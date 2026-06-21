// ============================================================
// Hellish Rebuke — PHB p.249 (also in XGE p.157 with clarifications)
//
// 1st-level evocation, reaction
// Trigger: You take damage from a creature within 60 feet of you that
//          you can see
// Range: 60 feet
// Duration: Instantaneous
//
// Effect:
//   - The triggering creature must make a DEX saving throw.
//   - On a failed save: 2d10 fire damage.
//   - On a successful save: half damage (1d10).
//   - Upcast: +1d10 damage per slot level above 1st.
//   - No concentration.
//
// TG-008 implementation:
//   - `shouldCastReaction` / `executeReaction` are the trigger-aware
//     entry points consumed by the reaction registry.
//   - `executeReaction` returns `{ kind: 'no_effect' }` — the reaction
//     deals damage to the attacker but does NOT negate the triggering
//     damage (the attacker's action still resolves normally).
//   - No cleanup needed — the effect is instantaneous.
//
// v1 simplifications:
//   - The save DC is computed from the caster's CHA mod + proficiency
//     bonus (Warlock spell, PHB p.249). v1 assumes proficiency bonus
//     of +2 (typical for L1-L4 characters). Higher-level characters
//     would have a higher prof bonus, but v1 doesn't track CR-based
//     prof bonus for monsters.
//   - Upcast is supported via `consumeSpellSlot(caster, 1)` returning
//     the actual slot level consumed.
// ============================================================

import { Combatant, Battlefield, ReactionTrigger, ReactionOutcome } from '../types/core';
import { EngineState } from '../engine/combat';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { rollSave, applyDamageWithTempHP, abilityMod, rollDiceString } from '../engine/utils';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Hellish Rebuke',
  level: 1,
  school: 'evocation',
  rangeFt: 60,
  concentration: false,
  castingTime: 'reaction',
} as const;

// ---- Trigger-aware shouldCast (TG-008) ----------------------

/**
 * Returns true if `caster` should cast Hellish Rebuke in response to
 * `trigger`.
 *
 * Tactical rule (v1): cast whenever the trigger is incoming_damage
 * from a creature within 60 ft and the damage dealt is > 0. Hellish
 * Rebuke is a retaliation spell — it's always tactically valid to
 * punish an attacker.
 *
 * Future enhancement: gate on the attacker's current HP (don't waste
 * a slot if the attacker is about to die from another source) or on
 * the caster's remaining slots (conserve slots if low).
 */
export function shouldCastReaction(
  caster: Combatant,
  _bf: Battlefield,
  trigger: ReactionTrigger,
): boolean {
  if (trigger.kind !== 'incoming_damage') return false;
  if (trigger.amount <= 0) return false;
  if (trigger.attacker.id === caster.id) return false;
  // PHB p.249: "in reaction to taking damage from a creature within 60
  // feet of you that you can see." Check range (Chebyshev distance * 5 ft).
  const dx = Math.abs(caster.pos.x - trigger.attacker.pos.x);
  const dy = Math.abs(caster.pos.y - trigger.attacker.pos.y);
  const dz = Math.abs(caster.pos.z - trigger.attacker.pos.z);
  const distFt = Math.max(dx, dy, dz) * 5;
  if (distFt > 60) return false;
  // Don't cast if the attacker is already dead (shouldn't happen — the
  // attacker just dealt damage — but guard).
  if (trigger.attacker.isDead || trigger.attacker.isUnconscious) return false;
  return true;
}

// ---- Trigger-aware execute (TG-008) -------------------------

/**
 * Execute Hellish Rebuke reaction. The attacker makes a DEX save vs
 * the caster's spell DC. Failed save: 2d10 fire. Successful save: half.
 * Returns `{ kind: 'no_effect' }` — the reaction deals damage but does
 * NOT negate the triggering action.
 */
export function executeReaction(
  caster: Combatant,
  state: EngineState,
  trigger: ReactionTrigger,
): ReactionOutcome {
  if (trigger.kind !== 'incoming_damage') return { kind: 'no_effect' };

  // Consume a L1 slot. The actual level consumed determines the damage
  // (2d10 at L1, +1d10 per slot level above 1st).
  const slotLevel = consumeSpellSlot(caster, 1) ?? 1;
  caster.budget.reactionUsed = true;

  // Save DC: 8 + CHA mod + prof bonus. v1 assumes +2 prof (typical L1-L4).
  // For monsters with CR-based prof, this is a slight undercount at high CR.
  const profBonus = 2;  // v1 simplification
  const dc = 8 + abilityMod(caster.cha) + profBonus;

  // Damage: 2d10 at L1, +1d10 per slot level above 1st.
  const diceCount = 2 + Math.max(0, slotLevel - 1);
  let dmg = 0;
  for (let i = 0; i < diceCount; i++) dmg += rollDiceString('1d10');

  // Attacker makes DEX save.
  const save = rollSave(trigger.attacker, 'dex', dc);
  const actualDmg = save.success ? Math.floor(dmg / 2) : dmg;
  const dealt = applyDamageWithTempHP(trigger.attacker, actualDmg, 'fire');

  // Log the save result.
  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: trigger.attacker.id,
    type: save.success ? 'save_success' : 'save_fail',
    targetId: caster.id,
    description: `${trigger.attacker.name} ${save.success ? 'succeeds' : 'fails'} DC ${dc} DEX save vs Hellish Rebuke (rolled ${save.total})`,
    value: save.roll,
  });

  // Log the damage.
  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: caster.id,
    type: 'damage',
    targetId: trigger.attacker.id,
    description: `${caster.name} casts Hellish Rebuke at ${trigger.attacker.name} — ${dealt} fire damage (${save.success ? 'save half' : 'save fail'}, ${diceCount}d10=${dmg} at L${slotLevel})!`,
    value: dealt,
  });

  return { kind: 'no_effect' };
}

// ---- cleanup ------------------------------------------------
//
// No cleanup needed — Hellish Rebuke is instantaneous. The cleanup
// function is a no-op exported for symmetry with other reaction spell
// modules (and in case future versions add a lingering effect).

export function cleanup(_caster: Combatant): void {
  // No-op — instantaneous spell.
}
