// ============================================================
// mirror_image.test.ts — Mirror Image spell module
// PHB p.260: 2nd-level illusion, action, self, NO concentration, 1 min.
// Effect: 3 illusory duplicates; attackers must roll d20 to retarget.
//
// Tests cover shouldCast() preconditions, execute() scratch field
// setup + slot consumption + logging, the resolveAttack retargeting
// hook (simulated — see section 5), integration pipeline, and metadata.
//
// The retargeting hook in resolveAttack uses rollDie(20) which is
// non-deterministic. Section 5 simulates the retargeting logic with
// controlled inputs (deterministic d20 rolls) to verify the
// duplicate-destruction mechanics.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/mirror_image';
import { Combatant, Action, PlayerResources, Vec3 } from '../types/core';

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

const MIRROR_ACTION: Action = {
  name: 'Mirror Image',
  isMultiattack: false,
  attackType: null,
  reach: 5,
  range: { normal: 0, long: 0 },
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
  description: 'Mirror Image (3 illusory duplicates, 1 min, no concentration)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
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

/** Wizard at pos (0,0,0) with Mirror Image + 2 2nd-level slots, DEX 16 (+3) */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [MIRROR_ACTION],
    resources: withSlots2(2),
  });
}

function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', pos });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('level is 2', metadata.level, 2);
eq('school is illusion', metadata.school, 'illusion');
eq('range is 0 (self)', metadata.rangeFt, 0);
eq('duplicate count is 3', metadata.duplicateCount, 3);
eq('duplicate AC base is 10', metadata.duplicateAcBase, 10);
eq('retarget threshold for 1 duplicate is 11', metadata.retargetThresholds[1], 11);
eq('retarget threshold for 2 duplicates is 8', metadata.retargetThresholds[2], 8);
eq('retarget threshold for 3 duplicates is 6', metadata.retargetThresholds[3], 6);
// Mirror Image is NOT a concentration spell — metadata has no `concentration` field
assert('NOT concentration (no concentration field in metadata)', !('concentration' in metadata));
eq('duration v1 simplified (1-min not tracked)', metadata.mirrorImageDurationV1Simplified, true);
eq('sight dependency NOT implemented (v1)', metadata.mirrorImageSightDependencyV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Mirror Image' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Mirror Image action', shouldCast(caster, bf) === false);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns false when no 2nd-level slots', shouldCast(caster, bf) === false);
}

{
  // 2c. Caster already has Mirror Image active (duplicates > 0) → skip
  const caster = makeWizard();
  caster._mirrorImageDuplicates = 3;
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster already has duplicates', shouldCast(caster, bf) === false);
}

{
  // 2d. Caster has 0 duplicates (all destroyed) → can re-cast
  const caster = makeWizard();
  caster._mirrorImageDuplicates = 0;
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns true when duplicates = 0 (re-cast allowed)', shouldCast(caster, bf) === true);
}

{
  // 2e. No enemies → returns false (buff is useless)
  const caster = makeWizard();
  const bf = makeBF([caster]);
  assert('Returns false when no enemies', shouldCast(caster, bf) === false);
}

{
  // 2f. Caster can cast while concentrating (NOT a concentration spell)
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns true even when caster is concentrating (NOT concentration)', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. execute — scratch field setup
// ============================================================

console.log('\n=== 3. execute — scratch field setup ===\n');

{
  // 3a. execute sets _mirrorImageDuplicates = 3
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('_mirrorImageDuplicates set to 3', caster._mirrorImageDuplicates, 3);
}

{
  // 3b. Slot consumed
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('2nd-level slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 3c. Does NOT start concentration (NOT a concentration spell)
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Concentration NOT started (Mirror Image is not concentration)',
    caster.concentration?.active ?? false, false);
}

{
  // 3d. Re-cast after all duplicates destroyed resets to 3
  const caster = makeWizard();
  caster._mirrorImageDuplicates = 0;  // all destroyed
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('_mirrorImageDuplicates reset to 3', caster._mirrorImageDuplicates, 3);
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
  assert('Condition_add event emitted', condEvents.length >= 1);
  assert('Action event mentions "Mirror Image"', actionEvents[0].description.includes('Mirror Image'));
}

// ============================================================
// 5. resolveAttack retargeting hook (simulated)
// ============================================================

console.log('\n=== 5. resolveAttack retargeting hook (simulated) ===\n');

// We can't easily call resolveAttack directly (it requires a full EngineState
// with all the combat infrastructure). Instead, we simulate the retargeting
// logic that combat.ts uses to verify the duplicate-destruction mechanics.
//
// The simulation mirrors combat.ts's Mirror Image hook:
//   1. If target has _mirrorImageDuplicates > 0, roll d20 for retargeting.
//   2. Threshold by duplicate count: 3→6, 2→8, 1→11.
//   3. If retargeted: roll attack vs duplicate AC (10 + target.DEX mod).
//      On hit: decrement counter. On miss: no effect.
//   4. Either way: the real caster takes no damage.

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Simulate one attack against a Mirror-Imaged target.
 * Returns { retargeted, duplicateHit, duplicatesRemaining }.
 *
 * @param target           The Mirror-Imaged target
 * @param retargetRoll     The forced d20 retargeting roll (for determinism)
 * @param attackRollTotal  The attacker's attack roll total (for the duplicate AC check)
 */
function simulateMirrorImageAttack(
  target: Combatant,
  retargetRoll: number,
  attackRollTotal: number,
): { retargeted: boolean; duplicateHit: boolean; duplicatesRemaining: number } {
  const duplicates = target._mirrorImageDuplicates ?? 0;
  if (duplicates <= 0) {
    return { retargeted: false, duplicateHit: false, duplicatesRemaining: 0 };
  }

  const thresholds = [0, 11, 8, 6];
  const threshold = thresholds[duplicates] ?? 11;
  const retargeted = retargetRoll >= threshold;

  if (!retargeted) {
    // Attack proceeds against the real target (no duplicate interaction)
    return { retargeted: false, duplicateHit: false, duplicatesRemaining: duplicates };
  }

  // Retargeted to a duplicate. Duplicate AC = 10 + target's DEX mod.
  const duplicateAC = 10 + abilityMod(target.dex);
  const duplicateHit = attackRollTotal >= duplicateAC;

  if (duplicateHit) {
    const newCount = duplicates - 1;
    target._mirrorImageDuplicates = newCount;
    return { retargeted: true, duplicateHit: true, duplicatesRemaining: newCount };
  }

  // Missed the duplicate — no effect on duplicates or caster
  return { retargeted: true, duplicateHit: false, duplicatesRemaining: duplicates };
}

{
  // 5a. No duplicates (0) → never retargets
  const target = makeWizard();
  target._mirrorImageDuplicates = 0;
  const result = simulateMirrorImageAttack(target, 20, 30);  // would retarget if duplicates
  assert('0 duplicates: never retargets', result.retargeted === false);
}

{
  // 5b. 3 duplicates, retarget roll 6 (≥6) → retargets; attack hits duplicate → destroyed
  const target = makeWizard();  // DEX 16 → +3 → duplicate AC = 13
  target._mirrorImageDuplicates = 3;
  const result = simulateMirrorImageAttack(target, 6, 20);  // attack total 20 ≥ 13
  assert('3 duplicates, roll 6: retargeted', result.retargeted);
  assert('Duplicate hit (attack 20 ≥ AC 13)', result.duplicateHit);
  eq('Duplicates decremented to 2', result.duplicatesRemaining, 2);
  eq('_mirrorImageDuplicates field updated to 2', target._mirrorImageDuplicates, 2);
}

{
  // 5c. 3 duplicates, retarget roll 5 (<6) → NOT retargeted
  const target = makeWizard();
  target._mirrorImageDuplicates = 3;
  const result = simulateMirrorImageAttack(target, 5, 30);
  assert('3 duplicates, roll 5: NOT retargeted', result.retargeted === false);
  eq('Duplicates unchanged at 3', result.duplicatesRemaining, 3);
}

{
  // 5d. 2 duplicates, retarget roll 8 (≥8) → retargets; attack misses → no destruction
  const target = makeWizard();  // duplicate AC = 13
  target._mirrorImageDuplicates = 2;
  const result = simulateMirrorImageAttack(target, 8, 10);  // attack 10 < 13
  assert('2 duplicates, roll 8: retargeted', result.retargeted);
  assert('Duplicate missed (attack 10 < AC 13)', result.duplicateHit === false);
  eq('Duplicates unchanged at 2 (miss)', result.duplicatesRemaining, 2);
}

{
  // 5e. 1 duplicate, retarget roll 11 (≥11) → retargets; attack hits → destroyed (count → 0)
  const target = makeWizard();
  target._mirrorImageDuplicates = 1;
  const result = simulateMirrorImageAttack(target, 11, 25);
  assert('1 duplicate, roll 11: retargeted', result.retargeted);
  assert('Duplicate hit (attack 25 ≥ AC 13)', result.duplicateHit);
  eq('Duplicates decremented to 0', result.duplicatesRemaining, 0);
  eq('_mirrorImageDuplicates field updated to 0', target._mirrorImageDuplicates, 0);
}

{
  // 5f. 1 duplicate, retarget roll 10 (<11) → NOT retargeted
  const target = makeWizard();
  target._mirrorImageDuplicates = 1;
  const result = simulateMirrorImageAttack(target, 10, 30);
  assert('1 duplicate, roll 10: NOT retargeted', result.retargeted === false);
  eq('Duplicates unchanged at 1', result.duplicatesRemaining, 1);
}

{
  // 5g. Progressive destruction: 3 → 2 → 1 → 0
  const target = makeWizard();
  target._mirrorImageDuplicates = 3;

  // Attack 1: 3 duplicates, roll 10 (≥6) → retargeted, hit → 2 remaining
  let r = simulateMirrorImageAttack(target, 10, 20);
  eq('Attack 1: 3→2 duplicates', r.duplicatesRemaining, 2);

  // Attack 2: 2 duplicates, roll 10 (≥8) → retargeted, hit → 1 remaining
  r = simulateMirrorImageAttack(target, 10, 20);
  eq('Attack 2: 2→1 duplicate', r.duplicatesRemaining, 1);

  // Attack 3: 1 duplicate, roll 15 (≥11) → retargeted, hit → 0 remaining
  r = simulateMirrorImageAttack(target, 15, 20);
  eq('Attack 3: 1→0 duplicates', r.duplicatesRemaining, 0);

  // Attack 4: 0 duplicates → never retargets
  r = simulateMirrorImageAttack(target, 20, 20);
  assert('Attack 4: 0 duplicates → not retargeted', r.retargeted === false);
  eq('Attack 4: duplicates stay at 0', r.duplicatesRemaining, 0);
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/mirror_image');
  const caster = makeWizard();
  caster._mirrorImageDuplicates = 3;
  cleanup(caster);
  // cleanup should NOT clear _mirrorImageDuplicates (Mirror Image is NOT
  // a 1-round buff — it persists until all duplicates are destroyed)
  eq('Cleanup does NOT clear _mirrorImageDuplicates', caster._mirrorImageDuplicates, 3);
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: caster casts Mirror Image, scratch field set
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  assert('shouldCast returns true', shouldCast(caster, bf) === true);
  execute(caster, state);

  eq('_mirrorImageDuplicates set to 3', caster._mirrorImageDuplicates, 3);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration NOT started', caster.concentration?.active ?? false, false);
}

{
  // 7b. After slots exhausted, shouldCast returns false
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  assert('shouldCast returns false after slots exhausted', shouldCast(caster, bf) === false);
}

{
  // 7c. Re-cast after all duplicates destroyed
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  // First cast: 3 duplicates
  execute(caster, state);
  eq('First cast: 3 duplicates', caster._mirrorImageDuplicates, 3);

  // Simulate all duplicates destroyed
  caster._mirrorImageDuplicates = 0;

  // shouldCast returns true again (re-cast allowed when duplicates = 0)
  assert('shouldCast returns true after all duplicates destroyed', shouldCast(caster, bf) === true);

  // Second cast: reset to 3 duplicates
  execute(caster, state);
  eq('Second cast: duplicates reset to 3', caster._mirrorImageDuplicates, 3);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
