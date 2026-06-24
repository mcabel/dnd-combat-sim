// ============================================================
// Darkness — PHB p.230
//
// 2nd-level evocation, action, range 60 ft, concentration (10 min).
// Components: V, M (bat fur and a drop of pitch or piece of coal).
//
// Effect: Creates a 15-ft-radius sphere of magical darkness (concentration).
//         Darkvision cannot see through it. Non-magical light cannot illuminate
//         within it. Creatures inside are blinded (heavily obscured).
//
// v1 status: STUB — requires TG-010 vision subsystem (specifically the
//   magicalDarknessCells set on Battlefield noted in the TG-010 RFC).
//   The subsystem needs to:
//     - Track magical darkness cells (Battlefield.magicalDarknessCells?)
//     - Block darkvision in those cells (unlike Fog Cloud)
//     - Apply blinded rules to creatures inside
//   shouldCast always returns null until the RFC is resolved.
//
// Coordination: TG-010 RFC posted at `docs/RFC-vision-audio-subsystem.md`.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Darkness', level: 2, school: 'evocation', rangeFt: 60,
  concentration: true, castingTime: 'action',
  darknessVisionV1Implemented: false, // requires TG-010 vision subsystem
  darknessBlocksDarkvision: true,     // distinguishing feature vs Fog Cloud
} as const;

/** Always returns null — awaiting TG-010 vision/darkness subsystem. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called until vision RFC resolved; no-op. */
export function execute(_caster: Combatant, _target: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
