// ============================================================
// Mirror Image — PHB p.260
//
// 2nd-level illusion, action, range Self, NO concentration (1 min).
// Components: V, S.
//
// Effect: Three illusory duplicates of yourself appear in your space.
//         Until the spell ends, the duplicates move with you and mimic
//         your actions, shifting position so it's impossible to track
//         which image is real. You can use your action to dismiss the
//         illusory duplicates.
//
//         Each time a creature targets you with an attack during the
//         spell's duration, roll a d20 to determine whether the attack
//         instead targets one of your duplicates.
//
//         If you have three duplicates, you must roll a 6 or higher to
//         change the attack's target to a duplicate. With two duplicates,
//         you must roll an 8 or higher. With one duplicate, you must
//         roll an 11 or higher.
//
//         A duplicate's AC equals 10 + your Dexterity modifier. If an
//         attack hits a duplicate, the duplicate is destroyed. A
//         duplicate can be destroyed only by an attack that hits it.
//         It ignores all other damage and effects. The spell ends when
//         all three duplicates are destroyed.
//
//         A creature is unaffected by this spell if it can't see, if it
//         relies on senses other than sight, such as blindsight, or if
//         it can perceive illusions as false, as with truesight.
//
// v1 simplifications:
//   - Duration: canon 1 min (10 rounds), NO concentration → v1 does NOT
//     track the duration. The spell lasts until all three duplicates are
//     destroyed (the canon end condition). If the caster is never
//     attacked, the spell persists for the entire combat. Documented via
//     the metadata flag `mirrorImageDurationV1Simplified: true`.
//   - Sight-dependency immunity: PHB p.260 says "A creature is
//     unaffected by this spell if it can't see, if it relies on senses
//     other than sight, such as blindsight, or if it can perceive
//     illusions as false, as with truesight." v1 does NOT model this
//     — all attackers are subject to the retargeting roll. The
//     `isBlindImmune` flag does NOT exist on Combatant yet — adding it
//     is part of TG-004 (parser tech debt) in TEAMGOALS.md. Documented
//     via the metadata flag `mirrorImageSightDependencyV1Implemented: false`.
//   - NOT a concentration spell (PHB p.260: no concentration noted).
//     The duplicates persist regardless of the caster's condition
//     (incapacitated, etc.) until all are destroyed or the 1-min
//     duration expires (v1 simplification: duration not tracked).
//   - No upcast (PHB p.260 lists no At Higher Levels entry).
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → boolean   (self-buff — no target)
//   execute(caster, state) → void
//   metadata → spell stats
//   cleanup() — no-op (spell ends when all duplicates destroyed, not at turn boundary)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Mirror Image',
  level: 2,
  school: 'illusion',
  rangeFt: 0,       // self
  duplicateCount: 3,             // PHB p.260: "Three illusory duplicates"
  duplicateAcBase: 10,           // PHB p.260: "A duplicate's AC equals 10 + your Dexterity modifier"
  // Retargeting thresholds (PHB p.260): d20 ≥ X retargets to a duplicate.
  // Indexed by remaining duplicate count (1, 2, 3). Index 0 unused.
  retargetThresholds: [0, 11, 8, 6] as const,
  castingTime: 'action',
  // v1 simplification flags:
  mirrorImageDurationV1Simplified: true,                    // 1-min duration not tracked
  mirrorImageSightDependencyV1Implemented: false,           // blindsight/truesight immunity
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
 * Returns true if the caster should cast Mirror Image this turn.
 *
 * Preconditions:
 *   - Caster has 'Mirror Image' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already Mirror-Imaged (re-cast would be wasteful —
 *     re-summoning duplicates while some remain does nothing extra in v1)
 *   - At least 1 living enemy exists (the buff is useless with no attackers)
 *
 * Target priority: self only (PHB p.260: range Self). No target selection.
 *
 * Note: Mirror Image is NOT concentration (PHB p.260: no concentration
 * noted). It can be cast while concentrating on another spell (e.g. Blur,
 * Bless). The planner should NOT gate on concentration.
 *
 * Note: Mirror Image is best when the caster expects to be attacked (in
 * melee range or visible to ranged enemies). v1's shouldCast fires
 * whenever an enemy exists — the AI planner can be more selective in
 * future work.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Mirror Image')) return false;
  if (!hasSpellSlot(caster, 2)) return false;

  // Skip if already Mirror-Imaged (re-cast would only refresh the
  // duplicate count — wasteful unless all duplicates are gone, in which
  // case _mirrorImageDuplicates is 0 or undefined and re-casting is OK).
  if ((caster._mirrorImageDuplicates ?? 0) > 0) return false;

  // Need at least 1 living enemy to justify the buff.
  if (livingEnemiesOf(caster, bf).length === 0) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Mirror Image:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Set `_mirrorImageDuplicates = 3` on the caster (scratch field).
 *  3. Log the cast.
 *
 * The retargeting logic lives in resolveAttack's pre-roll section in
 * combat.ts. On each incoming attack against the caster while
 * `_mirrorImageDuplicates > 0`:
 *   - Roll a d20; if it meets the threshold for the current duplicate
 *     count (3→6, 2→8, 1→11), the attack is retargeted to a duplicate.
 *   - Roll a SEPARATE attack against the duplicate's AC (10 + caster's
 *     DEX mod). On hit, one duplicate is destroyed (decrement the
 *     counter). On miss, the attack simply misses.
 *   - The attack doesn't affect the real caster either way.
 *
 * v1 simplifications: duration NOT tracked (lasts until all duplicates
 * destroyed); sight-dependency immunity NOT modelled; NOT concentration.
 *
 * @param caster  The casting Combatant (Bard/Sorcerer/Warlock/Wizard)
 * @param state   Current EngineState (for logging)
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  caster._mirrorImageDuplicates = metadata.duplicateCount;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Mirror Image! (${metadata.duplicateCount} illusory duplicates appear)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} is surrounded by ${metadata.duplicateCount} mirror images — attackers must roll to distinguish!`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Mirror Image — called from resetBudget() at the start
 * of the caster's next turn. NO-OP in v1 because:
 *   - Mirror Image is NOT a concentration spell; the duplicates persist
 *     until all are destroyed (the canon end condition).
 *   - v1 does NOT track the 1-min duration (the spell lasts until all
 *     duplicates are destroyed, which is the canon end condition anyway).
 *
 * Exported for symmetry with the other spell modules' cleanup pattern.
 * The duplicate-destruction logic (decrementing `_mirrorImageDuplicates`)
 * lives in resolveAttack's pre-roll section in combat.ts, NOT in this
 * cleanup function.
 */
export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; spell ends when all duplicates destroyed.
}
