// ============================================================
// Test: Draconic Sorcerer Dragon Wings + Draconic Presence
// (Session 49, Task #29-follow-up-5d)
//
// Validates that two Draconic Bloodline (Sorcerer) features are mechanically
// wired into the engine:
//
//   Dragon Wings (Draconic Sorcerer 14, PHB p.102):
//     "At 14th level, you gain the ability to sprout a pair of dragon wings
//      from your back, obtaining a flying speed equal to your current speed."
//     - Wired in buildCombatant: sets combatant.flySpeed = combatant.speed
//     - Permanent passive (no resource cost)
//     - Higher of racial fly speed vs wings speed wins
//
//   Draconic Presence (Draconic Sorcerer 18, PHB p.102):
//     "Beginning at 18th level, you can channel the dread presence of your
//      dragon ancestor, using Action + 5 sorcery points. Each creature of
//      your choice within 60 feet of you must succeed on a Wisdom saving
//      throw or become frightened of you until the end of your next turn."
//     - Wired as 'draconicPresence' action type in combat.ts
//     - v1 simplification: 1/combat (sorcery points not yet on Combatant)
//     - Planner fires when 2+ enemies within 60 ft and HP > 30%
//     - Frightened applied via applySpellEffect (condition_apply)
//
// Coverage:
//   1. Draconic Sorcerer 14 has "Dragon Wings" feature
//   2. Vanilla Sorcerer 14 does NOT have "Dragon Wings"
//   3. Draconic Sorcerer 14 has flySpeed = speed (30)
//   4. Draconic Sorcerer 6 (too low) does NOT have flySpeed set
//   5. Draconic Sorcerer 18 has "Draconic Presence" feature
//   6. resources.draconicPresence is set (max 1, remaining 1)
//   7. Planner fires Draconic Presence when 2+ enemies within 60ft and HP > 30%
//   8. Planner does NOT fire when HP < 30% (self-preserve takes priority)
//   9. Planner does NOT fire when only 1 enemy within 60ft
//  10. Planner does NOT fire when no uses remaining
//  11. Engine: enemy fails WIS save → frightened
//  12. Engine: enemy succeeds WIS save → not frightened
//  13. Engine: resource consumed after use (1 → 0)
//  14. Engine: already-frightened enemy is skipped
//  15. Engine: enemy outside 60ft is NOT affected
//
// Run: npx ts-node src/test/draconic_wings_presence.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyLevelUp } from '../characters/leveler';
import { chooseSubclass } from '../characters/improvements';
import { buildCombatant, hasFeature } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
import { planTurn } from '../ai/planner';
import { executePlannedAction, EngineState } from '../engine/combat';
import { Combatant, Action, Battlefield, Vec3 } from '../types/core';

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

function makeSorcerer1(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Lyra', race: 'Human', background: 'Sage',
    alignment: 'Chaotic Good',
    firstClass: 'Sorcerer',
    classLevels: [{ className: 'Sorcerer', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha: 17 },
    stats:     { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha: 17 },
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
  return { ...base, ...overrides };
}

function levelTo(sheet: CharacterSheet, cls: string, target: number, subclass: string | null = null): CharacterSheet {
  let s = sheet;
  // Sorcerer picks subclass at level 1 (Draconic Bloodline).
  if (subclass && cls === 'Sorcerer') {
    s = chooseSubclass(s, cls, subclass);
  }
  for (let lvl = 2; lvl <= target; lvl++) {
    s = applyLevelUp(s, cls).sheet;
  }
  return s;
}

function makeEnemy(id: string, pos: Vec3, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 10000, currentHP: 10000, ac: 30, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos,
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'attackNearest',
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
    ...overrides,
  } as Combatant;
}

function makeBF(combatants: Combatant[]): Battlefield {
  const width = 40, height = 40, depth = 1;
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

/** Build a Draconic Sorcerer at `level` with no spell slots (forces planner
 * to pick non-spell actions). Returns the Combatant. */
function makeDraconicSorc(level: number): Combatant {
  const sheet = levelTo(makeSorcerer1(), 'Sorcerer', level, 'Draconic Bloodline');
  const sorc = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  sorc.draconicAncestry = 'fire';
  // Clear spell slots so the planner doesn't prefer offensive spells.
  if (sorc.resources) {
    (sorc.resources as any).spellSlots = {};
  }
  // Remove spell actions so the planner doesn't pick them.
  sorc.actions = sorc.actions.filter(a => a.slotLevel === undefined || a.slotLevel === null);
  return sorc;
}

// ============================================================
// 1. Draconic Sorcerer 14 has "Dragon Wings" feature
// ============================================================
console.log('\n--- 1. Draconic Sorcerer 14 has Dragon Wings ---');
{
  const sorc = makeDraconicSorc(14);
  assert('1. has Dragon Wings', hasFeature(sorc, 'Dragon Wings'));
}

// ============================================================
// 2. Vanilla Sorcerer 14 does NOT have "Dragon Wings"
// ============================================================
console.log('\n--- 2. Vanilla Sorcerer 14 does NOT have Dragon Wings ---');
{
  const sheet = levelTo(makeSorcerer1(), 'Sorcerer', 14);  // no subclass
  const sorc = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  assert('2. does NOT have Dragon Wings', !hasFeature(sorc, 'Dragon Wings'));
}

// ============================================================
// 3. Draconic Sorcerer 14 has flySpeed = speed (30)
// ============================================================
console.log('\n--- 3. Draconic Sorcerer 14 flySpeed = speed ---');
{
  const sorc = makeDraconicSorc(14);
  eq('3a. speed = 30', sorc.speed, 30);
  eq('3b. flySpeed = 30 (Dragon Wings)', sorc.flySpeed, 30);
}

// ============================================================
// 4. Draconic Sorcerer 6 (too low) does NOT have flySpeed set
// ============================================================
console.log('\n--- 4. Draconic Sorcerer 6 (too low) — no flySpeed ---');
{
  const sorc = makeDraconicSorc(6);
  assert('4a. does NOT have Dragon Wings', !hasFeature(sorc, 'Dragon Wings'));
  eq('4b. flySpeed is null (no wings yet)', sorc.flySpeed, null);
}

// ============================================================
// 5. Draconic Sorcerer 18 has "Draconic Presence" feature
// ============================================================
console.log('\n--- 5. Draconic Sorcerer 18 has Draconic Presence ---');
{
  const sorc = makeDraconicSorc(18);
  assert('5. has Draconic Presence', hasFeature(sorc, 'Draconic Presence'));
}

// ============================================================
// 6. resources.draconicPresence is set (max 1, remaining 1)
// ============================================================
console.log('\n--- 6. draconicPresence resource set ---');
{
  const sorc = makeDraconicSorc(18);
  assert('6a. draconicPresence resource exists', !!sorc.resources?.draconicPresence);
  eq('6b. max = 1', sorc.resources?.draconicPresence?.max, 1);
  eq('6c. remaining = 1', sorc.resources?.draconicPresence?.remaining, 1);
}

// ============================================================
// 7. Planner fires Draconic Presence when 2+ enemies within 60ft and HP > 30%
// ============================================================
console.log('\n--- 7. Planner fires Draconic Presence (2+ enemies, HP > 30%) ---');
{
  const sorc = makeDraconicSorc(18);
  sorc.currentHP = Math.floor(sorc.maxHP * 0.8);  // 80% HP — well above 30%
  sorc.budget = { movementFt: sorc.speed, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  // 3 enemies within 60 ft (at 5, 10, 15 squares = 25, 50, 75 ft — last one OUT of 60ft)
  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 });   // 25 ft — in
  const e2 = makeEnemy('e2', { x: 10, y: 0, z: 0 });  // 50 ft — in
  const e3 = makeEnemy('e3', { x: 15, y: 0, z: 0 });  // 75 ft — OUT
  const bf = makeBF([sorc, e1, e2, e3]);
  const plan = planTurn(sorc, bf);

  assert('7. planner returns draconicPresence action', plan.action?.type === 'draconicPresence',
    `got ${plan.action?.type}`);
  if (plan.action?.type === 'draconicPresence') {
    console.log(`    Plan: ${plan.action.description}`);
  }
}

// ============================================================
// 8. Planner does NOT fire when HP < 30% (self-preserve takes priority)
// ============================================================
console.log('\n--- 8. Planner does NOT fire Draconic Presence when HP < 30% ---');
{
  const sorc = makeDraconicSorc(18);
  sorc.currentHP = Math.floor(sorc.maxHP * 0.2);  // 20% HP — below 30%
  sorc.budget = { movementFt: sorc.speed, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 });
  const e2 = makeEnemy('e2', { x: 10, y: 0, z: 0 });
  const bf = makeBF([sorc, e1, e2]);
  const plan = planTurn(sorc, bf);

  // HP < 30% → self-preserve takes priority; Draconic Presence should NOT fire.
  assert('8. planner does NOT return draconicPresence when HP < 30%',
    plan.action?.type !== 'draconicPresence',
    `got ${plan.action?.type}`);
}

// ============================================================
// 9. Planner does NOT fire when only 1 enemy within 60ft
// ============================================================
console.log('\n--- 9. Planner does NOT fire with only 1 enemy in range ---');
{
  const sorc = makeDraconicSorc(18);
  sorc.currentHP = sorc.maxHP;  // full HP
  sorc.budget = { movementFt: sorc.speed, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  // Only 1 enemy within 60 ft.
  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 });
  // e2 outside 60 ft (15 squares = 75 ft)
  const e2 = makeEnemy('e2', { x: 15, y: 0, z: 0 });
  const bf = makeBF([sorc, e1, e2]);
  const plan = planTurn(sorc, bf);

  assert('9. planner does NOT return draconicPresence with only 1 enemy in range',
    plan.action?.type !== 'draconicPresence',
    `got ${plan.action?.type}`);
}

// ============================================================
// 10. Planner does NOT fire when no uses remaining
// ============================================================
console.log('\n--- 10. Planner does NOT fire when no uses remaining ---');
{
  const sorc = makeDraconicSorc(18);
  sorc.currentHP = sorc.maxHP;
  // Exhaust the resource.
  if (sorc.resources?.draconicPresence) sorc.resources.draconicPresence.remaining = 0;
  sorc.budget = { movementFt: sorc.speed, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 });
  const e2 = makeEnemy('e2', { x: 10, y: 0, z: 0 });
  const bf = makeBF([sorc, e1, e2]);
  const plan = planTurn(sorc, bf);

  assert('10. planner does NOT return draconicPresence when no uses remaining',
    plan.action?.type !== 'draconicPresence',
    `got ${plan.action?.type}`);
}

// ============================================================
// 11. Engine: enemy fails WIS save → frightened
// ============================================================
console.log('\n--- 11. Engine: enemy fails WIS save → frightened ---');
{
  const sorc = makeDraconicSorc(18);
  sorc.budget = { movementFt: sorc.speed, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  // Enemy with WIS 1 → guaranteed WIS save fail.
  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { wis: 1, ac: 30 });
  const bf = makeBF([sorc, e1]);
  const state = makeState(bf);

  executePlannedAction(sorc, {
    type: 'draconicPresence',
    action: null,
    targetId: null,
    description: `${sorc.name} channels Draconic Presence`,
  }, state);

  assert('11. enemy is frightened after failed WIS save', e1.conditions.has('frightened'));
  const frightenEvents = state.log.events.filter((e: any) => e.type === 'condition_add');
  if (frightenEvents.length > 0) {
    console.log(`    ${frightenEvents[0].description}`);
  }
}

// ============================================================
// 12. Engine: enemy succeeds WIS save → not frightened
// ============================================================
console.log('\n--- 12. Engine: enemy succeeds WIS save → not frightened ---');
{
  const sorc = makeDraconicSorc(18);
  // Lower CHA so the fallback saveDC (8 + prof + CHA mod) drops to
  // 8 + 6 + (-5) = 9. With WIS 30 (+10), enemy min save = 11 ≥ 9 → guaranteed success.
  sorc.cha = 1;
  sorc.budget = { movementFt: sorc.speed, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  // Enemy with WIS 30 → guaranteed WIS save success vs DC 9.
  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { wis: 30, ac: 30 });
  const bf = makeBF([sorc, e1]);
  const state = makeState(bf);

  executePlannedAction(sorc, {
    type: 'draconicPresence',
    action: null,
    targetId: null,
    description: `${sorc.name} channels Draconic Presence`,
  }, state);

  assert('12. enemy is NOT frightened after successful WIS save', !e1.conditions.has('frightened'));
  const saveSuccessEvents = state.log.events.filter((e: any) => e.type === 'save_success');
  if (saveSuccessEvents.length > 0) {
    console.log(`    ${saveSuccessEvents[0].description}`);
  }
}

// ============================================================
// 13. Engine: resource consumed after use (1 → 0)
// ============================================================
console.log('\n--- 13. Engine: draconicPresence resource consumed ---');
{
  const sorc = makeDraconicSorc(18);
  sorc.budget = { movementFt: sorc.speed, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };
  eq('13a. remaining = 1 before use', sorc.resources?.draconicPresence?.remaining, 1);

  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { wis: 1, ac: 30 });
  const bf = makeBF([sorc, e1]);
  const state = makeState(bf);

  executePlannedAction(sorc, {
    type: 'draconicPresence',
    action: null,
    targetId: null,
    description: `${sorc.name} channels Draconic Presence`,
  }, state);

  eq('13b. remaining = 0 after use', sorc.resources?.draconicPresence?.remaining, 0);
}

// ============================================================
// 14. Engine: already-frightened enemy is skipped
// ============================================================
console.log('\n--- 14. Engine: already-frightened enemy is skipped ---');
{
  const sorc = makeDraconicSorc(18);
  sorc.budget = { movementFt: sorc.speed, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  // Pre-frighten the enemy (e.g. from Cause Fear earlier).
  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { wis: 1, ac: 30 });
  e1.conditions.add('frightened');
  const bf = makeBF([sorc, e1]);
  const state = makeState(bf);

  executePlannedAction(sorc, {
    type: 'draconicPresence',
    action: null,
    targetId: null,
    description: `${sorc.name} channels Draconic Presence`,
  }, state);

  // Enemy should still be frightened (was already), and the log should note it was skipped.
  assert('14a. enemy remains frightened', e1.conditions.has('frightened'));
  const skipEvents = state.log.events.filter((e: any) =>
    e.type === 'action' && typeof e.description === 'string' && e.description.includes('already frightened'));
  assert('14b. log notes enemy was already frightened — skipped', skipEvents.length > 0);
}

// ============================================================
// 15. Engine: enemy outside 60ft is NOT affected
// ============================================================
console.log('\n--- 15. Engine: enemy outside 60ft is NOT affected ---');
{
  const sorc = makeDraconicSorc(18);
  sorc.budget = { movementFt: sorc.speed, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  // e1 within 60 ft (5 squares = 25 ft), e2 OUTSIDE 60 ft (15 squares = 75 ft)
  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { wis: 1, ac: 30 });
  const e2 = makeEnemy('e2', { x: 15, y: 0, z: 0 }, { wis: 1, ac: 30 });
  const bf = makeBF([sorc, e1, e2]);
  const state = makeState(bf);

  executePlannedAction(sorc, {
    type: 'draconicPresence',
    action: null,
    targetId: null,
    description: `${sorc.name} channels Draconic Presence`,
  }, state);

  assert('15a. e1 (within 60ft) is frightened', e1.conditions.has('frightened'));
  assert('15b. e2 (outside 60ft) is NOT frightened', !e2.conditions.has('frightened'));
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('draconic_wings_presence.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('draconic_wings_presence.test.ts: all tests passed ✅');
}
