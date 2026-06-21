// ============================================================
// Silence — PHB p.275
//
// 2nd-level illusion, action, range 120 ft, concentration (10 min).
// Components: V, S.
//
// Effect: For the duration, no sound can be created within or pass
//         through a 20-foot-radius sphere centered on a point you choose
//         within range. Any creature or object entirely inside the sphere
//         is immune to thunder damage, and a creature entirely inside the
//         sphere has disadvantage on Perception checks that rely on hearing.
//
//         Casting a spell that includes a verbal component is impossible
//         there.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - v1 has NO spell-block subsystem (the engine has no concept of
//     "verbal component" or "blocked spell casting"). This spell sets a
//     forward-compat flag `_silenceZoneActive` on the TARGET — set for
//     future use, never read in v1. Like Darkvision's `_darkvisionActive`
//     pattern, but with a sentinel effect for cleanup because Silence IS
//     concentration.
//   - v1 simplification: canon Silence is a 20-ft-radius sphere centered
//     on a POINT (not a creature). v1 anchors the zone to a single enemy
//     target (the highest-threat enemy within 120 ft). The AoE / multi-
//     target geometry is NOT modelled. Forward-compat TODO via the metadata
//     flag `silenceAoEMultiTargetV1Implemented: false`.
//   - Thunder-damage immunity: v1 does NOT model the "immune to thunder
//     damage" rider (no AoE-thunder damage intersection subsystem in v1's
//     damage pipeline).
//   - Perception-hearing disadvantage: v1 has no perception subsystem —
//     covered by the forward-compat flag.
//   - Verbal spell block: v1 has no spell-block subsystem — covered by the
//     forward-compat flag `silenceVerbalSpellBlockV1Implemented: false`.
//   - Duration: canon 10 min concentration → v1: concentration is started
//     via startConcentration(), but NOT enforced (TG-002). The flag
//     persists until removeEffectsFromCaster() is called.
//   - Upcast: — (no At Higher Levels entry). v1 always targets a single
//     creature. Forward-compat TODO via `silenceUpcastV1Implemented: false`.
//
// Spell module pattern (mirrors darkvision.ts forward-compat flag pattern
// BUT with concentration + sentinel effect for cleanup):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   metadata → spell stats
//   cleanup() — no-op (concentration break handled by sentinel effect)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Silence',
  level: 2,
  school: 'illusion',
  rangeFt: 120,
  aoeRadiusFt: 20,
  concentration: true,
  castingTime: 'action',
  silenceVerbalSpellBlockV1Implemented: false,            // verbal spell block NOT modelled
  silenceAoEMultiTargetV1Implemented: false,              // single-target simplification
  silenceUpcastV1Implemented: false,                      // no At Higher Levels entry — single target
  silenceConcentrationEnforcementV1Implemented: true,    // TG-002 DONE (Session 34)
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
 * Returns the single best target for Silence (a living enemy within 120 ft —
 * the silence zone is anchored to that enemy in v1's single-target
 * simplification, not already Silence'd by this caster), or null when the
 * spell should not be cast.
 *
 * Target priority: highest-threat enemy (maxHP) within 120 ft — silencing
 * the biggest spellcaster removes their verbal spells (forward-compat —
 * v1 doesn't model spell-blocking yet, but the flag is set for future use).
 *
 * Preconditions:
 *   - Caster has 'Silence' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 120 ft
 *
 * Note: Silence IS concentration — it cannot be cast while concentrating on
 * another spell. The planner gates on concentration via shouldCast.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Silence')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 120) continue;

    // Skip if already Silence'd by this caster (re-cast would only refresh
    // the duration — wasteful in v1 since the duration isn't tracked).
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Silence'
    )) continue;

    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Silence:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Silence.
 *  4. Set `target._silenceZoneActive = true` (forward-compat flag).
 *  5. Attach a `damage_zone` sentinel effect (dieCount=0, dieSides=0) to
 *     the TARGET so removeEffectsFromCaster clears the flag on concentration
 *     break. The sentinel has `sourceIsConcentration: true`.
 *
 * v1 simplifications: AoE / multi-target NOT modelled (single target); verbal
 * spell block NOT modelled (forward-compat flag only); thunder immunity NOT
 * modelled; perception-hearing disadvantage NOT modelled; concentration NOT
 * enforced (TG-002). The flag persists for the entire combat (or until
 * concentration breaks).
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Silence');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Silence centered on ${target.name}! (20-ft-radius zone — v1: anchored to target, single-target simplification)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  target._silenceZoneActive = true;

  // Attach a damage_zone sentinel (dieCount=0) so removeEffectsFromCaster
  // clears the `_silenceZoneActive` flag on concentration break.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Silence',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is enveloped in SILENCE! (v1: forward-compat flag set; verbal spell block NOT modelled until spell-block subsystem is implemented)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via the sentinel effect.
}
