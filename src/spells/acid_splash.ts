// ============================================================
// Acid Splash — PHB p.211
// Level 0 conjuration cantrip
//
// Casting time: action
// Range: 60 ft
// Effect: You hurl a bubble of acid. Choose one creature you can
//   see within range, OR choose two creatures you can see within
//   range that are within 5 feet of each other. A target must
//   succeed on a Dexterity saving throw or take 1d6 acid damage.
//
// Scaling: +1d6 at 5th level (2d6), 11th (3d6), 17th (4d6).
//
// Implementation:
//   - Save-based cantrip → rides resolveAttack's save branch
//     (attackType: 'save', saveDC, saveAbility: 'dex'). No new
//     routing needed.
//   - NO post-hit rider → no CANTRIP_EFFECTS entry needed.
//   - This module provides `metadata` only.
//
// ⚠️ v1 SIMPLIFICATION: PHB allows targeting EITHER 1 creature OR
//    2 creatures within 5 ft of each other. v1 implements ONLY the
//    single-target case (one DEX save, one damage roll). The 2-target
//    AoE resolution path is deferred to a future batch. Tests confirm
//    single-target behavior. The codebase already has an AoE targeting
//    helper used by Burning Hands / Thunderwave — when 2-target
//    support is added, follow that pattern (resolveAttack once per
//    target, save DC and damage type shared).
// ============================================================

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Acid Splash',
  level: 0,
  school: 'conjuration',
  rangeFt: 60,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d6',
  damageType: 'acid',
  saveAbility: 'dex' as const,
  /** Scales at levels 5/11/17 (PHB p.211). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d6', '3d6', '4d6'] as const,
  /**
   * v1 simplification: only 1 target. PHB allows up to 2 creatures
   * within 5 ft of each other; multi-target support is TODO.
   */
  maxTargets: 1 as const,
} as const;
