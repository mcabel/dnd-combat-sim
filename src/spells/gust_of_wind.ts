// ============================================================
// Gust of Wind — PHB p.248
//
// 2nd-level evocation, action, range Self (line 60 ft), concentration (1 min).
// Components: V, S, M (a legume seed).
//
// Effect: A line of strong wind 60 feet long and 10 feet wide blasts from
//         you in a direction you choose for the spell's duration. Each
//         creature that starts its turn in the line must succeed on a
//         Strength saving throw or be pushed 15 feet away from you in a
//         direction following the line.
//
//         Any creature in the line must spend 2 feet of movement for every
//         1 foot it moves when moving closer to you.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - AoE shape: canon 60-ft line, 10 ft wide. v1 simplification: targets
//     a SINGLE enemy within 60 ft (the line's primary target). The push
//     effect is applied to that enemy only. Forward-compat TODO via the
//     metadata flag `gustOfWindLineAoeV1Implemented: false`.
//   - "Starts its turn in the line": v1 does NOT model the persistent
//     push-at-start-of-turn effect (the push is applied once, on cast).
//     Forward-compat TODO via the metadata flag
//     `gustOfWindStartOfTurnPushV1Implemented: false`.
//   - Difficult-terrain-when-moving-toward-caster: v1 does NOT model this
//     (no per-direction difficult-terrain subsystem). Forward-compat TODO
//     via the metadata flag `gustOfWindDifficultTerrainV1Implemented: false`.
//   - Direction: v1 always pushes the target directly AWAY from the caster
//     (the most tactically relevant direction).
//   - Duration: canon 1 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002). Since v1 applies the push only on cast,
//     the concentration has no ongoing effect (it's effectively a one-shot
//     push spell in v1). Concentration is still started for consistency
//     with canon and future-work expansion.
//   - No damage (PHB p.248: Gust of Wind deals no damage — it only pushes).
//
// Spell module pattern:
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (v1: no persistent effect; concentration is cosmetic)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Gust of Wind',
  level: 2,
  school: 'evocation',
  rangeFt: 60,
  pushFt: 15,
  concentration: true,
  saveAbility: 'str' as const,
  castingTime: 'action',
  gustOfWindLineAoeV1Implemented: false,                     // single-target only (canon: line)
  gustOfWindStartOfTurnPushV1Implemented: false,             // persistent push NOT modelled
  gustOfWindDifficultTerrainV1Implemented: false,            // difficult-terrain rider NOT modelled
  gustOfWindConcentrationEnforcementV1Implemented: true,    // TG-002 DONE (Session 34)
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

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Gust of Wind (a living enemy within 60
 * ft, positioned such that pushing them 15 ft is tactically useful — i.e.
 * they are NOT already at the battlefield edge in the push direction), or
 * null when the spell should not be cast.
 *
 * Target priority: closest enemy within 60 ft (the push is most useful
 * against an approaching melee enemy — pushing them back 15 ft delays
 * their engagement).
 *
 * Preconditions:
 *   - Caster has 'Gust of Wind' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Gust of Wind IS concentration — it cannot be cast while concentrating
 * on another spell. The planner gates on concentration via shouldCast.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Gust of Wind')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    candidates.push({ c, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: closest first (the push delays the closest melee enemy most).
  candidates.sort((a, b) => a.dist - b.dist);

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Gust of Wind:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Gust of Wind (cosmetic in v1 — no persistent
 *     effect; the push is one-shot on cast).
 *  4. Roll the target's STR save vs the caster's saveDC.
 *  5. On fail: push the target 15 ft directly away from the caster (set pos).
 *     Clamp to battlefield bounds [0, 29].
 *  6. On success: no push.
 *
 * v1 simplifications: single-target only (canon: line); one-shot push (canon:
 * persistent start-of-turn push); difficult-terrain rider NOT modelled;
 * concentration NOT enforced (TG-002).
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Gust of Wind');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Gust of Wind');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Gust of Wind at ${target.name}! (DC ${saveDC} STR or pushed ${metadata.pushFt} ft)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  const save = rollSaveReactable(state, caster, target, 'str', saveDC);
  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} STR save vs Gust of Wind (rolled ${save.total})`,
    target.id, save.roll,
  );

  if (save.success) {
    emit(
      state, 'action', caster.id,
      `${target.name} resists the gust — not pushed!`,
      target.id,
    );
    return;
  }

  // Push the target 15 ft (3 grid squares) directly away from the caster.
  const dx = target.pos.x - caster.pos.x;
  const dy = target.pos.y - caster.pos.y;
  const stepX = dx === 0 ? 0 : Math.sign(dx);
  const stepY = dy === 0 ? 0 : Math.sign(dy);

  const pushSquares = Math.floor(metadata.pushFt / 5);  // 3 squares
  const oldPos = { ...target.pos };
  target.pos = {
    x: Math.max(0, Math.min(29, target.pos.x + stepX * pushSquares)),
    y: Math.max(0, Math.min(29, target.pos.y + stepY * pushSquares)),
    z: target.pos.z,
  };

  emit(
    state, 'action', caster.id,
    `${target.name} is blown ${metadata.pushFt} ft away by the gust! (from (${oldPos.x},${oldPos.y}) to (${target.pos.x},${target.pos.y}))`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — v1: no persistent effect; concentration is cosmetic.
}
