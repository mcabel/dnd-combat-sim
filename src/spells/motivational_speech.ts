// ============================================================
// Motivational Speech — AI p.77
//
// 3-level enchantment, 1 minute, range 60 ft.
// Duration: 1 hour.
//
// Effect: {'type': 'quote', 'entries': ['I once heard a motivational speech by Jim and it was the worst ninety seconds of my life. What does Omin see in him, anyway?'], 'by': 'Walnut Dankgrass'}
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
  name: 'Motivational Speech',
  level: 3,
  school: 'enchantment',
  rangeFt: 60,
  concentration: false,
  castingTime: '1min',
  motivationalSpeechV1Simplified: true,
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
 * Returns true if the caster should cast Motivational Speech this turn.
 *
 * Preconditions:
 *   - Caster has 'Motivational Speech' in their actions
 *   - Caster has at least one 3-level-or-higher slot available
 *   - Caster is NOT already Motivational Speech-active (re-cast would be a no-op in v1)
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Motivational Speech')) return false;
  if (!hasSpellSlot(caster, 3)) return false;
  if (caster._genericSpellActiveSpells?.has('Motivational Speech')) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Motivational Speech:
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
  caster._genericSpellActiveSpells.add('Motivational Speech');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Motivational Speech! (v1: forward-compat flag set; mechanical effect not yet implemented)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} is affected by Motivational Speech. (v1: forward-compat flag set; no mechanical effect until engine subsystem is implemented)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — forward-compat flag persists for combat.
}
