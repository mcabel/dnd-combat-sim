// ============================================================
// summon_beast.test.ts — Summon Beast spell module (TCE p.111)
// 2nd-level conjuration, action, range 30 ft, concentration 1 hr.
// Effect: Spawns a Bestial Spirit combatant that shares the caster's
//         initiative count and takes its turn immediately after.
//         HP/AC scale with slot level. Disappears on concentration
//         break or 0 HP.
//
// Tests cover: metadata, shouldCast gates, execute combatant creation,
// summon tags, battlefield addition, initiative insertion, concentration
// break despawn, and HP/AC scaling.
// ============================================================

import { shouldCast, execute, metadata, createBestialSpirit } from '../spells/summon_beast';
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

function withSlots2(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

function withSlotsUpTo(level: number, remaining: Record<number, number>): PlayerResources {
  const spellSlots: Record<number, { max: number; remaining: number }> = {};
  for (let l = 1; l <= level; l++) {
    spellSlots[l] = { max: remaining[l] ?? 0, remaining: remaining[l] ?? 0 };
  }
  return { spellSlots };
}

const SUMMON_BEAST_ACTION: Action = {
  name: 'Summon Beast',
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
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Summon Beast (concentration 1 hr)',
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

/** Caster with Summon Beast action + 2nd-level slots */
function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Druid',
    pos,
    actions: [SUMMON_BEAST_ACTION],
    resources: withSlots2(2),
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

eq('name is Summon Beast', metadata.name, 'Summon Beast');
eq('level is 2', metadata.level, 2);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 30 ft', metadata.rangeFt, 30);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('summonBeastV1Implemented is true', metadata.summonBeastV1Implemented, true);
eq('summonBeastUpcastV1Implemented is true', metadata.summonBeastUpcastV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Summon Beast' action
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Summon Beast action', shouldCast(caster, bf) === false);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeCaster();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when no 2nd-level slots', shouldCast(caster, bf) === false);
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
  // 2d. Caster already has a Summon Beast active
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingSummon = makeCombatant('existing_summon', {
    name: 'Bestial Spirit (Druid)',
    faction: 'party',
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Summon Beast',
  });
  const bf = makeBF([caster, enemy, existingSummon]);
  assert('Returns false when caster already has a Summon Beast active', shouldCast(caster, bf) === false);
}

{
  // 2e. All conditions met
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createBestialSpirit — combatant creation
// ============================================================

console.log('\n=== 3. createBestialSpirit — combatant creation ===\n');

{
  const caster = makeCaster();
  const spirit = createBestialSpirit(caster, 2);

  eq('isSummon is true', spirit.isSummon, true);
  eq('summonerId matches caster', spirit.summonerId, 'caster1');
  eq('summonSpellName is Summon Beast', spirit.summonSpellName, 'Summon Beast');
  eq('faction matches caster', spirit.faction, 'party');
  eq('name includes Bestial Spirit', spirit.name.includes('Bestial Spirit'), true);
  eq('name includes caster name', spirit.name.includes('Druid'), true);
  eq('HP at L2 is 20', spirit.maxHP, 20);
  eq('currentHP equals maxHP', spirit.currentHP, spirit.maxHP);
  eq('AC at L2 is 13 (11+2)', spirit.ac, 13);
  eq('aiProfile is attackNearest', spirit.aiProfile, 'attackNearest');
  eq('speed is 30', spirit.speed, 30);
  eq('STR is 14', spirit.str, 14);
  eq('DEX is 12', spirit.dex, 12);
  eq('CON is 13', spirit.con, 13);
  eq('INT is 4', spirit.int, 4);
  eq('WIS is 10', spirit.wis, 10);
  eq('CHA is 6', spirit.cha, 6);
  eq('cr is 0', spirit.cr, 0);
  eq('has 1 attack action at L2', spirit.actions.length, 1);
  eq('attack name is Maul', spirit.actions[0].name, 'Maul');
  eq('attack hitBonus is +5', spirit.actions[0].hitBonus, 5);
  eq('attack damage is 1d6+2', spirit.actions[0].damage?.count === 1 && spirit.actions[0].damage?.sides === 6 && spirit.actions[0].damage?.bonus === 2, true);
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

  // Find the summon in the battlefield
  const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  eq('1 summon added to battlefield', summons.length, 1);

  if (summons.length === 1) {
    const summon = summons[0];
    eq('Summon isSummon is true', summon.isSummon, true);
    eq('Summon summonerId is caster', summon.summonerId, 'caster1');
    eq('Summon summonSpellName is Summon Beast', summon.summonSpellName, 'Summon Beast');
    eq('Summon faction matches caster', summon.faction, 'party');
    eq('Summon HP at L2 is 20', summon.maxHP, 20);
    eq('Summon AC at L2 is 13', summon.ac, 13);
  }

  // Caster is concentrating on Summon Beast
  eq('Caster concentrating on Summon Beast', caster.concentration?.spellName, 'Summon Beast');
  eq('Caster concentration is active', caster.concentration?.active, true);

  // Slot consumed
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
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
      // The combatantId should match the summon
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

  // Verify caster concentration is still set (removeEffectsFromCaster doesn't clear it)
  // The combat engine handles that separately
}

// ============================================================
// 7. HP/AC scale with slot level
// ============================================================

console.log('\n=== 7. HP/AC scale with slot level ===\n');

{
  const caster = makeCaster();

  const spirit2 = createBestialSpirit(caster, 2);
  eq('L2: HP = 20', spirit2.maxHP, 20);
  eq('L2: AC = 13', spirit2.ac, 13);

  const spirit3 = createBestialSpirit(caster, 3);
  eq('L3: HP = 25', spirit3.maxHP, 25);
  eq('L3: AC = 14', spirit3.ac, 14);

  const spirit4 = createBestialSpirit(caster, 4);
  eq('L4: HP = 30', spirit4.maxHP, 30);
  eq('L4: AC = 15', spirit4.ac, 15);

  const spirit5 = createBestialSpirit(caster, 5);
  eq('L5: HP = 35', spirit5.maxHP, 35);
  eq('L5: AC = 16', spirit5.ac, 16);
  eq('L5: 2 attack actions (Multiattack)', spirit5.actions.length, 2);

  const spirit6 = createBestialSpirit(caster, 6);
  eq('L6: HP = 40', spirit6.maxHP, 40);
  eq('L6: AC = 17', spirit6.ac, 17);

  const spirit7 = createBestialSpirit(caster, 7);
  eq('L7: HP = 45', spirit7.maxHP, 45);
  eq('L7: AC = 18', spirit7.ac, 18);

  const spirit8 = createBestialSpirit(caster, 8);
  eq('L8: HP = 50', spirit8.maxHP, 50);
  eq('L8: AC = 19', spirit8.ac, 19);

  const spirit9 = createBestialSpirit(caster, 9);
  eq('L9: HP = 55', spirit9.maxHP, 55);
  eq('L9: AC = 20', spirit9.ac, 20);
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
    assert('Action event mentions "Summon Beast"', actionEvents[0].description.includes('Summon Beast'));
    assert('Action event mentions "Bestial Spirit"', actionEvents[0].description.includes('Bestial Spirit'));
    assert('Action event mentions HP', actionEvents[0].description.includes('HP'));
  }
}

// ============================================================
// 9. execute — upcast with higher slot
// ============================================================

console.log('\n=== 9. execute — upcast with higher slot ===\n');

{
  // Create caster with L3 slots
  const caster = makeCaster();
  caster.resources = withSlotsUpTo(5, { 1: 4, 2: 0, 3: 2, 4: 0, 5: 1 });

  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  if (summons.length === 1) {
    // consumeSpellSlot uses lowest available slot first; L3 is available
    eq('Upcast to L3: HP = 25', summons[0].maxHP, 25);
    eq('Upcast to L3: AC = 14', summons[0].ac, 14);
  } else {
    assert('Summon created at L3', false, `expected 1 summon, got ${summons.length}`);
  }
}

// ============================================================
// 10. shouldCast returns false when no enemy present (but still true — summon doesn't need a target)
// ============================================================

console.log('\n=== 10. shouldCast — no enemy required ===\n');

{
  const caster = makeCaster();
  const bf = makeBF([caster]);
  // Summon Beast doesn't need an enemy target — it just needs a slot and no concentration
  assert('Returns true even with no enemies (summon does not need target)', shouldCast(caster, bf) === true);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
