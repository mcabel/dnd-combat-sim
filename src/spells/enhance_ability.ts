// ============================================================
// Enhance Ability — PHB p.237
//
// 2nd-level transmutation, action, range Touch (5 ft), concentration (1 hr).
// Components: V, S, M (a pinch of fur from a bloodhound).
//
// Effect: You touch a creature and bestow upon it a magical enhancement.
//         Choose one of the following effects for the duration; the target
//         gains the chosen benefit:
//           Bear's Endurance: The target has advantage on Constitution
//             checks. It also gains 2d6 temporary hit points, which are
//             lost when the spell ends.
//           Bull's Strength: The target has advantage on Strength checks.
//           Cat's Grace: The target has advantage on Dexterity checks. It
//             doesn't take damage from falling 20 feet or less if it isn't
//             incapacitated.
//           Eagle's Splendor: The target has advantage on Charisma checks.
//           Fox's Cunning: The target has advantage on Intelligence checks.
//           Owl's Wisdom: The target has advantage on Wisdom checks.
//
// Upcast: — (PHB p.237 lists no At Higher Levels entry for advantage;
//   the temp HP from Bear's Endurance doesn't scale).
//
// v1 simplifications:
//   - Duration: canon 1 hr concentration → v1: concentration is started
//     via startConcentration(), but the engine does NOT enforce
//     concentration checks (TG-002). The `_enhanceAbilityActive` scratch
//     field persists until removeEffectsFromCaster() is called (the spell
//     uses a damage_zone sentinel effect with dieCount=0 to anchor
//     concentration-break cleanup — see _undoEffect in spell_effects.ts).
//   - Bear's Endurance temp HP: v1 does NOT model the 2d6 temp HP
//     (forward-compat TODO via the metadata flag
//     `enhanceAbilityTempHPV1Implemented: false`).
//   - Cat's Grace fall-damage immunity: v1 does NOT model this (no fall-
//     damage subsystem — forward-compat TODO via the metadata flag
//     `enhanceAbilityFallDamageImmunityV1Implemented: false`).
//   - v1 models ONLY the advantage-on-ability-checks effect (the universal
//     benefit across all six options). The target's `_enhanceAbilityActive`
//     scratch field holds the ability score whose checks gain advantage.
//   - Option selection: v1 picks the ability based on the target's highest
//     ability score (the target is "best at" that ability — advantage there
//     is most impactful). Future work could let the caster choose.
//
// Spell module pattern:
//   shouldCast(caster, bf) → { target, ability } | null
//   execute(caster, target, ability, state) → void
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster
//               via the damage_zone sentinel → _undoEffect clears the scratch field)
// ============================================================

import { Combatant, Battlefield, AbilityScore } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Enhance Ability',
  level: 2,
  school: 'transmutation',
  rangeFt: 5,       // touch
  concentration: true,
  castingTime: 'action',
  enhanceAbilityTempHPV1Implemented: false,                  // Bear's Endurance 2d6 temp HP skipped
  enhanceAbilityFallDamageImmunityV1Implemented: false,      // Cat's Grace fall immunity skipped
  enhanceAbilityConcentrationEnforcementV1Implemented: false, // see TG-002
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
 * Returns the best target + ability for Enhance Ability, or null when the
 * spell should not be cast.
 *
 * Target priority: lowest-HP% ally within touch range (most vulnerable
 * benefits most from any buff). Self is a valid target.
 *
 * Ability selection (v1 simplification): the target's HIGHEST ability
 * score — advantage on the target's best ability is most impactful.
 *
 * Preconditions:
 *   - Caster has 'Enhance Ability' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid ally target exists within 5 ft
 *   - Target is NOT already Enhanced-Ability'd by this caster
 */
export function shouldCast(
  caster: Combatant,
  bf: Battlefield,
): { target: Combatant; ability: AbilityScore } | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Enhance Ability')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;

    // Skip if already Enhanced-Ability'd by this caster.
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Enhance Ability'
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

  const target = candidates[0].c;

  // Pick the target's highest ability score.
  const scores: Array<[AbilityScore, number]> = [
    ['str', target.str], ['dex', target.dex], ['con', target.con],
    ['int', target.int], ['wis', target.wis], ['cha', target.cha],
  ];
  scores.sort((a, b) => b[1] - a[1]);

  return { target, ability: scores[0][0] };
}

// ---- Execution ----------------------------------------------

/**
 * Execute Enhance Ability:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Enhance Ability.
 *  4. Set `_enhanceAbilityActive = ability` on the target (scratch field).
 *     rollAbilityCheck (utils.ts) checks this flag and grants advantage on
 *     ability checks of the matching ability.
 *  5. Attach a `damage_zone` sentinel effect (dieCount=0) to anchor
 *     concentration-break cleanup. When the sentinel is removed by
 *     removeEffectsFromCaster, _undoEffect clears `_enhanceAbilityActive`.
 *
 * v1 simplifications: Bear's Endurance temp HP NOT modelled; Cat's Grace
 * fall-damage immunity NOT modelled; concentration NOT enforced (TG-002).
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  ability: AbilityScore,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  // Safety: clean up any stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Enhance Ability');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Enhance Ability on ${target.name}! (${ability.toUpperCase()} checks gain advantage)`,
    target.id,
  );

  // Re-check liveness (stale edge case)
  if (target.isDead || target.isUnconscious) return;

  target._enhanceAbilityActive = ability;

  // Attach a damage_zone sentinel (dieCount=0) so removeEffectsFromCaster
  // clears the scratch field on concentration break. The start-of-turn
  // damage tick naturally skips dieCount=0 effects.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Enhance Ability',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} has advantage on ${ability.toUpperCase()} checks!`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Enhance Ability — called from resetBudget() at the start
 * of the caster's next turn. NO-OP in v1 because:
 *   - Enhance Ability is a concentration spell; the scratch field is cleared
 *     via removeEffectsFromCaster() when concentration breaks (the damage_zone
 *     sentinel's _undoEffect clears `_enhanceAbilityActive`).
 *   - v1 does NOT enforce concentration checks (TG-002).
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via the sentinel effect.
}
