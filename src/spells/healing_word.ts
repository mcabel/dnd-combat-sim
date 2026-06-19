// ============================================================
// Healing Word — PHB p.250
//
// 1st-level evocation, bonus action, NOT concentration
// Range: 60 ft   Components: V only
// Effect: One creature within range regains 1d4 + spellcasting
//         ability modifier hit points.
//         No effect on undead or constructs (PHB p.250).
//
// Caster note: Healing Word allows the caster to also use their
//   action for a cantrip or another action on the same turn
//   (bonus-action spell + action restriction per PHB p.203
//   means the action must be a cantrip if the spell is 1st level).
//   The engine does not currently model this PHB p.203 restriction.
//
// Upcast: +1d4 per slot level above 1st (not modelled — lv1 only).
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant | null   (target or null)
//   execute(caster, target, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyHeal, abilityMod } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Healing Word',
  level: 1,
  school: 'evocation',
  rangeFt: 60,
  healDie: 4,               // 1d4
  castingAbility: 'wis',    // Wis-based for Cleric/Druid/Bard
  concentration: false,
  castingTime: 'bonusAction',
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
 * Returns the best heal target within 60 ft, or null if HW should not be cast.
 *
 * Preconditions:
 *   1. Caster has 'Healing Word' in their actions.
 *   2. Caster has at least one 1st-level spell slot.
 *   3. A valid target exists (see priority below).
 *
 * Target priority (PHB p.250 — must be within 60 ft and visible):
 *   1. Downed (unconscious, !isDead) ally within range — revival is urgent.
 *   2. Self, if below 25% max HP.
 *   3. Any ally below 25% max HP within range.
 *
 * Healing Word has no effect on undead or constructs (PHB p.250).
 * The engine does not model constructs; undead are excluded via isUndead flag.
 */
export function shouldCast(
  caster: Combatant,
  bf: Battlefield,
): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Healing Word')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const inRange = (c: Combatant) => chebyshev3D(caster.pos, c.pos) * 5 <= metadata.rangeFt;
  const validTarget = (c: Combatant) => !c.isUndead; // PHB p.250: no effect on undead

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

  // 2. Self-heal if critical (self is always in range)
  if (caster.currentHP < caster.maxHP * 0.25 && validTarget(caster)) {
    return caster;
  }

  // 3. Any ally below 25% HP within range
  for (const c of bf.combatants.values()) {
    if (
      c.faction === caster.faction &&
      c.id !== caster.id &&
      !c.isDead && !c.isUnconscious &&
      c.currentHP < c.maxHP * 0.25 &&
      inRange(c) && validTarget(c)
    ) {
      return c;
    }
  }

  return null;
}

// ---- execute ------------------------------------------------

/**
 * Cast Healing Word on target.
 *   1. Guard: target must not be dead or undead (PHB p.250).
 *   2. Consume a 1st-level spell slot.
 *   3. Roll 1d4 + WIS modifier (min 1) healing.
 *   4. Apply heal via applyHeal — automatically clears 'unconscious'
 *      condition if target was at 0 HP and healed > 0 (PHB p.250 / p.197).
 *   5. Log: spell cast, condition_remove (if revived), heal amount.
 *
 * @param caster  The casting Combatant (Cleric / Druid / Bard)
 * @param target  Ally (or self) receiving the heal
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  // Guard: dead creatures cannot be healed (revive requires raise dead, not a spell heal)
  if (target.isDead) return;
  // Guard: no effect on undead (PHB p.250)
  if (target.isUndead) {
    emit(
      state, 'action', caster.id,
      `${caster.name} casts Healing Word on ${target.name} — no effect (undead)!`,
      target.id,
    );
    return;
  }

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Healing Word on ${target.name}!`,
    target.id,
  );

  // Roll 1d4 + WIS modifier; minimum 1 HP restored (always at least some healing)
  const roll   = rollDie(metadata.healDie);
  const wisMod = abilityMod(caster.wis);
  const amount = Math.max(1, roll + wisMod);

  const wasUnconscious = target.isUnconscious;
  const healed = applyHeal(target, amount);

  // Log revival event (condition cleared inside applyHeal when HP goes above 0)
  if (wasUnconscious && healed > 0) {
    emit(
      state, 'condition_remove', target.id,
      `${target.name} regains consciousness!`,
      target.id,
    );
  }

  emit(
    state, 'heal', caster.id,
    `Healing Word: ${healed} HP restored to ${target.name} (1d4[${roll}]+${wisMod}=${amount})`,
    target.id, healed,
  );
}
