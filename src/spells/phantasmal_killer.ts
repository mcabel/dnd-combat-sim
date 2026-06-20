// ============================================================
// Phantasmal Killer — PHB p.265
//
// 4th-level illusion, action, range 120 ft, concentration (1 min).
// Components: V, S.
//
// Effect: You tap into the nightmares of a creature you can see within
//         range and create an illusory manifestation of its deepest
//         fears. The target must make a Wisdom saving throw. On a failed
//         save, the target becomes frightened for the duration. At the
//         start of each of the target's turns, the target takes 4d10
//         psychic damage.
//
// Upcast: +1d10/slot-level above 4th (not modelled in v1).
//
// v1 simplifications:
//   - Per-turn DoT (PHB p.265: "4d10 psychic damage at the start of each
//     of the target's turns"): v1 simplifies to ONE-SHOT 4d10 psychic on
//     the cast (no per-turn tick). Documented via
//     `phantasmalKillerPerTurnDotV1Simplified`.
//   - On success: NO damage (canon: save negates entirely). v1 deals
//     damage ONLY on a failed save.
//   - End-of-turn save to end frightened (PHB p.265): NOT modelled (no
//     end-of-turn save hook). frightened persists for combat (or until
//     concentration breaks).
//   - Concentration: canon 1 min. v1 starts concentration; not enforced
//     on damage (TG-002). frightened is sourceIsConcentration: true.
//   - Upcast: +1d10/slot-level NOT modelled — v1 always rolls 4d10.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-frightened + 4d10 psychic
// (concentration). Removed from `_generic_registry.ts`; routed via
// `case 'phantasmalKiller':` in combat.ts and a planner branch in
// planner.ts. Mirrors Hold Person (single-target conc save-or-condition)
// + one-shot damage.
//
// Spell module pattern (single-target save + damage + condition, conc):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Phantasmal Killer',
  level: 4,
  school: 'illusion',
  rangeFt: 120,                  // PHB p.265: 120 ft
  dieCount: 4,
  dieSides: 10,
  damageType: 'psychic' as const,
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  phantasmalKillerPerTurnDotV1Simplified: true,             // one-shot 4d10 (canon per-turn DoT simplified)
  phantasmalKillerEndOfTurnSaveV1Implemented: false,       // end-of-turn save skipped
  phantasmalKillerUpcastV1Implemented: false,              // +1d10/slot-level NOT modelled
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

// ---- Dice helper --------------------------------------------

export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Phantasmal Killer (a living enemy
 * within 120 ft, not already frightened), or null when the spell should
 * not be cast. Target priority: highest-threat, then closest.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Phantasmal Killer')) return null;
  if (!hasSpellSlot(caster, 4)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 120) continue;
    if (c.conditions.has('frightened') || c.conditions.has('incapacitated')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Phantasmal Killer')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Phantasmal Killer');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 4);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Phantasmal Killer');

  emit(state, 'action', caster.id,
    `${caster.name} casts Phantasmal Killer at ${target.name}! (DC ${saveDC} WIS — 4d10 ${metadata.damageType} + frightened on fail)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Phantasmal Killer (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Phantasmal Killer — no effect!`, target.id);
    return;
  }

  // On fail: deal 4d10 psychic (one-shot) + frightened (concentration-sourced).
  const dmg = rollDamage();
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
  emit(state, 'damage', caster.id,
    `Phantasmal Killer: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg})`, target.id, dealt);

  if (!target.conditions.has('frightened')) {
    applySpellEffect(target, {
      casterId: caster.id, spellName: 'Phantasmal Killer',
      effectType: 'condition_apply', payload: { condition: 'frightened' },
      sourceIsConcentration: true,
    });
    emit(state, 'condition_add', caster.id,
      `${target.name} is FRIGHTENED by Phantasmal Killer! (disadvantage on attacks/ability checks while caster is visible)`, target.id);
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
