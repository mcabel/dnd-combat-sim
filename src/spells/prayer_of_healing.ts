// ============================================================
// Prayer of Healing — PHB p.267
//
// 2nd-level evocation, action, range 30 ft, NO concentration.
// Duration: Instantaneous.   Components: V, S.
//
// Effect: Up to three creatures of your choice that you can see within range
//         regain hit points equal to 2d8 + your spellcasting ability modifier.
//         This spell has no effect on undead or constructs.
//
// Upcast: +1d8 per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - Casting time: PHB p.267 says "10 minutes" (out-of-combat ritual-style
//     heal). v1 models it as an ACTION to make it castable in combat —
//     documented via the metadata flag `prayerOfHealingCastTimeV1Simplified:
//     true`. Future work: model 10-min casts as out-of-combat-only actions.
//   - Upcast NOT modelled (fixed 2d8 + WIS mod, single 2nd-level slot).
//   - Undead/constructs exclusion NOT modelled (v1 has no creature-type
//     subsystem — Prayer of Healing works on any living ally, including
//     undead allies if any).
//   - Spellcasting ability: v1 uses WIS mod by default (Cleric/Druid casting
//     — the most common Prayer of Healing casters). Future work: detect the
//     caster's class and use the appropriate spellcasting ability.
//
// Spell module pattern (mirrors Aid's multi-target heal approach):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { rollDie, abilityMod } from '../engine/utils';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Prayer of Healing',
  level: 2,
  school: 'evocation',
  rangeFt: 30,
  maxTargets: 3,
  dieCount: 2,
  dieSides: 8,
  concentration: false,
  castingTime: 'action',
  prayerOfHealingCastTimeV1Simplified: true,   // canon: 10 min → v1: action
  prayerOfHealingUpcastV1Implemented: false,   // +1d8/slot-level NOT modelled
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
 * Returns up to 3 candidate targets for Prayer of Healing (living wounded
 * allies within 30 ft, excluding full-HP allies), or null when the spell
 * should not be cast.
 *
 * Target priority:
 *   1. Self (caster) — if wounded (currentHP < maxHP).
 *   2. Remaining allies ordered by lowest HP percentage (most wounded
 *      benefits most from the heal).
 *   3. Full-HP allies are EXCLUDED (healing them wastes the slot).
 *
 * Preconditions:
 *   - Caster has 'Prayer of Healing' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - At least 1 wounded ally exists within 30 ft (self qualifies if wounded)
 *
 * Note: Prayer of Healing is NOT concentration — it can be cast while
 * concentrating on another spell (e.g. Bless). The planner should NOT gate
 * on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Prayer of Healing')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;

    // Skip full-HP allies — healing them wastes the slot.
    if (c.currentHP >= c.maxHP) continue;

    candidates.push({ c, hpPct: c.currentHP / c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: self first, then lowest HP% (most wounded), then closest.
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
 * Execute Prayer of Healing:
 *  1. Consume a 2nd-level spell slot.
 *  2. For each target: roll 2d8 + spellcastingMod (WIS mod by default —
 *     Cleric/Druid casting). Heal the target (currentHP = min(maxHP,
 *     currentHP + heal)). Log each heal.
 *
 * v1 simplifications: action cast (canon: 10 min); WIS-mod spellcasting
 * (canon: caster's class spellcasting ability); upcast NOT modelled;
 * undead/constructs exclusion NOT modelled; NOT concentration.
 *
 * @param caster  The casting Combatant (Cleric/Druid)
 * @param targets Candidates from shouldCast (wounded allies within 30 ft)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  const spellcastingMod = abilityMod(caster.wis);   // Cleric/Druid casting

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Prayer of Healing on ${names} (${targets.length} creature${targets.length !== 1 ? 's' : ''})! (${metadata.dieCount}d${metadata.dieSides} + ${spellcastingMod} HP each)`,
  );

  for (const target of targets) {
    // Re-check liveness (stale edge case)
    if (target.isDead || target.isUnconscious) continue;

    // Roll heal: 2d8 + spellcasting mod.
    let heal = spellcastingMod;
    for (let i = 0; i < metadata.dieCount; i++) {
      heal += rollDie(metadata.dieSides);
    }
    // Heal cannot be negative — floor at 0 (in case spellcastingMod is negative
    // and the dice roll low — PHB p.7: bonuses can be negative with low stats).
    if (heal < 0) heal = 0;

    const before = target.currentHP;
    target.currentHP = Math.min(target.maxHP, target.currentHP + heal);
    const actual = target.currentHP - before;

    emit(
      state, 'heal', caster.id,
      `${target.name} regains ${actual} HP (rolled ${heal}, capped at maxHP ${target.maxHP}; now ${target.currentHP}/${target.maxHP})`,
      target.id, actual,
    );
  }
}
