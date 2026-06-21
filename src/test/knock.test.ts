// ============================================================
// knock.test.ts — Knock spell module
// PHB p.254: 2nd-level transmutation, action, range 60 ft, NO concentration.
// Effect: opens a stuck/locked object (v1: forward-compat flag on the CASTER;
//         no object/lock subsystem in v1).
//
// v1 simplifications (documented via metadata flags):
//   - Object/lock subsystem NOT implemented — `_knockActive` flag is forward-
//     compat only.
//   - Loud-knock audibility NOT modelled (no sound/perception subsystem).
//   - Magical-relock-after-duration NOT modelled.
//   - Upcast NOT modelled (no At Higher Levels entry).
//   - NOT a concentration spell (PHB p.254: instantaneous, no concentration).
//
// Tests cover shouldCast() preconditions + execute() scratch-field application
// + slot consumption + logging + integration pipeline + metadata shape.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/knock';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots2(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

const KNOCK_ACTION: Action = {
  name: 'Knock',
  isMultiattack: false,
  attackType: 'special',   // utility cast — NOT 'melee'/'ranged'
  reach: 0,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Knock (60 ft, opens a stuck/locked object, NOT concentration)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set() as Set<Condition>,
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
    ...overrides,
  };
}

function makeBF(combatants: Combatant[]) {
  return {
    width: 20, height: 20, depth: 1,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

/** Wizard at (0,0,0) with Knock + 2 2nd-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [KNOCK_ACTION],
    resources: withSlots2(2),
  });
}

function makeEnemy(
  id: string,
  pos: Vec3 = { x: 1, y: 0, z: 0 },
  overrides: Partial<Combatant> = {},
): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', pos, ...overrides });
}

// ============================================================
// 1. Metadata (including v1 forward-compat flags)
// ============================================================

console.log('\n=== 1. Metadata (including v1 flags) ===\n');

eq('name is Knock', metadata.name, 'Knock');
eq('level is 2', metadata.level, 2);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
eq('v1: object subsystem NOT implemented',
  (metadata as any).knockObjectSubsystemV1Implemented, false);
eq('v1: audible range NOT implemented',
  (metadata as any).knockAudibleRangeV1Implemented, false);
eq('v1: upcast NOT implemented',
  (metadata as any).knockUpcastV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Knock' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when caster has no Knock action', shouldCast(caster, bf), false);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when no 2nd-level slots', shouldCast(caster, bf), false);
}

{
  // 2c. Already Knock-active — skip
  const caster = makeWizard();
  caster._knockActive = true;
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when already Knock-active', shouldCast(caster, bf), false);
}

{
  // 2d. All preconditions met → returns true
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns true when all preconditions met', shouldCast(caster, bf), true);
}

{
  // 2e. NOT concentration: cast allowed while concentrating on another spell
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('NOT concentration: cast allowed while concentrating on another spell', shouldCast(caster, bf), true);
}

// ============================================================
// 3. execute — scratch field + slot consumption
// ============================================================

console.log('\n=== 3. execute — scratch field + slot consumption ===\n');

{
  // 3a. _knockActive set to true on caster
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  eq('Scratch field undefined before cast', caster._knockActive, undefined);

  execute(caster, state);

  eq('Scratch field set', caster._knockActive, true);
}

{
  // 3b. Slot consumed + NOT concentration
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('No concentration started', caster.concentration, null);
}

{
  // 3c. No sentinel effect attached (flag persists for combat — no cleanup)
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const sentinels = caster.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Knock',
  );
  eq('No sentinel effect attached (forward-compat flag only)', sentinels.length, 0);
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Knock"',
    actionEvents[0].description.includes('Knock'));
  eq('1 condition_add event (forward-compat flag)', condEvents.length, 1);
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/knock');
  const caster = makeWizard();
  caster._knockActive = true;
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT clear scratch field', caster._knockActive, true);
  eq('Cleanup does NOT touch concentration', caster.concentration?.spellName, 'Blur');
}

// ============================================================
// 6. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 6. Integration pipeline ===\n');

{
  // 6a. Full pipeline: wizard casts Knock in combat
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const decision = shouldCast(caster, bf);
  eq('shouldCast returns true', decision, true);
  if (decision) execute(caster, state);

  eq('Scratch field set', caster._knockActive, true);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster NOT concentrating', caster.concentration, null);
}

{
  // 6b. After already Knock-active, shouldCast returns false
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const d1 = shouldCast(caster, bf);
  if (d1) execute(caster, state);

  eq('Slot depleted by 1', caster.resources!.spellSlots![2]!.remaining, 1);
  // Caster is now Knock-active → second shouldCast returns false
  const d2 = shouldCast(caster, bf);
  eq('shouldCast returns false after already-active', d2, false);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
