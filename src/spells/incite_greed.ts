// ============================================================
// Incite Greed — EGtW p.151 (Explorer's Guide to Wildemount)
//
// 3rd-level enchantment, action, range 30 ft (cone), concentration (1 min).
// Components: V, S, M (a coin).
//
// Effect: You weave a charm over a 30-foot cone of creatures. Each
//         creature in the area must make a Wisdom saving throw. On a
//         failed save, the creature is charmed by you for the duration.
//
// Upcast: none (3rd-level spell — no upcast).
//
// v1 simplifications: cone from caster (inConeFt aimed at nearest enemy);
// concentration not enforced (TG-002); charmed is conc-sourced; end-of-turn
// save not modelled; range 30-ft cone (chebyshev/inConeFt approx).
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-charmed cone (concentration).
// Removed from `_generic_registry.ts`; routed via `case 'inciteGreed':` in
// combat.ts and a planner branch in planner.ts. Mirrors Spray of Cards
// (cone) + Hold Person (concentration) but charmed.
//
// Spell module pattern (cone AoE save + condition, concentration):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
import { inConeFt, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Incite Greed',
  level: 3,
  school: 'enchantment',
  rangeFt: 30,                   // 30-ft cone
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  inciteGreedConcentrationEnforcementV1Implemented: true,
  inciteGreedEndOfTurnSaveV1Implemented: false,
} as const;

const CONE_RANGE_FT = 30;
const CONE_HALF_ANGLE_DEG = 26.57;

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

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Incite Greed')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  let nearest: Combatant | null = null;
  let nearestDistFt = Infinity;
  for (const e of enemies) {
    const dx = e.pos.x - caster.pos.x;
    const dy = e.pos.y - caster.pos.y;
    const distFt = Math.sqrt(dx * dx + dy * dy) * 5;
    if (distFt <= CONE_RANGE_FT && distFt < nearestDistFt) {
      nearest = e; nearestDistFt = distFt;
    }
  }
  if (!nearest) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    if (inConeFt(caster.pos, nearest.pos, e.pos, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT)) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Incite Greed');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 3);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Incite Greed');

  emit(state, 'action', caster.id,
    `${caster.name} casts Incite Greed! (DC ${saveDC} WIS, charmed on fail, ${CONE_RANGE_FT}-ft cone) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`);

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;
    const save = rollSave(target, 'wis', saveDC);
    emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Incite Greed (rolled ${save.total})${save.success ? '' : ' + CHARMED'}`, target.id, save.roll);

    if (!save.success && !target.conditions.has('charmed')) {
      applySpellEffect(target, {
        casterId: caster.id, spellName: 'Incite Greed',
        effectType: 'condition_apply', payload: { condition: 'charmed' },
        sourceIsConcentration: true,
      });
      emit(state, 'condition_add', caster.id, `${target.name} is CHARMED by Incite Greed!`, target.id);
    }
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
