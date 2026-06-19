// ============================================================
// Arcane Lock — PHB p.215
//
// 2nd-level abjuration, action, range Touch, NO concentration (permanent).
// Duration: Permanent (until dispelled).   Components: V, S, M (gold dust
//          worth at least 25 gp, which the spell consumes).
//
// Effect: You touch a closed door, window, gate, chest, or other entryway,
//         and it becomes locked for the duration. The object is locked
//         against any creature that does not know the password or does not
//         have a key matching the arcane lock (which can be created by the
//         caster at the time of casting). The caster can freely pass through
//         the locked object without unlocking it. Knock (PHB p.254) or a
//         similar spell can open the arcane lock.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - v1 has NO object/lock subsystem (no doors/containers/chests on the
//     battlefield). This spell sets a forward-compat flag `_arcaneLockActive`
//     on the CASTER (v1: target = caster self, since there's no object to
//     target — the flag represents "caster has locked something this combat")
//     — set for future use, never read in v1. Like Darkvision's
//     `_darkvisionActive` pattern. Future work: add an object/lock subsystem
//     that lets Arcane Lock target a real object.
//   - NOT a concentration spell (PHB p.215: permanent, no concentration).
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
  name: 'Arcane Lock',
  level: 2,
  school: 'abjuration',
  rangeFt: 5,       // touch
  concentration: false,
  castingTime: 'action',
  arcaneLockObjectSubsystemV1Implemented: false,    // object/lock subsystem NOT implemented
  arcaneLockUpcastV1Implemented: false,             // upcast NOT modelled (no At Higher Levels)
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
 * Returns true if the caster should cast Arcane Lock this turn.
 *
 * Preconditions:
 *   - Caster has 'Arcane Lock' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already Arcane-Lock-active (re-cast would be a no-op in v1)
 *
 * Note: Arcane Lock is NOT concentration — it can be cast while concentrating
 * on another spell. The planner should NOT gate on concentration.
 *
 * Note: v1's planner still casts Arcane Lock even though the object/lock
 * subsystem is not implemented — the flag is set for forward-compat. Arcane
 * Lock is essentially a no-op in v1 combat (no objects to lock), but v1 casts
 * it for realism and to exercise the spell module. A future planner
 * improvement could skip Arcane Lock in v1 when no objects exist on the
 * battlefield.
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Arcane Lock')) return false;
  if (!hasSpellSlot(caster, 2)) return false;

  if (caster._arcaneLockActive) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Arcane Lock:
 *  1. Consume a 2nd-level spell slot.
 *  2. Set `_arcaneLockActive = true` on the caster (forward-compat flag — v1
 *     has no object to target, so the flag represents "caster has locked
 *     something this combat").
 *  3. Log the cast.
 *
 * v1 simplifications: object/lock subsystem NOT implemented (flag is forward-
 * compat only); password/key subsystem NOT modelled; Knock-spell interaction
 * NOT modelled; upcast NOT modelled; NOT concentration.
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  caster._arcaneLockActive = true;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Arcane Lock! (locks a closed object within ${metadata.rangeFt} ft — v1: forward-compat flag; object/lock subsystem not yet implemented; permanent until dispelled)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} magically locks an object! (v1: forward-compat flag set; no mechanical effect until object/lock subsystem is implemented)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — forward-compat flag persists for combat (permanent duration).
}
