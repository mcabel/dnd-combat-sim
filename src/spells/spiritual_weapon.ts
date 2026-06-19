// ============================================================
// Spiritual Weapon — PHB p.278
//
// 2nd-level evocation, BONUS ACTION, range 60 ft, NO concentration (1 min).
// Components: V, S.
//
// Effect: You create a floating, spectral weapon within range that lasts
//         for the duration or until you cast this spell again. When you
//         cast the spell, you can make a melee spell attack against a
//         creature within 5 feet of the weapon. On a hit, the target
//         takes force damage equal to 1d8 + your spellcasting ability
//         modifier.
//
//         As a bonus action on your turn, you can move the weapon up to
//         20 feet and repeat the attack against a creature within 5 feet
//         of it.
//
// Upcast: +1d8 force per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - BONUS ACTION cast: PHB p.278 says "bonus action" — v1 uses
//     costType: 'bonusAction' in the action definition. The spell module
//     does NOT enforce bonus-action timing (the planner is responsible
//     for slotting this into the bonus-action slot).
//   - Subsequent-turn attacks: canon: on subsequent turns, the caster
//     uses a bonus action to move the weapon and attack again. v1
//     simplification: persistent damage_zone effect that ticks 1d8 force
//     at the start of the target's turn (mirror Cordon of Arrows' auto-
//     tick pattern). NO attack roll on subsequent turns (v1 simplification
//     — canon requires a fresh melee spell attack each turn).
//     Documented via the metadata flag
//     `spiritualWeaponSubsequentAttackV1Simplified: true`.
//   - On cast: melee spell attack vs target AC. On hit: 1d8 force.
//     v1 does NOT add the spellcasting ability modifier to the damage
//     (canon: "1d8 + your spellcasting ability modifier"). The +WIS/+CHA
//     bonus is omitted in v1 for simplicity (forward-compat TODO —
//     implicit, no separate flag). Crit does NOT double (fixed spell dice).
//   - NOT a concentration spell (PHB p.278: 1 min, no concentration).
//     The damage_zone effect has sourceIsConcentration: false — it
//     ticks for 10 rounds (1 min) and is removed by the ticksRemaining
//     decrement.
//   - Duration: canon 1 min (10 rounds) → v1: damage_zone with
//     ticksRemaining: 10. After 10 ticks, the effect is removed.
//   - Weapon movement: v1 does NOT model the bonus-action weapon move
//     (no positional AoE subsystem). The weapon is "anchored" to the
//     target for v1's purposes. Forward-compat TODO via the metadata
//     flag `spiritualWeaponRetargetingV1Implemented: false`.
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 1d8 force.
//     Forward-compat TODO via `spiritualWeaponUpcastV1Implemented: false`.
//
// Spell module pattern:
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void   (rolls the attack + damage_zone)
//   cleanup() — no-op (effect removed by ticksRemaining decrement)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { rollDie, rollAttack, applyDamageWithTempHP, abilityMod } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Spiritual Weapon',
  level: 2,
  school: 'evocation',
  rangeFt: 60,
  dieCount: 1,
  dieSides: 8,
  damageType: 'force' as const,
  concentration: false,
  castingTime: 'bonusAction',
  durationRounds: 10,             // 1 min = 10 rounds
  spiritualWeaponSubsequentAttackV1Simplified: true,    // auto-tick (canon: bonus action attack)
  spiritualWeaponUpcastV1Implemented: false,             // +1d8/slot-level NOT modelled
  spiritualWeaponRetargetingV1Implemented: false,        // weapon move NOT modelled
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
 * Returns the single best target for Spiritual Weapon (a living enemy
 * within 60 ft), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (maxHP) within 60 ft — the persistent 1d8
 *      force/turn for 10 rounds is most valuable against a high-HP target.
 *   2. Tie-break: closest enemy.
 *
 * Preconditions:
 *   - Caster has 'Spiritual Weapon' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Spiritual Weapon is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 *
 * Note: v1 does NOT check whether the caster has already cast Spiritual
 * Weapon this combat (canon: "or until you cast this spell again" — a
 * second cast ends the first). v1 allows multiple Spiritual Weapon
 * effects on different targets (a v1 simplification).
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Spiritual Weapon')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

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
 * Execute Spiritual Weapon:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Make a melee spell attack vs the target's AC.
 *     - Attack bonus = caster's spellcasting mod (WIS for Cleric, CHA for
 *       Paladin). v1 uses the action's hitBonus if set, else falls back
 *       to WIS mod.
 *  3. On hit:
 *     - Roll 1d8 force, apply immediately. (v1: NO +spellcasting-mod
 *       bonus — forward-compat TODO.)
 *     - Apply a damage_zone effect (1d8 force, ticksRemaining: 10) for
 *       the persistent per-turn damage. The start-of-turn damage tick
 *       (combat.ts runCombat loop) rolls 1d8 force and decrements
 *       ticksRemaining; after 10 ticks the effect is removed.
 *  4. On miss: NO immediate damage, BUT the damage_zone effect is still
 *     attached (the weapon persists for the duration; v1 simplification
 *     — canon: a missed attack just means no damage on the cast turn,
 *     but the weapon is still there for subsequent-turn attacks).
 *     v1 simplification: the persistent damage_zone is attached on cast
 *     regardless of hit/miss. (Canon would require a fresh attack roll
 *     on subsequent turns — v1 omits that for simplicity.)
 *
 * v1 simplifications: bonus action (not action); subsequent attacks
 * simplified to auto-tick damage_zone (no attack roll); NO +spellcasting
 * damage bonus; NO weapon movement; NOT concentration; upcast NOT modelled.
 *
 * @param caster  The casting Combatant (Cleric/Paladin)
 * @param target  The candidate from shouldCast (single enemy in range)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Spiritual Weapon');
  const hitBonus = action?.hitBonus ?? abilityMod(caster.wis);

  consumeSpellSlot(caster, 2);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Spiritual Weapon at ${target.name}! (bonus action, melee spell attack, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} on hit + persistent damage_zone ${metadata.durationRounds} rounds)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  const result = rollAttack(hitBonus, false, false);
  const effectiveAC = target.ac;

  if (result.total < effectiveAC && !result.isCrit) {
    emit(
      state, 'attack_miss', caster.id,
      `${caster.name} misses ${target.name} with Spiritual Weapon (rolled ${result.roll}+${hitBonus}=${result.total} vs AC ${effectiveAC}) — no immediate force damage!`,
      target.id, result.roll,
    );
  } else {
    emit(
      state, result.isCrit ? 'attack_crit' : 'attack_hit', caster.id,
      `${caster.name} ${result.isCrit ? 'CRITS' : 'hits'} ${target.name} with Spiritual Weapon (${result.total} vs AC ${effectiveAC})`,
      target.id, result.roll,
    );

    // 1d8 force. Crit does NOT double (fixed spell dice).
    const dmg = rollDamage();
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
    emit(
      state, 'damage', caster.id,
      `${target.name} takes ${dealt} ${metadata.damageType} damage from Spiritual Weapon (${metadata.dieCount}d${metadata.dieSides}=${dmg})`,
      target.id, dealt,
    );
  }

  // Apply damage_zone effect for persistent per-turn damage (1d8 force).
  // NO saveDC (automatic damage). NOT concentration. ticksRemaining: 10.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Spiritual Weapon',
    effectType: 'damage_zone',
    payload: {
      dieCount: metadata.dieCount,
      dieSides: metadata.dieSides,
      damageType: metadata.damageType,
      ticksRemaining: metadata.durationRounds,
    },
    sourceIsConcentration: false,   // NOT concentration (PHB p.278)
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is threatened by a spectral weapon! (will take ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} at the start of each of its next ${metadata.durationRounds} turns)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Spiritual Weapon — NO-OP because:
 *   - Spiritual Weapon is NOT a concentration spell; the damage_zone
 *     effect is removed by the ticksRemaining decrement (10 ticks).
 *   - No scratch field, no concentration to break.
 */
export function cleanup(_c: Combatant): void {
  // No-op — effect removed by ticksRemaining decrement.
}
