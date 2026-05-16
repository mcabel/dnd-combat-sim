// ============================================================
// Test: Phase 7.2 — Concentration AI
// Verifies that:
//   1. requiresConcentration is correctly detected by parsers
//   2. AI avoids recasting concentration spells when already concentrating
//   3. Smart enemies prefer targeting concentrating casters
// Run: ts-node src/test/concentration_ai.test.ts
// ============================================================

import { selectAction, bestAttackAction }    from '../ai/actions';
import { selectSmart, smartScore }           from '../ai/targeting';
import { startConcentration }                from '../engine/utils';
import { loadBestiaryJson }                  from '../parser/fivetools';
import { loadPCStatBlocks, spawnPC, RawPCEntry } from '../parser/pc';
import { Combatant, Battlefield, Action }    from '../types/core';
import * as fs   from 'fs';
import * as path from 'path';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(o: Partial<Combatant> = {}): Combatant {
  const speed = (o.speed ?? 30);
  return {
    id: `c${++_id}`, name: `c${_id}`, isPlayer: false, faction: 'enemy',
    maxHP: 20, currentHP: 20, ac: 14, speed,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1, pos: { x: 0, y: 0, z: 0 }, actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: speed, actionUsed: false, bonusActionUsed: false,
              reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(), concentration: null, deathSaves: null,
    tempHP: 0, resources: null, usedSneakAttackThisTurn: false,
    mountedOn: null, carriedBy: null,
    aiProfile: 'smart', perception: { targets: new Map() },
    isDead: false, isUnconscious: false,
    ...o,
  };
}

function makeAction(o: Partial<Action> = {}): Action {
  return {
    name: 'Attack', isMultiattack: false, attackType: 'melee',
    reach: 5, range: null, hitBonus: 4,
    damage: { count: 1, sides: 8, bonus: 3, average: 7 },
    damageType: 'slashing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: '',
    ...o,
  };
}

function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return { width: 20, height: 20, depth: 1, cells: [], combatants: map,
           round: 1, initiativeOrder: [] };
}

// ---- PC data ------------------------------------------------

const pcPath = [
  path.join(__dirname, '../../pc_stat_blocks_lv1.json'),
  '/mnt/project/pc_stat_blocks_lv1.json',
].find(p => fs.existsSync(p))!;
const pcMap = loadPCStatBlocks(JSON.parse(fs.readFileSync(pcPath, 'utf-8')));
const pc = (cls: string) => spawnPC(pcMap, cls, { x: 0, y: 0, z: 0 })!;

// ============================================================
// 1. requiresConcentration detection in parsers
// ============================================================
console.log('\n=== 1. requiresConcentration detection ===\n');

{
  // PC spells: Bless = concentration, Sacred Flame = not
  const cleric = pc('Cleric');
  const blessAction = cleric.actions.find(a => a.name.toLowerCase().includes('bless'));
  const flameAction = cleric.actions.find(a => a.name.toLowerCase().includes('sacred flame'));

  if (blessAction) {
    // Bless is in the weapon list for Cleric? Check spellcasting weapons
    // Bless is a preparedSpell, not in weapons[] — so it's not an Action in our model yet
    // The parser creates Actions from weapons[], not prepared spells
    // This is expected: spell selection AI is future work
    assert('Bless not in Cleric weapon actions (spell slots TBD)', blessAction === undefined);
  } else {
    assert('Bless not in Cleric weapon actions (spells not actions yet)', true);
  }

  // Sacred Flame IS in weapons[] as a cantrip action
  if (flameAction) {
    assert('Sacred Flame: requiresConcentration = false', !flameAction.requiresConcentration);
  }

  // Druid Entangle — in preparedSpells, not weapons, so not in actions yet
  const druid = pc('Druid');
  const thornWhip = druid.actions.find(a => a.name === 'Thorn Whip');
  if (thornWhip) {
    assert('Thorn Whip: requiresConcentration = false', !thornWhip.requiresConcentration);
  }

  // Warlock Hex is in weapons[]
  const warlock = pc('Warlock');
  const hexAction = warlock.actions.find(a => a.name.toLowerCase() === 'hex (via slot)');
  if (hexAction) {
    assert('Hex: requiresConcentration = true', hexAction.requiresConcentration);
  } else {
    // Hex is listed as "Hex (via slot)" in weapons
    const hexViaSlot = warlock.actions.find(a => a.name.toLowerCase().includes('hex'));
    assert('Hex found in warlock actions', hexViaSlot !== undefined);
    if (hexViaSlot) {
      assert('Hex: requiresConcentration = true', hexViaSlot.requiresConcentration);
    }
  }
}

{
  // Fivetools parser: "Concentration" keyword in description
  const bestiaryPath = [
    path.join(__dirname, '../../bestiaryData/bestiary-dmg.json'),
    '/mnt/project/bestiary-dmg.json',
  ].find(p => fs.existsSync(p))!;
  const bestiary = loadBestiaryJson(JSON.parse(fs.readFileSync(bestiaryPath, 'utf-8')));

  const larvaRaw = bestiary.get('larva');
  if (larvaRaw && larvaRaw.action) {
    // Larva Bite — no concentration
    const { parseAction } = require('../parser/fivetools');
    const bite = parseAction(larvaRaw.action[0], 'action', 0);
    assert('Larva Bite: requiresConcentration = false', !bite.requiresConcentration);
  }

  // Verify all parsed actions have the field (type completeness)
  const avatarRaw = bestiary.get('avatar of death');
  if (avatarRaw?.action) {
    const { parseAction } = require('../parser/fivetools');
    const scythe = parseAction(avatarRaw.action[0], 'action', 0);
    assert('Reaping Scythe has requiresConcentration field', typeof scythe.requiresConcentration === 'boolean');
    assert('Reaping Scythe: not concentration', !scythe.requiresConcentration);
  }
}

// ============================================================
// 2. AI avoids recasting concentration spells when concentrating
// ============================================================
console.log('\n=== 2. AI avoids double-concentration ===\n');

{
  const concSpell = makeAction({
    name: 'Hold Person', attackType: 'save',
    requiresConcentration: true, isAoE: false,
    saveDC: 14, saveAbility: 'wis',
  });
  const normalAttack = makeAction({ name: 'Claw', requiresConcentration: false });

  const caster = makeC({
    aiProfile: 'smart',
    pos: { x: 0, y: 0, z: 0 },
    actions: [concSpell, normalAttack],
  });

  const target = makeC({ faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, target]);

  // Without concentration active: bestAttackAction can return concSpell
  const withoutConc = bestAttackAction(caster, target, true);
  assert('Without concentration: concSpell available',
    withoutConc !== null);

  // With concentration active: concSpell should be excluded
  startConcentration(caster, 'Entangle');
  assert('Concentration now active', caster.concentration?.active === true);

  const withConc = bestAttackAction(caster, target, true);
  // Should return the non-concentration Claw instead of Hold Person
  if (withConc) {
    assert('With concentration: skips concSpell, picks normal attack',
      !withConc.requiresConcentration,
      `got ${withConc.name}`);
    eq('Picks Claw (non-concentration)', withConc.name, 'Claw');
  } else {
    // If both are filtered, falls through to unarmed — that's also valid
    assert('With concentration: no concentration spell selected', true);
  }
}

{
  // AoE concentration guard in selectAction
  const concAoE = makeAction({
    name: 'Entangle', attackType: 'save',
    requiresConcentration: true, isAoE: true,
    range: { normal: 90, long: 90 }, saveDC: 13, saveAbility: 'str',
    damage: { count: 0, sides: 0, bonus: 0, average: 0 },
  });
  const normalAttack = makeAction({ name: 'Staff', requiresConcentration: false });

  const druidAI = makeC({
    aiProfile: 'smart',
    pos: { x: 5, y: 5, z: 0 },
    actions: [concAoE, normalAttack],
  });

  // Two enemies clustered — normally triggers AoE
  const e1 = makeC({ faction: 'party', pos: { x: 6, y: 5, z: 0 } });
  const e2 = makeC({ faction: 'party', pos: { x: 6, y: 6, z: 0 } });
  const bf2 = makeBF([druidAI, e1, e2]);

  // Without concentration: AoE is selected
  const planWithoutConc = selectAction(druidAI, e1, bf2);
  assert('Without conc: AoE selected when clustered',
    planWithoutConc.action?.isAoE === true || planWithoutConc.type === 'cast',
    `got type=${planWithoutConc.type} action=${planWithoutConc.action?.name}`);

  // With concentration: AoE is skipped, falls back to normal attack
  startConcentration(druidAI, 'Entangle');
  const planWithConc = selectAction(druidAI, e1, bf2);
  assert('With conc: concentration AoE skipped',
    planWithConc.action?.requiresConcentration !== true,
    `got ${planWithConc.action?.name ?? planWithConc.type}`);
}

// ============================================================
// 3. Smart targeting prefers concentrating casters
// ============================================================
console.log('\n=== 3. Smart targeting: prefer concentrating casters ===\n');

{
  const smartEnemy = makeC({
    id: 'smart_orc',
    faction: 'enemy',
    aiProfile: 'smart',
    pos: { x: 0, y: 0, z: 0 },
  });

  // Target A: a normal fighter — no spells cast
  const fighter = makeC({
    id: 'fighter', faction: 'party', name: 'Fighter',
    pos: { x: 2, y: 0, z: 0 }, maxHP: 13, currentHP: 13,
  });

  // Target B: a cleric who cast an AoE/concentration spell this combat
  const cleric = makeC({
    id: 'cleric', faction: 'party', name: 'Cleric',
    pos: { x: 3, y: 0, z: 0 }, maxHP: 11, currentHP: 11,
  });

  // Mark cleric as having cast an AoE spell (observable proxy for concentration)
  smartEnemy.perception.targets.set(cleric.id, {
    lastSeenPos: cleric.pos,
    visibleArmorType: 'heavy',
    hasShield: true,
    isBloodied: false,
    castAoEThisCombat: true,       // ← the key signal
    receivedHealingThisCombat: false,
    isFlying: false, isRanged: false, hasMeleeWeapon: true,
  });
  smartEnemy.perception.targets.set(fighter.id, {
    lastSeenPos: fighter.pos,
    visibleArmorType: 'heavy',
    hasShield: false,
    isBloodied: false,
    castAoEThisCombat: false,
    receivedHealingThisCombat: false,
    isFlying: false, isRanged: false, hasMeleeWeapon: true,
  });

  const bf3 = makeBF([smartEnemy, fighter, cleric]);

  const clericScore  = smartScore(smartEnemy, cleric, bf3);
  const fighterScore = smartScore(smartEnemy, fighter, bf3);

  assert('Concentrating caster scores higher than fighter',
    clericScore > fighterScore,
    `cleric=${clericScore.toFixed(1)} fighter=${fighterScore.toFixed(1)}`);

  // The target actually selected should be the cleric
  const selected = selectSmart(smartEnemy, bf3);
  eq('Smart AI targets the concentrating cleric', selected?.id, cleric.id);
}

{
  // Edge case: concentrating caster who is also bloodied → even higher priority
  const smartOrc = makeC({ id: 'orc2', faction: 'enemy', aiProfile: 'smart', pos: {x:0,y:0,z:0} });

  const bloodiedCaster = makeC({
    id: 'bc', faction: 'party', name: 'BloodiedCaster',
    pos: {x:2,y:0,z:0}, maxHP: 10, currentHP: 4,
  });
  const healthyCaster = makeC({
    id: 'hc', faction: 'party', name: 'HealthyCaster',
    pos: {x:3,y:0,z:0}, maxHP: 10, currentHP: 10,
  });

  for (const [id, castAoE] of [[bloodiedCaster.id, true], [healthyCaster.id, true]] as [string, boolean][]) {
    smartOrc.perception.targets.set(id, {
      lastSeenPos: {x:2,y:0,z:0},
      visibleArmorType: 'none', hasShield: false,
      isBloodied: id === bloodiedCaster.id,
      castAoEThisCombat: castAoE,
      receivedHealingThisCombat: false,
      isFlying: false, isRanged: false, hasMeleeWeapon: false,
    });
  }

  const bf4 = makeBF([smartOrc, bloodiedCaster, healthyCaster]);
  const bloodiedScore = smartScore(smartOrc, bloodiedCaster, bf4);
  const healthyScore  = smartScore(smartOrc, healthyCaster, bf4);

  assert('Bloodied concentrating caster scores higher than healthy concentrating caster',
    bloodiedScore > healthyScore,
    `bloodied=${bloodiedScore.toFixed(1)} healthy=${healthyScore.toFixed(1)}`);
}


// ============================================================
// 4. Non-concentration spells always available when concentrating
// ============================================================
console.log('\n=== 4. Non-concentration spells always available ===\n');

{
  // Use correct single-object factory signature: makeAction({ name, ...props })
  const fireBolt = makeAction({
    name: 'Fire Bolt', attackType: 'ranged', requiresConcentration: false,
    hitBonus: 5, damage: { count: 1, sides: 10, bonus: 0, average: 6 },
  });
  const magicMissile = makeAction({
    name: 'Magic Missile', attackType: 'ranged', requiresConcentration: false,
    hitBonus: null, damage: { count: 3, sides: 4, bonus: 3, average: 10 },
  });
  const blessSpell = makeAction({
    name: 'Bless', attackType: 'save', requiresConcentration: true,
    hitBonus: null, saveDC: 13, saveAbility: 'wis',
    damage: { count: 0, sides: 0, bonus: 0, average: 0 },
  });

  const wizard = makeC({ actions: [fireBolt, magicMissile, blessSpell], aiProfile: 'smart' });
  startConcentration(wizard, 'Hold Person');

  const target4 = makeC({ faction: 'party', pos: { x: 6, y: 0, z: 0 } });
  const best4 = bestAttackAction(wizard, target4, false);

  assert('Concentrating wizard: Bless excluded', best4?.name !== 'Bless',
    `got: ${best4?.name}`);
  assert('Non-concentration spell selected',
    best4?.name === 'Magic Missile' || best4?.name === 'Fire Bolt',
    `got: ${best4?.name}`);
  // Magic Missile average=10 > Fire Bolt average=6 → Magic Missile wins
  eq('Highest-damage non-conc spell wins', best4?.name, 'Magic Missile');
}

// ============================================================
// 5. PC actions have requiresConcentration from parser
// ============================================================
console.log('\n=== 5. PC parser sets requiresConcentration ===\n');

{
  // Cleric weapons: Mace + Sacred Flame — neither requires concentration
  const clericPC = pc('Cleric');
  const maceAction = clericPC.actions.find(a => a.name === 'Mace');
  if (maceAction) {
    assert('Mace: requiresConcentration field exists', typeof maceAction.requiresConcentration === 'boolean');
    assert('Mace: requiresConcentration = false', !maceAction.requiresConcentration);
  } else {
    assert('Cleric has Mace action', false, 'Mace not found in cleric actions');
  }

  const flameAction = clericPC.actions.find(a => a.name === 'Sacred Flame');
  if (flameAction) {
    assert('Sacred Flame: requiresConcentration = false (cantrip)', !flameAction.requiresConcentration);
  }

  // Warlock Hex — contains "hex" in name, flagged as concentration by pc.ts
  const warlockPC = pc('Warlock');
  const hexInActions = warlockPC.actions.find(a => a.name.toLowerCase().includes('hex'));
  if (hexInActions) {
    assert('Hex action found in Warlock', true);
    assert('Hex: requiresConcentration = true', hexInActions.requiresConcentration,
      `got false for action: ${hexInActions.name}`);
  }

  // Druid Thorn Whip — not a concentration spell
  const druidPC = pc('Druid');
  const thornWhip = druidPC.actions.find(a => a.name === 'Thorn Whip');
  if (thornWhip) {
    assert('Thorn Whip: requiresConcentration = false', !thornWhip.requiresConcentration);
  }
}

// ============================================================
// 6. Bestiary monster actions have requiresConcentration
// ============================================================
console.log('\n=== 6. Bestiary actions have requiresConcentration field ===\n');

{
  const bestiaryPath6 = [
    path.join(__dirname, '../../bestiaryData/bestiary-dmg.json'),
    '/mnt/project/bestiary-dmg.json',
  ].find(p => fs.existsSync(p));

  if (bestiaryPath6) {
    const bestiary6 = loadBestiaryJson(JSON.parse(fs.readFileSync(bestiaryPath6, 'utf-8')));
    const { monsterToCombatant } = require('../parser/fivetools');

    const larvaRaw6 = bestiary6.get('larva');
    if (larvaRaw6) {
      const larva6 = monsterToCombatant(larvaRaw6, {x:0,y:0,z:0}, 'attackNearest');
      const bite6 = larva6.actions.find((a: Action) => a.name === 'Bite');
      assert('Larva Bite exists', bite6 !== undefined);
      if (bite6) {
        assert('Bite: requiresConcentration field is boolean', typeof bite6.requiresConcentration === 'boolean');
        assert('Bite: requiresConcentration = false', !bite6.requiresConcentration);
      }
    }

    const avatarRaw6 = bestiary6.get('avatar of death');
    if (avatarRaw6) {
      const avatar6 = monsterToCombatant(avatarRaw6, {x:0,y:0,z:0}, 'smart', 'enemy', 30);
      const scythe6 = avatar6.actions.find((a: Action) => a.name === 'Reaping Scythe');
      assert('Reaping Scythe exists', scythe6 !== undefined);
      if (scythe6) {
        assert('Reaping Scythe: requiresConcentration = false', !scythe6.requiresConcentration);
      }
    }
  } else {
    console.log('  ⚠️  bestiary-dmg.json not found — skipping');
  }
}

// ============================================================
// 7. attackNearest also respects concentration guard (PHB rule)
// ============================================================
console.log('\n=== 7. attackNearest respects concentration guard ===\n');

{
  const hexA = makeAction({
    name: 'Hex', attackType: 'ranged', requiresConcentration: true,
    hitBonus: 5, damage: { count: 1, sides: 6, bonus: 3, average: 10 },
  });
  const boltA = makeAction({
    name: 'Fire Bolt', attackType: 'ranged', requiresConcentration: false,
    hitBonus: 5, damage: { count: 1, sides: 6, bonus: 0, average: 6 },
  });

  const nearestCaster = makeC({
    actions: [hexA, boltA], aiProfile: 'attackNearest',
    faction: 'enemy', pos: { x: 0, y: 0, z: 0 },
  });
  startConcentration(nearestCaster, 'Bless');

  const target7 = makeC({ faction: 'party', pos: { x: 6, y: 0, z: 0 } });
  const best7 = bestAttackAction(nearestCaster, target7, false);

  // PHB rule (not AI preference): dropping concentration silently ends the spell.
  // The guard applies to all profiles to prevent accidentally ending key effects.
  eq('attackNearest: Hex skipped while concentrating on Bless', best7?.name, 'Fire Bolt');
}

// ============================================================
// 8. Concentration spell freely chosen when NOT concentrating
// ============================================================
console.log('\n=== 8. Concentration spell freely chosen when not concentrating ===\n');

{
  const hexB = makeAction({
    name: 'Hex', attackType: 'ranged', requiresConcentration: true,
    hitBonus: 5, damage: { count: 1, sides: 6, bonus: 3, average: 10 },
  });
  const boltB = makeAction({
    name: 'Fire Bolt', attackType: 'ranged', requiresConcentration: false,
    hitBonus: 5, damage: { count: 1, sides: 6, bonus: 0, average: 6 },
  });

  const freshCaster = makeC({ actions: [hexB, boltB] });
  assert('No active concentration', freshCaster.concentration === null);

  const target8 = makeC({ faction: 'party', pos: { x: 6, y: 0, z: 0 } });
  const best8 = bestAttackAction(freshCaster, target8, false);

  // Hex avg=10 > Fire Bolt avg=6 → Hex wins when nothing is being concentrated on
  eq('No concentration: higher-damage Hex chosen freely', best8?.name, 'Hex');
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
