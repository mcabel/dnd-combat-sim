// ============================================================
// Mass Healing Word — PHB p.258
//
// 3rd-level evocation, bonus action, NO concentration
// Range: 60 ft   Components: V
// Duration: Instantaneous
//
// Canon effect: As you call out words of restoration, up to six
//   creatures of your choice that you can see within range regain
//   hit points equal to 1d4 + your spellcasting ability modifier.
//   This spell has no effect on undead or constructs.
//
// Upcast: +1d4 per slot level above 3rd (not modelled in v1).
//
// v1 simplifications:
//   - Spellcasting ability: v1 uses WIS mod by default (Cleric/Druid
//     casting — the most common Mass Healing Word casters). Min 1 floor
//     mirrors healing_word.ts.
//   - Undead/constructs exclusion NOT modelled for healing (we still
//     guard against healing undead in execute — but shouldCast does not
//     pre-filter, so an undead ally could be picked by the planner; the
//     execute guard skips it silently).
//   - Upcast NOT modelled.
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
  name: 'Mass Healing Word',
  level: 3,
  school: 'evocation',
  rangeFt: 60,
  maxTargets: 6,
  healDie: 4,
  healDieCount: 1,
  castingAbility: 'wis',
  concentration: false,
  castingTime: 'bonusAction',
  massHealingWordCanonV1Implemented: true,
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
 * Returns up to 6 wounded allies within 60 ft, or null if Mass Healing Word
 * should not be cast.
 *
 * Preconditions:
 *   - Caster has 'Mass Healing Word' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - At least 1 wounded ally (currentHP < maxHP, !dead) exists within 60 ft
 *
 * Target priority (mirrors prayer_of_healing.ts):
 *   1. Self first (if wounded).
 *   2. Downed (unconscious, !dead) allies — revival is urgent.
 *   3. Remaining allies by lowest HP%.
 *   4. Up to 6 targets total. Full-HP allies EXCLUDED.
 *
 * Note: Mass Healing Word is NOT concentration — can be cast while
 * concentrating on another spell.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Mass Healing Word')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const candidates: Array<{ c: Combatant; hpPct: number; dist: number; downed: boolean }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > metadata.rangeFt) continue;

    // Skip full-HP non-downed allies.
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

  // Sort: self first, then downed allies, then lowest HP%, then closest.
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
 * Execute Mass Healing Word:
 *  1. Consume a 3rd-level spell slot.
 *  2. For each target: roll 1d4 + spellcastingMod (WIS mod, min 1).
 *     Heal the target via applyHeal (caps at maxHP, clears unconscious
 *     if target was at 0 HP and healed > 0).
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
  consumeSpellSlot(caster, 3);

  const spellcastingMod = abilityMod(caster.wis);

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Mass Healing Word on ${names} (${targets.length} creature${targets.length !== 1 ? 's' : ''})! (1d4 + ${spellcastingMod} HP each)`,
  );

  for (const target of targets) {
    // Guard: skip dead or undead targets (PHB p.258: no effect on undead)
    if (target.isDead) continue;
    if (target.isUndead) continue;

    const roll = rollDie(metadata.healDie);
    const amount = Math.max(1, roll + spellcastingMod); // min 1 HP

    const wasUnconscious = target.isUnconscious;
    const healed = applyHeal(target, amount);

    if (wasUnconscious && healed > 0) {
      emit(
        state, 'condition_remove', target.id,
        `${target.name} regains consciousness!`,
        target.id,
      );
    }

    emit(
      state, 'heal', caster.id,
      `Mass Healing Word: ${healed} HP restored to ${target.name} (1d4[${roll}]+${spellcastingMod}=${amount}; now ${target.currentHP}/${target.maxHP})`,
      target.id, healed,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous heal, no persistent effect.
}
