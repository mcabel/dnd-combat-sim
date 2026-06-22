// ============================================================
// Phantasmal Force — PHB p.264
//
// 2nd-level illusion, action, range 60 ft, concentration (1 min).
// Components: V, S, M (a bit of fleece).
//
// Effect: You craft an illusion that takes root in the mind of a creature
//         that you can see within range. The target must make an
//         Intelligence saving throw. On a failed save, you create a
//         phantasmal object, creature, or other visible phenomenon of
//         your choice that is no larger than a 10-foot cube and that is
//         perceivable only to the target for the spell's duration.
//
//         The target rationalizes any illogical outcomes from interacting
//         with the phantasm. The target treats the phantasm as if it were
//         real. The target can use its action to examine the phantasm with
//         an Intelligence (Investigation) check against your spell save DC.
//         If the check succeeds, the target realizes the phantasm is an
//         illusion, and the spell ends.
//
//         While a target is affected by the spell, the target treats the
//         phantasm as if it were real. The target can take damage from the
//         phantasm. An attacker who was affected at the start of its turn
//         takes 1d6 psychic damage.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - Rationalization: PHB p.264 says "The target rationalizes any
//     illogical outcomes from interacting with the phantasm." v1 has
//     no illogical-outcome subsystem — this rider is moot. Forward-compat
//     TODO via the metadata flag
//     `phantasmalForceRationalizationV1Implemented: false`.
//   - Investigation check to disbelieve: PHB p.264 says "The target can
//     use its action to examine the phantasm with an Intelligence
//     (Investigation) check against your spell save DC. If the check
//     succeeds, the target realizes the phantasm is an illusion, and the
//     spell ends." v1 does NOT model this — the spell ends only when the
//     caster's concentration breaks. (Implicit v1 simplification — no
//     separate flag.)
//   - Persistent damage: PHB p.264 says "An attacker who was affected at
//     the start of its turn takes 1d6 psychic damage." v1 models this as
//     a damage_zone effect with dieCount: 1, dieSides: 6, damageType:
//     'psychic', NO save (illusion damage is automatic). The damage
//     ticks at the start of each of the target's turns (the "start of
//     its turn" trigger).
//   - On cast: INT save. On fail: 1d6 psychic immediately + damage_zone.
//     On success: NO damage, NO damage_zone (target disbelieves).
//   - Duration: canon 1 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002). The damage_zone effect has
//     sourceIsConcentration: true (removed when concentration breaks).
//   - Single-target (PHB p.264: "a creature").
//   - First INT save in the cantrip-z workstream.
//
// Spell module pattern (mirrors flaming_sphere.ts):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Phantasmal Force',
  level: 2,
  school: 'illusion',
  rangeFt: 60,
  dieCount: 1,
  dieSides: 6,
  damageType: 'psychic' as const,
  concentration: true,
  saveAbility: 'int' as const,
  castingTime: 'action',
  phantasmalForceRationalizationV1Implemented: false,             // rationalization NOT modelled
  phantasmalForceUpcastV1Implemented: false,                       // (no upcast entry — placeholder)
  phantasmalForceConcentrationEnforcementV1Implemented: true,     // TG-002 DONE (Session 34)
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

// ---- Dice helper --------------------------------------------

/** Roll `metadata.dieCount`d`metadata.dieSides` and return the total. */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Phantasmal Force (a living enemy
 * within 60 ft, not already Phantasmal-Forced by this caster), or null
 * when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 60 ft — the
 *      persistent 1d6 psychic/turn is most valuable against a high-HP
 *      target. Additionally, low-INT enemies are preferred targets
 *      (high failure rate on the INT save) — v1 simplification: only
 *      threat proxy (maxHP) is used; the AI doesn't check INT score.
 *   2. Tie-break: closest enemy.
 *
 * Preconditions:
 *   - Caster has 'Phantasmal Force' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Phantasmal Force IS concentration — it cannot be cast while
 * concentrating on another spell. The planner gates on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Phantasmal Force')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    // Skip if already Phantasmal-Forced by this caster.
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Phantasmal Force'
    )) continue;

    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Phantasmal Force:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Phantasmal Force.
 *  4. Roll the target's INT save vs the caster's saveDC.
 *     - On FAIL: roll 1d6 psychic damage, apply immediately. Then apply
 *       a `damage_zone` effect (1d6 psychic/turn, NO save — automatic)
 *       for persistent damage at the start of each of the target's turns.
 *     - On SUCCESS: NO damage, NO damage_zone (target disbelieves the
 *       illusion). The spell is wasted (slot consumed, concentration
 *       started — but no effect attached). v1 simplification: the spell
 *       ends effectively immediately on a successful save (no damage_zone
 *       to remove later).
 *
 * v1 simplifications: rationalization NOT modelled; Investigation check
 * to disbelieve NOT modelled; upcast N/A; concentration NOT enforced
 * (TG-002); first INT save in cantrip-z workstream.
 *
 * @param caster  The casting Combatant (Bard/Sorcerer/Warlock/Wizard)
 * @param target  The candidate from shouldCast (single enemy in range)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Phantasmal Force');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Phantasmal Force');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Phantasmal Force at ${target.name}! (DC ${saveDC} INT, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} on fail + persistent)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  // INT save — first INT save in the cantrip-z workstream.
  const save = rollSaveReactable(state, caster, target, 'int', saveDC);

  if (save.success) {
    // Target disbelieves the illusion — NO damage, NO damage_zone.
    emit(
      state, 'save_success', caster.id,
      `${target.name} succeeds on DC ${saveDC} INT save vs Phantasmal Force (rolled ${save.total}) — disbelieves the illusion! No damage, no persistent effect.`,
      target.id, save.roll,
    );
    return;
  }

  // On fail: 1d6 psychic immediately + persistent damage_zone.
  const immediateDmg = rollDamage();
  const dealtImmediate = applyDamageWithTempHP(target, immediateDmg, metadata.damageType);
  emit(
    state, 'save_fail', caster.id,
    `${target.name} fails DC ${saveDC} INT save vs Phantasmal Force (rolled ${save.total}) — ${dealtImmediate} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${immediateDmg})`,
    target.id, save.roll,
  );
  emit(
    state, 'damage', caster.id,
    `${target.name} takes ${dealtImmediate} ${metadata.damageType} damage from Phantasmal Force (on cast)`,
    target.id, dealtImmediate,
  );

  // Persistent damage_zone — 1d6 psychic/turn, NO save (automatic).
  // The illusion's "affected at the start of its turn" trigger is
  // approximated by the damage_zone start-of-turn tick.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Phantasmal Force',
    effectType: 'damage_zone',
    payload: {
      dieCount: metadata.dieCount,
      dieSides: metadata.dieSides,
      damageType: metadata.damageType,
      // NO saveDC / saveAbility — illusion damage is automatic.
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is haunted by a phantasm! (will take ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} at the start of each of its turns, no save)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Phantasmal Force — NO-OP in v1 because:
 *   - Phantasmal Force is a concentration spell; the damage_zone effect
 *     is removed via removeEffectsFromCaster() when concentration breaks.
 *   - v1 does NOT enforce concentration checks (TG-002), so concentration
 *     effectively persists for the entire combat.
 *
 * Exported for symmetry with the other spell modules' cleanup pattern.
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
