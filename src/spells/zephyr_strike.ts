// ============================================================
// Zephyr Strike — XGE p.171 (also PHB-style bonus-action self-buff)
//
// 1st-level transmutation, BONUS ACTION, range Self, concentration
// (up to 1 min).
// Components: V only.
//
// Effect: You move like the wind. Until the spell ends, your movement
//         doesn't provoke opportunity attacks. Once before the spell
//         ends, you can give yourself advantage on one weapon attack
//         roll on your turn. That attack deals an extra 1d8 force
//         damage on a hit. If you attack with this advantage, your
//         speed increases by 30 feet until the end of the turn.
//
// Upcast: see source (not modelled in v1).
//
// v1 simplifications:
//   - Duration: canon 1 min concentration → v1 one-shot scratch field
//     `_nextHitRider` on the CASTER. The rider is consumed by
//     resolveAttack's damage branch on the next weapon hit. Documented
//     via `zephyrStrikeCanonV1Implemented: true`.
//   - Disengage rider (PHB p.171: movement doesn't provoke opportunity
//     attacks) NOT modelled — v1 only applies the bonus 1d8 force.
//     Documented via `zephyrStrikeRidersV1Simplified: true`.
//   - Speed-boost-on-advantage rider (PHB p.171: +30 ft speed on the
//     advantage attack) NOT modelled — also covered by the
//     riders-simplified flag.
//   - Advantage-on-next-attack rider (PHB p.171: one attack with
//     advantage) NOT modelled — covered by the riders-simplified flag.
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

import { Combatant, Battlefield, DamageType } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Zephyr Strike',
  level: 1,
  school: 'transmutation',
  rangeFt: 0,              // self
  concentration: true,
  castingTime: 'bonus action',
  dieSides: 8,
  count: 1,
  damageType: 'force' as const,
  zephyrStrikeCanonV1Implemented: true,
  zephyrStrikeRidersV1Simplified: true,    // disengage + speed + advantage riders simplified
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
 * Returns true if the caster should cast Zephyr Strike this turn.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on another spell.
 *   - Caster has 'Zephyr Strike' in their actions.
 *   - Caster has at least one 1st-level-or-higher slot available.
 *   - Caster does NOT already have a pending `_nextHitRider`.
 *
 * Target priority: self only (PHB p.171: range Self).
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Zephyr Strike')) return false;
  if (!hasSpellSlot(caster, 1)) return false;
  if (caster._nextHitRider) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Zephyr Strike:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Safety: drop any stale concentration effects before starting new.
 *  3. Start concentration on 'Zephyr Strike'.
 *  4. Set `_nextHitRider` on the caster (one-shot rider).
 *
 * The rider is CONSUMED by resolveAttack's damage branch in combat.ts
 * on the next weapon hit. The damage branch rolls 1d8 force (crit
 * doubles), adds it to the damage total, then sets `_nextHitRider = null`
 * (one-shot — PHB p.171).
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
  startConcentration(caster, 'Zephyr Strike');

  caster._nextHitRider = {
    spellName: 'Zephyr Strike',
    dieSides: metadata.dieSides,
    count: metadata.count,
    damageType: metadata.damageType as DamageType,
  };

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Zephyr Strike! (Next weapon hit: +${metadata.count}d${metadata.dieSides} ${metadata.damageType})`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} readies Zephyr Strike — next weapon hit deals +${metadata.count}d${metadata.dieSides} ${metadata.damageType}!`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Zephyr Strike — clears a stale `_nextHitRider`
 * (whose spellName is 'Zephyr Strike') if concentration broke before
 * the next weapon hit consumed it. Called from resetBudget() at the
 * start of the caster's next turn.
 *
 * @param c  The combatant whose turn is starting (the caster)
 */
export function cleanup(c: Combatant): void {
  if (
    c._nextHitRider?.spellName === 'Zephyr Strike' &&
    (!c.concentration?.active || c.concentration.spellName !== 'Zephyr Strike')
  ) {
    c._nextHitRider = null;
  }
}
