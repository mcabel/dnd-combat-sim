// ============================================================
// Bestow Curse — PHB p.214
//
// 3rd-level necromancy, action, range Touch (5 ft), concentration (1 min).
// Components: V, S.
//
// Effect: You touch a creature, and that creature must succeed on a
//         Wisdom saving throw or become cursed for the duration. Choose
//         one of the following effects: (1) disadv on one ability, (2)
//         disadv on attacks vs you, (3) take extra damage when hit, (4)
//         cannot take reactions. (v1 simplifies all to incapacitated.)
//
// Upcast: 4th (8 hr no conc), 5th+ (until dispelled) — not modelled in v1.
//
// v1 simplifications:
//   - Curse options (PHB p.214: 4 choices): v1 picks ONE —
//     `condition_apply:incapacitated` (the most disabling; a "no action"
//     curse). Documented via `bestowCurseOptionsV1SimplifiedToIncapacitated`.
//   - Range: canon Touch (5 ft). Session 27 canon fix — NOW canon Touch
//     (was 60 ft per plan in Batch 2 — "mirror hold_person"). Documented
//     via `bestowCurseCanonTouchRangeV1` (replaces `...RangeV1SimplifiedTo60Ft`).
//   - Concentration: canon 1 min concentration. v1 starts concentration;
//     not enforced on damage (TG-002). incapacitated is conc-sourced.
//   - Upcast duration extensions (no-conc at 4th) NOT modelled.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-incapacitated (concentration).
// Session 27 canon fix: reverted range to canon Touch (was 60 ft per plan).
// Removed from `_generic_registry.ts`; routed via `case 'bestowCurse':` in
// combat.ts and a planner branch in planner.ts. Mirrors Hold Person
// (single-target concentration save-or-condition) but with incapacitated.
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
  name: 'Bestow Curse',
  level: 3,
  school: 'necromancy',
  rangeFt: 5,                    // canon Touch (Session 27 fix; was 60 ft per plan)
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  bestowCurseOptionsV1SimplifiedToIncapacitated: true,    // 4 curse options → incapacitated
  bestowCurseCanonTouchRangeV1: true,                     // Session 27: canon Touch range (was 60 ft per plan)
  bestowCurseConcentrationEnforcementV1Implemented: false,
  bestowCurseUpcastV1Implemented: false,                  // duration extensions NOT modelled
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
 * Returns the single best target for Bestow Curse (a living enemy within Touch
 * range (5 ft), not already incapacitated), or null when the spell should not be cast.
 * Target priority: highest-threat, then closest.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Bestow Curse')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;   // canon Touch range (Session 27 fix; was 60 ft)
    if (c.conditions.has('incapacitated')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Bestow Curse')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Bestow Curse');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 3);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Bestow Curse');

  emit(state, 'action', caster.id, `${caster.name} casts Bestow Curse at ${target.name}! (DC ${saveDC} WIS)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Bestow Curse (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Bestow Curse — not cursed!`, target.id);
    return;
  }

  applySpellEffect(target, {
    casterId: caster.id, spellName: 'Bestow Curse',
    effectType: 'condition_apply', payload: { condition: 'incapacitated' },
    sourceIsConcentration: true,
  });
  emit(state, 'condition_add', caster.id,
    `${target.name} is INCAPACITATED by Bestow Curse! (v1: 4 curse options simplified to incapacitated; can't take actions)`, target.id);
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
