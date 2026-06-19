// ============================================================
// Test: Frostbite Cantrip
// XGE p.156 — Level 0 evocation cantrip (CON save + one-shot weapon-attack disadv rider)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d6/3d6/4d6)
//   3. metadata exposes saveAbility = 'con' for AI/parser
//   4. metadata exposes components (V + S — no M)
//   5. metadata exposes riderAttackTypes = ['melee', 'ranged'] (weapon only)
//   6. applyCantripEffect (module) — sets _frostbiteDisadvNextWeaponAttack
//   7. dispatcher integration — 'Frostbite' registered in CANTRIP_EFFECTS
//   8. dispatcher safety — unknown cantrip name is a no-op
//   9. resetBudget cleanup clears the flag
//  10. resolveAttack save branch: rider applies ONLY on save-FAIL
//  11. resolveAttack save branch: save-SUCCESS applies NO rider
//  12. resolveAttack attack branch: disadv folded into WEAPON attack roll (melee)
//  13. resolveAttack attack branch: disadv folded into WEAPON attack roll (ranged)
//  14. resolveAttack attack branch: rider CONSUMED after one weapon attack (one-shot)
//  15. resolveAttack attack branch: SPELL attacks do NOT get disadv (control test)
//  16. resolveAttack attack branch: SPELL attacks do NOT consume the flag
//  17. Frostbite respects Total Cover (no bypassesCover flag)
//
// Run: npx ts-node src/test/frostbite.test.ts
// ============================================================

import { metadata, applyCantripEffect } from '../spells/frostbite';
import { applyCantripEffect as dispatchCantrip } from '../engine/cantrip_effects';
import { resetBudget } from '../engine/utils';
import { resolveAttack, CombatEvent } from '../engine/combat';
import { Combatant, Action, Vec3, Cell, Obstacle } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail: any = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10,
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

function makeBF(combatants: Combatant[], obstacles: Obstacle[] = []) {
  const width = 10, height = 10, depth = 1;
  const cells: Cell[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [];
      for (let z = 0; z < depth; z++) {
        cells[x][y][z] = { terrain: 'normal', elevation: 0 };
      }
    }
  }
  return {
    width, height, depth, cells,
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
    obstacles: obstacles.length ? obstacles : undefined,
  };
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// A Frostbite Action as the AI/parser would build it from metadata.
// Save-based: attackType='save', saveDC = caster's spell save DC, saveAbility='con'.
// Damage 1d6 cold. Range 60 ft. No bypassesCover flag.
const FROSTBITE_ACTION: Action = {
  name: 'Frostbite',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: { count: 1, sides: 6, bonus: 0, average: 3 },
  damageType: 'cold',
  saveDC: 13,
  saveAbility: 'con',
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Frostbite',
};

// Deterministic save-FAIL variant: DC=30 → save always fails.
const FROSTBITE_FAIL: Action = { ...FROSTBITE_ACTION, saveDC: 30 };
// Deterministic save-SUCCESS variant: DC=1 + con=30 (+10) → save always succeeds.
const FROSTBITE_SUCCESS: Action = { ...FROSTBITE_ACTION, saveDC: 1 };

// A simple MELEE weapon attack for testing the consume-on-attack behavior.
// High hitBonus + low AC guarantees the attack hits (so the roll resolves).
// Uses isCritOverride=true in the resolveAttack call to guarantee a hit
// (avoids the 5% nat-1 auto-miss rate; mirror Booming Blade test pattern).
const MELEE_ACTION: Action = {
  name: 'Longsword',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: null,
  hitBonus: 20,
  damage: { count: 1, sides: 8, bonus: 0, average: 4 },
  damageType: 'slashing',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Longsword',
};

// A simple RANGED weapon attack for the weapon-attack-only filter test.
const RANGED_ACTION: Action = {
  ...MELEE_ACTION,
  name: 'Shortbow',
  attackType: 'ranged',
  range: { normal: 80, long: 320 },
  damage: { count: 1, sides: 6, bonus: 0, average: 3 },
  damageType: 'piercing',
  description: 'Shortbow',
};

// A SPELL attack action (control test — Frostbite should NOT apply to spell attacks).
const SPELL_ATTACK_ACTION: Action = {
  ...MELEE_ACTION,
  name: 'Fire Bolt',
  attackType: 'spell',
  range: { normal: 120, long: 120 },
  damage: { count: 1, sides: 10, bonus: 0, average: 5 },
  damageType: 'fire',
  description: 'Fire Bolt',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Frostbite');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'evocation');
  eq('1d. rangeFt (60)', metadata.rangeFt, 60);
  eq('1e. damageDice', metadata.damageDice, '1d6');
  eq('1f. damageType = cold', metadata.damageType, 'cold');
  eq('1g. not concentration', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. scaling metadata
// ============================================================
console.log('\n--- 2. scaling metadata ---');
{
  eq('2a. scales flag', metadata.scales, true);
  eq('2b. scalingLevels length 3', metadata.scalingLevels.length, 3);
  eq('2c. scalingLevels[0] = 5', metadata.scalingLevels[0], 5);
  eq('2d. scalingLevels[1] = 11', metadata.scalingLevels[1], 11);
  eq('2e. scalingLevels[2] = 17', metadata.scalingLevels[2], 17);
  eq('2f. scalingDice[0] = 2d6', metadata.scalingDice[0], '2d6');
  eq('2g. scalingDice[1] = 3d6', metadata.scalingDice[1], '3d6');
  eq('2h. scalingDice[2] = 4d6', metadata.scalingDice[2], '4d6');
}

// ============================================================
// 3. save ability exposed for AI/parser
// ============================================================
console.log('\n--- 3. save ability ---');
{
  eq('3a. saveAbility = con', metadata.saveAbility, 'con');
}

// ============================================================
// 4. components: V + S (no M) — XGE p.156
// ============================================================
console.log('\n--- 4. components ---');
{
  eq('4a. verbal component', metadata.components.v, true);
  eq('4b. somatic component', metadata.components.s, true);
  eq('4c. no material component', metadata.components.m, false);
}

// ============================================================
// 5. metadata exposes riderAttackTypes = ['melee', 'ranged']
// ============================================================
console.log('\n--- 5. riderAttackTypes (weapon only) ---');
{
  eq('5a. riderAttackTypes has 2 entries', metadata.riderAttackTypes.length, 2);
  eq('5b. riderAttackTypes[0] = melee', metadata.riderAttackTypes[0], 'melee');
  eq('5c. riderAttackTypes[1] = ranged', metadata.riderAttackTypes[1], 'ranged');
  // Spell is NOT in the list — Frostbite's weapon-attack-only restriction.
  assert('5d. spell NOT in riderAttackTypes',
    !(metadata.riderAttackTypes as readonly string[]).includes('spell'));
}

// ============================================================
// 6. applyCantripEffect (module) — sets _frostbiteDisadvNextWeaponAttack
// ============================================================
console.log('\n--- 6. applyCantripEffect: sets flag ---');
{
  const caster = makeCombatant('druid');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  eq('6a. flag undefined before', target._frostbiteDisadvNextWeaponAttack, undefined);

  const ret = applyCantripEffect(caster, target, state);
  eq('6b. returns true', ret, true);
  eq('6c. flag set to true', target._frostbiteDisadvNextWeaponAttack, true);

  const logEntry = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Frostbite'),
  );
  assert('6d. rider logged', logEntry !== undefined, 'expected a log event mentioning Frostbite');
  assert('6e. log mentions disadvantage', logEntry?.description.includes('disadvantage') === true, true);
  assert('6f. log mentions WEAPON', logEntry?.description.includes('WEAPON') === true, true);
}

// ============================================================
// 7. dispatcher integration — 'Frostbite' registered in CANTRIP_EFFECTS
// ============================================================
console.log('\n--- 7. dispatcher integration ---');
{
  const caster = makeCombatant('druid');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Frostbite', state);

  eq('7a. dispatcher set flag', target._frostbiteDisadvNextWeaponAttack, true);
  const logHit = state.log.events.find((e: CombatEvent) => e.description.includes('Frostbite'));
  assert('7b. dispatcher emitted Frostbite log', logHit !== undefined);
}

// ============================================================
// 8. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 8. dispatcher safety ---');
{
  const caster = makeCombatant('druid');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('8a. unknown cantrip → no flag', target._frostbiteDisadvNextWeaponAttack, undefined);
  eq('8b. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 9. resetBudget cleanup clears the flag
// ============================================================
console.log('\n--- 9. resetBudget cleanup ---');
{
  const caster = makeCombatant('druid');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  applyCantripEffect(caster, target, state);
  eq('9a. flag set', target._frostbiteDisadvNextWeaponAttack, true);

  // Start of target's next turn — resetBudget clears the rider if not consumed
  resetBudget(target);
  eq('9b. flag cleared by resetBudget', target._frostbiteDisadvNextWeaponAttack, undefined);
}
{
  // If the flag was already consumed (set to false), resetBudget still clears it.
  const target = makeCombatant('goblin', { _frostbiteDisadvNextWeaponAttack: false });
  resetBudget(target);
  eq('9c. flag=false also cleared by resetBudget', target._frostbiteDisadvNextWeaponAttack, undefined);
}

// ============================================================
// 10. resolveAttack save branch: rider applies ONLY on save-FAIL
// ============================================================
console.log('\n--- 10. save FAIL → rider applies ---');
{
  // DC=30 → guaranteed save FAIL → rider should be applied.
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    con: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, FROSTBITE_FAIL, state);

  eq('10a. flag set after save FAIL', target._frostbiteDisadvNextWeaponAttack, true);

  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  assert('10b. save_fail event logged', saveFail !== undefined);

  // Verify cold damage was dealt (1d6 = 1..6)
  const dmgEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('cold'),
  );
  assert('10c. cold damage logged', dmgEvent !== undefined);
  if (dmgEvent) {
    assert('10d. cold damage in 1..6 range', dmgEvent.value! >= 1 && dmgEvent.value! <= 6,
      `got ${dmgEvent.value}`);
  }
}

// ============================================================
// 11. resolveAttack save branch: save-SUCCESS applies NO rider
// ============================================================
console.log('\n--- 11. save SUCCESS → NO rider ---');
{
  // DC=1 + con=30 (+10) → guaranteed save SUCCESS → no rider.
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    con: 30,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, FROSTBITE_SUCCESS, state);

  eq('11a. flag NOT set after save SUCCESS', target._frostbiteDisadvNextWeaponAttack, undefined);

  const saveSuccess = state.log.events.find((e: CombatEvent) => e.type === 'save_success');
  assert('11b. save_success event logged', saveSuccess !== undefined);
}

// ============================================================
// 12. resolveAttack attack branch: disadv folded into WEAPON attack roll (melee)
// ============================================================
console.log('\n--- 12. weapon (melee) attack: disadv folded ---');
{
  // Target was debuffed by Frostbite, now attacks the caster with a melee weapon.
  // Verify: (a) disadv log mentions Frostbite, (b) flag consumed after the attack.
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 },
    _frostbiteDisadvNextWeaponAttack: true,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  // Force a hit with isCritOverride=true to avoid nat-1 flakiness
  resolveAttack(target, caster, MELEE_ACTION, state, true);

  const frostbiteLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Frostbite'),
  );
  assert('12a. disadv log mentions Frostbite', frostbiteLog !== undefined);

  // One-shot consume: flag cleared after the attack resolves (hit or miss).
  eq('12b. flag consumed (false) after melee attack', target._frostbiteDisadvNextWeaponAttack, false);

  const consumeLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'condition_remove' && e.description.includes('Frostbite'),
  );
  assert('12c. consume log mentions Frostbite', consumeLog !== undefined);
}

// ============================================================
// 13. resolveAttack attack branch: disadv folded into WEAPON attack roll (ranged)
// ============================================================
console.log('\n--- 13. weapon (ranged) attack: disadv folded ---');
{
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 5, y: 0, z: 0 }, // 25 ft away — within shortbow's normal range
    _frostbiteDisadvNextWeaponAttack: true,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(target, caster, RANGED_ACTION, state, true);

  const frostbiteLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Frostbite'),
  );
  assert('13a. disadv log mentions Frostbite (ranged)', frostbiteLog !== undefined);
  eq('13b. flag consumed (false) after ranged attack', target._frostbiteDisadvNextWeaponAttack, false);
}

// ============================================================
// 14. resolveAttack attack branch: rider CONSUMED after one weapon attack (one-shot)
// ============================================================
console.log('\n--- 14. one-shot: second attack has NO disadv ---');
{
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 },
    _frostbiteDisadvNextWeaponAttack: true,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  // First attack — consumes the flag.
  resolveAttack(target, caster, MELEE_ACTION, state, true);
  eq('14a. flag consumed after first attack', target._frostbiteDisadvNextWeaponAttack, false);

  // Count of Frostbite disadv logs so far
  const frostbiteLogsAfter1 = state.log.events.filter(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Frostbite'),
  ).length;

  // Second attack — should NOT have Frostbite disadv (flag is consumed).
  resolveAttack(target, caster, MELEE_ACTION, state, true);
  const frostbiteLogsAfter2 = state.log.events.filter(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Frostbite'),
  ).length;

  eq('14b. no new Frostbite disadv log on second attack', frostbiteLogsAfter2, frostbiteLogsAfter1);
}

// ============================================================
// 15. resolveAttack attack branch: SPELL attacks do NOT get disadv (control test)
// ============================================================
console.log('\n--- 15. SPELL attack: NO disadv (control test) ---');
{
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    _frostbiteDisadvNextWeaponAttack: true, // flag is set
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  // Cast a spell attack — Frostbite should NOT apply (weapon-attacks-only).
  resolveAttack(target, caster, SPELL_ATTACK_ACTION, state, true);

  const frostbiteLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Frostbite'),
  );
  assert('15a. NO Frostbite disadv log on spell attack', frostbiteLog === undefined,
    `unexpected log: ${JSON.stringify(frostbiteLog)}`);
}

// ============================================================
// 16. resolveAttack attack branch: SPELL attacks do NOT consume the flag
// ============================================================
console.log('\n--- 16. SPELL attack: does NOT consume the flag ---');
{
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    _frostbiteDisadvNextWeaponAttack: true, // flag is set
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  // Cast a spell attack — flag should remain SET (not consumed).
  resolveAttack(target, caster, SPELL_ATTACK_ACTION, state, true);

  eq('16a. flag STILL set after spell attack', target._frostbiteDisadvNextWeaponAttack, true);

  // Now do a weapon attack — should still get disadv + consume the flag.
  resolveAttack(target, caster, MELEE_ACTION, state, true);
  eq('16b. flag consumed after subsequent weapon attack', target._frostbiteDisadvNextWeaponAttack, false);

  const frostbiteLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Frostbite'),
  );
  assert('16c. Frostbite disadv DID apply on the weapon attack (after spell attack left flag intact)',
    frostbiteLog !== undefined);
}

// ============================================================
// 17. Frostbite respects Total Cover (no bypassesCover flag)
// ============================================================
console.log('\n--- 17. Total Cover blocks Frostbite ---');
{
  // Wall between caster (0,0) and target (6,0): x=3, y=-1..9, 1 square wide → Total Cover.
  // Frostbite has no bypassesCover flag → blocked by Total Cover (mirror non-bypassing
  // save spells like Acid Splash / Poison Spray / Vicious Mockery).
  const wall: Obstacle = {
    id: 'wall', x: 3, y: -1, z: 0,
    width: 1, depth: 10, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 6, y: 0, z: 0 },
    con: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target], [wall]);
  const state = makeState(bf);

  resolveAttack(caster, target, FROSTBITE_FAIL, state);

  const blockedLog = state.log.events.find(
    (e: CombatEvent) => e.description.includes('Total Cover'),
  );
  assert('17a. Total Cover blocks Frostbite', blockedLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);

  // No save rolled, no damage, no rider.
  eq('17b. flag NOT set (blocked by cover)', target._frostbiteDisadvNextWeaponAttack, undefined);
  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  assert('17c. no save_fail event (spell blocked)', saveFail === undefined);
}

// ============================================================
// Summary
// ============================================================
console.log(`\n=== Frostbite test: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
