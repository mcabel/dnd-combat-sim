// ============================================================
// Divine Favor — PHB p.234
//
// 1st-level evocation, bonus action, range Self, concentration (1 min).
// Components: V, S.
//
// Effect: Your prayer empowers you with divine radiance. Until the spell
//         ends, your weapon attacks deal an extra 1d4 radiant damage on a
//         hit.
//
// Upcast: None (PHB p.234 — fixed 1d4 at all slot levels).
//
// v1 simplifications:
//   - Self-buff only: canon is "your weapon attacks" — v1 applies the
//     `weapon_enchant` ActiveEffect to the CASTER and the engine consumes
//     it on every weapon attack the caster makes (melee AND ranged, NOT
//     spell). This matches canon exactly (canon doesn't distinguish melee
//     vs ranged — just "your weapon attacks").
//   - Duration: canon 1 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002). The `weapon_enchant` ActiveEffect persists
//     until removeEffectsFromCaster() is called.
//
// Weapon_enchant pattern (Session 27 Batch 3):
//   The engine's resolveAttack damage branch consumes `damageDie` ×
//   `damageDieCount` of `damageDieType` and rolls them, adding the result
//   to the weapon's damage (PHB p.196: crit doubles the dice). The
//   `attackBonus` and `damageBonus` (flat) are 0 for Divine Favor — only
//   the radiant damage die is added.
//
// Migration note: Session 27 Batch 3 — migrated from generic forward-compat
// stub to bespoke weapon_enchant self-buff. Previously this spell only
// set a `_genericSpellActiveSpells` flag with no mechanical effect; now
// it applies a real `weapon_enchant` effect with a 1d4 radiant damage die.
//
// Spell module pattern (self-buff, mirrors magic_weapon.ts but self-only):
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
  name: 'Divine Favor',
  level: 1,
  school: 'evocation',
  rangeFt: 0,                  // self-buff
  concentration: true,
  castingTime: 'bonus action',
  attackBonus: 0,
  damageBonus: 0,
  damageDie: 4,                // +1d4 radiant per weapon attack (PHB p.234)
  damageDieCount: 1,
  damageType: 'radiant' as DamageType,
  divineFavorCanonV1Implemented: true,
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
 * Returns true if the caster should cast Divine Favor this turn.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating (one concentration spell at a time)
 *   - Caster has 'Divine Favor' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - Caster does NOT already have an active Divine Favor weapon_enchant
 *     (re-cast would be a waste — the effect doesn't stack with itself)
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Divine Favor')) return false;
  if (!hasSpellSlot(caster, 1)) return false;
  if (caster.activeEffects.some(e =>
    e.casterId === caster.id && e.spellName === 'Divine Favor'
  )) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Divine Favor:
 *  1. Consume a 1st-level spell slot.
 *  2. Break any existing concentration (safety net — planner should prevent).
 *  3. Start concentration on Divine Favor.
 *  4. Apply a `weapon_enchant` ActiveEffect on the CASTER (self-buff) with
 *     payload.damageDie=4, payload.damageDieCount=1, payload.damageDieType='radiant'.
 *     The engine's resolveAttack damage branch rolls the 1d4 radiant and adds
 *     it to every weapon attack (melee/ranged, NOT spell). Crit doubles the
 *     die (PHB p.196).
 *
 * v1 simplifications: concentration NOT enforced (TG-002); self-buff applies
 * to ALL of the caster's weapon attacks (canon: "your weapon attacks" —
 * matches canon exactly).
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 1);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Divine Favor');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Divine Favor! (+1d4 radiant on weapon attacks)`,
    caster.id,
  );

  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Divine Favor',
    effectType: 'weapon_enchant',
    payload: {
      attackBonus: 0,
      damageBonus: 0,
      damageDie: 4,
      damageDieCount: 1,
      damageDieType: 'radiant',
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${caster.name}'s weapon is enchanted! (+1d4 radiant damage on weapon attacks)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
