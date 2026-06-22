// ============================================================
// Mental Prison — XGE p.161
// 6th-level illusion, action, range 60 ft. Canon: concentration, up to
// 1 minute. v1: concentration + movement-trigger simplified to one-shot.
// Components: S.
//
// Effect: You make a grasping motion toward a creature within range. The
//         target must make an Intelligence saving throw. On a failed save,
//         the target takes 5d10 psychic damage and is restrained by the
//         illusion. The target can use its action to make an Intelligence
//         check against your spell save DC. If it succeeds, the spell ends.
//         On a successful save, the target takes half as much damage and
//         the spell has no other effect.
//
//         Canon rider: if the target moves (willingly or unwillingly) before
//         the spell ends, it takes 3d10 psychic damage and the spell ends.
//
// v1 simplifications:
//   - Concentration + movement-trigger (XGE p.161): v1 simplifies to one-shot
//     (concentration: false). The per-turn Int-check escape + movement-trigger
//     3d10 are NOT modelled. One-shot 5d10 psychic on failed save, half on
//     success. Documented via `mentalPrisonConcentrationV1Simplified: true`.
//   - Upcast: +1d10/slot-level above 6th NOT modelled.
//
// Migration note (Session 24): Mirrors Catapult (Session 21) but INT save,
// 5d10 psychic, L6 slot, 60-ft range.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Mental Prison',
  level: 6,
  school: 'illusion',
  rangeFt: 60,                   // XGE p.161: 60 ft
  dieCount: 5,
  dieSides: 10,
  damageType: 'psychic' as const,
  concentration: false,          // v1 simplification: one-shot (canon concentration + movement-trigger)
  saveAbility: 'int' as const,
  castingTime: 'action',
  mentalPrisonConcentrationV1Simplified: true,                         // canon concentration + movement-trigger simplified to one-shot
  mentalPrisonUpcastV1Implemented: false,                               // +1d10/slot-level NOT modelled
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Mental Prison')) return null;
  if (!hasSpellSlot(caster, 6)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    candidates.push({ c: e, threat: e.maxHP, curHP: e.currentHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    if (a.curHP !== b.curHP) return a.curHP - b.curHP;
    return a.dist - b.dist;
  });
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Mental Prison');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 6);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Mental Prison at ${target.name}! (DC ${saveDC} INT, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, half on save)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(state, 'save_success', caster.id, `Mental Prison: ${target.name} is already down — the illusion finds no mind.`, target.id);
    return;
  }

  const save = rollSaveReactable(state, caster, target, 'int', saveDC);
  const fullDmg = rollDamage();
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} INT save vs Mental Prison (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
    target.id, save.roll,
  );
  emit(state, 'damage', caster.id, `Mental Prison: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);
}

export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot.
}
