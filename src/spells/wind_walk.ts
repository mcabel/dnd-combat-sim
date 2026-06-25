// ============================================================
// Wind Walk — PHB p.288
//
// 6th-level transmutation, 1-minute cast time (v1: action), range touch
// (5 ft) + self, concentration (8 hours). Components: V, S, M (fire and holy
// water, or a pinch of earth from a sacred site).
//
// Effect: You and up to 11 willing creatures transform into a cloud of mist.
//   - You gain a flying speed of 300 ft and can move in any direction.
//   - You can't take actions other than Dash (as a mist).
//   - You revert as an action (or when concentration breaks, or when you
//     drop to 0 HP).
//
// v1 simplifications:
//   - Casting time: canon 1 min. v1: action (treat as a combat-round cast —
//     the spell is a strong escape/movement spell; monsters cast it mid-fight
//     in the bestiary). Flagged `windWalkCastTimeV1Simplified: true`.
//   - Multi-ally targeting: NOT modelled. v1 buffs the CASTER ONLY (canon
//     allows up to 11 willing allies). Flagged `windWalkMultiAllyV1Implemented: false`.
//   - Mist form: modelled as `condition_apply` of `incapacitated` (can only
//     Dash) PLUS `caster.flySpeed = 300` (300-ft fly speed per PHB).
//     Flagged `windWalkMistFormV1Implemented: true`.
//   - Duration: canon 8 hr. v1: encounter-only (concentration enforced).
//     Flagged `windWalkDurationV1EncounterOnly: true`.
//   - "Revert as an action": NOT modelled (no dismiss-as-action hook; the
//     caster can break their own concentration to revert).
//   - "Revert at 0 HP": modelled via the engine's existing concentration-
//     breaks-on-death pipeline (startConcentration registers the caster;
//     when they drop to 0 HP, removeEffectsFromCaster clears the effect and
//     condition_apply removal restores the caster's capacity to act).
//   - NO save (targets are willing), NO upcast (Wind Walk has no upcast).
//
// Spell module pattern (self-targeted movement/escape, concentration):
//   shouldCast(caster, bf) → Combatant | null  (returns the CASTER (self) if
//     the caster is below 30% HP (defensive escape) OR no enemies within
//     30 ft (repositioning); null otherwise)
//   execute(caster, _self, state) → void
//   cleanup() — no-op (removeEffectsFromCaster handles conc cleanup)
//
// Combat value: SITUATIONAL — defensive escape OR tactical reposition.
// ~8 creatures know it (per coverage report).
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Wind Walk', level: 6, school: 'transmutation', rangeFt: 0,
  concentration: true, castingTime: 'action',  // v1: action (canon 1 min)
  windWalkMultiAllyV1Implemented: false,         // v1: caster only
  windWalkMistFormV1Implemented: true,           // incapacitated + fly 300
  windWalkDurationV1EncounterOnly: true,          // canon 8 hr → v1 encounter
  windWalkCastTimeV1Simplified: true,             // canon 1 min → v1 action
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

/**
 * Returns the CASTER (self) when:
 *   - the caster is below 30% HP (defensive escape — fly 300 ft to safety), OR
 *   - no enemies are within 30 ft (tactical reposition — close the distance
 *     with a 300-ft fly speed).
 *
 * Returns null otherwise (caster is healthy AND enemies are nearby — no need
 * to mist-form).
 *
 * Range: self (0 ft) — Wind Walk v1 is self-targeted only (canon allows up
 * to 11 willing allies in 5 ft, NOT modelled).
 *
 * Concentration-gated: Wind Walk IS concentration; caster can't have another
 * concentration spell active.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Wind Walk')) return null;
  if (!hasSpellSlot(caster, 6)) return null;
  if (caster.concentration?.active) return null;  // can't concentrate on 2 spells

  // Skip if already Wind Walking (no stacking)
  if (caster.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Wind Walk')) return null;

  const hpPct = caster.maxHP > 0 ? caster.currentHP / caster.maxHP : 1;

  // Defensive escape: caster below 30% HP
  if (hpPct < 0.3) return caster;

  // Tactical reposition: no enemies within 30 ft
  let enemyNearby = false;
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt <= 30) {
      enemyNearby = true;
      break;
    }
  }
  if (!enemyNearby) return caster;

  return null;
}

export function execute(caster: Combatant, _self: Combatant, state: EngineState): void {
  consumeSpellSlot(caster, 6);

  // Drop stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Wind Walk');

  emit(state, 'action', caster.id,
    `${caster.name} casts Wind Walk, transforming into a cloud of mist! (v1: caster only; concentration; gains fly 300 + incapacitated — can only Dash. Canon: 1-min cast + up to 11 allies — NOT modelled.)`,
    caster.id);

  if (caster.isDead || caster.isUnconscious) return;

  // (a) Set flySpeed = 300 (PHB p.288: mist form grants 300-ft fly speed).
  // v1 overwrites the caster's existing flySpeed (canon: Wind Walk replaces
  // movement mode while in mist form). Restored to prior value when conc breaks
  // is NOT modelled in v1 — the caster keeps the 300 ft fly speed for the
  // rest of the encounter (a v1 simplification flagged in metadata).
  caster.flySpeed = 300;

  // (b) Apply `incapacitated` via condition_apply (can only Dash in mist form).
  // sourceIsConcentration: true → condition clears when concentration breaks.
  //
  // NOTE: we do NOT call `addCondition(caster, 'incapacitated')` separately.
  // `addCondition` auto-breaks concentration on `incapacitated` per PHB p.203
  // ("you lose concentration if you are incapacitated"). That would break
  // Wind Walk's OWN concentration (the caster just started concentrating on
  // Wind Walk, then immediately became incapacitated → concentration breaks
  // → mist form ends instantly — a canonical conflict).
  //
  // PHB p.288 Wind Walk's "can only Dash" is NOT the canonical `incapacitated`
  // condition (which would break concentration); it's a custom action-limitation.
  // v1 simplification: use `incapacitated` for the engine's existing
  // attack-blocking + DEX-save disadv logic, but apply it via applySpellEffect
  // (which calls `target.conditions.add('incapacitated')` directly — bypassing
  // addCondition's concentration-break side effect). The condition persists
  // until concentration breaks (removeEffectsFromCaster → undoEffect →
  // condition removed from the Set).
  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Wind Walk',
    effectType: 'condition_apply',
    payload: { condition: 'incapacitated' },
    sourceIsConcentration: true,
    sourceCreatureType: caster.creatureType,
  });

  emit(state, 'condition_add', caster.id,
    `${caster.name} is now a cloud of mist — flySpeed 300 ft, INCAPACITATED (can only Dash). Concentration maintains the form; reverting requires breaking concentration.`,
    caster.id);
}

export function cleanup(_c: Combatant): void { /* no-op — removeEffectsFromCaster handles conc cleanup */ }
