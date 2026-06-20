// ============================================================
// Flame Arrows — XGE p.156 (also PHB/XGE — transmutation 3rd level)
//
// 3rd-level transmutation, action, range Touch (5 ft), concentration (1 hr).
// Components: V, S.
//
// Effect: You touch a quiver containing arrows or bolts. When a target is
//         hit by a ranged weapon attack using a piece of ammunition drawn
//         from the quiver, the target takes an extra 1d6 fire damage.
//
// Upcast: None in XGE (fixed 1d6 at all slot levels).
//
// v1 simplifications:
//   - Self-buff vs. touch: canon is a touch-range spell cast on an ally's
//     quiver. v1 models it as a SELF-BUFF on the caster (the caster
//     enchants their own ammunition). Touching allies is NOT modelled.
//   - Ranged-ammo-only gate: canon restricts the extra damage to RANGED
//     weapon attacks using AMMUNITION from the enchanted quiver. v1's
//     weapon_enchant consumption in resolveAttack applies the damage die
//     to ALL weapon attacks (melee AND ranged) — there is no ranged-only
//     / ammunition-only gate in the engine's weapon_enchant consumption.
//     v1 thus applies the +1d6 fire to melee weapon attacks too. Forward-
//     compat TODO via the metadata flag `flameArrowsCanonV1Implemented: true`
//     — "v1 applies to all weapon attacks; canon is ranged-ammo-only (no
//     ranged-only gate in weapon_enchant consumption — forward-compat TODO)."
//   - Quiver-tracking: v1 does NOT track per-quiver state — applies to all
//     of the caster's weapon attacks.
//   - Duration: canon 1 hr concentration → v1: concentration is started,
//     but NOT enforced (TG-002).
//
// Weapon_enchant pattern (Session 27 Batch 3):
//   The engine's resolveAttack damage branch consumes `damageDie` (6) ×
//   `damageDieCount` (1) of `damageDieType` ('fire') and adds the roll to
//   every weapon attack (melee/ranged, NOT spell). Crit doubles the dice
//   (PHB p.196).
//
// Migration note: Session 27 Batch 3 — migrated from generic forward-compat
// stub to bespoke weapon_enchant self-buff. Previously this spell only
// set a `_genericSpellActiveSpells` flag with no mechanical effect; now
// it applies a real `weapon_enchant` effect with 1d6 fire.
//
// Spell module pattern (self-buff):
//   shouldCast(caster, bf) → boolean
//   execute(caster, state) → void
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield, DamageType } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Flame Arrows',
  level: 3,
  school: 'transmutation',
  rangeFt: 0,                  // v1: self-buff (canon: touch 5 ft)
  concentration: true,
  castingTime: 'action',
  attackBonus: 0,
  damageBonus: 0,
  damageDie: 6,                // +1d6 fire per weapon attack (XGE p.156)
  damageDieCount: 1,
  damageType: 'fire' as DamageType,
  flameArrowsCanonV1Implemented: true,
  // v1 applies to all weapon attacks; canon is ranged-ammo-only (no
  // ranged-only gate in weapon_enchant consumption — forward-compat TODO).
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
 * Returns true if the caster should cast Flame Arrows this turn.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating
 *   - Caster has 'Flame Arrows' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - Caster does NOT already have an active Flame Arrows weapon_enchant
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Flame Arrows')) return false;
  if (!hasSpellSlot(caster, 3)) return false;
  if (caster.activeEffects.some(e =>
    e.casterId === caster.id && e.spellName === 'Flame Arrows'
  )) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Flame Arrows:
 *  1. Consume a 3rd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Flame Arrows.
 *  4. Apply a `weapon_enchant` ActiveEffect on the CASTER (self-buff) with
 *     payload.damageDie=6, payload.damageDieCount=1, payload.damageDieType='fire'.
 *     The engine's resolveAttack damage branch rolls 1d6 fire and adds it
 *     to every weapon attack (melee/ranged, NOT spell). Crit doubles the
 *     dice (PHB p.196).
 *
 * v1 simplifications: self-buff (canon: touch ally's quiver); applies to ALL
 * weapon attacks (canon: ranged-ammo-only — no ranged-only gate in the
 * engine's weapon_enchant consumption, forward-compat TODO); per-quiver NOT
 * tracked; concentration NOT enforced (TG-002).
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 3);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Flame Arrows');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Flame Arrows! (+1d6 fire on weapon attacks)`,
    caster.id,
  );

  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Flame Arrows',
    effectType: 'weapon_enchant',
    payload: {
      attackBonus: 0,
      damageBonus: 0,
      damageDie: 6,
      damageDieCount: 1,
      damageDieType: 'fire',
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${caster.name}'s weapon is enchanted! (+1d6 fire damage on weapon attacks)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
