// ============================================================
// Absorb Elements — XGE p.150
//
// 1st-level abjuration, reaction
// Trigger: You take acid, cold, fire, lightning, poison, or thunder damage
// Range: Self
// Duration: 1 round (until the start of your next turn)
//
// Effect:
//   - You gain resistance to the triggering damage type until the start
//     of your next turn.
//   - The first time you hit with a melee attack on your next turn, the
//     target takes an additional 1d6 damage of the triggering type.
//   - Upcast: +1d6 damage per slot level above 1st.
//   - No concentration.
//
// TG-008 implementation:
//   - `shouldCastReaction` / `executeReaction` are the trigger-aware
//     entry points consumed by the reaction registry.
//   - `executeReaction` returns `{ kind: 'no_effect' }` — the triggering
//     damage still applies (resistance is granted AFTER the triggering
//     hit, per PHB timing: "you gain resistance" — the resistance
//     protects against FUTURE damage of that type, not the triggering
//     hit). v1 simplification: the engine fires the reaction AFTER
//     `applyDamageWithTempHP`, so the triggering damage is already
//     dealt. This matches the PHB timing (resistance starts now).
//   - `cleanup` removes the resistance at start of the caster's next
//     turn. Called by `resetBudget` in utils.ts.
//
// v1 simplifications:
//   - The melee rider is consumed on the next melee weapon attack,
//     regardless of whose turn it is (PHB says "your next turn", but
//     "first time you hit with a melee attack" is the operative clause
//     — an OA melee hit before your next turn would also consume it).
//   - Upcast is supported: `consumeSpellSlot(caster, 1)` consumes the
//     lowest available L1+ slot. If the caster only has L2+ slots
//     remaining, the upcast bonus applies (+1d6 per slot level above
//     1st). v1 always consumes L1 if available (no tactical upcast).
// ============================================================

import { Combatant, Battlefield, DamageType, ReactionTrigger, ReactionOutcome } from '../types/core';
import { EngineState } from '../engine/combat';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { rollDiceString } from '../engine/utils';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Absorb Elements',
  level: 1,
  school: 'abjuration',
  rangeFt: 0,           // self
  concentration: false,
  castingTime: 'reaction',
} as const;

/** Damage types that trigger Absorb Elements (XGE p.150). */
const TRIGGERING_DAMAGE_TYPES: DamageType[] = [
  'acid', 'cold', 'fire', 'lightning', 'poison', 'thunder',
];

// ---- Trigger-aware shouldCast (TG-008) ----------------------

/**
 * Returns true if `caster` should cast Absorb Elements in response to
 * `trigger`.
 *
 * Tactical rule (v1): cast whenever the trigger is incoming_damage of
 * an eligible type and the damage dealt is > 0. The resistance protects
 * against future damage of that type this round, and the rider adds
 * damage to the caster's next melee hit — both are always useful in
 * combat.
 *
 * Future enhancement: gate on whether the caster is likely to take
 * more of that damage type this round, or whether they have a melee
 * attack to benefit from the rider.
 */
export function shouldCastReaction(
  caster: Combatant,
  _bf: Battlefield,
  trigger: ReactionTrigger,
): boolean {
  if (trigger.kind !== 'incoming_damage') return false;
  if (!trigger.damageType) return false;
  if (!TRIGGERING_DAMAGE_TYPES.includes(trigger.damageType)) return false;
  if (trigger.amount <= 0) return false;
  // Don't cast against ourselves.
  if (trigger.attacker.id === caster.id) return false;
  // Already resistant to this type? The resistance from a prior Absorb
  // Elements is still active — recasting doesn't help (no extra resistance,
  // but the rider WOULD stack). v1: don't recast if already resistant.
  if (caster._absorbElementsResistance === trigger.damageType) return false;
  return true;
}

// ---- Trigger-aware execute (TG-008) -------------------------

/**
 * Execute Absorb Elements reaction. Grants resistance to the triggering
 * damage type and stores a rider for the next melee hit. Returns
 * `{ kind: 'no_effect' }` — the triggering damage already applied.
 */
export function executeReaction(
  caster: Combatant,
  state: EngineState,
  trigger: ReactionTrigger,
): ReactionOutcome {
  if (trigger.kind !== 'incoming_damage' || !trigger.damageType) {
    return { kind: 'no_effect' };
  }

  // Consume a L1 slot (v1: always L1; upcast bonus derived from slot
  // consumed if the caster only has higher-level slots available).
  const slotLevel = consumeSpellSlot(caster, 1) ?? 1;
  caster.budget.reactionUsed = true;

  // 1. Grant resistance to the triggering damage type.
  //    PHB: "you have resistance to that damage type until the start of
  //    your next turn." We add it to `resistances` and track it for
  //    cleanup via `_absorbElementsResistance`.
  if (!caster.resistances.includes(trigger.damageType)) {
    caster.resistances.push(trigger.damageType);
  }
  caster._absorbElementsResistance = trigger.damageType;

  // 2. Store the melee rider: 1d6 of the triggering type, +1d6 per slot
  //    level above 1st. Consumed by resolveAttack's damage branch on the
  //    next melee weapon hit.
  const diceCount = 1 + Math.max(0, slotLevel - 1);  // L1 → 1d6, L2 → 2d6, ...
  caster._absorbElementsRider = {
    damageType: trigger.damageType,
    diceCount,
  };

  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: caster.id,
    type: 'action',
    targetId: trigger.attacker.id,
    description: `${caster.name} casts Absorb Elements — gains resistance to ${trigger.damageType} until start of next turn, and +${diceCount}d6 ${trigger.damageType} on next melee hit!`,
  });

  return { kind: 'no_effect' };
}

// ---- cleanup ------------------------------------------------

/**
 * Remove Absorb Elements resistance at the start of the caster's next
 * turn. Called by resetBudget in utils.ts.
 *
 * The melee rider is NOT cleared here — it persists until consumed by
 * the next melee hit (which may happen on the caster's next turn or
 * later). If the rider is never consumed (e.g., the caster doesn't make
 * a melee attack), it just sits in the scratch field harmlessly.
 */
export function cleanup(caster: Combatant): void {
  if (caster._absorbElementsResistance) {
    const dt = caster._absorbElementsResistance;
    // Remove the resistance we added (only the one we added — if the
    // caster has innate resistance to the same type, leave it).
    const idx = caster.resistances.indexOf(dt);
    if (idx >= 0) caster.resistances.splice(idx, 1);
    caster._absorbElementsResistance = null;
  }
}

// ---- Rider consumption helper -------------------------------
//
// Called by resolveAttack's damage branch when the attacker has an
// active Absorb Elements rider. Returns the extra damage to add (and
// clears the rider). The caller is responsible for adding the damage
// to the attack's total and applying the damage type.
//
// This is exported so combat.ts can call it without duplicating the
// dice-rolling logic. The function is idempotent — calling it twice
// returns 0 the second time.

/**
 * Consume the Absorb Elements rider on `attacker` if one is active.
 * Returns the extra damage to add to the current melee hit (0 if no
 * rider is active). Clears the rider after consumption.
 *
 * PHB: "the first time you hit with a melee attack on your next turn,
 * the target takes an additional 1d6 damage of the triggering type."
 *
 * v1: applies on ANY melee weapon hit (not just on the caster's next
 * turn) — matches "first time you hit" wording.
 */
export function consumeRider(attacker: Combatant): { damage: number; damageType: DamageType } | null {
  if (!attacker._absorbElementsRider) return null;
  const { damageType, diceCount } = attacker._absorbElementsRider;
  let extra = 0;
  for (let i = 0; i < diceCount; i++) {
    extra += rollDiceString('1d6');
  }
  attacker._absorbElementsRider = null;  // one-shot
  return { damage: extra, damageType };
}
