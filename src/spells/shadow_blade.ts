// ============================================================
// Shadow Blade — PHB p.275
//
// 2nd-level illusion, bonus action, range Self, concentration (1 min).
// Components: V, S.
//
// Effect: You weave together threads of shadow to create a sword of
//         solidified gloom in your hand. This magic sword lasts until
//         the spell ends. It counts as a simple melee weapon with which
//         you are proficient. It deals 2d8 psychic damage on a hit.
//         When you cast this spell, you can make one melee attack with
//         the blade as a bonus action — NOT modelled in v1.
//
// Upcast: +1d8 per slot above 2nd (3d8 at 3rd-4th, 4d8 at 5th-6th, etc.)
//         — NOT modelled in v1.
//
// v1 simplifications:
//   - Creates-a-weapon vs. enchants-existing-weapon: canon creates a NEW
//     melee weapon (Shadow Blade) that the caster attacks with; v1 instead
//     approximates this as a `weapon_enchant` rider on the caster's
//     EXISTING weapon attacks (+2d8 psychic per hit, +1 attack roll).
//     Forward-compat TODO via the metadata flag
//     `shadowBladeCreatesWeaponV1Simplified: true` — "canon creates a new
//     weapon; v1 enchants existing weapon."
//   - Bonus-action attack on cast: NOT modelled (no bonus-action-attack
//     subsystem).
//   - Light-property finesse throwing (20/60): NOT modelled.
//   - Upcast: +1d8 per slot — NOT modelled in v1 (always 2d8).
//   - Duration: canon 1 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002).
//
// Weapon_enchant pattern (Session 27 Batch 3):
//   The engine's resolveAttack damage branch consumes `damageDie` ×
//   `damageDieCount` of `damageDieType` and rolls them, adding the result
//   to the weapon's damage (PHB p.196: crit doubles the dice). The
//   `attackBonus` of +1 reflects the caster being "proficient" with the
//   shadow blade (v1 approximation — the canon blade grants proficiency
//   with itself, which v1 models as a flat +1 to existing weapon attacks).
//
// Migration note: Session 27 Batch 3 — migrated from generic forward-compat
// stub to bespoke weapon_enchant self-buff. Previously this spell only
// set a `_genericSpellActiveSpells` flag with no mechanical effect; now
// it applies a real `weapon_enchant` effect with +1 attack and 2d8 psychic.
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
  name: 'Shadow Blade',
  level: 2,
  school: 'illusion',
  rangeFt: 0,                  // self-buff
  concentration: true,
  castingTime: 'bonus action',
  attackBonus: 1,              // v1: approximated proficiency with the blade
  damageBonus: 0,
  damageDie: 8,                // +2d8 psychic per weapon attack (PHB p.275)
  damageDieCount: 2,
  damageType: 'psychic' as DamageType,
  shadowBladeCanonV1Implemented: true,
  shadowBladeCreatesWeaponV1Simplified: true,    // canon creates a new weapon; v1 enchants existing weapon
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
 * Returns true if the caster should cast Shadow Blade this turn.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating
 *   - Caster has 'Shadow Blade' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster does NOT already have an active Shadow Blade weapon_enchant
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Shadow Blade')) return false;
  if (!hasSpellSlot(caster, 2)) return false;
  if (caster.activeEffects.some(e =>
    e.casterId === caster.id && e.spellName === 'Shadow Blade'
  )) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Shadow Blade:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Shadow Blade.
 *  4. Apply a `weapon_enchant` ActiveEffect on the CASTER (self-buff) with
 *     payload.attackBonus=1, payload.damageDie=8, payload.damageDieCount=2,
 *     payload.damageDieType='psychic'.
 *     The engine's resolveAttack attack-roll branch adds the +1 attack;
 *     the damage branch rolls 2d8 psychic and adds it to every weapon
 *     attack (melee/ranged, NOT spell). Crit doubles the dice (PHB p.196).
 *
 * v1 simplifications: creates-a-weapon is approximated as an enchant on
 * the caster's existing weapon (canon: a new weapon); bonus-action attack
 * on cast NOT modelled; upcast NOT modelled; concentration NOT enforced
 * (TG-002).
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Shadow Blade');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Shadow Blade! (+1 attack, +2d8 psychic on weapon attacks)`,
    caster.id,
  );

  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Shadow Blade',
    effectType: 'weapon_enchant',
    payload: {
      attackBonus: 1,
      damageBonus: 0,
      damageDie: 8,
      damageDieCount: 2,
      damageDieType: 'psychic',
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${caster.name}'s weapon is enchanted! (+2d8 psychic damage on weapon attacks)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
