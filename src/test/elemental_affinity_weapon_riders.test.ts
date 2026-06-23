// ============================================================
// Test: Elemental Affinity (Draconic Sorcerer 6) on the 3 weapon-rider
// damage sites in combat.ts (TG-027, Core Engine side of TG-015)
//
// Background: Elemental Affinity (PHB p.102) adds the sorcerer's CHA mod
// to spell damage matching their draconic ancestry. Sessions 47-51 wired
// it into the main spell-attack / save-spell / auto-hit paths and ~25
// bespoke spell execute() functions. THREE weapon-rider damage sites in
// combat.ts were missed — they add bonus spell damage of a type on top
// of a weapon attack but did NOT call elementalAffinityBonus():
//
//   Site 1: `_nextHitRider` consume (~line 1906) — Searing Smite (fire),
//           Lightning Arrow (lightning), Blinding Smite (radiant), etc.
//   Site 2: `weapon_enchant` damage DICE (~line 2028) — Elemental Weapon
//           (fire), Flame Arrows (fire), Holy Weapon (radiant), Divine
//           Favor (radiant), Shadow Blade (psychic).
//   Site 3: Flame Blade rider (~line 2053) — +3d6 fire on melee.
//
// TG-027 wires elementalAffinityBonus() into all 3 sites. The bonus is
// FLAT (NOT doubled on crit — PHB p.196 only doubles damage dice, not
// flat modifiers).
//
// Coverage (18 assertions):
//   Site 1 — _nextHitRider (Searing Smite, fire):
//     1a. fire ancestry + rider → EA log fires, value = CHA mod (3)
//     1b. cold ancestry + rider → no EA log
//     1c. non-Sorcerer + rider → no EA log
//     1d. EA bonus NOT doubled on crit (still 3 on a forced crit)
//   Site 2 — weapon_enchant dice (Elemental Weapon, fire):
//     2a. fire ancestry + enchant → EA log fires, value = 3
//     2b. cold ancestry + enchant → no EA log
//     2c. non-Sorcerer + enchant → no EA log
//     2d. EA bonus NOT doubled on crit (still 3 on a forced crit)
//   Site 3 — Flame Blade rider (fire):
//     3a. fire ancestry + Flame Blade → EA log fires, value = 3
//     3b. cold ancestry + Flame Blade → no EA log
//     3c. non-Sorcerer + Flame Blade → no EA log
//     3d. EA bonus NOT doubled on crit (still 3 on a forced crit)
//   Cross-cutting:
//     4a. EA bonus value = CHA mod (CHA 17 → +3) on Flame Blade
//     4b. EA bonus value = CHA mod (CHA 20 → +5) on Searing Smite rider
//     4c. No EA bonus when draconicAncestry not set (Flame Blade)
//     4d. EA rider log mentions the source (rider/enchant/Flame Blade)
//
// Run: npx ts-node --transpile-only src/test/elemental_affinity_weapon_riders.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyLevelUp } from '../characters/leveler';
import { chooseSubclass } from '../characters/improvements';
import { buildCombatant, hasFeature } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
import { elementalAffinityBonus } from '../engine/utils';
import { resolveAttack, EngineState } from '../engine/combat';
import { Combatant, Action, Battlefield, Vec3, Condition } from '../types/core';

// ---- Test harness -------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Factories ----------------------------------------------

/**
 * Build a level-1 Sorcerer sheet with Draconic Bloodline subclass pre-chosen,
 * then level it to 6 (where Elemental Affinity unlocks, PHB p.102). CHA 17
 * → +3 mod (the canonical test value). The sheet's draconicAncestry is set
 * AFTER buildCombatant() because the builder doesn't currently propagate
 * the player-chosen ancestry from subclassChoices (separate Sheet workstream
 * task); tests set it directly on the Combatant.
 */
function makeDraconicSorcerer6(ancestry: string | undefined, cha = 17): Combatant {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Pyra', race: 'Human', background: 'Sage',
    alignment: 'Chaotic Good',
    firstClass: 'Sorcerer',
    classLevels: [{ className: 'Sorcerer', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha },
    stats:     { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha },
    maxHP: 8, currentHP: 8, temporaryHP: 0,
    armorClass: 12, acFormula: 'No armor + DEX', speed: 30,
    hitDice: [{ className: 'Sorcerer', dieSides: 6, total: 1, remaining: 1 }],
    proficiencies: {
      armor: [], weapons: ['simple-melee','simple-ranged'],
      tools: [], savingThrows: ['con','cha'],
      skills: ['Arcana','Persuasion'], expertise: [],
    },
    languages: ['Common'],
    resources: {},
    spellcasting: {
      ability: 'cha', spellAttackBonus: 5, saveDC: 13,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: ['Fire Bolt'],
      knownSpells: [], preparedSpells: [], spellbook: [],
    },
    equipment: [{ name: 'Quarterstaff', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 10,
    level1Features: [
      { name: 'Spellcasting', description: 'CHA caster.', source: 'class' },
    ],
    allFeatures: [
      { name: 'Spellcasting', description: 'CHA caster.', source: 'class' },
    ],
    feats: [], backgroundFeature: 'Researcher', exhaustionLevel: 0, levelHistory: [],
  };
  // Sorcerer chooses subclass at level 1 (before the level-up loop).
  let sheet = chooseSubclass(base, 'Sorcerer', 'Draconic Bloodline');
  for (let lvl = 2; lvl <= 6; lvl++) {
    sheet = applyLevelUp(sheet, 'Sorcerer').sheet;
  }
  const sorc = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  sorc.draconicAncestry = ancestry;
  return sorc;
}

/** Vanilla combatant with NO class features — used for the non-Sorcerer tests. */
function makeNonSorcerer(id: string, cha = 17): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 14, con: 13, int: 10, wis: 10, cha,
    cr: null,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set<Condition>(),
    aiProfile: 'smart',
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    // classFeatures intentionally UNSET — no Elemental Affinity
    draconicAncestry: 'fire',
  } as Combatant;
}

function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 10000, currentHP: 10000, ac: 5,  // low AC — easy to hit
    speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 1, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos,
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set<Condition>(),
    aiProfile: 'smart',
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
  } as Combatant;
}

function makeBF(combatants: Combatant[]): Battlefield {
  const width = 30, height = 30, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [];
      for (let z = 0; z < depth; z++) {
        cells[x][y][z] = { terrain: 'flat', elevation: 0 };
      }
    }
  }
  return {
    width, height, depth, cells,
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1,
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

// ---- Actions ------------------------------------------------

/** Melee weapon attack — the rider fires on this (attackType='melee'). */
const LONGSWORD_ACTION: Action = {
  name: 'Longsword',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: 9,    // +9 to hit — reliably hits AC 5
  damage: { count: 1, sides: 8, bonus: 3, average: 7 },
  damageType: 'slashing',   // NOT fire — main weapon damage gets no EA
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Longsword melee attack',
};

// ---- Helper: find the EA log event for a given source keyword ----

function findEALog(state: EngineState, sourceKeyword: string): any | undefined {
  return state.log.events.find(
    (e: any) =>
      e.type === 'action' &&
      e.description.includes('Elemental Affinity') &&
      e.description.includes(sourceKeyword),
  );
}

// =============================================================
// Preflight: confirm the Draconic Sorcerer 6 setup is correct
// =============================================================
console.log('\n--- Preflight: Draconic Sorcerer 6 setup ---');
{
  const sorc = makeDraconicSorcerer6('fire');
  assert('PF1. has Elemental Affinity feature', hasFeature(sorc, 'Elemental Affinity'));
  assert('PF2. draconicAncestry = fire', sorc.draconicAncestry === 'fire');
  // CHA 17 → +3 mod (the canonical TG-027 test value)
  eq('PF3. elementalAffinityBonus(fire) = 3', elementalAffinityBonus(sorc, 'fire'), 3);
  eq('PF4. elementalAffinityBonus(cold) = 0', elementalAffinityBonus(sorc, 'cold'), 0);

  const nonSorc = makeNonSorcerer('ns');
  eq('PF5. non-Sorcerer EA = 0', elementalAffinityBonus(nonSorc, 'fire'), 0);
}

// =============================================================
// SITE 1 — _nextHitRider (Searing Smite, fire)
// =============================================================
console.log('\n--- Site 1: _nextHitRider (Searing Smite, fire) ---');

// 1a. fire ancestry + Searing Smite rider → EA log fires, value = 3
{
  const sorc = makeDraconicSorcerer6('fire');
  sorc.actions = [LONGSWORD_ACTION];
  // Manually arm the Searing Smite rider (mirrors what execute() sets).
  sorc._nextHitRider = {
    spellName: 'Searing Smite',
    dieSides: 6,
    count: 1,
    damageType: 'fire' as any,
  };
  sorc.concentration = { active: true, spellName: 'Searing Smite', dcIfHit: 10 } as any;

  const enemy = makeEnemy('e1a');
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  resolveAttack(sorc, enemy, LONGSWORD_ACTION, state, true);  // force crit = auto-hit

  const eaLog = findEALog(state, 'Searing Smite');
  assert('1a. EA log fires on Searing Smite rider (fire ancestry)', eaLog !== undefined);
  if (eaLog) {
    console.log(`    Log: ${eaLog.description}`);
    eq('1a. EA value = 3 (CHA mod)', eaLog.value, 3);
  }
  // Rider was consumed (one-shot)
  eq('1a. rider consumed after hit', sorc._nextHitRider, null);
}

// 1b. cold ancestry + Searing Smite rider → no EA log
{
  const sorc = makeDraconicSorcerer6('cold');
  sorc.actions = [LONGSWORD_ACTION];
  sorc._nextHitRider = {
    spellName: 'Searing Smite',
    dieSides: 6, count: 1, damageType: 'fire' as any,
  };
  sorc.concentration = { active: true, spellName: 'Searing Smite', dcIfHit: 10 } as any;

  const enemy = makeEnemy('e1b');
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  resolveAttack(sorc, enemy, LONGSWORD_ACTION, state, true);

  const eaLog = findEALog(state, 'Searing Smite');
  assert('1b. no EA log on Searing Smite rider (cold ancestry)', eaLog === undefined);
}

// 1c. non-Sorcerer + Searing Smite rider → no EA log
{
  const ns = makeNonSorcerer('ns1c');
  ns.actions = [LONGSWORD_ACTION];
  ns._nextHitRider = {
    spellName: 'Searing Smite',
    dieSides: 6, count: 1, damageType: 'fire' as any,
  };
  ns.concentration = { active: true, spellName: 'Searing Smite', dcIfHit: 10 } as any;

  const enemy = makeEnemy('e1c');
  const bf = makeBF([ns, enemy]);
  const state = makeState(bf);

  resolveAttack(ns, enemy, LONGSWORD_ACTION, state, true);

  const eaLog = findEALog(state, 'Searing Smite');
  assert('1c. no EA log on Searing Smite rider (non-Sorcerer)', eaLog === undefined);
}

// 1d. EA bonus NOT doubled on crit (still 3 on a forced crit)
{
  const sorc = makeDraconicSorcerer6('fire');
  sorc.actions = [LONGSWORD_ACTION];
  sorc._nextHitRider = {
    spellName: 'Searing Smite',
    dieSides: 6, count: 1, damageType: 'fire' as any,
  };
  sorc.concentration = { active: true, spellName: 'Searing Smite', dcIfHit: 10 } as any;

  const enemy = makeEnemy('e1d');
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  resolveAttack(sorc, enemy, LONGSWORD_ACTION, state, true);  // FORCED CRIT

  const eaLog = findEALog(state, 'Searing Smite');
  assert('1d. EA log fires on crit', eaLog !== undefined);
  if (eaLog) {
    // The rider dice ARE doubled on crit (1d6 → 2d6), but the EA flat
    // bonus is NOT — it stays at +3 (CHA mod), per PHB p.196.
    eq('1d. EA value = 3 on crit (flat, NOT doubled)', eaLog.value, 3);
  }
}

// =============================================================
// SITE 2 — weapon_enchant damage DICE (Elemental Weapon, fire)
// =============================================================
console.log('\n--- Site 2: weapon_enchant dice (Elemental Weapon, fire) ---');

// 2a. fire ancestry + Elemental Weapon effect → EA log fires, value = 3
{
  const sorc = makeDraconicSorcerer6('fire');
  sorc.actions = [LONGSWORD_ACTION];
  // Manually attach the weapon_enchant ActiveEffect (mirrors what
  // elemental_weapon.execute() applies via applySpellEffect).
  sorc.activeEffects = [{
    id: randomUUID(),
    casterId: sorc.id,
    spellName: 'Elemental Weapon',
    effectType: 'weapon_enchant',
    payload: {
      attackBonus: 1,
      damageBonus: 0,
      damageDie: 4,
      damageDieCount: 1,
      damageDieType: 'fire',
    },
    sourceIsConcentration: true,
  } as any];

  const enemy = makeEnemy('e2a');
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  resolveAttack(sorc, enemy, LONGSWORD_ACTION, state, true);

  const eaLog = findEALog(state, 'weapon enchant');
  assert('2a. EA log fires on weapon_enchant dice (fire ancestry)', eaLog !== undefined);
  if (eaLog) {
    console.log(`    Log: ${eaLog.description}`);
    eq('2a. EA value = 3 (CHA mod)', eaLog.value, 3);
  }
}

// 2b. cold ancestry + Elemental Weapon effect → no EA log
{
  const sorc = makeDraconicSorcerer6('cold');
  sorc.actions = [LONGSWORD_ACTION];
  sorc.activeEffects = [{
    id: randomUUID(),
    casterId: sorc.id,
    spellName: 'Elemental Weapon',
    effectType: 'weapon_enchant',
    payload: {
      attackBonus: 1, damageBonus: 0,
      damageDie: 4, damageDieCount: 1, damageDieType: 'fire',
    },
    sourceIsConcentration: true,
  } as any];

  const enemy = makeEnemy('e2b');
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  resolveAttack(sorc, enemy, LONGSWORD_ACTION, state, true);

  const eaLog = findEALog(state, 'weapon enchant');
  assert('2b. no EA log on weapon_enchant dice (cold ancestry)', eaLog === undefined);
}

// 2c. non-Sorcerer + Elemental Weapon effect → no EA log
{
  const ns = makeNonSorcerer('ns2c');
  ns.actions = [LONGSWORD_ACTION];
  ns.activeEffects = [{
    id: randomUUID(),
    casterId: ns.id,
    spellName: 'Elemental Weapon',
    effectType: 'weapon_enchant',
    payload: {
      attackBonus: 1, damageBonus: 0,
      damageDie: 4, damageDieCount: 1, damageDieType: 'fire',
    },
    sourceIsConcentration: true,
  } as any];

  const enemy = makeEnemy('e2c');
  const bf = makeBF([ns, enemy]);
  const state = makeState(bf);

  resolveAttack(ns, enemy, LONGSWORD_ACTION, state, true);

  const eaLog = findEALog(state, 'weapon enchant');
  assert('2c. no EA log on weapon_enchant dice (non-Sorcerer)', eaLog === undefined);
}

// 2d. EA bonus NOT doubled on crit (still 3 on a forced crit)
{
  const sorc = makeDraconicSorcerer6('fire');
  sorc.actions = [LONGSWORD_ACTION];
  sorc.activeEffects = [{
    id: randomUUID(),
    casterId: sorc.id,
    spellName: 'Elemental Weapon',
    effectType: 'weapon_enchant',
    payload: {
      attackBonus: 1, damageBonus: 0,
      damageDie: 4, damageDieCount: 1, damageDieType: 'fire',
    },
    sourceIsConcentration: true,
  } as any];

  const enemy = makeEnemy('e2d');
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  resolveAttack(sorc, enemy, LONGSWORD_ACTION, state, true);  // FORCED CRIT

  const eaLog = findEALog(state, 'weapon enchant');
  assert('2d. EA log fires on crit', eaLog !== undefined);
  if (eaLog) {
    // Enchant dice ARE doubled on crit (1d4 → 2d4), but EA flat bonus
    // stays at +3 (PHB p.196).
    eq('2d. EA value = 3 on crit (flat, NOT doubled)', eaLog.value, 3);
  }
}

// =============================================================
// SITE 3 — Flame Blade rider (+3d6 fire on melee)
// =============================================================
console.log('\n--- Site 3: Flame Blade rider (fire) ---');

// 3a. fire ancestry + Flame Blade active → EA log fires, value = 3
{
  const sorc = makeDraconicSorcerer6('fire');
  sorc.actions = [LONGSWORD_ACTION];
  sorc._flameBladeActive = true;

  const enemy = makeEnemy('e3a');
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  resolveAttack(sorc, enemy, LONGSWORD_ACTION, state, true);

  const eaLog = findEALog(state, 'Flame Blade');
  assert('3a. EA log fires on Flame Blade rider (fire ancestry)', eaLog !== undefined);
  if (eaLog) {
    console.log(`    Log: ${eaLog.description}`);
    eq('3a. EA value = 3 (CHA mod)', eaLog.value, 3);
  }
}

// 3b. cold ancestry + Flame Blade active → no EA log
{
  const sorc = makeDraconicSorcerer6('cold');
  sorc.actions = [LONGSWORD_ACTION];
  sorc._flameBladeActive = true;

  const enemy = makeEnemy('e3b');
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  resolveAttack(sorc, enemy, LONGSWORD_ACTION, state, true);

  const eaLog = findEALog(state, 'Flame Blade');
  assert('3b. no EA log on Flame Blade rider (cold ancestry)', eaLog === undefined);
}

// 3c. non-Sorcerer + Flame Blade active → no EA log
{
  const ns = makeNonSorcerer('ns3c');
  ns.actions = [LONGSWORD_ACTION];
  ns._flameBladeActive = true;

  const enemy = makeEnemy('e3c');
  const bf = makeBF([ns, enemy]);
  const state = makeState(bf);

  resolveAttack(ns, enemy, LONGSWORD_ACTION, state, true);

  const eaLog = findEALog(state, 'Flame Blade');
  assert('3c. no EA log on Flame Blade rider (non-Sorcerer)', eaLog === undefined);
}

// 3d. EA bonus NOT doubled on crit (still 3 on a forced crit)
{
  const sorc = makeDraconicSorcerer6('fire');
  sorc.actions = [LONGSWORD_ACTION];
  sorc._flameBladeActive = true;

  const enemy = makeEnemy('e3d');
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  resolveAttack(sorc, enemy, LONGSWORD_ACTION, state, true);  // FORCED CRIT

  const eaLog = findEALog(state, 'Flame Blade');
  assert('3d. EA log fires on crit', eaLog !== undefined);
  if (eaLog) {
    // Flame Blade dice ARE doubled on crit (3d6 → 6d6), but EA flat
    // bonus stays at +3 (PHB p.196).
    eq('3d. EA value = 3 on crit (flat, NOT doubled)', eaLog.value, 3);
  }
}

// =============================================================
// CROSS-CUTTING
// =============================================================
console.log('\n--- Cross-cutting ---');

// 4a. EA bonus value = CHA mod (CHA 17 → +3) on Flame Blade
{
  const sorc = makeDraconicSorcerer6('fire', 17);
  sorc.actions = [LONGSWORD_ACTION];
  sorc._flameBladeActive = true;
  eq('4a. CHA 17 → +3 EA', elementalAffinityBonus(sorc, 'fire'), 3);

  const enemy = makeEnemy('e4a');
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);
  resolveAttack(sorc, enemy, LONGSWORD_ACTION, state, true);
  const eaLog = findEALog(state, 'Flame Blade');
  if (eaLog) eq('4a. logged value = 3', eaLog.value, 3);
  else assert('4a. EA log found', false);
}

// 4b. EA bonus value = CHA mod (CHA 20 → +5) on Searing Smite rider
{
  const sorc = makeDraconicSorcerer6('fire', 20);
  sorc.actions = [LONGSWORD_ACTION];
  sorc._nextHitRider = {
    spellName: 'Searing Smite',
    dieSides: 6, count: 1, damageType: 'fire' as any,
  };
  sorc.concentration = { active: true, spellName: 'Searing Smite', dcIfHit: 10 } as any;
  eq('4b. CHA 20 → +5 EA', elementalAffinityBonus(sorc, 'fire'), 5);

  const enemy = makeEnemy('e4b');
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);
  resolveAttack(sorc, enemy, LONGSWORD_ACTION, state, true);
  const eaLog = findEALog(state, 'Searing Smite');
  if (eaLog) eq('4b. logged value = 5', eaLog.value, 5);
  else assert('4b. EA log found', false);
}

// 4c. No EA bonus when draconicAncestry not set (Flame Blade)
{
  const sorc = makeDraconicSorcerer6(undefined);  // ancestry NOT set
  sorc.actions = [LONGSWORD_ACTION];
  sorc._flameBladeActive = true;
  eq('4c. no ancestry → EA = 0', elementalAffinityBonus(sorc, 'fire'), 0);

  const enemy = makeEnemy('e4c');
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);
  resolveAttack(sorc, enemy, LONGSWORD_ACTION, state, true);
  const eaLog = findEALog(state, 'Flame Blade');
  assert('4c. no EA log when ancestry unset', eaLog === undefined);
}

// 4d. EA rider log mentions the source keyword (rider/enchant/Flame Blade)
{
  const sorc = makeDraconicSorcerer6('fire');
  sorc.actions = [LONGSWORD_ACTION];
  sorc._flameBladeActive = true;
  sorc._nextHitRider = {
    spellName: 'Searing Smite',
    dieSides: 6, count: 1, damageType: 'fire' as any,
  };
  sorc.concentration = { active: true, spellName: 'Searing Smite', dcIfHit: 10 } as any;
  sorc.activeEffects = [{
    id: randomUUID(),
    casterId: sorc.id,
    spellName: 'Elemental Weapon',
    effectType: 'weapon_enchant',
    payload: {
      attackBonus: 1, damageBonus: 0,
      damageDie: 4, damageDieCount: 1, damageDieType: 'fire',
    },
    sourceIsConcentration: true,
  } as any];

  const enemy = makeEnemy('e4d');
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  resolveAttack(sorc, enemy, LONGSWORD_ACTION, state, true);

  // All 3 EA logs should fire on the same hit (each site is independent).
  const riderLog = findEALog(state, 'Searing Smite');
  const enchLog = findEALog(state, 'weapon enchant');
  const flameLog = findEALog(state, 'Flame Blade');
  assert('4d-1. Searing Smite EA log present', riderLog !== undefined);
  assert('4d-2. weapon enchant EA log present', enchLog !== undefined);
  assert('4d-3. Flame Blade EA log present', flameLog !== undefined);
  if (riderLog) console.log(`    rider:  ${riderLog.description}`);
  if (enchLog)  console.log(`    ench:   ${enchLog.description}`);
  if (flameLog) console.log(`    flame:  ${flameLog.description}`);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
