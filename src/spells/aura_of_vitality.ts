// ============================================================
// Aura of Vitality — PHB p.216
//
// 3rd-level evocation, bonus action, concentration
// Range: Self (30-ft aura)   Components: V
// Duration: Concentration, up to 1 minute
//
// Canon effect: Healing energy radiates from you in an aura with a
//   30-foot radius. Until the spell ends, the aura moves with you,
//   centered on you. You can use a bonus action to cause one creature
//   in the aura (including you) to regain 2d6 hit points.
//
// v1 SIMPLIFICATION:
//   - Canon: cast action → 30-ft aura → bonus-action heal 1 creature/turn
//     for 10 turns (concentration). v1 has no per-turn bonus-action hook,
//     so on cast we heal up to 3 most-wounded allies within 30 ft (2d6
//     each).
//   - Session 89: per-turn re-heal is NOW modelled. At the start of each
//     of the caster's subsequent turns, the engine auto-heals the most-
//     wounded ally in the 30-ft aura for 2d6. This mirrors the Eyebite
//     pattern (start-of-turn auto-processing, no bonus action cost — v1
//     simplification). The initial 3-ally burst on cast is preserved.
//   - Upcast: +1d6 heal per slot level above 3rd (not modelled in v1).
//   - Flag: auraOfVitalityPerTurnRehealV1Simplified is now false;
//     auraOfVitalityPerTurnRehealV1Implemented is true.
//
// Spell module pattern (multi-target heal, mirrors prayer_of_healing.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyHeal, startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Aura of Vitality',
  level: 3,
  school: 'evocation',
  rangeFt: 30,
  maxTargets: 3,
  healDie: 6,
  healDieCount: 2,
  concentration: true,
  castingTime: 'bonusAction',
  /**
   * v1 simplification flag for per-turn re-heal. NOW FALSE — the per-turn
   * re-heal is implemented (Session 89) via start-of-turn auto-processing
   * in combat.ts (mirrors the Eyebite pattern). The initial 3-ally burst
   * on cast is preserved (v1 simplification — canon heals 1/turn from
   * turn 1, v1 heals 3 on cast + 1/turn from turn 2).
   */
  auraOfVitalityPerTurnRehealV1Simplified: false as const,
  /** Session 89: per-turn re-heal is NOW implemented. */
  auraOfVitalityPerTurnRehealV1Implemented: true as const,
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
 * Returns up to 3 most-wounded allies within 30 ft of the caster, or null
 * if Aura of Vitality should not be cast.
 *
 * Preconditions:
 *   - Caster has 'Aura of Vitality' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - Caster is NOT already concentrating on another spell
 *   - At least 1 wounded ally exists within 30 ft (self qualifies)
 *
 * Target priority (mirrors prayer_of_healing.ts):
 *   1. Self first (if wounded).
 *   2. Then allies sorted by lowest HP% (most wounded).
 *   3. Up to 3 targets total.
 *   Full-HP allies are EXCLUDED (healing them wastes the slot).
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Aura of Vitality')) return null;
  if (!hasSpellSlot(caster, 3)) return null;
  if (caster.concentration?.active) return null; // already concentrating

  const candidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > metadata.rangeFt) continue;

    if (c.currentHP >= c.maxHP) continue; // skip full-HP

    candidates.push({ c, hpPct: c.currentHP / c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: self first, then lowest HP%, then closest.
  candidates.sort((a, b) => {
    const aSelf = a.c.id === caster.id ? 0 : 1;
    const bSelf = b.c.id === caster.id ? 0 : 1;
    if (aSelf !== bSelf) return aSelf - bSelf;
    if (Math.abs(a.hpPct - b.hpPct) > 0.01) return a.hpPct - b.hpPct;
    return a.dist - b.dist;
  });

  return candidates.slice(0, metadata.maxTargets).map(e => e.c);
}

// ---- Execution ----------------------------------------------

/**
 * Execute Aura of Vitality:
 *  1. Consume a 3rd-level spell slot.
 *  2. Start concentration on 'Aura of Vitality'.
 *  3. Set _auraOfVitalityActive flag for per-turn re-heal processing.
 *  4. For each target: roll 2d6 → applyHeal (capped at maxHP).
 *  5. Log: spell cast + concentration + per-target heal events.
 *
 * Session 89: the per-turn re-heal is now modelled. The _auraOfVitalityActive
 * flag is set here and checked at the start of each subsequent turn by
 * combat.ts's turn-start processing (mirrors the Eyebite pattern). The
 * flag stores the heal die/count/range so the per-turn pulse is
 * self-contained.
 *
 * @param caster  The casting Combatant (Cleric / Druid / Paladin)
 * @param targets Wounded allies within 30 ft (up to 3, self-first)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 3);
  startConcentration(caster, 'Aura of Vitality');

  // Session 89: set the per-turn re-heal flag. The engine's turn-start
  // processing checks this flag + concentration to fire the per-turn heal.
  caster._auraOfVitalityActive = {
    healDie: metadata.healDie,
    healDieCount: metadata.healDieCount,
    rangeFt: metadata.rangeFt,
  };

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Aura of Vitality — healing aura radiates 30 ft (initial burst on ${names}; ${targets.length} creature${targets.length !== 1 ? 's' : ''})!`,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} is concentrating on Aura of Vitality.`,
    caster.id,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    let heal = 0;
    for (let i = 0; i < metadata.healDieCount; i++) {
      heal += rollDie(metadata.healDie);
    }

    const wasUnconscious = target.isUnconscious;
    const healed = applyHeal(target, heal);

    if (wasUnconscious && healed > 0) {
      emit(
        state, 'condition_remove', target.id,
        `${target.name} regains consciousness!`,
        target.id,
      );
    }

    emit(
      state, 'heal', caster.id,
      `Aura of Vitality: ${healed} HP restored to ${target.name} (rolled ${heal}; now ${target.currentHP}/${target.maxHP})`,
      target.id, healed,
    );
  }
}

// ---- Per-turn re-heal (Session 89) --------------------------

/**
 * Find the most-wounded ally (including self) within the Aura of Vitality
 * 30-ft radius. Called at the start of each of the caster's subsequent
 * turns while Aura of Vitality is active.
 *
 * Target priority: lowest currentHP (most wounded), tie-broken by closest.
 * Full-HP allies are excluded (healing them wastes the pulse).
 *
 * @param caster The Aura of Vitality concentrator.
 * @param bf     The battlefield.
 * @returns The most-wounded ally in range, or null if none need healing.
 */
export function shouldCastPulse(
  caster: Combatant,
  bf: Battlefield,
): Combatant | null {
  const candidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead) continue;  // dead allies can't be healed
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > metadata.rangeFt) continue;

    if (c.currentHP >= c.maxHP) continue;  // skip full-HP

    candidates.push({ c, hpPct: c.currentHP / c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: lowest HP% first (most wounded), tie-break by closest.
  candidates.sort((a, b) => {
    if (Math.abs(a.hpPct - b.hpPct) > 0.01) return a.hpPct - b.hpPct;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

/**
 * Execute a single per-turn Aura of Vitality heal pulse.
 *
 * Heals the target for 2d6 (capped at maxHP). Does NOT consume a spell slot
 * (the slot was consumed on cast). Does NOT consume a bonus action (v1
 * simplification — mirrors the Eyebite pattern; the heal fires automatically
 * at the start of the caster's turn).
 *
 * @param caster The Aura of Vitality concentrator.
 * @param target The most-wounded ally in range (from shouldCastPulse).
 * @param state  Current EngineState (for logging).
 */
export function executePulse(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  if (target.isDead) return;  // dead allies can't be healed

  let heal = 0;
  for (let i = 0; i < metadata.healDieCount; i++) {
    heal += rollDie(metadata.healDie);
  }

  const wasUnconscious = target.isUnconscious;
  const healed = applyHeal(target, heal);

  if (wasUnconscious && healed > 0) {
    emit(
      state, 'condition_remove', target.id,
      `${target.name} regains consciousness!`,
      target.id,
    );
  }

  emit(
    state, 'heal', caster.id,
    `Aura of Vitality pulse: ${healed} HP restored to ${target.name} (rolled ${heal}; now ${target.currentHP}/${target.maxHP})`,
    target.id, healed,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handled by engine's concentration subsystem.
  // The _auraOfVitalityActive flag is cleared by removeEffectsFromCaster
  // (which sets concentration = null) — the turn-start check gates on
  // concentration?.active, so clearing concentration disables the pulse.
}
