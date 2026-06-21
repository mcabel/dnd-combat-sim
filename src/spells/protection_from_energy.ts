// ============================================================
// Protection from Energy — PHB p.266
//
// 3rd-level abjuration, action, range Touch (5 ft), concentration 10 min.
// Components: V, S.   Classes: Cleric, Druid, Ranger, Sorcerer, Wizard.
//
// Effect: For the duration, the willing creature has resistance to
//   one damage type of your choice: acid, cold, fire, lightning, or
//   thunder.
//
// Upcast: When you cast this spell using a spell slot of 4th level or
//   higher, you may target one additional creature for each slot level
//   above 3rd. (Session 36: NOW MODELLED.)
//   L3 slot → 1 target, L4 → 2, L5 → 3, L6 → 4, etc.
//
// v1 simplifications:
//   - Damage-type choice: the AI picks the most common eligible damage
//     type dealt by living enemies' actions (acid/cold/fire/lightning/
//     thunder). Defaults to fire if no eligible type found. The caster
//     can also pass `damageType` to `executeWithTargets` for testing or
//     scripted scenarios. The SAME damage type is granted to ALL targets
//     (PHB p.266: "one damage type of your choice" — singular, applies
//     to the whole spell).
//   - 10-minute concentration duration not tracked — concentration is
//     started but cleanup is via removeEffectsFromCaster on
//     concentration break (PHB p.203 damage check).
//   - Upcast: +1 target/slot-level NOW MODELLED (Session 36). The AI
//     picks the highest available slot level (L3+) and targets
//     `1 + max(0, slotLevel - 3)` allies. The AI prefers upcasting when
//     multiple valid allies are in touch range; otherwise uses L3
//     (1 target). The actual slot consumed is decided in `execute`
//     based on the target count returned.
//   - Innate-resistance edge case (Session 36 fix): if a target has
//     INNATE resistance to the same type the spell grants, the spell's
//     idempotent push is a no-op AND the sentinel's payload records
//     `addedResistance: false`. On concentration break, `_undoEffect`
//     checks this flag and does NOT splice the innate entry. Pre-Session
//     36 behavior (unconditional splice) is preserved for legacy
//     sentinels with `addedResistance === undefined`.
//   - The resistance is added to `target.resistances` directly AND
//     tracked via a `damage_zone` sentinel effect (dieCount=0) sourced
//     from the caster. When concentration breaks, _undoEffect's
//     'Protection from Energy' case removes the resistance from
//     `target.resistances` (only when `addedResistance === true`).
//
// Spell module pattern (Session 36: multi-target upcast, generic-registry shape):
//   shouldCast(caster, bf) → boolean                  (generic-registry shape, unchanged)
//   pickDamageType(caster, bf) → DamageType           (AI helper)
//   pickTarget(caster, bf) → Combatant | null         (AI helper, backwards-compat single-target)
//   collectCandidates(caster, bf) → sorted array      (shared multi-target helper)
//   execute(caster, state) → void                     (re-queries targets + type; multi-target upcast)
//   executeWithTargets(caster, targets, state, damageType) → void  (multi-target test entry)
//   executeWithTarget(caster, target, state, damageType) → void   (backwards-compat single-target wrapper)
//
// The generic-registry shape (`shouldCast → boolean`, `execute(caster, state)`)
// is preserved so the spell stays dispatched via `case 'genericSpell':` in
// combat.ts. Multi-target selection lives entirely inside `execute`, which
// re-queries the live battlefield for the candidate list + highest slot.
// ============================================================

import { Combatant, Battlefield, DamageType } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Protection from Energy',
  level: 3,
  school: 'abjuration',
  rangeFt: 5,       // touch
  concentration: true,
  castingTime: 'action',
  protectionFromEnergyUpcastV1Implemented: true,    // +1 target/slot NOW modelled (Session 36)
  protectionFromEnergyConcentrationEnforcementV1Implemented: true,  // TG-002 DONE (Session 34)
  protectionFromEnergyInnateResistanceFixV1Implemented: true,       // Session 36 fix
  protectionFromEnergyEligibleTypes: ['acid', 'cold', 'fire', 'lightning', 'thunder'] as const,
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

// ---- Eligible damage types ----------------------------------

const ELIGIBLE: ReadonlySet<DamageType> = new Set<DamageType>([
  'acid', 'cold', 'fire', 'lightning', 'thunder',
]);

// ---- Candidate collection (shared by pickTarget + execute) ----

/**
 * Collect and sort valid Protection from Energy targets within touch range.
 *
 * Target priority:
 *   1. Lowest-HP% ally within 5 ft (most vulnerable benefits most from
 *      resistance — they're taking damage and will keep taking it).
 *   2. Self (caster) LAST as a fallback when no ally is in touch range.
 *
 * Excludes:
 *   - Dead / unconscious allies
 *   - Allies already affected by THIS caster's Protection from Energy
 *     (no stacking).
 *
 * Preconditions (checked by caller):
 *   - Caster has 'Protection from Energy' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 */
function collectCandidates(caster: Combatant, bf: Battlefield): Array<{ c: Combatant; hpPct: number; dist: number }> {
  const candidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;

    // Skip if already affected by this caster's Protection from Energy.
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Protection from Energy'
    )) continue;

    candidates.push({ c, hpPct: c.currentHP / c.maxHP, dist: distFt });
  }

  // Sort: allies first (lowest HP%, then closest), self LAST as a fallback.
  // Rationale: Protection from Energy is most useful on a tanky ally who
  // will be taking the brunt of elemental attacks. Self-cast is the
  // fallback when no ally is in touch range.
  candidates.sort((a, b) => {
    const aSelf = a.c.id === caster.id ? 1 : 0;
    const bSelf = b.c.id === caster.id ? 1 : 0;
    if (aSelf !== bSelf) return aSelf - bSelf;  // self LAST
    if (Math.abs(a.hpPct - b.hpPct) > 0.01) return a.hpPct - b.hpPct;
    return a.dist - b.dist;
  });

  return candidates;
}

// ---- Target picker (backwards-compat single-target) --------

/**
 * Pick the best single ally target for Protection from Energy.
 *
 * Returns the first candidate from `collectCandidates` (lowest-HP% ally,
 * or self as fallback), or null when no valid target exists.
 *
 * Backwards-compat: retained for tests + legacy callers that expect
 * single-target semantics. The multi-target upcast path uses
 * `collectCandidates` directly.
 */
export function pickTarget(caster: Combatant, bf: Battlefield): Combatant | null {
  const candidates = collectCandidates(caster, bf);
  if (candidates.length === 0) return null;
  return candidates[0].c;
}

// ---- Damage type picker -------------------------------------

/**
 * Pick the best damage type for Protection from Energy based on the
 * enemies' actions. Returns the most common eligible damage type
 * (acid/cold/fire/lightning/thunder) dealt by living enemies' actions.
 * Defaults to 'fire' if no eligible type is found.
 *
 * The SAME damage type is granted to ALL targets of a single cast
 * (PHB p.266: "one damage type of your choice" — singular).
 */
export function pickDamageType(caster: Combatant, bf: Battlefield): DamageType {
  const counts = new Map<DamageType, number>();

  for (const e of bf.combatants.values()) {
    if (e.isDead || e.isUnconscious) continue;
    if (e.faction === caster.faction) continue;  // skip allies
    for (const a of e.actions) {
      const dt = a.damageType as DamageType | undefined;
      if (dt && ELIGIBLE.has(dt)) {
        counts.set(dt, (counts.get(dt) ?? 0) + 1);
      }
    }
  }

  let best: DamageType = 'fire';
  let bestCount = 0;
  for (const [dt, n] of counts) {
    if (n > bestCount) {
      best = dt;
      bestCount = n;
    }
  }
  return best;
}

// ---- Highest-slot helper ------------------------------------

/**
 * Determine the highest available spell slot level (L3-L9) the caster
 * has available. Returns 0 if no L3+ slot is available.
 *
 * Mirrors the Invisibility upcast pattern (Session 35): checks standard
 * slots L3-L9, then pact slots (Warlock) if higher.
 */
function findHighestSlot(caster: Combatant): number {
  const r = caster.resources;
  if (!r) return 0;
  let highest = 0;
  if (r.spellSlots) {
    for (let lvl = 3; lvl <= 9; lvl++) {
      if ((r.spellSlots[lvl]?.remaining ?? 0) > 0) highest = lvl;
    }
  }
  // Pact slots (Warlock) — if the pact slot level is higher, prefer it.
  // (Mirrors Invisibility's check; the `?? 0 > 0` precedence quirk is
  //  pre-existing and harmless for number truthiness.)
  if (r.pactSlots?.remaining ?? 0 > 0) {
    const pactLvl = r.pactSlots?.slotLevel ?? 0;
    if (pactLvl > highest) highest = pactLvl;
  }
  return highest;
}

// ---- shouldCast (generic-registry shape) --------------------

/**
 * Returns true if the caster should cast Protection from Energy this turn.
 *
 * Preconditions:
 *   - Caster has 'Protection from Energy' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - Caster is NOT already concentrating (would replace own concentration)
 *   - At least 1 valid ally target exists within 5 ft (self counts)
 *
 * The generic-registry dispatch (`case 'genericSpell':` in combat.ts) calls
 * this for the go/no-go decision, then calls `execute(caster, state)` which
 * re-queries the live battlefield for the actual multi-target list + slot
 * level (the count may change between plan time and execute time).
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Protection from Energy')) return false;
  if (!hasSpellSlot(caster, 3)) return false;
  if (caster.concentration?.active) return false;
  return collectCandidates(caster, bf).length > 0;
}

// ---- execute (generic-registry shape, multi-target) ---------

/**
 * Execute Protection from Energy (re-queries for the best targets + damage
 * type). Generic-registry compatible — called via `case 'genericSpell':`
 * in combat.ts.
 *
 * Multi-target upcast (Session 36, PHB p.266 "At Higher Levels"):
 *   - Determine the highest available slot level (L3+).
 *   - maxTargets = 1 + max(0, slotLevel - 3)  (L3→1, L4→2, L5→3, ...)
 *   - targetCount = min(candidates.length, maxTargets)  (no waste)
 *   - All targets get the SAME damage type (picked once via pickDamageType).
 *   - The actual slot consumed is decided in `executeWithTargets` based on
 *     the target count (slotLevel = 3 + (targets.length - 1)).
 */
export function execute(caster: Combatant, state: EngineState): void {
  const allCandidates = collectCandidates(caster, state.battlefield);
  if (allCandidates.length === 0) return;  // no valid target — silent no-op

  const highestSlot = findHighestSlot(caster);
  if (highestSlot === 0) return;  // no slot (defensive — shouldCast gating)

  // Multi-target upcast: exclude self UNLESS self is the only candidate.
  // Rationale (matches pickTarget's "self as fallback" design): allies
  // benefit more from resistance (especially tanks taking the brunt of
  // elemental attacks). Self is only targeted when no ally is in touch
  // range. This also avoids the AI "wasting" an upcast slot on itself
  // when an ally could benefit instead.
  const allies = allCandidates.filter(e => e.c.id !== caster.id);
  const candidates = allies.length > 0 ? allies : allCandidates;

  // AI heuristic (mirrors Invisibility Session 35): greedy on allies —
  // use the highest available slot, but cap target count at the number of
  // candidates (no waste). If only 1 candidate, uses L3 (no upcast).
  const maxTargetsFromSlot = 1 + Math.max(0, highestSlot - 3);  // L3→1, L4→2, L5→3, ...
  const targetCount = Math.min(candidates.length, maxTargetsFromSlot);
  const targets = candidates.slice(0, targetCount).map(e => e.c);

  const damageType = pickDamageType(caster, state.battlefield);
  executeWithTargets(caster, targets, state, damageType);
}

// ---- executeWithTargets (multi-target test entry point) -----

/**
 * Apply Protection from Energy to one or more targets with a specific
 * damage type. Used by `execute` (re-queries) and by tests (scripted).
 *
 * The SAME damage type is granted to ALL targets (PHB p.266: "one damage
 * type of your choice" — singular, applies to the whole spell).
 *
 * Steps:
 *  1. Determine the slot level to consume: `3 + (targets.length - 1)`.
 *     1 target → L3, 2 → L4, 3 → L5, etc. (PHB upcast rule). Consume
 *     that slot level (consumeSpellSlot falls back to a higher slot if
 *     the exact level is unavailable).
 *  2. Clean up any stale concentration (safety net).
 *  3. Start concentration on Protection from Energy.
 *  4. For each target:
 *     a. If the target does NOT already have `damageType` resistance
 *        (innate), push it and record `addedResistance: true` on the
 *        sentinel (Session 36 innate-resistance fix).
 *     b. If the target ALREADY has `damageType` resistance (innate),
 *        do NOT push (idempotent) and record `addedResistance: false`
 *        so `_undoEffect` won't splice the innate entry on break.
 *     c. Apply a `damage_zone` sentinel effect (dieCount=0) on the
 *        target, sourced from the caster — lifecycle anchor for
 *        concentration-break cleanup.
 */
export function executeWithTargets(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
  damageType: DamageType,
): void {
  if (targets.length === 0) return;

  // Determine slot level from target count: 1 target → L3, 2 → L4, etc.
  const desiredSlotLevel = Math.min(9, 3 + (targets.length - 1));
  consumeSpellSlot(caster, desiredSlotLevel);

  // Safety: clean up any stale concentration before starting new.
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Protection from Energy');

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Protection from Energy on ${names} — gains resistance to ${damageType}! (${targets.length} creature${targets.length !== 1 ? 's' : ''})`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    // Innate-resistance fix (Session 36): record whether the spell
    // actually pushed a new entry. If the target already had innate
    // resistance to this type, the push is a no-op and the sentinel
    // must NOT splice on concentration break.
    const alreadyHad = target.resistances.includes(damageType);
    let addedResistance = false;
    if (!alreadyHad) {
      target.resistances.push(damageType);
      addedResistance = true;
    }

    // Apply the sentinel effect (lifecycle anchor for concentration break).
    // payload.damageType is read by _undoEffect's 'Protection from Energy'
    // case to know which resistance to remove. payload.addedResistance
    // gates the splice (Session 36 innate-resistance fix).
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Protection from Energy',
      effectType: 'damage_zone',
      payload: {
        dieCount: 0,        // sentinel — skipped by start-of-turn damage tick
        dieSides: 0,
        damageType,
        addedResistance,
      },
      sourceIsConcentration: true,
    });

    emit(
      state, 'condition_add', caster.id,
      `${target.name} gains resistance to ${damageType} damage! (concentration)`,
      target.id,
    );
  }
}

// ---- executeWithTarget (backwards-compat single-target) -----

/**
 * Apply Protection from Energy to a single target. Backwards-compat
 * wrapper around `executeWithTargets` for legacy callers + tests that
 * expect single-target semantics (slot consumed = L3, no upcast).
 */
export function executeWithTarget(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
  damageType: DamageType,
): void {
  executeWithTargets(caster, [target], state, damageType);
}

// ---- cleanup ------------------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn from
 * resetBudget(). No-op for Protection from Energy — the 10-minute
 * concentration duration is not tracked in v1; cleanup happens via
 * removeEffectsFromCaster when concentration breaks (which calls
 * _undoEffect's 'Protection from Energy' case).
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via _undoEffect.
}
