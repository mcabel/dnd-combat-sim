// ============================================================
// Compelled Duel — PHB p.224
//
// 1st-level enchantment, action, range 30 ft, concentration (1 min).
// Components: V, S, M (a pair of entwined rings).
//
// Effect: You attempt to compel a creature into a duel. One creature
//         that you can see within range must make a Wisdom saving throw.
//         On a failed save, the creature is drawn to you, compelled
//         through your divine word to fight you and only you.
//         The creature has disadvantage on attack rolls against
//         creatures other than you. The creature must make a Wisdom
//         saving throw before moving to a space more than 30 feet away
//         from you.
//
// Upcast: none (1st-level spell — no upcast).
//
// v2: Taunt implemented via `effectType: 'taunt'` (Session 28 engine
//   mechanism). The taunted creature has disadvantage on attack rolls
//   against creatures other than the caster — matching PHB p.224:
//   "disadvantage on attack rolls against creatures other than you".
//   Previous v1 simplified to `condition_apply:frightened` (closest
//   available condition, but overly broad — frightened gives disadv on
//   ALL attacks while caster visible). The movement-restriction rider
//   is NOT modelled (v1 has no movement-compulsion subsystem).
//   Documented via `compelledDuelTauntV2Implemented`.
//   - Concentration: canon 1 min concentration. v1 starts concentration;
//     not enforced on damage (TG-002). frightened is conc-sourced.
//   - End-of-turn repeat save (PHB p.224): NOT modelled.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-frightened (concentration).
// Removed from `_generic_registry.ts`; routed via `case 'compelledDuel':`
// in combat.ts and a planner branch in planner.ts. Mirrors Hold Person
// (single-target conc save-or-condition) but frightened + L1.
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

export const metadata = {
  name: 'Compelled Duel', level: 1, school: 'enchantment', rangeFt: 30,
  concentration: true, saveAbility: 'wis' as const, castingTime: 'action',
  compelledDuelTauntV2Implemented: true,                   // taunt via effectType (disadv vs non-caster)
  compelledDuelConcentrationEnforcementV1Implemented: true,
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Compelled Duel')) return null;
  if (!hasSpellSlot(caster, 1)) return null;
  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;
    if (c.activeEffects.some(e => e.effectType === 'taunt')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Compelled Duel')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Compelled Duel');
  const saveDC = action?.saveDC ?? 13;
  consumeSpellSlot(caster, 1);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Compelled Duel');
  emit(state, 'action', caster.id, `${caster.name} casts Compelled Duel at ${target.name}! (DC ${saveDC} WIS)`, target.id);
  if (target.isDead || target.isUnconscious) return;
  const save = rollSave(target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Compelled Duel (rolled ${save.total})`, target.id, save.roll);
  if (save.success) { emit(state, 'action', caster.id, `${target.name} resists Compelled Duel — no effect!`, target.id); return; }
  applySpellEffect(target, { casterId: caster.id, spellName: 'Compelled Duel', effectType: 'taunt', payload: { tauntCasterId: caster.id }, sourceIsConcentration: true });
  emit(state, 'condition_add', caster.id, `${target.name} is TAUNTED by Compelled Duel! (disadv on attacks vs non-caster)`, target.id);
}

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
