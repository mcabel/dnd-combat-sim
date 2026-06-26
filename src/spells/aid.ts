// ============================================================
// Aid — PHB p.211
//
// 2nd-level abjuration, action, range 30 ft, NO concentration.
// Duration: 8 hours.   Components: V, S, M (a tiny strip of white cloth).
//
// Effect: Choose up to three creatures within range. Each target's
//         hit point maximum AND current hit points increase by 5
//         for the duration.
//
// Upcast: +5 HP (max & current) per slot level above 2nd (not modelled
//         in v1 — fixed 2nd-level slot only).
//
// v1 simplifications:
//   - 8-hour duration >> combat length (max ~30 rounds). v1 applies the
//     buff directly to maxHP and currentHP with NO cleanup — the HP
//     increase persists for the rest of the combat. The `_aidHPBonus`
//     field tracks how much HP was added so a future cleanup subsystem
//     (or dispel magic) can reverse it (forward-compat TODO via the
//     metadata flag `aidHPCleanupV1Implemented: false`).
//   - v1 does NOT model upcasting (fixed +5 HP, single slot level).
//   - v1 does NOT model the "no effect on undead/constructs" exclusion
//     that some similar buffs have (Aid has NO such exclusion per PHB
//     p.211 — it works on any creature, including undead allies).
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Aid',
  level: 2,
  school: 'abjuration',
  rangeFt: 30,
  hpBonus: 5,                // PHB p.211: +5 HP max & current
  concentration: false,
  castingTime: 'action',
  maxTargets: 3,
  // v1 simplification flags (mirror cantrip-workstream pattern):
  aidHPCleanupV1Implemented: false,        // 8-hr cleanup not enforced
  aidUpcastV1Implemented: true,            // +5 HP/slot-level above 2nd per target
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

// ---- Planner ------------------------------------------------

/**
 * Returns up to 3 candidate targets for Aid (living allies within 30 ft,
 * not already Aided by this caster), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Self (caster) — always benefits from the +5 HP buffer
 *   2. Remaining allies ordered by lowest HP percentage (most vulnerable
 *      benefits most from the buff — both the max-HP increase and the
 *      current-HP heal are most valuable to a wounded ally)
 *
 * Preconditions:
 *   - Caster has 'Aid' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - At least 1 valid target exists (self or ally within 30 ft)
 *
 * Note: Aid is NOT concentration — it can be cast while concentrating on
 * another spell (e.g. Bless). The planner should NOT gate on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Aid')) return null;
  // hasSpellSlot returns true for any slot >= minLevel. Aid needs a 2nd-level slot.
  // (We can't directly check "has a 2nd-level slot" with the existing helper, but
  // consumeSpellSlot will find the lowest available slot >= 2 if any exists.)
  // We use a stricter check: scan spellSlots for any 2nd+ slot remaining.
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;

    // Skip if already Aided by this caster (re-cast would be wasteful — the
    // HP bonus doesn't stack, and re-casting only refreshes the duration,
    // which is already 8 hours >> combat).
    if (c._aidHPBonus !== undefined && c._aidHPBonus > 0) continue;

    candidates.push({ c, hpPct: c.currentHP / c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: self first, then lowest HP% (most vulnerable), then closest.
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
 * Execute Aid:
 *  1. Consume a 2nd-level spell slot (or higher if no 2nd-level slot remains —
 *     consumeSpellSlot handles upcasting automatically).
 *  2. For each target:
 *     - Increase maxHP by `metadata.hpBonus` (5).
 *     - Increase currentHP by `metadata.hpBonus` (5) — this is a HEAL
 *       as well as a max-HP buff (PHB p.211: "current hit points
 *       increase by 5 for the duration").
 *     - Set `_aidHPBonus` field on the target (tracks the bonus for
 *       future cleanup / dispel — forward-compat TODO).
 *  3. Log the spell cast and each target's HP change.
 *
 * v1 simplification: no cleanup (8-hr duration >> combat). The HP
 * increase persists for the rest of the combat. The `_aidHPBonus`
 * field is set for future use only — v1 never reads it.
 *
 * @param caster  The casting Combatant (Cleric / Paladin)
 * @param targets Candidates from shouldCast (allies including self, in range)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const slotLevel = consumeSpellSlot(caster, 2) ?? 2;
  const hpGain = 5 * (1 + Math.max(0, slotLevel - 2));

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Aid at L${slotLevel} on ${names} (${targets.length} creature${targets.length !== 1 ? 's' : ''})! ` +
    `(+${hpGain} max HP, +${hpGain} current HP each)`,
  );

  for (const target of targets) {
    // Re-check liveness (stale edge case)
    if (target.isDead || target.isUnconscious) continue;

    const bonus = hpGain;
    target.maxHP += bonus;
    target.currentHP += bonus;

    // Track the bonus for future cleanup / dispel (forward-compat).
    // Multiple Aid casts would stack (PHB p.211 doesn't say "no stack");
    // v1 allows stacking — the field sums the bonus.
    target._aidHPBonus = (target._aidHPBonus ?? 0) + bonus;

    emit(
      state, 'heal', caster.id,
      `${target.name} gains +${bonus} max HP and +${bonus} HP (now ${target.currentHP}/${target.maxHP})`,
      target.id, bonus,
    );
    emit(
      state, 'condition_add', caster.id,
      `${target.name} is bolstered by Aid!`,
      target.id,
    );
  }
}
