// ============================================================
// Maddening Darkness — XGE p.158
// 8th-level evocation, action, range 120 ft. Canon: concentration, up to
// 10 minutes. v1: concentration + darkness simplified to one-shot.
// Components: V, S, M (a pinch of soot).
//
// Effect: Magical darkness spreads from a point you choose within range
//         to fill a 60-foot-radius sphere for the duration. Each creature
//         in that area when the spell is cast must make a Wisdom saving
//         throw. On a failed save, a creature takes 8d8 psychic damage
//         and is affected by the darkness (heavily obscured — can't see).
//
//         NOTE: XGE p.158 does NOT apply a condition — it's 8d8 psychic +
//         magical darkness (heavily obscured). v1 has no LOS/darkness
//         subsystem (TG-010 pending), so the darkness rider is simplified
//         away (no condition applied). Per the plan: "darkness rider
//         simplified — no condition applied, just 8d8 psychic".
//
// v1 simplifications:
//   - Concentration (XGE p.158: "concentration, up to 10 minutes"): v1
//     simplifies to one-shot (concentration: false). The persistent
//     magical darkness is NOT modelled (TG-010 pending). One-shot 8d8
//     psychic. Documented via `maddeningDarknessConcentrationV1Simplified: true`.
//   - Magical darkness rider (heavily obscured): NOT modelled (TG-010).
//     Documented via `maddeningDarknessDarknessRiderV1Simplified: true`.
//   - AoE: 60-ft radius sphere at a point within 120 ft.
//   - Upcast: none (8th-level only).
//
// Migration note (Session 24): Mirrors Sunburst (Session 23) AoE shape
// but NO condition (the plan reclassifies from AoE+condition to pure AoE
// save). 8d8 psychic, WIS save (per XGE p.158), 60-ft radius, L8 slot,
// 120-ft range.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { filterGoIProtectedTargets } from '../engine/spell_effects';

export const metadata = {
  name: 'Maddening Darkness',
  level: 8,
  school: 'evocation',
  rangeFt: 120,                  // XGE p.158: 120 ft
  aoeRadiusFt: 60,               // XGE p.158: 60-ft radius
  dieCount: 8,
  dieSides: 8,
  damageType: 'psychic' as const,
  concentration: false,          // v1 simplification: one-shot (canon concentration 10 min)
  saveAbility: 'wis' as const,   // XGE p.158: WIS save (confirmed)
  castingTime: 'action',
  maddeningDarknessConcentrationV1Simplified: true,                   // canon concentration simplified to one-shot
  maddeningDarknessDarknessRiderV1Simplified: true,                   // TG-010 LOS subsystem pending
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
  if (!caster.actions.some(a => a.name === 'Maddening Darkness')) return null;
  if (!hasSpellSlot(caster, 8)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 120) continue;
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
  const action = caster.actions.find(a => a.name === 'Maddening Darkness');
  const saveDC = action?.saveDC ?? 15;

  const slotLevel = consumeSpellSlot(caster, 8) ?? 8;

  // Session 79 (GoI AoE exclusion): exclude targets protected by Globe of
  // Invulnerability. PHB p.245: "the spell has no effect on them." The spell
  // still fires (slot already consumed above); protected targets are simply
  // skipped in the damage loop.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Maddening Darkness! (DC ${saveDC} WIS, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE — darkness rider simplified) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
  );

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'wis', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Maddening Darkness (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Maddening Darkness: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot.
}
