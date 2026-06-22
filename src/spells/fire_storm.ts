// ============================================================
// Fire Storm — PHB p.242
// 7th-level evocation, action, range 150 ft, NO concentration.
// Components: V, S.
//
// Effect: A storm made of roaring flame appears in a 20-foot-radius
//         cylinder centered on a point you choose within range. (PHB p.242
//         actually lets you shape up to ten 10-ft cubes — v1 simplifies
//         to a single 40-ft radius sphere.) Each creature in the area
//         makes a Dexterity saving throw. On a failed save, a creature
//         takes 7d10 fire damage; on a successful save, it takes half
//         as much.
//
// v1 simplifications:
//   - Shape: canon "ten 10-ft cubes" (PHB p.242). v1 simplifies to a single
//     40-ft radius sphere at a point within 150 ft (per plan). Documented
//     via `fireStormShapeV1Simplified: true`.
//   - Flammable-object ignition rider: NOT modelled.
//   - Upcast: +1d10/slot-level above 7th NOT modelled.
//   - NOT concentration (PHB p.242: instantaneous).
//
// Migration note (Session 24): Mirrors Shatter (Session 18) but 7d10 fire,
// 40-ft radius, L7 slot, 150-ft range.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Fire Storm',
  level: 7,
  school: 'evocation',
  rangeFt: 150,                  // PHB p.242: 150 ft
  aoeRadiusFt: 40,               // v1: 40-ft radius (canon: ten 10-ft cubes)
  dieCount: 7,
  dieSides: 10,
  damageType: 'fire' as const,
  concentration: false,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  fireStormShapeV1Simplified: true,                                   // canon ten-10ft-cubes → v1 40-ft radius
  fireStormUpcastV1Implemented: false,                                 // +1d10/slot-level NOT modelled
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
  if (!caster.actions.some(a => a.name === 'Fire Storm')) return null;
  if (!hasSpellSlot(caster, 7)) return null;

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
  const action = caster.actions.find(a => a.name === 'Fire Storm');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 7);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Fire Storm! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'dex', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Fire Storm (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Fire Storm: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous.
}
