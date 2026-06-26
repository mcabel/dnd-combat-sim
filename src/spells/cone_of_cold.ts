// ============================================================
// Cone of Cold — PHB p.229
//
// 5th-level evocation, action, range Self (60-ft cone),
// NO concentration.
// Components: V, S, M (a small crystal or glass cone).
//
// Effect: A blast of cold air erupts from your hands. Each creature
//         in a 60-foot cone must make a Constitution saving throw.
//         A creature takes 8d8 cold damage on a failed save, or half
//         as much on a successful one.
//
//         A creature killed by this spell becomes a frozen statue
//         until it thaws.
//
// Upcast: +1d8 cold per slot level above 5th (not modelled in v1).
//
// v1 simplifications:
//   - Cone geometry (PHB p.204 / SAC v2.7): half-angle = arctan(0.5)
//     ≈ 26.57°, length 60 ft. Implemented via the existing
//     `inConeFt()` helper in movement.ts (same one Burning Hands uses).
//   - "Frozen statue" on-kill cosmetic (PHB p.229): NOT modelled —
//     v1 has no death-state cosmetic subsystem. Documented via the
//     metadata flag `coneOfColdFrozenStatueV1Implemented: false`.
//   - Object freezing (PHB flavour): not modelled.
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 8d8
//     cold. Forward-compat TODO via `coneOfColdUpcastV1Implemented: false`.
//   - NOT a concentration spell (PHB p.229: instantaneous).
//
// Migration note (Session 21): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect).
// Session 21 migrated it to a bespoke implementation with REAL CON
// save + 8d8 cold damage via the existing `inConeFt` helper. Removed
// from `_generic_registry.ts`; routed via `case 'coneOfCold':` in
// combat.ts and a planner branch in planner.ts. Mirrors the Burning
// Hands bespoke pattern (Session 17) but with a 60-ft cone (vs 15-ft),
// 8d8 cold (vs 3d6 fire), CON save (vs DEX), L5 slot (vs L1).
//
// Spell module pattern (cone AoE save — mirrors burning_hands.ts but
// with a 60-ft cone instead of 15-ft, 8d8 cold instead of 3d6 fire,
// CON save instead of DEX, L5 slot instead of L1):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state, aimAt?) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP, elementalAffinityBonus } from '../engine/utils';
import { inConeFt, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { filterGoIProtectedTargets } from '../engine/spell_effects';

// ---- Constants ----------------------------------------------

/** D&D 5e SAC cone half-angle in degrees (arctan(0.5) ≈ 26.57°). */
export const CONE_HALF_ANGLE_DEG = 26.57;

/** Range of Cone of Cold cone in feet. */
export const CONE_RANGE_FT = 60;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Cone of Cold',
  level: 5,
  school: 'evocation',
  rangeFt: CONE_RANGE_FT,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  dieCount: 8,
  dieSides: 8,
  damageType: 'cold' as const,
  coneOfColdFrozenStatueV1Implemented: false,                     // on-kill cosmetic NOT modelled
  coneOfColdUpcastV1Implemented: false,                            // +1d8/slot-level NOT modelled
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

// ---- Dice helper --------------------------------------------

/** Roll `metadata.dieCount`d`metadata.dieSides` and return the total. */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the list of enemies that would be caught in a Cone of Cold
 * cone aimed at the highest-threat enemy within 60 ft of the caster,
 * or null when the spell should not be cast.
 *
 * Target selection:
 *   1. Find the highest-threat (maxHP) living enemy within 60 ft of
 *      the caster — this is the cone's aim point.
 *   2. Collect ALL living enemies inside the cone (using inConeFt).
 *
 * Preconditions:
 *   - Caster has 'Cone of Cold' in their actions
 *   - Caster has at least one 5th-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Cone of Cold is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Cone of Cold')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  // Find highest-threat enemy within 60 ft of the caster (cone aim point).
  let aimAt: Combatant | null = null;
  let aimThreat = -1;
  let aimDist = Infinity;
  for (const e of enemies) {
    const dx = e.pos.x - caster.pos.x;
    const dy = e.pos.y - caster.pos.y;
    const distFt = Math.sqrt(dx * dx + dy * dy) * 5;
    if (distFt > CONE_RANGE_FT) continue;
    // Threat proxy: maxHP. Tie-break: closest to caster.
    if (e.maxHP > aimThreat ||
        (e.maxHP === aimThreat && distFt < aimDist)) {
      aimAt = e;
      aimThreat = e.maxHP;
      aimDist = distFt;
    }
  }

  if (!aimAt) return null;

  // Collect all enemies in cone aimed at aimAt
  const targets: Combatant[] = [];
  for (const e of enemies) {
    if (inConeFt(caster.pos, aimAt.pos, e.pos, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT)) {
      targets.push(e);
    }
  }

  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Cone of Cold:
 *  1. Consume a 5th-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Determine cone direction (toward `aimAt`, or first target if omitted).
 *  3. Filter `targets` to only those within the cone.
 *  4. For each target in cone: CON save vs saveDC.
 *       Fail  → 8d8 cold damage
 *       Success → half (rounded down)
 *  5. Log every event.
 *
 * @param caster  The casting Combatant (Sorcerer / Wizard / Draconic
 *                Bloodline cold-lineage, etc.)
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
  const action = caster.actions.find(a => a.name === 'Cone of Cold');
  const saveDC = action?.saveDC ?? 17;

  // Determine cone aim direction
  const aimTarget = aimAt ?? targets[0];

  // Re-filter to cone in case caller passed a broader list
  const inCone = targets.filter(t =>
    !t.isDead && !t.isUnconscious &&
    inConeFt(caster.pos, aimTarget.pos, t.pos, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT),
  );

  const slotLevel = consumeSpellSlot(caster, 5) ?? 5;

  // Session 79: exclude targets protected by Globe of Invulnerability from
  // this AoE. PHB p.245: "the spell has no effect on them." The spell still
  // fires (slot already consumed above); protected targets are simply
  // skipped in the damage loop.
  const effectiveTargets = filterGoIProtectedTargets(inCone, slotLevel, caster.id, state.battlefield);
  const excludedCount = inCone.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Cone of Cold (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} in cone${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
  );

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'con', saveDC);
    // Session 48 Task #29-follow-up-5c: Elemental Affinity (Draconic Sorcerer 6)
    const eaBonus = elementalAffinityBonus(caster, metadata.damageType);
    const fullDmg = rollDamage() + eaBonus;
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Cone of Cold (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Cone of Cold: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Cone of Cold — NO-OP because:
 *   - Cone of Cold is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
