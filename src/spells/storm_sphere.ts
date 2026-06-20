// ============================================================
// Storm Sphere — XGE p.166
//
// 4th-level evocation, action, range 150 ft. Canon: concentration,
// up to 1 minute. v1: concentration + riders simplified to one-shot.
// Components: V, S.
//
// Effect: A 20-foot-radius sphere of whirling air and 40-foot-high
//         cylinder of wind (the "storm sphere") appears centered on a
//         point within range. The area is difficult terrain. Each
//         creature in the sphere makes a Constitution save. On a failed
//         save, a creature takes 6d6 thunder damage. On a successful
//         save, a creature takes half as much damage.
//
//         Canon riders (NOT modelled in v1):
//         - Each creature within 40 ft of the sphere (not just inside):
//           no extra effect in canon (the sphere is 20-ft radius).
//         - Bonus action: 1d8 lightning bolt at a creature within 60 ft
//           of the sphere — v1 does NOT model this (no per-turn bonus-
//           action rider subsystem).
//         - Difficult terrain: NOT modelled.
//
// Upcast: +1d6 thunder per slot level above 4th (not modelled in v1).
//
// v1 simplifications:
//   - Concentration (XGE p.166: "concentration, up to 1 minute"): v1
//     simplifies to one-shot (concentration: false). The persistent
//     difficult-terrain + per-turn bonus-action lightning bolt are NOT
//     modelled. One-shot 6d6 thunder AoE. Documented via
//     `stormSphereConcentrationV1Simplified: true`.
//   - AoE shape: canon 20-ft radius sphere (v1 follows XGE p.166, NOT
//     the plan's "40-ft sphere" note — the plan mis-stated the radius).
//     v1 targets the highest-threat enemy within 150 ft as the sphere's
//     centre and applies to ALL enemies within 20 ft (chebyshev3D approx).
//   - Plan deviation: the plan says "40-ft sphere"; XGE p.166 says
//     20-ft radius. v1 follows canon (20-ft). Documented via
//     `stormSphereRadius20ftCanonV1: true`.
//   - Lightning-bolt bonus action (XGE p.166): NOT modelled.
//   - Upcast: NOT modelled.
//
// Migration note (Session 24): Mirrors Shatter (Session 18) but with
// 6d6 thunder, 20-ft radius (canon; plan's 40-ft is wrong), L4 slot,
// 150-ft range.
//
// Spell module pattern (AoE save radius — mirrors shatter.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (v1 one-shot)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Storm Sphere',
  level: 4,
  school: 'evocation',
  rangeFt: 150,                  // XGE p.166: 150 ft
  aoeRadiusFt: 20,               // XGE p.166: 20-ft radius (canon; plan's 40-ft is wrong)
  dieCount: 6,
  dieSides: 6,
  damageType: 'thunder' as const,
  concentration: false,          // v1 simplification: one-shot (canon concentration 1 min)
  saveAbility: 'con' as const,
  castingTime: 'action',
  stormSphereConcentrationV1Simplified: true,                         // canon concentration simplified to one-shot
  stormSphereRadius20ftCanonV1: true,                                 // v1 uses canon 20-ft (plan's 40-ft is wrong)
  stormSphereLightningRiderV1Simplified: true,                       // bonus-action lightning bolt NOT modelled
  stormSphereUpcastV1Implemented: false,                              // +1d6/slot-level NOT modelled
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
  if (!caster.actions.some(a => a.name === 'Storm Sphere')) return null;
  if (!hasSpellSlot(caster, 4)) return null;

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
  const action = caster.actions.find(a => a.name === 'Storm Sphere');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 4);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Storm Sphere! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
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
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Storm Sphere (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Storm Sphere: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot.
}
