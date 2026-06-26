// ============================================================
// Gravity Fissure — EGtW p.162
// 6th-level evocation, action, range Self (100-ft line), NO concentration.
// Components: V, S, M (a pickaxe tip).
//
// Effect: You manifest a ravine of gravitational energy in a line
//         originating from you that is 100 feet long and 5 feet wide.
//         Each creature in that area must make a Constitution saving
//         throw, taking 8d8 force damage on a failed save or half as
//         much on a successful one. Each creature within 10 feet of the
//         line but not in it must succeed on a Constitution saving throw
//         or take half damage and be pulled toward the line.
//
// v1 simplifications:
//   - Line geometry: 100-ft × 5-ft line via inLineFt. Mirrors Lightning Bolt.
//   - "Within 10 ft of line" secondary AoE + pull rider: NOT modelled.
//   - Upcast: +1d8/slot-level above 6th NOT modelled.
//   - NOT concentration (EGtW p.162: instantaneous).
//
// Migration note (Session 24): Mirrors Lightning Bolt (Session 21) line
// pattern but 8d8 force, L6 slot.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { inLineFt, chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { filterGoIProtectedTargets } from '../engine/spell_effects';

export const metadata = {
  name: 'Gravity Fissure',
  level: 6,
  school: 'evocation',
  rangeFt: 100,                  // EGtW p.162: 100-ft line
  lineLengthFt: 100,             // EGtW p.162
  lineWidthFt: 5,                // PHB p.204 (default line width)
  dieCount: 8,
  dieSides: 8,
  damageType: 'force' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  gravityFissureSecondaryAoeV1Simplified: true,                       // "within 10 ft of line" + pull NOT modelled
  gravityFissureUpcastV1Implemented: false,                            // +1d8/slot-level NOT modelled
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Gravity Fissure')) return null;
  if (!hasSpellSlot(caster, 6)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  let aimAt: Combatant | null = null;
  let aimThreat = -1;
  let aimDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 100) continue;
    if (e.maxHP > aimThreat || (e.maxHP === aimThreat && distFt < aimDist)) {
      aimAt = e;
      aimThreat = e.maxHP;
      aimDist = distFt;
    }
  }
  if (!aimAt) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    if (inLineFt(caster.pos, aimAt.pos, e.pos, metadata.lineLengthFt, metadata.lineWidthFt)) {
      targets.push(e);
    }
  }
  return targets.length >= 1 ? targets : null;
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Gravity Fissure');
  const saveDC = action?.saveDC ?? 15;

  const slotLevel = consumeSpellSlot(caster, 6) ?? 6;

  // Session 79 (GoI AoE exclusion): exclude targets protected by Globe of
  // Invulnerability. PHB p.245: "the spell has no effect on them." The spell
  // still fires (slot already consumed above); protected targets are simply
  // skipped in the damage loop.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id, state.battlefield);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Gravity Fissure! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.lineLengthFt}-ft × ${metadata.lineWidthFt}-ft line) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
  );

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'con', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Gravity Fissure (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Gravity Fissure: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous.
}
