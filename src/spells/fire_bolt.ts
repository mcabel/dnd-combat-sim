// ============================================================
// Fire Bolt — PHB p.242
// Level 0 evocation cantrip
//
// Casting time: action
// Range: 120 ft (ranged spell attack)
// Effect: On a hit, the target takes 1d10 fire damage.
//   A flammable object hit by this spell ignites if it isn't
//   being worn or carried.
//
// Scaling: +1d10 at 5th level (2d10), 11th (3d10), 17th (4d10).
//
// Implementation:
//   - Basic attack and damage handled entirely by resolveAttack
//     in combat.ts (ranged spell attack → attackType: 'spell').
//   - NO post-hit rider → no CANTRIP_EFFECTS entry needed.
//   - This module provides `metadata` only — the AI/parser uses
//     metadata to build an Action with attackType='spell',
//     hitBonus = caster's spell attack modifier, damage =
//     { count: 1, sides: 10, bonus: 0, average: 5 } (scales with
//     level — see the AI planner / parser for scaling logic).
//   - The "flammable object ignites" clause is a narrative/flavor
//     rider that has no mechanical effect on creatures and is
//     therefore not modeled.
// ============================================================

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Fire Bolt',
  level: 0,
  school: 'evocation',
  rangeFt: 120,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d10',
  damageType: 'fire',
  /** Scales at levels 5/11/17 (PHB p.242). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d10', '3d10', '4d10'] as const,
} as const;
