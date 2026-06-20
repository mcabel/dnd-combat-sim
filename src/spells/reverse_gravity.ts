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
//         itself to a solid surface. On a failed save, a creature is
//         restrained (v1 simplification of the "fall upward" effect).
//
// Upcast: none (7th-level spell — no upcast).
//
// v1 simplifications:
//   - Shape: canon 50-ft-radius cylinder centered on a point within
//     100 ft. v1 centers the cylinder on the highest-threat enemy
//     within 100 ft (mirrors Sunburst) and collects all enemies within
//     50 ft via chebyshev3D (square approx of the cylinder).
//   - Effect: canon "falls upward" + lands at top of area (then falls
//     back when concentration ends, taking fall damage). v1 simplifies
//     to `condition_apply:restrained` on a failed DEX save (the closest
//     disabling condition; fall-damage-on-concentration-end NOT modelled).
//     Documented via `reverseGravityFallUpwardSimplifiedToRestrained`.
//   - Concentration: canon 1 min concentration. v1 starts concentration
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
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
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
  reverseGravityFallUpwardSimplifiedToRestrained: true,  // "fall upward" → restrained
  reverseGravityFallDamageV1Simplified: true,            // fall-back damage NOT modelled
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

    const save = rollSave(target, 'dex', saveDC);
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
        payload: { condition: 'restrained' },
        sourceIsConcentration: true,
      });
      emit(
        state, 'condition_add', caster.id,
        `${target.name} is RESTRAINED (falls upward, anchored at the top of the area)!`,
        target.id,
      );
    }
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup.
}
