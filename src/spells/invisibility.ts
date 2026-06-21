// ============================================================
// Invisibility — PHB p.254
//
// 2nd-level illusion, action, range Touch, concentration (1 hr).
// Components: V, S, M (an eyelash encased in gum arabic).
//
// Effect: A creature you touch becomes invisible until the spell ends.
//         Anything the target is wearing or carrying is invisible as long
//         as it is on the target's person. The spell ends for a target
//         that attacks or casts a spell.
//
// Upcast: +1 target per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - Duration: canon 1 hr concentration → v1: concentration is started,
//     but NOT enforced (TG-002). The invisible condition persists until
//     removeEffectsFromCaster() is called OR the target attacks/casts.
//   - "Spell ends for a target that attacks or casts a spell": v1 does NOT
//     model this end condition (no per-action hook to break invisibility
//     when the invisible creature attacks/casts). Forward-compat TODO via
//     the metadata flag `invisibilityEndsOnAttackV1Implemented: false`.
//     In v1, the invisible condition persists for the entire combat (or
//     until concentration breaks) regardless of the target's actions.
//     This is a known v1 simplification — a creature could become invisible,
//     attack with advantage, and STAY invisible for subsequent attacks.
//   - Upcast: +1 target/slot-level NOT modelled — v1 always targets a
//     single creature.
//   - The invisible condition is already wired into attackAdvantageState
//     (utils.ts): invisible attacker has advantage, attacks vs invisible
//     target have disadvantage. No additional integration needed.
//
// Spell module pattern:
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Invisibility',
  level: 2,
  school: 'illusion',
  rangeFt: 5,       // touch
  concentration: true,
  castingTime: 'action',
  invisibilityEndsOnAttackV1Implemented: false,               // ends-on-attack NOT modelled
  invisibilityUpcastV1Implemented: false,                     // +1 target/slot-level NOT modelled
  invisibilityConcentrationEnforcementV1Implemented: false,   // see TG-002
} as const;

// ---- Local log helper ---------------------------------------

function emit(
  state: EngineState,
  type: CombatEvent['type'],
  actorId: string,
  desc: string,
  targetId?: string,
  value?: number,
): void {
  state.log.events.push({
    round: state.battlefield.round,
    actorId,
    type,
    targetId,
    value,
    description: desc,
  });
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Invisibility (a living ally within
 * touch range, not already invisible, not already Invisibility'd by this
 * caster), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Self (caster) — if the caster has a weapon attack (a squishy caster
 *      that attacks at range benefits most from invisible-advantage).
 *   2. Lowest-HP% ally within 5 ft with a weapon attack (most vulnerable
 *      benefits from disadvantage on attacks vs them).
 *
 * Preconditions:
 *   - Caster has 'Invisibility' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid ally target exists within 5 ft
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Invisibility')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;

    // Skip if already invisible (no stacking).
    if (c.conditions.has('invisible')) continue;

    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Invisibility'
    )) continue;

    candidates.push({ c, hpPct: c.currentHP / c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: self first, then lowest HP%, then closest.
  candidates.sort((a, b) => {
    const aSelf = a.c.id === caster.id ? 0 : 1;
    const bSelf = b.c.id === caster.id ? 0 : 1;
    if (aSelf !== bSelf) return aSelf - bSelf;
    if (Math.abs(a.hpPct - b.hpPct) > 0.01) return a.hpPct - b.hpPct;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Invisibility:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Invisibility.
 *  4. Apply invisible effect on the target.
 *     The 'invisible' SpellEffectType handles:
 *     - Adding the 'invisible' condition (for OA immunity, etc.)
 *     - Disadvantage on attacks vs the creature (can't see target, PHB p.194)
 *     - Advantage on the creature's own attacks (unseen attacker, PHB p.194)
 *
 * v1 simplifications: ends-on-attack NOT modelled; upcast NOT modelled;
 * concentration NOT enforced (TG-002).
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Invisibility');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Invisibility on ${target.name}!`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Invisibility',
    effectType: 'invisible',
    payload: {},
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} turns INVISIBLE! (advantage on attacks, disadvantage on attacks vs them)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
