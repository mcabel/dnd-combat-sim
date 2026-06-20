// ============================================================
// Staggering Smite — PHB p.279
//
// 4th-level evocation, BONUS ACTION, range Self, concentration (1 min).
// Components: V only.
//
// Effect: The next time you hit a creature with a weapon attack
//         before this spell ends, your weapon strikes with psychically
//         charged force, and the attack deals an extra 4d6 psychic
//         damage to the target and causes the target to make a Wisdom
//         saving throw. On a failed save, the target is stunned until
//         the end of your next turn.
//
// Upcast: see source (not modelled in v1).
//
// v1 simplifications:
//   - Duration: canon 1 min concentration → v1 one-shot scratch field
//     `_nextHitRider` on the CASTER. The rider is consumed by
//     resolveAttack's damage branch on the next weapon hit. The rider's
//     `condition: 'stunned'` is applied to the target on hit
//     (sourceIsConcentration: true — ends if Staggering Smite's conc
//     breaks). Documented via `staggeringSmiteCanonV1Implemented: true`.
//   - Initial WIS save to resist the stun (PHB p.279) NOT modelled —
//     v1 auto-stuns on hit. Documented via
//     `staggeringSmiteRidersV1Simplified: true`.
//   - Stun-duration (PHB p.279: stunned "until the end of your next
//     turn") NOT precisely modelled — the stunned condition lasts
//     until concentration breaks (which is generally close, since
//     concentration on a 1-min spell outlasts the canon end-of-next-
//     turn window; this is an over-broad simplification, documented
//     by the same riders-simplified flag).
//   - Upcast: not applicable (PHB has no per-slot-level scaling).
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

import { Combatant, Battlefield, DamageType, Condition } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Staggering Smite',
  level: 4,
  school: 'evocation',
  rangeFt: 0,              // self
  concentration: true,
  castingTime: 'bonus action',
  dieSides: 6,
  count: 4,
  damageType: 'psychic' as const,
  staggeringSmiteCanonV1Implemented: true,
  staggeringSmiteRidersV1Simplified: true,    // WIS-save-to-stun simplified
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
 * Returns true if the caster should cast Staggering Smite this turn.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on another spell.
 *   - Caster has 'Staggering Smite' in their actions.
 *   - Caster has at least one 4th-level-or-higher slot available.
 *   - Caster does NOT already have a pending `_nextHitRider`.
 *
 * Target priority: self only (PHB p.279: range Self).
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Staggering Smite')) return false;
  if (!hasSpellSlot(caster, 4)) return false;
  if (caster._nextHitRider) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Staggering Smite:
 *  1. Consume a 4th-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Safety: drop any stale concentration effects before starting new.
 *  3. Start concentration on 'Staggering Smite'.
 *  4. Set `_nextHitRider` on the caster (one-shot rider).
 *
 * The rider is CONSUMED by resolveAttack's damage branch in combat.ts
 * on the next weapon hit. The damage branch rolls 4d6 psychic (crit
 * doubles), adds it to the damage total, applies `stunned` to the
 * target (sourceIsConcentration: true), then sets `_nextHitRider = null`
 * (one-shot — PHB p.279).
 *
 * @param caster  The casting Combatant (Paladin)
 * @param state   Current EngineState (for logging)
 */
export function execute(caster: Combatant, state: EngineState): void {
  consumeSpellSlot(caster, 4);

  // Safety net: drop stale concentration effects before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Staggering Smite');

  caster._nextHitRider = {
    spellName: 'Staggering Smite',
    dieSides: metadata.dieSides,
    count: metadata.count,
    damageType: metadata.damageType as DamageType,
    condition: 'stunned' as Condition,
  };

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Staggering Smite! (Next weapon hit: +${metadata.count}d${metadata.dieSides} ${metadata.damageType} + stunned)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} readies Staggering Smite — next weapon hit deals +${metadata.count}d${metadata.dieSides} ${metadata.damageType}!`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Staggering Smite — clears a stale `_nextHitRider`
 * (whose spellName is 'Staggering Smite') if concentration broke
 * before the next weapon hit consumed it. Called from resetBudget()
 * at the start of the caster's next turn.
 *
 * @param c  The combatant whose turn is starting (the caster)
 */
export function cleanup(c: Combatant): void {
  if (
    c._nextHitRider?.spellName === 'Staggering Smite' &&
    (!c.concentration?.active || c.concentration.spellName !== 'Staggering Smite')
  ) {
    c._nextHitRider = null;
  }
}
