// ============================================================
// Spirit Shroud — XGE p.171 / TCE p.108 (also PHB-style bonus-action self-buff)
//
// 3rd-level necromancy, BONUS ACTION, range Self, concentration
// (up to 1 min).
// Components: V, S.
//
// Effect: You call forth spirits of the dead, which hover around you
//         in a 10-foot radius. Until the spell ends, any attack you
//         make deals an extra 1d8 radiant damage (if you choose good)
//         or 1d8 necrotic damage (if you choose evil) when it hits.
//         The spirits also hinder the target: it can't regain hit
//         points, its speed is reduced by 10 ft, and it can't move
//         more than 5 ft by any means (slow rider). At higher levels
//         the die size grows: 1d8 at 3rd-4th, 2d8 at 5th-6th, 3d8 at 7th+.
//
// Upcast: +1d8 die per two slot levels above 3rd (not modelled in v1).
//
// v1 simplifications:
//   - Duration: canon 1 min concentration → v1 one-shot scratch field
//     `_nextHitRider` on the CASTER (rather than an aura). The rider
//     is consumed by resolveAttack's damage branch on the next weapon
//     hit. Documented via `spiritShroudCanonV1Implemented: true`.
//   - Damage type: canon lets the caster pick radiant OR necrotic.
//     v1 picks radiant. Documented via `damageType: 'radiant'` and
//     the canon flag.
//   - 10-ft aura rider (PHB p.278: spirits hover around the caster
//     in a 10-ft radius, applying to all attacks vs targets in the
//     aura) NOT modelled — v1 only applies the bonus on the next hit.
//     Documented via `spiritShroudRidersV1Simplified: true`.
//   - Slow rider (PHB p.278: target can't regain HP, speed −10 ft,
//     can't move more than 5 ft) NOT modelled — also covered by the
//     riders-simplified flag.
//   - Upcast: +1d8 die per two slot levels NOT modelled — v1 always
//     rolls 1d8 radiant.
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
  name: 'Spirit Shroud',
  level: 3,
  school: 'necromancy',
  rangeFt: 0,              // self
  concentration: true,
  castingTime: 'bonus action',
  dieSides: 8,
  count: 1,
  damageType: 'radiant' as const,   // v1 picks radiant over necrotic
  spiritShroudCanonV1Implemented: true,
  spiritShroudRidersV1Simplified: true,    // 10-ft aura + slow + no-heal riders simplified
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
 * Returns true if the caster should cast Spirit Shroud this turn.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on another spell.
 *   - Caster has 'Spirit Shroud' in their actions.
 *   - Caster has at least one 3rd-level-or-higher slot available.
 *   - Caster does NOT already have a pending `_nextHitRider`.
 *
 * Target priority: self only (PHB p.278: range Self).
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Spirit Shroud')) return false;
  if (!hasSpellSlot(caster, 3)) return false;
  if (caster._nextHitRider) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Spirit Shroud:
 *  1. Consume a 3rd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Safety: drop any stale concentration effects before starting new.
 *  3. Start concentration on 'Spirit Shroud'.
 *  4. Set `_nextHitRider` on the caster (one-shot rider).
 *
 * The rider is CONSUMED by resolveAttack's damage branch in combat.ts
 * on the next weapon hit. The damage branch rolls 1d8 radiant (crit
 * doubles), adds it to the damage total, then sets `_nextHitRider = null`
 * (one-shot — PHB p.278).
 *
 * @param caster  The casting Combatant (Cleric / Paladin / Warlock)
 * @param state   Current EngineState (for logging)
 */
export function execute(caster: Combatant, state: EngineState): void {
  consumeSpellSlot(caster, 3);

  // Safety net: drop stale concentration effects before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Spirit Shroud');

  caster._nextHitRider = {
    spellName: 'Spirit Shroud',
    dieSides: metadata.dieSides,
    count: metadata.count,
    damageType: metadata.damageType as DamageType,
  };

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Spirit Shroud! (Next weapon hit: +${metadata.count}d${metadata.dieSides} ${metadata.damageType})`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} readies Spirit Shroud — next weapon hit deals +${metadata.count}d${metadata.dieSides} ${metadata.damageType}!`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Spirit Shroud — clears a stale `_nextHitRider`
 * (whose spellName is 'Spirit Shroud') if concentration broke before
 * the next weapon hit consumed it. Called from resetBudget() at the
 * start of the caster's next turn.
 *
 * @param c  The combatant whose turn is starting (the caster)
 */
export function cleanup(c: Combatant): void {
  if (
    c._nextHitRider?.spellName === 'Spirit Shroud' &&
    (!c.concentration?.active || c.concentration.spellName !== 'Spirit Shroud')
  ) {
    c._nextHitRider = null;
  }
}
