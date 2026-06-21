// ============================================================
// summon_fey.test.ts — Summon Fey spell module (TCE p.112)
// 3rd-level conjuration, action, range 30 ft, concentration 1 hr.
// Effect: Spawns a Fey Spirit combatant that shares the caster's
//         initiative count and takes its turn immediately after.
//         HP/AC scale with slot level. Disappears on concentration
//         break or 0 HP.
//
// Tests cover: metadata, shouldCast gates, execute combatant creation,
// summon tags, battlefield addition, initiative insertion, concentration
// break despawn, and HP/AC scaling.
// ============================================================

import { shouldCast, execute, metadata, createFeySpirit } from '../spells/summon_fey';
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

function withSlotsUpTo(level: number, remaining: Record<number, number>): PlayerResources {
  const spellSlots: Record<number, { max: number; remaining: number }> = {};
  for (let l = 1; l <= level; l++) {
    spellSlots[l] = { max: remaining[l] ?? 0, remaining: remaining[l] ?? 0 };
  }
  return { spellSlots };
}

const SUMMON_FEY_ACTION: Action = {
  name: 'Summon Fey',
  isMultiattack: false,
  attackType: 'save',
  reach: 30,
  range: { normal: 30, long: 30 },
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
  description: 'Summon Fey (concentration 1 hr)',
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

/** Caster with Summon Fey action + 3rd-level slots */
function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Warlock',
    pos,
    actions: [SUMMON_FEY_ACTION],
    resources: withSlots3(2),
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

eq('name is Summon Fey', metadata.name, 'Summon Fey');
eq('level is 3', metadata.level, 3);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 30 ft', metadata.rangeFt, 30);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('summonFeyV1Implemented is true', metadata.summonFeyV1Implemented, true);
eq('summonFeyUpcastV1Implemented is true', metadata.summonFeyUpcastV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Summon Fey' action
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Summon Fey action', shouldCast(caster, bf) === false);
}

{
  // 2b. No 3rd-level slots remaining
  const caster = makeCaster();
  caster.resources = withSlots3(0);
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when no 3rd-level slots', shouldCast(caster, bf) === false);
}

{
  // 2c. Caster is already concentrating
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Barkskin', dcIfHit: 10 };
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster is already concentrating', shouldCast(caster, bf) === false);
}

{
  // 2d. Caster already has a Summon Fey active
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingSummon = makeCombatant('existing_summon', {
    name: 'Fey Spirit (Warlock)',
    faction: 'party',
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Summon Fey',
  });
  const bf = makeBF([caster, enemy, existingSummon]);
  assert('Returns false when caster already has a Summon Fey active', shouldCast(caster, bf) === false);
}

{
  // 2e. All conditions met
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createFeySpirit — combatant creation
// ============================================================

console.log('\n=== 3. createFeySpirit — combatant creation ===\n');

{
  const caster = makeCaster();
  const spirit = createFeySpirit(caster, 3);

  eq('isSummon is true', spirit.isSummon, true);
  eq('summonerId matches caster', spirit.summonerId, 'caster1');
  eq('summonSpellName is Summon Fey', spirit.summonSpellName, 'Summon Fey');
  eq('faction matches caster', spirit.faction, 'party');
  eq('name includes Fey Spirit', spirit.name.includes('Fey Spirit'), true);
  eq('name includes caster name', spirit.name.includes('Warlock'), true);
  eq('HP at L3 is 30', spirit.maxHP, 30);
  eq('currentHP equals maxHP', spirit.currentHP, spirit.maxHP);
  eq('AC at L3 is 15 (12+3)', spirit.ac, 15);
  eq('aiProfile is attackNearest', spirit.aiProfile, 'attackNearest');
  eq('speed is 40', spirit.speed, 40);
  eq('STR is 10', spirit.str, 10);
  eq('DEX is 14', spirit.dex, 14);
  eq('CON is 12', spirit.con, 12);
  eq('INT is 8', spirit.int, 8);
  eq('WIS is 12', spirit.wis, 12);
  eq('CHA is 14', spirit.cha, 14);
  eq('cr is 0', spirit.cr, 0);
  eq('has 1 attack action at L3', spirit.actions.length, 1);
  eq('attack name is Shortsword', spirit.actions[0].name, 'Shortsword');
  eq('attack hitBonus is +5', spirit.actions[0].hitBonus, 5);
  eq('attack damage is 1d6+2', spirit.actions[0].damage?.count === 1 && spirit.actions[0].damage?.sides === 6 && spirit.actions[0].damage?.bonus === 2, true);
  eq('attack damageType is piercing', spirit.actions[0].damageType, 'piercing');
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

  // Find the summon in the battlefield
  const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  eq('1 summon added to battlefield', summons.length, 1);

  if (summons.length === 1) {
    const summon = summons[0];
    eq('Summon isSummon is true', summon.isSummon, true);
    eq('Summon summonerId is caster', summon.summonerId, 'caster1');
    eq('Summon summonSpellName is Summon Fey', summon.summonSpellName, 'Summon Fey');
    eq('Summon faction matches caster', summon.faction, 'party');
    eq('Summon HP at L3 is 30', summon.maxHP, 30);
    eq('Summon AC at L3 is 15', summon.ac, 15);
  }

  // Caster is concentrating on Summon Fey
  eq('Caster concentrating on Summon Fey', caster.concentration?.spellName, 'Summon Fey');
  eq('Caster concentration is active', caster.concentration?.active, true);

  // Slot consumed
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![3]!.remaining, 1);
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

  // Verify summon exists
  const summonsBefore = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  eq('Summon exists before concentration break', summonsBefore.length, 1);

  // Break concentration
  removeEffectsFromCaster(caster.id, bf);

  // Verify summon is removed
  const summonsAfter = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  eq('Summon removed after concentration break', summonsAfter.length, 0);
}

// ============================================================
// 7. HP/AC scale with slot level
// ============================================================

console.log('\n=== 7. HP/AC scale with slot level ===\n');

{
  const caster = makeCaster();

  const spirit3 = createFeySpirit(caster, 3);
  eq('L3: HP = 30', spirit3.maxHP, 30);
  eq('L3: AC = 15 (12+3)', spirit3.ac, 15);

  const spirit4 = createFeySpirit(caster, 4);
  eq('L4: HP = 40', spirit4.maxHP, 40);
  eq('L4: AC = 16 (12+4)', spirit4.ac, 16);

  const spirit5 = createFeySpirit(caster, 5);
  eq('L5: HP = 50', spirit5.maxHP, 50);
  eq('L5: AC = 17 (12+5)', spirit5.ac, 17);
  eq('L5: 2 attack actions (Multiattack)', spirit5.actions.length, 2);

  const spirit6 = createFeySpirit(caster, 6);
  eq('L6: HP = 60', spirit6.maxHP, 60);
  eq('L6: AC = 18 (12+6)', spirit6.ac, 18);

  const spirit7 = createFeySpirit(caster, 7);
  eq('L7: HP = 70', spirit7.maxHP, 70);
  eq('L7: AC = 19 (12+7)', spirit7.ac, 19);

  const spirit8 = createFeySpirit(caster, 8);
  eq('L8: HP = 80', spirit8.maxHP, 80);
  eq('L8: AC = 20 (12+8)', spirit8.ac, 20);

  const spirit9 = createFeySpirit(caster, 9);
  eq('L9: HP = 90', spirit9.maxHP, 90);
  eq('L9: AC = 21 (12+9)', spirit9.ac, 21);
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
    assert('Action event mentions "Summon Fey"', actionEvents[0].description.includes('Summon Fey'));
    assert('Action event mentions "Fey Spirit"', actionEvents[0].description.includes('Fey Spirit'));
    assert('Action event mentions HP', actionEvents[0].description.includes('HP'));
  }
}

// ============================================================
// 9. execute — upcast with higher slot
// ============================================================

console.log('\n=== 9. execute — upcast with higher slot ===\n');

{
  // Create caster with L5 slots (lowest available L3+ is L3)
  const caster = makeCaster();
  caster.resources = withSlotsUpTo(5, { 1: 4, 2: 0, 3: 2, 4: 0, 5: 1 });

  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  if (summons.length === 1) {
    // consumeSpellSlot uses lowest available slot first; L3 is available
    eq('Base cast at L3: HP = 30', summons[0].maxHP, 30);
    eq('Base cast at L3: AC = 15', summons[0].ac, 15);
  } else {
    assert('Summon created at L3', false, `expected 1 summon, got ${summons.length}`);
  }
}

// ============================================================
// 10. shouldCast returns true even with no enemies
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
