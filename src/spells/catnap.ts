// ============================================================
// Catnap — XGE p.151
//
// 3rd-level enchantment, action, range 30 ft, NO concentration (10 min).
// Components: V, S, M (a pinch of sand).
//
// Effect: You make a soothing gesture, and up to three willing creatures
//         of your choice within range fall unconscious for the spell's
//         duration. The spell ends on a target early if it takes damage
//         or someone uses an action to shake it awake. This spell
//         provides the equivalent of a short rest.
//
// Upcast: +1 target per slot-level above 3rd (not modelled in v1).
//
// v1 simplifications:
//   - Willing-target / NO save (XGE p.151: "willing creatures"). v1
//     treats same-faction allies as willing (no save rolled). This is a
//     NEW selection pattern (willing allies, not enemies). Documented via
//     `catnapWillingAlliesV1Simplified` — v1 has no willingness flag;
//     same-faction = willing.
//   - Short-rest benefit (XGE p.151: "equivalent of a short rest"):
//     NOT modelled (v1 has no short-rest subsystem). v1 applies ONLY the
//     sleeping condition — which is tactically poor in combat (disabling
//     allies). Documented via `catnapShortRestBenefitV1NotModelled`.
//   - Wake-on-damage / shake-awake (XGE p.151): NOT modelled — sleeping
//     persists for the v1 combat. NOT concentration (sourceIsConc: false).
//   - Target cap: 3 (XGE p.151: "up to three"). v1 caps at 3 allies.
//   - Upcast +1/slot-level NOT modelled.
//   - Range: canon 30 ft. v1 uses chebyshev3D * 5.
//
// NOTE: Because v1 models no short-rest benefit, catnap is tactically
// poor (it only disables allies). The planner may still cast it when
// allies are in range — a known v1 limitation. A future short-rest
// subsystem would give it real value.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke willing-target sleeping (no save).
// Removed from `_generic_registry.ts`; routed via `case 'catnap':` in
// combat.ts and a planner branch in planner.ts. NEW pattern: shouldCast
// targets ALLIES (same faction), not enemies.
//
// Spell module pattern (willing-target condition, no save, no conc):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (no concentration; sleeping persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Catnap',
  level: 3,
  school: 'enchantment',
  rangeFt: 30,                   // XGE p.151: 30 ft
  maxTargets: 3,                 // XGE p.151: up to 3
  concentration: false,
  saveAbility: null,             // XGE p.151: NO save (willing)
  castingTime: 'action',
  catnapWillingAlliesV1Simplified: true,                   // same-faction = willing
  catnapShortRestBenefitV1NotModelled: true,               // short-rest benefit NOT modelled
  catnapUpcastV1Implemented: false,                        // +1 target/slot-level NOT modelled
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
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

// ---- Planner ------------------------------------------------

/**
 * Returns up to 3 willing ALLIES within 30 ft of the caster, or null when
 * the spell should not be cast. (NEW pattern: targets allies, not enemies.)
 *
 * Target selection:
 *   1. Collect living same-faction allies (excluding the caster) within 30 ft.
 *   2. Skip allies already sleeping/incapacitated (no benefit).
 *   3. Sort by id (deterministic) and take up to `metadata.maxTargets` (3).
 *
 * Preconditions:
 *   - Caster has 'Catnap' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - At least 1 willing ally exists within 30 ft
 *
 * Note: Catnap is NOT concentration — it can be cast while concentrating.
 * NOTE: v1 models no short-rest benefit, so catnap only sleeps allies
 * (tactically poor). The planner may still cast it — a known limitation.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Catnap')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const candidates: Combatant[] = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction !== caster.faction) continue;       // ALLIES only (willing)
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;
    if (c.conditions.has('sleeping') || c.conditions.has('incapacitated')) continue;
    candidates.push(c);
  }
  if (candidates.length === 0) return null;
  // Sort by id for deterministic selection, then cap at maxTargets.
  candidates.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return candidates.slice(0, metadata.maxTargets);
}

// ---- Execution ----------------------------------------------

/**
 * Execute Catnap:
 *  1. Consume a 3rd-level spell slot.
 *  2. For each willing ally: apply sleeping (NO save — willing targets).
 *     NOT concentration (sourceIsConcentration: false).
 *
 * @param caster  The casting Combatant (Bard / Sorcerer / Wizard)
 * @param targets Candidates from shouldCast (up to 3 allies in 30 ft)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 3);

  emit(state, 'action', caster.id,
    `${caster.name} casts Catnap! (${targets.length} willing all${targets.length !== 1 ? 'ies' : 'y'} fall asleep — no save, no short-rest benefit in v1)`);

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;
    if (target.conditions.has('sleeping')) {
      emit(state, 'condition_add', caster.id, `${target.name} is already asleep — Catnap has no additional effect.`, target.id);
      continue;
    }
    applySpellEffect(target, {
      casterId: caster.id, spellName: 'Catnap',
      effectType: 'condition_apply', payload: { condition: 'sleeping' },
      sourceIsConcentration: false,   // XGE p.151: NOT concentration (10 min)
    });
    emit(state, 'condition_add', caster.id,
      `${target.name} falls ASLEEP (willing, no save)! (v1: short-rest benefit NOT modelled — sleeping only)`, target.id);
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration; sleeping persists */ }
