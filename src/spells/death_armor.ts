// ============================================================
// Death Armor — XGE / Planescape
//
// 2nd-level abjuration, action, range Self (5-ft aura), concentration (1 min).
// Components: V, S.
//
// Effect (canon): An inky aura surrounds you for the duration. Once per turn,
//                 when a creature within 5 feet of you hits you with an
//                 attack, the aura deals 1d4 slashing damage to that attacker.
//
// v1 simplifications:
//   - Canon is a RETALIATION aura that triggers when the caster is attacked
//     by a creature within 5 ft. v1 does NOT model retaliation triggers (no
//     on-hit-against-caster hook). v1 instead models the spell as a
//     damage_zone aura applied at cast time on each enemy within 5 ft of
//     the caster. The start-of-turn damage tick (combat.ts runCombat loop)
//     rolls 1d4 slashing on each affected enemy's turn start. This is an
//     APPROXIMATION (canon triggers on attack, not on turn start) — flag
//     `deathArmorRetaliationV1SimplifiedToAura`.
//   - Aura movement: canon the aura is centered on the caster (moves with
//     them). v1 simplification: the effect is applied at cast time on each
//     enemy currently within 5 ft; enemies that move into the aura later
//     are NOT affected (no positional AoE subsystem). Documented via the
//     same flag.
//   - No save (canon: retaliation auto-hits).
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
  name: 'Death Armor',
  level: 2,
  school: 'abjuration',
  rangeFt: 5,           // self-aura radius
  aoeSizeFt: 5,         // 5-ft aura around caster
  dieCount: 1,
  dieSides: 4,
  damageType: 'slashing' as const as DamageType,
  concentration: true,
  castingTime: 'action',
  deathArmorRetaliationV1SimplifiedToAura: true,    // canon triggers on being attacked (retaliation)
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
 * Used for both the on-cast damage and the persistent start-of-turn damage.
 */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns candidate targets for Death Armor (living enemies within 5 ft of
 * the caster, not already affected by this caster's Death Armor), or null
 * when the spell should not be cast.
 *
 * Target priority: closest enemies first (all within 5 ft — the aura radius).
 * No max-targets cap (canon affects all creatures within 5 ft of caster).
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on any spell
 *   - Caster has 'Death Armor' in their actions
 *   - Caster has at least one 2nd-level (or higher) slot available
 *   - At least 1 valid enemy target exists within 5 ft of the caster
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Death Armor')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > metadata.aoeSizeFt) continue;

    // Skip if already affected by this caster's Death Armor (re-cast wasteful)
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Death Armor'
    )) continue;

    candidates.push({ c, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.dist - b.dist);

  return candidates.map(e => e.c);
}

// ---- Execution ----------------------------------------------

/**
 * Execute Death Armor:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Death Armor.
 *  4. For each target (enemy within 5 ft of caster):
 *     (a) Roll 1d4 slashing, apply immediately (the on-cast trigger —
 *         canon approximates this as the moment the attacker enters the
 *         aura; v1 treats all current enemies as in the aura at cast).
 *     (b) Apply a `damage_zone` effect for persistent start-of-turn damage
 *         (the per-turn retaliation tick approximated as start-of-turn
 *         damage; flag `deathArmorRetaliationV1SimplifiedToAura`).
 *
 * v1 simplification: canon triggers on the caster being attacked by a
 * creature within 5 ft; v1 models it as start-of-turn damage on each
 * enemy in the aura at cast time (no retaliation hook, no aura movement).
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Death Armor');

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Death Armor! Aura of 1d4 slashing surrounds them (${targets.length} enem${targets.length !== 1 ? 'ies' : 'y'} in range: ${names})`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    // 1. Immediate on-cast damage (1d4 slashing, no save).
    const immediateDmg = rollDamage();
    const dealtImmediate = applyDamageWithTempHP(target, immediateDmg, metadata.damageType);
    emit(
      state, 'damage', caster.id,
      `${target.name} takes ${dealtImmediate} ${metadata.damageType} damage from Death Armor (on cast: ${metadata.dieCount}d${metadata.dieSides}=${immediateDmg})`,
      target.id, dealtImmediate,
    );

    // 2. Apply damage_zone effect for persistent start-of-turn damage.
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Death Armor',
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
      `${target.name} is enveloped by Death Armor! (will take ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} at the start of each of its turns — v1 simplified from canon retaliation)`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Death Armor — NO-OP in v1 because:
 *   - Death Armor is a concentration spell; the damage_zone effects are
 *     removed via removeEffectsFromCaster() when concentration breaks.
 *   - v1 does NOT enforce concentration checks (TG-002), so concentration
 *     effectively persists for the entire combat.
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
