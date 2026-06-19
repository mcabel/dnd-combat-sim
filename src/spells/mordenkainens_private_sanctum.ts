// ============================================================
// Mordenkainen's Private Sanctum — PHB p.262
//
// 4-level abjuration, 10 minutes, range 120 ft.
// Duration: 24 hours.
//
// Effect: You make an area within range magically secure. The area is a cube that can be as small as 5 feet to as large as 100 feet on each side. The spell lasts for the duration or until you use an action to d
//
// Upcast: see source (not modelled in v1).
//
// v1 simplifications:
//   - v1 models this spell as a FORWARD-COMPAT flag only (Session 19 bulk
//     implementation). The spell consumes a slot and sets the flag
//     `_genericSpellActiveSpells` on the caster; the actual mechanical
//     effect (damage / save / condition / buff) is NOT applied in v1.
//     A future implementation should extend the relevant engine subsystem
//     (damage_zone for persistent damage, condition_apply for conditions,
//     advantage_vs for buffs, etc.) to consume this flag and apply the
//     real effect. This mirrors the Session 17/18 forward-compat pattern
//     established by Darkvision, Arcane Lock, Knock, See Invisibility.
//
// Spell module pattern (mirrors Darkvision / Arcane Lock forward-compat
// self-buff pattern):
//   shouldCast(caster, bf) → boolean
//   execute(caster, state) → void
//   cleanup() — no-op (forward-compat flag persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: "Mordenkainen's Private Sanctum",
  level: 4,
  school: 'abjuration',
  rangeFt: 120,
  concentration: false,
  castingTime: '10min',
  mordenkainensPrivateSanctumV1Simplified: true,
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
 * Returns true if the caster should cast Mordenkainen's Private Sanctum this turn.
 *
 * Preconditions:
 *   - Caster has "Mordenkainen's Private Sanctum" in their actions
 *   - Caster has at least one 4-level-or-higher slot available
 *   - Caster is NOT already Mordenkainen's Private Sanctum-active (re-cast would be a no-op in v1)
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === "Mordenkainen's Private Sanctum")) return false;
  if (!hasSpellSlot(caster, 4)) return false;
  if (caster._genericSpellActiveSpells?.has("Mordenkainen's Private Sanctum")) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Mordenkainen's Private Sanctum:
 *  1. Consume a 4-level spell slot.
 *  2. Set the flag on the caster's `_genericSpellActiveSpells` Set.
 *  3. Log the cast.
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 4);

  if (!caster._genericSpellActiveSpells) {
    caster._genericSpellActiveSpells = new Set<string>();
  }
  caster._genericSpellActiveSpells.add("Mordenkainen's Private Sanctum");

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Mordenkainen's Private Sanctum! (v1: forward-compat flag set; mechanical effect not yet implemented)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} is affected by Mordenkainen's Private Sanctum. (v1: forward-compat flag set; no mechanical effect until engine subsystem is implemented)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — forward-compat flag persists for combat.
}
