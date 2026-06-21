// ============================================================
// Test: Thaumaturgy Cantrip
// PHB p.282 — Level 0 transmutation cantrip (self-buff: flavor log only, no mechanical effect in v1)
//
// CANON components note: Thaumaturgy is V-only (NO S, NO M) per the 5etools
// JSON {"v":true}. This is unusual — most cantrips have at least S. The
// V-only components reflect the spell's divine-themed flavor (the caster
// speaks a word of power).
//
// v1 simplifications (all documented via metadata flags):
//   - Effect choice: canonically the caster chooses 1 of 6 magical effects
//     → v1: emits a single "manifests a minor supernatural sign" log
//     without choosing (the log mentions all 6 options).
//   - Multi-effect tracking: canonically up to 3 1-minute effects active
//     simultaneously → v1: no persistent-effect-tracking subsystem.
//   - Dismissal: canonically "dismiss such an effect as an action" → v1:
//     no dismissal action.
//   - Duration: canonically up to 1 minute → v1: 1-round (cleanup is a
//     no-op since there's no persistent state).
//   - Range: canonically 30 ft → v1: does NOT enforce range.
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (V only — NO S, NO M, canon per 5etools JSON)
//   3. metadata exposes isSelfBuff = true
//   4. metadata exposes v1 simplification flags
//   5. metadata does NOT scale (6 magical effects are flat)
//   6. metadata exposes rangeFt = 30 (canon)
//   7. applySelfEffect emits a single flavor log + returns true
//   8. applySelfEffect sets NO scratch fields (v1 has no persistent state)
//   9. applySelfEffect emits NO attack/damage events
//  10. resolveCantripAction integration — 'Thaumaturgy' routes to applySelfEffect
//  11. dispatcher safety — unknown cantrip name is a no-op
//  12. cleanup is a no-op (no scratch fields, no persistent state)
//  13. resetBudget integration — cleanup is a no-op
//  14. Thaumaturgy itself does NOT go through resolveAttack (self-buff)
//  15. resolveCantripAoE returns false (not a caster-centered AoE)
//  16. resolveCantripTouchEffect returns false (not a touch-effect)
//  17. no CANTRIP_EFFECTS entry (not a post-hit rider)
//  18. NO new Combatant fields (v1 has no scratch fields)
//  19. flavor log mentions "supernatural sign" or "manifest" + at least one of the 6 options
//  20. v1 simplification flags document the missing mechanics
//
// Run: npx ts-node src/test/thaumaturgy.test.ts
// ============================================================

import { metadata, applySelfEffect, cleanup } from '../spells/thaumaturgy';
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

// A Thaumaturgy Action — self-buff (flavor-only), no target, no attack roll, no save.
const THAUMATURGY_ACTION: Action = {
  name: 'Thaumaturgy',
  isMultiattack: false,
  attackType: 'special', // self-buff — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 30, long: 0 }, // 30 ft (canon PHB p.282)
  hitBonus: null,
  damage: null, // no damage — the cantrip manifests a minor supernatural sign (flavor only)
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Thaumaturgy',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Thaumaturgy');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'transmutation');
  eq('1d. rangeFt (30 — canon PHB p.282)', metadata.rangeFt, 30);
  eq('1e. damageDice null (no damage — utility only)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. not concentration (no concentration required)', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. components: V only (NO S, NO M) — PHB p.282, canon per 5etools JSON
// ============================================================
console.log('\n--- 2. components ---');
{
  eq('2a. verbal component', metadata.components.v, true);
  eq('2b. NO somatic component (canon 5etools JSON: {"v":true})',
    metadata.components.s, false);
  eq('2c. NO material component (canon 5etools JSON: {"v":true})',
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
  eq('4a. thaumaturgyEffectChoiceV1Simplified = true (canon: choose 1 of 6; v1: single log)',
    metadata.thaumaturgyEffectChoiceV1Simplified, true);
  eq('4b. thaumaturgyMultiEffectTrackingV1Implemented = false (no persistent-effect-tracking subsystem)',
    metadata.thaumaturgyMultiEffectTrackingV1Implemented, false);
  eq('4c. thaumaturgyDismissalV1Implemented = false (no dismissal action)',
    metadata.thaumaturgyDismissalV1Implemented, false);
  eq('4d. thaumaturgyDurationV1Simplified = true (canon: up to 1 min; v1: 1 round)',
    metadata.thaumaturgyDurationV1Simplified, true);
  eq('4e. thaumaturgyRangeEnforcementV1Simplified = true (canon: 30 ft; v1: no range check)',
    metadata.thaumaturgyRangeEnforcementV1Simplified, true);
}

// ============================================================
// 5. metadata does NOT scale (6 magical effects are flat)
// ============================================================
console.log('\n--- 5. no scaling ---');
{
  eq('5a. scales = false (Thaumaturgy does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 6. metadata exposes rangeFt = 30 (canon)
// ============================================================
console.log('\n--- 6. rangeFt ---');
{
  eq('6a. rangeFt = 30 (canon PHB p.282: "within range" — 30 ft)', metadata.rangeFt, 30);
}

// ============================================================
// 7. applySelfEffect emits a single flavor log + returns true
// ============================================================
console.log('\n--- 7. applySelfEffect ---');
{
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = applySelfEffect(caster, state);
  eq('7a. applySelfEffect returns true', ret, true);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('7b. exactly 1 action log emitted (flavor)', actionLogs.length, 1);
  assert('7c. action log mentions Thaumaturgy',
    actionLogs[0]?.description.includes('Thaumaturgy') === true,
    `got: ${actionLogs[0]?.description}`);
}

// ============================================================
// 8. applySelfEffect sets NO scratch fields (v1 has no persistent state)
// ============================================================
console.log('\n--- 8. no scratch fields ---');
{
  const caster = makeCombatant('cleric');
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
  const caster = makeCombatant('cleric');
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
// 10. resolveCantripAction integration — 'Thaumaturgy' routes to applySelfEffect
// ============================================================
console.log('\n--- 10. resolveCantripAction integration ---');
{
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Thaumaturgy', state);
  eq('10a. resolveCantripAction returns true', ret, true);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('10b. exactly 1 action log emitted via dispatcher', actionLogs.length, 1);
  assert('10c. action log mentions Thaumaturgy',
    actionLogs[0]?.description.includes('Thaumaturgy') === true,
    `got: ${actionLogs[0]?.description}`);
}

// ============================================================
// 11. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 11. dispatcher safety ---');
{
  const caster = makeCombatant('cleric');
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
  const caster = makeCombatant('cleric');
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
  const caster = makeCombatant('cleric');
  // Apply Thaumaturgy (sets no scratch fields, just emits a log).
  const bf = makeBF([caster]);
  const state = makeState(bf);
  applySelfEffect(caster, state);

  // resetBudget calls cleanup(Thaumaturgy) which is a no-op.
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
// 14. Thaumaturgy itself does NOT go through resolveAttack (self-buff)
// ============================================================
console.log('\n--- 14. Thaumaturgy bypasses resolveAttack ---');
{
  const caster = makeCombatant('cleric', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [THAUMATURGY_ACTION],
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  resolveCantripAction(caster, 'Thaumaturgy', state);

  // Only the "casts Thaumaturgy" action event should be present.
  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('14a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('14b. action event mentions Thaumaturgy',
    actionEvents[0]?.description.includes('Thaumaturgy') === true,
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
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Thaumaturgy', state);
  eq('15a. resolveCantripAoE returns false', ret, false);
  eq('15b. no log events', state.log.events.length, 0);
}

// ============================================================
// 16. resolveCantripTouchEffect returns false (not a touch-effect)
// ============================================================
console.log('\n--- 16. not a touch-effect ---');
{
  const caster = makeCombatant('cleric');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const ret = resolveCantripTouchEffect(caster, target, 'Thaumaturgy', state);
  eq('16a. resolveCantripTouchEffect returns false', ret, false);
  eq('16b. no log events', state.log.events.length, 0);
}

// ============================================================
// 17. no CANTRIP_EFFECTS entry (not a post-hit rider)
// ============================================================
console.log('\n--- 17. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('cleric');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Thaumaturgy', state);
  eq('17a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);
}

// ============================================================
// 18. NO new Combatant fields (v1 has no scratch fields)
// ============================================================
console.log('\n--- 18. no new Combatant fields ---');
{
  // Thaumaturgy v1 introduces NO new scratch fields on Combatant.
  // The cantrip is metadata-only — applySelfEffect just emits a log event.
  // Verify by checking that none of the v1 cantrip scratch fields are set
  // after casting Thaumaturgy.
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  // v1: no Thaumaturgy-specific scratch field exists.
  // (If we wanted to add one in the future, it would be something like
  // `_thaumaturgyEffectsActive?: number`. v1 does NOT have it.)
  eq('18a. no _thaumaturgyEffectsActive field (v1 has no persistent state)',
    (caster as any)._thaumaturgyEffectsActive, undefined);
}

// ============================================================
// 19. flavor log mentions "supernatural sign" or "manifest" + at least one of the 6 options
// ============================================================
console.log('\n--- 19. flavor log ---');
{
  const caster = makeCombatant('cleric', { name: 'Cleric Cleo' });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Thaumaturgy'),
  );
  assert('19a. cast log mentions caster name',
    castLog?.description.includes('Cleric Cleo') === true,
    `got: ${castLog?.description}`);
  assert('19b. cast log mentions "casts Thaumaturgy"',
    castLog?.description.includes('casts Thaumaturgy') === true,
    `got: ${castLog?.description}`);
  assert('19c. cast log mentions "supernatural sign" or "manifest"',
    castLog?.description.toLowerCase().includes('supernatural sign') === true ||
    castLog?.description.toLowerCase().includes('manifest') === true,
    `got: ${castLog?.description}`);
  // Verify the log mentions at least one of the 6 canon effect categories.
  const lowerDesc = castLog?.description.toLowerCase() ?? '';
  const mentionsEffectCategory =
    lowerDesc.includes('voice') ||
    lowerDesc.includes('flame') ||
    lowerDesc.includes('tremor') ||
    lowerDesc.includes('sound') ||
    lowerDesc.includes('door') ||
    lowerDesc.includes('eyes');
  assert('19d. cast log mentions at least one of (voice/flame/tremor/sound/door/eyes)',
    mentionsEffectCategory,
    `got: ${castLog?.description}`);
}

// ============================================================
// 20. v1 simplification flags document the missing mechanics
// ============================================================
console.log('\n--- 20. v1 simplification flags document missing mechanics ---');
{
  // Verify the metadata flags are set (forward-compat TODO acknowledged).
  eq('20a. thaumaturgyMultiEffectTrackingV1Implemented = false (TODO acknowledged)',
    metadata.thaumaturgyMultiEffectTrackingV1Implemented, false);
  eq('20b. thaumaturgyEffectChoiceV1Simplified = true (TODO acknowledged)',
    metadata.thaumaturgyEffectChoiceV1Simplified, true);
  eq('20c. thaumaturgyDismissalV1Implemented = false (TODO acknowledged)',
    metadata.thaumaturgyDismissalV1Implemented, false);

  // Verify no persistent-effect-tracking state is created in v1.
  const caster = makeCombatant('cleric', {
    wis: 18, // high WIS — would matter for spell save DC in canon
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  // v1: NO persistent-effect-tracking state is created (no scratch fields).
  eq('20d. NO _thaumaturgyEffectsActive scratch field after cast',
    (caster as any)._thaumaturgyEffectsActive, undefined);

  // Verify the cast log mentions the v1 simplification disclaimer.
  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Thaumaturgy'),
  );
  assert('20e. cast log mentions v1 disclaimer (flavor-only)',
    castLog?.description.toLowerCase().includes('flavor-only') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
