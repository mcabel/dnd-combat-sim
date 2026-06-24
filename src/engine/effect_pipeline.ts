// ============================================================
// Effect Priority-Activation Pipeline — RFC-COMBINING-EFFECTS Phase 1
//
// Module: src/engine/effect_pipeline.ts
//
// Implements DMG p.252 "Combining Game Effects" + PHB Ch.10 "Combining
// Magical Effects": when 2+ active effects share an `effectName`, only the
// most potent applies (power > total duration > most recently activated).
//
// KEY DESIGN (user clarification): this is PRIORITY ACTIVATION, not dedup.
// Both effects COEXIST in combatant.activeEffects with their timers running.
// The loser gets `suppressed: true` (dormant, not deleted). When the active
// effect is removed (concentration break, expiry, dispel), the pipeline
// re-evaluates and promotes the next-highest suppressed effect to active.
// Removal from the stack happens ONLY when a source ends — never as a side
// effect of the priority-activation step.
//
// Phase 1 scope (this module):
//   - reevaluateEffects(): group by effectName → sort by priority → toggle
//     suppressed. NO condition re-derivation (conditions Set stays
//     authoritative — Phase 4). NO sourceTurnExpires expiry (Phase 2).
//   - Called from runCombat turn-start (after updateDetectionStates) AND
//     from removeEffectsFromCaster (so suppressed effects promote immediately
//     when a concentration break removes the active effect mid-turn).
//
// Phase 2 (DEFERRED): sourceTurnExpires expiry removal.
// Phase 3 (DEFERRED): explicit takeover-on-expiry tests.
// Phase 4 (DEFERRED): conditions derived from pipeline (replaces direct
//   addCondition/removeCondition for spell-sourced conditions).
// ============================================================

import { ActiveEffect, Combatant, Battlefield } from '../types/core';

/**
 * Re-evaluate the active-effects pipeline for one combatant.
 *
 * Steps:
 *   1. Group activeEffects by effectName (the priority-activation key).
 *   2. For each group with >1 effect, sort by priority (power > total
 *      duration > most recently activated) and mark the top one
 *      `suppressed: false` (active), the rest `suppressed: true`.
 *   3. For single-effect groups, ensure suppressed = false.
 *
 * This step ONLY toggles `suppressed` flags. It does NOT remove any effect
 * from activeEffects. Removal happens only when a source ends (concentration
 * break via removeEffectsFromCaster, or sourceTurnExpires expiry in Phase 2).
 *
 * Call from:
 *   - runCombat turn-start (after updateDetectionStates) — refreshes the
 *     pipeline for the actor at the start of their turn.
 *   - removeEffectsFromCaster — after removing a caster's effects, re-evaluate
 *     each affected combatant so suppressed effects promote to active
 *     immediately (no 1-round gap).
 */
export function reevaluateEffects(c: Combatant, _bf: Battlefield): void {
  // Group by effectName. Effects without effectName are treated as unique
  // (each is its own group of 1 → always active).
  const groups = new Map<string, ActiveEffect[]>();
  const ungrouped: ActiveEffect[] = [];

  for (const e of c.activeEffects) {
    if (!e.effectName) {
      ungrouped.push(e);
      continue;
    }
    const key = e.effectName;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  // Ungrouped effects (no effectName) are always active (legacy/unique).
  for (const e of ungrouped) {
    e.suppressed = false;
  }

  // For each named group, pick the top + suppress the rest.
  for (const [, group] of groups) {
    if (group.length <= 1) {
      if (group[0]) group[0].suppressed = false;
      continue;
    }
    // Sort: highest priority first (power > total duration > most recently activated).
    group.sort(compareByPriority);
    group[0].suppressed = false;       // top effect stays active
    for (let i = 1; i < group.length; i++) {
      group[i].suppressed = true;      // suppressed but retained (takeover candidates)
    }
  }
}

/**
 * DMG p.252 + XGE priority: power > total duration > most recently activated.
 *
 * Returns negative if `a` is higher priority (should sort first), positive
 * if `b` is higher, 0 if equal. (Array.sort ascending: lower = earlier.)
 *
 * "Higher priority" = "should be the active effect" = sorts first.
 */
export function compareByPriority(a: ActiveEffect, b: ActiveEffect): number {
  // 1. Power (effect-type-specific potency comparator — see comparePotency)
  const potency = comparePotency(a, b);
  if (potency !== 0) return -potency;   // higher potency first (negate because sort ascending)

  // 2. Total duration (longer total spell duration wins).
  //    total = sourceTurnExpires - appliedTurn; Infinity for concentration
  //    (no fixed end) — concentration outlasts finite, so it wins the tiebreak.
  const aDur = totalDuration(a);
  const bDur = totalDuration(b);
  if (aDur !== bDur) return bDur - aDur;   // longer duration first

  // 3. Most recently activated (higher appliedTurn wins)
  return (b.appliedTurn ?? 0) - (a.appliedTurn ?? 0);
}

/**
 * Total spell duration in rounds. For concentration effects (no
 * sourceTurnExpires), returns Infinity (outlasts any finite duration).
 * For effects with sourceTurnExpires, returns sourceTurnExpires - appliedTurn.
 * For effects with neither, returns 0 (instantaneous/unknown — lowest).
 */
function totalDuration(e: ActiveEffect): number {
  if (e.sourceTurnExpires !== undefined) {
    return e.sourceTurnExpires - (e.appliedTurn ?? 0);
  }
  if (e.sourceIsConcentration) {
    return Infinity;
  }
  return 0;
}

/**
 * Per-effect-type potency comparator. Returns positive if `a` is more potent,
 * negative if `b` is, 0 if equal. (compareByPriority negates this so higher
 * potency sorts first.)
 *
 * "Power" is effect-type-specific:
 *   - bless_die/bane_die: larger die = more potent.
 *   - ac_bonus: higher bonus = more potent.
 *   - ac_floor: higher floor = more potent.
 *   - damage_zone: more damage (dieCount × dieSides) = more potent.
 *   - condition_apply: higher saveDC = more potent.
 *   - weapon_enchant: higher total bonus = more potent.
 *   - others: 0 (tiebreak by duration/recency).
 */
export function comparePotency(a: ActiveEffect, b: ActiveEffect): number {
  // Same effectName → same effectType (guaranteed by registry design).
  // But defensive: if effectTypes differ, don't compare potency.
  if (a.effectType !== b.effectType) return 0;

  const ap = a.payload as Record<string, unknown>;
  const bp = b.payload as Record<string, unknown>;

  switch (a.effectType) {
    case 'bless_die':
    case 'bane_die':
      return ((ap.dieSides as number) ?? 0) - ((bp.dieSides as number) ?? 0);

    case 'ac_bonus':
      return ((ap.acBonus as number) ?? 0) - ((bp.acBonus as number) ?? 0);

    case 'ac_floor':
      return ((ap.acFloor as number) ?? 0) - ((bp.acFloor as number) ?? 0);

    case 'damage_zone':
      // Higher damage die × count = more powerful.
      return ((ap.dieCount as number) ?? 0) * ((ap.dieSides as number) ?? 0)
           - ((bp.dieCount as number) ?? 0) * ((bp.dieSides as number) ?? 0);

    case 'condition_apply':
      // For save-imposed conditions: higher save DC = more potent.
      // v1: condition_apply may not carry saveDC; falls back to 0.
      return ((ap.saveDC as number) ?? 0) - ((bp.saveDC as number) ?? 0);

    case 'weapon_enchant':
      return (((ap.attackBonus as number) ?? 0) + ((ap.damageBonus as number) ?? 0))
           - (((bp.attackBonus as number) ?? 0) + ((bp.damageBonus as number) ?? 0));

    // For effect types where "power" is harder to define (advantage_vs, taunt,
    // curse_rider, hex_damage, movement_rider, etc.) return 0 → tiebreak by
    // duration/recency.
    default:
      return 0;
  }
}

/**
 * Check if an effect is currently active (not suppressed).
 * Convenience helper for read functions. An effect with `suppressed: undefined`
 * or `suppressed: false` is active.
 */
export function isActive(e: ActiveEffect): boolean {
  return e.suppressed !== true;
}
