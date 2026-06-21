// ============================================================
// Cure Wounds — PHB p.230
//
// 1st-level evocation, action, NOT concentration
// Range: Touch (5 ft)   Components: V, S
// Effect: A creature you touch regains 1d8 + spellcasting
//         ability modifier hit points.
//         This spell has no effect on undead or constructs.
//
// Upcast: +1d8 per slot level above 1st.
//         v1 models lv1 cast only (slotLevel parameter reserved).
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
  name: 'Cure Wounds',
  level: 1,
  school: 'evocation',
  rangeFt: 5,             // Touch
  healDie: 8,             // 1d8
  castingAbility: 'wis',  // Wis-based for Cleric/Druid/Paladin/Ranger/Bard
  concentration: false,
  castingTime: 'action',
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
 * Returns the best heal target within touch range (5 ft), or null if
 * Cure Wounds should not be cast this turn.
 *
 * Preconditions:
 *   1. Caster has 'Cure Wounds' in their actions.
 *   2. Caster has at least one 1st-level spell slot.
 *   3. A valid target exists within 5 ft (see priority below).
 *
 * Target priority (PHB p.230 — must be within touch range):
 *   1. Downed (unconscious, !isDead) ally within range — revival is urgent.
 *   2. Self, if below 25% max HP.
 *   3. Any ally below 25% max HP within range.
 *
 * No effect on undead or constructs (PHB p.230).
 * The engine does not model constructs; undead are excluded via isUndead flag.
 */
export function shouldCast(
  caster: Combatant,
  bf: Battlefield,
): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Cure Wounds')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const inRange    = (c: Combatant) => chebyshev3D(caster.pos, c.pos) * 5 <= metadata.rangeFt;
  const validTarget = (c: Combatant) => !c.isUndead; // PHB p.230: no effect on undead

  // 1. Revive a downed ally within touch range
  for (const c of bf.combatants.values()) {
    if (
      c.faction === caster.faction &&
      c.isUnconscious && !c.isDead &&
      inRange(c) && validTarget(c)
    ) {
      return c;
    }
  }

  // 2. Self-heal if critical (self is always in touch range)
  if (caster.currentHP < caster.maxHP * 0.25 && validTarget(caster)) {
    return caster;
  }

  // 3. Any ally below 25% HP within touch range
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
 * Cast Cure Wounds on target.
 *   1. Guard: target must not be dead or undead (PHB p.230).
 *   2. Consume a 1st-level spell slot.
 *   3. Roll 1d8 + WIS modifier (min 1) healing.
 *   4. Apply heal via applyHeal — automatically clears 'unconscious'
 *      condition if target was at 0 HP and healed > 0 (PHB p.197).
 *   5. Log: spell cast, condition_remove (if revived), heal amount.
 *
 * @param caster     The casting Combatant (Cleric / Druid / Paladin / Ranger / Bard)
 * @param target     Ally (or self) receiving the heal
 * @param state      Current EngineState (for logging + battlefield access)
 * @param _slotLevel Reserved for upcast support (not yet modelled); defaults to 1.
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
  _slotLevel = 1,
): void {
  // Guard: dead creatures cannot be healed
  if (target.isDead) return;
  // Guard: no effect on undead (PHB p.230)
  if (target.isUndead) {
    emit(
      state, 'action', caster.id,
      `${caster.name} casts Cure Wounds on ${target.name} — no effect (undead)!`,
      target.id,
    );
    return;
  }

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Cure Wounds on ${target.name}!`,
    target.id,
  );

  // Roll 1d8 + WIS modifier; minimum 1 HP restored
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
    `Cure Wounds: ${healed} HP restored to ${target.name} (1d8[${roll}]+${wisMod}=${amount})`,
    target.id, healed,
  );
}
