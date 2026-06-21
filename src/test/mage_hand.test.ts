// ============================================================
// Test: Mage Hand Cantrip
// PHB p.256 — Level 0 conjuration cantrip (self-buff: flavor log only, no mechanical effect in v1)
//
// v1 simplifications (all documented via metadata flags):
//   - Persistent hand: canonically a spectral hand persists for 1 minute
//     and is controllable with subsequent actions → v1: emits a single
//     "spectral floating hand appears" log without persistent tracking.
//   - Remote interaction: canonically the caster can use actions to
//     manipulate objects, open doors, stow/retrieve items, pour vials,
//     move the hand 30 ft → v1: no remote-interaction subsystem.
//   - Dismissal: canonically "dismiss it as an action" → v1: no
//     dismissal action.
//   - Carry weight: canonically 10 lb carry limit → v1: no carry-weight
//     subsystem.
//   - Duration: canonically 1 minute → v1: 1-round (cleanup is a no-op
//     since there's no persistent state).
//   - Range: canonically 30 ft → v1: does NOT enforce range.
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (V + S, NO M, canon per 5etools JSON)
//   3. metadata exposes isSelfBuff = true
//   4. metadata exposes v1 simplification flags
//   5. metadata does NOT scale (hand capabilities are flat)
//   6. metadata exposes rangeFt = 30 (canon)
//   7. applySelfEffect emits a single flavor log + returns true
//   8. applySelfEffect sets NO scratch fields (v1 has no persistent state)
//   9. applySelfEffect emits NO attack/damage events
//  10. resolveCantripAction integration — 'Mage Hand' routes to applySelfEffect
//  11. dispatcher safety — unknown cantrip name is a no-op
//  12. cleanup is a no-op (no scratch fields, no persistent state)
//  13. resetBudget integration — cleanup is a no-op
//  14. Mage Hand itself does NOT go through resolveAttack (self-buff)
//  15. resolveCantripAoE returns false (not a caster-centered AoE)
//  16. resolveCantripTouchEffect returns false (not a touch-effect)
//  17. no CANTRIP_EFFECTS entry (not a post-hit rider)
//  18. NO new Combatant fields (v1 has no scratch fields)
//  19. flavor log mentions "spectral" + "hand"
//  20. v1 simplification flags document the missing mechanics
//
// Run: npx ts-node src/test/mage_hand.test.ts
// ============================================================

import { metadata, applySelfEffect, cleanup } from '../spells/mage_hand';
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

// A Mage Hand Action — self-buff (flavor-only), no target, no attack roll, no save.
const MAGE_HAND_ACTION: Action = {
  name: 'Mage Hand',
  isMultiattack: false,
  attackType: 'special', // self-buff — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 30, long: 0 }, // 30 ft (canon PHB p.256)
  hitBonus: null,
  damage: null, // no damage — the cantrip conjures a spectral hand (flavor only)
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Mage Hand',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Mage Hand');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'conjuration');
  eq('1d. rangeFt (30 — canon PHB p.256)', metadata.rangeFt, 30);
  eq('1e. damageDice null (no damage — utility only)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. not concentration (no concentration required)', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. components: V + S (NO M) — PHB p.256, canon per 5etools JSON
// ============================================================
console.log('\n--- 2. components ---');
{
  eq('2a. verbal component', metadata.components.v, true);
  eq('2b. somatic component', metadata.components.s, true);
  eq('2c. NO material component (canon 5etools JSON: {"v":true,"s":true})',
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
  eq('4a. mageHandPersistentHandV1Simplified = true (canon: persistent hand; v1: single log)',
    metadata.mageHandPersistentHandV1Simplified, true);
  eq('4b. mageHandRemoteInteractionV1Implemented = false (no remote-interaction subsystem)',
    metadata.mageHandRemoteInteractionV1Implemented, false);
  eq('4c. mageHandDismissalV1Implemented = false (no dismissal action)',
    metadata.mageHandDismissalV1Implemented, false);
  eq('4d. mageHandCarryWeightLimitV1Implemented = false (no carry-weight subsystem)',
    metadata.mageHandCarryWeightLimitV1Implemented, false);
  eq('4e. mageHandDurationV1Simplified = true (canon: 1 min; v1: 1 round)',
    metadata.mageHandDurationV1Simplified, true);
  eq('4f. mageHandRangeEnforcementV1Simplified = true (canon: 30 ft; v1: no range check)',
    metadata.mageHandRangeEnforcementV1Simplified, true);
}

// ============================================================
// 5. metadata does NOT scale (hand capabilities are flat)
// ============================================================
console.log('\n--- 5. no scaling ---');
{
  eq('5a. scales = false (Mage Hand does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 6. metadata exposes rangeFt = 30 (canon)
// ============================================================
console.log('\n--- 6. rangeFt ---');
{
  eq('6a. rangeFt = 30 (canon PHB p.256: "within range" — 30 ft)', metadata.rangeFt, 30);
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
  assert('7c. action log mentions Mage Hand',
    actionLogs[0]?.description.includes('Mage Hand') === true,
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
// 10. resolveCantripAction integration — 'Mage Hand' routes to applySelfEffect
// ============================================================
console.log('\n--- 10. resolveCantripAction integration ---');
{
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Mage Hand', state);
  eq('10a. resolveCantripAction returns true', ret, true);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('10b. exactly 1 action log emitted via dispatcher', actionLogs.length, 1);
  assert('10c. action log mentions Mage Hand',
    actionLogs[0]?.description.includes('Mage Hand') === true,
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
  // Apply Mage Hand (sets no scratch fields, just emits a log).
  const bf = makeBF([caster]);
  const state = makeState(bf);
  applySelfEffect(caster, state);

  // resetBudget calls cleanup(Mage Hand) which is a no-op.
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
// 14. Mage Hand itself does NOT go through resolveAttack (self-buff)
// ============================================================
console.log('\n--- 14. Mage Hand bypasses resolveAttack ---');
{
  const caster = makeCombatant('wizard', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [MAGE_HAND_ACTION],
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  resolveCantripAction(caster, 'Mage Hand', state);

  // Only the "casts Mage Hand" action event should be present.
  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('14a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('14b. action event mentions Mage Hand',
    actionEvents[0]?.description.includes('Mage Hand') === true,
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

  const ret = resolveCantripAoE(caster, 'Mage Hand', state);
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

  const ret = resolveCantripTouchEffect(caster, target, 'Mage Hand', state);
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
  dispatchCantrip(caster, target, 'Mage Hand', state);
  eq('17a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);
}

// ============================================================
// 18. NO new Combatant fields (v1 has no scratch fields)
// ============================================================
console.log('\n--- 18. no new Combatant fields ---');
{
  // Mage Hand v1 introduces NO new scratch fields on Combatant.
  // The cantrip is metadata-only — applySelfEffect just emits a log event.
  // Verify by checking that none of the v1 cantrip scratch fields are set
  // after casting Mage Hand.
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  // v1: no Mage Hand-specific scratch field exists.
  // (If we wanted to add one in the future, it would be something like
  // `_mageHandActive?: boolean`. v1 does NOT have it.)
  eq('18a. no _mageHandActive field (v1 has no persistent state)',
    (caster as any)._mageHandActive, undefined);
}

// ============================================================
// 19. flavor log mentions "spectral" + "hand"
// ============================================================
console.log('\n--- 19. flavor log ---');
{
  const caster = makeCombatant('wizard', { name: 'Wizard Wil' });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Mage Hand'),
  );
  assert('19a. cast log mentions caster name',
    castLog?.description.includes('Wizard Wil') === true,
    `got: ${castLog?.description}`);
  assert('19b. cast log mentions "casts Mage Hand"',
    castLog?.description.includes('casts Mage Hand') === true,
    `got: ${castLog?.description}`);
  assert('19c. cast log mentions "spectral"',
    castLog?.description.toLowerCase().includes('spectral') === true,
    `got: ${castLog?.description}`);
  assert('19d. cast log mentions "hand"',
    castLog?.description.toLowerCase().includes('hand') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// 20. v1 simplification flags document the missing mechanics
// ============================================================
console.log('\n--- 20. v1 simplification flags document missing mechanics ---');
{
  // Verify the metadata flags are set (forward-compat TODO acknowledged).
  eq('20a. mageHandRemoteInteractionV1Implemented = false (TODO acknowledged)',
    metadata.mageHandRemoteInteractionV1Implemented, false);
  eq('20b. mageHandPersistentHandV1Simplified = true (TODO acknowledged)',
    metadata.mageHandPersistentHandV1Simplified, true);
  eq('20c. mageHandDismissalV1Implemented = false (TODO acknowledged)',
    metadata.mageHandDismissalV1Implemented, false);
  eq('20d. mageHandCarryWeightLimitV1Implemented = false (TODO acknowledged)',
    metadata.mageHandCarryWeightLimitV1Implemented, false);

  // Verify no persistent-hand state is created in v1.
  const caster = makeCombatant('wizard', {
    int: 20, // high INT — would matter for spell save DC in canon
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  // v1: NO persistent-hand state is created (no scratch fields).
  eq('20e. NO _mageHandActive scratch field after cast',
    (caster as any)._mageHandActive, undefined);
  eq('20f. NO _mageHandPosition scratch field after cast',
    (caster as any)._mageHandPosition, undefined);

  // Verify the cast log mentions the v1 simplification disclaimer.
  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Mage Hand'),
  );
  assert('20g. cast log mentions v1 disclaimer (flavor-only)',
    castLog?.description.toLowerCase().includes('flavor-only') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
