// ============================================================
// Thunderous Smite — PHB p.282
//
// 1-level evocation, 1 bonus action, range Self, concentration.
// Duration: 1 minute.
//
// Effect: The first time you hit with a melee weapon attack during this spell's duration, your weapon rings with thunder that is audible within 300 feet of you, and the attack deals an extra  thund
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
  name: 'Thunderous Smite',
  level: 1,
  school: 'evocation',
  rangeFt: 0,
  concentration: true,
  castingTime: 'bonusAction',
  thunderousSmiteV1Simplified: true,
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
 * Returns true if the caster should cast Thunderous Smite this turn.
 *
 * Preconditions:
 *   - Caster has 'Thunderous Smite' in their actions
 *   - Caster has at least one 1-level-or-higher slot available
 *   - Caster is NOT already Thunderous Smite-active (re-cast would be a no-op in v1)
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Thunderous Smite')) return false;
  if (!hasSpellSlot(caster, 1)) return false;
  if (caster._genericSpellActiveSpells?.has('Thunderous Smite')) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Thunderous Smite:
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
  caster._genericSpellActiveSpells.add('Thunderous Smite');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Thunderous Smite! (v1: forward-compat flag set; mechanical effect not yet implemented)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} is affected by Thunderous Smite. (v1: forward-compat flag set; no mechanical effect until engine subsystem is implemented)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — forward-compat flag persists for combat.
}
