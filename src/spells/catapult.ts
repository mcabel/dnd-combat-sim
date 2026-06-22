// ============================================================
// Catapult — XGE p.15
//
// 1st-level transmutation, action, range 60 ft, NO concentration.
// Components: V, S.
//
// Effect: Choose one object weighing 1 to 5 pounds within range that
//         isn't being worn or carried. The object flies in a straight
//         line up to 90 feet in a direction you choose before trying
//         to strike a target. Calculate the spell's damage as 3d8
//         bludgeoning damage. The target takes that damage if the
//         spell succeeds.
//
//         The object stops moving after the spell's effect is
//         resolved, and falls to the ground.
//
// Upcast: +1d8 bludgeoning per slot level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Object selection (XGE p.15: "Choose one object weighing 1 to 5
//     pounds within range that isn't being worn or carried"): NOT
//     modelled — v1 has no object inventory subsystem. v1 assumes
//     the caster always has a suitable projectile (a rock, a coin,
//     a flask, etc.) and skips the object-pick step. Documented via
//     `catapultObjectPickV1Simplified: true`.
//   - Object flight path (XGE p.15: "flies in a straight line up to
//     90 feet in a direction you choose before trying to strike a
//     target"): NOT modelled as a flight path — v1 treats Catapult as
//     a single-target DEX save spell with range 60 ft. The 90-ft
//     flight arc is folded into the 60-ft range (v1 simplification —
//     the projectile's path doesn't matter because we don't model
//     cover or interception). Documented via
//     `catapultFlightPathV1Simplified: true`.
//   - Save type: XGE p.15 is ambiguous about DEX vs STR save; SAC
//     v2.7 confirms DEX (the target tries to dodge the projectile).
//     v1 uses DEX save.
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 3d8
//     bludgeoning. Forward-compat TODO via
//     `catapultUpcastV1Implemented: false`.
//   - NOT a concentration spell (XGE p.15: instantaneous).
//
// Migration note (Session 21): This spell was BULK-IMPLEMENTED in
// Session 20 as a forward-compat flag (no mechanical effect).
// Session 21 migrated it to a bespoke implementation with REAL DEX
// save + 3d8 bludgeoning damage. Removed from `_generic_registry.ts`;
// routed via `case 'catapult':` in combat.ts and a planner branch in
// planner.ts. Mirrors the Shatter bespoke pattern (Session 18) but
// with a single target instead of an AoE.
//
// Spell module pattern (single-target save — mirrors shatter.ts but
// with 1 target instead of an AoE, 3d8 bludgeoning instead of 3d8
// thunder, range 60 ft vs 60 ft):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Catapult',
  level: 1,
  school: 'transmutation',
  rangeFt: 60,                 // XGE p.15: target within 60 ft
  dieCount: 3,
  dieSides: 8,
  damageType: 'bludgeoning' as const,
  concentration: false,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  catapultObjectPickV1Simplified: true,                            // assumes caster has a projectile
  catapultFlightPathV1Simplified: true,                            // 90-ft arc folded into 60-ft range
  catapultUpcastV1Implemented: false,                              // +1d8/slot-level NOT modelled
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
 * Returns the single best target for Catapult (a living enemy within
 * 60 ft), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 60 ft — Catapult's
 *      3d8 (avg 13.5) bludgeoning is best spent against a high-HP
 *      target.
 *   2. Tie-break: lowest current HP (more likely to drop the target).
 *
 * Preconditions:
 *   - Caster has 'Catapult' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Catapult is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Catapult')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    candidates.push({ c: e, threat: e.maxHP, curHP: e.currentHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: highest threat first, then lowest current HP (kill-shot bias),
  // then closest.
  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    if (a.curHP !== b.curHP) return a.curHP - b.curHP;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Catapult:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Roll the target's DEX save vs the caster's saveDC.
 *  3. On fail: 3d8 bludgeoning. On success: half (floor).
 *  4. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *     Warding Bond redirect).
 *  5. Log the save result + damage.
 *
 * v1 simplifications: assumes caster has a projectile (no object
 * inventory); 90-ft flight arc folded into 60-ft range; upcast NOT
 * modelled; NOT concentration.
 *
 * @param caster  The casting Combatant (Sorcerer / Wizard / Artificer)
 * @param target  The target Combatant (must be within 60 ft — shouldCast enforces)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Catapult');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Catapult at ${target.name}! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, half on save)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'save_success', caster.id,
      `Catapult: ${target.name} is already down — projectile sails past.`,
      target.id,
    );
    return;
  }

  const save = rollSaveReactable(state, caster, target, 'dex', saveDC);
  const fullDmg = rollDamage();
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Catapult (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
    target.id, save.roll,
  );
  emit(
    state, 'damage', caster.id,
    `Catapult: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
    target.id, dealt,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Catapult — NO-OP because:
 *   - Catapult is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
