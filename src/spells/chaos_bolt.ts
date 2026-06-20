// ============================================================
// Chaos Bolt — XGE p.151
//
// 1st-level evocation, action, range 120 ft, NO concentration.
// Components: V, S.
//
// Effect: You hurl an undulating, warbling mass of chaotic energy at
//         one creature in range. Make a ranged spell attack against
//         the target. On a hit, the target takes 2d8 damage of a type
//         you choose: acid, cold, fire, lightning, poison, or thunder.
//
//         Chaos Burst: If you roll the max on a damage die (an 8),
//         the bolt leaps to a target within 30 ft of the first, using
//         the same attack roll. It can leap this way up to 4 times.
//
// Upcast: +1d8 damage per slot level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Damage type choice: XGE p.151 lets the caster choose the type.
//     v1 picks a RANDOM type from [acid, cold, fire, lightning,
//     poison, thunder] on each cast (chaos flavour). This differs
//     from Chromatic Orb's smart picker — Chaos Bolt is "chaotic" by
//     design, so a random type is on-theme. Documented via
//     `chaosBoltRandomTypeV1Simplified: true`.
//   - Chaos Burst bounce (XGE p.151: "if you roll the max on a damage
//     die, the bolt leaps to a target within 30 ft"): NOT modelled —
//     v1 has no multi-target bounce subsystem. v1 simplification: on a
//     crit, the dice are doubled (standard PHB p.196 crit rule) and the
//     bounce is skipped. Documented via
//     `chaosBoltBounceV1Simplified: true`.
//   - Hit bonus: v1 falls back to the action's hitBonus (parser
//     populates it for spell attacks). If null, v1 falls back to
//     abilityMod(caster.cha) (Sorcerer primary spellcasting — Chaos
//     Bolt is a Sorcerer-only spell, XGE p.151). Mirrors the Scorching
//     Ray / Chromatic Orb fallback pattern but with CHA.
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 2d8.
//     Forward-compat TODO via `chaosBoltUpcastV1Implemented: false`.
//   - NOT a concentration spell (XGE p.151: instantaneous).
//   - Crit DOES double the dice (standard PHB p.196 crit rule for
//     spell attacks — same as Chromatic Orb / Inflict Wounds).
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 20 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL ranged spell
// attack + 2d8 random-type damage. Removed from `_generic_registry.ts`;
// routed via `case 'chaosBolt':` in combat.ts and a planner branch in
// planner.ts. Mirrors the Chromatic Orb bespoke pattern (Session 21)
// but with a random damage-type picker instead of a smart one, 2d8
// instead of 3d8, 120-ft range instead of 90 ft.
//
// Spell module pattern (single-target ranged spell attack — mirrors
// chromatic_orb.ts but with a random type picker, 2d8, 120-ft range):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield, DamageType } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollAttack, rollDie, applyDamageWithTempHP, abilityMod } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Constants ----------------------------------------------

/** The 6 damage types Chaos Bolt can produce, per XGE p.151. */
export const CHAOS_DAMAGE_TYPES: readonly DamageType[] = [
  'acid', 'cold', 'fire', 'lightning', 'poison', 'thunder',
] as const;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Chaos Bolt',
  level: 1,
  school: 'evocation',
  rangeFt: 120,                 // XGE p.151: 120 ft
  dieCount: 2,
  dieSides: 8,
  concentration: false,
  castingTime: 'action',
  chaosBoltRandomTypeV1Simplified: true,                            // random type (chaos flavour)
  chaosBoltBounceV1Simplified: true,                                // chaos-burst bounce NOT modelled
  chaosBoltUpcastV1Implemented: false,                              // +1d8/slot-level NOT modelled
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

// ---- Damage-type picker -------------------------------------

/**
 * Pick a RANDOM damage type for Chaos Bolt (chaos flavour).
 * XGE p.151 lets the caster choose; v1 picks randomly to reflect the
 * "chaotic energy" theme. Each cast rolls a fresh type.
 */
export function pickDamageType(): DamageType {
  const idx = rollDie(CHAOS_DAMAGE_TYPES.length) - 1;   // 1..6 → 0..5
  return CHAOS_DAMAGE_TYPES[idx] as DamageType;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Chaos Bolt (a living enemy within
 * 120 ft), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 120 ft — Chaos
 *      Bolt's 2d8 (avg 9) random-type damage is best spent against a
 *      high-HP target.
 *   2. Tie-break: lowest current HP (more likely to drop the target).
 *
 * Preconditions:
 *   - Caster has 'Chaos Bolt' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 120 ft
 *
 * Note: Chaos Bolt is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Chaos Bolt')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 120) continue;
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
 * Execute Chaos Bolt:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Pick a random damage type (chaos flavour).
 *  3. Roll a ranged spell attack vs the target's AC.
 *  4. On hit: 2d8 <random type> damage. On crit: 4d8 (dice doubled).
 *  5. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *     Warding Bond redirect).
 *  6. Log the attack roll + damage + chosen type.
 *
 * v1 simplifications: random type (chaos flavour, no smart pick);
 * chaos-burst bounce NOT modelled (crit just doubles dice); upcast NOT
 * modelled; NOT concentration; crit DOES double the dice (standard
 * PHB p.196 crit rule for spell attacks).
 *
 * @param caster  The casting Combatant (Sorcerer — Chaos Bolt is
 *                Sorcerer-only per XGE p.151)
 * @param target  The target Combatant (must be within 120 ft — shouldCast enforces)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Chaos Bolt');
  // Hit bonus: prefer the action's hitBonus (parser populates it for
  // spell attacks). Fall back to CHA mod (Sorcerer primary spellcasting
  // — Chaos Bolt is a Sorcerer-only spell, XGE p.151).
  const hitBonus = action?.hitBonus ?? abilityMod(caster.cha);

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Chaos Bolt! (ranged spell attack, ${metadata.dieCount}d${metadata.dieSides} random-type damage on hit, crit doubles dice)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'attack_miss', caster.id,
      `Chaos Bolt: ${target.name} is already down — chaotic energy dissipates.`,
      target.id,
    );
    return;
  }

  const result = rollAttack(hitBonus, false, false);
  const effectiveAC = target.ac;

  if (result.total < effectiveAC && !result.isCrit) {
    emit(
      state, 'attack_miss', caster.id,
      `${caster.name} misses ${target.name} with Chaos Bolt (rolled ${result.roll}+${hitBonus}=${result.total} vs AC ${effectiveAC}) — no damage!`,
      target.id, result.roll,
    );
    return;
  }

  // Pick the chaos damage type for this cast.
  const dmgType = pickDamageType();

  emit(
    state, result.isCrit ? 'attack_crit' : 'attack_hit', caster.id,
    `${caster.name} ${result.isCrit ? 'CRITS' : 'hits'} ${target.name} with Chaos Bolt (${result.total} vs AC ${effectiveAC}) — chaotic energy manifests as ${dmgType.toUpperCase()}!`,
    target.id, result.roll,
  );

  // 2d8 random-type damage; crit doubles the dice (PHB p.196).
  const dmg = rollDamage(result.isCrit);
  const dealt = applyDamageWithTempHP(target, dmg, dmgType);
  emit(
    state, 'damage', caster.id,
    `Chaos Bolt: ${target.name} takes ${dealt} ${dmgType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg}${result.isCrit ? ', CRIT doubled' : ''})`,
    target.id, dealt,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Chaos Bolt — NO-OP because:
 *   - Chaos Bolt is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
