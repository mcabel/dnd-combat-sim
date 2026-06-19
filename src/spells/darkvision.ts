// ============================================================
// Darkvision — PHB p.230
//
// 2nd-level transmutation, action, range Touch, NO concentration (8 hr).
// Duration: 8 hours.   Components: V, S, M (a pinch of dried carrot or
//          an agate).
//
// Effect: You touch a willing creature to grant it the ability to see in
//         the dark. For the duration, that creature has darkvision out to
//         a range of 60 feet.
//
// Upcast: +20 ft range per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - v1 has NO vision subsystem (computeLOS does not query darkvision).
//     This spell sets a forward-compat flag `_darkvisionActive` on the
//     target — set for future use, never read in v1. Like Light's
//     `_lightSourceActive` pattern. Future work: extend computeLOS to
//     query `_darkvisionActive` and grant vision in dim light / darkness.
//   - NOT a concentration spell (PHB p.230: 8 hr, no concentration).
//     v1 applies the flag with no cleanup (persists for the combat, like
//     Aid's `_aidHPBonus`). Documented via the metadata flag
//     `darkvisionDurationV1Simplified: true`.
//   - Willing-creature check: v1 does NOT verify willingness — any
//     same-faction ally is a valid target.
//   - Upcast: +20 ft/slot-level NOT modelled — v1 always grants 60 ft.
//
// Spell module pattern (mirrors Light's touch-effect approach):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (forward-compat flag persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Darkvision',
  level: 2,
  school: 'transmutation',
  rangeFt: 5,       // touch
  darkvisionRangeFt: 60,
  concentration: false,
  castingTime: 'action',
  darkvisionVisionIntegrationV1Implemented: false,           // vision subsystem not implemented
  darkvisionDurationV1Simplified: true,                      // 8-hr duration not tracked (persists for combat)
  darkvisionUpcastV1Implemented: false,                      // +20 ft/slot-level NOT modelled
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
 * Returns the single best target for Darkvision (a living ally within touch
 * range, not already Darkvision'd by this caster), or null when the spell
 * should not be cast.
 *
 * Target priority:
 *   1. Self (caster) — always a valid target.
 *   2. Lowest-HP% ally within 5 ft (most vulnerable benefits from any buff).
 *
 * Preconditions:
 *   - Caster has 'Darkvision' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - At least 1 valid ally target exists within 5 ft
 *
 * Note: Darkvision is NOT concentration — it can be cast while concentrating
 * on another spell. The planner should NOT gate on concentration.
 *
 * Note: v1's planner still casts Darkvision even though the vision subsystem
 * is not implemented — the flag is set for forward-compat. A future planner
 * improvement could skip Darkvision in v1 (no mechanical effect), but v1
 * casts it for realism and to exercise the spell module.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Darkvision')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;

    // Skip if already Darkvision'd by this caster (no stacking).
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Darkvision'
    )) continue;

    candidates.push({ c, hpPct: c.currentHP / c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: self first, then lowest HP%, then closest.
  candidates.sort((a, b) => {
    const aSelf = a.c.id === caster.id ? 0 : 1;
    const bSelf = b.c.id === caster.id ? 0 : 1;
    if (aSelf !== bSelf) return aSelf - bSelf;
    if (Math.abs(a.hpPct - b.hpPct) > 0.01) return a.hpPct - b.hpPct;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Darkvision:
 *  1. Consume a 2nd-level spell slot.
 *  2. Set `target._darkvisionActive = true` (forward-compat flag).
 *  3. Log the cast.
 *
 * v1 simplifications: vision subsystem NOT implemented (flag is forward-
 * compat only); 8-hr duration not tracked (persists for combat); upcast NOT
 * modelled; NOT concentration.
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Darkvision on ${target.name}! (grants darkvision ${metadata.darkvisionRangeFt} ft — v1: forward-compat flag; vision subsystem not yet implemented)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  target._darkvisionActive = true;

  emit(
    state, 'condition_add', caster.id,
    `${target.name} gains darkvision out to ${metadata.darkvisionRangeFt} ft! (v1: forward-compat flag set; no mechanical effect until vision subsystem is implemented)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — forward-compat flag persists for combat (8-hr duration >> combat).
}
