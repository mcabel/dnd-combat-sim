// ============================================================
// lesser_restoration.test.ts — Lesser Restoration spell module
// PHB p.255: 2nd-level abjuration, action, range Touch, NO concentration.
// Effect: ends one disease or one condition (blinded, deafened, paralyzed,
//         or poisoned) on a touched creature.
//
// v1 simplifications (documented via metadata flags):
//   - Instantaneous (no duration to track).
//   - Removes ALL of blinded/deafened/paralyzed/poisoned (canon: ONE).
//   - Diseases NOT modelled.
//   - NOT a concentration spell.
//
// Tests cover shouldCast() preconditions + target priority, execute()
// condition removal + slot consumption + logging (condition_remove events),
// integration pipeline, and metadata shape.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/lesser_restoration';
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

const LESSER_RESTORATION_ACTION: Action = {
  name: 'Lesser Restoration',
  isMultiattack: false,
  attackType: null,
  reach: 5,
  range: { normal: 5, long: 5 },
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
  description: 'Lesser Restoration (ends blinded/deafened/paralyzed/poisoned on touch)',
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

/** Cleric at pos (0,0,0) with Lesser Restoration + 2 2nd-level slots */
function makeCleric(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    pos,
    actions: [LESSER_RESTORATION_ACTION],
    resources: withSlots2(2),
  });
}

/** Ally at given pos with a removable condition preset */
function makeAlly(
  id: string,
  pos: Vec3 = { x: 1, y: 0, z: 0 },
  overrides: Partial<Combatant> = {},
): Combatant {
  return makeCombatant(id, { name: id, pos, ...overrides });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Lesser Restoration', metadata.name, 'Lesser Restoration');
eq('level is 2', metadata.level, 2);
eq('school is abjuration', metadata.school, 'abjuration');
eq('range is 5 ft (touch)', metadata.rangeFt, 5);
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');

// removableConditions: ['blinded','deafened','paralyzed','poisoned']
const removable = (metadata as any).removableConditions as string[];
eq('removableConditions length is 4', removable.length, 4);
eq('removableConditions includes blinded', removable.includes('blinded'), true);
eq('removableConditions includes deafened', removable.includes('deafened'), true);
eq('removableConditions includes paralyzed', removable.includes('paralyzed'), true);
eq('removableConditions includes poisoned', removable.includes('poisoned'), true);

eq('v1: removes ALL conditions (canon: one)',
  (metadata as any).lesserRestorationSingleConditionV1Simplified, true);
eq('v1: diseases NOT modelled',
  (metadata as any).lesserRestorationDiseaseV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Lesser Restoration' action
  const caster = makeCleric();
  caster.actions = [];
  const ally = makeAlly('a1');
  ally.conditions.add('poisoned');
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Lesser Restoration action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeCleric();
  caster.resources = withSlots2(0);
  const ally = makeAlly('a1');
  ally.conditions.add('poisoned');
  const bf = makeBF([caster, ally]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No ally with a removable condition (ally is healthy)
  const caster = makeCleric();
  const ally = makeAlly('a1');
  // ally has no conditions
  const bf = makeBF([caster, ally]);
  assert('Returns null when no ally has a removable condition', shouldCast(caster, bf) === null);
}

{
  // 2d. Ally has a non-removable condition (e.g. frightened) only — skip
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('frightened');
  const bf = makeBF([caster, ally]);
  assert('Returns null when ally has only non-removable conditions', shouldCast(caster, bf) === null);
}

{
  // 2e. Out of range: ally with poisoned condition is >5 ft away
  const caster = makeCleric();
  const farAlly = makeAlly('far', { x: 5, y: 0, z: 0 });  // 25 ft away
  farAlly.conditions.add('poisoned');
  const bf = makeBF([caster, farAlly]);
  assert('Returns null when afflicted ally is out of touch range', shouldCast(caster, bf) === null);
}

{
  // 2f. Already concentrating — Lesser Restoration is NOT concentration, so
  // this should NOT block casting.
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const ally = makeAlly('a1');
  ally.conditions.add('poisoned');
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('NOT concentration: cast allowed while concentrating on another spell', result !== null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Self first: caster is afflicted → targets self
  const caster = makeCleric();
  caster.conditions.add('paralyzed');
  const ally = makeAlly('a1');
  ally.conditions.add('poisoned');
  const bf = makeBF([caster, ally]);
  eq('Self-afflicted caster targets self', shouldCast(caster, bf)?.id, 'cleric1');
}

{
  // 3b. Lowest-HP% ally preferred
  const caster = makeCleric();
  const hurt = makeAlly('hurt', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 10 });
  hurt.conditions.add('poisoned');
  const full = makeAlly('full', { x: 1, y: 1, z: 0 }, { maxHP: 40, currentHP: 40 });
  full.conditions.add('blinded');
  const bf = makeBF([caster, hurt, full]);
  eq('Lowest-HP% ally selected', shouldCast(caster, bf)?.id, 'hurt');
}

{
  // 3c. Touch range: all non-self allies at chebyshev=1 are at 5 ft — the
  // distance tiebreak cannot differentiate them. Verify stable behaviour:
  // two equal-HP% afflicted allies at the same distance both qualify, and
  // shouldCast returns one of them (deterministic per insertion order in
  // V8's stable sort).
  const caster = makeCleric();
  const a = makeAlly('a', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 20 });
  a.conditions.add('poisoned');
  const b = makeAlly('b', { x: 0, y: 1, z: 0 }, { maxHP: 40, currentHP: 20 });
  b.conditions.add('blinded');
  const bf = makeBF([caster, a, b]);
  const target = shouldCast(caster, bf)?.id;
  assert('Tie-break selects one of the equal-priority allies', target === 'a' || target === 'b',
    `got ${target}`);
}

// ============================================================
// 4. execute — condition removal + slot consumption
// ============================================================

console.log('\n=== 4. execute — condition removal + slot consumption ===\n');

{
  // 4a. All removable conditions removed (v1 simplification — canon removes ONE)
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('blinded');
  ally.conditions.add('deafened');
  ally.conditions.add('paralyzed');
  ally.conditions.add('poisoned');
  // Add a NON-removable condition — should NOT be removed.
  ally.conditions.add('frightened');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('blinded removed', !ally.conditions.has('blinded'));
  assert('deafened removed', !ally.conditions.has('deafened'));
  assert('paralyzed removed', !ally.conditions.has('paralyzed'));
  assert('poisoned removed', !ally.conditions.has('poisoned'));
  assert('frightened NOT removed (not in removableConditions)', ally.conditions.has('frightened'));
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4b. NOT concentration — caster.concentration remains null
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('poisoned');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  eq('NO concentration started (instantaneous spell)', caster.concentration, null);
}

{
  // 4c. Dead target skipped (stale plan) — slot still consumed, no condition removed
  const caster = makeCleric();
  const ally = makeAlly('a1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  ally.conditions.add('poisoned');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
  assert('Dead target keeps conditions (no removal)', ally.conditions.has('poisoned'));
}

{
  // 4d. Stale plan: condition cleared between plan and execute — no crash,
  // emits "no removable conditions" log.
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('poisoned');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  // Manually clear condition between plan and execute to simulate staleness.
  ally.conditions.delete('poisoned');
  execute(caster, ally, state);

  eq('Slot still consumed on stale plan', caster.resources!.spellSlots![2]!.remaining, 1);
  const staleLog = state.log.events.some(
    (e: any) => e.type === 'action' && e.description.includes('no removable conditions'),
  );
  assert('Stale-plan log emitted', staleLog);
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('paralyzed');
  ally.conditions.add('poisoned');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const removeEvents = events.filter(e => e.type === 'condition_remove');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Lesser Restoration"',
    actionEvents[0].description.includes('Lesser Restoration'));
  // 2 conditions removed → 2 condition_remove events
  eq('condition_remove event count matches removed conditions', removeEvents.length, 2);
  // Each removed condition is mentioned in its event description
  assert('Paralyzed removal logged',
    removeEvents.some(e => e.description.includes('paralyzed')));
  assert('Poisoned removal logged',
    removeEvents.some(e => e.description.includes('poisoned')));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/lesser_restoration');
  const caster = makeCleric();
  // cleanup is a no-op for instantaneous spells. Even if the caster has
  // concentration on a different spell, cleanup should NOT touch it.
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT touch concentration', caster.concentration?.spellName, 'Bless');
  eq('Cleanup does NOT change active flag', caster.concentration?.active, true);
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: ally with multiple conditions → all removed
  const caster = makeCleric();
  const ally = makeAlly('ally', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 5 });
  ally.conditions.add('blinded');
  ally.conditions.add('deafened');
  ally.conditions.add('paralyzed');
  ally.conditions.add('poisoned');
  const otherAlly = makeAlly('other', { x: 1, y: 1, z: 0 }, { maxHP: 40, currentHP: 40 });
  otherAlly.conditions.add('poisoned');
  const bf = makeBF([caster, ally, otherAlly]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the lowest-HP% ally (ally)', target?.id, 'ally');
  if (target) execute(caster, target, state);

  assert('All 4 conditions removed from target', ally.conditions.size === 0);
  assert('Other ally NOT cleansed (only targeted ally)', otherAlly.conditions.has('poisoned'));
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster NOT concentrating (instantaneous)', caster.concentration, null);
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
  caster.resources = withSlots2(1);
  const ally = makeAlly('a1');
  ally.conditions.add('poisoned');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  // Re-afflict to ensure target would still be valid by condition
  ally.conditions.add('blinded');
  const t2 = shouldCast(caster, makeBF([caster, ally]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
