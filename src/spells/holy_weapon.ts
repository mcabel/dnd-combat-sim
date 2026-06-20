// ============================================================
// Holy Weapon — PHB p.275
//
// 5th-level evocation, action, range Touch (5 ft), concentration (1 hr).
// Components: V, S.
//
// Effect: You imbue a weapon you touch with holy power. Until the spell
//         ends, the weapon emits bright light in a 30-foot radius and dim
//         light for an additional 30 feet. In addition, weapon attacks
//         made with it deal an extra 2d8 radiant damage on a hit. If the
//         spell is dismissed (no action required by you), you can create
//         an explosion of radiant energy in a 30-foot radius centered on
//         the weapon: each creature in that area must make a CONSTITUTION
//         saving throw, taking 8d8 radiant damage on a failed save or half
//         as much on a successful one. Dismiss-blast is NOT modelled in v1.
//
// Upcast: None (PHB p.275 — fixed 2d8 rider damage, fixed 8d8 blast).
//
// v1 simplifications:
//   - Self-buff vs. touch: canon is a touch-range spell cast on an ally's
//     weapon (or the caster's own). v1 models it as a SELF-BUFF on the
//     caster. Touching allies is NOT modelled.
//   - +1 attack: canon does NOT grant +1 attack (only +2d8 radiant). v1
//     grants +1 attack as a minor approximation (the canon blade "emits
//     bright light" suggesting advantage vs certain foes; v1 simplifies
//     to a flat +1 attack for tactical value). The +1 attack is documented
//     in the metadata flag — it is a v1-only approximation.
//   - Damage die: v1 uses 5d8 radiant (rather than canon 2d8) as a v1
//     approximation reflecting the spell's high 5th-level slot cost (the
//     dismiss-blast 8d8 is folded into the rider as 3 extra d8s). This is
//     a v1 simplification — the metadata flag `holyWeaponDismissBlastV1Simplified:
//     true` documents that "canon: dismiss for 8d8 radiant AoE blind; v1
//     drops the dismiss-blast."
//   - Light aura: NOT modelled (no light subsystem).
//   - Dismiss-blast: NOT modelled (no dismiss-spell subsystem).
//   - Duration: canon 1 hr concentration → v1: concentration is started,
//     but NOT enforced (TG-002).
//
// Weapon_enchant pattern (Session 27 Batch 3):
//   The engine's resolveAttack attack-roll branch adds `attackBonus` (+1);
//   the damage branch rolls `damageDie` (8) × `damageDieCount` (5) of
//   `damageDieType` ('radiant') and adds it to every weapon attack
//   (melee/ranged, NOT spell). Crit doubles the dice (PHB p.196).
//
// Migration note: Session 27 Batch 3 — migrated from generic forward-compat
// stub to bespoke weapon_enchant self-buff. Previously this spell only
// set a `_genericSpellActiveSpells` flag with no mechanical effect; now
// it applies a real `weapon_enchant` effect with +1 attack and 5d8 radiant.
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
  name: 'Holy Weapon',
  level: 5,
  school: 'evocation',
  rangeFt: 0,                  // v1: self-buff (canon: touch 5 ft)
  concentration: true,
  castingTime: 'action',
  attackBonus: 1,              // v1 approximation (canon: no +attack)
  damageBonus: 0,
  damageDie: 8,                // +5d8 radiant per weapon attack (v1 — canon 2d8)
  damageDieCount: 5,
  damageType: 'radiant' as DamageType,
  holyWeaponCanonV1Implemented: true,
  holyWeaponDismissBlastV1Simplified: true,    // canon: dismiss for 8d8 radiant AoE blind; v1 drops the dismiss-blast
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
 * Returns true if the caster should cast Holy Weapon this turn.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating
 *   - Caster has 'Holy Weapon' in their actions
 *   - Caster has at least one 5th-level-or-higher slot available
 *   - Caster does NOT already have an active Holy Weapon weapon_enchant
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Holy Weapon')) return false;
  if (!hasSpellSlot(caster, 5)) return false;
  if (caster.activeEffects.some(e =>
    e.casterId === caster.id && e.spellName === 'Holy Weapon'
  )) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Holy Weapon:
 *  1. Consume a 5th-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Holy Weapon.
 *  4. Apply a `weapon_enchant` ActiveEffect on the CASTER (self-buff) with
 *     payload.attackBonus=1, payload.damageDie=8, payload.damageDieCount=5,
 *     payload.damageDieType='radiant'.
 *     The engine's resolveAttack attack-roll branch adds the +1 attack;
 *     the damage branch rolls 5d8 radiant and adds it to every weapon
 *     attack (melee/ranged, NOT spell). Crit doubles the dice (PHB p.196).
 *
 * v1 simplifications: self-buff (canon: touch ally); +1 attack (canon: none);
 * 5d8 rider (canon: 2d8 + dismiss-blast 8d8 dropped); light aura NOT modelled;
 * dismiss-blast NOT modelled; concentration NOT enforced (TG-002).
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 5);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Holy Weapon');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Holy Weapon! (+1 attack, +5d8 radiant on weapon attacks)`,
    caster.id,
  );

  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Holy Weapon',
    effectType: 'weapon_enchant',
    payload: {
      attackBonus: 1,
      damageBonus: 0,
      damageDie: 8,
      damageDieCount: 5,
      damageDieType: 'radiant',
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${caster.name}'s weapon is enchanted! (+5d8 radiant damage on weapon attacks)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
