// ============================================================
// summon_greater_demon.test.ts — Summon Greater Demon spell module (XGE p.166)
// 4th-level conjuration, action, range 60 ft, concentration 1 min.
// Effect: Spawns a Barlgura combatant that shares the caster's
//         initiative count and takes its turn immediately after.
//         HP scales with slot level. Disappears on concentration
//         break or 0 HP. v1: always Barlgura, no break-free.
//
// Tests cover: metadata, shouldCast gates, execute combatant creation,
// summon tags, battlefield addition, initiative insertion, concentration
// break despawn, HP scaling, and Barlgura stat block.
// ============================================================

import { shouldCast, execute, metadata, createBarlgura } from '../spells/summon_greater_demon';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { Combatant, Action, PlayerResources, Vec3 } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots4(remaining = 2): PlayerResources {
  return { spellSlots: { 4: { max: 2, remaining } } };
}

const SUMMON_GREATER_DEMON_ACTION: Action = {
  name: 'Summon Greater Demon',
  isMultiattack: false,
  attackType: 'save',
  reach: 60,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 15,
  saveAbility: 'wis',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 4,
  costType: 'action',
  legendaryCost: 0,
  description: 'Summon Greater Demon (concentration 1 min)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
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

function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Warlock',
    pos,
    actions: [SUMMON_GREATER_DEMON_ACTION],
    resources: withSlots4(2),
  });
}

function makeEnemy(id: string = 'enemy1', pos: Vec3 = { x: 5, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    pos,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Summon Greater Demon', metadata.name, 'Summon Greater Demon');
eq('level is 4', metadata.level, 4);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('summonGreaterDemonV1Implemented is true', metadata.summonGreaterDemonV1Implemented, true);
eq('summonGreaterDemonUpcastV1Implemented is true', metadata.summonGreaterDemonUpcastV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Summon Greater Demon action', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  caster.resources = withSlots4(0);
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when no 4th-level slots', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Barkskin', dcIfHit: 10 };
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster is already concentrating', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingSummon = makeCombatant('existing_summon', {
    name: 'Barlgura (Warlock)',
    faction: 'party',
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Summon Greater Demon',
  });
  const bf = makeBF([caster, enemy, existingSummon]);
  assert('Returns false when caster already has a Summon Greater Demon active', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createBarlgura — combatant creation
// ============================================================

console.log('\n=== 3. createBarlgura — combatant creation ===\n');

{
  const caster = makeCaster();
  const demon = createBarlgura(caster, 4);

  eq('isSummon is true', demon.isSummon, true);
  eq('summonerId matches caster', demon.summonerId, 'caster1');
  eq('summonSpellName is Summon Greater Demon', demon.summonSpellName, 'Summon Greater Demon');
  eq('faction matches caster', demon.faction, 'party');
  eq('name includes Barlgura', demon.name.includes('Barlgura'), true);
  eq('name includes caster name', demon.name.includes('Warlock'), true);
  eq('HP at L4 is 52', demon.maxHP, 52);
  eq('currentHP equals maxHP', demon.currentHP, demon.maxHP);
  eq('AC is 15', demon.ac, 15);
  eq('aiProfile is attackNearest', demon.aiProfile, 'attackNearest');
  eq('speed is 30', demon.speed, 30);
  eq('STR is 18', demon.str, 18);
  eq('DEX is 13', demon.dex, 13);
  eq('CON is 14', demon.con, 14);
  eq('INT is 7', demon.int, 7);
  eq('WIS is 6', demon.wis, 6);
  eq('CHA is 6', demon.cha, 6);
  eq('cr is 5', demon.cr, 5);
  eq('has 2 attack actions (Bite + Claws)', demon.actions.length, 2);
  eq('first attack name is Bite', demon.actions[0].name, 'Bite');
  eq('second attack name is Claws', demon.actions[1].name, 'Claws');
  eq('Bite hitBonus is +6', demon.actions[0].hitBonus, 6);
  eq('Claws hitBonus is +6', demon.actions[1].hitBonus, 6);
  eq('Bite damage is 1d8+4', demon.actions[0].damage?.count === 1 && demon.actions[0].damage?.sides === 8 && demon.actions[0].damage?.bonus === 4, true);
  eq('Claws damage is 1d10+4', demon.actions[1].damage?.count === 1 && demon.actions[1].damage?.sides === 10 && demon.actions[1].damage?.bonus === 4, true);
  eq('Bite damageType is piercing', demon.actions[0].damageType, 'piercing');
  eq('Claws damageType is slashing', demon.actions[1].damageType, 'slashing');
  assert('Position is adjacent to caster', demon.pos.x === 1 && demon.pos.y === 0);
}

// ============================================================
// 4. execute — creates summon and adds to battlefield
// ============================================================

console.log('\n=== 4. execute — creates summon and adds to battlefield ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  eq('1 summon added to battlefield', summons.length, 1);

  if (summons.length === 1) {
    const summon = summons[0];
    eq('Summon isSummon is true', summon.isSummon, true);
    eq('Summon summonerId is caster', summon.summonerId, 'caster1');
    eq('Summon summonSpellName is Summon Greater Demon', summon.summonSpellName, 'Summon Greater Demon');
    eq('Summon faction matches caster', summon.faction, 'party');
    eq('Summon HP at L4 is 52', summon.maxHP, 52);
    eq('Summon AC is 15', summon.ac, 15);
    eq('Summon has 2 attacks', summon.actions.length, 2);
  }

  eq('Caster concentrating on Summon Greater Demon', caster.concentration?.spellName, 'Summon Greater Demon');
  eq('Caster concentration is active', caster.concentration?.active, true);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![4]!.remaining, 1);
}

// ============================================================
// 5. execute — pendingInitiativeInserts
// ============================================================

console.log('\n=== 5. execute — pendingInitiativeInserts ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  assert('pendingInitiativeInserts exists', Array.isArray(bf.pendingInitiativeInserts));
  if (Array.isArray(bf.pendingInitiativeInserts)) {
    eq('1 pending insert', bf.pendingInitiativeInserts.length, 1);
    if (bf.pendingInitiativeInserts.length >= 1) {
      eq('insertAfterId is caster id', bf.pendingInitiativeInserts[0].insertAfterId, 'caster1');
    }
  }
}

// ============================================================
// 6. Concentration break despawns the summon
// ============================================================

console.log('\n=== 6. Concentration break despawns the summon ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  const summonsBefore = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  eq('Summon exists before concentration break', summonsBefore.length, 1);

  removeEffectsFromCaster(caster.id, bf);

  const summonsAfter = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  eq('Summon removed after concentration break', summonsAfter.length, 0);
}

// ============================================================
// 7. HP scales with slot level (AC is fixed at 15)
// ============================================================

console.log('\n=== 7. HP scales with slot level (AC is fixed at 15) ===\n');

{
  const caster = makeCaster();

  const demon4 = createBarlgura(caster, 4);
  eq('L4: HP = 52', demon4.maxHP, 52);
  eq('L4: AC = 15', demon4.ac, 15);

  const demon5 = createBarlgura(caster, 5);
  eq('L5: HP = 67 (52+15)', demon5.maxHP, 67);
  eq('L5: AC = 15', demon5.ac, 15);

  const demon6 = createBarlgura(caster, 6);
  eq('L6: HP = 82 (52+30)', demon6.maxHP, 82);

  const demon7 = createBarlgura(caster, 7);
  eq('L7: HP = 97 (52+45)', demon7.maxHP, 97);

  const demon8 = createBarlgura(caster, 8);
  eq('L8: HP = 112 (52+60)', demon8.maxHP, 112);

  const demon9 = createBarlgura(caster, 9);
  eq('L9: HP = 127 (52+75)', demon9.maxHP, 127);
}

// ============================================================
// 8. execute — logging
// ============================================================

console.log('\n=== 8. execute — logging ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  if (actionEvents.length >= 1) {
    assert('Action event mentions "Summon Greater Demon"', actionEvents[0].description.includes('Summon Greater Demon'));
    assert('Action event mentions "Barlgura"', actionEvents[0].description.includes('Barlgura'));
    assert('Action event mentions HP', actionEvents[0].description.includes('HP'));
  }
}

// ============================================================
// 9. shouldCast returns true even with no enemies
// ============================================================

console.log('\n=== 9. shouldCast — no enemy required ===\n');

{
  const caster = makeCaster();
  const bf = makeBF([caster]);
  assert('Returns true even with no enemies (summon does not need target)', shouldCast(caster, bf) === true);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
