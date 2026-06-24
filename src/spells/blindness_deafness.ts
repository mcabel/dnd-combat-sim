// ============================================================
// Blindness/Deafness — PHB p.219
//
// 2nd-level necromancy, action, range 30 ft, NO concentration (1 min).
// Components: V.
//
// Effect: Choose one creature that you can see within range to make a
//         Constitution saving throw. If it fails, the target is either
//         blinded or deafened (your choice) for the duration. At the end
//         of each of its turns, the target can make a Constitution saving
//         throw. On a success, the spell ends.
//
// v1 simplifications:
//   - Duration: canon 1 min = 10 rounds. sourceTurnExpires tracks the
//     expiry turn (appliedTurn + 10). The effect-pipeline's reevaluateEffects
//     expires it automatically when bf.round > sourceTurnExpires.
//   - v1 always picks 'blinded' (more impactful in combat than deafened).
//   - End-of-turn save to shake off: NOT modelled (v1 has no per-turn
//     save hook for non-concentration spells).
//
// Spell module pattern (single-target save-or-condition, NO concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (no concentration)
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Blindness/Deafness', level: 2, school: 'necromancy', rangeFt: 30,
  concentration: false, saveAbility: 'con' as const, castingTime: 'action',
  blindnessDeafnessAlwaysBlindV1Simplified: true,  // v1 always picks blinded
  blindnessDeafnessEndOfTurnSaveV1Simplified: false,  // v1 no end-of-turn save
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Blindness/Deafness')) return null;
  if (!hasSpellSlot(caster, 2)) return null;
  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;
    if (c.conditions.has('blinded')) continue;  // already blinded
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Blindness/Deafness')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Blindness/Deafness');
  const saveDC = action?.saveDC ?? 13;
  consumeSpellSlot(caster, 2);
  emit(state, 'action', caster.id, `${caster.name} casts Blindness/Deafness at ${target.name}! (DC ${saveDC} CON)`, target.id);
  if (target.isDead || target.isUnconscious) return;
  const save = rollSaveReactable(state, caster, target, 'con', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Blindness/Deafness (rolled ${save.total})`, target.id, save.roll);
  if (save.success) { emit(state, 'action', caster.id, `${target.name} resists Blindness/Deafness!`, target.id); return; }
  // v1: always pick 'blinded' (more impactful — disadvantage on attacks)
  // Duration: 1 min = 10 rounds (PHB p.219). sourceTurnExpires tracks when
  // the effect expires so the pipeline can remove it + promote any suppressed
  // same-name effect (e.g. Darkness-spell blinded → Blindness/Deafness takeover).
  const round = state.battlefield.round;
  applySpellEffect(target, {
    casterId: caster.id, spellName: 'Blindness/Deafness',
    effectType: 'condition_apply', payload: { condition: 'blinded' as Condition, saveDC },
    sourceIsConcentration: false,
    appliedTurn: round,
    sourceTurnExpires: round + 10,   // 1 min = 10 rounds
  });
  emit(state, 'condition_add', caster.id, `${target.name} is BLINDED by Blindness/Deafness!`, target.id);
}

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration */ }
