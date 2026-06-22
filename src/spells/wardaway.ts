// ============================================================
// Wardaway — (homebrew / 3rd-party source; v1 spells DB entry)
//
// 1st-level abjuration, action, range 60 ft, NO concentration.
// Components: V, S, M (a sprig of holly or a small silver mirror).
//
// Effect: You project a burst of warding force at one creature within
//         range. The target must make a Constitution saving throw. On
//         a failed save, the target takes 2d4 force damage and is
//         pushed 5 feet away from you. On a successful save, the
//         target takes half as much damage and isn't pushed.
//
//         Constructs and undead automatically succeed on this saving
//         throw (warding power has no effect on creatures without
//         living essence).
//
// Upcast: +1d4 force per slot level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Range: canon 60 ft. v1 uses chebyshev3D * 5 for the distance
//     check (square approximation of euclidean range).
//   - Construct/undead auto-succeed (source: "Constructs and undead
//     automatically succeed"): NOT modelled — v1 has no creature-type
//     tag on Combatant. The auto-success clause is simplified away
//     (all targets roll the CON save normally). Documented via
//     `wardawayConstructUndeadAutoSucceedV1Simplified: true`.
//   - Push 5 ft on failed save (source: "pushed 5 feet away from you"):
//     NOT modelled — v1's push subsystem is limited; v1 applies the
//     damage + save but skips the forced movement. Documented via
//     `wardawayPush5ftV1Simplified: true`.
//   - Upcast: +1d4/slot-level NOT modelled — v1 always rolls 2d4.
//     Forward-compat TODO via `wardawayUpcastV1Implemented: false`.
//   - NOT a concentration spell (instantaneous).
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 20 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL CON save + 2d4
// force single-target damage. Removed from `_generic_registry.ts`;
// routed via `case 'wardaway':` in combat.ts and a planner branch in
// planner.ts. Mirrors the Catapult bespoke pattern (Session 21) but
// with CON save (vs DEX), 2d4 force (vs 3d8 bludgeoning).
//
// Spell module pattern (single-target save — mirrors catapult.ts but
// with CON save, 2d4 force, 60-ft range):
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
  name: 'Wardaway',
  level: 1,
  school: 'abjuration',
  rangeFt: 60,                   // source: 60 ft
  dieCount: 2,
  dieSides: 4,
  damageType: 'force' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  wardawayConstructUndeadAutoSucceedV1Simplified: true,             // no creature-type tag in v1
  wardawayPush5ftV1Simplified: true,                                // forced movement NOT modelled
  wardawayUpcastV1Implemented: false,                               // +1d4/slot-level NOT modelled
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
 * Returns the single best target for Wardaway (a living enemy within
 * 60 ft), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 60 ft — Wardaway's
 *      2d4 (avg 5) force damage is modest, but force is rarely
 *      resisted, making it a reliable chip against high-HP targets.
 *   2. Tie-break: lowest current HP (more likely to drop the target).
 *
 * Preconditions:
 *   - Caster has 'Wardaway' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Wardaway is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 *
 * v1 simplification: the construct/undead auto-succeed clause is NOT
 * applied (no creature-type tag) — shouldCast may return a construct
 * or undead target, which then rolls the CON save normally.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Wardaway')) return null;
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
 * Execute Wardaway:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Roll the target's CON save vs the caster's saveDC.
 *  3. On fail: 2d4 force. On success: half (floor).
 *  4. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *     Warding Bond redirect).
 *  5. Log the save result + damage.
 *
 * v1 simplifications: construct/undead auto-succeed NOT applied;
 * push-5-ft on fail NOT modelled; upcast NOT modelled; NOT
 * concentration.
 *
 * @param caster  The casting Combatant
 * @param target  The target Combatant (must be within 60 ft — shouldCast enforces)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Wardaway');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Wardaway at ${target.name}! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, half on save)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'save_success', caster.id,
      `Wardaway: ${target.name} is already down — warding force fizzles.`,
      target.id,
    );
    return;
  }

  const save = rollSaveReactable(state, caster, target, 'con', saveDC);
  const fullDmg = rollDamage();
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Wardaway (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
    target.id, save.roll,
  );
  emit(
    state, 'damage', caster.id,
    `Wardaway: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
    target.id, dealt,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Wardaway — NO-OP because:
 *   - Wardaway is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
