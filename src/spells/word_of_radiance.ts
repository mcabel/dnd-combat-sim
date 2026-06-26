// ============================================================
// Word of Radiance — XGE p.171 (reprinted as XPHB|Word of Radiance)
// Level 0 evocation cantrip
//
// Casting time: action
// Range: Self (5-ft radius — caster-centered AoE)
// Components: V + M (a holy symbol — no S)
// Effect: You utter a divine word, and burning radiance erupts
//   from you. Each creature of your choice that you can see
//   within range must succeed on a Constitution saving throw
//   or take 1d6 radiant damage.
//
// Scaling: +1d6 at 5th level (2d6), 11th (3d6), 17th (4d6).
//
// ────────────────────────────────────────────────────────────
// Implementation (caster-centered AoE — THIRD of its kind,
// mirrors Thunderclap, XGE p.168 and Sword Burst, TCE p.115):
// ────────────────────────────────────────────────────────────
// Word of Radiance is the THIRD caster-centered AoE cantrip.
// It reuses the CANTRIP_AOE_EFFECTS registry — near-identical
// execute handler, differing only in:
//   - Save ability: CON (vs Thunderclap's CON — same;
//                       vs Sword Burst's DEX)
//   - Damage type:  radiant (vs Thunderclap's thunder;
//                              vs Sword Burst's force)
//   - Components:   V + M holy symbol (vs Thunderclap's S only;
//                                          vs Sword Burst's V only)
//   - Source:       XGE (same as Thunderclap; Sword Burst is TCE)
//
// CANON NOTE: Although zHANDOVER-SESSION-9 listed Word of Radiance
// as "DEX save", the canonical text from XGE p.171 (and the
// 5etools spell-cache JSON, which is the authoritative source per
// SPELL-CACHE.md) reads "Constitution saving throw". This module
// follows canon (CON save). Thunderclap is now Word of Radiance's
// nearest sibling: same save (CON), same range (5-ft caster-centered
// AoE), same dice (1d6), same scaling (5/11/17). They differ only
// in damage type (thunder vs radiant), components (S vs V+M), and
// school (evocation for both, but Thunderclap is "sound" themed).
//
// v1 simplification: XGE p.171 says "each creature of your choice"
// — i.e. the caster can selectively exclude allies. The engine
// does not yet support "pick N from in-range" for AoE cantrips.
// v1 follows the Thunderclap / Sword Burst convention: affect ALL
// non-caster creatures in range (enemies AND allies). The AI
// planner is responsible for not casting when allies would be
// caught. The "of your choice" clause is documented as a v1
// simplification — future batches can add an excludeAllies flag
// or a per-target selection hook.
//
// Routing (per zHANDOVER-SESSION-9):
//   - The AI planner emits a normal `cast` PlannedAction.
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_AOE_EFFECTS registry via resolveCantripAoE()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAoE
//     calls the module's execute(caster, state) and returns
//     true; the switch breaks.
//
// execute(caster, state):
//   - Find all creatures within 5 ft of the caster (Euclidean
//     distance — PHB circle, not Chebyshev square). The caster
//     is excluded.
//   - For each: roll CON save vs action.saveDC. Fail → full
//     1d6 radiant damage; success → half (rounded down).
//   - Damage type is `radiant` (resistances apply via
//     applyDamageWithTempHP). Radiant damage is rare among
//     cantrips — only Sacred Flame (PHB p.273) also deals
//     radiant. Good for damage-type coverage testing.
//   - If 0 creatures are in range, the spell is still cast
//     (wasted) — return true so the action is consumed.
//
// No post-hit rider → no CANTRIP_EFFECTS entry. Word of Radiance
// lives in CANTRIP_AOE_EFFECTS, the same registry as Thunderclap
// and Sword Burst.
// ============================================================

import { Combatant } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP, cantripTier } from '../engine/utils';
import { euclideanDistFt } from '../engine/movement';

// ---- Constants ----------------------------------------------

/** Radius of Word of Radiance's AoE in feet (XGE p.171: "within range" — range is 5 ft). */
export const WORD_OF_RADIANCE_RADIUS_FT = 5;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Word of Radiance',
  level: 0,
  school: 'evocation',
  /** Range: Self (5-ft radius — the AoE is centered on the caster). */
  rangeFt: WORD_OF_RADIANCE_RADIUS_FT,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d6',
  damageType: 'radiant',
  saveAbility: 'con' as const,
  /** Scales at levels 5/11/17 (XGE p.171). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d6', '3d6', '4d6'] as const,
  /** Components: V + M (a holy symbol — no S). */
  components: { v: true, s: false, m: true } as const,
  /**
   * Caster-centered AoE flag. The AI/planner reads this to know
   * that Word of Radiance is an AoE cantrip (not single-target)
   * and should be planned when ≥1 enemy is within
   * WORD_OF_RADIANCE_RADIUS_FT of the caster.
   */
  isCasterCenteredAoE: true as const,
  /**
   * v1 simplification flag: XGE p.171 says "each creature of your
   * choice" — the caster can selectively exclude allies. v1 does
   * NOT support ally exclusion (affects all non-caster creatures
   * in range, mirroring Thunderclap / Sword Burst). Future work.
   */
  allyExclusionV1Implemented: false as const,
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

// ---- execute ------------------------------------------------

/**
 * Execute Word of Radiance:
 *  1. Find all creatures within WORD_OF_RADIANCE_RADIUS_FT of the
 *     caster (Euclidean distance — PHB circle). The caster is
 *     excluded.
 *  2. For each creature in range: CON save vs saveDC.
 *       Fail     → full Nd6 radiant damage
 *       Success  → half (rounded down)
 *  3. Log every event.
 *
 * The saveDC is read from the Word of Radiance Action on the
 * caster's action list (set by the parser/AI). Falls back to 13
 * if missing.
 *
 * The damage dice COUNT scales with caster level (1d6 → 2d6 → 3d6
 * → 4d6 at 5/11/17). v1 uses the base 1d6; multi-die scaling is
 * handled by the AI/parser setting action.damage.count when it
 * builds the Action from metadata + caster level.
 *
 * @param caster  The casting Combatant (Cleric typically — divine cantrip)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  const bf = state.battlefield;
  const action = caster.actions.find(a => a.name === 'Word of Radiance');
  const saveDC = action?.saveDC ?? 13;
  // ── RFC-UPCASTING Phase 6: Cantrip damage scaling (PHB p.201) ──
  // Use cantripTier() to determine dice count (1 + tier) instead of
  // reading from the Action (which may have base count 1 for PCs).
  const dmgCount = 1 + cantripTier(caster);
  const dmgSides = action?.damage?.sides ?? 6;

  // Find all creatures within range (excluding the caster).
  // Word of Radiance affects EVERY creature in range — enemies AND
  // allies (v1 simplification of "each creature of your choice").
  // The AI planner is responsible for not casting it when allies
  // would be caught (mirror Thunderclap / Sword Burst).
  const inRange: Combatant[] = [];
  for (const [, c] of bf.combatants) {
    if (c.id === caster.id) continue;
    if (c.isDead || c.isUnconscious) continue;
    if (euclideanDistFt(caster.pos, c.pos) <= WORD_OF_RADIANCE_RADIUS_FT) {
      inRange.push(c);
    }
  }

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Word of Radiance (DC ${saveDC} CON) — ${inRange.length} creature${inRange.length !== 1 ? 's' : ''} within ${WORD_OF_RADIANCE_RADIUS_FT} ft!`,
  );

  for (const target of inRange) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'con', saveDC);

    // Roll Nd6 radiant damage (N = dmgCount, scales with caster level)
    let dmgRoll = 0;
    for (let i = 0; i < dmgCount; i++) dmgRoll += rollDie(dmgSides);
    const dmgFinal = save.success ? Math.floor(dmgRoll / 2) : dmgRoll;

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds' : 'fails'} CON save (rolled ${save.total} vs DC ${saveDC}) — takes ${dmgFinal} radiant damage (${save.success ? 'half of ' : ''}${dmgRoll})`,
      target.id,
    );

    const dealt = applyDamageWithTempHP(target, dmgFinal, 'radiant');
    emit(
      state, 'damage', caster.id,
      `Word of Radiance: ${target.name} takes ${dealt} radiant damage`,
      target.id,
      dealt,
    );
  }
}
