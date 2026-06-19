// ============================================================
// See Invisibility — PHB p.274
//
// 2nd-level divination, action, range Self, NO concentration (1 hr).
// Duration: 1 hour.   Components: V, S, M (a pinch of talc and a small
//          sprinkling of silver powder).
//
// Effect: For the duration, you see invisible creatures and objects as if
//         they were visible, and you can see into the Ethereal Plane. Ethereal
//         creatures and objects appear ghostly and translucent.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - v1 has NO invisibility-detection subsystem (computeLOS does not query
//     invisibility flags). This spell sets a forward-compat flag
//     `_seeInvisibilityActive` on the CASTER — set for future use, never read
//     in v1. Like Darkvision's `_darkvisionActive` pattern. Future work:
//     extend computeLOS to ignore the invisible condition for casters with
//     this flag.
//   - NOT a concentration spell (PHB p.274: 1 hr, no concentration).
//     v1 applies the flag with no cleanup (persists for the combat, like
//     Darkvision's `_darkvisionActive`). Documented via the metadata flag
//     `seeInvisibilityDurationV1Simplified: true`.
//   - v1 does NOT model the Ethereal Plane integration (forward-compat only).
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
import { livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'See Invisibility',
  level: 2,
  school: 'divination',
  rangeFt: 0,       // self
  seeInvisibilityRangeFt: 60,
  concentration: false,
  castingTime: 'action',
  seeInvisibilityVisionIntegrationV1Implemented: false,    // vision subsystem not implemented
  seeInvisibilityDurationV1Simplified: true,               // 1-hr duration not tracked (persists for combat)
  seeInvisibilityUpcastV1Implemented: false,               // upcast NOT modelled (no At Higher Levels)
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
 * Returns true if the caster should cast See Invisibility this turn.
 *
 * Preconditions:
 *   - Caster has 'See Invisibility' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already See-Invisibility-active (re-cast would only refresh)
 *   - At least 1 living enemy exists (the buff is useless with no enemies —
 *     invisible enemies still count as enemies, so this gate does NOT check
 *     for invisible ones explicitly; the planner relies on livingEnemiesOf
 *     which counts all living enemies regardless of invisibility)
 *
 * Note: See Invisibility is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on concentration.
 *
 * Note: v1's planner still casts See Invisibility even though the vision
 * subsystem is not implemented — the flag is set for forward-compat. A future
 * planner improvement could skip See Invisibility in v1 unless the caster
 * knows an enemy is invisible (no perception subsystem in v1 either), but v1
 * casts it for realism and to exercise the spell module.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'See Invisibility')) return false;
  if (!hasSpellSlot(caster, 2)) return false;

  if (caster._seeInvisibilityActive) return false;

  if (livingEnemiesOf(caster, bf).length === 0) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute See Invisibility:
 *  1. Consume a 2nd-level spell slot.
 *  2. Set `_seeInvisibilityActive = true` on the caster (forward-compat flag).
 *  3. Log the cast.
 *
 * v1 simplifications: vision subsystem NOT implemented (flag is forward-
 * compat only); 1-hr duration not tracked (persists for combat); Ethereal
 * Plane NOT modelled; upcast NOT modelled; NOT concentration.
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  caster._seeInvisibilityActive = true;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts See Invisibility! (see invisible creatures/objects out to ${metadata.seeInvisibilityRangeFt} ft — v1: forward-compat flag; vision subsystem not yet implemented)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} can now see invisible creatures! (v1: forward-compat flag set; no mechanical effect until vision subsystem is implemented)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — forward-compat flag persists for combat (1-hr duration >> combat).
}
