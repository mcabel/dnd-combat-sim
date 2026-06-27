// ============================================================
// Dust Devil — XGE p.154
//
// 2nd-level conjuration, action, range 60 ft, concentration (1 min).
// Components: V, S, M (a handful of dust).
//
// Effect (canon): Choose an unoccupied 5-foot cube of air that you can see
//                 within range. An elemental force that resembles a dust
//                 devil appears in the cube and lasts for the spell's
//                 duration. When a creature enters the spell's area for the
//                 first time on a turn or starts its turn there, that
//                 creature takes 1d8 bludgeoning damage. As a bonus action,
//                 you can move the dust devil up to 30 feet in any direction.
//
// Upcast: +1d8 per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - Aura movement: canon the dust devil moves with the caster's bonus
//     action (a moving 5-ft-cube aura). v1 simplification: the spell is
//     modelled as a damage_zone aura applied at cast time on each enemy
//     within 5 ft of the CASTER (the cube is anchored to the caster for
//     v1's purposes — flag `dustDevilMovingAuraV1Simplified`). Enemies
//     entering the cube later are NOT affected.
//   - Multi-creature: v1 affects all enemies within 5 ft at cast time
//     (canon cube is 5 ft, so it typically hits 1 creature).
//   - Persistent damage: PHB says "starts its turn there" → 1d8 bludgeoning.
//     v1 also applies 1d8 on cast (the "enters the area for the first time
//     on a turn" trigger — the targets are in the area when the spell is
//     cast).
//   - Duration: canon 1 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002).
//   - Upcast: +1d8/slot-level NOT modelled.
//   - No save (PHB p.154: no saving throw listed).
//
// Spell module pattern (Session 31 architecture — multi-target aura):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup(_c) — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, DamageType } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster, isProtectedByGoI } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Dust Devil',
  level: 2,
  school: 'conjuration',
  rangeFt: 60,          // canon range (point within 60 ft)
  aoeSizeFt: 5,         // 5-ft aura around caster (v1 simplified)
  dieCount: 1,
  dieSides: 8,
  damageType: 'bludgeoning' as const as DamageType,
  concentration: true,
  castingTime: 'action',
  dustDevilMovingAuraV1Simplified: true,            // cube anchored to caster (canon moves with bonus action)
  dustDevilUpcastV1Implemented: false,              // +1d8/slot-level not modelled
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
 */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns candidate targets for Dust Devil (living enemies within 5 ft of
 * the caster, not already affected by this caster's Dust Devil), or null
 * when the spell should not be cast.
 *
 * Target priority: closest enemies first (all within 5 ft).
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on any spell
 *   - Caster has 'Dust Devil' in their actions
 *   - Caster has at least one 2nd-level (or higher) slot available
 *   - At least 1 valid enemy target exists within 5 ft of the caster
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Dust Devil')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > metadata.aoeSizeFt) continue;

    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Dust Devil'
    )) continue;

    candidates.push({ c, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.dist - b.dist);

  return candidates.map(e => e.c);
}

// ---- Execution ----------------------------------------------

/**
 * Execute Dust Devil:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Dust Devil.
 *  4. For each target (enemy within 5 ft of caster):
 *     (a) Roll 1d8 bludgeoning, apply immediately (on-cast trigger).
 *     (b) Apply a `damage_zone` effect for persistent start-of-turn damage
 *         (1d8 bludgeoning, no save, sourceIsConcentration: true).
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const slotLevel = consumeSpellSlot(caster, 2) ?? 2;

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Dust Devil');

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Dust Devil! A swirling 5-ft vortex surrounds them (${targets.length} enem${targets.length !== 1 ? 'ies' : 'y'} in range: ${names})`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    // Session 79 (GoI AoE exclusion follow-up): PHB p.245: "the spell has no
    // effect on them." The spell still fires (slot already consumed above).
    // For persistent damage zones, the damage_zone EFFECT is applied to ALL
    // targets in range (so it can tick later if GoI expires), but the ON-CAST
    // damage is skipped for GoI-protected targets. The caster's own GoI does
    // NOT block their own spell (PHB p.245: "cast from outside the barrier").
    const goiBlocked = target.id !== caster.id && isProtectedByGoI(target, slotLevel, state.battlefield, caster.id);

    // 1. Immediate on-cast damage (1d8 bludgeoning, no save).
    //    Skipped if the target is GoI-protected (PHB p.245: "no effect on them").
    if (!goiBlocked) {
      const immediateDmg = rollDamage();
      const dealtImmediate = applyDamageWithTempHP(target, immediateDmg, metadata.damageType);
      emit(
        state, 'damage', caster.id,
        `${target.name} takes ${dealtImmediate} ${metadata.damageType} damage from Dust Devil (on cast: ${metadata.dieCount}d${metadata.dieSides}=${immediateDmg})`,
        target.id, dealtImmediate,
      );
    } else {
      emit(
        state, 'damage', caster.id,
        `${target.name} is protected by Globe of Invulnerability — on-cast damage negated (persistent effect still applied, will tick when GoI expires).`,
        target.id, 0,
      );
    }

    // 2. Apply damage_zone effect for persistent start-of-turn damage.
    //    ALWAYS applied (even to GoI-protected targets) so the spell can start
    //    ticking if GoI expires later. sourceSlotLevel is set so the combat.ts
    //    damage_zone tick loop can re-check GoI protection on each per-turn
    //    tick (PHB p.245: the spell continues to have no effect on GoI-
    //    protected creatures for as long as GoI is active).
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Dust Devil',
      effectType: 'damage_zone',
      sourceSlotLevel: slotLevel,
      payload: {
        dieCount: metadata.dieCount,
        dieSides: metadata.dieSides,
        damageType: metadata.damageType,
      },
      sourceIsConcentration: true,
    });

    emit(
      state, 'condition_add', caster.id,
      `${target.name} is caught in the dust devil! (will take ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} at the start of each of its turns)`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
