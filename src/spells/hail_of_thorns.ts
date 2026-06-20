// ============================================================
// Hail of Thorns — PHB p.249
//
// 1st-level conjuration, BONUS ACTION, range Self, concentration (1 min).
// Components: V only.
//
// Effect: The next time you hit a creature with a ranged weapon
//         attack before this spell ends, a hail of thorns bursts
//         from the target, dealing an extra 1d10 piercing damage
//         to the target and to every creature within 5 feet of it.
//
// Upcast: +1d10 piercing per slot level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Duration: canon 1 min concentration → v1 one-shot scratch field
//     `_nextHitRider` on the CASTER. The rider is consumed by
//     resolveAttack's damage branch on the next weapon hit (the engine
//     does NOT gate on ranged-only — melee hits also consume it in v1,
//     a minor over-broad trigger that simplifies the engine contract).
//     Documented via `hailOfThornsCanonV1Implemented: true`.
//   - AoE splash rider (PHB p.249: "every creature within 5 feet of it"
//     takes piercing damage) NOT modelled — v1 only applies the bonus
//     to the primary target. Documented via
//     `hailOfThornsRidersV1Simplified: true`.
//   - Upcast: +1d10/slot-level NOT modelled — v1 always rolls 1d10
//     piercing (forward-compat TODO).
//
// Session 27 Batch 3 — migrated from generic forward-compat stub to
// bespoke `_nextHitRider` self-buff. The stub previously set a flag on
// `_genericSpellActiveSpells` and applied no mechanical effect; this
// implementation drives the engine's next-hit rider pipeline directly.
//
// Spell module pattern:
//   shouldCast(caster, bf) → boolean   (self-buff — no target)
//   execute(caster, state) → void
//   metadata → spell stats
//   cleanup(c) — clears stale `_nextHitRider` if concentration broke
// ============================================================

import { Combatant, Battlefield, DamageType } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Hail of Thorns',
  level: 1,
  school: 'conjuration',
  rangeFt: 0,              // self
  concentration: true,
  castingTime: 'bonus action',
  dieSides: 10,
  count: 1,
  damageType: 'piercing' as const,
  hailOfThornsCanonV1Implemented: true,
  hailOfThornsRidersV1Simplified: true,    // 5-ft AoE splash simplified
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
 * Returns true if the caster should cast Hail of Thorns this turn.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on another spell.
 *   - Caster has 'Hail of Thorns' in their actions.
 *   - Caster has at least one 1st-level-or-higher slot available.
 *   - Caster does NOT already have a pending `_nextHitRider`.
 *
 * Target priority: self only (PHB p.249: range Self). The planner
 * decides priority relative to other bonus-action options.
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Hail of Thorns')) return false;
  if (!hasSpellSlot(caster, 1)) return false;
  if (caster._nextHitRider) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Hail of Thorns:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Safety: drop any stale concentration effects before starting new.
 *  3. Start concentration on 'Hail of Thorns'.
 *  4. Set `_nextHitRider` on the caster (one-shot rider).
 *
 * The rider is CONSUMED by resolveAttack's damage branch in combat.ts
 * on the next weapon hit. The damage branch rolls 1d10 piercing (crit
 * doubles), adds it to the damage total, then sets `_nextHitRider = null`
 * (one-shot — PHB p.249).
 *
 * @param caster  The casting Combatant (Ranger)
 * @param state   Current EngineState (for logging)
 */
export function execute(caster: Combatant, state: EngineState): void {
  consumeSpellSlot(caster, 1);

  // Safety net: drop stale concentration effects before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Hail of Thorns');

  caster._nextHitRider = {
    spellName: 'Hail of Thorns',
    dieSides: metadata.dieSides,
    count: metadata.count,
    damageType: metadata.damageType as DamageType,
  };

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Hail of Thorns! (Next weapon hit: +${metadata.count}d${metadata.dieSides} ${metadata.damageType})`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} readies Hail of Thorns — next weapon hit deals +${metadata.count}d${metadata.dieSides} ${metadata.damageType}!`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Hail of Thorns — clears a stale `_nextHitRider`
 * (whose spellName is 'Hail of Thorns') if concentration broke before
 * the next weapon hit consumed it. Called from resetBudget() at the
 * start of the caster's next turn.
 *
 * @param c  The combatant whose turn is starting (the caster)
 */
export function cleanup(c: Combatant): void {
  if (
    c._nextHitRider?.spellName === 'Hail of Thorns' &&
    (!c.concentration?.active || c.concentration.spellName !== 'Hail of Thorns')
  ) {
    c._nextHitRider = null;
  }
}
