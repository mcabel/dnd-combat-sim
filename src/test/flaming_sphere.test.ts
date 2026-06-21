// ============================================================
// flaming_sphere.test.ts — Flaming Sphere spell module
// PHB p.242: 2nd-level conjuration, action, range 60 ft, concentration 1 min.
// Effect: 2d6 fire on cast (DEX save for half) + persistent damage_zone
//         effect that ticks 2d6 fire at the start of each of the target's
//         turns (DEX save for half).
//
// Tests cover shouldCast() gates + target priority, execute() save
// resolution (full damage on fail, half on success) + damage_zone effect
// with saveDC/saveAbility + slot consumption + logging, rollDamage range
// check, cleanup no-op, integration pipeline, and metadata shape.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - DEX 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - DEX 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/flaming_sphere';
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

const FLAMING_SPHERE_ACTION: Action = {
  name: 'Flaming Sphere',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC for tests (DEX 1 → max 15 < 25)
  saveAbility: 'dex',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Flaming Sphere (DEX save for half, 2d6 fire, concentration 1 min)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
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

/** Wizard at pos (0,0,0) with Flaming Sphere + 2 2nd-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [FLAMING_SPHERE_ACTION],
    resources: withSlots2(2),
  });
}

/** Enemy with DEX 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    dex: 1,            // guaranteed fail vs DC 25 (mod -5, max roll 15 < 25)
    pos,
    ...overrides,
  });
}

/** Enemy with DEX 30 (guaranteed success vs DC 5) — used with a low-DC action */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    dex: 30,           // guaranteed success vs DC 5 (mod +10, min roll 11 ≥ 5)
    pos,
    ...overrides,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Flaming Sphere', metadata.name, 'Flaming Sphere');
eq('level is 2', metadata.level, 2);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('die count is 2', metadata.dieCount, 2);
eq('die sides is 6', metadata.dieSides, 6);
eq('damage type is fire', metadata.damageType, 'fire');
eq('is concentration', metadata.concentration, true);
eq('save ability is dex', metadata.saveAbility, 'dex');
eq('casting time is action', metadata.castingTime, 'action');
eq('sphere movement NOT implemented (v1)', metadata.flamingSphereMovementV1Implemented, false);
eq('multi-target NOT implemented (v1)', metadata.flamingSphereMultiTargetV1Implemented, false);
eq('upcast NOT implemented (v1)', metadata.flamingSphereUpcastV1Implemented, false);
eq('concentration enforcement NOT implemented (v1)', metadata.flamingSphereConcentrationEnforcementV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates + target priority
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates + target priority ===\n');

{
  // 2a. Caster lacks 'Flaming Sphere' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Flaming Sphere action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. Caster is already concentrating
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d. No enemies in range (60 ft)
  const caster = makeWizard();
  const farEnemy = makeWeakEnemy('far', { x: 20, y: 0, z: 0 });  // 100 ft
  const bf = makeBF([caster, farEnemy]);
  assert('Returns null when no enemies in range (60 ft)', shouldCast(caster, bf) === null);
}

{
  // 2e. Enemy already in Flaming Sphere zone from this caster — skip
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_fs1', casterId: caster.id, spellName: 'Flaming Sphere',
    effectType: 'damage_zone',
    payload: { dieCount: 2, dieSides: 6, damageType: 'fire', saveDC: 25, saveAbility: 'dex' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already in Flaming Sphere zone', shouldCast(caster, bf) === null);
}

{
  // 2f. Highest-threat (maxHP) enemy selected first
  const caster = makeWizard();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 120) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 2g. Tie-break: closest enemy first
  const caster = makeWizard();
  const far = makeWeakEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const near = makeWeakEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

// ============================================================
// 3. execute — save resolution
// ============================================================

console.log('\n=== 3. execute — save resolution ===\n');

{
  // 3a. Guaranteed fail (DEX 1 vs DC 25) → full 2d6 fire damage
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const hpLost = 100 - enemy.currentHP;
  assert('Failed save → full damage in [2, 12] (2d6)', hpLost >= 2 && hpLost <= 12, `got ${hpLost}`);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Flaming Sphere', caster.concentration?.spellName, 'Flaming Sphere');
}

{
  // 3b. Guaranteed success (DEX 30 vs DC 5) → half damage (floor(2d6/2) = 1..6)
  const caster = makeWizard();
  caster.actions = [{ ...FLAMING_SPHERE_ACTION, saveDC: 5 }];
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const hpLost = 100 - enemy.currentHP;
  assert('Successful save → half damage in [1, 6]', hpLost >= 1 && hpLost <= 6, `got ${hpLost}`);
  eq('Slot still consumed on save success', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 3c. Dead target skipped (stale edge case — no damage, slot still consumed)
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0, maxHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('No damage_zone effect on dead target', getActiveDamageZones(enemy).length, 0);
}

// ============================================================
// 4. damage_zone effect attached with saveDC + saveAbility
// ============================================================

console.log('\n=== 4. damage_zone effect attached with saveDC + saveAbility ===\n');

{
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const zones = getActiveDamageZones(enemy);
  eq('1 damage_zone effect applied', zones.length, 1);
  if (zones.length === 1) {
    const z = zones[0];
    eq('damage_zone dieCount is 2', z.payload.dieCount, 2);
    eq('damage_zone dieSides is 6', z.payload.dieSides, 6);
    eq('damage_zone damageType is fire', z.payload.damageType, 'fire');
    eq('damage_zone saveDC is set (25)', z.payload.saveDC, 25);
    eq('damage_zone saveAbility is dex', z.payload.saveAbility, 'dex');
    eq('damage_zone sourceIsConcentration is true', z.sourceIsConcentration, true);
    eq('damage_zone spellName is Flaming Sphere', z.spellName, 'Flaming Sphere');
  }
}

// ============================================================
// 5. rollDamage range check (2d6 → 2..12)
// ============================================================

console.log('\n=== 5. rollDamage range check ===\n');

{
  for (let i = 0; i < 50; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [2, 12] (iteration ${i})`, dmg >= 2 && dmg <= 12, `got ${dmg}`);
  }
}

// ============================================================
// 6. execute — logging
// ============================================================

console.log('\n=== 6. execute — logging ===\n');

{
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const saveEvents = events.filter(e => e.type === 'save_success' || e.type === 'save_fail');
  const damageEvents = events.filter(e => e.type === 'damage');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Save event emitted', saveEvents.length === 1);
  assert('Save event is save_fail (guaranteed fail)', saveEvents[0]?.type === 'save_fail');
  assert('Damage event emitted', damageEvents.length === 1);
  assert('Condition_add event emitted (damage_zone applied)', condEvents.length === 1);
  assert('Action event mentions "Flaming Sphere"', actionEvents[0].description.includes('Flaming Sphere'));
  assert('Save event mentions DEX save', saveEvents[0].description.includes('DEX'));
  assert('Damage event mentions "Flaming Sphere"', damageEvents[0].description.includes('Flaming Sphere'));
}

// ============================================================
// 7. cleanup — no-op
// ============================================================

console.log('\n=== 7. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/flaming_sphere');
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Flaming Sphere', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Flaming Sphere');
}

// ============================================================
// 8. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 8. Integration pipeline ===\n');

{
  // 8a. Full pipeline: caster hits highest-threat enemy
  const caster = makeWizard();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 120)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  // Strong enemy took damage
  const hpLostStrong = 120 - strong.currentHP;
  assert('Strong enemy took damage in [2, 12]', hpLostStrong >= 2 && hpLostStrong <= 12);
  // Weak enemy NOT damaged
  eq('Weak enemy NOT damaged', weak.currentHP, 30);
  // Strong enemy has damage_zone effect
  const zones = getActiveDamageZones(strong);
  eq('Strong enemy has 1 damage_zone effect', zones.length, 1);
  // Weak enemy has NO damage_zone effect
  eq('Weak enemy has 0 damage_zone effects', getActiveDamageZones(weak).length, 0);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 8b. After slots exhausted, shouldCast returns null
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  assert('shouldCast returns null after slots exhausted (and concentration active)', t2 === null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
