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
import { applyLevelUp }               from './characters/leveler';
import { spawnMonster, Raw5etoolsMonster } from './parser/fivetools';
import { simulate }                    from './scenarios/simulate';
import { Combatant }                   from './types/core';
import { EncounterSpec }               from './scenarios/encounter';

// Lazy-loaded bestiary — mirrors getBestiary() in server.ts
let _bestiary: Map<string, Raw5etoolsMonster> | null = null;
function getBestiary(): Map<string, Raw5etoolsMonster> {
  if (_bestiary) return _bestiary;
  const dir = path.join(process.cwd(), 'bestiaryData');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadBestiaryDir } = require('./data/loader');
  _bestiary = loadBestiaryDir(dir) as Map<string, Raw5etoolsMonster>;
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
