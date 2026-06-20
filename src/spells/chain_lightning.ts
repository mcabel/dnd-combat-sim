// ============================================================
// Chain Lightning — PHB p.221
// 6th-level evocation, action, range 150 ft, NO concentration.
// Components: V, S, M (a bit of fur; a piece of amber, glass, or crystal).
//
// Effect: You create a bolt of lightning that arcs toward a target of your
//         choice that you can see within range. Three bolts then leap from
//         that target to as many as three other targets, each of which must
//         be within 30 feet of the first target. A target can be a creature
//         or an object and can be targeted by only one of the bolts.
//         A target must make a Dexterity saving throw. The target takes 10d8
//         lightning damage on a failed save, or half as much on a successful
//         one.
//
// v1 simplifications:
//   - AUTO-HIT (no save, no attack): per the plan spec, v1 treats this as
//     auto-hit 10d8 lightning to up to 4 targets (1 primary + 3 arcs within
//     30 ft of primary). PHB p.221 actually has a DEX save — v1 follows the
//     plan's "AUTO_HIT_DAMAGE multi-target" interpretation. Documented via
//     `chainLightningAutoHitV1PerPlan: true`.
//   - Upcast: +2d8/slot-level above 6th NOT modelled.
//   - NOT concentration (PHB p.221: instantaneous).
//
// Migration note (Session 24): NEW auto-hit multi-target pattern (mirrors
// magic_missile's auto-hit + fireball's multi-target). shouldCast returns
// up to 4 Combatants (1 primary + 3 nearest enemies within 30 ft of primary).
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Chain Lightning',
  level: 6,
  school: 'evocation',
  rangeFt: 150,                  // PHB p.221: 150 ft
  maxTargets: 4,                 // 1 primary + 3 arcs
  arcRangeFt: 30,                // PHB p.221: arcs within 30 ft of primary
  dieCount: 10,
  dieSides: 8,
  damageType: 'lightning' as const,
  concentration: false,
  castingTime: 'action',
  chainLightningAutoHitV1PerPlan: true,                               // v1: auto-hit (plan reclassified from canon DEX save)
  chainLightningUpcastV1Implemented: false,                            // +2d8/slot-level NOT modelled
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

/**
 * Returns up to 4 targets: the primary (highest-threat enemy within 150 ft)
 * + up to 3 nearest enemies within 30 ft of the primary. Returns null if no
 * primary target exists.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Chain Lightning')) return null;
  if (!hasSpellSlot(caster, 6)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  // Primary: highest-threat enemy within 150 ft of caster.
  let primary: Combatant | null = null;
  let primaryThreat = -1;
  let primaryDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 150) continue;
    if (e.maxHP > primaryThreat || (e.maxHP === primaryThreat && distFt < primaryDist)) {
      primary = e;
      primaryThreat = e.maxHP;
      primaryDist = distFt;
    }
  }
  if (!primary) return null;

  // Arcs: up to 3 nearest enemies within 30 ft of the primary (excluding primary).
  const arcs: Array<{ c: Combatant; dist: number }> = [];
  for (const e of enemies) {
    if (e.id === primary.id) continue;
    const distFt = chebyshev3D(primary.pos, e.pos) * 5;
    if (distFt <= 30) arcs.push({ c: e, dist: distFt });
  }
  arcs.sort((a, b) => a.dist - b.dist);
  const arcTargets = arcs.slice(0, 3).map(a => a.c);

  return [primary, ...arcTargets];
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  consumeSpellSlot(caster, 6);

  const primary = targets[0];
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Chain Lightning at ${primary?.name ?? 'nothing'}! (AUTO-HIT — ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} to ${targets.length} target${targets.length !== 1 ? 's' : ''})`,
  );

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (!target || target.isDead || target.isUnconscious) continue;

    const dmg = rollDamage();
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
    const label = i === 0 ? 'Primary bolt' : `Arc ${i}`;
    emit(
      state, 'damage', caster.id,
      `${label}: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg}, auto-hit)`,
      target.id, dealt,
    );
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous.
}
