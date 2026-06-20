// ============================================================
// Witch Bolt — PHB p.289
//
// 1st-level evocation, action, range 30 ft, CONCENTRATION (1 min).
// Components: V, S, M (a twig from a tree that has been struck by
// lightning).
//
// Effect: A beam of crackling, blue energy lances out toward a
//         creature within range, forming a sustained arc of lightning
//         between you and the target. Make a ranged spell attack
//         against that creature. On a hit, the target takes 1d12
//         lightning damage, and on each of your turns for the
//         duration, you can use your action to deal 1d12 lightning
//         damage to the target automatically. The spell ends if you
//         use your action for anything else. The spell also ends if
//         the target is ever outside the spell's range or if it has
//         total cover from you.
//
// Upcast: +1d12 damage (initial + DoT) per slot level above 1st
// (not modelled in v1).
//
// v1 simplifications:
//   - Range: canon 30 ft. v1 uses chebyshev3D * 5 for the distance
//     check (square approximation of euclidean range).
//   - Hit bonus: v1 falls back to the action's hitBonus (parser
//     populates it for spell attacks). If null, v1 falls back to
//     abilityMod(caster.cha) (Warlock primary — Witch Bolt is a
//     Warlock spell, PHB p.289). Mirrors the Scorching Ray / Chromatic
//     Orb fallback pattern but with CHA.
//   - Concentration + linked target: v1 stores the linked target's id
//     in `caster.concentration.targetId` (a NEW optional field added
//     to the concentration type in core.ts — backward-compatible).
//     This lets shouldCast + execute identify the DoT target on
//     subsequent turns. Documented via
//     `witchBoltLinkedTargetIdV1Implemented: true`.
//   - DoT (PHB p.289: "on each of your turns ... use your action to
//     deal 1d12 lightning damage automatically"): v1 implements this
//     as a re-fire of the `witchBolt` action while concentration is
//     active. The DoT mode: NO slot consumed, NO attack roll (auto-
//     hit), 1d12 lightning. The planner branch detects "concentrating
//     on Witch Bolt + linked target alive & in range" and emits a
//     `witchBolt` action (DoT mode). Documented via
//     `witchBoltDoTV1Implemented: true`.
//   - "Spell ends if you use your action for anything else" (PHB p.289):
//     v1 enforces this via a guard at the top of executePlannedAction
//     in combat.ts — if the caster is concentrating on Witch Bolt and
//     the planned action is NOT 'witchBolt', Witch Bolt's concentration
//     breaks (logged). Documented via
//     `witchBoltEndsOnOtherActionV1Implemented: true`.
//   - "Target outside range / total cover ends the spell" (PHB p.289):
//     v1 handles the OUT-OF-RANGE case in shouldCast's DoT mode (if the
//     linked target is beyond 30 ft, shouldCast returns null → the
//     planner picks another action → the "ends on other action" guard
//     breaks concentration). Total cover (LOS) is NOT separately
//     modelled (v1's LOS subsystem is separate; Witch Bolt relies on
//     the range check). Documented via
//     `witchBoltTotalCoverV1Simplified: true`.
//   - Duration: canon 1 min (10 rounds). v1 does NOT track the round
//     count — concentration persists until broken (damage / death /
//     other action / target leaves range). This matches v1's general
//     concentration handling. Documented via
//     `witchBoltDurationV1Simplified: true`.
//   - Upcast: +1d12/slot-level NOT modelled — v1 always rolls 1d12
//     (initial + DoT). Forward-compat TODO via
//     `witchBoltUpcastV1Implemented: false`.
//   - Crit on the INITIAL attack DOES double the dice (standard PHB
//     p.196 crit rule for spell attacks). The DoT has no attack roll,
//     so no crit on the DoT.
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 20 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL ranged spell
// attack (initial) + 1d12 lightning + concentration + per-turn action
// DoT. Removed from `_generic_registry.ts`; routed via
// `case 'witchBolt':` in combat.ts and a planner branch in planner.ts.
// This is the FIRST spell in v1 with a per-turn ACTION-DoT gated on
// concentration — a new pattern. Mirrors the Chromatic Orb bespoke
// pattern (Session 21) for the initial attack, plus a NEW
// concentration-DoT pattern (re-fire the action while concentration
// holds, auto-hit, no slot).
//
// Spell module pattern (single-target ranged spell attack +
// concentration + per-turn action DoT — NEW pattern):
//   shouldCast(caster, bf) → Combatant | null   (DoT mode if concentrating)
//   execute(caster, target, state) → void        (DoT mode if concentrating)
//   cleanup(caster) — clears Witch Bolt concentration (called on break)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollAttack, rollDie, applyDamageWithTempHP, abilityMod } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Witch Bolt',
  level: 1,
  school: 'evocation',
  rangeFt: 30,                   // PHB p.289: 30 ft
  dieCount: 1,
  dieSides: 12,
  damageType: 'lightning' as const,
  concentration: true,           // PHB p.289: concentration, 1 min
  castingTime: 'action',
  witchBoltLinkedTargetIdV1Implemented: true,                        // stores targetId in concentration
  witchBoltDoTV1Implemented: true,                                   // per-turn action DoT (auto-hit, no slot)
  witchBoltEndsOnOtherActionV1Implemented: true,                     // combat.ts guard breaks WB on other action
  witchBoltTotalCoverV1Simplified: true,                             // LOS/total-cover NOT separately modelled
  witchBoltDurationV1Simplified: true,                               // 1-min duration NOT tracked (persists till broken)
  witchBoltUpcastV1Implemented: false,                               // +1d12/slot-level NOT modelled
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

/**
 * Roll `metadata.dieCount`d`metadata.dieSides` and return the total.
 * Crit doubles the dice (PHB p.196: "roll the dice twice") — only
 * relevant for the INITIAL attack (the DoT has no attack roll, so no
 * crit).
 */
export function rollDamage(isCrit = false): number {
  let total = 0;
  const rolls = isCrit ? metadata.dieCount * 2 : metadata.dieCount;
  for (let i = 0; i < rolls; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Concentration helpers ----------------------------------

/**
 * True iff `caster` is currently concentrating on Witch Bolt (the DoT
 * is active). Used by shouldCast + execute to pick DoT mode vs fresh
 * cast mode.
 */
function isDoTActive(caster: Combatant): boolean {
  return !!caster.concentration?.active && caster.concentration.spellName === 'Witch Bolt';
}

// ---- Planner ------------------------------------------------

/**
 * Returns the target for Witch Bolt this turn, or null when the spell
 * should not be cast / continued.
 *
 * Two modes:
 *
 *   DoT MODE (caster is already concentrating on Witch Bolt):
 *     - Return the linked target (caster.concentration.targetId) IF it
 *       is alive, not unconscious, and within 30 ft. The DoT will
 *       auto-hit for 1d12 lightning (no slot, no attack).
 *     - If the linked target is down or out of range → return null
 *       (the spell ends — the planner will pick another action, and
 *       the "ends on other action" guard in combat.ts breaks the
 *       concentration).
 *
 *   FRESH CAST MODE (caster is NOT concentrating on Witch Bolt):
 *     - Preconditions: caster has 'Witch Bolt' action, has a 1st-level
 *       slot, and a living enemy within 30 ft.
 *     - Target priority: highest-threat (maxHP) enemy within 30 ft
 *       (tie-break: lowest current HP, then closest). Witch Bolt's
 *       1d12 (avg 6.5) initial + repeatable DoT is best spent on a
 *       high-HP target the caster can keep LOS/range to.
 *
 * Note: Witch Bolt IS concentration — if the caster is concentrating
 * on another spell, a fresh cast will replace it (the engine's
 * concentration setup handles the break). v1 does NOT gate fresh-cast
 * on "not already concentrating on something else" — the caster may
 * choose to drop an existing concentration to start Witch Bolt.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Witch Bolt')) return null;

  // ---- DoT mode ----
  if (isDoTActive(caster)) {
    const linkedId = caster.concentration?.targetId;
    if (!linkedId) return null;             // no linked target recorded (defensive)
    const linked = bf.combatants.get(linkedId);
    if (!linked || linked.isDead || linked.isUnconscious) return null;
    const distFt = chebyshev3D(caster.pos, linked.pos) * 5;
    if (distFt > 30) return null;           // target left range → spell ends
    return linked;
  }

  // ---- Fresh cast mode ----
  if (!hasSpellSlot(caster, 1)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 30) continue;
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
 * Execute Witch Bolt.
 *
 * Two modes (auto-detected from the caster's concentration state):
 *
 *   DoT MODE (caster is already concentrating on Witch Bolt, target is
 *   the linked target):
 *     1. NO slot consumed (the slot was spent on the initial cast).
 *     2. NO attack roll — auto-hit (PHB p.289: "automatically").
 *     3. Roll 1d12 lightning, apply via applyDamageWithTempHP.
 *     4. Log the DoT tick.
 *
 *   FRESH CAST MODE (caster is NOT concentrating on Witch Bolt):
 *     1. Consume a 1st-level spell slot.
 *     2. Roll a ranged spell attack vs the target's AC.
 *     3. On hit: 1d12 lightning damage (crit: 2d12) + START
 *        concentration (store targetId in caster.concentration).
 *     4. On miss: no damage, no concentration started (slot still
 *        consumed — PHB: the slot is spent on the cast, not the hit).
 *     5. Apply via applyDamageWithTempHP; log the attack + damage.
 *
 * v1 simplifications: DoT auto-hit (no attack roll); 1-min duration
 * NOT tracked (persists till broken); "ends on other action" enforced
 * via a combat.ts guard; total-cover/LOS NOT separately modelled
 * (range check only); upcast NOT modelled; crit doubles dice on the
 * INITIAL attack only.
 *
 * @param caster  The casting Combatant (Warlock — PHB p.289)
 * @param target  The target Combatant (must be within 30 ft — shouldCast enforces)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Witch Bolt');
  // Hit bonus: prefer the action's hitBonus. Fall back to CHA mod
  // (Warlock primary — Witch Bolt is a Warlock spell, PHB p.289).
  const hitBonus = action?.hitBonus ?? abilityMod(caster.cha);

  // ---- DoT mode ----
  if (isDoTActive(caster)) {
    // Auto-hit 1d12 lightning, no slot, no attack roll (PHB p.289).
    emit(
      state, 'action', caster.id,
      `${caster.name} sustains Witch Bolt on ${target.name}! (DoT: auto-hit 1d12 ${metadata.damageType}, no slot)`,
      target.id,
    );

    if (target.isDead || target.isUnconscious) {
      // shouldCast already filters this, but re-check defensively.
      emit(
        state, 'action', caster.id,
        `Witch Bolt: ${target.name} is down — the arc dissipates (concentration ends).`,
        target.id,
      );
      caster.concentration = null;
      return;
    }

    const dmg = rollDamage(false);
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
    emit(
      state, 'damage', caster.id,
      `Witch Bolt DoT: ${target.name} takes ${dealt} ${metadata.damageType} damage (1d12=${dmg}, auto-hit)`,
      target.id, dealt,
    );
    return;
  }

  // ---- Fresh cast mode ----
  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Witch Bolt at ${target.name}! (ranged spell attack, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} on hit + concentration DoT, crit doubles dice)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'attack_miss', caster.id,
      `Witch Bolt: ${target.name} is already down — the arc fails to form (slot consumed, no concentration started).`,
      target.id,
    );
    return;
  }

  const result = rollAttack(hitBonus, false, false);
  const effectiveAC = target.ac;

  if (result.total < effectiveAC && !result.isCrit) {
    emit(
      state, 'attack_miss', caster.id,
      `${caster.name} misses ${target.name} with Witch Bolt (rolled ${result.roll}+${hitBonus}=${result.total} vs AC ${effectiveAC}) — no damage, no concentration (slot consumed).`,
      target.id, result.roll,
    );
    return;
  }

  emit(
    state, result.isCrit ? 'attack_crit' : 'attack_hit', caster.id,
    `${caster.name} ${result.isCrit ? 'CRITS' : 'hits'} ${target.name} with Witch Bolt (${result.total} vs AC ${effectiveAC}) — a sustained arc of lightning forms!`,
    target.id, result.roll,
  );

  // 1d12 lightning damage; crit doubles the dice (PHB p.196).
  const dmg = rollDamage(result.isCrit);
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
  emit(
    state, 'damage', caster.id,
    `Witch Bolt: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg}${result.isCrit ? ', CRIT doubled' : ''})`,
    target.id, dealt,
  );

  // Start concentration + link the target (NEW optional targetId field
  // on the concentration type — backward-compatible). If the caster was
  // concentrating on another spell, that concentration is replaced
  // (PHB p.203: only one concentration spell at a time).
  if (caster.concentration?.active && caster.concentration.spellName !== 'Witch Bolt') {
    emit(
      state, 'condition_remove', caster.id,
      `${caster.name}'s concentration on ${caster.concentration.spellName ?? 'a spell'} is replaced by Witch Bolt!`,
    );
  }
  caster.concentration = {
    active: true,
    spellName: 'Witch Bolt',
    dcIfHit: 10,
    targetId: target.id,
  };
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} sustains Witch Bolt on ${target.name} (concentration — ends on damage, death, or using an action for anything else).`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Witch Bolt — clears the Witch Bolt concentration
 * (called when concentration breaks: damage, death, target leaves
 * range, or the caster uses their action for something else via the
 * combat.ts guard).
 *
 * NOTE: v1's concentration-break path (in combat.ts applyDamage +
 * executePlannedAction guard) sets `caster.concentration = null`
 * directly. This cleanup() is a safety net for any future
 * concentration-break dispatcher that calls cleanup() on the spell
 * module. It clears the concentration field if it's Witch Bolt.
 */
export function cleanup(caster: Combatant): void {
  if (caster.concentration?.active && caster.concentration.spellName === 'Witch Bolt') {
    caster.concentration = null;
  }
}
