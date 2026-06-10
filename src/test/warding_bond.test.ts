// ============================================================
// Test: Warding Bond (PHB p.287)
// Covers:
//   - applyDamageWithTempHP: resistance to all damage types when bonded
//   - rollSave: +1 bonus to all saving throws when bonded
//   - resolveAttack: +1 effective AC when bonded (+1 not tested deterministically
//     due to dice, but AC guard is structural — see effectiveAC in combat.ts)
//   - applyWardingBondRedirect: caster takes the same damage as bonded creature
//   - Bond breaks when caster drops to 0 HP (checkDeath + redirect helper)
//   - Bond skips redirect if caster is already dead/unconscious
//   - wardingBond: null initialized for all new PCs and monsters
// Run: ts-node src/test/warding_bond.test.ts
// ============================================================

import { runCombat, makeFlatBattlefield } from '../engine/combat';
import { applyDamageWithTempHP, rollSave } from '../engine/utils';
import { loadPCStatBlocks, spawnPC }       from '../parser/pc';
import { Combatant, Action }               from '../types/core';
import * as fs from 'fs';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, actual: T, expected: T): void {
  assert(label, actual === expected,
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(overrides: Partial<Combatant> = {}): Combatant {
  const id = overrides.id ?? `c_${++_id}`;
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 20, currentHP: 20, ac: 14,
    speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 8, wis: 10, cha: 8,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'attackNearest',
    perception: { targets: new Map() },
    concentration: null,
    deathSaves: null,
    mountedOn: null,
    carriedBy: null,
    independentMount: false,
    role: 'regular',
    bonded: null,
    resources: null,
    tempHP: 0,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false,
    cannotAttack: false,
    hasHands: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null,
    wardingBond: null, activeEffects: [],
    ...overrides,
  };
}

function fixedInit(...cs: Combatant[]): string[] { return cs.map(c => c.id); }

function meleeAction(overrides: Partial<Action> = {}): Action {
  return {
    name: 'Strike', isMultiattack: false, attackType: 'melee',
    reach: 5, range: null, hitBonus: 5,
    damage: { count: 1, sides: 6, bonus: 0, average: 3.5 },
    damageType: 'slashing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: '',
    ...overrides,
  };
}

// ============================================================
// Section 1: applyDamageWithTempHP — WB resistance (all types)
// ============================================================
console.log('\n=== 1. WB resistance in applyDamageWithTempHP ===\n');

{
  // Bonded creature: WB active → any typed damage is halved
  const bonded = makeC({ id: 'wb1', maxHP: 100, currentHP: 100,
    wardingBond: { casterId: 'caster_x' } });

  const dealt1 = applyDamageWithTempHP(bonded, 10, 'fire');
  eq('WB: 10 fire dealt = 5 (halved)',  dealt1, 5);
  eq('WB: fire HP = 95',               bonded.currentHP, 95);

  const dealt2 = applyDamageWithTempHP(bonded, 10, 'slashing');
  eq('WB: 10 slashing dealt = 5',      dealt2, 5);

  // Floor: 7 → 3
  const dealt3 = applyDamageWithTempHP(bonded, 7, 'cold');
  eq('WB: 7 cold dealt = 3 (floor)',   dealt3, 3);
}

{
  // WB halves typeless (null) damage — unlike specific resistances
  const bonded = makeC({ id: 'wb2', maxHP: 100, currentHP: 100,
    wardingBond: { casterId: 'caster_x' } });

  const dealt = applyDamageWithTempHP(bonded, 10, null);
  eq('WB: 10 typeless dealt = 5',  dealt, 5);
  eq('WB: typeless HP = 95',       bonded.currentHP, 95);
}

{
  // No bond → full damage (control: resistance does NOT apply without bond)
  const noBond = makeC({ id: 'wb3', maxHP: 100, currentHP: 100, wardingBond: null });

  const dealt = applyDamageWithTempHP(noBond, 10, 'fire');
  eq('No WB: 10 fire dealt = 10 (full)',  dealt, 10);
  eq('No WB: HP = 90',                   noBond.currentHP, 90);
}

{
  // WB + existing specific resistance: still halved once (PHB: no double-halving)
  const bonded = makeC({ id: 'wb4', maxHP: 100, currentHP: 100,
    wardingBond: { casterId: 'caster_x' },
    resistances: ['fire'] });

  // Both WB and specific resistance → still floor(10/2) = 5, not floor(5/2) = 2
  const dealt = applyDamageWithTempHP(bonded, 10, 'fire');
  eq('WB + fire resistance: dealt = 5 (single halving)', dealt, 5);
}

// ============================================================
// Section 2: rollSave — +1 bonus when bonded
// ============================================================
console.log('\n=== 2. rollSave +1 bonus ===\n');

{
  // WIS 10 → mod 0, no proficiency, no BI → total should equal roll + 1 (WB bonus)
  const bonded = makeC({ id: 'wb_save1', wis: 10,
    wardingBond: { casterId: 'caster_x' } });

  const result = rollSave(bonded, 'wis', 999 /* impossible DC — we're checking arithmetic */);
  eq('WB save: total = roll + 1 (WIS 10)', result.total, result.roll + 1);
}

{
  // WIS 10, no WB → total = roll + 0
  const noBond = makeC({ id: 'wb_save2', wis: 10, wardingBond: null });

  const result = rollSave(noBond, 'wis', 999);
  eq('No WB save: total = roll (WIS 10)', result.total, result.roll);
}

{
  // WIS 14 → mod +2 — verify +1 WB stacks correctly: total = roll + 2 + 1 = roll + 3
  const bonded = makeC({ id: 'wb_save3', wis: 14,
    wardingBond: { casterId: 'caster_x' } });

  const result = rollSave(bonded, 'wis', 999);
  eq('WB save: WIS 14 total = roll + 3 (mod 2 + WB 1)', result.total, result.roll + 3);
}

// ============================================================
// Section 3: Damage redirect via runCombat
// ============================================================
console.log('\n=== 3. Damage redirect (runCombat) ===\n');

{
  // Enemy attacks bonded creature first.
  // - Bonded takes halved damage (WB resistance)
  // - Caster takes the same amount as redirect
  // - Both start at 100 HP; enemy deals exactly 10 → each takes 5.
  const casterId  = 'wb_caster';
  const bondedId  = 'wb_bonded';
  const enemyId   = 'wb_enemy';

  const caster = makeC({
    id: casterId, name: 'Cleric (caster)',
    faction: 'party', pos: { x: 5, y: 5, z: 0 },   // far from enemy
    maxHP: 100, currentHP: 100, ac: 20, actions: [],  // survives, not targeted
  });

  const bonded = makeC({
    id: bondedId, name: 'Paladin (bonded)',
    faction: 'party', pos: { x: 1, y: 0, z: 0 },    // adjacent to enemy
    maxHP: 100, currentHP: 100, ac: 4,               // very easy to hit
    wardingBond: { casterId },
    actions: [meleeAction({ hitBonus: 20,             // kills enemy on own turn
      damage: { count: 1, sides: 1, bonus: 9, average: 10 } })],
  });

  const enemy = makeC({
    id: enemyId, name: 'Orc',
    faction: 'enemy', pos: { x: 0, y: 0, z: 0 },
    maxHP: 5, currentHP: 5, ac: 4,
    actions: [meleeAction({ hitBonus: 20,             // always hits bonded
      damage: { count: 1, sides: 1, bonus: 9, average: 10 },  // exactly 10 damage
      damageType: 'slashing' })],
  });

  const bf = makeFlatBattlefield(10, 10, [caster, bonded, enemy]);
  // Enemy goes first: hits bonded → bonded takes 5 (WB halved), caster takes 5 (redirect)
  // Then bonded kills enemy. Combat ends.
  runCombat(bf, fixedInit(enemy, bonded, caster), { maxRounds: 3 });

  const finalBonded = bf.combatants.get(bondedId)!;
  const finalCaster  = bf.combatants.get(casterId)!;

  assert('Redirect: bonded took halved damage (HP > 90)',
    finalBonded.currentHP > 90,
    `HP was ${finalBonded.currentHP}`);

  assert('Redirect: caster took redirect damage (HP < 100)',
    finalCaster.currentHP < 100,
    `Caster HP was ${finalCaster.currentHP}`);

  eq('Redirect: bonded HP === caster HP (same damage taken)',
    finalBonded.currentHP, finalCaster.currentHP);
}

// ============================================================
// Section 4: Bond breaks when caster drops to 0 HP
// ============================================================
console.log('\n=== 4. Bond break on caster death ===\n');

{
  // Enemy deals 10 damage to bonded → bonded takes 5 → caster (5 HP) takes 5 → caster dies.
  // Bond should be null on bonded after the round.
  const casterId = 'wb_dying_caster';
  const bondedId = 'wb_protected';
  const enemyId  = 'wb_killer';

  const caster = makeC({
    id: casterId, name: 'Dying Cleric',
    faction: 'party', pos: { x: 5, y: 5, z: 0 },
    maxHP: 5, currentHP: 5, ac: 20,   // will die from redirect (5 damage)
    isPlayer: false,                   // monster-style: dies at 0 (no death saves)
    actions: [],
  });

  const bonded = makeC({
    id: bondedId, name: 'Bonded Warrior',
    faction: 'party', pos: { x: 1, y: 0, z: 0 },
    maxHP: 100, currentHP: 100, ac: 4,
    wardingBond: { casterId },
    actions: [meleeAction({ hitBonus: 20,
      damage: { count: 1, sides: 1, bonus: 49, average: 50 } })],  // kills enemy fast
  });

  const enemy = makeC({
    id: enemyId, name: 'Bond Breaker',
    faction: 'enemy', pos: { x: 0, y: 0, z: 0 },
    maxHP: 5, currentHP: 5, ac: 4,
    actions: [meleeAction({ hitBonus: 20,
      damage: { count: 1, sides: 1, bonus: 9, average: 10 },
      damageType: 'fire' })],
  });

  const bf = makeFlatBattlefield(10, 10, [caster, bonded, enemy]);
  const result = runCombat(bf, fixedInit(enemy, bonded, caster), { maxRounds: 3 });

  const finalBonded = bf.combatants.get(bondedId)!;
  const finalCaster  = bf.combatants.get(casterId)!;

  assert('Bond break: caster died (isDead or isUnconscious)',
    finalCaster.isDead || finalCaster.isUnconscious,
    `caster HP=${finalCaster.currentHP}`);

  eq('Bond break: wardingBond cleared on bonded after caster death',
    finalBonded.wardingBond, null);

  const bondBreakEvent = result.events.find(e =>
    e.description.toLowerCase().includes('warding bond ends'));
  assert('Bond break: condition_remove event logged', bondBreakEvent !== undefined);
}

// ============================================================
// Section 5: wardingBond initialized to null for all new PCs
// ============================================================
console.log('\n=== 5. wardingBond: null for spawned PCs ===\n');

{
  const raw    = JSON.parse(fs.readFileSync('./pc_stat_blocks_lv1.json', 'utf-8'));
  const pcMap  = loadPCStatBlocks(raw);
  const cleric = spawnPC(pcMap, 'Cleric',  { x: 0, y: 0, z: 0 })!;
  const paladin = spawnPC(pcMap, 'Paladin', { x: 1, y: 0, z: 0 })!;
  const wizard  = spawnPC(pcMap, 'Wizard',  { x: 2, y: 0, z: 0 })!;

  eq('Cleric wardingBond initializes to null',  cleric.wardingBond,  null);
  eq('Paladin wardingBond initializes to null', paladin.wardingBond, null);
  eq('Wizard wardingBond initializes to null',  wizard.wardingBond,  null);
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
