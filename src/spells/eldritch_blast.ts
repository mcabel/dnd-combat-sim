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
// v1 IMPLEMENTATION (Session 80):
// ────────────────────────────────────────────────────────────
// Multi-beam is now implemented using the existing attackCount
// pattern (same as Extra Attack / Thirsting Blade). The AI
// planner computes the beam count from cantripTier() + 1 and
// sets plan.action.attackCount. The engine's existing attack
// loop then calls resolveAttack once per beam, with each beam
// being an independent attack roll.
//
// Key design decisions:
//   - noCantripScaling: true on the Action prevents the engine
//     from scaling the die (1d10 → 2d10 etc). Each beam stays
//     1d10 regardless of caster level — the scaling is in beam
//     COUNT, not die size.
//   - v1 simplification: all beams START at the same enemy (focus-fire).
//     Session 85: when a beam kills the primary target, remaining beams
//     re-target to the next-best living enemy in range (PHB p.237: "direct
//     the beams at the same target or at different ones"). A deliberate
//     "spread damage" heuristic (firing at different living targets from
//     the start) is NOT implemented — focus-fire-then-switch is the v1
//     strategy.
//   - Grasp of Hadar: now enforces once-per-turn (PHB p.111:
//     "once on each of your turns"). A flag on the combatant
//     tracks usage; reset at start of each turn.
//   - Repelling Blast / Lance of Lethargy: fire on every beam
//     hit (no "once per turn" restriction in the spell text).
//   - Agonizing Blast: +CHA mod per beam (no restriction).
//
// The engine routing for each beam is identical to a single
// Eldritch Blast: a ranged spell attack (attackType='spell')
// with 1d10 force damage, resolved by resolveAttack. No
// post-hit rider → no CANTRIP_EFFECTS entry needed.
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
  multiBeamV1Implemented: true as const,   // Session 80: multi-beam via attackCount pattern
  /**
   * Session 85: Multi-target per beam is NOW supported. PHB p.237: "You can
   * direct the beams at the same target or at different ones." When an EB
   * beam kills the primary target, remaining beams re-target to the next-best
   * living enemy in range (combat.ts `pickNextEldritchBlastTarget`). This
   * prevents wasted beams and approximates the RAW multi-target choice. The
   * AI still focus-fires on one primary target (planner picks one); the engine
   * handles re-targeting on kill. A deliberate "spread damage" AI heuristic
   * (firing beams at different living targets from the start) is NOT
   * implemented — focus-fire-then-switch is the v1 strategy.
   */
  multiTargetPerBeamV1Implemented: true as const,  // Session 85: re-target on kill
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
   *   - Thirsting Blade (PHB p.111): extra attack with Pact Weapon
   * Session 42 Task #18: Thirsting Blade is NOW FULLY IMPLEMENTED
   * (was V1Registered/metadata-only in Session 41). The planner sets
   * plan.attackCount = 2 for melee attacks when the Warlock has
   * Thirsting Blade + Pact of the Blade; the engine loops resolveAttack.
   */
  eldritchSpearV1Implemented: true as const,
  eldritchMindV1Implemented: true as const,
  thirstingBladeV1Implemented: true as const,  // Session 42 Task #18: fully wired (was V1Registered)
} as const;
