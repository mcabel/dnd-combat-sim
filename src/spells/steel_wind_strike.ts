// ============================================================
// Steel Wind Strike — XGE p.166
//
// 5th-level conjuration, action, range 30 ft, NO concentration.
// Components: V, S, M (a melee weapon worth at least 1 sp).
//
// Effect: You flourish the weapon used in the casting and then vanish,
//         striking up to 5 different creatures you can see within range.
//         Make a melee spell attack against each target. On a hit, a
//         target takes 6d10 force damage.
//
//         NOTE: XGE p.166 has a "teleport to the last target" rider —
//         v1 simplifies this away (see simplifications).
//
// Upcast: none (XGE p.166: 5th-level only).
//
// v1 simplifications:
//   - Multi-attack: canon allows up to 5 DISTINCT targets within 30 ft.
//     v1 picks up to 5 highest-threat enemies within 30 ft; if fewer
//     than 5 enemies are available, repeats the first (highest-threat)
//     target to fill 5 slots so all 5 attacks have a target. Mirrors
//     Scorching Ray (Session 18) but with 5 attacks instead of 3.
//     Documented via `steelWindStrikeMultiTargetV1Simplified: true`.
//   - Teleport-to-last-target rider (XGE p.166: "you teleport to an
//     unoccupied space you can see within 5 feet of the target"):
//     NOT modelled — v1 has no teleport subsystem. The caster stays put.
//     Documented via `steelWindStrikeTeleportV1Simplified: true`.
//   - Hit bonus: v1 falls back to the action's hitBonus (parser populates
//     it for spell attacks). If null, v1 falls back to abilityMod(caster.int)
//     (Wizard/Ranger primary — Steel Wind Strike is a Ranger/Wizard spell,
//     XGE p.166; INT is a safe default for Wizards). Mirrors Scorching Ray.
//   - Crit DOES double the dice (standard PHB p.196 crit rule for spell
//     attacks). Documented via `steelWindStrikeCritDoublesV1: true`.
//   - NOT concentration (XGE p.166: instantaneous).
//   - Range: 30 ft (NOT adjacency — the spell's range is 30 ft even
//     though it's a "melee" spell attack; the teleport rider explains
//     the reach. v1 uses 30-ft chebyshev range check).
//
// Migration note (Session 24): Mirrors Scorching Ray (Session 18) for
// the multi-attack pattern, but with 5 attacks instead of 3, 6d10 force
// instead of 2d6 fire, 30-ft range instead of 120-ft, "melee" spell
// attacks instead of ranged. Crit DOES double (unlike Scorching Ray,
// which doesn't — Steel Wind Strike's 6d10 are spell dice in the attack,
// so PHB p.196 crit rule applies).
//
// Spell module pattern (multi-attack spell — mirrors scorching_ray.ts):
//   shouldCast(caster, bf) → Combatant[] | null   (5 targets, may repeat)
//   execute(caster, targets, state) → void        (loops 5 times)
//   cleanup() — no-op (no persistent effect)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, rollAttack, applyDamageWithTempHP, abilityMod } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Steel Wind Strike',
  level: 5,
  school: 'conjuration',
  rangeFt: 30,                   // XGE p.166: 30 ft
  attackCount: 5,                // XGE p.166: 5 attacks
  dieCount: 6,
  dieSides: 10,
  damageType: 'force' as const,
  concentration: false,
  castingTime: 'action',
  steelWindStrikeMultiTargetV1Simplified: true,                       // repeats first target if <5 enemies
  steelWindStrikeTeleportV1Simplified: true,                          // teleport-to-last-target NOT modelled
  steelWindStrikeCritDoublesV1: true,                                 // crit doubles the 6d10 (PHB p.196)
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

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

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Steel Wind Strike')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;

    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  const distinct = candidates.slice(0, metadata.attackCount).map(e => e.c);
  const targets: Combatant[] = [];
  for (let i = 0; i < metadata.attackCount; i++) {
    targets.push(distinct[i % distinct.length]);
  }
  return targets;
}

export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Steel Wind Strike');
  const hitBonus = action?.hitBonus ?? abilityMod(caster.int);

  consumeSpellSlot(caster, 5);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Steel Wind Strike! (${metadata.attackCount} melee spell attacks, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} on hit, crit doubles dice)`,
  );

  for (let i = 0; i < metadata.attackCount; i++) {
    const target = targets[i];
    if (!target) continue;

    if (target.isDead || target.isUnconscious) {
      emit(state, 'attack_miss', caster.id, `Strike ${i + 1}: ${target.name} is already down — strike passes through.`, target.id);
      continue;
    }

    const result = rollAttack(hitBonus, false, false);
    const effectiveAC = target.ac;

    if (result.total < effectiveAC && !result.isCrit) {
      emit(
        state, 'attack_miss', caster.id,
        `Strike ${i + 1}: ${caster.name} misses ${target.name} (rolled ${result.roll}+${hitBonus}=${result.total} vs AC ${effectiveAC}) — no force damage!`,
        target.id, result.roll,
      );
      continue;
    }

    emit(
      state, result.isCrit ? 'attack_crit' : 'attack_hit', caster.id,
      `Strike ${i + 1}: ${caster.name} ${result.isCrit ? 'CRITS' : 'hits'} ${target.name} (${result.total} vs AC ${effectiveAC})`,
      target.id, result.roll,
    );

    const dmg = rollDamage(result.isCrit);
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
    emit(
      state, 'damage', caster.id,
      `Strike ${i + 1}: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg}${result.isCrit ? ', CRIT doubled' : ''})`,
      target.id, dealt,
    );
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous.
}
