// ============================================================
// Magic Weapon — PHB p.257
//
// 2nd-level transmutation, action, range Touch, concentration (1 hr).
// Components: V, S.
//
// Effect: You touch a nonmagical weapon. Until the spell ends, that weapon
//         becomes a magic weapon, the chosen type you choose, with a +1
//         bonus to attack rolls and damage rolls.
//
// Upcast: +2 (3rd-4th slot) / +3 (5th-6th slot) — NOT modelled in v1.
//
// v1 simplifications:
//   - Per-weapon tracking: v1 does NOT track per-weapon state. The buff is
//     applied to the WIELDER (the creature whose weapon is enchanted) and
//     applies to ALL of that creature's weapon attacks (melee AND ranged).
//     Canon: a specific weapon. Forward-compat TODO via the metadata flag
//     `magicWeaponPerWeaponV1Implemented: false`.
//   - Nonmagical-weapon requirement: v1 does NOT verify the target's weapon
//     is nonmagical (no per-weapon magic-tracking subsystem). Forward-compat
//     TODO via the metadata flag `magicWeaponNonmagicalCheckV1Implemented: false`.
//   - Upcast: +2/+3 NOT modelled — v1 always grants +1.
//   - Duration: canon 1 hr concentration → v1: concentration is started,
//     but NOT enforced (TG-002). The `weapon_enchant` ActiveEffect persists
//     until removeEffectsFromCaster() is called.
//
// Spell module pattern:
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Magic Weapon',
  level: 2,
  school: 'transmutation',
  rangeFt: 5,       // touch
  bonus: 1,         // +1 to attack AND damage (PHB p.257)
  concentration: true,
  castingTime: 'action',
  magicWeaponPerWeaponV1Implemented: false,                   // per-weapon tracking NOT modelled
  magicWeaponNonmagicalCheckV1Implemented: false,             // nonmagical-weapon check skipped
  magicWeaponUpcastV1Implemented: false,                      // +2/+3 NOT modelled
  magicWeaponConcentrationEnforcementV1Implemented: false,    // see TG-002
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
 * Returns the single best target for Magic Weapon (a living ally within
 * touch range with at least one weapon attack, not already Magic-Weapon'd
 * by this caster), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Self (caster) — if the caster has a weapon attack.
 *   2. Lowest-HP% ally within 5 ft with a weapon attack.
 *
 * Preconditions:
 *   - Caster has 'Magic Weapon' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid ally target exists within 5 ft with a weapon attack
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Magic Weapon')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;

    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Magic Weapon'
    )) continue;

    // Must have a weapon attack to benefit.
    const hasWeaponAttack = c.actions.some(a =>
      a.attackType === 'melee' || a.attackType === 'ranged'
    );
    if (!hasWeaponAttack) continue;

    candidates.push({ c, hpPct: c.currentHP / c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: self first, then lowest HP%, then closest.
  candidates.sort((a, b) => {
    const aSelf = a.c.id === caster.id ? 0 : 1;
    const bSelf = b.c.id === caster.id ? 0 : 1;
    if (aSelf !== bSelf) return aSelf - bSelf;
    if (Math.abs(a.hpPct - b.hpPct) > 0.01) return a.hpPct - b.hpPct;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Magic Weapon:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Magic Weapon.
 *  4. Apply a `weapon_enchant` ActiveEffect on the target with
 *     payload.attackBonus = payload.damageBonus = metadata.bonus (1).
 *     resolveAttack's attack-roll branch adds the attackBonus to the total;
 *     the damage branch adds the damageBonus to weapon damage (melee/ranged,
 *     NOT spell).
 *
 * v1 simplifications: applies to ALL of the wielder's weapon attacks (canon:
 * a specific weapon); nonmagical-weapon check skipped; upcast NOT modelled;
 * concentration NOT enforced (TG-002).
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Magic Weapon');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Magic Weapon on ${target.name}'s weapon! (+${metadata.bonus} to attack and damage rolls)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Magic Weapon',
    effectType: 'weapon_enchant',
    payload: {
      attackBonus: metadata.bonus,
      damageBonus: metadata.bonus,
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name}'s weapon glows with magical energy! (+${metadata.bonus} to attack and damage rolls with weapon attacks)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
