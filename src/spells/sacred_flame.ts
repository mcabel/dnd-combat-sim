// ============================================================
// Sacred Flame — PHB p.272
// Level 0 evocation cantrip
//
// Casting time: action
// Range: 60 ft
// Effect: Flame-like radiance descends on a creature that you can
//   see within range. The target must succeed on a Dexterity
//   saving throw or take 1d8 radiant damage. The target gains no
//   benefit from cover for this saving throw.
//
// Scaling: +1d8 at 5th level (2d8), 11th (3d8), 17th (4d8).
//
// Implementation:
//   - Save-based cantrip → rides resolveAttack's save branch
//     (attackType: 'save', saveDC, saveAbility: 'dex').
//   - NO post-hit rider → no CANTRIP_EFFECTS entry needed.
//   - SPECIAL RULE (PHB p.272): "The target gains no benefit from
//     cover for this saving throw."
//       → The Action created by the AI/parser must set
//         `bypassesCover: true` (new optional field on Action in
//         core.ts). resolveAttack's save branch checks this flag
//         and skips the LOS / total-cover gating when set — Sacred
//         Flame can target a creature even behind total cover.
//       → Other save spells (default undefined/false) ARE subject
//         to total-cover blocking per PHB line-of-effect rules.
//   - This module provides `metadata` only (plus a `bypassesCover:
//     true` flag exposed for the AI/parser to copy onto the Action).
// ============================================================

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Sacred Flame',
  level: 0,
  school: 'evocation',
  rangeFt: 60,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d8',
  damageType: 'radiant',
  saveAbility: 'dex' as const,
  /** Scales at levels 5/11/17 (PHB p.272). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d8', '3d8', '4d8'] as const,
  /**
   * PHB p.272: "The target gains no benefit from cover for this
   * saving throw." The AI/parser MUST copy this flag onto the
   * Action it builds (action.bypassesCover = true). resolveAttack's
   * save branch checks action.bypassesCover and skips the LOS /
   * total-cover gating when set.
   */
  bypassesCover: true as const,
} as const;
