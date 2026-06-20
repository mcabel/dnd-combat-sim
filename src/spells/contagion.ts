// ============================================================
// Contagion — PHB p.227
//
// 5th-level necromancy, action, range Touch (5 ft), NO concentration.
// Components: V, S.
//
// Effect: Your touch inflicts disease. Make a melee spell attack against
//         a creature within your reach. On a hit, you afflict the
//         creature with a disease of your choice... After 3 failed
//         saves, the disease takes full effect.
//
// Upcast: none (5th-level spell — no upcast).
//
// v1 simplifications:
//   - Disease-after-3-saves (PHB p.227: target makes CON saves; after 3
//     failures the disease takes effect): v1 simplifies to IMMEDIATE
//     poisoned on hit (no 3-save escalation). Documented via
//     `contagionThreeSaveEscalationV1Simplified`.
//   - Disease choice (PHB p.227: 6 named diseases with varied effects):
//     v1 picks `poisoned` (the common/simplest disabling condition).
//     Documented via `contagionDiseaseChoiceV1SimplifiedToPoisoned`.
//   - NO damage (PHB p.227: the diseases cause conditions, not direct
//     damage). v1 applies poisoned on hit, no damage roll.
//   - NO concentration (PHB p.227: instantaneous — the disease is a
//     non-concentration persistent effect).
//   - Melee spell attack: mirrors Inflict Wounds (rollAttack vs AC,
//     hitBonus from action or WIS mod). crit does NOT double (no dice
//     to double — no damage).
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke melee-spell-attack + poisoned. Removed
// from `_generic_registry.ts`; routed via `case 'contagion':` in combat.ts
// and a planner branch in planner.ts. Mirrors Inflict Wounds (melee spell
// attack) + Blindness/Deafness (condition_apply on hit).
//
// Spell module pattern (melee spell attack + condition):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous; poisoned persists via condition_apply)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { rollAttack, abilityMod } from '../engine/utils';
import { isAdjacent, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Contagion',
  level: 5,
  school: 'necromancy',
  rangeFt: 5,                    // PHB p.227: touch = 5 ft
  concentration: false,
  saveAbility: null,             // PHB p.227: NO save (melee spell attack)
  castingTime: 'action',
  contagionThreeSaveEscalationV1Simplified: true,         // immediate poisoned on hit
  contagionDiseaseChoiceV1SimplifiedToPoisoned: true,     // v1 picks poisoned
  contagionHitBonusFromActionV1Implemented: true,         // uses action.hitBonus
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
 * Returns the single best target for Contagion (a living ADJACENT enemy,
 * not already poisoned), or null when the spell should not be cast.
 * Target priority: highest-threat (maxHP), then lowest current HP.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Contagion')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number }> = [];
  for (const e of enemies) {
    if (!isAdjacent(caster.pos, e.pos)) continue;
    if (e.conditions.has('poisoned')) continue;
    candidates.push({ c: e, threat: e.maxHP, curHP: e.currentHP });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.curHP - b.curHP);
  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Contagion');
  const hitBonus = action?.hitBonus ?? abilityMod(caster.wis);

  consumeSpellSlot(caster, 5);

  emit(state, 'action', caster.id,
    `${caster.name} casts Contagion! (melee spell attack, poisoned on hit, no damage)`, target.id);

  if (target.isDead || target.isUnconscious) {
    emit(state, 'attack_miss', caster.id, `Contagion: ${target.name} is already down — spell fizzles.`, target.id);
    return;
  }

  const result = rollAttack(hitBonus, false, false);
  const effectiveAC = target.ac;

  if (result.total < effectiveAC && !result.isCrit) {
    emit(state, 'attack_miss', caster.id,
      `${caster.name} misses ${target.name} with Contagion (${result.total} vs AC ${effectiveAC}) — no disease!`, target.id, result.roll);
    return;
  }

  emit(state, result.isCrit ? 'attack_crit' : 'attack_hit', caster.id,
    `${caster.name} ${result.isCrit ? 'CRITS' : 'hits'} ${target.name} with Contagion (${result.total} vs AC ${effectiveAC})`, target.id, result.roll);

  // Apply poisoned on hit (disease-after-3-saves simplified to immediate).
  if (!target.conditions.has('poisoned')) {
    applySpellEffect(target, {
      casterId: caster.id, spellName: 'Contagion',
      effectType: 'condition_apply', payload: { condition: 'poisoned' },
      sourceIsConcentration: false,
    });
    emit(state, 'condition_add', caster.id,
      `${target.name} is POISONED by Contagion! (disadvantage on attacks/ability checks)`, target.id);
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — instantaneous; poisoned persists */ }
