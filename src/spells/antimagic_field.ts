// ============================================================
// Antimagic Field — PHB p.213
//
// 8th-level abjuration, action, range self (10-ft sphere), concentration (10 min).
// Components: V, S, M (a pinch of powdered iron or iron filings).
//
// Effect: A 10-ft-radius sphere centered on the caster suppresses all magic.
//   - Spells cast in the area have no effect.
//   - Spells targeting a creature in the area are suppressed.
//   - Magic items cease to be magical within the sphere.
//   - Creatures summoned/created by spells disappear.
//   - The caster's own spells (already active) are suppressed while in the area.
//
// v1 simplifications:
//   - AoE zone subsystem: NOT modelled (no zone/area effect pipeline). v1
//     applies a `condition_apply` of `incapacitated` to ALL enemy spellcasters
//     within 10 ft of the caster (spellcasting-locked), sourceIsConcentration=true.
//     This is the engine's cleanest model for "magic is shut off" — an
//     incapacitated creature can't cast spells (PHB p.290).
//   - Magic items: suppression is INFORMATIONAL ONLY (logged, not enforced).
//     The engine has no magic-item subsystem; v1 just logs that items are
//     suppressed for narrative continuity.
//   - Summoned creatures disappearing: NOT modelled (no despawn-on-cast hook).
//   - Caster's own active spells suppressed: NOT modelled.
//   - Upcast: NONE (Antimagic Field has no upcast effect per PHB).
//
// Spell module pattern (self-targeted multi-target debuff, concentration):
//   shouldCast(caster, bf) → Combatant | null  (returns the CASTER if any
//     enemy spellcaster is within 10 ft; null otherwise)
//   execute(caster, _self, state) → void
//   cleanup() — no-op (removeEffectsFromCaster handles conc cleanup)
//
// Combat value: SITUATIONAL. The caster must position themselves within 10 ft
// of an enemy caster (touch-range distance). The payoff: shut down ALL enemy
// casters in the sphere for 10 min. ~12 creatures know it (per coverage report).
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, addCondition } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Antimagic Field', level: 8, school: 'abjuration', rangeFt: 0,
  concentration: true, castingTime: 'action',
  antimagicFieldGeometryV1Implemented: false,           // 10-ft sphere zone NOT modelled
  antimagicFieldSingleTargetV1Implemented: false,       // (renamed — see below)
  antimagicFieldMultiTargetV1Implemented: true,         // v1 applies incapacitated to all enemy casters in 10 ft
  antimagicFieldMagicItemSuppressionV1Implemented: false, // logged only — no item subsystem
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

/**
 * Heuristic: is this combatant a "spellcaster"?
 *
 * Per spec, we treat any creature as a spellcaster if EITHER:
 *   - they have a non-empty `resources.spellSlots` map, OR
 *   - they have an action whose `saveAbility` is set (spells typically have
 *     a save DC; weapon attacks don't).
 *
 * This is a v1 simplification — it may misclassify a few corner cases
 * (e.g. a monster with a "save vs Web" non-spell trait), but it's a clean
 * signal for the v1 Antimagic Field targeting heuristic.
 */
function isSpellcaster(c: Combatant): boolean {
  if (c.resources?.spellSlots) {
    for (const lvl in c.resources.spellSlots) {
      const slot = (c.resources.spellSlots as any)[lvl];
      if (slot && (slot.remaining ?? 0) > 0) return true;
    }
  }
  return c.actions.some(a => a.saveAbility !== null && a.saveAbility !== undefined);
}

/**
 * Returns the CASTER (self) if there's ≥1 enemy spellcaster within 10 ft;
 * null otherwise.
 *
 * Range: self (0 ft) — Antimagic Field is centered on the caster, so the
 * caster is always the "target" of their own spell. The 10-ft sphere around
 * them is the suppression zone (handled in execute by incapacitating all
 * enemy casters within 10 ft).
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Antimagic Field')) return null;
  if (!hasSpellSlot(caster, 8)) return null;
  if (caster.concentration?.active) return null;  // can't concentrate on 2 spells

  // Check for ≥1 enemy spellcaster within 10 ft
  let foundEnemyCaster = false;
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 10) continue;
    if (!isSpellcaster(c)) continue;
    // Skip if already incapacitated by this caster's Antimagic Field
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Antimagic Field')) continue;
    foundEnemyCaster = true;
    break;
  }
  if (!foundEnemyCaster) return null;
  return caster;
}

export function execute(caster: Combatant, _self: Combatant, state: EngineState): void {
  consumeSpellSlot(caster, 8);

  // Drop stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Antimagic Field');

  emit(state, 'action', caster.id,
    `${caster.name} casts Antimagic Field! A 10-ft sphere of magical suppression surrounds them (concentration; magic items cease functioning, spells are dampened).`,
    caster.id);

  // Informational log: magic items are suppressed (no item subsystem in v1)
  emit(state, 'action', caster.id,
    `(v1: magic items within the sphere are suppressed — informational only; the engine has no item subsystem.)`,
    caster.id);

  // Apply `incapacitated` to ALL enemy spellcasters within 10 ft
  for (const c of state.battlefield.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 10) continue;
    if (!isSpellcaster(c)) continue;
    // Skip if already affected
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Antimagic Field')) continue;

    applySpellEffect(c, {
      casterId: caster.id,
      spellName: 'Antimagic Field',
      effectType: 'condition_apply',
      payload: { condition: 'incapacitated' },
      sourceIsConcentration: true,
      sourceCreatureType: caster.creatureType,
    });
    addCondition(c, 'incapacitated');
    emit(state, 'condition_add', caster.id,
      `${c.name} is inside the Antimagic Field — INCAPACITATED (can't cast spells) until concentration ends or they leave the area!`,
      c.id);
  }
}

export function cleanup(_c: Combatant): void { /* no-op — removeEffectsFromCaster handles conc cleanup */ }
