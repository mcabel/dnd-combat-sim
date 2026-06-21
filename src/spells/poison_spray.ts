// ============================================================
// Poison Spray — PHB p.266
// Level 0 conjuration cantrip
//
// Casting time: action
// Range: 10 ft (single target within 10 ft — NOT a cone despite
//        the "spray" name; the spell's range is "point, 10 ft")
// Effect: You extend your hand toward a creature you can see
//   within range and project a puff of noxious gas from your
//   palm. The creature must succeed on a Constitution saving
//   throw or take 1d12 poison damage.
//
// Scaling: +1d12 at 5th level (2d12), 11th (3d12), 17th (4d12).
//
// Implementation:
//   - Save-based cantrip → rides resolveAttack's save branch
//     (attackType: 'save', saveDC, saveAbility: 'con'). No new
//     routing needed.
//   - NO post-hit rider → no CANTRIP_EFFECTS entry needed.
//   - This module provides `metadata` only.
//   - Range is 10 ft (very short for a cantrip). The AI/parser
//     must enforce this when building the Action (range: { normal: 10, long: 10 }).
//
//   NOTE on poison immunity: Constructs and undead are typically immune
//   to poison damage (MM p.6 Construct immunities, MM p.7 Undead
//   immunities). The combat engine handles this via the target's
//   `resistances` array (or a future `immunities` field) — this
//   metadata-only module does NOT enforce poison immunity at the
//   spell level. The parser should set poison immunity on constructs
//   and undead when building their Combatant objects.
// ============================================================

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Poison Spray',
  level: 0,
  school: 'conjuration',
  rangeFt: 10,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d12',
  damageType: 'poison',
  saveAbility: 'con' as const,
  /** Scales at levels 5/11/17 (PHB p.266). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d12', '3d12', '4d12'] as const,
} as const;
