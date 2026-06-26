// ============================================================
// Thunderclap — XGE p.168 (reprinted from EEPC p.22)
// Level 0 evocation cantrip
//
// Casting time: action
// Range: Self (5-ft radius — caster-centered AoE)
// Components: S (somatic only — no V, no M)
// Effect: You create a burst of thunderous sound that can be
//   heard up to 100 feet away. Each creature within range,
//   other than you, must make a Constitution saving throw or
//   take 1d6 thunder damage.
//
// Scaling: +1d6 at 5th level (2d6), 11th (3d6), 17th (4d6).
//
// ────────────────────────────────────────────────────────────
// Implementation (caster-centered AoE — new CANTRIP_AOE_EFFECTS):
// ────────────────────────────────────────────────────────────
// Thunderclap is the FIRST caster-centered AoE cantrip. Unlike
// single-target save cantrips (Acid Splash, Poison Spray, etc.)
// which ride resolveAttack's save branch, Thunderclap hits ALL
// creatures within 5 ft of the CASTER (not the target).
//
// Routing (per zHANDOVER-SESSION-7):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Thunderclap's Action. plan.targetId may be set to the
//     nearest enemy (for animation/log purposes) but is ignored
//     by the execute handler.
//   - executePlannedAction's `case 'cast':` consults a NEW
//     registry, CANTRIP_AOE_EFFECTS, via resolveCantripAoE()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAoE calls
//     the module's execute(caster, state) and returns true; the
//     switch breaks. Otherwise it falls through to the normal
//     single-target save path.
//   - This mirrors CANTRIP_SELF_EFFECTS / resolveCantripAction
//     for self-buffs (Blade Ward). Both registries are checked
//     before resolveAttack so AoE / self-buff cantrips bypass
//     the single-target attack-roll path entirely.
//
// execute(caster, state):
//   - Find all creatures within 5 ft of the caster (Euclidean
//     distance — PHB circle, not Chebyshev square). The caster
//     is excluded.
//   - For each: roll CON save vs action.saveDC. Fail → full
//     1d6 thunder damage; success → half (rounded down).
//   - Damage type is `thunder` (resistances apply via
//     applyDamageWithTempHP).
//   - If 0 creatures are in range, the spell is still cast
//     (wasted) — return true so the action is consumed.
//
// No post-hit rider → no CANTRIP_EFFECTS entry. Thunderclap
// lives in CANTRIP_AOE_EFFECTS, a separate registry.
// ============================================================

import { Combatant } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP, cantripTier } from '../engine/utils';
import { euclideanDistFt } from '../engine/movement';

// ---- Constants ----------------------------------------------

/** Radius of Thunderclap's AoE in feet (XGE p.168: "Each creature within range"). */
export const THUNDERCLAP_RADIUS_FT = 5;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Thunderclap',
  level: 0,
  school: 'evocation',
  /** Range: Self (5-ft radius — the AoE is centered on the caster). */
  rangeFt: THUNDERCLAP_RADIUS_FT,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d6',
  damageType: 'thunder',
  saveAbility: 'con' as const,
  /** Scales at levels 5/11/17 (XGE p.168). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d6', '3d6', '4d6'] as const,
  /** Components: S only (no V, no M). */
  components: { v: false, s: true, m: false } as const,
  /**
   * Caster-centered AoE flag. The AI/planner reads this to know
   * that Thunderclap is an AoE cantrip (not single-target) and
   * should be planned when ≥1 enemy is within THUNDERCLAP_RADIUS_FT
   * of the caster.
   */
  isCasterCenteredAoE: true as const,
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
 * Execute Thunderclap:
 *  1. Find all creatures within THUNDERCLAP_RADIUS_FT of the caster
 *     (Euclidean distance — PHB circle). The caster is excluded.
 *  2. For each creature in range: CON save vs saveDC.
 *       Fail     → full Nd6 thunder damage
 *       Success  → half (rounded down)
 *  3. Log every event.
 *
 * The saveDC is read from the Thunderclap Action on the caster's
 * action list (set by the parser/AI). Falls back to 13 if missing.
 *
 * The damage dice COUNT scales with caster level (1d6 → 2d6 → 3d6
 * → 4d6 at 5/11/17). v1 uses the base 1d6; multi-die scaling is
 * handled by the AI/parser setting action.damage.count when it
 * builds the Action from metadata + caster level.
 *
 * @param caster  The casting Combatant (Sorcerer/Wizard/Fighter/etc.)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  const bf = state.battlefield;
  const action = caster.actions.find(a => a.name === 'Thunderclap');
  const saveDC = action?.saveDC ?? 13;
  // ── RFC-UPCASTING Phase 6: Cantrip damage scaling (PHB p.201) ──
  // Use cantripTier() to determine dice count (1 + tier) instead of
  // reading from the Action (which may have base count 1 for PCs).
  const dmgCount = 1 + cantripTier(caster);
  const dmgSides = action?.damage?.sides ?? 6;

  // Find all creatures within range (excluding the caster).
  // Thunderclap affects EVERY creature in range — enemies AND allies
  // (PHB-style "each creature"). The AI planner is responsible for
  // not casting it when allies would be caught (mirror Burning Hands
  // shouldCast which excludes allies from its target list).
  const inRange: Combatant[] = [];
  for (const [, c] of bf.combatants) {
    if (c.id === caster.id) continue;
    if (c.isDead || c.isUnconscious) continue;
    if (euclideanDistFt(caster.pos, c.pos) <= THUNDERCLAP_RADIUS_FT) {
      inRange.push(c);
    }
  }

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Thunderclap (DC ${saveDC} CON) — ${inRange.length} creature${inRange.length !== 1 ? 's' : ''} within ${THUNDERCLAP_RADIUS_FT} ft!`,
  );

  for (const target of inRange) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'con', saveDC);

    // Roll Nd6 thunder damage (N = dmgCount, scales with caster level)
    let dmgRoll = 0;
    for (let i = 0; i < dmgCount; i++) dmgRoll += rollDie(dmgSides);
    const dmgFinal = save.success ? Math.floor(dmgRoll / 2) : dmgRoll;

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds' : 'fails'} CON save (rolled ${save.total} vs DC ${saveDC}) — takes ${dmgFinal} thunder damage (${save.success ? 'half of ' : ''}${dmgRoll})`,
      target.id,
    );

    const dealt = applyDamageWithTempHP(target, dmgFinal, 'thunder');
    emit(
      state, 'damage', caster.id,
      `Thunderclap: ${target.name} takes ${dealt} thunder damage`,
      target.id,
      dealt,
    );
  }
}
