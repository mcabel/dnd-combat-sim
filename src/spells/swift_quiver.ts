// ============================================================
// Swift Quiver — PHB p.279
//
// 5th-level transmutation, bonus action, range Touch (5 ft), concentration
// (1 min). Components: V, S.
//
// Effect: You transmute your quiver so it produces an endless supply of
//         nonmagical ammunition, which seems to leap into your hand when
//         you reach for it. On each of your turns until the spell ends,
//         you can use a bonus action to make one attack with a weapon
//         that uses ammunition from the quiver. The attack deals its
//         normal damage and effects but does NOT add your ability modifier
//         to the damage (unless you have a feature like Sharpshooter).
//
// Upcast: None (PHB p.279 — fixed 1 bonus-action attack per turn).
//
// v1 simplifications:
//   - Self-buff vs. touch: canon is a touch-range spell cast on an ally's
//     quiver. v1 models it as a SELF-BUFF on the caster. Touching allies
//     is NOT modelled.
//   - Bonus-action extra attack: NOT modelled. The engine has no bonus-
//     action-attack subsystem that consumes a weapon_enchant marker. v1
//     applies a `weapon_enchant` ActiveEffect with ALL-ZERO payload fields
//     (`attackBonus: 0, damageBonus: 0` and no damage die) as a MARKER
//     only — it does NOT add any damage or attack bonus. The marker exists
//     to: (a) anchor concentration-break cleanup, (b) make the spell
//     observable in the activeEffects array (so tests/AI can see "caster
//     is under Swift Quiver"), (c) prevent re-casting while active. Forward-
//     compat TODO via the metadata flag `swiftQuiverBonusActionAttackV1NotModelled:
//     true` — "v1: marker effect only; the canon bonus-action extra attack
//     is NOT modelled (no bonus-action-attack subsystem). LOW tactical
//     value in v1."
//   - Endless ammunition: NOT modelled (no ammo-tracking subsystem).
//   - Duration: canon 1 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002).
//
// Weapon_enchant pattern (Session 27 Batch 3):
//   v1 applies a `weapon_enchant` effect with NO damage die and NO bonuses.
//   The engine's resolveAttack does NOT consume any bonus from this effect
//   (all payload fields are 0). The effect is purely a MARKER.
//
// Migration note: Session 27 Batch 3 — migrated from generic forward-compat
// stub to bespoke weapon_enchant self-buff (marker only). Previously this
// spell only set a `_genericSpellActiveSpells` flag; now it applies a
// `weapon_enchant` effect with all-zero bonuses as a marker. The mechanical
// effect (bonus-action extra attack) remains a forward-compat TODO.
//
// Spell module pattern (self-buff):
//   shouldCast(caster, bf) → boolean
//   execute(caster, state) → void
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Swift Quiver',
  level: 5,
  school: 'transmutation',
  rangeFt: 0,                  // v1: self-buff (canon: touch 5 ft)
  concentration: true,
  castingTime: 'bonus action',
  attackBonus: 0,              // marker only — no bonus attack modelled
  damageBonus: 0,
  swiftQuiverCanonV1Implemented: true,
  swiftQuiverBonusActionAttackV1NotModelled: true,    // v1: marker effect only; canon bonus-action extra attack NOT modelled (no bonus-action-attack subsystem). LOW tactical value in v1.
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
 * Returns true if the caster should cast Swift Quiver this turn.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating
 *   - Caster has 'Swift Quiver' in their actions
 *   - Caster has at least one 5th-level-or-higher slot available
 *   - Caster does NOT already have an active Swift Quiver weapon_enchant
 *
 * NOTE: Because the v1 effect is a marker only (no mechanical effect),
 * the AI may rarely want to cast this. The shouldCast gate is kept permissive
 * (returns true when all preconditions are met) so the spell remains
 * dispatchable — the planner's generic-spell loop will pick it as a
 * bonus-action option when no better action exists.
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Swift Quiver')) return false;
  if (!hasSpellSlot(caster, 5)) return false;
  if (caster.activeEffects.some(e =>
    e.casterId === caster.id && e.spellName === 'Swift Quiver'
  )) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Swift Quiver:
 *  1. Consume a 5th-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Swift Quiver.
 *  4. Apply a `weapon_enchant` ActiveEffect on the CASTER (self-buff) with
 *     payload.attackBonus=0, payload.damageBonus=0, NO damageDie fields —
 *     a MARKER ONLY. The engine's resolveAttack consumes nothing from this
 *     effect. The marker exists for concentration-break cleanup, observability,
 *     and re-cast prevention.
 *
 * v1 simplifications: marker only — canon bonus-action extra attack NOT
 * modelled (no bonus-action-attack subsystem). LOW tactical value in v1.
 * Self-buff (canon: touch ally's quiver); endless ammo NOT modelled;
 * concentration NOT enforced (TG-002).
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 5);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Swift Quiver');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Swift Quiver! (v1: marker effect; bonus-action extra attack NOT modelled)`,
    caster.id,
  );

  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Swift Quiver',
    effectType: 'weapon_enchant',
    payload: {
      attackBonus: 0,
      damageBonus: 0,
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${caster.name}'s weapon is enchanted! (v1: marker only — canon bonus-action extra attack NOT modelled)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
