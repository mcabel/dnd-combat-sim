// ============================================================
// Test: Agonizing Blast, Grasp of Hadar, Lance of Lethargy
// Eldritch Invocations (Session 39)
//
// Agonizing Blast (PHB p.110): +CHA mod to EB damage (pre-damage hook)
// Grasp of Hadar (PHB p.111): pull 10 ft toward caster on EB hit
// Lance of Lethargy (XGE p.157): reduce target speed 10 ft on EB hit
//
// Tests:
//   1. Registry shape (all 3 invocations registered)
//   2. Agonizing Blast — fireEldritchBlastDamageInvocations unit tests
//   3. Agonizing Blast — end-to-end resolveAttack (+CHA mod damage)
//   4. Agonizing Blast — CHA mod computation (CHA 8/10/14/20)
//   5. Agonizing Blast — crit does NOT double (flat modifier, not dice)
//   6. Grasp of Hadar — fireEldritchBlastHitInvocations unit tests
//   7. Grasp of Hadar — end-to-end resolveAttack (pull 10 ft toward)
//   8. Grasp of Hadar — pull direction (toward caster, not away)
//   9. Lance of Lethargy — fireEldritchBlastHitInvocations unit tests
//  10. Lance of Lethargy — end-to-end resolveAttack (speed reduced)
//  11. Lance of Lethargy — cleanup restores speed (resetBudget)
//  12. Combinations — Repelling + Agonizing (push + extra damage)
//  13. Combinations — Repelling + Grasp (push then pull = net zero)
//  14. Eldritch Blast metadata flags
//
// Run: npx ts-node src/test/eldritch_invocations.test.ts
// ============================================================

import {
  ELDRITCH_INVOCATIONS,
  hasInvocation,
  fireEldritchBlastDamageInvocations,
  fireEldritchBlastHitInvocations,
} from '../spells/_invocations';
import { metadata as ebMetadata } from '../spells/eldritch_blast';
import { resolveAttack, CombatEvent } from '../engine/combat';
import { resetBudget } from '../engine/utils';
import { Combatant, Action, Vec3, Obstacle } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail: any = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 18,
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
  const width = 20, height = 20, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [];
      for (let z = 0; z < depth; z++) {
        cells[x][y][z] = { terrain: 'flat', elevation: 0 };
      }
    }
  }
  return {
    width, height, depth, cells,
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1,
    initiativeOrder: combatants.map(c => c.id),
  } as any;
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

const ELDRITCH_BLAST_ACTION: Action = {
  name: 'Eldritch Blast',
  isMultiattack: false,
  attackType: 'spell',
  reach: 0,
  range: { normal: 120, long: 120 },
  hitBonus: 8,
  damage: { count: 1, sides: 10, bonus: 0, average: 5 },
  damageType: 'force',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Eldritch Blast',
};

const FIRE_BOLT_ACTION: Action = {
  ...ELDRITCH_BLAST_ACTION,
  name: 'Fire Bolt',
  damageType: 'fire',
};

// ============================================================
// 1. Registry shape
// ============================================================
console.log('\n--- 1. Registry shape ---');
{
  assert('1a. Agonizing Blast registered', !!ELDRITCH_INVOCATIONS['Agonizing Blast']);
  assert('1b. Grasp of Hadar registered', !!ELDRITCH_INVOCATIONS['Grasp of Hadar']);
  assert('1c. Lance of Lethargy registered', !!ELDRITCH_INVOCATIONS['Lance of Lethargy']);
  assert('1d. Agonizing Blast has onEldritchBlastDamage hook',
    typeof ELDRITCH_INVOCATIONS['Agonizing Blast']?.onEldritchBlastDamage === 'function');
  assert('1e. Grasp of Hadar has onEldritchBlastHit hook',
    typeof ELDRITCH_INVOCATIONS['Grasp of Hadar']?.onEldritchBlastHit === 'function');
  assert('1f. Lance of Lethargy has onEldritchBlastHit hook',
    typeof ELDRITCH_INVOCATIONS['Lance of Lethargy']?.onEldritchBlastHit === 'function');
  assert('1g. Agonizing Blast has NO onEldritchBlastHit hook',
    ELDRITCH_INVOCATIONS['Agonizing Blast']?.onEldritchBlastHit === undefined);
}

// ============================================================
// 2. Agonizing Blast — fireEldritchBlastDamageInvocations unit tests
// ============================================================
console.log('\n--- 2. Agonizing Blast — fireEldritchBlastDamageInvocations ---');
{
  // 2a. No invocations → 0 bonus
  const warlockNoInv = makeCombatant('w1', { cha: 18 }); // CHA +4
  eq('2a. no invocations → 0 bonus', fireEldritchBlastDamageInvocations(warlockNoInv, makeCombatant('t1')), 0);

  // 2b. Agonizing Blast + CHA 18 (+4) → 4 bonus
  const warlockCha18 = makeCombatant('w2', { cha: 18, eldritchInvocations: ['Agonizing Blast'] });
  eq('2b. CHA 18 (+4) → 4 bonus', fireEldritchBlastDamageInvocations(warlockCha18, makeCombatant('t2')), 4);

  // 2c. Agonizing Blast + CHA 20 (+5) → 5 bonus
  const warlockCha20 = makeCombatant('w3', { cha: 20, eldritchInvocations: ['Agonizing Blast'] });
  eq('2c. CHA 20 (+5) → 5 bonus', fireEldritchBlastDamageInvocations(warlockCha20, makeCombatant('t3')), 5);

  // 2d. hasInvocation helper
  assert('2d. hasInvocation true for Agonizing Blast', hasInvocation(warlockCha18, 'Agonizing Blast'));
  assert('2e. hasInvocation false for unknown', !hasInvocation(warlockCha18, 'Grasp of Hadar'));
}

// ============================================================
// 3. Agonizing Blast — end-to-end resolveAttack (+CHA mod damage)
// ============================================================
console.log('\n--- 3. Agonizing Blast — end-to-end +CHA mod damage ---');
{
  // Warlock with Agonizing Blast + CHA 18 (+4)
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    cha: 18, // +4
    eldritchInvocations: ['Agonizing Blast'],
  });
  const goblin = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* force crit */);

  // EB base: 2d10 force crit = 2..20. Agonizing Blast: +4 force (NOT doubled).
  // Total: 6..24. (isCritOverride=true forces a crit — there's no "force hit
  // without crit" parameter; test 6 below verifies the CHA mod is NOT doubled.)
  const dmgDealt = 100 - goblin.currentHP;
  assert('3a. damage in 6..24 range (2d10 crit + 4 CHA mod, not doubled)',
    dmgDealt >= 6 && dmgDealt <= 24, `got ${dmgDealt}`);

  // Agonizing Blast bonus logged
  const agonizingLog = state.log.events.find((e: CombatEvent) =>
    e.type === 'action' && e.description.includes('Agonizing Blast'));
  assert('3b. Agonizing Blast bonus logged', agonizingLog !== undefined);
  assert('3c. log mentions +4 force', agonizingLog?.description.includes('+4') === true);
}

// ============================================================
// 4. Agonizing Blast — end-to-end WITHOUT invocation (no extra damage)
// ============================================================
console.log('\n--- 4. Agonizing Blast — no invocation → no extra damage ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    cha: 18,
    // NO eldritchInvocations
  });
  const goblin = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* force crit */);

  // EB base only (crit): 2d10 = 2..20 (no CHA mod bonus — no Agonizing Blast)
  const dmgDealt = 100 - goblin.currentHP;
  assert('4a. damage in 2..20 range (no Agonizing Blast bonus, crit)',
    dmgDealt >= 2 && dmgDealt <= 20, `got ${dmgDealt}`);

  // No Agonizing Blast log
  assert('4b. no Agonizing Blast log',
    !state.log.events.some((e: CombatEvent) => e.description.includes('Agonizing Blast')));
}

// ============================================================
// 5. Agonizing Blast — Fire Bolt does NOT trigger (EB-only)
// ============================================================
console.log('\n--- 5. Agonizing Blast — Fire Bolt does NOT trigger ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    cha: 18,
    eldritchInvocations: ['Agonizing Blast'],
  });
  const goblin = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  resolveAttack(warlock, goblin, FIRE_BOLT_ACTION, state, true /* force crit */);

  // Fire Bolt base only (crit): 2d10 fire = 2..20 (no CHA mod bonus — Agonizing
  // Blast only applies to Eldritch Blast, not Fire Bolt)
  const dmgDealt = 100 - goblin.currentHP;
  assert('5a. damage in 2..20 range (Fire Bolt crit, no Agonizing Blast)',
    dmgDealt >= 2 && dmgDealt <= 20, `got ${dmgDealt}`);
  assert('5b. no Agonizing Blast log for Fire Bolt',
    !state.log.events.some((e: CombatEvent) => e.description.includes('Agonizing Blast')));
}

// ============================================================
// 6. Agonizing Blast — crit does NOT double (flat modifier)
// ============================================================
console.log('\n--- 6. Agonizing Blast — crit does NOT double ---');
{
  // Force crit: EB base 2d10 = 2..20, Agonizing Blast +4 (NOT doubled)
  // Total: 6..24
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    cha: 18, // +4
    eldritchInvocations: ['Agonizing Blast'],
  });
  const goblin = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* force crit */);

  const dmgDealt = 100 - goblin.currentHP;
  // 2d10 crit (2..20) + 4 (CHA mod, NOT doubled) = 6..24
  assert('6a. crit damage in 6..24 range (2d10 + 4, CHA mod NOT doubled)',
    dmgDealt >= 6 && dmgDealt <= 24, `got ${dmgDealt}`);

  // If CHA mod WERE doubled, the range would be 8..28. Verify we're not in
  // the "doubled" upper range (25..28 would indicate +8 instead of +4).
  assert('6b. damage NOT in 25..28 (would indicate doubled CHA mod)',
    dmgDealt < 25, `got ${dmgDealt}`);
}

// ============================================================
// 7. Grasp of Hadar — fireEldritchBlastHitInvocations pulls 10 ft
// ============================================================
console.log('\n--- 7. Grasp of Hadar — pulls 10 ft toward caster ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    eldritchInvocations: ['Grasp of Hadar'],
  });
  // Goblin 15 ft away (3 squares) — will be pulled 10 ft (2 squares) toward caster
  const goblin = makeCombatant('goblin', { pos: { x: 3, y: 0, z: 0 } });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  fireEldritchBlastHitInvocations(warlock, goblin, state);

  // Goblin pulled from x=3 to x=1 (toward caster at x=0)
  eq('7a. goblin pulled from x=3 to x=1', goblin.pos.x, 1);
  const pullEvent = state.log.events.find((e: CombatEvent) =>
    e.type === 'move' && e.description.includes('Grasp of Hadar'));
  assert('7b. pull event logged', pullEvent !== undefined);
  assert('7c. log mentions pulled toward', pullEvent?.description.includes('pulled') === true);
}

// ============================================================
// 8. Grasp of Hadar — end-to-end resolveAttack (pull toward)
// ============================================================
console.log('\n--- 8. Grasp of Hadar — end-to-end pull toward caster ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    eldritchInvocations: ['Grasp of Hadar'],
  });
  const goblin = makeCombatant('goblin', {
    pos: { x: 4, y: 0, z: 0 }, // 20 ft away
    ac: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* force hit */);

  // Goblin pulled from x=4 to x=2 (10 ft = 2 squares toward caster at x=0)
  eq('8a. goblin pulled from x=4 to x=2', goblin.pos.x, 2);
  assert('8b. damage still dealt', goblin.currentHP < 100);
}

// ============================================================
// 9. Grasp of Hadar — pull direction (diagonal toward caster)
// ============================================================
console.log('\n--- 9. Grasp of Hadar — diagonal pull toward caster ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 5, y: 5, z: 0 },
    eldritchInvocations: ['Grasp of Hadar'],
  });
  // Goblin diagonally up-right: (7,7) = 10 ft from caster (Chebyshev)
  const goblin = makeCombatant('goblin', {
    pos: { x: 7, y: 7, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* force hit */);

  // Pull toward (5,5): from (7,7) pull 2 squares in (-1,-1) direction → (5,5)
  eq('9a. goblin pulled from x=7 to x=5', goblin.pos.x, 5);
  eq('9b. goblin pulled from y=7 to y=5', goblin.pos.y, 5);
}

// ============================================================
// 10. Lance of Lethargy — fireEldritchBlastHitInvocations reduces speed
// ============================================================
console.log('\n--- 10. Lance of Lethargy — reduces speed 10 ft ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    eldritchInvocations: ['Lance of Lethargy'],
  });
  const goblin = makeCombatant('goblin', { pos: { x: 2, y: 0, z: 0 }, speed: 30 });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  fireEldritchBlastHitInvocations(warlock, goblin, state);

  eq('10a. goblin speed reduced from 30 to 20', goblin.speed, 20);
  assert('10b. _hasLanceOfLethargy flag set', goblin._hasLanceOfLethargy === true);
  eq('10c. _lanceOfLethargyOriginalSpeed stored', goblin._lanceOfLethargyOriginalSpeed, 30);
  const slowEvent = state.log.events.find((e: CombatEvent) =>
    e.type === 'action' && e.description.includes('Lance of Lethargy'));
  assert('10d. slow event logged', slowEvent !== undefined);
  assert('10e. log mentions speed reduction', slowEvent?.description.includes('30ft → 20ft') === true);
}

// ============================================================
// 11. Lance of Lethargy — end-to-end + cleanup restores speed
// ============================================================
console.log('\n--- 11. Lance of Lethargy — end-to-end + cleanup ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    eldritchInvocations: ['Lance of Lethargy'],
  });
  const goblin = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
    speed: 30,
    faction: 'enemy',
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* force hit */);

  // Speed reduced after hit
  eq('11a. goblin speed reduced to 20 after EB hit', goblin.speed, 20);

  // Simulate start of goblin's next turn (resetBudget)
  resetBudget(goblin);

  // Speed restored
  eq('11b. goblin speed restored to 30 after resetBudget', goblin.speed, 30);
  assert('11c. _hasLanceOfLethargy cleared', goblin._hasLanceOfLethargy === undefined);
  assert('11d. _lanceOfLethargyOriginalSpeed cleared', goblin._lanceOfLethargyOriginalSpeed === undefined);
}

// ============================================================
// 12. Lance of Lethargy — EB miss → no slow
// ============================================================
console.log('\n--- 12. Lance of Lethargy — EB miss → no slow ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    eldritchInvocations: ['Lance of Lethargy'],
  });
  const goblin = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    currentHP: 100, maxHP: 100,
    speed: 30,
    faction: 'enemy',
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  // Force a deterministic miss via isCritOverride=false. Previously this test
  // used `ac: 30` + `hitBonus: -100` to "guarantee" a miss, but per PHB p.194
  // a natural 20 always hits regardless of AC/modifiers — so ~5% of the time
  // the attack landed and 12a/12b failed. isCritOverride=false short-circuits
  // the hit check in resolveAttack (combat.ts:1859) for a flake-free miss.
  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, false /* force miss */);

  eq('12a. goblin speed NOT reduced (miss)', goblin.speed, 30);
  assert('12b. no Lance of Lethargy log',
    !state.log.events.some((e: CombatEvent) => e.description.includes('Lance of Lethargy')));
}

// ============================================================
// 13. Combinations — Repelling Blast + Agonizing Blast (push + damage)
// ============================================================
console.log('\n--- 13. Combinations — Repelling + Agonizing ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    cha: 16, // +3
    eldritchInvocations: ['Repelling Blast', 'Agonizing Blast'],
  });
  const goblin = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* force crit */);

  // Pushed 10 ft away: x=2 → x=4
  eq('13a. goblin pushed from x=2 to x=4 (Repelling Blast)', goblin.pos.x, 4);
  // Damage: 2d10 crit (2..20) + 3 CHA mod (not doubled) = 5..23
  const dmgDealt = 100 - goblin.currentHP;
  assert('13b. damage in 5..23 range (2d10 crit + 3 CHA mod, not doubled)',
    dmgDealt >= 5 && dmgDealt <= 23, `got ${dmgDealt}`);
  // Both invocations logged
  assert('13c. Repelling Blast logged',
    state.log.events.some((e: CombatEvent) => e.description.includes('Repelling Blast')));
  assert('13d. Agonizing Blast logged',
    state.log.events.some((e: CombatEvent) => e.description.includes('Agonizing Blast')));
}

// ============================================================
// 14. Combinations — Repelling + Grasp (push then pull = net zero)
// ============================================================
console.log('\n--- 14. Combinations — Repelling + Grasp (net zero) ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    eldritchInvocations: ['Repelling Blast', 'Grasp of Hadar'],
  });
  const goblin = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* force hit */);

  // Repelling fires first (push away 10 ft: x=2 → x=4)
  // Then Grasp fires (pull toward 10 ft: x=4 → x=2)
  // Net result: goblin ends up back at x=2
  eq('14a. goblin back at x=2 (push + pull cancel out)', goblin.pos.x, 2);
  // Both events logged (the push event + the pull event)
  const pushEvents = state.log.events.filter((e: CombatEvent) =>
    e.type === 'move' && e.description.includes('Repelling Blast'));
  const pullEvents = state.log.events.filter((e: CombatEvent) =>
    e.type === 'move' && e.description.includes('Grasp of Hadar'));
  assert('14b. Repelling Blast push logged', pushEvents.length === 1);
  assert('14c. Grasp of Hadar pull logged', pullEvents.length === 1);
}

// ============================================================
// 15. Eldritch Blast metadata flags
// ============================================================
console.log('\n--- 15. Eldritch Blast metadata flags ---');
{
  eq('15a. agonizingBlastV1Implemented', (ebMetadata as any).agonizingBlastV1Implemented, true);
  eq('15b. graspOfHadarV1Implemented', (ebMetadata as any).graspOfHadarV1Implemented, true);
  eq('15c. lanceOfLethargyV1Implemented', (ebMetadata as any).lanceOfLethargyV1Implemented, true);
  eq('15d. repellingBlastV1Implemented (from Session 38)', (ebMetadata as any).repellingBlastV1Implemented, true);
}

// ============================================================
// Final results
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) {
  console.error('eldritch_invocations.test.ts: SOME TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('eldritch_invocations.test.ts: all tests passed ✅');
}
