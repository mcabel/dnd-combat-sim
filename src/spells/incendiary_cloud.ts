// ============================================================
// Incendiary Cloud — PHB p.253
// 8th-level conjuration, action, range 150 ft, NO concentration.
// Components: V, S.
//
// Effect: A swirling cloud of fire shoots down from the sky in a 20-foot-
//         radius cylinder centered on a point you choose within range. The
//         cloud moves 10 feet directly away from you in a straight line
//         (canon: each of your turns). Each creature in the area makes a
//         Dexterity saving throw. On a failed save, a creature takes 10d8
//         fire damage; on a successful save, it takes half as much.
//
// v1 simplifications:
//   - Moving-cloud rider (PHB p.253: "moves 10 ft away from you each of
//     your turns"): NOT modelled — v1 has no moving-AoE subsystem. One-shot
//     10d8 fire. Documented via `incendiaryCloudMovingV1Simplified: true`.
//   - AoE: 20-ft radius cylinder at a point within 150 ft.
//   - Upcast: +2d8/slot-level above 8th NOT modelled.
//   - NOT concentration (PHB p.253: the cloud persists without concentration
//     for the duration; v1 simplifies to one-shot).
//
// Migration note (Session 24): Mirrors Shatter (Session 18) but 10d8 fire,
// 20-ft radius, L8 slot, 150-ft range.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Incendiary Cloud',
  level: 8,
  school: 'conjuration',
  rangeFt: 150,                  // PHB p.253: 150 ft
  aoeRadiusFt: 20,               // PHB p.253: 20-ft radius cylinder
  dieCount: 10,
  dieSides: 8,
  damageType: 'fire' as const,
  concentration: false,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  incendiaryCloudMovingV1Simplified: true,                             // moving-cloud rider NOT modelled
  incendiaryCloudUpcastV1Implemented: false,                            // +2d8/slot-level NOT modelled
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
  if (!caster.actions.some(a => a.name === 'Incendiary Cloud')) return null;
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
    if (distFt <= 20) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Incendiary Cloud');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 8);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Incendiary Cloud! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSave(target, 'dex', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Incendiary Cloud (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Incendiary Cloud: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot.
}
