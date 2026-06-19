// ============================================================
// Branding Smite — PHB p.219
//
// 2nd-level evocation, BONUS ACTION, range Self, concentration (1 min).
// Components: V only.
//
// Effect: The next time you hit a creature with a weapon attack
//         before this spell ends, the weapon gleams with astral
//         radiance as you strike. The attack deals an extra 2d6
//         radiant damage to the target, which becomes visible if
//         it's invisible, and the target sheds dim light in a
//         5-foot radius and can't become invisible until the spell
//         ends.
//
// Upcast: +1d6 radiant per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - Duration: canon 1 min concentration → v1 1-round scratch flag
//     (`_brandingSmiteActive` on the CASTER). The flag is consumed by
//     resolveAttack on the next weapon hit (melee OR ranged, NOT spell —
//     PHB p.219 explicitly says "weapon attack"), OR cleared at the start
//     of the caster's NEXT turn via cleanup() called from resetBudget()
//     (mirror True Strike / Blade Ward / Shillelagh timing). Documented
//     via the metadata flag `brandingSmiteDurationV1Simplified: true`.
//   - Concentration: canonically a concentration spell, but v1 treats it
//     as a 1-round self-buff (concentration not enforced — forward-compat
//     TODO; see TG-002 in TEAMGOALS.md).
//   - Invisibility suppression: PHB p.219 also says the target "becomes
//     visible if it's invisible, and the target sheds dim light in a
//     5-foot radius and can't become invisible until the spell ends."
//     v1 does NOT model this (no invisibility subsystem — forward-compat
//     TODO via the metadata flag
//     `brandingSmiteInvisibilitySuppressionV1Implemented: false`).
//   - Upcast: +1d6 per slot level above 2nd NOT modelled — v1 always
//     rolls 2d6 radiant. Forward-compat TODO via
//     `brandingSmiteUpcastV1Implemented: false`.
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → boolean   (self-buff — no target)
//   execute(caster, state) → void
//   metadata → spell stats
//   cleanup(c) — clears `_brandingSmiteActive` if not consumed
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Branding Smite',
  level: 2,
  school: 'evocation',
  rangeFt: 0,       // self
  radiantDice: 2,
  radiantDieSides: 6,
  concentration: true,
  castingTime: 'bonusAction',
  brandingsmiteDurationV1Simplified: true,                  // 1-min → 1-round
  brandingsmiteConcentrationEnforcementV1Implemented: false,// see TG-002
  brandingsmiteInvisibilitySuppressionV1Implemented: false, // no invisibility subsystem
  brandingsmiteUpcastV1Implemented: false,                  // +1d6/slot-level not modelled
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
 * Returns true if the caster should cast Branding Smite this turn (as a
 * bonus action, before the caster's main-action weapon attack).
 *
 * Preconditions:
 *   - Caster has 'Branding Smite' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already Branding-Smite-primed (re-cast would be wasteful)
 *   - Caster has at least one weapon attack in their action list
 *     (melee or ranged — PHB p.219: "weapon attack"). Spell-only casters
 *     (e.g. a Wizard with only Fire Bolt) get no benefit from Branding
 *     Smite — the buff wouldn't trigger on a spell attack.
 *   - At least 1 living enemy exists (no point priming if there's no one
 *     to hit).
 *
 * Target priority: self only (PHB p.219: range Self). No target selection.
 *
 * Note: Branding Smite is a BONUS ACTION — it pairs with the caster's
 * main-action weapon attack. The AI planner should cast it BEFORE the
 * attack action on the same turn. The buff is consumed by resolveAttack
 * on the next weapon hit (one-shot — PHB p.219: "the next time you hit").
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Branding Smite')) return false;
  if (!hasSpellSlot(caster, 2)) return false;

  // Skip if already primed (re-cast would only refresh the duration —
  // wasteful in v1 since the buff is one-shot per cast).
  if (caster._brandingSmiteActive === true) return false;

  // Caster must have at least one weapon attack (melee or ranged) to
  // benefit from the buff. Spell-only casters get no value.
  const hasWeaponAttack = caster.actions.some(a =>
    a.attackType === 'melee' || a.attackType === 'ranged'
  );
  if (!hasWeaponAttack) return false;

  // Need at least 1 living enemy to justify the buff.
  // (Use a simple scan to avoid importing livingEnemiesOf — keep this
  // module's import surface minimal.)
  const hasEnemy = [...bf.combatants.values()].some(c =>
    c.faction !== caster.faction && !c.isDead && !c.isUnconscious
  );
  if (!hasEnemy) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Branding Smite:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Set `_brandingSmiteActive = true` on the caster (scratch flag).
 *  3. Log the cast.
 *
 * The buff is CONSUMED by resolveAttack's damage branch in combat.ts on
 * the next weapon hit (melee OR ranged, NOT spell — PHB p.219). The
 * damage branch rolls 2d6 radiant, adds it to the damage total, then
 * sets `_brandingSmiteActive = false` (one-shot — see the doc comment
 * on `_brandingSmiteActive` in core.ts for details).
 *
 * v1 simplifications: concentration NOT enforced (TG-002); invisibility
 * suppression NOT modelled; upcast NOT modelled.
 *
 * @param caster  The casting Combatant (Paladin / Ranger)
 * @param state   Current EngineState (for logging)
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  caster._brandingSmiteActive = true;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Branding Smite! (Next weapon hit deals +${metadata.radiantDice}d${metadata.radiantDieSides} radiant)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name}'s next weapon attack is primed with astral radiance!`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Branding Smite — called from resetBudget() at the start
 * of the caster's next turn. Clears `_brandingSmiteActive` if the buff was
 * not consumed by a weapon attack during the caster's turn (v1 1-round
 * simplification — canonically the spell is concentration, up to 1 min).
 *
 * This is a SAFETY NET — the primary clearing mechanism is resolveAttack's
 * damage branch consuming the flag on the next weapon hit. If the caster
 * makes no weapon attack before their next turn (e.g. they cast a spell
 * or used a non-attack action), the flag is cleared here so the buff
 * doesn't carry over to a future turn (v1 1-round simplification).
 *
 * @param c  The combatant whose turn is starting (the caster)
 */
export function cleanup(c: Combatant): void {
  if (c._brandingSmiteActive === true) {
    c._brandingSmiteActive = false;
  }
}
