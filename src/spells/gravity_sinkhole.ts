// ============================================================
// Gravity Sinkhole — EGtW p.162
//
// 4th-level evocation, action, range 60 ft, NO concentration.
// Components: V, S, M (a chunk of magnetite).
//
// Effect: A 20-foot-radius sphere of crushing gravity centered on a
//         point within range forms in a void. Each creature in that
//         area must make a Constitution saving throw. On a failed save,
//         a creature takes 5d10 force damage and is pulled in a straight
//         line toward the center of the sphere, ending in an unoccupied
//         space as close to the center as possible. On a successful save,
//         a creature takes half as much damage and isn't pulled.
//
// Upcast: +1d10 force per slot level above 4th (not modelled in v1).
//
// v1 simplifications:
//   - AoE shape: 20-ft radius sphere at a point within 60 ft. v1 targets
//     the highest-threat enemy within 60 ft as the sphere's centre, and
//     applies the damage to ALL enemies within 20 ft of that centre
//     (chebyshev3D — square approx). Mirrors Shatter (Session 18).
//   - Pull toward centre (EGtW p.162): NOT modelled — v1 has no
//     forced-movement subsystem. Documented via
//     `gravitySinkholePullV1Simplified: true`.
//   - Upcast: +1d10/slot-level NOT modelled.
//   - NOT concentration (EGtW p.162: instantaneous).
//
// Migration note (Session 24): Mirrors Shatter but 5d10 force, 20-ft
// radius, L4 slot.
//
// Spell module pattern (AoE save radius — mirrors shatter.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Gravity Sinkhole',
  level: 4,
  school: 'evocation',
  rangeFt: 60,                   // EGtW p.162: 60 ft
  aoeRadiusFt: 20,               // EGtW p.162: 20-ft radius
  dieCount: 5,
  dieSides: 10,
  damageType: 'force' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  gravitySinkholePullV1Simplified: true,                             // forced movement NOT modelled
  gravitySinkholeUpcastV1Implemented: false,                          // +1d10/slot-level NOT modelled
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
  if (!caster.actions.some(a => a.name === 'Gravity Sinkhole')) return null;
  if (!hasSpellSlot(caster, 4)) return null;

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
    if (distFt <= 20) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Gravity Sinkhole');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 4);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Gravity Sinkhole! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'con', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Gravity Sinkhole (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Gravity Sinkhole: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous.
}
