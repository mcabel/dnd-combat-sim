// ============================================================
// Crown of Madness — PHB p.229
//
// 2nd-level enchantment, action, range 120 ft, concentration (1 min).
// Components: V, S.
//
// Effect: One humanoid of your choice that you can see within range
//         must succeed on a Wisdom saving throw or become charmed by
//         you for the duration. While the target is charmed in this
//         way, a twisted crown of jagged iron appears on its head, and
//         a madness glows in its eyes.
//
//         The charmed target must use its action before moving on each
//         of its turns to make a melee attack against a creature other
//         than itself that you mentally choose. The target can act
//         normally on its turn if you choose no creature or if none are
//         within its reach.
//
//         On your subsequent turns, you must use your action to
//         maintain control over the target, or the spell ends. Also,
//         the target can make a Wisdom saving throw at the end of each
//         of its turns. On a success, the spell ends.
//
// v1 simplifications:
//   - Duration: canon 1 min concentration → v1: concentration is started
//     via startConcentration(), but the engine does NOT yet enforce
//     concentration checks on damage taken (forward-compat TODO; see
//     TG-002 in TEAMGOALS.md). The charmed condition persists until
//     removeEffectsFromCaster() is called.
//   - Forced-attack mechanic: PHB p.229 says "The charmed target must
//     use its action before moving on each of its turns to make a melee
//     attack against a creature other than itself that you mentally
//     choose." v1 does NOT model this (the engine has no mechanism to
//     override a combatant's AI to attack a specific creature — would
//     require a "charmed controller" hook in planTurn). The charmed
//     condition is applied but the forced-attack rider is skipped.
//     Forward-compat TODO via the metadata flag
//     `crownOfMadnessForcedAttackV1Implemented: false`.
//   - Action maintenance: PHB p.229 says "On your subsequent turns,
//     you must use your action to maintain control over the target, or
//     the spell ends." v1 does NOT model this (no multi-turn action
//     commitment subsystem). The spell persists for the entire combat
//     without requiring the caster to spend actions maintaining it.
//     Forward-compat TODO via the metadata flag
//     `crownOfMadnessActionMaintenanceV1Implemented: false`.
//   - End-of-turn WIS save: PHB p.229 says "the target can make a
//     Wisdom saving throw at the end of each of its turns. On a
//     success, the spell ends." v1 does NOT model this (forward-compat
//     TODO via the metadata flag
//     `crownOfMadnessEndOfTurnSaveV1Implemented: false`).
//   - Humanoid creature-type restriction: PHB p.229 says "One humanoid".
//     v1 does NOT verify creature type (parser tech debt — TG-004).
//     All living enemies are valid targets.
//   - Concentration enforcement: v1 does NOT enforce concentration
//     checks (TG-002).
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   metadata → spell stats
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Crown of Madness',
  level: 2,
  school: 'enchantment',
  rangeFt: 120,
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  crownOfMadnessForcedAttackV1Implemented: false,           // forced-attack rider skipped
  crownOfMadnessActionMaintenanceV1Implemented: false,      // multi-turn action commitment skipped
  crownOfMadnessEndOfTurnSaveV1Implemented: false,          // end-of-turn save skipped
  crownOfMadnessConcentrationEnforcementV1Implemented: false,  // see TG-002
  crownOfMadnessHumanoidTypeCheckV1Implemented: false,      // see TG-004
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
 * Returns the single best target for Crown of Madness (a living enemy
 * within 120 ft, not already charmed by this caster), or null when the
 * spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 120 ft — charming
 *      the biggest attacker removes them from the fight (the charmed
 *      condition prevents them from attacking the caster's allies, and
 *      the forced-attack rider would turn them against their own allies
 *      if it were modelled).
 *   2. Tie-break: closest enemy.
 *
 * Preconditions:
 *   - Caster has 'Crown of Madness' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 120 ft
 *
 * Note: Crown of Madness IS concentration — it cannot be cast while
 * concentrating on another spell. The planner gates on concentration.
 *
 * Note: In v1, the forced-attack rider is NOT modelled, so Crown of
 * Madness is functionally equivalent to a "save-or-charmed" debuff.
 * The charmed condition in v1 doesn't prevent the target from attacking
 * the caster's allies (the engine doesn't check charmed in
 * attackAdvantageState or planTurn). The spell's main v1 effect is
 * therefore the charmed condition's interaction with future Calm
 * Emotions / Break Enchantment-style effects. This is a known v1
 * limitation documented via the metadata flag
 * `crownOfMadnessForcedAttackV1Implemented: false`.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Crown of Madness')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 120) continue;

    // Skip if already charmed by any source — Crown of Madness doesn't
    // stack (a creature can be charmed by multiple casters, but v1
    // doesn't model per-caster charm tracking — re-cast would only
    // refresh the duration, which is wasteful).
    if (c.conditions.has('charmed')) continue;

    // Skip if already Crown-of-Madness'd by this caster (re-cast would
    // only refresh the duration — wasteful in v1 since the end-of-turn
    // save isn't modelled).
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Crown of Madness'
    )) continue;

    // Threat proxy: maxHP (higher = more dangerous when not charmed).
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
 * Execute Crown of Madness:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Crown of Madness.
 *  4. Roll the target's WIS save vs the caster's saveDC.
 *  5. On fail: apply condition_apply:charmed effect on the target.
 *     - The effect has sourceIsConcentration: true (removed when the
 *       caster's concentration breaks).
 *  6. On success: log the save, no effect applied.
 *
 * v1 simplifications: forced-attack rider NOT modelled; action
 * maintenance NOT modelled; end-of-turn WIS save NOT modelled;
 * concentration NOT enforced (TG-002). The charmed condition persists
 * for the entire combat (or until concentration breaks).
 *
 * @param caster  The casting Combatant (Bard/Sorcerer/Warlock/Wizard)
 * @param target  The candidate from shouldCast (single enemy in range)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Crown of Madness');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  // Safety: clean up any stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Crown of Madness');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Crown of Madness at ${target.name}! (DC ${saveDC} WIS)`,
    target.id,
  );

  // Re-check liveness (stale edge case)
  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'wis', saveDC);
  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Crown of Madness (rolled ${save.total})`,
    target.id,
    save.roll,
  );

  if (save.success) {
    emit(
      state, 'action', caster.id,
      `${target.name} resists Crown of Madness — not charmed!`,
      target.id,
    );
    return;
  }

  // Apply charmed condition. IS concentration — sourceIsConcentration: true.
  // The condition is removed via removeEffectsFromCaster when concentration
  // breaks.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Crown of Madness',
    effectType: 'condition_apply',
    payload: { condition: 'charmed' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is CHARMED by Crown of Madness! (v1: forced-attack rider not modelled)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Crown of Madness — called from resetBudget() at the
 * start of the caster's next turn. NO-OP in v1 because:
 *   - Crown of Madness is a concentration spell; the charmed condition
 *     is removed via removeEffectsFromCaster() when concentration breaks.
 *   - v1 does NOT enforce concentration checks (TG-002).
 *
 * Exported for symmetry with the other spell modules' cleanup pattern.
 * Future work: implement the end-of-turn WIS save by hooking into the
 * TARGET's turn-end (mirror Hold Person / Blindness/Deafness's analogous
 * end-of-turn save TODO).
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
