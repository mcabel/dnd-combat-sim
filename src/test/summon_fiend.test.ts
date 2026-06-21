// ============================================================
// summon_fiend.test.ts — Summon Fiend spell module (TCE p.112)
// 6th-level conjuration, action, range 30 ft, concentration 1 hr.
// Effect: Spawns a Fiendish Spirit combatant that shares the caster's
//         initiative count and takes its turn immediately after.
//         HP/AC scale with slot level. Disappears on concentration
//         break or 0 HP.
//
// Tests cover: metadata, shouldCast gates, execute combatant creation,
// summon tags, battlefield addition, initiative insertion, concentration
// break despawn, HP/AC scaling, fiend options, and upcast.
// ============================================================

import { shouldCast, execute, metadata, createFiendishSpirit } from '../spells/summon_fiend';
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

function withSlots6(remaining = 2): PlayerResources {
  return { spellSlots: { 6: { max: 2, remaining } } };
}

function withSlotsUpTo(level: number, remaining: Record<number, number>): PlayerResources {
  const spellSlots: Record<number, { max: number; remaining: number }> = {};
  for (let l = 1; l <= level; l++) {
    spellSlots[l] = { max: remaining[l] ?? 0, remaining: remaining[l] ?? 0 };
  }
  return { spellSlots };
}

const SUMMON_FIEND_ACTION: Action = {
  name: 'Summon Fiend',
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
  slotLevel: 6,
  costType: 'action',
  legendaryCost: 0,
  description: 'Summon Fiend (concentration 1 hr)',
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

/** Caster with Summon Fiend action + 6th-level slots */
function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Warlock',
    pos,
    actions: [SUMMON_FIEND_ACTION],
    resources: withSlots6(2),
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

eq('name is Summon Fiend', metadata.name, 'Summon Fiend');
eq('level is 6', metadata.level, 6);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 30 ft', metadata.rangeFt, 30);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('summonFiendV1Implemented is true', metadata.summonFiendV1Implemented, true);
eq('summonFiendUpcastV1Implemented is true', metadata.summonFiendUpcastV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Summon Fiend action', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  caster.resources = withSlots6(0);
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when no 6th-level slots', shouldCast(caster, bf) === false);
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
    name: 'Fiendish Spirit (Warlock)',
    faction: 'party',
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Summon Fiend',
  });
  const bf = makeBF([caster, enemy, existingSummon]);
  assert('Returns false when caster already has a Summon Fiend active', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createFiendishSpirit — combatant creation (default: Devil)
// ============================================================

console.log('\n=== 3. createFiendishSpirit — combatant creation (default: Devil) ===\n');

{
  const caster = makeCaster();
  const spirit = createFiendishSpirit(caster, 6);

  eq('isSummon is true', spirit.isSummon, true);
  eq('summonerId matches caster', spirit.summonerId, 'caster1');
  eq('summonSpellName is Summon Fiend', spirit.summonSpellName, 'Summon Fiend');
  eq('faction matches caster', spirit.faction, 'party');
  eq('name includes Fiendish Spirit', spirit.name.includes('Fiendish Spirit'), true);
  eq('name includes caster name', spirit.name.includes('Warlock'), true);
  eq('HP at L6 is 60', spirit.maxHP, 60);
  eq('currentHP equals maxHP', spirit.currentHP, spirit.maxHP);
  eq('AC at L6 is 19 (13+6)', spirit.ac, 19);
  eq('aiProfile is attackNearest', spirit.aiProfile, 'attackNearest');
  eq('speed is 30', spirit.speed, 30);
  eq('flySpeed is null', spirit.flySpeed, null);
  eq('STR is 14', spirit.str, 14);
  eq('DEX is 14', spirit.dex, 14);
  eq('CON is 14', spirit.con, 14);
  eq('INT is 6', spirit.int, 6);
  eq('WIS is 10', spirit.wis, 10);
  eq('CHA is 8', spirit.cha, 8);
  eq('cr is 0', spirit.cr, 0);
  eq('has 1 attack action at L6', spirit.actions.length, 1);
  eq('attack name is Fiendish Blade (Devil)', spirit.actions[0].name, 'Fiendish Blade');
  eq('attack hitBonus is +5', spirit.actions[0].hitBonus, 5);
  eq('attack damage is 1d8+2', spirit.actions[0].damage?.count === 1 && spirit.actions[0].damage?.sides === 8 && spirit.actions[0].damage?.bonus === 2, true);
  eq('attack damageType is slashing (Devil)', spirit.actions[0].damageType, 'slashing');
  eq('attack is melee', spirit.actions[0].attackType, 'melee');
  assert('Position is adjacent to caster', spirit.pos.x === 1 && spirit.pos.y === 0);
}

// ============================================================
// 3b. createFiendishSpirit — Demon option
// ============================================================

console.log('\n=== 3b. createFiendishSpirit — Demon option ===\n');

{
  const caster = makeCaster();
  const spirit = createFiendishSpirit(caster, 6, 'demon');

  eq('Demon: attack name is Bite', spirit.actions[0].name, 'Bite');
  eq('Demon: damageType is piercing', spirit.actions[0].damageType, 'piercing');
  assert('Demon: description mentions poison', spirit.actions[0].description!.includes('poison'));
}

// ============================================================
// 3c. createFiendishSpirit — Yugoloth option
// ============================================================

console.log('\n=== 3c. createFiendishSpirit — Yugoloth option ===\n');

{
  const caster = makeCaster();
  const spirit = createFiendishSpirit(caster, 6, 'yugoloth');

  eq('Yugoloth: attack name is Claws', spirit.actions[0].name, 'Claws');
  eq('Yugoloth: damageType is slashing', spirit.actions[0].damageType, 'slashing');
  assert('Yugoloth: description mentions necrotic', spirit.actions[0].description!.includes('necrotic'));
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
    eq('Summon summonSpellName is Summon Fiend', summon.summonSpellName, 'Summon Fiend');
    eq('Summon faction matches caster', summon.faction, 'party');
    eq('Summon HP at L6 is 60', summon.maxHP, 60);
    eq('Summon AC at L6 is 19', summon.ac, 19);
  }

  eq('Caster concentrating on Summon Fiend', caster.concentration?.spellName, 'Summon Fiend');
  eq('Caster concentration is active', caster.concentration?.active, true);

  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![6]!.remaining, 1);
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

  const spirit6 = createFiendishSpirit(caster, 6);
  eq('L6: HP = 60', spirit6.maxHP, 60);
  eq('L6: AC = 19', spirit6.ac, 19);
  eq('L6: 1 attack (no multiattack)', spirit6.actions.length, 1);

  const spirit7 = createFiendishSpirit(caster, 7);
  eq('L7: HP = 70', spirit7.maxHP, 70);
  eq('L7: AC = 20', spirit7.ac, 20);
  eq('L7: 2 attacks (Multiattack)', spirit7.actions.length, 2);

  const spirit8 = createFiendishSpirit(caster, 8);
  eq('L8: HP = 80', spirit8.maxHP, 80);
  eq('L8: AC = 21', spirit8.ac, 21);
  eq('L8: 2 attacks', spirit8.actions.length, 2);

  const spirit9 = createFiendishSpirit(caster, 9);
  eq('L9: HP = 90', spirit9.maxHP, 90);
  eq('L9: AC = 22', spirit9.ac, 22);
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
    assert('Action event mentions "Summon Fiend"', actionEvents[0].description.includes('Summon Fiend'));
    assert('Action event mentions "Fiendish Spirit"', actionEvents[0].description.includes('Fiendish Spirit'));
    assert('Action event mentions HP', actionEvents[0].description.includes('HP'));
  }
}

// ============================================================
// 9. execute — upcast with higher slot
// ============================================================

console.log('\n=== 9. execute — upcast with higher slot ===\n');

{
  const caster = makeCaster();
  caster.resources = withSlotsUpTo(8, { 1: 4, 2: 3, 3: 2, 4: 1, 5: 1, 6: 0, 7: 1, 8: 1 });

  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  if (summons.length === 1) {
    // consumeSpellSlot uses lowest available slot first; L7 is available
    eq('Upcast to L7: HP = 70', summons[0].maxHP, 70);
    eq('Upcast to L7: AC = 20', summons[0].ac, 20);
    eq('Upcast to L7: 2 attacks', summons[0].actions.length, 2);
  } else {
    assert('Summon created at L7', false, `expected 1 summon, got ${summons.length}`);
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
