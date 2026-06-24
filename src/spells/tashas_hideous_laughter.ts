// ============================================================
// Tasha's Hideous Laughter — PHB p.282
//
// 1st-level enchantment, action, range 30 ft, concentration (1 min).
// Components: V, S, M (tiny tarts and a feather).
//
// Effect: A creature of your choice that you can see within range perceives
//         everything as hilariously funny and falls into fits of laughter
//         if this spell affects it. The target must succeed on a Wisdom
//         saving throw or fall prone, becoming incapacitated and unable to
//         stand up for the duration. A creature with an Intelligence score
//         of 4 or lower isn't affected.
//         At the end of each of its turns, the target can make another
//         Wisdom saving throw. On a success, the spell ends.
//
// v1 simplifications:
//   - Duration: canon 1 min concentration. v1: concentration-tracked (reverts
//     when concentration breaks).
//   - End-of-turn save to shake off: NOT modelled (v1 has no per-turn save hook).
//   - INT 4 or lower immunity: NOT modelled (rare edge case).
//   - "Unable to stand up": NOT modelled (prone condition already handles the
//     main effect; standing up costs half movement which v1 doesn't track).
//
// Spell module pattern (single-target save-or-condition, concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup(c) — clears conditions if concentration broke
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: "Tasha's Hideous Laughter", level: 1, school: 'enchantment', rangeFt: 30,
  concentration: true, saveAbility: 'wis' as const, castingTime: 'action',
  tashasHideousLaughterEndOfTurnSaveV1Simplified: false,  // v1 no end-of-turn save
  tashasHideousLaughterInt4ImmunityV1Simplified: false,  // v1 no INT check
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === "Tasha's Hideous Laughter")) return null;
  if (!hasSpellSlot(caster, 1)) return null;
  if (caster.concentration?.active) return null;  // can't concentrate on 2 spells
  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;
    if (c.conditions.has('incapacitated')) continue;  // already incapacitated
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === "Tasha's Hideous Laughter")) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === "Tasha's Hideous Laughter");
  const saveDC = action?.saveDC ?? 13;
  consumeSpellSlot(caster, 1);

  // Safety: drop stale concentration effects before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, "Tasha's Hideous Laughter");

  emit(state, 'action', caster.id, `${caster.name} casts Tasha's Hideous Laughter at ${target.name}! (DC ${saveDC} WIS, concentration)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSaveReactable(state, caster, target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Tasha's Hideous Laughter (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Tasha's Hideous Laughter!`, target.id);
    return;
  }

  // Apply prone + incapacitated (both concentration-sourced)
  applySpellEffect(target, {
    casterId: caster.id, spellName: "Tasha's Hideous Laughter",
    effectType: 'condition_apply', payload: { condition: 'prone' as Condition },
    sourceIsConcentration: true,
  });
  applySpellEffect(target, {
    casterId: caster.id, spellName: "Tasha's Hideous Laughter",
    effectType: 'condition_apply', payload: { condition: 'incapacitated' as Condition },
    sourceIsConcentration: true,
  });
  emit(state, 'condition_add', caster.id,
    `${target.name} falls prone, incapacitated by fits of laughter!`, target.id);
}

export function cleanup(c: Combatant): void {
  // Concentration broke — prone + incapacitated were applied via condition_apply
  // with sourceIsConcentration: true, so removeEffectsFromCaster (called by the
  // engine when concentration breaks) will remove them. No additional cleanup needed.
}
