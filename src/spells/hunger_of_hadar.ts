// ============================================================
// Hunger of Hadar — PHB p.251
//
// 3rd-level conjuration, action, range 150 ft, concentration (1 min).
// Components: V, S, M (a pickled octopus tentacle and a drop of squid ink).
//
// Effect (canon): You open a gateway to the dark between the stars, a region
//                 infested with unknown horrors. A 20-foot-radius sphere of
//                 blackness and bitter cold appears, centered on a point
//                 within range and lasting for the duration. This void is
//                 filled with a cacophony of soft whispers and slurping
//                 noises that can be heard up to 30 feet away. No light,
//                 magical or otherwise, can illuminate the area...
//                 A creature entirely within the void is blinded... Any
//                 creature that starts its turn in the area takes 2d6 cold
//                 damage. If you are inside the area, you are not subject to
//                 this damage. Any creature that ends its turn in the area
//                 takes 2d6 acid damage.
//                 (Upcast: +1d6 per damage type per slot level above 3rd.)
//
// v1 simplifications:
//   - DUAL DAMAGE: canon deals 2d6 cold (start of turn) AND 2d6 acid
//     (end of turn). v1 models BOTH as start-of-turn ticks via TWO
//     damage_zone effects per target:
//       (a) { dieCount: 2, dieSides: 6, damageType: 'cold' }
//       (b) { dieCount: 4, dieSides: 6, damageType: 'acid' }
//     Per task spec, the acid damage is 4d6 (not 2d6) — flag
//     `hungerOfHadarAcidDieV1AdjustedTo4d6`. The engine's damage_zone
//     tick loops all zones on each affected creature independently
//     (backward-compatible — no engine change needed for dual damage).
//   - Strike-point choice: canon the sphere is centered on any point
//     within 150 ft. v1 simplification: the sphere is centered on the
//     highest-threat enemy within 60 ft of the caster (battlefield
//     scale). Flag `hungerOfHadarCenterPointV1SimplifiedTo60Ft`.
//   - Sphere radius: canon 20 ft; v1 uses 20 ft (matches canon).
//   - No save (canon: no save on the cold/acid damage ticks).
//   - Blindness + difficult-terrain + light-obscurement riders NOT
//     modelled. Flag `hungerOfHadarBlindnessAndTerrainV1NotModelled`.
//   - Caster-immunity rider NOT modelled (v1 planner only selects enemies
//     as targets anyway — caster is never a target).
//   - Duration: canon 1 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002).
//   - Upcast: +1d6/slot-level NOT modelled.
//
// Spell module pattern (Session 31 architecture — multi-target center-point zone):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup(_c) — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, DamageType, Vec3 } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Hunger of Hadar',
  level: 3,
  school: 'conjuration',
  rangeFt: 60,           // caster-to-center range (canon: 150 ft)
  aoeSizeFt: 20,         // 20-ft sphere radius (matches canon)
  coldDieCount: 2,
  coldDieSides: 6,
  acidDieCount: 4,
  acidDieSides: 6,
  coldDamageType: 'cold' as const as DamageType,
  acidDamageType: 'acid' as const as DamageType,
  concentration: true,
  castingTime: 'action',
  hungerOfHadarAcidDieV1AdjustedTo4d6: true,             // canon: 2d6 acid; v1: 4d6 (per task spec)
  hungerOfHadarCenterPointV1SimplifiedTo60Ft: true,      // canon: any point within 150 ft; v1: highest-threat enemy within 60 ft
  hungerOfHadarBlindnessAndTerrainV1NotModelled: true,   // blindness + difficult-terrain + light-obscurement riders
  hungerOfHadarUpcastV1Implemented: false,               // +1d6/slot-level not modelled
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

/** Roll `count`d`sides` and return the total. */
export function rollNDice(count: number, sides: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += rollDie(sides);
  return total;
}

/** Roll the cold-damage portion (2d6). */
export function rollColdDamage(): number {
  return rollNDice(metadata.coldDieCount, metadata.coldDieSides);
}

/** Roll the acid-damage portion (4d6). */
export function rollAcidDamage(): number {
  return rollNDice(metadata.acidDieCount, metadata.acidDieSides);
}

// ---- Planner ------------------------------------------------

/**
 * Returns candidate targets for Hunger of Hadar (all living enemies within
 * 20 ft of the highest-threat enemy within 60 ft of the caster, not already
 * affected by this caster's Hunger of Hadar), or null when the spell
 * should not be cast.
 *
 * Target priority:
 *   1. Find the highest-threat (maxHP) living enemy within 60 ft of the
 *      caster — this enemy is the sphere's CENTER.
 *   2. Collect all living enemies within 20 ft of that center.
 *   3. Return those as targets.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on any spell
 *   - Caster has 'Hunger of Hadar' in their actions
 *   - Caster has at least one 3rd-level (or higher) slot available
 *   - At least 1 valid enemy target exists within 60 ft of the caster
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Hunger of Hadar')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  // Step 1: find the center enemy (highest maxHP within 60 ft of caster).
  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > metadata.rangeFt) continue;

    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  const center: Vec3 = candidates[0].c.pos;

  // Step 2: collect all living enemies within 20 ft of the center.
  const targets: Combatant[] = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFromCenter = chebyshev3D(center, c.pos) * 5;
    if (distFromCenter > metadata.aoeSizeFt) continue;

    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Hunger of Hadar'
    )) continue;

    targets.push(c);
  }

  if (targets.length === 0) return null;
  return targets;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Hunger of Hadar:
 *  1. Consume a 3rd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Hunger of Hadar.
 *  4. For each target (enemy within 20 ft of the center):
 *     (a) Roll 2d6 cold + 4d6 acid, apply both immediately (on-cast trigger,
 *         no save).
 *     (b) Apply TWO `damage_zone` effects for persistent start-of-turn
 *         damage (one for cold, one for acid — both sourceIsConcentration:
 *         true). The engine's damage_zone tick loops all zones on each
 *         affected creature independently.
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 3);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Hunger of Hadar');

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Hunger of Hadar! A sphere of blackness opens (${targets.length} enem${targets.length !== 1 ? 'ies' : 'y'}: ${names}) — ${metadata.coldDieCount}d${metadata.coldDieSides} ${metadata.coldDamageType} + ${metadata.acidDieCount}d${metadata.acidDieSides} ${metadata.acidDamageType} per turn, no save`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    // 1. Immediate on-cast damage: 2d6 cold + 4d6 acid (no save).
    const coldDmg = rollColdDamage();
    const acidDmg = rollAcidDamage();
    const dealtCold = applyDamageWithTempHP(target, coldDmg, metadata.coldDamageType);
    const dealtAcid = applyDamageWithTempHP(target, acidDmg, metadata.acidDamageType);
    emit(
      state, 'damage', caster.id,
      `${target.name} takes ${dealtCold} ${metadata.coldDamageType} + ${dealtAcid} ${metadata.acidDamageType} damage from Hunger of Hadar (on cast: ${metadata.coldDieCount}d${metadata.coldDieSides}=${coldDmg} + ${metadata.acidDieCount}d${metadata.acidDieSides}=${acidDmg})`,
      target.id, dealtCold + dealtAcid,
    );

    // 2. Apply TWO damage_zone effects for persistent start-of-turn damage.
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Hunger of Hadar',
      effectType: 'damage_zone',
      payload: {
        dieCount: metadata.coldDieCount,
        dieSides: metadata.coldDieSides,
        damageType: metadata.coldDamageType,
      },
      sourceIsConcentration: true,
    });
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Hunger of Hadar',
      effectType: 'damage_zone',
      payload: {
        dieCount: metadata.acidDieCount,
        dieSides: metadata.acidDieSides,
        damageType: metadata.acidDamageType,
      },
      sourceIsConcentration: true,
    });

    emit(
      state, 'condition_add', caster.id,
      `${target.name} is trapped in the dark void! (will take ${metadata.coldDieCount}d${metadata.coldDieSides} ${metadata.coldDamageType} + ${metadata.acidDieCount}d${metadata.acidDieSides} ${metadata.acidDamageType} at the start of each of its turns)`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
