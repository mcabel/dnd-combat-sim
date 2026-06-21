// ============================================================
// ray_of_enfeeblement.test.ts — Ray of Enfeeblement spell module
// PHB p.271: 2nd-level necromancy, action, range 60 ft, concentration 1 min.
// Effect: Ranged spell attack. On hit: target deals half weapon damage
//         (v1: ALL weapon attacks; canon: STR-only). NO damage on the attack.
//
// Scratch-field mechanic:
//   - On hit: target._rayOfEnfeeblementActive = true (read by resolveAttack's
//     damage branch to halve weapon damage).
//   - On hit: a damage_zone SENTINEL effect (dieCount=0) is attached with
//     sourceIsConcentration: true. When concentration breaks, the
//     _undoEffect branch for 'Ray of Enfeeblement' (in spell_effects.ts —
//     separate task) clears the scratch field. v1 does NOT enforce
//     concentration (TG-002), so the scratch field persists for the combat.
//
// Deterministic attack outcomes:
//   - Hit:  AC 5  + hitBonus +20 → min total 21 ≥ 5 (always hits, even nat 1)
//   - Miss: AC 30 + hitBonus +0  → max non-crit total 20 < 30 (nat 20 auto-crits)
// ============================================================

import { shouldCast, execute, metadata } from '../spells/ray_of_enfeeblement';
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

/** Guaranteed-hit action: AC 5 + hitBonus +20 → min roll 1+20=21 ≥ 5 */
const ROE_ACTION_HIT: Action = {
  name: 'Ray of Enfeeblement',
  isMultiattack: false,
  attackType: 'spell',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: 20,           // guaranteed hit (nat 1 → 21 ≥ AC 5)
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Ray of Enfeeblement (ranged spell attack, no damage, enfeeble on hit)',
};

/** Guaranteed-miss action: AC 30 + hitBonus +0 → max non-crit total 20 < 30 */
const ROE_ACTION_MISS: Action = { ...ROE_ACTION_HIT, hitBonus: 0 };

/** A melee weapon attack (Longsword) — used to satisfy shouldCast's weapon-attack gate */
const LONGSWORD_ACTION: Action = {
  name: 'Longsword',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: 5,
  damage: { count: 1, sides: 8, bonus: 3, average: 7 },
  damageType: 'slashing',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Longsword (melee weapon attack)',
};

/** A ranged weapon attack (Shortbow) — used to satisfy shouldCast's weapon-attack gate */
const SHORTBOW_ACTION: Action = {
  name: 'Shortbow',
  isMultiattack: false,
  attackType: 'ranged',
  reach: 0,
  range: { normal: 80, long: 320 },
  hitBonus: 5,
  damage: { count: 1, sides: 6, bonus: 3, average: 6 },
  damageType: 'piercing',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Shortbow (ranged weapon attack)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 5, speed: 30,        // low AC → guaranteed hit
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

/** Warlock at pos (0,0,0) with Ray of Enfeeblement + 2 2nd-level slots */
function makeWarlock(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('warlock1', {
    name: 'Warlock',
    pos,
    actions: [ROE_ACTION_HIT],
    resources: withSlots2(2),
  });
}

/** Enemy with low AC 5 (guaranteed hit) + a Longsword weapon attack */
function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    pos,
    actions: [LONGSWORD_ACTION],
    ...overrides,
  });
}

/** Enemy with high AC 30 (guaranteed miss) + a Longsword weapon attack */
function makeHighAcEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    ac: 30,
    pos,
    actions: [LONGSWORD_ACTION],
  });
}

/** Enemy with NO weapon attacks (only a spell attack) — should NOT be targeted */
function makeSpellOnlyEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  const spellAction: Action = {
    name: 'Fire Bolt',
    isMultiattack: false,
    attackType: 'spell',
    reach: 5,
    range: { normal: 120, long: 120 },
    hitBonus: 5,
    damage: { count: 1, sides: 10, bonus: 0, average: 5.5 },
    damageType: 'fire',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Fire Bolt (spell cantrip — NOT a weapon attack)',
  };
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    pos,
    actions: [spellAction],
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Ray of Enfeeblement', metadata.name, 'Ray of Enfeeblement');
eq('level is 2', metadata.level, 2);
eq('school is necromancy', metadata.school, 'necromancy');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('STR-only simplified flag set (v1: applies to all weapon attacks)',
  metadata.rayOfEnfeeblementStrOnlyV1Simplified, true);
eq('upcast NOT implemented (v1)', metadata.rayOfEnfeeblementUpcastV1Implemented, false);
eq('concentration enforcement NOT implemented (v1)',
  metadata.rayOfEnfeeblementConcentrationEnforcementV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster is already concentrating — cannot cast
  const caster = makeWarlock();
  caster.concentration = { active: true, spellName: 'Hex', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster is already concentrating', shouldCast(caster, bf), null);
}

{
  // 2b. Caster lacks 'Ray of Enfeeblement' action
  const caster = makeWarlock();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Ray of Enfeeblement action', shouldCast(caster, bf), null);
}

{
  // 2c. No 2nd-level slots remaining
  const caster = makeWarlock();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 2nd-level slots', shouldCast(caster, bf), null);
}

{
  // 2d. No enemies in range
  const caster = makeWarlock();
  const farEnemy = makeEnemy('far', { x: 20, y: 0, z: 0 });  // 100 ft > 60 ft
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies in range (60 ft)', shouldCast(caster, bf), null);
}

{
  // 2e. Enemy has NO weapon attacks — gate fails
  const caster = makeWarlock();
  const spellOnly = makeSpellOnlyEnemy('spellonly');
  const bf = makeBF([caster, spellOnly]);
  eq('Returns null when enemy has NO weapon attacks', shouldCast(caster, bf), null);
}

{
  // 2f. Enemy already enfeebled by this caster — skip
  const caster = makeWarlock();
  const enemy = makeEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_roe1', casterId: caster.id, spellName: 'Ray of Enfeeblement',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 0, damageType: 'necrotic' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when enemy already enfeebled by this caster', shouldCast(caster, bf), null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Highest-threat (maxHP) enemy selected first
  const caster = makeWarlock();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 120) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 3b. Tie-break: closest enemy first
  const caster = makeWarlock();
  const far = makeEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const near = makeEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

{
  // 3c. Enemy with a ranged weapon attack (Shortbow) is also a valid target
  const caster = makeWarlock();
  const archer = makeCombatant('archer', {
    name: 'Archer',
    faction: 'enemy',
    pos: { x: 1, y: 0, z: 0 },
    actions: [SHORTBOW_ACTION],
  });
  const bf = makeBF([caster, archer]);
  eq('Enemy with ranged weapon attack is targeted', shouldCast(caster, bf)?.id, 'archer');
}

// ============================================================
// 4. execute — on hit (scratch field set + sentinel attached)
// ============================================================

console.log('\n=== 4. execute — on hit ===\n');

{
  // 4a. Scratch field set on hit
  const caster = makeWarlock();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  eq('Scratch field undefined before cast', enemy._rayOfEnfeeblementActive, undefined);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  eq('Scratch field set to true on hit', enemy._rayOfEnfeeblementActive, true);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Ray of Enfeeblement', caster.concentration?.spellName, 'Ray of Enfeeblement');
}

{
  // 4b. Sentinel damage_zone effect attached (dieCount=0)
  const caster = makeWarlock();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const sentinels = enemy.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Ray of Enfeeblement',
  );
  eq('1 sentinel damage_zone effect attached', sentinels.length, 1);
  if (sentinels.length === 1) {
    eq('Sentinel dieCount is 0 (no damage tick)', sentinels[0].payload.dieCount, 0);
    eq('Sentinel dieSides is 0', sentinels[0].payload.dieSides, 0);
    eq('Sentinel damageType is necrotic', sentinels[0].payload.damageType, 'necrotic');
    eq('Sentinel sourceIsConcentration is true', sentinels[0].sourceIsConcentration, true);
    eq('Sentinel casterId is the warlock', sentinels[0].casterId, 'warlock1');
  }
}

{
  // 4c. NO damage on hit (Ray of Enfeeblement does no damage — only applies debuff)
  const caster = makeWarlock();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  eq('Enemy HP unchanged on hit (no damage)', enemy.currentHP, 100);
}

{
  // 4d. Dead target skipped (stale edge case)
  const caster = makeWarlock();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0, maxHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Slot consumed even for dead target', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Scratch field NOT set on dead target', enemy._rayOfEnfeeblementActive, undefined);
  eq('No sentinel effect on dead target',
    enemy.activeEffects.filter(e => e.spellName === 'Ray of Enfeeblement').length, 0);
}

// ============================================================
// 5. execute — on miss (no scratch field, no sentinel)
// ============================================================

console.log('\n=== 5. execute — on miss ===\n');

{
  // 5a. On miss: scratch field NOT set, sentinel NOT attached
  const caster = makeWarlock();
  caster.actions = [ROE_ACTION_MISS];
  const enemy = makeHighAcEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  // Note: nat 20 auto-crits — small chance of "hit" despite high AC.
  // If a crit-hit happened, scratch field would be true and 1 sentinel attached.
  // For deterministic test: accept either outcome (miss OR crit-hit).
  if (enemy._rayOfEnfeeblementActive === true) {
    // Crit-hit path — verify sentinel also attached
    const sentinels = enemy.activeEffects.filter(
      e => e.effectType === 'damage_zone' && e.spellName === 'Ray of Enfeeblement',
    );
    eq('Crit-hit: scratch field set + 1 sentinel', sentinels.length, 1);
  } else {
    // Miss path — verify scratch field NOT set and no sentinel
    eq('Miss path: scratch field NOT set', enemy._rayOfEnfeeblementActive, undefined);
    eq('Miss path: no sentinel attached',
      enemy.activeEffects.filter(e => e.spellName === 'Ray of Enfeeblement').length, 0);
  }
  eq('Slot still consumed on miss', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Enemy HP unchanged (no damage)', enemy.currentHP, 100);
}

// ============================================================
// 6. execute — logging
// ============================================================

console.log('\n=== 6. execute — logging ===\n');

{
  const caster = makeWarlock();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const hitEvents = events.filter(e => e.type === 'attack_hit' || e.type === 'attack_crit');
  const condEvents = events.filter(e => e.type === 'condition_add');
  const damageEvents = events.filter(e => e.type === 'damage');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Ray of Enfeeblement"',
    actionEvents[0].description.includes('Ray of Enfeeblement'));
  eq('1 attack_hit/attack_crit event', hitEvents.length, 1);
  eq('1 condition_add event (enfeebled)', condEvents.length, 1);
  eq('0 damage events (no damage on Ray of Enfeeblement)', damageEvents.length, 0);
}

{
  // 6b. On miss: attack_miss event, NO condition_add, NO damage
  // (accept crit-hit fallback as above)
  const caster = makeWarlock();
  caster.actions = [ROE_ACTION_MISS];
  const enemy = makeHighAcEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  const events = state.log.events as any[];
  const missEvents = events.filter(e => e.type === 'attack_miss');
  const critEvents = events.filter(e => e.type === 'attack_crit');
  const condEvents = events.filter(e => e.type === 'condition_add');
  const damageEvents = events.filter(e => e.type === 'damage');

  if (missEvents.length === 1) {
    // Miss path
    eq('Miss path: 1 attack_miss event', missEvents.length, 1);
    eq('Miss path: 0 condition_add events', condEvents.length, 0);
  } else {
    // Crit-hit fallback path
    eq('Crit-hit fallback: 1 attack_crit event', critEvents.length, 1);
    eq('Crit-hit fallback: 1 condition_add event', condEvents.length, 1);
  }
  eq('0 damage events (always — no damage on this spell)', damageEvents.length, 0);
}

// ============================================================
// 7. cleanup — no-op
// ============================================================

console.log('\n=== 7. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/ray_of_enfeeblement');
  const caster = makeWarlock();
  caster.concentration = { active: true, spellName: 'Ray of Enfeeblement', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Ray of Enfeeblement');
}

// ============================================================
// 8. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 8. Integration pipeline ===\n');

{
  // 8a. Full pipeline: caster hits highest-threat enemy
  const caster = makeWarlock();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 120)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  eq('Strong enemy enfeebled (scratch field set)', strong._rayOfEnfeeblementActive, true);
  eq('Weak enemy NOT enfeebled (scratch field undefined)', weak._rayOfEnfeeblementActive, undefined);
  eq('Strong enemy has 1 sentinel effect',
    strong.activeEffects.filter(e => e.spellName === 'Ray of Enfeeblement').length, 1);
  eq('Weak enemy has 0 sentinel effects',
    weak.activeEffects.filter(e => e.spellName === 'Ray of Enfeeblement').length, 0);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Ray of Enfeeblement', caster.concentration?.spellName, 'Ray of Enfeeblement');
}

{
  // 8b. After slots exhausted, shouldCast returns null
  const caster = makeWarlock();
  caster.resources = withSlots2(1);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  eq('shouldCast returns null after slots exhausted / concentration active', t2, null);
}

{
  // 8c. Existing concentration broken (safety net)
  const caster = makeWarlock();
  caster.concentration = { active: true, spellName: 'Hex', dcIfHit: 10 };
  // Pre-existing Hex effect on enemy (simulated)
  const enemy = makeEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_hex', casterId: caster.id, spellName: 'Hex',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 6, damageType: 'necrotic' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration switched to Ray of Enfeeblement', caster.concentration?.spellName, 'Ray of Enfeeblement');
  assert('Prior Hex effect removed from enemy',
    !enemy.activeEffects.some(e => e.spellName === 'Hex'));
  eq('Scratch field set', enemy._rayOfEnfeeblementActive, true);
  eq('Sentinel effect attached',
    enemy.activeEffects.filter(e => e.spellName === 'Ray of Enfeeblement').length, 1);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
