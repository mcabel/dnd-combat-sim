// ============================================================
// Frostbite — XGE p.156 (reprinted from EEPC p.18)
// Level 0 evocation cantrip
//
// Casting time: action
// Range: 60 ft
// Components: V, S (verbal + somatic — no material)
// Effect: You cause numbing frost to form on one creature that
//   you can see within range. The target must make a
//   Constitution saving throw. On a failed save, the target
//   takes 1d6 cold damage, and it has disadvantage on the next
//   WEAPON attack roll it makes before the end of its next turn.
//
// Scaling: +1d6 at 5th level (2d6), 11th (3d6), 17th (4d6).
//
// ────────────────────────────────────────────────────────────
// Implementation (one-shot weapon-attack debuff — mirrors
// Vicious Mockery's one-shot attack debuff, with a key
// restriction: the rider applies ONLY to WEAPON attacks
// (melee/ranged), NOT to spell attacks).
// ────────────────────────────────────────────────────────────
// Rider: target has disadv on the next WEAPON attack roll it
//   makes before the end of its next turn (XGE p.156).
//
// Mirror the Vicious Mockery pattern (zHANDOVER-SESSION-6):
//   - Set `target._frostbiteDisadvNextWeaponAttack = true` in
//     applyCantripEffect (post-save-FAIL).
//   - resolveAttack's attack-roll branch folds this into the
//     `disadvantage` boolean — BUT ONLY when
//     `action.attackType === 'melee' || action.attackType === 'ranged'`
//     (i.e. weapon attacks). Spell attacks (attackType='spell')
//     are EXCLUDED — Frostbite specifically says "weapon attack
//     roll" (XGE p.156), unlike Vicious Mockery which applies
//     to ALL attack rolls (PHB p.285).
//   - Consume (set back to false) after the attack roll resolves,
//     hit or miss — one-shot.
//   - Cleanup via resetBudget() → cleanup() clears the flag if
//     not consumed before the target's next turn.
//
// Distinct from Vicious Mockery:
//   - Vicious Mockery: ALL attack rolls (weapon + spell)
//   - Frostbite:       WEAPON attack rolls only (melee + ranged)
//
// This is the FIRST cantrip to filter its one-shot attack debuff
// by attackType — establishing the pattern for future
// attack-type-restricted debuffs.
//
// Registered in CANTRIP_EFFECTS (post-save-FAIL dispatcher).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Frostbite',
  level: 0,
  school: 'evocation',
  rangeFt: 60,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d6',
  damageType: 'cold',
  saveAbility: 'con' as const,
  /** Scales at levels 5/11/17 (XGE p.156). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d6', '3d6', '4d6'] as const,
  /** Components: V + S (no M). */
  components: { v: true, s: true, m: false } as const,
  /**
   * Rider restriction: this debuff applies ONLY to weapon attacks
   * (attackType='melee' or 'ranged'), NOT spell attacks.
   * Distinct from Vicious Mockery, which applies to all attack
   * rolls. The resolveAttack attack-roll branch checks
   * `action.attackType === 'melee' || 'ranged'` before folding
   * this flag into `disadvantage`.
   */
  riderAttackTypes: ['melee', 'ranged'] as const,
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

// ---- applyCantripEffect --------------------------------------

/**
 * Apply Frostbite's post-fail rider after the target fails its
 * Constitution save. Called from resolveAttack's save branch
 * (via cantrip_effects dispatcher) AFTER damage is dealt, ONLY
 * when the save failed.
 *
 *   Rider: target has disadvantage on the next WEAPON attack
 *          roll it makes before the end of its next turn
 *          (XGE p.156).
 *   Implementation:
 *     target._frostbiteDisadvNextWeaponAttack = true (one-shot)
 *
 *   The rider is consumed in resolveAttack's attack-roll branch
 *   — but ONLY when the marked creature makes a WEAPON attack
 *   (attackType='melee' or 'ranged'). Spell attacks do NOT
 *   consume the flag and do NOT suffer the disadvantage.
 *
 * @returns true if the rider was applied
 */
export function applyCantripEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  target._frostbiteDisadvNextWeaponAttack = true;

  emit(
    state, 'action', caster.id,
    `${caster.name}'s Frostbite numbs ${target.name} — disadvantage on their next WEAPON attack!`,
    target.id,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Clears the Frostbite one-shot
 * weapon-attack disadvantage flag if it wasn't consumed by a
 * weapon attack before the target's next turn started
 * (XGE p.156: "before the end of its next turn").
 *
 * Codebase convention: the affected creature is the target; the
 * flag clears at the start of the TARGET's next turn (slightly
 * more lenient than PHB's "end of its next turn" but consistent
 * with how Vicious Mockery and Mind Sliver are timed).
 */
export function cleanup(combatant: Combatant): void {
  if (combatant._frostbiteDisadvNextWeaponAttack !== undefined) {
    delete combatant._frostbiteDisadvNextWeaponAttack;
  }
}
