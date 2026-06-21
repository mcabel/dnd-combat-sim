// ============================================================
// Test: Chill Touch Cantrip
// PHB p.221 — Level 0 necromancy cantrip
//
// Tests:
//   1. metadata correctness
//   2. applyCantripEffect (module) — no-heal rider on any target
//   3. applyCantripEffect (module) — undead disadv rider only on undead
//   4. dispatcher integration — 'Chill Touch' registered in CANTRIP_EFFECTS
//   5. applyHeal heal-block when _chillTouchNoHealing is set
//   6. resetBudget cleanup clears both flags
//   7. dispatcher safety — unknown cantrip name is a no-op
//
// Run: npx ts-node src/test/chill_touch.test.ts
// ============================================================

import { metadata, applyCantripEffect } from '../spells/chill_touch';
import { applyCantripEffect as dispatchCantrip } from '../engine/cantrip_effects';
import { applyHeal, resetBudget } from '../engine/utils';
import { Combatant, Action, PlayerResources, Vec3, Cell } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
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

function makeBF(combatants: Combatant[]) {
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

const CHILL_TOUCH_ACTION: Action = {
  name: 'Chill Touch',
  isMultiattack: false,
  attackType: 'spell',
  reach: 0,
  range: { normal: 120, long: 120 },
  hitBonus: 5,
  damage: { count: 1, sides: 8, bonus: 0, average: 4 },
  damageType: 'necrotic',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Chill Touch',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Chill Touch');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'necromancy');
  eq('1d. rangeFt (120)', metadata.rangeFt, 120);
  eq('1e. damageDice', metadata.damageDice, '1d8');
  eq('1f. damageType', metadata.damageType, 'necrotic');
  eq('1g. not concentration', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. applyCantripEffect (module) — no-heal rider on any target
// ============================================================
console.log('\n--- 2. applyCantripEffect (module): no-heal rider ---');
{
  const caster = makeCombatant('wizard', { actions: [CHILL_TOUCH_ACTION], resources: withSlots(1) });
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const ret = applyCantripEffect(caster, target, state);
  eq('2a. returns true', ret, true);
  eq('2b. target._chillTouchNoHealing set', target._chillTouchNoHealing, true);
  eq('2c. non-undead target: _chillTouchDisadvVs NOT set', target._chillTouchDisadvVs, undefined);

  const logEntry = state.log.events.find(
    (e: any) => e.type === 'action' && e.description.includes('Chill Touch') && e.description.includes('no healing'),
  );
  assert('2d. no-heal rider logged', logEntry !== undefined, 'expected a log event mentioning Chill Touch + no healing');
}

// ============================================================
// 3. applyCantripEffect (module) — undead disadv rider only on undead
// ============================================================
console.log('\n--- 3. applyCantripEffect (module): undead disadv rider ---');
{
  const caster = makeCombatant('cleric', { actions: [CHILL_TOUCH_ACTION], resources: withSlots(1) });
  const skeleton = makeCombatant('skeleton', { isUndead: true });
  const bf = makeBF([caster, skeleton]);
  const state = makeState(bf);

  const ret = applyCantripEffect(caster, skeleton, state);
  eq('3a. returns true', ret, true);
  eq('3b. undead target: _chillTouchNoHealing set', skeleton._chillTouchNoHealing, true);
  eq('3c. undead target: _chillTouchDisadvVs = caster.id', skeleton._chillTouchDisadvVs, 'cleric');

  const logUndead = state.log.events.find(
    (e: any) => e.description.includes('undead') && e.description.includes('disadvantage'),
  );
  assert('3d. undead disadv rider logged', logUndead !== undefined, 'expected a log event mentioning undead + disadvantage');
}
{
  // Non-undead target must NOT get the disadv rider
  const caster = makeCombatant('wizard');
  const goblin = makeCombatant('goblin', { isUndead: false });
  const bf = makeBF([caster, goblin]);
  const state = makeState(bf);

  applyCantripEffect(caster, goblin, state);
  eq('3e. non-undead: _chillTouchNoHealing set', goblin._chillTouchNoHealing, true);
  eq('3f. non-undead: _chillTouchDisadvVs undefined', goblin._chillTouchDisadvVs, undefined);
}
{
  // isUndead undefined (default) → treated as non-undead
  const caster = makeCombatant('wizard');
  const beast = makeCombatant('wolf'); // isUndead not set
  const bf = makeBF([caster, beast]);
  const state = makeState(bf);

  applyCantripEffect(caster, beast, state);
  eq('3g. isUndead undefined: no disadv rider', beast._chillTouchDisadvVs, undefined);
  eq('3h. isUndead undefined: heal-block still applied', beast._chillTouchNoHealing, true);
}

// ============================================================
// 4. dispatcher integration — 'Chill Touch' registered in CANTRIP_EFFECTS
// ============================================================
console.log('\n--- 4. dispatcher integration ---');
{
  const caster = makeCombatant('wizard', { actions: [CHILL_TOUCH_ACTION], resources: withSlots(1) });
  const skeleton = makeCombatant('skeleton', { isUndead: true });
  const bf = makeBF([caster, skeleton]);
  const state = makeState(bf);

  // Route through the central dispatcher (same path resolveAttack uses)
  dispatchCantrip(caster, skeleton, 'Chill Touch', state);

  eq('4a. dispatcher set no-heal flag', skeleton._chillTouchNoHealing, true);
  eq('4b. dispatcher set undead disadv flag', skeleton._chillTouchDisadvVs, 'wizard');
  const logHit = state.log.events.find((e: any) => e.description.includes('Chill Touch'));
  assert('4c. dispatcher emitted Chill Touch log', logHit !== undefined);
}
{
  // Unknown cantrip name → dispatcher is a no-op (no throw, no state change)
  const caster = makeCombatant('wizard');
  const goblin = makeCombatant('goblin');
  const bf = makeBF([caster, goblin]);
  const state = makeState(bf);

  dispatchCantrip(caster, goblin, 'Definitely Not A Cantrip', state);
  eq('4d. unknown cantrip → no heal-block', goblin._chillTouchNoHealing, undefined);
  eq('4e. unknown cantrip → no disadv flag', goblin._chillTouchDisadvVs, undefined);
  eq('4f. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 5. applyHeal heal-block when _chillTouchNoHealing is set
// ============================================================
console.log('\n--- 5. applyHeal heal-block ---');
{
  const caster = makeCombatant('cleric');
  const wounded = makeCombatant('fighter', { currentHP: 10, maxHP: 40 }); // 30 HP missing
  const bf = makeBF([caster, wounded]);
  const state = makeState(bf);

  // Before Chill Touch: heal works normally
  const healedBefore = applyHeal(wounded, 5);
  eq('5a. heal works before Chill Touch', healedBefore, 5);
  eq('5b. HP increased to 15', wounded.currentHP, 15);

  // Apply Chill Touch rider
  applyCantripEffect(caster, wounded, state);
  eq('5c. heal-block flag set', wounded._chillTouchNoHealing, true);

  // After Chill Touch: heal is blocked
  const healedAfter = applyHeal(wounded, 20);
  eq('5d. heal blocked (returns 0)', healedAfter, 0);
  eq('5e. HP unchanged at 15', wounded.currentHP, 15);
}
{
  // A target NOT struck by Chill Touch heals normally
  const target = makeCombatant('fighter', { currentHP: 10, maxHP: 40 });
  const healed = applyHeal(target, 10);
  eq('5f. unaffected target heals normally', healed, 10);
  eq('5g. HP increased to 20', target.currentHP, 20);
}

// ============================================================
// 6. resetBudget cleanup clears both flags
// ============================================================
console.log('\n--- 6. resetBudget cleanup ---');
{
  const caster = makeCombatant('cleric');
  const skeleton = makeCombatant('skeleton', { isUndead: true });
  const bf = makeBF([caster, skeleton]);
  const state = makeState(bf);

  applyCantripEffect(caster, skeleton, state);
  eq('6a. no-heal flag set', skeleton._chillTouchNoHealing, true);
  eq('6b. disadv flag set', skeleton._chillTouchDisadvVs, 'cleric');

  // Start of skeleton's next turn — resetBudget clears the riders
  resetBudget(skeleton);
  eq('6c. no-heal flag cleared', skeleton._chillTouchNoHealing, undefined);
  eq('6d. disadv flag cleared', skeleton._chillTouchDisadvVs, undefined);

  // Heal now works again
  skeleton.currentHP = 10; skeleton.maxHP = 40;
  const healed = applyHeal(skeleton, 5);
  eq('6e. heal works after cleanup', healed, 5);
}

// ============================================================
// Results ----------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
