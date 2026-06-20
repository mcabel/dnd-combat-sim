// ============================================================
// Vampiric Touch — PHB p.287
//
// 3rd-level necromancy, action, range Touch (5 ft). Canon:
// concentration, up to 1 minute. v1: concentration simplified to
// one-shot (see simplifications).
// Components: V, S, M (a pinch of powdered wolf hair).
//
// Effect: The touch of your shadow-wreathed hand can siphon life force
//         from others. Make a melee spell attack against a creature
//         within your reach. On a hit, the target takes 3d6 necrotic
//         damage, and you regain hit points equal to half the amount
//         of necrotic damage dealt.
//
//         Canon concentration rider (PHB p.287: "concentration, up to
//         1 minute" — you can repeat the attack on each of your turns
//         as an action): v1 simplifies to a single one-shot attack.
//
// Upcast: +1d6 necrotic per slot level above 3rd (not modelled in v1).
//
// v1 simplifications:
//   - Concentration (PHB p.287: "concentration, up to 1 minute"): v1
//     simplifies this to a one-shot instantaneous attack
//     (concentration: false). The "repeat the attack each turn" rider
//     is NOT modelled — v1 has no per-turn-action-repeat hook (same gap
//     as Witch Bolt's DoT, but Witch Bolt was implemented because its
//     DoT is the spell's PRIMARY effect; Vampiric Touch's repeat is a
//     secondary rider). Documented via
//     `vampiricTouchConcentrationV1Simplified: true`.
//   - Range: canon touch = 5 ft reach. v1 uses a strict 5-ft chebyshev
//     adjacency check (isAdjacent). Mirrors Inflict Wounds.
//   - Hit bonus: v1 falls back to the action's hitBonus (parser
//     populates it for spell attacks). If null, v1 falls back to
//     abilityMod(caster.wis) (Cleric primary — Vampiric Touch is a
//     Cleric/Warlock/Wizard spell, PHB p.287; WIS is a safe default
//     for Clerics, the most common caster). Mirrors Inflict Wounds'
//     fallback pattern. Documented via
//     `vampiricTouchHitBonusWisFallbackV1: true`.
//   - Heal amount: half the ACTUAL necrotic damage dealt (after the
//     target's temp HP / resistance), per PHB p.287 ("half the amount
//     of necrotic damage dealt" — dealt = actually suffered). v1 uses
//     applyHeal(caster, floor(dealt / 2)). Documented via
//     `vampiricTouchHealBasedOnActualDamageV1: true`.
//   - Crit DOES double the dice (standard PHB p.196 crit rule for
//     spell attacks — same as Inflict Wounds). The heal is half the
//     ACTUAL damage (so a crit heal is larger).
//   - Upcast: +1d6/slot-level NOT modelled — v1 always rolls 3d6.
//     Forward-compat TODO via `vampiricTouchUpcastV1Implemented: false`.
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL melee spell
// attack + 3d6 necrotic + heal-caster-half. Removed from
// `_generic_registry.ts`; routed via `case 'vampiricTouch':` in
// combat.ts and a planner branch in planner.ts. Mirrors the Inflict
// Wounds bespoke pattern (Session 21) for the attack + damage, plus a
// NEW heal-caster-half rider (uses applyHeal).
//
// Spell module pattern (single-target melee spell attack + heal rider
// — mirrors inflict_wounds.ts + applyHeal):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (v1 one-shot)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollAttack, rollDie, applyDamageWithTempHP, applyHeal, abilityMod } from '../engine/utils';
import { isAdjacent, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Vampiric Touch',
  level: 3,
  school: 'necromancy',
  rangeFt: 5,                  // PHB p.287: touch = 5 ft reach
  dieCount: 3,
  dieSides: 6,
  damageType: 'necrotic' as const,
  healFraction: 2,               // PHB p.287: heal = half the necrotic dealt
  concentration: false,          // v1 simplification: one-shot (canon is concentration 1 min)
  castingTime: 'action',
  vampiricTouchConcentrationV1Simplified: true,                       // canon concentration simplified to one-shot
  vampiricTouchHitBonusWisFallbackV1: true,                           // hitBonus falls back to WIS (Cleric)
  vampiricTouchHealBasedOnActualDamageV1: true,                       // heal = half actual necrotic dealt
  vampiricTouchUpcastV1Implemented: false,                             // +1d6/slot-level NOT modelled
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
 * Crit doubles the dice (PHB p.196: "roll the dice twice").
 */
export function rollDamage(isCrit = false): number {
  let total = 0;
  const rolls = isCrit ? metadata.dieCount * 2 : metadata.dieCount;
  for (let i = 0; i < rolls; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Vampiric Touch (a living adjacent
 * enemy), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat adjacent enemy (highest maxHP) — Vampiric
 *      Touch's 3d6 (avg 10.5) necrotic + heal-half is best spent on a
 *      high-HP target that will survive to be hit again later (the
//      heal scales with damage dealt).
 *   2. Tie-break: lowest current HP (more likely to drop the target).
 *
 * Preconditions:
 *   - Caster has 'Vampiric Touch' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 5 ft (touch)
 *
 * Note: v1 simplifies Vampiric Touch to NOT concentration (canon is
 * concentration 1 min, but the repeat-attack rider is NOT modelled).
 * The planner should NOT gate on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Vampiric Touch')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number }> = [];

  for (const e of enemies) {
    if (!isAdjacent(caster.pos, e.pos)) continue;
    candidates.push({ c: e, threat: e.maxHP, curHP: e.currentHP });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.curHP - b.curHP;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Vampiric Touch:
 *  1. Consume a 3rd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Roll a melee spell attack vs the target's AC.
 *  3. On hit: 3d6 necrotic damage (crit: 6d6). Heal the CASTER for
 *     half the ACTUAL necrotic damage dealt (after target's temp HP /
//     resistance), via applyHeal.
 *  4. Apply damage via applyDamageWithTempHP; heal via applyHeal.
 *  5. Log the attack roll + damage + heal.
 *
 * v1 simplifications: concentration simplified to one-shot (canon 1 min
 * + repeat-attack rider NOT modelled); hitBonus WIS fallback (Cleric);
 * heal = half actual damage dealt; upcast NOT modelled; crit doubles
 * dice (standard PHB p.196).
 *
 * @param caster  The casting Combatant (Cleric / Warlock / Wizard — PHB p.287)
 * @param target  The target Combatant (must be adjacent — shouldCast enforces)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Vampiric Touch');
  // Hit bonus: prefer the action's hitBonus. Fall back to WIS mod
  // (Cleric primary — Vampiric Touch is a Cleric/Warlock/Wizard spell,
  // PHB p.287; WIS is a safe default for Clerics, the most common caster).
  const hitBonus = action?.hitBonus ?? abilityMod(caster.wis);

  consumeSpellSlot(caster, 3);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Vampiric Touch! (melee spell attack, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} on hit + heal self for half damage, crit doubles dice)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'attack_miss', caster.id,
      `Vampiric Touch: ${target.name} is already down — the touch finds no life to siphon.`,
      target.id,
    );
    return;
  }

  const result = rollAttack(hitBonus, false, false);
  const effectiveAC = target.ac;

  if (result.total < effectiveAC && !result.isCrit) {
    emit(
      state, 'attack_miss', caster.id,
      `${caster.name} misses ${target.name} with Vampiric Touch (rolled ${result.roll}+${hitBonus}=${result.total} vs AC ${effectiveAC}) — no necrotic damage, no heal!`,
      target.id, result.roll,
    );
    return;
  }

  emit(
    state, result.isCrit ? 'attack_crit' : 'attack_hit', caster.id,
    `${caster.name} ${result.isCrit ? 'CRITS' : 'hits'} ${target.name} with Vampiric Touch (${result.total} vs AC ${effectiveAC})`,
    target.id, result.roll,
  );

  // 3d6 necrotic damage; crit doubles the dice (PHB p.196).
  const dmg = rollDamage(result.isCrit);
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
  emit(
    state, 'damage', caster.id,
    `Vampiric Touch: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg}${result.isCrit ? ', CRIT doubled' : ''})`,
    target.id, dealt,
  );

  // Heal the caster for half the ACTUAL necrotic damage dealt (PHB p.287).
  // If the target resisted / had temp HP, the heal is smaller (matches
  // "half the amount of necrotic damage dealt" — dealt = actually suffered).
  const healAmount = Math.floor(dealt / metadata.healFraction);
  if (healAmount > 0) {
    const healed = applyHeal(caster, healAmount);
    emit(
      state, 'heal', caster.id,
      `Vampiric Touch: ${caster.name} siphons ${healed} HP from ${target.name} (half of ${dealt} necrotic dealt)`,
      caster.id, healed,
    );
  } else {
    emit(
      state, 'action', caster.id,
      `Vampiric Touch: ${caster.name} siphons no life (0 necrotic dealt — target immune or fully absorbed).`,
      caster.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Vampiric Touch — NO-OP in v1 because:
 *   - v1 simplifies Vampiric Touch to one-shot (canon concentration 1
 *     min + repeat-attack rider NOT modelled). No persistent effect.
 */
export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot (canon concentration simplified away).
}
