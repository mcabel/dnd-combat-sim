// ============================================================
// Greater Invisibility — PHB p.254
//
// 4th-level illusion, action, range Self, concentration (1 min).
// Components: V, S.
//
// Effect: You or a creature you touch becomes invisible until the
//         spell ends. Anything the target is wearing or carrying is
//         invisible as long as it is on the target's person.
//
// KEY DIFFERENCE FROM INVISIBILITY (L2, PHB p.254):
//   - Greater Invisibility targets SELF (PHB p.254: "You or a creature
//     you touch" — but in practice it's almost always self-cast by
//     martial casters who want invisible-advantage on every attack).
//   - Greater Invisibility does NOT have the "ends on attack or cast"
//     clause that Invisibility has. The caster stays invisible for the
//     full duration regardless of their actions.
//   - v1 models this by NOT setting `breaksOnAttackOrCast` on the
//     ActiveEffect — the effect persists until concentration breaks.
//
// v1 simplifications:
//   - Range: canon "self or touch" → v1 always self (the most common
//     use case in combat).
//   - Duration: canon 1 min concentration → v1: concentration is
//     started, but NOT enforced (TG-002). The invisible condition
//     persists until removeEffectsFromCaster() is called.
//   - The invisible condition is already wired into attackAdvantageState
//     (utils.ts): invisible attacker has advantage, attacks vs invisible
//     target have disadvantage. No additional integration needed.
//   - The ends-on-attack/cast hook from Invisibility (Session 32) does
//     NOT fire for Greater Invisibility because we don't set the
//     `breaksOnAttackOrCast` flag.
//
// Spell module pattern:
//   shouldCast(caster, bf) → boolean   (self-buff — no target picker)
//   execute(caster, _target, state) → void
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Greater Invisibility',
  level: 4,
  school: 'illusion',
  rangeFt: 0,       // self
  concentration: true,
  castingTime: 'action',
  greaterInvisibilityEndsOnAttackV1Implemented: false,  // NOT applicable — no ends-on-attack clause
  greaterInvisibilityUpcastV1Implemented: false,        // no upcast in PHB
  greaterInvisibilityConcentrationEnforcementV1Implemented: false,  // see TG-002
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
 * Returns true if the caster should cast Greater Invisibility this turn.
 *
 * Preconditions:
 *   - Caster has 'Greater Invisibility' in their actions
 *   - Caster has at least one 4th-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster is NOT already invisible (no stacking)
 *   - Caster doesn't already have a Greater Invisibility effect active
 *
 * Target: self only (PHB p.254 — most common combat use is self-cast).
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Greater Invisibility')) return false;
  if (!hasSpellSlot(caster, 4)) return false;
  if (caster.conditions.has('invisible')) return false;

  // Skip if caster already has a Greater Invisibility effect active
  if (caster.activeEffects.some(e =>
    e.spellName === 'Greater Invisibility' && e.effectType === 'invisible'
  )) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Greater Invisibility:
 *  1. Consume a 4th-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Greater Invisibility.
 *  4. Apply invisible effect on the caster (self).
 *
 * The 'invisible' SpellEffectType handles:
 *   - Adding the 'invisible' condition (for OA immunity, etc.)
 *   - Disadvantage on attacks vs the creature (can't see target, PHB p.194)
 *   - Advantage on the creature's own attacks (unseen attacker, PHB p.194)
 *
 * NOTE: Unlike Invisibility (L2), Greater Invisibility does NOT set
 * `breaksOnAttackOrCast` on the effect. The caster stays invisible for
 * the full duration regardless of their actions (PHB p.254).
 */
export function execute(
  caster: Combatant,
  _target: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 4);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Greater Invisibility');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Greater Invisibility!`,
    caster.id,
  );

  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Greater Invisibility',
    effectType: 'invisible',
    payload: {},
    sourceIsConcentration: true,
    // PHB p.254: Greater Invisibility does NOT have the "ends on attack or
    // cast" clause. The caster stays invisible for the full duration.
    // Therefore we do NOT set breaksOnAttackOrCast (it defaults to undefined/false).
  });

  emit(
    state, 'condition_add', caster.id,
    `${caster.name} turns INVISIBLE! (advantage on attacks, disadvantage on attacks vs them; does NOT end on attack/cast)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
