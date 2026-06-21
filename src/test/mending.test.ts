// ============================================================
// Test: Mending Cantrip
// PHB p.259 — Level 0 transmutation cantrip (touch-effect: set _mended flag)
//
// CANON CASTING TIME: 1 MINUTE (PHB p.259 — "time":[{"number":1,"unit":"minute"}]
// per the 5etools JSON). This is the FIRST cantrip with a non-action casting time
// (1 min = 10 rounds = out-of-combat only per PHB p.192 casting-time rules).
// v1 simplification: the engine treats Mending as a standard ACTION for engine
// simplicity — documented via the metadata flag `mendingCastingTimeV1Simplified:
// true`.
//
// v1 simplifications (all documented via metadata flags):
//   - Casting time: canonically 1 MINUTE → v1: standard action (FIRST cantrip
//     with a non-action casting time).
//   - Construct repair: canonically can physically repair constructs → v1: no
//     construct-heal subsystem.
//   - Magic item restoration: canonically can physically repair magic items but
//     can't restore magic → v1: no magic-item-state subsystem.
//   - Break size limit: canonically break/tear no larger than 1 foot → v1: no
//     size check.
//   - Object-state integration: v1 sets the `_mended` flag on the target for
//     forward-compat, but the future object-state subsystem is not yet
//     implemented.
//   - Range: canonically Touch → v1: does NOT enforce adjacency.
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (V + S + M — two lodestones, canon per 5etools JSON)
//   3. metadata exposes isTouchEffect = true
//   4. metadata exposes v1 simplification flags (casting-time simplified + construct-repair TODO + magic-item-restoration TODO + break-size-limit simplified + object-state-integration TODO + range simplified)
//   5. metadata does NOT scale (mend effect is binary)
//   6. metadata exposes rangeFt = 0 (Touch, canon)
//   7. applyTouchEffect sets _mended = true + emits log
//   8. applyTouchEffect on dead creature → fizzle (no effect, action consumed)
//   9. CANTRIP_TOUCH_EFFECTS routing — 'Mending' routes to applyTouchEffect
//  10. dispatcher safety — unknown cantrip name is a no-op
//  11. resolveCantripTouchEffect returns true when target is null (fizzle, action consumed)
//  12. resolveCantripAction returns false (NOT a self-buff)
//  13. resolveCantripAoE returns false (NOT a caster-centered AoE)
//  14. no CANTRIP_EFFECTS entry (NOT a post-hit rider)
//  15. cleanup clears _mended flag (resetBudget integration)
//  16. CANTRIP_TOUCH_EFFECTS routing bypasses resolveAttack (no attack hit/miss/damage events)
//  17. DEX save NOT triggered in v1 (Mending has no save in canon either)
//  18. v1 flag is forward-compat only (no object-state integration yet)
//  19. flavor log emitted on cast (mentions "repair" + "break" or "tear" + caster + target)
//  20. v1 casting-time simplification documented (canon: 1 min; v1: 1 action)
//
// Run: npx ts-node src/test/mending.test.ts
// ============================================================

import { metadata, applyTouchEffect, cleanup } from '../spells/mending';
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

// A Mending Action — touch-effect, no attack roll, no save (v1).
const MENDING_ACTION: Action = {
  name: 'Mending',
  isMultiattack: false,
  attackType: 'special', // touch-effect — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 0, long: 0 }, // Touch
  hitBonus: null,
  damage: null, // no damage — the cantrip repairs a single break or tear in the target
  damageType: null,
  saveDC: null,
  saveAbility: null, // Mending has no save in canon
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action', // v1 simplification: canon casting time is 1 MINUTE; v1: 1 action
  legendaryCost: 0,
  description: 'Mending',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Mending');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'transmutation');
  eq('1d. rangeFt (0 — Touch)', metadata.rangeFt, 0);
  eq('1e. damageDice null (no damage — utility only)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. not concentration (instant — no concentration required)', metadata.concentration, false);
  // v1 simplification: canon casting time is 1 MINUTE; v1: 'action' for engine simplicity.
  eq('1h. castingTime = "action" (v1 simplification; canon: 1 minute)',
    metadata.castingTime, 'action');
}

// ============================================================
// 2. components: V + S + M (two lodestones) — PHB p.259, canon per 5etools JSON
// ============================================================
console.log('\n--- 2. components ---');
{
  eq('2a. verbal component', metadata.components.v, true);
  eq('2b. somatic component', metadata.components.s, true);
  eq('2c. material component (two lodestones — canon 5etools JSON: {"v":true,"s":true,"m":"two lodestones"})',
    metadata.components.m, true);
}

// ============================================================
// 3. metadata exposes isTouchEffect = true
// ============================================================
console.log('\n--- 3. isTouchEffect ---');
{
  eq('3a. isTouchEffect = true (routes via CANTRIP_TOUCH_EFFECTS)',
    metadata.isTouchEffect, true);
}

// ============================================================
// 4. metadata exposes v1 simplification flags
// ============================================================
console.log('\n--- 4. v1 simplification flags ---');
{
  eq('4a. mendingCastingTimeV1Simplified = true (canon: 1 min; v1: 1 action)',
    metadata.mendingCastingTimeV1Simplified, true);
  eq('4b. mendingConstructRepairV1Implemented = false (no construct-heal subsystem)',
    metadata.mendingConstructRepairV1Implemented, false);
  eq('4c. mendingMagicItemRestorationV1Implemented = false (no magic-item-state subsystem)',
    metadata.mendingMagicItemRestorationV1Implemented, false);
  eq('4d. mendingBreakSizeLimitV1Simplified = true (canon: 1-foot limit; v1: no size check)',
    metadata.mendingBreakSizeLimitV1Simplified, true);
  eq('4e. mendingObjectStateIntegrationV1Implemented = false (object-state subsystem TODO)',
    metadata.mendingObjectStateIntegrationV1Implemented, false);
  eq('4f. mendingRangeEnforcementV1Simplified = true (canon: Touch; v1: no adjacency check)',
    metadata.mendingRangeEnforcementV1Simplified, true);
}

// ============================================================
// 5. metadata does NOT scale (mend effect is binary)
// ============================================================
console.log('\n--- 5. no scaling ---');
{
  eq('5a. scales = false (Mending does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 6. metadata exposes rangeFt = 0 (Touch, canon)
// ============================================================
console.log('\n--- 6. rangeFt ---');
{
  eq('6a. rangeFt = 0 (Touch — canon PHB p.259)', metadata.rangeFt, 0);
}

// ============================================================
// 7. applyTouchEffect sets _mended = true + emits log
// ============================================================
console.log('\n--- 7. applyTouchEffect ---');
{
  const caster = makeCombatant('wizard', {
    pos: { x: 5, y: 5, z: 0 },
  });
  const target = makeCombatant('fighter', {
    pos: { x: 6, y: 5, z: 0 },
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  eq('7a. flag not set before cast', target._mended, undefined);

  const ret = applyTouchEffect(caster, target, state);
  eq('7b. applyTouchEffect returns true', ret, true);
  eq('7c. _mended set to true on TARGET (not caster)',
    target._mended, true);
  eq('7d. _mended NOT set on caster',
    caster._mended, undefined);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Mending'),
  );
  assert('7e. cast log emitted', castLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('7f. log mentions "repair" or "mend"',
    castLog?.description.toLowerCase().includes('repair') === true ||
    castLog?.description.toLowerCase().includes('mend') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// 8. applyTouchEffect on dead creature → fizzle (no effect, action consumed)
// ============================================================
console.log('\n--- 8. dead creature → fizzle ---');
{
  const caster = makeCombatant('wizard', { isPlayer: true });
  const corpse = makeCombatant('fighter', {
    isPlayer: true,
    currentHP: 0,
    isDead: true,
    isUnconscious: true,
  });
  const bf = makeBF([caster, corpse]);
  const state = makeState(bf);

  const ret = applyTouchEffect(caster, corpse, state);
  eq('8a. applyTouchEffect returns true (action consumed)', ret, true);
  eq('8b. corpse NOT mended (already dead)',
    corpse._mended, undefined);

  const fizzleLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.toLowerCase().includes('no effect'),
  );
  assert('8c. fizzle log emitted (dead target)',
    fizzleLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 9. CANTRIP_TOUCH_EFFECTS routing — 'Mending' routes to applyTouchEffect
// ============================================================
console.log('\n--- 9. CANTRIP_TOUCH_EFFECTS routing ---');
{
  const caster = makeCombatant('wizard', {
    pos: { x: 5, y: 5, z: 0 },
  });
  const target = makeCombatant('fighter', {
    pos: { x: 6, y: 5, z: 0 },
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const ret = resolveCantripTouchEffect(caster, target, 'Mending', state);
  eq('9a. resolveCantripTouchEffect returns true', ret, true);
  eq('9b. target _mended set via dispatcher',
    target._mended, true);
}

// ============================================================
// 10. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 10. dispatcher safety ---');
{
  const caster = makeCombatant('wizard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const ret = resolveCantripTouchEffect(caster, target, 'Definitely Not A Cantrip', state);
  eq('10a. unknown cantrip → resolveCantripTouchEffect returns false (fall through)',
    ret, false);
  eq('10b. unknown cantrip → no log events', state.log.events.length, 0);
  eq('10c. unknown cantrip → no flag set on target',
    target._mended, undefined);
}

// ============================================================
// 11. resolveCantripTouchEffect returns true when target is null (fizzle, action consumed)
// ============================================================
console.log('\n--- 11. null target → fizzle (action consumed) ---');
{
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripTouchEffect(caster, null, 'Mending', state);
  eq('11a. null target → returns true (action consumed, spell fizzles)',
    ret, true);
  eq('11b. null target → no log events (handler not called)',
    state.log.events.length, 0);
}

// ============================================================
// 12. resolveCantripAction returns false (NOT a self-buff)
// ============================================================
console.log('\n--- 12. not a self-buff ---');
{
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Mending', state);
  eq('12a. resolveCantripAction returns false (NOT a self-buff)', ret, false);
  eq('12b. no log events', state.log.events.length, 0);
  eq('12c. caster has no scratch fields set',
    caster._mended, undefined);
}

// ============================================================
// 13. resolveCantripAoE returns false (NOT a caster-centered AoE)
// ============================================================
console.log('\n--- 13. not a caster-centered AoE ---');
{
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Mending', state);
  eq('13a. resolveCantripAoE returns false', ret, false);
  eq('13b. no log events', state.log.events.length, 0);
}

// ============================================================
// 14. no CANTRIP_EFFECTS entry (NOT a post-hit rider)
// ============================================================
console.log('\n--- 14. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('wizard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Mending', state);
  eq('14a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);
  eq('14b. no flag set on target', target._mended, undefined);
}

// ============================================================
// 15. cleanup clears _mended flag (resetBudget integration)
// ============================================================
console.log('\n--- 15. cleanup ---');
{
  // The cleanup operates on the combatant whose turn is starting.
  // v1: the flag is set on the TARGET, but cleanup clears the flag from
  // ANY combatant that has it set (defensive cleanup).
  const mended = makeCombatant('fighter', { _mended: true });
  cleanup(mended);
  eq('15a. _mended cleared by cleanup()',
    mended._mended, undefined);

  // resetBudget integration — flag clears at start of caster's next turn
  // (in v1, this works if the caster is also the target — self-cast Mending).
  const selfMended = makeCombatant('wizard', { _mended: true });
  resetBudget(selfMended);
  eq('15b. _mended cleared by resetBudget() (self-cast case)',
    selfMended._mended, undefined);

  // Cleanup is a no-op when the flag isn't set.
  const clean = makeCombatant('rogue');
  cleanup(clean);
  eq('15c. cleanup is a no-op when flag is not set',
    clean._mended, undefined);
}

// ============================================================
// 16. CANTRIP_TOUCH_EFFECTS routing bypasses resolveAttack
// ============================================================
console.log('\n--- 16. bypasses resolveAttack ---');
{
  const caster = makeCombatant('wizard', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [MENDING_ACTION],
  });
  const target = makeCombatant('fighter', {
    pos: { x: 6, y: 5, z: 0 },
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveCantripTouchEffect(caster, target, 'Mending', state);

  // Only the "casts Mending" action event should be present.
  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('16a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('16b. action event mentions Mending',
    actionEvents[0]?.description.includes('Mending') === true,
    `got: ${actionEvents[0]?.description}`);

  // No attack hit/miss/crit/damage events.
  const attackEvents = state.log.events.filter((e: CombatEvent) =>
    e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit' || e.type === 'damage',
  );
  eq('16c. no attack/damage events (touch-effect bypasses resolveAttack)',
    attackEvents.length, 0);

  // No save events.
  const saveEvents = state.log.events.filter((e: CombatEvent) =>
    e.type === 'save_success' || e.type === 'save_fail',
  );
  eq('16d. no save events (Mending has no save in canon)', saveEvents.length, 0);
}

// ============================================================
// 17. DEX save NOT triggered in v1 (Mending has no save in canon either)
// ============================================================
console.log('\n--- 17. no save triggered (canon + v1) ---');
{
  const caster = makeCombatant('wizard', {
    pos: { x: 5, y: 5, z: 0 },
  });
  const target = makeCombatant('goblin', {
    isPlayer: false, // monster — canonically Mending would have no save anyway
    pos: { x: 6, y: 5, z: 0 },
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  applyTouchEffect(caster, target, state);

  // Verify no save-related logs.
  const saveLogs = state.log.events.filter(
    (e: CombatEvent) => e.type === 'save_success' || e.type === 'save_fail',
  );
  eq('17a. no save_success/save_fail events', saveLogs.length, 0);

  // Verify no "fails DC ... save" or "succeeds on DC ... save" in any log.
  const anySaveMention = state.log.events.some(
    (e: CombatEvent) => e.description.toLowerCase().includes('save'),
  );
  eq('17b. no log mentions "save" (Mending has no save in canon or v1)',
    anySaveMention, false);

  // The target's _mended flag IS set.
  eq('17c. monster target IS mended',
    target._mended, true);
}

// ============================================================
// 18. v1 flag is forward-compat only (no object-state integration yet)
// ============================================================
console.log('\n--- 18. v1 flag forward-compat ---');
{
  // The _mended flag is set on the target, but the engine does NOT yet
  // consume it. The flag is forward-compat — the future object-state
  // subsystem will read it.
  eq('18a. mendingObjectStateIntegrationV1Implemented = false (TODO acknowledged)',
    metadata.mendingObjectStateIntegrationV1Implemented, false);

  // Verify the flag IS set (forward-compat: the flag exists for the future
  // object-state subsystem to read).
  const caster = makeCombatant('wizard');
  const target = makeCombatant('fighter');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  applyTouchEffect(caster, target, state);
  eq('18b. _mended flag IS set on target (forward-compat)',
    target._mended, true);
}

// ============================================================
// 19. flavor log emitted on cast (mentions "repair" + "break" or "tear" + caster + target)
// ============================================================
console.log('\n--- 19. flavor log ---');
{
  const caster = makeCombatant('wizard', { name: 'Wizard Will' });
  const target = makeCombatant('fighter', { name: 'Fighter Fay' });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  applyTouchEffect(caster, target, state);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Mending'),
  );
  assert('19a. cast log mentions caster name',
    castLog?.description.includes('Wizard Will') === true,
    `got: ${castLog?.description}`);
  assert('19b. cast log mentions target name',
    castLog?.description.includes('Fighter Fay') === true,
    `got: ${castLog?.description}`);
  assert('19c. cast log mentions "casts Mending"',
    castLog?.description.includes('casts Mending') === true,
    `got: ${castLog?.description}`);
  assert('19d. cast log mentions "repair" or "mend"',
    castLog?.description.toLowerCase().includes('repair') === true ||
    castLog?.description.toLowerCase().includes('mend') === true,
    `got: ${castLog?.description}`);
  assert('19e. cast log mentions "break" or "tear"',
    castLog?.description.toLowerCase().includes('break') === true ||
    castLog?.description.toLowerCase().includes('tear') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// 20. v1 casting-time simplification documented (canon: 1 min; v1: 1 action)
// ============================================================
console.log('\n--- 20. v1 casting-time simplification ---');
{
  // Verify the metadata flag is set (canon 1-min casting time acknowledged).
  eq('20a. mendingCastingTimeV1Simplified = true (canon: 1 min; v1: 1 action)',
    metadata.mendingCastingTimeV1Simplified, true);

  // Verify the metadata.castingTime is 'action' (v1 simplification).
  eq('20b. metadata.castingTime = "action" (v1 simplification)',
    metadata.castingTime, 'action');

  // Verify the cast log mentions the casting-time simplification (canon: 1 minute).
  const caster = makeCombatant('wizard');
  const target = makeCombatant('fighter');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  applyTouchEffect(caster, target, state);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Mending'),
  );
  assert('20c. cast log mentions "1 minute" (canon casting time)',
    castLog?.description.toLowerCase().includes('1 minute') === true,
    `got: ${castLog?.description}`);
  assert('20d. cast log mentions "standard action" or "engine simplicity" (v1 simplification)',
    castLog?.description.toLowerCase().includes('standard action') === true ||
    castLog?.description.toLowerCase().includes('engine simplicity') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
