// ============================================================
// Character Sheet → Combatant Builder
// D&D 5e Combat Sim — PHB 2014 / MM 2014 / SAC v2.7
//
// Converts a saved CharacterSheet into a Combatant that the
// existing combat engine can run. Strategy: synthesise a
// RawPCEntry that is structurally identical to what the
// pc_stat_blocks_lv1.json entries produce, then delegate to
// the existing pcToCombatant() which handles all the weapon-
// to-Action and resource-building logic.
//
// After pcToCombatant(), we patch:
//   combatant.name  → sheet.name  (not "Fighter (Mountain Dwarf)")
//   combatant.id    → "sheet_<sheet.id>"
// ============================================================

import { RawPCEntry, pcToCombatant } from '../parser/pc';
import { Combatant, AIProfile, Vec3 } from '../types/core';
import {
  CharacterSheet, CharacterResources, SpellcastingInfo,
  totalLevel, proficiencyBonus, abilityModifier,
} from './types';

// ---- PHB Weapon Database ------------------------------------
// Covers all weapons that appear across the 12 level-1 class
// stat blocks plus common PHB options for custom characters.
// Key: lowercase weapon name as stored in equipment items.

interface WeaponTemplate {
  /** Damage die without modifier, e.g. "1d8" */
  die: string;
  damageType: string;
  /** 'str' | 'dex' | 'finesse' | 'ranged' */
  attackStat: 'str' | 'dex' | 'finesse' | 'ranged';
  /** Range string used by weaponToAction parser in pc.ts */
  range: string;
  /** True if normally two-handed (affects whether it can be used with a shield) */
  twoHanded?: boolean;
}

const WEAPON_DB: Record<string, WeaponTemplate> = {
  // ---- Simple Melee ----
  'club':             { die: '1d4', damageType: 'bludgeoning', attackStat: 'str',    range: 'melee 5ft' },
  'dagger':           { die: '1d4', damageType: 'piercing',    attackStat: 'finesse', range: 'melee 5ft / thrown 20/60ft' },
  'greatclub':        { die: '1d8', damageType: 'bludgeoning', attackStat: 'str',    range: 'melee 5ft', twoHanded: true },
  'handaxe':          { die: '1d6', damageType: 'slashing',    attackStat: 'str',    range: 'melee 5ft / thrown 20/60ft' },
  'javelin':          { die: '1d6', damageType: 'piercing',    attackStat: 'str',    range: 'melee 5ft / thrown 30/120ft' },
  'light hammer':     { die: '1d4', damageType: 'bludgeoning', attackStat: 'str',    range: 'melee 5ft / thrown 20/60ft' },
  'mace':             { die: '1d6', damageType: 'bludgeoning', attackStat: 'str',    range: 'melee 5ft' },
  'quarterstaff':     { die: '1d6', damageType: 'bludgeoning', attackStat: 'str',    range: 'melee 5ft' },
  'sickle':           { die: '1d4', damageType: 'slashing',    attackStat: 'str',    range: 'melee 5ft' },
  'spear':            { die: '1d6', damageType: 'piercing',    attackStat: 'str',    range: 'melee 5ft / thrown 20/60ft' },
  'unarmed strike':   { die: '1d4', damageType: 'bludgeoning', attackStat: 'str',    range: 'melee 5ft' },

  // ---- Simple Ranged ----
  'light crossbow':   { die: '1d8', damageType: 'piercing',    attackStat: 'dex',    range: 'ranged 80/320ft', twoHanded: true },
  'shortbow':         { die: '1d6', damageType: 'piercing',    attackStat: 'dex',    range: 'ranged 80/320ft', twoHanded: true },

  // ---- Martial Melee ----
  'battleaxe':        { die: '1d8', damageType: 'slashing',    attackStat: 'str',    range: 'melee 5ft' },
  'flail':            { die: '1d8', damageType: 'bludgeoning', attackStat: 'str',    range: 'melee 5ft' },
  'glaive':           { die: '1d10', damageType: 'slashing',   attackStat: 'str',    range: 'melee 10ft', twoHanded: true },
  'greataxe':         { die: '1d12', damageType: 'slashing',   attackStat: 'str',    range: 'melee 5ft', twoHanded: true },
  'greatsword':       { die: '2d6', damageType: 'slashing',    attackStat: 'str',    range: 'melee 5ft', twoHanded: true },
  'halberd':          { die: '1d10', damageType: 'slashing',   attackStat: 'str',    range: 'melee 10ft', twoHanded: true },
  'lance':            { die: '1d12', damageType: 'piercing',   attackStat: 'str',    range: 'melee 10ft' },
  'longsword':        { die: '1d8', damageType: 'slashing',    attackStat: 'str',    range: 'melee 5ft' },
  'maul':             { die: '2d6', damageType: 'bludgeoning', attackStat: 'str',    range: 'melee 5ft', twoHanded: true },
  'morningstar':      { die: '1d8', damageType: 'piercing',    attackStat: 'str',    range: 'melee 5ft' },
  'pike':             { die: '1d10', damageType: 'piercing',   attackStat: 'str',    range: 'melee 10ft', twoHanded: true },
  'rapier':           { die: '1d8', damageType: 'piercing',    attackStat: 'finesse', range: 'melee 5ft' },
  'scimitar':         { die: '1d6', damageType: 'slashing',    attackStat: 'finesse', range: 'melee 5ft' },
  'shortsword':       { die: '1d6', damageType: 'piercing',    attackStat: 'finesse', range: 'melee 5ft' },
  'trident':          { die: '1d6', damageType: 'piercing',    attackStat: 'str',    range: 'melee 5ft / thrown 20/60ft' },
  'war pick':         { die: '1d8', damageType: 'piercing',    attackStat: 'str',    range: 'melee 5ft' },
  'warhammer':        { die: '1d8', damageType: 'bludgeoning', attackStat: 'str',    range: 'melee 5ft' },
  'whip':             { die: '1d4', damageType: 'slashing',    attackStat: 'finesse', range: 'melee 10ft' },

  // ---- Martial Ranged ----
  'hand crossbow':    { die: '1d6', damageType: 'piercing',    attackStat: 'dex',    range: 'ranged 30/120ft' },
  'heavy crossbow':   { die: '1d10', damageType: 'piercing',   attackStat: 'dex',    range: 'ranged 100/400ft', twoHanded: true },
  'longbow':          { die: '1d8', damageType: 'piercing',    attackStat: 'dex',    range: 'ranged 150/600ft', twoHanded: true },
  'net':              { die: '0d0', damageType: 'none',        attackStat: 'str',    range: 'ranged 5/15ft' },
};

// Aliases for lookup tolerance
const WEAPON_ALIASES: Record<string, string> = {
  'hand-crossbow':    'hand crossbow',
  'light-crossbow':   'light crossbow',
  'heavy-crossbow':   'heavy crossbow',
  'war-pick':         'war pick',
};

function lookupWeapon(name: string): WeaponTemplate | null {
  const key = name.toLowerCase().trim();
  return WEAPON_DB[key] ?? WEAPON_DB[WEAPON_ALIASES[key] ?? ''] ?? null;
}

// ---- Ability mod helpers ------------------------------------

function mod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function attackMod(template: WeaponTemplate, stats: CharacterSheet['stats']): number {
  switch (template.attackStat) {
    case 'str':     return mod(stats.str);
    case 'dex':     return mod(stats.dex);
    case 'ranged':  return mod(stats.dex);
    case 'finesse': return Math.max(mod(stats.str), mod(stats.dex));
  }
}

// ---- Slot key conversion ------------------------------------
// CharacterSheet uses "1".."9"; RawPCEntry.spellcasting.slots
// uses "1st".."9th" but buildResources() calls parseInt() on them,
// so both formats work. We normalise to the ordinal form for clarity.

const ORDINALS = ['1st','2nd','3rd','4th','5th','6th','7th','8th','9th'];

function slotsToOrdinal(slots: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(slots)) {
    const idx = parseInt(k, 10) - 1;
    if (idx >= 0 && idx < 9 && v > 0) {
      out[ORDINALS[idx]] = v;
    }
  }
  return out;
}

// ---- Weapon equipment → RawWeapon conversion ----------------

function buildWeapons(sheet: CharacterSheet): import('../parser/pc').RawPCEntry['weapons'] {
  const prof   = proficiencyBonus(sheet);
  const stats  = sheet.stats;

  // We work with an inline type that matches what weaponToAction expects.
  // Use 'any' for the returned array — pc.ts's RawWeapon is an unexported interface.
  const weapons: any[] = [];

  for (const item of sheet.equipment) {
    if (item.category !== 'weapon') continue;
    if (!item.equipped) continue;

    const tmpl = lookupWeapon(item.name);
    if (!tmpl) {
      // Unknown weapon — emit a generic melee stub so the character can still fight
      console.warn(`[builder] Unknown weapon "${item.name}" — using club stats`);
      const fallback = WEAPON_DB['club'];
      const abilMod = mod(stats.str);
      weapons.push({
        name:   item.name,
        bonus:  prof + abilMod,
        damage: `1d4+${abilMod}`,
        type:   'bludgeoning',
        range:  'melee 5ft',
        note:   item.notes ?? item.name,
      });
      continue;
    }

    const abilMod = attackMod(tmpl, stats);
    const hitBonus = prof + abilMod;

    // Damage string: die + modifier (e.g. "2d6+3")
    // For zero-mod weapons (quarterstaff for low-STR Wizards), show negative
    const damageStr = abilMod !== 0
      ? `${tmpl.die}${abilMod >= 0 ? '+' : ''}${abilMod}`
      : tmpl.die;

    weapons.push({
      name:   item.name,
      bonus:  hitBonus,
      damage: damageStr,
      type:   tmpl.damageType,
      range:  tmpl.range,
      note:   item.notes ?? item.name,
    });
  }

  // If no weapons found at all, give a bare-hands unarmed strike
  if (weapons.length === 0) {
    const strMod = mod(stats.str);
    weapons.push({
      name:   'Unarmed Strike',
      bonus:  prof + strMod,
      damage: `1+${strMod}`,  // 1 + STR mod (PHB p.195, no weapon die)
      type:   'bludgeoning',
      range:  'melee 5ft',
    });
  }

  return weapons;
}

// ---- Spellcasting conversion --------------------------------

function buildRawSpellcasting(sp: SpellcastingInfo): any | null {
  if (!sp) return null;
  return {
    ability:          sp.ability.toUpperCase(),   // "int" → "INT"
    spellAttackBonus: sp.spellAttackBonus,
    saveDC:           sp.saveDC,
    slots:            slotsToOrdinal(sp.slots),
    pactSlots:        sp.pactSlots
      ? { [String(sp.pactSlots.slotLevel)]: sp.pactSlots.total }
      : undefined,
    cantrips:         sp.cantrips,
    spells_1st:       sp.knownSpells.filter(s => !sp.preparedSpells.includes(s)),
    preparedSpells:   sp.preparedSpells,
    spellbook:        sp.spellbook,
  };
}

// ---- Resources conversion -----------------------------------

function buildRawResources(res: CharacterResources): any {
  const out: any = {};

  if (res.rage)              out.rage             = { uses: res.rage.max };
  if (res.secondWind)        out.secondWind        = { uses: 1 };
  // ── Session 43 Task #23: Action Surge transfer ──
  // Fighter 2+ has 1 use; Fighter 17+ has 2 uses. Pass max through so
  // buildResources (pc.ts) can populate { max, remaining } on the Combatant.
  if (res.actionSurge)       out.actionSurge       = { uses: res.actionSurge.max };
  if (res.bardicInspiration) out.bardicInspiration = {
    uses: res.bardicInspiration.max,
    die:  `d${res.bardicInspiration.dieSides}`,
  };
  if (res.layOnHands)        out.layOnHands        = { pool: res.layOnHands.pool };
  if (res.divineSmite)       out.divineSmite        = true;
  if (res.sneakAttackDice)   out.sneakAttack        = { dice: res.sneakAttackDice };
  if (res.cunningAction)     out.cunningAction      = true;
  if (res.arcaneRecovery)    out.arcaneRecovery     = { usesRemaining: res.arcaneRecovery.usesRemaining };

  return out;
}

// ---- Main conversion: CharacterSheet → RawPCEntry -----------

function sheetToRawEntry(sheet: CharacterSheet): RawPCEntry {
  const lvl  = totalLevel(sheet);
  const prof  = proficiencyBonus(sheet);
  const stats = sheet.stats;

  // Modifiers object (pre-computed for RawPCEntry)
  const modifiers = {
    str: mod(stats.str),
    dex: mod(stats.dex),
    con: mod(stats.con),
    int: mod(stats.int),
    wis: mod(stats.wis),
    cha: mod(stats.cha),
  };

  // savingThrows: Record<string, boolean>
  const savingThrows: Record<string, boolean> = {
    str: false, dex: false, con: false, int: false, wis: false, cha: false,
  };
  for (const ab of sheet.proficiencies.savingThrows) {
    savingThrows[ab] = true;
  }

  // Skills
  const skills = {
    proficient: sheet.proficiencies.skills as string[],
    expertise:  sheet.proficiencies.expertise as string[],
  };

  // Features for traits list
  const level1Features = sheet.level1Features.map(f => ({
    name:        f.name,
    description: f.description,
  }));
  const racialTraits = sheet.allFeatures
    .filter(f => f.source === 'race')
    .map(f => ({ name: f.name, description: f.description }));

  return {
    class:           sheet.firstClass,
    subclass:        sheet.subclassChoices[sheet.firstClass] ?? '',
    race:            sheet.race,
    background:      sheet.background,
    level:           lvl,
    proficiencyBonus: prof,
    ability_scores:  { ...stats },
    modifiers,
    hp:              sheet.maxHP,
    ac:              sheet.armorClass,
    acFormula:       sheet.acFormula,
    speed:           sheet.speed,
    savingThrows,
    skills,
    weapons:         buildWeapons(sheet),
    spellcasting:    sheet.spellcasting
      ? buildRawSpellcasting(sheet.spellcasting)
      : null,
    resources:       buildRawResources(sheet.resources),
    level1Features,
    racialTraits,
  };
}

// ---- Public API ---------------------------------------------

/**
 * Convert a CharacterSheet into a Combatant ready for combat.
 *
 * Uses the existing pcToCombatant() pipeline so all weapon-to-Action
 * conversion, spell lookup, and resource building are handled
 * by the tested parser code.
 *
 * Name and id are patched after creation to use the sheet's identity.
 *
 * Eldritch Invocations (Session 40): if the sheet has `eldritchInvocations`
 * set (Warlock PCs only — populated via chooseEldritchInvocations() in
 * improvements.ts), it is transferred to the Combatant so the engine's
 * invocation hooks (Repelling Blast, Agonizing Blast, Grasp of Hadar,
 * Lance of Lethargy) can fire on Eldritch Blast hits.
 */
export function buildCombatant(
  sheet: CharacterSheet,
  pos:     Vec3     = { x: 0, y: 0, z: 0 },
  profile: AIProfile = 'smart',
): Combatant {
  const raw       = sheetToRawEntry(sheet);
  const combatant = pcToCombatant(raw, pos, profile);

  // Patch identity: use the character's actual name and a stable id
  combatant.name = sheet.name;
  combatant.id   = `sheet_${sheet.id}`;

  // Transfer Eldritch Invocations (Warlock-only; undefined for non-Warlocks).
  // The list is validated by chooseEldritchInvocations() before being stored
  // on the sheet, so we just pass it through. Empty arrays are normalized to
  // undefined to match the existing engine convention (hasInvocation helper
  // treats undefined and [] the same — both return false for any name lookup).
  if (sheet.eldritchInvocations && sheet.eldritchInvocations.length > 0) {
    combatant.eldritchInvocations = [...sheet.eldritchInvocations];

    // ── Session 41 Task #16: Eldritch Spear invocation ──
    // PHB p.111: "When you cast Eldritch Blast, its range is 300 feet."
    // The default EB range is 120 ft (per the SPELL_DB entry). When the
    // Warlock has Eldritch Spear, patch the EB Action's reach + range
    // to 300 ft. This is a metadata-only change — no engine hook needed.
    if (combatant.eldritchInvocations.includes('Eldritch Spear')) {
      const ebAction = combatant.actions.find(a => a.name === 'Eldritch Blast');
      if (ebAction) {
        ebAction.reach = 300;
        ebAction.range = { normal: 300, long: 300 };
      }
    }
  }

  // ── Session 42 Task #18: Pact Boon transfer ──
  // Transfer the Warlock's Pact Boon choice (chain/blade/tome) to the
  // Combatant so the planner can check it for Thirsting Blade (requires
  // 'blade'). No-op for non-Warlocks (pactBoon is undefined).
  if (sheet.pactBoon) {
    combatant.pactBoon = sheet.pactBoon;
  }

  // ── Session 43 Task #24: Class features transfer ──
  // Transfer the names of all class/subclass features the character has
  // gained via leveling (e.g. 'Extra Attack', 'Action Surge (1/rest)',
  // 'Cunning Action', etc.). The planner checks this list to set
  // attackCount for Extra Attack (Fighter/Paladin/Ranger/Barbarian/Monk 5+,
  // Fighter 11+ = 3 attacks, Fighter 20 = 4 attacks). Monsters have no
  // class features, so this is undefined for them.
  //
  // We include source 'class' and 'subclass' features (NOT 'race' — racial
  // traits are already in combatant.traits). We dedupe by name in case the
  // same feature appears multiple times (e.g. multi-class characters).
  const classFeatureNames = sheet.allFeatures
    .filter(f => f.source === 'class' || f.source === 'subclass')
    .map(f => f.name);
  if (classFeatureNames.length > 0) {
    combatant.classFeatures = [...new Set(classFeatureNames)];
  }

  // ── Session 46 Task #29-follow-up-2: Character level transfer ──
  // Store the PC's total character level on the Combatant so engine features
  // that depend on proficiency bonus (Remarkable Athlete, Jack of All Trades,
  // etc.) can compute it without access to the CharacterSheet. The total
  // level is the sum of all class levels (e.g. Fighter 7 / Wizard 3 = 10).
  // Monsters leave this undefined (their proficiency is CR-based).
  const totalLevel = sheet.classLevels.reduce((sum, cl) => sum + cl.level, 0);
  if (totalLevel > 0) {
    combatant.level = totalLevel;
  }

  // ── Session 47 Task #29-follow-up-4: Per-class levels transfer ──
  // Store a map of class name → level (e.g. { Monk: 6, Fighter: 2 }). Used by
  // features that depend on a specific class's level (e.g. Wholeness of Body
  // heals 3 × monk level, not 3 × total level). Monsters leave this undefined.
  if (sheet.classLevels.length > 0) {
    const clMap: Record<string, number> = {};
    for (const cl of sheet.classLevels) {
      clMap[cl.className] = cl.level;
    }
    combatant.classLevels = clMap;
  }

  // ── Session 47 Task #29-follow-up-4: Wholeness of Body resource ──
  // Open Hand Monk 6 (PHB p.79): self-heal 3 × monk level, once per long rest.
  // The feature is tracked in classFeatures by the leveler. Here we set the
  // resource (max 1, remaining 1) when the combatant has the feature. The
  // engine consumes one use when the wholenessOfBody action executes.
  if (combatant.classFeatures?.includes('Wholeness of Body')) {
    if (!combatant.resources) combatant.resources = {} as any;
    (combatant.resources as any).wholenessOfBody = { max: 1, remaining: 1 };
  }

  return combatant;
}

/**
 * Check if a combatant has a specific class/subclass feature by name.
 * Returns true if the feature name is in the combatant's `classFeatures`
 * list (populated by buildCombatant from sheet.allFeatures).
 *
 * Examples: 'Extra Attack', 'Extra Attack (2)', 'Action Surge (1/rest)',
 * 'Cunning Action', 'Jack of All Trades', etc.
 *
 * Returns false for monsters (no classFeatures list) and for combatants
 * that don't have the named feature.
 */
export function hasFeature(combatant: Combatant, featureName: string): boolean {
  return combatant.classFeatures?.includes(featureName) ?? false;
}

/**
 * Quick sanity check — returns a list of warnings (not errors) about
 * the sheet that may affect combat fidelity.
 * Useful for displaying hints in the UI before starting a simulation.
 */
export function buildWarnings(sheet: CharacterSheet): string[] {
  const warnings: string[] = [];

  for (const item of sheet.equipment) {
    if (item.category === 'weapon' && item.equipped) {
      const tmpl = lookupWeapon(item.name);
      if (!tmpl) {
        warnings.push(`"${item.name}" is not in the weapon database — using fallback club stats`);
      }
    }
  }

  if (sheet.spellcasting) {
    const allSpells = [
      ...sheet.spellcasting.preparedSpells,
      ...sheet.spellcasting.knownSpells,
      ...(sheet.spellcasting.spellbook ?? []),
    ];
    if (allSpells.length === 0 && Object.keys(sheet.spellcasting.slots).length > 0) {
      warnings.push('Character has spell slots but no spells listed');
    }
  }

  if (sheet.currentHP <= 0) {
    warnings.push('Character has 0 or fewer HP — will start combat unconscious');
  }

  return warnings;
}
