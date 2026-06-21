// ============================================================
// summon_lesser_demons.test.ts — Summon Lesser Demons spell module (XGE p.167)
// 3rd-level conjuration, action, range 60 ft, concentration 1 min.
// Effect: Spawns 2 Dretch combatants that share the caster's
//         initiative count and take their turn immediately after.
//         Disappears on concentration break or 0 HP.
//
// SPECIAL: This spell spawns MULTIPLE creatures (2 Dretches).
//
// Tests cover: metadata, shouldCast gates, execute combatant creation,
// summon tags, battlefield addition, initiative insertion, concentration
// break despawn (all dretches), multi-spawn, and stat block.
// ============================================================

import { shouldCast, execute, metadata, createDretch } from '../spells/summon_lesser_demons';
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

function withSlots3(remaining = 2): PlayerResources {
  return { spellSlots: { 3: { max: 2, remaining } } };
}

const SUMMON_LESSER_DEMONS_ACTION: Action = {
  name: 'Summon Lesser Demons',
  isMultiattack: false,
  attackType: 'save',
  reach: 60,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 13,
  saveAbility: 'wis',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Summon Lesser Demons (concentration 1 min)',
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
    actions: [SUMMON_LESSER_DEMONS_ACTION],
    resources: withSlots3(2),
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

eq('name is Summon Lesser Demons', metadata.name, 'Summon Lesser Demons');
eq('level is 3', metadata.level, 3);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('summonLesserDemonsV1Implemented is true', metadata.summonLesserDemonsV1Implemented, true);
eq('summonLesserDemonsUpcastV1Implemented is true', metadata.summonLesserDemonsUpcastV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Summon Lesser Demons action', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  caster.resources = withSlots3(0);
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when no 3rd-level slots', shouldCast(caster, bf) === false);
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
    name: 'Dretch 1 (Warlock)',
    faction: 'party',
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Summon Lesser Demons',
  });
  const bf = makeBF([caster, enemy, existingSummon]);
  assert('Returns false when caster already has a Summon Lesser Demons active', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createDretch — combatant creation
// ============================================================

console.log('\n=== 3. createDretch — combatant creation ===\n');

{
  const caster = makeCaster();
  const dretch = createDretch(caster, 0);

  eq('isSummon is true', dretch.isSummon, true);
  eq('summonerId matches caster', dretch.summonerId, 'caster1');
  eq('summonSpellName is Summon Lesser Demons', dretch.summonSpellName, 'Summon Lesser Demons');
  eq('faction matches caster', dretch.faction, 'party');
  eq('name includes Dretch', dretch.name.includes('Dretch'), true);
  eq('name includes caster name', dretch.name.includes('Warlock'), true);
  eq('HP is 18', dretch.maxHP, 18);
  eq('currentHP equals maxHP', dretch.currentHP, dretch.maxHP);
  eq('AC is 11', dretch.ac, 11);
  eq('aiProfile is attackNearest', dretch.aiProfile, 'attackNearest');
  eq('speed is 20', dretch.speed, 20);
  eq('STR is 11', dretch.str, 11);
  eq('DEX is 11', dretch.dex, 11);
  eq('CON is 12', dretch.con, 12);
  eq('INT is 5', dretch.int, 5);
  eq('WIS is 8', dretch.wis, 8);
  eq('CHA is 3', dretch.cha, 3);
  eq('cr is 0', dretch.cr, 0);
  eq('has 2 attack actions (Bite + Claws)', dretch.actions.length, 2);
  eq('first attack name is Bite', dretch.actions[0].name, 'Bite');
  eq('second attack name is Claws', dretch.actions[1].name, 'Claws');
  eq('Bite hitBonus is +2', dretch.actions[0].hitBonus, 2);
  eq('Claws hitBonus is +2', dretch.actions[1].hitBonus, 2);
  eq('Bite damage is 1d6', dretch.actions[0].damage?.count === 1 && dretch.actions[0].damage?.sides === 6, true);
  eq('Claws damage is 1d4', dretch.actions[1].damage?.count === 1 && dretch.actions[1].damage?.sides === 4, true);
  assert('Position is adjacent to caster', dretch.pos.x === 1 && dretch.pos.y === 0);
}

// ============================================================
// 4. execute — creates 2 Dretches and adds to battlefield
// ============================================================

console.log('\n=== 4. execute — creates 2 Dretches and adds to battlefield ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  // Find all dretches in the battlefield
  const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  eq('2 summons added to battlefield', summons.length, 2);

  if (summons.length === 2) {
    for (const summon of summons) {
      eq('Summon isSummon is true', summon.isSummon, true);
      eq('Summon summonerId is caster', summon.summonerId, 'caster1');
      eq('Summon summonSpellName is Summon Lesser Demons', summon.summonSpellName, 'Summon Lesser Demons');
      eq('Summon faction matches caster', summon.faction, 'party');
      eq('Summon HP is 18', summon.maxHP, 18);
      eq('Summon AC is 11', summon.ac, 11);
      eq('Summon has 2 attacks', summon.actions.length, 2);
    }
  }

  // Caster is concentrating on Summon Lesser Demons
  eq('Caster concentrating on Summon Lesser Demons', caster.concentration?.spellName, 'Summon Lesser Demons');
  eq('Caster concentration is active', caster.concentration?.active, true);

  // Slot consumed
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![3]!.remaining, 1);
}

// ============================================================
// 5. execute — pendingInitiativeInserts (2 inserts)
// ============================================================

console.log('\n=== 5. execute — pendingInitiativeInserts (2 inserts) ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  assert('pendingInitiativeInserts exists', Array.isArray(bf.pendingInitiativeInserts));
  if (Array.isArray(bf.pendingInitiativeInserts)) {
    eq('2 pending inserts', bf.pendingInitiativeInserts.length, 2);
    for (const insert of bf.pendingInitiativeInserts) {
      eq('insertAfterId is caster id', insert.insertAfterId, 'caster1');
    }
  }
}

// ============================================================
// 6. Concentration break despawns ALL Dretches
// ============================================================

console.log('\n=== 6. Concentration break despawns ALL Dretches ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  // Verify 2 dretches exist
  const summonsBefore = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  eq('2 Dretches exist before concentration break', summonsBefore.length, 2);

  // Break concentration
  removeEffectsFromCaster(caster.id, bf);

  // Verify all dretches are removed
  const summonsAfter = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  eq('All Dretches removed after concentration break', summonsAfter.length, 0);
}

// ============================================================
// 7. Dretch index positions
// ============================================================

console.log('\n=== 7. Dretch index positions ===\n');

{
  const caster = makeCaster();
  const dretch0 = createDretch(caster, 0);
  const dretch1 = createDretch(caster, 1);

  eq('Dretch 0 position x = caster.x + 1', dretch0.pos.x, 1);
  eq('Dretch 1 position x = caster.x + 2', dretch1.pos.x, 2);
  assert('Dretch IDs are unique', dretch0.id !== dretch1.id);
  assert('Dretch names differ by index', dretch0.name !== dretch1.name);
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
    assert('Action event mentions "Summon Lesser Demons"', actionEvents[0].description.includes('Summon Lesser Demons'));
    assert('Action event mentions "Dretch"', actionEvents[0].description.includes('Dretch'));
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
