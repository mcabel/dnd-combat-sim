// ============================================================
// _reaction_registry.ts — TG-008 Reaction spell registry
//
// Central registry of all reaction spells in the engine. Each entry
// is a `ReactionSpellDescriptor` describing:
//   - name: canonical spell name (must match the Action.name on the caster)
//   - level: minimum spell slot level required to cast
//   - triggerKinds: which ReactionTrigger kinds this spell responds to
//   - shouldCast: trigger-aware predicate (slot, reaction budget, tactical value)
//   - execute: trigger-aware effect; returns a ReactionOutcome
//
// The engine's `triggerReactions` helper (in combat.ts) iterates this
// registry for each candidate reactor. The FIRST matching spell fires
// (a creature can only cast one reaction per round — PHB p.190).
//
// To add a new reaction spell:
//   1. Create `src/spells/<snake_name>.ts` exporting
//      `shouldCastReaction` + `executeReaction` (+ `cleanup` if needed).
//   2. Register it in the `REACTION_SPELLS` array below.
//   3. If it needs cleanup at start-of-turn, add a `cleanupXxx` import
//      and call in `resetBudget` (utils.ts).
// ============================================================

import { Combatant, Battlefield, ReactionTrigger, ReactionOutcome } from '../types/core';
import { EngineState } from '../engine/combat';

// ---- ReactionSpellDescriptor --------------------------------

/**
 * Describes a reaction spell for the registry. Each field is consumed
 * by `triggerReactions` in combat.ts.
 */
export interface ReactionSpellDescriptor {
  /** Canonical spell name (must match `Action.name` on the caster). */
  name: string;
  /** Minimum spell slot level required (1 for Shield/Absorb Elements/etc., 3 for Counterspell). */
  level: number;
  /** Which trigger kinds this spell responds to. */
  triggerKinds: ReactionTrigger['kind'][];
  /**
   * Trigger-aware predicate. Returns true if the reactor should cast
   * this spell in response to `trigger`.
   *
   * Pre-conditions already checked by `triggerReactions` before calling:
   *   - reactor has a matching Action (name === spell.name)
   *   - reactor has a spell slot of `level` or higher
   *   - reactor's reaction budget is unused
   *   - reactor is alive, conscious, not incapacitated
   *   - trigger is not self-caused (reactor != attacker/caster)
   *
   * This function should check TACTICAL viability (e.g. Shield only
   * fires if +5 AC would flip the hit to a miss).
   */
  shouldCast: (reactor: Combatant, bf: Battlefield, trigger: ReactionTrigger) => boolean;
  /**
   * Trigger-aware effect. Applies the spell's mechanics, consumes the
   * spell slot, marks `reactionUsed = true`, and returns the outcome.
   *
   * The returned `ReactionOutcome` tells the engine whether to abort
   * the triggering action (`'negated'`), continue normally (`'no_effect'`),
   * or continue after a failed attempt (`'failed'`).
   */
  execute: (reactor: Combatant, state: EngineState, trigger: ReactionTrigger) => ReactionOutcome;
}

// ---- Registry ------------------------------------------------
//
// Spell modules are imported individually and registered below.
// The order matters only for tie-breaking when a creature has
// multiple reaction spells known — the first matching one fires.
// In practice, each creature typically has only one reaction spell
// prepared, so order is rarely relevant.

import {
  shouldCastReaction as shouldCastShieldReaction,
  executeReaction as executeShieldReaction,
} from './shield';

import {
  shouldCastReaction as shouldCastAbsorbElements,
  executeReaction as executeAbsorbElements,
} from './absorb_elements';

import {
  shouldCastReaction as shouldCastHellishRebuke,
  executeReaction as executeHellishRebuke,
} from './hellish_rebuke';

import {
  shouldCastReaction as shouldCastCounterspell,
  executeReaction as executeCounterspell,
} from './counterspell';

import {
  shouldCastReaction as shouldCastFeatherFall,
  executeReaction as executeFeatherFall,
} from './feather_fall';

import {
  shouldCastReaction as shouldCastSilveryBarbs,
  executeReaction as executeSilveryBarbs,
} from './silvery_barbs';

export const REACTION_SPELLS: ReactionSpellDescriptor[] = [
  {
    name: 'Shield',
    level: 1,
    // Session 37: added 'targeted_by_magic_missile' for Shield's PHB p.275
    // "targeted by Magic Missile" trigger (in addition to the original
    // 'incoming_attack_hit' "hit by an attack" trigger).
    triggerKinds: ['incoming_attack_hit', 'targeted_by_magic_missile'],
    shouldCast: shouldCastShieldReaction,
    execute: executeShieldReaction,
  },
  {
    name: 'Absorb Elements',
    level: 1,
    triggerKinds: ['incoming_damage'],
    shouldCast: shouldCastAbsorbElements,
    execute: executeAbsorbElements,
  },
  {
    name: 'Hellish Rebuke',
    level: 1,
    triggerKinds: ['incoming_damage'],
    shouldCast: shouldCastHellishRebuke,
    execute: executeHellishRebuke,
  },
  {
    name: 'Silvery Barbs',
    level: 1,
    // Session 41 Task #8: added 'incoming_save_success' for the save-success
    // reroll trigger (SCC p.38: "succeeds on a saving throw").
    // Session 42 Task #19: added 'incoming_ability_check_success' for the
    // ability-check-success reroll trigger (SCC p.38: "succeeds on an
    // ability check"). Covers grapple/shove/escape contests.
    triggerKinds: ['incoming_attack_hit', 'incoming_save_success', 'incoming_ability_check_success'],
    shouldCast: shouldCastSilveryBarbs,
    execute: executeSilveryBarbs,
  },
  {
    name: 'Counterspell',
    level: 3,
    triggerKinds: ['incoming_spell'],
    shouldCast: shouldCastCounterspell,
    execute: executeCounterspell,
  },
  {
    name: 'Feather Fall',
    level: 1,
    triggerKinds: ['falling'],
    shouldCast: shouldCastFeatherFall,
    execute: executeFeatherFall,
  },
];

/**
 * Look up a reaction spell descriptor by canonical name.
 * Returns undefined if not found.
 */
export function getReactionSpell(name: string): ReactionSpellDescriptor | undefined {
  return REACTION_SPELLS.find(s => s.name === name);
}
