// ============================================================
// Test: Light Cantrip
// PHB p.255 — Level 0 evocation cantrip (touch-effect: set _lightSourceActive flag)
//
// v1 simplifications (all documented via metadata flags):
//   - Duration: canonically 1 hour → v1: 1-round (clears at start of caster's next turn).
//   - Vision integration: canonically sheds bright/dim light in a radius
//     → v1: sets _lightSourceActive flag on target but engine's computeLOS
//     does NOT yet consume it (forward-compat TODO).
//   - Hostile-target DEX save: canonically imposes a DEX save on hostile creatures
//     → v1: treats ALL targets as "willing" (no DEX save).
//   - Dismissal: canonically "dismiss it as an action" → v1: no dismissal action.
//   - Recast: canonically "ends if you cast it again" → v1: no recast-tracking.
//   - Range: canonically Touch → v1: does NOT enforce adjacency.
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (V + M — firefly/phosphorescent moss, NO S, canon per 5etools JSON)
//   3. metadata exposes isTouchEffect = true
//   4. metadata exposes bright/dim light radii (20 ft + 20 ft)
//   5. metadata exposes v1 simplification flags
//   6. metadata does NOT scale (light radius is flat)
//   7. applyTouchEffect sets _lightSourceActive = true + emits log
//   8. applyTouchEffect on dead creature → fizzle (no effect, action consumed)
//   9. CANTRIP_TOUCH_EFFECTS routing — 'Light' routes to applyTouchEffect
//  10. dispatcher safety — unknown cantrip name is a no-op
//  11. resolveCantripTouchEffect returns true when target is null (fizzle, action consumed)
//  12. resolveCantripAction returns false (NOT a self-buff)
//  13. resolveCantripAoE returns false (NOT a caster-centered AoE)
//  14. no CANTRIP_EFFECTS entry (NOT a post-hit rider)
//  15. cleanup clears _lightSourceActive flag (resetBudget integration)
//  16. CANTRIP_TOUCH_EFFECTS routing bypasses resolveAttack (no attack hit/miss/damage events)
//  17. DEX save NOT triggered in v1 (all targets treated as willing)
//  18. v1 flag is forward-compat only (no vision integration yet)
//  19. flavor log emitted on cast (mentions Light + glow + radius)
//
// Run: npx ts-node src/test/light.test.ts
// ============================================================

import { metadata, applyTouchEffect, cleanup } from '../spells/light';
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

// A Light Action — touch-effect, no attack roll, no save (v1).
const LIGHT_ACTION: Action = {
  name: 'Light',
  isMultiattack: false,
  attackType: 'special', // touch-effect — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 0, long: 0 }, // Touch
  hitBonus: null,
  damage: null, // no damage — the cantrip ignites a target with light
  damageType: null,
  saveDC: null,
  saveAbility: null, // v1: no DEX save (all targets treated as willing)
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Light',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Light');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'evocation');
  eq('1d. rangeFt (0 — Touch)', metadata.rangeFt, 0);
  eq('1e. damageDice null (no damage — utility only)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. not concentration (no concentration required)', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. components: V + M (firefly/phosphorescent moss, NO S) — PHB p.255, canon per 5etools JSON
// ============================================================
console.log('\n--- 2. components ---');
{
  eq('2a. verbal component', metadata.components.v, true);
  eq('2b. NO somatic component (canon 5etools JSON: {"v":true,"m":...})',
    metadata.components.s, false);
  eq('2c. material component (firefly or phosphorescent moss)',
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
// 4. metadata exposes bright/dim light radii (20 ft + 20 ft)
// ============================================================
console.log('\n--- 4. light radii ---');
{
  eq('4a. brightLightRadiusFt = 20 (PHB p.255)', metadata.brightLightRadiusFt, 20);
  eq('4b. dimLightRadiusFt = 20 (PHB p.255: "dim light for an additional 20 ft")',
    metadata.dimLightRadiusFt, 20);
}

// ============================================================
// 5. metadata exposes v1 simplification flags
// ============================================================
console.log('\n--- 5. v1 simplification flags ---');
{
  eq('5a. lightVisionIntegrationV1Implemented = false (computeLOS does not yet consume the flag)',
    metadata.lightVisionIntegrationV1Implemented, false);
  eq('5b. lightDismissalV1Implemented = false (no dismissal action)',
    metadata.lightDismissalV1Implemented, false);
  eq('5c. lightRecastEndsPreviousV1Implemented = false (no recast-tracking)',
    metadata.lightRecastEndsPreviousV1Implemented, false);
  eq('5d. lightHostileTargetSaveV1Simplified = true (v1: no DEX save)',
    metadata.lightHostileTargetSaveV1Simplified, true);
  eq('5e. lightDurationV1Simplified = true (canon: 1 hour; v1: 1 round)',
    metadata.lightDurationV1Simplified, true);
  eq('5f. lightRangeEnforcementV1Simplified = true (canon: Touch; v1: no adjacency check)',
    metadata.lightRangeEnforcementV1Simplified, true);
}

// ============================================================
// 6. metadata does NOT scale (light radius is flat)
// ============================================================
console.log('\n--- 6. no scaling ---');
{
  eq('6a. scales = false (Light does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 7. applyTouchEffect sets _lightSourceActive = true + emits log
// ============================================================
console.log('\n--- 7. applyTouchEffect ---');
{
  const caster = makeCombatant('cleric', {
    pos: { x: 5, y: 5, z: 0 },
  });
  const target = makeCombatant('fighter', {
    pos: { x: 6, y: 5, z: 0 },
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  eq('7a. flag not set before cast', target._lightSourceActive, undefined);

  const ret = applyTouchEffect(caster, target, state);
  eq('7b. applyTouchEffect returns true', ret, true);
  eq('7c. _lightSourceActive set to true on TARGET (not caster)',
    target._lightSourceActive, true);
  eq('7d. _lightSourceActive NOT set on caster',
    caster._lightSourceActive, undefined);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Light'),
  );
  assert('7e. cast log emitted', castLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('7f. log mentions "glow" or "light"',
    castLog?.description.toLowerCase().includes('glow') === true ||
    castLog?.description.toLowerCase().includes('light') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// 8. applyTouchEffect on dead creature → fizzle (no effect, action consumed)
// ============================================================
console.log('\n--- 8. dead creature → fizzle ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
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
  eq('8b. corpse NOT ignited (already dead)',
    corpse._lightSourceActive, undefined);

  const fizzleLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.toLowerCase().includes('no effect'),
  );
  assert('8c. fizzle log emitted (dead target)',
    fizzleLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 9. CANTRIP_TOUCH_EFFECTS routing — 'Light' routes to applyTouchEffect
// ============================================================
console.log('\n--- 9. CANTRIP_TOUCH_EFFECTS routing ---');
{
  const caster = makeCombatant('cleric', {
    pos: { x: 5, y: 5, z: 0 },
  });
  const target = makeCombatant('fighter', {
    pos: { x: 6, y: 5, z: 0 },
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const ret = resolveCantripTouchEffect(caster, target, 'Light', state);
  eq('9a. resolveCantripTouchEffect returns true', ret, true);
  eq('9b. target _lightSourceActive set via dispatcher',
    target._lightSourceActive, true);
}

// ============================================================
// 10. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 10. dispatcher safety ---');
{
  const caster = makeCombatant('cleric');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const ret = resolveCantripTouchEffect(caster, target, 'Definitely Not A Cantrip', state);
  eq('10a. unknown cantrip → resolveCantripTouchEffect returns false (fall through)',
    ret, false);
  eq('10b. unknown cantrip → no log events', state.log.events.length, 0);
  eq('10c. unknown cantrip → no flag set on target',
    target._lightSourceActive, undefined);
}

// ============================================================
// 11. resolveCantripTouchEffect returns true when target is null (fizzle, action consumed)
// ============================================================
console.log('\n--- 11. null target → fizzle (action consumed) ---');
{
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripTouchEffect(caster, null, 'Light', state);
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
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Light', state);
  eq('12a. resolveCantripAction returns false (NOT a self-buff)', ret, false);
  eq('12b. no log events', state.log.events.length, 0);
  eq('12c. caster has no scratch fields set',
    caster._lightSourceActive, undefined);
}

// ============================================================
// 13. resolveCantripAoE returns false (NOT a caster-centered AoE)
// ============================================================
console.log('\n--- 13. not a caster-centered AoE ---');
{
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Light', state);
  eq('13a. resolveCantripAoE returns false', ret, false);
  eq('13b. no log events', state.log.events.length, 0);
}

// ============================================================
// 14. no CANTRIP_EFFECTS entry (NOT a post-hit rider)
// ============================================================
console.log('\n--- 14. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('cleric');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Light', state);
  eq('14a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);
  eq('14b. no flag set on target', target._lightSourceActive, undefined);
}

// ============================================================
// 15. cleanup clears _lightSourceActive flag (resetBudget integration)
// ============================================================
console.log('\n--- 15. cleanup ---');
{
  // The cleanup operates on the combatant whose turn is starting.
  // v1: the flag is set on the TARGET, but cleanup clears the flag from
  // ANY combatant that has it set (defensive cleanup).
  const lit = makeCombatant('fighter', { _lightSourceActive: true });
  cleanup(lit);
  eq('15a. _lightSourceActive cleared by cleanup()',
    lit._lightSourceActive, undefined);

  // resetBudget integration — flag clears at start of caster's next turn
  // (in v1, this works if the caster is also the target — self-cast Light).
  const selfLit = makeCombatant('cleric', { _lightSourceActive: true });
  resetBudget(selfLit);
  eq('15b. _lightSourceActive cleared by resetBudget() (self-cast case)',
    selfLit._lightSourceActive, undefined);
}

// ============================================================
// 16. CANTRIP_TOUCH_EFFECTS routing bypasses resolveAttack
// ============================================================
console.log('\n--- 16. bypasses resolveAttack ---');
{
  const caster = makeCombatant('cleric', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [LIGHT_ACTION],
  });
  const target = makeCombatant('fighter', {
    pos: { x: 6, y: 5, z: 0 },
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveCantripTouchEffect(caster, target, 'Light', state);

  // Only the "casts Light" action event should be present.
  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('16a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('16b. action event mentions Light',
    actionEvents[0]?.description.includes('Light') === true,
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
  eq('16d. no save events (Light v1 has no DEX save)', saveEvents.length, 0);
}

// ============================================================
// 17. DEX save NOT triggered in v1 (all targets treated as willing)
// ============================================================
console.log('\n--- 17. no DEX save triggered (v1) ---');
{
  const caster = makeCombatant('cleric', {
    pos: { x: 5, y: 5, z: 0 },
  });
  const target = makeCombatant('goblin', {
    isPlayer: false, // monster — canonically would impose a DEX save (hostile creature)
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
  eq('17b. no log mentions "save" (v1: no DEX save, even on hostile target)',
    anySaveMention, false);

  // The target's _lightSourceActive flag IS set (v1 treats all as willing).
  eq('17c. monster target IS ignited (v1: no DEX save — all treated as willing)',
    target._lightSourceActive, true);
}

// ============================================================
// 18. v1 flag is forward-compat only (no vision integration yet)
// ============================================================
console.log('\n--- 18. v1 flag forward-compat ---');
{
  // The _lightSourceActive flag is set on the target, but the engine's
  // computeLOS does NOT yet consume it. The flag is forward-compat —
  // the future vision subsystem will read it.
  eq('18a. lightVisionIntegrationV1Implemented = false (TODO acknowledged)',
    metadata.lightVisionIntegrationV1Implemented, false);

  // Verify the flag IS set (forward-compat: the flag exists for the future
  // vision subsystem to read).
  const caster = makeCombatant('cleric');
  const target = makeCombatant('fighter');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  applyTouchEffect(caster, target, state);
  eq('18b. _lightSourceActive flag IS set on target (forward-compat)',
    target._lightSourceActive, true);
}

// ============================================================
// 19. flavor log emitted on cast (mentions Light + glow + radius)
// ============================================================
console.log('\n--- 19. flavor log ---');
{
  const caster = makeCombatant('cleric', { name: 'Cleric Zoe' });
  const target = makeCombatant('fighter', { name: 'Fighter Dan' });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  applyTouchEffect(caster, target, state);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Light'),
  );
  assert('19a. cast log mentions caster name',
    castLog?.description.includes('Cleric Zoe') === true,
    `got: ${castLog?.description}`);
  assert('19b. cast log mentions target name',
    castLog?.description.includes('Fighter Dan') === true,
    `got: ${castLog?.description}`);
  assert('19c. cast log mentions "casts Light"',
    castLog?.description.includes('casts Light') === true,
    `got: ${castLog?.description}`);
  assert('19d. cast log mentions "20-foot" or "20 ft" (bright radius)',
    castLog?.description.includes('20') === true,
    `got: ${castLog?.description}`);
  assert('19e. cast log mentions "glow" or "light"',
    castLog?.description.toLowerCase().includes('glow') === true ||
    castLog?.description.toLowerCase().includes('light') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
