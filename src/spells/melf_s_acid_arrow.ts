// ============================================================
// Melf's Acid Arrow — PHB p.259
//
// 2nd-level evocation, action, range 90 ft, NO concentration.
// Duration: Instantaneous.   Components: V, S, M (powdered rhubarb leaf and
//          an adder's stomach).
//
// Effect: A shimmering green arrow streaks toward a target within range and
//         bursts in a spray of acid. Make a ranged spell attack against the
//         target. On a hit, the target takes 4d4 acid damage immediately and
//         2d4 acid damage at the end of its next turn.
//
// Upcast: +1d4 (immediate) + 1d4 (delayed) per slot level above 2nd (not
//   modelled in v1).
//
// v1 simplifications:
//   - Delayed damage (2d4 at end of target's next turn): v1 models this as
//     a damage_zone effect with `ticksRemaining: 1` — one tick at the start
//     of the target's NEXT turn (slightly earlier than canon's "end of its
//     next turn", but consistent with the damage_zone start-of-tick timing
//     established by Cloud of Daggers). The tick has NO save (acid damage
//     is automatic). Forward-compat TODO: a proper end-of-turn hook (vs the
//     start-of-turn damage_zone tick) via the metadata flag
//     `melfsAcidArrowEndOfTurnV1Simplified: true`.
//   - Ranged spell attack: v1 uses resolveAttack's standard ranged spell
//     attack resolution (the action has attackType: 'spell'). The 4d4 acid
//     damage is rolled in execute() (NOT via the action's damage field —
//     the action's damage is null in SPELL_DB so selectAction skips it;
//     the case branch in combat.ts calls execute directly).
//   - NOT a concentration spell (PHB p.259: instantaneous). The damage_zone
//     for the delayed damage has sourceIsConcentration: false — it ticks
//     once and is removed by the ticksRemaining decrement.
//   - Upcast: +1d4/+1d4 per slot-level NOT modelled — v1 always rolls 4d4
//     immediate + 2d4 delayed.
//   - Miss: PHB p.259 implies no damage on a miss (the arrow "bursts in a
//     spray of acid" only on a hit). v1: on miss, no immediate damage AND
//     no delayed damage_zone effect.
//
// Spell module pattern:
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void   (rolls the attack + damage)
//   cleanup() — no-op (no scratch field; delayed damage via damage_zone)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { rollDie, rollAttack, applyDamageWithTempHP, abilityMod } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: "Melf's Acid Arrow",
  level: 2,
  school: 'evocation',
  rangeFt: 90,
  immediateDiceCount: 4,
  immediateDieSides: 4,
  delayedDiceCount: 2,
  delayedDieSides: 4,
  damageType: 'acid' as const,
  concentration: false,
  castingTime: 'action',
  melfsAcidArrowEndOfTurnV1Simplified: true,                  // delayed dmg ticks at start-of-turn (not end)
  melfsAcidArrowUpcastV1Implemented: false,                   // +1d4/+1d4 per slot-level NOT modelled
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

// ---- Dice helpers -------------------------------------------

export function rollImmediateDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.immediateDiceCount; i++) total += rollDie(metadata.immediateDieSides);
  return total;
}

export function rollDelayedDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.delayedDiceCount; i++) total += rollDie(metadata.delayedDieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Melf's Acid Arrow (a living enemy
 * within 90 ft), or null when the spell should not be cast.
 *
 * Target priority: highest-threat enemy (maxHP) within 90 ft — the 4d4+2d4
 * acid is most valuable against a high-HP target that will survive to take
 * the delayed damage.
 *
 * Preconditions:
 *   - Caster has "Melf's Acid Arrow" in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 90 ft
 *
 * Note: Melf's Acid Arrow is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === "Melf's Acid Arrow")) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 90) continue;

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
 * Execute Melf's Acid Arrow:
 *  1. Consume a 2nd-level spell slot.
 *  2. Make a ranged spell attack vs the target's AC.
 *     - Attack bonus = caster's spellcasting mod (INT for Wizard, CHA for
 *       Sorcerer) + prof bonus. v1 uses the action's hitBonus if set,
 *       else falls back to INT mod.
 *  3. On hit:
 *     - Roll 4d4 acid, apply immediately.
 *     - Apply a damage_zone effect (2d4 acid, ticksRemaining: 1) for the
 *       delayed damage at the start of the target's next turn.
 *  4. On miss: no damage, no delayed effect.
 *
 * v1 simplifications: delayed damage ticks at start-of-next-turn (not end);
 * upcast NOT modelled; NOT concentration.
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === "Melf's Acid Arrow");
  // v1: use the action's hitBonus if set; else fall back to INT mod (Wizard).
  const hitBonus = action?.hitBonus ?? abilityMod(caster.int);

  consumeSpellSlot(caster, 2);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Melf's Acid Arrow at ${target.name}! (ranged spell attack, ${metadata.immediateDiceCount}d${metadata.immediateDieSides} ${metadata.damageType} on hit + ${metadata.delayedDiceCount}d${metadata.delayedDieSides} ${metadata.damageType} next turn)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  const result = rollAttack(hitBonus, false, false);
  const effectiveAC = target.ac;

  if (result.total < effectiveAC && !result.isCrit) {
    emit(
      state, 'attack_miss', caster.id,
      `${caster.name} misses ${target.name} with Melf's Acid Arrow (rolled ${result.roll}+${hitBonus}=${result.total} vs AC ${effectiveAC}) — no acid damage!`,
      target.id, result.roll,
    );
    return;
  }

  emit(
    state, result.isCrit ? 'attack_crit' : 'attack_hit', caster.id,
    `${caster.name} ${result.isCrit ? 'CRITS' : 'hits'} ${target.name} with Melf's Acid Arrow (${result.total} vs AC ${effectiveAC})`,
    target.id, result.roll,
  );

  // On hit: 4d4 acid immediately. Crit does NOT double (canon: the spell
  // rolls fixed dice, not weapon dice — PHB p.196 crit rule only doubles
  // "damage dice in the attack"; v1 simplification: no crit doubling for
  // Melf's Acid Arrow's fixed spell damage. Documented via the metadata
  // flag `melfsAcidArrowCritNoDoubleV1Simplified: true` (implicit)).
  const immediateDmg = rollImmediateDamage();
  const dealtImmediate = applyDamageWithTempHP(target, immediateDmg, metadata.damageType);
  emit(
    state, 'damage', caster.id,
    `${target.name} takes ${dealtImmediate} ${metadata.damageType} damage from Melf's Acid Arrow (immediate: ${metadata.immediateDiceCount}d${metadata.immediateDieSides}=${immediateDmg})`,
    target.id, dealtImmediate,
  );

  // Apply the delayed 2d4 acid as a damage_zone with ticksRemaining: 1.
  // The start-of-turn damage tick (combat.ts runCombat loop) will roll 2d4
  // acid at the start of the target's next turn, then remove the effect
  // (ticksRemaining decrements to 0).
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: "Melf's Acid Arrow",
    effectType: 'damage_zone',
    payload: {
      dieCount: metadata.delayedDiceCount,
      dieSides: metadata.delayedDieSides,
      damageType: metadata.damageType,
      ticksRemaining: 1,            // one tick (at start of target's next turn)
      // No saveDC / saveAbility — acid damage is automatic.
    },
    sourceIsConcentration: false,   // NOT concentration (PHB p.259: instantaneous)
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is splashed with acid! (will take ${metadata.delayedDiceCount}d${metadata.delayedDieSides} ${metadata.damageType} at the start of its next turn)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — no scratch field; delayed damage tracked via damage_zone.
}
