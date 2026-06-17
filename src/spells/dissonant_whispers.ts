// ============================================================
// Dissonant Whispers — PHB p.234
//
// 1st-level enchantment, NOT concentration
// Casting time: action
// Range: 60 ft (single target)
// Components: V (verbal only)
//
// Effect:
//   Target makes a WIS saving throw.
//   Fail  → 3d6 psychic damage + must use reaction (if available)
//           to immediately move away at full speed.
//   Success → half damage, no forced movement.
//   Deafened → auto-succeeds (PHB p.234).
//
// Forced movement detail (PHB):
//   "must immediately use its reaction, if available, to move as far
//   as its speed allows away from you. The creature doesn't move into
//   obviously dangerous ground, such as a fire or a pit."
//   → reactionUsed = true on failed save; target pushed speed/5 cells.
//     Obstacle / hazard avoidance: deferred (not modelled — no hazard map).
//
// PHB note: "A deafened creature automatically succeeds on the save."
//   → We check the 'deafened' condition string when present.
//
// AI target selection: nearest enemy within 60 ft.
//   Single-target only (areaTags: ST in spell DB).
//
// Simplifications:
//   - Forced move direction: directly away from caster (same vector as
//     Thunderwave's pushAway, but distance = speed / 5 cells).
//   - "Obviously dangerous ground" avoidance not modelled.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamage } from '../engine/utils';
import { euclideanDistFt, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Constants ----------------------------------------------

export const RANGE_FT = 60;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Dissonant Whispers',
  level: 1,
  school: 'enchantment',
  rangeFt: RANGE_FT,
  concentration: false,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  damageDice: '3d6',
  damageType: 'psychic',
} as const;

// ---- Local log helper ---------------------------------------

function emit(
  state: EngineState,
  type: CombatEvent['type'],
  actorId: string,
  desc: string,
  targetId?: string,
  value?: number,
): void {
  state.log.events.push({
    round: state.battlefield.round,
    actorId,
    type,
    targetId,
    value,
    description: desc,
  });
}

// ---- Forced movement helper ---------------------------------

/**
 * Move `target` directly away from `caster` by `cells` grid cells.
 * Mirrors Thunderwave's pushAway logic but accepts a variable distance.
 * Mutates target.pos in-place.
 */
function moveAway(caster: Combatant, target: Combatant, cells: number): void {
  const dx = target.pos.x - caster.pos.x;
  const dy = target.pos.y - caster.pos.y;
  const dz = target.pos.z - caster.pos.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (len === 0) {
    // Same cell — flee +x by default
    target.pos = { ...target.pos, x: target.pos.x + cells };
    return;
  }

  target.pos = {
    x: target.pos.x + Math.round((dx / len) * cells),
    y: target.pos.y + Math.round((dy / len) * cells),
    z: target.pos.z + Math.round((dz / len) * cells),
  };
}

// ---- shouldCast ---------------------------------------------

/**
 * Returns the best target for Dissonant Whispers (nearest living enemy
 * within 60 ft), or null if casting conditions are not met.
 *
 * Conditions:
 *  - Caster has 'Dissonant Whispers' in their action list.
 *  - Caster has a 1st-level spell slot.
 *  - ≥1 living, non-unconscious enemy is within 60 ft.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Dissonant Whispers')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  let best: Combatant | null = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    const dist = euclideanDistFt(caster.pos, e.pos);
    if (dist <= RANGE_FT && dist < bestDist) {
      best = e;
      bestDist = dist;
    }
  }

  return best;
}

// ---- execute ------------------------------------------------

/**
 * Execute Dissonant Whispers against `target`:
 *  1. Consume a 1st-level spell slot.
 *  2. Check deafened → auto-success if deafened.
 *  3. WIS save vs saveDC.
 *     Fail  → 3d6 psychic + forced flee (reactionUsed, move away speed/5 cells).
 *     Success → half damage, no movement.
 *  5. Log every event.
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Dissonant Whispers');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Dissonant Whispers on ${target.name} (DC ${saveDC} WIS)`,
    target.id,
  );

  // PHB p.234: deafened creature auto-succeeds
  const isDeafened = target.conditions.has('deafened');
  if (isDeafened) {
    // Roll damage for the half-on-success calculation, but target is auto-success
    const dmgRoll = rollDie(6) + rollDie(6) + rollDie(6);
    const dmgFinal = Math.floor(dmgRoll / 2);
    emit(
      state, 'save_success', caster.id,
      `${target.name} is deafened — auto-succeeds on WIS save vs Dissonant Whispers, takes ${dmgFinal} psychic damage (half of ${dmgRoll})`,
      target.id, dmgFinal,
    );
    applyDamage(target, dmgFinal);
    emit(state, 'damage', caster.id,
      `Dissonant Whispers: ${target.name} takes ${dmgFinal} psychic damage`,
      target.id, dmgFinal);
    return;
  }

  const save = rollSave(target, 'wis', saveDC);

  const dmgRoll = rollDie(6) + rollDie(6) + rollDie(6);
  const dmgFinal = save.success ? Math.floor(dmgRoll / 2) : dmgRoll;

  if (save.success) {
    emit(
      state, 'save_success', caster.id,
      `${target.name} succeeds WIS save (rolled ${save.roll} vs DC ${saveDC}) — takes ${dmgFinal} psychic damage (half of ${dmgRoll}), no forced movement`,
      target.id, dmgFinal,
    );
  } else {
    emit(
      state, 'save_fail', caster.id,
      `${target.name} fails WIS save (rolled ${save.roll} vs DC ${saveDC}) — takes ${dmgFinal} psychic damage and must flee!`,
      target.id, dmgFinal,
    );
  }

  applyDamage(target, dmgFinal);
  emit(state, 'damage', caster.id,
    `Dissonant Whispers: ${target.name} takes ${dmgFinal} psychic damage`,
    target.id, dmgFinal);

  // Forced movement on failed save (reaction consumed, then flee)
  if (!save.success) {
    const hadReaction = !target.budget.reactionUsed;

    if (hadReaction) {
      target.budget.reactionUsed = true;
      emit(
        state, 'action', caster.id,
        `${target.name} uses its reaction to flee from Dissonant Whispers`,
        target.id,
      );
    }

    // Move away at full speed (speed / 5 = cells)
    const speedCells = Math.floor((target.speed ?? 30) / 5);
    if (speedCells > 0 && !target.isDead && !target.isUnconscious) {
      const oldPos = { ...target.pos };
      moveAway(caster, target, speedCells);
      emit(
        state, 'action', caster.id,
        `${target.name} flees ${speedCells * 5} ft away (${oldPos.x},${oldPos.y}) → (${target.pos.x},${target.pos.y})`,
        target.id,
      );
    }
  }
}
