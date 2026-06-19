// ============================================================
// Elemental Weapon — PHB p.237
//
// 3-level transmutation, 1 action, range Touch (5 ft), concentration.
// Duration: 1 hour.
//
// Effect: A nonmagical weapon you touch becomes a magic weapon. Choose one of the following damage types: acid, cold, fire, lightning, or thunder. For the duration, the weapon has a +1 bonus to attack rolls and
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
//   - Concentration spell (forward-compat flag persists for combat).
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
  name: 'Elemental Weapon',
  level: 3,
  school: 'transmutation',
  rangeFt: 5,
  concentration: true,
  castingTime: 'action',
  elementalWeaponV1Simplified: true,
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
 * Returns true if the caster should cast Elemental Weapon this turn.
 *
 * Preconditions:
 *   - Caster has 'Elemental Weapon' in their actions
 *   - Caster has at least one 3-level-or-higher slot available
 *   - Caster is NOT already Elemental Weapon-active (re-cast would be a no-op in v1)
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Elemental Weapon')) return false;
  if (!hasSpellSlot(caster, 3)) return false;
  if (caster._genericSpellActiveSpells?.has('Elemental Weapon')) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Elemental Weapon:
 *  1. Consume a 3-level spell slot.
 *  2. Set the flag on the caster's `_genericSpellActiveSpells` Set.
 *  3. Log the cast.
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 3);

  if (!caster._genericSpellActiveSpells) {
    caster._genericSpellActiveSpells = new Set<string>();
  }
  caster._genericSpellActiveSpells.add('Elemental Weapon');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Elemental Weapon! (v1: forward-compat flag set; mechanical effect not yet implemented)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} is affected by Elemental Weapon. (v1: forward-compat flag set; no mechanical effect until engine subsystem is implemented)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — forward-compat flag persists for combat.
}
