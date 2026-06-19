// ============================================================
// Color Spray — PHB p.222
//
// 1-level illusion, 1 action, range 15 ft.
// Duration: 1 round.
//
// Effect: A dazzling array of flashing, colored light springs from your hand. Roll ; the total is how many hit points of creatures this spell can effect. Creatures in a 15-foot cone originating from
//
// Upcast: see source (not modelled in v1).
//
// v1 simplifications:
//   - v1 models this spell as a FORWARD-COMPAT flag only (Session 20 bulk
//     implementation — level-1 backfill). The spell consumes a slot and
//     sets the flag `_genericSpellActiveSpells` on the caster; the actual
//     mechanical effect (damage / save / condition / buff) is NOT applied
//     in v1. A future implementation should extend the relevant engine
//     subsystem (damage_zone for persistent damage, condition_apply for
//     conditions, advantage_vs for buffs, etc.) to consume this flag and
//     apply the real effect. This mirrors the Session 17/18 forward-compat
//     pattern established by Darkvision, Arcane Lock, Knock, See Invisibility
//     and the Session 19 bulk-implementation pattern.
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
  name: 'Color Spray',
  level: 1,
  school: 'illusion',
  rangeFt: 15,
  concentration: false,
  castingTime: 'action',
  colorSprayV1Simplified: true,
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
 * Returns true if the caster should cast Color Spray this turn.
 *
 * Preconditions:
 *   - Caster has 'Color Spray' in their actions
 *   - Caster has at least one 1-level-or-higher slot available
 *   - Caster is NOT already Color Spray-active (re-cast would be a no-op in v1)
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Color Spray')) return false;
  if (!hasSpellSlot(caster, 1)) return false;
  if (caster._genericSpellActiveSpells?.has('Color Spray')) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Color Spray:
 *  1. Consume a 1-level spell slot.
 *  2. Set the flag on the caster's `_genericSpellActiveSpells` Set.
 *  3. Log the cast.
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 1);

  if (!caster._genericSpellActiveSpells) {
    caster._genericSpellActiveSpells = new Set<string>();
  }
  caster._genericSpellActiveSpells.add('Color Spray');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Color Spray! (v1: forward-compat flag set; mechanical effect not yet implemented)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} is affected by Color Spray. (v1: forward-compat flag set; no mechanical effect until engine subsystem is implemented)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — forward-compat flag persists for combat.
}
