// ============================================================
// Test: Silvery Barbs on Counterspell & Dispel Magic ability checks
// (Session 43, Task #26)
//
// Validates that Silvery Barbs can now be cast in response to a
// successful ability check from Counterspell (L4+ spells, DC 10+level)
// or Dispel Magic (non-concentration effects, DC 13 flat). The original
// spellcaster (Counterspell) or target creature (Dispel Magic) can
// cast Silvery Barbs to force the checker to reroll the d20 and use
// the lower result, potentially flipping the check to failure.
//
// Coverage:
//   1. rollAbilityCheckReactable fires trigger on success
//   2. rollAbilityCheckReactable does NOT fire trigger on failure
//   3. rollAbilityCheckReactable returns success=false when negated
//   4. Counterspell L4+ uses rollAbilityCheckReactable
//   5. Counterspell ability check can be negated by Silvery Barbs
//   6. Dispel Magic non-concentration check uses rollAbilityCheckReactable
//   7. Dispel Magic check can be negated by Silvery Barbs
//   8. End-to-end: Silvery Barbs protects enemy's buff from Dispel Magic
//   9. Auto-success paths (L3 slot vs L3 spell) don't trigger Silvery Barbs
//
// Run: npx ts-node src/test/silvery_barbs_counterspell_dispel.test.ts
// ============================================================

import {
  shouldCastReaction,
  executeReaction,
} from '../spells/silvery_barbs';
import {
  executeReaction as executeCounterspell,
} from '../spells/counterspell';
import {
  execute as executeDispelMagic,
} from '../spells/dispel_magic';
import {
  rollAbilityCheckReactable,
  EngineState,
} from '../engine/combat';
import { Combatant, Action, PlayerResources, Battlefield, ReactionTrigger, ActiveEffect } from '../types/core';

// ---- Test harness -------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Helpers ------------------------------------------------

const SILVERY_BARBS_ACTION: Action = {
  name: 'Silvery Barbs', costType: 'reaction', attackType: null,
  isMultiattack: false, reach: 0, range: null, hitBonus: null,
  damage: null, damageType: null, saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 1, legendaryCost: 0, description: 'Silvery Barbs',
};

const COUNTERSPELL_ACTION: Action = {
  name: 'Counterspell', costType: 'reaction', attackType: null,
  isMultiattack: false, reach: 0, range: null, hitBonus: null,
  damage: null, damageType: null, saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 3, legendaryCost: 0, description: 'Counterspell',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 50, currentHP: 50, ac: 15, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(), aiProfile: 'smart', perception: { targets: new Map() } as any,
    concentration: null, deathSaves: null, resources: null,
    tempHP: 0, mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null,
    activeEffects: [], exhaustionLevel: 0,
    ...overrides,
  };
}

function makeBF(combatants: Combatant[]): Battlefield {
  return {
    combatants: new Map(combatants.map(c => [c.id, c])),
    cells: new Map(), width: 20, height: 20, round: 1,
  } as any;
}

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

function withL1AndL3(l1 = 1, l3 = 1): PlayerResources {
  return {
    spellSlots: {
      1: { max: 1, remaining: l1 },
      3: { max: 1, remaining: l3 },
    },
  };
}

function withL1AndL3AndL5(l1 = 1, l3 = 1, l5 = 1): PlayerResources {
  return {
    spellSlots: {
      1: { max: 1, remaining: l1 },
      3: { max: 1, remaining: l3 },
      5: { max: 1, remaining: l5 },
    },
  };
}

/** Make a non-concentration ActiveEffect (forces Dispel Magic ability check). */
function makeNonConcentrationEffect(id: string, spellName: string, casterId: string): ActiveEffect {
  return {
    id,
    casterId,
    spellName,
    effectType: 'ac_bonus',
    payload: { acBonus: 2 },
    sourceIsConcentration: false,
  } as ActiveEffect;
}

// ---- Tests --------------------------------------------------

// ============================================================
// 1. rollAbilityCheckReactable fires trigger on success
// ============================================================
console.log('\n--- 1. rollAbilityCheckReactable fires on success ---');
{
  // Checker has high INT (auto-success vs DC 10)
  // Opponent has Silvery Barbs prepared
  let triggerFired = false;
  for (let i = 0; i < 50; i++) {
    const checker = makeCombatant('checker', {
      faction: 'enemy',
      int: 20,  // +5 mod + 2 prof = +7, auto-success vs DC 10
      pos: { x: 0, y: 0, z: 0 },
    });
    const opponent = makeCombatant('opponent', {
      faction: 'party',
      actions: [SILVERY_BARBS_ACTION],
      resources: withL1AndL3(1, 0),  // L1 slot for Silvery Barbs
      pos: { x: 1, y: 0, z: 0 },
    });
    const bf = makeBF([checker, opponent]);
    const state = makeState(bf);

    const result = rollAbilityCheckReactable(
      state, checker, opponent, 'int', 10, true, 'counterspell',
    );

    // Check if Silvery Barbs was cast (log entry mentions it)
    const sbLog = state.log.events.find((e: any) =>
      e.type === 'action' && e.description.includes('Silvery Barbs'));
    if (sbLog) {
      triggerFired = true;
      break;
    }
  }
  assert('1a. Silvery Barbs trigger fires on ability check success', triggerFired);
}

// ============================================================
// 2. rollAbilityCheckReactable does NOT fire trigger on failure
// ============================================================
console.log('\n--- 2. No trigger on check failure ---');
{
  // Checker has low INT (auto-fail vs DC 30)
  const checker = makeCombatant('checker', {
    faction: 'enemy',
    int: 1,  // -5 mod, auto-fail vs DC 30
    pos: { x: 0, y: 0, z: 0 },
  });
  const opponent = makeCombatant('opponent', {
    faction: 'party',
    actions: [SILVERY_BARBS_ACTION],
    resources: withL1AndL3(1, 0),
    pos: { x: 1, y: 0, z: 0 },
  });
  const bf = makeBF([checker, opponent]);
  const state = makeState(bf);

  const result = rollAbilityCheckReactable(
    state, checker, opponent, 'int', 30, true, 'counterspell',
  );

  assert('2a. check fails (success=false)', !result.success);
  assert('2b. not negated (no reaction fired)', !result.negated);

  const sbLog = state.log.events.find((e: any) =>
    e.type === 'action' && e.description.includes('Silvery Barbs'));
  assert('2c. No Silvery Barbs log entry (check failed)', !sbLog);
}

// ============================================================
// 3. rollAbilityCheckReactable returns success=false when negated
// ============================================================
console.log('\n--- 3. success=false when negated ---');
{
  // Run many trials. With DC 10 and +7 bonus, success requires d20 >= 3
  // (85% success rate). When SB fires and forces lower-of-two-d20s,
  // the negation rate is P(lowerD20 + 7 < 10) = P(lowerD20 < 3) = P(newD20 < 3)
  // = 2/20 = 10%. So ~10% of successes get negated.
  let negatedCount = 0;
  let successCount = 0;
  let totalTrials = 100;
  for (let i = 0; i < totalTrials; i++) {
    const checker = makeCombatant('checker', {
      faction: 'enemy',
      int: 20,
      pos: { x: 0, y: 0, z: 0 },
    });
    const opponent = makeCombatant('opponent', {
      faction: 'party',
      actions: [SILVERY_BARBS_ACTION],
      resources: withL1AndL3(1, 0),
      pos: { x: 1, y: 0, z: 0 },
    });
    const bf = makeBF([checker, opponent]);
    const state = makeState(bf);

    const result = rollAbilityCheckReactable(
      state, checker, opponent, 'int', 10, true, 'counterspell',
    );

    if (result.negated) negatedCount++;
    if (result.success) successCount++;
  }
  // Should have at least 1 negation over 100 trials (P ≈ 10% per success,
  // 85% success rate → ~8.5 expected negations). Conservative threshold.
  assert(`3a. negated at least once (got ${negatedCount})`, negatedCount >= 1);
  assert(`3b. succeeded at least 50 times (got ${successCount})`, successCount >= 50);
}

// ============================================================
// 4. Counterspell L4+ uses rollAbilityCheckReactable
// ============================================================
console.log('\n--- 4. Counterspell L4+ uses reactable wrapper ---');
{
  // Counterspell caster (party) counters a L4 spell from enemy.
  // The enemy has Silvery Barbs — when CS ability check succeeds,
  // Silvery Barbs should fire (negating the CS, so the spell resolves).
  let sbFired = false;
  for (let i = 0; i < 50; i++) {
    const csCaster = makeCombatant('csCaster', {
      faction: 'party',
      actions: [COUNTERSPELL_ACTION],
      resources: withL1AndL3AndL5(0, 1, 1),  // L3 slot for CS (will upcast L5 if needed)
      int: 18,  // +4 mod
      pos: { x: 0, y: 0, z: 0 },
    });
    const enemyCaster = makeCombatant('enemyCaster', {
      faction: 'enemy',
      actions: [SILVERY_BARBS_ACTION],
      resources: withL1AndL3(1, 0),  // L1 slot for Silvery Barbs
      pos: { x: 1, y: 0, z: 0 },
    });
    const bf = makeBF([csCaster, enemyCaster]);
    const state = makeState(bf);

    // Trigger Counterspell reaction on a L4 spell (forces ability check)
    const trigger: ReactionTrigger = {
      kind: 'incoming_spell',
      caster: enemyCaster,
      spellName: 'Polymorph',
      level: 4,
    };
    executeCounterspell(csCaster, state, trigger);

    // Check if Silvery Barbs fired
    const sbLog = state.log.events.find((e: any) =>
      e.type === 'action' && e.description.includes('Silvery Barbs'));
    if (sbLog) {
      sbFired = true;
      break;
    }
  }
  assert('4a. Silvery Barbs fires on Counterspell ability check success', sbFired);
}

// ============================================================
// 5. Counterspell ability check can be negated by Silvery Barbs
// ============================================================
console.log('\n--- 5. Counterspell negated by Silvery Barbs ---');
{
  // Run many trials. When SB fires and negates the CS check,
  // the spell resolves (not countered).
  let negatedCount = 0;
  let counteredCount = 0;
  for (let i = 0; i < 100; i++) {
    const csCaster = makeCombatant('csCaster', {
      faction: 'party',
      actions: [COUNTERSPELL_ACTION],
      resources: withL1AndL3AndL5(0, 1, 1),
      int: 18,
      pos: { x: 0, y: 0, z: 0 },
    });
    const enemyCaster = makeCombatant('enemyCaster', {
      faction: 'enemy',
      actions: [SILVERY_BARBS_ACTION],
      resources: withL1AndL3(1, 0),
      pos: { x: 1, y: 0, z: 0 },
    });
    const bf = makeBF([csCaster, enemyCaster]);
    const state = makeState(bf);

    const trigger: ReactionTrigger = {
      kind: 'incoming_spell',
      caster: enemyCaster,
      spellName: 'Polymorph',
      level: 4,
    };
    const outcome = executeCounterspell(csCaster, state, trigger);

    if (outcome.kind === 'negated') counteredCount++;
    if (outcome.kind === 'failed') negatedCount++;  // CS failed = spell resolves
  }
  // Both outcomes should be observed (SB sometimes flips, sometimes not)
  assert(`5a. CS sometimes succeeds (counters spell) — got ${counteredCount}`, counteredCount > 0);
  assert(`5b. CS sometimes fails (SB negated) — got ${negatedCount}`, negatedCount > 0);
}

// ============================================================
// 6. Dispel Magic non-concentration check uses rollAbilityCheckReactable
// ============================================================
console.log('\n--- 6. Dispel Magic uses reactable wrapper ---');
{
  // Dispel Magic caster (party) dispels an effect on the enemy.
  // The enemy has Silvery Barbs — when Dispel's ability check succeeds,
  // Silvery Barbs should fire (negating the dispel, so the effect stays).
  let sbFired = false;
  for (let i = 0; i < 50; i++) {
    const dispelCaster = makeCombatant('dispelCaster', {
      faction: 'party',
      resources: withL1AndL3(0, 1),  // L3 slot for Dispel Magic
      int: 18,
      pos: { x: 0, y: 0, z: 0 },
    });
    const target = makeCombatant('target', {
      faction: 'enemy',
      actions: [SILVERY_BARBS_ACTION],
      resources: withL1AndL3(1, 0),  // L1 slot for Silvery Barbs
      pos: { x: 1, y: 0, z: 0 },
      // Add a non-concentration effect that Dispel Magic will try to remove
      activeEffects: [makeNonConcentrationEffect('haste_effect', 'Haste', 'target')],
    });
    const bf = makeBF([dispelCaster, target]);
    const state = makeState(bf);

    executeDispelMagic(dispelCaster, target, state);

    const sbLog = state.log.events.find((e: any) =>
      e.type === 'action' && e.description.includes('Silvery Barbs'));
    if (sbLog) {
      sbFired = true;
      break;
    }
  }
  assert('6a. Silvery Barbs fires on Dispel Magic ability check success', sbFired);
}

// ============================================================
// 7. Dispel Magic check can be negated by Silvery Barbs
// ============================================================
console.log('\n--- 7. Dispel Magic negated by Silvery Barbs ---');
{
  // Run many trials. The target's Haste effect is sometimes dispelled
  // (check succeeded, SB didn't flip) and sometimes stays (SB flipped).
  let effectRemovedCount = 0;
  let effectKeptCount = 0;
  for (let i = 0; i < 100; i++) {
    const dispelCaster = makeCombatant('dispelCaster', {
      faction: 'party',
      resources: withL1AndL3(0, 1),
      int: 18,
      pos: { x: 0, y: 0, z: 0 },
    });
    const target = makeCombatant('target', {
      faction: 'enemy',
      actions: [SILVERY_BARBS_ACTION],
      resources: withL1AndL3(1, 0),
      pos: { x: 1, y: 0, z: 0 },
      activeEffects: [makeNonConcentrationEffect(`haste_${i}`, 'Haste', 'target')],
    });
    const bf = makeBF([dispelCaster, target]);
    const state = makeState(bf);

    executeDispelMagic(dispelCaster, target, state);

    // Check if the Haste effect is still on the target
    const hasteStillOn = target.activeEffects.some(e => e.spellName === 'Haste');
    if (hasteStillOn) effectKeptCount++;
    else effectRemovedCount++;
  }
  // Both outcomes should be observed
  assert(`7a. effect sometimes removed (dispel succeeded) — got ${effectRemovedCount}`, effectRemovedCount > 0);
  assert(`7b. effect sometimes kept (SB negated) — got ${effectKeptCount}`, effectKeptCount > 0);
}

// ============================================================
// 8. End-to-end: Silvery Barbs protects enemy's buff from Dispel Magic
// ============================================================
console.log('\n--- 8. End-to-end: SB protects buff ---');
{
  // Verify that when SB negates the Dispel Magic check, the buff's
  // mechanical effect is preserved (the effect stays in activeEffects).
  let protectionObserved = false;
  for (let i = 0; i < 100; i++) {
    const dispelCaster = makeCombatant('dispelCaster', {
      faction: 'party',
      resources: withL1AndL3(0, 1),
      int: 18,
      pos: { x: 0, y: 0, z: 0 },
    });
    const target = makeCombatant('target', {
      faction: 'enemy',
      actions: [SILVERY_BARBS_ACTION],
      resources: withL1AndL3(1, 0),
      pos: { x: 1, y: 0, z: 0 },
      activeEffects: [makeNonConcentrationEffect(`haste_${i}`, 'Haste', 'target')],
    });
    const bf = makeBF([dispelCaster, target]);
    const state = makeState(bf);

    executeDispelMagic(dispelCaster, target, state);

    // Check for the SB FLIPPED log entry
    const flippedLog = state.log.events.find((e: any) =>
      e.description.includes('Silvery Barbs FLIPPED'));
    if (flippedLog) {
      // Verify the effect is still on the target
      const hasteStillOn = target.activeEffects.some(e => e.spellName === 'Haste');
      if (hasteStillOn) {
        protectionObserved = true;
        break;
      }
    }
  }
  assert('8a. Silvery Barbs protects enemy buff (effect preserved when negated)', protectionObserved);
}

// ============================================================
// 9. Auto-success paths don't trigger Silvery Barbs
// ============================================================
console.log('\n--- 9. Auto-success does NOT trigger Silvery Barbs ---');
{
  // Counterspell with L3 slot vs L3 spell = auto-success (no ability check).
  // No ability check → no Silvery Barbs trigger.
  const csCaster = makeCombatant('csCaster', {
    faction: 'party',
    actions: [COUNTERSPELL_ACTION],
    resources: withL1AndL3AndL5(0, 1, 1),  // L3 slot for CS
    int: 18,
    pos: { x: 0, y: 0, z: 0 },
  });
  const enemyCaster = makeCombatant('enemyCaster', {
    faction: 'enemy',
    actions: [SILVERY_BARBS_ACTION],
    resources: withL1AndL3(1, 0),
    pos: { x: 1, y: 0, z: 0 },
  });
  const bf = makeBF([csCaster, enemyCaster]);
  const state = makeState(bf);

  // L3 spell → auto-success with L3 slot (no ability check)
  const trigger: ReactionTrigger = {
    kind: 'incoming_spell',
    caster: enemyCaster,
    spellName: 'Fireball',
    level: 3,
  };
  const outcome = executeCounterspell(csCaster, state, trigger);

  // CS should negate (auto-success)
  eq('9a. CS negates L3 spell (auto-success)', outcome.kind, 'negated');

  // No Silvery Barbs should fire (no ability check was rolled)
  const sbLog = state.log.events.find((e: any) =>
    e.type === 'action' && e.description.includes('Silvery Barbs'));
  assert('9b. No Silvery Barbs on auto-success (no ability check)', !sbLog);
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('silvery_barbs_counterspell_dispel.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('silvery_barbs_counterspell_dispel.test.ts: all tests passed ✅');
}
