// ============================================================
// Mind Spike — XGE p.162
//
// 2nd-level divination, action, range 60 ft. Canon: concentration,
// up to 1 hour. v1: concentration simplified to false (one-shot —
// see simplifications).
// Components: V, S.
//
// Effect: You reach into the mind of one creature you can see within
//         range. The target must make a Wisdom saving throw, taking
//         3d8 psychic damage on a failed save, or half as much damage
//         on a successful one. On a failed save, you also always know
//         the target's location until the spell ends, even if the
//         target moves or tries to hide.
//
// Upcast: +1d8 psychic per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - Concentration (XGE p.162: "concentration, up to 1 hour"): v1
//     simplifies this to a one-shot instantaneous damage spell
//     (concentration: false). The "know the target's location until
//     the spell ends" rider (a divination tracking effect) is NOT
//     modelled — v1 has no hidden-target tracking subsystem, and the
//     rider has no combat-mechanical effect in v1's open-information
//     model. Documented via `mindSpikeConcentrationV1Simplified: true`.
//   - Range: canon 60 ft. v1 uses chebyshev3D * 5 for the distance
//     check (square approximation of euclidean range).
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 3d8.
//     Forward-compat TODO via `mindSpikeUpcastV1Implemented: false`.
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL WIS save + 3d8
// psychic damage. Removed from `_generic_registry.ts`; routed via
// `case 'mindSpike':` in combat.ts and a planner branch in planner.ts.
// Mirrors the Catapult bespoke pattern (Session 21) but with WIS save,
// 3d8 psychic, L2 slot.
//
// Spell module pattern (single-target save — mirrors catapult.ts):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous in v1)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Mind Spike',
  level: 2,
  school: 'divination',
  rangeFt: 60,                   // XGE p.162: 60 ft
  dieCount: 3,
  dieSides: 8,
  damageType: 'psychic' as const,
  concentration: false,          // v1 simplification: one-shot (canon is concentration 1 hr)
  saveAbility: 'wis' as const,
  castingTime: 'action',
  mindSpikeConcentrationV1Simplified: true,                          // canon concentration simplified to one-shot
  mindSpikeLocationTrackingV1Simplified: true,                      // "know target's location" rider NOT modelled
  mindSpikeUpcastV1Implemented: true,                                // +1d8/slot-level modelled
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

/** Roll `count`d`metadata.dieSides` and return the total. */
export function rollDamage(count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Mind Spike (a living enemy within
 * 60 ft), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 60 ft — Mind Spike's
 *      3d8 (avg 13.5) psychic damage is rarely resisted, best spent on
 *      a high-HP target.
 *   2. Tie-break: lowest current HP (more likely to drop the target).
 *
 * Preconditions:
 *   - Caster has 'Mind Spike' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: v1 simplifies Mind Spike to NOT concentration (canon is
 * concentration 1 hr, but the rider has no v1 combat effect). The
 * planner should NOT gate on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Mind Spike')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    candidates.push({ c: e, threat: e.maxHP, curHP: e.currentHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    if (a.curHP !== b.curHP) return a.curHP - b.curHP;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Mind Spike:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Roll the target's WIS save vs the caster's saveDC.
 *  3. On fail: 3d8 psychic. On success: half (floor).
 *  4. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *     Warding Bond redirect).
 *  5. Log the save result + damage.
 *
 * v1 simplifications: concentration simplified to one-shot (canon 1 hr);
 * location-tracking rider NOT modelled; upcast NOT modelled.
 *
 * @param caster  The casting Combatant (Sorcerer / Warlock / Wizard — XGE p.162)
 * @param target  The target Combatant (must be within 60 ft — shouldCast enforces)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Mind Spike');
  const saveDC = action?.saveDC ?? 13;

  const slotLevel = consumeSpellSlot(caster, 2) ?? 2;
  const diceCount = 3 + Math.max(0, slotLevel - 2);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Mind Spike at L${slotLevel} at ${target.name}! (DC ${saveDC} WIS, ${diceCount}d${metadata.dieSides} ${metadata.damageType}, half on save)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'save_success', caster.id,
      `Mind Spike: ${target.name} is already down — the psychic probe finds no mind to reach.`,
      target.id,
    );
    return;
  }

  const save = rollSaveReactable(state, caster, target, 'wis', saveDC);
  const fullDmg = rollDamage(diceCount);
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Mind Spike (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${diceCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
    target.id, save.roll,
  );
  emit(
    state, 'damage', caster.id,
    `Mind Spike: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
    target.id, dealt,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Mind Spike — NO-OP in v1 because:
 *   - v1 simplifies Mind Spike to one-shot (canon concentration 1 hr is
 *     not tracked). No persistent effect to clean up.
 */
export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot (canon concentration simplified away).
}
