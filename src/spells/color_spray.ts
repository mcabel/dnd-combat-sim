// ============================================================
// Color Spray — PHB p.222
//
// 1st-level illusion, action, range Self (15-ft cone), NO concentration.
// Components: V, S, M (red sand, yellow dust, and blue powder).
//
// Effect: A dazzling array of flashing, colored light springs from your
//         hand. Roll 6d10; the total is how many hit points of creatures
//         this spell can affect. Creatures in a 15-foot cone originating
//         from you are affected in order of their current hit points
//         (starting with the lowest current hit points). Each affected
//         creature is blinded [v1: unconscious] until the spell ends.
//         Subtract each creature's hit points from the total before
//         moving on to the creature with the next lowest hit points. A
//         creature's hit points must be equal to or less than the
//         remaining total for that creature to be affected.
//
// Upcast: +2d10/slot-level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Condition: PHB p.222 says "blinded". PER PLAN, v1 applies
//     `unconscious` (the plan's Batch 2 spec lists color_spray under
//     "unconscious"). This is a deviation from canon (blinded →
//     unconscious) per the plan. Documented via
//     `colorSprayBlindedV1SimplifiedToUnconscious`.
//   - HP-pool selection (PHB p.222: "6d10 hit points of creatures"):
//     v1 rolls 6d10 = HP budget; affects enemies in the 15-ft cone,
//     lowest-currentHP-first, deducting each enemy's currentHP from the
//     budget, until exhausted. This is the NEW HP-pool selection pattern
//     (mirrors Sleep's HP-bucket, but a cone + 6d10 + unconscious).
//     Documented via `colorSprayHpPoolSelectionV1`.
//   - Shape: canon 15-ft cone from caster. v1 uses inConeFt aimed at the
//     nearest living enemy within 15 ft (mirrors Spray of Cards).
//   - Unconscious application: v1 sets isUnconscious=true + conditions
//     (unconscious + incapacitated) AND uses applySpellEffect for the
//     unconscious condition (Batch-2 consistency + cleanup tracking).
//     Mirrors Sleep's direct-flag approach (engine correctness) +
//     Batch 2's applySpellEffect (condition tracking).
//   - Wake-on-damage (PHB p.222: ends when the creature takes damage):
//     NOT modelled — unconscious persists for the v1 combat.
//   - NOT concentration (PHB p.222: instantaneous — 1 min rider).
//   - Upcast: +2d10/slot-level NOT modelled — v1 always rolls 6d10.
//   - Undead immunity (PHB p.222: undead unaffected): NOT enforced.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke HP-pool cone → unconscious. Removed
// from `_generic_registry.ts`; routed via `case 'colorSpray':` in
// combat.ts and a planner branch in planner.ts. Mirrors Sleep (HP-pool)
// + Spray of Cards (15-ft cone) + applySpellEffect(condition_apply).
//
// Spell module pattern (HP-pool cone selection, no save, no concentration):
//   shouldCast(caster, bf) → Combatant[] | null  (enemies in cone, unsorted)
//   execute(caster, targets, state) → void  (rolls 6d10, sorts, budget-filters)
//   cleanup() — no-op (no concentration; unconscious persists for combat)
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { rollDie } from '../engine/utils';
import { inConeFt, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Color Spray',
  level: 1,
  school: 'illusion',
  rangeFt: 15,                   // PHB p.222: 15-ft cone
  dieCount: 6,
  dieSides: 10,                  // PHB p.222: 6d10 HP budget
  concentration: false,
  saveAbility: null,             // PHB p.222: NO save (HP-pool selection)
  castingTime: 'action',
  colorSprayBlindedV1SimplifiedToUnconscious: true,        // canon blinded → v1 unconscious (per plan)
  colorSprayHpPoolSelectionV1: true,                       // NEW HP-pool pattern (mirrors Sleep)
  colorSprayWakeOnDamageV1Simplified: true,                // wake-on-damage NOT modelled
  colorSprayUpcastV1Implemented: false,                    // +2d10/slot-level NOT modelled
} as const;

const CONE_RANGE_FT = 15;
const CONE_HALF_ANGLE_DEG = 26.57;

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

// ---- Dice helper --------------------------------------------

/** Roll `metadata.dieCount`d`metadata.dieSides` and return the total (HP budget). */
export function rollHpPool(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the list of enemies caught in a Color Spray 15-ft cone aimed at
 * the nearest living enemy within 15 ft, or null when the spell should not
 * be cast. (Targets are returned UNSORTED — execute sorts by currentHP for
 * the HP-pool filter.)
 *
 * Preconditions:
 *   - Caster has 'Color Spray' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - At least 1 living enemy (not already unconscious) is within 15 ft
 *
 * Note: Color Spray is NOT concentration — it can be cast while
 * concentrating on another spell.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Color Spray')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  // Find nearest enemy within cone range (sets the cone's aim direction).
  let nearest: Combatant | null = null;
  let nearestDistFt = Infinity;
  for (const e of enemies) {
    // Skip already-unconscious (via flag OR condition) — Color Spray adds no value.
    if (e.isUnconscious || e.conditions.has('unconscious')) continue;
    const dx = e.pos.x - caster.pos.x;
    const dy = e.pos.y - caster.pos.y;
    const distFt = Math.sqrt(dx * dx + dy * dy) * 5;
    if (distFt <= CONE_RANGE_FT && distFt < nearestDistFt) {
      nearest = e; nearestDistFt = distFt;
    }
  }
  if (!nearest) return null;

  // Collect all enemies in the cone aimed at the nearest enemy.
  const targets: Combatant[] = [];
  for (const e of enemies) {
    if (e.isUnconscious || e.conditions.has('unconscious')) continue;
    if (inConeFt(caster.pos, nearest.pos, e.pos, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT)) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Color Spray:
 *  1. Consume a 1st-level spell slot.
 *  2. Roll 6d10 = HP budget.
 *  3. Sort targets by ascending currentHP (weakest first).
 *  4. For each: if currentHP ≤ remaining budget → render unconscious
 *     (applySpellEffect + isUnconscious=true + incapacitated), deduct
 *     currentHP from budget. Else unaffected (budget can't cover them).
 *
 * v1: blinded (canon) → unconscious (per plan); HP-pool (mirrors Sleep).
 *
 * @param caster  The casting Combatant (Sorcerer / Wizard)
 * @param targets Candidates from shouldCast (enemies in the 15-ft cone, unsorted)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 1);

  // Roll 6d10 for the HP budget.
  let budget = rollHpPool();

  emit(state, 'action', caster.id,
    `${caster.name} casts Color Spray! (6d10 = ${budget} HP budget, 15-ft cone — ${targets.length} creature${targets.length !== 1 ? 's' : ''} in range)`);

  // Sort ascending by current HP — affect the weakest first (PHB p.222).
  const sorted = [...targets]
    .filter(t => !t.isDead && !t.isUnconscious && !t.conditions.has('unconscious'))
    .sort((a, b) => a.currentHP - b.currentHP);

  let affected = 0;
  for (const target of sorted) {
    if (budget <= 0) {
      emit(state, 'action', caster.id,
        `${target.name} (${target.currentHP} HP) — HP budget exhausted, unaffected by Color Spray`, target.id);
      continue;
    }
    if (target.currentHP <= budget) {
      // Budget covers this creature — render unconscious.
      budget -= target.currentHP;

      // applySpellEffect for Batch-2 condition tracking (cleanup on conc break —
      // though Color Spray is NOT concentration, this is consistent with the
      // Batch 2 pattern). sourceIsConcentration: false (instantaneous rider).
      applySpellEffect(target, {
        casterId: caster.id, spellName: 'Color Spray',
        effectType: 'condition_apply', payload: { condition: 'unconscious' },
        sourceIsConcentration: false,
      });
      // Mirror Sleep: set the engine isUnconscious flag + incapacitated so the
      // engine treats the target as down (skips their turn, etc.).
      target.isUnconscious = true;
      target.conditions.add('incapacitated' as Condition);

      emit(state, 'condition_add', caster.id,
        `${target.name} (${target.currentHP} HP) is rendered UNCONSCIOUS by Color Spray! (${budget} HP budget remaining)`, target.id);
      affected++;
    } else {
      // Creature's HP exceeds remaining budget — unaffected.
      emit(state, 'action', caster.id,
        `${target.name} (${target.currentHP} HP) — too many HP for remaining budget (${budget}), unaffected`, target.id);
    }
  }

  emit(state, 'action', caster.id,
    `Color Spray: ${affected} creature${affected !== 1 ? 's' : ''} rendered unconscious`);
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration; unconscious persists */ }
