// ============================================================
// summon_celestial.test.ts — Summon Celestial spell module (TCE p.111)
// 5th-level conjuration, action, range 30 ft, concentration 1 hr.
// Effect: Spawns a Celestial Spirit combatant that shares the caster's
//         initiative count and takes its turn immediately after.
//         HP/AC scale with slot level. Disappears on concentration
//         break or 0 HP.
//
// Tests cover: metadata, shouldCast gates, execute combatant creation,
// summon tags, battlefield addition, initiative insertion, concentration
// break despawn, HP/AC scaling, and upcast.
// ============================================================

import { shouldCast, execute, metadata, createCelestialSpirit } from '../spells/summon_celestial';
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

const SUMMON_CELESTIAL_ACTION: Action = {
  name: 'Summon Celestial',
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
  description: 'Summon Celestial (concentration 1 hr)',
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

/** Caster with Summon Celestial action + 5th-level slots */
function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Cleric',
    pos,
    actions: [SUMMON_CELESTIAL_ACTION],
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

eq('name is Summon Celestial', metadata.name, 'Summon Celestial');
eq('level is 5', metadata.level, 5);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 30 ft', metadata.rangeFt, 30);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('summonCelestialV1Implemented is true', metadata.summonCelestialV1Implemented, true);
eq('summonCelestialUpcastV1Implemented is true', metadata.summonCelestialUpcastV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Summon Celestial action', shouldCast(caster, bf) === false);
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
    name: 'Celestial Spirit (Cleric)',
    faction: 'party',
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Summon Celestial',
  });
  const bf = makeBF([caster, enemy, existingSummon]);
  assert('Returns false when caster already has a Summon Celestial active', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createCelestialSpirit — combatant creation
// ============================================================

console.log('\n=== 3. createCelestialSpirit — combatant creation ===\n');

{
  const caster = makeCaster();
  const spirit = createCelestialSpirit(caster, 5);

  eq('isSummon is true', spirit.isSummon, true);
  eq('summonerId matches caster', spirit.summonerId, 'caster1');
  eq('summonSpellName is Summon Celestial', spirit.summonSpellName, 'Summon Celestial');
  eq('faction matches caster', spirit.faction, 'party');
  eq('name includes Celestial Spirit', spirit.name.includes('Celestial Spirit'), true);
  eq('name includes caster name', spirit.name.includes('Cleric'), true);
  eq('HP at L5 is 50', spirit.maxHP, 50);
  eq('currentHP equals maxHP', spirit.currentHP, spirit.maxHP);
  eq('AC at L5 is 18 (13+5)', spirit.ac, 18);
  eq('aiProfile is attackNearest', spirit.aiProfile, 'attackNearest');
  eq('speed is 30', spirit.speed, 30);
  eq('flySpeed is 40', spirit.flySpeed, 40);
  eq('STR is 16', spirit.str, 16);
  eq('DEX is 14', spirit.dex, 14);
  eq('CON is 14', spirit.con, 14);
  eq('INT is 8', spirit.int, 8);
  eq('WIS is 14', spirit.wis, 14);
  eq('CHA is 12', spirit.cha, 12);
  eq('cr is 0', spirit.cr, 0);
  eq('has 1 attack action at L5', spirit.actions.length, 1);
  eq('attack name is Radiant Greatsword (Defender)', spirit.actions[0].name, 'Radiant Greatsword');
  eq('attack hitBonus is +5', spirit.actions[0].hitBonus, 5);
  eq('attack damage is 3d8+3', spirit.actions[0].damage?.count === 3 && spirit.actions[0].damage?.sides === 8 && spirit.actions[0].damage?.bonus === 3, true);
  eq('attack damageType is radiant', spirit.actions[0].damageType, 'radiant');
  eq('attack is melee', spirit.actions[0].attackType, 'melee');
  assert('Position is adjacent to caster', spirit.pos.x === 1 && spirit.pos.y === 0);
}

// ============================================================
// 3b. createCelestialSpirit — Avenger option
// ============================================================

console.log('\n=== 3b. createCelestialSpirit — Avenger option ===\n');

{
  const caster = makeCaster();
  const spirit = createCelestialSpirit(caster, 5, 'avenger');

  eq('attack name is Radiant Bow (Avenger)', spirit.actions[0].name, 'Radiant Bow');
  eq('attack is ranged', spirit.actions[0].attackType, 'ranged');
  eq('attack range is 150', spirit.actions[0].range?.normal, 150);
  eq('attack damage is 2d6+3', spirit.actions[0].damage?.count === 2 && spirit.actions[0].damage?.sides === 6 && spirit.actions[0].damage?.bonus === 3, true);
  eq('attack damageType is radiant', spirit.actions[0].damageType, 'radiant');
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
    eq('Summon summonSpellName is Summon Celestial', summon.summonSpellName, 'Summon Celestial');
    eq('Summon faction matches caster', summon.faction, 'party');
    eq('Summon HP at L5 is 50', summon.maxHP, 50);
    eq('Summon AC at L5 is 18', summon.ac, 18);
  }

  eq('Caster concentrating on Summon Celestial', caster.concentration?.spellName, 'Summon Celestial');
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

  const spirit5 = createCelestialSpirit(caster, 5);
  eq('L5: HP = 50', spirit5.maxHP, 50);
  eq('L5: AC = 18', spirit5.ac, 18);
  eq('L5: 1 attack (no multiattack)', spirit5.actions.length, 1);

  const spirit6 = createCelestialSpirit(caster, 6);
  eq('L6: HP = 60', spirit6.maxHP, 60);
  eq('L6: AC = 19', spirit6.ac, 19);
  eq('L6: 2 attacks (Multiattack)', spirit6.actions.length, 2);

  const spirit7 = createCelestialSpirit(caster, 7);
  eq('L7: HP = 70', spirit7.maxHP, 70);
  eq('L7: AC = 20', spirit7.ac, 20);

  const spirit8 = createCelestialSpirit(caster, 8);
  eq('L8: HP = 80', spirit8.maxHP, 80);
  eq('L8: AC = 21', spirit8.ac, 21);

  const spirit9 = createCelestialSpirit(caster, 9);
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
    assert('Action event mentions "Summon Celestial"', actionEvents[0].description.includes('Summon Celestial'));
    assert('Action event mentions "Celestial Spirit"', actionEvents[0].description.includes('Celestial Spirit'));
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
    // consumeSpellSlot uses lowest available slot first; L6 is available
    eq('Upcast to L6: HP = 60', summons[0].maxHP, 60);
    eq('Upcast to L6: AC = 19', summons[0].ac, 19);
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
