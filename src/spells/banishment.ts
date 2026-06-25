// ============================================================
// Banishment — PHB p.217
//
// 4th-level abjuration, action, range 60 ft, concentration (1 min).
// Components: V, S, M (an item distasteful to the target).
//
// Effect: You attempt to send one creature that you can see within range
//         to another plane of existence. The target must succeed on a
//         Charisma saving throw or be banished. If the target is native to
//         the plane of existence you're on, the target is banished to a
//         harmless demiplane. While there, the target is incapacitated.
//         The target remains there for the duration, until it drops to 0
//         hit points, or until you use an action to dismiss it. If the
//         target is native to a different plane of existence, the target
//         is banished to its home plane (no incapacitated — just gone).
//
// v1 simplifications:
//   - Duration: canon 1 min concentration. v1: concentration-tracked (reverts
//     when concentration breaks). NOT permanent.
//   - "Native to a different plane" → sent home (effectively removed from
//     combat permanently). v1: checks creatureType — fey/elemental/celestial/
//     fiend/undead are "not native to Material Plane" → banished permanently
//     (removed from combat). Other types → demiplane (incapacitated, reverts
//     on concentration break).
//   - Dismissal action: NOT modelled (concentration break = revert).
//
// Spell module pattern (single-target save-or-removal, concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup(c) — clears banishment if concentration broke
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, addCondition } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Banishment', level: 4, school: 'abjuration', rangeFt: 60,
  concentration: true, saveAbility: 'cha' as const, castingTime: 'action',
  banishmentNonNativeRemovalV1Implemented: true,  // fey/elemental/etc removed permanently
  banishmentDismissalActionV1Simplified: true,  // no dismiss action; conc break = revert
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

/** Creature types native to a DIFFERENT plane (banished permanently, not demiplane). */
const NON_NATIVE_TYPES = new Set(['fey', 'elemental', 'celestial', 'fiend', 'undead']);

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Banishment')) return null;
  if (!hasSpellSlot(caster, 4)) return null;
  if (caster.concentration?.active) return null;  // can't concentrate on 2 spells
  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Banishment')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Banishment');
  const saveDC = action?.saveDC ?? 15;
  consumeSpellSlot(caster, 4);

  // Safety: drop stale concentration effects before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Banishment');

  emit(state, 'action', caster.id, `${caster.name} casts Banishment at ${target.name}! (DC ${saveDC} CHA, concentration)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSaveReactable(state, caster, target, 'cha', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CHA save vs Banishment (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Banishment!`, target.id);
    return;
  }

  // Check if target is native to a different plane
  const creatureType = target.creatureType?.toLowerCase() ?? '';
  const isNonNative = NON_NATIVE_TYPES.has(creatureType);

  if (isNonNative) {
    // Banished to home plane — permanently removed from combat
    target.isDead = true;  // effectively removed
    target.currentHP = 0;
    emit(state, 'action', caster.id,
      `${target.name} is BANISHED to its home plane (${creatureType}) — permanently removed from combat!`, target.id);
    log(state, 'death', target.id,
      `${target.name} is banished from this plane of existence!`, undefined, 0);
  } else {
    // Banished to demiplane — incapacitated, reverts on concentration break
    applySpellEffect(target, {
      casterId: caster.id, spellName: 'Banishment',
      effectType: 'condition_apply', payload: { condition: 'incapacitated' },
      sourceIsConcentration: true,
    });
    // Also mark as "banished" (can't take actions, can't be targeted)
    addCondition(target, 'incapacitated');
    emit(state, 'condition_add', caster.id,
      `${target.name} is BANISHED to a demiplane (incapacitated until concentration ends)!`, target.id);
  }
}

function log(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function cleanup(c: Combatant): void {
  // Concentration broke — banished (demiplane) creatures revert.
  // The incapacitated condition was applied via condition_apply with
  // sourceIsConcentration: true, so removeEffectsFromCaster (called by
  // the engine when concentration breaks) will remove it.
  // No additional cleanup needed here — this function is a no-op marker.
}
