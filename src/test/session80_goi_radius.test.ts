// ============================================================
// Test: Session 80 — Globe of Invulnerability 10-ft radius
//       ally protection (PHB p.245)
//
// PHB p.245: "An immobile, faintly shimmering barrier springs
// into existence in a 10-foot radius around you and remains
// for the duration. Any spell of 5th level or lower cast from
// outside the barrier can't affect creatures or objects within
// it."
//
// Prior state: GoI only protected the caster (v1 simplification).
// Session 80: isProtectedByGoI() now accepts an optional
// Battlefield parameter. When provided, it checks both:
//   1) The target's own GoI effect (self-caster)
//   2) Whether the target is within 10 ft of any OTHER GoI caster
//
// Run: npx ts-node --transpile-only src/test/session80_goi_radius.test.ts
// ============================================================

import { Combatant, Action, PlayerResources, Condition, ActiveEffect } from '../types/core';
import { isProtectedByGoI, filterGoIProtectedTargets } from '../engine/spell_effects';
import { combatantsWithinRadiusFt } from '../engine/movement';
import { EngineState } from '../engine/combat';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Shared helpers -----------------------------------------

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 1000, currentHP: 1000, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 1, con: 10, int: 10, wis: 16, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set<Condition>(),
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
    width: 60, height: 60, depth: 5,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: any): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

/** Construct a GoI ActiveEffect with the given blockThreshold (L6→5, L7→6, etc.). */
function makeGoIEffect(blockThreshold: number, sourceSlotLevel: number = 6): ActiveEffect {
  return {
    id: `eff_goi_${blockThreshold}`,
    casterId: 'goiCaster',  // will be overridden per test
    spellName: 'Globe of Invulnerability',
    effectType: 'spell_shield',
    sourceSlotLevel,
    sourceIsConcentration: true,
    payload: { blockThreshold },
  } as ActiveEffect;
}

// ============================================================
// Phase 1 — isProtectedByGoI: backward compat (no bf)
// ============================================================

console.log('\n=== Phase 1 — isProtectedByGoI backward compat (no Battlefield) ===\n');

{
  // 1a. Target has own GoI → protected (same as before)
  const target = makeCombatant('t', {
    activeEffects: [makeGoIEffect(5)],
  });
  eq('1a. Self GoI: L3 blocked', isProtectedByGoI(target, 3), true);
  eq('1a. Self GoI: L6 not blocked', isProtectedByGoI(target, 6), false);
}

{
  // 1b. No GoI → not protected
  const target = makeCombatant('t');
  eq('1b. No GoI: L3 not blocked', isProtectedByGoI(target, 3), false);
}

{
  // 1c. Cantrip (level 0) → never blocked
  const target = makeCombatant('t', {
    activeEffects: [makeGoIEffect(5)],
  });
  eq('1c. Cantrip never blocked', isProtectedByGoI(target, 0), false);
}

// ============================================================
// Phase 2 — isProtectedByGoI: 10-ft radius with Battlefield
// ============================================================

console.log('\n=== Phase 2 — isProtectedByGoI: 10-ft radius ally protection ===\n');

{
  // 2a. Ally within 5 ft (1 square) of GoI caster → protected
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goiCaster' }],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });  // 1 square away = 5 ft
  const enemy = makeCombatant('enemy', { pos: { x: 0, y: 0, z: 0 } });
  const bf = makeBF([goiCaster, ally, enemy]);

  eq('2a. Ally at 5ft: L3 blocked', isProtectedByGoI(ally, 3, bf), true);
  eq('2a. Ally at 5ft: L6 not blocked (penetrates)', isProtectedByGoI(ally, 6, bf), false);
}

{
  // 2b. Ally within 10 ft (2 squares) of GoI caster → protected
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goiCaster' }],
  });
  const ally = makeCombatant('ally', { pos: { x: 7, y: 5, z: 0 } });  // 2 squares = 10 ft (chebyshev)
  const bf = makeBF([goiCaster, ally]);

  eq('2b. Ally at 10ft (2 squares): L3 blocked', isProtectedByGoI(ally, 3, bf), true);
}

{
  // 2c. Ally beyond 10 ft (3 squares = 15 ft) → NOT protected
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goiCaster' }],
  });
  const ally = makeCombatant('ally', { pos: { x: 8, y: 5, z: 0 } });  // 3 squares = 15 ft
  const bf = makeBF([goiCaster, ally]);

  eq('2c. Ally at 15ft (3 squares): NOT protected', isProtectedByGoI(ally, 3, bf), false);
}

{
  // 2d. Diagonal distance: ally at (7,7,0) from caster at (5,5,0)
  //     chebyshev = max(|7-5|, |7-5|) = 2 → within 10 ft
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goiCaster' }],
  });
  const ally = makeCombatant('ally', { pos: { x: 7, y: 7, z: 0 } });
  const bf = makeBF([goiCaster, ally]);

  eq('2d. Diagonal ally at 2 squares (10ft): L3 blocked', isProtectedByGoI(ally, 3, bf), true);
}

{
  // 2e. 3D distance: ally at different Z but within 2 squares
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goiCaster' }],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 5, z: 1 } });  // 1 square up
  const bf = makeBF([goiCaster, ally]);

  eq('2e. 3D ally 1 square up: L3 blocked', isProtectedByGoI(ally, 3, bf), true);
}

{
  // 2f. Enemy near GoI caster is NOT protected (different faction check not needed —
  //     GoI protects ALL creatures within the barrier per PHB p.245, regardless of faction)
  const goiCaster = makeCombatant('goiCaster', {
    faction: 'party',
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goiCaster' }],
  });
  const enemy = makeCombatant('enemy', {
    faction: 'enemy',
    pos: { x: 5, y: 6, z: 0 },  // adjacent
  });
  const bf = makeBF([goiCaster, enemy]);

  // PHB p.245: "Any spell of 5th level or lower cast from outside the
  // barrier can't affect creatures or objects within it" — ALL creatures,
  // not just allies. So the enemy IS protected while inside the barrier.
  eq('2f. Enemy within GoI radius: also protected', isProtectedByGoI(enemy, 3, bf), true);
}

{
  // 2g. Dead GoI caster: does not protect anyone
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goiCaster' }],
    isDead: true,
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([goiCaster, ally]);

  eq('2g. Dead GoI caster: ally NOT protected', isProtectedByGoI(ally, 3, bf), false);
}

{
  // 2h. Unconscious GoI caster: does not protect anyone
  //     (concentration would actually break, but test the guard anyway)
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goiCaster' }],
    isUnconscious: true,
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([goiCaster, ally]);

  eq('2h. Unconscious GoI caster: ally NOT protected', isProtectedByGoI(ally, 3, bf), false);
}

// ============================================================
// Phase 3 — isProtectedByGoI: GoI caster's own spells
// ============================================================

console.log('\n=== Phase 3 — GoI caster self-exclusion ===\n');

{
  // 3a. The GoI caster itself is checked first (own effect), so their own
  //     spells are NOT blocked. This is the existing behavior.
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goiCaster' }],
  });
  const bf = makeBF([goiCaster]);

  // Self-check: has own GoI → protected from others' spells
  eq('3a. GoI caster: protected from L3', isProtectedByGoI(goiCaster, 3, bf), true);
  eq('3a. GoI caster: NOT protected from L6', isProtectedByGoI(goiCaster, 6, bf), false);
}

// ============================================================
// Phase 4 — filterGoIProtectedTargets with battlefield
// ============================================================

console.log('\n=== Phase 4 — filterGoIProtectedTargets with battlefield ===\n');

{
  // 4a. Ally near GoI caster is filtered out of AoE target list
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goiCaster' }],
  });
  const allyNearby = makeCombatant('allyNear', { pos: { x: 5, y: 6, z: 0 } });
  const allyFar = makeCombatant('allyFar', { pos: { x: 0, y: 0, z: 0 } });
  const bf = makeBF([goiCaster, allyNearby, allyFar]);

  const targets = [goiCaster, allyNearby, allyFar];
  const filtered = filterGoIProtectedTargets(targets, 3, 'enemyCaster', bf);

  // GoI caster has own GoI → filtered out
  // allyNearby is within 10 ft of GoI caster → filtered out
  // allyFar is too far → NOT filtered out
  const filteredIds = filtered.map(t => t.id);
  assert('4a. GoI caster filtered out', !filteredIds.includes('goiCaster'));
  assert('4a. Ally nearby filtered out', !filteredIds.includes('allyNear'));
  assert('4a. Ally far NOT filtered out', filteredIds.includes('allyFar'));
}

{
  // 4b. Caster's own GoI does NOT block their own spells (casterId check).
  //     Session 81 fix: when the spell's caster is INSIDE the GoI barrier
  //     (here the GoI caster themselves), PHB p.245's "cast from outside
  //     the barrier" clause means the barrier provides NO protection — so
  //     allies within the radius are NOT filtered either.
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goiCaster' }],
  });
  const allyNearby = makeCombatant('allyNear', { pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([goiCaster, allyNearby]);

  const targets = [goiCaster, allyNearby];
  // Caster is the GoI caster themselves
  const filtered = filterGoIProtectedTargets(targets, 3, 'goiCaster', bf);

  const filteredIds = filtered.map(t => t.id);
  // Caster's own GoI doesn't block their own spells
  assert('4b. GoI caster NOT filtered (own spell)', filteredIds.includes('goiCaster'));
  // Session 81: the GoI caster is INSIDE the barrier, so their AoE spell
  // is "cast from inside" and DOES affect allies within the radius.
  // PHB p.245: "Any spell of 5th level or lower cast from OUTSIDE the
  // barrier can't affect creatures or objects within it." — only outside.
  assert('4b. Ally near GoI caster NOT filtered (Session 81: caster inside barrier)', filteredIds.includes('allyNear'));
}

{
  // 4c. Cantrip bypass: cantrips never filtered regardless of GoI
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goiCaster' }],
  });
  const allyNearby = makeCombatant('allyNear', { pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([goiCaster, allyNearby]);

  const targets = [goiCaster, allyNearby];
  const filtered = filterGoIProtectedTargets(targets, 0, 'enemyCaster', bf);

  assert('4c. Cantrip: GoI caster NOT filtered', filtered.map(t => t.id).includes('goiCaster'));
  assert('4c. Cantrip: Ally near GoI NOT filtered', filtered.map(t => t.id).includes('allyNear'));
}

{
  // 4d. Upcast GoI (L7, threshold 6): blocks L6 but not L7
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(6, 7), casterId: 'goiCaster' }],  // L7 GoI: threshold 6
  });
  const allyNearby = makeCombatant('allyNear', { pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([goiCaster, allyNearby]);

  const targets = [allyNearby];
  const filtered6 = filterGoIProtectedTargets(targets, 6, 'enemyCaster', bf);
  const filtered7 = filterGoIProtectedTargets(targets, 7, 'enemyCaster', bf);

  assert('4d. Upcast GoI L7: L6 ally filtered (blocked)', filtered6.length === 0);
  assert('4d. Upcast GoI L7: L7 ally NOT filtered (penetrates)', filtered7.length === 1);
}

// ============================================================
// Phase 5 — Multiple GoI casters
// ============================================================

console.log('\n=== Phase 5 — Multiple GoI casters ===\n');

{
  // 5a. Target between two GoI casters: protected by either
  const goiCaster1 = makeCombatant('goi1', {
    pos: { x: 3, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goi1' }],
  });
  const goiCaster2 = makeCombatant('goi2', {
    pos: { x: 7, y: 5, z: 0 },
    activeEffects: [{ ...makeGoIEffect(4), casterId: 'goi2' }],  // threshold 4 (if L6)
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 5, z: 0 } });  // 2 squares from each
  const bf = makeBF([goiCaster1, goiCaster2, ally]);

  // ally is within 10 ft of goi1 (chebyshev = 2) → protected by threshold 5
  eq('5a. Between two GoI casters: L3 blocked', isProtectedByGoI(ally, 3, bf), true);
  // L5 blocked by goi1 (5 ≤ 5), but not by goi2 (5 > 4)
  eq('5a. Between two GoI casters: L5 blocked by goi1', isProtectedByGoI(ally, 5, bf), true);
}

{
  // 5b. Target near only one GoI caster (the other is too far)
  const goiCaster1 = makeCombatant('goi1', {
    pos: { x: 0, y: 0, z: 0 },
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goi1' }],
  });
  const goiCaster2 = makeCombatant('goi2', {
    pos: { x: 20, y: 20, z: 0 },  // very far
    activeEffects: [{ ...makeGoIEffect(5), casterId: 'goi2' }],
  });
  const ally = makeCombatant('ally', { pos: { x: 1, y: 0, z: 0 } });  // near goi1 only
  const bf = makeBF([goiCaster1, goiCaster2, ally]);

  eq('5b. Near one GoI only: L3 blocked', isProtectedByGoI(ally, 3, bf), true);
}

// ============================================================
// Phase 6 — combatantsWithinRadiusFt helper
// ============================================================

console.log('\n=== Phase 6 — combatantsWithinRadiusFt helper ===\n');

{
  const c1 = makeCombatant('c1', { pos: { x: 0, y: 0, z: 0 } });
  const c2 = makeCombatant('c2', { pos: { x: 1, y: 0, z: 0 } });  // 5 ft
  const c3 = makeCombatant('c3', { pos: { x: 2, y: 0, z: 0 } });  // 10 ft
  const c4 = makeCombatant('c4', { pos: { x: 3, y: 0, z: 0 } });  // 15 ft
  const c5 = makeCombatant('c5', { pos: { x: 0, y: 0, z: 0 }, isDead: true });
  const bf = makeBF([c1, c2, c3, c4, c5]);

  const within10 = combatantsWithinRadiusFt({ x: 0, y: 0, z: 0 }, 10, bf);
  const within10Ids = within10.map(c => c.id);

  assert('6a. c1 (self) within 10ft', within10Ids.includes('c1'));
  assert('6a. c2 (5ft) within 10ft', within10Ids.includes('c2'));
  assert('6a. c3 (10ft) within 10ft', within10Ids.includes('c3'));
  assert('6a. c4 (15ft) NOT within 10ft', !within10Ids.includes('c4'));
  assert('6a. c5 (dead) NOT within 10ft', !within10Ids.includes('c5'));
}

// ============================================================
// Phase 7 — Metadata checks
// ============================================================

console.log('\n=== Phase 7 — Metadata checks ===\n');

{
  const meta = require('../spells/globe_of_invulnerability').metadata;
  eq('7a. globeOfInvulnerabilityRadiusV1Implemented', meta.globeOfInvulnerabilityRadiusV1Implemented, true);
  eq('7b. globeOfInvulnerabilityV1Simplified still false', meta.globeOfInvulnerabilityV1Simplified, false);
  eq('7c. globeOfInvulnerabilityAoEV1Simplified still false', meta.globeOfInvulnerabilityAoEV1Simplified, false);
  eq('7d. globeOfInvulnerabilityImplemented still true', meta.globeOfInvulnerabilityImplemented, true);
  // Session 81: caster-inside-barrier flag
  eq('7e. globeOfInvulnerabilityCasterInsideV1Implemented (Session 81)', meta.globeOfInvulnerabilityCasterInsideV1Implemented, true);
}

// ============================================================
// Results
// ============================================================

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n❌ SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('\nAll tests passed ✅');
}
