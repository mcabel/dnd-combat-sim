// ============================================================
// Mass Heal — PHB p.257
//
// 9th-level evocation, action, NO concentration
// Range: 60 ft   Components: V, S
// Duration: Instantaneous
//
// Canon effect: A flood of healing energy flows from you into injured
//   creatures around you. You restore up to 700 hit points, divided as
//   you choose among any number of creatures that you can see within
//   range. Creatures healed by this spell are also cured of all
//   magical diseases, and they are unaffected by any disease or poison
//   for the duration. (PHB p.257 lists "blinded, deafened, and
//   diseases" as conditions ended by the spell.)
//
// v1 simplifications:
//   - 700 HP pool split among wounded allies via a simple round-robin
//     equal-share algorithm: each ally receives floor(700/count) HP,
//     then any remainder is distributed 1 HP at a time to allies
//     starting from the most-wounded. Pool is consumed even if all
//     allies are full-HP (no heal applied in that case).
//     Flag: massHealSplitV1Implemented
//   - Disease/poison removal NOT modelled (no 'diseased'/'poisoned'
//     effect tracked here — v1 'poisoned' condition exists but is not
//     removed by Mass Heal — only Heal/Power Word Heal explicitly
//     remove conditions in v1).
//   - Upcast NOT modelled (9th-level only).
//   - Spellcasting ability: NOT used (canon Mass Heal is a flat 700 HP
//     pool — no ability modifier).
//
// Spell module pattern (multi-target heal, mirrors prayer_of_healing.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applyHeal } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Mass Heal',
  level: 9,
  school: 'evocation',
  rangeFt: 60,
  healPool: 700,
  maxTargets: 10,                                  // v1 cap (canon: unlimited)
  concentration: false,
  castingTime: 'action',
  massHealSplitV1Implemented: true,
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
 * Returns up to 10 wounded allies within 60 ft, or null if Mass Heal
 * should not be cast.
 *
 * Preconditions:
 *   - Caster has 'Mass Heal' in their actions
 *   - Caster has at least one 9th-level slot available
 *   - At least 1 wounded ally exists within 60 ft (self qualifies)
 *
 * Target priority (mirrors mass_healing_word.ts):
 *   1. Self first (if wounded).
 *   2. Downed allies (revival urgent).
 *   3. Remaining allies by lowest HP%.
 *   4. Up to 10 targets total (v1 cap; canon: unlimited). Full-HP allies
 *      EXCLUDED.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Mass Heal')) return null;
  if (!hasSpellSlot(caster, 9)) return null;

  const candidates: Array<{ c: Combatant; hpPct: number; dist: number; downed: boolean }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > metadata.rangeFt) continue;

    const downed = c.isUnconscious;
    if (!downed && c.currentHP >= c.maxHP) continue;

    candidates.push({
      c,
      hpPct: downed ? -1 : c.currentHP / c.maxHP,
      dist: distFt,
      downed,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aSelf = a.c.id === caster.id ? 0 : 1;
    const bSelf = b.c.id === caster.id ? 0 : 1;
    if (aSelf !== bSelf) return aSelf - bSelf;
    if (a.downed !== b.downed) return a.downed ? -1 : 1;
    if (Math.abs(a.hpPct - b.hpPct) > 0.01) return a.hpPct - b.hpPct;
    return a.dist - b.dist;
  });

  return candidates.slice(0, metadata.maxTargets).map(e => e.c);
}

// ---- Execution ----------------------------------------------

/**
 * Execute Mass Heal:
 *  1. Consume a 9th-level spell slot.
 *  2. Distribute the 700 HP pool among the targets:
 *     - Step 1: compute base = floor(700 / count). Heal each target by
 *       min(base, deficit). Decrement pool accordingly.
 *     - Step 2: distribute the remainder 1 HP at a time to the most-
 *       wounded remaining target (re-evaluating deficits each iteration).
 *       Continue until the pool is exhausted or all allies are at full HP.
 *  3. Log: spell cast + per-target heal events.
 *
 * @param caster  The casting Combatant (Cleric)
 * @param targets Up to 10 wounded allies within 60 ft
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 9);

  // Filter to valid living non-undead targets (in case stale plan)
  const valid = targets.filter(t => !t.isDead && !t.isUndead);
  if (valid.length === 0) {
    emit(
      state, 'action', caster.id,
      `${caster.name} casts Mass Heal — no valid targets (all dead or undead)!`,
    );
    return;
  }

  const names = valid.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Mass Heal on ${names} (${valid.length} creature${valid.length !== 1 ? 's' : ''})! (700 HP pool split)`,
  );

  let pool = metadata.healPool;

  // Step 1: equal-share base allocation. Full-HP allies do NOT consume
  // their share — the unused portion remains in the pool for Step 2 to
  // redistribute to wounded allies (matches canon: cleric divides the 700
  // HP pool as they choose among creatures in range).
  const base = Math.floor(pool / valid.length);
  for (const target of valid) {
    const deficit = target.maxHP - target.currentHP;
    const amount = Math.min(base, deficit);
    if (amount > 0) {
      const wasUnconscious = target.isUnconscious;
      const healed = applyHeal(target, amount);
      pool -= healed;
      if (wasUnconscious && healed > 0) {
        emit(
          state, 'condition_remove', target.id,
          `${target.name} regains consciousness!`,
          target.id,
        );
      }
      emit(
        state, 'heal', caster.id,
        `Mass Heal (base share): ${healed} HP restored to ${target.name} (now ${target.currentHP}/${target.maxHP})`,
        target.id, healed,
      );
    }
    // No `else`: full-HP allies do NOT consume their base share from the pool.
  }

  // Step 2: distribute remaining pool 1 HP at a time to most-wounded ally
  // Re-sort by deficit descending for remainder distribution.
  let safety = pool + 10; // safety guard against infinite loops
  while (pool > 0 && safety-- > 0) {
    // Find the target with the largest remaining deficit
    let mostWounded: Combatant | null = null;
    let mostWoundedDeficit = 0;
    for (const t of valid) {
      const deficit = t.maxHP - t.currentHP;
      if (deficit > mostWoundedDeficit) {
        mostWoundedDeficit = deficit;
        mostWounded = t;
      }
    }
    if (!mostWounded || mostWoundedDeficit === 0) break;
    const healed = applyHeal(mostWounded, 1);
    pool -= healed;
    if (healed > 0) {
      emit(
        state, 'heal', caster.id,
        `Mass Heal (remainder): 1 HP to ${mostWounded.name} (now ${mostWounded.currentHP}/${mostWounded.maxHP})`,
        mostWounded.id, 1,
      );
    }
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous heal, no persistent effect.
}
