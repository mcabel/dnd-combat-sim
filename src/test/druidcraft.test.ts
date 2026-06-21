// ============================================================
// Test: Druidcraft Cantrip
// PHB p.236 — Level 0 transmutation cantrip (self-buff: flavor log only, no mechanical effect in v1)
//
// v1 simplifications (all documented via metadata flags):
//   - Effect choice: canonically choose 1 of 4 (weather/bloom/sensory/light)
//     → v1: emit single "whispers to the spirits of nature" log.
//   - Weather prediction: canonically predicts next 24 hr weather
//     → v1: no weather subsystem.
//   - Plant growth: canonically instantly blooms flower/seed/leaf
//     → v1: no plant-state subsystem.
//   - Duration: canonically instant (or 1 round for weather prediction)
//     → v1: 1-round flavor log.
//   - Range: canonically 30 ft → v1: does NOT enforce range.
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (V + S — NO M)
//   3. metadata exposes isSelfBuff = true
//   4. metadata exposes v1 simplification flags
//   5. metadata does NOT scale (the 4 nature effects are flat)
//   6. metadata exposes rangeFt = 30 (canon)
//   7. applySelfEffect emits a single flavor log + returns true
//   8. applySelfEffect sets NO scratch fields (v1 has no persistent state)
//   9. applySelfEffect emits NO attack/damage events
//  10. resolveCantripAction integration — 'Druidcraft' routes to applySelfEffect
//  11. dispatcher safety — unknown cantrip name is a no-op
//  12. cleanup is a no-op (no scratch fields, no persistent state)
//  13. resetBudget integration — cleanup is a no-op
//  14. Druidcraft itself does NOT go through resolveAttack (self-buff)
//  15. resolveCantripAoE returns false (not a caster-centered AoE)
//  16. resolveCantripTouchEffect returns false (not a touch-effect)
//  17. no CANTRIP_EFFECTS entry (not a post-hit rider)
//  18. NO new Combatant fields (v1 has no scratch fields)
//  19. flavor log mentions "spirits of nature" or "nature" + at least one of (weather/bloom/sensory/light)
//  20. v1 simplification flags document the missing mechanics
//  21. metadata exposes concentration = false
//  22. metadata exposes castingTime = 'action'
//  23. metadata exposes school = 'transmutation'
//  24. metadata exposes damageDice = null + damageType = null
//  25. metadata exposes name = 'Druidcraft' (exact casing/spelling)
//  26. applySelfEffect is idempotent — repeated calls emit one log each
//  27. applySelfEffect handles caster with various stats (no stat dependency)
//  28. applySelfEffect handles caster at 0 HP (no HP requirement for flavor)
//  29. applySelfEffect handles dead caster (engine doesn't gate — engine's job)
//  30. applySelfEffect is robust to undefined optional fields on caster
//  31. Druidcraft is a near-twin of Prestidigitation/Thaumaturgy — verify metadata shape parity
//
// Run: npx ts-node src/test/druidcraft.test.ts
// ============================================================

import { metadata, applySelfEffect, cleanup } from '../spells/druidcraft';
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

// A Druidcraft Action — self-buff (flavor-only), no target, no attack roll, no save.
const DRUIDCRAFT_ACTION: Action = {
  name: 'Druidcraft',
  isMultiattack: false,
  attackType: 'special', // self-buff — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 30, long: 0 }, // 30 ft (canon PHB p.236)
  hitBonus: null,
  damage: null, // no damage — the cantrip creates a minor nature effect (flavor only)
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Druidcraft',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Druidcraft');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'transmutation');
  eq('1d. rangeFt (30 — canon PHB p.236)', metadata.rangeFt, 30);
  eq('1e. damageDice null (no damage — utility only)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. not concentration (instant — no concentration required)', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. components: V + S (NO M) — PHB p.236, canon per 5etools JSON
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
  eq('4a. druidcraftEffectChoiceV1Simplified = true (canon: choose 1 of 4; v1: single log)',
    metadata.druidcraftEffectChoiceV1Simplified, true);
  eq('4b. druidcraftWeatherPredictionV1Implemented = false (no weather subsystem)',
    metadata.druidcraftWeatherPredictionV1Implemented, false);
  eq('4c. druidcraftPlantGrowthV1Implemented = false (no plant-state subsystem)',
    metadata.druidcraftPlantGrowthV1Implemented, false);
  eq('4d. druidcraftDurationV1Simplified = true (canon: instant or 1 round; v1: 1 round)',
    metadata.druidcraftDurationV1Simplified, true);
  eq('4e. druidcraftRangeEnforcementV1Simplified = true (canon: 30 ft; v1: no range check)',
    metadata.druidcraftRangeEnforcementV1Simplified, true);
}

// ============================================================
// 5. metadata does NOT scale (the 4 nature effects are flat)
// ============================================================
console.log('\n--- 5. no scaling ---');
{
  eq('5a. scales = false (Druidcraft does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 6. metadata exposes rangeFt = 30 (canon)
// ============================================================
console.log('\n--- 6. rangeFt ---');
{
  eq('6a. rangeFt = 30 (canon PHB p.236: "within range" — 30 ft)', metadata.rangeFt, 30);
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
  assert('7c. action log mentions Druidcraft',
    actionLogs[0]?.description.includes('Druidcraft') === true,
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
// 10. resolveCantripAction integration — 'Druidcraft' routes to applySelfEffect
// ============================================================
console.log('\n--- 10. resolveCantripAction integration ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Druidcraft', state);
  eq('10a. resolveCantripAction returns true', ret, true);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('10b. exactly 1 action log emitted via dispatcher', actionLogs.length, 1);
  assert('10c. action log mentions Druidcraft',
    actionLogs[0]?.description.includes('Druidcraft') === true,
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
  const caster = makeCombatant('druid');
  // Apply Druidcraft (sets no scratch fields, just emits a log).
  const bf = makeBF([caster]);
  const state = makeState(bf);
  applySelfEffect(caster, state);

  // resetBudget calls cleanup(Druidcraft) which is a no-op.
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
// 14. Druidcraft itself does NOT go through resolveAttack (self-buff)
// ============================================================
console.log('\n--- 14. Druidcraft bypasses resolveAttack ---');
{
  const caster = makeCombatant('druid', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [DRUIDCRAFT_ACTION],
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  resolveCantripAction(caster, 'Druidcraft', state);

  // Only the "casts Druidcraft" action event should be present.
  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('14a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('14b. action event mentions Druidcraft',
    actionEvents[0]?.description.includes('Druidcraft') === true,
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
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Druidcraft', state);
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

  const ret = resolveCantripTouchEffect(caster, target, 'Druidcraft', state);
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
  dispatchCantrip(caster, target, 'Druidcraft', state);
  eq('17a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);
}

// ============================================================
// 18. NO new Combatant fields (v1 has no scratch fields)
// ============================================================
console.log('\n--- 18. no new Combatant fields ---');
{
  // Druidcraft v1 introduces NO new scratch fields on Combatant.
  // The cantrip is metadata-only — applySelfEffect just emits a log event.
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  // v1: no Druidcraft-specific scratch field exists.
  eq('18a. no _druidcraftWeatherForecast field (v1 has no persistent state)',
    (caster as any)._druidcraftWeatherForecast, undefined);
  eq('18b. no _druidcraftActiveEffect field (v1 has no persistent state)',
    (caster as any)._druidcraftActiveEffect, undefined);
}

// ============================================================
// 19. flavor log mentions "spirits of nature" or "nature" + at least one of (weather/bloom/sensory/light)
// ============================================================
console.log('\n--- 19. flavor log ---');
{
  const caster = makeCombatant('druid', { name: 'Druid Daisy' });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Druidcraft'),
  );
  assert('19a. cast log mentions caster name',
    castLog?.description.includes('Daisy') === true,
    `got: ${castLog?.description}`);
  assert('19b. cast log mentions "casts Druidcraft"',
    castLog?.description.includes('casts Druidcraft') === true,
    `got: ${castLog?.description}`);
  const lowerDesc = castLog?.description.toLowerCase() ?? '';
  // Must mention "spirits of nature" or "nature".
  const hasNature = lowerDesc.includes('spirits of nature') || lowerDesc.includes('nature');
  assert('19c. cast log mentions "spirits of nature" or "nature"',
    hasNature, `got: ${castLog?.description}`);
  // Must mention at least one of (weather/bloom/sensory/light).
  const hasAtLeastOneEffect = ['weather', 'bloom', 'sensory', 'light'].some(w => lowerDesc.includes(w));
  assert('19d. cast log mentions at least one of (weather/bloom/sensory/light)',
    hasAtLeastOneEffect, `got: ${castLog?.description}`);
}

// ============================================================
// 20. v1 simplification flags document the missing mechanics
// ============================================================
console.log('\n--- 20. v1 simplification flags document missing mechanics ---');
{
  // Verify the metadata flags are set (forward-compat TODO acknowledged).
  eq('20a. druidcraftEffectChoiceV1Simplified = true (TODO acknowledged)',
    metadata.druidcraftEffectChoiceV1Simplified, true);
  eq('20b. druidcraftWeatherPredictionV1Implemented = false (TODO acknowledged)',
    metadata.druidcraftWeatherPredictionV1Implemented, false);
  eq('20c. druidcraftPlantGrowthV1Implemented = false (TODO acknowledged)',
    metadata.druidcraftPlantGrowthV1Implemented, false);
  eq('20d. druidcraftDurationV1Simplified = true (TODO acknowledged)',
    metadata.druidcraftDurationV1Simplified, true);
  eq('20e. druidcraftRangeEnforcementV1Simplified = true (TODO acknowledged)',
    metadata.druidcraftRangeEnforcementV1Simplified, true);

  // Verify no weather/plant state is created in v1.
  const caster = makeCombatant('druid', {
    wis: 18, // high WIS — would matter for spell save DC in canon (though Druidcraft has no save)
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  // v1: NO weather/plant state is created (no scratch fields).
  eq('20f. NO _druidcraftWeatherForecast scratch field after cast',
    (caster as any)._druidcraftWeatherForecast, undefined);

  // Verify the cast log mentions the v1 simplification disclaimer.
  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Druidcraft'),
  );
  assert('20g. cast log mentions v1 disclaimer (flavor-only)',
    castLog?.description.toLowerCase().includes('flavor-only') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// 21. metadata exposes concentration = false
// ============================================================
console.log('\n--- 21. concentration ---');
{
  eq('21a. concentration = false (instant — no concentration required)',
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
// 25. metadata exposes name = 'Druidcraft' (exact casing/spelling)
// ============================================================
console.log('\n--- 25. name exact ---');
{
  eq('25a. name = "Druidcraft" (exact casing/spelling)', metadata.name, 'Druidcraft');
  // CRITICAL: the registry key in CANTRIP_SELF_EFFECTS MUST match this exactly.
  assert('25b. name has no leading/trailing whitespace',
    metadata.name === metadata.name.trim(),
    `got: "${metadata.name}"`);
  assert('25c. name is a single word (no space)',
    metadata.name.includes(' ') === false,
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

  // No scratch fields set after 3 casts.
  eq('26b. no scratch fields after 3 casts',
    (caster as any)._druidcraftWeatherForecast, undefined);
}

// ============================================================
// 27. applySelfEffect handles caster with various stats (no stat dependency)
// ============================================================
console.log('\n--- 27. stat-independent ---');
{
  // Druidcraft doesn't use any stat for save DC (no save in v1) or attack roll.
  // Verify applySelfEffect works regardless of caster stats.
  const lowWisCaster = makeCombatant('lowwis', { wis: 3 });
  const highWisCaster = makeCombatant('highwis', { wis: 20 });
  const lowChaCaster = makeCombatant('lowcha', { cha: 1 });

  const bf1 = makeBF([lowWisCaster]);
  const s1 = makeState(bf1);
  const r1 = applySelfEffect(lowWisCaster, s1);
  eq('27a. low-WIS caster: applySelfEffect returns true', r1, true);

  const bf2 = makeBF([highWisCaster]);
  const s2 = makeState(bf2);
  const r2 = applySelfEffect(highWisCaster, s2);
  eq('27b. high-WIS caster: applySelfEffect returns true', r2, true);

  const bf3 = makeBF([lowChaCaster]);
  const s3 = makeState(bf3);
  const r3 = applySelfEffect(lowChaCaster, s3);
  eq('27c. low-CHA caster: applySelfEffect returns true', r3, true);

  // All three should emit exactly 1 action log.
  eq('27d. low-WIS caster: 1 action log',
    s1.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
  eq('27e. high-WIS caster: 1 action log',
    s2.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
  eq('27f. low-CHA caster: 1 action log',
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
    exhaustionLevel: 0,
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
// 31. Druidcraft is a near-twin of Prestidigitation/Thaumaturgy — verify metadata shape parity
// ============================================================
console.log('\n--- 31. metadata shape parity with Prestidigitation/Thaumaturgy ---');
{
  // Druidcraft is the nature-themed variant of Prestidigitation (arcane) /
  // Thaumaturgy (divine). All three are "minor magical effect, choose 1 of N"
  // cantrips with V-or-V+S, no M, no save, no attack roll, no damage, self-buff.
  const { metadata: prestMeta } = require('../spells/prestidigitation');
  const { metadata: thauMeta } = require('../spells/thaumaturgy');

  // Verify Druidcraft has the same structural metadata shape.
  eq('31a. Druidcraft level === Prestidigitation level (both 0)',
    metadata.level, prestMeta.level);
  eq('31b. Druidcraft level === Thaumaturgy level (both 0)',
    metadata.level, thauMeta.level);
  eq('31c. Druidcraft school === Prestidigitation school (transmutation)',
    metadata.school, prestMeta.school);
  eq('31d. Druidcraft isSelfBuff === Prestidigitation isSelfBuff (both true)',
    metadata.isSelfBuff, prestMeta.isSelfBuff);
  eq('31e. Druidcraft scales === Prestidigitation scales (both false)',
    metadata.scales, prestMeta.scales);
  eq('31f. Druidcraft concentration === Prestidigitation concentration (both false)',
    metadata.concentration, prestMeta.concentration);
  // Druidcraft (V+S) matches Prestidigitation (V+S) — both differ from Thaumaturgy (V only).
  eq('31g. Druidcraft components.v === Prestidigitation components.v (both true)',
    metadata.components.v, prestMeta.components.v);
  eq('31h. Druidcraft components.s === Prestidigitation components.s (both true)',
    metadata.components.s, prestMeta.components.s);
  eq('31i. Druidcraft components.m === Prestidigitation components.m (both false)',
    metadata.components.m, prestMeta.components.m);
  // Range differs: Druidcraft 30 ft, Prestidigitation 10 ft.
  assert('31j. Druidcraft rangeFt (30) differs from Prestidigitation rangeFt (10)',
    metadata.rangeFt !== prestMeta.rangeFt,
    `got Druidcraft=${metadata.rangeFt}, Prestidigitation=${prestMeta.rangeFt}`);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
