// ============================================================
// Eldritch Blast — PHB p.237
// Level 0 evocation cantrip (Warlock signature)
//
// Casting time: action
// Range: 120 ft (ranged spell attack)
// Components: V, S
// Effect: A beam of crackling energy streaks toward a creature
//   within range. Make a ranged spell attack against the target.
//   On a hit, the target takes 1d10 force damage.
//
// Scaling (UNIQUE — multi-beam, NOT bigger dice):
//   The spell creates MORE THAN ONE BEAM at higher levels:
//     2 beams at 5th level
//     3 beams at 11th level
//     4 beams at 17th level
//   You can direct the beams at the same target or at different
//   ones. Make a separate attack roll for each beam.
//
// ────────────────────────────────────────────────────────────
// v1 SIMPLIFICATION (this module):
// ────────────────────────────────────────────────────────────
// Eldritch Blast is the FIRST cantrip whose scaling produces
// MULTIPLE separate attack rolls rather than a single larger
// damage roll. resolveAttack in combat.ts resolves ONE attack
// roll per Action; multi-beam routing requires either:
//   (a) the AI planner to emit multiple `cast` PlannedActions
//       (one per beam) — this is a Core-Engine/AI-planner task,
//       NOT a cantrip-module task; OR
//   (b) a new "multi-attack cantrip" registry that loops the
//       attack-roll + damage per beam.
// Both are out of scope for Cantrip-7 (this session). For v1
// this module provides METADATA ONLY for a SINGLE beam:
//   damageDice: '1d10'  ·  damageType: 'force'  ·  range: 120 ft
//   scales: true (flag set so the AI/UI knows the spell scales)
//   scalingLevels/scalingDice describe the per-beam damage IF
//     it scaled — but Eldritch Blast's beams stay 1d10 each at
//     all levels; the scaling is in BEAM COUNT, not die size.
//   The multi-beam behavior is documented via `scalesByBeamCount`
//     (true) and `beamCountByLevel` so the AI planner can read
//     this metadata in a future batch and emit the right number
//     of attack actions.
//
// The engine routing for a single Eldritch Blast beam is identical
// to Fire Bolt: a ranged spell attack (attackType='spell') with
// 1d10 force damage, resolved by resolveAttack. No post-hit rider
// → no CANTRIP_EFFECTS entry needed. The `force` damage type is
// new to the cantrip roster (no prior cantrip deals force damage)
// and serves as good coverage for damage-type testing.
// ============================================================

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Eldritch Blast',
  level: 0,
  school: 'evocation',
  rangeFt: 120,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d10',
  damageType: 'force',
  /**
   * Scales at levels 5/11/17 (PHB p.237).
   *
   * IMPORTANT: Eldritch Blast scales by ADDING BEAMS, not by
   * increasing the per-beam die size. Each beam is always 1d10
   * force. The scalingLevels/scalingDice arrays below describe
   * the PER-BEAM damage (constant 1d10 at all levels) — they
   * exist for metadata-shape consistency with other cantrips,
   * NOT to indicate bigger dice.
   *
   * The actual scaling (beam count: 1 → 2 → 3 → 4) is exposed
   * via `scalesByBeamCount: true` and `beamCountByLevel` so a
   * future AI-planner batch can read this and emit the right
   * number of `cast` PlannedActions (one per beam).
   */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['1d10', '1d10', '1d10'] as const, // per-beam (constant)
  /**
   * Eldritch Blast-specific scaling metadata.
   * - scalesByBeamCount: true → scaling produces MORE attack
   *   rolls, not bigger damage dice. AI planner / multi-attack
   *   routing MUST handle this; the v1 single-beam path does not.
   * - beamCountByLevel: maps character level → beam count
   *   (1 beam at 1–4, 2 at 5–10, 3 at 11–16, 4 at 17+).
   * - multiBeamV1Implemented: false → v1 emits a single beam
   *   regardless of caster level. Multi-beam routing is TODO.
   */
  scalesByBeamCount: true as const,
  beamCountByLevel: { 5: 2, 11: 3, 17: 4 } as const,
  multiBeamV1Implemented: false as const,
  /** Components: V + S (no M). */
  components: { v: true, s: true, m: false } as const,
  /**
   * Session 38: Repelling Blast invocation is NOW supported. When a
   * Warlock with 'Repelling Blast' in their `eldritchInvocations` list
   * hits with Eldritch Blast, the target is pushed 10 ft away (PHB p.111).
   * The push fires in resolveAttack after damage, before checkDeath.
   * See src/spells/_invocations.ts for the invocation registry.
   */
  repellingBlastV1Implemented: true as const,
  /**
   * Session 39: Three more EB-augmenting invocations are NOW supported:
   *   - Agonizing Blast (PHB p.110): +CHA mod to EB damage (pre-damage hook)
   *   - Grasp of Hadar (PHB p.111): pull 10 ft toward caster on EB hit
   *   - Lance of Lethargy (XGE p.157): reduce target speed 10 ft on EB hit
   * See src/spells/_invocations.ts for the invocation registry.
   */
  agonizingBlastV1Implemented: true as const,
  graspOfHadarV1Implemented: true as const,
  lanceOfLethargyV1Implemented: true as const,
  /**
   * Session 41 Task #16: Three more invocations are NOW registered:
   *   - Eldritch Spear (PHB p.111): EB range 300 ft (builder patches range)
   *   - Eldritch Mind (TCE p.71): advantage on concentration saves (utils)
   *   - Thirsting Blade (PHB p.111): extra attack with Pact Weapon (v1.5:
   *     descriptor only — engine integration is future work)
   * Eldritch Spear and Eldritch Mind are fully wired; Thirsting Blade is
   * metadata-only (no combat effect yet).
   */
  eldritchSpearV1Implemented: true as const,
  eldritchMindV1Implemented: true as const,
  thirstingBladeV1Registered: true as const,  // engine integration is future work
} as const;
