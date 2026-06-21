// ============================================================
// conjure_woodland_beings.test.ts — Conjure Woodland Beings (PHB p.228)
// 4th-level conjuration, action, range 60 ft, concentration 1 hr.
// Effect: Spawns 4 Sprite combatants (v1: hardcoded most common option).
//         Unlike TCE summons, PHB Conjure spells pick from the MM by CR.
//         Sprites disappear on concentration break or 0 HP.
//
// Tests cover: metadata, shouldCast gates, execute combatant creation,
// summon tags, battlefield addition, initiative insertion, concentration
// break despawn, sprite stats, and CR picker option table.
// ============================================================

import { shouldCast, execute, metadata, createSprite } from '../spells/conjure_woodland_beings';
import {
  CONJURE_WOODLAND_BEINGS_OPTIONS,
  DEFAULT_CWB_OPTION,
} from '../summons/cr_picker';
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

function withSlots4(remaining = 1): PlayerResources {
  return { spellSlots: { 4: { max: 1, remaining } } };
}

const CWB_ACTION: Action = {
  name: 'Conjure Woodland Beings',
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
  slotLevel: 4,
  costType: 'action',
  legendaryCost: 0,
  description: 'Conjure Woodland Beings (concentration 1 hr)',
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

/** Caster with Conjure Woodland Beings action + 4th-level slots */
function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Druid',
    pos,
    actions: [CWB_ACTION],
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

eq('name is Conjure Woodland Beings', metadata.name, 'Conjure Woodland Beings');
eq('level is 4', metadata.level, 4);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
assert('conjureWoodlandBeingsV1Implemented is true', metadata.conjureWoodlandBeingsV1Implemented === true);
assert('v1DefaultOption mentions CR', (metadata as any).v1DefaultOption.includes('CR'));
eq('v1SpawnCount is 4', (metadata as any).v1SpawnCount, 4);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Conjure Woodland Beings' action
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Conjure Woodland Beings action', shouldCast(caster, bf) === false);
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
  caster.concentration = { active: true, spellName: 'Barkskin', dcIfHit: 10 };
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster is already concentrating', shouldCast(caster, bf) === false);
}

{
  // 2d. Caster already has 4+ Conjure Woodland Beings summons active
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingSummons = [0, 1, 2, 3].map(i =>
    makeCombatant(`existing_sprite_${i}`, {
      name: `Sprite (Druid) #${i + 1}`,
      faction: 'party',
      isSummon: true,
      summonerId: caster.id,
      summonSpellName: 'Conjure Woodland Beings',
    })
  );
  const bf = makeBF([caster, enemy, ...existingSummons]);
  assert('Returns false when caster already has 4 Conjure Woodland Beings summons', shouldCast(caster, bf) === false);
}

{
  // 2e. Caster has fewer than 4 summons (should still allow)
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingSummons = [0, 1].map(i =>
    makeCombatant(`existing_sprite_${i}`, {
      name: `Sprite (Druid) #${i + 1}`,
      faction: 'party',
      isSummon: true,
      summonerId: caster.id,
      summonSpellName: 'Conjure Woodland Beings',
    })
  );
  const bf = makeBF([caster, enemy, ...existingSummons]);
  assert('Returns true when caster has <4 Conjure Woodland Beings summons', shouldCast(caster, bf) === true);
}

{
  // 2f. All conditions met
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createSprite — combatant creation
// ============================================================

console.log('\n=== 3. createSprite — combatant creation ===\n');

{
  const caster = makeCaster();
  const sprite0 = createSprite(caster, 0);
  const sprite1 = createSprite(caster, 1);

  eq('Sprite 0 isSummon is true', sprite0.isSummon, true);
  eq('Sprite 0 summonerId matches caster', sprite0.summonerId, 'caster1');
  eq('Sprite 0 summonSpellName is Conjure Woodland Beings', sprite0.summonSpellName, 'Conjure Woodland Beings');
  eq('Sprite 0 faction matches caster', sprite0.faction, 'party');
  assert('Sprite 0 name includes Sprite', sprite0.name.includes('Sprite'));
  assert('Sprite 0 name includes caster name', sprite0.name.includes('Druid'));
  eq('Sprite 0 HP is 2', sprite0.maxHP, 2);
  eq('Sprite 0 currentHP equals maxHP', sprite0.currentHP, sprite0.maxHP);
  eq('Sprite 0 AC is 15', sprite0.ac, 15);
  eq('Sprite 0 aiProfile is attackNearest', sprite0.aiProfile, 'attackNearest');
  eq('Sprite 0 speed is 10', sprite0.speed, 10);
  eq('Sprite 0 flySpeed is 40', sprite0.flySpeed, 40);
  eq('Sprite 0 STR is 3', sprite0.str, 3);
  eq('Sprite 0 DEX is 18', sprite0.dex, 18);
  eq('Sprite 0 CON is 10', sprite0.con, 10);
  eq('Sprite 0 INT is 14', sprite0.int, 14);
  eq('Sprite 0 WIS is 13', sprite0.wis, 13);
  eq('Sprite 0 CHA is 11', sprite0.cha, 11);
  eq('Sprite 0 CR is 0.25', sprite0.cr, 0.25);

  // Attack actions (Sprite has 2: Shortbow + Longsword)
  eq('Sprite 0 has 2 attack actions', sprite0.actions.length, 2);
  eq('Sprite 0 first attack is Shortbow (primary)', sprite0.actions[0].name, 'Shortbow');
  eq('Sprite 0 second attack is Longsword', sprite0.actions[1].name, 'Longsword');

  // Shortbow (primary, ranged)
  const shortbow = sprite0.actions[0];
  eq('Shortbow attackType is ranged', shortbow.attackType, 'ranged');
  eq('Shortbow reach is 40', shortbow.reach, 40);
  eq('Shortbow range normal 40', shortbow.range!.normal, 40);
  eq('Shortbow range long 160', shortbow.range!.long, 160);
  eq('Shortbow hitBonus is +6', shortbow.hitBonus, 6);
  assert('Shortbow damage 1d4-3 (avg 1)', shortbow.damage!.count === 1 && shortbow.damage!.sides === 4 && shortbow.damage!.bonus === -3);
  eq('Shortbow damageType piercing', shortbow.damageType, 'piercing');
  eq('Shortbow saveDC 10 (poisoned)', shortbow.saveDC, 10);
  eq('Shortbow saveAbility con', shortbow.saveAbility, 'con');

  // Longsword (secondary, melee)
  const longsword = sprite0.actions[1];
  eq('Longsword attackType is melee', longsword.attackType, 'melee');
  eq('Longsword reach is 5', longsword.reach, 5);
  eq('Longsword hitBonus is +2', longsword.hitBonus, 2);
  eq('Longsword damageType slashing', longsword.damageType, 'slashing');

  // Position: sprite0 is adjacent (offset +1, 0)
  eq('Sprite 0 pos.x is caster.pos.x + 1', sprite0.pos.x, 1);
  eq('Sprite 0 pos.y is caster.pos.y', sprite0.pos.y, 0);

  // sprite1 has different position
  eq('Sprite 1 pos.x is caster.pos.x - 1', sprite1.pos.x, -1);
  eq('Sprite 1 pos.y is caster.pos.y', sprite1.pos.y, 0);

  // wearingArmor true (Sprite wears leather armor per MM)
  eq('Sprite 0 wearingArmor is true', sprite0.wearingArmor, true);

  // Unique IDs
  assert('Sprite IDs are unique', sprite0.id !== sprite1.id);
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

  // Find the sprites in the battlefield
  const sprites = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Woodland Beings');
  eq('4 sprites added to battlefield', sprites.length, 4);

  if (sprites.length === 4) {
    for (const sprite of sprites) {
      eq('Sprite isSummon is true', sprite.isSummon, true);
      eq('Sprite summonerId is caster', sprite.summonerId, 'caster1');
      eq('Sprite summonSpellName is Conjure Woodland Beings', sprite.summonSpellName, 'Conjure Woodland Beings');
      eq('Sprite faction matches caster', sprite.faction, 'party');
      eq('Sprite HP is 2', sprite.maxHP, 2);
      eq('Sprite AC is 15', sprite.ac, 15);
    }
  }

  // Caster is concentrating on Conjure Woodland Beings
  eq('Caster concentrating on Conjure Woodland Beings', caster.concentration?.spellName, 'Conjure Woodland Beings');
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

      const sprites = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Woodland Beings');
      if (sprites.length === 4) {
        const spriteIds = new Set(sprites.map(s => s.id));
        for (let i = 0; i < 4; i++) {
          assert(`insert ${i} combatantId is a sprite`, spriteIds.has(bf.pendingInitiativeInserts[i].combatantId));
        }
      }
    }
  }
}

// ============================================================
// 6. Concentration break despawns all sprites
// ============================================================

console.log('\n=== 6. Concentration break despawns all sprites ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  // Verify sprites exist
  const spritesBefore = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Woodland Beings');
  eq('4 sprites exist before concentration break', spritesBefore.length, 4);

  // Break concentration
  removeEffectsFromCaster(caster.id, bf);

  // Verify sprites are removed
  const spritesAfter = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Woodland Beings');
  eq('All sprites removed after concentration break', spritesAfter.length, 0);
}

// ============================================================
// 7. Sprite stats correctness (comprehensive)
// ============================================================

console.log('\n=== 7. Sprite stats correctness (comprehensive) ===\n');

{
  const caster = makeCaster('druid1', { x: 3, y: 3, z: 0 });
  const sprite = createSprite(caster, 0);

  // Core stats
  eq('AC 15', sprite.ac, 15);
  eq('HP 2', sprite.maxHP, 2);
  eq('currentHP = maxHP', sprite.currentHP, sprite.maxHP);
  eq('Speed 10', sprite.speed, 10);
  eq('Fly speed 40', sprite.flySpeed, 40);
  eq('No swim speed', sprite.swimSpeed, null);
  eq('No burrow speed', sprite.burrowSpeed, null);

  // Ability scores (MM p.340)
  eq('STR 3', sprite.str, 3);
  eq('DEX 18', sprite.dex, 18);
  eq('CON 10', sprite.con, 10);
  eq('INT 14', sprite.int, 14);
  eq('WIS 13', sprite.wis, 13);
  eq('CHA 11', sprite.cha, 11);

  // CR
  eq('CR 0.25', sprite.cr, 0.25);

  // Shortbow attack details (primary, ranged)
  const shortbow = sprite.actions[0];
  eq('Shortbow attackType is ranged', shortbow.attackType, 'ranged');
  eq('Shortbow reach is 40', shortbow.reach, 40);
  eq('Shortbow hitBonus +6', shortbow.hitBonus, 6);
  assert('Shortbow damage 1d4-3 (avg 1)', shortbow.damage!.count === 1 && shortbow.damage!.sides === 4 && shortbow.damage!.bonus === -3);
  eq('Shortbow average damage is 1', shortbow.damage!.average, 1);
  eq('Shortbow damageType piercing', shortbow.damageType, 'piercing');
  eq('Shortbow saveDC 10 (poisoned)', shortbow.saveDC, 10);
  eq('Shortbow saveAbility con', shortbow.saveAbility, 'con');
  eq('Shortbow costType action', shortbow.costType, 'action');

  // Longsword attack details (secondary, melee)
  const longsword = sprite.actions[1];
  eq('Longsword attackType is melee', longsword.attackType, 'melee');
  eq('Longsword reach is 5', longsword.reach, 5);
  eq('Longsword hitBonus +2', longsword.hitBonus, 2);
  eq('Longsword damageType slashing', longsword.damageType, 'slashing');

  // Summon fields
  eq('isSummon true', sprite.isSummon, true);
  eq('summonerId is druid1', sprite.summonerId, 'druid1');
  eq('summonSpellName is Conjure Woodland Beings', sprite.summonSpellName, 'Conjure Woodland Beings');

  // Position adjacent to caster
  assert('Sprite positioned adjacent to caster',
    Math.abs(sprite.pos.x - caster.pos.x) + Math.abs(sprite.pos.y - caster.pos.y) <= 2
  );

  // wearingArmor (Sprite wears leather armor per MM)
  eq('wearingArmor true', sprite.wearingArmor, true);
}

// ============================================================
// 8. All 4 sprites have unique positions and IDs
// ============================================================

console.log('\n=== 8. All 4 sprites have unique positions and IDs ===\n');

{
  const caster = makeCaster('druid1', { x: 0, y: 0, z: 0 });
  const sprites = [0, 1, 2, 3].map(i => createSprite(caster, i));

  const ids = new Set(sprites.map(s => s.id));
  eq('All 4 IDs are unique', ids.size, 4);

  const positions = new Set(sprites.map(s => `${s.pos.x},${s.pos.y}`));
  eq('All 4 positions are unique', positions.size, 4);

  // Verify each sprite is adjacent (within 2 Manhattan distance)
  for (let i = 0; i < sprites.length; i++) {
    const dist = Math.abs(sprites[i].pos.x - caster.pos.x) + Math.abs(sprites[i].pos.y - caster.pos.y);
    eq(`Sprite ${i} is adjacent to caster (dist ${dist})`, dist <= 2, true as any);
  }
}

// ============================================================
// 9. CR Picker — Conjure Woodland Beings options table
// ============================================================

console.log('\n=== 9. CR Picker — Conjure Woodland Beings options table ===\n');

eq('4 options defined', CONJURE_WOODLAND_BEINGS_OPTIONS.length, 4);
eq('Option 0: CR 2, 1 fey', CONJURE_WOODLAND_BEINGS_OPTIONS[0].maxCR, 2);
eq('Option 0: count 1', CONJURE_WOODLAND_BEINGS_OPTIONS[0].count, 1);
eq('Option 1: CR 1, 2 fey', CONJURE_WOODLAND_BEINGS_OPTIONS[1].maxCR, 1);
eq('Option 1: count 2', CONJURE_WOODLAND_BEINGS_OPTIONS[1].count, 2);
eq('Option 2: CR 1/2, 4 fey', CONJURE_WOODLAND_BEINGS_OPTIONS[2].maxCR, 0.5);
eq('Option 2: count 4', CONJURE_WOODLAND_BEINGS_OPTIONS[2].count, 4);
eq('Option 3: CR 1/4, 8 fey', CONJURE_WOODLAND_BEINGS_OPTIONS[3].maxCR, 0.25);
eq('Option 3: count 8', CONJURE_WOODLAND_BEINGS_OPTIONS[3].count, 8);
eq('Default option is index 3 (CR 1/4, 8 fey)', DEFAULT_CWB_OPTION.maxCR, 0.25);
eq('Default option count 8', DEFAULT_CWB_OPTION.count, 8);

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
    assert('Action event mentions "Conjure Woodland Beings"', actionEvents[0].description.includes('Conjure Woodland Beings'));
    assert('Action event mentions "Sprites"', actionEvents[0].description.includes('Sprites'));
    assert('Action event mentions HP', actionEvents[0].description.includes('HP'));
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
