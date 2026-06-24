// ============================================================
// Fog Cloud — PHB p.243
//
// 1st-level conjuration, action, range 120 ft, concentration (1 hr).
// Components: V, S.
//
// Effect: Creates a 20-ft-radius sphere of heavy obscurement (all within
//         are heavily obscured). Blocks line of sight.
//
// v1 status: STUB — requires TG-010 vision/obscurement subsystem.
//   The obscurement subsystem needs to:
//     - Track fog cells (Battlefield.fogCloudCells?)
//     - Modify computeLOS to block vision through fog
//     - Apply heavily-obscured rules (attacks vs/by creatures in fog have disadv)
//   shouldCast always returns null until the RFC is resolved.
//
// Upcast: +5-ft radius per slot level above 1st (not modelled in v1).
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Fog Cloud', level: 1, school: 'conjuration', rangeFt: 120,
  concentration: true, castingTime: 'action',
  fogCloudObscurementV1Implemented: false, // requires TG-010 vision subsystem
  fogCloudUpcastV1Implemented: false,
} as const;

/** Always returns null — awaiting TG-010 vision/obscurement subsystem. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called until vision RFC resolved; no-op. */
export function execute(_caster: Combatant, _target: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
