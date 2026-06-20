// ============================================================
// Cacophonic Shield — AI p.143 (Acquisitions Incorporated)
//
// 3rd-level evocation, action, range Self (10-ft aura), concentration (10 min).
// Components: V, S.
//
// Effect (canon): Thunderous reverberations fill a 10-foot emanation
//                 originating from you for the duration. Whenever a creature
//                 enters the spell's area for the first time on a turn or
//                 starts its turn there, the creature takes 2d6 thunder
//                 damage.
//
// Upcast: see source (not modelled in v1).
//
// v1 simplifications:
//   - Aura movement: canon emanation is centered on the caster (moves with
//     them). v1 simplification: the effect is applied at cast time on each
//     enemy currently within 10 ft; enemies that enter the aura later are
//     NOT affected (no positional AoE subsystem). Flag
//     `cacophonicShieldMovingAuraV1Simplified`.
//   - Persistent damage: canon says "starts its turn there" → 2d6 thunder.
//     v1 also applies 2d6 on cast (the "enters the area for the first time
//     on a turn" trigger — the targets are in the area when the spell is
//     cast).
//   - Duration: canon 10 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002).
//   - No save (canon: no saving throw listed).
//
// Spell module pattern (Session 31 architecture — multi-target aura):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup(_c) — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, DamageType } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Cacophonic Shield',
  level: 3,
  school: 'evocation',
  rangeFt: 10,          // self-aura radius
  aoeSizeFt: 10,        // 10-ft aura around caster
  dieCount: 2,
  dieSides: 6,
  damageType: 'thunder' as const as DamageType,
  concentration: true,
  castingTime: 'action',
  cacophonicShieldMovingAuraV1Simplified: true,     // aura anchored to caster at cast time
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
 * Returns candidate targets for Cacophonic Shield (living enemies within
 * 10 ft of the caster, not already affected by this caster's Cacophonic
 * Shield), or null when the spell should not be cast.
 *
 * Target priority: closest enemies first (all within 10 ft).
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on any spell
 *   - Caster has 'Cacophonic Shield' in their actions
 *   - Caster has at least one 3rd-level (or higher) slot available
 *   - At least 1 valid enemy target exists within 10 ft of the caster
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Cacophonic Shield')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const candidates: Array<{ c: Combatant; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > metadata.aoeSizeFt) continue;

    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Cacophonic Shield'
    )) continue;

    candidates.push({ c, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.dist - b.dist);

  return candidates.map(e => e.c);
}

// ---- Execution ----------------------------------------------

/**
 * Execute Cacophonic Shield:
 *  1. Consume a 3rd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Cacophonic Shield.
 *  4. For each target (enemy within 10 ft of caster):
 *     (a) Roll 2d6 thunder, apply immediately (on-cast trigger).
 *     (b) Apply a `damage_zone` effect for persistent start-of-turn damage
 *         (2d6 thunder, no save, sourceIsConcentration: true).
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
  startConcentration(caster, 'Cacophonic Shield');

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Cacophonic Shield! A 10-ft thunderous emanation surrounds them (${targets.length} enem${targets.length !== 1 ? 'ies' : 'y'} in range: ${names})`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    // 1. Immediate on-cast damage (2d6 thunder, no save).
    const immediateDmg = rollDamage();
    const dealtImmediate = applyDamageWithTempHP(target, immediateDmg, metadata.damageType);
    emit(
      state, 'damage', caster.id,
      `${target.name} takes ${dealtImmediate} ${metadata.damageType} damage from Cacophonic Shield (on cast: ${metadata.dieCount}d${metadata.dieSides}=${immediateDmg})`,
      target.id, dealtImmediate,
    );

    // 2. Apply damage_zone effect for persistent start-of-turn damage.
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Cacophonic Shield',
      effectType: 'damage_zone',
      payload: {
        dieCount: metadata.dieCount,
        dieSides: metadata.dieSides,
        damageType: metadata.damageType,
      },
      sourceIsConcentration: true,
    });

    emit(
      state, 'condition_add', caster.id,
      `${target.name} is engulfed by thunderous reverberations! (will take ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} at the start of each of its turns)`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
