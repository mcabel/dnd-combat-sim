// ============================================================
// Silvery Barbs — SCC p.38 (Strixhaven: A Curriculum of Chaos)
//
// 1st-level enchantment, reaction
// Trigger: A creature you can see within 60 feet of you hits on an
//          attack roll, OR succeeds on a saving throw, OR succeeds on
//          an ability check
// Range: 60 feet
// Duration: Instantaneous
//
// Effect:
//   - The triggering creature must reroll the d20 and use the lower
//     result. (This can flip a hit to a miss, a save success to a
//     failure, or an ability-check success to a failure.)
//   - You can then choose a different creature you can see within
//     range; that creature has advantage on its next attack roll
//     against the triggering creature, made before the start of the
//     triggering creature's next turn.
//   - Upcast: +1 creature per slot level above 1st (for the advantage
//     rider, not the reroll).
//   - No concentration.
//
// TG-008 implementation:
//   - `shouldCastReaction` / `executeReaction` are the trigger-aware
//     entry points consumed by the reaction registry.
//   - Session 41 Task #8: added `incoming_save_success` trigger handling.
//     The save-success path rerolls the d20, uses the lower result, and
//     re-evaluates success. If the reroll flips the save to a failure,
//     returns `{ kind: 'negated' }` — the engine's `rollSaveReactable`
//     wrapper then returns success=false so the calling spell module's
//     "save failed" branch runs.
//   - Session 42 Task #19: added `incoming_ability_check_success` trigger
//     handling for grapple/shove/escape contests. The ability-check path
//     re-rolls the contest (calls rollGrappleContest again internally)
//     and returns `{ kind: 'negated' }` if the reroll flips the contest
//     to the defender winning.
//   - The ability-check-success trigger is NOT implemented (would
//     require additional trigger points in the engine).
//   - `executeReaction` returns `{ kind: 'negated' }` when the reroll
//     flips the hit to a miss OR the save success to a failure;
//     otherwise `{ kind: 'failed' }`.
//   - The "advantage on next attack" rider is NOT implemented in v1
//     (would require tracking a per-target advantage flag).
//   - No cleanup needed — the effect is instantaneous.
//
// v1 simplifications:
//   - Triggers on attack hits AND save successes (Session 41 added the
//     latter). Ability-check-success is not yet implemented.
//   - The reroll uses the lower of the two d20 rolls, but the to-hit
//     bonus / save mods are the same (no reroll of the bonus).
//   - The advantage rider is not modelled.
//   - shouldCastReaction always returns true if the trigger is valid
//     (no tactical gating on whether the reroll will help). This may
//     waste slots when the original roll was low enough that the reroll
//     won't flip it. Future enhancement: only cast if the lower of
//     (original roll, expected reroll) would miss/fail.
// ============================================================

import { Combatant, Battlefield, ReactionTrigger, ReactionOutcome } from '../types/core';
import { EngineState } from '../engine/combat';
import { consumeSpellSlot } from '../ai/resources';
import { rollDie, attackHits, rollGrappleContest } from '../engine/utils';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Silvery Barbs',
  level: 1,
  school: 'enchantment',
  rangeFt: 60,
  concentration: false,
  castingTime: 'reaction',
  silveryBarbsSaveSuccessV1Implemented: true,
  silveryBarbsAbilityCheckSuccessV1Implemented: true,
} as const;

// ---- Trigger-aware shouldCast (TG-008) ----------------------

/**
 * Returns true if `caster` should cast Silvery Barbs in response to
 * `trigger`.
 *
 * Handles three trigger kinds:
 *   - 'incoming_attack_hit': caster forces attacker to reroll the d20.
 *     Cast whenever an enemy within 60 ft hits with an attack.
 *   - 'incoming_save_success' (Session 41 Task #8): caster forces saver
 *     to reroll the d20. Cast whenever an enemy within 60 ft succeeds
 *     on a save against the caster's spell.
 *   - 'incoming_ability_check_success' (Session 42 Task #19): opponent
 *     forces checker to reroll. Cast whenever an enemy within 60 ft
 *     succeeds on a grapple/shove/escape contest against the caster.
 *
 * v1 does NOT gate on whether the reroll will flip the result.
 */
export function shouldCastReaction(
  caster: Combatant,
  _bf: Battlefield,
  trigger: ReactionTrigger,
): boolean {
  if (
    trigger.kind !== 'incoming_attack_hit' &&
    trigger.kind !== 'incoming_save_success' &&
    trigger.kind !== 'incoming_ability_check_success'
  ) return false;

  // The triggering creature is:
  //   - attacker (for attack_hit)
  //   - saver (for save_success)
  //   - checker (for ability_check_success)
  // Silvery Barbs forces THAT creature to reroll.
  let triggerCreature: Combatant;
  if (trigger.kind === 'incoming_attack_hit') {
    triggerCreature = trigger.attacker;
  } else if (trigger.kind === 'incoming_save_success') {
    triggerCreature = trigger.saver;
  } else {
    triggerCreature = trigger.checker;
  }

  // Only cast against enemies (PHB: "a creature you can see" — but
  // tactically you'd only cast against enemies).
  if (triggerCreature.id === caster.id) return false;
  // Range check: PHB p.38 "within 60 feet".
  const dx = Math.abs(caster.pos.x - triggerCreature.pos.x);
  const dy = Math.abs(caster.pos.y - triggerCreature.pos.y);
  const dz = Math.abs(caster.pos.z - triggerCreature.pos.z);
  const distFt = Math.max(dx, dy, dz) * 5;
  if (distFt > 60) return false;
  // Don't cast if the triggering creature is already dead (shouldn't happen mid-trigger).
  if (triggerCreature.isDead || triggerCreature.isUnconscious) return false;
  return true;
}

// ---- Trigger-aware execute (TG-008) -------------------------

/**
 * Execute Silvery Barbs reaction. Handles two trigger kinds:
 *
 * 'incoming_attack_hit': rolls a new d20, uses the lower of the
 * original and new rolls, and re-evaluates the hit. If the lower
 * roll misses, returns `{ kind: 'negated' }`.
 *
 * 'incoming_save_success' (Session 41 Task #8): rolls a new d20, uses
 * the lower of the original and new rolls, and re-evaluates the save.
 * If the lower roll fails the save, returns `{ kind: 'negated' }` —
 * the engine's `rollSaveReactable` wrapper then returns success=false
 * so the calling spell module's "save failed" branch runs.
 *
 * PHB/SCC: "The triggering creature must reroll the d20 and use the
 * lower roll."
 */
export function executeReaction(
  caster: Combatant,
  state: EngineState,
  trigger: ReactionTrigger,
): ReactionOutcome {
  if (trigger.kind === 'incoming_attack_hit') {
    return executeAttackHitReroll(caster, state, trigger);
  }
  if (trigger.kind === 'incoming_save_success') {
    return executeSaveSuccessReroll(caster, state, trigger);
  }
  if (trigger.kind === 'incoming_ability_check_success') {
    return executeAbilityCheckSuccessReroll(caster, state, trigger);
  }
  return { kind: 'no_effect' };
}

/**
 * Handle the 'incoming_attack_hit' trigger: reroll the attack d20,
 * use the lower result, and re-evaluate the hit.
 */
function executeAttackHitReroll(
  caster: Combatant,
  state: EngineState,
  trigger: Extract<ReactionTrigger, { kind: 'incoming_attack_hit' }>,
): ReactionOutcome {
  consumeSpellSlot(caster, 1);
  caster.budget.reactionUsed = true;

  // Roll a new d20 for the reroll.
  const newRoll = rollDie(20);
  // Use the lower of the original and new rolls.
  const lowerRoll = Math.min(trigger.attackRoll, newRoll);
  // Reconstruct the attack total with the lower roll.
  const hitBonus = trigger.attackTotal - trigger.attackRoll;
  const newTotal = lowerRoll + hitBonus;

  const newIsCrit = lowerRoll === 20;
  const newHits = attackHits(lowerRoll, newTotal, trigger.effectiveAC);

  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: caster.id,
    type: 'action',
    targetId: trigger.attacker.id,
    description: `${caster.name} casts Silvery Barbs — ${trigger.attacker.name} rerolls the d20 (original ${trigger.attackRoll} → new ${newRoll}, using ${lowerRoll}). Attack ${newHits ? 'still hits' : 'now MISSES'} (${newTotal} vs AC ${trigger.effectiveAC})!`,
  });

  if (!newHits) {
    return { kind: 'negated', detail: `Silvery Barbs reroll (${newRoll}) flipped hit to miss` };
  }
  return { kind: 'failed', detail: `Silvery Barbs reroll (${newRoll}) did not flip the hit` };
}

/**
 * Handle the 'incoming_save_success' trigger (Session 41 Task #8):
 * reroll the save d20, use the lower result, and re-evaluate success.
 *
 * The save's modifier is reconstructed from `trigger.total - trigger.roll`
 * (the original total included the d20 + all mods; the new total uses
 * the lower d20 + the same mods).
 */
function executeSaveSuccessReroll(
  caster: Combatant,
  state: EngineState,
  trigger: Extract<ReactionTrigger, { kind: 'incoming_save_success' }>,
): ReactionOutcome {
  consumeSpellSlot(caster, 1);
  caster.budget.reactionUsed = true;

  // Roll a new d20 for the reroll.
  const newRoll = rollDie(20);
  // Use the lower of the original and new rolls.
  const lowerRoll = Math.min(trigger.roll, newRoll);
  // Reconstruct the save total with the lower roll.
  // The original total = roll + mods. The new total = lowerRoll + mods.
  const saveMods = trigger.total - trigger.roll;
  const newTotal = lowerRoll + saveMods;
  // The save succeeds if total >= DC.
  const newSuccess = newTotal >= trigger.dc;

  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: caster.id,
    type: 'action',
    targetId: trigger.saver.id,
    description: `${caster.name} casts Silvery Barbs — ${trigger.saver.name} rerolls the save d20 (original ${trigger.roll} → new ${newRoll}, using ${lowerRoll}). Save ${newSuccess ? 'still succeeds' : 'now FAILS'} (${newTotal} vs DC ${trigger.dc})!`,
  });

  if (!newSuccess) {
    return { kind: 'negated', detail: `Silvery Barbs reroll (${newRoll}) flipped save success to failure` };
  }
  return { kind: 'failed', detail: `Silvery Barbs reroll (${newRoll}) did not flip the save` };
}

/**
 * Handle the 'incoming_ability_check_success' trigger (Session 42 Task #19):
 * re-roll the grapple/shove/escape contest. Since `rollGrappleContest`
 * doesn't expose the raw d20 rolls, we re-roll the entire contest and
 * check if the defender now wins.
 *
 * v1 simplification: instead of reconstructing the original d20 + mods
 * (which `rollGrappleContest` doesn't expose), we re-roll the contest
 * by calling `rollGrappleContest` again. If the reroll flips the contest
 * (defender now wins), returns `{ kind: 'negated' }` — the engine's
 * `rollGrappleContestReactable` wrapper then returns false (attacker
 * did NOT win).
 *
 * PHB/SCC: "The triggering creature must reroll the d20 and use the
 * lower roll." v1 approximates this by re-rolling the entire contest.
 */
function executeAbilityCheckSuccessReroll(
  caster: Combatant,
  state: EngineState,
  trigger: Extract<ReactionTrigger, { kind: 'incoming_ability_check_success' }>,
): ReactionOutcome {
  consumeSpellSlot(caster, 1);
  caster.budget.reactionUsed = true;

  // v1 simplification: re-roll the contest by calling rollGrappleContest
  // again. The original contest was attacker vs defender (checker vs
  // opponent). The reroll uses the same participants.
  // rollGrappleContest is imported at the top of this file from ../engine/utils.

  // Re-roll the contest: if the checker (attacker) wins again, the
  // reroll didn't flip it. If the opponent (defender) wins, the reroll
  // flipped the contest → negated.
  const checkerWonReroll = rollGrappleContest(trigger.checker, trigger.opponent);

  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: caster.id,
    type: 'action',
    targetId: trigger.checker.id,
    description: `${caster.name} casts Silvery Barbs — ${trigger.checker.name} rerolls the ${trigger.contestType} contest vs ${trigger.opponent.name}. Contest ${checkerWonReroll ? 'still succeeds' : 'now FAILS'}!`,
  });

  if (!checkerWonReroll) {
    return { kind: 'negated', detail: `Silvery Barbs reroll flipped ${trigger.contestType} contest to defender winning` };
  }
  return { kind: 'failed', detail: `Silvery Barbs reroll did not flip the ${trigger.contestType} contest` };
}

// ---- cleanup ------------------------------------------------
//
// No cleanup needed — Silvery Barbs is instantaneous.

export function cleanup(_caster: Combatant): void {
  // No-op — instantaneous spell.
}
