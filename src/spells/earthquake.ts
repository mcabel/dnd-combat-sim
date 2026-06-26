// ============================================================
// Earthquake — PHB p.234
// 8th-level evocation, action, range Self (100-ft radius — v1 uses 50-ft
// per plan). Canon: concentration, up to 1 minute. v1: concentration +
// multi-effect simplified to one-shot auto-hit AoE.
// Components: V, S, M (a pinch of dirt, a piece of rock, and a lump of clay).
//
// Effect: You create a seismic disturbance at a point on the ground that
//         you can see within range. For the duration, an intense tremor
//         rips through the ground in a 100-foot-radius circle centered on
//         that point. (v1 uses 50-ft radius per plan.) Each creature on
//         the ground other than you in that area must make a Constitution
//         saving throw. On a failed save, a creature takes 5d6 bludgeoning
//         damage and is knocked prone. On a successful save, the creature
//         takes half as much damage and isn't knocked prone.
//
//         Canon riders (NOT modelled in v1): difficult terrain, fissures,
//         structure collapse, per-turn re-save.
//
// v1 simplifications:
//   - Per plan: v1 reclassifies as AUTO-HIT AoE (no save — just 5d6
//     bludgeoning to all enemies in range). The plan explicitly says
//     "no save — auto-hit AoE". This deviates from canon (which has a
//     CON save + prone). Documented via `earthquakeAutoHitV1PerPlan: true`.
//   - Concentration + multi-effect (PHB p.234: "concentration, up to 1
//     minute"; fissures + difficult terrain + per-turn re-save): v1
//     simplifies to one-shot auto-hit (concentration: false). All riders
//     NOT modelled. Documented via `earthquakeConcentrationV1Simplified: true`.
//   - Radius: canon 100-ft. v1 uses 50-ft per plan. Documented via
//     `earthquakeRadius50ftV1PerPlan: true`.
//   - Upcast: none (8th-level only).
//
// Migration note (Session 24): NEW auto-hit AoE pattern (mirrors
// spellfire_flare's auto-hit + shatter's AoE shape). shouldCast returns
// Combatant[] (all enemies within 50 ft of the caster — Self range).
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { filterGoIProtectedTargets } from '../engine/spell_effects';

export const metadata = {
  name: 'Earthquake',
  level: 8,
  school: 'evocation',
  rangeFt: 0,                    // v1: Self (50-ft radius per plan)
  aoeRadiusFt: 50,               // v1: 50-ft radius (canon 100-ft)
  dieCount: 5,
  dieSides: 6,
  damageType: 'bludgeoning' as const,
  concentration: false,          // v1 simplification: one-shot (canon concentration 1 min + multi-effect)
  castingTime: 'action',
  earthquakeAutoHitV1PerPlan: true,                                   // v1: auto-hit (canon has CON save + prone)
  earthquakeConcentrationV1Simplified: true,                           // canon concentration + multi-effect simplified
  earthquakeRadius50ftV1PerPlan: true,                                 // v1: 50-ft radius (canon 100-ft)
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
  if (!caster.actions.some(a => a.name === 'Earthquake')) return null;
  if (!hasSpellSlot(caster, 8)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt <= 50) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const slotLevel = consumeSpellSlot(caster, 8) ?? 8;

  // Session 79: exclude targets protected by Globe of Invulnerability from
  // this AoE. PHB p.245: "the spell has no effect on them." The spell still
  // fires (slot already consumed above); protected targets are simply
  // skipped in the damage loop. Earthquake is auto-hit (no save), but GoI
  // still blocks the damage.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Earthquake! (AUTO-HIT — no save; ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius self-centred AoE) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
  );

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;

    // Auto-hit: no save, just apply 5d6 bludgeoning.
    const dmg = rollDamage();
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
    emit(
      state, 'damage', caster.id,
      `Earthquake: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg}, auto-hit)`,
      target.id, dealt,
    );
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot.
}
