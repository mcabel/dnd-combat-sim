// ============================================================
// Flame Strike — PHB p.243
//
// 5th-level evocation, action, range 60 ft, NO concentration.
// Components: V, S, M (pinch of sulfur).
//
// Effect: A vertical column of divine fire roars down from the sky in a
//         10-foot-radius, 40-foot-high cylinder centered on a point you
//         choose within range. Each creature in the cylinder must make a
//         Dexterity saving throw. A creature takes 4d6 fire damage + 4d6
//         radiant damage on a failed save, or half as much damage on a
//         successful one.
//
// Upcast: +1d6 fire + 1d6 radiant per slot level above 5th (not modelled).
//
// v1 simplifications:
//   - AoE shape: canon 10-ft radius cylinder at a point within 60 ft. v1
//     targets the highest-threat enemy within 60 ft as the cylinder's
//     centre and applies to ALL enemies within 10 ft (chebyshev3D approx).
//     Mirrors Shatter (Session 18) but with a 10-ft radius (same).
//   - Dual damage type: 4d6 fire + 4d6 radiant. v1 rolls each separately
//     and applies them as TWO damage applications (fire then radiant) so
//     per-type resistances apply correctly. The save halves BOTH. Mirrors
//     Ice Storm (Session 24). Documented via `flameStrikeDualDamageV1Implemented: true`.
//   - Upcast: NOT modelled.
//   - NOT concentration (PHB p.243: instantaneous).
//
// Migration note (Session 24): Mirrors Ice Storm (Session 24) for the
// dual-damage pattern, but with 4d6 fire + 4d6 radiant (vs 2d8 cold +
// 2d6 bludgeoning), 10-ft radius (vs 20-ft), L5 slot (vs L4).
//
// Spell module pattern (AoE save radius, dual damage — mirrors ice_storm.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP, elementalAffinityBonus } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Flame Strike',
  level: 5,
  school: 'evocation',
  rangeFt: 60,                   // PHB p.243: 60 ft
  aoeRadiusFt: 10,               // PHB p.243: 10-ft radius cylinder
  dieCount: 4,                   // fire dice count
  dieSides: 6,
  radiantDieCount: 4,            // radiant dice count (PHB p.243: 4d6)
  radiantDieSides: 6,
  damageType: 'fire' as const,
  concentration: false,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  flameStrikeDualDamageV1Implemented: true,                           // 4d6 fire + 4d6 radiant, applied separately
  flameStrikeUpcastV1Implemented: false,                               // +1d6 fire + 1d6 radiant NOT modelled
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function rollDamageFire(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

export function rollDamageRadiant(): number {
  let total = 0;
  for (let i = 0; i < metadata.radiantDieCount; i++) total += rollDie(metadata.radiantDieSides);
  return total;
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Flame Strike')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

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
    if (distFt <= 10) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Flame Strike');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 5);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Flame Strike! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} fire + ${metadata.radiantDieCount}d${metadata.radiantDieSides} radiant, ${metadata.aoeRadiusFt}-ft radius AoE) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'dex', saveDC);

    // Session 50 Task #29-follow-up-5c-3: Elemental Affinity (Draconic
    // Sorcerer 6) adds CHA mod to the FIRE damage only if the caster's
    // ancestry is fire. The radiant portion does NOT get EA — radiant is
    // not a draconic ancestry type.
    const eaBonus = elementalAffinityBonus(caster, 'fire');
    const fireRaw = rollDamageFire() + eaBonus;
    const radRaw = rollDamageRadiant();
    const fire = save.success ? Math.floor(fireRaw / 2) : fireRaw;
    const rad = save.success ? Math.floor(radRaw / 2) : radRaw;

    const fireDealt = applyDamageWithTempHP(target, fire, 'fire');
    const radDealt = applyDamageWithTempHP(target, rad, 'radiant');
    const totalDealt = fireDealt + radDealt;

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Flame Strike (rolled ${save.total}) — ${fireDealt} fire + ${radDealt} radiant = ${totalDealt} total damage (${save.success ? 'halved' : 'full'})`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Flame Strike: ${target.name} takes ${totalDealt} damage (${fireDealt} fire + ${radDealt} radiant)`, target.id, totalDealt);
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous.
}
