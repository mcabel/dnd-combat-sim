// ============================================================
// Pass without Trace — PHB p.264
//
// 2nd-level abjuration, action, range Self, concentration 1 hr.
// Duration: 1 hour, concentration.   Components: V, S, M (ashes from a burned
//          leaf of mistletoe and a sprig of spruce).
//
// Effect: A veil of shadows and silence radiates from you, masking you and
//         your companions from detection. For the duration, each creature you
//         choose within 30 feet of you (including you) gains a +10 bonus to
//         Dexterity (Stealth) checks.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - v1 has NO stealth subsystem (no hide/stealth-check integration in
//     combat). This spell sets a forward-compat flag `_passWithoutTraceActive`
//     on the CASTER — set for future use, never read in v1. Like Darkvision's
//     `_darkvisionActive` pattern. Future work: extend the stealth subsystem
//     to query `_passWithoutTraceActive` and grant +10 to DEX (Stealth) rolls
//     for allies within 30 ft of the caster.
//   - Concentration spell (PHB p.264: 1 hr, concentration). v1 starts
//     concentration via startConcentration, but concentration enforcement
//     (CON save on damage) is NOT implemented (TG-002). The flag persists
//     until removeEffectsFromCaster() is called (the spell uses a damage_zone
//     sentinel effect with dieCount=0 to anchor concentration-break cleanup).
//   - The aura's ally-selection (PHB p.264: "each creature you choose") is
//     NOT modelled — v1 sets the flag on the CASTER only (the caster's
//     presence is the aura anchor; future subsystem will compute allies
//     within 30 ft dynamically at stealth-check time).
//   - Upcast NOT modelled (no At Higher Levels entry).
//
// Spell module pattern (mirrors Alter Self's self-buff + sentinel approach
// but with concentration):
//   shouldCast(caster, bf) → boolean   (self-buff — no target needed)
//   execute(caster, state) → void
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
  name: 'Pass without Trace',
  level: 2,
  school: 'abjuration',
  rangeFt: 0,       // self
  auraRadiusFt: 30,
  stealthBonus: 10,
  concentration: true,
  castingTime: 'action',
  passWithoutTraceStealthSubsystemV1Implemented: false,    // stealth subsystem NOT implemented
  passWithoutTraceUpcastV1Implemented: false,              // upcast NOT modelled (no At Higher Levels)
  passWithoutTraceConcentrationEnforcementV1Implemented: true, // concentration break NOT enforced (TG-002)
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
 * Returns true if the caster should cast Pass without Trace this turn.
 *
 * Preconditions:
 *   - Caster has 'Pass without Trace' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on a spell (Pass without Trace is
 *     concentration — cannot stack with another concentration spell)
 *   - Caster is NOT already Pass-without-Trace-active (re-cast would only refresh)
 *   - At least 1 living ally (including self) is within 30 ft of the caster
 *     (the aura needs at least one ally to benefit — though self always
 *     qualifies, this check also ensures combat context)
 *
 * Note: Pass without Trace IS concentration — it cannot be cast while
 * concentrating on another spell. The planner gates on concentration via
 * shouldCast.
 *
 * Note: v1's planner still casts Pass without Trace even though the stealth
 * subsystem is not implemented — the flag is set for forward-compat. A future
 * planner improvement could skip Pass without Trace in v1 (no mechanical
 * effect), but v1 casts it for realism and to exercise the spell module.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Pass without Trace')) return false;
  if (!hasSpellSlot(caster, 2)) return false;

  if (caster._passWithoutTraceActive) return false;

  // At least 1 living ally within 30 ft (including self — self always qualifies
  // because chebyshev3D(self, self) = 0).
  let allyWithin30Ft = false;
  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt <= metadata.auraRadiusFt) {
      allyWithin30Ft = true;
      break;
    }
  }
  if (!allyWithin30Ft) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Pass without Trace:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Pass without Trace.
 *  4. Set `_passWithoutTraceActive = true` on the caster (forward-compat flag).
 *  5. Attach a `damage_zone` sentinel effect (dieCount=0) to anchor
 *     concentration-break cleanup.
 *
 * v1 simplifications: stealth subsystem NOT implemented (flag is forward-
 * compat only); aura ally-selection NOT modelled (caster-only flag);
 * concentration NOT enforced (TG-002); upcast NOT modelled.
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Pass without Trace');

  caster._passWithoutTraceActive = true;

  // Attach a damage_zone sentinel (dieCount=0) so removeEffectsFromCaster
  // clears the scratch field on concentration break.
  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Pass without Trace',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Pass without Trace! (+${metadata.stealthBonus} to DEX (Stealth) for allies within ${metadata.auraRadiusFt} ft — v1: forward-compat flag; stealth subsystem not yet implemented)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} radiates a veil of shadows and silence! (v1: forward-compat flag set; no mechanical effect until stealth subsystem is implemented)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via the sentinel effect.
}
