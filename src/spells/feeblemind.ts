// ============================================================
// Feeblemind — PHB p.239
// 8th-level enchantment, action, range 60 ft, NO concentration.
// Components: V, S, M (a handful of clay, crystal, glass, or mineral).
//
// Effect: You blast the mind of a creature that you can see within range,
//         attempting to shatter its intellect and personality. The target
//         takes 4d6 psychic damage and must make an Intelligence saving
//         throw. On a failed save, the creature's Intelligence and Charisma
//         scores become 1. The creature can't cast spells, activate magic
//         items, understand language, or communicate in any intelligible
//         way. The creature can still recognize its allies and follow them.
//         The spell can be ended only by heal, greater restoration, or wish.
//
// v1 simplifications:
//   - Ability-damage rider (PHB p.239: "Intelligence and Charisma scores
//     become 1"): v1 has no ability-score-damage subsystem. v1 simplifies
//     to `condition_apply:incapacitated` (can't take actions — a
//     reasonable proxy for "can't cast spells / understand language /
//     communicate"). Documented via `feeblemindAbilityDamageToIncapacitatedV1: true`.
//   - 60-day duration (PHB p.239: "can be ended only by heal, greater
//     restoration, or wish"): v1 does NOT track the duration (incapacitated
//     persists for the v1 combat). Documented via `feeblemindDurationV1Simplified: true`.
//   - Upcast: none (8th-level only).
//   - NOT concentration (PHB p.239: instantaneous — the effect is a
//     persistent non-concentration condition).
//
// Migration note (Session 24): Mirrors Catapult (Session 21) for the
// save + damage, plus Sunburst (Session 23) for the condition_apply.
// INT save, 4d6 psychic, L8 slot, 60-ft range, + incapacitated on fail.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect } from '../engine/spell_effects';

export const metadata = {
  name: 'Feeblemind',
  level: 8,
  school: 'enchantment',
  rangeFt: 60,                   // PHB p.239: 60 ft
  dieCount: 4,
  dieSides: 6,
  damageType: 'psychic' as const,
  concentration: false,
  saveAbility: 'int' as const,
  castingTime: 'action',
  feeblemindAbilityDamageToIncapacitatedV1: true,                     // INT/CHA→1 simplified to incapacitated
  feeblemindDurationV1Simplified: true,                               // 60-day duration NOT tracked
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Feeblemind')) return null;
  if (!hasSpellSlot(caster, 8)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    candidates.push({ c: e, threat: e.maxHP, curHP: e.currentHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    if (a.curHP !== b.curHP) return a.curHP - b.curHP;
    return a.dist - b.dist;
  });
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Feeblemind');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 8);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Feeblemind at ${target.name}! (DC ${saveDC} INT, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} + incapacitated on fail [INT/CHA→1 simplified])`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(state, 'save_success', caster.id, `Feeblemind: ${target.name} is already down — the psychic blast dissipates.`, target.id);
    return;
  }

  // Damage is applied regardless of save outcome (PHB p.239: "takes 4d6
  // psychic damage AND must make an INT save").
  const fullDmg = rollDamage();
  const dealt = applyDamageWithTempHP(target, fullDmg, metadata.damageType);

  const save = rollSaveReactable(state, caster, target, 'int', saveDC);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} INT save vs Feeblemind (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage${save.success ? '' : ' + INCAPACITATED (INT/CHA→1 simplified)'}`,
    target.id, save.roll,
  );
  emit(state, 'damage', caster.id, `Feeblemind: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);

  if (!save.success && !target.conditions.has('incapacitated')) {
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Feeblemind',
      effectType: 'condition_apply',
      payload: { condition: 'incapacitated' },
      sourceIsConcentration: false,
    });
    emit(state, 'condition_add', caster.id, `${target.name} is INCAPACITATED by feeblemind! (INT/CHA→1 simplified to incapacitated — can't take actions)`, target.id);
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; incapacitated persists for v1 combat.
}
