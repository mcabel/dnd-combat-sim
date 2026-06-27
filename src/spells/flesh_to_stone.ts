// ============================================================
// Flesh to Stone — PHB p.241
//
// 6th-level transmutation, action, range 60 ft, concentration (1 min).
// Components: V, S, M (a pinch of lime, water, and earth).
//
// Effect: You attempt to turn one creature that you can see within range
//         into stone. If the target's body is made of flesh, the creature
//         must make a Constitution saving throw. On a failed save, it is
//         restrained as its flesh begins to harden. On a successful save,
//         it isn't affected. A creature restrained by this spell must make
//         another Constitution saving throw at the end of its next turn.
//         If it successfully saves against this spell three times, the
//         spell ends. If it fails its saves three times, it is turned to
//         stone and subjected to the petrified condition.
//
// Upcast: none (6th-level spell — no upcast).
//
// v2 implementation (3-fail-save escalation):
//   - On CON save fail: apply restrained (concentration-sourced).
//     Set _saveFailTracker with fails=1, successes=0.
//   - At the start of each of the target's turns: CON save vs spell DC.
//   - After 3 failed saves total: upgrade to petrified (NOT concentration-
//     sourced — permanent). Tracker cleared.
//   - After 3 successful saves total: remove all effects, clear tracker.
//   - If concentration breaks before petrification: restrained removed,
//     tracker cleared.
//   - If petrified is reached: condition persists even if concentration
//     breaks (it's the final state — PHB p.241).
//
// v1 simplifications (replaced in v2):
//   - 3-fail petrification: v1 simplified to ONE condition — restrained
//     on initial fail (no 3-save escalation). Was documented via
//     `fleshToStonePetrifiedOn3FailsV1Simplified`.
//   - End-of-turn repeat save: v1 skipped (no end-of-turn save hook).
//     Was documented via `fleshToStoneEndOfTurnSaveV1Implemented: false`.
//   - Range: canon 60 ft. v1 uses chebyshev3D * 5.
//   - Concentration: canon 1 min concentration. v1 starts concentration
//     via startConcentration(); engine does NOT enforce concentration
//     checks on damage taken (TG-002). The restrained is
//     sourceIsConcentration: true.
//   - Flesh-only restriction (PHB p.241: "If the target's body is made
//     of flesh"): NOT enforced — v1 has no creature-composition tag.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke CON-save-or-restrained (concentration).
// Removed from `_generic_registry.ts`; routed via `case 'fleshToStone':`
// in combat.ts and a planner branch in planner.ts. Mirrors Hold Person
// (single-target concentration save-or-condition) but with CON save +
// restrained (3-fail petrified simplified).
//
// Spell module pattern (single-target save-or-condition, concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, SaveFailTracker } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Flesh to Stone',
  level: 6,
  school: 'transmutation',
  rangeFt: 60,                   // PHB p.241: 60 ft
  concentration: true,
  saveAbility: 'con' as const,
  castingTime: 'action',
  fleshToStonePetrifiedOn3FailsV2Implemented: true,        // 3-fail escalation tracked
  fleshToStoneEndOfTurnSaveV2Implemented: true,             // start-of-turn save tracked
  fleshToStoneFleshOnlyRestrictionV1Simplified: true,      // no creature-composition tag
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
 * Returns the single best target for Flesh to Stone (a living enemy
 * within 60 ft, not already restrained), or null when the spell should
 * not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (maxHP) within 60 ft.
 *   2. Tie-break: closest enemy.
 *
 * Preconditions:
 *   - Caster has 'Flesh to Stone' in their actions
 *   - Caster has at least one 6th-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 60 ft
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Flesh to Stone')) return null;
  if (!hasSpellSlot(caster, 6)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    if (c.conditions.has('restrained') || c.conditions.has('petrified')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Flesh to Stone')) continue;

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
 * Execute Flesh to Stone:
 *  1. Consume a 6th-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Flesh to Stone.
 *  4. Roll the target's CON save; on fail apply restrained (conc-sourced)
 *     and set _saveFailTracker with fails=1.
 *
 * @param caster  The casting Combatant (Warlock / Wizard)
 * @param target  The candidate from shouldCast (single enemy in range)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Flesh to Stone');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 6);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Flesh to Stone');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Flesh to Stone at ${target.name}! (DC ${saveDC} CON, 3-fail escalation tracked)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  const save = rollSaveReactable(state, caster, target, 'con', saveDC);
  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Flesh to Stone (rolled ${save.total})`,
    target.id,
    save.roll,
  );

  if (save.success) {
    emit(
      state, 'action', caster.id,
      `${target.name} resists Flesh to Stone — not restrained!`,
      target.id,
    );
    return;
  }

  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Flesh to Stone',
    effectType: 'condition_apply',
    payload: { condition: 'restrained' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is RESTRAINED as flesh begins to harden! (CON saves at start of each turn — 3 fails → petrified, 3 successes → freed)`,
    target.id,
  );

  // Set the save-fail tracker for 3-fail escalation.
  // Flesh to Stone: initial = restrained (concentration-sourced),
  // escalation = petrified (NOT concentration-sourced — permanent).
  // fails starts at 1 because the initial save was already failed.
  target._saveFailTracker = {
    spellName: 'Flesh to Stone',
    casterId: caster.id,
    fails: 1,
    successes: 0,
    maxCount: 3,
    saveAbility: 'con',
    saveDC,
    conditionOnFail: 'petrified',
    currentCondition: 'restrained',
    // Session 84: Flesh to Stone is a 6th-level spell (no upcast). Used by
    // the combat.ts save-fail tracker loop to check Globe of Invulnerability
    // protection on each per-turn save roll (PHB p.245). Base GoI (threshold
    // 5) does NOT block L6; an upcast GoI at L7+ (threshold 6+) DOES block.
    // Mirrors the sourceSlotLevel pattern on zone effects.
    slotLevel: 6,
  };
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup.
}
