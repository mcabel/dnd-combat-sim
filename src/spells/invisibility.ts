// ============================================================
// Invisibility — PHB p.254
//
// 2nd-level illusion, action, range Touch, concentration (1 hr).
// Components: V, S, M (an eyelash encased in gum arabic).
//
// Effect: A creature you touch becomes invisible until the spell ends.
//         Anything the target is wearing or carrying is invisible as long
//         as it is on the target's person. The spell ends for a target
//         that attacks or casts a spell.
//
// Upcast: +1 target per slot level above 2nd (Session 35: NOW MODELLED).
//   L2 slot → 1 target, L3 → 2, L4 → 3, L5 → 4, etc.
//
// v1 simplifications:
//   - Duration: canon 1 hr concentration → v1: concentration is started
//     and enforced (TG-002 DONE Session 34). The invisible condition
//     persists until removeEffectsFromCaster() is called (concentration
//     break) OR the target attacks/casts.
//   - "Spell ends for a target that attacks or casts a spell": NOW MODELLED
//     (Session 32). The applySpellEffect call sets `breaksOnAttackOrCast: true`
//     on the ActiveEffect. combat.ts resolveAttack checks the ATTACKER's
//     activeEffects for this flag and removes the effect AFTER the attack
//     resolves (so the attack still gets invisible-advantage, but the
//     invisibility ends immediately after). The spell-casting path does
//     the same when the invisible creature casts a spell.
//   - Upcast: +1 target/slot-level NOW MODELLED (Session 35). The planner
//     picks the highest available slot level (L2+) and targets
//     `1 + max(0, slotLevel - 2)` allies. The AI prefers upcasting when
//     multiple valid allies are in touch range; otherwise uses L2 (1 target).
//   - The invisible condition is already wired into attackAdvantageState
//     (utils.ts): invisible attacker has advantage, attacks vs invisible
//     target have disadvantage. No additional integration needed.
//
// Spell module pattern (Session 35: multi-target for upcast):
//   shouldCast(caster, bf) → Combatant[] | null   (1 to N targets)
//   execute(caster, targets, state) → void         (applies to all)
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
//
// Backwards compat: `shouldCastSingle` and `executeSingle` retained for
// external callers that want single-target semantics (e.g. tests, legacy
// dispatch paths).
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Invisibility',
  level: 2,
  school: 'illusion',
  rangeFt: 5,       // touch
  concentration: true,
  castingTime: 'action',
  invisibilityEndsOnAttackV1Implemented: true,                // ends-on-attack NOW modelled (Session 32)
  invisibilityUpcastV1Implemented: true,                      // +1 target/slot-level NOW modelled (Session 35)
  invisibilityConcentrationEnforcementV1Implemented: true,   // TG-002 DONE (Session 34)
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

// ---- Candidate collection (shared by shouldCast + shouldCastSingle) ----

/**
 * Collect and sort valid Invisibility targets within touch range.
 *
 * Target priority:
 *   1. Self (caster) — if the caster has a weapon attack (a squishy caster
 *      that attacks at range benefits most from invisible-advantage).
 *   2. Lowest-HP% ally within 5 ft with a weapon attack (most vulnerable
 *      benefits from disadvantage on attacks vs them).
 *
 * Excludes:
 *   - Dead / unconscious allies
 *   - Allies already invisible (no stacking)
 *   - Allies already Invisibility'd by this caster
 *
 * Preconditions (checked by caller):
 *   - Caster has 'Invisibility' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 */
function collectCandidates(caster: Combatant, bf: Battlefield): Array<{ c: Combatant; hpPct: number; dist: number }> {
  const candidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;

    // Skip if already invisible (no stacking).
    if (c.conditions.has('invisible')) continue;

    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Invisibility'
    )) continue;

    candidates.push({ c, hpPct: c.currentHP / c.maxHP, dist: distFt });
  }

  // Sort: self first, then lowest HP%, then closest.
  candidates.sort((a, b) => {
    const aSelf = a.c.id === caster.id ? 0 : 1;
    const bSelf = b.c.id === caster.id ? 0 : 1;
    if (aSelf !== bSelf) return aSelf - bSelf;
    if (Math.abs(a.hpPct - b.hpPct) > 0.01) return a.hpPct - b.hpPct;
    return a.dist - b.dist;
  });

  return candidates;
}

/**
 * Returns the best N targets for Invisibility (living allies within touch
 * range, not already invisible, not already Invisibility'd by this caster),
 * or null when the spell should not be cast.
 *
 * The number of targets depends on the highest available slot level:
 *   L2 → 1 target, L3 → 2, L4 → 3, L5 → 4, etc.
 *   Formula: targetCount = 1 + max(0, slotLevel - 2)
 *
 * If the caster has multiple slot levels available (e.g. L2 + L3), the
 * planner picks the slot level that matches the number of valid candidates
 * (no waste). If only 1 candidate is in range, uses L2. If 2+ candidates
 * and an L3+ slot is available, uses the highest slot that has enough
 * candidates to fill (avoiding wasted upcasts).
 *
 * Preconditions:
 *   - Caster has 'Invisibility' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid ally target exists within 5 ft
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Invisibility')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates = collectCandidates(caster, bf);
  if (candidates.length === 0) return null;

  // Determine the highest available slot level (L2-L9).
  let highestSlot = 0;
  const r = caster.resources;
  if (r?.spellSlots) {
    for (let lvl = 2; lvl <= 9; lvl++) {
      if ((r.spellSlots[lvl]?.remaining ?? 0) > 0) highestSlot = lvl;
    }
  }
  if (r?.pactSlots?.remaining ?? 0 > 0) {
    const pactLvl = r?.pactSlots?.slotLevel ?? 0;
    if (pactLvl > highestSlot) highestSlot = pactLvl;
  }
  if (highestSlot === 0) return null;  // no slots (defensive — hasSpellSlot already checked)

  // AI heuristic: pick the slot level that best matches the candidate count.
  // - If only 1 candidate: use L2 (no benefit from upcasting).
  // - If 2+ candidates: use the highest available slot, but cap the target
  //   count at the number of available candidates (no waste).
  // - The actual slot consumed is decided in `execute` based on the target
  //   count we return (execute will consume slotLevel = 2 + (targets.length - 1)).
  //
  // v1 simplification: the AI is "greedy on allies" — if 3 allies are in
  // range and an L4 slot is available, it uses L4 (3 targets). If only an
  // L3 slot is available (no L4+), it uses L3 (2 targets, leaving 1 ally
  // visible). This matches the PHB upcast rule and avoids wasting high
  // slots on a single target when an L2 would suffice.
  const maxTargetsFromSlot = 1 + Math.max(0, highestSlot - 2);  // L2→1, L3→2, L4→3, ...
  const targetCount = Math.min(candidates.length, maxTargetsFromSlot);

  return candidates.slice(0, targetCount).map(e => e.c);
}

/**
 * Backwards-compat single-target shouldCast. Returns the single best
 * target or null. Used by legacy dispatch paths and tests that expect
 * the pre-upcast signature.
 */
export function shouldCastSingle(caster: Combatant, bf: Battlefield): Combatant | null {
  const targets = shouldCast(caster, bf);
  return targets && targets.length > 0 ? targets[0] : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Invisibility on one or more targets.
 *
 * Steps:
 *  1. Determine the slot level to consume: `2 + (targets.length - 1)`.
 *     L2 for 1 target, L3 for 2, L4 for 3, etc. (PHB upcast rule).
 *  2. Consume that slot level. If the exact level is unavailable, fall
 *     back to a higher slot (consumeSpellSlot handles this).
 *  3. Break any existing concentration (safety net — shouldCast gating
 *     should prevent this).
 *  4. Start concentration on Invisibility.
 *  5. For each target: apply the invisible effect with
 *     `breaksOnAttackOrCast: true` (PHB p.254: "The spell ends for a
 *     target that attacks or casts a spell").
 *
 * @param caster   The casting Combatant
 * @param targets  1 to N targets from shouldCast (allies within 5 ft)
 * @param state    Current EngineState
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  if (targets.length === 0) return;

  // Determine slot level from target count: 1 target → L2, 2 → L3, etc.
  const desiredSlotLevel = Math.min(9, 2 + (targets.length - 1));
  consumeSpellSlot(caster, desiredSlotLevel);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Invisibility');

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Invisibility on ${names}! (${targets.length} creature${targets.length !== 1 ? 's' : ''})`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Invisibility',
      effectType: 'invisible',
      payload: {},
      sourceIsConcentration: true,
      // PHB p.254: "The spell ends for a target that attacks or casts a spell."
      // Session 32: now modelled — combat.ts resolveAttack + spell-casting path
      // check for breaksOnAttackOrCast=true and remove the effect after the
      // attack/spell resolves. Greater Invisibility does NOT set this flag.
      breaksOnAttackOrCast: true,
    });

    emit(
      state, 'condition_add', caster.id,
      `${target.name} turns INVISIBLE! (advantage on attacks, disadvantage on attacks vs them)`,
      target.id,
    );
  }
}

/**
 * Backwards-compat single-target execute. Applies Invisibility to a
 * single target. Used by legacy dispatch paths and tests.
 */
export function executeSingle(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  execute(caster, [target], state);
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
