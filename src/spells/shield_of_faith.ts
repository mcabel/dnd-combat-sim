// ============================================================
// Shield of Faith — PHB p.275
//
// 1st-level abjuration, concentration (up to 10 min)
// Range: 60 ft   Target: one willing creature
// Casting time: bonus action
//
// Effect: The target gains a +2 bonus to AC for the duration.
//         Removed when concentration breaks.
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Shield of Faith',
  level: 1,
  school: 'abjuration',
  rangeFt: 60,
  concentration: true,
  castingTime: 'bonus action',
  maxTargets: 1,
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

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Shield of Faith:
 * the living party member (including caster) within 60 ft with the lowest AC
 * that is not already protected by this caster's Shield of Faith.
 * Tie-break: closest first.
 * Returns null if no valid candidates exist.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Shield of Faith')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const candidates: Array<{ c: Combatant; ac: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Shield of Faith')) continue;

    candidates.push({ c, ac: c.ac, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.ac !== b.ac ? a.ac - b.ac : a.dist - b.dist);
  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Shield of Faith:
 *  1. Consume a 1st-level spell slot.
 *  2. Break any existing concentration (safety net — planner should prevent this).
 *  3. Start concentration on Shield of Faith.
 *  4. Apply ac_bonus (+2) to the target — no save required.
 *     The bonus is automatically added by getActiveAcBonus() in resolveAttack.
 *
 * @param caster  The casting Combatant (Cleric/Paladin/Artificer)
 * @param target  The candidate from shouldCast (single ally in range, lowest AC)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 1);

  // Safety: clean up any stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Shield of Faith');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Shield of Faith on ${target.name}!`,
  );

  // Re-check liveness (stale edge case)
  if (target.isDead || target.isUnconscious) return;

  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Shield of Faith',
    effectType: 'ac_bonus',
    payload: {
      acBonus: 2,   // PHB: +2 to AC
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is shielded by faith — +2 AC!`,
    target.id,
  );
}
