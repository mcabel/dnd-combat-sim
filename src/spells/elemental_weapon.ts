// ============================================================
// Elemental Weapon — PHB p.234
//
// 3rd-level transmutation, action, range Touch (5 ft), concentration (1 hr).
// Components: V, S.
//
// Effect: A nonmagical weapon you touch becomes a magic weapon. Choose one
//         of the following damage types: acid, cold, fire, lightning, or
//         thunder. For the duration, the weapon has a +1 bonus to attack
//         rolls and deals an extra 1d4 damage of the chosen type on a hit.
//
// Upcast: +2 (5th-6th slot, +1d4 damage) / +3 (7th-9th slot, +1d4 damage)
//         — NOT modelled in v1 (always +1 attack, +1d4 damage).
//
// v1 simplifications:
//   - Self-buff vs. touch: canon is a touch-range spell cast on an ally's
//     weapon (or the caster's own). v1 models it as a SELF-BUFF on the
//     caster (the caster enchants their own weapon). Touching allies is
//     NOT modelled (forward-compat TODO).
//   - Element choice: canon lets the caster choose acid/cold/fire/lightning/
//     thunder. v1 always picks FIRE. Forward-compat TODO via the metadata
//     flag `elementalWeaponElementChoiceV1Simplified: true` — "v1 picks
//     fire; canon lets caster choose acid/cold/fire/lightning/thunder."
//   - Per-weapon tracking: v1 does NOT track per-weapon state. The buff is
//     applied to the caster and applies to ALL of the caster's weapon
//     attacks (melee AND ranged). Canon: a specific weapon.
//   - Nonmagical-weapon requirement: v1 does NOT verify the weapon is
//     nonmagical (no per-weapon magic-tracking subsystem).
//   - Upcast: +2/+3 NOT modelled — v1 always grants +1 attack, +1d4 damage.
//   - Duration: canon 1 hr concentration → v1: concentration is started,
//     but NOT enforced (TG-002).
//
// Weapon_enchant pattern (Session 27 Batch 3):
//   The engine's resolveAttack attack-roll branch adds `attackBonus` (+1)
//   to the total; the damage branch rolls `damageDie` (4) × `damageDieCount`
//   (1) of `damageDieType` ('fire') and adds it to every weapon attack.
//   Crit doubles the dice (PHB p.196).
//
// Migration note: Session 27 Batch 3 — migrated from generic forward-compat
// stub to bespoke weapon_enchant self-buff. Previously this spell only
// set a `_genericSpellActiveSpells` flag with no mechanical effect; now
// it applies a real `weapon_enchant` effect with +1 attack and 1d4 fire.
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
  name: 'Elemental Weapon',
  level: 3,
  school: 'transmutation',
  rangeFt: 0,                  // v1: self-buff (canon: touch 5 ft)
  concentration: true,
  castingTime: 'action',
  attackBonus: 1,              // +1 to attack rolls (PHB p.234)
  damageBonus: 0,
  damageDie: 4,                // +1d4 elemental damage per weapon attack
  damageDieCount: 1,
  damageType: 'fire' as DamageType,   // v1 always picks fire
  elementalWeaponCanonV1Implemented: true,
  elementalWeaponElementChoiceV1Simplified: true,   // v1 picks fire; canon lets caster choose acid/cold/fire/lightning/thunder
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
 * Returns true if the caster should cast Elemental Weapon this turn.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating
 *   - Caster has 'Elemental Weapon' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - Caster does NOT already have an active Elemental Weapon weapon_enchant
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Elemental Weapon')) return false;
  if (!hasSpellSlot(caster, 3)) return false;
  if (caster.activeEffects.some(e =>
    e.casterId === caster.id && e.spellName === 'Elemental Weapon'
  )) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Elemental Weapon:
 *  1. Consume a 3rd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Elemental Weapon.
 *  4. Apply a `weapon_enchant` ActiveEffect on the CASTER (self-buff) with
 *     payload.attackBonus=1, payload.damageDie=4, payload.damageDieCount=1,
 *     payload.damageDieType='fire'.
 *     The engine's resolveAttack attack-roll branch adds the +1 attack;
 *     the damage branch rolls 1d4 fire and adds it to every weapon attack
 *     (melee/ranged, NOT spell). Crit doubles the dice (PHB p.196).
 *
 * v1 simplifications: self-buff (canon: touch ally); element fixed to fire
 * (canon: caster chooses); per-weapon NOT tracked; nonmagical-weapon check
 * skipped; upcast NOT modelled; concentration NOT enforced (TG-002).
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 3);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Elemental Weapon');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Elemental Weapon! (+1 attack, +1d4 fire on weapon attacks)`,
    caster.id,
  );

  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Elemental Weapon',
    effectType: 'weapon_enchant',
    payload: {
      attackBonus: 1,
      damageBonus: 0,
      damageDie: 4,
      damageDieCount: 1,
      damageDieType: 'fire',
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${caster.name}'s weapon is enchanted! (+1d4 fire damage on weapon attacks)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
