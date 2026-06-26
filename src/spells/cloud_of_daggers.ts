// ============================================================
// Cloud of Daggers — PHB p.222
//
// 2nd-level conjuration, action, range 60 ft, concentration (1 min).
// Components: V, S, M (a sliver of glass).
//
// Effect: You fill the air with spinning daggers in a cube 5 feet on
//         each side, centered on a point you choose within range. A
//         creature takes 4d4 slashing damage when it enters the spell's
//         area for the first time on a turn or starts its turn there.
//
// Upcast: +2d4 slashing per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - AoE shape: canon 5-ft cube centered on a point within 60 ft.
//     v1 simplification: targets a SINGLE enemy within 60 ft. The 5-ft
//     cube is canonically a single grid square, so in 5e it typically
//     hits ONE creature anyway (multiple creatures in the same square
//     is rare). v1 picks the highest-threat enemy as the cube's center
//     and applies damage to that enemy only. This is a v1 simplification
//     — the spell's multi-creature potential (e.g. hitting a swarm) is
//     NOT modelled. Documented via the metadata flag
//     `cloudOfDaggersMultiTargetV1Implemented: false`.
//   - Persistent damage: PHB p.222 says "A creature takes 4d4 slashing
//     damage when it enters the spell's area for the first time on a
//     turn OR starts its turn there." v1 implements BOTH triggers:
//       1. On cast: 4d4 slashing to the target (the "enters the area
//          for the first time on a turn" trigger — the target is in
//          the area when the spell is cast).
//       2. At the start of each of the target's turns: 4d4 slashing
//          (the "starts its turn there" trigger) via the new
//          `damage_zone` effect type + a start-of-turn hook in
//          combat.ts's runCombat loop (right after resetBudget).
//     v1 simplification: v1 does NOT track whether the target moves
//     out of the zone. The persistent damage applies regardless of
//     the target's position on its turn (canon: only if it "starts
//     its turn there"). Forward-compat TODO via the metadata flag
//     `cloudOfDaggersMovementTrackingV1Implemented: false`.
//   - Duration: canon 1 min concentration → v1: concentration is
//     started via startConcentration(), but the engine does NOT yet
//     enforce concentration checks on damage taken (forward-compat
//     TODO; see TG-002 in TEAMGOALS.md). The damage_zone effect
//     persists until removeEffectsFromCaster() is called.
//   - Upcast: +2d4 per slot level above 2nd NOT modelled — v1 always
//     rolls 4d4 slashing. Forward-compat TODO via
//     `cloudOfDaggersUpcastV1Implemented: false`.
//   - No save (PHB p.222: no saving throw listed). The target takes
//     the damage unconditionally.
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   metadata → spell stats
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster, isProtectedByGoI } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Cloud of Daggers',
  level: 2,
  school: 'conjuration',
  rangeFt: 60,
  aoeSizeFt: 5,       // 5-ft cube (canon)
  dieCount: 4,
  dieSides: 4,
  damageType: 'slashing' as const,
  concentration: true,
  castingTime: 'action',
  // v1 simplification flags:
  cloudOfDaggersMultiTargetV1Implemented: false,           // single-target only
  cloudOfDaggersMovementTrackingV1Implemented: false,      // persistent dmg regardless of position
  cloudOfDaggersUpcastV1Implemented: false,                // +2d4/slot-level not modelled
  cloudOfDaggersConcentrationEnforcementV1Implemented: true,  // TG-002 DONE (Session 34)
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

/**
 * Roll `metadata.dieCount`d`metadata.dieSides` and return the total.
 * Used for both the on-cast damage and the persistent start-of-turn damage.
 * Exported so combat.ts's start-of-turn damage tick can call the same
 * roller (ensuring consistent dice mechanics).
 */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Cloud of Daggers (a living enemy
 * within 60 ft, not already in a Cloud of Daggers zone from this caster),
 * or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 60 ft — the persistent
 *      damage is most valuable against a high-HP target that will survive
 *      multiple rounds of 4d4 slashing.
 *   2. Tie-break: closest enemy.
 *
 * Preconditions:
 *   - Caster has 'Cloud of Daggers' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Cloud of Daggers IS concentration — it cannot be cast while
 * concentrating on another spell. The planner gates on concentration.
 *
 * Note: v1 targets a SINGLE enemy (the 5-ft cube's center). Canonically
 * the cube could hit multiple creatures in the same square, but v1
 * simplifies to single-target. See metadata flag
 * `cloudOfDaggersMultiTargetV1Implemented: false`.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Cloud of Daggers')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    // Skip if already in a Cloud of Daggers zone from this caster
    // (re-cast would only refresh the duration — wasteful in v1 since
    // the persistent damage ticks every turn regardless).
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Cloud of Daggers'
    )) continue;

    // Threat proxy: maxHP (higher = more rounds of persistent damage).
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: highest threat first, then closest.
  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Cloud of Daggers:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Cloud of Daggers.
 *  4. Roll 4d4 slashing and apply to the target immediately (the "enters
 *     the area for the first time on a turn" trigger — the target is in
 *     the area when the spell is cast).
 *  5. Apply a `damage_zone` effect on the target. The effect deals 4d4
 *     slashing at the start of each of the target's turns (the "starts
 *     its turn there" trigger) via the start-of-turn hook in combat.ts's
 *     runCombat loop. The effect has sourceIsConcentration: true (removed
 *     when the caster's concentration breaks).
 *
 * v1 simplifications: single-target only; persistent damage applies
 * regardless of target's position (no movement tracking); upcast NOT
 * modelled; concentration NOT enforced (TG-002).
 *
 * @param caster  The casting Combatant (Bard/Sorcerer/Warlock/Wizard)
 * @param target  The candidate from shouldCast (single enemy in range)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const slotLevel = consumeSpellSlot(caster, 2) ?? 2;

  // Safety: clean up any stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Cloud of Daggers');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Cloud of Daggers at ${target.name}! (${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, no save, persistent)`,
    target.id,
  );

  // Re-check liveness (stale edge case)
  if (target.isDead || target.isUnconscious) return;

  // Session 78 (GoI AoE exclusion follow-up): PHB p.245: "the spell has no
  // effect on them." The spell still fires (slot already consumed above).
  // For persistent damage zones, the damage_zone EFFECT is applied to the
  // target (so it can tick later if GoI expires), but the ON-CAST damage is
  // skipped if the target is GoI-protected. The caster's own GoI does NOT
  // block their own spell (PHB p.245: "cast from outside the barrier").
  const goiBlocked = target.id !== caster.id && isProtectedByGoI(target, slotLevel, state.battlefield);

  // 1. Immediate damage on cast (the "enters the area for the first
  //    time on a turn" trigger — the target is in the area when the
  //    spell is cast). Skipped if GoI-protected.
  if (!goiBlocked) {
    const immediateDmg = rollDamage();
    const dealtImmediate = applyDamageWithTempHP(target, immediateDmg, metadata.damageType);
    emit(
      state, 'damage', caster.id,
      `${target.name} takes ${dealtImmediate} ${metadata.damageType} damage from Cloud of Daggers (on cast: ${metadata.dieCount}d${metadata.dieSides}=${immediateDmg})`,
      target.id, dealtImmediate,
    );
  } else {
    emit(
      state, 'damage', caster.id,
      `${target.name} is protected by Globe of Invulnerability — on-cast damage negated (persistent effect still applied, will tick when GoI expires).`,
      target.id, 0,
    );
  }

  // 2. Apply damage_zone effect for persistent start-of-turn damage
  //    (the "starts its turn there" trigger). The start-of-turn damage
  //    tick is in combat.ts's runCombat loop, right after resetBudget.
  //    ALWAYS applied (even to GoI-protected targets) so the spell can start
  //    ticking if GoI expires later. sourceSlotLevel is set so the combat.ts
  //    damage_zone tick loop can re-check GoI protection on each per-turn
  //    tick (PHB p.245: the spell continues to have no effect on GoI-
  //    protected creatures for as long as GoI is active).
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Cloud of Daggers',
    effectType: 'damage_zone',
    sourceSlotLevel: slotLevel,
    payload: {
      dieCount: metadata.dieCount,
      dieSides: metadata.dieSides,
      damageType: metadata.damageType,
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is enveloped in spinning daggers! (will take ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} at the start of each of its turns)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Cloud of Daggers — called from resetBudget() at the
 * start of the caster's next turn. NO-OP in v1 because:
 *   - Cloud of Daggers is a concentration spell; the damage_zone effect
 *     is removed via removeEffectsFromCaster() when concentration breaks.
 *   - v1 does NOT enforce concentration checks (TG-002), so concentration
 *     effectively persists for the entire combat.
 *
 * Exported for symmetry with the other spell modules' cleanup pattern.
 * The start-of-turn damage tick (the "starts its turn there" trigger)
 * is handled by a separate hook in combat.ts's runCombat loop, NOT by
 * this cleanup function (cleanup runs on the CASTER's turn start; the
 * damage tick runs on the TARGET's turn start).
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
