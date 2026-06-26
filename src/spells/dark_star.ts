// ============================================================
// Dark Star — XGE p.153
// 8th-level evocation, action, range 150 ft. Canon: concentration, up to
// 1 minute. v1: concentration simplified to one-shot.
// Components: V, S, M (a shard of onyx).
//
// Effect: You conjure a globe of darkness in a 40-foot-radius sphere
//         centered on a point you choose within range. The globe spreads
//         around corners. The area within the globe is heavily obscured
//         (magical darkness). Each creature in the area when the globe
//         appears must make a Constitution saving throw. On a failed save,
//         a creature takes 8d8 necrotic damage and is blinded for the
//         duration. On a successful save, a creature takes half as much
//         damage and isn't blinded.
//
// v1 simplifications:
//   - Concentration (XGE p.153: "concentration, up to 1 minute"): v1
//     simplifies to one-shot (concentration: false). The persistent
//     magical darkness + per-turn re-save are NOT modelled (TG-010 LOS
//     subsystem pending). One-shot 8d8 necrotic + blinded on fail.
//   - Magical darkness rider (heavily obscured): NOT modelled (TG-010).
//   - AoE: 40-ft radius sphere at a point within 150 ft.
//   - Blinded persists for v1 combat (no end-of-turn save).
//   - Upcast: none (8th-level only).
//
// Migration note (Session 24): Mirrors Sunburst (Session 23) but 8d8
// necrotic (vs 12d6 radiant), 40-ft radius (vs 60-ft), L8 slot, 150-ft
// range.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect, filterGoIProtectedTargets } from '../engine/spell_effects';

export const metadata = {
  name: 'Dark Star',
  level: 8,
  school: 'evocation',
  rangeFt: 150,                  // XGE p.153: 150 ft
  aoeRadiusFt: 40,               // XGE p.153: 40-ft radius
  dieCount: 8,
  dieSides: 8,
  damageType: 'necrotic' as const,
  concentration: false,          // v1 simplification: one-shot (canon concentration + magical darkness)
  saveAbility: 'con' as const,
  castingTime: 'action',
  darkStarConcentrationV1Simplified: true,                             // canon concentration simplified to one-shot
  darkStarMagicalDarknessV1Simplified: true,                           // TG-010 LOS subsystem pending
  darkStarBlindedDurationV1Simplified: true,                           // persists for v1 combat
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
  if (!caster.actions.some(a => a.name === 'Dark Star')) return null;
  if (!hasSpellSlot(caster, 8)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 150) continue;
    if (e.maxHP > centerThreat || (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e;
      centerThreat = e.maxHP;
      centerDist = distFt;
    }
  }
  if (!center) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 40) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Dark Star');
  const saveDC = action?.saveDC ?? 15;

  const slotLevel = consumeSpellSlot(caster, 8) ?? 8;

  // Session 79 (GoI AoE exclusion): exclude targets protected by Globe of
  // Invulnerability. PHB p.245: "the spell has no effect on them." The spell
  // still fires (slot already consumed above); protected targets are simply
  // skipped in the damage loop (and thus also skip the blinded rider).
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Dark Star! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE + blinded on fail) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
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
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Dark Star (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + BLINDED'}`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Dark Star: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);

    if (!save.success && !target.conditions.has('blinded')) {
      applySpellEffect(target, {
        casterId: caster.id,
        spellName: 'Dark Star',
        effectType: 'condition_apply',
        payload: { condition: 'blinded' },
        sourceIsConcentration: false,
      });
      emit(state, 'condition_add', caster.id, `${target.name} is BLINDED by the dark star!`, target.id);
    }
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot.
}
