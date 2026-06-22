// ============================================================
// Dispel Magic — PHB p.233
//
// 3rd-level abjuration, action, range 120 ft, NO concentration.
// Components: V, S.
//
// Effect: Choose one creature, object, or magical effect within range.
//         Any spell of 3rd level or lower on the target ends. For each
//         spell of 4th level or higher on the target, make an ability
//         check using your spellcasting ability (no proficiency). The DC
//         equals 10 + the spell's level. On a successful check, the
//         spell ends.
//
// Upcast: +1 automatic dispel level per slot level above 3rd
//         (e.g., 4th-level slot dispels L4 and below automatically).
//
// v1 simplifications:
//   - Spell-level tracking: ActiveEffect does not currently store the
//     source spell's level. v1 approach:
//       * Concentration-sourced effects are auto-dispelled (concentration
//         spells end when dispelled — PHB p.233).
//       * Non-concentration effects require an ability check vs DC 13
//         (v1 flat DC — no spell-level tracking). The check uses the
//         caster's spellcasting ability modifier (derived from highest
//         mental stat: INT/WIS/CHA).
//       * Upcast: auto-dispel 1 additional non-concentration effect
//         per slot level above 3rd (bypassing the ability check).
//   - Target: v1 targets a SINGLE creature within 120 ft (no object
//     or "magical effect" targeting — those are edge cases).
//   - Spell-level-based DC: PHB p.233 says the DC is 10 + spell level.
//     v1 uses DC 13 (approximating a 3rd-level spell) since we can't
//     determine the actual spell level. Forward-compat TODO via the
//     metadata flag `dispelMagicSpellLevelTrackingV1Implemented: false`.
//   - Exhaustion: NOT removed by Dispel Magic (PHB p.291: exhaustion
//     persists until rest/spell removal). Exhaustion_level effects are
//     skipped.
//
// Spell module pattern:
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op
// ============================================================

import { Combatant, Battlefield, ActiveEffect } from '../types/core';
import { CombatEvent, EngineState, rollAbilityCheckReactable } from '../engine/combat';
import { removeEffectById } from '../engine/spell_effects';
import { rollDie, abilityMod } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Dispel Magic',
  level: 3,
  school: 'abjuration',
  rangeFt: 120,
  concentration: false,
  castingTime: 'action',
  // v1 simplification flags
  dispelMagicSpellLevelTrackingV1Implemented: false,   // DC 13 flat instead of 10 + spell level
  dispelMagicObjectTargetingV1Implemented: false,      // creature-only targeting
} as const;

/** v1 flat DC for non-concentration effect ability checks */
const V1_FLAT_DC = 13;

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

// ---- Spellcasting ability helper ----------------------------

/**
 * Derive the caster's spellcasting ability modifier.
 * v1: uses the highest mental stat (INT/WIS/CHA).
 * PHB p.233: "make an ability check using your spellcasting ability".
 * No proficiency is added (PHB p.233 explicit).
 */
export function spellcastingMod(caster: Combatant): number {
  return Math.max(abilityMod(caster.int), abilityMod(caster.wis), abilityMod(caster.cha));
}

// ---- Ability check (no proficiency) -------------------------

/**
 * Roll a d20 + spellcasting ability modifier (no proficiency).
 * Returns the total.
 */
export function rollAbilityCheck(caster: Combatant): number {
  return rollDie(20) + spellcastingMod(caster);
}

// ---- Planner ------------------------------------------------

/**
 * Returns the best target for Dispel Magic (a living enemy within 120 ft
 * that has active spell effects from any caster), or null when the spell
 * should not be cast.
 *
 * Target priority:
 *   1. Enemy with the MOST active effects (most value per cast)
 *   2. Tie-break: closest enemy
 *
 * Preconditions:
 *   - Caster has 'Dispel Magic' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - At least 1 enemy within 120 ft has active spell effects
 *
 * Note: Dispel Magic is NOT concentration — it can be cast regardless
 * of the caster's concentration state.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Dispel Magic')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const candidates: Array<{ c: Combatant; effectCount: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 120) continue;

    // Count active effects that are dispellable (skip exhaustion_level)
    const dispellableEffects = c.activeEffects.filter(e =>
      e.effectType !== 'exhaustion_level'
    );
    if (dispellableEffects.length === 0) continue;

    candidates.push({ c, effectCount: dispellableEffects.length, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.effectCount !== b.effectCount) return b.effectCount - a.effectCount;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Dispel Magic:
 *  1. Consume a 3rd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Categorize effects on the target:
 *     - Concentration effects → auto-dispelled
 *     - Non-concentration effects → ability check vs DC 13 (v1 flat DC)
 *       Exception: upcast auto-dispels additional non-concentration effects
 *       (1 extra per slot level above 3rd)
 *     - exhaustion_level effects → NOT dispelled (PHB p.291)
 *  3. For each auto-dispelled effect: remove via removeEffectById
 *  4. For non-concentration effects: roll ability check; on success, remove
 *  5. Log all dispels
 *
 *  Upcast (PHB p.233): "When you cast this spell using a spell slot of
 *  4th level or higher, you automatically end the effects of a spell on
 *  the target if the spell's level is equal to or less than the level of
 *  the spell slot you used." v1: auto-dispel N extra non-concentration
 *  effects, where N = (slotLevel - 3).
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const slotLevel = consumeSpellSlot(caster, 3);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Dispel Magic at ${target.name}! (slot level ${slotLevel ?? '?'})`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;
  if (slotLevel === null) return; // no slot was consumed — shouldn't happen

  // Categorize effects
  const concentrationEffects: ActiveEffect[] = [];
  const nonConcentrationEffects: ActiveEffect[] = [];

  for (const effect of [...target.activeEffects]) {
    // Skip exhaustion — PHB p.291: not removed by dispel
    if (effect.effectType === 'exhaustion_level') continue;

    if (effect.sourceIsConcentration) {
      concentrationEffects.push(effect);
    } else {
      nonConcentrationEffects.push(effect);
    }
  }

  let dispelledCount = 0;

  // 1. Auto-dispel all concentration effects
  for (const effect of concentrationEffects) {
    removeEffectById(target.id, effect.id, state.battlefield);
    dispelledCount++;

    emit(
      state, 'condition_remove', caster.id,
      `${target.name}'s ${effect.spellName} (concentration) is dispelled by Dispel Magic!`,
      target.id,
    );

    // If the target was concentrating on this spell, break their concentration
    if (target.concentration?.active && target.concentration.spellName === effect.spellName) {
      target.concentration = null;
    }
  }

  // 2. Non-concentration effects: ability check vs DC 13
  //    Upcast: first (slotLevel - 3) non-concentration effects are auto-dispelled
  const autoDispelCount = Math.max(0, slotLevel - 3);

  for (let i = 0; i < nonConcentrationEffects.length; i++) {
    const effect = nonConcentrationEffects[i];

    // Check if effect still exists (it may have been removed by a previous
    // removal that cascaded — e.g. concentration break cleanup)
    if (!target.activeEffects.some(e => e.id === effect.id)) continue;

    if (i < autoDispelCount) {
      // Upcast auto-dispel
      removeEffectById(target.id, effect.id, state.battlefield);
      dispelledCount++;

      emit(
        state, 'condition_remove', caster.id,
        `${target.name}'s ${effect.spellName} is automatically dispelled by upcast Dispel Magic (slot level ${slotLevel})!`,
        target.id,
      );
    } else {
      // Ability check vs DC 13 (v1 flat DC)
      // Session 43 Task #26: use rollAbilityCheckReactable so Silvery Barbs
      // can fire on a successful check. The opponent is the target creature
      // (whose effect is being dispelled) — they might cast Silvery Barbs
      // to protect their buff if the dispel came from an enemy.
      //
      // PHB p.233: "make an ability check using your spellcasting ability".
      // The local spellcastingMod() helper returns max(INT, WIS, CHA) mod.
      // The canonical rollAbilityCheck takes a specific ability — we pass
      // 'int' as the v1 default (Wizards are the typical dispellers).
      // No proficiency per PHB p.233 (isProficient=false).
      const spellcastingAbility: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha' = 'int';
      const checkResult = rollAbilityCheckReactable(
        state,
        caster,    // checker (the one making the ability check)
        target,    // opponent (the target creature — might protect their buff)
        spellcastingAbility,
        V1_FLAT_DC,
        false,     // no proficiency (PHB p.233 explicit)
        'dispel magic',
      );
      const check = checkResult.total;
      const success = checkResult.success;

      if (success) {
        removeEffectById(target.id, effect.id, state.battlefield);
        dispelledCount++;

        emit(
          state, 'condition_remove', caster.id,
          `${caster.name} dispels ${target.name}'s ${effect.spellName}! (check ${check} vs DC ${V1_FLAT_DC}${checkResult.negated ? ' — Silvery Barbs did NOT flip' : ''})`,
          target.id,
          check,
        );
      } else {
        emit(
          state, 'save_success', caster.id,
          `${caster.name} fails to dispel ${target.name}'s ${effect.spellName} (check ${check} vs DC ${V1_FLAT_DC}${checkResult.negated ? ' — Silvery Barbs FLIPPED success to failure!' : ''})`,
          target.id,
          check,
        );
      }
    }
  }

  emit(
    state, 'action', caster.id,
    `Dispel Magic removed ${dispelledCount} effect(s) from ${target.name}`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — Dispel Magic is instantaneous, no ongoing effects.
}
