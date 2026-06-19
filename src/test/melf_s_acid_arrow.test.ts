// ============================================================
// melf_s_acid_arrow.test.ts — Melf's Acid Arrow spell module
// PHB p.259: 2nd-level evocation, action, 90 ft, NO concentration.
// Effect: ranged spell attack — on hit, 4d4 acid immediately + 2d4 acid
//         at the start of the target's next turn (modelled as a
//         damage_zone effect with ticksRemaining: 1, sourceIsConcentration
//         false — the spell is instantaneous).
//
// Tests cover shouldCast() preconditions + target priority, execute()
// attack hit/miss resolution + immediate damage + delayed damage_zone
// effect + slot consumption + logging, rollImmediateDamage /
// rollDelayedDamage dice helpers, integration pipeline, and metadata
// shape.
//
// Deterministic attack outcomes:
//   - Hit:  AC 5  + hitBonus +20 → min total 21 ≥ 5 (always hits, even nat 1)
//   - Miss: AC 30 + hitBonus +0  → max non-crit total 20 < 30 (nat 20 auto-crits)
// ============================================================

import { shouldCast, execute, metadata, rollImmediateDamage, rollDelayedDamage } from '../spells/melf_s_acid_arrow';
import { getActiveDamageZones } from '../engine/spell_effects';
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

/** Guaranteed-hit action: AC 5 + hitBonus +20 → min roll 1+20=21 ≥ 5 */
const ACID_ACTION_HIT: Action = {
  name: "Melf's Acid Arrow",
  isMultiattack: false,
  attackType: 'spell',
  reach: 5,
  range: { normal: 90, long: 90 },
  hitBonus: 20,           // guaranteed hit (nat 1 → 21 ≥ AC 5)
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
  description: "Melf's Acid Arrow (ranged spell attack, 4d4 acid + 2d4 acid next turn)",
};

/** Guaranteed-miss action: AC 30 + hitBonus +0 → max non-crit total 20 < 30 */
const ACID_ACTION_MISS: Action = { ...ACID_ACTION_HIT, hitBonus: 0 };

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 5, speed: 30,       // low AC → guaranteed hit
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10,
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
    width: 30, height: 30, depth: 1,
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

/** Wizard at pos (0,0,0) with Melf's Acid Arrow + 2 2nd-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [ACID_ACTION_HIT],
    resources: withSlots2(2),
  });
}

/** Enemy with low AC 5 (guaranteed hit vs hitBonus +20) */
function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', pos, ...overrides });
}

/** Enemy with high AC 30 (guaranteed miss vs hitBonus +0) */
function makeHighAcEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', ac: 30, pos });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is "Melf\'s Acid Arrow"', metadata.name, "Melf's Acid Arrow");
eq('level is 2', metadata.level, 2);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 90 ft', metadata.rangeFt, 90);
eq('immediate dice count is 4', metadata.immediateDiceCount, 4);
eq('immediate die sides is 4', metadata.immediateDieSides, 4);
eq('delayed dice count is 2', metadata.delayedDiceCount, 2);
eq('delayed die sides is 4', metadata.delayedDieSides, 4);
eq('damage type is acid', metadata.damageType, 'acid');
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
eq('end-of-turn v1 simplified flag set', metadata.melfsAcidArrowEndOfTurnV1Simplified, true);
eq('upcast NOT implemented (v1)', metadata.melfsAcidArrowUpcastV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates + priority
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates + priority ===\n');

{
  // 2a. Caster lacks 'Melf's Acid Arrow' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Melf\'s Acid Arrow action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. Already concentrating — NOT a gate (Melf's Acid Arrow is not concentration)
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns target even when caster is already concentrating (NOT concentration spell)',
    shouldCast(caster, bf)?.id === 'e1');
}

{
  // 2d. No enemies in range
  const caster = makeWizard();
  const farEnemy = makeEnemy('far', { x: 20, y: 0, z: 0 });  // 100 ft > 90 ft
  const bf = makeBF([caster, farEnemy]);
  assert('Returns null when no enemies in range (90 ft)', shouldCast(caster, bf) === null);
}

{
  // 2e. Highest-threat (maxHP) enemy selected first
  const caster = makeWizard();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 120) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 2f. Tie-break: closest enemy first
  const caster = makeWizard();
  const far = makeEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const near = makeEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

// ============================================================
// 3. execute — on hit (immediate 4d4 acid + delayed damage_zone)
// ============================================================

console.log('\n=== 3. execute — on hit ===\n');

{
  // 3a. Immediate 4d4 acid damage applied on hit
  const caster = makeWizard();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const hpLost = 100 - enemy.currentHP;
  assert('Immediate damage in [4, 16] (4d4)', hpLost >= 4 && hpLost <= 16, `got ${hpLost}`);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 3b. damage_zone effect attached on hit (for delayed 2d4 acid)
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const zones = getActiveDamageZones(enemy);
  eq('1 damage_zone effect attached', zones.length, 1);
  if (zones.length === 1) {
    eq('damage_zone dieCount is 2', zones[0].payload.dieCount, 2);
    eq('damage_zone dieSides is 4', zones[0].payload.dieSides, 4);
    eq('damage_zone damageType is acid', zones[0].payload.damageType, 'acid');
    eq('damage_zone ticksRemaining is 1', zones[0].payload.ticksRemaining, 1);
    eq('damage_zone sourceIsConcentration is false (NOT concentration)', zones[0].sourceIsConcentration, false);
    eq('damage_zone spellName is Melf\'s Acid Arrow', zones[0].spellName, "Melf's Acid Arrow");
  }
}

{
  // 3c. No concentration started on caster (instantaneous spell)
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration NOT started', caster.concentration, null);
}

// ============================================================
// 4. execute — on miss (no damage, no effect)
// ============================================================

console.log('\n=== 4. execute — on miss ===\n');

{
  // 4a. On miss: no immediate damage, no damage_zone effect
  const caster = makeWizard();
  caster.actions = [ACID_ACTION_MISS];       // hitBonus 0
  const enemy = makeHighAcEnemy('e1');        // AC 30
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('No immediate damage on miss', enemy.currentHP, 100);
  eq('No damage_zone effect on miss', getActiveDamageZones(enemy).length, 0);
  eq('Slot still consumed on miss', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4b. Dead target skipped (stale plan) — no damage, no effect
  const caster = makeWizard();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0, maxHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('No damage on dead target', enemy.currentHP, 0);
  eq('No damage_zone effect on dead target', getActiveDamageZones(enemy).length, 0);
  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
}

// ============================================================
// 5. rollImmediateDamage + rollDelayedDamage helpers
// ============================================================

console.log('\n=== 5. rollImmediateDamage + rollDelayedDamage helpers ===\n');

{
  // 5a. rollImmediateDamage in [4, 16] (4d4)
  for (let i = 0; i < 50; i++) {
    const dmg = rollImmediateDamage();
    assert(`rollImmediateDamage() in [4, 16] (iteration ${i})`, dmg >= 4 && dmg <= 16, `got ${dmg}`);
  }
}

{
  // 5b. rollDelayedDamage in [2, 8] (2d4)
  for (let i = 0; i < 50; i++) {
    const dmg = rollDelayedDamage();
    assert(`rollDelayedDamage() in [2, 8] (iteration ${i})`, dmg >= 2 && dmg <= 8, `got ${dmg}`);
  }
}

// ============================================================
// 6. execute — logging
// ============================================================

console.log('\n=== 6. execute — logging ===\n');

{
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const hitEvents = events.filter(e => e.type === 'attack_hit' || e.type === 'attack_crit');
  const damageEvents = events.filter(e => e.type === 'damage');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Attack hit event emitted', hitEvents.length === 1);
  assert('Damage event emitted (immediate 4d4)', damageEvents.length === 1);
  assert('Condition_add event emitted (delayed acid splash)', condEvents.length === 1);
  assert('First action event mentions "Melf\'s Acid Arrow"', actionEvents[0].description.includes("Melf's Acid Arrow"));
  assert('Damage event description mentions acid', damageEvents[0].description.includes('acid'));
}

{
  // 6b. On miss: attack_miss event, no damage event, no condition_add event
  const caster = makeWizard();
  caster.actions = [ACID_ACTION_MISS];
  const enemy = makeHighAcEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  const events = state.log.events as any[];
  const missEvents = events.filter(e => e.type === 'attack_miss');
  const damageEvents = events.filter(e => e.type === 'damage');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('Attack miss event emitted', missEvents.length === 1);
  assert('No damage event on miss', damageEvents.length === 0);
  assert('No condition_add event on miss', condEvents.length === 0);
}

// ============================================================
// 7. cleanup — no-op
// ============================================================

console.log('\n=== 7. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/melf_s_acid_arrow');
  const caster = makeWizard();
  const prePos = { ...caster.pos };
  const preSlots = caster.resources!.spellSlots![2]!.remaining;
  cleanup(caster);
  eq('Cleanup does NOT change caster pos', caster.pos.x, prePos.x);
  eq('Cleanup does NOT consume slots', caster.resources!.spellSlots![2]!.remaining, preSlots);
  eq('Cleanup does NOT start concentration', caster.concentration, null);
}

// ============================================================
// 8. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 8. Integration pipeline ===\n');

{
  // 8a. Full pipeline: caster hits highest-threat enemy
  const caster = makeWizard();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 120)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  const hpLost = 120 - strong.currentHP;
  assert('Strong enemy took immediate damage [4, 16]', hpLost >= 4 && hpLost <= 16);
  eq('Weak enemy NOT damaged', weak.currentHP, 30);
  eq('Strong enemy has 1 damage_zone effect', getActiveDamageZones(strong).length, 1);
  eq('Weak enemy has 0 damage_zone effects', getActiveDamageZones(weak).length, 0);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 8b. After slots exhausted, shouldCast returns null
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

{
  // 8c. Can be cast while already concentrating (NOT a concentration spell)
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast returns target even when caster is concentrating', target?.id === 'e1');
  if (target) execute(caster, target, state);

  // Hold Person concentration should remain unchanged
  eq('Existing concentration preserved (NOT replaced)', caster.concentration?.spellName, 'Hold Person');
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Damage_zone effect attached to enemy', getActiveDamageZones(enemy).length, 1);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
