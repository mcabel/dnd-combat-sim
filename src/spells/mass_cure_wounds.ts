// ============================================================
// Mass Cure Wounds — PHB p.258
//
// 5th-level evocation, action, NO concentration
// Range: 60 ft   Components: V, S
// Duration: Instantaneous
//
// Canon effect: A wave of healing energy washes out from a point of
//   your choice within range. Choose up to six creatures in a 30-foot-
//   radius sphere centered on that point. Each target regains hit
//   points equal to 3d8 + your spellcasting ability modifier. This
//   spell has no effect on undead or constructs.
//
// Upcast: +1d8 per slot level above 5th (not modelled in v1).
//
// v1 simplifications:
//   - Spellcasting ability: v1 uses WIS mod by default (Cleric/Druid
//     casting — the most common Mass Cure Wounds casters).
//   - Undead/constructs exclusion NOT modelled in shouldCast (execute
//     guards against healing undead silently).
//   - Upcast NOT modelled.
//   - AoE origin point collapsed: v1 heals allies within 60 ft of the
//     CASTER (not within a chosen point within range).
//
// Spell module pattern (multi-target heal, mirrors prayer_of_healing.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyHeal, abilityMod } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Mass Cure Wounds',
  level: 5,
  school: 'evocation',
  rangeFt: 60,
  maxTargets: 6,
  healDie: 8,
  healDieCount: 3,
  castingAbility: 'wis',
  concentration: false,
  castingTime: 'action',
  massCureWoundsCanonV1Implemented: true,
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
 * Returns up to 6 wounded allies within 60 ft, or null if Mass Cure Wounds
 * should not be cast.
 *
 * Preconditions:
 *   - Caster has 'Mass Cure Wounds' in their actions
 *   - Caster has at least one 5th-level-or-higher slot available
 *   - At least 1 wounded ally exists within 60 ft (self qualifies)
 *
 * Target priority (mirrors mass_healing_word.ts):
 *   1. Self first (if wounded).
 *   2. Downed allies (revival urgent).
 *   3. Remaining allies by lowest HP%.
 *   4. Up to 6 targets total. Full-HP allies EXCLUDED.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Mass Cure Wounds')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

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
 * Execute Mass Cure Wounds:
 *  1. Consume a 5th-level spell slot.
 *  2. For each target: roll 3d8 + spellcastingMod (WIS mod).
 *     Heal the target via applyHeal (caps at maxHP, clears unconscious).
 *  3. Log: spell cast + per-target heal events.
 *
 * @param caster  The casting Combatant (Cleric / Druid / Bard)
 * @param targets Up to 6 wounded allies within 60 ft
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 5);

  const spellcastingMod = abilityMod(caster.wis);

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Mass Cure Wounds on ${names} (${targets.length} creature${targets.length !== 1 ? 's' : ''})! (3d8 + ${spellcastingMod} HP each)`,
  );

  for (const target of targets) {
    if (target.isDead) continue;
    if (target.isUndead) continue;

    let heal = spellcastingMod;
    for (let i = 0; i < metadata.healDieCount; i++) {
      heal += rollDie(metadata.healDie);
    }
    if (heal < 0) heal = 0;

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
      `Mass Cure Wounds: ${healed} HP restored to ${target.name} (rolled ${heal}; now ${target.currentHP}/${target.maxHP})`,
      target.id, healed,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous heal, no persistent effect.
}
