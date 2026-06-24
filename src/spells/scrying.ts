// ============================================================
// Scrying — PHB p.273
//
// 5th-level divination, 10 minutes casting time, WIS save, concentration (10 min).
// Components: V, S, M (focus worth ≥1000 gp).
//
// Effect: You see and hear a creature on the same plane of existence (WIS save
//         based on how well you know the target). A magical sensor appears near
//         the target, invisible and impervious to most damage.
//
// v1 status: OUT-OF-COMBAT — 10-minute casting time makes it unusable during
//   combat. shouldCast always returns false. Monsters with Scrying will never
//   select it during a combat encounter.
//
// TG-010 note: A full implementation would require the vision subsystem
//   (Arcane Eye / Clairvoyance / Scrying extend computeLOS for remote sight).
//   Deferred until TG-010 vision RFC is resolved.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Scrying', level: 5, school: 'divination', rangeFt: 0,
  concentration: true, castingTime: '10_minutes',
  outOfCombat: true,               // 10-min cast time — never used in combat
  scryingVisionV1Implemented: false, // requires TG-010 vision subsystem
} as const;

/** Always returns false — 10-minute casting time; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): boolean {
  return false;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
