// ============================================================
// Hypnotic Pattern — PHB p.252
//
// 3rd-level illusion, action, range 120 ft, concentration (1 min).
// Components: V, S, M (a glowing stick of incense or a crystal vial
//             filled with phosphorescent material).
//
// Effect: You create a twisting pattern of colors that weaves through
//         the air inside a 10-foot cube within range. The pattern
//         appears for a moment and vanishes. Each creature in the area
//         who sees the pattern must make a Wisdom saving throw. On a
//         failed save, the creature becomes charmed and incapacitated
//         for the duration. While charmed by this spell, the creature
//         is incapacitated and has a speed of 0.
//
// Upcast: none (3rd-level spell — no upcast).
//
// v1 simplifications:
//   - Shape: canon 10-foot cube. v1 treats as a 10-ft-radius sphere
//     centered on the highest-threat enemy within 120 ft (mirrors Sunburst
//     — square approx). Documented via `hypnoticPatternCubeV1SimplifiedToRadius`.
//   - DUAL-condition (PHB p.252: "charmed and incapacitated"): v1 applies
//     BOTH conditions (two applySpellEffect calls). This is a NEW pattern
//     (dual-condition). Documented via `hypnoticPatternDualConditionV1`.
//   - Speed-0 rider (PHB p.252: "speed of 0"): approximated by incapacitated
//     (incapacitated creatures can't move in v1's engine). NOT separately
//     modelled.
//   - End-on-damage (PHB p.252: "the spell ends for the target if it takes
//     any damage"): NOT modelled — conditions persist for combat (or until
//     concentration breaks).
//   - Concentration: canon 1 min. v1 starts concentration; not enforced
//     on damage (TG-002). Both conditions are conc-sourced.
//   - Vision requirement (PHB p.252: "who sees the pattern"): NOT enforced
//     (v1 has no vision/line-of-sight check for spell effects).
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-charmed+incapacitated AoE
// (concentration, DUAL-condition). Removed from `_generic_registry.ts`;
// routed via `case 'hypnoticPattern':` in combat.ts and a planner branch
// in planner.ts. Mirrors Sunburst (radius AoE save + condition) + applies
// TWO conditions (charmed AND incapacitated).
//
// Spell module pattern (radius AoE save + dual-condition, concentration):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Hypnotic Pattern',
  level: 3,
  school: 'illusion',
  rangeFt: 120,                  // PHB p.252: 120 ft
  aoeRadiusFt: 10,               // canon 10-ft cube → v1 10-ft radius
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  hypnoticPatternCubeV1SimplifiedToRadius: true,           // 10-ft cube → 10-ft radius
  hypnoticPatternDualConditionV1: true,                    // charmed AND incapacitated (two calls)
  hypnoticPatternEndOnDamageV1Simplified: true,            // end-on-damage NOT modelled
  hypnoticPatternVisionRequirementV1Simplified: true,      // "who sees" NOT enforced
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
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

// ---- Planner ------------------------------------------------

/**
 * Returns the list of enemies caught in a Hypnotic Pattern 10-ft-radius area
 * centered on the highest-threat enemy within 120 ft, or null when the spell
 * should not be cast.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Hypnotic Pattern')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 120) continue;
    if (e.maxHP > centerThreat || (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e; centerThreat = e.maxHP; centerDist = distFt;
    }
  }
  if (!center) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 10) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Hypnotic Pattern');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 3);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Hypnotic Pattern');

  emit(state, 'action', caster.id,
    `${caster.name} casts Hypnotic Pattern! (DC ${saveDC} WIS, charmed+incapacitated on fail, ${metadata.aoeRadiusFt}-ft radius) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`);

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;
    const save = rollSaveReactable(state, caster, target, 'wis', saveDC);
    emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Hypnotic Pattern (rolled ${save.total})${save.success ? '' : ' + CHARMED+INCAPACITATED'}`, target.id, save.roll);

    if (!save.success) {
      // DUAL-condition: apply BOTH charmed AND incapacitated (two calls).
      if (!target.conditions.has('charmed')) {
        applySpellEffect(target, {
          casterId: caster.id, spellName: 'Hypnotic Pattern',
          effectType: 'condition_apply', payload: { condition: 'charmed' },
          sourceIsConcentration: true,
        });
      }
      if (!target.conditions.has('incapacitated')) {
        applySpellEffect(target, {
          casterId: caster.id, spellName: 'Hypnotic Pattern',
          effectType: 'condition_apply', payload: { condition: 'incapacitated' },
          sourceIsConcentration: true,
        });
      }
      emit(state, 'condition_add', caster.id,
        `${target.name} is CHARMED and INCAPACITATED by the swirling pattern! (speed 0, can't take actions)`, target.id);
    }
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
