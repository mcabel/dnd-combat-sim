// ============================================================
// Knock — PHB p.254
//
// 2nd-level transmutation, action, range 60 ft, NO concentration.
// Duration: Instantaneous.   Components: V, S.
//
// Effect: Choose an object that you can see within range. The spell can open
//         a stuck, barred, or locked door, container, or other barrier. The
//         target remains unlocked for the duration of the spell, then
//         magically relocks (if it was locked by nonmagical means). The spell
//         also unlocks any secret doors or containers (and reveals them if
//         they are hidden). The spell makes a loud knock that is audible up
//         to 300 feet.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - v1 has NO object/lock subsystem (no doors/containers/chests on the
//     battlefield). This spell sets a forward-compat flag `_knockActive` on
//     the CASTER (v1: target = caster self, since there's no object to target
//     — the flag represents "caster has unlocked something this combat") —
//     set for future use, never read in v1. Like Darkvision's
//     `_darkvisionActive` pattern. Future work: add an object/lock subsystem
//     that lets Knock target a real object.
//   - v1 does NOT model the loud-knock audibility (no sound/perception
//     subsystem to alert enemies). Forward-compat TODO via the metadata flag
//     `knockAudibleRangeV1Implemented: false`.
//   - v1 does NOT model the magical-relock-after-duration behaviour (no
//     object subsystem to relock). Forward-compat TODO.
//   - NOT a concentration spell (PHB p.254: instantaneous, no concentration).
//     v1 applies the flag with no cleanup (persists for the combat, like
//     Darkvision's `_darkvisionActive`).
//   - Upcast NOT modelled (no At Higher Levels entry).
//
// Spell module pattern (mirrors Darkvision's self-buff forward-compat flag,
// NO concentration):
//   shouldCast(caster, bf) → boolean
//   execute(caster, state) → void
//   cleanup() — no-op (forward-compat flag persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Knock',
  level: 2,
  school: 'transmutation',
  rangeFt: 60,
  concentration: false,
  castingTime: 'action',
  knockObjectSubsystemV1Implemented: false,         // object/lock subsystem NOT implemented
  knockAudibleRangeV1Implemented: false,            // loud-knock audibility NOT modelled
  knockUpcastV1Implemented: false,                  // upcast NOT modelled (no At Higher Levels)
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
 * Returns true if the caster should cast Knock this turn.
 *
 * Preconditions:
 *   - Caster has 'Knock' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already Knock-active (re-cast would be a no-op in v1)
 *
 * Note: Knock is NOT concentration — it can be cast while concentrating on
 * another spell. The planner should NOT gate on concentration.
 *
 * Note: v1's planner still casts Knock even though the object/lock subsystem
 * is not implemented — the flag is set for forward-compat. Knock is essentially
 * a no-op in v1 combat (no objects to unlock), but v1 casts it for realism
 * and to exercise the spell module. A future planner improvement could skip
 * Knock in v1 when no objects exist on the battlefield.
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Knock')) return false;
  if (!hasSpellSlot(caster, 2)) return false;

  if (caster._knockActive) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Knock:
 *  1. Consume a 2nd-level spell slot.
 *  2. Set `_knockActive = true` on the caster (forward-compat flag — v1 has
 *     no object to target, so the flag represents "caster has unlocked
 *     something this combat").
 *  3. Log the cast.
 *
 * v1 simplifications: object/lock subsystem NOT implemented (flag is forward-
 * compat only); loud-knock audibility NOT modelled; magical-relock NOT
 * modelled; upcast NOT modelled; NOT concentration.
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  caster._knockActive = true;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Knock! (opens a stuck/locked object within ${metadata.rangeFt} ft — v1: forward-compat flag; object/lock subsystem not yet implemented; loud knock audible up to 300 ft NOT modelled)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} emits a loud knock that opens a locked object! (v1: forward-compat flag set; no mechanical effect until object/lock subsystem is implemented)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — forward-compat flag persists for combat (instantaneous spell).
}
