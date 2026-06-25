// ============================================================
// Drawmij's Instant Summons — PHB p.235
//
// 6th-level conjuration, 1-MINUTE casting time, range touch,
// permanent (until dispelled). Components: V, S, M (sapphire worth 1000 gp).
//
// Effect: You touch an object weighing 10 pounds or less whose longest
//         dimension is 6 feet or less. The spell leaves an invisible mark
//         on it. At any time thereafter, you can speak a command word to
//         summon the object to your hand.
//
// v1 status: OUT-OF-COMBAT — 1-min cast + object-marking with no combat
//   effect. shouldCast always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: "Drawmij's Instant Summons", level: 6, school: 'conjuration', rangeFt: 5,
  concentration: false, castingTime: '1_minute',
  outOfCombat: true,                            // 1-min cast + object marking — never used in combat
  drawmajsInstantSummonsOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
