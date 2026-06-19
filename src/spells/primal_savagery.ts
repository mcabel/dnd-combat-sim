// ============================================================
// Primal Savagery — XGE p.163
// Level 0 transmutation cantrip
//
// Casting time: action
// Range: Self (the target is one creature within 5 ft of you —
//   i.e. reach 5 ft)
// Components: S only (no V, no M — XGE p.163)
// Duration: Instant
// Effect: You channel primal magic to cause your teeth or
//   fingernails to sharpen, ready to deliver a corrosive attack.
//   Make a melee spell attack against one creature within 5 feet
//   of you. On a hit, the target takes 1d10 acid damage. After
//   you make the attack, your teeth or fingernails return to
//   normal.
//
// Scaling: +1d10 at 5th level (2d10), 11th (3d10), 17th (4d10).
//
// ────────────────────────────────────────────────────────────
// Implementation (metadata-only — vanilla melee spell attack):
// ────────────────────────────────────────────────────────────
// Primal Savagery is a vanilla MELEE SPELL ATTACK — the same
// pattern as Fire Bolt (PHB p.242) but melee instead of ranged,
// acid instead of fire, 1d10 (same dice), 5-ft reach (vs 120-ft
// range). The "teeth/fingernails sharpen" flavor has no
// mechanical effect beyond the attack/damage — no rider.
//
// v1 simplification: implement as a metadata-only module (mirror
// Fire Bolt / Produce Flame / Create Bonfire v1). The AI/parser
// builds an Action from metadata with attackType='spell' (spell
// attack — both ranged and melee spell attacks use attackType
// 'spell' in this engine; the reach/range fields distinguish
// them: reach=5 for melee spell attack, range.normal=120 for
// ranged spell attack), damage 1d10 acid, scales at 5/11/17.
//
// NO CANTRIP_EFFECTS entry (no post-hit rider).
// NO CANTRIP_SELF_EFFECTS entry (not a self-buff).
// NO CANTRIP_AOE_EFFECTS entry (not a caster-centered AoE).
//
// Acid damage is RARE on cantrips — only Acid Splash (PHB p.211)
// also deals acid. Primal Savagery is the second acid cantrip,
// good for damage-type coverage testing.
//
// Routing (per zHANDOVER-SESSION-10):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Primal Savagery's Action and a primary target.
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS / CANTRIP_AOE_EFFECTS registries (no
//     match) and falls through to resolveAttack.
//   - resolveAttack's standard attack-roll branch rolls the
//     attack, applies 1d10 acid damage on hit (crit doubles
//     the dice — PHB p.196).
// ============================================================

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Primal Savagery',
  level: 0,
  school: 'transmutation',
  /**
   * Range: Self (XGE p.163: "range: self"). The target is one
   * creature within 5 ft of the caster (a melee spell attack
   * with 5-ft reach). rangeFt is the spell's listed range (Self
   * = 0 ft); the attack's reach is set on the Action (reach=5).
   */
  rangeFt: 0,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d10',
  damageType: 'acid',
  /** Scales at levels 5/11/17 (XGE p.163). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d10', '3d10', '4d10'] as const,
  /**
   * Components: S only (XGE p.163: "Components: S"). No verbal,
   * no material. This is one of the few cantrips with somatic-
   * only components (most have V+S or V+S+M).
   */
  components: { v: false, s: true, m: false } as const,
  /**
   * Reach in feet (5 ft — melee spell attack). The AI/parser
   * builds an Action with reach=5 from this metadata to
   * distinguish Primal Savagery (melee spell attack, reach 5)
   * from Fire Bolt (ranged spell attack, range 120).
   */
  reachFt: 5,
} as const;
