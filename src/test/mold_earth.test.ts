// ============================================================
// Test: Mold Earth Cantrip
// XGE p.162 — Level 0 transmutation cantrip (self-buff: flavor log only, no mechanical effect in v1)
//
// v1 simplifications (all documented via metadata flags):
//   - Multi-effect tracking: canonically up to 2 non-instantaneous effects active
//     → v1: no persistent-effect-tracking subsystem.
//   - Effect choice: canonically choose 1 of 3 (excavate/shape/difficult terrain)
//     → v1: emit single "manipulates dirt or stone" log.
//   - Difficult-terrain integration: canonically toggles difficult terrain for 1 hr
//     → v1: no per-cell difficult-terrain subsystem (most mechanically significant
//     simplification in this batch — would double movement cost in affected cells).
//   - Duration: canonically instant or 1 hour → v1: 1-round flavor log.
//   - Dismissal: canonically dismiss as action → v1: no dismissal action.
//   - Excavation: canonically excavate/move loose earth 5 ft
//     → v1: no terrain-modification subsystem.
//   - Range: canonically 30 ft → v1: does NOT enforce range.
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (S only — NO V, NO M — THIRD S-only cantrip)
//   3. metadata exposes isSelfBuff = true
//   4. metadata exposes v1 simplification flags
//   5. metadata does NOT scale (the 3 earth effects are flat)
//   6. metadata exposes rangeFt = 30 (canon)
//   7. applySelfEffect emits a single flavor log + returns true
//   8. applySelfEffect sets NO scratch fields (v1 has no persistent state)
//   9. applySelfEffect emits NO attack/damage events
//  10. resolveCantripAction integration — 'Mold Earth' routes to applySelfEffect
//  11. dispatcher safety — unknown cantrip name is a no-op
//  12. cleanup is a no-op (no scratch fields, no persistent state)
//  13. resetBudget integration — cleanup is a no-op
//  14. Mold Earth itself does NOT go through resolveAttack (self-buff)
//  15. resolveCantripAoE returns false (not a caster-centered AoE)
//  16. resolveCantripTouchEffect returns false (not a touch-effect)
//  17. no CANTRIP_EFFECTS entry (not a post-hit rider)
//  18. NO new Combatant fields (v1 has no scratch fields)
//  19. flavor log mentions "dirt" or "stone" + at least one of (excavate/shape/difficult terrain)
//  20. v1 simplification flags document the missing mechanics
//  21. metadata exposes concentration = false
//  22. metadata exposes castingTime = 'action'
//  23. metadata exposes school = 'transmutation'
//  24. metadata exposes damageDice = null + damageType = null
//  25. metadata exposes name = 'Mold Earth' (exact casing/spelling)
//  26. applySelfEffect is idempotent — repeated calls emit one log each
//  27. applySelfEffect handles caster with various stats (no stat dependency)
//  28. applySelfEffect handles caster at 0 HP (no HP requirement for flavor)
//  29. applySelfEffect handles dead caster (engine doesn't gate — engine's job)
//  30. applySelfEffect is robust to undefined optional fields on caster
//  31. Mold Earth mirrors Control Flames — verify metadata shape parity
//  32. difficult-terrain integration is the most significant v1 simplification — verify flag
//
// Run: npx ts-node src/test/mold_earth.test.ts
// ============================================================

import { metadata, applySelfEffect, cleanup } from '../spells/mold_earth';
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

// A Mold Earth Action — self-buff (flavor-only), no target, no attack roll, no save.
const MOLD_EARTH_ACTION: Action = {
  name: 'Mold Earth',
  isMultiattack: false,
  attackType: 'special', // self-buff — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 30, long: 0 }, // 30 ft (canon XGE p.162)
  hitBonus: null,
  damage: null, // no damage — the cantrip manipulates dirt/stone (flavor only)
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Mold Earth',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Mold Earth');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'transmutation');
  eq('1d. rangeFt (30 — canon XGE p.162)', metadata.rangeFt, 30);
  eq('1e. damageDice null (no damage — utility only)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. not concentration (instant or 1 hour — no concentration required)', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. components: S only (NO V, NO M) — XGE p.162, canon per 5etools JSON
//    THIS IS THE THIRD S-ONLY CANTRIP IN THE WORKSTREAM.
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
  eq('4a. moldEarthMultiEffectTrackingV1Implemented = false (no persistent-effect-tracking subsystem)',
    metadata.moldEarthMultiEffectTrackingV1Implemented, false);
  eq('4b. moldEarthEffectChoiceV1Simplified = true (canon: choose 1 of 3; v1: single log)',
    metadata.moldEarthEffectChoiceV1Simplified, true);
  eq('4c. moldEarthDifficultTerrainIntegrationV1Implemented = false (no per-cell difficult-terrain subsystem)',
    metadata.moldEarthDifficultTerrainIntegrationV1Implemented, false);
  eq('4d. moldEarthDurationV1Simplified = true (canon: instant or 1 hour; v1: 1 round)',
    metadata.moldEarthDurationV1Simplified, true);
  eq('4e. moldEarthDismissalV1Implemented = false (no dismissal action)',
    metadata.moldEarthDismissalV1Implemented, false);
  eq('4f. moldEarthExcavationV1Implemented = false (no terrain-modification subsystem)',
    metadata.moldEarthExcavationV1Implemented, false);
  eq('4g. moldEarthRangeEnforcementV1Simplified = true (canon: 30 ft; v1: no range check)',
    metadata.moldEarthRangeEnforcementV1Simplified, true);
}

// ============================================================
// 5. metadata does NOT scale (the 3 earth effects are flat)
// ============================================================
console.log('\n--- 5. no scaling ---');
{
  eq('5a. scales = false (Mold Earth does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 6. metadata exposes rangeFt = 30 (canon)
// ============================================================
console.log('\n--- 6. rangeFt ---');
{
  eq('6a. rangeFt = 30 (canon XGE p.162: "within range" — 30 ft)', metadata.rangeFt, 30);
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
  assert('7c. action log mentions Mold Earth',
    actionLogs[0]?.description.includes('Mold Earth') === true,
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
// 10. resolveCantripAction integration — 'Mold Earth' routes to applySelfEffect
// ============================================================
console.log('\n--- 10. resolveCantripAction integration ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Mold Earth', state);
  eq('10a. resolveCantripAction returns true', ret, true);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('10b. exactly 1 action log emitted via dispatcher', actionLogs.length, 1);
  assert('10c. action log mentions Mold Earth',
    actionLogs[0]?.description.includes('Mold Earth') === true,
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
// 14. Mold Earth itself does NOT go through resolveAttack (self-buff)
// ============================================================
console.log('\n--- 14. Mold Earth bypasses resolveAttack ---');
{
  const caster = makeCombatant('druid', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [MOLD_EARTH_ACTION],
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  resolveCantripAction(caster, 'Mold Earth', state);

  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('14a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('14b. action event mentions Mold Earth',
    actionEvents[0]?.description.includes('Mold Earth') === true,
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

  const ret = resolveCantripAoE(caster, 'Mold Earth', state);
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

  const ret = resolveCantripTouchEffect(caster, target, 'Mold Earth', state);
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
  dispatchCantrip(caster, target, 'Mold Earth', state);
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

  // v1: no Mold-Earth-specific scratch field exists.
  eq('18a. no _moldEarthActiveEffects field (v1 has no persistent state)',
    (caster as any)._moldEarthActiveEffects, undefined);
  eq('18b. no _moldEarthExcavatedCells field (v1 has no persistent state)',
    (caster as any)._moldEarthExcavatedCells, undefined);
}

// ============================================================
// 19. flavor log mentions "dirt" or "stone" + at least one of (excavate/shape/difficult terrain)
// ============================================================
console.log('\n--- 19. flavor log ---');
{
  const caster = makeCombatant('druid', { name: 'Druid Dara' });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Mold Earth'),
  );
  assert('19a. cast log mentions caster name',
    castLog?.description.includes('Dara') === true,
    `got: ${castLog?.description}`);
  assert('19b. cast log mentions "casts Mold Earth"',
    castLog?.description.includes('casts Mold Earth') === true,
    `got: ${castLog?.description}`);
  const lowerDesc = castLog?.description.toLowerCase() ?? '';
  // Must mention "dirt" or "stone".
  const hasDirtOrStone = lowerDesc.includes('dirt') || lowerDesc.includes('stone');
  assert('19c. cast log mentions "dirt" or "stone"',
    hasDirtOrStone, `got: ${castLog?.description}`);
  // Must mention at least one of (excavate/shape/difficult terrain).
  const hasAtLeastOneEffect =
    lowerDesc.includes('excavate') ||
    lowerDesc.includes('shape') ||
    lowerDesc.includes('difficult terrain');
  assert('19d. cast log mentions at least one of (excavate/shape/difficult terrain)',
    hasAtLeastOneEffect, `got: ${castLog?.description}`);
}

// ============================================================
// 20. v1 simplification flags document the missing mechanics
// ============================================================
console.log('\n--- 20. v1 simplification flags document missing mechanics ---');
{
  eq('20a. moldEarthMultiEffectTrackingV1Implemented = false (TODO acknowledged)',
    metadata.moldEarthMultiEffectTrackingV1Implemented, false);
  eq('20b. moldEarthEffectChoiceV1Simplified = true (TODO acknowledged)',
    metadata.moldEarthEffectChoiceV1Simplified, true);
  eq('20c. moldEarthDifficultTerrainIntegrationV1Implemented = false (TODO acknowledged)',
    metadata.moldEarthDifficultTerrainIntegrationV1Implemented, false);
  eq('20d. moldEarthDurationV1Simplified = true (TODO acknowledged)',
    metadata.moldEarthDurationV1Simplified, true);
  eq('20e. moldEarthDismissalV1Implemented = false (TODO acknowledged)',
    metadata.moldEarthDismissalV1Implemented, false);
  eq('20f. moldEarthExcavationV1Implemented = false (TODO acknowledged)',
    metadata.moldEarthExcavationV1Implemented, false);
  eq('20g. moldEarthRangeEnforcementV1Simplified = true (TODO acknowledged)',
    metadata.moldEarthRangeEnforcementV1Simplified, true);

  const caster = makeCombatant('druid', {
    wis: 18, // high WIS — would matter for spell save DC in canon (though Mold Earth has no save)
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  eq('20h. NO _moldEarthActiveEffects scratch field after cast',
    (caster as any)._moldEarthActiveEffects, undefined);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Mold Earth'),
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
// 25. metadata exposes name = 'Mold Earth' (exact casing/spelling)
// ============================================================
console.log('\n--- 25. name exact ---');
{
  eq('25a. name = "Mold Earth" (exact casing/spelling)', metadata.name, 'Mold Earth');
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
    (caster as any)._moldEarthActiveEffects, undefined);
}

// ============================================================
// 27. applySelfEffect handles caster with various stats (no stat dependency)
// ============================================================
console.log('\n--- 27. stat-independent ---');
{
  const lowWisCaster = makeCombatant('lowwis', { wis: 3 });
  const highWisCaster = makeCombatant('highwis', { wis: 20 });
  const lowStrCaster = makeCombatant('lowstr', { str: 1 });

  const bf1 = makeBF([lowWisCaster]);
  const s1 = makeState(bf1);
  const r1 = applySelfEffect(lowWisCaster, s1);
  eq('27a. low-WIS caster: applySelfEffect returns true', r1, true);

  const bf2 = makeBF([highWisCaster]);
  const s2 = makeState(bf2);
  const r2 = applySelfEffect(highWisCaster, s2);
  eq('27b. high-WIS caster: applySelfEffect returns true', r2, true);

  const bf3 = makeBF([lowStrCaster]);
  const s3 = makeState(bf3);
  const r3 = applySelfEffect(lowStrCaster, s3);
  eq('27c. low-STR caster: applySelfEffect returns true', r3, true);

  eq('27d. low-WIS caster: 1 action log',
    s1.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
  eq('27e. high-WIS caster: 1 action log',
    s2.log.events.filter((e: CombatEvent) => e.type === 'action').length, 1);
  eq('27f. low-STR caster: 1 action log',
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
// 31. Mold Earth mirrors Control Flames — verify metadata shape parity
// ============================================================
console.log('\n--- 31. metadata shape parity with Control Flames ---');
{
  // Mold Earth is the earth-element variant of Control Flames (fire-element).
  // Both are XGE elemental-utility cantrips with S-only components, multi-effect
  // (3 or 4 choices), instant-or-1-hour duration, no concentration.
  const { metadata: cfMeta } = require('../spells/control_flames');

  eq('31a. Mold Earth school === Control Flames school (both transmutation)',
    metadata.school, cfMeta.school);
  eq('31b. Mold Earth components.s === Control Flames components.s (both true)',
    metadata.components.s, cfMeta.components.s);
  eq('31c. Mold Earth components.v === Control Flames components.v (both false)',
    metadata.components.v, cfMeta.components.v);
  eq('31d. Mold Earth components.m === Control Flames components.m (both false)',
    metadata.components.m, cfMeta.components.m);
  eq('31e. Mold Earth isSelfBuff === Control Flames isSelfBuff (both true)',
    metadata.isSelfBuff, cfMeta.isSelfBuff);
  eq('31f. Mold Earth scales === Control Flames scales (both false)',
    metadata.scales, cfMeta.scales);
  eq('31g. Mold Earth concentration === Control Flames concentration (both false)',
    metadata.concentration, cfMeta.concentration);
  eq('31h. Mold Earth castingTime === Control Flames castingTime (both action)',
    metadata.castingTime, cfMeta.castingTime);
  // Both have multi-effect tracking + effect-choice + duration + dismissal + range flags.
  eq('31i. Mold Earth multiEffect flag === Control Flames multiEffect flag (both false)',
    metadata.moldEarthMultiEffectTrackingV1Implemented, cfMeta.controlFlamesMultiEffectTrackingV1Implemented);
  eq('31j. Mold Earth effectChoice flag === Control Flames effectChoice flag (both true)',
    metadata.moldEarthEffectChoiceV1Simplified, cfMeta.controlFlamesEffectChoiceV1Simplified);
  eq('31k. Mold Earth duration flag === Control Flames duration flag (both true)',
    metadata.moldEarthDurationV1Simplified, cfMeta.controlFlamesDurationV1Simplified);
  eq('31l. Mold Earth dismissal flag === Control Flames dismissal flag (both false)',
    metadata.moldEarthDismissalV1Implemented, cfMeta.controlFlamesDismissalV1Implemented);
  eq('31m. Mold Earth range flag === Control Flames range flag (both true)',
    metadata.moldEarthRangeEnforcementV1Simplified, cfMeta.controlFlamesRangeEnforcementV1Simplified);
  // Range differs: Mold Earth 30 ft, Control Flames 60 ft.
  assert('31n. Mold Earth rangeFt (30) differs from Control Flames rangeFt (60)',
    metadata.rangeFt !== cfMeta.rangeFt,
    `got Mold Earth=${metadata.rangeFt}, Control Flames=${cfMeta.rangeFt}`);
}

// ============================================================
// 32. difficult-terrain integration is the most significant v1 simplification — verify flag
// ============================================================
console.log('\n--- 32. difficult-terrain integration (most significant v1 simplification) ---');
{
  // The difficult-terrain toggle is the most mechanically significant v1
  // simplification in this batch — it's the only effect that would have a
  // combat-impactful consequence (movement cost doubling in the affected cells).
  // Verify the flag is set and the engine's terrain field is NOT modified by v1.
  eq('32a. moldEarthDifficultTerrainIntegrationV1Implemented = false (most significant v1 simplification)',
    metadata.moldEarthDifficultTerrainIntegrationV1Implemented, false);

  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  // Snapshot the terrain of cell (1,1) before cast.
  const cellBefore = bf.cells[1][1][0];
  const terrainBefore = cellBefore.terrain;

  applySelfEffect(caster, state);

  // Verify the terrain is unchanged (v1 does NOT modify Cell.terrain).
  const cellAfter = bf.cells[1][1][0];
  eq('32b. Cell.terrain unchanged after cast (v1 does NOT modify terrain)',
    cellAfter.terrain, terrainBefore);
  eq('32c. Cell.terrain is still "normal" (v1 does NOT toggle difficult terrain)',
    cellAfter.terrain, 'normal');
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
