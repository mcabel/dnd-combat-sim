// ============================================================
// summon_draconic_spirit.test.ts — Summon Draconic Spirit spell module (FTD p.21)
// 5th-level conjuration, action, range 30 ft, concentration 1 hr.
// Effect: Spawns a Draconic Spirit combatant that shares the caster's
//         initiative count and takes its turn immediately after.
//         HP/AC scale with slot level. Disappears on concentration
//         break or 0 HP.
//
// Tests cover: metadata, shouldCast gates, execute combatant creation,
// summon tags, battlefield addition, initiative insertion, concentration
// break despawn, HP/AC scaling, dragon color damage types, and upcast.
// ============================================================

import { shouldCast, execute, metadata, createDraconicSpirit } from '../spells/summon_draconic_spirit';
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

function withSlots5(remaining = 2): PlayerResources {
  return { spellSlots: { 5: { max: 2, remaining } } };
}

function withSlotsUpTo(level: number, remaining: Record<number, number>): PlayerResources {
  const spellSlots: Record<number, { max: number; remaining: number }> = {};
  for (let l = 1; l <= level; l++) {
    spellSlots[l] = { max: remaining[l] ?? 0, remaining: remaining[l] ?? 0 };
  }
  return { spellSlots };
}

const SUMMON_DRACONIC_ACTION: Action = {
  name: 'Summon Draconic Spirit',
  isMultiattack: false,
  attackType: 'save',
  reach: 30,
  range: { normal: 30, long: 30 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 17,
  saveAbility: 'wis',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 5,
  costType: 'action',
  legendaryCost: 0,
  description: 'Summon Draconic Spirit (concentration 1 hr)',
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

/** Caster with Summon Draconic Spirit action + 5th-level slots */
function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Sorcerer',
    pos,
    actions: [SUMMON_DRACONIC_ACTION],
    resources: withSlots5(2),
  });
}

/** Enemy for battlefield context */
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

eq('name is Summon Draconic Spirit', metadata.name, 'Summon Draconic Spirit');
eq('level is 5', metadata.level, 5);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 30 ft', metadata.rangeFt, 30);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('summonDraconicSpiritV1Implemented is true', metadata.summonDraconicSpiritV1Implemented, true);
eq('summonDraconicSpiritUpcastV1Implemented is true', metadata.summonDraconicSpiritUpcastV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Summon Draconic Spirit action', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  caster.resources = withSlots5(0);
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when no 5th-level slots', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster is already concentrating', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingSummon = makeCombatant('existing_summon', {
    name: 'Draconic Spirit (Sorcerer)',
    faction: 'party',
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Summon Draconic Spirit',
  });
  const bf = makeBF([caster, enemy, existingSummon]);
  assert('Returns false when caster already has a Summon Draconic Spirit active', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createDraconicSpirit — combatant creation (default: Red)
// ============================================================

console.log('\n=== 3. createDraconicSpirit — combatant creation (default: Red) ===\n');

{
  const caster = makeCaster();
  const spirit = createDraconicSpirit(caster, 5);

  eq('isSummon is true', spirit.isSummon, true);
  eq('summonerId matches caster', spirit.summonerId, 'caster1');
  eq('summonSpellName is Summon Draconic Spirit', spirit.summonSpellName, 'Summon Draconic Spirit');
  eq('faction matches caster', spirit.faction, 'party');
  eq('name includes Draconic Spirit', spirit.name.includes('Draconic Spirit'), true);
  eq('name includes caster name', spirit.name.includes('Sorcerer'), true);
  eq('HP at L5 is 50', spirit.maxHP, 50);
  eq('currentHP equals maxHP', spirit.currentHP, spirit.maxHP);
  eq('AC at L5 is 19 (14+5)', spirit.ac, 19);
  eq('aiProfile is attackNearest', spirit.aiProfile, 'attackNearest');
  eq('speed is 30', spirit.speed, 30);
  eq('flySpeed is 40', spirit.flySpeed, 40);
  eq('STR is 16', spirit.str, 16);
  eq('DEX is 12', spirit.dex, 12);
  eq('CON is 14', spirit.con, 14);
  eq('INT is 8', spirit.int, 8);
  eq('WIS is 12', spirit.wis, 12);
  eq('CHA is 8', spirit.cha, 8);
  eq('cr is 0', spirit.cr, 0);
  eq('has 1 attack action at L5', spirit.actions.length, 1);
  eq('attack name is Bite', spirit.actions[0].name, 'Bite');
  eq('attack hitBonus is +5', spirit.actions[0].hitBonus, 5);
  eq('attack damage is 1d10+3', spirit.actions[0].damage?.count === 1 && spirit.actions[0].damage?.sides === 10 && spirit.actions[0].damage?.bonus === 3, true);
  eq('attack damageType is piercing', spirit.actions[0].damageType, 'piercing');
  eq('attack is melee', spirit.actions[0].attackType, 'melee');
  assert('Position is adjacent to caster', spirit.pos.x === 1 && spirit.pos.y === 0);
}

// ============================================================
// 3b. createDraconicSpirit — other dragon colors
// ============================================================

console.log('\n=== 3b. createDraconicSpirit — other dragon colors ===\n');

{
  const caster = makeCaster();
  const blueSpirit = createDraconicSpirit(caster, 5, 'blue');
  eq('Blue dragon: damageType still piercing (Bite)', blueSpirit.actions[0].damageType, 'piercing');
  assert('Blue dragon: description mentions lightning', blueSpirit.actions[0].description!.includes('lightning'));

  const greenSpirit = createDraconicSpirit(caster, 5, 'green');
  assert('Green dragon: description mentions poison', greenSpirit.actions[0].description!.includes('poison'));

  const silverSpirit = createDraconicSpirit(caster, 5, 'silver');
  assert('Silver dragon: description mentions cold', silverSpirit.actions[0].description!.includes('cold'));
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
    eq('Summon summonSpellName is Summon Draconic Spirit', summon.summonSpellName, 'Summon Draconic Spirit');
    eq('Summon faction matches caster', summon.faction, 'party');
    eq('Summon HP at L5 is 50', summon.maxHP, 50);
    eq('Summon AC at L5 is 19', summon.ac, 19);
  }

  eq('Caster concentrating on Summon Draconic Spirit', caster.concentration?.spellName, 'Summon Draconic Spirit');
  eq('Caster concentration is active', caster.concentration?.active, true);

  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![5]!.remaining, 1);
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
      const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
      if (summons.length === 1) {
        eq('combatantId matches summon id', bf.pendingInitiativeInserts[0].combatantId, summons[0].id);
      }
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

  const spirit5 = createDraconicSpirit(caster, 5);
  eq('L5: HP = 50', spirit5.maxHP, 50);
  eq('L5: AC = 19', spirit5.ac, 19);
  eq('L5: 1 attack (no multiattack)', spirit5.actions.length, 1);

  const spirit6 = createDraconicSpirit(caster, 6);
  eq('L6: HP = 60', spirit6.maxHP, 60);
  eq('L6: AC = 20', spirit6.ac, 20);
  eq('L6: 2 attacks (Multiattack)', spirit6.actions.length, 2);

  const spirit7 = createDraconicSpirit(caster, 7);
  eq('L7: HP = 70', spirit7.maxHP, 70);
  eq('L7: AC = 21', spirit7.ac, 21);

  const spirit8 = createDraconicSpirit(caster, 8);
  eq('L8: HP = 80', spirit8.maxHP, 80);
  eq('L8: AC = 22', spirit8.ac, 22);

  const spirit9 = createDraconicSpirit(caster, 9);
  eq('L9: HP = 90', spirit9.maxHP, 90);
  eq('L9: AC = 23', spirit9.ac, 23);
  eq('L9: 2 attacks (Multiattack)', spirit9.actions.length, 2);
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
    assert('Action event mentions "Summon Draconic Spirit"', actionEvents[0].description.includes('Summon Draconic Spirit'));
    assert('Action event mentions "Draconic Spirit"', actionEvents[0].description.includes('Draconic Spirit'));
    assert('Action event mentions HP', actionEvents[0].description.includes('HP'));
  }
}

// ============================================================
// 9. execute — upcast with higher slot
// ============================================================

console.log('\n=== 9. execute — upcast with higher slot ===\n');

{
  const caster = makeCaster();
  caster.resources = withSlotsUpTo(7, { 1: 4, 2: 3, 3: 2, 4: 1, 5: 0, 6: 1, 7: 1 });

  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  if (summons.length === 1) {
    eq('Upcast to L6: HP = 60', summons[0].maxHP, 60);
    eq('Upcast to L6: AC = 20', summons[0].ac, 20);
    eq('Upcast to L6: 2 attacks', summons[0].actions.length, 2);
  } else {
    assert('Summon created at L6', false, `expected 1 summon, got ${summons.length}`);
  }
}

// ============================================================
// 10. shouldCast — no enemy required
// ============================================================

console.log('\n=== 10. shouldCast — no enemy required ===\n');

{
  const caster = makeCaster();
  const bf = makeBF([caster]);
  assert('Returns true even with no enemies (summon does not need target)', shouldCast(caster, bf) === true);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
