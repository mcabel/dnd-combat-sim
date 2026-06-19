// ============================================================
// Produce Flame — PHB p.269
// Level 0 conjuration cantrip
//
// Casting time: action (used both for the initial cast AND for
//   hurling the flame on a later turn)
// Range: Self (the flame appears in your hand). The THROW has a
//   range of 30 feet.
// Components: V + S (no material)
// Effect:
//   Mode 1 (CREATE): A flickering flame appears in your hand. The
//     flame remains for the duration (10 minutes) and harms
//     neither you nor your equipment. The flame sheds bright
//     light in a 10-foot radius and dim light for an additional
//     10 feet. The spell ends if you dismiss it as an action or
//     if you cast it again.
//   Mode 2 (THROW): You can also attack with the flame, although
//     doing so ends the spell. When you cast this spell, OR AS AN
//     ACTION ON A LATER TURN, you can hurl the flame at a creature
//     within 30 feet of you. Make a ranged spell attack. On a
//     hit, the target takes 1d8 fire damage.
//
// Scaling: +1d8 at 5th level (2d8), 11th (3d8), 17th (4d8).
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — THROW-only):
// ────────────────────────────────────────────────────────────
// v1 implements only Mode 2 (THROW) — the ranged spell attack
// that deals 1d8 fire damage on hit. This is the mechanically
// relevant combat mode.
//
// Mode 1 (CREATE) is a utility mode (light source, no combat
// effect on creatures). v1 SKIPS it and documents the
// simplification via the metadata flag
// `produceFlameCreateModeV1Implemented: false`. The create-light
// mode would require a persistent-light subsystem (similar to
// the Light cantrip, PHB p.255) — out of scope for this batch.
//
// Implementation pattern: MIRRORS Fire Bolt (PHB p.242) — same
// pattern: ranged spell attack, fire damage, scales at 5/11/17.
// Differences from Fire Bolt:
//   - Damage dice: 1d8 (vs Fire Bolt's 1d10 — Produce Flame is
//     weaker because it offers the utility mode)
//   - Range: 30 ft (vs Fire Bolt's 120 ft)
//   - Components: V + S (vs Fire Bolt's V + S — same)
//   - Mode 1 utility (skipped in v1 — Fire Bolt has no utility
//     mode)
//
// Routing:
//   - The AI planner emits a normal `cast` PlannedAction with
//     Produce Flame's Action and a primary target.
//   - executePlannedAction's `case 'cast':` consults the cantrip
//     registries; Produce Flame is NOT in any of them (no rider,
//     not a self-buff, not a caster-centered AoE). It falls
//     through to resolveAttack's standard attack-roll branch
//     (attackType='spell', range 30 ft, 1d8 fire).
//
//   - No post-hit rider → no CANTRIP_EFFECTS entry.
//   - No self-buff → no CANTRIP_SELF_EFFECTS entry.
//   - Not caster-centered AoE → no CANTRIP_AOE_EFFECTS entry.
//   - This module provides `metadata` only — the AI/parser uses
//     metadata to build an Action with attackType='spell',
//     hitBonus = caster's spell attack modifier, damage =
//     { count: 1, sides: 8, bonus: 0, average: 4 } (scales with
//     level — see the AI planner / parser for scaling logic).
//
// The "flammable objects ignite" clause (PHB p.269 mode 2 has no
// such clause, but the Light cantrip does) is a narrative/flavor
// rider that has no mechanical effect on creatures and is
// therefore not modeled.
// ============================================================

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Produce Flame',
  level: 0,
  school: 'conjuration',
  /**
   * Range: the THROW has a 30-ft range (PHB p.269: "hurl the
   * flame at a creature within 30 feet of you"). The spell's
   * nominal range is Self (the flame appears in your hand), but
   * for the AI/parser the relevant range for combat planning is
   * the throw range (30 ft).
   */
  rangeFt: 30,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d8',
  damageType: 'fire',
  /** Scales at levels 5/11/17 (PHB p.269). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d8', '3d8', '4d8'] as const,
  /** Components: V + S (no M). */
  components: { v: true, s: true, m: false } as const,
  /**
   * v1 simplification flag: PHB p.269 has TWO modes — Mode 1
   * (CREATE a flame that sheds light for 10 min) and Mode 2
   * (THROW the flame as a ranged spell attack for 1d8 fire).
   * v1 implements ONLY Mode 2 (THROW). Mode 1 (light source) is
   * a utility mode that requires a persistent-light subsystem
   * (similar to the Light cantrip, PHB p.255) — out of scope for
   * this batch. The create-light mode has NO combat effect on
   * creatures, so skipping it does not affect combat outcomes.
   */
  produceFlameCreateModeV1Implemented: false as const,
} as const;
