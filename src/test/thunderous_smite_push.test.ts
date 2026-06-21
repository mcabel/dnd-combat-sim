// ============================================================
// thunderous_smite_push.test.ts — Thunderous Smite 10-ft push rider (Session 32)
//
// Tests for the pushFt field added to _nextHitRider in Session 32.
// Verifies that:
//   1. Thunderous Smite rider carries pushFt: 10
//   2. When the rider triggers on a weapon hit, the target is pushed 10 ft
//      away from the attacker via pushAway()
//   3. A move event is logged for the push
//   4. The push direction is correct (away from attacker)
//   5. Other smites (Searing Smite) without pushFt do NOT push
//
// NOTE: resolveAttack's isCritOverride parameter uses ?? semantics —
// passing `false` is treated as "force miss", not "force no crit".
// To force a hit, pass `true` (force crit). To use the natural attack
// roll, pass `undefined`.
// ============================================================

import { shouldCast, execute, metadata, cleanup } from '../spells/thunderous_smite';
import { resolveAttack } from '../engine/combat';
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

function withSlots1(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
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
    width: 30, height: 30, depth: 1,
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

const THUNDEROUS_SMITE_ACTION: Action = {
  name: 'Thunderous Smite',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: 0, long: 0 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 13,
  saveAbility: 'wis',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 1,
  costType: 'bonusAction',
  legendaryCost: 0,
  description: 'Thunderous Smite (self buff)',
};

const LONGSWORD_ACTION: Action = {
  name: 'Longsword',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: 5,    // +5 to hit (high enough to reliably hit AC 14)
  damage: { count: 1, sides: 8, bonus: 3, average: 7 },
  damageType: 'slashing',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Longsword attack',
};

function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Paladin',
    pos,
    actions: [THUNDEROUS_SMITE_ACTION, LONGSWORD_ACTION],
    resources: withSlots1(2),
  });
}

function makeEnemy(id: string = 'enemy1', pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    ac: 10, // low AC so the longsword hits
    pos,
  });
}

// ============================================================
// 1. Thunderous Smite rider carries pushFt: 10
// ============================================================

console.log('\n=== 1. Rider carries pushFt: 10 ===\n');

{
  const caster = makeCaster();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  assert('Rider is set', caster._nextHitRider != null);
  if (caster._nextHitRider) {
    eq('Rider pushFt is 10', caster._nextHitRider.pushFt, 10);
    eq('Rider spellName is Thunderous Smite', caster._nextHitRider.spellName, 'Thunderous Smite');
    eq('Rider damageType is thunder', caster._nextHitRider.damageType, 'thunder');
  }
}

// ============================================================
// 2. Push triggers on weapon hit — target moves 10 ft away
// ============================================================

console.log('\n=== 2. Push triggers on weapon hit ===\n');

{
  const caster = makeCaster('paladin', { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('goblin', { x: 1, y: 0, z: 0 }); // 1 square away
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  // Cast Thunderous Smite (sets _nextHitRider on caster)
  execute(caster, state);
  assert('Rider set after cast', caster._nextHitRider != null);

  const enemyHPBefore = enemy.currentHP;
  const enemyXBefore = enemy.pos.x;
  const enemyYBefore = enemy.pos.y;

  // Make a weapon attack — force a hit with isCritOverride=true (forces crit,
  // which is also a guaranteed hit). The push should trigger regardless of crit.
  resolveAttack(caster, enemy, LONGSWORD_ACTION, state, true);

  // Rider should be consumed
  eq('Rider consumed after hit', caster._nextHitRider, null);

  // Enemy should have taken damage (weapon + 2d6 thunder, doubled dice on crit)
  assert('Enemy took damage', enemy.currentHP < enemyHPBefore);

  // Enemy should have been pushed 10 ft = 2 squares
  // Original pos (1, 0); push direction is away from caster (0, 0) → +x direction
  // After 10 ft push: pos should be (3, 0)
  eq('Enemy pushed to x=3 (10 ft away from caster at x=0)', enemy.pos.x, 3);
  eq('Enemy y unchanged (pushed along x axis)', enemy.pos.y, 0);
  assert('Enemy moved 2 squares (10 ft)', Math.abs(enemy.pos.x - enemyXBefore) === 2);
}

// ============================================================
// 3. Push event is logged
// ============================================================

console.log('\n=== 3. Push event logged ===\n');

{
  const caster = makeCaster('paladin', { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('goblin', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);
  resolveAttack(caster, enemy, LONGSWORD_ACTION, state, true);

  const moveEvents = state.log.events.filter((e: any) => e.type === 'move');
  assert('At least 1 move event (push)', moveEvents.length >= 1);

  const pushEvent = moveEvents.find((e: any) =>
    e.description.includes('pushed') && e.description.includes('Thunderous Smite'));
  assert('Push event mentions "pushed"', !!pushEvent);
  assert('Push event mentions "Thunderous Smite"', !!pushEvent);
  if (pushEvent) {
    assert('Push event mentions "10 ft"', (pushEvent as any).description.includes('10 ft'));
  }
}

// ============================================================
// 4. Push direction follows displacement vector
// ============================================================

console.log('\n=== 4. Push direction follows displacement ===\n');

{
  // Caster at (5, 5), enemy at (6, 5) — push should move enemy along +x
  const caster = makeCaster('paladin', { x: 5, y: 5, z: 0 });
  const enemy = makeEnemy('goblin', { x: 6, y: 5, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);
  resolveAttack(caster, enemy, LONGSWORD_ACTION, state, true);

  // Enemy should be pushed in +x direction (away from caster)
  eq('Enemy pushed from x=6 to x=8', enemy.pos.x, 8);
  eq('Enemy y unchanged at 5', enemy.pos.y, 5);
}

{
  // Caster at (0, 0), enemy at (0, 1) — push should move enemy along +y
  const caster = makeCaster('paladin', { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('goblin', { x: 0, y: 1, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);
  resolveAttack(caster, enemy, LONGSWORD_ACTION, state, true);

  // Enemy should be pushed in +y direction
  eq('Enemy pushed from y=1 to y=3', enemy.pos.y, 3);
  eq('Enemy x unchanged at 0', enemy.pos.x, 0);
}

// ============================================================
// 5. Other smites without pushFt do NOT push
// ============================================================

console.log('\n=== 5. Searing Smite (no pushFt) does not push ===\n');

{
  const caster = makeCaster('paladin', { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('goblin', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  // Manually set a Searing Smite rider (no pushFt)
  caster._nextHitRider = {
    spellName: 'Searing Smite',
    dieSides: 6,
    count: 1,
    damageType: 'fire',
    // No pushFt — should not push
  };
  caster.concentration = { active: true, spellName: 'Searing Smite', dcIfHit: 10 };

  const enemyXBefore = enemy.pos.x;
  resolveAttack(caster, enemy, LONGSWORD_ACTION, state, true);

  // Enemy should NOT have been pushed
  eq('Enemy NOT pushed (no pushFt on rider)', enemy.pos.x, enemyXBefore);

  // But enemy should have taken damage (weapon + 1d6 fire)
  assert('Enemy took damage', enemy.currentHP < 100);

  // No move event should be logged for the push
  const pushEvent = state.log.events.find((e: any) =>
    e.type === 'move' && e.description.includes('Searing Smite'));
  assert('No push event for Searing Smite', !pushEvent);
}

// ============================================================
// 6. Push does not trigger on a miss
// ============================================================

console.log('\n=== 6. Push does not trigger on a miss ===\n');

// To force a miss: set enemy AC very high so the attack roll misses
{
  const caster = makeCaster('paladin', { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('goblin', { x: 1, y: 0, z: 0 });
  enemy.ac = 30; // impossible to hit
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);
  const enemyXBefore = enemy.pos.x;
  const enemyHPBefore = enemy.currentHP;

  resolveAttack(caster, enemy, LONGSWORD_ACTION, state, false);

  // Enemy should NOT have been pushed (attack missed)
  eq('Enemy NOT pushed on miss', enemy.pos.x, enemyXBefore);
  eq('Enemy HP unchanged on miss', enemy.currentHP, enemyHPBefore);

  // Rider should NOT be consumed on a miss (PHB: "next time you HIT")
  // The rider stays pending for the next attack.
  assert('Rider NOT consumed on miss', caster._nextHitRider != null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
