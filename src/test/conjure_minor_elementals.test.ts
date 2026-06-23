// ============================================================
// conjure_minor_elementals.test.ts — Conjure Minor Elementals (PHB p.226)
// 4th-level conjuration, action, range 90 ft, concentration 1 hr.
// Effect: Spawns 4 Mud Mephit combatants (v1: hardcoded most common option).
//         Unlike TCE summons, PHB Conjure spells pick from the MM by CR.
//         Mud Mephits disappear on concentration break or 0 HP.
//
// Tests cover: metadata, shouldCast gates, execute combatant creation,
// summon tags, battlefield addition, initiative insertion, concentration
// break despawn, mud mephit stats, and CR picker option table.
// ============================================================

import { shouldCast, execute, metadata, createMudMephit } from '../spells/conjure_minor_elementals';
import {
  CONJURE_MINOR_ELEMENTALS_OPTIONS,
  DEFAULT_CME_OPTION,
} from '../summons/cr_picker';
import { setBestiaryForTesting } from '../summons/summon_picker';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { Combatant, Action, PlayerResources, Vec3 } from '../types/core';

// Session 43 Task #21: force empty bestiary so the v1 hardcoded fallback
// (4 Mud Mephits) is exercised. The bestiary-driven path is tested
// separately in bestiary_integration.test.ts.
setBestiaryForTesting(new Map());

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

const CME_ACTION: Action = {
  name: 'Conjure Minor Elementals',
  isMultiattack: false,
  attackType: 'save',
  reach: 90,
  range: { normal: 90, long: 90 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 13,
  saveAbility: 'wis',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 4,
  costType: 'action',
  legendaryCost: 0,
  description: 'Conjure Minor Elementals (concentration 1 hr)',
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

/** Caster with Conjure Minor Elementals action + 4th-level slots */
function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Wizard',
    pos,
    actions: [CME_ACTION],
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

eq('name is Conjure Minor Elementals', metadata.name, 'Conjure Minor Elementals');
eq('level is 4', metadata.level, 4);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 90 ft', metadata.rangeFt, 90);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
assert('conjureMinorElementalsV1Implemented is true', metadata.conjureMinorElementalsV1Implemented === true);
assert('v1DefaultOption mentions CR', (metadata as any).v1DefaultOption.includes('CR'));
eq('v1SpawnCount is 4', (metadata as any).v1SpawnCount, 4);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Conjure Minor Elementals' action
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Conjure Minor Elementals action', shouldCast(caster, bf) === false);
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
  // 2c. Caster is already concentrating
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Polymorph', dcIfHit: 10 };
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster is already concentrating', shouldCast(caster, bf) === false);
}

{
  // 2d. Caster already has 4+ Conjure Minor Elementals summons active
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingSummons = [0, 1, 2, 3].map(i =>
    makeCombatant(`existing_mephit_${i}`, {
      name: `Mud Mephit (Wizard) #${i + 1}`,
      faction: 'party',
      isSummon: true,
      summonerId: caster.id,
      summonSpellName: 'Conjure Minor Elementals',
    })
  );
  const bf = makeBF([caster, enemy, ...existingSummons]);
  assert('Returns false when caster already has 4 Conjure Minor Elementals summons', shouldCast(caster, bf) === false);
}

{
  // 2e. Caster has fewer than 4 summons (should still allow)
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingSummons = [0, 1].map(i =>
    makeCombatant(`existing_mephit_${i}`, {
      name: `Mud Mephit (Wizard) #${i + 1}`,
      faction: 'party',
      isSummon: true,
      summonerId: caster.id,
      summonSpellName: 'Conjure Minor Elementals',
    })
  );
  const bf = makeBF([caster, enemy, ...existingSummons]);
  assert('Returns true when caster has <4 Conjure Minor Elementals summons', shouldCast(caster, bf) === true);
}

{
  // 2f. All conditions met
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createMudMephit — combatant creation
// ============================================================

console.log('\n=== 3. createMudMephit — combatant creation ===\n');

{
  const caster = makeCaster();
  const mephit0 = createMudMephit(caster, 0);
  const mephit1 = createMudMephit(caster, 1);

  eq('Mephit 0 isSummon is true', mephit0.isSummon, true);
  eq('Mephit 0 summonerId matches caster', mephit0.summonerId, 'caster1');
  eq('Mephit 0 summonSpellName is Conjure Minor Elementals', mephit0.summonSpellName, 'Conjure Minor Elementals');
  eq('Mephit 0 faction matches caster', mephit0.faction, 'party');
  assert('Mephit 0 name includes Mud Mephit', mephit0.name.includes('Mud Mephit'));
  assert('Mephit 0 name includes caster name', mephit0.name.includes('Wizard'));
  eq('Mephit 0 HP is 27', mephit0.maxHP, 27);
  eq('Mephit 0 currentHP equals maxHP', mephit0.currentHP, mephit0.maxHP);
  eq('Mephit 0 AC is 11', mephit0.ac, 11);
  eq('Mephit 0 aiProfile is attackNearest', mephit0.aiProfile, 'attackNearest');
  eq('Mephit 0 speed is 20', mephit0.speed, 20);
  eq('Mephit 0 flySpeed is 20', mephit0.flySpeed, 20);
  eq('Mephit 0 swimSpeed is 20', mephit0.swimSpeed, 20);
  eq('Mephit 0 STR is 8', mephit0.str, 8);
  eq('Mephit 0 DEX is 12', mephit0.dex, 12);
  eq('Mephit 0 CON is 12', mephit0.con, 12);
  eq('Mephit 0 INT is 9', mephit0.int, 9);
  eq('Mephit 0 WIS is 11', mephit0.wis, 11);
  eq('Mephit 0 CHA is 7', mephit0.cha, 7);
  eq('Mephit 0 CR is 0.25', mephit0.cr, 0.25);

  // Attack action (Fists)
  eq('Mephit 0 has 1 attack action', mephit0.actions.length, 1);
  eq('Mephit 0 attack name is Fists', mephit0.actions[0].name, 'Fists');
  eq('Mephit 0 attack hitBonus is +3', mephit0.actions[0].hitBonus, 3);
  assert('Mephit 0 attack damage 1d6+1', mephit0.actions[0].damage!.count === 1 && mephit0.actions[0].damage!.sides === 6 && mephit0.actions[0].damage!.bonus === 1);
  eq('Mephit 0 attack damageType is bludgeoning', mephit0.actions[0].damageType, 'bludgeoning');

  // Traits (Death Burst, Mud Breath — documented even if not modelled)
  eq('Mephit 0 has 2 traits (Death Burst, Mud Breath)', mephit0.traits.length, 2);
  assert('Mephit 0 has Death Burst trait', mephit0.traits.includes('Death Burst'));
  assert('Mephit 0 has Mud Breath trait', mephit0.traits.includes('Mud Breath (recharge 6)'));

  // Position: mephit0 is adjacent (offset +1, 0)
  eq('Mephit 0 pos.x is caster.pos.x + 1', mephit0.pos.x, 1);
  eq('Mephit 0 pos.y is caster.pos.y', mephit0.pos.y, 0);

  // mephit1 has different position
  eq('Mephit 1 pos.x is caster.pos.x - 1', mephit1.pos.x, -1);
  eq('Mephit 1 pos.y is caster.pos.y', mephit1.pos.y, 0);

  // hasHands true (Mud Mephit has fists)
  eq('Mephit 0 hasHands is true', mephit0.hasHands, true);

  // Unique IDs
  assert('Mephit IDs are unique', mephit0.id !== mephit1.id);
}

// ============================================================
// 4. execute — creates summons and adds to battlefield
// ============================================================

console.log('\n=== 4. execute — creates summons and adds to battlefield ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  // Find the mephits in the battlefield
  const mephits = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Minor Elementals');
  eq('4 mephits added to battlefield', mephits.length, 4);

  if (mephits.length === 4) {
    for (const mephit of mephits) {
      eq('Mephit isSummon is true', mephit.isSummon, true);
      eq('Mephit summonerId is caster', mephit.summonerId, 'caster1');
      eq('Mephit summonSpellName is Conjure Minor Elementals', mephit.summonSpellName, 'Conjure Minor Elementals');
      eq('Mephit faction matches caster', mephit.faction, 'party');
      eq('Mephit HP is 27', mephit.maxHP, 27);
      eq('Mephit AC is 11', mephit.ac, 11);
    }
  }

  // Caster is concentrating on Conjure Minor Elementals
  eq('Caster concentrating on Conjure Minor Elementals', caster.concentration?.spellName, 'Conjure Minor Elementals');
  eq('Caster concentration is active', caster.concentration?.active, true);

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
    eq('4 pending inserts', bf.pendingInitiativeInserts.length, 4);
    if (bf.pendingInitiativeInserts.length >= 4) {
      for (let i = 0; i < 4; i++) {
        eq(`insert ${i} insertAfterId is caster id`, bf.pendingInitiativeInserts[i].insertAfterId, 'caster1');
      }

      const mephits = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Minor Elementals');
      if (mephits.length === 4) {
        const mephitIds = new Set(mephits.map(m => m.id));
        for (let i = 0; i < 4; i++) {
          assert(`insert ${i} combatantId is a mephit`, mephitIds.has(bf.pendingInitiativeInserts[i].combatantId));
        }
      }
    }
  }
}

// ============================================================
// 6. Concentration break despawns all mephits
// ============================================================

console.log('\n=== 6. Concentration break despawns all mephits ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  // Verify mephits exist
  const mephitsBefore = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Minor Elementals');
  eq('4 mephits exist before concentration break', mephitsBefore.length, 4);

  // Break concentration
  removeEffectsFromCaster(caster.id, bf);

  // Verify mephits are removed
  const mephitsAfter = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Minor Elementals');
  eq('All mephits removed after concentration break', mephitsAfter.length, 0);
}

// ============================================================
// 7. Mud Mephit stats correctness (comprehensive)
// ============================================================

console.log('\n=== 7. Mud Mephit stats correctness (comprehensive) ===\n');

{
  const caster = makeCaster('wiz1', { x: 3, y: 3, z: 0 });
  const mephit = createMudMephit(caster, 0);

  // Core stats
  eq('AC 11', mephit.ac, 11);
  eq('HP 27', mephit.maxHP, 27);
  eq('currentHP = maxHP', mephit.currentHP, mephit.maxHP);
  eq('Speed 20', mephit.speed, 20);
  eq('Fly speed 20', mephit.flySpeed, 20);
  eq('Swim speed 20', mephit.swimSpeed, 20);
  eq('No burrow speed', mephit.burrowSpeed, null);

  // Ability scores (MM p.215)
  eq('STR 8', mephit.str, 8);
  eq('DEX 12', mephit.dex, 12);
  eq('CON 12', mephit.con, 12);
  eq('INT 9', mephit.int, 9);
  eq('WIS 11', mephit.wis, 11);
  eq('CHA 7', mephit.cha, 7);

  // CR
  eq('CR 0.25', mephit.cr, 0.25);

  // Fists attack details
  const fists = mephit.actions[0];
  eq('Fists attackType is melee', fists.attackType, 'melee');
  eq('Fists reach is 5', fists.reach, 5);
  eq('Fists hitBonus +3', fists.hitBonus, 3);
  assert('Fists damage 1d6+1', fists.damage!.count === 1 && fists.damage!.sides === 6 && fists.damage!.bonus === 1);
  eq('Fists average damage is 4', fists.damage!.average, 4);
  eq('Fists damageType bludgeoning', fists.damageType, 'bludgeoning');
  eq('Fists costType action', fists.costType, 'action');

  // Summon fields
  eq('isSummon true', mephit.isSummon, true);
  eq('summonerId is wiz1', mephit.summonerId, 'wiz1');
  eq('summonSpellName is Conjure Minor Elementals', mephit.summonSpellName, 'Conjure Minor Elementals');

  // Position adjacent to caster
  assert('Mephit positioned adjacent to caster',
    Math.abs(mephit.pos.x - caster.pos.x) + Math.abs(mephit.pos.y - caster.pos.y) <= 2
  );
}

// ============================================================
// 8. All 4 mephits have unique positions and IDs
// ============================================================

console.log('\n=== 8. All 4 mephits have unique positions and IDs ===\n');

{
  const caster = makeCaster('wiz1', { x: 0, y: 0, z: 0 });
  const mephits = [0, 1, 2, 3].map(i => createMudMephit(caster, i));

  const ids = new Set(mephits.map(m => m.id));
  eq('All 4 IDs are unique', ids.size, 4);

  const positions = new Set(mephits.map(m => `${m.pos.x},${m.pos.y}`));
  eq('All 4 positions are unique', positions.size, 4);

  // Verify each mephit is adjacent (within 2 Manhattan distance)
  for (let i = 0; i < mephits.length; i++) {
    const dist = Math.abs(mephits[i].pos.x - caster.pos.x) + Math.abs(mephits[i].pos.y - caster.pos.y);
    eq(`Mephit ${i} is adjacent to caster (dist ${dist})`, dist <= 2, true as any);
  }
}

// ============================================================
// 9. CR Picker — Conjure Minor Elementals options table
// ============================================================

console.log('\n=== 9. CR Picker — Conjure Minor Elementals options table ===\n');

eq('4 options defined', CONJURE_MINOR_ELEMENTALS_OPTIONS.length, 4);
eq('Option 0: CR 2, 1 elemental', CONJURE_MINOR_ELEMENTALS_OPTIONS[0].maxCR, 2);
eq('Option 0: count 1', CONJURE_MINOR_ELEMENTALS_OPTIONS[0].count, 1);
eq('Option 1: CR 1, 2 elementals', CONJURE_MINOR_ELEMENTALS_OPTIONS[1].maxCR, 1);
eq('Option 1: count 2', CONJURE_MINOR_ELEMENTALS_OPTIONS[1].count, 2);
eq('Option 2: CR 1/2, 4 elementals', CONJURE_MINOR_ELEMENTALS_OPTIONS[2].maxCR, 0.5);
eq('Option 2: count 4', CONJURE_MINOR_ELEMENTALS_OPTIONS[2].count, 4);
eq('Option 3: CR 1/4, 8 elementals', CONJURE_MINOR_ELEMENTALS_OPTIONS[3].maxCR, 0.25);
eq('Option 3: count 8', CONJURE_MINOR_ELEMENTALS_OPTIONS[3].count, 8);
eq('Default option is index 3 (CR 1/4, 8 elementals)', DEFAULT_CME_OPTION.maxCR, 0.25);
eq('Default option count 8', DEFAULT_CME_OPTION.count, 8);

// ============================================================
// 10. execute — logging
// ============================================================

console.log('\n=== 10. execute — logging ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter((e: any) => e.type === 'action');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  if (actionEvents.length >= 1) {
    assert('Action event mentions "Conjure Minor Elementals"', actionEvents[0].description.includes('Conjure Minor Elementals'));
    assert('Action event mentions "Mud Mephits"', actionEvents[0].description.includes('Mud Mephits'));
    assert('Action event mentions HP', actionEvents[0].description.includes('HP'));
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
