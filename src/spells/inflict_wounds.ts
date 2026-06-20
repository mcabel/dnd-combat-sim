// ============================================================
// Inflict Wounds — PHB p.253
//
// 1st-level necromancy, action, range Touch (5 ft), NO concentration.
// Components: V, S.
//
// Effect: Make a melee spell attack against a creature you can reach.
//         On a hit, the target takes 3d10 necrotic damage.
//
// Upcast: +1d10 necrotic per slot level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Range: canon touch = 5 ft reach. v1 uses a strict 5-ft chebyshev
//     adjacency check (isAdjacent). The caster must be next to the
//     target to cast. Forward-compat TODO via the metadata flag
//     `inflictWoundsReachExtensionV1Simplified: true`.
//   - Hit bonus: v1 falls back to the action's hitBonus (already
//     populated by the parser for spell attacks). If null, v1 falls
//     back to abilityMod(caster.wis) — Cleric's primary spellcasting
//     ability. Forward-compat TODO via
//     `inflictWoundsHitBonusFromActionV1Implemented: true`.
//   - Upcast: +1d10/slot-level NOT modelled — v1 always rolls 3d10
//     necrotic. Forward-compat TODO via
//     `inflictWoundsUpcastV1Implemented: false`.
//   - NOT a concentration spell (PHB p.253: instantaneous).
//   - Crit: per PHB p.196, the dice in the attack ARE doubled on a
//     crit. v1 DOES double the 3d10 on a crit (uses rollDamage with
//     isCrit=true — see the execute() body). This differs from
//     Scorching Ray, where the spell-dice crit rule is debatable;
//     Inflict Wounds follows the standard "roll the dice twice on
//     crit" rule for melee spell attacks.
//
// Migration note (Session 21): This spell was BULK-IMPLEMENTED in
// Session 20 as a forward-compat flag (no mechanical effect).
// Session 21 migrated it to a bespoke implementation with REAL melee
// spell attack + 3d10 necrotic damage. Removed from
// `_generic_registry.ts`; routed via `case 'inflictWounds':` in
// combat.ts and a planner branch in planner.ts. Mirrors the Scorching
// Ray bespoke pattern (Session 18) but with a single-target melee
// spell attack instead of 3 ranged spell attacks.
//
// Spell module pattern (single-target melee spell attack — mirrors
// scorching_ray.ts but with 1 attack instead of 3, melee reach 5 ft
// instead of ranged 120 ft, 3d10 necrotic instead of 2d6 fire):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollAttack, rollDie, applyDamageWithTempHP, abilityMod } from '../engine/utils';
import { isAdjacent, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Inflict Wounds',
  level: 1,
  school: 'necromancy',
  rangeFt: 5,                  // PHB p.253: touch = 5 ft reach
  dieCount: 3,
  dieSides: 10,
  damageType: 'necrotic' as const,
  concentration: false,
  castingTime: 'action',
  inflictWoundsReachExtensionV1Simplified: true,                   // strict 5-ft adjacency
  inflictWoundsHitBonusFromActionV1Implemented: true,              // uses action.hitBonus
  inflictWoundsUpcastV1Implemented: false,                         // +1d10/slot-level NOT modelled
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
 * Returns the single best target for Inflict Wounds (a living
 * adjacent enemy), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat adjacent enemy (highest maxHP) — Inflict
 *      Wounds' 3d10 (avg 16.5) necrotic is best spent against a
 *      high-HP target that will survive to be hit again later.
 *   2. Tie-break: lowest current HP (more likely to drop the target).
 *
 * Preconditions:
 *   - Caster has 'Inflict Wounds' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 5 ft (touch)
 *
 * Note: Inflict Wounds is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Inflict Wounds')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number }> = [];

  for (const e of enemies) {
    if (!isAdjacent(caster.pos, e.pos)) continue;
    candidates.push({ c: e, threat: e.maxHP, curHP: e.currentHP });
  }

  if (candidates.length === 0) return null;

  // Sort: highest threat first, then lowest current HP (kill-shot bias).
  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.curHP - b.curHP;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Inflict Wounds:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Roll a melee spell attack vs the target's AC.
 *  3. On hit: 3d10 necrotic damage. On crit: 6d10 necrotic (dice doubled).
 *  4. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *     Warding Bond redirect).
 *  5. Log the attack roll + damage.
 *
 * v1 simplifications: strict 5-ft adjacency (no reach extension);
 * upcast NOT modelled; NOT concentration; crit DOES double the dice
 * (standard PHB p.196 crit rule for spell attacks).
 *
 * @param caster  The casting Combatant (Cleric / Paladins via oath /
 *                some Warlock patrons, etc.)
 * @param target  The target Combatant (must be adjacent — shouldCast enforces)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Inflict Wounds');
  // Hit bonus: prefer the action's hitBonus (parser populates it for
  // spell attacks). Fall back to WIS mod (Cleric primary spellcasting)
  // if hitBonus is null — this matches the Scorching Ray fallback
  // pattern (which uses INT mod for Wizard).
  const hitBonus = action?.hitBonus ?? abilityMod(caster.wis);

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Inflict Wounds! (melee spell attack, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} on hit, crit doubles dice)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'attack_miss', caster.id,
      `Inflict Wounds: ${target.name} is already down — spell fizzles.`,
      target.id,
    );
    return;
  }

  const result = rollAttack(hitBonus, false, false);
  const effectiveAC = target.ac;

  if (result.total < effectiveAC && !result.isCrit) {
    emit(
      state, 'attack_miss', caster.id,
      `${caster.name} misses ${target.name} with Inflict Wounds (rolled ${result.roll}+${hitBonus}=${result.total} vs AC ${effectiveAC}) — no necrotic damage!`,
      target.id, result.roll,
    );
    return;
  }

  emit(
    state, result.isCrit ? 'attack_crit' : 'attack_hit', caster.id,
    `${caster.name} ${result.isCrit ? 'CRITS' : 'hits'} ${target.name} with Inflict Wounds (${result.total} vs AC ${effectiveAC})`,
    target.id, result.roll,
  );

  // 3d10 necrotic damage; crit doubles the dice (PHB p.196).
  const dmg = rollDamage(result.isCrit);
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
  emit(
    state, 'damage', caster.id,
    `Inflict Wounds: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg}${result.isCrit ? ', CRIT doubled' : ''})`,
    target.id, dealt,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Inflict Wounds — NO-OP because:
 *   - Inflict Wounds is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
