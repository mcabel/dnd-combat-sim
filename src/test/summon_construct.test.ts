// ============================================================
// summon_construct.test.ts — Summon Construct spell module (TCE p.111)
// 4th-level conjuration, action, range 30 ft, concentration 1 hr.
// Effect: Spawns a Construct Spirit combatant that shares the caster's
//         initiative count and takes its turn immediately after.
//         HP/AC scale with slot level. Disappears on concentration
//         break or 0 HP.
//
// Tests cover: metadata, shouldCast gates, execute combatant creation,
// summon tags, battlefield addition, initiative insertion, concentration
// break despawn, HP/AC scaling, and stat block.
// ============================================================

import { shouldCast, execute, metadata, createConstructSpirit } from '../spells/summon_construct';
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

const SUMMON_CONSTRUCT_ACTION: Action = {
  name: 'Summon Construct',
  isMultiattack: false,
  attackType: 'save',
  reach: 30,
  range: { normal: 30, long: 30 },
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
  description: 'Summon Construct (concentration 1 hr)',
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
    name: 'Artificer',
    pos,
    actions: [SUMMON_CONSTRUCT_ACTION],
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

eq('name is Summon Construct', metadata.name, 'Summon Construct');
eq('level is 4', metadata.level, 4);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 30 ft', metadata.rangeFt, 30);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('summonConstructV1Implemented is true', metadata.summonConstructV1Implemented, true);
eq('summonConstructUpcastV1Implemented is true', metadata.summonConstructUpcastV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Summon Construct action', shouldCast(caster, bf) === false);
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
    name: 'Construct Spirit (Artificer)',
    faction: 'party',
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Summon Construct',
  });
  const bf = makeBF([caster, enemy, existingSummon]);
  assert('Returns false when caster already has a Summon Construct active', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createConstructSpirit — combatant creation
// ============================================================

console.log('\n=== 3. createConstructSpirit — combatant creation ===\n');

{
  const caster = makeCaster();
  const spirit = createConstructSpirit(caster, 4);

  eq('isSummon is true', spirit.isSummon, true);
  eq('summonerId matches caster', spirit.summonerId, 'caster1');
  eq('summonSpellName is Summon Construct', spirit.summonSpellName, 'Summon Construct');
  eq('faction matches caster', spirit.faction, 'party');
  eq('name includes Construct Spirit', spirit.name.includes('Construct Spirit'), true);
  eq('name includes caster name', spirit.name.includes('Artificer'), true);
  eq('HP at L4 is 40', spirit.maxHP, 40);
  eq('currentHP equals maxHP', spirit.currentHP, spirit.maxHP);
  eq('AC at L4 is 17 (13+4)', spirit.ac, 17);
  eq('aiProfile is attackNearest', spirit.aiProfile, 'attackNearest');
  eq('speed is 30', spirit.speed, 30);
  eq('STR is 18', spirit.str, 18);
  eq('DEX is 10', spirit.dex, 10);
  eq('CON is 14', spirit.con, 14);
  eq('INT is 4', spirit.int, 4);
  eq('WIS is 10', spirit.wis, 10);
  eq('CHA is 6', spirit.cha, 6);
  eq('cr is 0', spirit.cr, 0);
  eq('has 1 attack action at L4', spirit.actions.length, 1);
  eq('attack name is Slam', spirit.actions[0].name, 'Slam');
  eq('attack hitBonus is +6', spirit.actions[0].hitBonus, 6);
  eq('attack damage is 1d8+4', spirit.actions[0].damage?.count === 1 && spirit.actions[0].damage?.sides === 8 && spirit.actions[0].damage?.bonus === 4, true);
  eq('attack damageType is bludgeoning', spirit.actions[0].damageType, 'bludgeoning');
  assert('Position is adjacent to caster', spirit.pos.x === 1 && spirit.pos.y === 0);
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
    eq('Summon summonSpellName is Summon Construct', summon.summonSpellName, 'Summon Construct');
    eq('Summon faction matches caster', summon.faction, 'party');
    eq('Summon HP at L4 is 40', summon.maxHP, 40);
    eq('Summon AC at L4 is 17', summon.ac, 17);
  }

  eq('Caster concentrating on Summon Construct', caster.concentration?.spellName, 'Summon Construct');
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
// 7. HP/AC scale with slot level
// ============================================================

console.log('\n=== 7. HP/AC scale with slot level ===\n');

{
  const caster = makeCaster();

  const spirit4 = createConstructSpirit(caster, 4);
  eq('L4: HP = 40', spirit4.maxHP, 40);
  eq('L4: AC = 17 (13+4)', spirit4.ac, 17);

  const spirit5 = createConstructSpirit(caster, 5);
  eq('L5: HP = 50', spirit5.maxHP, 50);
  eq('L5: AC = 18 (13+5)', spirit5.ac, 18);
  eq('L5: 2 attack actions (Multiattack)', spirit5.actions.length, 2);

  const spirit6 = createConstructSpirit(caster, 6);
  eq('L6: HP = 60', spirit6.maxHP, 60);
  eq('L6: AC = 19 (13+6)', spirit6.ac, 19);

  const spirit8 = createConstructSpirit(caster, 8);
  eq('L8: HP = 80', spirit8.maxHP, 80);
  eq('L8: AC = 21 (13+8)', spirit8.ac, 21);

  const spirit9 = createConstructSpirit(caster, 9);
  eq('L9: HP = 90', spirit9.maxHP, 90);
  eq('L9: AC = 22 (13+9)', spirit9.ac, 22);
  eq('L9: 2 attack actions (Multiattack)', spirit9.actions.length, 2);
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
    assert('Action event mentions "Summon Construct"', actionEvents[0].description.includes('Summon Construct'));
    assert('Action event mentions "Construct Spirit"', actionEvents[0].description.includes('Construct Spirit'));
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
