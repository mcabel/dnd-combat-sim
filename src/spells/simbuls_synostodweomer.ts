// ============================================================
// Simbul's Synostodweomer — FRHoF p.145
//
// 7-level transmutation, 1 action, range Touch (5 ft).
// Duration: 1 hour.
//
// Effect: You imbue one creature you touch with magical healing energy for the duration. Whenever the target casts a spell using a spell slot, the target can immediately roll a number of unexpended {@variantrul
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
  name: "Simbul's Synostodweomer",
  level: 7,
  school: 'transmutation',
  rangeFt: 5,
  concentration: false,
  castingTime: 'action',
  simbulsSynostodweomerV1Simplified: true,
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
 * Returns true if the caster should cast Simbul's Synostodweomer this turn.
 *
 * Preconditions:
 *   - Caster has "Simbul's Synostodweomer" in their actions
 *   - Caster has at least one 7-level-or-higher slot available
 *   - Caster is NOT already Simbul's Synostodweomer-active (re-cast would be a no-op in v1)
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === "Simbul's Synostodweomer")) return false;
  if (!hasSpellSlot(caster, 7)) return false;
  if (caster._genericSpellActiveSpells?.has("Simbul's Synostodweomer")) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Simbul's Synostodweomer:
 *  1. Consume a 7-level spell slot.
 *  2. Set the flag on the caster's `_genericSpellActiveSpells` Set.
 *  3. Log the cast.
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 7);

  if (!caster._genericSpellActiveSpells) {
    caster._genericSpellActiveSpells = new Set<string>();
  }
  caster._genericSpellActiveSpells.add("Simbul's Synostodweomer");

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Simbul's Synostodweomer! (v1: forward-compat flag set; mechanical effect not yet implemented)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} is affected by Simbul's Synostodweomer. (v1: forward-compat flag set; no mechanical effect until engine subsystem is implemented)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — forward-compat flag persists for combat.
}
