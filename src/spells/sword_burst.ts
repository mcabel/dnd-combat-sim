// ============================================================
// Sword Burst — TCE p.115 (reprinted from SCAG p.143)
// Level 0 conjuration cantrip
//
// Casting time: action
// Range: Self (5-ft radius — caster-centered AoE)
// Components: V (verbal only — no S, no M)
// Effect: You create a momentary circle of spectral blades
//   that sweep around you. All other creatures within 5 feet
//   of you must succeed on a Dexterity saving throw or take
//   1d6 force damage.
//
// Scaling: +1d6 at 5th level (2d6), 11th (3d6), 17th (4d6).
//
// ────────────────────────────────────────────────────────────
// Implementation (caster-centered AoE — second of its kind,
// mirrors Thunderclap, XGE p.168):
// ────────────────────────────────────────────────────────────
// Sword Burst is the SECOND caster-centered AoE cantrip. It
// reuses the CANTRIP_AOE_EFFECTS registry (4th registry,
// added in Session 7 for Thunderclap) — near-identical execute
// handler, differing only in:
//   - Save ability: DEX (vs Thunderclap's CON)
//   - Damage type:  force (vs Thunderclap's thunder)
//   - Components:   V only (vs Thunderclap's S only)
//   - Source:       TCE (vs Thunderclap's XGE)
//
// Routing (per zHANDOVER-SESSION-8):
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
//   - For each: roll DEX save vs action.saveDC. Fail → full
//     1d6 force damage; success → half (rounded down).
//   - Damage type is `force` (resistances apply via
//     applyDamageWithTempHP). Force damage is RARE on cantrips
//     — only Eldritch Blast also deals force. Good for damage-
//     type coverage testing.
//   - If 0 creatures are in range, the spell is still cast
//     (wasted) — return true so the action is consumed.
//
// No post-hit rider → no CANTRIP_EFFECTS entry. Sword Burst
// lives in CANTRIP_AOE_EFFECTS, the same registry as Thunderclap.
// ============================================================

import { Combatant } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { euclideanDistFt } from '../engine/movement';

// ---- Constants ----------------------------------------------

/** Radius of Sword Burst's AoE in feet (TCE p.115: "All other creatures within 5 feet of you"). */
export const SWORD_BURST_RADIUS_FT = 5;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Sword Burst',
  level: 0,
  school: 'conjuration',
  /** Range: Self (5-ft radius — the AoE is centered on the caster). */
  rangeFt: SWORD_BURST_RADIUS_FT,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d6',
  damageType: 'force',
  saveAbility: 'dex' as const,
  /** Scales at levels 5/11/17 (TCE p.115). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d6', '3d6', '4d6'] as const,
  /** Components: V only (no S, no M). */
  components: { v: true, s: false, m: false } as const,
  /**
   * Caster-centered AoE flag. The AI/planner reads this to know
   * that Sword Burst is an AoE cantrip (not single-target) and
   * should be planned when ≥1 enemy is within SWORD_BURST_RADIUS_FT
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
 * Execute Sword Burst:
 *  1. Find all creatures within SWORD_BURST_RADIUS_FT of the caster
 *     (Euclidean distance — PHB circle). The caster is excluded.
 *  2. For each creature in range: DEX save vs saveDC.
 *       Fail     → full Nd6 force damage
 *       Success  → half (rounded down)
 *  3. Log every event.
 *
 * The saveDC is read from the Sword Burst Action on the caster's
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
  const action = caster.actions.find(a => a.name === 'Sword Burst');
  const saveDC = action?.saveDC ?? 13;
  // v1 reads damage from the Action if present, else defaults to 1d6.
  // This lets the AI/parser scale the dice count via action.damage
  // without changing the engine.
  const dmgCount = action?.damage?.count ?? 1;
  const dmgSides = action?.damage?.sides ?? 6;

  // Find all creatures within range (excluding the caster).
  // Sword Burst affects EVERY creature in range — enemies AND allies
  // (PHB-style "all other creatures"). The AI planner is responsible
  // for not casting it when allies would be caught (mirror Burning
  // Hands shouldCast which excludes allies from its target list).
  const inRange: Combatant[] = [];
  for (const [, c] of bf.combatants) {
    if (c.id === caster.id) continue;
    if (c.isDead || c.isUnconscious) continue;
    if (euclideanDistFt(caster.pos, c.pos) <= SWORD_BURST_RADIUS_FT) {
      inRange.push(c);
    }
  }

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Sword Burst (DC ${saveDC} DEX) — ${inRange.length} creature${inRange.length !== 1 ? 's' : ''} within ${SWORD_BURST_RADIUS_FT} ft!`,
  );

  for (const target of inRange) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'dex', saveDC);

    // Roll Nd6 force damage (N = dmgCount, scales with caster level)
    let dmgRoll = 0;
    for (let i = 0; i < dmgCount; i++) dmgRoll += rollDie(dmgSides);
    const dmgFinal = save.success ? Math.floor(dmgRoll / 2) : dmgRoll;

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds' : 'fails'} DEX save (rolled ${save.total} vs DC ${saveDC}) — takes ${dmgFinal} force damage (${save.success ? 'half of ' : ''}${dmgRoll})`,
      target.id,
    );

    const dealt = applyDamageWithTempHP(target, dmgFinal, 'force');
    emit(
      state, 'damage', caster.id,
      `Sword Burst: ${target.name} takes ${dealt} force damage`,
      target.id,
      dealt,
    );
  }
}
