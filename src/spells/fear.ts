// ============================================================
// Fear — PHB p.239
//
// 3rd-level illusion, action, range 30 ft (cone), concentration (1 min).
// Components: V, S, M (a white feather or the heart of a hen).
//
// Effect: You project a phantasmal image of a creature's worst fears.
//         Each creature in a 30-foot cone must make a Wisdom saving
//         throw or drop whatever it is holding and become frightened
//         for the duration. (Drop-weapon rider simplified away in v1.)
//
// Upcast: none (3rd-level spell — no upcast).
//
// v1 simplifications:
//   - Drop-weapon rider (PHB p.239: "drop whatever it is holding"):
//     simplified away. v1 applies frightened only. Documented via
//     `fearDropWeaponV1Simplified`.
//   - Concentration: canon 1 min concentration (PHB p.239). Session 27
//     canon fix: Fear is now concentration (was non-conc per plan in
//     Batch 2 — "mirror Sunburst"). The frightened is conc-sourced; it
//     ends when concentration breaks (engine does NOT enforce conc checks
//     on damage taken — TG-002). Documented via `fearCanonConcentrationV1`.
//   - End-of-turn WIS save to end frightened (PHB p.239): NOT modelled
//     (the frightened persists for the v1 combat or until conc breaks).
//   - Shape: canon 30-ft cone from caster. v1 uses inConeFt aimed at the
//     nearest living enemy within 30 ft (mirrors Spray of Cards).
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-frightened cone.
// Session 27 canon fix: switched from non-concentration (per plan) to
// canon concentration (PHB p.239). Removed from `_generic_registry.ts`;
// routed via `case 'fear':` in combat.ts and a planner branch in planner.ts.
// Mirrors Spray of Cards (cone AoE) + Hold Person (concentration).
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
  name: 'Fear',
  level: 3,
  school: 'illusion',
  rangeFt: 30,                   // PHB p.239: 30-ft cone
  concentration: true,           // canon (PHB p.239) — Session 27 fix (was false per plan)
  saveAbility: 'wis' as const,
  castingTime: 'action',
  fearDropWeaponV1Simplified: true,                        // drop-weapon rider simplified away
  fearCanonConcentrationV1: true,                          // Session 27: canon conc (was non-conc per plan)
  fearEndOfTurnSaveV1Implemented: false,                   // end-of-turn WIS save NOT modelled
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

/**
 * Returns the list of enemies caught in a Fear 30-ft cone aimed at the
 * nearest living enemy within 30 ft, or null when the spell should not be cast.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;   // never interrupt active concentration
  if (!caster.actions.some(a => a.name === 'Fear')) return null;
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
  const action = caster.actions.find(a => a.name === 'Fear');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 3);

  // Safety: clean up any stale concentration before starting new.
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Fear');

  emit(state, 'action', caster.id,
    `${caster.name} casts Fear! (DC ${saveDC} WIS, frightened on fail, ${CONE_RANGE_FT}-ft cone, concentration) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`);

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;
    const save = rollSave(target, 'wis', saveDC);
    emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Fear (rolled ${save.total})${save.success ? '' : ' + FRIGHTENED'}`, target.id, save.roll);

    if (!save.success && !target.conditions.has('frightened')) {
      applySpellEffect(target, {
        casterId: caster.id, spellName: 'Fear',
        effectType: 'condition_apply', payload: { condition: 'frightened' },
        sourceIsConcentration: true,    // canon concentration (Session 27 fix)
      });
      emit(state, 'condition_add', caster.id,
        `${target.name} is FRIGHTENED! (v1: drop-weapon rider simplified; canon conc — ends if caster loses concentration)`, target.id);
    }
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup (Session 27: canon conc) */ }
