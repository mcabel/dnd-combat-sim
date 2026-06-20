// ============================================================
// Weird — PHB p.288
//
// 9th-level illusion, action, range 120 ft, concentration (1 min).
// Components: V, S, M (a tiny tentacle of a giant squid).
//
// Effect: Drawing on the deepest fears of a group of creatures, you
//         create illusory visions in their minds, with each creature
//         in a 30-foot-radius sphere centered on a point you choose
//         within range. The illusions appear differently to each
//         creature. A creature must make a Wisdom saving throw. On a
//         failed save, a creature takes 4d10 psychic damage per turn
//         and is frightened (for the duration). On a successful save,
//         a creature takes half as much damage and isn't frightened.
//
//         At the end of each of its turns, a frightened creature can
//         make a Wisdom saving throw. On a success, the spell ends for
//         that target.
//
// Upcast: none (9th-level spell — no upcast).
//
// v1 simplifications:
//   - Shape: canon 30-ft-radius SPHERE centered on a point within 120 ft.
//     v1 centers the sphere on the highest-threat enemy within 120 ft
//     (mirrors Sunburst) and collects all enemies within 30 ft of that
//     center via chebyshev3D (square approximation of the sphere).
//   - Per-turn DoT (PHB p.288: "4d10 psychic damage per turn" while
//     frightened): v1 simplifies to ONE-SHOT 4d10 psychic on the cast
//     (no end-of-turn DoT tick). The frightened condition still
//     persists (concentration). Documented via
//     `weirdPerTurnDotV1Simplified: true`.
//   - End-of-turn WIS save to end frightened early (PHB p.288): NOT
//     modelled — v1 has no end-of-turn save hook (same gap as Hold
//     Person / Blindness/Deafness). The frightened persists for the
//     entire combat (or until concentration breaks). Documented via
//     `weirdEndOfTurnSaveV1Implemented: false`.
//   - Concentration: canon 1 min concentration. v1 starts concentration
//     via startConcentration(), but the engine does NOT yet enforce
//     concentration checks on damage taken (TG-002). The frightened
//     condition is sourceIsConcentration: true so it is removed when
//     the caster's concentration breaks (re-cast, etc.).
//   - Half-damage on save: v1 DOES apply half damage on a successful
//     save (floor of the 4d10 roll), matching canon.
//
// Migration note (Session 25 / Batch 2): This spell was BULK-IMPLEMENTED
// in Session 19 as a forward-compat flag (no mechanical effect).
// Session 25 migrated it to a bespoke implementation with REAL WIS save
// + 4d10 psychic AoE + frightened condition on failed save (concentration).
// Removed from `_generic_registry.ts`; routed via `case 'weird':` in
// combat.ts and a planner branch in planner.ts. Mirrors Sunburst (AoE
// save + damage + condition) + Hold Person (concentration start).
//
// Spell module pattern (AoE save + damage + condition, concentration):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Weird',
  level: 9,
  school: 'illusion',
  rangeFt: 120,                 // PHB p.288: 120 ft
  aoeRadiusFt: 30,              // PHB p.288: 30-ft radius sphere
  dieCount: 4,
  dieSides: 10,
  damageType: 'psychic' as const,
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  weirdPerTurnDotV1Simplified: true,                  // one-shot 4d10 (canon per-turn DoT simplified)
  weirdEndOfTurnSaveV1Implemented: false,             // end-of-turn save skipped
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

// ---- Dice helper --------------------------------------------

/** Roll `metadata.dieCount`d`metadata.dieSides` and return the total. */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the list of enemies caught in a Weird 30-ft-radius sphere
 * centered on the highest-threat enemy within 120 ft of the caster, or
 * null when the spell should not be cast.
 *
 * Target selection:
 *   1. Find the highest-threat (maxHP) living enemy within 120 ft of
 *      the caster — this is the sphere's center.
 *   2. Collect ALL living enemies within 30 ft of that center (chebyshev).
 *
 * Preconditions:
 *   - Caster has 'Weird' in their actions
 *   - Caster has at least one 9th-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 120 ft
 *
 * Note: Weird IS concentration — it cannot be cast while concentrating
 * on another spell. The planner gates on concentration via shouldCast.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Weird')) return null;
  if (!hasSpellSlot(caster, 9)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  // Find highest-threat enemy within 120 ft of the caster (sphere center).
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 120) continue;
    if (e.maxHP > centerThreat ||
        (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e;
      centerThreat = e.maxHP;
      centerDist = distFt;
    }
  }
  if (!center) return null;

  // Collect all enemies within 30 ft of the center (chebyshev3D * 5).
  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 30) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Weird:
 *  1. Consume a 9th-level spell slot (no upcast — Weird is 9th-level only).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Weird.
 *  4. For each target in the list:
 *     a. Roll the target's WIS save vs the caster's saveDC.
 *     b. Always deal 4d10 psychic (half on successful save).
 *     c. On failed save: apply frightened (condition_apply, concentration-sourced).
 *
 * v1 simplifications: one-shot 4d10 (canon per-turn DoT simplified);
 * end-of-turn save NOT modelled; concentration-sourced frightened.
 *
 * @param caster  The casting Combatant (Wizard)
 * @param targets Candidates from shouldCast (all enemies in the 30-ft sphere)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Weird');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 9);

  // Safety: clean up any stale concentration before starting new.
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Weird');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Weird! (DC ${saveDC} WIS, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} + frightened on fail, ${metadata.aoeRadiusFt}-ft radius AoE) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSave(target, 'wis', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Weird (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + FRIGHTENED'}`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Weird: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );

    // On failed save: apply frightened condition (concentration-sourced).
    if (!save.success) {
      if (!target.conditions.has('frightened')) {
        applySpellEffect(target, {
          casterId: caster.id,
          spellName: 'Weird',
          effectType: 'condition_apply',
          payload: { condition: 'frightened' },
          sourceIsConcentration: true,
        });
        emit(
          state, 'condition_add', caster.id,
          `${target.name} is FRIGHTENED by illusory visions! (disadvantage on attacks/ability checks while caster is visible)`,
          target.id,
        );
      }
    }
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Weird — NO-OP in v1 because:
 *   - Weird is a concentration spell; the frightened condition is removed
 *     via removeEffectsFromCaster() when concentration breaks.
 *   - v1 does NOT enforce concentration checks (TG-002), so concentration
 *     effectively persists for the entire combat.
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup.
}
