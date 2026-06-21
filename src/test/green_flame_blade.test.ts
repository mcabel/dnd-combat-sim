// ============================================================
// Test: Green-Flame Blade Cantrip
// TCE p.107 — Level 0 evocation cantrip (melee spell attack + fire splash to 2nd creature)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (on-hit: flat 1d8 v1 simplification)
//   3. metadata exposes splash scaling (mod → 1d8+mod → 2d8+mod → 3d8+mod)
//   4. metadata exposes components (S + M, no V)
//   5. metadata exposes splashRangeF = 5
//   6. applyCantripEffect (module) — splash to nearest enemy within 5 ft of primary
//   7. applyCantripEffect — NO splash if no secondary target in range
//   8. splash damage type = fire (verify log)
//   9. on-hit damage type = fire (v1 simplification — verify resolveAttack deals fire)
//  10. dispatcher integration — 'Green-Flame Blade' registered in CANTRIP_EFFECTS
//  11. dispatcher safety — unknown cantrip name is a no-op
//  12. cleanup() is a no-op (splash is instant, no scratch fields)
//  13. resolveAttack HIT → on-hit fire damage (1..8) + splash to 2nd creature
//  14. resolveAttack MISS → NO on-hit damage, NO splash
//  15. splash damage at level 1 = spellcasting_mod (default 3, min 1)
//  16. splash damage at level 5 = 1d8 + mod (4..11)
//  17. splash damage at level 11 = 2d8 + mod (5..19)
//  18. splash damage at level 17 = 3d8 + mod (6..27)
//  19. findSplashTarget — nearest enemy within 5 ft of primary (not caster, not primary)
//  20. findSplashTarget — allies excluded (v1 — only enemies are valid splash targets)
//  21. findSplashTarget — returns null if no enemy in range
//  22. rollSplashDamage helper — levels 1/5/11/17 dice counts
//  23. Green-Flame Blade respects Total Cover on the initial attack
//
// Run: npx ts-node src/test/green_flame_blade.test.ts
// ============================================================

import {
  metadata,
  applyCantripEffect,
  findSplashTarget,
  rollSplashDamage,
  cleanup,
  GREEN_FLAME_BLADE_REACH_FT,
  GREEN_FLAME_BLADE_SPLASH_RANGE_FT,
  DEFAULT_SPELLCASTING_MOD,
} from '../spells/green_flame_blade';
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

// A Green-Flame Blade Action as the AI/parser would build it from metadata.
// Melee spell attack: attackType='spell', reach=5. Damage 1d8 fire (v1 simplification).
const GREEN_FLAME_BLADE_ACTION: Action = {
  name: 'Green-Flame Blade',
  isMultiattack: false,
  attackType: 'spell',
  reach: 5,
  range: null,
  hitBonus: 20, // +20 → always hits AC 10
  damage: { count: 1, sides: 8, bonus: 0, average: 4 },
  damageType: 'fire',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Green-Flame Blade',
};

// Guaranteed-miss variant.
const GREEN_FLAME_BLADE_MISS: Action = { ...GREEN_FLAME_BLADE_ACTION, hitBonus: -100 };

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Green-Flame Blade');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'evocation');
  eq('1d. rangeFt (5 — melee reach)', metadata.rangeFt, 5);
  eq('1e. damageDice', metadata.damageDice, '1d8');
  eq('1f. damageType = fire', metadata.damageType, 'fire');
  eq('1g. not concentration', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. scaling metadata (on-hit fire, v1 flat 1d8)
// ============================================================
console.log('\n--- 2. scaling metadata (on-hit) ---');
{
  eq('2a. scales flag', metadata.scales, true);
  eq('2b. scalingLevels length 3', metadata.scalingLevels.length, 3);
  eq('2c. scalingLevels[0] = 5', metadata.scalingLevels[0], 5);
  eq('2d. scalingLevels[1] = 11', metadata.scalingLevels[1], 11);
  eq('2e. scalingLevels[2] = 17', metadata.scalingLevels[2], 17);
  // v1 simplification: on-hit fire flat 1d8 at all levels.
  eq('2f. scalingDice[0] = 1d8 (v1 flat)', metadata.scalingDice[0], '1d8');
  eq('2g. scalingDice[2] = 1d8 (v1 flat)', metadata.scalingDice[2], '1d8');
}

// ============================================================
// 3. metadata exposes splash scaling (mod → 1d8+mod → 2d8+mod → 3d8+mod)
// ============================================================
console.log('\n--- 3. splash scaling metadata ---');
{
  eq('3a. scalingDiceSplash[0] = mod (level 1)', metadata.scalingDiceSplash[0], 'mod');
  eq('3b. scalingDiceSplash[1] = 1d8+mod (level 5)', metadata.scalingDiceSplash[1], '1d8+mod');
  eq('3c. scalingDiceSplash[2] = 2d8+mod (level 11)', metadata.scalingDiceSplash[2], '2d8+mod');
  eq('3d. scalingDiceSplash[3] = 3d8+mod (level 17)', metadata.scalingDiceSplash[3], '3d8+mod');
  eq('3e. splashDamageByLevel[1] = mod', metadata.splashDamageByLevel[1], 'mod');
  eq('3f. splashDamageByLevel[5] = 1d8+mod', metadata.splashDamageByLevel[5], '1d8+mod');
  eq('3g. splashDamageByLevel[11] = 2d8+mod', metadata.splashDamageByLevel[11], '2d8+mod');
  eq('3h. splashDamageByLevel[17] = 3d8+mod', metadata.splashDamageByLevel[17], '3d8+mod');
}

// ============================================================
// 4. components: S + M (no V) — TCE p.107
// ============================================================
console.log('\n--- 4. components ---');
{
  eq('4a. no verbal component', metadata.components.v, false);
  eq('4b. somatic component', metadata.components.s, true);
  eq('4c. material component (melee weapon ≥1 sp)', metadata.components.m, true);
}

// ============================================================
// 5. metadata exposes splashRangeFt = 5
// ============================================================
console.log('\n--- 5. splashRangeFt ---');
{
  eq('5a. splashRangeFt = 5', metadata.splashRangeFt, 5);
  eq('5b. GREEN_FLAME_BLADE_SPLASH_RANGE_FT const = 5', GREEN_FLAME_BLADE_SPLASH_RANGE_FT, 5);
  eq('5c. GREEN_FLAME_BLADE_REACH_FT const = 5', GREEN_FLAME_BLADE_REACH_FT, 5);
  eq('5d. DEFAULT_SPELLCASTING_MOD const = 3', DEFAULT_SPELLCASTING_MOD, 3);
}

// ============================================================
// 6. applyCantripEffect (module) — splash to nearest enemy within 5 ft of primary
// ============================================================
console.log('\n--- 6. applyCantripEffect: splash to 2nd creature ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    spellcastingMod: 3, // custom field — set directly in tests
  });
  const primary = makeCombatant('goblin1', {
    pos: { x: 1, y: 0, z: 0 }, // 5 ft from caster (adjacent — within reach)
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const secondary = makeCombatant('goblin2', {
    pos: { x: 2, y: 0, z: 0 }, // 5 ft from primary (within splash range)
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([caster, primary, secondary]);
  const state = makeState(bf);

  const ret = applyCantripEffect(caster, primary, state);
  eq('6a. returns true', ret, true);

  // Splash target should have taken fire damage (3 = spellcasting_mod at level 1).
  assert('6b. secondary took splash damage', secondary.currentHP < 100, true);
  const damageTaken = 100 - secondary.currentHP;
  // Level 1 splash = mod (3). Test setup uses default level 1.
  eq('6c. splash damage = spellcasting_mod (3) at level 1', damageTaken, 3);

  const dmgEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('Green-Flame Blade'),
  );
  assert('6d. splash damage event logged', dmgEvent !== undefined);
  assert('6e. splash mentions secondary target', dmgEvent?.description.includes('goblin2') === true, true);
}

// ============================================================
// 7. applyCantripEffect — NO splash if no secondary target in range
// ============================================================
console.log('\n--- 7. no secondary target in range ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    spellcastingMod: 3,
  });
  const primary = makeCombatant('goblin1', {
    pos: { x: 1, y: 0, z: 0 },
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  // No secondary target — nearest enemy is far away.
  const farEnemy = makeCombatant('far', {
    pos: { x: 5, y: 0, z: 0 }, // 20 ft from primary
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([caster, primary, farEnemy]);
  const state = makeState(bf);

  const ret = applyCantripEffect(caster, primary, state);
  eq('7a. returns true (rider ran, just no target)', ret, true);

  // Far enemy should NOT have taken damage.
  eq('7b. far enemy HP unchanged', farEnemy.currentHP, 100);

  const noTargetLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('no secondary creature'),
  );
  assert('7c. "no secondary" log emitted', noTargetLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 8. splash damage type = fire (verify log)
// ============================================================
console.log('\n--- 8. splash damage type = fire ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    spellcastingMod: 3,
  });
  const primary = makeCombatant('goblin1', {
    pos: { x: 1, y: 0, z: 0 },
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const secondary = makeCombatant('goblin2', {
    pos: { x: 2, y: 0, z: 0 },
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, primary, secondary]);
  const state = makeState(bf);

  applyCantripEffect(caster, primary, state);

  const dmgEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('fire'),
  );
  assert('8a. splash damage log mentions fire', dmgEvent !== undefined);
}

// ============================================================
// 9. on-hit damage type = fire (v1 simplification — verify resolveAttack deals fire)
// ============================================================
console.log('\n--- 9. on-hit damage type = fire ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    spellcastingMod: 3,
  });
  const primary = makeCombatant('goblin1', {
    pos: { x: 1, y: 0, z: 0 },
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, primary]);
  const state = makeState(bf);

  // Force a hit with isCritOverride=true to avoid nat-1 flakiness
  resolveAttack(caster, primary, GREEN_FLAME_BLADE_ACTION, state, true);

  const onHitDmg = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('fire')
      && !e.description.includes('Green-Flame Blade'),
  );
  assert('9a. on-hit fire damage logged', onHitDmg !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  if (onHitDmg) {
    // 1d8 fire = 1..8 (or 2..16 on crit, but isCritOverride=true forces crit — let's check both).
    // Actually isCritOverride=true forces a crit → 2d8 = 2..16. Adjust the range.
    assert('9b. on-hit damage in 2..16 range (2d8 crit, forced)',
      onHitDmg.value! >= 2 && onHitDmg.value! <= 16, `got ${onHitDmg.value}`);
  }
}

// ============================================================
// 10. dispatcher integration — 'Green-Flame Blade' registered in CANTRIP_EFFECTS
// ============================================================
console.log('\n--- 10. dispatcher integration ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    spellcastingMod: 3,
  });
  const primary = makeCombatant('goblin1', {
    pos: { x: 1, y: 0, z: 0 },
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const secondary = makeCombatant('goblin2', {
    pos: { x: 2, y: 0, z: 0 },
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, primary, secondary]);
  const state = makeState(bf);

  dispatchCantrip(caster, primary, 'Green-Flame Blade', state);

  assert('10a. dispatcher applied splash damage', secondary.currentHP < 100, true);
  const logHit = state.log.events.find((e: CombatEvent) => e.description.includes('Green-Flame Blade'));
  assert('10b. dispatcher emitted Green-Flame Blade log', logHit !== undefined);
}

// ============================================================
// 11. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 11. dispatcher safety ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('11a. unknown cantrip → no log events', state.log.events.length, 0);
  eq('11b. unknown cantrip → target HP unchanged', target.currentHP, 40);
}

// ============================================================
// 12. cleanup() is a no-op (splash is instant, no scratch fields)
// ============================================================
console.log('\n--- 12. cleanup is a no-op ---');
{
  const target = makeCombatant('goblin');
  cleanup(target); // should not throw
  eq('12a. cleanup does not change HP', target.currentHP, 40);
}

// ============================================================
// 13. resolveAttack HIT → on-hit fire damage (1..8) + splash to 2nd creature
// ============================================================
console.log('\n--- 13. resolveAttack HIT → on-hit + splash ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    spellcastingMod: 3,
  });
  const primary = makeCombatant('goblin1', {
    pos: { x: 1, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const secondary = makeCombatant('goblin2', {
    pos: { x: 2, y: 0, z: 0 },
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, primary, secondary]);
  const state = makeState(bf);

  // Force a hit with isCritOverride=true (crit doubles on-hit dice to 2d8=2..16)
  resolveAttack(caster, primary, GREEN_FLAME_BLADE_ACTION, state, true);

  // On-hit damage to primary: 2d8 fire (crit) = 2..16
  const primaryDamage = 100 - primary.currentHP;
  assert('13a. primary took on-hit damage (2..16, crit 2d8)',
    primaryDamage >= 2 && primaryDamage <= 16, `got ${primaryDamage}`);

  // Splash damage to secondary: 3 (mod at level 1)
  const secondaryDamage = 100 - secondary.currentHP;
  eq('13b. secondary took splash damage (3, level-1 mod)', secondaryDamage, 3);

  // Caster took no damage.
  eq('13c. caster HP unchanged', caster.currentHP, 40);
}

// ============================================================
// 14. resolveAttack MISS → NO on-hit damage, NO splash
// ============================================================
console.log('\n--- 14. resolveAttack MISS → no on-hit, no splash ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    spellcastingMod: 3,
  });
  const primary = makeCombatant('goblin1', {
    pos: { x: 1, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const secondary = makeCombatant('goblin2', {
    pos: { x: 2, y: 0, z: 0 },
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, primary, secondary]);
  const state = makeState(bf);

  // Force a miss with isCritOverride=false
  resolveAttack(caster, primary, GREEN_FLAME_BLADE_MISS, state, false);

  eq('14a. primary HP unchanged (miss)', primary.currentHP, 100);
  eq('14b. secondary HP unchanged (no splash on miss)', secondary.currentHP, 100);

  const missLog = state.log.events.find((e: CombatEvent) => e.type === 'attack_miss');
  assert('14c. attack_miss logged', missLog !== undefined);
}

// ============================================================
// 15. splash damage at level 1 = spellcasting_mod (default 3, min 1)
// ============================================================
console.log('\n--- 15. splash damage at level 1 = mod ---');
{
  // Run multiple iterations to verify the damage is exactly the mod (no dice at level 1).
  for (let i = 0; i < 10; i++) {
    const splash = rollSplashDamage(1, 3);
    eq(`15.${i}. level 1 splash = mod (3)`, splash.roll, 3);
    eq(`15.${i}b. level 1 diceCount = 0`, splash.diceCount, 0);
  }
}
{
  // Min-1 rule: mod = -2 → splash clamped to 1.
  const splash = rollSplashDamage(1, -2);
  eq('15c. min-1 rule: negative mod clamps to 1', splash.roll, 1);
}
{
  // mod = 0 → clamped to 1.
  const splash = rollSplashDamage(1, 0);
  eq('15d. min-1 rule: zero mod clamps to 1', splash.roll, 1);
}

// ============================================================
// 16. splash damage at level 5 = 1d8 + mod (4..11)
// ============================================================
console.log('\n--- 16. splash damage at level 5 = 1d8 + mod ---');
{
  for (let i = 0; i < 20; i++) {
    const splash = rollSplashDamage(5, 3);
    eq(`16.${i}. level 5 diceCount = 1`, splash.diceCount, 1);
    assert(`16.${i}b. level 5 splash in 4..11 range (1d8 + 3)`,
      splash.roll >= 4 && splash.roll <= 11, `got ${splash.roll}`);
    if (splash.roll < 4 || splash.roll > 11) break;
  }
}

// ============================================================
// 17. splash damage at level 11 = 2d8 + mod (5..19)
// ============================================================
console.log('\n--- 17. splash damage at level 11 = 2d8 + mod ---');
{
  for (let i = 0; i < 20; i++) {
    const splash = rollSplashDamage(11, 3);
    eq(`17.${i}. level 11 diceCount = 2`, splash.diceCount, 2);
    assert(`17.${i}b. level 11 splash in 5..19 range (2d8 + 3)`,
      splash.roll >= 5 && splash.roll <= 19, `got ${splash.roll}`);
    if (splash.roll < 5 || splash.roll > 19) break;
  }
}

// ============================================================
// 18. splash damage at level 17 = 3d8 + mod (6..27)
// ============================================================
console.log('\n--- 18. splash damage at level 17 = 3d8 + mod ---');
{
  for (let i = 0; i < 20; i++) {
    const splash = rollSplashDamage(17, 3);
    eq(`18.${i}. level 17 diceCount = 3`, splash.diceCount, 3);
    assert(`18.${i}b. level 17 splash in 6..27 range (3d8 + 3)`,
      splash.roll >= 6 && splash.roll <= 27, `got ${splash.roll}`);
    if (splash.roll < 6 || splash.roll > 27) break;
  }
}

// ============================================================
// 19. findSplashTarget — nearest enemy within 5 ft of primary (not caster, not primary)
// ============================================================
console.log('\n--- 19. findSplashTarget — nearest enemy ---');
{
  const caster = makeCombatant('wiz', { pos: { x: 0, y: 0, z: 0 } });
  const primary = makeCombatant('primary', {
    pos: { x: 1, y: 0, z: 0 },
    faction: 'enemy',
  });
  const close = makeCombatant('close', {
    pos: { x: 2, y: 0, z: 0 }, // 5 ft from primary (adjacent)
    faction: 'enemy',
  });
  const farther = makeCombatant('farther', {
    pos: { x: 1, y: 1, z: 0 }, // ~7 ft from primary (1 square diagonal)
    faction: 'enemy',
  });
  const bf = makeBF([caster, primary, close, farther]);
  const state = makeState(bf);

  const target = findSplashTarget(caster, primary, state);
  // close is 5 ft from primary (orthogonal) — within range.
  // farther is ~7 ft from primary (diagonal) — OUT of range (Euclidean > 5).
  assert('19a. splash target found', target !== null);
  eq('19b. splash target = close (5 ft, in range)', target?.id, 'close');
}

// ============================================================
// 20. findSplashTarget — allies excluded (v1 — only enemies are valid splash targets)
// ============================================================
console.log('\n--- 20. findSplashTarget — allies excluded ---');
{
  const caster = makeCombatant('wiz', { pos: { x: 0, y: 0, z: 0 }, faction: 'party' });
  const primary = makeCombatant('primary', {
    pos: { x: 1, y: 0, z: 0 },
    faction: 'enemy',
  });
  // An ALLY of the caster within 5 ft of primary — should be EXCLUDED in v1.
  const ally = makeCombatant('ally', {
    pos: { x: 2, y: 0, z: 0 },
    faction: 'party', // same faction as caster
  });
  const bf = makeBF([caster, primary, ally]);
  const state = makeState(bf);

  const target = findSplashTarget(caster, primary, state);
  eq('20a. ally NOT selected as splash target (v1: enemies only)', target, null);
}

// ============================================================
// 21. findSplashTarget — returns null if no enemy in range
// ============================================================
console.log('\n--- 21. findSplashTarget — null if no enemy in range ---');
{
  const caster = makeCombatant('wiz', { pos: { x: 0, y: 0, z: 0 } });
  const primary = makeCombatant('primary', {
    pos: { x: 1, y: 0, z: 0 },
    faction: 'enemy',
  });
  const farEnemy = makeCombatant('far', {
    pos: { x: 5, y: 0, z: 0 }, // 20 ft from primary
    faction: 'enemy',
  });
  const bf = makeBF([caster, primary, farEnemy]);
  const state = makeState(bf);

  const target = findSplashTarget(caster, primary, state);
  eq('21a. null returned (no enemy within 5 ft of primary)', target, null);
}

// ============================================================
// 22. rollSplashDamage helper — levels 1/5/11/17 dice counts
// ============================================================
console.log('\n--- 22. rollSplashDamage dice counts ---');
{
  // Boundary tests for level → diceCount mapping.
  eq('22a. level 1 diceCount = 0', rollSplashDamage(1, 3).diceCount, 0);
  eq('22b. level 4 diceCount = 0', rollSplashDamage(4, 3).diceCount, 0);
  eq('22c. level 5 diceCount = 1', rollSplashDamage(5, 3).diceCount, 1);
  eq('22d. level 10 diceCount = 1', rollSplashDamage(10, 3).diceCount, 1);
  eq('22e. level 11 diceCount = 2', rollSplashDamage(11, 3).diceCount, 2);
  eq('22f. level 16 diceCount = 2', rollSplashDamage(16, 3).diceCount, 2);
  eq('22g. level 17 diceCount = 3', rollSplashDamage(17, 3).diceCount, 3);
  eq('22h. level 20 diceCount = 3', rollSplashDamage(20, 3).diceCount, 3);
}

// ============================================================
// 23. Green-Flame Blade respects Total Cover on the initial attack
// ============================================================
console.log('\n--- 23. Total Cover blocks Green-Flame Blade ---');
{
  // Wall between caster (0,0) and primary (6,0): x=3, y=-1..9, 1 square wide → Total Cover.
  const wall: Obstacle = {
    id: 'wall', x: 3, y: -1, z: 0,
    width: 1, depth: 10, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('wiz', { pos: { x: 0, y: 0, z: 0 }, spellcastingMod: 3 });
  const primary = makeCombatant('goblin1', {
    pos: { x: 6, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const secondary = makeCombatant('goblin2', {
    pos: { x: 7, y: 0, z: 0 },
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, primary, secondary], [wall]);
  const state = makeState(bf);

  resolveAttack(caster, primary, GREEN_FLAME_BLADE_ACTION, state, true);

  const blockedLog = state.log.events.find(
    (e: CombatEvent) => e.description.includes('Total Cover'),
  );
  assert('23a. Total Cover blocks Green-Flame Blade', blockedLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);

  // No damage to primary or secondary (spell blocked).
  eq('23b. primary HP unchanged (blocked)', primary.currentHP, 100);
  eq('23c. secondary HP unchanged (no splash on block)', secondary.currentHP, 100);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
