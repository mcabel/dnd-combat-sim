// ============================================================
// Guardian of Faith — PHB p.246
//
// 4th-level conjuration, action, range 30 ft. NO concentration (8 hr duration).
// Components: V, S, M (a small sculpted hand of silver).
//
// Effect (canon): A Large spectral guardian appears and hovers for the
//                 duration in an unoccupied space of your choice that you
//                 can see within range. The guardian occupies that space
//                 and is indistinct except for a gleaming sword and shield
//                 emblazoned with the symbol of your deity. Any creature
//                 hostile to you that moves to a space within 10 feet of
//                 the guardian for the first time on a turn or starts its
//                 turn there must make a Dexterity saving throw. The
//                 creature takes 20d6 radiant damage on a failed save, or
//                 half as much on a successful one. The guardian vanishes
//                 when it has dealt a total of 60 damage.
//                 (Upcast: see source — not modelled in v1.)
//
// v1 simplifications:
//   - Damage budget: canon the guardian vanishes when it has dealt 60
//     total damage. v1 has no per-spell damage-budget tracker — the spell
//     is modelled as a ONE-SHOT blast of 20d6 radiant to all enemies in
//     the guardian's 10-ft zone at cast time. There is NO persistent
//     damage_zone effect (no per-turn tick) and NO budget tracking.
//     Flag `guardianOfFaithDamageBudgetV1SimplifiedToOneShot`.
//   - NO save: canon grants a DEX save for half. v1 has NO save (per
//     task spec — simplification). Flag `guardianOfFaithDexSaveV1SimplifiedToNone`.
//   - Guardian placement: canon lets the caster place the guardian in any
//     space within 30 ft. v1 simplification: the guardian is placed at the
//     location of the highest-threat enemy within 60 ft of the caster
//     (the guardian's zone is centered on that enemy, and all enemies
//     within 10 ft of it are affected). Flag `guardianOfFaithPlacementV1Simplified`.
//   - NO concentration: the spell has a canon 8-hour duration but is not
//     concentration. v1 has no duration tracker; the spell is one-shot
//     (immediate damage on cast, no persistent effect, no cleanup needed).
//   - "Vanishes when it has dealt 60 damage" rider NOT modelled (no budget
//     tracking; v1 always rolls 20d6 on cast).
//
// Spell module pattern (Session 31 architecture — multi-target one-shot blast):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup(_c) — no-op (no persistent effect in v1)
// ============================================================

import { Combatant, Battlefield, DamageType, Vec3 } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { filterGoIProtectedTargets } from '../engine/spell_effects';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Guardian of Faith',
  level: 4,
  school: 'conjuration',
  rangeFt: 60,          // caster-to-center range (canon: 30 ft guardian placement)
  aoeSizeFt: 10,        // 10-ft radius around the guardian (canon)
  dieCount: 20,
  dieSides: 6,
  damageType: 'radiant' as const as DamageType,
  concentration: false,
  castingTime: 'action',
  guardianOfFaithDamageBudgetV1SimplifiedToOneShot: true,    // canon: 60-damage budget + persistent tick; v1: one-shot 20d6
  guardianOfFaithDexSaveV1SimplifiedToNone: true,            // canon: DEX save for half; v1: no save
  guardianOfFaithPlacementV1Simplified: true,                // canon: place in any space within 30 ft; v1: center on highest-threat enemy within 60 ft
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
 * Roll `metadata.dieCount`d`metadata.dieSides` (20d6) and return the total.
 */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns candidate targets for Guardian of Faith (all living enemies
 * within 10 ft of the highest-threat enemy within 60 ft of the caster),
 * or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Find the highest-threat (maxHP) living enemy within 60 ft of the
 *      caster — this enemy is the GUARDIAN's placement point.
 *   2. Collect all living enemies within 10 ft of that placement point.
 *   3. Return those as targets.
 *
 * Preconditions:
 *   - Caster has 'Guardian of Faith' in their actions
 *   - Caster has at least one 4th-level (or higher) slot available
 *   - At least 1 valid enemy target exists within 60 ft of the caster
 *
 * Note: Guardian of Faith is NOT a concentration spell, so the
 * concentration.active gate is NOT applied. (The spell has a canon 8-hour
 * duration; v1 treats it as one-shot — no duration tracking.)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Guardian of Faith')) return null;
  if (!hasSpellSlot(caster, 4)) return null;

  // Step 1: find the placement-point enemy (highest maxHP within 60 ft).
  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > metadata.rangeFt) continue;

    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  const center: Vec3 = candidates[0].c.pos;

  // Step 2: collect all living enemies within 10 ft of the placement point.
  const targets: Combatant[] = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFromCenter = chebyshev3D(center, c.pos) * 5;
    if (distFromCenter > metadata.aoeSizeFt) continue;

    targets.push(c);
  }

  if (targets.length === 0) return null;
  return targets;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Guardian of Faith:
 *  1. Consume a 4th-level spell slot.
 *  2. (NO concentration — Guardian of Faith is not concentration.)
 *  3. For each target (enemy within 10 ft of the placement point):
 *     (a) Roll 20d6 radiant, apply immediately (one-shot blast — no save,
 *         no damage_zone effect, no budget tracking).
 *
 * v1 simplification: this is a ONE-SHOT blast. No persistent effect, no
 * damage_zone tick, no concentration. The cleanup is a no-op.
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 4);
  const slotLevel = 4;

  // Guardian of Faith is NOT concentration — no startConcentration call.

  // Session 78 (GoI AoE exclusion follow-up): exclude targets protected by
  // Globe of Invulnerability from this AoE. PHB p.245: "the spell has no
  // effect on them." The spell still fires (slot already consumed above);
  // protected targets are simply skipped in the damage loop.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id, state.battlefield);
  const excludedCount = targets.length - effectiveTargets.length;

  const names = effectiveTargets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Guardian of Faith! A spectral guardian appears (${effectiveTargets.length} enem${effectiveTargets.length !== 1 ? 'ies' : 'y'}: ${names}) — one-shot ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, no save${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}`,
  );

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;

    // One-shot 20d6 radiant (no save, no damage_zone effect).
    const dmg = rollDamage();
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
    emit(
      state, 'damage', caster.id,
      `${target.name} takes ${dealt} ${metadata.damageType} damage from Guardian of Faith (one-shot: ${metadata.dieCount}d${metadata.dieSides}=${dmg})`,
      target.id, dealt,
    );
    emit(
      state, 'condition_add', caster.id,
      `${target.name} is struck by the Guardian of Faith's gleaming sword!`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — Guardian of Faith has no persistent effect in v1 (one-shot blast,
  // no damage_zone, no concentration). Nothing to clean up.
}
