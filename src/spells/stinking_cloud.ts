// ============================================================
// Stinking Cloud — PHB p.278
//
// 3rd-level conjuration, action, range 90 ft, concentration (1 min).
// Components: V, S, M (a rotten egg or cabbage leaves).
//
// Effect: You create a 20-foot-radius sphere of nauseating gas centered
//         on a point within range. The cloud spreads around corners. Each
//         creature that is completely within the cloud must succeed on a
//         Constitution saving throw or be poisoned until the end of its
//         next turn. While poisoned in this way, a creature can take
//         either an action or a bonus action on its turn, not both...
//         (v1 simplifies to poisoned AND incapacitated.)
//
// Upcast: none (3rd-level spell — no upcast).
//
// v1 simplifications:
//   - Shape: canon 20-ft-radius sphere. v1 centers on highest-threat enemy
//     within 90 ft (mirrors Sunburst); 20-ft radius (chebyshev).
//   - DUAL-condition (PHB p.278: "poisoned" + "while poisoned... can take
//     either an action or a bonus action, not both" — effectively a partial
//     incapacitation): v1 applies BOTH poisoned AND incapacitated (two
//     applySpellEffect calls). The action-economy restriction is simplified
//     to full incapacitated. Documented via `stinkingCloudDualConditionV1`.
//   - End-of-next-turn expiry (PHB p.278: "until the end of its next turn"):
//     NOT modelled — conditions persist for the v1 combat (or until conc
//     breaks).
//   - Concentration: canon 1 min. v1 starts concentration; not enforced
//     on damage (TG-002). Both conditions are conc-sourced.
//   - No damage (PHB p.278: no damage roll).
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke CON-save-or-poisoned+incapacitated AoE
// (concentration, DUAL-condition). Removed from `_generic_registry.ts`;
// routed via `case 'stinkingCloud':` in combat.ts and a planner branch in
// planner.ts. Mirrors Sunburst (radius AoE save + condition) + applies TWO
// conditions (poisoned AND incapacitated).
//
// Spell module pattern (radius AoE save + dual-condition, concentration):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster, filterGoIProtectedTargets } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Stinking Cloud',
  level: 3,
  school: 'conjuration',
  rangeFt: 90,                   // PHB p.278: 90 ft
  aoeRadiusFt: 20,               // PHB p.278: 20-ft radius sphere
  concentration: true,
  saveAbility: 'con' as const,
  castingTime: 'action',
  stinkingCloudDualConditionV1: true,                       // poisoned AND incapacitated (two calls)
  stinkingCloudEndOfNextTurnV1Simplified: true,             // end-of-next-turn not tracked
  stinkingCloudConcentrationEnforcementV1Implemented: true,
  stinkingCloudTerrainZoneV2Implemented: true,                      // v2: terrain_zone for persistent cloud
  stinkingCloudTerrainIncapacitatedV2SimplifiedToPoisonedOnly: true, // terrain zone applies poisoned only; incapacitated is initial-cast-only
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

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Stinking Cloud')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 90) continue;
    if (e.maxHP > centerThreat || (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e; centerThreat = e.maxHP; centerDist = distFt;
    }
  }
  if (!center) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 20) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Stinking Cloud');
  const saveDC = action?.saveDC ?? 13;

  const slotLevel = consumeSpellSlot(caster, 3) ?? 3;
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Stinking Cloud');

  // Session 78 (GoI AoE exclusion follow-up): PHB p.245: "the spell has no
  // effect on them." This applies to ALL spell effects, not just damage —
  // Stinking Cloud's poisoned + incapacitated conditions are also blocked.
  // The spell still fires (slot already consumed above); protected targets
  // are simply skipped in the condition application loop.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(state, 'action', caster.id,
    `${caster.name} casts Stinking Cloud! (DC ${saveDC} CON, poisoned+incapacitated on fail, ${metadata.aoeRadiusFt}-ft radius) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`);

  // Find the center (highest-threat enemy) for the terrain zone position
  // NOTE: use the original targets list (not effectiveTargets) so the terrain
  // zone is placed correctly even if all targets are GoI-protected.
  const center = targets.reduce<Combatant | null>((best, t) => {
    if (t.isDead || t.isUnconscious) return best;
    if (!best || t.maxHP > best.maxHP) return t;
    return best;
  }, null);

  // Apply terrain_zone effect on the CASTER (concentration)
  // This marks a persistent 20-ft radius zone at the center position.
  // On start-of-turn terrain check, creatures in the zone save vs CON or
  // become poisoned. The incapacitated rider from the initial cast is NOT
  // applied via terrain_zone (it only supports one condition); this is a
  // minor simplification — poisoned already gives disadv on attacks/ability
  // checks. Documented via stinkingCloudTerrainIncapacitatedV2SimplifiedToPoisonedOnly.
  //
  // Session 78: sourceSlotLevel is set so the terrain_zone tick in combat.ts
  // can re-check GoI protection on each per-turn tick.
  if (center) {
    applySpellEffect(caster, {
      casterId: caster.id,
      spellName: 'Stinking Cloud',
      effectType: 'terrain_zone',
      sourceSlotLevel: slotLevel,
      payload: {
        terrainSaveAbility: 'con' as const,
        terrainCondition: 'poisoned' as Condition,
        terrainRadiusFt: 20,
        terrainCenterX: center.pos.x,
        terrainCenterY: center.pos.y,
        terrainCenterZ: center.pos.z,
      },
      sourceIsConcentration: true,
    });
  }

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;
    const save = rollSaveReactable(state, caster, target, 'con', saveDC);
    emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Stinking Cloud (rolled ${save.total})${save.success ? '' : ' + POISONED+INCAPACITATED'}`, target.id, save.roll);

    if (!save.success) {
      // DUAL-condition: apply BOTH poisoned AND incapacitated (two calls).
      if (!target.conditions.has('poisoned')) {
        applySpellEffect(target, {
          casterId: caster.id, spellName: 'Stinking Cloud',
          effectType: 'condition_apply', payload: { condition: 'poisoned' },
          sourceIsConcentration: true,
        });
      }
      if (!target.conditions.has('incapacitated')) {
        applySpellEffect(target, {
          casterId: caster.id, spellName: 'Stinking Cloud',
          effectType: 'condition_apply', payload: { condition: 'incapacitated' },
          sourceIsConcentration: true,
        });
      }
      emit(state, 'condition_add', caster.id,
        `${target.name} is POISONED and INCAPACITATED by the nauseating cloud! (v1: action-economy restriction simplified to full incapacitated)`, target.id);
    }
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
