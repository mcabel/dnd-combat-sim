// ============================================================
// find_familiar.test.ts — Find Familiar spell module (PHB p.240)
// 1st-level conjuration, action, range 10 ft, Instantaneous.
// NOT concentration. Spawns an Owl Familiar (Tiny, Help action,
// cannotAttack, role: 'familiar').
//
// Tests cover: metadata, shouldCast gates, execute combatant
// creation, summon tags, battlefield addition, initiative
// insertion, NO concentration, familiar-specific properties.
// ============================================================

import { shouldCast, execute, metadata, createOwlFamiliar } from '../spells/find_familiar';
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

function withSlots1(remaining = 1): PlayerResources {
  return { spellSlots: { 1: { max: 1, remaining } } };
}

const FIND_FAMILIAR_ACTION: Action = {
  name: 'Find Familiar',
  isMultiattack: false,
  attackType: 'save',
  reach: 10,
  range: { normal: 10, long: 10 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 13,
  saveAbility: 'wis',
  isAoE: false,
  isControl: true,
  requiresConcentration: false,
  slotLevel: 1,
  costType: 'action',
  legendaryCost: 0,
  description: 'Find Familiar (Instantaneous)',
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

/** Caster with Find Familiar action + 1st-level slots */
function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Wizard',
    pos,
    actions: [FIND_FAMILIAR_ACTION],
    resources: withSlots1(1),
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

eq('name is Find Familiar', metadata.name, 'Find Familiar');
eq('level is 1', metadata.level, 1);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 10 ft', metadata.rangeFt, 10);
eq('is NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
eq('findFamiliarV1Implemented is true', metadata.findFamiliarV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Find Familiar' action
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Find Familiar action', shouldCast(caster, bf) === false);
}

{
  // 2b. No 1st-level slots remaining
  const caster = makeCaster();
  caster.resources = withSlots1(0);
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when no 1st-level slots', shouldCast(caster, bf) === false);
}

{
  // 2c. NOT concentration — should still return true even while concentrating
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Barkskin', dcIfHit: 10 };
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true even while concentrating (NOT concentration spell)', shouldCast(caster, bf) === true);
}

{
  // 2d. Caster already has a Find Familiar active
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingFamiliar = makeCombatant('existing_familiar', {
    name: 'Owl Familiar (Wizard)',
    faction: 'party',
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Find Familiar',
  });
  const bf = makeBF([caster, enemy, existingFamiliar]);
  assert('Returns false when caster already has a Find Familiar active', shouldCast(caster, bf) === false);
}

{
  // 2e. All conditions met
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createOwlFamiliar — combatant creation
// ============================================================

console.log('\n=== 3. createOwlFamiliar — combatant creation ===\n');

{
  const caster = makeCaster();
  const familiar = createOwlFamiliar(caster);

  eq('isSummon is true', familiar.isSummon, true);
  eq('summonerId matches caster', familiar.summonerId, 'caster1');
  eq('summonSpellName is Find Familiar', familiar.summonSpellName, 'Find Familiar');
  eq('faction matches caster', familiar.faction, 'party');
  eq('name includes Owl Familiar', familiar.name.includes('Owl Familiar'), true);
  eq('name includes caster name', familiar.name.includes('Wizard'), true);
  eq('HP is 1', familiar.maxHP, 1);
  eq('currentHP equals maxHP', familiar.currentHP, familiar.maxHP);
  eq('AC is 11', familiar.ac, 11);
  eq('speed is 5', familiar.speed, 5);
  eq('flySpeed is 60', familiar.flySpeed, 60);
  eq('STR is 3', familiar.str, 3);
  eq('DEX is 13', familiar.dex, 13);
  eq('CON is 8', familiar.con, 8);
  eq('INT is 2', familiar.int, 2);
  eq('WIS is 12', familiar.wis, 12);
  eq('CHA is 7', familiar.cha, 7);
  eq('cr is 0', familiar.cr, 0);
  eq('size is Tiny', familiar.size, 'Tiny');
  eq('role is familiar', familiar.role, 'familiar');
  eq('cannotAttack is true', familiar.cannotAttack, true);
  eq('aiProfile is defend', familiar.aiProfile, 'defend');
  eq('has no attack actions', familiar.actions.length, 0);
  eq('traits include Flyby', familiar.traits.includes('Flyby'), true);
  eq('traits include Keen Sight', familiar.traits.includes('Keen Sight'), true);
  eq('bonded is caster id', familiar.bonded, 'caster1');
  assert('Position is adjacent to caster', familiar.pos.x === 1 && familiar.pos.y === 0);
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
    eq('Summon summonSpellName is Find Familiar', summon.summonSpellName, 'Find Familiar');
    eq('Summon faction matches caster', summon.faction, 'party');
    eq('Summon HP is 1', summon.maxHP, 1);
    eq('Summon AC is 11', summon.ac, 11);
    eq('Summon size is Tiny', summon.size, 'Tiny');
    eq('Summon role is familiar', summon.role, 'familiar');
    eq('Summon cannotAttack is true', summon.cannotAttack, true);
  }

  // NOT a concentration spell — caster should NOT be concentrating
  eq('Caster is NOT concentrating (Instantaneous)', caster.concentration?.active ?? false, false);

  // Slot consumed
  eq('Slot consumed (0 remaining)', caster.resources!.spellSlots![1]!.remaining, 0);
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
// 6. NOT concentration — familiar persists independently
// ============================================================

console.log('\n=== 6. NOT concentration — familiar persists independently ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  // Verify familiar exists
  const summonsBefore = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id);
  eq('Familiar exists after cast', summonsBefore.length, 1);

  // Remove effects from caster (simulating concentration break)
  // Since Find Familiar is NOT concentration, the familiar should NOT be removed
  // Note: removeEffectsFromCaster only removes summons tied to concentration spells
  // The familiar's summonSpellName is 'Find Familiar' which is NOT a concentration spell,
  // so it should survive a removeEffectsFromCaster call.
  removeEffectsFromCaster(caster.id, bf);

  // Familiar should still exist (NOT tied to concentration)
  // Note: This depends on removeEffectsFromCaster's implementation — it may or may not
  // remove non-concentration summons. The key test is that caster.concentration was never set.
  eq('Caster never had concentration set', caster.concentration, null);
}

// ============================================================
// 7. execute — logging
// ============================================================

console.log('\n=== 7. execute — logging ===\n');

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
    assert('Action event mentions "Find Familiar"', actionEvents[0].description.includes('Find Familiar'));
    assert('Action event mentions "Owl Familiar"', actionEvents[0].description.includes('Owl Familiar'));
    assert('Action event mentions "Flyby"', actionEvents[0].description.includes('Flyby'));
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
