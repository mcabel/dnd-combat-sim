// ============================================================
// Test: Session 81 — Ready action defensive no-op stub
//
// PHB p.193: "you take the Ready action so you can act later in
// the round using your reaction."
//
// Prior state: `case 'ready':` in executePlannedAction() FELL
// THROUGH to `case 'bardicInspiration':`. The AI planner never
// emits a 'ready' plan today, so this was a dormant bug — but if
// a 'ready' plan ever surfaced, it would have incorrectly granted
// a Bardic Inspiration die to the target.
//
// Session 81: `case 'ready':` is now its own branch — a defensive
// no-op stub that logs the action, consumes the action budget, and
// breaks (no fall-through). Full Ready Action implementation
// (trigger taxonomy + AI heuristic + reaction plumbing) is tracked
// as a follow-up.
//
// This test dispatches a synthetic 'ready' plan directly via
// executePlannedAction and verifies:
//   1. The action budget is consumed.
//   2. A log event is emitted.
//   3. Bardic Inspiration logic did NOT run (no bardicInspirationDie
//      set on the target — the latent fall-through bug is gone).
//
// Run: npx ts-node --transpile-only src/test/session81_ready_stub.test.ts
// ============================================================

import { Combatant, Condition, PlannedAction } from '../types/core';
import { executePlannedAction, EngineState } from '../engine/combat';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}

// ---- Helpers ------------------------------------------------

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 14,
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

function makeState(combatants: Combatant[]): EngineState {
  const bf = {
    width: 30, height: 30, depth: 5,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

// ============================================================
// Phase 1 — Ready stub: consumes action + logs + no fall-through
// ============================================================

console.log('\n=== Phase 1 — Ready stub: action consumed, logged, no fall-through ===\n');

{
  const actor = makeCombatant('hero');
  const ally = makeCombatant('ally', { pos: { x: 1, y: 0, z: 0 } });
  const state = makeState([actor, ally]);

  assert('1a. actionUsed false before Ready', actor.budget.actionUsed === false);
  assert('1b. ally bardicInspirationDie null before', ally.bardicInspirationDie === null);

  const plan: PlannedAction = {
    type: 'ready',
    action: null,
    targetId: 'ally',          // set to verify BI does NOT get applied
    description: 'hero takes the Ready action (test).',
  };

  executePlannedAction(actor, plan, state);

  // 1. Action budget consumed (turn progresses).
  assert('1c. actionUsed true after Ready', actor.budget.actionUsed === true);

  // 2. A log event was emitted.
  const readyLog = state.log.events.find(e =>
    e.type === 'action' && e.actorId === 'hero' && e.description.includes('Ready'),
  );
  assert('1d. Ready action logged', readyLog !== undefined);

  // 3. CRITICAL: Bardic Inspiration logic did NOT run — the fall-through
  //    bug is gone. The ally must NOT have received a bardicInspirationDie.
  assert('1e. ally bardicInspirationDie still null (no fall-through to Bardic Inspiration)', ally.bardicInspirationDie === null);
}

// ============================================================
// Phase 2 — Ready stub: default description when plan.description empty
// ============================================================

console.log('\n=== Phase 2 — Ready stub: default description ===\n');

{
  const actor = makeCombatant('hero2');
  const state = makeState([actor]);

  const plan: PlannedAction = {
    type: 'ready',
    action: null,
    targetId: null,
    description: '',   // empty → stub uses its own default text
  };

  executePlannedAction(actor, plan, state);

  assert('2a. actionUsed true', actor.budget.actionUsed === true);
  const readyLog = state.log.events.find(e =>
    e.type === 'action' && e.actorId === 'hero2' && e.description.includes('Ready'),
  );
  assert('2b. default Ready description logged', readyLog !== undefined);
}

// ============================================================
// Phase 3 — Source-code presence: 'ready' no longer falls through
// ============================================================

console.log('\n=== Phase 3 — Source-code presence ===\n');

{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine', 'combat.ts'), 'utf8');

  // The fall-through pattern `case 'ready':\n    case 'bardicInspiration':` must be GONE.
  assert('3a. no fall-through from ready to bardicInspiration',
    !/case 'ready':\s*\n\s*case 'bardicInspiration':/.test(src));

  // 'ready' must have its own break (dedicated branch).
  assert('3b. ready branch has its own break + comment',
    /case 'ready': \{[\s\S]*?Ready action[\s\S]*?break;/.test(src));
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
