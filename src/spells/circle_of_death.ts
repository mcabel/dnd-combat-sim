// ============================================================
// Circle of Death — PHB p.221
// 6th-level necromancy, action, range 60 ft, NO concentration.
// Components: V, S, M (the powder of a crushed black pearl worth 500 gp).
//
// Effect: A sphere of negative energy ripples out in a 60-foot-radius
//         sphere from a point within range. Each creature in that area
//         makes a Constitution saving throw. A creature takes 8d6 necrotic
//         damage on a failed save, or half as much on a successful one.
//
// v1 simplifications:
//   - AoE: 60-ft radius sphere at a point within 60 ft. v1 targets the
//     highest-threat enemy within 60 ft as the centre and applies to ALL
//     enemies within 60 ft (chebyshev3D approx — large AoE).
//   - Upcast: +2d6/slot-level above 6th NOT modelled.
//   - NOT concentration (PHB p.221: instantaneous).
//
// Migration note (Session 24): Mirrors Sunburst (Session 23) AoE pattern
// but no condition, 8d6 necrotic, L6 slot.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Circle of Death',
  level: 6,
  school: 'necromancy',
  rangeFt: 60,                   // PHB p.221: 60 ft
  aoeRadiusFt: 60,               // PHB p.221: 60-ft radius
  dieCount: 8,
  dieSides: 6,
  damageType: 'necrotic' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  circleOfDeathUpcastV1Implemented: false,                            // +2d6/slot-level NOT modelled
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
  if (!caster.actions.some(a => a.name === 'Circle of Death')) return null;
  if (!hasSpellSlot(caster, 6)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
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
    if (distFt <= 60) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Circle of Death');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 6);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Circle of Death! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSave(target, 'con', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Circle of Death (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Circle of Death: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous.
}
