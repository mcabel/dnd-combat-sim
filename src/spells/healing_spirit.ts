// ============================================================
// Healing Spirit — XGE p.157
//
// 2nd-level conjuration, bonus action, range 60 ft, concentration (1 min).
// Components: V, S, M (a sprig of mistletoe).
//
// Effect (canon): You call forth a nature spirit to soothe the wounded. The
//                 intangible spirit appears in a space that is a 5-foot cube
//                 you can see within range. The spirit looks like a
//                 transparent beast or fey (your choice). Whenever you or a
//                 creature you can see moves into the spirit's space for the
//                 first time on a turn or ends its turn there, you can have
//                 the spirit restore 1d6 hit points to that creature (no
//                 action required). The spirit can't heal constructs or
//                 undead. As a bonus action on your turn, you can move the
//                 spirit up to 30 feet in any direction.
//                 (Upcast: +1d6 per slot level above 2nd.)
//
// v1 simplifications:
//   - The damage_zone engine tick does NOT support healing (it calls
//     applyDamageWithTempHP, not applyHeal). v1 therefore models this as
//     a ONE-SHOT heal on cast: heal the most-wounded ally within 30 ft
//     by 1d6 (the canon per-turn bonus-action re-heal is NOT modelled).
//     Flag `healingSpiritPerTurnRehealV1SimplifiedToOneShot`.
//   - Range: canon says "a 5-foot cube you can see within range (60 ft)".
//     v1 simplifies to "most-wounded ally within 30 ft of the caster" (the
//     spirit cube is anchored near the caster; canon the cube can be placed
//     anywhere within 60 ft). Flag `healingSpiritCubePlacementV1Simplified`.
//   - Construct/undead exclusion NOT modelled (no creature-type subsystem).
//     Flag `healingSpiritConstructUndeadExclusionV1NotModelled`.
//   - Upcast: +1d6/slot-level NOT modelled.
//   - Concentration: canon 1 min concentration → v1: concentration is
//     started, but NOT enforced (TG-002). The spell has no persistent
//     effect in v1 (one-shot heal), so concentration is largely a label.
//
// Spell module pattern (Session 31 architecture — multi-target heal):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup(_c) — no-op (no persistent effect in v1)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollDie, applyHeal } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Healing Spirit',
  level: 2,
  school: 'conjuration',
  rangeFt: 30,          // v1 simplified range (canon: 60 ft cube placement)
  aoeSizeFt: 30,        // heal-aura radius around caster
  dieCount: 1,
  dieSides: 6,
  healingType: 'healing' as const,
  concentration: true,
  castingTime: 'bonusAction',
  healingSpiritPerTurnRehealV1SimplifiedToOneShot: true,    // canon: per-turn bonus-action reheal; v1: one-shot
  healingSpiritCubePlacementV1Simplified: true,             // canon: cube placed anywhere within 60 ft; v1: anchored to caster 30-ft aura
  healingSpiritConstructUndeadExclusionV1NotModelled: true, // no creature-type subsystem
  healingSpiritUpcastV1Implemented: false,                  // +1d6/slot-level not modelled
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
 * Used for the one-shot heal amount.
 */
export function rollHealAmount(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns candidate targets for Healing Spirit (wounded living allies
 * within 30 ft of the caster), or null when the spell should not be cast.
 *
 * Target priority: most-wounded ally first (lowest currentHP / maxHP ratio),
 * then closest. Only allies that have taken damage (currentHP < maxHP) are
 * considered — casting on a full-HP ally is wasteful.
 *
 * v1 simplification: returns ALL wounded allies within 30 ft (the execute
 * path will heal the most-wounded ONE — see healingSpiritPerTurnRehealV1SimplifiedToOneShot
 * flag). Returning the full list lets the planner batch-heal in a future
 * iteration; the execute() path picks the best one.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on any spell
 *   - Caster has 'Healing Spirit' in their actions
 *   - Caster has at least one 2nd-level (or higher) slot available
 *   - At least 1 wounded ally exists within 30 ft of the caster
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Healing Spirit')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; woundRatio: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;
    // Only wounded allies (currentHP < maxHP) — casting on full-HP is wasteful
    if (c.currentHP >= c.maxHP) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > metadata.aoeSizeFt) continue;

    // woundRatio: 0 = untouched, 1 = nearly dead. Higher = more urgent.
    const woundRatio = 1 - (c.currentHP / c.maxHP);
    candidates.push({ c, woundRatio, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: most-wounded first, then closest.
  candidates.sort((a, b) => {
    if (a.woundRatio !== b.woundRatio) return b.woundRatio - a.woundRatio;
    return a.dist - b.dist;
  });

  return candidates.map(e => e.c);
}

// ---- Execution ----------------------------------------------

/**
 * Execute Healing Spirit:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Healing Spirit (label only in v1 — no
 *     persistent effect; the heal is one-shot).
 *  4. Heal the most-wounded ally from `targets` (the first entry —
 *     shouldCast already sorted by wound ratio). Roll 1d6 and call
 *     applyHeal (capped at maxHP). Log the heal event.
 *
 * v1 simplification: canon allows healing a different ally each turn
 * (bonus-action re-heal), but v1's damage_zone tick can't heal — so v1
 * models this as a one-shot heal on the most-wounded ally. The per-turn
 * re-heal is NOT modelled (flag healingSpiritPerTurnRehealV1SimplifiedToOneShot).
 *
 * Note: targets is the list of wounded allies from shouldCast. v1 only
 * heals the FIRST one (the most-wounded). The others are returned by
 * shouldCast only to preserve the multi-target dispatch signature.
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
  startConcentration(caster, 'Healing Spirit');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Healing Spirit (bonus action)! A nature spirit appears to soothe the wounded.`,
  );

  if (targets.length === 0) return;

  // Pick the most-wounded ally (first in the list — shouldCast sorted).
  const target = targets[0];
  if (target.isDead || target.isUnconscious) return;
  if (target.currentHP >= target.maxHP) return;   // already at full (stale edge case)

  const healAmt = rollHealAmount();
  const healed = applyHeal(target, healAmt);

  emit(
    state, 'heal', caster.id,
    `${target.name} is healed by Healing Spirit for ${healed} HP (rolled ${metadata.dieCount}d${metadata.dieSides}=${healAmt}, capped at maxHP)`,
    target.id, healed,
  );
  emit(
    state, 'condition_add', caster.id,
    `${target.name} is soothed by a nature spirit! (v1: one-shot heal; per-turn re-heal NOT modelled)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — v1 has no persistent effect (heal is one-shot). Concentration
  // break has nothing to undo (no damage_zone, no condition_apply, etc.).
}
