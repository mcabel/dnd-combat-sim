// ============================================================
// Test: Session 88 — Eldritch Blast spread damage heuristic
//
// PHB p.237 (Eldritch Blast): "You can direct the beams at the same
// target or at different ones. Make a separate attack roll for each
// beam."
//
// Prior state (Session 85): when an EB beam kills the primary target,
// remaining beams re-target to the next-best living enemy in range
// (retarget-on-kill). The AI focus-fires on one primary target; the
// engine handles re-targeting on kill. A deliberate "spread damage"
// AI heuristic — firing beams at different living targets from the
// start — was NOT implemented.
//
// Session 88 fix: the planner now populates `PlannedAction.secondaryTargetIds`
// when EB has multiple beams AND there are other living enemies in range
// that are weak enough to be killed by a single beam (currentHP ≤ max
// beam damage). The engine then directs beams 2+ at the secondary targets
// from the start. If a secondary target is dead, the beam falls back to
// the primary + retarget-on-kill. The default (no secondary targets)
// remains focus-fire-then-switch (Session 85 behavior).
//
// Run: npx ts-node --transpile-only src/test/session88_eb_spread_damage.test.ts
// ============================================================

import { Combatant, Action, Condition, Battlefield, PlannedAction } from '../types/core';
import { executePlannedAction, EngineState } from '../engine/combat';
import { planTurn } from '../ai/planner';
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

/** Count log events matching a substring. */
function countLogEvents(state: EngineState, substring: string): number {
  return state.log.events.filter((e: any) =>
    typeof e.description === 'string' && e.description.includes(substring)
  ).length;
}

// ============================================================
// Phase 1 — Metadata: spreadDamageV1Implemented
// ============================================================

console.log('\n=== Phase 1 — Metadata flag ===\n');

{
  const meta = require('../spells/eldritch_blast').metadata;
  eq('1a. spreadDamageV1Implemented is true', meta.spreadDamageV1Implemented, true);
  eq('1b. multiTargetPerBeamV1Implemented still true', meta.multiTargetPerBeamV1Implemented, true);
  eq('1c. multiBeamV1Implemented still true', meta.multiBeamV1Implemented, true);
}

// ============================================================
// Phase 2 — Engine: 2 beams, secondaryTargetIds set → spread
// ============================================================

console.log('\n=== Phase 2 — Engine: 2 beams spread to 2 targets ===\n');

{
  // 2 beams (attackCount=2), secondaryTargetIds = ['sec'].
  // Beam 1 → primary, beam 2 → sec (spread).
  // Use retry loop because of 5% nat-1 miss rate.
  let success = false;
  for (let attempt = 0; attempt < 20 && !success; attempt++) {
    const caster = makeCombatant('wiz', {
      pos: { x: 0, y: 0, z: 0 },
      actions: [EB_ACTION],
      cha: 16,  // CHA mod = 3
      casterLevel: 5,  // cantripTier = 1 → 2 beams
    });
    const primary = makeCombatant('primary', {
      faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
      maxHP: 1000, currentHP: 1000,  // tanky — won't die from 1 beam
    });
    const secondary = makeCombatant('sec', {
      faction: 'enemy', pos: { x: 2, y: 0, z: 0 },
      maxHP: 1000, currentHP: 1000,  // tanky — won't die from 1 beam
    });
    const bf = makeBF([caster, primary, secondary]);
    const state = makeState(bf);

    const plan: PlannedAction = {
      type: 'attack',
      action: EB_ACTION,
      targetId: 'primary',
      description: `${caster.name} casts Eldritch Blast at ${primary.name}`,
      attackCount: 2,
      secondaryTargetIds: ['sec'],
    };

    executePlannedAction(caster, plan, state);

    const spreadLog = findLogEvent(state, 'directs Eldritch Beam 2/2');
    const attacksOnPrimary = countAttacksOn(state, 'wiz', 'primary');
    const attacksOnSec = countAttacksOn(state, 'wiz', 'sec');

    if (spreadLog && attacksOnPrimary >= 1 && attacksOnSec >= 1) {
      assert('2a. Spread log emitted for beam 2', spreadLog !== undefined);
      assert('2a. Beam 1 attacked primary', attacksOnPrimary >= 1);
      assert('2a. Beam 2 attacked secondary (spread)', attacksOnSec >= 1);
      eq('2a. Total attacks = 2', attacksOnPrimary + attacksOnSec, 2);
      success = true;
    }
  }
  if (!success) {
    assert('2a. Spread scenario achieved (retry loop)', false, '20 attempts failed');
  }
}

// ============================================================
// Phase 3 — Engine: 3 beams, 2 secondary targets → 3 different targets
// ============================================================

console.log('\n=== Phase 3 — Engine: 3 beams spread to 3 targets ===\n');

{
  // 3 beams (attackCount=3), secondaryTargetIds = ['sec1', 'sec2'].
  // Beam 1 → primary, beam 2 → sec1, beam 3 → sec2.
  let success = false;
  for (let attempt = 0; attempt < 20 && !success; attempt++) {
    const caster = makeCombatant('wiz', {
      pos: { x: 0, y: 0, z: 0 },
      actions: [EB_ACTION],
      cha: 16,
      casterLevel: 11,  // cantripTier = 2 → 3 beams
    });
    const primary = makeCombatant('primary', {
      faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
      maxHP: 1000, currentHP: 1000,
    });
    const sec1 = makeCombatant('sec1', {
      faction: 'enemy', pos: { x: 2, y: 0, z: 0 },
      maxHP: 1000, currentHP: 1000,
    });
    const sec2 = makeCombatant('sec2', {
      faction: 'enemy', pos: { x: 3, y: 0, z: 0 },
      maxHP: 1000, currentHP: 1000,
    });
    const bf = makeBF([caster, primary, sec1, sec2]);
    const state = makeState(bf);

    const plan: PlannedAction = {
      type: 'attack',
      action: EB_ACTION,
      targetId: 'primary',
      description: `${caster.name} casts Eldritch Blast at ${primary.name}`,
      attackCount: 3,
      secondaryTargetIds: ['sec1', 'sec2'],
    };

    executePlannedAction(caster, plan, state);

    const spreadLog2 = findLogEvent(state, 'directs Eldritch Beam 2/3');
    const spreadLog3 = findLogEvent(state, 'directs Eldritch Beam 3/3');
    const attacksOnPrimary = countAttacksOn(state, 'wiz', 'primary');
    const attacksOnSec1 = countAttacksOn(state, 'wiz', 'sec1');
    const attacksOnSec2 = countAttacksOn(state, 'wiz', 'sec2');

    if (spreadLog2 && spreadLog3 &&
        attacksOnPrimary >= 1 && attacksOnSec1 >= 1 && attacksOnSec2 >= 1) {
      assert('3a. Spread log for beam 2', spreadLog2 !== undefined);
      assert('3a. Spread log for beam 3', spreadLog3 !== undefined);
      assert('3a. Beam 1 attacked primary', attacksOnPrimary >= 1);
      assert('3a. Beam 2 attacked sec1', attacksOnSec1 >= 1);
      assert('3a. Beam 3 attacked sec2', attacksOnSec2 >= 1);
      eq('3a. Total attacks = 3', attacksOnPrimary + attacksOnSec1 + attacksOnSec2, 3);
      success = true;
    }
  }
  if (!success) {
    assert('3a. 3-beam spread achieved (retry loop)', false, '20 attempts failed');
  }
}

// ============================================================
// Phase 4 — Engine: secondary dead → falls back to retarget-on-kill
// ============================================================

console.log('\n=== Phase 4 — Engine: secondary dead → retarget fallback ===\n');

{
  // 2 beams, secondaryTargetIds = ['sec'] but sec is DEAD.
  // Beam 1 → primary, beam 2 → sec is dead → falls back.
  // Since primary is tanky (1000 HP), beam 2 should retarget to sec
  // (but sec is dead) → no other target → "not fired" or retarget to
  // a third enemy. Let's add a third enemy that can be retargeted to.
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [EB_ACTION],
    cha: 16,
    casterLevel: 5,
  });
  const primary = makeCombatant('primary', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const deadSec = makeCombatant('sec', {
    faction: 'enemy', pos: { x: 2, y: 0, z: 0 },
    maxHP: 100, currentHP: 0, isDead: true,  // already dead
  });
  const thirdEnemy = makeCombatant('third', {
    faction: 'enemy', pos: { x: 3, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, primary, deadSec, thirdEnemy]);
  const state = makeState(bf);

  const plan: PlannedAction = {
    type: 'attack',
    action: EB_ACTION,
    targetId: 'primary',
    description: `${caster.name} casts Eldritch Blast at ${primary.name}`,
    attackCount: 2,
    secondaryTargetIds: ['sec'],  // sec is dead
  };

  executePlannedAction(caster, plan, state);

  // Beam 1 targets primary (alive). Beam 2: sec is dead → currentTarget
  // retains primary (alive) → no retarget needed → beam 2 targets primary.
  // (The spread assignment fails because sec is dead; currentTarget stays
  //  as primary from beam 1. Primary is alive, so no retarget fires.)
  const attacksOnPrimary = countAttacksOn(state, 'wiz', 'primary');
  const attacksOnSec = countAttacksOn(state, 'wiz', 'sec');
  const attacksOnThird = countAttacksOn(state, 'wiz', 'third');

  // No spread log (sec was dead, spread didn't fire)
  const spreadLog = findLogEvent(state, 'directs Eldritch Beam 2/2');
  assert('4a. No spread log (secondary was dead)', spreadLog === undefined);
  // Both beams hit primary (sec was dead, primary was alive, no retarget needed)
  assert('4a. Both beams targeted primary (fallback)', attacksOnPrimary === 2);
  eq('4a. No attacks on dead secondary', attacksOnSec, 0);
  eq('4a. No attacks on third enemy', attacksOnThird, 0);
}

// ============================================================
// Phase 5 — Engine: no secondaryTargetIds → focus-fire (backward compat)
// ============================================================

console.log('\n=== Phase 5 — Engine: no secondary → focus-fire ===\n');

{
  // 2 beams, no secondaryTargetIds → both beams at primary (Session 85 behavior).
  let success = false;
  for (let attempt = 0; attempt < 20 && !success; attempt++) {
    const caster = makeCombatant('wiz', {
      pos: { x: 0, y: 0, z: 0 },
      actions: [EB_ACTION],
      cha: 16,
      casterLevel: 5,
    });
    const primary = makeCombatant('primary', {
      faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
      maxHP: 1000, currentHP: 1000,
    });
    const other = makeCombatant('other', {
      faction: 'enemy', pos: { x: 2, y: 0, z: 0 },
      maxHP: 1000, currentHP: 1000,
    });
    const bf = makeBF([caster, primary, other]);
    const state = makeState(bf);

    const plan: PlannedAction = {
      type: 'attack',
      action: EB_ACTION,
      targetId: 'primary',
      description: `${caster.name} casts Eldritch Blast at ${primary.name}`,
      attackCount: 2,
      // secondaryTargetIds NOT set → focus-fire
    };

    executePlannedAction(caster, plan, state);

    const spreadLog = findLogEvent(state, 'directs Eldritch Beam 2/2');
    const attacksOnPrimary = countAttacksOn(state, 'wiz', 'primary');
    const attacksOnOther = countAttacksOn(state, 'wiz', 'other');

    // No spread log; both beams at primary
    if (!spreadLog && attacksOnPrimary === 2 && attacksOnOther === 0) {
      assert('5a. No spread log (focus-fire)', spreadLog === undefined);
      assert('5a. Both beams at primary', attacksOnPrimary === 2);
      eq('5a. No attacks on other enemy', attacksOnOther, 0);
      success = true;
    }
  }
  if (!success) {
    assert('5a. Focus-fire scenario achieved (retry loop)', false, '20 attempts failed');
  }
}

// ============================================================
// Phase 6 — Planner: populates secondaryTargetIds when weak enemies exist
// ============================================================

console.log('\n=== Phase 6 — Planner: populates secondaryTargetIds ===\n');

{
  // Warlock level 5 (2 beams), CHA 20 (mod 5), Agonizing Blast.
  // Primary enemy: 1000/1000 HP (tanky, healthy — NOT bloodied, highest threat
  //   by proximity). selectSmart picks this as the primary target.
  // Secondary enemy: 10/10 HP (weak — currentHP ≤ maxBeamDamage = 15, but NOT
  //   bloodied since 10 = 10). This avoids the +60 bloodied bonus that would
  //   make the weak enemy the primary target.
  // The planner should populate secondaryTargetIds = ['weak'].
  const caster = makeCombatant('warlock', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [EB_ACTION],
    cha: 20,  // CHA mod = 5
    casterLevel: 5,  // 2 beams
    eldritchInvocations: ['Agonizing Blast'],
    aiProfile: 'smart',
    perception: { targets: new Map() } as any,
  });
  const tanky = makeCombatant('tanky', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },  // 5 ft (closest)
    maxHP: 1000, currentHP: 1000,  // healthy, not bloodied
    ac: 10,
  });
  const weak = makeCombatant('weak', {
    faction: 'enemy', pos: { x: 3, y: 0, z: 0 },  // 15 ft (farther)
    maxHP: 10, currentHP: 10,  // ≤ 15 (max beam damage), NOT bloodied (10 = 10)
    ac: 10,
  });
  // Set perception: both enemies visible
  caster.perception = {
    targets: new Map([
      [tanky.id, { detectionState: 'visible', lastKnownPos: { ...tanky.pos }, lastSeenRound: 1 }],
      [weak.id, { detectionState: 'visible', lastKnownPos: { ...weak.pos }, lastSeenRound: 1 }],
    ]),
  } as any;
  tanky.perception = { targets: new Map() } as any;
  weak.perception = { targets: new Map() } as any;

  const bf = makeBF([caster, tanky, weak]);
  const plan = planTurn(caster, bf);

  assert('6a. Planner chose attack action', plan.action?.type === 'attack');
  assert('6a. Planner chose Eldritch Blast', plan.action?.action?.name === 'Eldritch Blast');
  eq('6a. attackCount = 2 (level 5)', plan.action?.attackCount, 2);
  // Primary should be 'tanky' (closest, not bloodied, no bloodied competitor)
  eq('6a. Primary target is tanky (closest)', plan.action?.targetId, 'tanky');

  // The planner should have populated secondaryTargetIds with 'weak'
  const secIds = plan.action?.secondaryTargetIds;
  assert('6b. secondaryTargetIds is populated', secIds !== undefined && secIds !== null);
  if (secIds) {
    eq('6b. secondaryTargetIds length = 1', secIds.length, 1);
    eq('6b. secondaryTargetIds[0] = weak', secIds[0], 'weak');
  }
}

// ============================================================
// Phase 7 — Planner: no secondary when all enemies are tanky
// ============================================================

console.log('\n=== Phase 7 — Planner: no secondary when all tanky ===\n');

{
  // Warlock level 5 (2 beams), CHA 20, Agonizing Blast.
  // Both enemies have 1000 HP (>> maxBeamDamage = 15).
  // The planner should NOT populate secondaryTargetIds.
  const caster = makeCombatant('warlock', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [EB_ACTION],
    cha: 20,
    casterLevel: 5,
    eldritchInvocations: ['Agonizing Blast'],
    aiProfile: 'smart',
  });
  const enemy1 = makeCombatant('e1', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, ac: 10,
  });
  const enemy2 = makeCombatant('e2', {
    faction: 'enemy', pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, ac: 10,
  });
  caster.perception = {
    targets: new Map([
      [enemy1.id, { detectionState: 'visible', lastKnownPos: { ...enemy1.pos }, lastSeenRound: 1 }],
      [enemy2.id, { detectionState: 'visible', lastKnownPos: { ...enemy2.pos }, lastSeenRound: 1 }],
    ]),
  } as any;
  enemy1.perception = { targets: new Map() } as any;
  enemy2.perception = { targets: new Map() } as any;

  const bf = makeBF([caster, enemy1, enemy2]);
  const plan = planTurn(caster, bf);

  assert('7a. Planner chose Eldritch Blast', plan.action?.action?.name === 'Eldritch Blast');
  // No secondary targets (both enemies have 1000 HP >> 15)
  const secIds = plan.action?.secondaryTargetIds;
  assert('7a. secondaryTargetIds is empty/undefined (all tanky)',
    secIds === undefined || secIds === null || secIds.length === 0);
}

// ============================================================
// Phase 8 — Planner: no secondary for level 1 (single beam)
// ============================================================

console.log('\n=== Phase 8 — Planner: no secondary for single beam ===\n');

{
  // Warlock level 1 (1 beam). Even with weak enemies, no spreading possible.
  const caster = makeCombatant('warlock', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [EB_ACTION],
    cha: 20,
    casterLevel: 1,  // 1 beam
    eldritchInvocations: ['Agonizing Blast'],
    aiProfile: 'smart',
  });
  const enemy1 = makeCombatant('e1', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, ac: 10,
  });
  const weak = makeCombatant('weak', {
    faction: 'enemy', pos: { x: 2, y: 0, z: 0 },
    maxHP: 100, currentHP: 5, ac: 10,  // very weak
  });
  caster.perception = {
    targets: new Map([
      [enemy1.id, { detectionState: 'visible', lastKnownPos: { ...enemy1.pos }, lastSeenRound: 1 }],
      [weak.id, { detectionState: 'visible', lastKnownPos: { ...weak.pos }, lastSeenRound: 1 }],
    ]),
  } as any;
  enemy1.perception = { targets: new Map() } as any;
  weak.perception = { targets: new Map() } as any;

  const bf = makeBF([caster, enemy1, weak]);
  const plan = planTurn(caster, bf);

  eq('8a. attackCount = 1 (level 1)', plan.action?.attackCount, 1);
  // No secondary targets (only 1 beam — can't spread)
  const secIds = plan.action?.secondaryTargetIds;
  assert('8a. secondaryTargetIds is empty/undefined (single beam)',
    secIds === undefined || secIds === null || secIds.length === 0);
}

// ============================================================
// Phase 9 — Planner: secondary excluded when out of range
// ============================================================

console.log('\n=== Phase 9 — Planner: out-of-range secondary excluded ===\n');

{
  // Warlock level 5, EB range 120 ft. Weak enemy at 125 ft (out of range).
  // The planner should NOT include the out-of-range enemy as a secondary.
  const caster = makeCombatant('warlock', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [EB_ACTION],
    cha: 20,
    casterLevel: 5,
    eldritchInvocations: ['Agonizing Blast'],
    aiProfile: 'smart',
  });
  const enemy1 = makeCombatant('e1', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, ac: 10,
  });
  const farWeak = makeCombatant('farWeak', {
    faction: 'enemy', pos: { x: 25, y: 0, z: 0 },  // 125 ft > 120 ft range
    maxHP: 100, currentHP: 5, ac: 10,
  });
  caster.perception = {
    targets: new Map([
      [enemy1.id, { detectionState: 'visible', lastKnownPos: { ...enemy1.pos }, lastSeenRound: 1 }],
      [farWeak.id, { detectionState: 'visible', lastKnownPos: { ...farWeak.pos }, lastSeenRound: 1 }],
    ]),
  } as any;
  enemy1.perception = { targets: new Map() } as any;
  farWeak.perception = { targets: new Map() } as any;

  const bf = makeBF([caster, enemy1, farWeak]);
  const plan = planTurn(caster, bf);

  // farWeak is out of range (125 > 120) → not included as secondary
  const secIds = plan.action?.secondaryTargetIds;
  assert('9a. Out-of-range weak enemy NOT in secondaryTargetIds',
    secIds === undefined || secIds === null || !secIds.includes('farWeak'));
}

// ============================================================
// Phase 10 — Source-presence checks
// ============================================================

console.log('\n=== Phase 10 — Source-presence checks ===\n');

{
  const fs = require('fs');
  const combatSrc = fs.readFileSync('src/engine/combat.ts', 'utf8');
  const plannerSrc = fs.readFileSync('src/ai/planner.ts', 'utf8');
  const typesSrc = fs.readFileSync('src/types/core.ts', 'utf8');
  const ebSrc = fs.readFileSync('src/spells/eldritch_blast.ts', 'utf8');

  // Type definition
  assert('10a. core.ts has secondaryTargetIds field',
    typesSrc.includes('secondaryTargetIds?: string[]'));

  // Planner heuristic
  assert('10b. planner.ts has spread damage heuristic',
    plannerSrc.includes('Session 88: EB spread damage heuristic'));
  assert('10c. planner.ts populates secondaryTargetIds',
    plannerSrc.includes('plan.action.secondaryTargetIds'));
  assert('10d. planner.ts checks currentHP ≤ maxBeamDamage',
    plannerSrc.includes('maxBeamDamage'));

  // Engine consumption
  assert('10e. combat.ts consumes secondaryTargetIds',
    combatSrc.includes('plan.secondaryTargetIds'));
  assert('10f. combat.ts has spread damage log',
    combatSrc.includes('directs Eldritch Beam'));
  assert('10g. combat.ts has spread damage comment',
    combatSrc.includes('Session 88: EB spread damage heuristic'));

  // Metadata
  assert('10h. eldritch_blast.ts has spreadDamageV1Implemented',
    ebSrc.includes('spreadDamageV1Implemented: true'));
}

// ============================================================
// Summary
// ============================================================

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
