// ============================================================
// Counterspell — PHB p.228
//
// 3rd-level abjuration, reaction
// Trigger: You see a creature within 60 feet of you casting a spell
// Range: 60 feet
// Duration: Instantaneous
//
// Effect:
//   - You attempt to interrupt the spell.
//   - If the spell is L1-3 and you cast Counterspell at L3: it
//     automatically fails (no check).
//   - If the spell is L4+: make an ability check using your
//     spellcasting ability. The DC = 10 + the spell's level.
//     On a success, the spell fails.
//   - Upcast: if you cast Counterspell at L4+, it automatically
//     counters spells of L1 through the slot level used.
//   - The countered spell's slot is still consumed (PHB p.228: "the
//     spell fails and has no effect, but resources used to cast it
//     are consumed").
//   - No concentration.
//
// TG-008 implementation:
//   - `shouldCastReaction` / `executeReaction` are the trigger-aware
//     entry points consumed by the reaction registry.
//   - `executeReaction` returns:
//       `{ kind: 'negated' }` — the spell is countered; the engine
//         aborts the spell execution (the spell's slot is consumed
//         by the engine's spell-casting path before Counterspell fires).
//       `{ kind: 'failed' }` — the ability check failed; the spell
//         resolves normally.
//   - No cleanup needed — the effect is instantaneous.
//
// v1 simplifications:
//   - The reactor's spellcasting ability is assumed to be the highest
//     of INT/WIS/CHA (we don't track which class uses which ability).
//     This is correct for Sorcerers (CHA), Warlocks (CHA), and Wizards
//     (INT), but may be wrong for Bards (CHA) or other classes.
//   - Proficiency bonus is assumed to be +2 (typical L1-L4). Higher-
//     level characters would have a higher prof bonus.
//   - v1 always consumes a L3 slot if available (no tactical upcast).
//     If only L4+ slots are available, the upcast auto-success applies.
//   - Cantrips are NOT countered in v1 (level 0). PHB p.228 says
//     "spell", which includes cantrips, but tactically countering a
//     cantrip with a L3 slot is a bad trade. The engine's trigger
//     point only fires for leveled spells anyway (cantrips go through
//     `case 'cast':` without `slotLevel >= 1`).
//   - Only ONE enemy attempts Counterspell per spell cast (the first
//     eligible enemy in battlefield iteration order). Multiple enemies
//     could each try per PHB, but v1 simplifies to one attempt.
// ============================================================

import { Combatant, Battlefield, ReactionTrigger, ReactionOutcome } from '../types/core';
import { EngineState } from '../engine/combat';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { abilityMod, rollDie } from '../engine/utils';

/**
 * Check if `caster` has a spell slot of at least `minLevel`.
 * Wraps the existing `hasSpellSlot` from resources.ts (which handles
 * both standard slots and Warlock pact slots).
 */
function hasSpellSlotAtLeast(caster: Combatant, minLevel: number): boolean {
  return hasSpellSlot(caster, minLevel);
}

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Counterspell',
  level: 3,
  school: 'abjuration',
  rangeFt: 60,
  concentration: false,
  castingTime: 'reaction',
} as const;

// ---- Trigger-aware shouldCast (TG-008) ----------------------

/**
 * Returns true if `caster` should cast Counterspell in response to
 * `trigger`.
 *
 * Tactical rule (v1):
 *   - Always cast if the spell is L1-3 (auto-success with a L3 slot).
 *   - Cast if the spell is L4-5 (reasonable chance with a +5 check
 *     bonus: DC 14-15, need to roll 9-10+ on the d20, ~55-60% success).
 *   - Don't cast if the spell is L6+ (DC 16+, need to roll 11+ with
 *     a +5 bonus, ~50% or worse — too risky for a L3 slot).
 *   - Don't cast on cantrips (level 0 — wasting a L3 slot).
 *
 * Future enhancement: consider the tactical value of the spell being
 * cast (always counter Fireball; maybe don't counter a low-impact
 * spell like Mage Armor).
 */
export function shouldCastReaction(
  caster: Combatant,
  _bf: Battlefield,
  trigger: ReactionTrigger,
): boolean {
  if (trigger.kind !== 'incoming_spell') return false;
  // Cantrips (level 0) — not worth a L3 slot.
  if (trigger.level < 1) return false;
  // Don't counter our own spells.
  if (trigger.caster.id === caster.id) return false;
  // Range check: PHB p.228 "within 60 feet".
  const dx = Math.abs(caster.pos.x - trigger.caster.pos.x);
  const dy = Math.abs(caster.pos.y - trigger.caster.pos.y);
  const dz = Math.abs(caster.pos.z - trigger.caster.pos.z);
  const distFt = Math.max(dx, dy, dz) * 5;
  if (distFt > 60) return false;
  // Don't counter if the caster is already dead (shouldn't happen mid-cast).
  if (trigger.caster.isDead || trigger.caster.isUnconscious) return false;

  // Tactical gate: v1 won't counter L6+ spells without an auto-success slot
  // (success chance is ~50% or worse even with good stats — too risky for a L3 slot).
  // The check bonus is best-of INT/WIS/CHA + prof (+2).
  const checkBonus = Math.max(
    abilityMod(caster.int),
    abilityMod(caster.wis),
    abilityMod(caster.cha),
  ) + 2;  // +2 prof (v1)
  const dc = 10 + trigger.level;
  // Success chance = (21 - (dc - checkBonus)) / 20, clamped to [0.05, 0.95].
  // For L4: dc=14, need to roll 14-checkBonus on d20. With +6 bonus, need 8+ (65%).
  // For L5: dc=15, need 9+ (60%).
  // For L6: dc=16, need 10+ (55%) — borderline, v1 rejects without auto-success.
  // For L7: dc=17, need 11+ (50%) — too risky.
  // v1 threshold: cast L4-5 without auto-success slot (decent chance).
  // v1 rejects L6+ without auto-success slot (too risky for a L3 slot).
  const minSlotForAutoSuccess = trigger.level;  // need a slot of this level
  // If the caster has a slot of level >= trigger.level, they can upcast
  // for auto-success. Otherwise, they need to roll.
  const hasAutoSuccessSlot = hasSpellSlotAtLeast(caster, minSlotForAutoSuccess);
  if (hasAutoSuccessSlot) return true;  // auto-success — always worth it
  // Otherwise, gate on success chance.
  if (trigger.level >= 6) return false;  // v1: too risky without auto-success
  // For L4-5 without auto-success slot, cast if check bonus is decent.
  if (checkBonus < 3) return false;  // weak caster — low chance
  return true;
}

// ---- Trigger-aware execute (TG-008) -------------------------

/**
 * Execute Counterspell reaction. If the spell is L1-3 and the reactor
 * uses a L3 slot, auto-success. If the spell is L4+ OR the reactor
 * upcasts at a level below the spell's level, make an ability check
 * vs DC 10 + spell level.
 *
 * Returns:
 *   `{ kind: 'negated' }` — the spell is countered.
 *   `{ kind: 'failed' }` — the ability check failed; the spell resolves.
 */
export function executeReaction(
  caster: Combatant,
  state: EngineState,
  trigger: ReactionTrigger,
): ReactionOutcome {
  if (trigger.kind !== 'incoming_spell') return { kind: 'no_effect' };

  // Consume a L3 slot (v1: always L3 if available; upcast only if no L3).
  // If we have a L3 slot, the auto-success threshold is L3.
  // If we only have L4+ slots, the auto-success threshold is that level.
  const slotLevel = consumeSpellSlot(caster, 3) ?? 3;
  caster.budget.reactionUsed = true;

  // Determine if this is an auto-success or an ability check.
  // PHB p.228: "If the spell is an area of effect spell, its area
  //   ... " — wait, the actual rule:
  //   "If the spell's level is less than or equal to the level of the
  //    spell slot you used, the spell fails and has no effect."
  // So auto-success if slotLevel >= trigger.level.
  let countered: boolean;
  let checkRoll: number | null = null;
  let checkTotal: number | null = null;
  let dc = 0;

  if (slotLevel >= trigger.level) {
    // Auto-success.
    countered = true;
  } else {
    // Ability check using spellcasting ability (best of INT/WIS/CHA in v1).
    // DC = 10 + spell's level.
    dc = 10 + trigger.level;
    const checkBonus = Math.max(
      abilityMod(caster.int),
      abilityMod(caster.wis),
      abilityMod(caster.cha),
    ) + 2;  // +2 prof (v1)
    checkRoll = rollDie(20);
    checkTotal = checkRoll + checkBonus;
    countered = checkTotal >= dc;
  }

  // Log the result.
  if (countered) {
    state.log.events.push({
      round: state.battlefield.round ?? 0,
      actorId: caster.id,
      type: 'action',
      targetId: trigger.caster.id,
      description: `${caster.name} casts Counterspell (L${slotLevel}) — ${trigger.caster.name}'s ${trigger.spellName} (L${trigger.level}) is NEGATED${slotLevel >= trigger.level ? ' (auto-success)' : ` (ability check ${checkTotal} vs DC ${dc})`}!`,
    });
    return { kind: 'negated', detail: `Counterspell succeeded (L${slotLevel} slot vs L${trigger.level} spell)` };
  } else {
    state.log.events.push({
      round: state.battlefield.round ?? 0,
      actorId: caster.id,
      type: 'action',
      targetId: trigger.caster.id,
      description: `${caster.name} casts Counterspell (L${slotLevel}) — but the ability check (${checkTotal} vs DC ${dc}) FAILS — ${trigger.caster.name}'s ${trigger.spellName} resolves!`,
    });
    return { kind: 'failed', detail: `Counterspell ability check failed (${checkTotal} vs DC ${dc})` };
  }
}

// ---- cleanup ------------------------------------------------
//
// No cleanup needed — Counterspell is instantaneous.

export function cleanup(_caster: Combatant): void {
  // No-op — instantaneous spell.
}
