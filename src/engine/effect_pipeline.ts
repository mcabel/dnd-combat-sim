// ============================================================
// Effect Priority-Activation Pipeline — RFC-COMBINING-EFFECTS
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
// Phase 1 (Session 64):
//   - reevaluateEffects(): group by effectName → sort by priority → toggle
//     suppressed. NO condition re-derivation (Phase 4).
//   - Called from runCombat turn-start AND from removeEffectsFromCaster.
//
// Phase 2 (this session):
//   - sourceTurnExpires expiry: before grouping, remove effects whose
//     sourceTurnExpires ≤ bf.round. Call undoEffect() for structural
//     cleanup, then reconcile conditions from remaining unsuppressed
//     effects (handles takeover-on-expiry for condition_apply effects).
//   - Spell modules populate sourceTurnExpires on non-concentration
//     effects with finite durations (Blindness/Deafness 1 min, etc.).
//
// Phase 3 (DEFERRED): explicit takeover-on-expiry tests.
// Phase 4 (Session 66): conditions derived from source-tracked map.
//   - Replaced _nonspecllConditions with _conditionSources:
//     Map<Condition, Set<sourceId>>. Each condition tracks which sources
//     impose it ('non-spell' for combat mechanics, effect.id for spells).
//   - _rederiveConditions() rebuilds conditions Set by checking which
//     sourceIds are still valid. This cleanly distinguishes expired spell
//     conditions from non-spell conditions — fixing the bug where Darkness
//     ending wrongly removed 'blinded' even though Blindness/Deafness was
//     still active, AND the bug where expired spell conditions persisted
//     via the backward-compat carry-over step.
// ============================================================

import { ActiveEffect, Combatant, Battlefield, Condition } from '../types/core';
import { undoEffect, removeBattlefieldObstacle, removeTerrainDifficulty } from './spell_effects';

/**
 * Re-evaluate the active-effects pipeline for one combatant.
 *
 * Steps:
 *   0. Expire effects whose sourceTurnExpires ≤ bf.round (non-concentration
 *      duration expiry). Call undoEffect() for structural cleanup, then
 *      remove from activeEffects.
 *   1. Group remaining activeEffects by effectName (the priority-activation key).
 *   2. For each group with >1 effect, sort by priority (power > total
 *      duration > most recently activated) and mark the top one
 *      `suppressed: false` (active), the rest `suppressed: true`.
 *   3. For single-effect groups, ensure suppressed = false.
 *   4. Reconcile conditions: ensure unsuppressed condition_apply effects'
 *      conditions are in the combatant's conditions Set (handles takeover
 *      after expiry — undoEffect may have deleted a condition that a
 *      newly-promoted suppressed effect still imposes).
 *
 * Call from:
 *   - runCombat turn-start (after updateDetectionStates) — refreshes the
 *     pipeline for the actor at the start of their turn.
 *   - removeEffectsFromCaster — after removing a caster's effects, re-evaluate
 *     each affected combatant so suppressed effects promote to active
 *     immediately (no 1-round gap).
 */
export function reevaluateEffects(c: Combatant, bf: Battlefield): void {
  const round = bf.round;

  // ── Phase 2 step 0: expire non-concentration effects ──
  // Remove effects whose sourceTurnExpires has passed. This is the ONLY
  // step that removes effects from the stack (besides concentration break
  // via removeEffectsFromCaster). For each expired effect, do full
  // structural cleanup (undoEffect + obstacle/terrain removal).
  const expired: ActiveEffect[] = [];
  c.activeEffects = c.activeEffects.filter(e => {
    if (e.sourceTurnExpires !== undefined && round > e.sourceTurnExpires) {
      expired.push(e);
      return false;
    }
    return true;
  });

  for (const e of expired) {
    // Structural cleanup matching removeEffectById / removeEffectsFromCaster:
    // terrain zones and battlefield obstacles need extra battlefield-level
    // cleanup before the per-combatant undoEffect.
    if (e.effectType === 'terrain_zone' && (e.payload as Record<string, unknown>).terrainDifficulty) {
      removeTerrainDifficulty(bf, e);
    }
    if (e.effectType === 'battlefield_obstacle') {
      removeBattlefieldObstacle(bf, e);
    }
    undoEffect(c, e);
  }

  // ── Steps 1-3: group by effectName → priority sort → toggle suppressed ──

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

  // ── Phase 4 step 4: re-derive conditions from source-tracked map ──
  // Rebuild the conditions Set from _conditionSources. Each condition
  // maps to sourceIds ('non-spell' or effect.id). A condition is derived
  // if any sourceId is valid (non-spell always, effect.id only if the
  // effect is still in activeEffects and unsuppressed). This cleanly
  // handles: (a) takeover — when a spell effect promotes from suppressed,
  // its sourceId becomes valid again; (b) expiry — when a spell effect
  // is removed from activeEffects, its sourceId becomes invalid, and
  // undoEffect already removed it from _conditionSources.
  _rederiveConditions(c);
}

/**
 * Re-derive the conditions Set from the pipeline state.
 *
 * Rebuilds `c.conditions` from `_conditionSources`:
 *   - Each condition maps to a Set of sourceIds.
 *   - 'non-spell' sourceIds always count (conditions from combat mechanics,
 *     monster traits, class features, etc.).
 *   - Effect-ID sourceIds count only if the effect still exists in
 *     `activeEffects` and is unsuppressed.
 *   - A condition is derived if ANY of its sourceIds is valid.
 *
 * Then cascades: paralyzed/stunned/petrified → incapacitated.
 *
 * This replaces the old approach of:
 *   1. Starting with _nonspecllConditions
 *   2. Adding conditions from unsuppressed effects
 *   3. Backward-compat carry-over of "orphan" conditions from the existing Set
 *
 * The old step 3 was the bug: it carried over conditions from expired spell
 * effects because once the effect was removed from activeEffects, there was
 * no way to distinguish them from non-spell conditions. The source-tracked
 * approach eliminates this ambiguity entirely.
 */
function _rederiveConditions(c: Combatant): void {
  const derived = new Set<Condition>();

  // Seed _conditionSources from the existing conditions Set if not yet created.
  // All existing conditions are assumed to be non-spell sources (they were set
  // before Phase 4 tracking existed). This handles:
  //   - Test factories that set conditions directly via the constructor
  //   - Legacy combatants created before Phase 4
  if (!c._conditionSources) {
    c._conditionSources = new Map();
    for (const cond of c.conditions) {
      let sources = new Set<string>();
      sources.add('non-spell');
      c._conditionSources.set(cond, sources);
    }
  }

  // Also handle conditions added directly to the Set after _conditionSources
  // was created (e.g. by test code or combat mechanics that bypass
  // addCondition). A condition in the Set but NOT in _conditionSources
  // was never tracked → must be non-spell. Add it.
  //
  // A condition in _conditionSources with an EMPTY sourceIds set is a
  // "tombstone" — it was spell-sourced and all sources were removed by
  // undoEffect. We do NOT re-add it as non-spell.
  for (const cond of c.conditions) {
    if (!c._conditionSources.has(cond)) {
      let sources = new Set<string>();
      sources.add('non-spell');
      c._conditionSources.set(cond, sources);
    }
  }

  for (const [cond, sourceIds] of c._conditionSources) {
    for (const sourceId of sourceIds) {
      if (sourceId === 'non-spell') {
        // Non-spell source: always valid (monster trait, combat mechanic, etc.)
        derived.add(cond);
        break;
      }
      // Spell-effect source: valid only if the effect still exists and is unsuppressed
      const effect = c.activeEffects.find(e => e.id === sourceId);
      if (effect && !effect.suppressed) {
        derived.add(cond);
        break;
      }
    }
  }

  // Cascade: paralyzed/stunned/petrified → incapacitated
  if (derived.has('paralyzed') ||
      derived.has('stunned') ||
      derived.has('petrified')) {
    derived.add('incapacitated');
  }

  // Replace the Set content (preserves Set identity for any external refs).
  c.conditions.clear();
  for (const cond of derived) c.conditions.add(cond);
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
