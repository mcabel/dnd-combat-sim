// ============================================================
// Teleport — PHB p.281
//
// 7th-level conjuration, action, range 10 ft (self + willing creatures
// within 10 ft), NO concentration (instantaneous). Components: V.
//
// Effect: You and up to 8 willing creatures of your choice that you can
//         see within range teleport to a destination you select. The
//         destination is any location on the same plane of existence
//         that you are familiar with (a "permanent circle" gives
//         "very familiar"; otherwise roll on the Teleport table for
//         off-target / similar area / mishap outcomes).
//
// v1 simplifications:
//   - Self-only: v1 mirrors Dimension Door's self-only teleport. The
//     "8 willing creatures" ally-carry rider is NOT modelled.
//     Flagged `teleportAllyCarryV1Implemented: false`.
//   - Destination selection: v1 AI picks the battlefield cell that
//     maximises minimum distance from all living enemies (escape),
//     exactly mirroring Dimension Door's `findEscapeCell`. The "same
//     plane" unlimited range means the entire v1 grid is valid.
//   - Teleport table (off-target / similar area / mishap): NOT modelled.
//     v1 always lands on the chosen cell (no mishap risk).
//     Flagged `teleportMishapTableV1Implemented: false`.
//   - "Familiar with destination": NOT enforced (v1 assumes the caster
//     knows the battlefield well enough).
//   - Cast condition: caster must be bloodied (HP ≤ 50%) OR surrounded
//     (≥ 2 adjacent enemies). Mirrors Dimension Door's retreat logic.
//   - Distinction from Dimension Door (L4): Teleport is a HIGHER slot
//     (L7 vs L4) with the same v1 effect. Monsters that know Teleport
//     but NOT Dimension Door will use this. The ally-carry rider is the
//     canonical differentiator (deferred in v1).
//
// Spell module pattern (self-only teleport, mirrors Dimension Door):
//   shouldCast(caster, bf) → boolean
//   execute(caster, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { livingEnemiesOf, chebyshev3D, posKey } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Teleport', level: 7, school: 'conjuration', rangeFt: 10,
  concentration: false, castingTime: 'action',
  teleportAllyCarryV1Implemented: false,    // v1: self-only (no 8-willing-creatures rider)
  teleportMishapTableV1Implemented: false,  // v1: always on-target (no d100 table)
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
  if (!caster.actions.some(a => a.name === 'Teleport')) return false;
  if (!hasSpellSlot(caster, 7)) return false;
  if (caster.budget.actionUsed) return false;

  const bloodied = caster.currentHP <= Math.floor(caster.maxHP / 2);
  const surrounded = adjacentEnemyCount(caster, bf) >= 2;

  // Only use as tactical retreat when threatened — mirrors Dimension Door.
  return bloodied || surrounded;
}

export function execute(caster: Combatant, state: EngineState): void {
  consumeSpellSlot(caster, 7);
  caster.budget.actionUsed = true;

  const dest = findEscapeCell(caster, state.battlefield);
  const from = { ...caster.pos };
  caster.pos = dest;

  emit(state, 'action', caster.id,
    `${caster.name} casts Teleport! Teleports from (${from.x},${from.y}) → (${dest.x},${dest.y}) [v1: self only, escape, no mishap table]`);
}

export function cleanup(_c: Combatant): void { /* no-op — instantaneous */ }
