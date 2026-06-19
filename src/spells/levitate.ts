// ============================================================
// Levitate — PHB p.255
//
// 2nd-level transmutation, action, range 60 ft, concentration (10 min).
// Components: V, S, M (a small leather loop or a piece of golden wire).
//
// Effect: One creature or object of your choice that you can see within
//         range rises vertically, up to 20 feet, and remains suspended
//         there for the duration. The spell can levitate a target that
//         weighs up to 500 pounds. The spell ends if the target leaves
//         the spell's range.
//
//         A creature can use its action to make a Constitution saving
//         throw against this spell, ending the effect on itself on a
//         success.
//
//         If the caster is the target, the caster can mentally direct
//         the spell to move up or down as much as 20 feet each round.
//         Otherwise, the caster can use their action to move the target
//         up or down.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - Condition model: canon Levitate does NOT impose a standard 5e
//     condition — the target can still attack (just can't move horizontally).
//     v1 models Levitate as the `restrained` condition (closest PHB
//     condition — speed 0, attacks vs target have advantage, target has
//     disadvantage on attacks/Dex saves). This is a v1 simplification —
//     `restrained` is slightly MORE punishing than canon Levitate (canon
//     doesn't impose attack disadv or attacks-vs-adv). Documented via the
//     metadata flag `levitateAsRestrainedV1Simplified: true`. The closest
//     alternative would be a custom `levitating` condition, but adding a
//     new condition is out of scope for this batch.
//   - End-of-turn CON save: v1 does NOT model the "creature can use its
//     action to make a CON save to end the effect" rider (forward-compat
//     TODO via the metadata flag `levitateEndOfTurnSaveV1Implemented: false`).
//   - Vertical movement: v1 does NOT model the caster directing the target
//     up or down (no positional Z-axis subsystem for spells). Forward-compat
//     TODO via the metadata flag `levitateVerticalMovementV1Implemented: false`.
//   - Object targeting: v1 targets creatures only (no object-tracking).
//   - Duration: canon 10 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002). The restrained condition persists until
//     removeEffectsFromCaster() is called.
//
// Spell module pattern:
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Levitate',
  level: 2,
  school: 'transmutation',
  rangeFt: 60,
  concentration: true,
  saveAbility: 'con' as const,
  castingTime: 'action',
  levitateAsRestrainedV1Simplified: true,                     // modeled as restrained (closest PHB condition)
  levitateEndOfTurnSaveV1Implemented: false,                  // end-of-turn CON save NOT modelled
  levitateVerticalMovementV1Implemented: false,               // vertical movement NOT modelled
  levitateObjectTargetingV1Implemented: false,                // objects NOT targeted
  levitateConcentrationEnforcementV1Implemented: false,       // see TG-002
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
 * Returns the single best target for Levitate (a living enemy within 60 ft,
 * not already restrained/levitating, not already Levitate'd by this caster),
 * or null when the spell should not be cast.
 *
 * Target priority: highest-threat enemy (maxHP) within 60 ft — removing the
 * biggest attacker's movement is the most impactful.
 *
 * Preconditions:
 *   - Caster has 'Levitate' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 60 ft
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Levitate')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    // Skip if already restrained/levitating (no stacking).
    if (c.conditions.has('restrained') || c.conditions.has('incapacitated')) continue;

    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Levitate'
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
 * Execute Levitate:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Levitate.
 *  4. Roll the target's CON save vs the caster's saveDC.
 *  5. On fail: apply condition_apply:restrained effect on the target.
 *     - v1 simplification: Levitate is modeled as the `restrained`
 *       condition (closest PHB condition — speed 0, attacks vs target have
 *       advantage, target has disadvantage on attacks/Dex saves). Canon
 *       Levitate does NOT impose attack disadv or attacks-vs-adv.
 *     - The effect has sourceIsConcentration: true (removed when the
 *       caster's concentration breaks).
 *  6. On success: log the save, no effect applied.
 *
 * v1 simplifications: modeled as restrained; end-of-turn CON save NOT
 * modelled; vertical movement NOT modelled; concentration NOT enforced (TG-002).
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Levitate');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Levitate');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Levitate at ${target.name}! (DC ${saveDC} CON)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'con', saveDC);
  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Levitate (rolled ${save.total})`,
    target.id, save.roll,
  );

  if (save.success) {
    emit(
      state, 'action', caster.id,
      `${target.name} resists Levitate — not lifted!`,
      target.id,
    );
    return;
  }

  // Apply restrained condition (v1 simplification — canon Levitate doesn't
  // impose a standard condition, but restrained is the closest model).
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Levitate',
    effectType: 'condition_apply',
    payload: { condition: 'restrained' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is LEVITATING! (v1: modeled as restrained — speed 0, attacks vs them have advantage, they have disadv on attacks/Dex saves)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
