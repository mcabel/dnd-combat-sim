// ============================================================
// Zone of Truth — PHB p.289
//
// 2nd-level enchantment, action, range 60 ft, concentration (10 min).
// Components: V, S, M (a pinch of powder and a drop of water).
//
// Effect: You create a magical zone that guards against deception in a
//         15-foot-radius sphere centered on a point of your choice within
//         range. Until the spell ends, a creature that enters the spell's
//         area for the first time on a turn or starts its turn there must
//         make a Charisma saving throw. On a failed save, a creature can't
//         speak a deliberate lie while in the zone. You know whether each
//         creature succeeds or fails on its saving throw.
//
//         A creature can be evasive in its answers as long as it remains
//         within the boundaries of the truth.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - v1 has NO lie/speech subsystem (the engine has no concept of
//     "deception" or "speaking a deliberate lie"). This spell sets a
//     forward-compat flag `_zoneOfTruthActive` on the TARGET — set for
//     future use, never read in v1. Like Darkvision's `_darkvisionActive`
//     pattern, but with a sentinel effect for cleanup because Zone of Truth
//     IS concentration.
//   - v1 simplification: canon Zone of Truth is a 15-ft-radius sphere
//     centered on a POINT (not a creature). v1 targets ONE creature (the
//     highest-threat enemy within 60 ft — mirror Silence's single-target
//     simplification). The AoE / multi-target geometry is NOT modelled.
//     Forward-compat TODO via the metadata flag
//     `zoneOfTruthAoEMultiTargetV1Implemented: false`.
//   - Duration: canon 10 min concentration → v1: concentration is started
//     via startConcentration(), but NOT enforced (TG-002). The flag
//     persists until removeEffectsFromCaster() is called.
//   - Upcast: — (no At Higher Levels entry). v1 always targets a single
//     creature. Forward-compat TODO via `zoneOfTruthUpcastV1Implemented: false`.
//   - Concentration enforcement: v1 does NOT enforce concentration
//     checks (TG-002).
//
// Spell module pattern (mirrors darkvision.ts forward-compat flag pattern
// BUT with concentration AND a CHA save — flag only set on save fail):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   metadata → spell stats
//   cleanup() — no-op (concentration break handled by sentinel effect)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Zone of Truth',
  level: 2,
  school: 'enchantment',
  rangeFt: 60,
  aoeRadiusFt: 15,
  concentration: true,
  saveAbility: 'cha' as const,
  castingTime: 'action',
  zoneOfTruthLieSubsystemV1Implemented: false,             // lie/speech subsystem NOT modelled
  zoneOfTruthAoEMultiTargetV1Implemented: false,           // single-target simplification
  zoneOfTruthUpcastV1Implemented: false,                   // no At Higher Levels entry — single target
  zoneOfTruthConcentrationEnforcementV1Implemented: false, // see TG-002
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
 * Returns the single best target for Zone of Truth (a living enemy within 60
 * ft, not already Zone-of-Truth'd by this caster), or null when the spell
 * should not be cast.
 *
 * Target priority: highest-threat enemy (maxHP) within 60 ft — v1's
 * single-target simplification (canon: 15-ft-radius AoE).
 *
 * Preconditions:
 *   - Caster has 'Zone of Truth' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Zone of Truth IS concentration — it cannot be cast while concentrating
 * on another spell. The planner gates on concentration via shouldCast.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Zone of Truth')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    // Skip if already Zone-of-Truth'd by this caster (re-cast would only
    // refresh the duration — wasteful in v1).
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Zone of Truth'
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
 * Execute Zone of Truth:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Zone of Truth.
 *  4. Roll the target's CHA save vs the caster's saveDC.
 *  5. On fail ONLY: set `target._zoneOfTruthActive = true` (forward-compat
 *     flag) AND attach a `damage_zone` sentinel effect (dieCount=0,
 *     dieSides=0) to the TARGET so removeEffectsFromCaster clears the flag
 *     on concentration break. The sentinel has `sourceIsConcentration: true`.
 *  6. On success: NO flag set, NO sentinel (target resisted).
 *
 * v1 simplifications: AoE / multi-target NOT modelled (single target);
 * lie/speech subsystem NOT modelled (forward-compat flag only); concentration
 * NOT enforced (TG-002). The flag persists for the entire combat (or until
 * concentration breaks).
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Zone of Truth');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Zone of Truth');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Zone of Truth at ${target.name}! (DC ${saveDC} CHA)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'cha', saveDC);
  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CHA save vs Zone of Truth (rolled ${save.total})`,
    target.id, save.roll,
  );

  if (save.success) {
    emit(
      state, 'action', caster.id,
      `${target.name} resists Zone of Truth — can lie freely!`,
      target.id,
    );
    return;  // No flag, no sentinel — target resisted.
  }

  // Apply the forward-compat flag (target can't lie — v1: forward-compat only).
  target._zoneOfTruthActive = true;

  // Attach a damage_zone sentinel (dieCount=0) so removeEffectsFromCaster
  // clears the `_zoneOfTruthActive` flag on concentration break.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Zone of Truth',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is bound by ZONE OF TRUTH! (v1: forward-compat flag set; lie/speech subsystem NOT modelled)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via the sentinel effect.
}
