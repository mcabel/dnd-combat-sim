// ============================================================
// Cause Fear — XGE p.151
//
// 1st-level necromancy, action, range 60 ft, NO concentration (1 min).
// Components: V.
//
// Effect: You awaken the sense of mortality in one creature you can see
//         within range. The target must succeed on a Wisdom saving throw
//         or become frightened of you until the spell ends.
//
// Upcast: +1 target per slot-level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Duration: canon 1 min (no concentration). v1 has no duration tracker
//     — frightened persists for the v1 combat. NOT concentration.
//   - Upcast: +1 target/slot-level NOT modelled — v1 targets 1 creature.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-frightened (no conc).
// Removed from `_generic_registry.ts`; routed via `case 'causeFear':` in
// combat.ts and a planner branch in planner.ts. Mirrors Blindness/Deafness.
//
// Spell module pattern (single-target save-or-condition, NO concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (no concentration; frightened persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Cause Fear', level: 1, school: 'necromancy', rangeFt: 60,
  concentration: false, saveAbility: 'wis' as const, castingTime: 'action',
  causeFearUpcastV1Implemented: false,
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Cause Fear')) return null;
  if (!hasSpellSlot(caster, 1)) return null;
  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;
    if (c.conditions.has('frightened')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Cause Fear')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Cause Fear');
  const saveDC = action?.saveDC ?? 13;
  consumeSpellSlot(caster, 1);
  emit(state, 'action', caster.id, `${caster.name} casts Cause Fear at ${target.name}! (DC ${saveDC} WIS)`, target.id);
  if (target.isDead || target.isUnconscious) return;
  const save = rollSaveReactable(state, caster, target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Cause Fear (rolled ${save.total})`, target.id, save.roll);
  if (save.success) { emit(state, 'action', caster.id, `${target.name} resists Cause Fear — not frightened!`, target.id); return; }
  applySpellEffect(target, {
    casterId: caster.id, spellName: 'Cause Fear', effectType: 'condition_apply',
    payload: { condition: 'frightened' },
    sourceIsConcentration: false, sourceCreatureType: caster.creatureType,
    appliedTurn: state.battlefield.round,
    sourceTurnExpires: state.battlefield.round + 10,   // XGE: 1 min = 10 rounds
  });
  emit(state, 'condition_add', caster.id, `${target.name} is FRIGHTENED by Cause Fear!`, target.id);
}

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration */ }
