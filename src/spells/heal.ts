// ============================================================
// Heal — PHB p.250
//
// 6th-level evocation, action, NO concentration
// Range: 60 ft   Components: V, S
// Duration: Instantaneous
//
// Canon effect: Choose a creature that you can see within range. A surge
//   of positive energy washes through the creature, causing it to regain
//   70 hit points. This spell also ends blindness, deafness, and any
//   diseases affecting the target. It has no effect on constructs or
//   undead.
//
// v1 simplifications:
//   - Flat 70 HP heal — no dice roll (matches canon).
//   - Removes 'blinded' and 'deafened' conditions.
//   - Disease removal NOT modelled (v1 has no 'diseased' condition).
//     Flag: healDiseaseRemovalV1NotModelled
//   - Undead/constructs exclusion: execute guards against healing undead
//     silently; shouldCast pre-filters undead.
//   - Upcast NOT modelled (PHB p.250: +70 HP per slot level above 6th).
//
// Spell module pattern (single-target heal, mirrors healing_word.ts):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applyHeal } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Heal',
  level: 6,
  school: 'evocation',
  rangeFt: 60,
  healFlat: 70,
  concentration: false,
  castingTime: 'action',
  healDiseaseRemovalV1NotModelled: true,
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
 * Returns the best heal target within 60 ft, or null if Heal should not
 * be cast.
 *
 * Preconditions:
 *   1. Caster has 'Heal' in their actions.
 *   2. Caster has at least one 6th-level-or-higher spell slot.
 *   3. A wounded ally (or an ally with a removable condition: blinded/
 *      deafened) is within range.
 *
 * Target priority:
 *   1. Downed (unconscious, !dead) ally within range.
 *   2. Self, if wounded (currentHP < maxHP).
 *   3. Most-wounded ally (largest HP deficit) within range.
 *   4. If no wounded ally, an ally with a removable condition (blinded
 *      or deafened) — Heal's condition-removal rider still applies.
 */
export function shouldCast(
  caster: Combatant,
  bf: Battlefield,
): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Heal')) return null;
  if (!hasSpellSlot(caster, 6)) return null;

  const inRange = (c: Combatant) =>
    chebyshev3D(caster.pos, c.pos) * 5 <= metadata.rangeFt;
  const validTarget = (c: Combatant) => !c.isUndead;

  // 1. Revive a downed ally
  for (const c of bf.combatants.values()) {
    if (
      c.faction === caster.faction &&
      c.isUnconscious && !c.isDead &&
      inRange(c) && validTarget(c)
    ) {
      return c;
    }
  }

  // 2. Self-heal if wounded
  if (caster.currentHP < caster.maxHP && validTarget(caster)) {
    return caster;
  }

  // 3. Most-wounded ally
  let best: Combatant | null = null;
  let bestDeficit = 0;
  for (const c of bf.combatants.values()) {
    if (
      c.faction === caster.faction &&
      c.id !== caster.id &&
      !c.isDead && !c.isUnconscious &&
      c.currentHP < c.maxHP &&
      inRange(c) && validTarget(c)
    ) {
      const deficit = c.maxHP - c.currentHP;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = c;
      }
    }
  }
  if (best) return best;

  // 4. Ally with a removable condition (blinded or deafened)
  for (const c of bf.combatants.values()) {
    if (
      c.faction === caster.faction &&
      !c.isDead &&
      (c.conditions.has('blinded') || c.conditions.has('deafened')) &&
      inRange(c) && validTarget(c)
    ) {
      return c;
    }
  }

  return null;
}

// ---- execute ------------------------------------------------

/**
 * Cast Heal on target.
 *   1. Guard: target must not be dead or undead.
 *   2. Consume a 6th-level spell slot.
 *   3. Apply 70 HP flat heal (applyHeal caps at maxHP and clears
 *      'unconscious' if target was at 0 HP and healed > 0).
 *   4. Remove 'blinded' and 'deafened' conditions (PHB p.250).
 *   5. Log: spell cast, condition_remove events, heal event.
 *
 * @param caster  The casting Combatant (Cleric / Druid)
 * @param target  Ally (or self) receiving the heal
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  if (target.isDead) return;
  if (target.isUndead) {
    emit(
      state, 'action', caster.id,
      `${caster.name} casts Heal on ${target.name} — no effect (undead)!`,
      target.id,
    );
    return;
  }

  consumeSpellSlot(caster, 6);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Heal on ${target.name}! (70 HP + remove blinded/deafened)`,
    target.id,
  );

  const wasUnconscious = target.isUnconscious;
  const healed = applyHeal(target, metadata.healFlat);

  if (wasUnconscious && healed > 0) {
    emit(
      state, 'condition_remove', target.id,
      `${target.name} regains consciousness!`,
      target.id,
    );
  }

  // Remove conditions (PHB p.250: ends blindness, deafness, diseases)
  if (target.conditions.has('blinded')) {
    target.conditions.delete('blinded');
    emit(
      state, 'condition_remove', target.id,
      `${target.name} is no longer blinded (Heal).`,
      target.id,
    );
  }
  if (target.conditions.has('deafened')) {
    target.conditions.delete('deafened');
    emit(
      state, 'condition_remove', target.id,
      `${target.name} is no longer deafened (Heal).`,
      target.id,
    );
  }

  emit(
    state, 'heal', caster.id,
    `Heal: ${healed} HP restored to ${target.name} (flat 70 HP, capped at maxHP ${target.maxHP}; now ${target.currentHP}/${target.maxHP})`,
    target.id, healed,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous heal, no persistent effect.
}
