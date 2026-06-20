// ============================================================
// Negative Energy Flood — XGE p.162
//
// 5th-level necromancy, action, range 60 ft, NO concentration.
// Components: V, S.
//
// Effect: You send a flood of necrotic energy toward a creature within
//         range. The target must make a Constitution saving throw. On a
//         failed save, the target takes 5d12 necrotic damage. On a
//         successful save, the creature takes half as much damage.
//
//         NOTE: XGE p.162 also has an undead-boost rider: if the target
//         is undead and survives, it gains 5d12 HP. v1 does NOT model
//         this (no creature-type tag). See simplifications.
//
// Upcast: +1d12 necrotic per slot level above 5th (not modelled in v1).
//
// v1 simplifications:
//   - Undead-boost rider (XGE p.162: "if the target is undead and
//     survives, it gains 5d12 HP"): NOT modelled — v1 has no creature-
//     type tag. One-shot 5d12 necrotic only. Documented via
//     `negativeEnergyFloodUndeadBoostV1Simplified: true`.
//   - Upcast: NOT modelled.
//   - NOT concentration (XGE p.162: instantaneous).
//
// Migration note (Session 24): Mirrors Catapult (Session 21) but with
// CON save, 5d12 necrotic, L5 slot, 60-ft range.
//
// Spell module pattern (single-target save — mirrors catapult.ts):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Negative Energy Flood',
  level: 5,
  school: 'necromancy',
  rangeFt: 60,                   // XGE p.162: 60 ft
  dieCount: 5,
  dieSides: 12,
  damageType: 'necrotic' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  negativeEnergyFloodUndeadBoostV1Simplified: true,                   // undead-boost rider NOT modelled (no creature-type tag)
  negativeEnergyFloodUpcastV1Implemented: false,                       // +1d12/slot-level NOT modelled
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
  if (!caster.actions.some(a => a.name === 'Negative Energy Flood')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

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
  const action = caster.actions.find(a => a.name === 'Negative Energy Flood');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 5);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Negative Energy Flood at ${target.name}! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, half on save)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(state, 'save_success', caster.id, `Negative Energy Flood: ${target.name} is already down — the flood disperses.`, target.id);
    return;
  }

  const save = rollSave(target, 'con', saveDC);
  const fullDmg = rollDamage();
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Negative Energy Flood (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
    target.id, save.roll,
  );
  emit(state, 'damage', caster.id, `Negative Energy Flood: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);
}

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous.
}
