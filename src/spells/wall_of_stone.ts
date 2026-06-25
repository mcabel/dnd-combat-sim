// ============================================================
// Wall of Stone — PHB p.287
//
// 5th-level evocation, action, range 120 ft, concentration (10 min).
// Components: V, S, M (a small block of granite).
//
// Effect: A nonmagical wall of solid stone springs into existence on a
//         solid surface within range. The wall is an object made of
//         stone that can be damaged (AC 15, HP 30 per 10×10 panel).
//   - Shape: up to ten 10×10 panels, OR a hemispherical dome.
//   - The wall merges with surrounding stone (no gap, can't be flanked
//     around at the merge point).
//   - Creatures in the wall's area are pushed to one side (caster's
//     choice); if a creature can't be pushed (no free space), it must
//     make a DEX save → 10d6 bludgeoning (half on success).
//   - The wall provides total cover (blocks LoS + attacks).
//   - If the caster moves > 120 ft from the wall, it ends (concentration).
//   - Upcast: +1 panel per slot level above 5th.
//
// v1 simplifications:
//   - Wall geometry: NOT modelled (no wall/zone subsystem). v1 targets a
//     single enemy and treats the spell as a "pin" — DEX save vs 10d6
//     bludgeoning (half on success). No push (no positional modelling).
//   - Cover / LoS blocking: NOT modelled (requires TG-007 wall subsystem).
//   - Damageable object: NOT modelled (wall HP, panel break, AC 15).
//   - Concentration-tracked (reverts when concentration breaks — though
//     v1's effect is instantaneous damage, no condition to remove).
//   - Upcast: NOT modelled.
//
// Spell module pattern (single-target save damage, concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous damage; removeEffectsFromCaster
//              still drops the concentration spell slot for safety)
//
// Combat value: MEDIUM. v1 strips it to a single-target damage spell
// (loses the cover/LoS value). Real value comes from Phase 2 when the
// wall subsystem lands. 8 creatures know it (Hill Giant Avalancher,
// Stalker of Baphomet, Pech, etc.).
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Wall of Stone', level: 5, school: 'evocation', rangeFt: 120,
  concentration: true, saveAbility: 'dex' as const, castingTime: 'action',
  wallOfStoneGeometryV1Implemented: false,     // wall shape not modelled
  wallOfStoneCoverV1Implemented: false,        // cover / LoS not modelled
  wallOfStoneDamageableObjectV1Implemented: false,  // wall HP not modelled
  wallOfStoneUpcastV1Implemented: false,       // upcast not modelled
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

function rollBludgeoningDamage(dieCount: number): number {
  let total = 0;
  for (let i = 0; i < dieCount; i++) total += rollDie(6);
  return total;
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Wall of Stone')) return null;
  if (!hasSpellSlot(caster, 5)) return null;
  if (caster.concentration?.active) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 120) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Wall of Stone');
  const saveDC = action?.saveDC ?? 15;
  consumeSpellSlot(caster, 5);

  // Drop stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Wall of Stone');

  emit(state, 'action', caster.id,
    `${caster.name} casts Wall of Stone, slamming a stone panel at ${target.name}! (DC ${saveDC} DEX, 10d6 bludgeoning)`, target.id);

  if (target.isDead || target.isUnconscious) return;

  // DEX save, 10d6 bludgeoning (half on success)
  const save = rollSaveReactable(state, caster, target, 'dex', saveDC);
  const rawDmg = rollBludgeoningDamage(10);
  const finalDmg = save.success ? Math.floor(rawDmg / 2) : rawDmg;

  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Wall of Stone — takes ${finalDmg} bludgeoning (rolled ${rawDmg}${save.success ? ', halved' : ''})`,
    target.id, save.roll);

  const dealt = applyDamageWithTempHP(target, finalDmg, 'bludgeoning');
  emit(state, 'damage', caster.id,
    `Wall of Stone deals ${dealt} bludgeoning to ${target.name}`, target.id, dealt);
}

export function cleanup(_c: Combatant): void { /* no-op — damage is instantaneous; conc slot already consumed */ }
