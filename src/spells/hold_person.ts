// ============================================================
// Hold Person — PHB p.251
//
// 2nd-level enchantment, action, range 60 ft, concentration (1 min).
// Components: V, S, M (a small, straight piece of iron).
//
// Effect: Choose a humanoid that you can see within range. The target
//         must succeed on a Wisdom saving throw or be paralyzed for
//         the duration. At the end of each of its turns, the target
//         can make another Wisdom saving throw. On a success, the
//         spell ends on the target.
//
// Upcast: +1 target per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - Duration: canon 1 min concentration → v1: concentration is started
//     via startConcentration(), but the engine does NOT yet enforce
//     concentration checks on damage taken (forward-compat TODO; see
//     TG-002 in TEAMGOALS.md). The paralyzed condition persists until
//     removeEffectsFromCaster() is called (concentration break by
//     re-cast, or combat end).
//   - End-of-turn WIS save to end early: PHB p.251 says "At the end of
//     each of its turns, the target can make another Wisdom saving
//     throw. On a success, the spell ends on the target." v1 does NOT
//     model this (forward-compat TODO via the metadata flag
//     `holdPersonEndOfTurnSaveV1Implemented: false`). The condition
//     persists for the entire combat in v1.
//   - Humanoid creature-type restriction: PHB p.251 says "Choose a
//     humanoid". v1 does NOT verify creature type (parser tech debt —
//     TG-004 in TEAMGOALS.md). All living enemies are valid targets.
//   - Upcast: +1 target per slot level above 2nd NOT modelled — v1
//     always targets a single creature. Forward-compat TODO via
//     `holdPersonUpcastV1Implemented: false`.
//   - Paralyzed auto-crit (PHB p.292: "Any attack that hits the
//     creature is a critical hit if the attacker is within 5 feet of
//     the creature") is NOT modelled in v1's engine — paralyzed only
//     grants advantage on attacks vs the target (via attackAdvantageState
//     in utils.ts). This is an engine-level limitation, not a Hold
//     Person bug — documented here for visibility.
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   metadata → spell stats
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Hold Person',
  level: 2,
  school: 'enchantment',
  rangeFt: 60,
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  holdPersonEndOfTurnSaveV1Implemented: false,    // end-of-turn save skipped
  holdPersonUpcastV1Implemented: false,           // +1 target/slot-level not modelled
  holdPersonConcentrationEnforcementV1Implemented: true,  // TG-002 DONE (Session 34)
  holdPersonHumanoidTypeCheckV1Implemented: false,         // see TG-004
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
 * Returns the single best target for Hold Person (a living enemy within
 * 60 ft, not already paralyzed or otherwise incapacitated by this caster),
 * or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 60 ft — paralyzing
 *      the biggest attacker is the most impactful (removes their action
 *      economy AND grants advantage to all melee attackers).
 *   2. Tie-break: closest enemy.
 *
 * Preconditions:
 *   - Caster has 'Hold Person' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Hold Person IS concentration — it cannot be cast while
 * concentrating on another spell (e.g. Bless, Faerie Fire). The planner
 * gates on concentration via shouldCast.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Hold Person')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    // Skip if already paralyzed or incapacitated by any source — Hold
    // Person adds no value (paralyzed doesn't stack, and the target is
    // already out of the fight).
    if (c.conditions.has('paralyzed') || c.conditions.has('incapacitated')) continue;

    // Skip if already Hold-Person'd by this caster (re-cast would only
    // refresh the duration — wasteful in v1 since the duration isn't
    // tracked and the end-of-turn save isn't modelled).
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Hold Person'
    )) continue;

    // Threat proxy: maxHP (higher = more dangerous when not paralyzed).
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: highest threat first, then closest.
  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Hold Person:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Hold Person.
 *  4. Roll the target's WIS save vs the caster's saveDC.
 *  5. On fail: apply condition_apply:paralyzed effect on the target.
 *     - The effect has sourceIsConcentration: true (removed when the
 *       caster's concentration breaks).
 *  6. On success: log the save, no effect applied.
 *
 * v1 simplification: the end-of-turn WIS save (PHB p.251) is NOT
 * modelled. The condition persists for the entire combat (or until
 * concentration breaks). Forward-compat TODO via
 * `holdPersonEndOfTurnSaveV1Implemented: false`.
 *
 * @param caster  The casting Combatant (Bard/Cleric/Druid/Paladin/Sorcerer/Warlock/Wizard)
 * @param target  The candidate from shouldCast (single enemy in range)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Hold Person');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  // Safety: clean up any stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Hold Person');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Hold Person at ${target.name}! (DC ${saveDC} WIS)`,
    target.id,
  );

  // Re-check liveness (stale edge case)
  if (target.isDead || target.isUnconscious) return;

  const save = rollSaveReactable(state, caster, target, 'wis', saveDC);
  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Hold Person (rolled ${save.total})`,
    target.id,
    save.roll,
  );

  if (save.success) {
    emit(
      state, 'action', caster.id,
      `${target.name} resists Hold Person — not paralyzed!`,
      target.id,
    );
    return;
  }

  // Apply paralyzed condition. IS concentration — sourceIsConcentration: true.
  // The condition is removed via removeEffectsFromCaster when concentration
  // breaks (re-cast, damage-taken CON save fail once TG-002 is implemented, etc.).
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Hold Person',
    effectType: 'condition_apply',
    payload: { condition: 'paralyzed' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is PARALYZED! (incapacitated, can't move, attacks vs them have advantage)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Hold Person — called from resetBudget() at the start of
 * the caster's next turn. NO-OP in v1 because:
 *   - Hold Person is a concentration spell; the paralyzed condition is
 *     removed via removeEffectsFromCaster() when concentration breaks.
 *   - v1 does NOT enforce concentration checks (TG-002), so concentration
 *     effectively persists for the entire combat.
 *
 * Exported for symmetry with the other spell modules' cleanup pattern.
 * Future work: implement the end-of-turn WIS save by hooking into the
 * TARGET's turn-end (would require a new engine hook in resetBudget
 * or a per-target cleanup pass — see Blindness/Deafness's analogous
 * end-of-turn save TODO).
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
