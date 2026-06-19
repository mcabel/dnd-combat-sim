// ============================================================
// spike_growth.test.ts — Spike Growth spell module
// PHB p.277: 2nd-level transmutation, action, range 150 ft, concentration 10 min.
// Effect: 2d4 piercing/turn (no save, automatic) at the start of each of
//         the target's turns (v1 simplification — canon: per-5-ft moved).
//         NO on-cast damage.
//
// v1 simplifications (documented via metadata flags):
//   - Difficult terrain NOT modelled.
//   - Per-5-ft movement damage NOT modelled (start-of-turn tick instead).
//   - Camouflage Perception check NOT modelled.
//   - NO on-cast damage (mirrors Cordon of Arrows v1 timing).
//   - No save (damage is automatic).
//   - Concentration NOT enforced (TG-002).
//
// Tests cover shouldCast() gates + target priority, execute() damage_zone
// application (no saveDC), rollDamage range check, slot consumption,
// logging, cleanup no-op, integration pipeline, and metadata.
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/spike_growth';
import { getActiveDamageZones } from '../engine/spell_effects';
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

const SPIKE_GROWTH_ACTION: Action = {
  name: 'Spike Growth',
  isMultiattack: false,
  attackType: 'special',
  reach: 5,
  range: { normal: 150, long: 150 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,           // Spike Growth has NO save (PHB p.277)
  saveAbility: null,
  isAoE: true,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Spike Growth (2d4 piercing/turn, no save, persistent, concentration 10 min)',
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
    width: 40, height: 40, depth: 1,
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

/** Druid at pos (0,0,0) with Spike Growth + 2 2nd-level slots */
function makeDruid(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('druid1', {
    name: 'Druid',
    pos,
    actions: [SPIKE_GROWTH_ACTION],
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
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Spike Growth', metadata.name, 'Spike Growth');
eq('level is 2', metadata.level, 2);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 150 ft', metadata.rangeFt, 150);
eq('AoE radius is 20 ft', metadata.aoeRadiusFt, 20);
eq('die count is 2', metadata.dieCount, 2);
eq('die sides is 4', metadata.dieSides, 4);
eq('damage type is piercing', metadata.damageType, 'piercing');
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('difficult terrain NOT implemented (v1)', metadata.spikeGrowthDifficultTerrainV1Implemented, false);
eq('movement trigger NOT implemented (v1)', metadata.spikeGrowthMovementTriggerV1Implemented, false);
eq('upcast NOT implemented (v1)', metadata.spikeGrowthUpcastV1Implemented, false);
eq('concentration enforcement NOT implemented (v1)', metadata.spikeGrowthConcentrationEnforcementV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster is already concentrating — cannot cast
  const caster = makeDruid();
  caster.concentration = { active: true, spellName: 'Moonbeam', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster is already concentrating', shouldCast(caster, bf), null);
}

{
  // 2b. Caster lacks 'Spike Growth' action
  const caster = makeDruid();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Spike Growth action', shouldCast(caster, bf), null);
}

{
  // 2c. No 2nd-level slots remaining
  const caster = makeDruid();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 2nd-level slots', shouldCast(caster, bf), null);
}

{
  // 2d. No enemies in range (150 ft)
  const caster = makeDruid();
  const farEnemy = makeEnemy('far', { x: 31, y: 0, z: 0 });  // 155 ft > 150 ft
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies in range (150 ft)', shouldCast(caster, bf), null);
}

{
  // 2e. Enemy already in Spike Growth zone from this caster — skip
  const caster = makeDruid();
  const enemy = makeEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_sg1', casterId: caster.id, spellName: 'Spike Growth',
    effectType: 'damage_zone',
    payload: { dieCount: 2, dieSides: 4, damageType: 'piercing' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when enemy already in Spike Growth zone', shouldCast(caster, bf), null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Highest-threat (maxHP) enemy selected first
  const caster = makeDruid();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 120) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 3b. Tie-break: closest enemy first
  const caster = makeDruid();
  const far = makeEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const near = makeEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

{
  // 3c. Enemy at 150 ft is within range
  const caster = makeDruid();
  const atMaxRange = makeEnemy('atMax', { x: 30, y: 0, z: 0 }, { maxHP: 60, currentHP: 60 });  // 150 ft
  const bf = makeBF([caster, atMaxRange]);
  eq('Enemy at 150 ft is within range', shouldCast(caster, bf)?.id, 'atMax');
}

// ============================================================
// 4. execute — damage_zone application (NO on-cast damage)
// ============================================================

console.log('\n=== 4. execute — damage_zone application (NO on-cast damage) ===\n');

{
  // 4a. damage_zone effect attached with no saveDC (no save per PHB p.277)
  const caster = makeDruid();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const zones = getActiveDamageZones(enemy);
  eq('1 damage_zone effect applied', zones.length, 1);
  if (zones.length === 1) {
    const z = zones[0];
    eq('damage_zone dieCount is 2', z.payload.dieCount, 2);
    eq('damage_zone dieSides is 4', z.payload.dieSides, 4);
    eq('damage_zone damageType is piercing', z.payload.damageType, 'piercing');
    eq('damage_zone has NO saveDC (no save)', z.payload.saveDC, undefined);
    eq('damage_zone has NO saveAbility (no save)', z.payload.saveAbility, undefined);
    eq('damage_zone sourceIsConcentration is true', z.sourceIsConcentration, true);
    eq('damage_zone spellName is Spike Growth', z.spellName, 'Spike Growth');
    eq('damage_zone casterId is the druid', z.casterId, 'druid1');
  }
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Spike Growth', caster.concentration?.spellName, 'Spike Growth');
}

{
  // 4b. NO on-cast damage (damage starts ticking at start of target's NEXT turn)
  const caster = makeDruid();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('No on-cast damage',
    !state.log.events.some((e: any) => e.type === 'damage'));
  eq('Enemy HP unchanged on cast (no on-cast damage)', enemy.currentHP, 100);
}

{
  // 4c. Concentration started (Spike Growth IS concentration)
  const caster = makeDruid();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  eq('Concentration started', caster.concentration?.active, true);
  eq('Concentration spellName is Spike Growth', caster.concentration?.spellName, 'Spike Growth');
}

{
  // 4d. Dead target skipped (stale edge case) — slot consumed, no effect
  const caster = makeDruid();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('No damage_zone on dead target', getActiveDamageZones(enemy).length, 0);
}

// ============================================================
// 5. rollDamage range check (2d4 → 2..8)
// ============================================================

console.log('\n=== 5. rollDamage range check ===\n');

{
  for (let i = 0; i < 50; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [2, 8] (iteration ${i})`, dmg >= 2 && dmg <= 8, `got ${dmg}`);
  }
}

// ============================================================
// 6. execute — logging
// ============================================================

console.log('\n=== 6. execute — logging ===\n');

{
  const caster = makeDruid();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');
  const damageEvents = events.filter(e => e.type === 'damage');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Spike Growth"',
    actionEvents[0].description.includes('Spike Growth'));
  eq('1 condition_add event (damage_zone applied)', condEvents.length, 1);
  eq('0 damage events (NO on-cast damage)', damageEvents.length, 0);
}

// ============================================================
// 7. cleanup — no-op
// ============================================================

console.log('\n=== 7. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/spike_growth');
  const caster = makeDruid();
  caster.concentration = { active: true, spellName: 'Spike Growth', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Spike Growth');
}

// ============================================================
// 8. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 8. Integration pipeline ===\n');

{
  // 8a. Full pipeline: caster targets highest-threat enemy
  const caster = makeDruid();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 120)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  const strongZones = getActiveDamageZones(strong);
  eq('Strong enemy has 1 damage_zone effect', strongZones.length, 1);
  eq('Weak enemy has 0 damage_zone effects', getActiveDamageZones(weak).length, 0);
  eq('Strong enemy HP unchanged (no on-cast damage)', strong.currentHP, 120);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Spike Growth', caster.concentration?.spellName, 'Spike Growth');
}

{
  // 8b. After slots exhausted, shouldCast returns null
  const caster = makeDruid();
  caster.resources = withSlots2(1);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  // Caster is now concentrating → second shouldCast also returns null
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  eq('shouldCast returns null after slots exhausted / concentration active', t2, null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
