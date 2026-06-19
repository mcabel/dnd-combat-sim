// ============================================================
// silence.test.ts — Silence spell module
// PHB p.275: 2nd-level illusion, action, range 120 ft,
// concentration (10 min). Components: V, S.
//
// Effect: 20-ft-radius sphere blocks all sound — verbal spells
//         can't be cast. v1 has no spell-block subsystem — this spell
//         sets a forward-compat flag `_silenceZoneActive` on the target.
//
// v1 simplifications (documented via metadata flags):
//   - Verbal spell block NOT modelled (forward-compat flag only).
//   - AoE / multi-target NOT modelled (single-target simplification).
//   - Thunder immunity NOT modelled.
//   - Perception-hearing disadvantage NOT modelled.
//   - Concentration NOT enforced (TG-002).
//
// Tests cover shouldCast() preconditions + target priority, execute()
// forward-compat flag application + sentinel effect attachment, slot
// consumption, concentration start, logging, cleanup no-op, integration
// pipeline, and metadata shape.
//
// Note: Silence has no save — the zone is placed on a point (canon) / on
// a target enemy (v1 simplification). No save outcomes to test.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/silence';
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

const SILENCE_ACTION: Action = {
  name: 'Silence',
  isMultiattack: false,
  attackType: 'special',    // AoE-zone spell — no attack roll, no save
  reach: 0,
  range: { normal: 120, long: 120 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: true,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Silence (20-ft-radius zone blocks sound, concentration 10 min)',
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
    width: 50, height: 50, depth: 1,
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

/** Bard with Silence + 2 2nd-level slots */
function makeBard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('bard1', {
    name: 'Bard',
    pos,
    actions: [SILENCE_ACTION],
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

eq('name is Silence', metadata.name, 'Silence');
eq('level is 2', metadata.level, 2);
eq('school is illusion', metadata.school, 'illusion');
eq('range is 120 ft', metadata.rangeFt, 120);
eq('AoE radius is 20 ft', metadata.aoeRadiusFt, 20);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('verbal spell block NOT implemented (v1)', metadata.silenceVerbalSpellBlockV1Implemented, false);
eq('AoE multi-target NOT implemented (v1)', metadata.silenceAoEMultiTargetV1Implemented, false);
eq('upcast NOT implemented (v1)', metadata.silenceUpcastV1Implemented, false);
eq('concentration enforcement NOT implemented (v1)', metadata.silenceConcentrationEnforcementV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates (incl. concentration)
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Silence' action
  const caster = makeBard();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Silence action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeBard();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. Caster is already concentrating on another spell
  const caster = makeBard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d. No enemies in range (120 ft)
  const caster = makeBard();
  const farEnemy = makeEnemy('far', { x: 30, y: 0, z: 0 });   // 150 ft > 120 ft
  const bf = makeBF([caster, farEnemy]);
  assert('Returns null when no enemies in range (120 ft)', shouldCast(caster, bf) === null);
}

{
  // 2e. Enemy already Silence'd by this caster — skip
  const caster = makeBard();
  const enemy = makeEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Silence',
    effectType: 'damage_zone', payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already Silence\'d by this caster', shouldCast(caster, bf) === null);
}

{
  // 2f. Dead enemy — skip
  const caster = makeBard();
  const deadEnemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, deadEnemy]);
  assert('Returns null when only enemy is dead', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Highest-threat (maxHP) enemy selected first
  const caster = makeBard();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 80) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 3b. Tie-break: closest enemy first
  const caster = makeBard();
  const far = makeEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40 });
  const near = makeEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

{
  // 3c. Same-faction allies skipped
  const caster = makeBard();
  const ally = makeCombatant('ally', { faction: 'party', maxHP: 90, pos: { x: 1, y: 0, z: 0 } });
  const enemy = makeEnemy('e1', { x: 2, y: 0, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, ally, enemy]);
  eq('Same-faction ally skipped, enemy selected', shouldCast(caster, bf)?.id, 'e1');
}

// ============================================================
// 4. execute — forward-compat flag + sentinel effect
// ============================================================

console.log('\n=== 4. execute — forward-compat flag + sentinel effect ===\n');

{
  // 4a. _silenceZoneActive set on target after cast
  const caster = makeBard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  eq('Flag undefined before cast', enemy._silenceZoneActive, undefined);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  eq('Flag set on target after cast', enemy._silenceZoneActive, true);
}

{
  // 4b. Sentinel damage_zone effect attached (dieCount=0)
  const caster = makeBard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  const sentinels = enemy.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Silence',
  );
  eq('1 sentinel damage_zone effect attached', sentinels.length, 1);
  if (sentinels.length === 1) {
    eq('Sentinel dieCount is 0 (no damage tick)', sentinels[0].payload.dieCount, 0);
    eq('Sentinel dieSides is 0', sentinels[0].payload.dieSides, 0);
    eq('Sentinel sourceIsConcentration is true', sentinels[0].sourceIsConcentration, true);
    eq('Sentinel casterId is the bard', sentinels[0].casterId, 'bard1');
  }
}

{
  // 4c. Slot consumed + concentration started
  const caster = makeBard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Silence', caster.concentration?.spellName, 'Silence');
}

{
  // 4d. Existing concentration broken (safety net)
  const caster = makeBard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  // Pre-existing Hold Person effect on enemy (simulated)
  const enemy = makeEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_hp', casterId: caster.id, spellName: 'Hold Person',
    effectType: 'condition_apply', payload: { condition: 'paralyzed' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration switched to Silence', caster.concentration?.spellName, 'Silence');
  assert('Prior Hold Person effect removed from enemy',
    !enemy.activeEffects.some(e => e.spellName === 'Hold Person'));
}

{
  // 4e. Dead target skipped (stale plan) — no flag set
  const caster = makeBard();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Dead enemy: flag NOT set', enemy._silenceZoneActive, undefined);
  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeBard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Silence"',
    actionEvents[0].description.includes('Silence'));
  eq('1 condition_add event (silence applied)', condEvents.length, 1);
  assert('condition_add mentions silence/SILENCE',
    condEvents[0].description.toLowerCase().includes('silence'));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/silence');
  const caster = makeBard();
  caster.concentration = { active: true, spellName: 'Silence', dcIfHit: 10 };
  // cleanup should NOT break concentration (concentration break is handled
  // by removeEffectsFromCaster's sentinel cleanup, not by cleanup)
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Silence');
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: bard silences highest-threat enemy
  const caster = makeBard();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 80)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  eq('Strong enemy silenced (flag set)', strong._silenceZoneActive, true);
  eq('Weak enemy NOT silenced (flag undefined)', weak._silenceZoneActive, undefined);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Silence', caster.concentration?.spellName, 'Silence');

  const sentinels = strong.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Silence',
  );
  eq('Sentinel effect attached', sentinels.length, 1);
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeBard();
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
  // 7c. Sentinel cleanup on concentration break — flag cleared
  const { removeEffectsFromCaster } = require('../engine/spell_effects');
  const caster = makeBard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Flag set on cast', enemy._silenceZoneActive, true);

  // Simulate concentration break (caster's concentration ends)
  removeEffectsFromCaster(caster.id, bf);

  eq('Flag cleared after concentration break', enemy._silenceZoneActive, undefined);
  assert('Sentinel effect removed from enemy',
    !enemy.activeEffects.some(e => e.spellName === 'Silence'));
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
