// ============================================================
// Reverse Gravity — PHB p.277
//
// 7th-level transmutation, action, range 100 ft, concentration (1 min).
// Components: V, S, M (a lodestone and iron filings).
//
// Effect: This spell reverses gravity in a 50-foot-radius cylinder
//         centered on a point you choose within range. All creatures
//         and loose objects in that area fall upward to the top of the
//         area. A creature can make a Dexterity saving throw to anchor
//         itself to a solid surface. On a failed save, a creature falls
//         upward 100 ft and is restrained at the top of the area.
//         When concentration ends, affected creatures fall back down
//         and take fall damage (PHB p.183: 1d6 per 10 ft).
//
// Upcast: none (7th-level spell — no upcast).
//
// v2 mechanics:
//   - Failed DEX save → restrained (stuck at top of 100-ft cylinder)
//     + _fallHeight = 100 (PHB p.277: creatures fall to the top of the
//     area, which is 100 ft up). When concentration breaks, the target
//     falls back down and takes 10d6 bludgeoning fall damage.
//   - Fall damage processed by processFallDamage() in combat.ts,
//     called after every removeEffectsFromCaster() invocation.
//     This handles: concentration save fail, caster death, new
//     concentration replacing old, etc.
//   - Shape: canon 50-ft-radius cylinder centered on a point within
//     100 ft. v2 centers the cylinder on the highest-threat enemy
//     within 100 ft (mirrors Sunburst) and collects all enemies within
//     50 ft via chebyshev3D (square approx of the cylinder).
//   - Concentration: canon 1 min concentration. v2 starts concentration
//     via startConcentration(); engine does NOT enforce concentration
//     checks on damage taken (TG-002). The restrained is
//     sourceIsConcentration: true.
//   - Upcast: none (7th-level only).
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke DEX-save-or-restrained AoE (conc).
// Removed from `_generic_registry.ts`; routed via `case 'reverseGravity':`
// in combat.ts and a planner branch in planner.ts. Mirrors Sunburst
// (radius AoE) + Hold Person (concentration), condition-only (no damage).
//
// Spell module pattern (radius AoE save + condition, concentration):
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
  name: 'Reverse Gravity',
  level: 7,
  school: 'transmutation',
  rangeFt: 100,                  // PHB p.277: 100 ft
  aoeRadiusFt: 50,               // PHB p.277: 50-ft radius cylinder
  concentration: true,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  reverseGravityFallDamageV2: true,  // PHB p.277 + p.183: fall damage on concentration break
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
 * Returns the list of enemies caught in a Reverse Gravity 50-ft-radius
 * cylinder centered on the highest-threat enemy within 100 ft of the
 * caster, or null when the spell should not be cast.
 *
 * Preconditions:
 *   - Caster has 'Reverse Gravity' in their actions
 *   - Caster has at least one 7th-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 100 ft
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Reverse Gravity')) return null;
  if (!hasSpellSlot(caster, 7)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 100) continue;
    if (e.maxHP > centerThreat ||
        (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e;
      centerThreat = e.maxHP;
      centerDist = distFt;
    }
  }
  if (!center) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 50) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Reverse Gravity:
 *  1. Consume a 7th-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Reverse Gravity.
 *  4. For each target: roll DEX save; on fail apply restrained (conc-sourced).
 *
 * @param caster  The casting Combatant (Druid / Sorcerer / Wizard)
 * @param targets Candidates from shouldCast (all enemies in the 50-ft radius)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Reverse Gravity');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 7);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Reverse Gravity');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Reverse Gravity! (DC ${saveDC} DEX, restrained on fail, ${metadata.aoeRadiusFt}-ft radius AoE) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'dex', saveDC);
    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Reverse Gravity (rolled ${save.total})${save.success ? '' : ' + RESTRAINED (falls upward)'}`,
      target.id, save.roll,
    );

    if (!save.success && !target.conditions.has('restrained')) {
      applySpellEffect(target, {
        casterId: caster.id,
        spellName: 'Reverse Gravity',
        effectType: 'condition_apply',
        payload: { condition: 'restrained', fallHeight: 100 },
        sourceIsConcentration: true,
      });
      // PHB p.277: creature falls upward to the top of the 100-ft cylinder.
      // _fallHeight is read by processFallDamage() in combat.ts when
      // concentration breaks (the restrained effect is removed, but the
      // scratch field persists until processFallDamage clears it).
      target._fallHeight = 100;
      emit(
        state, 'condition_add', caster.id,
        `${target.name} is RESTRAINED (falls upward 100 ft, anchored at the top of the area)!`,
        target.id,
      );
    }
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup.
}
