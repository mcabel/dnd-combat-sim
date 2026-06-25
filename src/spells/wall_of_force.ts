// ============================================================
// Wall of Force — PHB p.285
//
// 5th-level evocation, action, range 120 ft, concentration (10 min).
// Components: V, S, M (a paste of powdered quartz).
//
// Effect: An invisible wall of force appears. It is immune to all damage
//         and can't be dispelled by dispel magic. The wall creates a
//         solid barrier; creatures can't pass through it. As an action,
//         the caster can dismiss the wall.
//   - Shape: a 10×10 panel (up to 10 panels), OR a hemispherical dome
//     (max 10-ft radius), OR a 10-ft-radius sphere enclosing a creature
//     (a "capture" — creature is restrained, can't move out).
//
// Upcast: +1 panel per slot level above 5th (not modelled in v1).
//
// v1 simplifications:
//   - Wall geometry: NOT modelled (no wall/zone subsystem). v1 mirrors the
//     Wall of Fire v1 pattern: pick the highest-threat enemy in range and
//     treat the spell as a single-target "capture" — apply restrained +
//     incapacity-to-leave (movement_rider-less; just restrained condition).
//   - "Solid barrier" between cells: NOT modelled (requires TG-007 wall
//     subsystem; same gap as Wall of Fire / Wall of Ice / Wall of Stone).
//   - Damage immunity / dispel immunity: NOT modelled (no damage to apply).
//   - Dismissal action: NOT modelled (concentration break = wall gone,
//     restrained condition removed via removeEffectsFromCaster).
//   - Upcast: NOT modelled.
//   - Save: NONE (Wall of Force has no saving throw — the capture is
//     automatic on a creature enclosed by the sphere shape). v1: apply
//     restrained unconditionally to the targeted creature.
//
// Spell module pattern (single-target capture, concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (removeEffectsFromCaster handles conc cleanup)
//
// Combat value: HIGH. A no-save restrained shuts down a melee threat
// (they have disadv on DEX saves + attacks; melee attackers have adv vs
// them). 20 creatures in the bestiary know it (per coverage report).
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, addCondition } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Wall of Force', level: 5, school: 'evocation', rangeFt: 120,
  concentration: true, castingTime: 'action',
  wallOfForceGeometryV1Implemented: false,   // wall shape not modelled
  wallOfForceCaptureV1Implemented: true,      // single-target restrained (sphere shape)
  wallOfForceUpcastV1Implemented: false,      // upcast not modelled
  wallOfForceNoSave: true,                    // PHB: no saving throw
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Wall of Force')) return null;
  if (!hasSpellSlot(caster, 5)) return null;
  if (caster.concentration?.active) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 120) continue;
    // Skip if already captured by this caster's Wall of Force
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Wall of Force')) continue;
    // Skip creatures already restrained (no extra value)
    if (c.conditions.has('restrained')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Wall of Force');
  void action;  // No save; saveDC unused but kept for log consistency
  consumeSpellSlot(caster, 5);

  // Drop stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Wall of Force');

  emit(state, 'action', caster.id,
    `${caster.name} casts Wall of Force, enclosing ${target.name} in a sphere of invisible force! (no save, concentration)`,
    target.id);

  if (target.isDead || target.isUnconscious) return;

  // No save — the sphere captures the target automatically.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Wall of Force',
    effectType: 'condition_apply',
    payload: { condition: 'restrained' },
    sourceIsConcentration: true,
    sourceCreatureType: caster.creatureType,
  });
  addCondition(target, 'restrained');
  emit(state, 'condition_add', caster.id,
    `${target.name} is enclosed by Wall of Force — RESTRAINED (can't move; attacks vs it have advantage, its attacks have disadvantage, DEX saves disadv)!`,
    target.id);
}

export function cleanup(_c: Combatant): void { /* no-op — removeEffectsFromCaster handles conc cleanup */ }
