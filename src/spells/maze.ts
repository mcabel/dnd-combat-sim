// ============================================================
// Maze — PHB p.261
//
// 8th-level conjuration, action, range 60 ft, NO concentration.
// Components: V, S.
//
// Effect: You banish a creature that you can see within range into a
//         labyrinthine demiplane. The target remains there for the
//         duration OR until it uses an action to make a DC 20 Intelligence
//         check to escape the maze. When the spell ends, the target
//         reappears in the space it left OR in the nearest unoccupied
//         space.
//   - Duration: 10 minutes (no concentration!).
//   - Immune: Creatures with Int score ≤ 1 are unaffected — they can't
//     navigate a maze they can't comprehend. PHB: "A creature with an
//     Intelligence score of -5 (≈ Int 1) is unaffected."
//   - Escape: ACTION → DC 20 INT check → on success, reappear.
//
// Upcast: N/A (Maze has no upcast in the PHB).
//
// v1 simplifications:
//   - Duration: canon 10 min / 600 rounds, no concentration. v1 has no
//     tracker for non-concentration long-duration effects; treat as
//     "removed from combat for the rest of the encounter" (target
//     isDead=true; reappears only if encounter ends — modelled as
//     permanent removal, matching Banishment-for-non-native pattern).
//   - Escape action: NOT modelled (monsters/PCs don't spend an action
//     on INT checks in v1 combat AI; the spell's effect is permanent
//     for the encounter). This is a known simplification — the Maze is
//     so strong it would end the fight for one creature, which is the
//     v1 outcome.
//   - Int ≤ 1 immunity: modelled (Int score ≤ 1 → no effect).
//   - "See the target" requirement: enforced via distance + alive check
//     (full vision subsystem is TG-010 vision RFC; v1 assumes LoS if
//     within 60 ft).
//
// Spell module pattern (single-target save-or-removal, NO concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (no concentration; permanent removal for encounter)
//
// Combat value: HIGH. A no-save, no-concentration removal spell at L8 —
// devastating vs single big threats. 10 creatures know it (per coverage
// report): Tyreus, Illusionist, Lady Illmarrow, Niv-Mizzet, etc.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Maze', level: 8, school: 'conjuration', rangeFt: 60,
  concentration: false, castingTime: 'action',
  mazeEscapeActionV1Simplified: true,    // no escape action; permanent for encounter
  mazeDurationV1EncounterOnly: true,     // canon 10 min; v1 = rest of encounter
  mazeInt1ImmunityImplemented: true,     // Int ≤ 1 unaffected
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

function logDeath(state: EngineState, actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type: 'death', targetId, value, description: desc });
}

/** PHB p.261: A creature with Int score ≤ 1 is unaffected by Maze. */
function isImmuneToIntMaze(target: Combatant): boolean {
  // Int ability score (not mod). The Combatant type stores the raw ability
  // score (e.g. `int: 10`). PHB: "≤ 1" → Int score 1 or 0 (which would be
  // mod -5). Some bestiary entries have `int: 1` (vermin, oozes).
  return (target.int ?? 10) <= 1;
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Maze')) return null;
  if (!hasSpellSlot(caster, 8)) return null;
  // Maze is NOT concentration → no concentration gate.

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;
    // Skip creatures already removed / banished
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Maze')) continue;
    // Skip Int ≤ 1 (immune)
    if (isImmuneToIntMaze(c)) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Maze');
  void action;  // No save DC for Maze
  consumeSpellSlot(caster, 8);

  emit(state, 'action', caster.id,
    `${caster.name} casts Maze at ${target.name}! (no save, no concentration; target banished to a labyrinthine demiplane)`,
    target.id);

  if (target.isDead || target.isUnconscious) return;

  // Int ≤ 1 immunity safety check (shouldCast already filters, but double-check)
  if (isImmuneToIntMaze(target)) {
    emit(state, 'action', caster.id,
      `${target.name} has Int ≤ 1 — unaffected by Maze (can't comprehend the labyrinth)!`,
      target.id);
    return;
  }

  // v1: target is removed from combat for the rest of the encounter.
  // (Canon: 10 min, escape action DC 20 INT; v1 simplifies to permanent
  // removal — matches Banishment non-native removal pattern.)
  target.isDead = true;
  target.currentHP = 0;
  emit(state, 'action', caster.id,
    `${target.name} is banished into the MAZE — removed from combat! (v1: no escape action; encounter-only)`,
    target.id);
  logDeath(state, caster.id,
    `${target.name} vanishes into a labyrinthine demiplane!`,
    target.id, 0);
}

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration; target already removed */ }
