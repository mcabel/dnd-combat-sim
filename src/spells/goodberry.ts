// ============================================================
// Goodberry — PHB p.246
//
// 1st-level transmutation, action, NO concentration
// Range: Touch (5 ft)   Components: V, S, M (a sprig of mistletoe)
// Duration: Instantaneous
//
// Canon effect: Up to ten berries appear in your hand and are infused
//   with magic. A creature can use its action to eat one berry; eating
//   a berry restores 1 hit point and provides enough nourishment for a
//   day. The berries remain potent for 24 hours; otherwise they wither.
//
// v1 SIMPLIFICATION (in-combat): rather than modelling per-berry eating
//   as a separate action (10 berries × 1 HP × 10 actions = out of
//   combat), v1 collapses the spell into a single heal: the caster eats
//   all 10 berries themselves and feeds any wounded ally within 30 ft
//   in the same action — represented as a single 10-HP flat heal to one
//   ally within 30 ft. This makes the spell castable in combat.
//
//   Flag: goodberryMultiBerryV1SimplifiedToSingleHeal
//   Deviation from canon Touch range: v1 uses 30 ft (so the spell can
//   affect any frontliner). Future work: per-berry inventory system.
//
// Upcast: +10 berries (10 HP) per slot level above 1st (not modelled in v1).
//
// Spell module pattern (mirrors healing_word.ts):
//   shouldCast(caster, bf) → Combatant | null   (target or null)
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
  name: 'Goodberry',
  level: 1,
  school: 'transmutation',
  rangeFt: 30,                                  // v1: 30 ft (canon Touch 5 ft)
  healFlat: 10,                                 // 10 berries × 1 HP each
  concentration: false,
  castingTime: 'action',
  goodberryMultiBerryV1SimplifiedToSingleHeal: true,
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
 * Returns the best heal target within 30 ft, or null if Goodberry should not
 * be cast.
 *
 * Preconditions:
 *   1. Caster has 'Goodberry' in their actions.
 *   2. Caster has at least one 1st-level spell slot.
 *   3. A wounded ally (currentHP < maxHP, !dead, !undead) is within range.
 *
 * Target priority (mirror healing_word.ts):
 *   1. Downed (unconscious, !isDead) ally within range.
 *   2. Self, if wounded (currentHP < maxHP).
 *   3. Most-wounded ally (lowest HP%) within range.
 */
export function shouldCast(
  caster: Combatant,
  bf: Battlefield,
): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Goodberry')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const inRange = (c: Combatant) =>
    chebyshev3D(caster.pos, c.pos) * 5 <= metadata.rangeFt;
  const validTarget = (c: Combatant) => !c.isUndead; // PHB p.246: no effect on undead

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

  // 2. Self-heal if wounded (self is always in range)
  if (caster.currentHP < caster.maxHP && validTarget(caster)) {
    return caster;
  }

  // 3. Most-wounded ally within range
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

  return best;
}

// ---- execute ------------------------------------------------

/**
 * Cast Goodberry on target.
 *   1. Guard: target must not be dead or undead.
 *   2. Consume a 1st-level spell slot.
 *   3. Apply 10 HP flat heal (applyHeal caps at maxHP and clears
 *      'unconscious' if target was at 0 HP and healed > 0).
 *   4. Log: spell cast, condition_remove (if revived), heal amount.
 *
 * @param caster  The casting Combatant (Druid / Ranger)
 * @param target  Ally (or self) receiving the heal
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  // Guard: dead creatures cannot be healed
  if (target.isDead) return;
  // Guard: no effect on undead (PHB p.246)
  if (target.isUndead) {
    emit(
      state, 'action', caster.id,
      `${caster.name} casts Goodberry on ${target.name} — no effect (undead)!`,
      target.id,
    );
    return;
  }

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Goodberry on ${target.name}! (10 berries → 10 HP)`,
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

  emit(
    state, 'heal', caster.id,
    `Goodberry: ${healed} HP restored to ${target.name} (flat 10 HP, capped at maxHP ${target.maxHP})`,
    target.id, healed,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous heal, no persistent effect.
}
