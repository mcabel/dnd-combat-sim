// ============================================================
// shield_of_faith.test.ts
//
// Tests:
//   1. shouldCast — planner precondition gates (10 tests)
//   2. execute    — slot/concentration/effect pipeline (8 tests)
//
// Run: ts-node src/test/shield_of_faith.test.ts
// ============================================================

import { shouldCast, execute, metadata } from '../spells/shield_of_faith';
import { EngineState, CombatLog } from '../engine/combat';
import { Combatant, Battlefield, Action, PlayerResources } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}

function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Factories ----------------------------------------------

const SHIELD_OF_FAITH_ACTION: Action = {
  name: 'Shield of Faith',
  isMultiattack: false,
  attackType: 'save',
  reach: 60,
  range: { normal: 60, long: 120 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 1,
  costType: 'bonusAction',
  legendaryCost: 0,
  description: 'Shield of Faith',
};

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 30, currentHP: 30, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'aggressive' as any,
    perception: { knownEnemyPositions: new Map(), lastSeenPositions: new Map() } as any,
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

function makeCaster(id: string, pos = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    faction: 'party',
    pos,
    actions: [{ ...SHIELD_OF_FAITH_ACTION }],
    resources: withSlots(2),
  });
}

function makeAlly(id: string, pos = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    faction: 'party',
    pos,
    ac: 14,
  });
}

function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    combatants: map,
    round: 1,
    initiative: combatants.map((c, i) => ({ id: c.id, initiative: 10 - i })),
    obstacles: [],
  } as unknown as Battlefield;
}

function makeState(bf: Battlefield): EngineState {
  const log: CombatLog = { events: [], winner: null, rounds: 0 };
  return {
    battlefield: bf,
    log,
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// ---- Tests --------------------------------------------------

console.log('Shield of Faith (PHB p.275)\n');

// Section 1: Metadata
console.log('1. Metadata');
(() => {
  eq('1a: name', metadata.name, 'Shield of Faith');
  eq('1b: level', metadata.level, 1);
  eq('1c: range', metadata.rangeFt, 60);
  eq('1d: concentration', metadata.concentration, true);
  eq('1e: castingTime', metadata.castingTime, 'bonus action');
  eq('1f: school', metadata.school, 'abjuration');
  eq('1g: maxTargets', metadata.maxTargets, 1);
})();

// Section 2: shouldCast — guards
console.log('\n2. shouldCast — precondition guards');
(() => {
  // 2a: no action
  const noAction = makeCaster('cleric2');
  noAction.actions = noAction.actions.filter((a: any) => a.name !== 'Shield of Faith');
  const bf2a = makeBF([noAction]);
  assert('2a: returns null if no "Shield of Faith" action', shouldCast(noAction, bf2a) === null);

  // 2b: no slots
  const noSlots = makeCaster('cleric3');
  noSlots.resources!.spellSlots = { 1: { max: 1, remaining: 0 } };
  const bf2b = makeBF([noSlots]);
  assert('2b: returns null if no 1st-level slots', shouldCast(noSlots, bf2b) === null);

  // 2c: already concentrating
  const concentrating = makeCaster('cleric4');
  concentrating.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const bf2c = makeBF([concentrating]);
  assert('2c: returns null if already concentrating', shouldCast(concentrating, bf2c) === null);

  // 2d: no living party members in range (caster dead, only out-of-range ally)
  const deadCaster = makeCaster('cleric5');
  deadCaster.isDead = true;
  const farAlly = makeAlly('fighter', { x: 100, y: 0, z: 0 }); // 500 ft away
  // shouldCast can't be called for a dead caster, but we can verify: only out-of-range ally
  const aliveCaster = makeCaster('cleric5b');
  aliveCaster.pos = { x: 0, y: 0, z: 0 };
  const bf2d = makeBF([aliveCaster, farAlly]);
  // aliveCaster is in range of self; should return self
  assert('2d: returns self if only ally is out of range', shouldCast(aliveCaster, bf2d) === aliveCaster);

  // 2e: all party members (ally + self) already protected
  const caster6 = makeCaster('cleric6');
  caster6.pos = { x: 0, y: 0, z: 0 };
  const allyProt = makeAlly('fighter2', { x: 1, y: 0, z: 0 });
  allyProt.activeEffects.push({
    id: 'eff_1',
    casterId: caster6.id,
    spellName: 'Shield of Faith',
    effectType: 'ac_bonus',
    payload: { acBonus: 2 },
    sourceIsConcentration: true,
  });
  // Also protect self
  caster6.activeEffects.push({
    id: 'eff_2',
    casterId: caster6.id,
    spellName: 'Shield of Faith',
    effectType: 'ac_bonus',
    payload: { acBonus: 2 },
    sourceIsConcentration: true,
  });
  const bf3 = makeBF([caster6, allyProt]);
  assert('2e: returns null if all party members already protected', shouldCast(caster6, bf3) === null);
})();

// Section 3: shouldCast — target selection
console.log('\n3. shouldCast — target selection');
(() => {
  // 3a: caster has lowest AC — should target self
  const caster = makeCaster('cleric');
  caster.pos = { x: 0, y: 0, z: 0 };
  caster.ac = 12;
  const ally = makeAlly('fighter', { x: 1, y: 0, z: 0 });
  ally.ac = 18;
  const bf = makeBF([caster, ally]);
  eq('3a: targets self if self has lowest AC', shouldCast(caster, bf), caster);

  // 3b: ally has lower AC — should target ally
  const caster2 = makeCaster('cleric2');
  caster2.pos = { x: 0, y: 0, z: 0 };
  caster2.ac = 14;
  const allyLow = makeAlly('fighter2', { x: 1, y: 0, z: 0 });
  allyLow.ac = 12;
  const bf2 = makeBF([caster2, allyLow]);
  eq('3b: targets lowest AC ally', shouldCast(caster2, bf2), allyLow);

  // 3c: tied AC — prefer closest
  const caster3 = makeCaster('cleric3');
  caster3.pos = { x: 0, y: 0, z: 0 };
  caster3.ac = 20; // caster has highest AC, so not selected
  const ally1 = makeAlly('fighter3', { x: 1, y: 0, z: 0 });
  ally1.ac = 14;
  const ally2 = makeAlly('fighter4', { x: 4, y: 0, z: 0 });
  ally2.ac = 14;
  const bf3 = makeBF([caster3, ally1, ally2]);
  eq('3c: prefers closest when AC tied', shouldCast(caster3, bf3), ally1);

  // 3d: ally is dead — falls back to self
  const caster4 = makeCaster('cleric4');
  caster4.pos = { x: 0, y: 0, z: 0 };
  const deadAlly = makeAlly('fighter5', { x: 1, y: 0, z: 0 });
  deadAlly.ac = 10;
  deadAlly.isDead = true;
  const bf4 = makeBF([caster4, deadAlly]);
  eq('3d: ignores dead allies, falls back to self', shouldCast(caster4, bf4), caster4);

  // 3e: enemy nearby, no ally — returns self (enemy ignored)
  const caster5 = makeCaster('cleric5');
  caster5.pos = { x: 0, y: 0, z: 0 };
  caster5.ac = 14;
  const enemy = makeCombatant('goblin', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 }, ac: 12 });
  const bf5 = makeBF([caster5, enemy]);
  eq('3e: ignores enemies, targets self', shouldCast(caster5, bf5), caster5);
})();

// Section 4: execute — effect application
console.log('\n4. execute — effect application');
(() => {
  const caster = makeCaster('cleric');
  const target = makeAlly('fighter');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const slotsBefore = caster.resources!.spellSlots![1]!.remaining;
  execute(caster, target, state);
  const slotsAfter = caster.resources!.spellSlots![1]!.remaining;

  assert('4a: consumes 1st-level spell slot', slotsAfter < slotsBefore);

  const caster2 = makeCaster('cleric2');
  const target2 = makeAlly('fighter2');
  const bf2 = makeBF([caster2, target2]);
  const state2 = makeState(bf2);

  execute(caster2, target2, state2);

  assert('4b: starts concentration on Shield of Faith', caster2.concentration?.spellName === 'Shield of Faith');
  assert('4c: concentration is active', caster2.concentration?.active === true);

  const caster3 = makeCaster('cleric3');
  const target3 = makeAlly('fighter3');
  const bf3 = makeBF([caster3, target3]);
  const state3 = makeState(bf3);

  execute(caster3, target3, state3);

  const effect = target3.activeEffects.find((e: any) => e.casterId === caster3.id && e.spellName === 'Shield of Faith');
  assert('4d: applies ac_bonus effect', effect !== undefined);
  assert('4e: ac_bonus is +2', effect?.payload.acBonus === 2);
  assert('4f: effect is concentration-based', effect?.sourceIsConcentration === true);
})();

// Section 5: execute — edge cases
console.log('\n5. execute — edge cases');
(() => {
  const caster = makeCaster('cleric');
  const target = makeAlly('fighter');
  target.isDead = true;
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  execute(caster, target, state);

  const effect = target.activeEffects.find((e: any) => e.spellName === 'Shield of Faith');
  assert('5a: does not apply effect if target is dead', effect === undefined);

  const caster2 = makeCaster('cleric2');
  const oldTarget = makeAlly('fighter2');
  oldTarget.activeEffects.push({
    id: 'eff_bless',
    casterId: caster2.id,
    spellName: 'Bless',
    effectType: 'bless_die',
    payload: { dieSides: 4 },
    sourceIsConcentration: true,
  });
  caster2.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };

  const newTarget = makeAlly('fighter3');
  const bf2 = makeBF([caster2, oldTarget, newTarget]);
  const state2 = makeState(bf2);

  execute(caster2, newTarget, state2);

  const oldEffect = oldTarget.activeEffects.find((e: any) => e.spellName === 'Bless');
  const newEffect = newTarget.activeEffects.find((e: any) => e.spellName === 'Shield of Faith');

  assert('5b: removes old concentration effect', oldEffect === undefined);
  assert('5c: applies new Shield of Faith', newEffect !== undefined);

  const caster3 = makeCaster('cleric3');
  const bf3 = makeBF([caster3]);
  const state3 = makeState(bf3);

  execute(caster3, caster3, state3);

  const selfEffect = caster3.activeEffects.find((e: any) => e.spellName === 'Shield of Faith');
  assert('5d: applies effect to self correctly', selfEffect !== undefined);
})();

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('All tests passed ✅');
  process.exit(0);
} else {
  process.exit(1);
}
