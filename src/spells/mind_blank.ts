// ============================================================
// Mind Blank — PHB p.260
//
// 8th-level abjuration, action, range touch (5 ft), NO concentration
// (duration 24 hours). Components: V, S.
//
// Effect: One willing creature is immune to:
//   - psychic damage,
//   - any effect that would sense its emotions or read its thoughts,
//   - divination spells,
//   - the charmed condition.
// The spell can even prevent the target's thoughts from being read by magic.
//
// v1 simplifications:
//   - Duration: canon 24 hours. v1: "for the rest of the encounter" — far
//     shorter than canon (an encounter rarely exceeds 1 minute = 10 rounds),
//     so v1 Mind Blank is effectively permanent until combat ends.
//   - Psychic immunity: modelled via the engine's native `immunities` field
//     on Combatant (DamageType[]). addImmunity(target, 'psychic') is the
//     canonical mechanism — applyDamageWithTempHP() respects it and reduces
//     incoming psychic damage to 0.
//   - Charm immunity: modelled via `conditionImmunities` on Combatant
//     (string[]). addCondition() checks this and refuses to apply 'charmed'.
//     This is the cleanest match for "immune to the charmed condition".
//   - Divination immunity: NOT modelled (no divination subsystem in v1).
//     Logged as informational only.
//   - "Sense emotions / read thoughts": NOT modelled (no thought-reading
//     subsystem). Logged as informational only.
//   - NO save (target is willing), NO concentration.
//   - Upcast: NONE (Mind Blank has no upcast effect per PHB).
//
// Spell module pattern (single-target defensive buff, NO concentration):
//   shouldCast(caster, bf) → Combatant | null  (lowest-HP ally within 5 ft,
//     or the caster themselves if no ally in range)
//   execute(caster, target, state) → void
//   cleanup() — no-op (no concentration; immunities persist until combat ends)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { chebyshev3D } from '../engine/movement';
import { addImmunity } from '../engine/utils';

export const metadata = {
  name: 'Mind Blank', level: 8, school: 'abjuration', rangeFt: 5,
  concentration: false, castingTime: 'action',
  mindBlankPsychicImmunityV1Implemented: true,      // addImmunity(target, 'psychic')
  mindBlankCharmImmunityV1Implemented: true,         // conditionImmunities.push('charmed')
  mindBlankDivinationImmunityV1Implemented: false,   // divination subsystem not built
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

/**
 * Returns the lowest-HP ally within 5 ft (touch range), or the caster
 * themselves if no ally is in range. The caster is always a valid target
 * (Mind Blank can be self-cast — PHB p.260 "one willing creature").
 *
 * Not concentration-gated (Mind Blank is NOT concentration).
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Mind Blank')) return null;
  if (!hasSpellSlot(caster, 8)) return null;
  // NOT concentration-gated — Mind Blank has no concentration requirement.

  const candidates: Array<{ c: Combatant; hp: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;          // exclude self from ally candidates
    if (c.faction !== caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;
    // Skip if already Mind Blanked by this caster
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Mind Blank')) continue;
    candidates.push({ c, hp: c.currentHP, dist: distFt });
  }
  if (candidates.length === 0) return caster;   // self-target per PHB p.260
  // Lowest-HP ally first (most in need of protection); tie-break by distance
  candidates.sort((a, b) => a.hp !== b.hp ? a.hp - b.hp : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  consumeSpellSlot(caster, 8);
  // NOT a concentration spell — no startConcentration() call.

  emit(state, 'action', caster.id,
    `${caster.name} casts Mind Blank on ${target.name}! (NO concentration; duration 24 hr — v1: rest of encounter. Immune to psychic damage, charmed, divination, thought-reading.)`,
    target.id);

  if (target.isDead || target.isUnconscious) return;

  // (a) Psychic damage immunity — use the engine's native `immunities` field.
  addImmunity(target, 'psychic');
  emit(state, 'action', caster.id,
    `${target.name} is now IMMUNE to psychic damage (Mind Blank).`,
    target.id);

  // (b) Charmed condition immunity — use the engine's native
  // `conditionImmunities` field (checked by addCondition).
  if (!target.conditionImmunities) target.conditionImmunities = [];
  if (!target.conditionImmunities.includes('charmed')) {
    target.conditionImmunities.push('charmed');
  }
  emit(state, 'action', caster.id,
    `${target.name} is now IMMUNE to the charmed condition (Mind Blank).`,
    target.id);

  // (c) Divination + thought-reading immunity — informational only (no subsystem)
  emit(state, 'action', caster.id,
    `(v1: ${target.name} is also immune to divination + thought-reading per PHB p.260 — informational only; the engine has no divination subsystem.)`,
    target.id);
}

export function cleanup(_c: Combatant): void { /* no-op — no concentration; immunities persist until combat ends */ }
