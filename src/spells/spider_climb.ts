// ============================================================
// Spider Climb — PHB p.277
//
// 2nd-level transmutation, action, range Touch, concentration 1 hr.
// Duration: 1 hour, concentration.   Components: V, S, M (a drop of bitumen
//          and a spider).
//
// Effect: Until the spell ends, one willing creature you touch gains the
//         ability to move up, down, and across vertical surfaces and upside
//         down along ceilings, while leaving its hands free. The target also
//         gains a climbing speed equal to its walking speed.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - v1 has NO climb-speed subsystem (movement does not query climb speed).
//     This spell sets a forward-compat flag `_spiderClimbActive` on the
//     TARGET — set for future use, never read in v1. Like Darkvision's
//     `_darkvisionActive` pattern. Future work: extend the movement system
//     to query `_spiderClimbActive` and grant vertical/climbing movement.
//   - Concentration spell (PHB p.277: 1 hr, concentration). v1 starts
//     concentration via startConcentration, but concentration enforcement
//     (CON save on damage) is NOT implemented (TG-002). The flag persists
//     until removeEffectsFromCaster() is called (the spell uses a damage_zone
//     sentinel effect with dieCount=0 to anchor concentration-break cleanup).
//   - Willing-creature check: v1 does NOT verify willingness — any same-
//     faction ally is a valid target.
//   - Upcast NOT modelled (no At Higher Levels entry).
//
// Spell module pattern (mirrors Darkvision's touch-effect approach BUT with
// concentration + sentinel):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (concentration break handles cleanup via the sentinel)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Spider Climb',
  level: 2,
  school: 'transmutation',
  rangeFt: 5,       // touch
  concentration: true,
  castingTime: 'action',
  spiderClimbClimbSpeedV1Implemented: false,                // climb-speed subsystem NOT implemented
  spiderClimbUpcastV1Implemented: false,                    // upcast NOT modelled (no At Higher Levels)
  spiderClimbConcentrationEnforcementV1Implemented: false,  // concentration break NOT enforced (TG-002)
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
 * Returns the single best target for Spider Climb (a living ally within touch
 * range, not already Spider-Climb-active by this caster), or null when the
 * spell should not be cast.
 *
 * Target priority:
 *   1. Self (caster) — always a valid target.
 *   2. Lowest-HP% ally within 5 ft (most vulnerable benefits from any buff).
 *
 * Preconditions:
 *   - Caster has 'Spider Climb' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on a spell (Spider Climb is
 *     concentration — cannot stack with another concentration spell)
 *   - At least 1 valid ally target exists within 5 ft
 *
 * Note: Spider Climb IS concentration — it cannot be cast while concentrating
 * on another spell. The planner gates on concentration via shouldCast.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Spider Climb')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;

    // Skip if already Spider-Climb-active by this caster (no stacking).
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Spider Climb'
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
 * Execute Spider Climb:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Spider Climb.
 *  4. Set `target._spiderClimbActive = true` (forward-compat flag).
 *  5. Attach a `damage_zone` sentinel effect (dieCount=0) to the TARGET to
 *     anchor concentration-break cleanup.
 *
 * v1 simplifications: climb-speed subsystem NOT implemented (flag is forward-
 * compat only); concentration NOT enforced (TG-002); upcast NOT modelled.
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Spider Climb');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Spider Climb on ${target.name}! (target gains climb speed — v1: forward-compat flag; climb-speed subsystem not yet implemented)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  target._spiderClimbActive = true;

  // Attach a damage_zone sentinel (dieCount=0) on the TARGET so
  // removeEffectsFromCaster clears the scratch field on concentration break.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Spider Climb',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} can now climb walls and ceilings! (v1: forward-compat flag set; no mechanical effect until climb-speed subsystem is implemented)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via the sentinel effect.
}
