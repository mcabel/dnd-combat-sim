// ============================================================
// Protection from Poison — PHB p.270
//
// 2nd-level abjuration, action, range Touch, NO concentration (1 hr).
// Duration: 1 hour.   Components: V, S.
//
// Effect: You touch a creature. If it is poisoned, you neutralize the poison.
//         If more than one poison afflicts the creature, you neutralize all
//         of them. For the duration, the target has advantage on saving
//         throws against being poisoned, and it has resistance to poison
//         damage.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - v1 implements the condition-removal part (mirror Lesser Restoration):
//     removes the 'poisoned' condition from the target on cast.
//   - v1 has NO poison-resistance subsystem (applyDamage does not query a
//     "resistance to poison damage" flag). The advantage/resistance is
//     tracked via a forward-compat flag `_protectionFromPoisonActive` on the
//     TARGET — set for future use, never read in v1. Future work: extend
//     rollSave to grant advantage on CON saves vs poison, and applyDamage
//     to halve poison damage.
//   - NOT a concentration spell (PHB p.270: 1 hr, no concentration).
//     v1 applies the flag with no cleanup (persists for the combat, like
//     Darkvision's `_darkvisionActive`). Documented via the metadata flag
//     `protectionFromPoisonDurationV1Simplified: true`.
//   - v1 only models a single 'poisoned' condition (PHB p.292: poisoned is
//     a single condition — different poison sources apply the same condition,
//     so removing 'poisoned' removes all of them in v1).
//   - Upcast NOT modelled (no At Higher Levels entry).
//
// Spell module pattern (mirrors Lesser Restoration's condition-removal
// approach BUT also sets a forward-compat flag for the advantage/resistance):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous removal + persistent flag)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot, hasInnateSpellUse, consumeInnateSpellUse } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Protection from Poison',
  level: 2,
  school: 'abjuration',
  rangeFt: 5,       // touch
  concentration: false,
  castingTime: 'action',
  protectionFromPoisonAdvantageV1Implemented: false,    // advantage on saves vs poison NOT modelled
  protectionFromPoisonResistanceV1Implemented: false,   // resistance to poison damage NOT modelled
  protectionFromPoisonDurationV1Simplified: true,       // 1-hr duration not tracked (persists for combat)
  protectionFromPoisonUpcastV1Implemented: false,       // upcast NOT modelled (no At Higher Levels)
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
 * Returns the single best target for Protection from Poison (a living ally
 * within touch range), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Self (caster) — if poisoned.
 *   2. Lowest-HP% poisoned ally within 5 ft (most vulnerable benefits most
 *      from condition removal + the advantage/resistance buff).
 *   3. If NO poisoned ally exists, falls back to lowest-HP% ally within 5 ft
 *      as a PREVENTIVE buff (the advantage/resistance is still valuable as
 *      a precaution against future poison attacks).
 *
 * Preconditions:
 *   - Caster has 'Protection from Poison' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available OR has
 *     an innate spellcasting use of Protection from Poison remaining
 *     (Session 45 Task #20-follow-up: supports the Couatl's 3/day innate
 *     casting — MM p.43)
 *   - At least 1 valid ally target exists within 5 ft (poisoned OR not — the
 *     preventive-buff fallback covers non-poisoned allies)
 *
 * Note: Protection from Poison is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Protection from Poison')) return null;
  // ── Session 45 Task #20-follow-up: accept innate spell uses as alternative ──
  if (!hasSpellSlot(caster, 2) && !hasInnateSpellUse(caster, 'Protection from Poison')) return null;

  const poisonedCandidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];
  const allCandidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;

    // Skip if already Protection-from-Poison-active by this caster (no stacking).
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Protection from Poison'
    )) continue;

    const entry = { c, hpPct: c.currentHP / c.maxHP, dist: distFt };
    allCandidates.push(entry);
    if (c.conditions.has('poisoned')) {
      poisonedCandidates.push(entry);
    }
  }

  // Prefer poisoned allies; fall back to all allies (preventive buff).
  const pool = poisonedCandidates.length > 0 ? poisonedCandidates : allCandidates;
  if (pool.length === 0) return null;

  // Sort: self first, then lowest HP%, then closest.
  pool.sort((a, b) => {
    const aSelf = a.c.id === caster.id ? 0 : 1;
    const bSelf = b.c.id === caster.id ? 0 : 1;
    if (aSelf !== bSelf) return aSelf - bSelf;
    if (Math.abs(a.hpPct - b.hpPct) > 0.01) return a.hpPct - b.hpPct;
    return a.dist - b.dist;
  });

  return pool[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Protection from Poison:
 *  1. Consume a 2nd-level spell slot — OR, if no slot is available, consume
 *     an innate spellcasting use (Session 45 Task #20-follow-up: supports
 *     the Couatl's 3/day innate casting — MM p.43).
 *  2. Remove the 'poisoned' condition from the target (if present).
 *  3. Set `_protectionFromPoisonActive = true` on the target (forward-compat
 *     flag for the advantage-on-saves-vs-poison and resistance-to-poison-
 *     damage effects — no subsystem reads it yet in v1).
 *  4. Log the cast and the condition removal (if any).
 *
 * v1 simplifications: advantage-on-saves subsystem NOT implemented (flag is
 * forward-compat only); resistance-to-poison-damage subsystem NOT implemented
 * (flag is forward-compat only); 1-hr duration not tracked (persists for
 * combat); NOT concentration.
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  // ── Session 45 Task #20-follow-up: innate spell use fallback ──
  // Mirrors cure_wounds.ts / shield.ts / lesser_restoration.ts pattern.
  const slotUsed = consumeSpellSlot(caster, 2);
  if (slotUsed === null) {
    consumeInnateSpellUse(caster, 'Protection from Poison');
  }

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Protection from Poison on ${target.name}! (ends poisoned + grants advantage on saves vs poison & resistance to poison damage)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  // Remove the 'poisoned' condition if present.
  if (target.conditions.has('poisoned')) {
    target.conditions.delete('poisoned');
    emit(
      state, 'condition_remove', caster.id,
      `${target.name}'s poisoned condition is ended by Protection from Poison!`,
      target.id,
    );
  }

  // Set the forward-compat flag for advantage/resistance.
  target._protectionFromPoisonActive = true;

  emit(
    state, 'condition_add', caster.id,
    `${target.name} gains advantage on saves vs poison and resistance to poison damage! (v1: forward-compat flag set; no mechanical effect until poison-resistance subsystem is implemented)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — forward-compat flag persists for combat (1-hr duration >> combat).
}
