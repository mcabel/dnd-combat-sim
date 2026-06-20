// ============================================================
// Hold Monster — PHB p.251
//
// 5th-level enchantment, action, range 60 ft, concentration (1 min).
// Components: V, S, M (a small, straight piece of iron).
//
// Effect: Choose a creature that you can see within range. The target
//         must succeed on a Wisdom saving throw or be paralyzed for the
//         duration. (Identical to Hold Person but affects ANY creature,
//         not just humanoids.)
//
// Upcast: +1 target per slot level above 5th (not modelled in v1).
//
// v1 simplifications: same as Hold Person — concentration not enforced
// on damage (TG-002); end-of-turn WIS save skipped; upcast not modelled;
// paralyzed auto-crit not modelled (advantage only). Creature type: any
// (Hold Monster's distinguishing feature vs Hold Person — both are v1
// gaps since v1 doesn't check creature type anyway).
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-paralyzed (concentration).
// Removed from `_generic_registry.ts`; routed via `case 'holdMonster':`
// in combat.ts and a planner branch in planner.ts. Mirrors Hold Person
// exactly (single-target concentration save-or-paralyzed) but L5.
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
  name: 'Hold Monster',
  level: 5,
  school: 'enchantment',
  rangeFt: 60,                   // PHB p.251: 60 ft
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  holdMonsterEndOfTurnSaveV1Implemented: false,
  holdMonsterUpcastV1Implemented: false,
  holdMonsterConcentrationEnforcementV1Implemented: false,
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
 * Returns the single best target for Hold Monster (a living enemy within
 * 60 ft, not already paralyzed/incapacitated), or null when the spell
 * should not be cast. Target priority: highest-threat (maxHP), then closest.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Hold Monster')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;
    if (c.conditions.has('paralyzed') || c.conditions.has('incapacitated')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Hold Monster')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Hold Monster');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 5);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Hold Monster');

  emit(state, 'action', caster.id, `${caster.name} casts Hold Monster at ${target.name}! (DC ${saveDC} WIS)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Hold Monster (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Hold Monster — not paralyzed!`, target.id);
    return;
  }

  applySpellEffect(target, {
    casterId: caster.id, spellName: 'Hold Monster',
    effectType: 'condition_apply', payload: { condition: 'paralyzed' },
    sourceIsConcentration: true,
  });
  emit(state, 'condition_add', caster.id,
    `${target.name} is PARALYZED! (incapacitated, can't move, attacks vs them have advantage)`, target.id);
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
