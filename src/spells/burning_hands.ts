// ============================================================
// Burning Hands — PHB p.220
//
// 1st-level evocation, NOT concentration
// Casting time: action
// Range: Self (15-ft cone)
// Effect: Each creature in the cone makes a DEX save.
//         Fail  → 3d6 fire damage
//         Success → half damage
//
// Cone geometry (SAC v2.7 / PHB p.204):
//   The cone originates at the caster's space and widens outward.
//   Width at distance d = d, giving halfAngle = arctan(0.5) ≈ 26.57°.
//   Implemented via inConeFt() in movement.ts.
//
// AI targeting:
//   shouldCast aims the cone toward the primary target (nearest enemy) and
//   collects all living enemies inside that cone. Returns targets when ≥1
//   enemy is in range. Planner enforces the ≥1 threshold (fire even for
//   single target — 3d6 avg 10.5 beats most cantrips).
//
// Simplifications:
//   - Cone direction = toward the first (nearest) returned target.
//     Multi-cluster optimisation deferred.
//   - Ally fire: excluded from shouldCast (AI never aims at allies).
//     In real play, allies in cone would also save.
//   - Object ignition (PHB flavour): not modelled.
//
// Spell module pattern:
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state, aimAt) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamage } from '../engine/utils';
import { inConeFt, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Constants ----------------------------------------------

/** D&D 5e SAC cone half-angle in degrees (arctan(0.5) ≈ 26.57°). */
export const CONE_HALF_ANGLE_DEG = 26.57;

/** Range of Burning Hands cone in feet. */
export const CONE_RANGE_FT = 15;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Burning Hands',
  level: 1,
  school: 'evocation',
  rangeFt: CONE_RANGE_FT,
  concentration: false,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  damageDice: '3d6',
  damageType: 'fire',
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

// ---- shouldCast ---------------------------------------------

/**
 * Returns the list of enemies that would be caught in a Burning Hands cone
 * aimed at the nearest enemy, or null if casting conditions are not met.
 *
 * Conditions:
 *  - Caster has 'Burning Hands' in their action list.
 *  - Caster has a 1st-level spell slot.
 *  - ≥1 living enemy is within CONE_RANGE_FT feet.
 *
 * The returned list is all enemies inside the cone aimed at the nearest
 * qualifying enemy. The planner reads this list but fires on ≥1 target.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Burning Hands')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  // Find nearest enemy within cone range
  let nearest: Combatant | null = null;
  let nearestDistFt = Infinity;
  for (const e of enemies) {
    const dx = e.pos.x - caster.pos.x;
    const dy = e.pos.y - caster.pos.y;
    const distFt = Math.sqrt(dx * dx + dy * dy) * 5;
    if (distFt <= CONE_RANGE_FT && distFt < nearestDistFt) {
      nearest = e;
      nearestDistFt = distFt;
    }
  }

  if (!nearest) return null;

  // Collect all enemies in cone aimed at nearest
  const targets: Combatant[] = [];
  for (const e of enemies) {
    if (inConeFt(caster.pos, nearest.pos, e.pos, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT)) {
      targets.push(e);
    }
  }

  return targets.length >= 1 ? targets : null;
}

// ---- execute ------------------------------------------------

/**
 * Execute Burning Hands:
 *  1. Consume a 1st-level spell slot.
 *  2. Determine cone direction (toward `aimAt`, or first target if omitted).
 *  3. Filter `targets` to only those within the cone.
 *  4. For each target in cone: DEX save vs saveDC.
 *       Fail  → 3d6 fire damage
 *       Success → half (rounded down)
 *  5. Log every event.
 *
 * @param caster  The casting Combatant (Sorcerer or Wizard)
 * @param targets Candidates from shouldCast (enemies in cone)
 * @param state   Current EngineState
 * @param aimAt   Optional explicit aim target; defaults to targets[0]
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
  aimAt?: Combatant,
): void {
  const action = caster.actions.find(a => a.name === 'Burning Hands');
  const saveDC = action?.saveDC ?? 13;

  // Determine cone aim direction
  const aimTarget = aimAt ?? targets[0];

  // Re-filter to cone in case caller passed a broader list
  const inCone = targets.filter(t =>
    !t.isDead && !t.isUnconscious &&
    inConeFt(caster.pos, aimTarget.pos, t.pos, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT),
  );

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Burning Hands (DC ${saveDC} DEX) — ${inCone.length} creature${inCone.length !== 1 ? 's' : ''} in cone!`,
  );

  for (const target of inCone) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSave(target, 'dex', saveDC);

    // Roll 3d6 fire damage
    const dmgRoll = rollDie(6) + rollDie(6) + rollDie(6);
    const dmgFinal = save.success ? Math.floor(dmgRoll / 2) : dmgRoll;

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds' : 'fails'} DEX save (rolled ${save.roll} vs DC ${saveDC}) — takes ${dmgFinal} fire damage (${save.success ? 'half of ' : ''}${dmgRoll})`,
      target.id,
      dmgFinal,
    );

    applyDamage(target, dmgFinal);

    emit(
      state, 'damage', caster.id,
      `Burning Hands: ${target.name} takes ${dmgFinal} fire damage`,
      target.id,
      dmgFinal,
    );
  }
}
