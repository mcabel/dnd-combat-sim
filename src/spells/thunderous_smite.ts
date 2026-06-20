// ============================================================
// Thunderous Smite — PHB p.282
//
// 1st-level evocation, BONUS ACTION, range Self, concentration (1 min).
// Components: V only.
//
// Effect: The next time you hit a creature with a weapon attack
//         before this spell ends, your weapon crackles with thunder,
//         and the attack deals an extra 2d6 thunder damage to the
//         target and pushes the target 10 feet away if it is Large
//         or smaller.
//
// Upcast: see source (not modelled in v1).
//
// v1 simplifications:
//   - Duration: canon 1 min concentration → v1 one-shot scratch field
//     `_nextHitRider` on the CASTER. The rider is consumed by
//     resolveAttack's damage branch on the next weapon hit. Documented
//     via `thunderousSmiteCanonV1Implemented: true`.
//   - Push 10 ft rider (PHB p.282: target pushed 10 ft if Large or
//     smaller) NOT modelled — v1 only applies the bonus 2d6 thunder
//     damage. Documented via `thunderousSmiteRidersV1Simplified: true`.
//   - Upcast: not applicable (PHB has no per-slot-level scaling; v1
//     always rolls 2d6 thunder).
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
  name: 'Thunderous Smite',
  level: 1,
  school: 'evocation',
  rangeFt: 0,              // self
  concentration: true,
  castingTime: 'bonus action',
  dieSides: 6,
  count: 2,
  damageType: 'thunder' as const,
  thunderousSmiteCanonV1Implemented: true,
  thunderousSmiteRidersV1Simplified: true,    // 10-ft push rider simplified
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
 * Returns true if the caster should cast Thunderous Smite this turn.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on another spell.
 *   - Caster has 'Thunderous Smite' in their actions.
 *   - Caster has at least one 1st-level-or-higher slot available.
 *   - Caster does NOT already have a pending `_nextHitRider`.
 *
 * Target priority: self only (PHB p.282: range Self).
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Thunderous Smite')) return false;
  if (!hasSpellSlot(caster, 1)) return false;
  if (caster._nextHitRider) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Thunderous Smite:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Safety: drop any stale concentration effects before starting new.
 *  3. Start concentration on 'Thunderous Smite'.
 *  4. Set `_nextHitRider` on the caster (one-shot rider).
 *
 * The rider is CONSUMED by resolveAttack's damage branch in combat.ts
 * on the next weapon hit. The damage branch rolls 2d6 thunder (crit
 * doubles), adds it to the damage total, then sets `_nextHitRider = null`
 * (one-shot — PHB p.282).
 *
 * @param caster  The casting Combatant (Paladin / Ranger)
 * @param state   Current EngineState (for logging)
 */
export function execute(caster: Combatant, state: EngineState): void {
  consumeSpellSlot(caster, 1);

  // Safety net: drop stale concentration effects before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Thunderous Smite');

  caster._nextHitRider = {
    spellName: 'Thunderous Smite',
    dieSides: metadata.dieSides,
    count: metadata.count,
    damageType: metadata.damageType as DamageType,
  };

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Thunderous Smite! (Next weapon hit: +${metadata.count}d${metadata.dieSides} ${metadata.damageType})`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} readies Thunderous Smite — next weapon hit deals +${metadata.count}d${metadata.dieSides} ${metadata.damageType}!`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Thunderous Smite — clears a stale `_nextHitRider`
 * (whose spellName is 'Thunderous Smite') if concentration broke
 * before the next weapon hit consumed it. Called from resetBudget()
 * at the start of the caster's next turn.
 *
 * @param c  The combatant whose turn is starting (the caster)
 */
export function cleanup(c: Combatant): void {
  if (
    c._nextHitRider?.spellName === 'Thunderous Smite' &&
    (!c.concentration?.active || c.concentration.spellName !== 'Thunderous Smite')
  ) {
    c._nextHitRider = null;
  }
}
