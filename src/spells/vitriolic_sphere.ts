// ============================================================
// Vitriolic Sphere — XGE p.168 (also EGtW p.165)
//
// 4th-level evocation, action, range 150 ft, NO concentration.
// Components: V, S, M (a drop of giant slug bile).
//
// Effect: You point at a location within range, and a glowing green bead
//         of acid streaks to that point and erupts in a 20-foot-radius
//         sphere. Each creature in that area makes a Dexterity saving
//         throw. On a failed save, a creature takes 10d4 acid damage and
//         another 5d4 acid damage at the end of its next turn. On a
//         successful save, a creature takes half the initial damage and
//         none of the later damage.
//
// Upcast: +2d4 acid (initial) per slot level above 4th (not modelled).
//
// v1 simplifications:
//   - DoT (XGE p.168: "5d4 acid at the end of its next turn"): NOT
//     modelled — v1 has no end-of-target-turn damage hook. One-shot
//     10d4 acid only. Documented via `vitriolicSphereDoTV1Simplified: true`.
//   - AoE shape: 20-ft radius sphere at a point within 150 ft. v1
//     targets the highest-threat enemy within 150 ft as the sphere's
//     centre and applies to ALL enemies within 20 ft (chebyshev3D approx).
//     Mirrors Shatter (Session 18).
//   - Upcast: NOT modelled.
//   - NOT concentration (XGE p.168: instantaneous).
//
// Migration note (Session 24): Mirrors Shatter but with 10d4 acid,
// 20-ft radius, L4 slot, 150-ft range.
//
// Spell module pattern (AoE save radius — mirrors shatter.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Vitriolic Sphere',
  level: 4,
  school: 'evocation',
  rangeFt: 150,                  // XGE p.168: 150 ft
  aoeRadiusFt: 20,               // XGE p.168: 20-ft radius
  dieCount: 10,
  dieSides: 4,
  damageType: 'acid' as const,
  concentration: false,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  vitriolicSphereDoTV1Simplified: true,                               // 5d4 end-of-next-turn DoT NOT modelled
  vitriolicSphereUpcastV1Implemented: false,                           // +2d4/slot-level NOT modelled
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
  if (!caster.actions.some(a => a.name === 'Vitriolic Sphere')) return null;
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
  const action = caster.actions.find(a => a.name === 'Vitriolic Sphere');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 4);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Vitriolic Sphere! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
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
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Vitriolic Sphere (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Vitriolic Sphere: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous.
}
