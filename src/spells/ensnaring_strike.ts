// ============================================================
// Ensnaring Strike — PHB p.237
//
// 1st-level conjuration, BONUS ACTION, range Self, concentration (1 min).
// Components: V only.
//
// Effect: The next time you hit a creature with a weapon attack
//         before this spell ends, a writhing mass of thorny vines
//         appears at the point of impact, and the target takes an
//         extra 1d6 piercing damage. The target must succeed on a
//         Strength saving throw or be restrained by the vines.
//
// Upcast: +1d6 piercing per slot level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Duration: canon 1 min concentration → v1 one-shot scratch field
//     `_nextHitRider` on the CASTER. The rider is consumed by
//     resolveAttack's damage branch on the next weapon hit (melee OR
//     ranged, NOT spell — PHB p.237: "weapon attack"). The rider's
//     `condition: 'restrained'` is applied to the target on hit
//     (sourceIsConcentration: true — ends if Ensnaring Strike's conc
//     breaks). Documented via `ensnaringStrikeCanonV1Implemented: true`.
//   - STR save to escape the vines (PHB p.237) NOT modelled — the
//     condition lasts until concentration breaks. Documented via
//     `ensnaringStrikeRidersV1Simplified: true`.
//   - Ranged-concealment rider (PHB p.237: vines impose ranged attack
//     disadvantage through the target's space) NOT modelled — included
//     in the riders-simplified flag.
//   - Upcast: +1d6/slot-level NOT modelled — v1 always rolls 1d6
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

import { Combatant, Battlefield, DamageType, Condition } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Ensnaring Strike',
  level: 1,
  school: 'conjuration',
  rangeFt: 0,              // self
  concentration: true,
  castingTime: 'bonus action',
  dieSides: 6,
  count: 1,
  damageType: 'piercing' as const,
  ensnaringStrikeCanonV1Implemented: true,
  ensnaringStrikeRidersV1Simplified: true,    // STR-save-to-escape + ranged-concealment simplified
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
 * Returns true if the caster should cast Ensnaring Strike this turn.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on another spell.
 *   - Caster has 'Ensnaring Strike' in their actions.
 *   - Caster has at least one 1st-level-or-higher slot available.
 *   - Caster does NOT already have a pending `_nextHitRider` (re-cast
 *     would overwrite a primed buff — wasteful).
 *
 * Target priority: self only (PHB p.237: range Self). The planner
 * decides priority relative to other bonus-action options.
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Ensnaring Strike')) return false;
  if (!hasSpellSlot(caster, 1)) return false;
  if (caster._nextHitRider) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Ensnaring Strike:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Safety: drop any stale concentration effects before starting new.
 *  3. Start concentration on 'Ensnaring Strike'.
 *  4. Set `_nextHitRider` on the caster (one-shot rider).
 *
 * The rider is CONSUMED by resolveAttack's damage branch in combat.ts
 * on the next weapon hit (melee OR ranged, NOT spell — PHB p.237).
 * The damage branch rolls 1d6 piercing (crit doubles), adds it to the
 * damage total, applies `restrained` to the target (sourceIsConcentration:
 * true), then sets `_nextHitRider = null` (one-shot — PHB p.237).
 *
 * @param caster  The casting Combatant (Ranger / Paladin)
 * @param state   Current EngineState (for logging)
 */
export function execute(caster: Combatant, state: EngineState): void {
  consumeSpellSlot(caster, 1);

  // Safety net: drop stale concentration effects before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Ensnaring Strike');

  caster._nextHitRider = {
    spellName: 'Ensnaring Strike',
    dieSides: metadata.dieSides,
    count: metadata.count,
    damageType: metadata.damageType as DamageType,
    condition: 'restrained' as Condition,
  };

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Ensnaring Strike! (Next weapon hit: +${metadata.count}d${metadata.dieSides} ${metadata.damageType} + restrained)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} readies Ensnaring Strike — next weapon hit deals +${metadata.count}d${metadata.dieSides} ${metadata.damageType}!`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Ensnaring Strike — clears a stale `_nextHitRider`
 * (whose spellName is 'Ensnaring Strike') if concentration broke
 * before the next weapon hit consumed it. Called from resetBudget()
 * at the start of the caster's next turn.
 *
 * If concentration is still active on this spell, the rider is left in
 * place — it will be consumed by the next weapon hit, or cleared by a
 * future cleanup once concentration breaks.
 *
 * @param c  The combatant whose turn is starting (the caster)
 */
export function cleanup(c: Combatant): void {
  if (
    c._nextHitRider?.spellName === 'Ensnaring Strike' &&
    (!c.concentration?.active || c.concentration.spellName !== 'Ensnaring Strike')
  ) {
    c._nextHitRider = null;
  }
}
