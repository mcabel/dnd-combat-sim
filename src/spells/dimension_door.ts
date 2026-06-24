// ============================================================
// Dimension Door — PHB p.233
//
// 4th-level conjuration, action, range 500 ft, instantaneous.
// Components: V.
//
// Effect: You teleport yourself to any spot within range. You can also
//         bring one willing creature of your size or smaller within 5 ft.
//         If destination is occupied, you and any ally take 4d6 force damage
//         and the spell fails to teleport you.
//
// v1 simplifications:
//   - Ally carry: NOT modelled (self-teleport only).
//   - Destination selection: v1 AI picks the battlefield cell that maximises
//     minimum distance from all living enemies (escape). 500 ft >> any
//     v1 battlefield, so the entire grid is valid range.
//   - Occupied-destination collision: NOT modelled — v1 always picks an
//     unoccupied cell.
//   - Cast condition: caster must be bloodied (HP ≤ 50%) OR surrounded
//     (≥ 2 adjacent enemies) AND not have already used their action.
//
// Spell module pattern (self-only, mirrors Mage Armor):
//   shouldCast(caster, bf) → boolean
//   execute(caster, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { livingEnemiesOf, chebyshev3D, posKey } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Dimension Door', level: 4, school: 'conjuration', rangeFt: 500,
  concentration: false, castingTime: 'action',
  dimensionDoorAllyCarryV1Implemented: false,   // ally carry not modelled
  dimensionDoorCollisionV1Implemented: false,   // occupied-cell 4d6 not modelled
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, description: desc });
}

function adjacentEnemyCount(caster: Combatant, bf: Battlefield): number {
  const enemies = livingEnemiesOf(caster, bf);
  return enemies.filter(e => chebyshev3D(caster.pos, e.pos) <= 1).length;
}

/** Return best escape cell: maximises minimum distance from all living enemies. */
function findEscapeCell(caster: Combatant, bf: Battlefield): { x: number; y: number; z: number } {
  const enemies = livingEnemiesOf(caster, bf);
  if (enemies.length === 0) return caster.pos;

  let best = caster.pos;
  let bestMinDist = -Infinity;

  for (let x = 0; x < bf.width; x++) {
    for (let y = 0; y < bf.height; y++) {
      const z = caster.pos.z; // stay same elevation in v1
      const candidate = { x, y, z };

      // Must be unoccupied (excluding caster itself)
      const key = posKey(candidate);
      let occupied = false;
      for (const [id, c] of bf.combatants) {
        if (id !== caster.id && !c.isDead && !c.isUnconscious && posKey(c.pos) === key) {
          occupied = true;
          break;
        }
      }
      if (occupied) continue;

      const minDist = enemies.reduce(
        (min, e) => Math.min(min, chebyshev3D(candidate, e.pos)),
        Infinity
      );

      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        best = candidate;
      }
    }
  }
  return best;
}

export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Dimension Door')) return false;
  if (!hasSpellSlot(caster, 4)) return false;
  if (caster.budget.actionUsed) return false;

  const bloodied = caster.currentHP <= Math.floor(caster.maxHP / 2);
  const surrounded = adjacentEnemyCount(caster, bf) >= 2;

  // Only use as tactical retreat when threatened
  return bloodied || surrounded;
}

export function execute(caster: Combatant, state: EngineState): void {
  consumeSpellSlot(caster, 4);
  caster.budget.actionUsed = true;

  const dest = findEscapeCell(caster, state.battlefield);
  const from = { ...caster.pos };
  caster.pos = dest;

  emit(state, 'action', caster.id,
    `${caster.name} casts Dimension Door! Teleports from (${from.x},${from.y}) → (${dest.x},${dest.y}) [v1: self only, escape]`);
}

export function cleanup(_c: Combatant): void { /* no-op — instantaneous */ }
