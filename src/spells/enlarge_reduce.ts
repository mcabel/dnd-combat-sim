// ============================================================
// Enlarge/Reduce — PHB p.237
//
// 2nd-level transmutation, action, range 30 ft, concentration (1 min).
// Components: V, S, M (a pinch of iron dust).
//
// Effect: You cause a creature or an object you can see within range to
//         grow larger or smaller for the duration.
//         - Enlarge: size +1 category; advantage on STR checks/saves;
//           weapon attacks deal +1d8 damage.
//         - Reduce: size -1 category; disadvantage on STR checks/saves;
//           weapon attacks deal half damage.
//
// v1 simplifications:
//   - Duration: canon 1 min concentration → v1: concentration is started
//     via startConcentration(), but the engine does NOT yet enforce
//     concentration checks on damage taken (forward-compat TODO; see
//     TG-002). The `enlarge_reduce` ActiveEffect persists until
//     removeEffectsFromCaster() is called (concentration break by
//     re-cast, or combat end).
//   - Size category change: v1 does NOT model the creature size change
//     (no size-modifier subsystem for weapon dice, carrying capacity,
//     or grapple size limits). The weapon-damage modifier (enlarge +1d8,
//     reduce half) IS modelled via resolveAttack's damage branch.
//   - Caster choice (enlarge vs reduce): v1 picks 'enlarge' when targeting
//     an ally and 'reduce' when targeting an enemy.
//   - Object targeting: v1 does NOT model targeting objects (creatures only).
//   - Upcast: PHB p.237 has no At Higher Levels entry — no upcast to model.
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → { target, mode } | null
//   execute(caster, target, mode, state) → void
//   metadata → spell stats
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Enlarge/Reduce',
  level: 2,
  school: 'transmutation',
  rangeFt: 30,
  concentration: true,
  saveAbility: 'con' as const,
  enlargeDamageDieSides: 8,      // +1d8 on weapon damage (enlarge)
  castingTime: 'action',
  // v1 simplification flags:
  enlargeReduceSizeCategoryV1Implemented: false,            // size change not modelled
  enlargeReduceObjectTargetingV1Implemented: false,         // objects not targeted
  enlargeReduceConcentrationEnforcementV1Implemented: false, // see TG-002
} as const;

export type EnlargeReduceMode = 'enlarge' | 'reduce';

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
 * Returns the best target + mode for Enlarge/Reduce, or null when the
 * spell should not be cast.
 *
 * Mode selection (v1 simplification):
 *   - Enemy target → 'reduce' (debuff: half weapon damage, disadv STR).
 *   - Ally target  → 'enlarge' (buff: +1d8 weapon damage, adv STR).
 *
 * Target priority:
 *   - Reduce (enemy): highest-threat enemy (maxHP) within 30 ft.
 *   - Enlarge (ally): ally with a weapon attack within 30 ft, lowest HP%.
 *
 * v1 PRIORITIZES the 'reduce' (enemy debuff) use case — if any valid enemy
 * exists within 30 ft, the planner picks 'reduce'. Only if no enemy is in
 * range does the planner fall back to 'enlarge' on an ally.
 *
 * Preconditions:
 *   - Caster has 'Enlarge/Reduce' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid target exists within 30 ft
 */
export function shouldCast(
  caster: Combatant,
  bf: Battlefield,
): { target: Combatant; mode: EnlargeReduceMode } | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Enlarge/Reduce')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  // 1. Look for an enemy to 'reduce' (highest threat, in range).
  let bestEnemy: { c: Combatant; threat: number; dist: number } | null = null;
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;

    // Skip if already affected by this caster (re-cast would only refresh).
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Enlarge/Reduce'
    )) continue;

    const threat = c.maxHP;
    if (!bestEnemy || threat > bestEnemy.threat ||
        (threat === bestEnemy.threat && distFt < bestEnemy.dist)) {
      bestEnemy = { c, threat, dist: distFt };
    }
  }

  if (bestEnemy) {
    return { target: bestEnemy.c, mode: 'reduce' };
  }

  // 2. Fall back to an ally to 'enlarge' (lowest HP% with a weapon attack).
  let bestAlly: { c: Combatant; hpPct: number; dist: number } | null = null;
  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;

    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Enlarge/Reduce'
    )) continue;

    // Must have a weapon attack to benefit from enlarge.
    const hasWeaponAttack = c.actions.some(a =>
      a.attackType === 'melee' || a.attackType === 'ranged'
    );
    if (!hasWeaponAttack) continue;

    const hpPct = c.currentHP / c.maxHP;
    if (!bestAlly || hpPct < bestAlly.hpPct ||
        (hpPct === bestAlly.hpPct && distFt < bestAlly.dist)) {
      bestAlly = { c, hpPct, dist: distFt };
    }
  }

  if (bestAlly) {
    return { target: bestAlly.c, mode: 'enlarge' };
  }

  return null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Enlarge/Reduce:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Enlarge/Reduce.
 *  4. Roll the target's CON save vs the caster's saveDC.
 *  5. On fail: apply an `enlarge_reduce` ActiveEffect on the target with
 *     payload.enlargeReduceMode = mode. The effect is read by:
 *       - resolveAttack's damage branch (attacker's effect: +1d8 if enlarge,
 *         half damage if reduce — melee/ranged weapon attacks only).
 *       - rollAbilityCheck (the creature's own STR checks: adv if enlarge,
 *         disadv if reduce).
 *       - rollSave (the creature's own STR saves: adv if enlarge, disadv if
 *         reduce — PHB p.237 explicitly says "Strength saving throws").
 *  6. On success: log the save, no effect applied.
 *
 * @param caster  The casting Combatant (Sorcerer/Wizard)
 * @param target  The candidate from shouldCast
 * @param mode    'enlarge' or 'reduce' (from shouldCast)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  mode: EnlargeReduceMode,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Enlarge/Reduce');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  // Safety: clean up any stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Enlarge/Reduce');

  const verb = mode === 'enlarge' ? 'Enlarge' : 'Reduce';
  emit(
    state, 'action', caster.id,
    `${caster.name} casts ${verb} at ${target.name}! (DC ${saveDC} CON)`,
    target.id,
  );

  // Re-check liveness (stale edge case)
  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'con', saveDC);
  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs ${verb} (rolled ${save.total})`,
    target.id,
    save.roll,
  );

  if (save.success) {
    emit(
      state, 'action', caster.id,
      `${target.name} resists ${verb} — no effect!`,
      target.id,
    );
    return;
  }

  // Apply the enlarge_reduce ActiveEffect. Read at resolution time by
  // resolveAttack (damage branch), rollAbilityCheck (STR), and rollSave (STR).
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Enlarge/Reduce',
    effectType: 'enlarge_reduce',
    payload: { enlargeReduceMode: mode },
    sourceIsConcentration: true,
  });

  const effectDesc = mode === 'enlarge'
    ? `ENLARGED! (+1d8 weapon damage, advantage on STR checks/saves)`
    : `REDUCED! (half weapon damage, disadvantage on STR checks/saves)`;
  emit(
    state, 'condition_add', caster.id,
    `${target.name} is ${effectDesc}`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Enlarge/Reduce — called from resetBudget() at the start
 * of the caster's next turn. NO-OP in v1 because:
 *   - Enlarge/Reduce is a concentration spell; the enlarge_reduce effect
 *     is removed via removeEffectsFromCaster() when concentration breaks.
 *   - v1 does NOT enforce concentration checks (TG-002).
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
