// ============================================================
// Immolation — XGE p.157
//
// 5th-level evocation, action, range 90 ft. Canon: concentration, until
// extinguished. v1: concentration + DoT simplified to one-shot.
// Components: V.
//
// Effect: Flames wreathe one creature you can see within range. The
//         target must make a Dexterity saving throw. It takes 8d6 fire
//         damage on a failed save, or half as much on a successful one.
//         On a failed save, the target also burns for the duration
//         (canon: 4d6 fire at the end of each of its turns until it or
//         an ally uses an action to extinguish the flames).
//
// Upcast: +1d6 fire per slot level above 5th (not modelled in v1).
//
// v1 simplifications:
//   - Concentration + DoT (XGE p.157: "concentration, until the spell
//     ends" + 4d6/turn until extinguished): v1 simplifies to one-shot
//     (concentration: false). The per-turn DoT is NOT modelled (same gap
//     as Spellfire Storm / Enervation). One-shot 8d6 fire. Documented
//     via `immolationConcentrationV1Simplified: true`.
//   - Upcast: NOT modelled.
//
// Migration note (Session 24): Mirrors Catapult (Session 21) but with
// DEX save, 8d6 fire, L5 slot, 90-ft range.
//
// Spell module pattern (single-target save — mirrors catapult.ts):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (v1 one-shot)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Immolation',
  level: 5,
  school: 'evocation',
  rangeFt: 90,                   // XGE p.157: 90 ft
  dieCount: 8,
  dieSides: 6,
  damageType: 'fire' as const,
  concentration: false,          // v1 simplification: one-shot (canon concentration + DoT)
  saveAbility: 'dex' as const,
  castingTime: 'action',
  immolationConcentrationV1Simplified: true,                           // canon concentration + DoT simplified to one-shot
  immolationUpcastV1Implemented: false,                                 // +1d6/slot-level NOT modelled
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
  if (!caster.actions.some(a => a.name === 'Immolation')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 90) continue;
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
  const action = caster.actions.find(a => a.name === 'Immolation');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 5);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Immolation at ${target.name}! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, half on save)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(state, 'save_success', caster.id, `Immolation: ${target.name} is already down — the flames find no fuel.`, target.id);
    return;
  }

  const save = rollSaveReactable(state, caster, target, 'dex', saveDC);
  const fullDmg = rollDamage();
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Immolation (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
    target.id, save.roll,
  );
  emit(state, 'damage', caster.id, `Immolation: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);
}

export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot.
}
