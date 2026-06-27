// ============================================================
// Test: Session 87 — Globe of Invulnerability broader RAW reading:
//       caster-inside-barrier SPATIAL case (PHB p.245)
//
// PHB p.245: "An immobile, faintly shimmering barrier springs into
// existence in a 10-foot radius around you and remains for the
// duration. Any spell of 5th level or lower cast from outside the
// barrier can't affect creatures or objects within it, even if the
// spell is cast using a higher spell slot. Such a spell can target
// creatures and objects within the barrier, but the spell has no
// effect on them."
//
// Session 81 established the identity case: when the spell's caster IS
// the GoI caster who owns a barrier (casterId === barrier center's id),
// that barrier provides NO protection — the spell is "cast from inside
// the barrier".
//
// Session 87 closes the broader RAW reading: ANY combatant standing
// WITHIN a barrier's 10-ft radius (not just the barrier's owner) counts
// as "inside" the barrier. PHB p.245 only blocks spells "cast from
// outside the barrier"; the converse is that spells cast from INSIDE
// the barrier (caster within 10 ft of the barrier center) DO affect
// creatures within it. Previously, an attacker standing inside an
// ally's GoI radius was wrongly treated as "outside" and their spells
// were blocked for creatures within that GoI.
//
// This test file validates the spatial case directly:
//   - An attacker within 10 ft of a GoI caster → GoI provides NO protection
//     for any creature within that GoI barrier (caster is "inside").
//   - An attacker at exactly 10 ft (2 squares Chebyshev) → still "inside".
//   - An attacker > 10 ft away → "outside" (GoI protects, backward compat).
//   - A dead/unconscious attacker within 10 ft → NOT "inside" (can't cast).
//   - The identity case (Session 81) still works as a subset.
//
// Run: npx ts-node --transpile-only src/test/session87_goi_caster_inside_spatial.test.ts
// ============================================================

import { Combatant, Action, PlayerResources, Condition, ActiveEffect } from '../types/core';
import { isProtectedByGoI, filterGoIProtectedTargets } from '../engine/spell_effects';
import { execute as fbExecute } from '../spells/fireball';
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

function withSlots(slots: { [level: number]: { max: number; remaining: number } }): PlayerResources {
  return { spellSlots: slots };
}

/** Construct a GoI ActiveEffect owned by `ownerId` with the given blockThreshold. */
function makeGoIEffect(blockThreshold: number, ownerId: string, sourceSlotLevel: number = 6): ActiveEffect {
  return {
    id: `eff_goi_${ownerId}_${blockThreshold}`,
    casterId: ownerId,
    spellName: 'Globe of Invulnerability',
    effectType: 'spell_shield',
    sourceSlotLevel,
    sourceIsConcentration: true,
    payload: { blockThreshold },
  } as ActiveEffect;
}

const FIREBALL_ACTION: Action = {
  name: 'Fireball', isMultiattack: false, attackType: 'save',
  reach: 5, range: { normal: 150, long: 150 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
  requiresConcentration: false, slotLevel: 3, costType: 'action',
  legendaryCost: 0, description: 'Fireball',
};

// ============================================================
// Phase 1 — isProtectedByGoI: spatial caster-inside-barrier
// ============================================================

console.log('\n=== Phase 1 — isProtectedByGoI: spatial caster-inside ===\n');

{
  // 1a. Attacker within 10 ft of GoI caster (NOT the GoI caster themselves).
  //      GoI provides NO protection — the attacker is "inside" the barrier.
  //      GoI caster at (5,5,0); attacker at (5,6,0) — 5 ft away (1 square).
  //      Target = ally at (5,7,0) — within GoI radius (2 squares from GoI caster).
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 7, z: 0 } });  // 10 ft from GoI caster
  const attacker = makeCombatant('attacker', { pos: { x: 5, y: 6, z: 0 } });  // 5 ft from GoI caster
  const bf = makeBF([goiCaster, ally, attacker]);

  // External attacker far away: ally protected.
  eq('1a. Far attacker: ally protected from L3', isProtectedByGoI(ally, 3, bf, 'farAway'), true);
  // Attacker within 10 ft of GoI caster: ally NOT protected (caster inside barrier).
  eq('1a. Near attacker (5 ft): ally NOT protected from L3', isProtectedByGoI(ally, 3, bf, 'attacker'), false);
}

{
  // 1b. Attacker at exactly 10 ft (2 squares Chebyshev) — boundary case.
  //      chebyshev <= 2 means "within 10 ft" → caster is "inside".
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });  // inside radius
  const attackerAt10ft = makeCombatant('attacker10', { pos: { x: 5, y: 7, z: 0 } });  // 2 squares = 10 ft
  const bf = makeBF([goiCaster, ally, attackerAt10ft]);

  // At exactly 10 ft (2 squares): caster is "inside" (chebyshev <= 2).
  eq('1b. Attacker at exactly 10 ft: ally NOT protected (boundary inclusive)', isProtectedByGoI(ally, 3, bf, 'attacker10'), false);
}

{
  // 1c. Attacker at 15 ft (3 squares Chebyshev) — outside the barrier.
  //      GoI protects normally.
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const attackerAt15ft = makeCombatant('attacker15', { pos: { x: 5, y: 8, z: 0 } });  // 3 squares = 15 ft
  const bf = makeBF([goiCaster, ally, attackerAt15ft]);

  // At 15 ft (3 squares): caster is "outside" (chebyshev > 2).
  eq('1c. Attacker at 15 ft: ally protected (outside barrier)', isProtectedByGoI(ally, 3, bf, 'attacker15'), true);
}

{
  // 1d. Diagonal distance: attacker at (7,7,0) is Chebyshev 2 from GoI caster
  //      at (5,5,0) → 10 ft → "inside".
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const attackerDiag = makeCombatant('attackerDiag', { pos: { x: 7, y: 7, z: 0 } });  // Chebyshev 2
  const bf = makeBF([goiCaster, ally, attackerDiag]);

  eq('1d. Diagonal attacker at Chebyshev 2 (10 ft): ally NOT protected', isProtectedByGoI(ally, 3, bf, 'attackerDiag'), false);
}

{
  // 1e. 3D distance: attacker above the GoI caster (z-axis).
  //      Chebyshev 3D includes z. Attacker at (5,5,2) is Chebyshev 2 from
  //      GoI caster at (5,5,0) → 10 ft → "inside".
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const attackerAbove = makeCombatant('attackerAbove', { pos: { x: 5, y: 5, z: 2 } });  // Chebyshev 2 (z-axis)
  const bf = makeBF([goiCaster, ally, attackerAbove]);

  eq('1e. Attacker above (z=2, Chebyshev 2): ally NOT protected', isProtectedByGoI(ally, 3, bf, 'attackerAbove'), false);
}

{
  // 1f. Dead attacker within 10 ft: NOT "inside" (dead combatants can't cast).
  //      GoI protects normally.
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const deadAttacker = makeCombatant('deadAttacker', {
    pos: { x: 5, y: 6, z: 0 },
    isDead: true,
  });
  const bf = makeBF([goiCaster, ally, deadAttacker]);

  eq('1f. Dead attacker within 10 ft: ally protected (dead can\'t cast)', isProtectedByGoI(ally, 3, bf, 'deadAttacker'), true);
}

{
  // 1g. Unconscious attacker within 10 ft: NOT "inside".
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const unconsciousAttacker = makeCombatant('unconAttacker', {
    pos: { x: 5, y: 6, z: 0 },
    isUnconscious: true,
  });
  const bf = makeBF([goiCaster, ally, unconsciousAttacker]);

  eq('1g. Unconscious attacker within 10 ft: ally protected', isProtectedByGoI(ally, 3, bf, 'unconAttacker'), true);
}

{
  // 1h. casterId refers to a combatant NOT in the battlefield → treated as
  //      outside (no spatial match possible). Protection applies normally.
  //      (Backward compat: external attacker ID not represented as a combatant.)
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([goiCaster, ally]);

  eq('1h. casterId not in bf: ally protected from L3', isProtectedByGoI(ally, 3, bf, 'absentCaster'), true);
}

{
  // 1i. casterId undefined (backward compat): caster assumed outside.
  //      Persistent damage-zone tick sites use this pattern.
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([goiCaster, ally]);

  eq('1i. No casterId (backward compat): ally protected from L3', isProtectedByGoI(ally, 3, bf), true);
}

{
  // 1j. Identity case (Session 81) still works: caster IS the GoI caster.
  //      This is a subset of the spatial case (distance 0 ≤ 2).
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([goiCaster, ally]);

  eq('1j. Identity case: GoI caster attacker, ally NOT protected', isProtectedByGoI(ally, 3, bf, 'goiCaster'), false);
}

// ============================================================
// Phase 2 — Multiple GoI barriers: spatial inside one but not another
// ============================================================

console.log('\n=== Phase 2 — Multiple GoI barriers ===\n');

{
  // 2a. Two GoI casters. Attacker is within 10 ft of GoI-A but not GoI-B.
  //      GoI-A provides no protection (attacker inside). GoI-B still protects
  //      (attacker outside GoI-B). A target within GoI-B's radius is protected
  //      by GoI-B even though the attacker is inside GoI-A.
  const goiA = makeCombatant('goiA', {
    pos: { x: 0, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiA')],
  });
  const goiB = makeCombatant('goiB', {
    pos: { x: 20, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiB')],
  });
  const targetNearB = makeCombatant('targetB', { pos: { x: 20, y: 1, z: 0 } });  // within GoI-B radius
  const attackerNearA = makeCombatant('attA', { pos: { x: 1, y: 0, z: 0 } });  // 5 ft from GoI-A
  const bf = makeBF([goiA, goiB, targetNearB, attackerNearA]);

  // Attacker is inside GoI-A (5 ft from goiA), but outside GoI-B (19 squares from goiB).
  // Target near GoI-B is protected by GoI-B (attacker is outside GoI-B).
  eq('2a. Attacker inside GoI-A, target near GoI-B: protected by GoI-B', isProtectedByGoI(targetNearB, 3, bf, 'attA'), true);
}

{
  // 2b. Attacker is within 10 ft of BOTH GoI-A and GoI-B. A target within
  //      either GoI's radius is NOT protected (attacker is inside both barriers).
  const goiA = makeCombatant('goiA', {
    pos: { x: 0, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiA')],
  });
  const goiB = makeCombatant('goiB', {
    pos: { x: 2, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiB')],
  });
  const targetNearA = makeCombatant('targetA', { pos: { x: 0, y: 1, z: 0 } });  // within GoI-A radius
  const attackerBetween = makeCombatant('attBet', { pos: { x: 1, y: 0, z: 0 } });  // 5 ft from both
  const bf = makeBF([goiA, goiB, targetNearA, attackerBetween]);

  // Attacker is inside both GoI-A and GoI-B. Target near GoI-A is NOT protected.
  eq('2b. Attacker inside both GoI: target NOT protected', isProtectedByGoI(targetNearA, 3, bf, 'attBet'), false);
}

// ============================================================
// Phase 3 — filterGoIProtectedTargets: spatial caster-inside
// ============================================================

console.log('\n=== Phase 3 — filterGoIProtectedTargets: spatial ===\n');

{
  // 3a. Attacker within 10 ft of GoI caster casts AoE; allies within the
  //     GoI radius are NOT filtered (caster is inside the barrier).
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const allyNear = makeCombatant('allyNear', { pos: { x: 5, y: 6, z: 0 } });   // 5 ft (inside radius)
  const allyFar = makeCombatant('allyFar', { pos: { x: 20, y: 20, z: 0 } });   // far (outside radius)
  const attacker = makeCombatant('attacker', { pos: { x: 5, y: 7, z: 0 } });   // 10 ft from GoI caster
  const bf = makeBF([goiCaster, allyNear, allyFar, attacker]);

  const targets = [goiCaster, allyNear, allyFar];
  const filtered = filterGoIProtectedTargets(targets, 3, 'attacker', bf);
  const ids = filtered.map(t => t.id);

  // All three retained: GoI caster (attacker inside), allyNear (attacker inside), allyFar (outside radius).
  assert('3a. GoI caster retained (attacker inside barrier)', ids.includes('goiCaster'));
  assert('3a. Ally near retained (attacker inside barrier)', ids.includes('allyNear'));
  assert('3a. Ally far retained (outside radius anyway)', ids.includes('allyFar'));
  eq('3a. No targets filtered out', filtered.length, 3);
}

{
  // 3b. External attacker far away casts AoE; allies within GoI radius ARE filtered
  //     (backward compat / unchanged behavior).
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const allyNear = makeCombatant('allyNear', { pos: { x: 5, y: 6, z: 0 } });
  const allyFar = makeCombatant('allyFar', { pos: { x: 20, y: 20, z: 0 } });
  const bf = makeBF([goiCaster, allyNear, allyFar]);

  const targets = [goiCaster, allyNear, allyFar];
  const filtered = filterGoIProtectedTargets(targets, 3, 'farEnemy', bf);
  const ids = filtered.map(t => t.id);

  assert('3b. GoI caster filtered (external attacker)', !ids.includes('goiCaster'));
  assert('3b. Ally near filtered (external attacker)', !ids.includes('allyNear'));
  assert('3b. Ally far retained (outside radius)', ids.includes('allyFar'));
  eq('3b. Only ally far remains', filtered.length, 1);
}

{
  // 3c. L6 spell penetrates threshold 5: not filtered regardless of caster position.
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const allyNear = makeCombatant('allyNear', { pos: { x: 5, y: 6, z: 0 } });
  const attacker = makeCombatant('attacker', { pos: { x: 5, y: 7, z: 0 } });  // inside barrier
  const bf = makeBF([goiCaster, allyNear, attacker]);

  const filtered = filterGoIProtectedTargets([allyNear], 6, 'attacker', bf);
  eq('3c. L6 penetrates threshold 5: ally retained (even with inside attacker)', filtered.length, 1);
}

// ============================================================
// Phase 4 — Fireball integration: spatial caster-inside
// ============================================================

console.log('\n=== Phase 4 — Fireball integration: spatial caster-inside ===\n');

{
  // 4a. Attacker within 10 ft of GoI caster casts Fireball (L3). The GoI
  //     caster and allies within the GoI radius take damage (GoI provides
  //     no protection — caster is inside the barrier).
  const goiCaster = makeCombatant('goiTarget', {
    faction: 'enemy', dex: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
    activeEffects: [makeGoIEffect(5, 'goiTarget')],
  });
  const allyNear = makeCombatant('allyNear', {
    faction: 'enemy', dex: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const enemyFar = makeCombatant('enemyFar', {
    faction: 'enemy', dex: 1, pos: { x: 10, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  // Attacker at (2,1,0) — Chebyshev 1 from GoI caster at (1,0,0) → 5 ft → inside barrier.
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 2, y: 1, z: 0 },
    actions: [FIREBALL_ACTION],
    resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    int: 20,
  });
  const bf = makeBF([caster, goiCaster, allyNear, enemyFar]);
  const state = makeState(bf);

  const hpGoiBefore = goiCaster.currentHP;
  const hpAllyBefore = allyNear.currentHP;
  const hpEnemyBefore = enemyFar.currentHP;

  fbExecute(caster, [goiCaster, allyNear, enemyFar], state);

  // Caster inside barrier → GoI provides NO protection → all take damage.
  assert('4a. GoI caster takes damage (caster inside barrier)', (hpGoiBefore - goiCaster.currentHP) > 0);
  assert('4a. Ally near takes damage (caster inside barrier)', (hpAllyBefore - allyNear.currentHP) > 0);
  assert('4a. Enemy far takes damage', (hpEnemyBefore - enemyFar.currentHP) > 0);

  // Log should NOT mention GoI exclusion (no targets were excluded).
  const castLog = state.log.events.find(e =>
    e.description.includes('excluded by Globe of Invulnerability')
  );
  assert('4a. Log does NOT mention GoI exclusion (caster inside)', castLog === undefined);
}

{
  // 4b. External attacker (> 10 ft from GoI caster) casts Fireball (L3).
  //     GoI caster and allies within GoI radius take 0 damage (protected).
  //     (Backward compat — verifies the spatial change doesn't break external case.)
  const goiCaster = makeCombatant('goiTarget', {
    faction: 'enemy', dex: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
    activeEffects: [makeGoIEffect(5, 'goiTarget')],
  });
  const allyNear = makeCombatant('allyNear', {
    faction: 'enemy', dex: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const enemyFar = makeCombatant('enemyFar', {
    faction: 'enemy', dex: 1, pos: { x: 10, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  // Attacker at (4,0,0) — Chebyshev 3 from GoI caster at (1,0,0) → 15 ft → outside barrier.
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 4, y: 0, z: 0 },
    actions: [FIREBALL_ACTION],
    resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    int: 20,
  });
  const bf = makeBF([caster, goiCaster, allyNear, enemyFar]);
  const state = makeState(bf);

  const hpGoiBefore = goiCaster.currentHP;
  const hpAllyBefore = allyNear.currentHP;
  const hpEnemyBefore = enemyFar.currentHP;

  fbExecute(caster, [goiCaster, allyNear, enemyFar], state);

  // External attacker → GoI caster & ally within radius filtered (0 damage).
  eq('4b. GoI caster takes 0 damage (external attacker)', hpGoiBefore - goiCaster.currentHP, 0);
  eq('4b. Ally near takes 0 damage (external attacker)', hpAllyBefore - allyNear.currentHP, 0);
  assert('4b. Enemy far takes damage', (hpEnemyBefore - enemyFar.currentHP) > 0);
}

// ============================================================
// Phase 5 — Edge case: attacker moves from inside to outside
// ============================================================

console.log('\n=== Phase 5 — Edge cases ===\n');

{
  // 5a. Same attacker ID, different positions: if the attacker moves away
  //     (> 10 ft), GoI starts protecting again. This simulates the attacker
  //     moving out of the GoI radius between turns.
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const attacker = makeCombatant('attacker', { pos: { x: 5, y: 7, z: 0 } });  // 10 ft (inside)
  const bf = makeBF([goiCaster, ally, attacker]);

  // Attacker at 10 ft: inside → ally NOT protected.
  eq('5a. Attacker at 10 ft: ally NOT protected', isProtectedByGoI(ally, 3, bf, 'attacker'), false);

  // Attacker moves to 15 ft (3 squares): outside → ally protected.
  attacker.pos = { x: 5, y: 8, z: 0 };
  eq('5a. Attacker moves to 15 ft: ally protected', isProtectedByGoI(ally, 3, bf, 'attacker'), true);
}

{
  // 5b. Cantrip (level 0): never blocked by GoI regardless of caster position.
  //      Even if the caster is outside the barrier, cantrips bypass GoI.
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const farAttacker = makeCombatant('farAttacker', { pos: { x: 20, y: 20, z: 0 } });
  const bf = makeBF([goiCaster, ally, farAttacker]);

  eq('5b. Cantrip from far attacker: not protected', isProtectedByGoI(ally, 0, bf, 'farAttacker'), false);
}

{
  // 5c. Penetrating level (L6 vs threshold 5): not protected regardless of
  //      caster position. Even an external attacker's L6 spell penetrates.
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const farAttacker = makeCombatant('farAttacker', { pos: { x: 20, y: 20, z: 0 } });
  const bf = makeBF([goiCaster, ally, farAttacker]);

  eq('5c. L6 from far attacker: not protected (penetrates)', isProtectedByGoI(ally, 6, bf, 'farAttacker'), false);
}

// ============================================================
// Summary
// ============================================================

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
