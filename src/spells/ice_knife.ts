// ============================================================
// Ice Knife — XGE p.157
//
// 1st-level conjuration, action, range 60 ft, NO concentration.
// Components: V, S, M (a drop of water or piece of ice).
//
// Effect: You create a shard of ice and fling it at one creature
//         within range. Make a ranged spell attack against the
//         target. On a hit, the target takes 1d10 piercing damage.
//         Hit or miss, the shard then explodes. Each creature within
//         5 feet of the point where the ice exploded must succeed on
//         a Dexterity saving throw, taking 2d6 cold damage on a
//         failed save, or half as much on a successful one.
//
// Upcast: +1d10 piercing AND +1d6 cold per slot level above 1st
//         (not modelled in v1).
//
// v1 simplifications:
//   - Explosion point: PHB/XGE: the explosion is centred on the
//     target's space (the shard hits the target then explodes). v1
//     uses the target's pos as the explosion centre — even on a
//     miss, the shard still explodes at the target's space (XGE
//     p.157: "Hit or miss, the shard then explodes"). This matches
//     the canon "the shard explodes where it hits" interpretation.
//     Documented via `iceKnifeExplosionOnMissV1Implemented: true`.
//   - Hit bonus: v1 falls back to the action's hitBonus (parser
//     populates it for spell attacks). If null, v1 falls back to
//     abilityMod(caster.int) (Wizard primary).
//   - Upcast: +1d10/+1d6 per slot-level NOT modelled — v1 always
//     rolls 1d10 piercing + 2d6 cold. Forward-compat TODO via
//     `iceKnifeUpcastV1Implemented: false`.
//   - NOT a concentration spell (XGE p.157: instantaneous).
//   - Crit: per PHB p.196, the dice in the attack ARE doubled on a
//     crit. v1 DOES double the 1d10 piercing on a crit. The 2d6 cold
//     explosion is a SEPARATE saving throw, NOT an attack roll — so
//     crit doubling does NOT apply to the cold damage (it has its own
//     save-for-half mechanic).
//   - AoE shape: canon 5-ft radius sphere centered on the target.
//     v1 uses chebyshev3D — square approximation of the sphere.
//     Forward-compat TODO via
//     `iceKnifeEuclideanRadiusV1Simplified: true`.
//   - Self-damage: v1 EXCLUDES the caster from the AoE (the shard
//     explodes at the target, not at the caster — XGE p.157 says
//     "within 5 feet of the point where the ice exploded", not "of
//     the caster"). Allies within 5 ft of the target ARE included
//     (the spell does not discriminate — this is canon "each creature
//     within 5 feet"). v1 simplification: only enemies within 5 ft
//     of the target are damaged (no ally-fire modelling for v1).
//     Documented via `iceKnifeAllyFireV1Simplified: true`.
//
// Migration note (Session 21): This spell was BULK-IMPLEMENTED in
// Session 20 as a forward-compat flag (no mechanical effect).
// Session 21 migrated it to a bespoke implementation with REAL
// ranged spell attack + 1d10 piercing + 2d6 cold DEX-save AoE.
// Removed from `_generic_registry.ts`; routed via `case 'iceKnife':`
// in combat.ts and a planner branch in planner.ts. Hybrid pattern —
// combines the Scorching Ray attack-roll pattern (Session 18) with
// the Shatter AoE-save pattern (Session 18).
//
// Spell module pattern (NEW hybrid — attack-roll + AoE-save):
//   shouldCast(caster, bf) → { primary, explosion } | null
//   execute(caster, plan, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollAttack, rollDie, applyDamageWithTempHP, abilityMod } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Ice Knife',
  level: 1,
  school: 'conjuration',
  rangeFt: 60,                 // XGE p.157
  aoeRadiusFt: 5,              // XGE p.157: 5-ft radius sphere
  pierceDieCount: 1,
  pierceDieSides: 10,
  coldDieCount: 2,
  coldDieSides: 6,
  pierceDamageType: 'piercing' as const,
  coldDamageType: 'cold' as const,
  concentration: false,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  iceKnifeExplosionOnMissV1Implemented: true,                      // explodes on hit OR miss
  iceKnifeEuclideanRadiusV1Simplified: true,                       // chebyshev square approx
  iceKnifeAllyFireV1Simplified: true,                              // enemies only
  iceKnifeUpcastV1Implemented: false,                              // +1d10/+1d6 NOT modelled
} as const;

// ---- Types --------------------------------------------------

/**
 * Ice Knife plan returned by shouldCast.
 *   - primary:   the target of the ranged spell attack (1d10 piercing)
 *   - explosion: all enemies within 5 ft of the primary target,
 *                including the primary itself (each takes 2d6 cold,
 *                DEX save for half)
 */
export interface IceKnifePlan {
  primary: Combatant;
  explosion: Combatant[];
}

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

// ---- Dice helpers -------------------------------------------

/** Roll 1d10 piercing (crit doubles — PHB p.196). */
export function rollPierceDamage(isCrit = false): number {
  const rolls = isCrit ? metadata.pierceDieCount * 2 : metadata.pierceDieCount;
  let total = 0;
  for (let i = 0; i < rolls; i++) total += rollDie(metadata.pierceDieSides);
  return total;
}

/** Roll 2d6 cold (no crit — this is a save, not an attack). */
export function rollColdDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.coldDieCount; i++) total += rollDie(metadata.coldDieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the Ice Knife plan (primary target + explosion victims), or
 * null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy within 60 ft — Ice Knife's 1d10 piercing
 *      + 2d6 cold AoE is best aimed at a clustered group's centre.
 *   2. Tie-break: the target with the MOST enemies within 5 ft
 *      (cluster density — maximises AoE damage).
 *   3. Final tie-break: closest to caster.
 *
 * Preconditions:
 *   - Caster has 'Ice Knife' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Ice Knife is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): IceKnifePlan | null {
  if (!caster.actions.some(a => a.name === 'Ice Knife')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{
    primary: Combatant;
    explosion: Combatant[];
    threat: number;
    dist: number;
  }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;

    // Collect all enemies within 5 ft of this candidate (explosion AoE).
    const explosion: Combatant[] = [];
    for (const other of enemies) {
      const dFt = chebyshev3D(e.pos, other.pos) * 5;
      if (dFt <= 5) explosion.push(other);
    }

    candidates.push({
      primary: e,
      explosion,
      threat: e.maxHP,
      dist: distFt,
    });
  }

  if (candidates.length === 0) return null;

  // Sort: highest cluster density first (more explosion victims = better
  // value), then highest threat, then closest.
  candidates.sort((a, b) => {
    if (a.explosion.length !== b.explosion.length) {
      return b.explosion.length - a.explosion.length;
    }
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  return {
    primary: candidates[0].primary,
    explosion: candidates[0].explosion,
  };
}

// ---- Execution ----------------------------------------------

/**
 * Execute Ice Knife:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Roll a ranged spell attack vs the primary target's AC.
 *  3. On hit: 1d10 piercing damage. On crit: 2d10 piercing (dice doubled).
 *  4. Apply piercing via applyDamageWithTempHP (handles resistances / temp HP / Warding Bond).
 *  5. REGARDLESS of hit or miss, the shard explodes: each enemy in
 *     `explosion` (within 5 ft of the primary) makes a DEX save vs
 *     the caster's saveDC. On fail: 2d6 cold. On success: half.
 *  6. Apply cold damage via applyDamageWithTempHP.
 *  7. Log every event (attack roll, pierce damage, save results, cold damage).
 *
 * v1 simplifications: explosion fires on hit OR miss; AoE radius 5 ft
 * (chebyshev square approximation); ally-fire excluded (enemies only);
 * upcast NOT modelled; NOT concentration; crit DOES double the
 * piercing dice (PHB p.196) but NOT the cold dice (save, not attack).
 *
 * @param caster    The casting Combatant (Druid / Sorcerer / Wizard)
 * @param plan      The IceKnifePlan from shouldCast (primary + explosion list)
 * @param state     Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  plan: IceKnifePlan,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Ice Knife');
  // Hit bonus: prefer the action's hitBonus (parser populates it for
  // spell attacks). Fall back to INT mod (Druid/Sorcerer/Wizard primary
  // — INT is the worst fallback but matches Scorching Ray's choice).
  const hitBonus = action?.hitBonus ?? abilityMod(caster.int);
  const saveDC = action?.saveDC ?? 13;

  const { primary, explosion } = plan;

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Ice Knife at ${primary.name}! (ranged spell attack ${metadata.pierceDieCount}d${metadata.pierceDieSides} ${metadata.pierceDamageType}, then ${metadata.coldDieCount}d${metadata.coldDieSides} ${metadata.coldDamageType} DEX save in ${metadata.aoeRadiusFt}-ft radius)`,
    primary.id,
  );

  // ── Phase 1: ranged spell attack vs primary target ──────────────
  let pierceDealt = 0;
  if (!primary.isDead && !primary.isUnconscious) {
    const result = rollAttack(hitBonus, false, false);
    const effectiveAC = primary.ac;

    if (result.total < effectiveAC && !result.isCrit) {
      emit(
        state, 'attack_miss', caster.id,
        `${caster.name} misses ${primary.name} with Ice Knife (rolled ${result.roll}+${hitBonus}=${result.total} vs AC ${effectiveAC}) — no piercing damage!`,
        primary.id, result.roll,
      );
    } else {
      emit(
        state, result.isCrit ? 'attack_crit' : 'attack_hit', caster.id,
        `${caster.name} ${result.isCrit ? 'CRITS' : 'hits'} ${primary.name} with Ice Knife (${result.total} vs AC ${effectiveAC})`,
        primary.id, result.roll,
      );

      // 1d10 piercing damage; crit doubles the dice (PHB p.196).
      const dmg = rollPierceDamage(result.isCrit);
      pierceDealt = applyDamageWithTempHP(primary, dmg, metadata.pierceDamageType);
      emit(
        state, 'damage', caster.id,
        `Ice Knife pierce: ${primary.name} takes ${pierceDealt} ${metadata.pierceDamageType} damage (${metadata.pierceDieCount}d${metadata.pierceDieSides}=${dmg}${result.isCrit ? ', CRIT doubled' : ''})`,
        primary.id, pierceDealt,
      );
    }
  } else {
    emit(
      state, 'attack_miss', caster.id,
      `Ice Knife: ${primary.name} is already down — the shard still explodes!`,
      primary.id,
    );
  }

  // ── Phase 2: cold explosion (fires on hit OR miss — XGE p.157) ───
  // Re-collect the explosion list from the live battlefield (some
  // members may have died from the pierce damage above).
  const liveExplosion = explosion.filter(t => !t.isDead && !t.isUnconscious);

  if (liveExplosion.length === 0) {
    emit(
      state, 'condition_remove', caster.id,
      `Ice Knife: the shard explodes, but no living creatures are within ${metadata.aoeRadiusFt} ft of ${primary.name}.`,
      primary.id,
    );
    return;
  }

  emit(
    state, 'condition_add', caster.id,
    `Ice Knife explodes! ${liveExplosion.length} creature${liveExplosion.length !== 1 ? 's' : ''} within ${metadata.aoeRadiusFt} ft of ${primary.name} must make a DC ${saveDC} DEX save vs ${metadata.coldDieCount}d${metadata.coldDieSides} ${metadata.coldDamageType}.`,
    primary.id,
  );

  for (const target of liveExplosion) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'dex', saveDC);
    const fullDmg = rollColdDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.coldDamageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Ice Knife cold (rolled ${save.total}) — ${dealt} ${metadata.coldDamageType} damage (${metadata.coldDieCount}d${metadata.coldDieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Ice Knife cold: ${target.name} takes ${dealt} ${metadata.coldDamageType} damage`,
      target.id, dealt,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Ice Knife — NO-OP because:
 *   - Ice Knife is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
