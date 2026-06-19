// ============================================================
// Test: Shape Water Cantrip
// XGE p.164 — Level 0 transmutation cantrip (self-buff: flavor log only, no mechanical effect in v1)
//
// THIS IS THE FINAL CANTRIP IN THE CANTRIP WORKSTREAM.
// After Shape Water, ALL 49 in-scope cantrips (excluding the 3 out-of-scope XPHB-only:
// Elementalism, Sorcerous Burst, Starry Wisp) are implemented.
//
// THIS IS THE FOURTH AND FINAL S-ONLY CANTRIP IN THE WORKSTREAM.
// (Control Flames was first, Encode Thoughts was second, Mold Earth was third — all in this session.)
//
// v1 simplifications (all documented via metadata flags):
//   - Multi-effect tracking: canonically up to 2 non-instantaneous effects active
//     → v1: no persistent-effect-tracking subsystem.
//   - Effect choice: canonically choose 1 of 4 (move/shape/color/freeze)
//     → v1: emit single "manipulates water" log.
//   - Water flow: canonically move/change flow 5 ft → v1: no water-flow subsystem.
//   - Freeze: canonically freeze water for 1 hr if no creatures → v1: no freeze subsystem.
//   - Duration: canonically instant or 1 hour → v1: 1-round flavor log.
//   - Dismissal: canonically dismiss as action → v1: no dismissal action.
//   - Range: canonically 30 ft → v1: does NOT enforce range.
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (S only — NO V, NO M — FOURTH and FINAL S-only cantrip)
//   3. metadata exposes isSelfBuff = true
//   4. metadata exposes v1 simplification flags
//   5. metadata does NOT scale (the 4 water effects are flat)
//   6. metadata exposes rangeFt = 30 (canon)
//   7. applySelfEffect emits a single flavor log + returns true
//   8. applySelfEffect sets NO scratch fields (v1 has no persistent state)
//   9. applySelfEffect emits NO attack/damage events
//  10. resolveCantripAction integration — 'Shape Water' routes to applySelfEffect
//  11. dispatcher safety — unknown cantrip name is a no-op
//  12. cleanup is a no-op (no scratch fields, no persistent state)
//  13. resetBudget integration — cleanup is a no-op
//  14. Shape Water itself does NOT go through resolveAttack (self-buff)
//  15. resolveCantripAoE returns false (not a caster-centered AoE)
//  16. resolveCantripTouchEffect returns false (not a touch-effect)
//  17. no CANTRIP_EFFECTS entry (not a post-hit rider)
//  18. NO new Combatant fields (v1 has no scratch fields)
//  19. flavor log mentions "water" + at least one of (move/shape/color/freeze)
//  20. v1 simplification flags document the missing mechanics
//  21. metadata exposes concentration = false
//  22. metadata exposes castingTime = 'action'
//  23. metadata exposes school = 'transmutation'
//  24. metadata exposes damageDice = null + damageType = null
//  25. metadata exposes name = 'Shape Water' (exact casing/spelling)
//  26. applySelfEffect is idempotent — repeated calls emit one log each
//  27. applySelfEffect handles caster with various stats (no stat dependency)
//  28. applySelfEffect handles caster at 0 HP (no HP requirement for flavor)
//  29. applySelfEffect handles dead caster (engine doesn't gate — engine's job)
//  30. applySelfEffect is robust to undefined optional fields on caster
//  31. Shape Water mirrors Control Flames / Mold Earth — verify metadata shape parity
//  32. FINAL cantrip in the workstream — verify all 4 XGE elemental-utility cantrips are S-only
//
// Run: npx ts-node src/test/shape_water.test.ts
// ============================================================

import { metadata, applySelfEffect, cleanup } from '../spells/shape_water';
import {
  applyCantripEffect as dispatchCantrip,
  resolveCantripAction,
  resolveCantripAoE,
  resolveCantripTouchEffect,
} from '../engine/cantrip_effects';
import { resetBudget } from '../engine/utils';
import { CombatEvent } from '../engine/combat';
import { Combatant, Action, Vec3, Cell, Obstacle } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail: any = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10,
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

function makeBF(combatants: Combatant[], obstacles: Obstacle[] = []) {
  const width = 10, height = 10, depth = 1;
  const cells: Cell[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [];
      for (let z = 0; z < depth; z++) {
        cells[x][y][z] = { terrain: 'normal', elevation: 0 };
      }
    }
  }
  return {
    width, height, depth, cells,
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
    obstacles: obstacles.length ? obstacles : undefined,
  };
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// A Shape Water Action — self-buff (flavor-only), no target, no attack roll, no save.
const SHAPE_WATER_ACTION: Action = {
  name: 'Shape Water',
  isMultiattack: false,
  attackType: 'special', // self-buff — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 30, long: 0 }, // 30 ft (canon XGE p.164)
  hitBonus: null,
  damage: null, // no damage — the cantrip manipulates water (flavor only)
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Shape Water',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Shape Water');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'transmutation');
  eq('1d. rangeFt (30 — canon XGE p.164)', metadata.rangeFt, 30);
  eq('1e. damageDice null (no damage — utility only)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. not concentration (instant or 1 hour — no concentration required)', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. components: S only (NO V, NO M) — XGE p.164, canon per 5etools JSON
//    THIS IS THE FOURTH AND FINAL S-ONLY CANTRIP IN THE WORKSTREAM.
// ============================================================
console.log('\n--- 2. components ---');
{
  eq('2a. NO verbal component (canon 5etools JSON: {"s":true})',
    metadata.components.v, false);
  eq('2b. somatic component', metadata.components.s, true);
  eq('2c. NO material component (canon 5etools JSON: {"s":true})',
    metadata.components.m, false);
}

// ============================================================
// 3. metadata exposes isSelfBuff = true
// ============================================================
console.log('\n--- 3. isSelfBuff ---');
{
  eq('3a. isSelfBuff = true (v1: flavor-only self-buff)', metadata.isSelfBuff, true);
}

// ============================================================
// 4. metadata exposes v1 simplification flags
// ============================================================
console.log('\n--- 4. v1 simplification flags ---');
{
  eq('4a. shapeWaterMultiEffectTrackingV1Implemented = false (no persistent-effect-tracking subsystem)',
    metadata.shapeWaterMultiEffectTrackingV1Implemented, false);
  eq('4b. shapeWaterEffectChoiceV1Simplified = true (canon: choose 1 of 4; v1: single log)',
    metadata.shapeWaterEffectChoiceV1Simplified, true);
  eq('4c. shapeWaterWaterFlowV1Implemented = false (no water-flow subsystem)',
    metadata.shapeWaterWaterFlowV1Implemented, false);
  eq('4d. shapeWaterFreezeV1Implemented = false (no freeze subsystem)',
    metadata.shapeWaterFreezeV1Implemented, false);
  eq('4e. shapeWaterDurationV1Simplified = true (canon: instant or 1 hour; v1: 1 round)',
    metadata.shapeWaterDurationV1Simplified, true);
  eq('4f. shapeWaterDismissalV1Implemented = false (no dismissal action)',
    metadata.shapeWaterDismissalV1Implemented, false);
  eq('4g. shapeWaterRangeEnforcementV1Simplified = true (canon: 30 ft; v1: no range check)',
    metadata.shapeWaterRangeEnforcementV1Simplified, true);
}

// ============================================================
// 5. metadata does NOT scale (the 4 water effects are flat)
// ============================================================
console.log('\n--- 5. no scaling ---');
{
  eq('5a. scales = false (Shape Water does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 6. metadata exposes rangeFt = 30 (canon)
// ============================================================
console.log('\n--- 6. rangeFt ---');
{
  eq('6a. rangeFt = 30 (canon XGE p.164: "within range" — 30 ft)', metadata.rangeFt, 30);
}

// ============================================================
// 7. applySelfEffect emits a single flavor log + returns true
// ============================================================
console.log('\n--- 7. applySelfEffect ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = applySelfEffect(caster, state);
  eq('7a. applySelfEffect returns true', ret, true);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('7b. exactly 1 action log emitted (flavor)', actionLogs.length, 1);
  assert('7c. action log mentions Shape Water',
    actionLogs[0]?.description.includes('Shape Water') === true,
    `got: ${actionLogs[0]?.description}`);
}

// ============================================================
// 8. applySelfEffect sets NO scratch fields (v1 has no persistent state)
// ============================================================
console.log('\n--- 8. no scratch fields ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const beforeKeys = Object.keys(caster).sort();

  applySelfEffect(caster, state);

  const afterKeys = Object.keys(caster).sort();

  eq('8a. caster keys unchanged after cast (no new scratch fields)',
    JSON.stringify(afterKeys), JSON.stringify(beforeKeys));

  eq('8b. _guidanceDieBonusNextAbilityCheck NOT set',
    caster._guidanceDieBonusNextAbilityCheck, undefined);
  eq('8c. _friendsAdvNextChaCheck NOT set',
    caster._friendsAdvNextChaCheck, undefined);
  eq('8d. _lightSourceActive NOT set',
    caster._lightSourceActive, undefined);
  eq('8e. _isStabilized NOT set',
    caster._isStabilized, undefined);
  eq('8f. _mended NOT set',
    caster._mended, undefined);
  eq('8g. _trueStrikeAdvNextAttack NOT set',
    caster._trueStrikeAdvNextAttack, undefined);
  eq('8h. _resistanceDieBonusNextSave NOT set',
    caster._resistanceDieBonusNextSave, undefined);
}

// ============================================================
// 9. applySelfEffect emits NO attack/damage events
// ============================================================
console.log('\n--- 9. no attack/damage events ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  const attackEvents = state.log.events.filter((e: CombatEvent) =>
    e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit' || e.type === 'damage',
  );
  eq('9a. no attack/damage events', attackEvents.length, 0);

  const saveEvents = state.log.events.filter((e: CombatEvent) =>
    e.type === 'save_success' || e.type === 'save_fail',
  );
  eq('9b. no save events', saveEvents.length, 0);
}

// ============================================================
// 10. resolveCantripAction integration — 'Shape Water' routes to applySelfEffect
// ============================================================
console.log('\n--- 10. resolveCantripAction integration ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Shape Water', state);
  eq('10a. resolveCantripAction returns true', ret, true);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('10b. exactly 1 action log emitted via dispatcher', actionLogs.length, 1);
  assert('10c. action log mentions Shape Water',
    actionLogs[0]?.description.includes('Shape Water') === true,
    `got: ${actionLogs[0]?.description}`);
}

// ============================================================
// 11. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 11. dispatcher safety ---');
{
  const caster = makeCombatant('druid');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('11a. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 12. cleanup is a no-op (no scratch fields, no persistent state)
// ============================================================
console.log('\n--- 12. cleanup is a no-op ---');
{
  const caster = makeCombatant('druid');
  const before = JSON.stringify(caster);

  cleanup(caster);

  const after = JSON.stringify(caster);

  eq('12a. cleanup is a no-op (caster state unchanged)',
    after, before);
}

// ============================================================
// 13. resetBudget integration — cleanup is a no-op
// ============================================================
console.log('\n--- 13. resetBudget integration ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);
  applySelfEffect(caster, state);

  resetBudget(caster);

  eq('13a. caster has no scratch fields after resetBudget',
    caster._guidanceDieBonusNextAbilityCheck, undefined);
  eq('13b. caster has no _friendsAdvNextChaCheck after resetBudget',
    caster._friendsAdvNextChaCheck, undefined);
  eq('13c. caster has no _lightSourceActive after resetBudget',
    caster._lightSourceActive, undefined);
  eq('13d. caster has no _mended after resetBudget',
    caster._mended, undefined);
}

// ============================================================
// 14. Shape Water itself does NOT go through resolveAttack (self-buff)
// ============================================================
console.log('\n--- 14. Shape Water bypasses resolveAttack ---');
{
  const caster = makeCombatant('druid', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [SHAPE_WATER_ACTION],
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  resolveCantripAction(caster, 'Shape Water', state);

  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('14a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('14b. action event mentions Shape Water',
    actionEvents[0]?.description.includes('Shape Water') === true,
    `got: ${actionEvents[0]?.description}`);

  const attackEvents = state.log.events.filter((e: CombatEvent) =>
    e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit' || e.type === 'damage',
  );
  eq('14c. no attack/damage events (self-buff bypasses resolveAttack)',
    attackEvents.length, 0);
}

// ============================================================
// 15. resolveCantripAoE returns false (not a caster-centered AoE)
// ============================================================
console.log('\n--- 15. not a caster-centered AoE ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Shape Water', state);
  eq('15a. resolveCantripAoE returns false', ret, false);
  eq('15b. no log events', state.log.events.length, 0);
}

// ============================================================
// 16. resolveCantripTouchEffect returns false (not a touch-effect)
// ============================================================
console.log('\n--- 16. not a touch-effect ---');
{
  const caster = makeCombatant('druid');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const ret = resolveCantripTouchEffect(caster, target, 'Shape Water', state);
  eq('16a. resolveCantripTouchEffect returns false', ret, false);
  eq('16b. no log events', state.log.events.length, 0);
}

// ============================================================
// 17. no CANTRIP_EFFECTS entry (not a post-hit rider)
// ============================================================
console.log('\n--- 17. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('druid');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Shape Water', state);
  eq('17a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);
}

// ============================================================
// 18. NO new Combatant fields (v1 has no scratch fields)
// ============================================================
console.log('\n--- 18. no new Combatant fields ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  // v1: no Shape-Water-specific scratch field exists.
  eq('18a. no _shapeWaterActiveEffects field (v1 has no persistent state)',
    (caster as any)._shapeWaterActiveEffects, undefined);
  eq('18b. no _shapeWaterFrozenCells field (v1 has no persistent state)',
    (caster as any)._shapeWaterFrozenCells, undefined);
}

// ============================================================
// 19. flavor log mentions "water" + at least one of (move/shape/color/freeze)
// ============================================================
console.log('\n--- 19. flavor log ---');
{
  const caster = makeCombatant('druid', { name: 'Druid Delta' });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Shape Water'),
  );
  assert('19a. cast log mentions caster name',
    castLog?.description.includes('Delta') === true,
    `got: ${castLog?.description}`);
  assert('19b. cast log mentions "casts Shape Water"',
    castLog?.description.includes('casts Shape Water') === true,
    `got: ${castLog?.description}`);
  assert('19c. cast log mentions "water"',
    castLog?.description.toLowerCase().includes('water') === true,
    `got: ${castLog?.description}`);
  const lowerDesc = castLog?.description.toLowerCase() ?? '';
  // Must mention at least one of (move/shape/color/freeze).
  const hasAtLeastOneEffect =
    lowerDesc.includes('move') ||
    lowerDesc.includes('shape') ||
    lowerDesc.includes('color') ||
    lowerDesc.includes('freeze');
  assert('19d. cast log mentions at least one of (move/shape/color/freeze)',
    hasAtLeastOneEffect, `got: ${castLog?.description}`);
}

// ============================================================
// 20. v1 simplification flags document the missing mechanics
// ============================================================
console.log('\n--- 20. v1 simplification flags document missing mechanics ---');
{
  eq('20a. shapeWaterMultiEffectTrackingV1Implemented = false (TODO acknowledged)',
    metadata.shapeWaterMultiEffectTrackingV1Implemented, false);
  eq('20b. shapeWaterEffectChoiceV1Simplified = true (TODO acknowledged)',
    metadata.shapeWaterEffectChoiceV1Simplified, true);
  eq('20c. shapeWaterWaterFlowV1Implemented = false (TODO acknowledged)',
    metadata.shapeWaterWaterFlowV1Implemented, false);
  eq('20d. shapeWaterFreezeV1Implemented = false (TODO acknowledged)',
    metadata.shapeWaterFreezeV1Implemented, false);
  eq('20e. shapeWaterDurationV1Simplified = true (TODO acknowledged)',
    metadata.shapeWaterDurationV1Simplified, true);
  eq('20f. shapeWaterDismissalV1Implemented = false (TODO acknowledged)',
    metadata.shapeWaterDismissalV1Implemented, false);
  eq('20g. shapeWaterRangeEnforcementV1Simplified = true (TODO acknowledged)',
    metadata.shapeWaterRangeEnforcementV1Simplified, true);

  const caster = makeCombatant('druid', {
    wis: 18, // high WIS — would matter for spell save DC in canon (though Shape Water has no save)
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  eq('20h. NO _shapeWaterActiveEffects scratch field after cast',
    (caster as any)._shapeWaterActiveEffects, undefined);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Shape Water'),
  );
  assert('20i. cast log mentions v1 disclaimer (flavor-only)',
    castLog?.description.toLowerCase().includes('flavor-only') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// 21. metadata exposes concentration = false
// ============================================================
console.log('\n--- 21. concentration ---');
{
  eq('21a. concentration = false (instant or 1 hour — no concentration required)',
    metadata.concentration, false);
}

// ============================================================
// 22. metadata exposes castingTime = 'action'
// ============================================================
console.log('\n--- 22. castingTime ---');
{
  eq('22a. castingTime = action', metadata.castingTime, 'action');
}

// ============================================================
// 23. metadata exposes school = 'transmutation'
// ============================================================
console.log('\n--- 23. school ---');
{
  eq('23a. school = transmutation', metadata.school, 'transmutation');
}

// ============================================================
// 24. metadata exposes damageDice = null + damageType = null
// ============================================================
console.log('\n--- 24. damage null ---');
{
  eq('24a. damageDice = null', metadata.damageDice, null);
  eq('24b. damageType = null', metadata.damageType, null);
}

// ============================================================
// 25. metadata exposes name = 'Shape Water' (exact casing/spelling)
// ============================================================
console.log('\n--- 25. name exact ---');
{
  eq('25a. name = "Shape Water" (exact casing/spelling)', metadata.name, 'Shape Water');
  assert('25b. name has no leading/trailing whitespace',
    metadata.name === metadata.name.trim(),
    `got: "${metadata.name}"`);
  assert('25c. name contains a space (multi-word)',
    metadata.name.includes(' ') === true,
    `got: "${metadata.name}"`);
}

// ============================================================
// 26. applySelfEffect is idempotent — repeated calls emit one log each
// ============================================================
console.log('\n--- 26. idempotent ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);
  applySelfEffect(caster, state);
  applySelfEffect(caster, state);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('26a. three casts → three action logs', actionLogs.length, 3);

  eq('26b. no scratch fields after 3 casts',
    (caster as any)._shapeWaterActiveEffects, undefined);
}

// ============================================================
// 27. applySelfEffect handles caster with various stats (no stat dependency)
// ============================================================
console.log('\n--- 27. stat-independent ---');
{
  const lowWisCaster = makeCombatant('lowwis', { wis: 3 });
  const highWisCaster = makeCombatant('highwis', { wis: 20 });
  const lowDexCaster = makeCombatant('lowdex', { dex: 1 });

  const bf1 = makeBF([lowWisCaster]);
  const s1 = makeState(bf1);
  const r1 = applySelfEffect(lowWisCaster, s1);
  eq('27a. low-WIS caster: applySelfEffect returns true', r1, true);

  const bf2 = makeBF([highWisCaster]);
  const s2 = makeState(bf2);
  const r2 = applySelfEffect(highWisCaster, s2);
  eq('27b. high-WIS caster: applySelfEffect returns true', r2, true);

  const bf3 = makeBF([lowDexCaster]);
  const s3 = makeState(bf3);
  const r3 = applySelfEffect(lowDexCaster, s3);
  eq('27c. low-DEX caster: applySelfEffect returns true', r3, true);

  eq('27d. low-WIS caster: 1 action log',
    s1.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
  eq('27e. high-WIS caster: 1 action log',
    s2.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
  eq('27f. low-DEX caster: 1 action log',
    s3.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
}

// ============================================================
// 28. applySelfEffect handles caster at 0 HP (no HP requirement for flavor)
// ============================================================
console.log('\n--- 28. 0 HP caster ---');
{
  const caster = makeCombatant('druid', { currentHP: 0, maxHP: 40 });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = applySelfEffect(caster, state);
  eq('28a. caster at 0 HP: applySelfEffect returns true', ret, true);
  eq('28b. caster at 0 HP: 1 action log emitted',
    state.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
}

// ============================================================
// 29. applySelfEffect handles dead caster (engine doesn't gate — engine's job)
// ============================================================
console.log('\n--- 29. dead caster ---');
{
  const caster = makeCombatant('druid', { isDead: true });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = applySelfEffect(caster, state);
  eq('29a. dead caster: applySelfEffect returns true (engine gates, not cantrip)', ret, true);
  eq('29b. dead caster: 1 action log emitted',
    state.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
}

// ============================================================
// 30. applySelfEffect is robust to undefined optional fields on caster
// ============================================================
console.log('\n--- 30. robust to undefined optional fields ---');
{
  const caster = makeCombatant('minimal', {
    concentration: null,
    deathSaves: null,
    resources: null,
    mountedOn: null,
    carriedBy: null,
    bonded: null,
    wardingBond: null,
    bardicInspirationDie: null,
    tempHP: 0,
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = applySelfEffect(caster, state);
  eq('30a. minimal caster: applySelfEffect returns true', ret, true);
  eq('30b. minimal caster: 1 action log emitted',
    state.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);

  const actionLog = state.log.events.find((e: CombatEvent) => e.type === 'action');
  assert('30c. minimal caster: log mentions caster name',
    actionLog?.description.includes('minimal') === true,
    `got: ${actionLog?.description}`);
}

// ============================================================
// 31. Shape Water mirrors Control Flames / Mold Earth — verify metadata shape parity
// ============================================================
console.log('\n--- 31. metadata shape parity with Control Flames / Mold Earth ---');
{
  // Shape Water is the water-element variant of Control Flames (fire) / Mold Earth (earth).
  // All three are XGE elemental-utility cantrips with S-only components, multi-effect,
  // instant-or-1-hour duration, no concentration.
  const { metadata: cfMeta } = require('../spells/control_flames');
  const { metadata: meMeta } = require('../spells/mold_earth');

  eq('31a. Shape Water school === Control Flames school (both transmutation)',
    metadata.school, cfMeta.school);
  eq('31b. Shape Water school === Mold Earth school (both transmutation)',
    metadata.school, meMeta.school);
  eq('31c. Shape Water components.s === Control Flames components.s (both true)',
    metadata.components.s, cfMeta.components.s);
  eq('31d. Shape Water components.s === Mold Earth components.s (both true)',
    metadata.components.s, meMeta.components.s);
  eq('31e. Shape Water isSelfBuff === Control Flames isSelfBuff (both true)',
    metadata.isSelfBuff, cfMeta.isSelfBuff);
  eq('31f. Shape Water isSelfBuff === Mold Earth isSelfBuff (both true)',
    metadata.isSelfBuff, meMeta.isSelfBuff);
  eq('31g. Shape Water scales === Control Flames scales (both false)',
    metadata.scales, cfMeta.scales);
  eq('31h. Shape Water concentration === Control Flames concentration (both false)',
    metadata.concentration, cfMeta.concentration);
  // Range: Shape Water 30 ft, Control Flames 60 ft, Mold Earth 30 ft.
  eq('31i. Shape Water rangeFt (30) === Mold Earth rangeFt (30)',
    metadata.rangeFt, meMeta.rangeFt);
  assert('31j. Shape Water rangeFt (30) differs from Control Flames rangeFt (60)',
    metadata.rangeFt !== cfMeta.rangeFt,
    `got Shape Water=${metadata.rangeFt}, Control Flames=${cfMeta.rangeFt}`);
  // Both have multi-effect tracking + effect-choice + duration + dismissal + range flags.
  eq('31k. Shape Water multiEffect flag === Mold Earth multiEffect flag (both false)',
    metadata.shapeWaterMultiEffectTrackingV1Implemented, meMeta.moldEarthMultiEffectTrackingV1Implemented);
  eq('31l. Shape Water effectChoice flag === Mold Earth effectChoice flag (both true)',
    metadata.shapeWaterEffectChoiceV1Simplified, meMeta.moldEarthEffectChoiceV1Simplified);
  eq('31m. Shape Water duration flag === Mold Earth duration flag (both true)',
    metadata.shapeWaterDurationV1Simplified, meMeta.moldEarthDurationV1Simplified);
  eq('31n. Shape Water dismissal flag === Mold Earth dismissal flag (both false)',
    metadata.shapeWaterDismissalV1Implemented, meMeta.moldEarthDismissalV1Implemented);
  eq('31o. Shape Water range flag === Mold Earth range flag (both true)',
    metadata.shapeWaterRangeEnforcementV1Simplified, meMeta.moldEarthRangeEnforcementV1Simplified);
}

// ============================================================
// 32. FINAL cantrip in the workstream — verify the 3 S-only XGE elemental-utility cantrips
// (Gust is V+S per canon, NOT S-only — the handover's "all 4 are S-only" claim was incorrect)
// ============================================================
console.log('\n--- 32. FINAL cantrip — verify the 3 S-only XGE elemental-utility cantrips ---');
{
  // Shape Water is the FINAL cantrip in the workstream.
  // 3 of the 4 XGE elemental-utility cantrips (Control Flames, Mold Earth, Shape Water)
  // are S-only per the 5etools JSON {"s":true}.
  // Gust (the 4th) is V+S per the 5etools JSON {"v":true,"s":true} — the handover's
  // claim that "all 4 are S-only" was INCORRECT; only 3 are S-only.
  // Gust was implemented in Session 10 with combat mechanics (push-AWAY forced movement);
  // the other three are flavor-only (this session).
  const { metadata: cfMeta } = require('../spells/control_flames');
  const { metadata: meMeta } = require('../spells/mold_earth');
  const { metadata: gustMeta } = require('../spells/gust');

  // Verify the 3 flavor-only elemental-utility cantrips are S-only.
  eq('32a. Control Flames is S-only', cfMeta.components.s, true);
  eq('32b. Mold Earth is S-only', meMeta.components.s, true);
  eq('32c. Shape Water is S-only', metadata.components.s, true);

  // Verify the 3 flavor-only elemental-utility cantrips have NO V and NO M.
  eq('32d. Control Flames has NO V', cfMeta.components.v, false);
  eq('32e. Control Flames has NO M', cfMeta.components.m, false);
  eq('32f. Mold Earth has NO V', meMeta.components.v, false);
  eq('32g. Mold Earth has NO M', meMeta.components.m, false);
  eq('32h. Shape Water has NO V', metadata.components.v, false);
  eq('32i. Shape Water has NO M', metadata.components.m, false);

  // Verify Gust is V+S (NOT S-only — canon 5etools JSON: {"v":true,"s":true}).
  eq('32j. Gust has V (canon 5etools JSON: {"v":true,"s":true})', gustMeta.components.v, true);
  eq('32k. Gust has S (canon 5etools JSON: {"v":true,"s":true})', gustMeta.components.s, true);
  eq('32l. Gust has NO M', gustMeta.components.m, false);

  // Verify Shape Water is the FINAL cantrip — it should be the 17th self-buff
  // (the cantrip workstream is COMPLETE after this cantrip).
  eq('32m. Shape Water level = 0 (cantrip)', metadata.level, 0);
  eq('32n. Shape Water isSelfBuff = true (self-buff cantrip)', metadata.isSelfBuff, true);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
