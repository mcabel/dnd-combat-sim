// ============================================================
// Psychic Scream — XGE p.163
// 9th-level enchantment, action, range 90 ft, NO concentration.
// Components: S.
//
// Effect: You unleash the power of your mind to blast the intellect of up
//         to ten creatures of your choice that you can see within range.
//         Each target must make an Intelligence saving throw. On a failed
//         save, a target takes 14d6 psychic damage and is stunned. On a
//         successful save, a creature takes half as much damage and isn't
//         stunned. A stunned target can make an Intelligence saving throw
//         at the end of each of its turns. On a successful save, the
//         stunning effect ends.
//
//         Canon rider: if a target's brain "explodes" (rolled 1 on the
//         die), it dies — NOT modelled in v1.
//
// v1 simplifications:
//   - 10-target cap (XGE p.163: "up to ten creatures"): v1 picks the 10
//     highest-threat enemies within 90 ft. If fewer than 10 exist, returns
//     all of them. Documented via `psychicScream10TargetCapV1: true`.
//   - Stunned on failed save (XGE p.163): v1 applies stunned via
//     condition_apply (mirror Sunburst's blinded). The end-of-turn INT
//     save to end the stun is NOT modelled (same gap as Sunburst).
//     Documented via `psychicScreamStunnedDurationV1Simplified: true`.
//   - "Head explodes on nat 1" rider: NOT modelled (v1 has no nat-1-
//     on-save instakill subsystem). Documented via
//     `psychicScreamHeadExplodeV1Simplified: true`.
//   - Upcast: none (9th-level only).
//   - NOT concentration (XGE p.163: instantaneous — the stun rider is a
//     non-concentration persistent effect).
//
// Migration note (Session 24): Mirrors Sunburst (Session 23) but with a
// 10-TARGET cap (vs unlimited AoE), INT save (vs CON), 14d6 psychic (vs
// 12d6 radiant), stunned (vs blinded), 90-ft range (vs 150-ft), no AoE
// radius (point-targeted, up to 10 creatures).
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect } from '../engine/spell_effects';

export const metadata = {
  name: 'Psychic Scream',
  level: 9,
  school: 'enchantment',
  rangeFt: 90,                   // XGE p.163: 90 ft
  maxTargets: 10,                // XGE p.163: up to 10 creatures
  dieCount: 14,
  dieSides: 6,
  damageType: 'psychic' as const,
  concentration: false,
  saveAbility: 'int' as const,
  castingTime: 'action',
  psychicScream10TargetCapV1: true,                                   // v1: 10-target cap
  psychicScreamStunnedDurationV1Simplified: true,                     // end-of-turn INT save NOT modelled
  psychicScreamHeadExplodeV1Simplified: true,                         // nat-1 instakill NOT modelled
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
 * Returns up to 10 highest-threat enemies within 90 ft (point-targeted,
 * NOT an AoE — the caster picks the targets). Returns null if no enemies
 * in range.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Psychic Scream')) return null;
  if (!hasSpellSlot(caster, 9)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 90) continue;
    candidates.push({ c: e, threat: e.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;

  // Sort: highest threat first, then closest. Take up to 10.
  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  return candidates.slice(0, metadata.maxTargets).map(x => x.c);
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Psychic Scream');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 9);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Psychic Scream! (DC ${saveDC} INT, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, up to ${metadata.maxTargets} targets + stunned on fail) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} targeted!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSave(target, 'int', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} INT save vs Psychic Scream (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + STUNNED'}`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Psychic Scream: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);

    if (!save.success && !target.conditions.has('stunned')) {
      applySpellEffect(target, {
        casterId: caster.id,
        spellName: 'Psychic Scream',
        effectType: 'condition_apply',
        payload: { condition: 'stunned' },
        sourceIsConcentration: false,
      });
      emit(state, 'condition_add', caster.id, `${target.name} is STUNNED by the psychic scream! (can't take actions; attacks vs them have advantage)`, target.id);
    }
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; stunned persists for v1 combat.
}
