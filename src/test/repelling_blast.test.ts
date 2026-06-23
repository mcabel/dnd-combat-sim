// ============================================================
// Test: Repelling Blast Eldritch Invocation (Session 38)
// PHB p.111: "When you hit a creature with Eldritch Blast, you can
// push the creature up to 10 feet away from you in a straight line."
//
// Tests:
//   1. Invocation registry shape (ELDRITCH_INVOCATIONS has Repelling Blast)
//   2. hasInvocation helper
//   3. Eldritch Blast metadata flag (repellingBlastV1Implemented)
//   4. fireEldritchBlastHitInvocations — no-op without invocations
//   5. fireEldritchBlastHitInvocations — pushes 10 ft when Repelling Blast present
//   6. End-to-end resolveAttack: EB hit + Repelling Blast → target pushed 10 ft
//   7. End-to-end resolveAttack: EB hit WITHOUT Repelling Blast → no push
//   8. End-to-end resolveAttack: non-EB cantrip + Repelling Blast → no push
//   9. End-to-end resolveAttack: EB MISS + Repelling Blast → no push (hit-only)
//  10. Push direction: target pushed AWAY from caster (not toward)
//  11. Push logged as 'move' event mentioning Repelling Blast
//  12. Dead target NOT pushed (pushAway guards isDead)
//
// Run: npx ts-node src/test/repelling_blast.test.ts
// ============================================================

import {
  ELDRITCH_INVOCATIONS,
  hasInvocation,
  fireEldritchBlastHitInvocations,
} from '../spells/_invocations';
import { metadata as ebMetadata } from '../spells/eldritch_blast';
import { resolveAttack, CombatEvent } from '../engine/combat';
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
  for (const c of combatants) {
    if (c.pos.x >= 0 && c.pos.x < width && c.pos.y >= 0 && c.pos.y < height) {
      cells[c.pos.x][c.pos.y][c.pos.z ?? 0].occupied = true;
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

const ELDRITCH_BLAST_MISS: Action = { ...ELDRITCH_BLAST_ACTION, hitBonus: -100 };

// A non-EB cantrip (Fire Bolt) to verify Repelling Blast only fires on EB
const FIRE_BOLT_ACTION: Action = {
  ...ELDRITCH_BLAST_ACTION,
  name: 'Fire Bolt',
  damageType: 'fire',
};

// ============================================================
// 1. Invocation registry shape
// ============================================================
console.log('\n--- 1. Invocation registry shape ---');
{
  assert('1a. ELDRITCH_INVOCATIONS has Repelling Blast',
    !!ELDRITCH_INVOCATIONS['Repelling Blast']);
  eq('1b. name', ELDRITCH_INVOCATIONS['Repelling Blast']?.name, 'Repelling Blast');
  assert('1c. description mentions push',
    ELDRITCH_INVOCATIONS['Repelling Blast']?.description.includes('push') === true);
  assert('1d. onEldritchBlastHit hook is a function',
    typeof ELDRITCH_INVOCATIONS['Repelling Blast']?.onEldritchBlastHit === 'function');
}

// ============================================================
// 2. hasInvocation helper
// ============================================================
console.log('\n--- 2. hasInvocation helper ---');
{
  const warlock = makeCombatant('warlock', {
    eldritchInvocations: ['Repelling Blast', 'Agonizing Blast'],
  });
  const fighter = makeCombatant('fighter');
  const emptyWarlock = makeCombatant('warlock2', { eldritchInvocations: [] });

  assert('2a. warlock has Repelling Blast', hasInvocation(warlock, 'Repelling Blast'));
  assert('2b. warlock has Agonizing Blast', hasInvocation(warlock, 'Agonizing Blast'));
  assert('2c. warlock does NOT have Grasp of Hadar', !hasInvocation(warlock, 'Grasp of Hadar'));
  assert('2d. fighter (undefined invocations) does NOT have Repelling Blast',
    !hasInvocation(fighter, 'Repelling Blast'));
  assert('2e. emptyWarlock (empty list) does NOT have Repelling Blast',
    !hasInvocation(emptyWarlock, 'Repelling Blast'));
}

// ============================================================
// 3. Eldritch Blast metadata flag
// ============================================================
console.log('\n--- 3. Eldritch Blast metadata flag ---');
{
  eq('3a. repellingBlastV1Implemented is true',
    (ebMetadata as any).repellingBlastV1Implemented, true);
}

// ============================================================
// 4. fireEldritchBlastHitInvocations — no-op without invocations
// ============================================================
console.log('\n--- 4. fireEldritchBlastHitInvocations — no-op without invocations ---');
{
  const attacker = makeCombatant('warlock');  // no eldritchInvocations
  const target = makeCombatant('goblin', { pos: { x: 3, y: 0, z: 0 } });
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);
  const posBefore = { ...target.pos };

  fireEldritchBlastHitInvocations(attacker, target, state);

  eq('4a. target NOT pushed (no invocations)', target.pos.x, posBefore.x);
  eq('4b. no move events logged', state.log.events.length, 0);
}

// ============================================================
// 5. fireEldritchBlastHitInvocations — pushes 10 ft when Repelling Blast present
// ============================================================
console.log('\n--- 5. fireEldritchBlastHitInvocations — pushes 10 ft ---');
{
  const attacker = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    eldritchInvocations: ['Repelling Blast'],
  });
  const target = makeCombatant('goblin', { pos: { x: 3, y: 0, z: 0 } });
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);

  fireEldritchBlastHitInvocations(attacker, target, state);

  // Target was at x=3 (15 ft from caster at x=0). Push 10 ft = 2 squares.
  // New position: x=5 (25 ft from caster).
  eq('5a. target pushed 2 squares (10 ft) away', target.pos.x, 5);
  assert('5b. move event logged',
    state.log.events.some((e: CombatEvent) => e.type === 'move' && e.description.includes('Repelling Blast')));
}

// ============================================================
// 6. End-to-end: EB hit + Repelling Blast → target pushed 10 ft
// ============================================================
console.log('\n--- 6. End-to-end: EB hit + Repelling Blast → push ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    eldritchInvocations: ['Repelling Blast'],
  });
  const goblin = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 }, // 10 ft away
    ac: 10, // low AC so +8 hitBonus always hits
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* force hit */);

  // Goblin was at x=2 (10 ft). Push 10 ft = 2 squares → x=4 (20 ft from caster).
  eq('6a. goblin pushed from x=2 to x=4', goblin.pos.x, 4);
  // Damage also dealt (1d10 force crit = 2..20)
  assert('6b. goblin took damage', goblin.currentHP < 100);
  // Push logged
  const pushEvent = state.log.events.find((e: CombatEvent) =>
    e.type === 'move' && e.description.includes('Repelling Blast'));
  assert('6c. push event logged', pushEvent !== undefined);
  assert('6d. push event mentions goblin', pushEvent?.description.includes('goblin') === true);
}

// ============================================================
// 7. End-to-end: EB hit WITHOUT Repelling Blast → no push
// ============================================================
console.log('\n--- 7. End-to-end: EB hit WITHOUT Repelling Blast → no push ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
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

  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* force hit */);

  // No push — goblin stays at x=2
  eq('7a. goblin NOT pushed (no invocation)', goblin.pos.x, 2);
  // Damage still dealt
  assert('7b. goblin still took damage', goblin.currentHP < 100);
  // No move event
  assert('7c. no move event logged',
    !state.log.events.some((e: CombatEvent) => e.type === 'move' && e.description.includes('Repelling Blast')));
}

// ============================================================
// 8. End-to-end: non-EB cantrip + Repelling Blast → no push
// ============================================================
console.log('\n--- 8. End-to-end: Fire Bolt + Repelling Blast → no push ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    eldritchInvocations: ['Repelling Blast'],
  });
  const goblin = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  resolveAttack(warlock, goblin, FIRE_BOLT_ACTION, state, true /* force hit */);

  // No push — Repelling Blast only fires on Eldritch Blast, not Fire Bolt
  eq('8a. goblin NOT pushed (Fire Bolt, not EB)', goblin.pos.x, 2);
  assert('8b. no move event logged',
    !state.log.events.some((e: CombatEvent) => e.type === 'move' && e.description.includes('Repelling Blast')));
}

// ============================================================
// 9. End-to-end: EB MISS + Repelling Blast → no push (hit-only)
// ============================================================
console.log('\n--- 9. End-to-end: EB miss + Repelling Blast → no push ---');
{
  // De-flake (Session 53): ELDRITCH_BLAST_MISS has hitBonus: -100, but nat 20
  // ALWAYS hits (crit) per PHB p.194 — 5% chance per run. Retry until we get
  // a non-crit miss (up to 20 tries → P(all crit) = 0.95^20 ≈ 0.36, so
  // P(success in 20 tries) > 99.6%).
  let missAchieved = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const warlock = makeCombatant('warlock', {
      pos: { x: 0, y: 0, z: 0 },
      eldritchInvocations: ['Repelling Blast'],
    });
    const goblin = makeCombatant('goblin', {
      pos: { x: 2, y: 0, z: 0 },
      ac: 10,
      currentHP: 100, maxHP: 100,
      faction: 'enemy',
    });
    const bf = makeBF([warlock, goblin]);
    const state = makeState(bf);

    resolveAttack(warlock, goblin, ELDRITCH_BLAST_MISS, state);

    // Check if the attack actually missed (no crit)
    const hitLog = state.log.events.some((e: CombatEvent) =>
      e.type === 'attack_hit' || e.type === 'attack_crit');
    if (hitLog) continue; // nat 20 — retry

    // Miss → no damage, no push
    eq('9a. goblin NOT pushed (miss)', goblin.pos.x, 2);
    eq('9b. goblin took no damage', goblin.currentHP, 100);
    assert('9c. no move event logged',
      !state.log.events.some((e: CombatEvent) => e.type === 'move' && e.description.includes('Repelling Blast')));
    missAchieved = true;
    break;
  }
  assert('9d. miss achieved within 20 attempts (de-flake)', missAchieved);
}

// ============================================================
// 10. Push direction: target pushed AWAY from caster (diagonal)
// ============================================================
console.log('\n--- 10. Push direction — diagonal away from caster ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 5, y: 5, z: 0 },
    eldritchInvocations: ['Repelling Blast'],
  });
  // Goblin is diagonally up-right from caster: (7,7) = 10 ft away (Chebyshev)
  const goblin = makeCombatant('goblin', {
    pos: { x: 7, y: 7, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* force hit */);

  // Push direction: away from caster (5,5). Goblin at (7,7) → push 2 squares
  // in the (1,1) direction → (9,9).
  eq('10a. goblin pushed from x=7 to x=9', goblin.pos.x, 9);
  eq('10b. goblin pushed from y=7 to y=9', goblin.pos.y, 9);
}

// ============================================================
// 11. Push logged as 'move' event mentioning Repelling Blast + positions
// ============================================================
console.log('\n--- 11. Push event log shape ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    eldritchInvocations: ['Repelling Blast'],
  });
  const goblin = makeCombatant('goblin', {
    pos: { x: 3, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* force hit */);

  const moveEvent = state.log.events.find((e: CombatEvent) =>
    e.type === 'move' && e.description.includes('Repelling Blast'));
  assert('11a. move event found', moveEvent !== undefined);
  assert('11b. mentions old position (3,0)',
    moveEvent?.description.includes('(3,0)') === true);
  assert('11c. mentions new position (5,0)',
    moveEvent?.description.includes('(5,0)') === true);
  assert('11d. mentions 10 ft',
    moveEvent?.description.includes('10 ft') === true);
  eq('11e. actorId is warlock', moveEvent?.actorId, 'warlock');
  eq('11f. targetId is goblin', moveEvent?.targetId, 'goblin');
}

// ============================================================
// 12. Dead target NOT pushed (pushAway guards isDead)
// ============================================================
console.log('\n--- 12. Dead target NOT pushed ---');
{
  const warlock = makeCombatant('warlock', {
    pos: { x: 0, y: 0, z: 0 },
    eldritchInvocations: ['Repelling Blast'],
  });
  const goblin = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
    isDead: true, // already dead
  });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  // Call the invocation hook directly (resolveAttack would skip a dead target
  // before reaching the damage branch, so we test the hook directly).
  fireEldritchBlastHitInvocations(warlock, goblin, state);

  eq('12a. dead goblin NOT pushed', goblin.pos.x, 2);
  assert('12b. no move event for dead target',
    !state.log.events.some((e: CombatEvent) => e.type === 'move' && e.description.includes('Repelling Blast')));
}

// ============================================================
// Final results
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) {
  console.error('repelling_blast.test.ts: SOME TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('repelling_blast.test.ts: all tests passed ✅');
}
