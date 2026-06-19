// ============================================================
// Test: Control Flames Cantrip
// XGE p.152 — Level 0 transmutation cantrip (self-buff: flavor log only, no mechanical effect in v1)
//
// v1 simplifications (all documented via metadata flags):
//   - Effect choice: canonically choose 1 of 4 (expand/extinguish/light/shape)
//     → v1: emit single "manipulates a nonmagical flame" log.
//   - Multi-effect tracking: canonically up to 3 non-instantaneous effects active
//     → v1: no persistent-effect-tracking subsystem.
//   - Duration: canonically instant or up to 1 hour → v1: 1-round flavor log.
//   - Dismissal: canonically dismiss as action → v1: no dismissal action.
//   - Nonmagical-flame requirement: canonically nonmagical flame only
//     → v1: no flame-type-tracking subsystem.
//   - Range: canonically 60 ft → v1: does NOT enforce range.
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (S only — NO V, NO M — FIRST S-only cantrip in the workstream)
//   3. metadata exposes isSelfBuff = true
//   4. metadata exposes v1 simplification flags
//   5. metadata does NOT scale (the 4 effects are flat)
//   6. metadata exposes rangeFt = 60 (canon)
//   7. applySelfEffect emits a single flavor log + returns true
//   8. applySelfEffect sets NO scratch fields (v1 has no persistent state)
//   9. applySelfEffect emits NO attack/damage events
//  10. resolveCantripAction integration — 'Control Flames' routes to applySelfEffect
//  11. dispatcher safety — unknown cantrip name is a no-op
//  12. cleanup is a no-op (no scratch fields, no persistent state)
//  13. resetBudget integration — cleanup is a no-op
//  14. Control Flames itself does NOT go through resolveAttack (self-buff)
//  15. resolveCantripAoE returns false (not a caster-centered AoE)
//  16. resolveCantripTouchEffect returns false (not a touch-effect)
//  17. no CANTRIP_EFFECTS entry (not a post-hit rider)
//  18. NO new Combatant fields (v1 has no scratch fields)
//  19. flavor log mentions "flame" + at least one of (expand/extinguish/light/shape)
//  20. v1 simplification flags document the missing mechanics
//  21. metadata exposes concentration = false
//  22. metadata exposes castingTime = 'action'
//  23. metadata exposes school = 'transmutation'
//  24. metadata exposes damageDice = null + damageType = null
//  25. metadata exposes name = 'Control Flames' (exact casing/spelling)
//  26. applySelfEffect is idempotent — repeated calls emit one log each
//  27. applySelfEffect handles caster with various stats (no stat dependency)
//  28. applySelfEffect handles caster at 0 HP (no HP requirement for flavor)
//  29. applySelfEffect handles dead caster (engine doesn't gate — engine's job)
//  30. applySelfEffect is robust to undefined optional fields on caster
//
// Run: npx ts-node src/test/control_flames.test.ts
// ============================================================

import { metadata, applySelfEffect, cleanup } from '../spells/control_flames';
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

// A Control Flames Action — self-buff (flavor-only), no target, no attack roll, no save.
const CONTROL_FLAMES_ACTION: Action = {
  name: 'Control Flames',
  isMultiattack: false,
  attackType: 'special', // self-buff — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 60, long: 0 }, // 60 ft (canon XGE p.152)
  hitBonus: null,
  damage: null, // no damage — the cantrip manipulates a nonmagical flame (flavor only)
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Control Flames',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Control Flames');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'transmutation');
  eq('1d. rangeFt (60 — canon XGE p.152)', metadata.rangeFt, 60);
  eq('1e. damageDice null (no damage — utility only)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. not concentration (instant or 1 hour — no concentration required)', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. components: S only (NO V, NO M) — XGE p.152, canon per 5etools JSON
//    THIS IS THE FIRST S-ONLY CANTRIP IN THE WORKSTREAM.
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
  eq('4a. controlFlamesMultiEffectTrackingV1Implemented = false (no persistent-effect-tracking subsystem)',
    metadata.controlFlamesMultiEffectTrackingV1Implemented, false);
  eq('4b. controlFlamesEffectChoiceV1Simplified = true (canon: choose 1 of 4; v1: single log)',
    metadata.controlFlamesEffectChoiceV1Simplified, true);
  eq('4c. controlFlamesDurationV1Simplified = true (canon: instant or 1 hour; v1: 1 round)',
    metadata.controlFlamesDurationV1Simplified, true);
  eq('4d. controlFlamesDismissalV1Implemented = false (no dismissal action)',
    metadata.controlFlamesDismissalV1Implemented, false);
  eq('4e. controlFlamesNonMagicalFlameRequirementV1Simplified = true (canon: nonmagical flame only; v1: no flame-type check)',
    metadata.controlFlamesNonMagicalFlameRequirementV1Simplified, true);
  eq('4f. controlFlamesRangeEnforcementV1Simplified = true (canon: 60 ft; v1: no range check)',
    metadata.controlFlamesRangeEnforcementV1Simplified, true);
}

// ============================================================
// 5. metadata does NOT scale (the 4 effects are flat)
// ============================================================
console.log('\n--- 5. no scaling ---');
{
  eq('5a. scales = false (Control Flames does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 6. metadata exposes rangeFt = 60 (canon)
// ============================================================
console.log('\n--- 6. rangeFt ---');
{
  eq('6a. rangeFt = 60 (canon XGE p.152: "within range" — 60 ft)', metadata.rangeFt, 60);
}

// ============================================================
// 7. applySelfEffect emits a single flavor log + returns true
// ============================================================
console.log('\n--- 7. applySelfEffect ---');
{
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = applySelfEffect(caster, state);
  eq('7a. applySelfEffect returns true', ret, true);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('7b. exactly 1 action log emitted (flavor)', actionLogs.length, 1);
  assert('7c. action log mentions Control Flames',
    actionLogs[0]?.description.includes('Control Flames') === true,
    `got: ${actionLogs[0]?.description}`);
}

// ============================================================
// 8. applySelfEffect sets NO scratch fields (v1 has no persistent state)
// ============================================================
console.log('\n--- 8. no scratch fields ---');
{
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  // Snapshot the caster's keys before cast.
  const beforeKeys = Object.keys(caster).sort();

  applySelfEffect(caster, state);

  // Snapshot after cast.
  const afterKeys = Object.keys(caster).sort();

  // v1 sets NO scratch fields — the caster's keys should be unchanged.
  eq('8a. caster keys unchanged after cast (no new scratch fields)',
    JSON.stringify(afterKeys), JSON.stringify(beforeKeys));

  // Specifically verify none of the existing cantrip scratch fields are set.
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
  const caster = makeCombatant('wizard');
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
// 10. resolveCantripAction integration — 'Control Flames' routes to applySelfEffect
// ============================================================
console.log('\n--- 10. resolveCantripAction integration ---');
{
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Control Flames', state);
  eq('10a. resolveCantripAction returns true', ret, true);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('10b. exactly 1 action log emitted via dispatcher', actionLogs.length, 1);
  assert('10c. action log mentions Control Flames',
    actionLogs[0]?.description.includes('Control Flames') === true,
    `got: ${actionLogs[0]?.description}`);
}

// ============================================================
// 11. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 11. dispatcher safety ---');
{
  const caster = makeCombatant('wizard');
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
  const caster = makeCombatant('wizard');
  // Snapshot before cleanup.
  const before = JSON.stringify(caster);

  cleanup(caster);

  // Snapshot after cleanup.
  const after = JSON.stringify(caster);

  eq('12a. cleanup is a no-op (caster state unchanged)',
    after, before);
}

// ============================================================
// 13. resetBudget integration — cleanup is a no-op
// ============================================================
console.log('\n--- 13. resetBudget integration ---');
{
  const caster = makeCombatant('wizard');
  // Apply Control Flames (sets no scratch fields, just emits a log).
  const bf = makeBF([caster]);
  const state = makeState(bf);
  applySelfEffect(caster, state);

  // resetBudget calls cleanup(Control Flames) which is a no-op.
  // The caster's state should be unchanged (no scratch fields to clear).
  // We just verify resetBudget doesn't crash and the caster has no scratch fields.
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
// 14. Control Flames itself does NOT go through resolveAttack (self-buff)
// ============================================================
console.log('\n--- 14. Control Flames bypasses resolveAttack ---');
{
  const caster = makeCombatant('wizard', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [CONTROL_FLAMES_ACTION],
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  resolveCantripAction(caster, 'Control Flames', state);

  // Only the "casts Control Flames" action event should be present.
  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('14a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('14b. action event mentions Control Flames',
    actionEvents[0]?.description.includes('Control Flames') === true,
    `got: ${actionEvents[0]?.description}`);

  // No attack hit/miss/crit/damage events.
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
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Control Flames', state);
  eq('15a. resolveCantripAoE returns false', ret, false);
  eq('15b. no log events', state.log.events.length, 0);
}

// ============================================================
// 16. resolveCantripTouchEffect returns false (not a touch-effect)
// ============================================================
console.log('\n--- 16. not a touch-effect ---');
{
  const caster = makeCombatant('wizard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const ret = resolveCantripTouchEffect(caster, target, 'Control Flames', state);
  eq('16a. resolveCantripTouchEffect returns false', ret, false);
  eq('16b. no log events', state.log.events.length, 0);
}

// ============================================================
// 17. no CANTRIP_EFFECTS entry (not a post-hit rider)
// ============================================================
console.log('\n--- 17. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('wizard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Control Flames', state);
  eq('17a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);
}

// ============================================================
// 18. NO new Combatant fields (v1 has no scratch fields)
// ============================================================
console.log('\n--- 18. no new Combatant fields ---');
{
  // Control Flames v1 introduces NO new scratch fields on Combatant.
  // The cantrip is metadata-only — applySelfEffect just emits a log event.
  // Verify by checking that none of the v1 cantrip scratch fields are set
  // after casting Control Flames.
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  // v1: no Control-Flames-specific scratch field exists.
  // (If we wanted to add one in the future, it would be something like
  // `_controlFlamesActiveEffects?: number`. v1 does NOT have it.)
  eq('18a. no _controlFlamesActiveEffects field (v1 has no persistent state)',
    (caster as any)._controlFlamesActiveEffects, undefined);
}

// ============================================================
// 19. flavor log mentions "flame" + at least one of (expand/extinguish/light/shape)
// ============================================================
console.log('\n--- 19. flavor log ---');
{
  const caster = makeCombatant('wizard', { name: 'Wizard Wren' });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Control Flames'),
  );
  assert('19a. cast log mentions caster name',
    castLog?.description.includes('Wren') === true,
    `got: ${castLog?.description}`);
  assert('19b. cast log mentions "casts Control Flames"',
    castLog?.description.includes('casts Control Flames') === true,
    `got: ${castLog?.description}`);
  assert('19c. cast log mentions "flame"',
    castLog?.description.toLowerCase().includes('flame') === true,
    `got: ${castLog?.description}`);
  // At least one of (expand/extinguish/light/shape) should appear.
  const lowerDesc = castLog?.description.toLowerCase() ?? '';
  const hasAtLeastOneEffect = ['expand', 'extinguish', 'light', 'shape'].some(w => lowerDesc.includes(w));
  assert('19d. cast log mentions at least one of (expand/extinguish/light/shape)',
    hasAtLeastOneEffect, `got: ${castLog?.description}`);
}

// ============================================================
// 20. v1 simplification flags document the missing mechanics
// ============================================================
console.log('\n--- 20. v1 simplification flags document missing mechanics ---');
{
  // Verify the metadata flags are set (forward-compat TODO acknowledged).
  eq('20a. controlFlamesMultiEffectTrackingV1Implemented = false (TODO acknowledged)',
    metadata.controlFlamesMultiEffectTrackingV1Implemented, false);
  eq('20b. controlFlamesEffectChoiceV1Simplified = true (TODO acknowledged)',
    metadata.controlFlamesEffectChoiceV1Simplified, true);
  eq('20c. controlFlamesDurationV1Simplified = true (TODO acknowledged)',
    metadata.controlFlamesDurationV1Simplified, true);
  eq('20d. controlFlamesDismissalV1Implemented = false (TODO acknowledged)',
    metadata.controlFlamesDismissalV1Implemented, false);
  eq('20e. controlFlamesNonMagicalFlameRequirementV1Simplified = true (TODO acknowledged)',
    metadata.controlFlamesNonMagicalFlameRequirementV1Simplified, true);
  eq('20f. controlFlamesRangeEnforcementV1Simplified = true (TODO acknowledged)',
    metadata.controlFlamesRangeEnforcementV1Simplified, true);

  // Verify no multi-effect state is created in v1.
  const caster = makeCombatant('wizard', {
    int: 18, // high INT — would matter for spell save DC in canon
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  // v1: NO multi-effect state is created (no scratch fields).
  eq('20g. NO _controlFlamesActiveEffects scratch field after cast',
    (caster as any)._controlFlamesActiveEffects, undefined);

  // Verify the cast log mentions the v1 simplification disclaimer.
  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Control Flames'),
  );
  assert('20h. cast log mentions v1 disclaimer (flavor-only)',
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
// 25. metadata exposes name = 'Control Flames' (exact casing/spelling)
// ============================================================
console.log('\n--- 25. name exact ---');
{
  eq('25a. name = "Control Flames" (exact casing/spelling)', metadata.name, 'Control Flames');
  // CRITICAL: the registry key in CANTRIP_SELF_EFFECTS MUST match this exactly.
  // A typo here (e.g. 'Control Flame' singular) would break routing.
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
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);
  applySelfEffect(caster, state);
  applySelfEffect(caster, state);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('26a. three casts → three action logs', actionLogs.length, 3);

  // No scratch fields set after 3 casts.
  eq('26b. no scratch fields after 3 casts',
    (caster as any)._controlFlamesActiveEffects, undefined);
}

// ============================================================
// 27. applySelfEffect handles caster with various stats (no stat dependency)
// ============================================================
console.log('\n--- 27. stat-independent ---');
{
  // Control Flames doesn't use any stat for save DC (no save in v1) or attack roll.
  // Verify applySelfEffect works regardless of caster stats.
  const lowIntCaster = makeCombatant('lowint', { int: 3 });
  const highIntCaster = makeCombatant('highint', { int: 20 });
  const noChaCaster = makeCombatant('nocha', { cha: 1 });

  const bf1 = makeBF([lowIntCaster]);
  const s1 = makeState(bf1);
  const r1 = applySelfEffect(lowIntCaster, s1);
  eq('27a. low-INT caster: applySelfEffect returns true', r1, true);

  const bf2 = makeBF([highIntCaster]);
  const s2 = makeState(bf2);
  const r2 = applySelfEffect(highIntCaster, s2);
  eq('27b. high-INT caster: applySelfEffect returns true', r2, true);

  const bf3 = makeBF([noChaCaster]);
  const s3 = makeState(bf3);
  const r3 = applySelfEffect(noChaCaster, s3);
  eq('27c. low-CHA caster: applySelfEffect returns true', r3, true);

  // All three should emit exactly 1 action log.
  eq('27d. low-INT caster: 1 action log',
    s1.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
  eq('27e. high-INT caster: 1 action log',
    s2.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
  eq('27f. low-CHA caster: 1 action log',
    s3.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
}

// ============================================================
// 28. applySelfEffect handles caster at 0 HP (no HP requirement for flavor)
// ============================================================
console.log('\n--- 28. 0 HP caster ---');
{
  const caster = makeCombatant('wizard', { currentHP: 0, maxHP: 40 });
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
  // v1 does NOT gate on caster.isDead — that's the engine's job (executePlannedAction).
  // The cantrip module just emits a log. If the engine routed to it, it fires.
  const caster = makeCombatant('wizard', { isDead: true });
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
  // Construct a caster with minimal fields — applySelfEffect should still work.
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

  // Verify the log description still contains the caster's name.
  const actionLog = state.log.events.find((e: CombatEvent) => e.type === 'action');
  assert('30c. minimal caster: log mentions caster name',
    actionLog?.description.includes('minimal') === true,
    `got: ${actionLog?.description}`);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
