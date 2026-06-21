// ============================================================
// Detect Thoughts — PHB p.231
//
// 2nd-level divination, action, range Self (5-ft aura), concentration 1 min.
// Components: V, S, M (a copper piece).
//
// Effect: For the duration, you can read the thoughts of certain creatures.
//         When you cast the spell and as your action on each turn before the
//         spell ends, you can focus your mind on any one creature that you can
//         see within 30 feet of you. If the target can see you (or has
//         passive Perception 15+), it knows you are probing its thoughts —
//         otherwise it doesn't. The target can resist with a WIS save; on a
//         success, the spell ends.
//
//         Initial reading (when cast): you detect surface thoughts of all
//         creatures within 5 feet of you.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - v1 has NO mind-reading subsystem (no probe action, no surface-thoughts
//     read, no WIS-save-vs-caster subsystem). This spell sets a forward-compat
//     flag `_detectThoughtsActive` on the CASTER — set for future use, never
//     read in v1. Like Enthrall's `_enthrallActive` pattern. Future work:
//     extend the planner to take a "probe" action that reads a target's
//     thoughts and triggers a WIS save vs the caster's spell save DC.
//   - Concentration spell (PHB p.231: 1 min, concentration). v1 starts
//     concentration via startConcentration, but concentration enforcement
//     (CON save on damage) is NOT implemented (TG-002). The flag persists
//     until removeEffectsFromCaster() is called (the spell uses a damage_zone
//     sentinel effect with dieCount=0 to anchor concentration-break cleanup).
//   - v1 has NO probe action subsystem — the caster cannot take subsequent
//     actions to deep-probe a target. The spell slot is "spent" on the
//     aura + flag only. Forward-compat TODO via the metadata flag
//     `detectThoughtsProbeActionV1Implemented: false`.
//   - v1 does NOT model the WIS save that ends the spell if the target
//     resists (forward-compat TODO via
//     `detectThoughtsConcentrationEnforcementV1Implemented: true`).
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
import { livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Detect Thoughts',
  level: 2,
  school: 'divination',
  rangeFt: 5,       // self (5-ft aura for initial surface-thought read)
  concentration: true,
  castingTime: 'action',
  detectThoughtsMindReadingV1Implemented: false,           // mind-reading subsystem NOT implemented
  detectThoughtsProbeActionV1Implemented: false,           // probe-action subsystem NOT implemented
  detectThoughtsUpcastV1Implemented: false,                // upcast NOT modelled (no At Higher Levels)
  detectThoughtsConcentrationEnforcementV1Implemented: true, // WIS-save-resist ending NOT modelled
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
 * Returns true if the caster should cast Detect Thoughts this turn.
 *
 * Preconditions:
 *   - Caster has 'Detect Thoughts' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on a spell (Detect Thoughts is
 *     concentration — cannot stack with another concentration spell)
 *   - Caster is NOT already Detect-Thoughts-active (re-cast would only refresh)
 *   - At least 1 living enemy exists (the buff is useless with no enemies)
 *
 * Note: v1's planner still casts Detect Thoughts even though the mind-reading
 * subsystem is not implemented — the flag is set for forward-compat. A future
 * planner improvement could skip Detect Thoughts in v1 (no mechanical effect),
 * but v1 casts it for realism and to exercise the spell module.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Detect Thoughts')) return false;
  if (!hasSpellSlot(caster, 2)) return false;

  if (caster._detectThoughtsActive) return false;

  if (livingEnemiesOf(caster, bf).length === 0) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Detect Thoughts:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Detect Thoughts.
 *  4. Set `_detectThoughtsActive = true` on the caster (forward-compat flag).
 *  5. Attach a `damage_zone` sentinel effect (dieCount=0) to anchor
 *     concentration-break cleanup.
 *
 * v1 simplifications: mind-reading subsystem NOT implemented (flag is forward-
 * compat only); probe-action subsystem NOT implemented; WIS-save-resist ending
 * NOT modelled; upcast NOT modelled.
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Detect Thoughts');

  caster._detectThoughtsActive = true;

  // Attach a damage_zone sentinel (dieCount=0) so removeEffectsFromCaster
  // clears the scratch field on concentration break.
  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Detect Thoughts',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Detect Thoughts! (5-ft aura reads surface thoughts; concentration 1 min — v1: forward-compat flag; mind-reading subsystem not yet implemented)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} begins reading surface thoughts of nearby creatures! (v1: forward-compat flag set; no mechanical effect until mind-reading subsystem is implemented)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via the sentinel effect.
}
