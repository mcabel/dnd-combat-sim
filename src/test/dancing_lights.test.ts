// ============================================================
// Test: Dancing Lights Cantrip
// PHB p.230 — Level 0 evocation cantrip (self-buff: flavor log only, no mechanical effect in v1)
//
// THIS IS THE FIRST CONCENTRATION CANTRIP IN THE WORKSTREAM.
// metadata.concentration = true is set, but v1 does NOT enforce concentration.
//
// v1 simplifications (all documented via metadata flags):
//   - Persistent lights: canonically up to 4 persistent lights for 1 min
//     → v1: no persistent-lights subsystem.
//   - Bonus-action move: canonically move lights 60 ft as bonus action
//     → v1: no bonus-action-move subsystem.
//   - Concentration: canonically concentration for 1 min → v1: 1-round non-concentration.
//   - Light radius: canonically dim light 10-ft radius per light
//     → v1: no vision/lighting integration.
//   - Combine form: canonically 4 lights OR 1 Medium humanoid form
//     → v1: emit single log without choosing.
//   - Range: canonically 120 ft → v1: does NOT enforce range.
//   - Proximity requirement: canonically lights must stay within 20 ft of each other
//     → v1: no proximity check.
//   - Dismissal: canonically dismiss by ending concentration → v1: no dismissal.
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (V + S + M — phosphorus/wychwood/glowworm)
//   3. metadata exposes isSelfBuff = true
//   4. metadata exposes v1 simplification flags
//   5. metadata does NOT scale (the lights are flat)
//   6. metadata exposes rangeFt = 120 (canon)
//   7. applySelfEffect emits a single flavor log + returns true
//   8. applySelfEffect sets NO scratch fields (v1 has no persistent state)
//   9. applySelfEffect emits NO attack/damage events
//  10. resolveCantripAction integration — 'Dancing Lights' routes to applySelfEffect
//  11. dispatcher safety — unknown cantrip name is a no-op
//  12. cleanup is a no-op (no scratch fields, no persistent state)
//  13. resetBudget integration — cleanup is a no-op
//  14. Dancing Lights itself does NOT go through resolveAttack (self-buff)
//  15. resolveCantripAoE returns false (not a caster-centered AoE)
//  16. resolveCantripTouchEffect returns false (not a touch-effect)
//  17. no CANTRIP_EFFECTS entry (not a post-hit rider)
//  18. NO new Combatant fields (v1 has no scratch fields)
//  19. flavor log mentions "dancing lights" or "lights" + "hover" or "dim light"
//  20. v1 simplification flags document the missing mechanics
//  21. metadata exposes concentration = true (FIRST concentration cantrip)
//  22. metadata exposes castingTime = 'action'
//  23. metadata exposes school = 'evocation' (FIRST evocation self-buff cantrip)
//  24. metadata exposes damageDice = null + damageType = null
//  25. metadata exposes name = 'Dancing Lights' (exact casing/spelling)
//  26. applySelfEffect is idempotent — repeated calls emit one log each
//  27. applySelfEffect handles caster with various stats (no stat dependency)
//  28. applySelfEffect handles caster at 0 HP (no HP requirement for flavor)
//  29. applySelfEffect handles dead caster (engine doesn't gate — engine's job)
//  30. applySelfEffect is robust to undefined optional fields on caster
//  31. FIRST concentration cantrip — verify metadata flag is unique among self-buffs
//  32. verify concentration flag does NOT cause the engine to enforce concentration in v1
//
// Run: npx ts-node src/test/dancing_lights.test.ts
// ============================================================

import { metadata, applySelfEffect, cleanup } from '../spells/dancing_lights';
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

// A Dancing Lights Action — self-buff (flavor-only), no target, no attack roll, no save.
const DANCING_LIGHTS_ACTION: Action = {
  name: 'Dancing Lights',
  isMultiattack: false,
  attackType: 'special', // self-buff — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 120, long: 0 }, // 120 ft (canon PHB p.230)
  hitBonus: null,
  damage: null, // no damage — the cantrip creates lights (flavor only)
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: true, // PHB p.230 — concentration cantrip (FIRST in the workstream)
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Dancing Lights',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Dancing Lights');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'evocation');
  eq('1d. rangeFt (120 — canon PHB p.230)', metadata.rangeFt, 120);
  eq('1e. damageDice null (no damage — utility only)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. CONCENTRATION (FIRST concentration cantrip)', metadata.concentration, true);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. components: V + S + M (phosphorus/wychwood/glowworm) — PHB p.230
// ============================================================
console.log('\n--- 2. components ---');
{
  eq('2a. verbal component', metadata.components.v, true);
  eq('2b. somatic component', metadata.components.s, true);
  eq('2c. material component (a bit of phosphorus or wychwood, or a glowworm — canon 5etools JSON)',
    metadata.components.m, true);
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
  eq('4a. dancingLightsPersistentLightsV1Implemented = false (no persistent-lights subsystem)',
    metadata.dancingLightsPersistentLightsV1Implemented, false);
  eq('4b. dancingLightsBonusActionMoveV1Implemented = false (no bonus-action-move subsystem)',
    metadata.dancingLightsBonusActionMoveV1Implemented, false);
  eq('4c. dancingLightsConcentrationV1Simplified = true (canon: 1 min concentration; v1: 1 round non-concentration)',
    metadata.dancingLightsConcentrationV1Simplified, true);
  eq('4d. dancingLightsLightRadiusIntegrationV1Implemented = false (no vision/lighting integration)',
    metadata.dancingLightsLightRadiusIntegrationV1Implemented, false);
  eq('4e. dancingLightsCombineFormV1Simplified = true (canon: 4 lights OR 1 form; v1: single log)',
    metadata.dancingLightsCombineFormV1Simplified, true);
  eq('4f. dancingLightsRangeEnforcementV1Simplified = true (canon: 120 ft; v1: no range check)',
    metadata.dancingLightsRangeEnforcementV1Simplified, true);
  eq('4g. dancingLightsProximityRequirementV1Simplified = true (canon: 20 ft between lights; v1: no proximity check)',
    metadata.dancingLightsProximityRequirementV1Simplified, true);
  eq('4h. dancingLightsDismissalV1Implemented = false (no dismissal action)',
    metadata.dancingLightsDismissalV1Implemented, false);
}

// ============================================================
// 5. metadata does NOT scale (the lights are flat)
// ============================================================
console.log('\n--- 5. no scaling ---');
{
  eq('5a. scales = false (Dancing Lights does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 6. metadata exposes rangeFt = 120 (canon)
// ============================================================
console.log('\n--- 6. rangeFt ---');
{
  eq('6a. rangeFt = 120 (canon PHB p.230: "within range" — 120 ft)', metadata.rangeFt, 120);
}

// ============================================================
// 7. applySelfEffect emits a single flavor log + returns true
// ============================================================
console.log('\n--- 7. applySelfEffect ---');
{
  const caster = makeCombatant('bard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = applySelfEffect(caster, state);
  eq('7a. applySelfEffect returns true', ret, true);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('7b. exactly 1 action log emitted (flavor)', actionLogs.length, 1);
  assert('7c. action log mentions Dancing Lights',
    actionLogs[0]?.description.includes('Dancing Lights') === true,
    `got: ${actionLogs[0]?.description}`);
}

// ============================================================
// 8. applySelfEffect sets NO scratch fields (v1 has no persistent state)
// ============================================================
console.log('\n--- 8. no scratch fields ---');
{
  const caster = makeCombatant('bard');
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
  // CRITICAL: caster.concentration is NOT set (v1 does not enforce concentration).
  eq('8i. caster.concentration remains null (v1 does not enforce concentration)',
    caster.concentration, null);
}

// ============================================================
// 9. applySelfEffect emits NO attack/damage events
// ============================================================
console.log('\n--- 9. no attack/damage events ---');
{
  const caster = makeCombatant('bard');
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
// 10. resolveCantripAction integration — 'Dancing Lights' routes to applySelfEffect
// ============================================================
console.log('\n--- 10. resolveCantripAction integration ---');
{
  const caster = makeCombatant('bard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Dancing Lights', state);
  eq('10a. resolveCantripAction returns true', ret, true);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('10b. exactly 1 action log emitted via dispatcher', actionLogs.length, 1);
  assert('10c. action log mentions Dancing Lights',
    actionLogs[0]?.description.includes('Dancing Lights') === true,
    `got: ${actionLogs[0]?.description}`);
}

// ============================================================
// 11. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 11. dispatcher safety ---');
{
  const caster = makeCombatant('bard');
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
  const caster = makeCombatant('bard');
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
  const caster = makeCombatant('bard');
  // Apply Dancing Lights (sets no scratch fields, just emits a log).
  const bf = makeBF([caster]);
  const state = makeState(bf);
  applySelfEffect(caster, state);

  // resetBudget calls cleanup(Dancing Lights) which is a no-op.
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
  // v1 does not enforce concentration — caster.concentration remains null.
  eq('13e. caster.concentration remains null after resetBudget (v1 does not enforce concentration)',
    caster.concentration, null);
}

// ============================================================
// 14. Dancing Lights itself does NOT go through resolveAttack (self-buff)
// ============================================================
console.log('\n--- 14. Dancing Lights bypasses resolveAttack ---');
{
  const caster = makeCombatant('bard', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [DANCING_LIGHTS_ACTION],
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  resolveCantripAction(caster, 'Dancing Lights', state);

  // Only the "casts Dancing Lights" action event should be present.
  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('14a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('14b. action event mentions Dancing Lights',
    actionEvents[0]?.description.includes('Dancing Lights') === true,
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
  const caster = makeCombatant('bard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Dancing Lights', state);
  eq('15a. resolveCantripAoE returns false', ret, false);
  eq('15b. no log events', state.log.events.length, 0);
}

// ============================================================
// 16. resolveCantripTouchEffect returns false (not a touch-effect)
// ============================================================
console.log('\n--- 16. not a touch-effect ---');
{
  const caster = makeCombatant('bard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const ret = resolveCantripTouchEffect(caster, target, 'Dancing Lights', state);
  eq('16a. resolveCantripTouchEffect returns false', ret, false);
  eq('16b. no log events', state.log.events.length, 0);
}

// ============================================================
// 17. no CANTRIP_EFFECTS entry (not a post-hit rider)
// ============================================================
console.log('\n--- 17. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('bard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Dancing Lights', state);
  eq('17a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);
}

// ============================================================
// 18. NO new Combatant fields (v1 has no scratch fields)
// ============================================================
console.log('\n--- 18. no new Combatant fields ---');
{
  // Dancing Lights v1 introduces NO new scratch fields on Combatant.
  // The cantrip is metadata-only — applySelfEffect just emits a log event.
  // Verify by checking that none of the v1 cantrip scratch fields are set
  // after casting Dancing Lights.
  const caster = makeCombatant('bard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  // v1: no Dancing-Lights-specific scratch field exists.
  // (If we wanted to add one in the future, it would be something like
  // `_dancingLightsActive?: number` for the count of active lights.
  // v1 does NOT have it.)
  eq('18a. no _dancingLightsActive field (v1 has no persistent state)',
    (caster as any)._dancingLightsActive, undefined);
  eq('18b. no _dancingLightsPositions field (v1 has no persistent state)',
    (caster as any)._dancingLightsPositions, undefined);
}

// ============================================================
// 19. flavor log mentions "dancing lights" or "lights" + "hover" or "dim light"
// ============================================================
console.log('\n--- 19. flavor log ---');
{
  const caster = makeCombatant('bard', { name: 'Bard Briar' });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Dancing Lights'),
  );
  assert('19a. cast log mentions caster name',
    castLog?.description.includes('Briar') === true,
    `got: ${castLog?.description}`);
  assert('19b. cast log mentions "casts Dancing Lights"',
    castLog?.description.includes('casts Dancing Lights') === true,
    `got: ${castLog?.description}`);
  const lowerDesc = castLog?.description.toLowerCase() ?? '';
  // Must mention "dancing lights" or "lights".
  const hasLights = lowerDesc.includes('dancing lights') || lowerDesc.includes('lights');
  assert('19c. cast log mentions "dancing lights" or "lights"',
    hasLights, `got: ${castLog?.description}`);
  // Must mention "hover" or "dim light".
  const hasHoverOrDim = lowerDesc.includes('hover') || lowerDesc.includes('dim light');
  assert('19d. cast log mentions "hover" or "dim light"',
    hasHoverOrDim, `got: ${castLog?.description}`);
}

// ============================================================
// 20. v1 simplification flags document the missing mechanics
// ============================================================
console.log('\n--- 20. v1 simplification flags document missing mechanics ---');
{
  // Verify the metadata flags are set (forward-compat TODO acknowledged).
  eq('20a. dancingLightsPersistentLightsV1Implemented = false (TODO acknowledged)',
    metadata.dancingLightsPersistentLightsV1Implemented, false);
  eq('20b. dancingLightsBonusActionMoveV1Implemented = false (TODO acknowledged)',
    metadata.dancingLightsBonusActionMoveV1Implemented, false);
  eq('20c. dancingLightsConcentrationV1Simplified = true (TODO acknowledged)',
    metadata.dancingLightsConcentrationV1Simplified, true);
  eq('20d. dancingLightsLightRadiusIntegrationV1Implemented = false (TODO acknowledged)',
    metadata.dancingLightsLightRadiusIntegrationV1Implemented, false);
  eq('20e. dancingLightsCombineFormV1Simplified = true (TODO acknowledged)',
    metadata.dancingLightsCombineFormV1Simplified, true);
  eq('20f. dancingLightsRangeEnforcementV1Simplified = true (TODO acknowledged)',
    metadata.dancingLightsRangeEnforcementV1Simplified, true);
  eq('20g. dancingLightsProximityRequirementV1Simplified = true (TODO acknowledged)',
    metadata.dancingLightsProximityRequirementV1Simplified, true);
  eq('20h. dancingLightsDismissalV1Implemented = false (TODO acknowledged)',
    metadata.dancingLightsDismissalV1Implemented, false);

  // Verify no persistent-lights state is created in v1.
  const caster = makeCombatant('bard', {
    cha: 18, // high CHA — would matter for save DC in canon (though Dancing Lights has no save)
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  // v1: NO persistent-lights state is created (no scratch fields).
  eq('20i. NO _dancingLightsActive scratch field after cast',
    (caster as any)._dancingLightsActive, undefined);

  // Verify the cast log mentions the v1 simplification disclaimer.
  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Dancing Lights'),
  );
  assert('20j. cast log mentions v1 disclaimer (flavor-only)',
    castLog?.description.toLowerCase().includes('flavor-only') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// 21. metadata exposes concentration = true (FIRST concentration cantrip)
// ============================================================
console.log('\n--- 21. concentration (FIRST concentration cantrip) ---');
{
  // CRITICAL: Dancing Lights is the FIRST cantrip to set concentration: true.
  // Prior self-buff cantrips (Blade Ward, Shillelagh, True Strike, Resistance,
  // Guidance, Friends, Minor Illusion, Mage Hand, Prestidigitation,
  // Thaumaturgy, Message, Control Flames) all have concentration: false.
  eq('21a. concentration = true (FIRST concentration cantrip)',
    metadata.concentration, true);
  // Even though concentration is true, v1 does NOT enforce it.
  eq('21b. dancingLightsConcentrationV1Simplified = true (v1 does NOT enforce concentration)',
    metadata.dancingLightsConcentrationV1Simplified, true);
}

// ============================================================
// 22. metadata exposes castingTime = 'action'
// ============================================================
console.log('\n--- 22. castingTime ---');
{
  eq('22a. castingTime = action', metadata.castingTime, 'action');
}

// ============================================================
// 23. metadata exposes school = 'evocation' (FIRST evocation self-buff cantrip)
// ============================================================
console.log('\n--- 23. school ---');
{
  // CRITICAL: Dancing Lights is the FIRST evocation self-buff cantrip.
  // Prior self-buff cantrips were transmutation (Prestidigitation, Thaumaturgy,
  // Mage Hand, Message, Control Flames), abjuration (Blade Ward), divination
  // (True Strike, Guidance), enchantment (Friends), or illusion (Minor Illusion).
  // Dancing Lights is evocation (it creates light from raw magical energy).
  eq('23a. school = evocation (FIRST evocation self-buff cantrip)', metadata.school, 'evocation');
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
// 25. metadata exposes name = 'Dancing Lights' (exact casing/spelling)
// ============================================================
console.log('\n--- 25. name exact ---');
{
  eq('25a. name = "Dancing Lights" (exact casing/spelling)', metadata.name, 'Dancing Lights');
  // CRITICAL: the registry key in CANTRIP_SELF_EFFECTS MUST match this exactly.
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
  const caster = makeCombatant('bard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);
  applySelfEffect(caster, state);
  applySelfEffect(caster, state);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('26a. three casts → three action logs', actionLogs.length, 3);

  // No scratch fields set after 3 casts.
  eq('26b. no scratch fields after 3 casts',
    (caster as any)._dancingLightsActive, undefined);
  // v1 does not enforce concentration — caster.concentration remains null.
  eq('26c. caster.concentration remains null after 3 casts',
    caster.concentration, null);
}

// ============================================================
// 27. applySelfEffect handles caster with various stats (no stat dependency)
// ============================================================
console.log('\n--- 27. stat-independent ---');
{
  // Dancing Lights doesn't use any stat for save DC (no save in v1) or attack roll.
  // Verify applySelfEffect works regardless of caster stats.
  const lowChaCaster = makeCombatant('lowcha', { cha: 3 });
  const highChaCaster = makeCombatant('highcha', { cha: 20 });
  const lowIntCaster = makeCombatant('lowint', { int: 1 });

  const bf1 = makeBF([lowChaCaster]);
  const s1 = makeState(bf1);
  const r1 = applySelfEffect(lowChaCaster, s1);
  eq('27a. low-CHA caster: applySelfEffect returns true', r1, true);

  const bf2 = makeBF([highChaCaster]);
  const s2 = makeState(bf2);
  const r2 = applySelfEffect(highChaCaster, s2);
  eq('27b. high-CHA caster: applySelfEffect returns true', r2, true);

  const bf3 = makeBF([lowIntCaster]);
  const s3 = makeState(bf3);
  const r3 = applySelfEffect(lowIntCaster, s3);
  eq('27c. low-INT caster: applySelfEffect returns true', r3, true);

  // All three should emit exactly 1 action log.
  eq('27d. low-CHA caster: 1 action log',
    s1.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
  eq('27e. high-CHA caster: 1 action log',
    s2.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
  eq('27f. low-INT caster: 1 action log',
    s3.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
}

// ============================================================
// 28. applySelfEffect handles caster at 0 HP (no HP requirement for flavor)
// ============================================================
console.log('\n--- 28. 0 HP caster ---');
{
  const caster = makeCombatant('bard', { currentHP: 0, maxHP: 40 });
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
  const caster = makeCombatant('bard', { isDead: true });
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
// 31. FIRST concentration cantrip — verify metadata flag is unique among self-buffs
// ============================================================
console.log('\n--- 31. FIRST concentration cantrip ---');
{
  // Import a few other self-buff cantrips to verify Dancing Lights is unique.
  // (We can't easily enumerate all without more imports, but spot-check a few.)
  const { metadata: bladeWardMeta } = require('../spells/blade_ward');
  const { metadata: mageHandMeta } = require('../spells/mage_hand');
  const { metadata: messageMeta } = require('../spells/message');

  assert('31a. Blade Ward is NOT concentration (Dancing Lights is the FIRST)',
    bladeWardMeta.concentration === false, `got: ${bladeWardMeta.concentration}`);
  assert('31b. Mage Hand is NOT concentration (Dancing Lights is the FIRST)',
    mageHandMeta.concentration === false, `got: ${mageHandMeta.concentration}`);
  assert('31c. Message is NOT concentration (Dancing Lights is the FIRST)',
    messageMeta.concentration === false, `got: ${messageMeta.concentration}`);
  assert('31d. Dancing Lights IS concentration (the FIRST concentration cantrip)',
    metadata.concentration === true, `got: ${metadata.concentration}`);
}

// ============================================================
// 32. verify concentration flag does NOT cause the engine to enforce concentration in v1
// ============================================================
console.log('\n--- 32. v1 does not enforce concentration ---');
{
  // Even though metadata.concentration = true, v1 does NOT enforce concentration.
  // Verify:
  //   1. caster.concentration remains null after cast (v1 doesn't set it).
  //   2. The v1 simplification flag dancingLightsConcentrationV1Simplified = true.
  //   3. cleanup does NOT clear caster.concentration (it was never set).
  const caster = makeCombatant('bard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  eq('32a. caster.concentration remains null after cast (v1 does not set it)',
    caster.concentration, null);
  eq('32b. dancingLightsConcentrationV1Simplified = true (v1 does NOT enforce concentration)',
    metadata.dancingLightsConcentrationV1Simplified, true);

  cleanup(caster);
  eq('32c. caster.concentration remains null after cleanup (v1 never set it)',
    caster.concentration, null);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
