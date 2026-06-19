// ============================================================
// Flock of Familiars — LLK p.57
//
// 2-level conjuration, 1 minute, range Touch (5 ft), concentration.
// Duration: 1 hour.
//
// Effect: You temporarily summon three familiars—spirits that take animal forms of your choice. Each familiar uses the same rules and options for a familiar conjured by the  spell. All the
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
  name: 'Flock of Familiars',
  level: 2,
  school: 'conjuration',
  rangeFt: 5,
  concentration: true,
  castingTime: '1min',
  flockOfFamiliarsV1Simplified: true,
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
 * Returns true if the caster should cast Flock of Familiars this turn.
 *
 * Preconditions:
 *   - Caster has 'Flock of Familiars' in their actions
 *   - Caster has at least one 2-level-or-higher slot available
 *   - Caster is NOT already Flock of Familiars-active (re-cast would be a no-op in v1)
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Flock of Familiars')) return false;
  if (!hasSpellSlot(caster, 2)) return false;
  if (caster._genericSpellActiveSpells?.has('Flock of Familiars')) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Flock of Familiars:
 *  1. Consume a 2-level spell slot.
 *  2. Set the flag on the caster's `_genericSpellActiveSpells` Set.
 *  3. Log the cast.
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  if (!caster._genericSpellActiveSpells) {
    caster._genericSpellActiveSpells = new Set<string>();
  }
  caster._genericSpellActiveSpells.add('Flock of Familiars');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Flock of Familiars! (v1: forward-compat flag set; mechanical effect not yet implemented)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} is affected by Flock of Familiars. (v1: forward-compat flag set; no mechanical effect until engine subsystem is implemented)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — forward-compat flag persists for combat.
}
