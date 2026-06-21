// ============================================================
// Enemies Abound — XGE p.155
//
// 3rd-level enchantment, action, range 120 ft, concentration (1 min).
// Components: V, S.
//
// Effect: You reach into the mind of one creature you can see within
//         range and force it to make an Intelligence saving throw. On a
//         failed save, the target loses the ability to distinguish friend
//         from foe... (v1 simplifies this target-acquisition debuff to
//         frightened.)
//
// Upcast: none (3rd-level spell — no upcast).
//
// v1 simplifications:
//   - Target-acquisition debuff (XGE p.155: "cannot distinguish friend
//     from foe, may attack allies"): simplified to `condition_apply:
//     frightened` (the closest disabling condition available). Documented
//     via `enemiesAboundDebuffV1SimplifiedToFrightened`.
//   - Range: canon 120 ft. v1 uses chebyshev3D * 5.
//   - Concentration: canon 1 min concentration. v1 starts concentration;
//     not enforced on damage (TG-002). frightened is conc-sourced.
//   - End-of-turn repeat save (XGE p.155): NOT modelled.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke INT-save-or-frightened (concentration).
// Removed from `_generic_registry.ts`; routed via `case 'enemiesAbound':`
// in combat.ts and a planner branch in planner.ts. Mirrors Hold Person
// (single-target conc save-or-condition) but INT save + frightened + 120 ft.
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
  name: 'Enemies Abound',
  level: 3,
  school: 'enchantment',
  rangeFt: 120,                  // XGE p.155: 120 ft
  concentration: true,
  saveAbility: 'int' as const,
  castingTime: 'action',
  enemiesAboundDebuffV1SimplifiedToFrightened: true,       // target-acquisition → frightened
  enemiesAboundConcentrationEnforcementV1Implemented: true,
  enemiesAboundEndOfTurnSaveV1Implemented: false,
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
 * Returns the single best target for Enemies Abound (a living enemy within
 * 120 ft, not already frightened), or null when the spell should not be cast.
 * Target priority: highest-threat, then closest.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Enemies Abound')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 120) continue;
    if (c.conditions.has('frightened') || c.conditions.has('incapacitated')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Enemies Abound')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Enemies Abound');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 3);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Enemies Abound');

  emit(state, 'action', caster.id, `${caster.name} casts Enemies Abound at ${target.name}! (DC ${saveDC} INT)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'int', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} INT save vs Enemies Abound (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Enemies Abound — no effect!`, target.id);
    return;
  }

  applySpellEffect(target, {
    casterId: caster.id, spellName: 'Enemies Abound',
    effectType: 'condition_apply', payload: { condition: 'frightened' },
    sourceIsConcentration: true,
  });
  emit(state, 'condition_add', caster.id,
    `${target.name} is FRIGHTENED by Enemies Abound! (v1: target-acquisition debuff simplified to frightened)`, target.id);
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
