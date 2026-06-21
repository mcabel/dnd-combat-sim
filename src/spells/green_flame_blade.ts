// ============================================================
// Green-Flame Blade — TCE p.107 (reprinted from SCAG p.143)
// Level 0 evocation cantrip
//
// Casting time: action
// Range: Self (5-ft radius — must target one creature within 5 ft)
// Components: S, M (a melee weapon worth at least 1 sp)
// Effect: You brandish the weapon used in the spell's casting
//   and make a melee attack with it against one creature
//   within 5 feet of you. On a hit, the target suffers the
//   weapon attack's normal effects, and you can cause green
//   fire to leap from the target to a different creature of
//   your choice that you can see within 5 feet of it. The
//   second creature takes fire damage equal to your
//   spellcasting ability modifier.
//
// Scaling (TCE p.107 — two damage tracks):
//   - "fire damage to secondary creature" (the splash):
//     at 1st-4th level: spellcasting_mod (min 1)
//     at 5th-10th:      1d8 + spellcasting_mod
//     at 11th-16th:     2d8 + spellcasting_mod
//     at 17th+:         3d8 + spellcasting_mod
//   - "fire damage on hit" (extra on-hit fire):
//     0d8 at 1–4, +1d8 at 5–10, +2d8 at 11–16, +3d8 at 17+
//
// ────────────────────────────────────────────────────────────
// v1 SIMPLIFICATION (this module):
// ────────────────────────────────────────────────────────────
// Green-Flame Blade is the SECOND cantrip with two damage
// components (after Booming Blade):
//   (1) on-hit fire damage (scales), AND
//   (2) a SPLASH fire damage rider to a second creature within
//       5 ft of the primary target (also scales).
//
// For v1, this module models the spell as:
//   - A melee weapon attack (attackType='spell', reach=5) dealing
//     1d8 fire damage on hit (simplification — at low levels
//     the on-hit damage should be 0d8 fire + weapon damage,
//     but v1 ignores weapon damage and gives a flat 1d8 fire
//     on hit at all levels so the cantrip is useful at 1st level,
//     mirroring the Booming Blade v1 simplification).
//   - A post-hit rider: fire damage LEAPS from the primary
//     target to a SECOND creature within 5 ft of the primary.
//     The splash damage = spellcasting_mod (min 1) at levels
//     1–4, scaling to 1d8+mod at 5+, 2d8+mod at 11+, 3d8+mod
//     at 17+. The splash target is AUTO-SELECTED as the
//     nearest enemy within 5 ft of the primary (other than
//     the caster and the primary itself). If no secondary
//     target is in range, only the primary takes on-hit
//     damage (the splash is wasted).
//
// Splash damage mechanics:
//   - Damage type = fire (resistances apply via applyDamageWithTempHP)
//   - Splash target takes the fire damage with NO save and NO
//     attack roll (TCE p.107: "The second creature takes fire
//     damage equal to your spellcasting ability modifier" — no
//     save, no attack).
//   - The splash target is NOT the primary target (TCE p.107:
//     "a different creature of your choice").
//   - The splash target must be within 5 ft of the PRIMARY
//     (not the caster) — this is checked with euclideanDistFt.
//   - Caster is excluded from being a splash target.
//
// The on-hit damage (1d8 → 2d8 → 3d8 at 5/11/17) and the splash
// damage (mod → 1d8+mod → 2d8+mod → 3d8+mod at 1/5/11/17) are
// exposed in metadata for the AI/parser to use when building
// the Action.
//
// Registered in CANTRIP_EFFECTS (post-hit dispatcher).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { euclideanDistFt } from '../engine/movement';

// ---- Constants ----------------------------------------------

/** Range: target must be within 5 ft of the caster (TCE p.107: "within 5 feet of you"). */
export const GREEN_FLAME_BLADE_REACH_FT = 5;

/** Splash range: secondary target must be within 5 ft of the PRIMARY target (TCE p.107). */
export const GREEN_FLAME_BLADE_SPLASH_RANGE_FT = 5;

/**
 * Default spellcasting ability modifier used by the splash damage
 * when the caster's spellcasting mod is not specified on the
 * Combatant. v1 default = 3 (a typical level-1 caster with 16 in
 * their spellcasting stat). The AI/parser SHOULD set this on the
 * caster (e.g. via a `spellcastingMod` field or by reading the
 * caster's class); tests set it directly on the caster for
 * determinism.
 *
 * Per TCE p.107: "fire damage equal to your spellcasting ability
 * modifier (minimum of 1)". We clamp to 1 when computing.
 */
export const DEFAULT_SPELLCASTING_MOD = 3;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Green-Flame Blade',
  level: 0,
  school: 'evocation',
  /** Range: Self (5-ft radius — the melee target must be within 5 ft). */
  rangeFt: GREEN_FLAME_BLADE_REACH_FT,
  concentration: false,
  castingTime: 'action',
  /**
   * On-hit damage dice (v1 simplification — flat 1d8 fire at all
   * levels; canonically 0d8 at 1–4 + weapon damage, +1d8 at 5+, etc.
   * — see module header).
   */
  damageDice: '1d8',
  damageType: 'fire',
  /**
   * Scales at levels 5/11/17 (TCE p.107). Both the on-hit fire
   * AND the splash rider scale; v1 simplifies the on-hit to a
   * flat 1d8 (no weapon damage) and exposes the splash scaling
   * via scalingDiceSplash + splashDamageByLevel.
   */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  /** On-hit fire damage dice by level (v1 simplification: flat 1d8). */
  scalingDice: ['1d8', '1d8', '1d8'] as const,
  /**
   * Splash (secondary target) damage dice BY LEVEL — the splash
   * is spellcasting_mod at 1st level and scales with extra dice
   * at 5/11/17. The AI/parser reads scalingDiceSplash[0] for
   * 1st–4th level casters, [1] for 5th–10th, [2] for 11th–16th,
   * and the max (3d8+mod) at 17+. The full level→splash-dice
   * map is in `splashDamageByLevel`.
   *
   * The string format is '<dice>+mod' where 'mod' = spellcasting
   * ability modifier. The cantrip module parses this at runtime
   * when applying the splash damage.
   */
  scalingDiceSplash: ['mod', '1d8+mod', '2d8+mod', '3d8+mod'] as const,
  /** Full level → splash-dice map (mod at 1, 1d8+mod at 5, 2d8+mod at 11, 3d8+mod at 17). */
  splashDamageByLevel: { 1: 'mod', 5: '1d8+mod', 11: '2d8+mod', 17: '3d8+mod' } as const,
  /** Components: S + M (a melee weapon worth at least 1 sp). No V. */
  components: { v: false, s: true, m: true } as const,
  /**
   * Splash range in feet (TCE p.107: secondary target must be
   * within 5 ft of the PRIMARY target).
   */
  splashRangeFt: GREEN_FLAME_BLADE_SPLASH_RANGE_FT,
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

// ---- Splash damage helpers -----------------------------------

/**
 * Get the caster's spellcasting ability modifier. v1 reads from
 * `caster.spellcastingMod` (a field on Combatant, populated by the parser
 * from the caster's class); falls back to DEFAULT_SPELLCASTING_MOD if not set.
 *
 * The AI/parser should populate `spellcastingMod` from the caster's class
 * (e.g. INT for Wizard, CHA for Sorcerer/Warlock, WIS for Cleric/Druid).
 * For tests, set it directly.
 */
function getSpellcastingMod(caster: Combatant): number {
  const mod = caster.spellcastingMod;
  if (typeof mod === 'number' && !Number.isNaN(mod)) return mod;
  return DEFAULT_SPELLCASTING_MOD;
}

/**
 * Roll the splash damage expression for a given caster level
 * and spellcasting modifier.
 *
 * Splash damage by level:
 *   1–4:  mod           (min 1)
 *   5–10: 1d8 + mod     (min 1)
 *   11–16: 2d8 + mod    (min 1)
 *   17+:  3d8 + mod     (min 1)
 *
 * @param casterLevel The caster's level (1–20). v1 default = 1.
 * @param spellcastingMod The caster's spellcasting ability modifier.
 * @returns { roll: number, diceCount: number, mod: number } — the
 *          rolled total, the number of d8s rolled, and the mod
 *          applied. Total clamped to min 1 (TCE p.107).
 */
export function rollSplashDamage(
  casterLevel: number = 1,
  spellcastingMod: number = DEFAULT_SPELLCASTING_MOD,
): { roll: number; diceCount: number; mod: number } {
  let diceCount = 0;
  if (casterLevel >= 17) diceCount = 3;
  else if (casterLevel >= 11) diceCount = 2;
  else if (casterLevel >= 5) diceCount = 1;
  // else 1–4: 0 dice, just mod

  let roll = spellcastingMod;
  for (let i = 0; i < diceCount; i++) roll += rollDie(8);
  // TCE p.107: "minimum of 1" for the spellcasting_mod component.
  // Apply min-1 to the TOTAL splash damage (the mod's min-1
  // propagates to the total when there are no dice).
  if (roll < 1) roll = 1;

  return { roll, diceCount, mod: spellcastingMod };
}

/**
 * Find the nearest enemy within GREEN_FLAME_BLADE_SPLASH_RANGE_FT
 * of the primary target (excluding the caster and the primary
 * target itself). Used to auto-select the splash target.
 *
 * Ties are broken by insertion order (first found wins) for
 * determinism.
 *
 * @returns The chosen splash target, or null if no enemy is in range.
 */
export function findSplashTarget(
  caster: Combatant,
  primaryTarget: Combatant,
  state: EngineState,
): Combatant | null {
  const bf = state.battlefield;
  let best: Combatant | null = null;
  let bestDist = Infinity;
  for (const [, c] of bf.combatants) {
    if (c.id === caster.id) continue;
    if (c.id === primaryTarget.id) continue;
    if (c.isDead || c.isUnconscious) continue;
    // Mirror Thunderclap/Sword Burst: splash hits ALL creatures
    // (enemies + allies), but auto-select the NEAREST ENEMY
    // (different faction from caster) for v1. The AI/planner
    // can override this by setting a custom splash target in a
    // future batch.
    if (c.faction === caster.faction) continue;
    const d = euclideanDistFt(primaryTarget.pos, c.pos);
    if (d <= GREEN_FLAME_BLADE_SPLASH_RANGE_FT && d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

// ---- applyCantripEffect --------------------------------------

/**
 * Apply Green-Flame Blade's post-hit rider after the melee spell
 * attack hits. Called from resolveAttack's attack-roll branch
 * (via cantrip_effects dispatcher) AFTER damage is dealt, ONLY
 * on a hit.
 *
 *   Rider (TCE p.107): green fire leaps from the primary target
 *     to a SECOND creature of the caster's choice within 5 ft of
 *     the primary. The second creature takes fire damage equal
 *     to the caster's spellcasting ability modifier (scales with
 *     caster level: +1d8 at 5, +2d8 at 11, +3d8 at 17).
 *
 *   Implementation:
 *     1. Auto-select the nearest enemy within 5 ft of the primary
 *        (other than the caster and the primary itself).
 *     2. If a splash target is found, roll the splash damage
 *        (rollSplashDamage) and apply it as fire damage.
 *     3. If no splash target is in range, log "no secondary target
 *        in range" — the splash is wasted, but the on-hit damage
 *        was already applied by resolveAttack.
 *
 *   Splash damage type = fire. No save, no attack roll (TCE p.107:
 *   "The second creature takes fire damage" — automatic).
 *
 *   v1 caster level = 1 (splash = spellcasting_mod, min 1). The
 *   AI/parser can override by setting a custom `casterLevel` field
 *   on the caster (future work); tests set it directly.
 *
 * @returns true if the rider was applied (splash damage may or may
 *          not have been dealt depending on whether a secondary
 *          target was in range)
 */
export function applyCantripEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  // Auto-select the splash target: nearest enemy within 5 ft of
  // the primary target (TCE p.107: "a different creature of your
  // choice that you can see within 5 feet of it").
  const splashTarget = findSplashTarget(caster, target, state);

  if (!splashTarget) {
    emit(
      state, 'action', caster.id,
      `${caster.name}'s Green-Flame Blade hits ${target.name}, but no secondary creature is within ${GREEN_FLAME_BLADE_SPLASH_RANGE_FT} ft — the green flame dissipates!`,
      target.id,
    );
    return true; // rider ran, just no target
  }

  // Roll the splash damage. v1 reads caster level from the `casterLevel`
  // field on the caster (default 1). The AI/parser should populate this
  // from the caster's character level; tests set it directly.
  const casterLevel: number = caster.casterLevel ?? 1;
  const spellcastingMod = getSpellcastingMod(caster);
  const splash = rollSplashDamage(casterLevel, spellcastingMod);

  const dealt = applyDamageWithTempHP(splashTarget, splash.roll, 'fire');
  emit(
    state, 'damage', caster.id,
    `${caster.name}'s Green-Flame Blade: green fire leaps from ${target.name} to ${splashTarget.name} — ${dealt} fire damage! (rolled ${splash.roll} = ${splash.diceCount > 0 ? splash.diceCount + 'd8 + ' : ''}${splash.mod} mod)`,
    splashTarget.id,
    dealt,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Green-Flame Blade has NO scratch
 * fields to clean up — the splash damage is INSTANT (applied
 * immediately on hit, not stored as a flag for later trigger).
 * Nothing persists across turns.
 *
 * Contrast with Booming Blade, which DOES use a scratch field
 * (`_boomingBladePendingDamageDice`) because its rider is
 * MOVEMENT-TRIGGERED (delayed). Green-Flame Blade's rider is
 * INSTANT (applied at the same time as the on-hit damage), so no
 * scratch field is needed.
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Green-Flame Blade
 * is in the registry.
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields (splash is instant).
}
