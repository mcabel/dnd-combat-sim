// ============================================================
// Magic Missile — PHB p.257
// 1st-level evocation, NOT concentration
// Range: 120 ft
// Effect: 3 darts, each auto-hits one target for 1d4+1 force damage.
//         All darts can target the same creature or different ones.
//         AI: all 3 darts aimed at the same target.
// No attack roll, no saving throw — always hits.
//
// Upcast (higher slots): +1 dart per slot level above 1st (not modelled — lv1 only).
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, target, bf) → boolean
//   execute(caster, target, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamage } from '../engine/utils';
import { distanceFt } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Magic Missile',
  level: 1,
  school: 'evocation',
  rangeFt: 120,
  darts: 3,
  damageDie: 4,
  damageBonus: 1,    // 1d4+1 per dart
  damageType: 'force' as const,
  concentration: false,
  castingTime: 'action',
  autoHit: true,
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
 * Returns true when Magic Missile should be cast this turn.
 *
 * Conditions:
 *   1. Caster has a 1st-level spell slot
 *   2. Target is within 120 ft
 *   3. Target is alive and not unconscious
 */
export function shouldCast(
  caster: Combatant,
  target: Combatant,
  _bf: Battlefield
): boolean {
  if (!caster.actions.some(a => a.name === 'Magic Missile')) return false;
  if (!hasSpellSlot(caster)) return false;
  if (target.isDead || target.isUnconscious) return false;
  if (distanceFt(caster.pos, target.pos) > 120) return false;
  return true;
}

// ---- execute ------------------------------------------------

/**
 * Fire 3 darts at target, each dealing 1d4+1 force damage (auto-hit).
 * Slot is consumed here.
 * Stops early if target drops to 0 HP mid-volley.
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 1);

  const dartsTotal = metadata.darts;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Magic Missile — ${dartsTotal} darts at ${target.name}!`,
    target.id,
  );

  let totalDealt = 0;

  for (let i = 1; i <= dartsTotal; i++) {
    if (target.isDead || target.isUnconscious) break; // target already down

    const rawDmg = rollDie(metadata.damageDie) + metadata.damageBonus;
    const dealt = applyDamage(target, rawDmg);
    totalDealt += dealt;

    emit(
      state, 'damage', caster.id,
      `Magic Missile dart ${i}: ${dealt} force damage to ${target.name}`,
      target.id,
      dealt,
    );

    // Rage damage tracking (for Barbarian rage maintenance)
    if (dealt > 0) state.rageDamagedSinceLastTurn.add(target.id);
  }

  if (totalDealt > 0) {
    emit(
      state, 'action', caster.id,
      `Magic Missile total: ${totalDealt} force damage to ${target.name}`,
      target.id,
    );
  }
}
