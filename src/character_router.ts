// ============================================================
// Character Sheet API Router
// D&D 5e Combat Sim
//
// Mounted at /api/characters and /api/parties in server.ts.
// Isolated here to avoid merge conflicts with the combat agent.
//
// Endpoints:
//   GET    /api/characters              list all character sheets
//   POST   /api/characters              create a new character sheet
//   GET    /api/characters/:id          get one character sheet
//   PUT    /api/characters/:id          update a character sheet
//   DELETE /api/characters/:id          delete a character sheet
//   POST   /api/characters/import       import from JSON string
//   GET    /api/characters/:id/export   export as JSON string
//
//   GET    /api/parties                 list all parties
//   POST   /api/parties                 create a new party
//   GET    /api/parties/:id             get one party (with member names)
//   PUT    /api/parties/:id             update a party
//   DELETE /api/parties/:id             delete a party
//   GET    /api/parties/:id/members     get full character sheets for party members
//   POST   /api/parties/:id/awardxp     award combat XP to all party members
//
// Character management extras:
//   POST   /api/characters/:id/chooseinvocations   set Warlock Eldritch Invocations
//   POST   /api/characters/:id/choosepactboon       set Warlock Pact Boon
//   POST   /api/characters/:id/choosesecondstyle    set Champion 10 second Fighting Style
//   POST   /api/characters/:id/addxp                award XP to a single character
//   POST   /api/characters/:id/settempstats         set/clear temporary stat overrides
// ============================================================

import { Router, Request, Response } from 'express';
import * as path from 'path';
import {
  saveCharacter, loadCharacter, listCharacters,
  deleteCharacter, importCharacter, exportCharacter,
  saveParty, loadParty, listParties,
  deleteParty, loadPartyMembers,
} from './characters/storage';
import { ValidationError }            from './characters/validator';
import { buildCombatant, buildWarnings } from './characters/builder';
import { applyLevelUp, popLevel, bootstrapLevelHistory } from './characters/leveler';
import { applyASI, applyFeat, chooseSubclass, chooseEldritchInvocations, choosePactBoon } from './characters/improvements';
import { listFeats, getFeat }          from './characters/feat_data';
import { spawnMonster, Raw5etoolsMonster } from './parser/fivetools';
import { simulate }                    from './scenarios/simulate';
import { Combatant }                   from './types/core';
import { EncounterSpec }               from './scenarios/encounter';
import { totalLevel, XP_THRESHOLDS, crToXP, abilityModifier, CharacterAbilityScores } from './characters/types';
import { RACE_DATA, RACE_NAMES }             from './characters/race_data';
import { BACKGROUND_DATA, BACKGROUND_NAMES } from './characters/background_data';
import { computeStatRecommendation, CLASS_STAT_PRIORITY } from './characters/stat_optimizer';
import {
  CLASS_SPELL_LISTS, CLASS_SPELL_LIST_ALIASES, SPELLCASTING_CLASS_NAMES,
  SpellcastingClassName,
} from './characters/class_spell_lists';

// Lazy-loaded bestiary — mirrors getBestiary() in server.ts
let _bestiary: Map<string, Raw5etoolsMonster> | null = null;
function getBestiary(): Map<string, Raw5etoolsMonster> {
  if (_bestiary) return _bestiary;
  const dir = path.join(process.cwd(), 'bestiaryData');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadBestiaryDir } = require('./data/loader');
  const result = loadBestiaryDir(dir);
  // loadBestiaryDir returns LoadResult { bestiary: Map, ... }
  _bestiary = (result.bestiary ?? result) as Map<string, Raw5etoolsMonster>;
  return _bestiary!;
}


// Inlined from server.ts to avoid triggering app.listen() via circular import
function difficultyLabel(winRate: number): string {
  if (winRate >= 0.90) return 'Trivial';
  if (winRate >= 0.70) return 'Easy';
  if (winRate >= 0.45) return 'Medium';
  if (winRate >= 0.20) return 'Hard';
  if (winRate >= 0.05) return 'Deadly';
  return 'Nearly Impossible';
}
const router = Router();

// ---- Helpers ------------------------------------------------

function handleError(res: Response, err: unknown): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
  } else if (err instanceof Error) {
    res.status(500).json({ error: err.message });
  } else {
    res.status(500).json({ error: 'Unknown error' });
  }
}

// ---- Armor AC table (PHB p.144-145) -------------------------
// Maps lowercase armor name → { baseAC, dexBonus: 'full' | 'max2' | 'none' }
const PHB_ARMOR_AC: Record<string, { base: number; dex: 'full' | 'max2' | 'none' }> = {
  // Light armor (full DEX)
  'padded':           { base: 11, dex: 'full' },
  'leather':          { base: 11, dex: 'full' },
  'leather armor':    { base: 11, dex: 'full' },
  'studded leather':  { base: 12, dex: 'full' },
  // Medium armor (DEX max +2)
  'hide':             { base: 12, dex: 'max2' },
  'hide armor':       { base: 12, dex: 'max2' },
  'chain shirt':      { base: 13, dex: 'max2' },
  'scale mail':       { base: 14, dex: 'max2' },
  'breastplate':      { base: 14, dex: 'max2' },
  'half plate':       { base: 15, dex: 'max2' },
  // Heavy armor (no DEX)
  'ring mail':        { base: 14, dex: 'none' },
  'chain mail':       { base: 16, dex: 'none' },
  'splint':           { base: 17, dex: 'none' },
  'splint armor':     { base: 17, dex: 'none' },
  'plate':            { base: 18, dex: 'none' },
  'plate armor':      { base: 18, dex: 'none' },
};

/**
 * Recompute armorClass and acFormula from the character's equipped items.
 * Returns null when no recognized armor is equipped (preserves existing AC).
 * toggledCategory: pass 'shield' when the toggled item was a shield, so that
 *   unequipping a shield (equippedShield becomes undefined) still triggers a recompute.
 */
function computeArmorAC(
  sheet: import('./characters/types').CharacterSheet,
  newEquipment: import('./characters/types').EquipmentItem[],
  toggledCategory?: 'armor' | 'shield',
): { armorClass: number; acFormula: string } | null {
  const dexScore = sheet.stats?.dex ?? 10;
  const dexMod   = Math.floor((dexScore - 10) / 2);

  const equippedArmor  = newEquipment.find(e => e.equipped && e.category === 'armor');
  const equippedShield = newEquipment.find(e => e.equipped && e.category === 'shield');

  if (!equippedArmor) {
    // Unarmored — update when a shield was toggled (equip OR unequip)
    if (equippedShield !== undefined || toggledCategory === 'shield') {
      // Per-class Unarmored Defense (PHB p.48 Barbarian, p.78 Monk)
      const classNames = (sheet.classLevels ?? []).map(cl => cl.className);
      const conScore = sheet.stats?.con ?? 10;
      const conMod   = Math.floor((conScore - 10) / 2);
      const wisScore = sheet.stats?.wis ?? 10;
      const wisMod   = Math.floor((wisScore - 10) / 2);

      let unarmoredBase: number;
      let baseLabel: string;
      if (classNames.includes('Barbarian')) {
        unarmoredBase = 10 + dexMod + conMod;
        baseLabel = `Unarmored Defense (Barbarian): ${unarmoredBase}`;
      } else if (classNames.includes('Monk')) {
        unarmoredBase = 10 + dexMod + wisMod;
        baseLabel = `Unarmored Defense (Monk): ${unarmoredBase}`;
      } else {
        unarmoredBase = 10 + dexMod;
        baseLabel = `Unarmored: ${unarmoredBase}`;
      }

      const total = unarmoredBase + (equippedShield ? 2 : 0);
      const formula = `${baseLabel}${equippedShield ? ' + Shield: +2' : ''}`;
      return { armorClass: total, acFormula: formula };
    }
    // No armor and shield state unchanged — let existing AC stand
    return null;
  }

  const entry = PHB_ARMOR_AC[equippedArmor.name.toLowerCase()];
  if (!entry) return null; // Unknown armor — don't override manually set AC

  let ac = entry.base;
  if (entry.dex === 'full')  ac += dexMod;
  if (entry.dex === 'max2')  ac += Math.min(dexMod, 2);
  // heavy: no DEX

  const shieldBonus = equippedShield ? 2 : 0;
  ac += shieldBonus;

  const formula = `${equippedArmor.name}: ${entry.base}${
    entry.dex === 'full'  ? ` + DEX ${dexMod >= 0 ? '+' : ''}${dexMod}` :
    entry.dex === 'max2'  ? ` + DEX ${Math.min(dexMod, 2) >= 0 ? '+' : ''}${Math.min(dexMod, 2)} (max 2)` : ''
  }${shieldBonus ? ' + Shield: +2' : ''}`;

  return { armorClass: ac, acFormula: formula };
}

// ---- Character Endpoints ------------------------------------

// GET /api/characters — list all characters (summary only)
router.get('/characters', (_req: Request, res: Response) => {
  try {
    const sheets = listCharacters();
    // Return summary (no equipment/features bulk) for list view
    const summary = sheets.map(s => ({
      id:          s.id,
      name:        s.name,
      race:        s.race,
      background:  s.background,
      firstClass:  s.firstClass,
      classLevels: s.classLevels,
      experiencePoints: s.experiencePoints,
      maxHP:       s.maxHP,
      armorClass:  s.armorClass,
      updatedAt:   s.updatedAt,
    }));
    res.json({ characters: summary, total: summary.length });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/characters — create a new character sheet
router.post('/characters', (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }
    // Strip id/timestamps — saveCharacter stamps these
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = body;
    const saved = saveCharacter(rest as any);
    return res.status(201).json({ character: saved });
  } catch (err) {
    return handleError(res, err);
  }
});

// GET /api/characters/:id — get one character sheet
router.get('/characters/:id', (req: Request, res: Response) => {
  try {
    const sheet = loadCharacter(String(req.params.id));
    if (!sheet) return res.status(404).json({ error: `Character "${String(req.params.id)}" not found` });
    return res.json({ character: sheet });
  } catch (err) {
    return handleError(res, err);
  }
});

// PUT /api/characters/:id — update a character sheet
router.put('/characters/:id', (req: Request, res: Response) => {
  try {
    const existing = loadCharacter(String(req.params.id));
    if (!existing) return res.status(404).json({ error: `Character "${String(req.params.id)}" not found` });

    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }

    // Merge: id and createdAt are immutable; everything else can change
    const updated = {
      ...existing,
      ...body,
      id:        existing.id,
      createdAt: existing.createdAt,
    };
    const saved = saveCharacter(updated);
    return res.json({ character: saved });
  } catch (err) {
    return handleError(res, err);
  }
});

// DELETE /api/characters/:id
router.delete('/characters/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteCharacter(String(req.params.id));
    if (!deleted) return res.status(404).json({ error: `Character "${String(req.params.id)}" not found` });
    return res.json({ deleted: true, id: String(req.params.id) });
  } catch (err) {
    return handleError(res, err);
  }
});

// POST /api/characters/import — import from JSON string in body
router.post('/characters/import', (req: Request, res: Response) => {
  try {
    const { json } = req.body as { json?: string };
    if (typeof json !== 'string') {
      return res.status(400).json({ error: 'Body must have a "json" string field' });
    }
    const imported = importCharacter(json);
    return res.status(201).json({ character: imported });
  } catch (err) {
    return handleError(res, err);
  }
});

// GET /api/characters/:id/export — export as JSON
router.get('/characters/:id/export', (req: Request, res: Response) => {
  try {
    const json = exportCharacter(String(req.params.id));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="character-${String(req.params.id)}.json"`
    );
    return res.send(json);
  } catch (err) {
    return handleError(res, err);
  }
});

// ---- Party Endpoints ----------------------------------------

// GET /api/parties — list all parties
router.get('/parties', (_req: Request, res: Response) => {
  try {
    const parties = listParties();
    res.json({ parties, total: parties.length });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/parties — create a new party
router.post('/parties', (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = body;
    const saved = saveParty(rest as any);
    return res.status(201).json({ party: saved });
  } catch (err) {
    return handleError(res, err);
  }
});

// GET /api/parties/:id — get one party
router.get('/parties/:id', (req: Request, res: Response) => {
  try {
    const party = loadParty(String(req.params.id));
    if (!party) return res.status(404).json({ error: `Party "${String(req.params.id)}" not found` });
    return res.json({ party });
  } catch (err) {
    return handleError(res, err);
  }
});

// PUT /api/parties/:id — update a party
router.put('/parties/:id', (req: Request, res: Response) => {
  try {
    const existing = loadParty(String(req.params.id));
    if (!existing) return res.status(404).json({ error: `Party "${String(req.params.id)}" not found` });

    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }

    const updated = {
      ...existing,
      ...body,
      id:        existing.id,
      createdAt: existing.createdAt,
    };
    const saved = saveParty(updated);
    return res.json({ party: saved });
  } catch (err) {
    return handleError(res, err);
  }
});

// DELETE /api/parties/:id
router.delete('/parties/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteParty(String(req.params.id));
    if (!deleted) return res.status(404).json({ error: `Party "${String(req.params.id)}" not found` });
    return res.json({ deleted: true, id: String(req.params.id) });
  } catch (err) {
    return handleError(res, err);
  }
});

// GET /api/parties/:id/members — get full character sheets for party members
router.get('/parties/:id/members', (req: Request, res: Response) => {
  try {
    const party = loadParty(String(req.params.id));
    if (!party) return res.status(404).json({ error: `Party "${String(req.params.id)}" not found` });
    const members = loadPartyMembers(String(req.params.id));
    return res.json({ party, members, total: members.length });
  } catch (err) {
    return handleError(res, err);
  }
});


// ============================================================
// POST /api/parties/:id/awardxp
// Award combat XP to all party members based on defeated monsters.
// XP is split evenly among party members (floor division).
//
// Request body:
//   { enemies: { name: string; count?: number }[] }
//
// Response:
//   { totalXP: number; xpEach: number; awarded: AwardedMember[] }
//   AwardedMember: { id, name, xpAwarded, totalXP, prevLevel, readyToLevel }
// ============================================================
router.post('/parties/:id/awardxp', async (req: Request, res: Response) => {
  try {
    const partyId   = String(req.params.id);
    const body      = req.body ?? {};
    const enemies   = body.enemies as { name: string; count?: number }[] | undefined;
    const xpOverride = typeof body.xpOverride === 'number' ? body.xpOverride : null;

    // Require either enemies array OR xpOverride
    if (xpOverride === null && (!Array.isArray(enemies) || enemies.length === 0)) {
      return res.status(400).json({ error: 'Provide enemies array or xpOverride (number)' });
    }

    const party = loadParty(partyId);
    if (!party) return res.status(404).json({ error: `Party "${partyId}" not found` });
    if (!party.characterIds || party.characterIds.length === 0) {
      return res.status(400).json({ error: 'Party has no members' });
    }

    let totalXP = 0;

    if (xpOverride !== null) {
      // Direct XP override — skip bestiary lookup
      totalXP = Math.max(0, Math.floor(xpOverride));
    } else {
      // Sum total XP from defeated monsters
      const bestiary = getBestiary();
      const unknownNames: string[] = [];
      for (const cfg of enemies!) {
        const count   = Math.max(cfg.count ?? 1, 1);
        const monster = bestiary.get(cfg.name.toLowerCase());
        if (!monster) { unknownNames.push(cfg.name); continue; }
        totalXP += crToXP(monster.cr) * count;
      }
      // If every supplied enemy was unrecognized, return 400
      if (unknownNames.length === enemies!.length) {
        return res.status(400).json({
          error: `None of the supplied enemies were found in the bestiary: ${unknownNames.join(', ')}`,
        });
      }
    }

    const memberCount = party.characterIds.length;
    const xpEach     = Math.floor(totalXP / Math.max(memberCount, 1));

    // Apply XP to each member
    type AwardedMember = {
      id: string; name: string;
      xpAwarded: number; totalXP: number;
      prevLevel: number; readyToLevel: boolean;
    };
    const awarded: AwardedMember[] = [];

    for (const id of party.characterIds) {
      const sheet = loadCharacter(String(id));
      if (!sheet) continue;

      const prevLevel  = totalLevel(sheet);
      const newXP      = sheet.experiencePoints + xpEach;
      const updated    = { ...sheet, experiencePoints: newXP };
      await saveCharacter(updated);

      // Level N → N+1 threshold is XP_THRESHOLDS[prevLevel] (0-indexed, level 1 = index 0)
      const nextThreshXP = prevLevel < 20 ? (XP_THRESHOLDS[prevLevel] ?? null) : null;
      const readyToLevel = nextThreshXP !== null && newXP >= nextThreshXP;

      awarded.push({ id, name: sheet.name, xpAwarded: xpEach, totalXP: newXP, prevLevel, readyToLevel });
    }

    return res.json({ totalXP, xpEach, awarded });
  } catch (err) {
    return handleError(res, err);
  }
});


// ---- POST /api/simulate/custom ------------------------------
// Run a simulation where the party is built from saved CharacterSheets
// instead of preset class templates.
//
// Request body:
//   {
//     partyCharacterIds: string[],        // IDs of saved characters
//     enemies: { name: string; count?: number; aiProfile?: string }[],
//     trials?: number                     // 1–500, default 100
//   }
//
// Response: same shape as POST /api/simulate
router.post('/simulate/custom', (req: Request, res: Response) => {
  try {
    const body = req.body as {
      partyCharacterIds?: string[];
      enemies?: { name: string; count?: number; aiProfile?: string }[];
      trials?: number;
    };

    if (!Array.isArray(body.partyCharacterIds) || body.partyCharacterIds.length === 0) {
      return res.status(400).json({ error: 'partyCharacterIds must be a non-empty array' });
    }
    if (!Array.isArray(body.enemies) || body.enemies.length === 0) {
      return res.status(400).json({ error: 'enemies must be a non-empty array' });
    }
    const trials = Math.min(Math.max(body.trials ?? 100, 1), 500);

    // Build party from saved character sheets
    const party: Combatant[] = [];
    const warnings: string[] = [];
    let px = 0;

    for (const id of body.partyCharacterIds) {
      const sheet = loadCharacter(String(id));
      if (!sheet) {
        return res.status(400).json({ error: `Character "${id}" not found` });
      }
      const w = buildWarnings(sheet);
      if (w.length > 0) warnings.push(...w.map(ww => `${sheet.name}: ${ww}`));

      party.push(buildCombatant(sheet, { x: px++, y: 0, z: 0 }, 'smart'));
    }

    // Build enemies
    const enemies: Combatant[] = [];
    const bestiary = getBestiary();
    let ex = 0;

    for (const cfg of body.enemies) {
      const n = Math.min(Math.max(cfg.count ?? 1, 1), 20);
      for (let i = 0; i < n; i++) {
        const m = spawnMonster(bestiary, cfg.name, { x: ex++ * 2, y: 6, z: 0 }, (cfg.aiProfile as any) ?? 'attackNearest');
        if (!m) {
          return res.status(400).json({ error: `Unknown monster: "${cfg.name}"` });
        }
        enemies.push(m);
      }
    }

    const spec: EncounterSpec = { party, enemies };
    const result = simulate(spec, { runs: trials });

    return res.json({
      runs:              result.runs,
      partyWinRate:      result.partyWinRate,
      enemyWinRate:      result.enemyWinRate,
      drawRate:          result.drawRate,
      avgRounds:         result.avgRounds,
      minRounds:         result.minRounds,
      maxRounds:         result.maxRounds,
      combatantStats:    result.combatantStats,
      roundDistribution: result.roundDistribution,
      difficulty:        difficultyLabel(result.partyWinRate),
      warnings:          warnings.length > 0 ? warnings : undefined,
    });
  } catch (err) {
    return handleError(res, err);
  }
});


// ============================================================
// POST /api/characters/:id/levelup
// Advance a saved character by one level.
// Body: { className: string; hpRollMethod?: "average" | "max" }
// Response: { character: CharacterSheet; hpGained: number; newFeatures: ...; subclassPrompt?: string; abilityScoreImprovement?: true }
// ============================================================
router.post('/:id/levelup', async (req: Request, res: Response) => {
  try {
    const id   = String(req.params.id);
    const body = req.body ?? {};
    const className = body.className;

    if (!className || typeof className !== 'string') {
      return res.status(400).json({ error: 'className (string) is required in the request body.' });
    }

    const hpRollMethod: 'average' | 'max' =
      body.hpRollMethod === 'max' ? 'max' : 'average';

    // Load existing sheet
    const sheet = loadCharacter(id);
    if (!sheet) {
      return res.status(404).json({ error: `Character not found: ${id}` });
    }

    // Apply level-up (throws on validation errors)
    const result = applyLevelUp(sheet, className, hpRollMethod);

    // Persist the updated sheet
    await saveCharacter(result.sheet);

    return res.json({
      character:               result.sheet,
      hpGained:                result.hpGained,
      newFeatures:             result.newFeatures,
      ...(result.subclassPrompt          !== undefined && { subclassPrompt:          result.subclassPrompt }),
      ...(result.abilityScoreImprovement !== undefined && { abilityScoreImprovement: result.abilityScoreImprovement }),
    });
  } catch (err) {
    return handleError(res, err);
  }
});

export default router;

// ============================================================
// (routes added below to avoid merge conflicts with combat agent)
// ============================================================

// ============================================================
// POST /api/characters/:id/applyasi
// Apply one Ability Score Improvement to a saved character.
//
// Rules (PHB p.165):
//   - Each ASI grants +2 points freely: +2 to one score, or +1/+1 split.
//   - amount=2 → full ASI consumed; amount=1 → half ASI (two calls per ASI).
//   - Scores cannot exceed 20.
//   - pendingAbilityScoreImprovements must be >= 1 (or half-point available).
//
// Request:  { ability: "str"|"dex"|"con"|"int"|"wis"|"cha"; amount: 1|2 }
// Response: { character: CharacterSheet; oldScore: number; newScore: number }
// ============================================================
router.post('/characters/:id/applyasi', async (req: Request, res: Response) => {
  try {
    const id   = String(req.params.id);
    const body = req.body ?? {};

    const ability = body.ability;
    const amount  = body.amount;

    if (!ability || typeof ability !== 'string') {
      return res.status(400).json({ error: 'ability (string) is required.' });
    }
    if (amount !== 1 && amount !== 2) {
      return res.status(400).json({ error: 'amount must be 1 or 2.' });
    }

    const sheet = loadCharacter(id);
    if (!sheet) {
      return res.status(404).json({ error: `Character not found: ${id}` });
    }

    const oldScore = (sheet.stats as any)[ability];
    const updated  = applyASI(sheet, ability, amount);

    await saveCharacter(updated);

    return res.json({
      character: updated,
      ability,
      oldScore,
      newScore: (updated.stats as any)[ability],
      pendingAbilityScoreImprovements: updated.pendingAbilityScoreImprovements ?? 0,
      pendingASIHalfPoints:            updated.pendingASIHalfPoints ?? 0,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

// ============================================================
// POST /api/characters/:id/applyfeat
// Apply a feat chosen instead of an Ability Score Improvement (PHB p.165).
// Consumes one full pending ASI (same accounting as applyasi amount=2).
//
// Request:  { featName: string; abilityChoice?: string;
//              skillChoices?: string[]; toolChoices?: string[];
//              languageChoices?: string[] }
// Response: { character: CharacterSheet; featName: string;
//              pendingAbilityScoreImprovements: number; pendingASIHalfPoints: number }
// ============================================================
router.post('/characters/:id/applyfeat', async (req: Request, res: Response) => {
  try {
    const id   = String(req.params.id);
    const body = req.body ?? {};

    const featName = body.featName;
    if (!featName || typeof featName !== 'string') {
      return res.status(400).json({ error: 'featName (string) is required.' });
    }

    const sheet = loadCharacter(id);
    if (!sheet) {
      return res.status(404).json({ error: `Character not found: ${id}` });
    }

    const updated = applyFeat(sheet, featName, {
      abilityChoice:   typeof body.abilityChoice === 'string' ? body.abilityChoice : undefined,
      skillChoices:    Array.isArray(body.skillChoices) ? body.skillChoices : undefined,
      toolChoices:     Array.isArray(body.toolChoices) ? body.toolChoices : undefined,
      languageChoices: Array.isArray(body.languageChoices) ? body.languageChoices : undefined,
    });

    await saveCharacter(updated);

    return res.json({
      character: updated,
      featName,
      grantsSpells:                    !!(getFeat(featName)?.grantsSpells),
      pendingAbilityScoreImprovements: updated.pendingAbilityScoreImprovements ?? 0,
      pendingASIHalfPoints:            updated.pendingASIHalfPoints ?? 0,
    });
  } catch (err) {
    return handleError(res, err);
  }
});


// ============================================================
// POST /api/characters/:id/setfeatspells
// Record the spell choices made for a spell-granting feat
// (Magic Initiate, Ritual Caster, Spell Sniper — flagged via
// `grantsSpells` in feat_data.ts). Purely informational: validates
// that the named feat is actually on the character and that it is a
// spell-granting one, then persists the chosen spell names.
//
// Request:  { featName: string; spells: string[] }
// Response: { character: CharacterSheet; featName: string; spells: string[] }
// ============================================================
router.post('/characters/:id/setfeatspells', async (req: Request, res: Response) => {
  try {
    const id   = String(req.params.id);
    const body = req.body ?? {};

    const featName = body.featName;
    if (!featName || typeof featName !== 'string') {
      return res.status(400).json({ error: 'featName (string) is required.' });
    }
    const spells = body.spells;
    if (!Array.isArray(spells) || spells.some((s: unknown) => typeof s !== 'string')) {
      return res.status(400).json({ error: 'spells must be an array of strings.' });
    }
    if (spells.length === 0) {
      return res.status(400).json({ error: 'spells must contain at least one spell name.' });
    }

    const featDef = getFeat(featName);
    if (!featDef) {
      return res.status(400).json({ error: `Unknown feat "${featName}".` });
    }
    if (!featDef.grantsSpells) {
      return res.status(400).json({ error: `Feat "${featName}" does not grant spells. Only Magic Initiate, Ritual Caster, and Spell Sniper accept spell choices via this endpoint.` });
    }

    const sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });

    if (!(sheet.feats || []).includes(featName)) {
      return res.status(409).json({ error: `Character does not have the "${featName}" feat. Apply it first via POST /applyfeat.` });
    }

    const updated = {
      ...sheet,
      featSpellChoices: {
        ...(sheet.featSpellChoices ?? {}),
        [featName]: spells,
      },
      updatedAt: new Date().toISOString(),
    };

    await saveCharacter(updated);
    return res.json({ character: updated, featName, spells });
  } catch (err) {
    return handleError(res, err);
  }
});

// Set the subclass for a class on a saved character.
//
// Rules:
//   - className must exist in sheet.classLevels
//   - subclassChoices[className] must not already be set
//   - subclassName must be non-empty
//
// Request:  { className: string; subclassName: string }
// Response: { character: CharacterSheet; className: string; subclassName: string }
// ============================================================
router.post('/characters/:id/choosesubclass', async (req: Request, res: Response) => {
  try {
    const id   = String(req.params.id);
    const body = req.body ?? {};

    const className    = body.className;
    const subclassName = body.subclassName;

    if (!className || typeof className !== 'string') {
      return res.status(400).json({ error: 'className (string) is required.' });
    }
    if (!subclassName || typeof subclassName !== 'string') {
      return res.status(400).json({ error: 'subclassName (string) is required.' });
    }

    const sheet = loadCharacter(id);
    if (!sheet) {
      return res.status(404).json({ error: `Character not found: ${id}` });
    }

    const updated = chooseSubclass(sheet, className, subclassName);
    await saveCharacter(updated);

    return res.json({
      character:   updated,
      className,
      subclassName: updated.subclassChoices[className],
    });
  } catch (err) {
    return handleError(res, err);
  }
});

// ============================================================
// POST /api/characters/:id/chooseinvocations
// Set the full list of Eldritch Invocations for a Warlock.
// Body: { invocations: string[] }  — must be exactly the right count for level.
// Response: { character: CharacterSheet; invocations: string[] }
// ============================================================
router.post('/characters/:id/chooseinvocations', async (req: Request, res: Response) => {
  try {
    const id   = String(req.params.id);
    const body = req.body ?? {};

    const invocations = body.invocations;
    if (!Array.isArray(invocations) || invocations.some(v => typeof v !== 'string')) {
      return res.status(400).json({ error: 'invocations (string[]) is required.' });
    }

    const sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });

    const updated = chooseEldritchInvocations(sheet, invocations);
    await saveCharacter(updated);

    return res.json({ character: updated, invocations: updated.eldritchInvocations });
  } catch (err) {
    // chooseEldritchInvocations throws plain Error for all validation failures
    if (err instanceof Error) return res.status(400).json({ error: err.message });
    return handleError(res, err);
  }
});

// ============================================================
// POST /api/characters/:id/choosepactboon
// Set the Pact Boon for a Warlock level 3+ (chain/blade/tome).
// Body: { boon: 'chain' | 'blade' | 'tome' }
// Response: { character: CharacterSheet; pactBoon: string }
// ============================================================
router.post('/characters/:id/choosepactboon', async (req: Request, res: Response) => {
  try {
    const id   = String(req.params.id);
    const body = req.body ?? {};

    const VALID_BOONS = ['chain', 'blade', 'tome'] as const;
    const boon = body.boon;
    if (!boon || !VALID_BOONS.includes(boon)) {
      return res.status(400).json({ error: `boon must be one of: ${VALID_BOONS.join(', ')}.` });
    }

    const sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });

    const updated = choosePactBoon(sheet, boon);
    await saveCharacter(updated);

    return res.json({ character: updated, pactBoon: updated.pactBoon });
  } catch (err) {
    // choosePactBoon throws plain Error for all validation failures
    if (err instanceof Error) return res.status(400).json({ error: err.message });
    return handleError(res, err);
  }
});

// ============================================================
// POST /api/characters/:id/choosesecondstyle
// Set the second Fighting Style for a Champion 10+ character.
// Body:     { style: string }
// Response: { character: CharacterSheet; secondFightingStyle: string }
// Errors:   400 if style is not one of the 6 PHB Fighting Styles,
//           400 if character does not have the "Additional Fighting Style"
//           feature (not a Champion 10+).
// ============================================================
const FIGHTING_STYLES = [
  'Archery', 'Defense', 'Dueling',
  'Great Weapon Fighting', 'Protection', 'Two-Weapon Fighting',
] as const;

router.post('/characters/:id/choosesecondstyle', async (req: Request, res: Response) => {
  try {
    const id    = String(req.params.id);
    const style = req.body?.style;

    if (!style || !FIGHTING_STYLES.includes(style as typeof FIGHTING_STYLES[number])) {
      return res.status(400).json({
        error: `style must be one of: ${FIGHTING_STYLES.join(', ')}.`,
      });
    }

    const sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });

    const hasFeature = sheet.allFeatures.some(
      f => f.name === 'Additional Fighting Style',
    );
    if (!hasFeature) {
      return res.status(400).json({
        error: 'Character does not have the Additional Fighting Style feature (requires Champion 10).',
      });
    }

    const updated: typeof sheet = { ...sheet, secondFightingStyle: style };
    await saveCharacter(updated);

    return res.json({ character: updated, secondFightingStyle: style });
  } catch (err) {
    return handleError(res, err);
  }
});

// ============================================================
// POST /api/characters/:id/addxp
// Award XP directly to a single character.
// Body: { amount: number }
// Response: { character: CharacterSheet; newTotal: number }
// ============================================================
router.post('/characters/:id/addxp', async (req: Request, res: Response) => {
  try {
    const id   = String(req.params.id);
    const body = req.body ?? {};

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: 'amount must be a non-negative number.' });
    }

    const sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });

    const updated = {
      ...sheet,
      experiencePoints: (sheet.experiencePoints || 0) + amount,
      updatedAt: new Date().toISOString(),
    };
    await saveCharacter(updated);

    return res.json({ character: updated, newTotal: updated.experiencePoints });
  } catch (err) {
    return handleError(res, err);
  }
});

// ============================================================
// POST /api/characters/:id/settempstats
// Set or clear temporary ability score overrides (PHB p.173).
// Body: { overrides: Partial<Record<AbilityScore, number | null>> }
//   - Setting a key to a number sets the override for that ability.
//   - Setting a key to null clears the override for that ability.
//   - Omitting a key leaves the existing override unchanged.
// Response: { character: CharacterSheet; tempStatOverrides: Record }
// ============================================================
router.post('/characters/:id/settempstats', async (req: Request, res: Response) => {
  try {
    const id   = String(req.params.id);
    const body = req.body ?? {};

    const { overrides } = body;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      return res.status(400).json({ error: 'overrides (object) is required.' });
    }

    const VALID_ABILITIES = new Set(['str', 'dex', 'con', 'int', 'wis', 'cha']);
    for (const [key, val] of Object.entries(overrides)) {
      if (!VALID_ABILITIES.has(key)) {
        return res.status(400).json({ error: `Invalid ability score key: "${key}". Must be one of str, dex, con, int, wis, cha.` });
      }
      if (val !== null && (typeof val !== 'number' || !Number.isInteger(val) || val < 1 || val > 30)) {
        return res.status(400).json({ error: `Override for "${key}" must be an integer 1–30 or null to clear.` });
      }
    }

    const sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });

    // Merge into existing overrides; null entries remove the key
    const existing = { ...(sheet.tempStatOverrides ?? {}) };
    for (const [key, val] of Object.entries(overrides)) {
      if (val === null) {
        delete existing[key as keyof typeof existing];
      } else {
        (existing as Record<string, number>)[key] = val as number;
      }
    }

    const updated = {
      ...sheet,
      tempStatOverrides: Object.keys(existing).length > 0 ? existing : undefined,
      updatedAt: new Date().toISOString(),
    };
    await saveCharacter(updated);

    return res.json({ character: updated, tempStatOverrides: updated.tempStatOverrides ?? {} });
  } catch (err) {
    return handleError(res, err);
  }
});

// ============================================================
// POST /api/characters/:id/damage
// Apply damage to a character with proper temp-HP absorption (PHB p.198).
//   Body:     { amount: number }
//   Response: { character, applied, absorbed, newHP, newTempHP, wasKO }
// Temp HP is depleted first; remainder reduces current HP (min 0).
// Clears deathSaves when the character drops to 0.
// ============================================================
router.post('/characters/:id/damage', async (req: Request, res: Response) => {
  try {
    const id     = String(req.params.id);
    const amount = req.body?.amount;

    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive integer.' });
    }

    const sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });

    const curHP  = Math.max(0, sheet.currentHP);
    const curTHP = Math.max(0, sheet.temporaryHP || 0);

    // THP absorbs damage first (PHB p.198)
    const absorbed = Math.min(curTHP, amount);
    const newTHP   = curTHP - absorbed;
    const remaining = amount - absorbed;
    const newHP    = Math.max(0, curHP - remaining);
    const wasKO    = newHP === 0 && curHP > 0;
    const applied  = Math.min(curHP, remaining) + absorbed; // total damage dealt

    const updated: typeof sheet = {
      ...sheet,
      currentHP:   newHP,
      temporaryHP: newTHP,
      updatedAt:   new Date().toISOString(),
    };
    // Clear death saves when freshly knocked out
    if (wasKO) {
      updated.deathSaves = { successes: 0, failures: 0 };
    }

    await saveCharacter(updated);
    return res.json({ character: updated, applied, absorbed, newHP, newTempHP: newTHP, wasKO });
  } catch (err) {
    return handleError(res, err);
  }
});

// ============================================================
// POST /api/characters/:id/heal
// Heal a character, capping at maxHP (PHB p.197).
//   Body:     { amount: number }
//   Response: { character, healed, newHP }
// Clears deathSaves automatically when returning from 0 HP.
// ============================================================
router.post('/characters/:id/heal', async (req: Request, res: Response) => {
  try {
    const id     = String(req.params.id);
    const amount = req.body?.amount;

    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive integer.' });
    }

    const sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });

    const wasDown = sheet.currentHP <= 0;
    const newHP   = Math.min(sheet.maxHP, sheet.currentHP + amount);
    const healed  = newHP - sheet.currentHP;

    const updated: typeof sheet = {
      ...sheet,
      currentHP: newHP,
      updatedAt: new Date().toISOString(),
    };
    // Reset death saves when regaining consciousness
    if (wasDown && newHP > 0) {
      updated.deathSaves = { successes: 0, failures: 0 };
    }

    await saveCharacter(updated);
    return res.json({ character: updated, healed, newHP });
  } catch (err) {
    return handleError(res, err);
  }
});

// ============================================================
// POST /api/characters/:id/conditions
// Add, remove, or clear conditions (PHB p.290).
//   Body:     { action: 'add'|'remove'|'clear', condition?: string }
//   Response: { character, conditions: string[] }
// Duplicate adds are silently ignored; removes of absent conditions
// are silently ignored. Custom condition names are accepted.
// ============================================================
router.post('/characters/:id/conditions', async (req: Request, res: Response) => {
  try {
    const id     = String(req.params.id);
    const { action, condition } = req.body ?? {};

    const VALID_ACTIONS = new Set(['add', 'remove', 'clear']);
    if (!VALID_ACTIONS.has(action)) {
      return res.status(400).json({ error: 'action must be "add", "remove", or "clear".' });
    }
    if (action !== 'clear') {
      if (typeof condition !== 'string' || condition.trim() === '') {
        return res.status(400).json({ error: 'condition (non-empty string) required for add/remove.' });
      }
    }

    const sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });

    let conditions = [...(sheet.conditions ?? [])];
    const cond = (condition ?? '').trim();

    if (action === 'add') {
      if (!conditions.includes(cond)) conditions.push(cond);
    } else if (action === 'remove') {
      conditions = conditions.filter(c => c !== cond);
    } else {
      // clear
      conditions = [];
    }

    const updated = {
      ...sheet,
      conditions,
      updatedAt: new Date().toISOString(),
    };
    await saveCharacter(updated);
    return res.json({ character: updated, conditions });
  } catch (err) {
    return handleError(res, err);
  }
});

// ============================================================
// POST /api/characters/:id/useslot
// Expend one spell slot of the given level.
//   Body:     { level: number }   (1-9, or pact slot via level 0)
//   Response: { character, level, remaining, used }
// Returns 400 if no slots are available at that level.
// ============================================================
router.post('/characters/:id/useslot', async (req: Request, res: Response) => {
  try {
    const id    = String(req.params.id);
    const level = req.body?.level;

    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 9) {
      return res.status(400).json({ error: 'level must be an integer 1–9.' });
    }

    const sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });
    if (!sheet.spellcasting) {
      return res.status(400).json({ error: 'Character has no spellcasting block.' });
    }

    const key  = String(level);
    const max  = (sheet.spellcasting.slots?.[key]) ?? 0;
    const used = (sheet.spellcasting.slotsUsed?.[key]) ?? 0;

    if (max === 0) {
      return res.status(400).json({ error: `No level-${level} slots available for this character.` });
    }
    if (used >= max) {
      return res.status(400).json({ error: `No level-${level} slots remaining (${used}/${max} used).` });
    }

    const newUsed = used + 1;
    const updated = {
      ...sheet,
      spellcasting: {
        ...sheet.spellcasting,
        slotsUsed: { ...(sheet.spellcasting.slotsUsed ?? {}), [key]: newUsed },
      },
      updatedAt: new Date().toISOString(),
    };
    await saveCharacter(updated);
    return res.json({ character: updated, level, remaining: max - newUsed, used: newUsed });
  } catch (err) {
    return handleError(res, err);
  }
});

// ============================================================
// POST /api/characters/:id/restoreslot
// Restore one used spell slot of the given level.
//   Body:     { level: number }   (1-9)
//   Response: { character, level, remaining, used }
// Returns 400 if no used slots exist at that level.
// ============================================================
router.post('/characters/:id/restoreslot', async (req: Request, res: Response) => {
  try {
    const id    = String(req.params.id);
    const level = req.body?.level;

    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 9) {
      return res.status(400).json({ error: 'level must be an integer 1–9.' });
    }

    const sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });
    if (!sheet.spellcasting) {
      return res.status(400).json({ error: 'Character has no spellcasting block.' });
    }

    const key  = String(level);
    const max  = (sheet.spellcasting.slots?.[key]) ?? 0;
    const used = (sheet.spellcasting.slotsUsed?.[key]) ?? 0;

    if (max === 0) {
      return res.status(400).json({ error: `No level-${level} slots exist for this character.` });
    }
    if (used <= 0) {
      return res.status(400).json({ error: `No used level-${level} slots to restore.` });
    }

    const newUsed = used - 1;
    const updated = {
      ...sheet,
      spellcasting: {
        ...sheet.spellcasting,
        slotsUsed: { ...(sheet.spellcasting.slotsUsed ?? {}), [key]: newUsed },
      },
      updatedAt: new Date().toISOString(),
    };
    await saveCharacter(updated);
    return res.json({ character: updated, level, remaining: max - newUsed, used: newUsed });
  } catch (err) {
    return handleError(res, err);
  }
});

// ============================================================
// POST /api/characters/:id/longrest
// Apply a long rest: restore HP, spell slots, per-long-rest resources, hit dice.
// Response: { character: CharacterSheet; restored: string[] }
// ============================================================
router.post('/characters/:id/longrest', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });

    const restored: string[] = [];
    const updated = JSON.parse(JSON.stringify(sheet)); // deep clone

    // HP
    if (updated.currentHP < updated.maxHP) {
      updated.currentHP = updated.maxHP;
      restored.push('HP fully restored');
    }
    updated.temporaryHP = 0;

    // Hit dice: recover half total (min 1), rounded down
    for (const hd of (updated.hitDice || [])) {
      const recover = Math.max(1, Math.floor(hd.total / 2));
      if (hd.remaining < hd.total) {
        hd.remaining = Math.min(hd.total, hd.remaining + recover);
        restored.push(`Hit dice recovered (${hd.className})`);
      }
    }

    // Spell slots
    if (updated.spellcasting) {
      const sc = updated.spellcasting;
      let slotsReset = false;
      for (const lvl of Object.keys(sc.slots || {})) {
        if ((sc.slotsUsed?.[lvl] ?? 0) > 0) {
          if (!sc.slotsUsed) sc.slotsUsed = {};
          sc.slotsUsed[lvl] = 0;
          slotsReset = true;
        }
      }
      if (slotsReset) restored.push('Spell slots restored');
      // Pact slots
      if (sc.pactSlots && sc.pactSlots.used > 0) {
        sc.pactSlots.used = 0;
        restored.push('Pact slots restored');
      }
    }

    // Per-long-rest class resources
    const r = updated.resources || {};
    if (r.secondWind && r.secondWind.remaining < r.secondWind.max) {
      r.secondWind.remaining = r.secondWind.max;
      restored.push('Second Wind restored');
    }
    if (r.rage && r.rage.remaining < r.rage.max) {
      r.rage.remaining = r.rage.max;
      restored.push('Rage uses restored');
    }
    if (r.bardicInspiration && r.bardicInspiration.remaining < r.bardicInspiration.max) {
      r.bardicInspiration.remaining = r.bardicInspiration.max;
      restored.push('Bardic Inspiration restored');
    }
    if (r.arcaneRecovery && r.arcaneRecovery.usesRemaining < 1) {
      r.arcaneRecovery.usesRemaining = 1;
      restored.push('Arcane Recovery restored');
    }
    if (r.layOnHands && r.layOnHands.remaining < r.layOnHands.pool) {
      r.layOnHands.remaining = r.layOnHands.pool;
      restored.push('Lay on Hands restored');
    }
    if (r.wardingBond && r.wardingBond.remaining < 1) {
      r.wardingBond.remaining = 1;
      restored.push('Warding Bond restored');
    }
    if (r.channelDivinity && r.channelDivinity.remaining < r.channelDivinity.max) {
      r.channelDivinity.remaining = r.channelDivinity.max;
      restored.push('Channel Divinity restored');
    }
    if (r.ki && r.ki.remaining < r.ki.max) {
      r.ki.remaining = r.ki.max;
      restored.push('Ki points restored');
    }
    // Fighter — Action Surge (short or long rest, PHB p.72)
    if (r.actionSurge && r.actionSurge.remaining < r.actionSurge.max) {
      r.actionSurge.remaining = r.actionSurge.max;
      restored.push('Action Surge restored');
    }
    // Sorcerer — Sorcery Points (long rest only, PHB p.101)
    if (r.sorceryPoints && r.sorceryPoints.remaining < r.sorceryPoints.max) {
      r.sorceryPoints.remaining = r.sorceryPoints.max;
      restored.push('Sorcery Points restored');
    }
    // Druid — Wild Shape (short or long rest, PHB p.66)
    if (r.wildShape && r.wildShape.remaining < r.wildShape.max) {
      r.wildShape.remaining = r.wildShape.max;
      restored.push('Wild Shape uses restored');
    }
    // Fighter — Indomitable (long rest only, PHB p.72)
    if (r.indomitable && r.indomitable.remaining < r.indomitable.max) {
      r.indomitable.remaining = r.indomitable.max;
      restored.push('Indomitable restored');
    }
    // Paladin — Cleansing Touch (long rest only, PHB p.91)
    if (r.cleansingTouch && r.cleansingTouch.remaining < r.cleansingTouch.max) {
      r.cleansingTouch.remaining = r.cleansingTouch.max;
      restored.push('Cleansing Touch restored');
    }
    // Warlock — Mystic Arcanum (long rest only, PHB p.110)
    if (r.mysticArcanum) {
      const ma = r.mysticArcanum;
      const anyUsed = !ma.l6 || !ma.l7 || !ma.l8 || !ma.l9;
      // Only flip back to true the levels that have actually been unlocked
      // (an unlocked-but-unused level is already true; a not-yet-unlocked
      // level is undefined and must stay undefined, not become true).
      if (ma.l6 === false) ma.l6 = true;
      if (ma.l7 === false) ma.l7 = true;
      if (ma.l8 === false) ma.l8 = true;
      if (ma.l9 === false) ma.l9 = true;
      if (anyUsed) restored.push('Mystic Arcanum restored');
    }
    // Wizard — Spell Mastery (long rest only, PHB p.117)
    if (r.spellMastery && r.spellMastery.remaining < r.spellMastery.max) {
      r.spellMastery.remaining = r.spellMastery.max;
      restored.push('Spell Mastery restored');
    }
    // Artificer — Flash of Genius (long rest only, TCE p.16)
    if (r.flashOfGenius && r.flashOfGenius.remaining < r.flashOfGenius.max) {
      r.flashOfGenius.remaining = r.flashOfGenius.max;
      restored.push('Flash of Genius restored');
    }
    // Artificer — Spell-Storing Item (TCE p.16)
    if (r.spellStoringItem && r.spellStoringItem.remaining < r.spellStoringItem.max) {
      r.spellStoringItem.remaining = r.spellStoringItem.max;
      restored.push('Spell-Storing Item charges restored');
    }
    // Artificer — Soul of Artifice (long rest only, TCE p.17)
    if (r.soulOfArtifice && r.soulOfArtifice.remaining < r.soulOfArtifice.max) {
      r.soulOfArtifice.remaining = r.soulOfArtifice.max;
      restored.push('Soul of Artifice restored');
    }
    // Dragonborn — Breath Weapon (short or long rest, PHB p.34)
    if (r.breathWeapon && r.breathWeapon.remaining < r.breathWeapon.max) {
      r.breathWeapon.remaining = r.breathWeapon.max;
      restored.push('Breath Weapon restored');
    }
    // Half-Orc — Relentless Endurance (long rest only, PHB p.41)
    if (r.relentlessEndurance && r.relentlessEndurance.remaining < r.relentlessEndurance.max) {
      r.relentlessEndurance.remaining = r.relentlessEndurance.max;
      restored.push('Relentless Endurance restored');
    }

    // Exhaustion: reduce by 1 on long rest (PHB p.291)
    if (updated.exhaustionLevel && updated.exhaustionLevel > 0) {
      updated.exhaustionLevel -= 1;
      restored.push('Exhaustion reduced');
    }

    updated.updatedAt = new Date().toISOString();
    await saveCharacter(updated);

    return res.json({ character: updated, restored });
  } catch (err) {
    return handleError(res, err);
  }
});


// ============================================================
// POST /api/characters/:id/shortrest
// Apply a short rest: spend hit dice to recover HP, recharge
// short-rest resources (Second Wind, Action Surge, Warlock pact slots,
// Bardic Inspiration at lv5+, Channel Divinity, Ki points, Wild Shape,
// Dragonborn Breath Weapon).
// Body:     { hitDiceToSpend?: number }    (default 0)
// Response: { character: CharacterSheet; hpRegained: number; hdSpent: number; restored: string[] }
// ============================================================
router.post('/characters/:id/shortrest', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });

    const body          = req.body ?? {};
    const hdToSpend     = Math.max(0, Math.floor(Number(body.hitDiceToSpend ?? 0)));
    const rollMode: 'average' | 'random' = body.rollMode === 'random' ? 'random' : 'average';

    const updated       = JSON.parse(JSON.stringify(sheet)); // deep clone
    const conMod        = abilityModifier(updated.stats.con);
    const restored: string[] = [];
    let hpRegained      = 0;
    let hdSpent         = 0;

    // ---- Hit dice spending ------------------------------------
    // Each die spent: roll die + CON mod (min 1 per die), add to currentHP capped at maxHP.
    // PHB p.186. We use average (ceil(sides/2)) per die for determinism.
    // To use random rolls: Math.floor(Math.random() * dieSides) + 1
    let remaining = hdToSpend;
    for (const hd of (updated.hitDice || [])) {
      if (remaining <= 0) break;
      const canSpend = Math.min(remaining, hd.remaining);
      if (canSpend <= 0) continue;
      for (let i = 0; i < canSpend; i++) {
        const roll      = rollMode === 'random'
          ? (Math.floor(Math.random() * hd.dieSides) + 1)
          : (Math.floor(hd.dieSides / 2) + 1); // average: ceil(d/2)
        const gain      = Math.max(1, roll + conMod);
        hpRegained     += gain;
      }
      hd.remaining   -= canSpend;
      hdSpent        += canSpend;
      remaining      -= canSpend;
    }
    if (hpRegained > 0) {
      updated.currentHP = Math.min(updated.maxHP, updated.currentHP + hpRegained);
      // Clamp hpRegained to what was actually applied (can't go above maxHP)
      hpRegained = updated.currentHP - sheet.currentHP;
    }

    // ---- Short-rest resource recharge -------------------------
    const r = updated.resources || {};

    // Fighter — Second Wind (short or long rest, PHB p.72)
    if (r.secondWind && r.secondWind.remaining < r.secondWind.max) {
      r.secondWind.remaining = r.secondWind.max;
      restored.push('Second Wind restored');
    }

    // Warlock — Pact Magic slots (short or long rest, PHB p.107)
    if (updated.spellcasting?.pactSlots && updated.spellcasting.pactSlots.used > 0) {
      updated.spellcasting.pactSlots.used = 0;
      restored.push('Pact slots restored');
    }

    // Bard — Bardic Inspiration recharges on short rest only at lv5+ (Font of Inspiration, PHB p.54)
    // We detect eligibility via allFeatures lookup.
    if (r.bardicInspiration && r.bardicInspiration.remaining < r.bardicInspiration.max) {
      const hasFontOfInspiration = (updated.allFeatures || []).some(
        (f: { name: string }) => f.name === 'Font of Inspiration',
      );
      if (hasFontOfInspiration) {
        r.bardicInspiration.remaining = r.bardicInspiration.max;
        restored.push('Bardic Inspiration restored (Font of Inspiration)');
      }
    }

    // Cleric — Channel Divinity (short or long rest, PHB p.58)
    if (r.channelDivinity && r.channelDivinity.remaining < r.channelDivinity.max) {
      r.channelDivinity.remaining = r.channelDivinity.max;
      restored.push('Channel Divinity restored');
    }

    // Monk — Ki points (short or long rest, PHB p.78)
    if (r.ki && r.ki.remaining < r.ki.max) {
      r.ki.remaining = r.ki.max;
      restored.push('Ki points restored');
    }

    // Fighter — Action Surge (short or long rest, PHB p.72)
    if (r.actionSurge && r.actionSurge.remaining < r.actionSurge.max) {
      r.actionSurge.remaining = r.actionSurge.max;
      restored.push('Action Surge restored');
    }

    // Druid — Wild Shape (short or long rest, PHB p.66)
    if (r.wildShape && r.wildShape.remaining < r.wildShape.max) {
      r.wildShape.remaining = r.wildShape.max;
      restored.push('Wild Shape uses restored');
    }

    // Dragonborn — Breath Weapon (short or long rest, PHB p.34)
    if (r.breathWeapon && r.breathWeapon.remaining < r.breathWeapon.max) {
      r.breathWeapon.remaining = r.breathWeapon.max;
      restored.push('Breath Weapon restored');
    }

    updated.updatedAt = new Date().toISOString();
    await saveCharacter(updated);

    return res.json({ character: updated, hpRegained, hdSpent, restored });
  } catch (err) {
    return handleError(res, err);
  }
});

// ============================================================
// POST /api/characters/:id/setlevel
// Force a character to a target level (DM tool).
// Levels UP by looping applyLevelUp(); levels DOWN by looping popLevel().
// Requires levelHistory to be populated (characters leveled up via this system).
// Body:     { level: number; className?: string }
// Response: { character: CharacterSheet; levelsGained: number; levelsLost: number }
// ============================================================
router.post('/characters/:id/setlevel', async (req: Request, res: Response) => {
  try {
    const id   = String(req.params.id);
    const body = req.body ?? {};
    const targetLevel = Number(body.level);
    if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > 20) {
      return res.status(400).json({ error: 'level must be an integer 1–20.' });
    }

    let sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });

    const currentLvl = totalLevel(sheet);

    if (targetLevel > currentLvl) {
      // Level UP path
      const className: string = (typeof body.className === 'string' && body.className)
        ? body.className
        : (sheet.firstClass || (sheet.classLevels?.[0]?.className ?? ''));
      if (!className) {
        return res.status(400).json({ error: 'Cannot determine className. Provide it in request body.' });
      }
      const levelsGained = targetLevel - currentLvl;
      for (let i = 0; i < levelsGained; i++) {
        const result = applyLevelUp(sheet, className, 'average');
        sheet = result.sheet;
      }
      sheet = { ...sheet, experiencePoints: XP_THRESHOLDS[targetLevel - 1] ?? 0 };
      sheet.updatedAt = new Date().toISOString();
      await saveCharacter(sheet);
      return res.json({ character: sheet, levelsGained, levelsLost: 0 });

    } else if (targetLevel < currentLvl) {
      // Level DOWN path
      if (!sheet.levelHistory || sheet.levelHistory.length === 0) {
        // Legacy character: no history. Attempt automatic bootstrap.
        try {
          sheet = bootstrapLevelHistory(sheet);
        } catch (bootstrapErr: unknown) {
          return res.status(400).json({
            error:
              'Cannot level down: no level history recorded. ' +
              'Automatic bootstrap failed: ' +
              (bootstrapErr instanceof Error ? bootstrapErr.message : String(bootstrapErr)),
          });
        }
      }
      const levelsLost = currentLvl - targetLevel;
      for (let i = 0; i < levelsLost; i++) {
        const result = popLevel(sheet);
        sheet = result.sheet;
      }
      sheet = { ...sheet, experiencePoints: XP_THRESHOLDS[targetLevel - 1] ?? 0 };
      sheet.updatedAt = new Date().toISOString();
      await saveCharacter(sheet);
      return res.json({ character: sheet, levelsGained: 0, levelsLost });

    } else {
      return res.status(400).json({
        error: `Character is already level ${currentLvl}.`,
      });
    }
  } catch (err) {
    return handleError(res, err);
  }
});

// ============================================================
// POST /api/characters/:id/leveldown
// Pop the most recent level from the stack (undo last level-up).
// Requires levelHistory. Min level: 1 (cannot pop below level 1).
// Response: { character: CharacterSheet; poppedLevel: { className, classLevel } }
// ============================================================
router.post('/characters/:id/leveldown', async (req: Request, res: Response) => {
  try {
    const id    = String(req.params.id);
    let   sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });

    if (!sheet.levelHistory || sheet.levelHistory.length === 0) {
      // Legacy character: no history. Attempt automatic bootstrap.
      try {
        sheet = bootstrapLevelHistory(sheet);
      } catch (bootstrapErr: unknown) {
        return res.status(400).json({
          error:
            'Cannot level down: no level history recorded. ' +
            'Automatic bootstrap failed: ' +
            (bootstrapErr instanceof Error ? bootstrapErr.message : String(bootstrapErr)),
        });
      }
      // After bootstrap, check again — level 1 chars bootstrap to empty history
      if (sheet.levelHistory!.length === 0) {
        return res.status(400).json({ error: 'Character is already level 1; cannot level down further.' });
      }
    }

    if (totalLevel(sheet) <= 1) {
      return res.status(400).json({ error: 'Character is already level 1; cannot level down further.' });
    }

    const result  = popLevel(sheet);
    const updated = { ...result.sheet, updatedAt: new Date().toISOString() };
    await saveCharacter(updated);

    return res.json({
      character:   updated,
      poppedLevel: {
        className:  result.poppedRecord.className,
        classLevel: result.poppedRecord.classLevel,
      },
    });
  } catch (err) {
    return handleError(res, err);
  }
});


// ============================================================
// POST /api/characters/:id/equip
// Toggle equipped status for a single item by index.
// When the toggled item is armor or a shield, recomputes armorClass/acFormula
// from the PHB armor table (PHB p.144-145) if the armor name is recognized.
// Body: { itemIndex: number, equipped: boolean }
// Response: { character: CharacterSheet; acUpdated?: boolean }
// ============================================================
router.post('/characters/:id/equip', async (req: Request, res: Response) => {
  try {
    const id    = String(req.params.id);
    const sheet = loadCharacter(id);
    if (!sheet) return res.status(404).json({ error: `Character not found: ${id}` });

    const { itemIndex, equipped } = req.body;

    if (typeof itemIndex !== 'number' || !Number.isInteger(itemIndex)) {
      return res.status(400).json({ error: 'itemIndex must be an integer' });
    }
    if (typeof equipped !== 'boolean') {
      return res.status(400).json({ error: 'equipped must be a boolean' });
    }

    const items = sheet.equipment || [];
    if (itemIndex < 0 || itemIndex >= items.length) {
      return res.status(400).json({ error: `itemIndex ${itemIndex} out of range (0–${items.length - 1})` });
    }

    const newItems = items.map((item, i) => i === itemIndex ? { ...item, equipped } : item);

    // Recompute AC when the toggled item is armor or a shield
    const toggledItem = items[itemIndex];
    let acPatch: { armorClass: number; acFormula: string } | null = null;
    if (toggledItem.category === 'armor' || toggledItem.category === 'shield') {
      acPatch = computeArmorAC(sheet, newItems, toggledItem.category as 'armor' | 'shield');
    }

    const updated = {
      ...sheet,
      equipment: newItems,
      ...(acPatch ?? {}),
      updatedAt: new Date().toISOString(),
    };
    await saveCharacter(updated);

    return res.json({ character: updated, acUpdated: acPatch !== null });
  } catch (err) {
    return handleError(res, err);
  }
});

// ============================================================
// Race & Background reference data
// ============================================================

// ---- GET /api/races -----------------------------------------
// Returns all playable races/subraces from PHB 2014 + Custom Lineage.
router.get('/races', (_req: Request, res: Response) => {
  const races = RACE_NAMES.map(name => RACE_DATA[name]);
  return res.json({ races });
});

// ---- GET /api/backgrounds -----------------------------------
// Returns all 13 PHB 2014 backgrounds.
router.get('/backgrounds', (_req: Request, res: Response) => {
  const backgrounds = BACKGROUND_NAMES.map(name => BACKGROUND_DATA[name]);
  return res.json({ backgrounds });
});

// ---- GET /api/feats -------------------------------------------
// Returns all 42 PHB 2014 feats (name, prerequisite, description, and
// any sheet-applicable mechanical hooks — see feat_data.ts).
router.get('/feats', (_req: Request, res: Response) => {
  return res.json({ feats: listFeats() });
});

// ---- Spell data cache (lazy-loaded from testDataSpells/) -----
// Maps spell name → spell level (0–9) for all pre-2024 sources.
let _allSpellsByName: Map<string, number> | null = null;

function getAllSpells(): Map<string, number> {
  if (_allSpellsByName) return _allSpellsByName;
  const spellMap = new Map<string, number>();
  const spellDir = path.join(__dirname, '../testDataSpells');
  try {
    const files = require('fs').readdirSync(spellDir) as string[];
    for (const fn of files) {
      // Exclude post-2024 (XPHB) content
      if (!fn.startsWith('spells-') || fn.includes('xphb')) continue;
      const raw = require('fs').readFileSync(path.join(spellDir, fn), 'utf8');
      const d = JSON.parse(raw) as { spell?: { name: string; level: number }[] };
      for (const sp of d.spell ?? []) {
        if (!spellMap.has(sp.name)) spellMap.set(sp.name, sp.level);
      }
    }
  } catch {
    // If testDataSpells is unavailable, return empty map gracefully
  }
  _allSpellsByName = spellMap;
  return spellMap;
}

// ---- GET /api/spells ----------------------------------------
// Returns spell names filtered by optional class and/or level.
//
// Query params:
//   class  — spellcasting class name (e.g. "Wizard", "Cleric")
//   level  — spell level 0–9 (0 = cantrips)
//
// Both params are optional. With no params, returns all pre-2024
// spell names (sorted). With class only, returns all spells on
// that class's list. With level only, returns all spells of that
// level. With both, returns the intersection.
//
// Response: { spells: string[], class?: string, level?: number }
router.get('/spells', (req: Request, res: Response) => {
  const classParam = typeof req.query.class === 'string' ? req.query.class.trim() : '';
  const levelParam = typeof req.query.level === 'string' ? req.query.level.trim() : '';

  // Validate level if provided
  let spellLevel: number | null = null;
  if (levelParam !== '') {
    spellLevel = parseInt(levelParam, 10);
    if (isNaN(spellLevel) || spellLevel < 0 || spellLevel > 9) {
      return res.status(400).json({ error: 'level must be an integer 0–9' });
    }
  }

  // Resolve class alias (e.g. "Eldritch Knight" → "Wizard")
  let resolvedClass: SpellcastingClassName | null = null;
  if (classParam !== '') {
    const alias = CLASS_SPELL_LIST_ALIASES[classParam];
    if (alias) {
      resolvedClass = alias;
    } else if (SPELLCASTING_CLASS_NAMES.includes(classParam)) {
      resolvedClass = classParam as SpellcastingClassName;
    } else {
      return res.status(400).json({
        error: `Unknown spellcasting class "${classParam}". ` +
               `Valid: ${SPELLCASTING_CLASS_NAMES.concat(Object.keys(CLASS_SPELL_LIST_ALIASES)).join(', ')}`,
      });
    }
  }

  let spells: string[];

  if (resolvedClass !== null) {
    // Use canonical class spell list
    const levels = CLASS_SPELL_LISTS[resolvedClass];
    if (spellLevel !== null) {
      spells = [...(levels[spellLevel] ?? [])];
    } else {
      spells = levels.flat();
    }
  } else {
    // No class filter — use all pre-2024 spell data
    const allSpells = getAllSpells();
    if (spellLevel !== null) {
      spells = [];
      for (const [name, lvl] of allSpells) {
        if (lvl === spellLevel) spells.push(name);
      }
    } else {
      spells = [...allSpells.keys()];
    }
  }

  spells.sort();
  const responseBody: Record<string, unknown> = { spells };
  if (resolvedClass !== null) responseBody.class = resolvedClass;
  if (spellLevel !== null) responseBody.level = spellLevel;
  return res.json(responseBody);
});

// ---- GET /api/stat-optimizer --------------------------------
// Returns the recommended standard-array assignment for a given
// race + class combination.
//
// Query params: race (string), class (string)
// Response: StatOptimizerResult
router.get('/stat-optimizer', (req: Request, res: Response) => {
  const raceName  = typeof req.query.race  === 'string' ? req.query.race  : '';
  const className = typeof req.query.class === 'string' ? req.query.class : '';

  if (!raceName) {
    return res.status(400).json({ error: 'race query parameter is required' });
  }
  if (!className) {
    return res.status(400).json({ error: 'class query parameter is required' });
  }

  const raceEntry = RACE_DATA[raceName];
  if (!raceEntry) {
    return res.status(400).json({
      error: `Unknown race "${raceName}". Valid races: ${RACE_NAMES.join(', ')}`,
    });
  }

  if (!(className in CLASS_STAT_PRIORITY)) {
    return res.status(400).json({
      error: `Unknown class "${className}". Valid classes: ${Object.keys(CLASS_STAT_PRIORITY).join(', ')}`,
    });
  }

  const result = computeStatRecommendation(className as any, raceEntry);
  return res.json(result);
});

// ============================================================
// Level 0 character creation
// ============================================================

// ---- POST /api/characters/create-level0 ---------------------
// Creates a Level 0 character: race + background + ability scores
// locked in; no class chosen yet.
//
// Body:
//   race          string   — must match a key in RACE_DATA
//   background    string   — must match a key in BACKGROUND_DATA
//   baseScores    object   — { str, dex, con, int, wis, cha } BEFORE racial bonus (each 1–30)
//   asiAssignment object?  — Partial<CharacterAbilityScores>: how racial bonus is distributed
//                            (required when race has no defaultASI, e.g. Half-Elf, Human Variant)
//   name          string?  — character name (default: 'New Character')
//   alignment     string?  — default: 'True Neutral'
//   languages     string[] — languages the player has already chosen for background choices
//
// Returns 201 { character } on success.
router.post('/characters/create-level0', async (req: Request, res: Response) => {
  try {
    const {
      race: raceName,
      background: bgName,
      baseScores,
      asiAssignment,
      name = 'New Character',
      alignment = 'True Neutral',
      languages: extraLanguages = [],
    } = req.body as {
      race: string;
      background: string;
      baseScores: CharacterAbilityScores;
      asiAssignment?: Partial<CharacterAbilityScores>;
      name?: string;
      alignment?: string;
      languages?: string[];
    };

    // ── Validate race ───────────────────────────────────────
    if (!raceName || typeof raceName !== 'string') {
      return res.status(400).json({ error: 'race is required' });
    }
    const raceEntry = RACE_DATA[raceName];
    if (!raceEntry) {
      return res.status(400).json({
        error: `Unknown race "${raceName}". Valid races: ${RACE_NAMES.join(', ')}`,
      });
    }

    // ── Validate background ─────────────────────────────────
    if (!bgName || typeof bgName !== 'string') {
      return res.status(400).json({ error: 'background is required' });
    }
    const bgEntry = BACKGROUND_DATA[bgName];
    if (!bgEntry) {
      return res.status(400).json({
        error: `Unknown background "${bgName}". Valid backgrounds: ${BACKGROUND_NAMES.join(', ')}`,
      });
    }

    // ── Validate baseScores ─────────────────────────────────
    const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
    if (!baseScores || typeof baseScores !== 'object') {
      return res.status(400).json({ error: 'baseScores is required' });
    }
    for (const ab of abilities) {
      const v = (baseScores as any)[ab];
      if (!Number.isInteger(v) || v < 1 || v > 30) {
        return res.status(400).json({ error: `baseScores.${ab} must be an integer 1–30 (got ${v})` });
      }
    }

    // ── Resolve ASI assignment ──────────────────────────────
    const allotmentSum = raceEntry.allotment.reduce((a, b) => a + b, 0);
    let appliedRacialASI: Partial<CharacterAbilityScores>;

    if (asiAssignment) {
      // Validate provided assignment
      if (typeof asiAssignment !== 'object') {
        return res.status(400).json({ error: 'asiAssignment must be an object' });
      }
      // Each value must be a positive integer
      for (const [ab, val] of Object.entries(asiAssignment)) {
        if (!abilities.includes(ab as any)) {
          return res.status(400).json({ error: `asiAssignment has unknown ability "${ab}"` });
        }
        if (!Number.isInteger(val) || (val as number) <= 0) {
          return res.status(400).json({ error: `asiAssignment.${ab} must be a positive integer (got ${val})` });
        }
      }
      // Sum must equal allotment total
      const assignedSum = Object.values(asiAssignment).reduce((a, b) => a + (b as number), 0);
      if (assignedSum !== allotmentSum) {
        return res.status(400).json({
          error: `asiAssignment total (${assignedSum}) must equal racial allotment total (${allotmentSum}) for ${raceName}`,
        });
      }
      appliedRacialASI = asiAssignment;
    } else if (raceEntry.defaultASI) {
      appliedRacialASI = raceEntry.defaultASI;
    } else {
      return res.status(400).json({
        error: `asiAssignment is required for ${raceName} (no fixed default in PHB 2014)`,
      });
    }

    // ── Compute final stats ─────────────────────────────────
    const stats: CharacterAbilityScores = { ...baseScores };
    for (const ab of abilities) {
      const bonus = (appliedRacialASI as any)[ab] ?? 0;
      stats[ab] = Math.min(30, baseScores[ab] + bonus);
    }

    // ── Build Level0Record ──────────────────────────────────
    const level0Record = {
      race: raceName,
      racialASIAllotment: raceEntry.allotment,
      appliedRacialASI,
      baseScores: { ...baseScores },
      background: bgName,
      backgroundSkills: bgEntry.skills,
      backgroundTools: bgEntry.tools,
      backgroundLanguages: extraLanguages,
      backgroundGold: bgEntry.gold,
      backgroundFeature: bgEntry.feature,
    };

    // ── Build minimal CharacterSheet ────────────────────────
    const now = new Date().toISOString();
    const id  = require('crypto').randomUUID() as string;

    // Build languages: always include Common, add any player-chosen extras
    const languages = ['Common', ...extraLanguages.filter((l: string) => l !== 'Common')];

    const sheet = {
      id,
      version: 1,
      createdAt: now,
      updatedAt: now,
      name: String(name).trim() || 'New Character',
      race: raceName,
      background: bgName,
      alignment,

      // Level 0 — no class yet
      firstClass: '',
      classLevels: [],
      subclassChoices: {},
      experiencePoints: 0,

      // Ability scores
      baseStats: { ...baseScores },
      stats,

      // Combat stats — zeroed until a class is chosen
      maxHP: 0,
      currentHP: 0,
      temporaryHP: 0,
      armorClass: 10,
      acFormula: 'Unarmored 10',
      speed: raceEntry.speed,

      // Hit dice — empty until class chosen
      hitDice: [],

      // Proficiencies from background only
      proficiencies: {
        armor:         [],
        weapons:       [],
        tools:         bgEntry.tools,
        savingThrows:  [],
        skills:        bgEntry.skills,
        expertise:     [],
      },
      languages,

      // Resources & equipment
      resources:  {},
      equipment:  [],
      gold:       bgEntry.gold,
      cp:         0,
      sp:         0,
      ep:         0,
      pp:         0,

      // Features — none yet
      level1Features: [],
      allFeatures:    [],
      feats:          [],
      backgroundFeature: bgEntry.feature,

      // Status
      exhaustionLevel: 0,

      // Level history (empty — no class levels yet)
      levelHistory:  [],
      level0Record,
    } as any;

    const { saveCharacter } = await import('./characters/storage');
    const saved = saveCharacter(sheet);

    return res.status(201).json({ character: saved });
  } catch (err) {
    return handleError(res, err);
  }
});
