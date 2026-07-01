// ============================================================
// Simulacrum — PHB p.276
//
// 7th-level illusion, 12-HOUR casting time, range touch,
// permanent (until dispelled). Components: V, S, M (snow/ice + ruby worth 1500 gp).
//
// Effect: You shape an illusory duplicate of one beast or humanoid that is
//         within range for the entire casting time of the spell. The duplicate
//         is a creature, partially real and formed from ice or snow, and it
//         takes its statistics from the original at the time of casting.
//
// v1 status: OUT-OF-COMBAT — 12-hour cast time makes it unusable during
//   combat. A full implementation would require a creature-duplication
//   subsystem. shouldCast always returns null.
//
// S115 lair-action forward-compat (Fraz-Urb'luu::2):
//   Fraz-Urb'luu's lair action "creates a simulacrum of that creature (as if
//   created with the simulacrum spell). This simulacrum obeys Fraz-Urb'luu's
//   commands and is destroyed on the next initiative count 20."
//   The lair action bypasses the 12-hour cast time (instantaneous). The lair
//   dispatcher uses `shouldCastLair` + `executeLair` (NOT the regular
//   shouldCast/execute stubs which stay null/no-op for the player spell system).
//   v1 forward-compat: executeLair logs the simulacrum creation + sets a
//   flag on the caster's `_genericSpellActiveSpells`. The actual duplicate
//   combatant (half-HP clone with the target's stats, joining the caster's
//   faction, removed at next initiative count 20) is NOT spawned — that
//   requires a creature-duplication subsystem (out of scope for S115).
//   A future session should implement the real duplicate creation + the
//   1-round lair-duration cleanup.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

export const metadata = {
  name: 'Simulacrum', level: 7, school: 'illusion', rangeFt: 5,
  concentration: false, castingTime: '12_hours',
  outOfCombat: true,                 // 12-hr cast — never used in combat
  simulacrumOutOfCombatV1Implemented: true,
  simulacrumLairForwardCompatV1Implemented: true,  // S115: lair-action forward-compat (log + flag)
} as const;

// ---- Local log helper (S115 lair-action forward-compat) -----

function emit(
  state: EngineState,
  type: CombatEvent['type'],
  actorId: string,
  desc: string,
  targetId?: string,
  value?: number,
): void {
  state.log.events.push({
    round: state.battlefield.round, actorId, type, targetId, value, description: desc,
  });
}

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }

// ---- S115 lair-action forward-compat (Fraz-Urb'luu::2) ------

/**
 * Lair-action shouldCast for Simulacrum (S115 forward-compat).
 *
 * Per Fraz-Urb'luu's lair text: "Fraz-Urb'luu chooses one Humanoid within
 * the lair and instantly creates a simulacrum of that creature." The lair
 * action targets an enemy HUMANOID (creatureType === 'humanoid'). Range is
 * the whole battlefield ("within the lair"). Picks the highest-HP humanoid
 * (most impactful duplicate). Returns null if no humanoid enemy exists
 * (canon-accurate "no valid target" → lair action skips).
 *
 * This is SEPARATE from the regular shouldCast (which always returns null
 * because the player spell has a 12-hour cast time and is out-of-combat).
 * The lair dispatcher calls this lair-specific function.
 */
export function shouldCastLair(caster: Combatant, bf: Battlefield): Combatant | null {
  let best: Combatant | null = null;
  let bestHP = -1;
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    if (c.creatureType !== 'humanoid') continue;  // lair text: "one Humanoid"
    if (c.maxHP > bestHP) { best = c; bestHP = c.maxHP; }
  }
  return best;
}

/**
 * Lair-action execute for Simulacrum (S115 forward-compat).
 *
 * v1: logs the simulacrum creation + sets a forward-compat flag on the
 * caster's `_genericSpellActiveSpells`. The actual duplicate combatant
 * (half-HP clone with the target's stats, joining the caster's faction,
 * removed at next initiative count 20) is NOT spawned — that requires a
 * creature-duplication subsystem. The lair dispatcher's suppress-mode
 * post-processing handles the 1-round lair-duration metadata, but since
 * executeLair creates no ActiveEffect, there's nothing to auto-expire
 * (the flag persists until caster death via removeEffectsFromCaster).
 *
 * A future session should:
 *   1. Clone the target's stats (HP, AC, abilities, actions, etc.)
 *   2. Set the clone's HP to half the target's maxHP (per simulacrum spell)
 *   3. Add the clone as a new combatant on the caster's faction
 *   4. Roll initiative for the clone (or have it act on the caster's turn)
 *   5. Remove the clone at the next initiative count 20 (1-round lair duration)
 */
export function executeLair(caster: Combatant, target: Combatant, state: EngineState): void {
  if (!caster._genericSpellActiveSpells) {
    caster._genericSpellActiveSpells = new Set<string>();
  }
  caster._genericSpellActiveSpells.add('Simulacrum');

  emit(
    state, 'action', caster.id,
    `${caster.name} creates a simulacrum of ${target.name}! ` +
    `(v1: forward-compat flag set; duplicate combatant not yet spawned — the real ` +
    `half-HP clone joining ${caster.name}'s faction + destroyed at next initiative ` +
    `count 20 requires a creature-duplication subsystem, out of scope for S115)`,
    target.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} has an active simulacrum (v1: forward-compat flag; no mechanical effect until duplicate-combatant subsystem is implemented).`,
    caster.id,
  );
}
