// ============================================================
// Test: Session 85 — Eldritch Blast multi-target per beam
//
// PHB p.237 (Eldritch Blast): "You can direct the beams at the same
// target or at different ones. Make a separate attack roll for each
// beam."
//
// Prior state (Session 80): multi-BEAM was implemented (beam count
// scales by cantrip tier: 1/2/3/4 beams at levels 1/5/11/17). However,
// all beams targeted the SAME enemy. If beam 1 killed the target,
// beams 2-4 were wasted (the attackCount loop broke on death). This
// was documented as "v1 simplification: all beams target the same
// enemy. RAW allows targeting different enemies, but that requires AI
// planner support for per-beam targeting (deferred)."
//
// Session 85 fix: when an EB beam kills the primary target, remaining
// beams re-target to the next-best living enemy in range (closest,
// tie-broken by highest maxHP/threat). This prevents wasted beams and
// approximates the RAW multi-target choice. The AI still focus-fires
// on one primary target (planner picks one); the engine handles
// re-targeting on kill. A deliberate "spread damage" AI heuristic
// (firing beams at different living targets from the start) is NOT
// implemented — focus-fire-then-switch is the v1 strategy.
//
// Extra Attack / Thirsting Blade preserve v1 break-on-death behavior
// (PHB p.192 allows splitting attacks, but v1 simplifies to focus-fire
// on one target; re-targeting is EB-specific because EB's cantrip
// scaling uniquely produces multiple independent attack rolls).
//
// Run: npx ts-node --transpile-only src/test/session85_eldritch_blast_multitarget.test.ts
// ============================================================

import { Combatant, Action, Condition, Battlefield } from '../types/core';
import { executePlannedAction, EngineState, pickNextEldritchBlastTarget } from '../engine/combat';
import { cantripTier } from '../engine/utils';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 1000, currentHP: 1000, ac: 10, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16,
    cr: 1,
    pos: { x: 5, y: 5, z: 0 },
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

function makeBF(combatants: Combatant[]): Battlefield {
  return {
    width: 60, height: 60, depth: 5,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

/** EB action with guaranteed hit (high hitBonus) and 1d10 damage. */
const EB_ACTION: Action = {
  name: 'Eldritch Blast', isMultiattack: false, attackType: 'spell',
  reach: 120, range: { normal: 120, long: 240 },
  hitBonus: 20, damage: { count: 1, sides: 10, bonus: 0, average: 5 },
  damageType: 'force', isAoE: false, isControl: false,
  requiresConcentration: false, slotLevel: 0, costType: 'action',
  legendaryCost: 0, description: 'Eldritch Blast',
  saveDC: null, saveAbility: null,
  noCantripScaling: true,
};

/** A generic melee attack action (for Extra Attack break-on-death test). */
const MELEE_ACTION: Action = {
  name: 'Attack', isMultiattack: false, attackType: 'melee',
  reach: 5, range: { normal: 5, long: 5 },
  hitBonus: 20, damage: { count: 1, sides: 10, bonus: 0, average: 5 },
  damageType: 'slashing', isAoE: false, isControl: false,
  requiresConcentration: false, slotLevel: 0, costType: 'action',
  legendaryCost: 0, description: 'Attack',
  saveDC: null, saveAbility: null,
  noCantripScaling: false,
};

/** Count log events of a given type from a given actor. */
function countEvents(state: EngineState, actorId: string, types: string[]): number {
  return state.log.events.filter((e: any) =>
    types.includes(e.type) && e.actorId === actorId
  ).length;
}

/** Count attack events (hit/crit/miss) from actorId targeting a specific target. */
function countAttacksOn(state: EngineState, actorId: string, targetId: string): number {
  return state.log.events.filter((e: any) =>
    ['attack_hit', 'attack_crit', 'attack_miss'].includes(e.type) &&
    e.actorId === actorId && e.targetId === targetId
  ).length;
}

/** Find the first log event matching a substring in description. */
function findLogEvent(state: EngineState, substring: string): any | undefined {
  return state.log.events.find((e: any) =>
    typeof e.description === 'string' && e.description.includes(substring)
  );
}

// ============================================================
// Phase 1 — Metadata: multiTargetPerBeamV1Implemented
// ============================================================

console.log('\n=== Phase 1 — Metadata flag ===\n');

{
  const meta = require('../spells/eldritch_blast').metadata;
  eq('1a. multiTargetPerBeamV1Implemented is true', meta.multiTargetPerBeamV1Implemented, true);
  eq('1b. multiBeamV1Implemented still true', meta.multiBeamV1Implemented, true);
}

// ============================================================
// Phase 2 — pickNextEldritchBlastTarget helper
// ============================================================

console.log('\n=== Phase 2 — pickNextEldritchBlastTarget helper ===\n');

{
  const caster = makeCombatant('wiz', { pos: { x: 0, y: 0, z: 0 } });
  const enemy1 = makeCombatant('e1', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 }, maxHP: 50 });   // 5 ft
  const enemy2 = makeCombatant('e2', { faction: 'enemy', pos: { x: 5, y: 0, z: 0 }, maxHP: 100 });  // 25 ft
  const enemy3 = makeCombatant('e3', { faction: 'enemy', pos: { x: 10, y: 0, z: 0 }, maxHP: 200 }); // 50 ft
  const bf = makeBF([caster, enemy1, enemy2, enemy3]);

  // 2a. Fallen target = e1 → next closest is e2 (25 ft).
  const next1 = pickNextEldritchBlastTarget(caster, 'e1', EB_ACTION, bf);
  eq('2a. After e1 falls, next target is e2 (closest)', next1?.id, 'e2');

  // 2b. Fallen target = e2 → next closest is e1 (5 ft).
  const next2 = pickNextEldritchBlastTarget(caster, 'e2', EB_ACTION, bf);
  eq('2b. After e2 falls, next target is e1 (closest)', next2?.id, 'e1');

  // 2c. Tie-break by highest maxHP (threat). Two enemies at same distance.
  const caster2 = makeCombatant('wiz2', { pos: { x: 0, y: 0, z: 0 } });
  const nearLow = makeCombatant('nl', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 }, maxHP: 30 });
  const nearHigh = makeCombatant('nh', { faction: 'enemy', pos: { x: 0, y: 1, z: 0 }, maxHP: 90 });
  const bf2 = makeBF([caster2, nearLow, nearHigh]);
  const next3 = pickNextEldritchBlastTarget(caster2, 'none', EB_ACTION, bf2);
  eq('2c. Tie at 5 ft → highest threat (nh, 90 HP)', next3?.id, 'nh');

  // 2d. No other enemies → null.
  const solo = makeCombatant('solo', { pos: { x: 0, y: 0, z: 0 } });
  const onlyEnemy = makeCombatant('only', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf3 = makeBF([solo, onlyEnemy]);
  const next4 = pickNextEldritchBlastTarget(solo, 'only', EB_ACTION, bf3);
  eq('2d. No other enemy → null', next4, null);

  // 2e. Enemy out of range → null (only enemy beyond 120 ft).
  const farCaster = makeCombatant('fc', { pos: { x: 0, y: 0, z: 0 } });
  const farEnemy = makeCombatant('fe', { faction: 'enemy', pos: { x: 25, y: 0, z: 0 } }); // 125 ft > 120
  const bf4 = makeBF([farCaster, farEnemy]);
  const next5 = pickNextEldritchBlastTarget(farCaster, 'fallen', EB_ACTION, bf4);
  eq('2e. Enemy at 125 ft (> 120 range) → null', next5, null);

  // 2f. Dead/unconscious enemies are excluded (livingEnemiesOf filters them).
  const caster3 = makeCombatant('wiz3', { pos: { x: 0, y: 0, z: 0 } });
  const deadEnemy = makeCombatant('de', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 }, isDead: true });
  const livingEnemy = makeCombatant('le', { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf5 = makeBF([caster3, deadEnemy, livingEnemy]);
  const next6 = pickNextEldritchBlastTarget(caster3, 'fallen', EB_ACTION, bf5);
  eq('2f. Dead enemy excluded → living enemy (le) selected', next6?.id, 'le');

  // 2g. Eldritch Spear range (300 ft) — enemy at 150 ft is in range.
  const spearAction = { ...EB_ACTION, range: { normal: 300, long: 600 } };
  const spearCaster = makeCombatant('sc', { pos: { x: 0, y: 0, z: 0 } });
  const distEnemy = makeCombatant('dist', { faction: 'enemy', pos: { x: 30, y: 0, z: 0 } }); // 150 ft
  const bf6 = makeBF([spearCaster, distEnemy]);
  const next7 = pickNextEldritchBlastTarget(spearCaster, 'fallen', spearAction, bf6);
  eq('2g. Eldritch Spear range 300 ft: enemy at 150 ft in range', next7?.id, 'dist');
}

// ============================================================
// Phase 3 — Engine: EB re-targets on kill (2 beams)
//
// NOTE: PHB p.194 — a natural 1 is an auto-miss regardless of hitBonus/AC.
// With hitBonus +20 vs AC 1, beam 1 hits ~95% of the time. To make this test
// deterministic, we retry up to 20 times until beam 1 kills primary (chance
// of 20 consecutive nat-1 misses ≈ 0.05^20 ≈ 10^-26 — effectively impossible).
// ============================================================

console.log('\n=== Phase 3 — Engine: EB re-targets on kill ===\n');

{
  const caster = makeCombatant('wiz', {
    casterLevel: 5,
    pos: { x: 0, y: 0, z: 0 },
    cha: 16,
  });
  const primary = makeCombatant('primary', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 1, currentHP: 1, ac: 1, name: 'Primary',
  });
  const secondary = makeCombatant('secondary', {
    faction: 'enemy', pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, ac: 1, name: 'Secondary',
  });
  const bf = makeBF([caster, primary, secondary]);
  const state = makeState(bf);

  const plan = {
    type: 'attack' as const,
    action: EB_ACTION,
    targetId: 'primary',
    description: 'Eldritch Blast',
    attackCount: 2,  // cantripTier(5) + 1 = 2 beams
  };

  // Retry until beam 1 kills primary AND beam 2 retargets to secondary.
  // Handles the 5% nat-1 auto-miss on beam 1 (which would leave primary alive
  // for beam 2, preventing the retarget). Condition: retarget log exists.
  let retargetLog: any;
  let attackEvents = 0;
  let attacksOnSecondary = 0;
  let success = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    // Reset state for retry.
    primary.currentHP = 1; primary.isDead = false; primary.isUnconscious = false;
    secondary.currentHP = 1000;
    state.log.events = [];

    executePlannedAction(caster, plan, state);

    retargetLog = findLogEvent(state, 'retargets Eldritch Beam');
    if (retargetLog) {
      // Beam 1 killed primary → beam 2 retargeted. Capture metrics.
      attackEvents = countEvents(state, caster.id, ['attack_hit', 'attack_crit', 'attack_miss']);
      attacksOnSecondary = countAttacksOn(state, caster.id, 'secondary');
      success = true;
      break;
    }
  }

  // 3a. Retarget log emitted (beam 1 killed primary, beam 2 retargeted).
  assert('3a. Retarget log emitted (beam 1 kill → beam 2 retarget)', success,
    `log: ${JSON.stringify(state.log.events.map((e:any)=>e.description))}`);

  // 3b. Retarget log targets secondary.
  assert('3b. Retarget log targets secondary', retargetLog?.targetId === 'secondary');

  // 3c. Beam 2 was aimed at secondary (attack event on secondary, regardless
  //      of hit/miss — handles the 5% nat-1 miss on beam 2).
  eq('3c. Beam 2 aimed at secondary (attack event on secondary)', attacksOnSecondary, 1);

  // 3d. Two attack events from caster (beam 1 on primary + beam 2 on secondary).
  eq('3d. Two attack events (beam 1 + beam 2)', attackEvents, 2);
}

// ============================================================
// Phase 4 — Engine: EB no other target in range → beam not fired
// ============================================================

console.log('\n=== Phase 4 — Engine: EB no other target → beam not fired ===\n');

{
  const caster = makeCombatant('wiz', {
    casterLevel: 5,
    pos: { x: 0, y: 0, z: 0 },
    cha: 16,
  });
  const primary = makeCombatant('primary', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 1, currentHP: 1, ac: 1, name: 'Primary',
  });
  // No secondary enemy — only the primary.
  const bf = makeBF([caster, primary]);
  const state = makeState(bf);

  const plan = {
    type: 'attack' as const,
    action: EB_ACTION,
    targetId: 'primary',
    description: 'Eldritch Blast',
    attackCount: 2,
  };

  // Retry until beam 1 kills primary AND beam 2 is "not fired".
  // Handles the 5% nat-1 auto-miss on beam 1. Condition: "not fired" log exists.
  let notFiredLog: any;
  let attackEvents = 0;
  let success = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    primary.currentHP = 1; primary.isDead = false; primary.isUnconscious = false;
    state.log.events = [];

    executePlannedAction(caster, plan, state);

    notFiredLog = findLogEvent(state, 'not fired');
    if (notFiredLog) {
      // Beam 1 killed primary → beam 2 not fired (no other target).
      attackEvents = countEvents(state, caster.id, ['attack_hit', 'attack_crit', 'attack_miss']);
      success = true;
      break;
    }
  }

  // 4a. "not fired" log emitted (beam 1 kill → beam 2 not fired).
  assert('4a. "not fired" log emitted (beam 1 kill → beam 2 wasted)', success,
    `log: ${JSON.stringify(state.log.events.map((e:any)=>e.description))}`);

  // 4b. Only one attack event (beam 1 only; beam 2 not fired).
  eq('4b. Only one attack event (beam 2 not fired)', attackEvents, 1);
}

// ============================================================
// Phase 5 — Engine: EB primary survives → both beams same target
// ============================================================

console.log('\n=== Phase 5 — Engine: EB primary survives both beams ===\n');

{
  const caster = makeCombatant('wiz', {
    casterLevel: 5,
    pos: { x: 0, y: 0, z: 0 },
    cha: 16,
  });
  // Primary has 1000 HP — survives both beams (2d10 = 2-20 damage).
  const primary = makeCombatant('primary', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, ac: 1, name: 'Primary',
  });
  const secondary = makeCombatant('secondary', {
    faction: 'enemy', pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, ac: 1, name: 'Secondary',
  });
  const bf = makeBF([caster, primary, secondary]);
  const state = makeState(bf);

  const plan = {
    type: 'attack' as const,
    action: EB_ACTION,
    targetId: 'primary',
    description: 'Eldritch Blast',
    attackCount: 2,
  };
  executePlannedAction(caster, plan, state);

  // 5a. Primary is NOT dead (survived both beams).
  assert('5a. Primary survived both beams', !primary.isDead && primary.currentHP > 0);

  // 5b. No retarget log (both beams hit primary).
  const retargetLog = findLogEvent(state, 'retargets');
  assert('5b. No retarget log (same target)', retargetLog === undefined);

  // 5c. Secondary took no damage (not targeted).
  eq('5c. Secondary took no damage', secondary.currentHP, 1000);

  // 5d. Two attack events, both targeting primary.
  const attackEvents = countEvents(state, caster.id, ['attack_hit', 'attack_crit', 'attack_miss']);
  eq('5d. Two attack events (both on primary)', attackEvents, 2);

  // 5e. Primary took damage (both beams hit).
  assert('5e. Primary took damage from both beams', primary.currentHP < 1000);
}

// ============================================================
// Phase 6 — Engine: Extra Attack (non-EB) breaks on death (no retarget)
// ============================================================

console.log('\n=== Phase 6 — Engine: Extra Attack break-on-death (no retarget) ===\n');

{
  // Fighter with Extra Attack (attackCount=2). Primary has 1 HP (dies on attack 1).
  // Secondary is adjacent. v1 behavior: attack 2 is NOT fired (break-on-death).
  const fighter = makeCombatant('fighter', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    str: 16,
  });
  const primary = makeCombatant('primary', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 1, currentHP: 1, ac: 1, name: 'Primary',
  });
  const secondary = makeCombatant('secondary', {
    faction: 'enemy', pos: { x: 0, y: 1, z: 0 },
    maxHP: 1000, currentHP: 1000, ac: 1, name: 'Secondary',
  });
  const bf = makeBF([fighter, primary, secondary]);
  const state = makeState(bf);

  const plan = {
    type: 'attack' as const,
    action: MELEE_ACTION,  // generic melee Attack (NOT Eldritch Blast)
    targetId: 'primary',
    description: 'Attack',
    attackCount: 2,  // Extra Attack
  };

  // Retry until attack 1 kills primary AND attack 2 is skipped (break-on-death).
  // Handles the 5% nat-1 auto-miss on attack 1. Condition: primary dead AND
  // only 1 attack event (attack 2 skipped). If attack 1 missed, primary
  // survives to attack 2 → 2 attack events → retry.
  let retargetLog: any;
  let attackEvents = 0;
  let success = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    primary.currentHP = 1; primary.isDead = false; primary.isUnconscious = false;
    secondary.currentHP = 1000;
    state.log.events = [];

    executePlannedAction(fighter, plan, state);

    attackEvents = countEvents(state, fighter.id, ['attack_hit', 'attack_crit', 'attack_miss']);
    // Success = primary killed on attack 1 (so attack 2 was skipped: 1 event total).
    if ((primary.isDead || primary.isUnconscious) && attackEvents === 1) {
      retargetLog = findLogEvent(state, 'retargets');
      success = true;
      break;
    }
  }

  // 6a. Primary killed on attack 1 (attack 2 skipped via break-on-death).
  assert('6a. Primary killed on attack 1, attack 2 skipped (within 20 attempts)', success,
    `attackEvents=${attackEvents}, primary.isDead=${primary.isDead}`);

  // 6b. No retarget log (Extra Attack does NOT retarget).
  assert('6b. No retarget log for Extra Attack', retargetLog === undefined);

  // 6c. Secondary took no damage (not retargeted).
  eq('6c. Secondary took no damage (no retarget)', secondary.currentHP, 1000);

  // 6d. Only one attack event (attack 2 skipped via break-on-death).
  eq('6d. Only one attack event (break-on-death)', attackEvents, 1);
}

// ============================================================
// Phase 7 — Source-presence checks
// ============================================================

console.log('\n=== Phase 7 — Source-presence checks ===\n');

{
  const fs = require('fs');
  const path = require('path');

  // 7a. combat.ts exports pickNextEldritchBlastTarget.
  const combatSrc = fs.readFileSync(path.join(__dirname, '..', 'engine', 'combat.ts'), 'utf8');
  assert('7a. combat.ts exports pickNextEldritchBlastTarget',
    combatSrc.includes('export function pickNextEldritchBlastTarget'));

  // 7b. combat.ts attack loop has the EB retarget check.
  assert('7b. combat.ts has EB retarget via pickNextEldritchBlastTarget',
    combatSrc.includes('pickNextEldritchBlastTarget(actor, currentTarget.id, plan.action, bf)'));

  // 7c. combat.ts has the "retargets Eldritch Beam" log.
  assert('7c. combat.ts has "retargets Eldritch Beam" log',
    combatSrc.includes('retargets Eldritch Beam'));

  // 7d. combat.ts has the "not fired" log for no-target case.
  assert('7d. combat.ts has "not fired" log',
    combatSrc.includes('Eldritch Beam(s) not fired'));

  // 7e. combat.ts preserves non-EB break-on-death.
  assert('7e. combat.ts has non-EB break-on-death guard',
    combatSrc.includes('if (!isEB) break;'));

  // 7f. eldritch_blast.ts metadata has multiTargetPerBeamV1Implemented: true.
  const ebSrc = fs.readFileSync(path.join(__dirname, '..', 'spells', 'eldritch_blast.ts'), 'utf8');
  assert('7f. eldritch_blast.ts has multiTargetPerBeamV1Implemented: true',
    ebSrc.includes('multiTargetPerBeamV1Implemented: true as const'));
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
