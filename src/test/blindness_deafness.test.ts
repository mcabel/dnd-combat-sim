// ============================================================
// blindness_deafness.test.ts — Blindness/Deafness spell module
// PHB p.219: 2nd-level necromancy, action, 30 ft, CON save, NO concentration.
// Effect: target is blinded (v1: always blinded) for 1 min on CON save fail.
//
// Tests cover shouldCast() preconditions + target priority, execute()
// save resolution + condition_apply effect + logging, the no-concentration
// invariant (sourceIsConcentration: false), and the cleanup no-op pattern.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/blindness_deafness';
import { Combatant, Action, PlayerResources } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function withSlots2(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

const BD_ACTION: Action = {
  name: 'Blindness/Deafness',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: 30, long: 30 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 15,
  saveAbility: 'con',
  isAoE: false,
  isControl: true,
  requiresConcentration: false,    // PHB p.219: NOT concentration!
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Blindness/Deafness (CON save or blinded, no concentration)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 12, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10,
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

function makeBF(combatants: Combatant[]) {
  return {
    width: 20, height: 20, depth: 1,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

/** Cleric at (0,0,0) with Blindness/Deafness + 2 2nd-level slots */
function makeCleric(): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    actions: [BD_ACTION],
    resources: withSlots2(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('level is 2', metadata.level, 2);
eq('school is necromancy', metadata.school, 'necromancy');
eq('range is 30 ft', metadata.rangeFt, 30);
eq('NOT concentration (PHB p.219 — unusual!)', metadata.concentration, false);
eq('save ability is con', metadata.saveAbility, 'con');
eq('casting time is action', metadata.castingTime, 'action');
eq('v1 always picks blinded (simplified flag)', (metadata as any).blindnessDeafnessAlwaysBlindV1Simplified, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Blindness/Deafness' action
  const caster = makeCleric();
  caster.actions = [];
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no BD action', shouldCast(caster, bf), null);
}

{
  // 2b. No 2nd-level slots
  const caster = makeCleric();
  caster.resources = withSlots2(0);
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 2nd-level slots', shouldCast(caster, bf), null);
}

{
  // 2c. No enemies
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { faction: 'party' });
  const bf = makeBF([caster, ally]);
  eq('Returns null when no enemies present', shouldCast(caster, bf), null);
}

{
  // 2d. Enemy out of range (> 30 ft)
  const caster = makeCleric();
  const enemy = makeCombatant('e1', { faction: 'enemy', pos: { x: 7, y: 0, z: 0 } }); // 35 ft
  const bf = makeBF([caster, enemy]);
  eq('Returns null when only enemy is out of range', shouldCast(caster, bf), null);
}

{
  // 2e. Enemy already blinded by this caster — skip
  const caster = makeCleric();
  const enemy = makeCombatant('e1', {
    faction: 'enemy',
    activeEffects: [{
      id: 'eff_1',
      casterId: 'cleric1',
      spellName: 'Blindness/Deafness',
      effectType: 'condition_apply',
      payload: { condition: 'blinded' },
      sourceIsConcentration: false,
    }],
  });
  const otherEnemy = makeCombatant('e2', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy, otherEnemy]);
  const result = shouldCast(caster, bf);
  eq('Already-blinded enemy skipped', result?.[0]?.id, 'e2');
}

{
  // 2f. Enemy already blinded by ANY source — skip
  const caster = makeCleric();
  const enemy = makeCombatant('e1', { faction: 'enemy', conditions: new Set(['blinded']) });
  const otherEnemy = makeCombatant('e2', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy, otherEnemy]);
  const result = shouldCast(caster, bf);
  eq('Already-blinded (any source) enemy skipped', result?.[0]?.id, 'e2');
}

{
  // 2g. NOT concentration — should NOT gate on caster.concentration
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 } as any;
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  // shouldCast should NOT return null just because caster is concentrating
  assert('shouldCast does NOT gate on concentration (BD is non-concentration)', result !== null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Highest-threat enemy picked (highest maxHP)
  const caster = makeCleric();
  const weak = makeCombatant('weak', { faction: 'enemy', maxHP: 10, pos: { x: 1, y: 0, z: 0 } });
  const strong = makeCombatant('strong', { faction: 'enemy', maxHP: 50, pos: { x: 2, y: 0, z: 0 } });
  const bf = makeBF([caster, weak, strong]);
  const result = shouldCast(caster, bf);
  eq('Highest-threat (maxHP) enemy picked', result?.[0]?.id, 'strong');
}

// ============================================================
// 4. execute — save resolution + condition application
// ============================================================

console.log('\n=== 4. execute — save resolution + condition application ===\n');

{
  // 4a. Target with CON 1 (-5 mod) vs save DC 25 — guaranteed fail → blinded applied
  // (max possible save: d20=20 + (-5) = 15 < 25 — always fails)
  const caster = makeCleric();
  caster.actions = [{ ...BD_ACTION, saveDC: 25 }];  // force guaranteed fail
  const enemy = makeCombatant('e1', { faction: 'enemy', con: 1 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, [enemy], state);

  assert('Enemy is blinded (CON 1 vs DC 25 — guaranteed fail)', enemy.conditions.has('blinded'));

  const effect = enemy.activeEffects.find(e => e.spellName === 'Blindness/Deafness');
  assert('BD effect registered on enemy', effect !== undefined);
  if (effect) {
    eq('effect.effectType is condition_apply', effect.effectType, 'condition_apply');
    eq('effect.payload.condition is blinded', effect.payload.condition, 'blinded');
    eq('effect.casterId is cleric1', effect.casterId, 'cleric1');
    // CRITICAL: PHB p.219 is NOT concentration — sourceIsConcentration must be false.
    eq('effect.sourceIsConcentration is FALSE (PHB p.219: NOT concentration)', effect.sourceIsConcentration, false);
  }
}

{
  // 4b. Target with CON 30 (+10 mod) vs save DC 5 — guaranteed success → NOT blinded
  // (min possible save: d20=1 + 10 = 11 >= 5 — always succeeds)
  const caster = makeCleric();
  caster.actions = [{ ...BD_ACTION, saveDC: 5 }];  // force guaranteed success
  const enemy = makeCombatant('e1', { faction: 'enemy', con: 30 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, [enemy], state);

  assert('Enemy is NOT blinded (CON 30 vs DC 5 — guaranteed success)', !enemy.conditions.has('blinded'));
  assert('No BD effect registered (save succeeded)', !enemy.activeEffects.some(e => e.spellName === 'Blindness/Deafness'));
}

{
  // 4c. Slot consumed (2nd level) — use guaranteed-fail DC for determinism
  const caster = makeCleric();
  caster.actions = [{ ...BD_ACTION, saveDC: 25 }];
  const enemy = makeCombatant('e1', { faction: 'enemy', con: 1 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, [enemy], state);

  eq('2nd-level slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4d. NO concentration started (PHB p.219: NOT concentration)
  const caster = makeCleric();
  caster.actions = [{ ...BD_ACTION, saveDC: 25 }];
  const enemy = makeCombatant('e1', { faction: 'enemy', con: 1 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, [enemy], state);

  // concentration should remain null (or unchanged from previous state)
  assert('Concentration is NOT started (BD is non-concentration)', caster.concentration === null || caster.concentration?.active !== true || caster.concentration?.spellName !== 'Blindness/Deafness');
}

{
  // 4e. Dead target skipped (stale edge case)
  const caster = makeCleric();
  caster.actions = [{ ...BD_ACTION, saveDC: 25 }];
  const deadEnemy = makeCombatant('e1', { faction: 'enemy', isDead: true, con: 1 });
  const bf = makeBF([caster, deadEnemy]);
  const state = makeState(bf);

  execute(caster, [deadEnemy], state);

  assert('Dead enemy not blinded', !deadEnemy.conditions.has('blinded'));
  // Slot is still consumed (the spell was cast — the target just died before resolution)
  eq('Slot still consumed (spell was cast)', caster.resources!.spellSlots![2]!.remaining, 1);
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeCleric();
  caster.actions = [{ ...BD_ACTION, saveDC: 25 }];
  const enemy = makeCombatant('e1', { faction: 'enemy', con: 1 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, [enemy], state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');
  const saveFailEvents = events.filter(e => e.type === 'save_fail');

  assert('Action event emitted (cast)', actionEvents.length >= 1);
  assert('save_fail event emitted (CON 1 vs DC 25 — guaranteed fail)', saveFailEvents.length >= 1);
  assert('condition_add event emitted (blinded applied)', condEvents.length >= 1);
  assert('Action event mentions Blindness/Deafness', actionEvents[0].description.includes('Blindness/Deafness'));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  // cleanup is a no-op for Blindness/Deafness (NOT concentration; condition persists)
  const caster = makeCleric();
  caster.actions = [{ ...BD_ACTION, saveDC: 25 }];
  const enemy = makeCombatant('e1', { faction: 'enemy', con: 1 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, [enemy], state);

  const enemyConditionsBefore = enemy.conditions.size;
  cleanup(caster); // should NOT remove the condition
  const enemyConditionsAfter = enemy.conditions.size;

  eq('cleanup does NOT remove conditions (no-op)', enemyConditionsAfter, enemyConditionsBefore);
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: cleric blinds a weak-CON enemy
  const caster = makeCleric();
  const enemy = makeCombatant('goblin1', { faction: 'enemy', con: 8, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast picks goblin (only enemy)', target?.[0]?.id === 'goblin1');
  if (target) execute(caster, target, state);

  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  // Goblin CON 8 (-1 mod) vs DC 15 — should usually fail
  // (don't assert blinded directly since it's probabilistic; instead check the
  // effect is registered OR a save_fail event was logged)
  const blinded = enemy.conditions.has('blinded');
  const savedFail = (state.log.events as any[]).some(e => e.type === 'save_fail');
  const savedSuccess = (state.log.events as any[]).some(e => e.type === 'save_success');
  assert('Either blinded applied OR save event logged', blinded || savedFail || savedSuccess);
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
  caster.resources = withSlots2(1);
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  eq('shouldCast returns null after slots exhausted', shouldCast(caster, makeBF([caster, enemy])), null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
