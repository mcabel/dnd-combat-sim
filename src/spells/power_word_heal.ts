// ============================================================
// Power Word Heal — XGE p.151 (also PHB p.266 in some printings)
//
// 6th-level evocation, action, NO concentration
// Range: Touch (5 ft)   Components: V, S
// Duration: Instantaneous
//
// Canon effect: A wave of healing energy washes over the creature you
//   touch. The target regains all its hit points. If the creature is
//   charmed, frightened, paralyzed, poisoned, stunned, or unconscious,
//   the spell ends that condition on the creature. The spell can also
//   be used to end the effects of the confusion spell and reduce the
//   exhaustion level of the target by 1.
//
// v1 simplifications:
//   - Full heal: set currentHP = maxHP (canon).
//   - Removes 5 conditions: blinded, deafened, frightened, paralyzed,
//     stunned. (Canon condition list is slightly different in XGE:
//     charmed, frightened, paralyzed, poisoned, stunned. v1 picks the
//     task-specified set — blinded/deafened/frightened/paralyzed/stunned
//     — for consistency with the Heal spell's blinded/deafened removal
//     plus the XGE frightened/paralyzed/stunned subset.)
//   - Charmed/poisoned/confusion/exhaustion removal NOT modelled.
//   - Upcast NOT modelled (6th-level only).
//   - Flag: powerWordHealCanonV1Implemented
//
// Spell module pattern (single-target heal, mirrors healing_word.ts):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Power Word Heal',
  level: 6,
  school: 'evocation',
  rangeFt: 5,
  removedConditions: ['blinded', 'deafened', 'frightened', 'paralyzed', 'stunned'] as Condition[],
  concentration: false,
  castingTime: 'action',
  powerWordHealCanonV1Implemented: true,
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
 * Returns the best heal target within Touch (5 ft), or null if Power Word
 * Heal should not be cast.
 *
 * Preconditions:
 *   1. Caster has 'Power Word Heal' in their actions.
 *   2. Caster has at least one 6th-level-or-higher spell slot.
 *   3. An ally within 5 ft is EITHER:
 *        a. wounded (currentHP < maxHP), OR
 *        b. affected by a removable condition
 *           (blinded/deafened/frightened/paralyzed/stunned).
 *
 * Target priority:
 *   1. Downed (unconscious, !dead) ally within 5 ft — the strongest case
 *      for full-HP revival.
 *   2. Self, if wounded OR carrying a removable condition.
 *   3. Most-wounded ally within 5 ft.
 *   4. Ally with a removable condition (regardless of HP).
 */
export function shouldCast(
  caster: Combatant,
  bf: Battlefield,
): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Power Word Heal')) return null;
  if (!hasSpellSlot(caster, 6)) return null;

  const inRange = (c: Combatant) =>
    chebyshev3D(caster.pos, c.pos) * 5 <= metadata.rangeFt;
  const hasRemovableCondition = (c: Combatant) =>
    metadata.removedConditions.some(cond => c.conditions.has(cond));

  // 1. Revive a downed ally
  for (const c of bf.combatants.values()) {
    if (
      c.faction === caster.faction &&
      c.isUnconscious && !c.isDead &&
      inRange(c)
    ) {
      return c;
    }
  }

  // 2. Self if wounded OR carrying a removable condition
  if (inRange(caster) && (caster.currentHP < caster.maxHP || hasRemovableCondition(caster))) {
    return caster;
  }

  // 3. Most-wounded ally within 5 ft
  let best: Combatant | null = null;
  let bestDeficit = 0;
  for (const c of bf.combatants.values()) {
    if (
      c.faction === caster.faction &&
      c.id !== caster.id &&
      !c.isDead &&
      c.currentHP < c.maxHP &&
      inRange(c)
    ) {
      const deficit = c.maxHP - c.currentHP;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = c;
      }
    }
  }
  if (best) return best;

  // 4. Ally with a removable condition
  for (const c of bf.combatants.values()) {
    if (
      c.faction === caster.faction &&
      c.id !== caster.id &&
      !c.isDead &&
      inRange(c) &&
      hasRemovableCondition(c)
    ) {
      return c;
    }
  }

  return null;
}

// ---- execute ------------------------------------------------

/**
 * Cast Power Word Heal on target.
 *   1. Guard: target must not be dead.
 *   2. Consume a 6th-level spell slot.
 *   3. Set target.currentHP = target.maxHP (full heal).
 *   4. Remove conditions: blinded, deafened, frightened, paralyzed,
 *      stunned (and clear 'unconscious'/'incapacitated' as side-effects
 *      of being at full HP — PHB p.197).
 *   5. Log: spell cast, condition_remove events, heal event.
 *
 * @param caster  The casting Combatant (Bard / Cleric)
 * @param target  Ally (or self) receiving the heal
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  if (target.isDead) return;

  consumeSpellSlot(caster, 6);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Power Word Heal on ${target.name}! (full HP + remove 5 conditions)`,
    target.id,
  );

  const wasUnconscious = target.isUnconscious;
  const beforeHP = target.currentHP;
  target.currentHP = target.maxHP;
  const healed = target.currentHP - beforeHP;

  if (wasUnconscious) {
    target.isUnconscious = false;
    target.conditions.delete('unconscious');
    target.conditions.delete('incapacitated');
    emit(
      state, 'condition_remove', target.id,
      `${target.name} regains consciousness!`,
      target.id,
    );
  }

  // Remove the 5 canon conditions
  for (const cond of metadata.removedConditions) {
    if (target.conditions.has(cond)) {
      target.conditions.delete(cond);
      emit(
        state, 'condition_remove', target.id,
        `${target.name} is no longer ${cond} (Power Word Heal).`,
        target.id,
      );
    }
  }

  emit(
    state, 'heal', caster.id,
    `Power Word Heal: ${healed} HP restored to ${target.name} (full HP: now ${target.currentHP}/${target.maxHP})`,
    target.id, healed,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous full heal, no persistent effect.
}
