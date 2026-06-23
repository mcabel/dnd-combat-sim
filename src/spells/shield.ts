// ============================================================
// Shield — PHB p.275
//
// 1st-level abjuration, reaction
// Trigger: Being hit by an attack or targeted by Magic Missile
// Range: Self
// Duration: 1 round (until start of your next turn)
//
// Effect: +5 bonus to AC, including against the triggering attack.
//         No damage from Magic Missile.
//         No concentration.
//
// TG-008 implementation:
//   - `shouldCastReaction` / `executeReaction` are the NEW trigger-aware
//     entry points consumed by the reaction registry. `executeReaction`
//     returns `{ kind: 'negated' }` when the +5 AC flips the hit to a
//     miss; the engine then re-evaluates `hits` and skips damage.
//   - `shouldCast` / `execute` are the LEGACY entry points retained for
//     backwards compatibility (the unreachable `case 'shield':` dispatch
//     in combat.ts and any external callers). They are NOT called by the
//     reactive trigger path.
//   - `cleanup` is unchanged — called by `resetBudget` at start of the
//     caster's next turn to remove the +5 AC effect.
//
// Session 37: Magic Missile blocking IS NOW implemented. A dedicated
//   `targeted_by_magic_missile` trigger kind fires in the `case
//   'magicMissile':` dispatch in combat.ts, BEFORE executeMagicMissile.
//   Shield's shouldCastReaction accepts this trigger and always casts
//   (Shield blocks ALL MM darts per PHB p.275). executeReaction applies
//   the +5 AC effect AND returns `{ kind: 'negated' }` so the dispatch
//   skips the damage loop. The MM slot is still consumed (the spell was
//   cast — PHB p.228 resource rule).
//
// v1 simplifications:
//   - Shield's `shouldCastReaction` only fires when +5 AC WILL flip the
//     hit to a miss (tactically optimal — never wastes a slot). A human
//     player might cast Shield even when it won't flip the hit, just for
//     the round-long +5 AC; the AI is stricter. (This gating applies to
//     the `incoming_attack_hit` trigger only — for `targeted_by_magic_missile`,
//     Shield always casts since it blocks ALL MM damage unconditionally.)
//   - MM currently targets a single creature (all darts at one target).
//     Shield blocks the entire volley. Multi-target MM + per-dart Shield
//     blocking is a future enhancement (would require per-dart trigger
//     firing inside executeMagicMissile's dart loop).
// ============================================================

import { Combatant, Battlefield, ReactionTrigger, ReactionOutcome } from '../types/core';
import { EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { consumeSpellSlot, hasSpellSlot, consumeInnateSpellUse } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Shield',
  level: 1,
  school: 'abjuration',
  rangeFt: 0,           // self
  concentration: false,
  castingTime: 'reaction',
  shieldMagicMissileBlockingV1Implemented: true,  // Session 37: MM blocking NOW modelled
} as const;

// ---- Trigger-aware shouldCast (TG-008) ----------------------

/**
 * Returns true if `caster` should cast Shield in response to `trigger`.
 *
 * Two trigger kinds are accepted (PHB p.275: "When you are hit by an
 * attack or targeted by Magic Missile"):
 *
 *   1. `incoming_attack_hit` — Tactical rule (v1): only cast when the
 *      +5 AC WILL flip the hit to a miss (`attackTotal < effectiveAC + 5`).
 *      Avoids wasting a slot when Shield wouldn't help.
 *
 *   2. `targeted_by_magic_missile` (Session 37) — Always cast. Shield
 *      blocks ALL Magic Missile damage unconditionally (PHB p.275: "acts
 *      as a shield against Magic Missile"). No tactical gating needed —
 *      blocking ~10.5 avg force damage + gaining round-long +5 AC is
 *      always worth a L1 slot.
 *
 * Common guards (both triggers): don't cast if already under Shield
 * (no benefit to recasting), don't cast against self.
 */
export function shouldCastReaction(
  caster: Combatant,
  _bf: Battlefield,
  trigger: ReactionTrigger,
): boolean {
  if (trigger.kind === 'incoming_attack_hit') {
    // Only worth casting if the +5 AC flips the hit to a miss.
    // If attackTotal >= effectiveAC + 5, the attack still hits even with
    // Shield — wasting the slot. (A human might still cast for the round-
    // long +5, but the AI is stricter.)
    if (trigger.attackTotal >= trigger.effectiveAC + 5) return false;
    // Don't cast Shield against ourselves (shouldn't happen, but guard).
    if (trigger.attacker.id === caster.id) return false;
  } else if (trigger.kind === 'targeted_by_magic_missile') {
    // Session 37: Shield blocks ALL MM damage — always cast (no tactical
    // gating). Don't cast against our own MM (triggerReactions already
    // guards this, but double-check for direct callers).
    if (trigger.caster.id === caster.id) return false;
  } else {
    return false;  // Shield only responds to these two trigger kinds
  }
  // Already under Shield? No benefit to recasting.
  const alreadyActive = caster.activeEffects.some((e: any) => e.spellName === 'Shield');
  if (alreadyActive) return false;
  return true;
}

// ---- Trigger-aware execute (TG-008) -------------------------

/**
 * Execute Shield reaction. Returns `{ kind: 'negated' }` — the engine
 * will either re-evaluate `hits` with the new +5 AC (for
 * `incoming_attack_hit`) and skip damage if the attack now misses, OR
 * skip the Magic Missile damage loop entirely (for
 * `targeted_by_magic_missile`).
 *
 * PHB p.275: "+5 bonus to AC, including against the triggering attack.
 * The spell also acts as a shield against Magic Missile."
 */
export function executeReaction(
  caster: Combatant,
  state: EngineState,
  trigger: ReactionTrigger,
): ReactionOutcome {
  if (trigger.kind === 'incoming_attack_hit') {
    // Session 44 Task #20: consume a spell slot OR an innate spell use.
    // The Couatl (and similar monsters) cast Shield via innate spellcasting
    // (3/day), not spell slots. Mirrors the pattern in cure_wounds.ts.
    if (consumeSpellSlot(caster, 1) === null) {
      consumeInnateSpellUse(caster, 'Shield');
    }
    caster.budget.reactionUsed = true;

    applySpellEffect(caster, {
      casterId: caster.id,
      spellName: 'Shield',
      effectType: 'ac_bonus',
      payload: { acBonus: 5 },
      sourceIsConcentration: false,
    });

    const triggerName = trigger.action.name;
    state.log.events.push({
      round: state.battlefield.round ?? 0,
      actorId: caster.id,
      type: 'action',
      targetId: trigger.attacker.id,
      description: `${caster.name} casts Shield (+5 AC, negates ${triggerName} hit — ${trigger.attackTotal} vs AC ${trigger.effectiveAC}+5=${trigger.effectiveAC + 5})!`,
    });

    // The +5 AC may or may not flip the hit to a miss — but we already
    // gated in shouldCastReaction on the flip happening, so we can safely
    // report 'negated'. The engine will re-evaluate hits and skip damage
    // if the new AC exceeds attackTotal.
    return { kind: 'negated', detail: 'Shield +5 AC may flip hit to miss' };
  }

  if (trigger.kind === 'targeted_by_magic_missile') {
    // Session 37: Shield blocks ALL Magic Missile damage.
    // Session 44 Task #20: innate-use fallback for monsters (Couatl).
    if (consumeSpellSlot(caster, 1) === null) {
      consumeInnateSpellUse(caster, 'Shield');
    }
    caster.budget.reactionUsed = true;

    applySpellEffect(caster, {
      casterId: caster.id,
      spellName: 'Shield',
      effectType: 'ac_bonus',
      payload: { acBonus: 5 },
      sourceIsConcentration: false,
    });

    state.log.events.push({
      round: state.battlefield.round ?? 0,
      actorId: caster.id,
      type: 'action',
      targetId: trigger.caster.id,
      description: `${caster.name} casts Shield — blocks ${trigger.dartCount} Magic Missile dart${trigger.dartCount !== 1 ? 's' : ''} from ${trigger.caster.name}! (+5 AC until start of next turn)`,
    });

    // 'negated' tells the `case 'magicMissile':` dispatch to skip the
    // damage loop entirely. The MM slot is consumed by the dispatch site
    // (not here) — the spell was cast, just blocked.
    return { kind: 'negated', detail: `Shield blocked ${trigger.dartCount} Magic Missile dart(s)` };
  }

  return { kind: 'no_effect' };
}

// ---- Legacy shouldCast (backwards compat) -------------------
//
// Retained for the unreachable `case 'shield':` dispatch in combat.ts
// and any external callers. NOT called by the reactive trigger path.

/**
 * @deprecated Use `shouldCastReaction` for the reactive trigger path.
 * Returns true if `caster` COULD cast Shield (slot available, reaction
 * unused, spell known, not already active). Does NOT consider tactical
 * value — always returns true if preconditions are met.
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Shield')) return false;
  if (!hasSpellSlot(caster, 1)) return false;
  if (caster.budget.reactionUsed) return false;

  const alreadyActive = caster.activeEffects.some((e: any) => e.spellName === 'Shield');
  if (alreadyActive) return false;

  return true;
}

// ---- Legacy execute (backwards compat) ----------------------
//
// Retained for the `case 'shield':` dispatch in combat.ts (currently
// unreachable from the planner, but kept for manual/test invocation).

/**
 * @deprecated Use `executeReaction` for the reactive trigger path.
 */
export function execute(caster: Combatant, state: EngineState, triggeringAttackName?: string): void {
  consumeSpellSlot(caster, 1);
  caster.budget.reactionUsed = true;

  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Shield',
    effectType: 'ac_bonus',
    payload: { acBonus: 5 },
    sourceIsConcentration: false,
  });

  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: caster.id,
    type: 'action',
    description: `${caster.name} casts Shield (+5 AC until start of next turn)${triggeringAttackName ? ` vs ${triggeringAttackName}` : ''}!`,
  });
}

// ---- cleanup ------------------------------------------------

/**
 * Remove Shield effect at the start of the caster's next turn.
 * Called by resetBudget in utils.ts.
 */
export function cleanup(caster: Combatant): void {
  caster.activeEffects = caster.activeEffects.filter((e: any) => e.spellName !== 'Shield');
}
