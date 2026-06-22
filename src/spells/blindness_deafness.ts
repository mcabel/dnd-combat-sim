// ============================================================
// Blindness/Deafness — PHB p.219
//
// 2nd-level necromancy, action, range 30 ft, NO concentration.
// Duration: 1 minute.   Components: V only.
//
// Effect: You can blind or deafen a foe. Choose one creature that
//         you can see within range to make a Constitution saving
//         throw. If it fails, the target is either blinded or
//         deafened (your choice) for the duration. At the end of
//         each of its turns, the target can make a Constitution
//         saving throw. On a success, the spell ends.
//
// Upcast: +1 target per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - NO concentration: PHB p.219 is unusual — Blindness/Deafness has a
//     1-minute duration but does NOT require concentration. The condition
//     persists until dispelled or the 1-minute duration expires. v1 has
//     neither a dispel subsystem nor a duration-tracking subsystem; the
//     `condition_apply` effect with `sourceIsConcentration: false`
//     persists for the entire combat. This is a known v1 simplification,
//     documented via the metadata flag
//     `blindnessDeafnessDurationV1Simplified: true`.
//   - End-of-turn CON save to end early: PHB p.219 says "At the end of
//     each of its turns, the target can make a new Constitution saving
//     throw. If the spell is still in effect, the target makes a new
//     Constitution saving throw. On a success, the spell ends." v1 does
//     NOT model this (forward-compat TODO via the metadata flag
//     `blindnessDeafnessEndOfTurnSaveV1Implemented: false`). The
//     condition persists for the entire combat in v1.
//   - Caster choice (blinded vs deafened): v1 ALWAYS picks blinded —
//     more combat-relevant (disadvantage on attacks, attacks vs them
//     have advantage, can't cast spells requiring sight). Deafened is
//     much less impactful in v1's engine (no spell-casting failure on
//     deafened casters, no disadvantage on Perception checks based on
//     hearing). Future work could let the AI pick based on target.
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   metadata → spell stats
//   cleanup() — no-op (NOT a concentration spell; condition persists)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Blindness/Deafness',
  level: 2,
  school: 'necromancy',
  rangeFt: 30,
  concentration: false,         // PHB p.219: NO concentration (unusual!)
  saveAbility: 'con' as const,
  castingTime: 'action',
  v1AlwaysPicks: 'blinded' as const,    // v1: always blinded (more combat-relevant)
  blindnessDeafnessDurationV1Simplified: true,            // 1-min not tracked
  blindnessDeafnessEndOfTurnSaveV1Implemented: false,    // end-of-turn save skipped
  blindnessDeafnessUpcastV1Implemented: false,           // +1 target/slot-level not modelled
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
 * Returns the single best target for Blindness/Deafness (a living enemy
 * within 30 ft, not already blinded or deafened by this caster), or null
 * when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest CR or maxHP) within 30 ft — blinding
 *      the biggest attacker is the most impactful.
 *   2. Tie-break: closest enemy.
 *
 * Preconditions:
 *   - Caster has 'Blindness/Deafness' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 30 ft
 *
 * Note: Blindness/Deafness is NOT concentration — it can be cast while
 * concentrating on another spell (e.g. Bless, Faerie Fire). The planner
 * should NOT gate on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Blindness/Deafness')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;

    // Skip if already blinded or deafened by this caster (re-cast would
    // be wasteful — the condition doesn't stack, and v1 has no end-of-turn
    // save to refresh against).
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Blindness/Deafness'
    )) continue;

    // Skip if target is ALREADY blinded or deafened (from any source) —
    // re-casting adds no value.
    if (c.conditions.has('blinded') || c.conditions.has('deafened')) continue;

    // Threat proxy: maxHP (higher = more dangerous when not blinded).
    // CR would also work but maxHP is universally populated.
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: highest threat first, then closest.
  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Blindness/Deafness:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Roll the target's CON save vs the caster's saveDC.
 *  3. On fail: apply condition_apply:blinded effect on the target.
 *     - v1 ALWAYS picks blinded (more combat-relevant than deafened).
 *     - The effect has sourceIsConcentration: false (PHB p.219: NOT
 *       concentration — the condition persists for the duration even
 *       if the caster is incapacitated, breaks concentration on another
 *       spell, etc.).
 *  4. On success: log the save, no effect applied.
 *
 * v1 simplification: the end-of-turn CON save (PHB p.219: "At the end
 * of each of its turns, the target can make a new Constitution saving
 * throw... On a success, the spell ends.") is NOT modelled. The
 * condition persists for the entire combat. Forward-compat TODO via
 * `blindnessDeafnessEndOfTurnSaveV1Implemented: false`.
 *
 * @param caster  The casting Combatant (Cleric / Sorcerer / Wizard)
 * @param target  The candidate from shouldCast (single enemy in range)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Blindness/Deafness');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Blindness/Deafness at ${target.name}! (DC ${saveDC} CON)`,
    target.id,
  );

  // Re-check liveness (stale edge case)
  if (target.isDead || target.isUnconscious) return;

  const save = rollSaveReactable(state, caster, target, 'con', saveDC);
  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Blindness/Deafness (rolled ${save.total})`,
    target.id,
    save.roll,
  );

  if (save.success) {
    emit(
      state, 'action', caster.id,
      `${target.name} resists Blindness/Deafness — no effect!`,
      target.id,
    );
    return;
  }

  // Apply blinded condition (v1 always picks blinded — see metadata).
  // NOT concentration — sourceIsConcentration: false. The condition
  // persists for the entire combat in v1 (1-min duration not tracked).
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Blindness/Deafness',
    effectType: 'condition_apply',
    payload: { condition: 'blinded' },
    sourceIsConcentration: false,   // PHB p.219: NOT concentration
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is BLINDED! (disadvantage on attacks, advantage on attacks vs them)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Blindness/Deafness — called from resetBudget() at the
 * start of the caster's next turn. NO-OP in v1 because:
 *   - Blindness/Deafness is NOT a concentration spell; the condition
 *     persists for the duration (1 min canon, full combat in v1).
 *   - v1 does NOT model the end-of-turn CON save (PHB p.219).
 *
 * Exported for symmetry with the other spell modules' cleanup pattern.
 * Future work: implement the end-of-turn save by hooking into the
 * target's turn-end (would require a new engine hook in resetBudget
 * or a per-target cleanup pass).
 */
export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; condition persists for v1 combat.
}
