// ============================================================
// Ravenous Void — XGE p.159
// 9th-level evocation, action, range 1000 ft. Canon: concentration, up to
// 1 minute. v1: concentration + pull/restrained simplified to one-shot
// auto-hit AoE.
// Components: V, S, M (a black hole symbol drawn on a surface).
//
// Effect: You open a tear in the fabric of the cosmos, summoning a
//         void that devours all in its path. The void is a 60-foot-radius
//         sphere centered on a point you choose within range. Each
//         creature in that area must make a Constitution saving throw. On
//         a failed save, a creature takes 5d10 force damage, is pulled
//         toward the center of the sphere, and is restrained. On a
//         successful save, a creature takes half as much damage and isn't
//         pulled or restrained.
//
//         NOTE: XGE p.159 actually has a save. The plan spec says
//         "no save — auto-hit". v1 follows the plan's auto-hit
//         interpretation. See simplifications.
//
// v1 simplifications:
//   - Per plan: v1 reclassifies as AUTO-HIT (no save — just 5d10 force to
//     all enemies in range). The plan explicitly says "no save, just
//     damage". This deviates from canon (which has a CON save + pull +
//     restrained). Documented via `ravenousVoidAutoHitV1PerPlan: true`.
//   - Concentration + pull/restrained riders (XGE p.159): v1 simplifies
//     to one-shot auto-hit (concentration: false). Pull + restrained +
//     per-turn re-save are NOT modelled. Documented via
//     `ravenousVoidConcentrationV1Simplified: true`.
//   - Range: canon 1000 ft (huge). v1 uses 1000 ft.
//   - AoE: 60-ft radius sphere at a point within 1000 ft. v1 targets the
//     highest-threat enemy within 1000 ft as the centre and applies to
//     ALL enemies within 60 ft (chebyshev3D approx).
//   - Upcast: none (9th-level only).
//
// Migration note (Session 24): NEW auto-hit AoE pattern (mirrors
// earthquake's auto-hit + sunburst's AoE shape). L9 slot, 1000-ft range,
// 60-ft radius.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { filterGoIProtectedTargets } from '../engine/spell_effects';

export const metadata = {
  name: 'Ravenous Void',
  level: 9,
  school: 'evocation',
  rangeFt: 1000,                 // XGE p.159: 1000 ft (huge)
  aoeRadiusFt: 60,               // XGE p.159: 60-ft radius
  dieCount: 5,
  dieSides: 10,
  damageType: 'force' as const,
  concentration: false,          // v1 simplification: one-shot (canon concentration 1 min + pull/restrained)
  castingTime: 'action',
  ravenousVoidAutoHitV1PerPlan: true,                                 // v1: auto-hit (canon has CON save + pull + restrained)
  ravenousVoidConcentrationV1Simplified: true,                         // canon concentration + riders simplified
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
  if (!caster.actions.some(a => a.name === 'Ravenous Void')) return null;
  if (!hasSpellSlot(caster, 9)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 1000) continue;
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
  const slotLevel = consumeSpellSlot(caster, 9) ?? 9;

  // Session 79 (GoI AoE exclusion): exclude targets protected by Globe of
  // Invulnerability. PHB p.245: "the spell has no effect on them." The spell
  // still fires (slot already consumed above); protected targets are simply
  // skipped in the damage loop.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Ravenous Void! (AUTO-HIT — no save; ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
  );

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;

    // Auto-hit: no save, just apply 5d10 force.
    const dmg = rollDamage();
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
    emit(
      state, 'damage', caster.id,
      `Ravenous Void: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg}, auto-hit)`,
      target.id, dealt,
    );
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot.
}
