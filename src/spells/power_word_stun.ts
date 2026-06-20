// ============================================================
// Power Word Stun — PHB p.267
//
// 8th-level enchantment, action, range 60 ft, NO concentration.
// Components: V.
//
// Effect: You speak a word of power that can overwhelm the mind of one
//         creature you can see within range, leaving it dumbfounded. If
//         the target has 150 hit points or fewer, it is stunned.
//         Otherwise, the spell has no effect.
//
// Upcast: none (8th-level spell — no upcast).
//
// v1 simplifications:
//   - Range: canon 60 ft. v1 uses chebyshev3D * 5 (square approx).
//   - HP threshold (PHB p.267: "150 hit points or fewer"): v1 uses
//     `currentHP <= 150` as the gate. The spell DOES NOT fire if the
//     target's currentHP > 150 (shouldCast prevents this by only
//     returning a target with currentHP ≤ 150). Documented via
//     `powerWordStunThreshold150Hp: true`.
//   - No save, no attack roll (PHB p.267: no save, no attack — the
//     creature is simply stunned if HP ≤ 150). Mirrors Power Word Kill's
//     pure-HP-gate pattern. Documented via `powerWordStunNoSaveNoAttack: true`.
//   - Stunned duration: canon is "until the end of the target's next
//     turn" (PHB p.267). v1 has no end-of-turn expiry hook — the stunned
//     condition persists for the entire combat. NOT concentration
//     (sourceIsConcentration: false). Documented via
//     `powerWordStunDurationV1Simplified: true`.
//   - NOT a concentration spell (PHB p.267: instantaneous — the stun is
//     a non-concentration effect).
//
// Migration note (Session 25 / Batch 2): This spell was BULK-IMPLEMENTED
// in Session 19 as a forward-compat flag. Session 25 migrated it to a
// bespoke implementation with the REAL HP-gate stun effect (no save, no
// attack). Removed from `_generic_registry.ts`; routed via
// `case 'powerWordStun':` in combat.ts and a planner branch in planner.ts.
// Mirrors Power Word Kill's HP-gate shape but applies stunned (not
// instakill) and is concentration-free.
//
// Spell module pattern (HP-gate condition — no save, no attack):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous; stunned persists via condition_apply)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Power Word Stun',
  level: 8,
  school: 'enchantment',
  rangeFt: 60,                   // PHB p.267: 60 ft
  hpThreshold: 150,              // PHB p.267: 150 hit points or fewer
  concentration: false,
  saveAbility: null,             // PHB p.267: NO save
  castingTime: 'action',
  powerWordStunThreshold150Hp: true,                       // PHB p.267: HP ≤ 150 gate
  powerWordStunNoSaveNoAttack: true,                       // no save AND no attack (mirrors PWK)
  powerWordStunDurationV1Simplified: true,                 // end-of-next-turn not tracked
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
 * Returns the single best target for Power Word Stun (a living enemy
 * within 60 ft whose currentHP ≤ 150), or null when the spell should
 * not be cast.
 *
 * Target priority:
 *   1. Highest-current-HP enemy within 60 ft whose currentHP ≤ 150 —
 *      Power Word Stun is best spent on the highest-HP target still
 *      under the 150-HP threshold (maximising the disable value). A
 *      145-HP threat is a better stun than a 20-HP minion.
 *   2. Tie-break: highest maxHP, then closest.
 *
 * Preconditions:
 *   - Caster has 'Power Word Stun' in their actions
 *   - Caster has at least one 8th-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft with currentHP ≤ 150
 *
 * Note: Power Word Stun is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 *
 * Note: Like Power Word Kill, this is an HP-gate spell whose shouldCast
 * reads `e.currentHP` directly (the engine doesn't model hidden HP).
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Power Word Stun')) return null;
  if (!hasSpellSlot(caster, 8)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; curHP: number; maxHP: number; dist: number }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    // HP gate: only target enemies with currentHP ≤ 150 (PHB p.267).
    if (e.currentHP > metadata.hpThreshold) continue;
    // Skip if already stunned (re-cast adds no value — stun doesn't stack).
    if (e.conditions.has('stunned')) continue;
    candidates.push({ c: e, curHP: e.currentHP, maxHP: e.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: highest current HP first (maximise the disable value), then
  // highest maxHP, then closest.
  candidates.sort((a, b) => {
    if (a.curHP !== b.curHP) return b.curHP - a.curHP;
    if (a.maxHP !== b.maxHP) return b.maxHP - a.maxHP;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Power Word Stun:
 *  1. Consume an 8th-level spell slot (no upcast — PWS is 8th-level only).
 *  2. Re-check the HP gate (the target may have been healed above 150
 *     between planTurn and executePlannedAction — if so, log "no effect"
 *     and return; the slot is still consumed per PHB p.267).
 *  3. If target.currentHP ≤ 150: apply stunned (condition_apply,
 *     sourceIsConcentration: false). NOT concentration.
 *
 * v1 simplifications: no save, no attack (pure HP check); stunned
 * persists for the entire combat (canon end-of-next-turn not tracked);
 * NOT concentration.
 *
 * @param caster  The casting Combatant (Bard / Sorcerer / Warlock / Wizard)
 * @param target  The target Combatant (within 60 ft, currentHP ≤ 150)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  // The slot is consumed UNCONDITIONALLY (PHB p.267: "You speak a word
  // of power" — the slot is spent whether or not the target is stunned).
  consumeSpellSlot(caster, 8);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Power Word Stun at ${target.name}! (no save, no attack — stunned if HP ≤ ${metadata.hpThreshold})`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'action', caster.id,
      `Power Word Stun: ${target.name} is already down — the word of power echoes harmlessly.`,
      target.id,
    );
    return;
  }

  // Re-check the HP gate (the target may have been healed between planTurn
  // and executePlannedAction).
  if (target.currentHP > metadata.hpThreshold) {
    emit(
      state, 'action', caster.id,
      `Power Word Stun: ${target.name} has ${target.currentHP} HP (> ${metadata.hpThreshold}) — the spell has NO EFFECT! (slot still consumed)`,
      target.id,
    );
    return;
  }

  // Apply stunned condition. NOT concentration — sourceIsConcentration: false.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Power Word Stun',
    effectType: 'condition_apply',
    payload: { condition: 'stunned' },
    sourceIsConcentration: false,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is STUNNED! (incapacitated, can't move, attacks vs them have advantage)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Power Word Stun — NO-OP because:
 *   - Power Word Stun is NOT a concentration spell; the stunned condition
 *     persists for the v1 combat duration (canon end-of-next-turn not tracked).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous cast; stunned persists via condition_apply.
}
