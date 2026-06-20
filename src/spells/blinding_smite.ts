// ============================================================
// Blinding Smite — PHB p.219
//
// 3rd-level evocation, BONUS ACTION, range Self, concentration (1 min).
// Components: V only.
//
// Effect: The next time you hit a creature with a weapon attack
//         before this spell ends, your weapon flares with bright
//         light, and the attack deals an extra 3d8 radiant damage
//         to the target, which must succeed on a Constitution saving
//         throw or be blinded until the spell ends.
//
// Upcast: see source (not modelled in v1).
//
// v1 simplifications:
//   - Duration: canon 1 min concentration → v1 one-shot scratch field
//     `_nextHitRider` on the CASTER. The rider is consumed by
//     resolveAttack's damage branch on the next weapon hit. The rider's
//     `condition: 'blinded'` is applied to the target on hit
//     (sourceIsConcentration: true — ends if Blinding Smite's conc
//     breaks). Documented via `blindingSmiteCanonV1Implemented: true`.
//   - Initial CON save to resist the blinded effect (PHB p.219) NOT
//     modelled — v1 auto-blinds on hit. The condition IS the primary
//     effect, so no separate `RidersV1Simplified` flag is needed (the
//     simplification is documented in the header).
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
  name: 'Blinding Smite',
  level: 3,
  school: 'evocation',
  rangeFt: 0,              // self
  concentration: true,
  castingTime: 'bonus action',
  dieSides: 8,
  count: 3,
  damageType: 'radiant' as const,
  blindingSmiteCanonV1Implemented: true,
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
 * Returns true if the caster should cast Blinding Smite this turn.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on another spell.
 *   - Caster has 'Blinding Smite' in their actions.
 *   - Caster has at least one 3rd-level-or-higher slot available.
 *   - Caster does NOT already have a pending `_nextHitRider`.
 *
 * Target priority: self only (PHB p.219: range Self).
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Blinding Smite')) return false;
  if (!hasSpellSlot(caster, 3)) return false;
  if (caster._nextHitRider) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Blinding Smite:
 *  1. Consume a 3rd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Safety: drop any stale concentration effects before starting new.
 *  3. Start concentration on 'Blinding Smite'.
 *  4. Set `_nextHitRider` on the caster (one-shot rider).
 *
 * The rider is CONSUMED by resolveAttack's damage branch in combat.ts
 * on the next weapon hit. The damage branch rolls 3d8 radiant (crit
 * doubles), adds it to the damage total, applies `blinded` to the
 * target (sourceIsConcentration: true), then sets `_nextHitRider = null`
 * (one-shot — PHB p.219).
 *
 * @param caster  The casting Combatant (Paladin)
 * @param state   Current EngineState (for logging)
 */
export function execute(caster: Combatant, state: EngineState): void {
  consumeSpellSlot(caster, 3);

  // Safety net: drop stale concentration effects before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Blinding Smite');

  caster._nextHitRider = {
    spellName: 'Blinding Smite',
    dieSides: metadata.dieSides,
    count: metadata.count,
    damageType: metadata.damageType as DamageType,
    condition: 'blinded' as Condition,
  };

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Blinding Smite! (Next weapon hit: +${metadata.count}d${metadata.dieSides} ${metadata.damageType} + blinded)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} readies Blinding Smite — next weapon hit deals +${metadata.count}d${metadata.dieSides} ${metadata.damageType}!`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Blinding Smite — clears a stale `_nextHitRider`
 * (whose spellName is 'Blinding Smite') if concentration broke before
 * the next weapon hit consumed it. Called from resetBudget() at the
 * start of the caster's next turn.
 *
 * @param c  The combatant whose turn is starting (the caster)
 */
export function cleanup(c: Combatant): void {
  if (
    c._nextHitRider?.spellName === 'Blinding Smite' &&
    (!c.concentration?.active || c.concentration.spellName !== 'Blinding Smite')
  ) {
    c._nextHitRider = null;
  }
}
