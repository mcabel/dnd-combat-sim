// ============================================================
// find_greater_steed.test.ts — Find Greater Steed spell module (XGE p.156)
// 4th-level conjuration, action, range 30 ft, Instantaneous.
// NOT concentration. Spawns a Griffon mount (Large, combat_mount).
// After spawning, auto-mounts the caster on the steed.
//
// Tests cover: metadata, shouldCast gates, execute combatant
// creation, mount link, summon tags, battlefield addition,
// initiative insertion, NO concentration, Griffon multiattack.
// ============================================================

import { shouldCast, execute, metadata, createGriffon } from '../spells/find_greater_steed';
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

function withSlots4(remaining = 1): PlayerResources {
  return { spellSlots: { 4: { max: 1, remaining } } };
}

const FIND_GREATER_STEED_ACTION: Action = {
  name: 'Find Greater Steed',
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
  requiresConcentration: false,
  slotLevel: 4,
  costType: 'action',
  legendaryCost: 0,
  description: 'Find Greater Steed (Instantaneous)',
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

/** Caster with Find Greater Steed action + 4th-level slots */
function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Paladin',
    pos,
    actions: [FIND_GREATER_STEED_ACTION],
    resources: withSlots4(1),
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

eq('name is Find Greater Steed', metadata.name, 'Find Greater Steed');
eq('level is 4', metadata.level, 4);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 30 ft', metadata.rangeFt, 30);
eq('is NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
eq('findGreaterSteedV1Implemented is true', metadata.findGreaterSteedV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Find Greater Steed' action
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Find Greater Steed action', shouldCast(caster, bf) === false);
}

{
  // 2b. No 4th-level slots remaining
  const caster = makeCaster();
  caster.resources = withSlots4(0);
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when no 4th-level slots', shouldCast(caster, bf) === false);
}

{
  // 2c. NOT concentration — should still return true even while concentrating
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true even while concentrating (NOT concentration spell)', shouldCast(caster, bf) === true);
}

{
  // 2d. Caster already has a Find Greater Steed active
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingSteed = makeCombatant('existing_steed', {
    name: 'Griffon (Paladin)',
    faction: 'party',
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Find Greater Steed',
  });
  const bf = makeBF([caster, enemy, existingSteed]);
  assert('Returns false when caster already has a Find Greater Steed active', shouldCast(caster, bf) === false);
}

{
  // 2e. Caster is already mounted
  const caster = makeCaster();
  caster.mountedOn = 'some_other_mount';
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster is already mounted', shouldCast(caster, bf) === false);
}

{
  // 2f. All conditions met
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createGriffon — combatant creation
// ============================================================

console.log('\n=== 3. createGriffon — combatant creation ===\n');

{
  const caster = makeCaster();
  const steed = createGriffon(caster);

  eq('isSummon is true', steed.isSummon, true);
  eq('summonerId matches caster', steed.summonerId, 'caster1');
  eq('summonSpellName is Find Greater Steed', steed.summonSpellName, 'Find Greater Steed');
  eq('faction matches caster', steed.faction, 'party');
  eq('name includes Griffon', steed.name.includes('Griffon'), true);
  eq('name includes caster name', steed.name.includes('Paladin'), true);
  eq('HP is 59', steed.maxHP, 59);
  eq('currentHP equals maxHP', steed.currentHP, steed.maxHP);
  eq('AC is 12', steed.ac, 12);
  eq('speed is 30', steed.speed, 30);
  eq('flySpeed is 80', steed.flySpeed, 80);
  eq('STR is 18', steed.str, 18);
  eq('DEX is 15', steed.dex, 15);
  eq('CON is 16', steed.con, 16);
  eq('INT is 2', steed.int, 2);
  eq('WIS is 13', steed.wis, 13);
  eq('CHA is 8', steed.cha, 8);
  eq('cr is 2', steed.cr, 2);
  eq('size is Large', steed.size, 'Large');
  eq('role is combat_mount', steed.role, 'combat_mount');
  eq('cannotAttack is false', steed.cannotAttack, false);
  eq('aiProfile is attackNearest', steed.aiProfile, 'attackNearest');
  eq('has 2 attack actions (Beak + Claws)', steed.actions.length, 2);
  eq('first attack name is Beak', steed.actions[0].name, 'Beak');
  eq('Beak hitBonus is +5', steed.actions[0].hitBonus, 5);
  eq('Beak damage is 1d8+4', steed.actions[0].damage?.count === 1 && steed.actions[0].damage?.sides === 8 && steed.actions[0].damage?.bonus === 4, true);
  eq('Beak damageType is piercing', steed.actions[0].damageType, 'piercing');
  eq('second attack name is Claws', steed.actions[1].name, 'Claws');
  eq('Claws hitBonus is +5', steed.actions[1].hitBonus, 5);
  eq('Claws damage is 2d6+4', steed.actions[1].damage?.count === 2 && steed.actions[1].damage?.sides === 6 && steed.actions[1].damage?.bonus === 4, true);
  eq('Claws damageType is slashing', steed.actions[1].damageType, 'slashing');
  eq('Both attacks are isMultiattack', steed.actions[0].isMultiattack === true && steed.actions[1].isMultiattack === true, true);
  eq('bonded is caster id', steed.bonded, 'caster1');
  assert('Position is adjacent to caster', steed.pos.x === 1 && steed.pos.y === 0);
}

// ============================================================
// 4. execute — creates summon, adds to battlefield, mounts caster
// ============================================================

console.log('\n=== 4. execute — creates summon, adds to battlefield, mounts caster ===\n');

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
    const steed = summons[0];
    eq('Summon isSummon is true', steed.isSummon, true);
    eq('Summon summonerId is caster', steed.summonerId, 'caster1');
    eq('Summon summonSpellName is Find Greater Steed', steed.summonSpellName, 'Find Greater Steed');
    eq('Summon faction matches caster', steed.faction, 'party');
    eq('Summon HP is 59', steed.maxHP, 59);
    eq('Summon AC is 12', steed.ac, 12);
    eq('Summon size is Large', steed.size, 'Large');
    eq('Summon role is combat_mount', steed.role, 'combat_mount');
    eq('Summon flySpeed is 80', steed.flySpeed, 80);

    // Mount link: caster is mounted on steed
    eq('Caster is mounted on steed', caster.mountedOn, steed.id);
    eq('Steed carries caster', steed.carriedBy, caster.id);

    // Caster position synced to steed position
    eq('Caster pos matches steed pos', caster.pos.x === steed.pos.x && caster.pos.y === steed.pos.y, true);
  }

  // NOT a concentration spell — caster should NOT be concentrating
  eq('Caster is NOT concentrating (Instantaneous)', caster.concentration?.active ?? false, false);

  // Slot consumed
  eq('Slot consumed (0 remaining)', caster.resources!.spellSlots![4]!.remaining, 0);
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
// 6. NOT concentration — steed persists independently
// ============================================================

console.log('\n=== 6. NOT concentration — steed persists independently ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  // Caster never had concentration set
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
    assert('Action event mentions "Find Greater Steed"', actionEvents[0].description.includes('Find Greater Steed'));
    assert('Action event mentions "Griffon"', actionEvents[0].description.includes('Griffon'));
    assert('Action event mentions "mounts"', actionEvents[0].description.includes('mounts'));
    assert('Action event mentions fly speed', actionEvents[0].description.includes('fly'));
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
