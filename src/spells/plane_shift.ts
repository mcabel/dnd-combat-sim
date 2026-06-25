// ============================================================
// Plane Shift — PHB p.266
//
// 7th-level conjuration, action, range 5 ft (melee spell attack),
// NO concentration (instantaneous). Components: V, S, M (a forked,
// two-pronged metal rod worth ≥250 gp, attuned to a particular plane).
//
// Effect: Plane Shift has TWO uses:
//   (1) Travel — you and up to 8 willing creatures link hands and
//       teleport to a different plane of existence (out-of-combat travel).
//   (2) Banish — you make a melee spell attack against a creature. On a
//       hit, the target must succeed on a Charisma saving throw or be
//       banished to a random location on a randomly determined plane
//       of existence. The target is removed from combat (it is on a
//       different plane and must find its own way back).
//
// v1 simplifications:
//   - Combat mode: v1 implements ONLY the banish use (mode 2). The
//     travel use (mode 1) is out-of-combat and NOT modelled.
//     Flagged `planeShiftTravelModeV1Implemented: false`.
//   - Melee spell attack: canon requires a melee spell attack roll
//     BEFORE the CHA save. v1 simplifies to a flat hit (always hits,
//     then save) — mirrors Banishment's pattern (save-only, no attack
//     roll). Flagged `planeShiftMeleeSpellAttackV1Simplified: true`.
//   - Range: 5 ft (touch). Very short — caster must be adjacent to the
//     target. This is the meaningful combat limitation vs Banishment
//     (60 ft range). Flagged in metadata.
//   - Permanent removal: canonically the target is on a random plane
//     and must Plane Shift back (takes an action + a 250gp fork). For
//     combat, this is effectively permanent removal (target isDead =
//     true), mirroring Banishment's non-native-removal pattern. There
//     is NO concentration to break (Plane Shift is instantaneous).
//   - Upcast: N/A (Plane Shift has no upcast effect per PHB).
//   - "Random plane": NOT modelled (all banished targets are treated
//     as permanently removed regardless of creature type).
//
// Spell module pattern (single-target save-or-removal, NO concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous; no concentration)
//
// Combat value: HIGH. A L7 slot for a no-concentration permanent removal
// is very strong. The 5-ft range is the balancing factor (caster must be
// in melee). ~80 creatures know Plane Shift (per coverage report — the
// #2 most-common unbuilt monster spell).
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Plane Shift', level: 7, school: 'conjuration', rangeFt: 5,
  concentration: false, saveAbility: 'cha' as const, castingTime: 'action',
  planeShiftTravelModeV1Implemented: false,      // v1: banish-only (no travel mode)
  planeShiftMeleeSpellAttackV1Simplified: true,  // v1: skip attack roll, save-only
  planeShiftPermanentRemovalV1Implemented: true, // target removed for encounter (no conc)
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

/**
 * Returns the highest-threat living enemy within 5 ft (touch range) that
 * is not already banished by this caster; null otherwise.
 *
 * "Highest-threat": highest maxHP (mirrors Banishment's selection logic).
 * Tiebreak: closest distance.
 *
 * NOT concentration-gated (Plane Shift is instantaneous — no concentration).
 * The engine's action-dispatch handles action economy (mirrors Banishment /
 * Create Undead / Gate — none of which check `budget.actionUsed` here).
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Plane Shift')) return null;
  if (!hasSpellSlot(caster, 7)) return null;
  // NOT concentration-gated — Plane Shift is instantaneous.

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;  // touch range
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Plane Shift')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Plane Shift');
  const saveDC = action?.saveDC ?? 17;
  consumeSpellSlot(caster, 7);
  // NOTE: budget.actionUsed is managed by the engine's action dispatch
  // (mirrors Banishment / Create Undead / Gate — none set it in execute).

  emit(state, 'action', caster.id,
    `${caster.name} casts Plane Shift at ${target.name}! (DC ${saveDC} CHA, NO concentration — permanent removal on fail)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  // v1 simplification: skip the melee spell attack roll (always hits).
  // Canon PHB p.266: "you make a melee spell attack against it. On a hit,
  // the target must make a Charisma saving throw."
  const save = rollSaveReactable(state, caster, target, 'cha', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CHA save vs Plane Shift (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Plane Shift!`, target.id);
    return;
  }

  // Failed save — target banished to a random plane (permanently removed).
  // No concentration to break later; the removal is instant and permanent
  // for the encounter. Mirrors Banishment's non-native-removal pattern.
  target.isDead = true;
  target.currentHP = 0;
  emit(state, 'action', caster.id,
    `${target.name} is BANISHED to a random plane by Plane Shift — permanently removed from combat!`, target.id);
  emit(state, 'death', target.id,
    `${target.name} is shifted to another plane of existence!`, undefined, 0);
}

export function cleanup(_c: Combatant): void { /* no-op — instantaneous; NO concentration */ }
