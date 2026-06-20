// ============================================================
// Wither and Bloom — SCC p.38 (Strixhaven Curriculum of Chaos)
//
// 2nd-level necromancy, action, NO concentration
// Range: 60 ft   Components: V, S, M (a dried petal from a sunflower)
// Duration: Instantaneous
//
// Canon effect: You invoke both death and life upon a 10-foot-radius
//   sphere centered on a point within range. Each creature of your
//   choice in that area must make a Constitution saving throw. A target
//   takes 2d6 necrotic damage on a failed save, or half as much on a
//   successful one. Choose one creature in the area that took damage;
//   that creature regains hit points equal to the necrotic damage dealt
//   by the spell (capped at the spell's level × 6, but for a 2nd-level
//   slot that's 12 HP). Also: a creature at 0 HP that fails its save
//   gains one success on its next death save.
//
// v1 SIMPLIFICATION:
//   - 10-ft AoE collapsed into TWO discrete targets: one enemy (damage)
//     and one ally (heal). shouldCast returns Combatant[] where:
//       [0] = damage target (enemy) — highest-threat enemy within 60 ft
//       [1] = heal target (ally)    — most-wounded ally within 60 ft
//     The execute() signature is the standard multi-target
//     (caster, targets, state) → void used by other multi-target heals,
//     with the dual-target convention documented here.
//   - Damage roll is 2d6 necrotic (no save — simplified to guaranteed
//     damage for v1 deterministic combat).
//   - Heal roll is 2d6 (separate roll — canon is "equal to the damage
//     dealt", but v1 re-rolls for simplicity).
//   - Death-save success rider NOT modelled (simplified).
//   - Spellcasting ability: v1 uses WIS mod by default (Druid casting —
//     the most common Wither and Bloom caster).
//
//   Flag: witherAndBloomCanonV1Implemented
//
// Upcast: +1d6 damage AND +1d6 heal per slot level above 2nd
//   (not modelled in v1).
//
// Spell module pattern (dual-target, mirrors prayer_of_healing.ts
//   shouldCast pattern but returns 2 targets with specific roles):
//   shouldCast(caster, bf) → Combatant[] | null  ([enemy, ally])
//   execute(caster, targets, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield, DamageType } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP, applyHeal } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Wither and Bloom',
  level: 2,
  school: 'necromancy',
  rangeFt: 60,
  damageDie: 6,
  damageDieCount: 2,
  damageType: 'necrotic' as DamageType,
  healDie: 6,
  healDieCount: 2,
  concentration: false,
  castingTime: 'action',
  witherAndBloomCanonV1Implemented: true,
  // Spec-required flag: canon grants a death-save success to targets at 0 HP
  // that fail the save — NOT modelled in v1 (simplified to guaranteed damage).
  witherAndBloomDeathSaveV1Simplified: true,
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

// ---- shouldCast ---------------------------------------------

/**
 * Returns a 2-element Combatant[] [enemyDamageTarget, allyHealTarget] for
 * Wither and Bloom, or null if the spell should not be cast.
 *
 * Preconditions:
 *   1. Caster has 'Wither and Bloom' in their actions.
 *   2. Caster has at least one 2nd-level-or-higher spell slot.
 *   3. At least one enemy AND at least one wounded ally exist within 60 ft.
 *
 * Target selection:
 *   - Damage target: highest-threat enemy within 60 ft (proxy: lowest
 *     currentHP — finishing off a wounded enemy first is highest value).
 *     Falls back to any enemy within range.
 *   - Heal target: most-wounded ally within 60 ft (largest HP deficit).
 *     Self qualifies if wounded.
 *
 * @returns Combatant[] of length 2: [damageTarget, healTarget]
 *          or null if conditions are not met.
 */
export function shouldCast(
  caster: Combatant,
  bf: Battlefield,
): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Wither and Bloom')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const inRange = (c: Combatant) =>
    chebyshev3D(caster.pos, c.pos) * 5 <= metadata.rangeFt;

  // Pick damage target: highest-threat (lowest HP) enemy within range
  let enemy: Combatant | null = null;
  let enemyHP = Infinity;
  for (const c of bf.combatants.values()) {
    if (
      c.faction !== caster.faction &&
      !c.isDead && !c.isUnconscious &&
      inRange(c)
    ) {
      if (c.currentHP < enemyHP) {
        enemyHP = c.currentHP;
        enemy = c;
      }
    }
  }

  // Pick heal target: most-wounded ally (largest HP deficit) within range
  let ally: Combatant | null = null;
  let allyDeficit = 0;
  for (const c of bf.combatants.values()) {
    if (
      c.faction === caster.faction &&
      !c.isDead &&
      c.currentHP < c.maxHP &&
      inRange(c)
    ) {
      const deficit = c.maxHP - c.currentHP;
      if (deficit > allyDeficit) {
        allyDeficit = deficit;
        ally = c;
      }
    }
  }

  if (!enemy || !ally) return null;

  return [enemy, ally];
}

// ---- execute ------------------------------------------------

/**
 * Execute Wither and Bloom:
 *  1. Consume a 2nd-level spell slot.
 *  2. Roll 2d6 necrotic → apply to damageTarget (with temp HP absorption).
 *  3. Roll 2d6 heal → apply to healTarget (capped at maxHP).
 *  4. Log: spell cast, damage event, heal event.
 *
 * @param caster   The casting Combatant (Druid / Sorcerer / Wizard)
 * @param targets  Combatant[] of length 2: [damageTarget, healTarget]
 * @param state    Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  if (targets.length < 2) return;

  const damageTarget = targets[0];
  const healTarget = targets[1];

  consumeSpellSlot(caster, 2);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Wither and Bloom — death upon ${damageTarget.name}, life upon ${healTarget.name}!`,
  );

  // ---- Damage branch: 2d6 necrotic to enemy ----
  // Guard: skip if target died between plan and execute
  if (!damageTarget.isDead) {
    let dmg = 0;
    for (let i = 0; i < metadata.damageDieCount; i++) {
      dmg += rollDie(metadata.damageDie);
    }

    const dmgBefore = damageTarget.currentHP;
    applyDamageWithTempHP(damageTarget, dmg, metadata.damageType);
    const dmgDealt = dmgBefore - damageTarget.currentHP;

    emit(
      state, 'damage', caster.id,
      `Wither and Bloom: ${dmgDealt} necrotic damage to ${damageTarget.name} (rolled ${dmg}; HP ${dmgBefore} → ${damageTarget.currentHP})`,
      damageTarget.id, dmgDealt,
    );
  }

  // ---- Heal branch: 2d6 heal to ally ----
  // Guard: skip if target died or is undead
  if (!healTarget.isDead && !healTarget.isUndead) {
    let heal = 0;
    for (let i = 0; i < metadata.healDieCount; i++) {
      heal += rollDie(metadata.healDie);
    }

    const wasUnconscious = healTarget.isUnconscious;
    const healed = applyHeal(healTarget, heal);

    if (wasUnconscious && healed > 0) {
      emit(
        state, 'condition_remove', healTarget.id,
        `${healTarget.name} regains consciousness!`,
        healTarget.id,
      );
    }

    emit(
      state, 'heal', caster.id,
      `Wither and Bloom: ${healed} HP restored to ${healTarget.name} (rolled ${heal}; now ${healTarget.currentHP}/${healTarget.maxHP})`,
      healTarget.id, healed,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous damage + heal, no persistent effect.
}
