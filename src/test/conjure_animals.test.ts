// ============================================================
// conjure_animals.test.ts — Conjure Animals spell module (PHB p.225)
// 3rd-level conjuration, action, range 60 ft, concentration 1 hr.
// Effect: Spawns 2 Wolf combatants (v1: hardcoded most common option).
//         Unlike TCE summons, PHB Conjure spells pick from the MM by CR.
//         Wolves disappear on concentration break or 0 HP.
//
// Tests cover: metadata, shouldCast gates, execute combatant creation,
// summon tags, battlefield addition, initiative insertion, concentration
// break despawn, wolf stats, and CR picker infrastructure.
// ============================================================

import { shouldCast, execute, metadata, createWolf } from '../spells/conjure_animals';
import { parseCR, pickCreaturesByCR, CONJURE_ANIMALS_OPTIONS, DEFAULT_CA_OPTION } from '../summons/cr_picker';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { Combatant, Action, PlayerResources, Vec3 } from '../types/core';
import { Raw5etoolsMonster } from '../parser/fivetools';

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

const CONJURE_ANIMALS_ACTION: Action = {
  name: 'Conjure Animals',
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
  description: 'Conjure Animals (concentration 1 hr)',
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

/** Caster with Conjure Animals action + 3rd-level slots */
function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Druid',
    pos,
    actions: [CONJURE_ANIMALS_ACTION],
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

eq('name is Conjure Animals', metadata.name, 'Conjure Animals');
eq('level is 3', metadata.level, 3);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('conjureAnimalsV1Implemented is true', metadata.conjureAnimalsV1Implemented, true);
assert('v1DefaultOption mentions wolves or CR', metadata.v1DefaultOption.includes('CR'));

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Conjure Animals' action
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Conjure Animals action', shouldCast(caster, bf) === false);
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
  // 2d. Caster already has 4+ Conjure Animals summons active
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingSummons = [0, 1, 2, 3].map(i =>
    makeCombatant(`existing_wolf_${i}`, {
      name: `Wolf (Druid) #${i + 1}`,
      faction: 'party',
      isSummon: true,
      summonerId: caster.id,
      summonSpellName: 'Conjure Animals',
    })
  );
  const bf = makeBF([caster, enemy, ...existingSummons]);
  assert('Returns false when caster already has 4 Conjure Animals summons', shouldCast(caster, bf) === false);
}

{
  // 2e. Caster has fewer than 4 summons (should still allow)
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingSummons = [0, 1].map(i =>
    makeCombatant(`existing_wolf_${i}`, {
      name: `Wolf (Druid) #${i + 1}`,
      faction: 'party',
      isSummon: true,
      summonerId: caster.id,
      summonSpellName: 'Conjure Animals',
    })
  );
  const bf = makeBF([caster, enemy, ...existingSummons]);
  assert('Returns true when caster has <4 Conjure Animals summons', shouldCast(caster, bf) === true);
}

{
  // 2f. All conditions met
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createWolf — combatant creation
// ============================================================

console.log('\n=== 3. createWolf — combatant creation ===\n');

{
  const caster = makeCaster();
  const wolf0 = createWolf(caster, 0);
  const wolf1 = createWolf(caster, 1);

  eq('Wolf 0 isSummon is true', wolf0.isSummon, true);
  eq('Wolf 0 summonerId matches caster', wolf0.summonerId, 'caster1');
  eq('Wolf 0 summonSpellName is Conjure Animals', wolf0.summonSpellName, 'Conjure Animals');
  eq('Wolf 0 faction matches caster', wolf0.faction, 'party');
  assert('Wolf 0 name includes Wolf', wolf0.name.includes('Wolf'));
  assert('Wolf 0 name includes caster name', wolf0.name.includes('Druid'));
  eq('Wolf 0 HP is 11', wolf0.maxHP, 11);
  eq('Wolf 0 currentHP equals maxHP', wolf0.currentHP, wolf0.maxHP);
  eq('Wolf 0 AC is 13', wolf0.ac, 13);
  eq('Wolf 0 aiProfile is attackNearest', wolf0.aiProfile, 'attackNearest');
  eq('Wolf 0 speed is 40', wolf0.speed, 40);
  eq('Wolf 0 STR is 12', wolf0.str, 12);
  eq('Wolf 0 DEX is 15', wolf0.dex, 15);
  eq('Wolf 0 CON is 12', wolf0.con, 12);
  eq('Wolf 0 INT is 3', wolf0.int, 3);
  eq('Wolf 0 WIS is 12', wolf0.wis, 12);
  eq('Wolf 0 CHA is 6', wolf0.cha, 6);
  eq('Wolf 0 CR is 0.25', wolf0.cr, 0.25);

  // Attack action
  eq('Wolf 0 has 1 attack action', wolf0.actions.length, 1);
  eq('Wolf 0 attack name is Bite', wolf0.actions[0].name, 'Bite');
  eq('Wolf 0 attack hitBonus is +4', wolf0.actions[0].hitBonus, 4);
  assert('Wolf 0 attack damage is 2d6+2', wolf0.actions[0].damage?.count === 2 && wolf0.actions[0].damage?.sides === 6 && wolf0.actions[0].damage?.bonus === 2);
  eq('Wolf 0 attack damageType is piercing', wolf0.actions[0].damageType, 'piercing');
  eq('Wolf 0 attack saveDC is 11', wolf0.actions[0].saveDC, 11);
  eq('Wolf 0 attack saveAbility is str', wolf0.actions[0].saveAbility, 'str');

  // Pack Tactics trait
  eq('Wolf 0 has 1 trait', wolf0.traits.length, 1);
  eq('Wolf 0 trait is Pack Tactics', wolf0.traits[0], 'Pack Tactics');

  // Position: wolf0 is adjacent (offset +1, 0)
  eq('Wolf 0 pos.x is caster.pos.x + 1', wolf0.pos.x, 1);
  eq('Wolf 0 pos.y is caster.pos.y', wolf0.pos.y, 0);

  // wolf1 has different position
  eq('Wolf 1 pos.x is caster.pos.x - 1', wolf1.pos.x, -1);
  eq('Wolf 1 pos.y is caster.pos.y', wolf1.pos.y, 0);

  // hasHands false (beast)
  eq('Wolf 0 hasHands is false', wolf0.hasHands, false);

  // Unique IDs
  assert('Wolf IDs are unique', wolf0.id !== wolf1.id);
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

  // Find the wolves in the battlefield
  const wolves = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Animals');
  eq('2 wolves added to battlefield', wolves.length, 2);

  if (wolves.length === 2) {
    for (const wolf of wolves) {
      eq('Wolf isSummon is true', wolf.isSummon, true);
      eq('Wolf summonerId is caster', wolf.summonerId, 'caster1');
      eq('Wolf summonSpellName is Conjure Animals', wolf.summonSpellName, 'Conjure Animals');
      eq('Wolf faction matches caster', wolf.faction, 'party');
      eq('Wolf HP is 11', wolf.maxHP, 11);
      eq('Wolf AC is 13', wolf.ac, 13);
    }
  }

  // Caster is concentrating on Conjure Animals
  eq('Caster concentrating on Conjure Animals', caster.concentration?.spellName, 'Conjure Animals');
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
    eq('2 pending inserts', bf.pendingInitiativeInserts.length, 2);
    if (bf.pendingInitiativeInserts.length >= 2) {
      eq('insert 0 insertAfterId is caster id', bf.pendingInitiativeInserts[0].insertAfterId, 'caster1');
      eq('insert 1 insertAfterId is caster id', bf.pendingInitiativeInserts[1].insertAfterId, 'caster1');

      const wolves = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Animals');
      if (wolves.length === 2) {
        const wolfIds = new Set(wolves.map(w => w.id));
        assert('insert 0 combatantId is a wolf', wolfIds.has(bf.pendingInitiativeInserts[0].combatantId));
        assert('insert 1 combatantId is a wolf', wolfIds.has(bf.pendingInitiativeInserts[1].combatantId));
      }
    }
  }
}

// ============================================================
// 6. Concentration break despawns both wolves
// ============================================================

console.log('\n=== 6. Concentration break despawns both wolves ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  // Verify wolves exist
  const wolvesBefore = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Animals');
  eq('2 wolves exist before concentration break', wolvesBefore.length, 2);

  // Break concentration
  removeEffectsFromCaster(caster.id, bf);

  // Verify wolves are removed
  const wolvesAfter = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Animals');
  eq('All wolves removed after concentration break', wolvesAfter.length, 0);
}

// ============================================================
// 7. Wolf stats correctness (comprehensive)
// ============================================================

console.log('\n=== 7. Wolf stats correctness (comprehensive) ===\n');

{
  const caster = makeCaster('druid1', { x: 3, y: 3, z: 0 });
  const wolf = createWolf(caster, 0);

  // Core stats
  eq('AC 13', wolf.ac, 13);
  eq('HP 11', wolf.maxHP, 11);
  eq('currentHP = maxHP', wolf.currentHP, wolf.maxHP);
  eq('Speed 40', wolf.speed, 40);
  eq('No fly speed', wolf.flySpeed, null);
  eq('No swim speed', wolf.swimSpeed, null);
  eq('No burrow speed', wolf.burrowSpeed, null);

  // Ability scores (MM p.341)
  eq('STR 12', wolf.str, 12);
  eq('DEX 15', wolf.dex, 15);
  eq('CON 12', wolf.con, 12);
  eq('INT 3', wolf.int, 3);
  eq('WIS 12', wolf.wis, 12);
  eq('CHA 6', wolf.cha, 6);

  // CR
  eq('CR 0.25', wolf.cr, 0.25);

  // Bite attack details
  const bite = wolf.actions[0];
  eq('Bite attackType is melee', bite.attackType, 'melee');
  eq('Bite reach is 5', bite.reach, 5);
  eq('Bite hitBonus +4', bite.hitBonus, 4);
  assert('Bite damage 2d6+2', bite.damage!.count === 2 && bite.damage!.sides === 6 && bite.damage!.bonus === 2);
  eq('Bite average damage is 9', bite.damage!.average, 9);
  eq('Bite damageType piercing', bite.damageType, 'piercing');
  eq('Bite saveDC 11 (knock prone)', bite.saveDC, 11);
  eq('Bite saveAbility str', bite.saveAbility, 'str');
  eq('Bite costType action', bite.costType, 'action');

  // Summon fields
  eq('isSummon true', wolf.isSummon, true);
  eq('summonerId is druid1', wolf.summonerId, 'druid1');
  eq('summonSpellName is Conjure Animals', wolf.summonSpellName, 'Conjure Animals');

  // Position adjacent to caster
  assert('Wolf positioned adjacent to caster',
    Math.abs(wolf.pos.x - caster.pos.x) + Math.abs(wolf.pos.y - caster.pos.y) <= 2
  );
}

// ============================================================
// 8. CR Picker — parseCR
// ============================================================

console.log('\n=== 8. CR Picker — parseCR ===\n');

eq('parseCR("0") = 0', parseCR('0'), 0);
eq('parseCR("1/8") = 0.125', parseCR('1/8'), 0.125);
eq('parseCR("1/4") = 0.25', parseCR('1/4'), 0.25);
eq('parseCR("1/2") = 0.5', parseCR('1/2'), 0.5);
eq('parseCR("1") = 1', parseCR('1'), 1);
eq('parseCR("2") = 2', parseCR('2'), 2);
eq('parseCR("5") = 5', parseCR('5'), 5);
eq('parseCR("21") = 21', parseCR('21'), 21);
eq('parseCR({ cr: "1/4" }) = 0.25', parseCR({ cr: '1/4' }), 0.25);
eq('parseCR({ cr: "2" }) = 2', parseCR({ cr: '2' }), 2);
eq('parseCR(undefined) = null', parseCR(undefined), null);
eq('parseCR(null) = null', parseCR(null), null);

// ============================================================
// 9. CR Picker — pickCreaturesByCR
// ============================================================

console.log('\n=== 9. CR Picker — pickCreaturesByCR ===\n');

{
  // Build a small test bestiary
  const bestiary = new Map<string, Raw5etoolsMonster>();
  bestiary.set('wolf', { name: 'Wolf', source: 'MM', cr: '1/4', type: 'beast', ac: [13], hp: { average: 11, formula: '2d8+2' } });
  bestiary.set('dire wolf', { name: 'Dire Wolf', source: 'MM', cr: '1', type: 'beast', ac: [14], hp: { average: 37, formula: '5d8+15' } });
  bestiary.set('brown bear', { name: 'Brown Bear', source: 'MM', cr: '1', type: 'beast', ac: [11], hp: { average: 34, formula: '4d8+16' } });
  bestiary.set('goblin', { name: 'Goblin', source: 'MM', cr: '1/4', type: 'humanoid', ac: [15], hp: { average: 7, formula: '2d6' } });
  bestiary.set('sprite', { name: 'Sprite', source: 'MM', cr: '1/4', type: 'fey', ac: [15], hp: { average: 2, formula: '1d4' } });
  bestiary.set('tiger', { name: 'Tiger', source: 'MM', cr: '1', type: 'beast', ac: [12], hp: { average: 37, formula: '5d10+10' } });

  // Pick beasts of CR 1/4 or lower
  const lowCRBeasts = pickCreaturesByCR(bestiary, 0.25, 'beast', 4);
  eq('Low CR beasts: all have CR <= 0.25', lowCRBeasts.every(c => c.cr <= 0.25), true);
  eq('Low CR beasts: all are beasts', lowCRBeasts.every(c => {
    // In our test bestiary, only Wolf is a beast with CR <= 0.25
    return c.name === 'Wolf';
  }), true);
  eq('Low CR beasts: Wolf found', lowCRBeasts.some(c => c.name === 'Wolf'), true);

  // Pick beasts of CR 1 or lower (top 2 by CR)
  const cr1Beasts = pickCreaturesByCR(bestiary, 1, 'beast', 2);
  eq('CR 1 beasts: exactly 2 picked', cr1Beasts.length, 2);
  eq('CR 1 beasts: all are CR 1 (highest within limit)', cr1Beasts.every(c => c.cr === 1), true);

  // Pick without type filter
  const anyType = pickCreaturesByCR(bestiary, 0.25, null, 10);
  eq('Any type CR 0.25: 3 results (Wolf, Goblin, Sprite)', anyType.length, 3);

  // Pick fey
  const feyPicks = pickCreaturesByCR(bestiary, 1, 'fey', 5);
  eq('Fey picks: 1 result (Sprite)', feyPicks.length, 1);
  eq('Fey picks: Sprite', feyPicks[0].name, 'Sprite');
}

// ============================================================
// 10. Conjure Animals options table
// ============================================================

console.log('\n=== 10. Conjure Animals options table ===\n');

eq('5 options defined', CONJURE_ANIMALS_OPTIONS.length, 5);
eq('Option 0: CR 2, 1 beast', CONJURE_ANIMALS_OPTIONS[0].maxCR, 2);
eq('Option 0: count 1', CONJURE_ANIMALS_OPTIONS[0].count, 1);
eq('Option 1: CR 1, 2 beasts', CONJURE_ANIMALS_OPTIONS[1].maxCR, 1);
eq('Option 1: count 2', CONJURE_ANIMALS_OPTIONS[1].count, 2);
eq('Option 2: CR 1/2, 3 beasts', CONJURE_ANIMALS_OPTIONS[2].maxCR, 0.5);
eq('Option 2: count 3', CONJURE_ANIMALS_OPTIONS[2].count, 3);
eq('Option 3: CR 1/4, 4 beasts', CONJURE_ANIMALS_OPTIONS[3].maxCR, 0.25);
eq('Option 3: count 4', CONJURE_ANIMALS_OPTIONS[3].count, 4);
eq('Option 4: CR 1/4, 8 beasts', CONJURE_ANIMALS_OPTIONS[4].maxCR, 0.25);
eq('Option 4: count 8', CONJURE_ANIMALS_OPTIONS[4].count, 8);
eq('Default option is index 1 (CR 1, 2 beasts)', DEFAULT_CA_OPTION.maxCR, 1);
eq('Default option count 2', DEFAULT_CA_OPTION.count, 2);

// ============================================================
// 11. execute — logging
// ============================================================

console.log('\n=== 11. execute — logging ===\n');

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
    assert('Action event mentions "Conjure Animals"', actionEvents[0].description.includes('Conjure Animals'));
    assert('Action event mentions "Wolves"', actionEvents[0].description.includes('Wolves'));
    assert('Action event mentions HP', actionEvents[0].description.includes('HP'));
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
