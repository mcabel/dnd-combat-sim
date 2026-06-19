// ============================================================
// Test: Encode Thoughts Cantrip
// GGR p.47 — Level 0 enchantment cantrip (self-buff: flavor log only, no mechanical effect in v1)
//
// THIS IS THE FIRST GGR-SOURCE CANTRIP IN THE WORKSTREAM
// (GGR = Guildmasters' Guide to Ravnica, 2018-11-20). All prior cantrips were
// PHB (2014), XGE (2017), TCE (2020), or EGW (2020).
//
// THIS IS THE FIRST 8-HOUR-DURATION CANTRIP IN THE WORKSTREAM
// (PHB cantrips typically last 1 round, 1 minute, or 1 hour; Encode Thoughts
// lasts 8 hours). v1 simplifies to 1 round.
//
// THIS IS THE SECOND S-ONLY CANTRIP IN THE WORKSTREAM (Control Flames was the first).
//
// v1 simplifications (all documented via metadata flags):
//   - Thought strand: canonically creates a tangible strand object (Tiny, weightless)
//     → v1: no thought-strand subsystem.
//   - Thought-reading integration: canonically can transform read thoughts into a strand
//     → v1: no thought-reading integration.
//   - Strand reception: canonically receive strand contents by holding it
//     → v1: no strand-reception subsystem.
//   - Duration: canonically 8 hours → v1: 1-round flavor log.
//   - Recast ends previous: canonically recasting ends the prior strand
//     → v1: no recast-tracking subsystem.
//   - Range: canonically self (strand appears within 5 ft) → v1: does NOT enforce range.
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (S only — NO V, NO M — SECOND S-only cantrip)
//   3. metadata exposes isSelfBuff = true
//   4. metadata exposes v1 simplification flags
//   5. metadata does NOT scale (the thought strand is flat)
//   6. metadata exposes rangeFt = 0 (self — canon)
//   7. applySelfEffect emits a single flavor log + returns true
//   8. applySelfEffect sets NO scratch fields (v1 has no persistent state)
//   9. applySelfEffect emits NO attack/damage events
//  10. resolveCantripAction integration — 'Encode Thoughts' routes to applySelfEffect
//  11. dispatcher safety — unknown cantrip name is a no-op
//  12. cleanup is a no-op (no scratch fields, no persistent state)
//  13. resetBudget integration — cleanup is a no-op
//  14. Encode Thoughts itself does NOT go through resolveAttack (self-buff)
//  15. resolveCantripAoE returns false (not a caster-centered AoE)
//  16. resolveCantripTouchEffect returns false (not a touch-effect)
//  17. no CANTRIP_EFFECTS entry (not a post-hit rider)
//  18. NO new Combatant fields (v1 has no scratch fields)
//  19. flavor log mentions "thought strand" + "memory" or "idea" or "message"
//  20. v1 simplification flags document the missing mechanics
//  21. metadata exposes concentration = false (8 hr — no concentration required)
//  22. metadata exposes castingTime = 'action'
//  23. metadata exposes school = 'enchantment'
//  24. metadata exposes damageDice = null + damageType = null
//  25. metadata exposes name = 'Encode Thoughts' (exact casing/spelling)
//  26. applySelfEffect is idempotent — repeated calls emit one log each
//  27. applySelfEffect handles caster with various stats (no stat dependency)
//  28. applySelfEffect handles caster at 0 HP (no HP requirement for flavor)
//  29. applySelfEffect handles dead caster (engine doesn't gate — engine's job)
//  30. applySelfEffect is robust to undefined optional fields on caster
//  31. FIRST GGR-source cantrip — verify metadata shape (school enchantment, S-only, self)
//  32. FIRST 8-hour-duration cantrip — verify v1 simplifies to 1 round
//  33. SECOND S-only cantrip — verify parity with Control Flames (also S-only)
//
// Run: npx ts-node src/test/encode_thoughts.test.ts
// ============================================================

import { metadata, applySelfEffect, cleanup } from '../spells/encode_thoughts';
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

// An Encode Thoughts Action — self-buff (flavor-only), no target, no attack roll, no save.
const ENCODE_THOUGHTS_ACTION: Action = {
  name: 'Encode Thoughts',
  isMultiattack: false,
  attackType: 'special', // self-buff — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 0, long: 0 }, // self (canon GGR p.47 — strand appears within 5 ft)
  hitBonus: null,
  damage: null, // no damage — the cantrip creates a thought strand (flavor only)
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Encode Thoughts',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Encode Thoughts');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school (enchantment — FIRST GGR-source cantrip)', metadata.school, 'enchantment');
  eq('1d. rangeFt (0 — self, canon GGR p.47)', metadata.rangeFt, 0);
  eq('1e. damageDice null (no damage — utility only)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. not concentration (8 hr — no concentration required)', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. components: S only (NO V, NO M) — GGR p.47, canon per 5etools JSON
//    THIS IS THE SECOND S-ONLY CANTRIP IN THE WORKSTREAM.
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
  eq('4a. encodeThoughtsThoughtStrandV1Implemented = false (no thought-strand subsystem)',
    metadata.encodeThoughtsThoughtStrandV1Implemented, false);
  eq('4b. encodeThoughtsThoughtReadingIntegrationV1Implemented = false (no thought-reading integration)',
    metadata.encodeThoughtsThoughtReadingIntegrationV1Implemented, false);
  eq('4c. encodeThoughtsStrandReceptionV1Implemented = false (no strand-reception subsystem)',
    metadata.encodeThoughtsStrandReceptionV1Implemented, false);
  eq('4d. encodeThoughtsDurationV1Simplified = true (canon: 8 hr; v1: 1 round)',
    metadata.encodeThoughtsDurationV1Simplified, true);
  eq('4e. encodeThoughtsRecastEndsPreviousV1Implemented = false (no recast-tracking subsystem)',
    metadata.encodeThoughtsRecastEndsPreviousV1Implemented, false);
  eq('4f. encodeThoughtsRangeV1Simplified = true (canon: self, 5-ft appearance; v1: no range check)',
    metadata.encodeThoughtsRangeV1Simplified, true);
}

// ============================================================
// 5. metadata does NOT scale (the thought strand is flat)
// ============================================================
console.log('\n--- 5. no scaling ---');
{
  eq('5a. scales = false (Encode Thoughts does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 6. metadata exposes rangeFt = 0 (self — canon)
// ============================================================
console.log('\n--- 6. rangeFt ---');
{
  eq('6a. rangeFt = 0 (canon GGR p.47: self range — strand appears within 5 ft)', metadata.rangeFt, 0);
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
  assert('7c. action log mentions Encode Thoughts',
    actionLogs[0]?.description.includes('Encode Thoughts') === true,
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
// 10. resolveCantripAction integration — 'Encode Thoughts' routes to applySelfEffect
// ============================================================
console.log('\n--- 10. resolveCantripAction integration ---');
{
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Encode Thoughts', state);
  eq('10a. resolveCantripAction returns true', ret, true);

  const actionLogs = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('10b. exactly 1 action log emitted via dispatcher', actionLogs.length, 1);
  assert('10c. action log mentions Encode Thoughts',
    actionLogs[0]?.description.includes('Encode Thoughts') === true,
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
  const caster = makeCombatant('wizard');
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
// 14. Encode Thoughts itself does NOT go through resolveAttack (self-buff)
// ============================================================
console.log('\n--- 14. Encode Thoughts bypasses resolveAttack ---');
{
  const caster = makeCombatant('wizard', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [ENCODE_THOUGHTS_ACTION],
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  resolveCantripAction(caster, 'Encode Thoughts', state);

  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('14a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('14b. action event mentions Encode Thoughts',
    actionEvents[0]?.description.includes('Encode Thoughts') === true,
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
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Encode Thoughts', state);
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

  const ret = resolveCantripTouchEffect(caster, target, 'Encode Thoughts', state);
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
  dispatchCantrip(caster, target, 'Encode Thoughts', state);
  eq('17a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);
}

// ============================================================
// 18. NO new Combatant fields (v1 has no scratch fields)
// ============================================================
console.log('\n--- 18. no new Combatant fields ---');
{
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  // v1: no Encode-Thoughts-specific scratch field exists.
  eq('18a. no _encodeThoughtsStrandActive field (v1 has no persistent state)',
    (caster as any)._encodeThoughtsStrandActive, undefined);
  eq('18b. no _encodeThoughtsStrandContent field (v1 has no persistent state)',
    (caster as any)._encodeThoughtsStrandContent, undefined);
}

// ============================================================
// 19. flavor log mentions "thought strand" + "memory" or "idea" or "message"
// ============================================================
console.log('\n--- 19. flavor log ---');
{
  const caster = makeCombatant('wizard', { name: 'Wizard Wren' });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Encode Thoughts'),
  );
  assert('19a. cast log mentions caster name',
    castLog?.description.includes('Wren') === true,
    `got: ${castLog?.description}`);
  assert('19b. cast log mentions "casts Encode Thoughts"',
    castLog?.description.includes('casts Encode Thoughts') === true,
    `got: ${castLog?.description}`);
  assert('19c. cast log mentions "thought strand"',
    castLog?.description.toLowerCase().includes('thought strand') === true,
    `got: ${castLog?.description}`);
  const lowerDesc = castLog?.description.toLowerCase() ?? '';
  // Must mention at least one of (memory/idea/message).
  const hasAtLeastOne = ['memory', 'idea', 'message'].some(w => lowerDesc.includes(w));
  assert('19d. cast log mentions at least one of (memory/idea/message)',
    hasAtLeastOne, `got: ${castLog?.description}`);
}

// ============================================================
// 20. v1 simplification flags document the missing mechanics
// ============================================================
console.log('\n--- 20. v1 simplification flags document missing mechanics ---');
{
  eq('20a. encodeThoughtsThoughtStrandV1Implemented = false (TODO acknowledged)',
    metadata.encodeThoughtsThoughtStrandV1Implemented, false);
  eq('20b. encodeThoughtsThoughtReadingIntegrationV1Implemented = false (TODO acknowledged)',
    metadata.encodeThoughtsThoughtReadingIntegrationV1Implemented, false);
  eq('20c. encodeThoughtsStrandReceptionV1Implemented = false (TODO acknowledged)',
    metadata.encodeThoughtsStrandReceptionV1Implemented, false);
  eq('20d. encodeThoughtsDurationV1Simplified = true (TODO acknowledged)',
    metadata.encodeThoughtsDurationV1Simplified, true);
  eq('20e. encodeThoughtsRecastEndsPreviousV1Implemented = false (TODO acknowledged)',
    metadata.encodeThoughtsRecastEndsPreviousV1Implemented, false);
  eq('20f. encodeThoughtsRangeV1Simplified = true (TODO acknowledged)',
    metadata.encodeThoughtsRangeV1Simplified, true);

  const caster = makeCombatant('wizard', {
    int: 18, // high INT — would matter for spell save DC in canon (though Encode Thoughts has no save)
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  eq('20g. NO _encodeThoughtsStrandActive scratch field after cast',
    (caster as any)._encodeThoughtsStrandActive, undefined);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Encode Thoughts'),
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
  eq('21a. concentration = false (8 hr — no concentration required)',
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
// 23. metadata exposes school = 'enchantment'
// ============================================================
console.log('\n--- 23. school ---');
{
  eq('23a. school = enchantment', metadata.school, 'enchantment');
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
// 25. metadata exposes name = 'Encode Thoughts' (exact casing/spelling)
// ============================================================
console.log('\n--- 25. name exact ---');
{
  eq('25a. name = "Encode Thoughts" (exact casing/spelling)', metadata.name, 'Encode Thoughts');
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

  eq('26b. no scratch fields after 3 casts',
    (caster as any)._encodeThoughtsStrandActive, undefined);
}

// ============================================================
// 27. applySelfEffect handles caster with various stats (no stat dependency)
// ============================================================
console.log('\n--- 27. stat-independent ---');
{
  const lowIntCaster = makeCombatant('lowint', { int: 3 });
  const highIntCaster = makeCombatant('highint', { int: 20 });
  const lowChaCaster = makeCombatant('lowcha', { cha: 1 });

  const bf1 = makeBF([lowIntCaster]);
  const s1 = makeState(bf1);
  const r1 = applySelfEffect(lowIntCaster, s1);
  eq('27a. low-INT caster: applySelfEffect returns true', r1, true);

  const bf2 = makeBF([highIntCaster]);
  const s2 = makeState(bf2);
  const r2 = applySelfEffect(highIntCaster, s2);
  eq('27b. high-INT caster: applySelfEffect returns true', r2, true);

  const bf3 = makeBF([lowChaCaster]);
  const s3 = makeState(bf3);
  const r3 = applySelfEffect(lowChaCaster, s3);
  eq('27c. low-CHA caster: applySelfEffect returns true', r3, true);

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
// 31. FIRST GGR-source cantrip — verify metadata shape
// ============================================================
console.log('\n--- 31. FIRST GGR-source cantrip ---');
{
  // Encode Thoughts is the FIRST cantrip from GGR (Guildmasters' Guide to Ravnica,
  // 2018-11-20). All prior cantrips were PHB (2014), XGE (2017), TCE (2020), or EGW (2020).
  // The spell-cache:build script auto-detects the source — verify it appears in the
  // implemented list with source=GGR.
  //
  // We can't easily import the spell-cache JSON here, but we verify the metadata
  // shape is consistent with GGR p.47 canon:
  //   - school = 'enchantment' (GGR p.47)
  //   - components = S only (GGR p.47, 5etools JSON: {"s":true})
  //   - rangeFt = 0 (self — GGR p.47)
  //   - school enchantment is unusual for a self-buff cantrip (most are transmutation)
  eq('31a. school = enchantment (GGR p.47 canon)',
    metadata.school, 'enchantment');
  eq('31b. components.s = true (GGR p.47, 5etools JSON: {"s":true})',
    metadata.components.s, true);
  eq('31c. components.v = false (GGR p.47, 5etools JSON: {"s":true})',
    metadata.components.v, false);
  eq('31d. components.m = false (GGR p.47, 5etools JSON: {"s":true})',
    metadata.components.m, false);
  eq('31e. rangeFt = 0 (self — GGR p.47 canon)',
    metadata.rangeFt, 0);
  // Spot-check: Encode Thoughts is the only enchantment self-buff cantrip so far.
  const { metadata: prestMeta } = require('../spells/prestidigitation');
  const { metadata: mageHandMeta } = require('../spells/mage_hand');
  assert('31f. Prestidigitation school !== enchantment (Encode Thoughts is unique so far)',
    prestMeta.school !== 'enchantment', `got: ${prestMeta.school}`);
  assert('31g. Mage Hand school !== enchantment (Encode Thoughts is unique so far)',
    mageHandMeta.school !== 'enchantment', `got: ${mageHandMeta.school}`);
}

// ============================================================
// 32. FIRST 8-hour-duration cantrip — verify v1 simplifies to 1 round
// ============================================================
console.log('\n--- 32. FIRST 8-hour-duration cantrip ---');
{
  // Encode Thoughts is the FIRST 8-hour-duration cantrip in the workstream.
  // PHB cantrips typically last 1 round, 1 minute, or 1 hour.
  // v1 simplifies to 1 round (the strand "fades" at the start of the caster's
  // NEXT turn via cleanup() — though v1 has no persistent state to clear).
  eq('32a. encodeThoughtsDurationV1Simplified = true (canon 8 hr → v1 1 round)',
    metadata.encodeThoughtsDurationV1Simplified, true);
  eq('32b. concentration = false (8 hr — no concentration required)',
    metadata.concentration, false);

  // Verify v1 does NOT track the 8-hour duration (no scratch field for strand expiry).
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);
  applySelfEffect(caster, state);

  eq('32c. no _encodeThoughtsStrandExpiryTurn scratch field (v1 has no persistent state)',
    (caster as any)._encodeThoughtsStrandExpiryTurn, undefined);
}

// ============================================================
// 33. SECOND S-only cantrip — verify parity with Control Flames (also S-only)
// ============================================================
console.log('\n--- 33. SECOND S-only cantrip (parity with Control Flames) ---');
{
  // Encode Thoughts is the SECOND S-only cantrip (Control Flames was the first).
  // Both have components = { v: false, s: true, m: false }.
  const { metadata: cfMeta } = require('../spells/control_flames');

  eq('33a. Encode Thoughts components.s === Control Flames components.s (both true)',
    metadata.components.s, cfMeta.components.s);
  eq('33b. Encode Thoughts components.v === Control Flames components.v (both false)',
    metadata.components.v, cfMeta.components.v);
  eq('33c. Encode Thoughts components.m === Control Flames components.m (both false)',
    metadata.components.m, cfMeta.components.m);

  // Both are self-buffs with no scratch fields.
  eq('33d. Encode Thoughts isSelfBuff === Control Flames isSelfBuff (both true)',
    metadata.isSelfBuff, cfMeta.isSelfBuff);
  eq('33e. Encode Thoughts scales === Control Flames scales (both false)',
    metadata.scales, cfMeta.scales);

  // Both have rangeEnforcementV1Simplified = true.
  eq('33f. Encode Thoughts range flag === Control Flames range flag (both true)',
    metadata.encodeThoughtsRangeV1Simplified, cfMeta.controlFlamesRangeEnforcementV1Simplified);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
