// ============================================================
// Test: Sword Burst Cantrip
// TCE p.115 — Level 0 conjuration cantrip (caster-centered 5-ft AoE, DEX save)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d6/3d6/4d6)
//   3. metadata exposes saveAbility = 'dex' for AI/parser
//   4. metadata exposes components (V only — no S, no M)
//   5. metadata exposes isCasterCenteredAoE = true
//   6. no CANTRIP_EFFECTS entry (no post-hit rider)
//   7. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
//   8. resolveCantripAoE registered — 'Sword Burst' routes to execute handler
//   9. resolveCantripAoE safety — unknown cantrip name returns false
//  10. dispatcher (applyCantripEffect) safety — unknown cantrip name is a no-op
//  11. execute integration — multiple enemies within 5 ft each roll a save
//  12. execute integration — caster is NOT hit
//  13. execute integration — enemies beyond 5 ft are NOT hit (incl. diagonal)
//  14. execute integration — 0 creatures in range still consumes the action
//  15. execute integration — save SUCCESS → half damage; save FAIL → full damage
//  16. execute integration — Sword Burst Action on caster.actions drives saveDC
//
// Run: npx ts-node src/test/sword_burst.test.ts
// ============================================================

import { metadata, execute, SWORD_BURST_RADIUS_FT } from '../spells/sword_burst';
import {
  applyCantripEffect as dispatchCantrip,
  resolveCantripAction,
  resolveCantripAoE,
} from '../engine/cantrip_effects';
import { CombatEvent } from '../engine/combat';
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
  const width = 20, height = 20, depth = 1;
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

// A Sword Burst Action as the AI/parser would build it from metadata.
// Save-based: attackType='save', saveDC = caster's spell save DC, saveAbility='dex'.
// Damage 1d6 force. Caster-centered 5-ft AoE (isAoE = true, range = 5 ft).
const SWORD_BURST_ACTION: Action = {
  name: 'Sword Burst',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: SWORD_BURST_RADIUS_FT, long: SWORD_BURST_RADIUS_FT },
  hitBonus: null,
  damage: { count: 1, sides: 6, bonus: 0, average: 3 },
  damageType: 'force',
  saveDC: 30, // DC=30 → guaranteed save FAIL for all targets (deterministic test)
  saveAbility: 'dex',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Sword Burst',
};

// Save-SUCCESS variant: DC=1 + dex=30 (+10) → guaranteed save SUCCESS.
const SWORD_BURST_SUCCESS_ACTION: Action = { ...SWORD_BURST_ACTION, saveDC: 1 };

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Sword Burst');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'conjuration');
  eq('1d. rangeFt (5 — caster-centered AoE)', metadata.rangeFt, 5);
  eq('1e. damageDice', metadata.damageDice, '1d6');
  eq('1f. damageType = force', metadata.damageType, 'force');
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
  eq('3a. saveAbility = dex', metadata.saveAbility, 'dex');
}

// ============================================================
// 4. components: V only (no S, no M) — TCE p.115
// ============================================================
console.log('\n--- 4. components ---');
{
  eq('4a. verbal component', metadata.components.v, true);
  eq('4b. no somatic component', metadata.components.s, false);
  eq('4c. no material component', metadata.components.m, false);
}

// ============================================================
// 5. metadata exposes isCasterCenteredAoE = true
// ============================================================
console.log('\n--- 5. isCasterCenteredAoE ---');
{
  eq('5a. isCasterCenteredAoE = true', metadata.isCasterCenteredAoE, true);
}

// ============================================================
// 6. no CANTRIP_EFFECTS entry (no post-hit rider)
// ============================================================
console.log('\n--- 6. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Sword Burst', state);
  // No scratch fields set on target (no rider), no log events from the dispatcher.
  eq('6a. no flag set on target', target._viciousMockeryDisadvNextAttack, undefined);
  eq('6b. no log events from dispatcher', state.log.events.length, 0);
}

// ============================================================
// 7. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
// ============================================================
console.log('\n--- 7. not a self-buff ---');
{
  const caster = makeCombatant('wiz');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  eq('7a. resolveCantripAction returns false', resolveCantripAction(caster, 'Sword Burst', state), false);
  eq('7b. no log events', state.log.events.length, 0);
}

// ============================================================
// 8. resolveCantripAoE registered — 'Sword Burst' routes to execute handler
// ============================================================
console.log('\n--- 8. resolveCantripAoE integration ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [SWORD_BURST_ACTION],
  });
  const enemy = makeCombatant('goblin', {
    pos: { x: 6, y: 5, z: 0 }, // 5 ft away (1 square) — within range
    dex: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Sword Burst', state);
  eq('8a. resolveCantripAoE returns true', ret, true);

  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  assert('8b. save_fail event logged', saveFail !== undefined);
  assert('8c. save_fail mentions DEX', saveFail?.description.includes('DEX') === true, true);
}

// ============================================================
// 9. resolveCantripAoE safety — unknown cantrip name returns false
// ============================================================
console.log('\n--- 9. resolveCantripAoE safety ---');
{
  const caster = makeCombatant('wiz');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Definitely Not A Cantrip', state);
  eq('9a. unknown cantrip → false', ret, false);
  eq('9b. no log events', state.log.events.length, 0);
}

// ============================================================
// 10. dispatcher (applyCantripEffect) safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 10. dispatcher safety ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('10a. unknown cantrip → no flag', target._frostbiteDisadvNextWeaponAttack, undefined);
  eq('10b. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 11. execute integration — multiple enemies within 5 ft each roll a save
// ============================================================
console.log('\n--- 11. multiple enemies in range ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [SWORD_BURST_ACTION],
  });
  // Three enemies within 5 ft of the caster (orthogonal + diagonal — all within 5 ft Euclidean).
  const enemy1 = makeCombatant('goblin1', {
    pos: { x: 6, y: 5, z: 0 }, // 5 ft away (1 square orthogonal)
    dex: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const enemy2 = makeCombatant('goblin2', {
    pos: { x: 5, y: 6, z: 0 }, // 5 ft away (1 square orthogonal, other direction)
    dex: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const enemy3 = makeCombatant('goblin3', {
    pos: { x: 6, y: 6, z: 0 }, // ~7 ft away diagonally (1 square diagonal)
    dex: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  // An enemy OUT of range (15 ft away)
  const farEnemy = makeCombatant('farGoblin', {
    pos: { x: 8, y: 5, z: 0 }, // 15 ft away (3 squares orthogonal)
    dex: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([caster, enemy1, enemy2, enemy3, farEnemy]);
  const state = makeState(bf);

  execute(caster, state);

  // Count save events: enemy1 (5 ft, in), enemy2 (5 ft, in), enemy3 (~7 ft diagonal, OUT),
  // farEnemy (15 ft, OUT). Only enemy1 and enemy2 should roll saves.
  const saveEvents = state.log.events.filter(
    (e: CombatEvent) => e.type === 'save_fail' || e.type === 'save_success',
  );
  // Actually wait — 1 square diagonal is sqrt(2)*5 ≈ 7.07 ft, which is > 5 ft.
  // So enemy3 is OUT of range (Euclidean circle, not Chebyshev square).
  eq('11a. exactly 2 saves rolled (enemy1 + enemy2 in range; enemy3 diagonal OUT)',
    saveEvents.length, 2);

  // Both enemies took force damage (save FAIL → full 1d6 = 1..6).
  const dmgEvents = state.log.events.filter(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('force'),
  );
  eq('11b. exactly 2 damage events (force)', dmgEvents.length, 2);
  for (const d of dmgEvents) {
    assert('11c. force damage in 1..6 range',
      d.value! >= 1 && d.value! <= 6, `got ${d.value}`);
  }

  // farEnemy and enemy3 (diagonal) should NOT have taken damage.
  eq('11d. farEnemy HP unchanged', farEnemy.currentHP, 100);
  eq('11e. enemy3 (diagonal, ~7 ft) HP unchanged', enemy3.currentHP, 100);
}

// ============================================================
// 12. execute integration — caster is NOT hit
// ============================================================
console.log('\n--- 12. caster not hit ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [SWORD_BURST_ACTION],
    currentHP: 100, maxHP: 100,
  });
  const enemy = makeCombatant('goblin', {
    pos: { x: 6, y: 5, z: 0 },
    dex: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('12a. caster HP unchanged (caster is excluded from the AoE)',
    caster.currentHP, 100);
  assert('12b. enemy took damage', enemy.currentHP < 100, true);
}

// ============================================================
// 13. execute integration — enemies beyond 5 ft are NOT hit (incl. diagonal ~7 ft)
// ============================================================
console.log('\n--- 13. range edge cases (Euclidean circle) ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [SWORD_BURST_ACTION],
  });
  // Enemy at exactly 5 ft (1 square orthogonal) — IN range.
  const inRange = makeCombatant('in', {
    pos: { x: 6, y: 5, z: 0 }, // 5 ft
    dex: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  // Enemy at ~7 ft (1 square diagonal) — OUT of range (Euclidean > 5).
  const diagonal = makeCombatant('diag', {
    pos: { x: 6, y: 6, z: 0 }, // sqrt(2)*5 ≈ 7.07 ft
    dex: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  // Enemy at 10 ft (2 squares orthogonal) — OUT of range.
  const ten = makeCombatant('ten', {
    pos: { x: 7, y: 5, z: 0 }, // 10 ft
    dex: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, inRange, diagonal, ten]);
  const state = makeState(bf);

  execute(caster, state);

  assert('13a. in-range enemy (5 ft) took damage', inRange.currentHP < 100, true);
  eq('13b. diagonal enemy (~7 ft) NOT hit (Euclidean circle, not Chebyshev square)',
    diagonal.currentHP, 100);
  eq('13c. 10-ft enemy NOT hit', ten.currentHP, 100);
}

// ============================================================
// 14. execute integration — 0 creatures in range still consumes the action
// ============================================================
console.log('\n--- 14. 0 creatures in range ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [SWORD_BURST_ACTION],
  });
  // Enemy far away — not in range.
  const farEnemy = makeCombatant('far', {
    pos: { x: 15, y: 15, z: 0 }, // very far
    dex: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, farEnemy]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Sword Burst', state);

  // The cantrip still fires — the spell is "cast" even if no one is in range.
  eq('14a. resolveCantripAoE returns true (action consumed)', ret, true);
  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Sword Burst'),
  );
  assert('14b. cast log mentions 0 creatures', castLog !== undefined && castLog.description.includes('0 creature'),
    `got: ${castLog?.description}`);
  eq('14c. far enemy HP unchanged', farEnemy.currentHP, 100);
  const saveEvents = state.log.events.filter(
    (e: CombatEvent) => e.type === 'save_fail' || e.type === 'save_success',
  );
  eq('14d. no saves rolled', saveEvents.length, 0);
}

// ============================================================
// 15. execute integration — save SUCCESS → half damage; save FAIL → full damage
// ============================================================
console.log('\n--- 15. save SUCCESS → half, FAIL → full ---');
{
  // DC=30 → guaranteed FAIL → full 1d6 = 1..6.
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [SWORD_BURST_ACTION], // DC=30, FAIL
  });
  const enemy = makeCombatant('goblin', {
    pos: { x: 6, y: 5, z: 0 },
    dex: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const dmgEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('force'),
  );
  assert('15a. FAIL damage event exists', dmgEvent !== undefined);
  if (dmgEvent) {
    assert('15b. FAIL damage in 1..6 range (full 1d6)',
      dmgEvent.value! >= 1 && dmgEvent.value! <= 6, `got ${dmgEvent.value}`);
  }
  const damageTaken = 100 - enemy.currentHP;
  assert('15c. damage taken = 1..6', damageTaken >= 1 && damageTaken <= 6, `got ${damageTaken}`);
}
{
  // DC=1 + dex=30 (+10) → guaranteed SUCCESS → half of 1d6 = 0..3 (floored).
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [SWORD_BURST_SUCCESS_ACTION], // DC=1, SUCCESS
  });
  const enemy = makeCombatant('goblin', {
    pos: { x: 6, y: 5, z: 0 },
    dex: 30, // +10 mod → save 11+ vs DC 1 → always succeeds
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const saveSuccess = state.log.events.find((e: CombatEvent) => e.type === 'save_success');
  assert('15d. save_success logged', saveSuccess !== undefined);
  const damageTaken = 100 - enemy.currentHP;
  assert('15e. SUCCESS damage in 0..3 range (half of 1d6, floored)',
    damageTaken >= 0 && damageTaken <= 3, `got ${damageTaken}`);
}

// ============================================================
// 16. execute integration — Sword Burst Action on caster.actions drives saveDC
// ============================================================
console.log('\n--- 16. saveDC read from caster.actions ---');
{
  // Custom DC=20 — verify the save_fail log shows DC 20.
  const customAction: Action = { ...SWORD_BURST_ACTION, saveDC: 20 };
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [customAction],
  });
  const enemy = makeCombatant('goblin', {
    pos: { x: 6, y: 5, z: 0 },
    dex: 10, // +0 mod → save 1..20 vs DC 20 → 5% fail rate (nat 20 only)
    // We don't care about pass/fail here — just verify the DC is read from the Action.
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('DC 20'),
  );
  assert('16a. cast log shows DC 20 (read from Action)', castLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}
{
  // Missing Action → fallback DC=13.
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [], // no Sword Burst Action
  });
  const enemy = makeCombatant('goblin', {
    pos: { x: 6, y: 5, z: 0 },
    dex: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('DC 13'),
  );
  assert('16b. fallback DC 13 used when Action is missing', castLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
