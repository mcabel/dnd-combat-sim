// ============================================================
// Cordon of Arrows — PHB p.228
//
// 2nd-level transmutation, action, range 5 ft, NO concentration (1 min).
// Duration: 1 minute.   Components: V, S, M (four or more arrows or bolts).
//
// Effect: You plant four pieces of nonmagical ammunition (arrows or bolts)
//         in the ground within range and lay illusion upon them to conceal
//         them. Until the spell ends, you can use your bonus action to make
//         one piece of ammunition fly into the air and shoot at one
//         creature you can see within 30 feet of the piece of ammunition,
//         using your spell attack modifier. On a hit, the target takes
//         1d6 piercing damage. The piece of ammunition is then destroyed.
//
//         The spell ends when no ammunition remains.
//
// Upcast: +2 pieces per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - Pieces of ammunition: canon 4 pieces (PHB p.228). v1 models this as
//     a damage_zone effect with `ticksRemaining: 4` — 4 ticks at the start
//     of the target's turns, then the effect is removed. Each tick deals
//     1d6 piercing with a DEX save for half (v1 simplification — canon uses
//     a ranged spell ATTACK, not a save; v1 uses a save for consistency
//     with Flaming Sphere and the damage_zone save mechanic. Documented via
//     the metadata flag `cordonOfArrowsSaveVsAttackV1Simplified: true`).
//   - Bonus-action trigger: canon: the caster uses a bonus action on each
//     subsequent turn to fire a piece. v1: the damage ticks automatically
//     at the start of the TARGET's turn (not the caster's bonus action).
//     This is a v1 timing simplification. Forward-compat TODO via the
//     metadata flag `cordonOfArrowsBonusActionTriggerV1Implemented: false`.
//   - Targeting: canon: the caster picks a target within 30 ft of the
//     ammunition each time. v1: targets a single enemy within 5 ft of the
//     caster on cast, and the persistent damage applies to that same enemy
//     (no retargeting). Forward-compat TODO via the metadata flag
//     `cordonOfArrowsRetargetingV1Implemented: false`.
//   - Spell attack modifier: v1 uses a DEX save vs the caster's saveDC
//     instead (see above). No spell-attack-roll integration.
//   - NOT a concentration spell (PHB p.228: 1 min, no concentration).
//     The damage_zone effect has sourceIsConcentration: false — it ticks
//     4 times and is removed by the ticksRemaining decrement.
//   - Upcast: +2 pieces/slot-level NOT modelled — v1 always has 4 pieces.
//
// Spell module pattern:
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (effect removed by ticksRemaining decrement)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { rollDie } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Cordon of Arrows',
  level: 2,
  school: 'transmutation',
  rangeFt: 5,
  pieces: 4,                  // PHB p.228: 4 pieces of ammunition
  dieCount: 1,
  dieSides: 6,
  damageType: 'piercing' as const,
  concentration: false,
  saveAbility: 'dex' as const,   // v1: DEX save (canon: ranged spell attack)
  castingTime: 'action',
  cordonOfArrowsSaveVsAttackV1Simplified: true,               // v1: DEX save (canon: spell attack)
  cordonOfArrowsBonusActionTriggerV1Implemented: false,       // auto-tick (canon: bonus action)
  cordonOfArrowsRetargetingV1Implemented: false,              // single-target (canon: retarget each piece)
  cordonOfArrowsUpcastV1Implemented: false,                   // +2 pieces/slot-level NOT modelled
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

export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Cordon of Arrows (a living enemy within
 * 5 ft, not already Cordon'd by this caster), or null when the spell should
 * not be cast.
 *
 * Target priority: highest-threat enemy (maxHP) within 5 ft — the persistent
 * 1d6 piercing/turn for 4 turns is most valuable against a high-HP target.
 *
 * Preconditions:
 *   - Caster has 'Cordon of Arrows' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 5 ft
 *
 * Note: Cordon of Arrows is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Cordon of Arrows')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;

    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Cordon of Arrows'
    )) continue;

    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Cordon of Arrows:
 *  1. Consume a 2nd-level spell slot.
 *  2. Apply a `damage_zone` effect with saveDC + saveAbility + dieCount +
 *     dieSides + damageType + ticksRemaining: 4.
 *     The start-of-turn damage tick (combat.ts runCombat loop) rolls 1d6
 *     piercing with a DEX save for half, decrements ticksRemaining, and
 *     removes the effect when ticksRemaining reaches 0.
 *
 *     v1: NO on-cast damage — the ammunition is "planted" on cast; the
 *     damage starts ticking at the beginning of the target's NEXT turn.
 *     (Canon: the caster uses a bonus action on subsequent turns to fire
 *     a piece — v1 approximates this with the start-of-turn tick.)
 *
 * v1 simplifications: DEX save (canon: spell attack); auto-tick (canon:
 * bonus action); single-target (canon: retarget); upcast NOT modelled;
 * NOT concentration.
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Cordon of Arrows');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Cordon of Arrows around ${target.name}! (${metadata.pieces} pieces of ammunition, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}/turn, DEX save for half, ${metadata.pieces} turns)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Cordon of Arrows',
    effectType: 'damage_zone',
    payload: {
      dieCount: metadata.dieCount,
      dieSides: metadata.dieSides,
      damageType: metadata.damageType,
      saveDC,
      saveAbility: metadata.saveAbility,
      ticksRemaining: metadata.pieces,    // 4 ticks (one per piece)
    },
    sourceIsConcentration: false,         // NOT concentration (PHB p.228)
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is surrounded by ${metadata.pieces} concealed arrows! (will take ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} at the start of each of its next ${metadata.pieces} turns, DEX save for half)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — effect removed by ticksRemaining decrement in the damage_zone tick.
}
