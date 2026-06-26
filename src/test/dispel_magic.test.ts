// ============================================================
// dispel_magic.test.ts — Dispel Magic spell module
// PHB p.233: 3rd-level abjuration, action, range 120 ft,
//            NO concentration.
// Effect: Auto-dispel concentration effects on target.
//         Non-concentration effects require ability check vs DC 13.
//         Upcast: auto-dispel additional non-concentration effects
//         (1 extra per slot level above 3rd).
//
// Tests cover:
//   1. Metadata
//   2. shouldCast — precondition gates + target priority
//   3. execute — auto-dispel concentration effects
//   4. execute — non-concentration effects (ability check)
//   5. execute — no effects on target
//   6. Upcast auto-dispels more effects
//   7. Exhaustion NOT dispelled
//   8. spellcastingMod helper
//   9. Logging
//  10. Cleanup no-op
//  11. Integration pipeline
//
// Deterministic ability checks use extreme stats:
//   - INT/WIS/CHA 1 → mod -5, d20 + (-5) = 1..15 vs DC 13 → ~25% success
//   - INT/WIS/CHA 30 → mod +10, d20 + 10 = 11..30 vs DC 13 → ~90% success
//   For guaranteed check: use INT 30 (mod +10, min roll 11 < 13) — NOT guaranteed.
//   For guaranteed success: INT 30 and mock rollDie to always return 20.
//   For guaranteed fail: INT 1 and mock rollDie to always return 1.
//   Instead: we test STATISTICAL behavior over many runs, or we test
//   by checking that at least SOME effects were dispelled over enough runs.
// ============================================================

import { shouldCast, execute, metadata, spellcastingMod, cleanup } from '../spells/dispel_magic';
import { removeEffectById } from '../engine/spell_effects';
import { Combatant, Action, PlayerResources, ActiveEffect } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots3(remaining = 2): PlayerResources {
  return { spellSlots: { 3: { max: 2, remaining } } };
}

function withSlots4(remaining = 1): PlayerResources {
  return { spellSlots: { 3: { max: 1, remaining: 0 }, 4: { max: 1, remaining } } };
}

const DISPEL_MAGIC_ACTION: Action = {
  name: 'Dispel Magic',
  isMultiattack: false,
  attackType: 'spell',
  reach: 5,
  range: { normal: 120, long: 120 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 15,
  saveAbility: 'wis',
  isAoE: false,
  isControl: true,
  requiresConcentration: false,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Dispel Magic (auto-dispel concentration effects + ability check for non-concentration)',
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

/** Wizard at pos (0,0,0) with Dispel Magic + 2 3rd-level slots */
function makeWizard(pos: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [DISPEL_MAGIC_ACTION],
    resources: withSlots3(2),
    int: 20,  // +5 mod — good spellcasting
  });
}

/** Enemy with default stats */
function makeEnemy(id: string, pos: { x: number; y: number; z: number } = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    pos,
    ...overrides,
  });
}

/** Make a concentration-sourced ActiveEffect on a target */
function makeConcentrationEffect(id: string, spellName: string, casterId: string): ActiveEffect {
  return {
    id,
    casterId,
    spellName,
    effectType: 'condition_apply',
    payload: { condition: 'frightened' },
    sourceIsConcentration: true,
  };
}

/** Make a non-concentration ActiveEffect on a target */
function makeNonConcentrationEffect(id: string, spellName: string, casterId: string): ActiveEffect {
  return {
    id,
    casterId,
    spellName,
    effectType: 'ac_bonus',
    payload: { acBonus: 2 },
    sourceIsConcentration: false,
  };
}

/** Make an exhaustion_level ActiveEffect (should NOT be dispelled) */
function makeExhaustionEffect(id: string, casterId: string): ActiveEffect {
  return {
    id,
    casterId,
    spellName: 'Sickening Radiance',
    effectType: 'exhaustion_level',
    payload: { exhaustionLevels: 1 },
    sourceIsConcentration: true,
  };
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Dispel Magic', metadata.name, 'Dispel Magic');
eq('level is 3', metadata.level, 3);
eq('school is abjuration', metadata.school, 'abjuration');
eq('range is 120 ft', metadata.rangeFt, 120);
eq('is NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
eq('spell level tracking IS implemented (Session 72)', metadata.dispelMagicSpellLevelTrackingV1Implemented, true);
eq('object targeting NOT implemented (v1)', metadata.dispelMagicObjectTargetingV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates + target priority
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates + target priority ===\n');

{
  // 2a. Caster lacks 'Dispel Magic' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  enemy.activeEffects = [makeConcentrationEffect('eff1', 'Hold Person', 'enemy_caster')];
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Dispel Magic action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 3rd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots3(0);
  const enemy = makeEnemy('e1');
  enemy.activeEffects = [makeConcentrationEffect('eff1', 'Hold Person', 'enemy_caster')];
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no 3rd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No enemy has active effects
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  // No effects on enemy
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no enemy has active effects', shouldCast(caster, bf) === null);
}

{
  // 2d. No enemies in range (120 ft)
  const caster = makeWizard();
  const farEnemy = makeEnemy('far', { x: 30, y: 0, z: 0 }); // 150 ft
  farEnemy.activeEffects = [makeConcentrationEffect('eff1', 'Hold Person', 'enemy_caster')];
  const bf = makeBF([caster, farEnemy]);
  assert('Returns null when no enemies in range (120 ft)', shouldCast(caster, bf) === null);
}

{
  // 2e. Enemy with most effects selected first
  const caster = makeWizard();
  const fewEffects = makeEnemy('few', { x: 1, y: 0, z: 0 });
  fewEffects.activeEffects = [makeConcentrationEffect('eff1', 'Spell A', 'c1')];
  const manyEffects = makeEnemy('many', { x: 2, y: 0, z: 0 });
  manyEffects.activeEffects = [
    makeConcentrationEffect('eff2', 'Spell B', 'c1'),
    makeConcentrationEffect('eff3', 'Spell C', 'c2'),
    makeNonConcentrationEffect('eff4', 'Spell D', 'c3'),
  ];
  const bf = makeBF([caster, fewEffects, manyEffects]);
  eq('Enemy with most effects selected', shouldCast(caster, bf)?.id, 'many');
}

{
  // 2f. Tie-break: closest enemy
  const caster = makeWizard();
  const far = makeEnemy('far', { x: 5, y: 0, z: 0 });
  far.activeEffects = [makeConcentrationEffect('eff1', 'Spell A', 'c1')];
  const near = makeEnemy('near', { x: 1, y: 0, z: 0 });
  near.activeEffects = [makeConcentrationEffect('eff2', 'Spell B', 'c2')];
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

{
  // 2g. Enemy with only exhaustion effects is skipped (exhaustion not dispellable)
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  enemy.activeEffects = [makeExhaustionEffect('eff1', 'c1')];
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy only has exhaustion effects', shouldCast(caster, bf) === null);
}

{
  // 2h. Dead enemies skipped
  const caster = makeWizard();
  const dead = makeEnemy('dead', { x: 1, y: 0, z: 0 }, { isDead: true });
  dead.activeEffects = [makeConcentrationEffect('eff1', 'Hold Person', 'c1')];
  const bf = makeBF([caster, dead]);
  assert('Returns null when only dead enemies have effects', shouldCast(caster, bf) === null);
}

{
  // 2i. Can be cast while concentrating on another spell
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  enemy.activeEffects = [makeConcentrationEffect('eff1', 'Hold Person', 'enemy_caster')];
  const bf = makeBF([caster, enemy]);
  assert('Can cast while concentrating (Dispel Magic is NOT concentration)', shouldCast(caster, bf) !== null);
}

// ============================================================
// 3. execute — auto-dispel concentration effects
// ============================================================

console.log('\n=== 3. execute — auto-dispel concentration effects ===\n');

{
  // 3a. Concentration effect is auto-dispelled
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const effect = makeConcentrationEffect('eff1', 'Hold Person', 'enemy_caster');
  enemy.activeEffects = [effect];
  enemy.conditions.add('frightened');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration effect removed', enemy.activeEffects.length, 0);
  eq('Slot consumed', caster.resources!.spellSlots![3]!.remaining, 1);
}

{
  // 3b. Concentration on the TARGET is broken when their spell is dispelled
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  enemy.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const effect = makeConcentrationEffect('eff1', 'Hold Person', enemy.id);
  enemy.activeEffects = [effect];
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  assert('Target concentration is broken', enemy.concentration === null);
}

{
  // 3c. Multiple concentration effects all auto-dispelled
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  enemy.activeEffects = [
    makeConcentrationEffect('eff1', 'Hold Person', 'c1'),
    makeConcentrationEffect('eff2', 'Faerie Fire', 'c2'),
  ];
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Both concentration effects removed', enemy.activeEffects.length, 0);
}

// ============================================================
// 4. execute — non-concentration effects (ability check)
// ============================================================

console.log('\n=== 4. execute — non-concentration effects (ability check) ===\n');

{
  // 4a. Non-concentration effect: statistical test over many runs
  // With INT 20 (mod +5), check = d20+5 vs DC 13 → success on 9+ (60%)
  // Over 50 runs, at least some should succeed
  const caster = makeWizard();
  caster.int = 20;
  let totalDispelled = 0;
  const RUNS = 50;

  for (let i = 0; i < RUNS; i++) {
    const enemy = makeEnemy('e1');
    enemy.activeEffects = [makeNonConcentrationEffect('eff1', 'Mage Armor', 'c1')];
    const bf = makeBF([caster, enemy]);
    const state = makeState(bf);
    // Reset slot for each run
    caster.resources = withSlots3(2);

    execute(caster, enemy, state);

    if (enemy.activeEffects.length === 0) totalDispelled++;
  }

  assert(`Non-concentration effects dispelled statistically (>${RUNS * 0.3} of ${RUNS})`, totalDispelled > RUNS * 0.3, `got ${totalDispelled}`);
}

{
  // 4b. Non-concentration effect with INT 1: very low chance
  // With INT 1 (mod -5), check = d20+(-5) vs DC 13 → success on 18+ (15%)
  const caster = makeWizard();
  caster.int = 1;
  caster.wis = 1;
  caster.cha = 1;
  let totalDispelled = 0;
  const RUNS = 50;

  for (let i = 0; i < RUNS; i++) {
    const enemy = makeEnemy('e1');
    enemy.activeEffects = [makeNonConcentrationEffect('eff1', 'Mage Armor', 'c1')];
    const bf = makeBF([caster, enemy]);
    const state = makeState(bf);
    caster.resources = withSlots3(2);

    execute(caster, enemy, state);

    if (enemy.activeEffects.length === 0) totalDispelled++;
  }

  // Should be very few dispels with -5 mod
  assert(`Low-mod caster dispels rarely (<${RUNS * 0.4} of ${RUNS})`, totalDispelled < RUNS * 0.4, `got ${totalDispelled}`);
}

// ============================================================
// 5. execute — no effects on target
// ============================================================

console.log('\n=== 5. execute — no effects on target ===\n');

{
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  // No effects on enemy
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Slot still consumed even with no effects', caster.resources!.spellSlots![3]!.remaining, 1);
  eq('No effects remain (none to remove)', enemy.activeEffects.length, 0);

  // Check logging mentions 0 dispels
  const removeEvents = state.log.events.filter((e: any) => e.type === 'condition_remove');
  eq('No condition_remove events', removeEvents.length, 0);
}

// ============================================================
// 6. Upcast auto-dispels more effects
// ============================================================

console.log('\n=== 6. Upcast auto-dispels more effects ===\n');

{
  // 6a. 4th-level slot auto-dispels 1 extra non-concentration effect
  // Slot level 4 means autoDispelCount = max(0, 4 - 3) = 1
  const caster = makeWizard();
  caster.resources = withSlots4(1);
  // Override actions with a 4th-level slot version
  caster.actions = [DISPEL_MAGIC_ACTION];

  const enemy = makeEnemy('e1');
  enemy.activeEffects = [
    makeConcentrationEffect('eff1', 'Hold Person', 'c1'),   // auto-dispelled (concentration)
    makeNonConcentrationEffect('eff2', 'Mage Armor', 'c2'), // auto-dispelled (upcast slot 4 → 1 extra)
    makeNonConcentrationEffect('eff3', 'Bless', 'c3'),       // ability check required
  ];

  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  // Concentration effect + 1 upcast auto-dispel = at least 2 effects removed
  // The 3rd effect may or may not be dispelled (ability check)
  const removedCount = 3 - enemy.activeEffects.length;
  assert(`At least 2 effects removed with L4 slot (got ${removedCount})`, removedCount >= 2);

  // Verify a 4th-level slot was consumed
  eq('4th-level slot consumed', caster.resources!.spellSlots![4]!.remaining, 0);
}

{
  // 6b. Statistical test: 5th-level slot auto-dispels 2 extra non-conc effects
  // autoDispelCount = max(0, 5 - 3) = 2
  const caster = makeWizard();
  caster.resources = { spellSlots: { 5: { max: 1, remaining: 1 } } };
  caster.int = 1; // Low spellcasting mod — ability checks will usually fail

  const enemy = makeEnemy('e1');
  enemy.activeEffects = [
    makeConcentrationEffect('eff1', 'Hold Person', 'c1'),     // auto-dispelled
    makeNonConcentrationEffect('eff2', 'Mage Armor', 'c2'),   // auto-dispelled (upcast #1)
    makeNonConcentrationEffect('eff3', 'Shield of Faith', 'c3'), // auto-dispelled (upcast #2)
    makeNonConcentrationEffect('eff4', 'Bless', 'c4'),        // ability check (unlikely to pass with INT 1)
  ];

  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  // 1 concentration + 2 upcast auto-dispels = at least 3 effects removed
  // The 4th effect may or may not be removed (ability check: d20-5 vs DC 13)
  const removedCount = 4 - enemy.activeEffects.length;
  assert(`L5 slot removes at least 3 effects (conc + 2 upcast) — got ${removedCount}`, removedCount >= 3);
  // The 5th-level slot should be consumed
  eq('5th-level slot consumed', caster.resources!.spellSlots![5]!.remaining, 0);
}

// ============================================================
// 7. Exhaustion NOT dispelled
// ============================================================

console.log('\n=== 7. Exhaustion NOT dispelled ===\n');

{
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  enemy.activeEffects = [
    makeExhaustionEffect('eff_exh', 'c1'),
    makeConcentrationEffect('eff_conc', 'Hold Person', 'c1'),
  ];

  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Exhaustion effect NOT removed', enemy.activeEffects.length, 1);
  eq('Remaining effect is exhaustion_level', enemy.activeEffects[0].effectType, 'exhaustion_level');
  eq('Concentration effect was removed', !enemy.activeEffects.some(e => e.spellName === 'Hold Person'), true);
}

// ============================================================
// 8. spellcastingMod helper
// ============================================================

console.log('\n=== 8. spellcastingMod helper ===\n');

{
  const c = makeCombatant('test', { int: 18, wis: 14, cha: 10 });
  // INT 18 → +4, WIS 14 → +2, CHA 10 → +0 → max is +4
  eq('spellcastingMod with INT 18, WIS 14, CHA 10 → +4', spellcastingMod(c), 4);
}

{
  const c = makeCombatant('test', { int: 8, wis: 20, cha: 16 });
  // INT 8 → -1, WIS 20 → +5, CHA 16 → +3 → max is +5
  eq('spellcastingMod with INT 8, WIS 20, CHA 16 → +5', spellcastingMod(c), 5);
}

{
  const c = makeCombatant('test', { int: 10, wis: 10, cha: 10 });
  // All 10 → +0
  eq('spellcastingMod with all 10s → +0', spellcastingMod(c), 0);
}

// ============================================================
// 9. Logging
// ============================================================

console.log('\n=== 9. Logging ===\n');

{
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  enemy.activeEffects = [makeConcentrationEffect('eff1', 'Hold Person', 'c1')];
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const removeEvents = events.filter(e => e.type === 'condition_remove');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Condition_remove event emitted (dispel)', removeEvents.length >= 1);
  assert('Action event mentions "Dispel Magic"', actionEvents[0].description.includes('Dispel Magic'));
  assert('Remove event mentions "Hold Person"', removeEvents[0].description.includes('Hold Person'));
  assert('Remove event mentions "dispelled"', removeEvents[0].description.includes('dispelled'));
}

// ============================================================
// 10. Cleanup no-op
// ============================================================

console.log('\n=== 10. Cleanup no-op ===\n');

{
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Some Spell', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
}

// ============================================================
// 11. Integration pipeline
// ============================================================

console.log('\n=== 11. Integration pipeline ===\n');

{
  // 11a. Full pipeline: shouldCast finds enemy with most effects, execute removes them
  const caster = makeWizard();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 });
  weak.activeEffects = [makeConcentrationEffect('eff1', 'Faerie Fire', 'c1')];
  const strong = makeEnemy('strong', { x: 2, y: 0, z: 0 });
  strong.activeEffects = [
    makeConcentrationEffect('eff2', 'Hold Person', 'c1'),
    makeConcentrationEffect('eff3', 'Faerie Fire', 'c2'),
    makeNonConcentrationEffect('eff4', 'Mage Armor', 'c3'),
  ];

  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (most effects)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  // Both concentration effects auto-dispelled; non-conc may or may not be
  const concRemoved = !strong.activeEffects.some(e => e.sourceIsConcentration);
  assert('Concentration effects auto-dispelled', concRemoved);
  eq('Slot consumed', caster.resources!.spellSlots![3]!.remaining, 1);
}

{
  // 11b. After slots exhausted, shouldCast returns null
  const caster = makeWizard();
  caster.resources = withSlots3(1);
  const enemy = makeEnemy('e1');
  enemy.activeEffects = [makeConcentrationEffect('eff1', 'Hold Person', 'c1')];
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![3]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, makeEnemy('e2', { x: 1, y: 0, z: 0 }, { activeEffects: [makeConcentrationEffect('eff2', 'Spell', 'c1')] })]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
