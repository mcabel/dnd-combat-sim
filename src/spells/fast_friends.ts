// ============================================================
// Fast Friends — EGtW p.151 (Explorer's Guide to Wildemount)
//
// 3rd-level enchantment, action, range 30 ft, concentration (1 hr).
// Components: V, S, M (a small amount of food).
//
// Effect: You choose one creature you can see within range and compel
//         it to make a Wisdom saving throw. On a failed save, the target
//         is charmed by you for the duration (v1: control rider simplified
//         to charmed).
//
// Upcast: none (3rd-level spell — no upcast).
//
// v2: Suggestion effect type implemented via `effectType: 'suggestion'`
//   (Session 28 engine mechanism). The target is charmed AND has
//   disadvantage on their own attack rolls — matching EGtW p.151:
//   "charmed by you for the duration... you can issue commands".
//   The `suggestion` effect type auto-applies charmed condition +
//   grantSelf disadvantage on attack rolls (handled in applySpellEffect /
//   _undoEffect in spell_effects.ts).
//   Previous v1 simplified to `condition_apply:charmed` only (no combat
//   penalty — charmed alone doesn't hinder attacks in 5e).
//   Documented via `fastFriendsControlV2Implemented`.
//
// v1 simplifications still pending:
//   - Movement-restriction rider NOT modelled (no movement-compulsion subsystem).
//   - End-of-turn save NOT modelled.
//   - Concentration enforcement NOT modelled (TG-002).
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-charmed (concentration).
// Removed from `_generic_registry.ts`; routed via `case 'fastFriends':`
// in combat.ts and a planner branch in planner.ts. Mirrors Hold Person
// (single-target conc save-or-condition) but charmed + range 30.
//
// Spell module pattern (single-target save-or-condition, concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Fast Friends',
  level: 3,
  school: 'enchantment',
  rangeFt: 30,
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  fastFriendsControlV2Implemented: true,                   // suggestion effect type (charmed + disadv on attacks)
  fastFriendsConcentrationEnforcementV1Implemented: false,
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

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Fast Friends')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;
    if (c.conditions.has('charmed') || c.conditions.has('incapacitated')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Fast Friends')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Fast Friends');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 3);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Fast Friends');

  emit(state, 'action', caster.id, `${caster.name} casts Fast Friends at ${target.name}! (DC ${saveDC} WIS)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Fast Friends (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Fast Friends — not charmed!`, target.id);
    return;
  }

  applySpellEffect(target, {
    casterId: caster.id, spellName: 'Fast Friends',
    effectType: 'suggestion', payload: {},
    sourceIsConcentration: true,
  });
  emit(state, 'condition_add', caster.id,
    `${target.name} is under SUGGESTION via Fast Friends! (charmed + disadv on attacks)`, target.id);
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
