// ============================================================
// Toll the Dead — XGE p.169
// Level 0 necromancy cantrip
//
// Casting time: action
// Range: 60 ft
// Components: V, S
// Effect: You point at one creature you can see within range,
//   and the sound of a dolorous bell fills the air around it
//   for a moment. The target must succeed on a Wisdom saving
//   throw or take 1d8 necrotic damage. If the target is missing
//   any of its hit points, it instead takes 1d12 necrotic
//   damage.
//
// Scaling: +1 die at 5th level (2d8 / 2d12), 11th (3d8 / 3d12),
//   and 17th (4d8 / 4d12). The die SIZE depends on whether the
//   target is wounded (1d12) or full HP (1d8); the die COUNT
//   scales with caster level.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 — conditional damage at Action-build time):
// ────────────────────────────────────────────────────────────
// This is the FIRST cantrip with conditional damage dice based
// on target state. The damage is rolled inside resolveAttack's
// save branch (rollDamage(action.damage)) BEFORE any cantrip
// dispatcher runs, so the conditional cannot be applied by a
// post-save-fail rider in CANTRIP_EFFECTS.
//
// Chosen approach (per zHANDOVER-SESSION-7): the AI/parser
// inspects the target's HP at Action-build time and sets the
// Action's `damage.sides` to 8 (full HP) or 12 (wounded). The
// cantrip module therefore provides METADATA ONLY — it exposes
// BOTH die-size tracks (full-HP and wounded) plus a helper
// `damageSidesForTarget(target)` that the AI/parser can call to
// pick the right sides. The save branch then rolls the
// pre-configured `action.damage` normally.
//
// Alternative approaches considered (NOT taken in v1):
//   - Add a `conditionalDamageDice` field on Action that the
//     save branch inspects to override damage.sides — cleaner
//     but more invasive (touches Action type + resolveAttack).
//   - Route Toll the Dead through a dedicated `executeTollTheDead`
//     handler like Burning Hands — overkill for a single-target
//     save cantrip.
//   - Use CANTRIP_SELF_EFFECTS with a flag the save branch reads
//     — would require a new flag field on Action anyway.
//
// No post-hit rider → no CANTRIP_EFFECTS entry needed.
// ============================================================

import { Combatant } from '../types/core';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Toll the Dead',
  level: 0,
  school: 'necromancy',
  rangeFt: 60,
  concentration: false,
  castingTime: 'action',
  /**
   * Default damage dice (target at FULL HP). The AI/parser MUST
   * swap to damageDiceWounded ('1d12') when target.currentHP <
   * target.maxHP — see damageSidesForTarget() below.
   */
  damageDice: '1d8',
  damageType: 'necrotic',
  saveAbility: 'wis' as const,
  /**
   * Scales at levels 5/11/17 (XGE p.169). Die COUNT scales; die
   * SIZE depends on whether the target is wounded.
   */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  /** Per-beam damage dice when target is at FULL HP (1d8 → 4d8). */
  scalingDice: ['2d8', '3d8', '4d8'] as const,
  /**
   * Conditional damage track — target is MISSING any HP.
   * damageDiceWounded: '1d12' base.
   * scalingDiceWounded: ['2d12', '3d12', '4d12'] at 5/11/17.
   * The AI/parser picks this track when target.currentHP < target.maxHP.
   */
  damageDiceWounded: '1d12' as const,
  scalingDiceWounded: ['2d12', '3d12', '4d12'] as const,
  /** Components: V + S (no M). */
  components: { v: true, s: true, m: false } as const,
} as const;

// ---- Helper: pick damage sides based on target HP ----------

/**
 * Pick the damage die SIDES for Toll the Dead based on the
 * target's current HP.
 *
 * XGE p.169: "If the target is missing any of its hit points,
 * it instead takes 1d12 necrotic damage."
 *
 * @param target  The cantrip's target.
 * @returns 12 if the target is missing any HP (wounded), 8 otherwise.
 *
 * The AI/parser calls this when building the Action and sets
 * `action.damage.sides` accordingly. This keeps the conditional
 * damage logic at Action-build time, not in the cantrip module
 * (which would be too late — damage is rolled in resolveAttack's
 * save branch before any cantrip dispatcher runs).
 */
export function damageSidesForTarget(target: Combatant): number {
  return target.currentHP < target.maxHP ? 12 : 8;
}

/**
 * Pick the damage dice STRING ('1d8' or '1d12') for a target at
 * a given caster level. Mainly for AI planning / log purposes.
 *
 * @param target       The cantrip's target.
 * @param casterLevel  The caster's character level (1–20).
 * @returns A dice string like '1d8', '1d12', '2d8', '2d12', etc.
 */
export function damageDiceForTarget(
  target: Combatant,
  casterLevel: number,
): string {
  const sides = damageSidesForTarget(target);
  let count = 1;
  if (casterLevel >= 17) count = 4;
  else if (casterLevel >= 11) count = 3;
  else if (casterLevel >= 5) count = 2;
  return `${count}d${sides}`;
}
