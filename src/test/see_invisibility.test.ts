// ============================================================
// see_invisibility.test.ts — See Invisibility spell module
// PHB p.274: 2nd-level divination, action, range Self, NO concentration (1 hr).
// Effect: see invisible creatures/objects 60 ft (v1: forward-compat flag on
//         the CASTER; no vision subsystem in v1).
//
// v1 simplifications (documented via metadata flags):
//   - Vision subsystem NOT implemented — `_seeInvisibilityActive` flag is
//     forward-compat only (computeLOS does not query it yet).
//   - 1-hr duration simplified (persists for combat — no cleanup).
//   - Upcast NOT modelled (no At Higher Levels entry).
//   - NOT a concentration spell (PHB p.274: 1 hr, no concentration).
//
// Tests cover shouldCast() preconditions + execute() scratch-field application
// + slot consumption + logging + integration pipeline + metadata shape.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/see_invisibility';
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

const SEE_INVIS_ACTION: Action = {
  name: 'See Invisibility',
  isMultiattack: false,
  attackType: 'special',   // self-buff — NOT 'melee'/'ranged'
  reach: 0,
  range: { normal: 0, long: 0 },   // Self
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
  description: 'See Invisibility (self, see invisible 60 ft, 1 hr, NOT concentration)',
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

/** Wizard at (0,0,0) with See Invisibility + 2 2nd-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [SEE_INVIS_ACTION],
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

eq('name is See Invisibility', metadata.name, 'See Invisibility');
eq('level is 2', metadata.level, 2);
eq('school is divination', metadata.school, 'divination');
eq('range is 0 ft (self)', metadata.rangeFt, 0);
eq('seeInvisibilityRangeFt is 60', (metadata as any).seeInvisibilityRangeFt, 60);
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
eq('v1: vision integration NOT implemented',
  (metadata as any).seeInvisibilityVisionIntegrationV1Implemented, false);
eq('v1: duration simplified (persists for combat)',
  (metadata as any).seeInvisibilityDurationV1Simplified, true);
eq('v1: upcast NOT implemented',
  (metadata as any).seeInvisibilityUpcastV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'See Invisibility' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when caster has no See Invisibility action', shouldCast(caster, bf), false);
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
  // 2c. Already See-Invisibility-active — skip
  const caster = makeWizard();
  caster._seeInvisibilityActive = true;
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when already See-Invisibility-active', shouldCast(caster, bf), false);
}

{
  // 2d. No living enemies → buff useless → false
  const caster = makeWizard();
  const deadEnemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, deadEnemy]);
  eq('Returns false when no living enemies', shouldCast(caster, bf), false);
}

{
  // 2e. All preconditions met → returns true
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns true when all preconditions met', shouldCast(caster, bf), true);
}

{
  // 2f. NOT concentration: cast allowed while concentrating on another spell
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
  // 3a. _seeInvisibilityActive set to true on caster
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  eq('Scratch field undefined before cast', caster._seeInvisibilityActive, undefined);

  execute(caster, state);

  eq('Scratch field set', caster._seeInvisibilityActive, true);
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
    e => e.effectType === 'damage_zone' && e.spellName === 'See Invisibility',
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
  assert('Action event mentions "See Invisibility"',
    actionEvents[0].description.includes('See Invisibility'));
  eq('1 condition_add event (vision granted)', condEvents.length, 1);
  assert('condition_add mentions invisible',
    condEvents[0].description.includes('invisible'));
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/see_invisibility');
  const caster = makeWizard();
  caster._seeInvisibilityActive = true;
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  // cleanup should NOT clear the scratch field or touch concentration.
  cleanup(caster);
  eq('Cleanup does NOT clear scratch field', caster._seeInvisibilityActive, true);
  eq('Cleanup does NOT touch concentration', caster.concentration?.spellName, 'Blur');
  eq('Cleanup does NOT change active flag', caster.concentration?.active, true);
}

// ============================================================
// 6. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 6. Integration pipeline ===\n');

{
  // 6a. Full pipeline: wizard casts See Invisibility in combat
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const decision = shouldCast(caster, bf);
  eq('shouldCast returns true', decision, true);
  if (decision) execute(caster, state);

  eq('Scratch field set', caster._seeInvisibilityActive, true);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster NOT concentrating (NOT a concentration spell)', caster.concentration, null);
}

{
  // 6b. After slots exhausted, shouldCast returns false
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const d1 = shouldCast(caster, bf);
  if (d1) execute(caster, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  // Caster is now See-Invisibility-active → second shouldCast also returns false
  const d2 = shouldCast(caster, bf);
  eq('shouldCast returns false after already-active', d2, false);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
