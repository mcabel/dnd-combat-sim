// ============================================================
// Dominate Person — PHB p.235
//
// 5th-level enchantment, action, range 60 ft, concentration (1 hr).
// Components: V, S.
//
// Effect: You attempt to beguile a humanoid that you can see within
//         range. It must succeed on a Wisdom saving throw or be charmed
//         by you for the duration. (Identical to Dominate Monster but
//         humanoid-only.)
//
// Upcast: +1 hour per slot-level above 5th (not modelled in v1).
//
// v2 implementation:
//   - Control-override: 'dominated' effect applies charmed + incapacitated.
//     The dominated creature can't take independent actions (incapacitated).
//     The caster could control the creature's actions by spending their own
//     action, but v1 has no mechanism for controlling another creature's
//     turn — so dominated = removed from combat (charmed + incapacitated).
//   - Creature-type enforcement: target must be a humanoid. If the target's
//     creatureType is set and is not 'humanoid', the spell skips them.
//     If creatureType is undefined (unknown), we allow (be permissive).
//   - Concentration: sourceIsConcentration: true — both conditions removed
//     when concentration breaks.
//
// NOT modelled:
//   - Repeat save on damage (PHB p.235: target can repeat save each time
//     it takes damage).
//   - Combat advantage on save (PHB p.235: "If you or creatures that are
//     friendly to you are fighting it, it has advantage on the saving
//     throw" — v1's rollSave has no adv-from-combat hook).
//   - Upcast duration extension (+1 hour per slot-level above 5th).
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
  name: 'Dominate Person',
  level: 5,
  school: 'enchantment',
  rangeFt: 60,                   // PHB p.235: 60 ft
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  dominatePersonControlV2Implemented: true,
  dominatePersonHumanoidTypeCheckV2Implemented: true,
  dominatePersonConcentrationEnforcementV1Implemented: true,  // TG-002 DONE (Session 34)
  dominatePersonCombatAdvSaveV1Simplified: true,               // in-combat adv on save NOT modelled
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
 * Returns the single best target for Dominate Person (a living enemy
 * humanoid within 60 ft, not already charmed/incapacitated), or null when
 * the spell should not be cast. Target priority: highest-threat, then closest.
 *
 * Creature-type enforcement (PHB p.235): only humanoids are valid targets.
 * If creatureType is set and is not 'humanoid', the candidate is skipped.
 * If creatureType is undefined (unknown type), we allow — be permissive.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Dominate Person')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    // Creature-type enforcement: target must be a humanoid
    if (c.creatureType && c.creatureType !== 'humanoid') continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;
    if (c.conditions.has('charmed') || c.conditions.has('incapacitated')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Dominate Person')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Dominate Person');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 5);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Dominate Person');

  emit(state, 'action', caster.id, `${caster.name} casts Dominate Person at ${target.name}! (DC ${saveDC} WIS)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Dominate Person (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Dominate Person!`, target.id);
    return;
  }

  // v2: dominated effect = charmed + incapacitated (control-override)
  applySpellEffect(target, {
    casterId: caster.id, spellName: 'Dominate Person',
    effectType: 'dominated', payload: {},
    sourceIsConcentration: true,
  });
  emit(state, 'condition_add', caster.id,
    `${target.name} is DOMINATED by Dominate Person! (charmed + incapacitated)`, target.id);
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
