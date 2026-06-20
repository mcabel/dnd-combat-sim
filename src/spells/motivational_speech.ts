// ============================================================
// Motivational Speech — AI p.77 (Acquisitions Incorporated)
//
// 3rd-level enchantment, action, range 60 ft, concentration (1 min).
// Components: V, S.
//
// Effect: Choose up to three creatures that can see and hear you within
//         range. Each target gains 5 temporary hit points and a +1d4
//         bonus to attack rolls and saving throws for the duration.
//
// Upcast: none (3rd-level spell — no upcast).
//
// v1 simplifications:
//   - v1 implements the canon +1d4 via the existing `bless_die` effect
//     (same as Bless) + 5 temp HP. Session 27 Batch 3 — migrated from the
//     generic forward-compat stub to a bespoke bless_die + temp HP buff.
//   - Temp HP: canon 5 (does NOT stack with other temp HP — PHB p.198:
//     "temporary hit points aren't cumulative"). v1 sets `tempHP = max(tempHP, 5)`.
//   - Concentration: canon 1 min. v1 starts concentration; not enforced on
//     damage (TG-002). The bless_die is sourceIsConcentration: true.
//     (Temp HP is NOT conc-sourced — it's consumed by damage, not removed
//     when concentration breaks. Canon: temp HP lasts until the spell ends
//     OR until lost to damage. v1 models it as a one-time temp HP grant.)
//
// Spell module pattern (multi-target buff, concentration):
//   shouldCast(caster, bf) → Combatant[] | null   (up to 3 allies)
//   execute(caster, targets, state) → void
//   cleanup() — no-op (concentration break handles bless_die cleanup)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Motivational Speech',
  level: 3,
  school: 'enchantment',
  rangeFt: 60,
  concentration: true,
  castingTime: 'action',
  maxTargets: 3,
  tempHP: 5,                               // AI p.77: 5 temp HP
  motivationalSpeechCanonV1Implemented: true,   // Session 27 Batch 3: real bless_die + temp HP
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
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

// ---- Planner ------------------------------------------------

/**
 * Returns up to 3 living allies within 60 ft (including self), not already
 * buffed by this caster, or null when the spell should not be cast.
 * Target priority: self first, then closest allies.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Motivational Speech')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const candidates: Array<{ c: Combatant; dist: number; isSelf: boolean }> = [];
  for (const c of bf.combatants.values()) {
    if (c.faction !== caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Motivational Speech')) continue;
    candidates.push({ c, dist: distFt, isSelf: c.id === caster.id });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    return a.dist - b.dist;
  });
  return candidates.slice(0, metadata.maxTargets).map(e => e.c);
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  consumeSpellSlot(caster, 3);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Motivational Speech');

  const names = targets.map(t => t.name).join(', ');
  emit(state, 'action', caster.id,
    `${caster.name} casts Motivational Speech on ${names}! (+1d4 to attacks/saves + ${metadata.tempHP} temp HP)`, caster.id);

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;
    applySpellEffect(target, {
      casterId: caster.id, spellName: 'Motivational Speech',
      effectType: 'bless_die', payload: { dieSides: 4 },
      sourceIsConcentration: true,
    });
    // Temp HP — PHB p.198: not cumulative; keep the higher value.
    target.tempHP = Math.max(target.tempHP, metadata.tempHP);
    emit(state, 'condition_add', caster.id,
      `${target.name} is motivated! (+1d4 to attacks/saves, ${metadata.tempHP} temp HP)`, target.id);
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles bless_die cleanup */ }
