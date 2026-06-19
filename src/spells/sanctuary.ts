// ============================================================
// Sanctuary — PHB p.272
//
// 1-level abjuration, 1 bonus action, range 30 ft.
// Duration: 1 minute.
//
// Effect: You ward a creature within range against attack. Until the spell ends, any creature who targets the warded creature with an attack or a harmful spell must first make a Wisdom saving throw. On a failed
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
  name: 'Sanctuary',
  level: 1,
  school: 'abjuration',
  rangeFt: 30,
  concentration: false,
  castingTime: 'bonusAction',
  sanctuaryV1Simplified: true,
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
 * Returns true if the caster should cast Sanctuary this turn.
 *
 * Preconditions:
 *   - Caster has 'Sanctuary' in their actions
 *   - Caster has at least one 1-level-or-higher slot available
 *   - Caster is NOT already Sanctuary-active (re-cast would be a no-op in v1)
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Sanctuary')) return false;
  if (!hasSpellSlot(caster, 1)) return false;
  if (caster._genericSpellActiveSpells?.has('Sanctuary')) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Sanctuary:
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
  caster._genericSpellActiveSpells.add('Sanctuary');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Sanctuary! (v1: forward-compat flag set; mechanical effect not yet implemented)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} is affected by Sanctuary. (v1: forward-compat flag set; no mechanical effect until engine subsystem is implemented)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — forward-compat flag persists for combat.
}
