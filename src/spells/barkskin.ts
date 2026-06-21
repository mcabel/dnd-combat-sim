// ============================================================
// Barkskin — PHB p.217
//
// 2nd-level transmutation, action, range Touch (5 ft), concentration (1 hr).
// Components: V, S, M (a handful of oak bark).
//
// Effect: You touch a willing creature. Until the spell ends, the
//         target's skin has a rough, bark-like appearance, and the
//         target's AC can't be less than 16, regardless of what kind
//         of armor it is wearing.
//
// v1 simplifications:
//   - Duration: canon 1 hr concentration → v1: concentration is started
//     via startConcentration(), but the engine does NOT yet enforce
//     concentration checks on damage taken (forward-compat TODO; see
//     TG-002 in TEAMGOALS.md). The AC floor persists until
//     removeEffectsFromCaster() is called (concentration break by
//     re-cast, or combat end).
//   - Willing-creature check: v1 does NOT verify willingness — any
//     same-faction ally is a valid target. Cross-faction targets are
//     never selected by shouldCast (defensive).
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   metadata → spell stats
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Barkskin',
  level: 2,
  school: 'transmutation',
  rangeFt: 5,       // touch
  acFloor: 16,      // PHB p.217: "AC can't be less than 16"
  concentration: true,
  castingTime: 'action',
  barkskinConcentrationEnforcementV1Implemented: true,  // TG-002 DONE (Session 34)
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
 * Returns the single best target for Barkskin (a living ally within touch
 * range whose AC is currently below the floor of 16, not already barkskinned
 * by this caster), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Self (caster) — if caster's AC < 16
 *   2. Lowest-AC ally within 5 ft (most at-risk benefits most from AC 16)
 *
 * Preconditions:
 *   - Caster has 'Barkskin' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid target exists (self or ally within 5 ft with AC < 16)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Barkskin')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; ac: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;

    // Skip if already Barkskinned by this caster (no stacking — PHB p.217
    // doesn't say "no stack" explicitly, but multiple AC floors of 16 don't
    // change anything; re-cast would only refresh the duration).
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Barkskin')) continue;

    // Skip if target's AC is already >= 16 — Barkskin wouldn't help.
    if (c.ac >= metadata.acFloor) continue;

    candidates.push({ c, ac: c.ac, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: self first, then lowest AC (most at-risk), then closest.
  candidates.sort((a, b) => {
    const aSelf = a.c.id === caster.id ? 0 : 1;
    const bSelf = b.c.id === caster.id ? 0 : 1;
    if (aSelf !== bSelf) return aSelf - bSelf;
    if (a.ac !== b.ac) return a.ac - b.ac;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Barkskin:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner should prevent this).
 *  3. Start concentration on Barkskin.
 *  4. Apply ac_floor (16) effect on the target — no save required (willing creature).
 *     The floor is consulted by resolveAttack's effectiveAC computation:
 *       effectiveAC = max(natural AC, ac_floor) + ac_bonus + wardingBond + cover
 *
 * @param caster  The casting Combatant (Druid / Ranger)
 * @param target  The candidate from shouldCast (single ally in touch range, AC < 16)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  // Safety: clean up any stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Barkskin');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Barkskin on ${target.name}! (AC can't be less than ${metadata.acFloor})`,
    target.id,
  );

  // Re-check liveness (stale edge case)
  if (target.isDead || target.isUnconscious) return;

  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Barkskin',
    effectType: 'ac_floor',
    payload: {
      acFloor: metadata.acFloor,   // PHB p.217: AC ≥ 16
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name}'s skin becomes bark-like — AC floor ${metadata.acFloor}!`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Barkskin — called from resetBudget() at the start of
 * the caster's next turn. NO-OP in v1 because:
 *   - Barkskin is a concentration spell; the AC floor effect is removed
 *     via removeEffectsFromCaster() when concentration breaks (re-cast,
 *     damage-taken CON save fail once TG-002 is implemented, etc.).
 *   - v1 does NOT enforce concentration checks (TG-002), so concentration
 *     effectively persists for the entire combat. The ac_floor effect
 *     is removed only when removeEffectsFromCaster() is called.
 *
 * Exported for symmetry with the other spell modules' cleanup pattern
 * (mirror shield.ts / warding_bond.ts). The function is a no-op so
 * resetBudget's call site is uniform.
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
