// ============================================================
// Bless — PHB p.219
//
// 1st-level enchantment, concentration (up to 1 min)
// Range: 30 ft   Targets: up to 3 willing creatures
// Effect: Until the spell ends, whenever a target makes an
//         attack roll or saving throw, it rolls a d4 and adds
//         the number to the result.
//         Removed when concentration breaks.
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
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
  name: 'Bless',
  level: 1,
  school: 'enchantment',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  maxTargets: 3,
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
 * Returns candidate targets for Bless (up to 3 living allies within 30 ft,
 * not already blessed by this caster), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Self (caster) — always benefits from bless die on own attacks/saves
 *   2. Remaining allies ordered by proximity (closest first)
 *
 * Preconditions:
 *   - Caster has 'Bless' in their actions
 *   - Caster has at least one 1st-level slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid target exists (self or ally within 30 ft)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  // Never interrupt active concentration
  if (caster.concentration?.active) return null;

  // Must have the spell and a free slot
  if (!caster.actions.some(a => a.name === 'Bless')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const selfEntry = bf.combatants.get(caster.id);
  const candidates: Array<{ c: Combatant; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;

    // Skip if already blessed by this caster (re-cast would be wasteful)
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Bless')) continue;

    candidates.push({ c, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: self first, then closest allies
  candidates.sort((a, b) => {
    const aSelf = a.c.id === caster.id ? 0 : 1;
    const bSelf = b.c.id === caster.id ? 0 : 1;
    if (aSelf !== bSelf) return aSelf - bSelf;
    return a.dist - b.dist;
  });

  return candidates.slice(0, metadata.maxTargets).map(e => e.c);
}

// ---- Execution ----------------------------------------------

/**
 * Execute Bless:
 *  1. Consume a 1st-level spell slot.
 *  2. Break any existing concentration (safety net — planner should prevent this).
 *  3. Start concentration on Bless.
 *  4. Apply bless_die (d4 = dieSides: 4) to each target — no save required.
 *     The die is rolled at attack/save resolution time by the combat engine.
 *
 * @param caster  The casting Combatant (Cleric/Paladin)
 * @param targets Candidates from shouldCast (allies including self, in range)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 1);

  // Safety: clean up any stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Bless');

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Bless on ${names} (${targets.length} creature${targets.length !== 1 ? 's' : ''})!`,
  );

  for (const target of targets) {
    // Re-check liveness (stale edge case)
    if (target.isDead || target.isUnconscious) continue;

    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Bless',
      effectType: 'bless_die',
      payload: {
        dieSides: 4,   // PHB: d4
      },
      sourceIsConcentration: true,
    });

    emit(
      state, 'condition_add', caster.id,
      `${target.name} is blessed — +1d4 to all attack rolls and saving throws!`,
      target.id,
    );
  }
}
