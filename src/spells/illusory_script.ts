// ============================================================
// Illusory Script — PHB p.252
//
// 1st-level illusion (ritual), 1-MINUTE casting time, range touch,
// duration 10 days. Components: V, S, M (lead-based ink worth 10 gp).
//
// Effect: You write on parchment, paper, or some other suitable writing
//         material and imbue it with a potent illusion that lasts for the
//         duration. To you and any creatures you designate when you cast
//         the spell, the writing appears normal. To all others, the writing
//         appears unintelligible.
//
// v1 status: OUT-OF-COMBAT — 1-min cast + hidden writing with no combat
//   effect. shouldCast always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Illusory Script', level: 1, school: 'illusion', rangeFt: 5,
  concentration: false, castingTime: '1_minute',
  outOfCombat: true,                  // 1-min cast + hidden writing — never used in combat
  illusoryScriptOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
