// ============================================================
// cordon_of_arrows.test.ts — Cordon of Arrows spell module
// PHB p.228: 2nd-level transmutation, action, range 5 ft, NO concentration (1 min).
// Effect: 4 pieces of ammunition planted in the ground; v1 models as a
//         damage_zone effect with ticksRemaining: 4 (1d6 piercing DEX-save
//         per turn at the start of the target's NEXT turn — NO on-cast damage).
//
// v1 simplifications (documented via metadata flags):
//   - DEX save (canon: ranged spell attack).
//   - Auto-tick at start of target's turn (canon: bonus action trigger).
//   - Single-target (canon: retarget each piece).
//   - Upcast +2 pieces/slot-level NOT modelled.
//   - NOT concentration (PHB p.228).
//
// Tests cover shouldCast() preconditions + target priority, execute()
// damage_zone application with ticksRemaining: 4, rollDamage() range,
// integration pipeline, and metadata shape.
// ============================================================

import { shouldCast, execute, rollDamage, metadata } from '../spells/cordon_of_arrows';
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

const CORDON_ACTION: Action = {
  name: 'Cordon of Arrows',
  isMultiattack: false,
  attackType: null,
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 13,            // v1: DEX save DC (canon: spell attack)
  saveAbility: 'dex',
  isAoE: false,
  isControl: true,
  requiresConcentration: false,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Cordon of Arrows (4 pieces, 1d6 piercing/turn DEX save, 4 turns, NOT concentration)',
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

/** Ranger at (0,0,0) with Cordon of Arrows + 2 2nd-level slots */
function makeRanger(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('ranger1', {
    name: 'Ranger',
    pos,
    actions: [CORDON_ACTION],
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

eq('name is Cordon of Arrows', metadata.name, 'Cordon of Arrows');
eq('level is 2', metadata.level, 2);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 5 ft', metadata.rangeFt, 5);
eq('pieces is 4', (metadata as any).pieces, 4);
eq('dieCount is 1', metadata.dieCount, 1);
eq('dieSides is 6', metadata.dieSides, 6);
eq('damageType is piercing', metadata.damageType, 'piercing');
eq('NOT concentration', metadata.concentration, false);
eq('saveAbility is dex', metadata.saveAbility, 'dex');
eq('casting time is action', metadata.castingTime, 'action');
eq('v1: DEX save simplified (canon: spell attack)',
  (metadata as any).cordonOfArrowsSaveVsAttackV1Simplified, true);
eq('v1: bonus-action trigger NOT implemented',
  (metadata as any).cordonOfArrowsBonusActionTriggerV1Implemented, false);
eq('v1: retargeting NOT implemented',
  (metadata as any).cordonOfArrowsRetargetingV1Implemented, false);
eq('v1: upcast NOT implemented',
  (metadata as any).cordonOfArrowsUpcastV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates + priority
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates + priority ===\n');

{
  // 2a. Caster lacks 'Cordon of Arrows' action
  const caster = makeRanger();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Cordon of Arrows action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeRanger();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No enemies in range
  const caster = makeRanger();
  const farEnemy = makeEnemy('far', { x: 5, y: 0, z: 0 });  // 25 ft away
  const bf = makeBF([caster, farEnemy]);
  assert('Returns null when no enemies in range (5 ft)', shouldCast(caster, bf) === null);
}

{
  // 2d. Already concentrating — Cordon of Arrows is NOT concentration, so
  // this should NOT block casting.
  const caster = makeRanger();
  caster.concentration = { active: true, spellName: 'Hunter\'s Mark', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('NOT concentration: cast allowed while concentrating on another spell', result !== null);
}

{
  // 2e. Enemy already Cordon'd by this caster — skip
  const caster = makeRanger();
  const enemy = makeEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Cordon of Arrows',
    effectType: 'damage_zone',
    payload: { dieCount: 1, dieSides: 6, damageType: 'piercing' },
    sourceIsConcentration: false,
  });
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already Cordon\'d by this caster', shouldCast(caster, bf) === null);
}

{
  // 2f. Highest-threat (maxHP) enemy selected first. Both enemies at 5 ft
  // (chebyshev=1) — threat (maxHP) differentiates them.
  const caster = makeRanger();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20, currentHP: 20 });
  const strong = makeEnemy('strong', { x: 0, y: 1, z: 0 }, { maxHP: 80, currentHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 80) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 2g. Touch range: all non-self enemies at chebyshev=1 are at 5 ft — the
  // distance tiebreak cannot differentiate them. Verify stable behaviour:
  // two equal-threat enemies both qualify, shouldCast returns one of them.
  const caster = makeRanger();
  const a = makeEnemy('a', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const b = makeEnemy('b', { x: 0, y: 1, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, a, b]);
  const target = shouldCast(caster, bf)?.id;
  assert('Tie-break selects one of the equal-threat enemies',
    target === 'a' || target === 'b', `got ${target}`);
}

// ============================================================
// 3. execute — damage_zone application (NO on-cast damage)
// ============================================================

console.log('\n=== 3. execute — damage_zone application (NO on-cast damage) ===\n');

{
  // 3a. damage_zone effect attached with ticksRemaining: 4
  const caster = makeRanger();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const zones = enemy.activeEffects.filter(e => e.effectType === 'damage_zone');
  eq('1 damage_zone effect applied', zones.length, 1);
  if (zones.length === 1) {
    eq('ticksRemaining is 4', zones[0].payload.ticksRemaining, 4);
    eq('dieCount is 1', zones[0].payload.dieCount, 1);
    eq('dieSides is 6', zones[0].payload.dieSides, 6);
    eq('damageType is piercing', zones[0].payload.damageType, 'piercing');
    eq('saveAbility is dex', zones[0].payload.saveAbility, 'dex');
    eq('saveDC is 13 (from action)', zones[0].payload.saveDC, 13);
    eq('sourceIsConcentration is false', zones[0].sourceIsConcentration, false);
    eq('spellName is Cordon of Arrows', zones[0].spellName, 'Cordon of Arrows');
    eq('casterId is the ranger', zones[0].casterId, 'ranger1');
  }

  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 3b. NO on-cast damage (damage starts ticking at start of target's NEXT turn)
  const caster = makeRanger();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  // No damage events — the damage_zone effect is just attached.
  assert('No on-cast damage',
    !state.log.events.some((e: any) => e.type === 'damage'));
  // HP unchanged
  eq('Enemy HP unchanged on cast (no on-cast damage)', enemy.currentHP, 100);
}

{
  // 3c. NOT concentration — caster.concentration remains null
  const caster = makeRanger();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  eq('NO concentration started', caster.concentration, null);
}

{
  // 3d. Dead target skipped (stale edge case) — slot consumed, no effect
  const caster = makeRanger();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('No damage_zone on dead target',
    enemy.activeEffects.filter(e => e.effectType === 'damage_zone').length, 0);
}

// ============================================================
// 4. rollDamage range (1d6 → 1..6)
// ============================================================

console.log('\n=== 4. rollDamage range (1d6) ===\n');

{
  for (let i = 0; i < 50; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [1, 6] (iteration ${i})`, dmg >= 1 && dmg <= 6, `got ${dmg}`);
  }
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeRanger();
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
  assert('Action event mentions "Cordon of Arrows"',
    actionEvents[0].description.includes('Cordon of Arrows'));
  eq('1 condition_add event (damage_zone applied)', condEvents.length, 1);
  eq('0 damage events (NO on-cast damage)', damageEvents.length, 0);
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/cordon_of_arrows');
  const caster = makeRanger();
  // Cordon of Arrows is NOT concentration, but the caster may be concentrating
  // on something else. cleanup should be a no-op regardless.
  caster.concentration = { active: true, spellName: 'Hunter\'s Mark', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT touch concentration', caster.concentration?.spellName, 'Hunter\'s Mark');
  eq('Cleanup does NOT change active flag', caster.concentration?.active, true);
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: caster targets highest-threat enemy with damage_zone.
  // Both enemies at 5 ft (chebyshev=1) — threat (maxHP) differentiates them.
  const caster = makeRanger();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20, currentHP: 20 });
  const strong = makeEnemy('strong', { x: 0, y: 1, z: 0 }, { maxHP: 80, currentHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 80)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  // Strong enemy has damage_zone effect with ticksRemaining: 4
  const strongZones = strong.activeEffects.filter(e => e.effectType === 'damage_zone');
  eq('Strong enemy has 1 damage_zone effect', strongZones.length, 1);
  eq('Strong enemy damage_zone ticksRemaining is 4', strongZones[0].payload.ticksRemaining, 4);

  // Weak enemy has NO damage_zone effect
  const weakZones = weak.activeEffects.filter(e => e.effectType === 'damage_zone');
  eq('Weak enemy has 0 damage_zone effects', weakZones.length, 0);

  // Strong enemy took NO immediate damage (ticks start next turn)
  eq('Strong enemy HP unchanged (no on-cast damage)', strong.currentHP, 80);

  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster NOT concentrating (NOT a concentration spell)', caster.concentration, null);
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeRanger();
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

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
