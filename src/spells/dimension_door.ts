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
//   - Destination selection: v1 AI picks the battlefield cell based on mode:
//       (a) Closing distance: nearest enemy >60 ft away, HP≥30% → teleport
//           to a cell adjacent to the nearest enemy (engage next round).
//       (b) Escape: nearest enemy ≤5 ft away, HP<30% → teleport to the cell
//           that maximises minimum distance from all living enemies.
//     500 ft >> any v1 battlefield, so the entire grid is valid range.
//   - Occupied-destination collision: NOT modelled — v1 always picks an
//     unoccupied cell.
//   - Cast condition: caster must have an action available.
//
// Spell module pattern (self-only, returns destination):
//   shouldCast(caster, bf) → { destination: Vec3 } | null
//   execute(caster, destination, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield, Vec3 } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { livingEnemiesOf, chebyshev3D, posKey } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Dimension Door', level: 4, school: 'conjuration', teleportRangeFt: 500,
  concentration: false, castingTime: 'action',
  dimensionDoorAllyCarryV1Implemented: false,   // ally carry not modelled
  dimensionDoorCollisionV1Implemented: false,   // occupied-cell 4d6 not modelled
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, description: desc });
}

/** Nearest living enemy (by chebyshev distance), or null if none. */
function nearestEnemy(caster: Combatant, bf: Battlefield): Combatant | null {
  const enemies = livingEnemiesOf(caster, bf);
  if (enemies.length === 0) return null;
  let best = enemies[0];
  let bestDist = chebyshev3D(caster.pos, best.pos);
  for (let i = 1; i < enemies.length; i++) {
    const d = chebyshev3D(caster.pos, enemies[i].pos);
    if (d < bestDist) { bestDist = d; best = enemies[i]; }
  }
  return best;
}

/** True if a cell is unoccupied (excluding the caster themselves). */
function isUnoccupied(pos: Vec3, caster: Combatant, bf: Battlefield): boolean {
  const key = posKey(pos);
  for (const [id, c] of bf.combatants) {
    if (id === caster.id) continue;
    if (c.isDead || c.isUnconscious) continue;
    if (posKey(c.pos) === key) return false;
  }
  return true;
}

/**
 * Closing-distance mode: teleport to an unoccupied cell adjacent to the
 * nearest enemy (within 5 ft / 1 square). This puts the caster in melee
 * range to engage next round.
 *
 * Returns null if no unoccupied adjacent cell exists.
 */
function findClosingCell(caster: Combatant, enemy: Combatant, bf: Battlefield): Vec3 | null {
  const offsets = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 },
  ];
  for (const off of offsets) {
    const candidate = { x: enemy.pos.x + off.x, y: enemy.pos.y + off.y, z: caster.pos.z };
    if (candidate.x < 0 || candidate.y < 0) continue;
    if (candidate.x >= bf.width || candidate.y >= bf.height) continue;
    if (isUnoccupied(candidate, caster, bf)) return candidate;
  }
  return null;
}

/**
 * Escape mode: teleport to the cell that maximises minimum chebyshev
 * distance from all living enemies. Stays at the same elevation.
 */
function findEscapeCell(caster: Combatant, bf: Battlefield): Vec3 {
  const enemies = livingEnemiesOf(caster, bf);
  if (enemies.length === 0) return caster.pos;

  let best = caster.pos;
  let bestMinDist = -Infinity;

  for (let x = 0; x < bf.width; x++) {
    for (let y = 0; y < bf.height; y++) {
      const z = caster.pos.z;
      const candidate = { x, y, z };
      if (!isUnoccupied(candidate, caster, bf)) continue;

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

/**
 * Returns { destination } if the caster should teleport, or null.
 *
 * Two trigger modes (mutually exclusive):
 *   (a) Closing distance: nearest enemy >60 ft (12 squares) away AND
 *       HP ≥ 30% → teleport adjacent to nearest enemy.
 *   (b) Escape: nearest enemy ≤5 ft (1 square) away AND HP < 30% →
 *       teleport to the cell maximising distance from all enemies.
 *
 * If neither mode applies (e.g. enemy 30-60 ft away, or HP < 30% but
 * enemy not adjacent), returns null.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): { destination: Vec3 } | null {
  if (!caster.actions.some(a => a.name === 'Dimension Door')) return null;
  if (!hasSpellSlot(caster, 4)) return null;
  if (caster.budget.actionUsed) return null;

  const enemy = nearestEnemy(caster, bf);
  if (!enemy) return null;

  const distSquares = chebyshev3D(caster.pos, enemy.pos);
  const distFt = distSquares * 5;
  const hpPct = caster.currentHP / caster.maxHP;

  // (a) Closing distance: enemy >60 ft away, HP ≥ 30%
  if (distFt > 60 && hpPct >= 0.3) {
    const dest = findClosingCell(caster, enemy, bf);
    if (dest) return { destination: dest };
    return null;  // no unoccupied adjacent cell
  }

  // (b) Escape: enemy ≤5 ft away, HP < 30%
  if (distFt <= 5 && hpPct < 0.3) {
    return { destination: findEscapeCell(caster, bf) };
  }

  return null;
}

export function execute(caster: Combatant, destination: Vec3, state: EngineState): void {
  consumeSpellSlot(caster, 4);
  caster.budget.actionUsed = true;

  const from = { ...caster.pos };
  caster.pos = { ...destination };

  emit(state, 'action', caster.id,
    `${caster.name} casts Dimension Door! Teleports from (${from.x},${from.y}) → (${destination.x},${destination.y}) [v1: self only, no ally carry, no collision damage]`);
}

export function cleanup(_c: Combatant): void { /* no-op — instantaneous */ }
