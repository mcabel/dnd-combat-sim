// ============================================================
// Charm Person — PHB p.221
//
// 1st-level enchantment, action, range 30 ft, NO concentration (1 hr).
// Components: V, S.
//
// Effect: You attempt to charm a humanoid you can see within range. It
//         must make a Wisdom saving throw, and does so with advantage if
//         you or your companions are fighting it. On a failed save, the
//         creature is charmed by you until the spell ends.
//
// Upcast: +1 target per slot-level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Humanoid-only restriction (PHB p.221: "a humanoid"): NOT enforced
//     (v1 has no creature-type tag — TG-004).
//   - Combat advantage on save (PHB p.221: "with advantage if fighting"):
//     NOT modelled.
//   - Duration: canon 1 hr (no concentration). v1 has no duration tracker
//     — charmed persists for the v1 combat. NOT concentration.
//   - Upcast: +1 target/slot-level NOT modelled.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-charmed (no conc).
// Removed from `_generic_registry.ts`; routed via `case 'charmPerson':` in
// combat.ts and a planner branch in planner.ts. Mirrors Blindness/Deafness.
//
// Spell module pattern (single-target save-or-condition, NO concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (no concentration; charmed persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Charm Person', level: 1, school: 'enchantment', rangeFt: 30,
  concentration: false, saveAbility: 'wis' as const, castingTime: 'action',
  charmPersonHumanoidTypeCheckV1Implemented: false,
  charmPersonCombatAdvSaveV1Simplified: true,
  charmPersonUpcastV1Implemented: false,
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Charm Person')) return null;
  if (!hasSpellSlot(caster, 1)) return null;
  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;
    if (c.conditions.has('charmed') || c.conditions.has('incapacitated')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Charm Person')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Charm Person');
  const saveDC = action?.saveDC ?? 13;
  consumeSpellSlot(caster, 1);
  emit(state, 'action', caster.id, `${caster.name} casts Charm Person at ${target.name}! (DC ${saveDC} WIS)`, target.id);
  if (target.isDead || target.isUnconscious) return;
  const save = rollSave(target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Charm Person (rolled ${save.total})`, target.id, save.roll);
  if (save.success) { emit(state, 'action', caster.id, `${target.name} resists Charm Person — not charmed!`, target.id); return; }
  applySpellEffect(target, { casterId: caster.id, spellName: 'Charm Person', effectType: 'condition_apply', payload: { condition: 'charmed' }, sourceIsConcentration: false });
  emit(state, 'condition_add', caster.id, `${target.name} is CHARMED by Charm Person! (humanoid-only NOT enforced in v1)`, target.id);
}

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration */ }
