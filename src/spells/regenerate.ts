// ============================================================
// Regenerate — PHB p.271
//
// 7th-level transmutation, action (canon: 1 minute — v1: action),
//   NO concentration
// Range: Touch (5 ft)   Components: V, S, M (a monster's heart)
// Duration: 1 hour
//
// Canon effect: You touch a creature and stimulate its natural healing
//   ability. The target regains 4d8 + your spellcasting ability modifier
//   hit points. For the duration of the spell, the target regains 1 hit
//   point at the start of each of its turns (10 HP per minute). The
//   target's severed body members (fingers, legs, tails, and so on),
//   if any, are restored after 1 minute. If you cast this spell on a
//   creature that is missing body parts, the spell restores them.
//
// v1 simplifications:
//   - Casting time: PHB p.271 says "1 minute" (out-of-combat ritual
//     heal). v1 models it as an ACTION to make it castable in combat
//     — flagged via metadata flag `regenerateCastTimeV1Simplified`.
//   - Initial heal: 4d8 + spellcastingMod (WIS mod) — modelled.
//   - Per-turn 1 HP/turn rider NOT modelled (no per-turn regen hook).
//     Flag: regeneratePerTurnHealV1NotModelled
//   - Severed-limb restoration NOT modelled (no body-part subsystem).
//   - 1-hour duration NOT tracked (instantaneous in v1).
//   - Upcast NOT modelled.
//
// Spell module pattern (single-target heal, mirrors healing_word.ts):
//   shouldCast(caster, bf) → Combatant | null
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
  name: 'Regenerate',
  level: 7,
  school: 'transmutation',
  rangeFt: 5,
  healDie: 8,
  healDieCount: 4,
  castingAbility: 'wis',
  concentration: false,
  castingTime: 'action',
  regenerateCastTimeV1Simplified: true,       // canon: 1 min → v1: action
  regeneratePerTurnHealV1NotModelled: true,
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
 * Returns the best heal target within Touch (5 ft), or null if Regenerate
 * should not be cast.
 *
 * Preconditions:
 *   1. Caster has 'Regenerate' in their actions.
 *   2. Caster has at least one 7th-level-or-higher spell slot.
 *   3. A wounded ally (currentHP < maxHP, !dead, !undead) is within 5 ft.
 *
 * Target priority:
 *   1. Downed (unconscious, !dead) ally within 5 ft.
 *   2. Self, if wounded.
 *   3. Most-wounded ally within 5 ft (largest HP deficit).
 */
export function shouldCast(
  caster: Combatant,
  bf: Battlefield,
): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Regenerate')) return null;
  if (!hasSpellSlot(caster, 7)) return null;

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
  return best;
}

// ---- execute ------------------------------------------------

/**
 * Cast Regenerate on target.
 *   1. Guard: target must not be dead or undead.
 *   2. Consume a 7th-level spell slot.
 *   3. Roll 4d8 + spellcastingMod (WIS mod) healing.
 *   4. Apply heal via applyHeal (caps at maxHP, clears unconscious).
 *   5. Log: spell cast, condition_remove (if revived), heal event.
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
  if (target.isDead) return;
  if (target.isUndead) {
    emit(
      state, 'action', caster.id,
      `${caster.name} casts Regenerate on ${target.name} — no effect (undead)!`,
      target.id,
    );
    return;
  }

  consumeSpellSlot(caster, 7);

  const spellcastingMod = abilityMod(caster.wis);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Regenerate on ${target.name}! (4d8 + ${spellcastingMod} HP; per-turn regen not modelled in v1)`,
    target.id,
  );

  let heal = spellcastingMod;
  for (let i = 0; i < metadata.healDieCount; i++) {
    heal += rollDie(metadata.healDie);
  }
  if (heal < 0) heal = 0;

  const wasUnconscious = target.isUnconscious;
  const healed = applyHeal(target, heal);

  if (wasUnconscious && healed > 0) {
    emit(
      state, 'condition_remove', target.id,
      `${target.name} regains consciousness!`,
      target.id,
    );
  }

  emit(
    state, 'heal', caster.id,
    `Regenerate: ${healed} HP restored to ${target.name} (rolled ${heal}; now ${target.currentHP}/${target.maxHP})`,
    target.id, healed,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — v1 simplification: instantaneous heal, no per-turn regen.
}
