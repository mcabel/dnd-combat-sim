// ============================================================
// Lightning Arrow — PHB p.255
//
// 3rd-level transmutation, BONUS ACTION, range Self, concentration
// (up to 1 min).
// Components: V, S.
//
// Effect: The next time you make a ranged weapon attack during the
//         spell's duration, the weapon's ammunition or projectile
//         transforms into a bolt of lightning. The target takes an
//         extra 4d8 lightning damage on a hit, and every creature
//         within 10 feet of the target takes 2d8 lightning damage
//         (half on a save).
//
// Upcast: +1d8 (target) / +1d8 (AoE) per slot level above 3rd (not modelled in v1).
//
// v1 simplifications:
//   - Duration: canon 1 min concentration → v1 one-shot scratch field
//     `_nextHitRider` on the CASTER. The rider is consumed by
//     resolveAttack's damage branch on the next weapon hit (the engine
//     does NOT gate on ranged-only — melee hits also consume it in v1,
//     a minor over-broad trigger that simplifies the engine contract).
//     Documented via `lightningArrowCanonV1Implemented: true`.
//   - AoE splash rider (PHB p.255: 2d8 lightning to every creature
//     within 10 ft of the target, DEX save for half) NOT modelled —
//     v1 only applies the bonus 4d8 lightning to the primary target.
//     Documented via `lightningArrowRidersV1Simplified: true`.
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 4d8 lightning.
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
  name: 'Lightning Arrow',
  level: 3,
  school: 'transmutation',
  rangeFt: 0,              // self
  concentration: true,
  castingTime: 'bonus action',
  dieSides: 8,
  count: 4,
  damageType: 'lightning' as const,
  lightningArrowCanonV1Implemented: true,
  lightningArrowRidersV1Simplified: true,    // 10-ft AoE 2d8 DEX-save splash simplified
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
 * Returns true if the caster should cast Lightning Arrow this turn.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on another spell.
 *   - Caster has 'Lightning Arrow' in their actions.
 *   - Caster has at least one 3rd-level-or-higher slot available.
 *   - Caster does NOT already have a pending `_nextHitRider`.
 *
 * Target priority: self only (PHB p.255: range Self).
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Lightning Arrow')) return false;
  if (!hasSpellSlot(caster, 3)) return false;
  if (caster._nextHitRider) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Lightning Arrow:
 *  1. Consume a 3rd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Safety: drop any stale concentration effects before starting new.
 *  3. Start concentration on 'Lightning Arrow'.
 *  4. Set `_nextHitRider` on the caster (one-shot rider).
 *
 * The rider is CONSUMED by resolveAttack's damage branch in combat.ts
 * on the next weapon hit. The damage branch rolls 4d8 lightning (crit
 * doubles), adds it to the damage total, then sets `_nextHitRider = null`
 * (one-shot — PHB p.255).
 *
 * @param caster  The casting Combatant (Ranger)
 * @param state   Current EngineState (for logging)
 */
export function execute(caster: Combatant, state: EngineState): void {
  consumeSpellSlot(caster, 3);

  // Safety net: drop stale concentration effects before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Lightning Arrow');

  caster._nextHitRider = {
    spellName: 'Lightning Arrow',
    dieSides: metadata.dieSides,
    count: metadata.count,
    damageType: metadata.damageType as DamageType,
  };

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Lightning Arrow! (Next weapon hit: +${metadata.count}d${metadata.dieSides} ${metadata.damageType})`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} readies Lightning Arrow — next weapon hit deals +${metadata.count}d${metadata.dieSides} ${metadata.damageType}!`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Lightning Arrow — clears a stale `_nextHitRider`
 * (whose spellName is 'Lightning Arrow') if concentration broke before
 * the next weapon hit consumed it. Called from resetBudget() at the
 * start of the caster's next turn.
 *
 * @param c  The combatant whose turn is starting (the caster)
 */
export function cleanup(c: Combatant): void {
  if (
    c._nextHitRider?.spellName === 'Lightning Arrow' &&
    (!c.concentration?.active || c.concentration.spellName !== 'Lightning Arrow')
  ) {
    c._nextHitRider = null;
  }
}
