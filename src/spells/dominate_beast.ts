// ============================================================
// Dominate Beast — PHB p.235
//
// 4th-level enchantment, action, range 60 ft, concentration (1 min).
// Components: V, S.
//
// Effect: You attempt to beguile a beast that you can see within range.
//         It must succeed on a Wisdom saving throw or be charmed by you
//         for the duration. (Identical to Dominate Monster but beast-only.)
//
// Upcast: +1 min per slot-level above 4th (not modelled in v1).
//
// v1 simplifications: same as Dominate Monster — control simplified to
// charmed; concentration not enforced (TG-002); beast-type restriction
// not enforced (TG-004); repeat-save-on-damage not modelled.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-charmed (concentration).
// Removed from `_generic_registry.ts`; routed via `case 'dominateBeast':`
// in combat.ts and a planner branch in planner.ts. Mirrors Hold Person
// (single-target concentration save-or-condition) but with charmed + L4.
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
  name: 'Dominate Beast',
  level: 4,
  school: 'enchantment',
  rangeFt: 60,                   // PHB p.235: 60 ft
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  dominateBeastControlV1Simplified: true,
  dominateBeastConcentrationEnforcementV1Implemented: false,
  dominateBeastBeastTypeCheckV1Implemented: false,
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
 * Returns the single best target for Dominate Beast (a living enemy
 * within 60 ft, not already charmed/incapacitated), or null when the
 * spell should not be cast. Target priority: highest-threat, then closest.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Dominate Beast')) return null;
  if (!hasSpellSlot(caster, 4)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;
    if (c.conditions.has('charmed') || c.conditions.has('incapacitated')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Dominate Beast')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Dominate Beast');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 4);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Dominate Beast');

  emit(state, 'action', caster.id, `${caster.name} casts Dominate Beast at ${target.name}! (DC ${saveDC} WIS)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Dominate Beast (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Dominate Beast — not charmed!`, target.id);
    return;
  }

  applySpellEffect(target, {
    casterId: caster.id, spellName: 'Dominate Beast',
    effectType: 'condition_apply', payload: { condition: 'charmed' },
    sourceIsConcentration: true,
  });
  emit(state, 'condition_add', caster.id,
    `${target.name} is CHARMED by Dominate Beast! (v1: control rider NOT modelled — charm only)`, target.id);
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
