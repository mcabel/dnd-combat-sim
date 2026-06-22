// ============================================================
// Eyebite — PHB p.238
//
// 6th-level necromancy, action, range 60 ft, concentration (1 min).
// Components: V, S.
//
// Effect: For the spell's duration, your eyes become an inky void
//         imbued with dread power. One creature within 60 feet of you
//         that you can see must make a Wisdom saving throw. On a failed
//         save, the target is affected by one of the following effects
//         (your choice): Asleep, Panicked, or Sickened.
//         Asleep: the target falls unconscious.
//         Panicked: the target is frightened of you.
//         Sickened: the target is poisoned.
//         On each of your turns until the spell ends, you can use your
//         action to target another creature.
//
// Upcast: none (6th-level spell — no upcast).
//
// v2 implementation:
//   - Effect choice: 3 canon options (Asleep/Panicked/Sickened) with
//     AI-driven selection via pickEyebiteOption(). Distance-based heuristic:
//     ≤20 ft → Panicked (frightened forces them away),
//     ≤40 ft → Sickened (poisoned hurts their attacks),
//     >40 ft → Asleep (most disabling — they can't reach you).
//     Documented via `eyebiteOptionsV2Implemented`.
//   - Per-turn re-targeting (PHB p.238: "On each of your turns... you
//     can use your action to target another creature"): implemented as
//     an automatic start-of-turn re-target in combat.ts's runCombat loop.
//     v1 simplification: the re-target does NOT consume the caster's
//     action (it fires automatically like damage_zone ticks). The caster
//     still gets their normal turn. Canon requires using an action each
//     turn to re-target, but the automatic approach is simpler and
//     consistent with the engine's damage_zone tick pattern.
//     Documented via `eyebitePerTurnRetargetV2Implemented` and
//     `eyebitePerTurnRetargetActionCostV1Simplified`.
//   - Range: canon 60 ft. Uses chebyshev3D * 5 (square approx).
//   - Concentration: canon 1 min concentration. Starts concentration
//     via startConcentration(); engine does NOT enforce concentration
//     checks on damage taken (TG-002). All conditions applied are
//     sourceIsConcentration: true.
//   - Sleeping wakes on damage (PHB p.292): v1 has no wake-on-damage
//     hook — sleeping persists for the entire combat (or until conc
//     breaks). Documented via `eyebiteWakeOnDamageV1Simplified`.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-sleeping (concentration).
// Removed from `_generic_registry.ts`; routed via `case 'eyebite':` in
// combat.ts and a planner branch in planner.ts. Mirrors Hold Person
// (single-target concentration save-or-condition) but with sleeping.
//
// Spell module pattern (single-target save-or-condition, concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Eyebite',
  level: 6,
  school: 'necromancy',
  rangeFt: 60,                   // PHB p.238: 60 ft
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  eyebiteOptionsV2Implemented: true,                         // v2: 3 canon options (Asleep/Panicked/Sickened)
  eyebitePerTurnRetargetV2Implemented: true,                 // v2: per-turn re-target via start-of-turn processing
  eyebitePerTurnRetargetActionCostV1Simplified: true,        // v1: re-target is automatic (doesn't consume action)
  eyebiteWakeOnDamageV1Simplified: true,                     // no wake-on-damage hook
} as const;

// ---- Option types and AI picker -----------------------------

export type EyebiteOption = 'asleep' | 'panicked' | 'sickened';

/**
 * Maps an EyebiteOption to the Condition it applies.
 *   Asleep   → sleeping   (unconscious, drops items, melee auto-crit)
 *   Panicked → frightened (disadv on attacks while source visible, can't approach)
 *   Sickened → poisoned   (disadv on attacks and ability checks)
 */
export function optionToCondition(option: EyebiteOption): Condition {
  switch (option) {
    case 'asleep':   return 'sleeping';
    case 'panicked': return 'frightened';
    case 'sickened': return 'poisoned';
  }
}

/**
 * AI picks the best Eyebite option for the target based on distance.
 *   ≤20 ft → Panicked (frightened: forces them away, disadv on attacks)
 *   ≤40 ft → Sickened (poisoned: disadv on attacks and ability checks)
 *   >40 ft → Asleep   (sleeping: most disabling — they can't reach you)
 *
 * Heuristic rationale: close targets are best dealt with by forcing
 * them away (frightened can't approach); mid-range targets are
 * disrupted by attack disadvantage (poisoned); distant targets are
 * fully disabled (sleeping — most debilitating condition).
 */
export function pickEyebiteOption(target: Combatant, caster: Combatant): EyebiteOption {
  const distFt = chebyshev3D(caster.pos, target.pos) * 5;
  if (distFt <= 20) return 'panicked';
  if (distFt <= 40) return 'sickened';
  return 'asleep';
}

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
 * Returns the single best target for Eyebite (a living enemy within 60 ft,
 * not already sleeping/incapacitated/frightened/poisoned by Eyebite from
 * this caster), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (maxHP) within 60 ft.
 *   2. Tie-break: closest enemy.
 *
 * Preconditions:
 *   - Caster has 'Eyebite' in their actions
 *   - Caster has at least one 6th-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 60 ft
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Eyebite')) return null;
  if (!hasSpellSlot(caster, 6)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    if (c.conditions.has('sleeping') || c.conditions.has('incapacitated')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Eyebite')) continue;

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
 * Execute Eyebite:
 *  1. Consume a 6th-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Eyebite.
 *  4. Place a damage_zone SENTINEL on the caster (dieCount=0) to anchor
 *     concentration-break cleanup of the _eyebiteActive scratch field.
 *  5. Set caster._eyebiteActive = { saveDC } for per-turn re-target.
 *  6. Pick the best option for this target (AI via pickEyebiteOption).
 *  7. Roll the target's WIS save; on fail apply the chosen condition (conc-sourced).
 *
 * @param caster  The casting Combatant (Bard / Sorcerer / Warlock / Wizard)
 * @param target  The candidate from shouldCast (single enemy in range)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Eyebite');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 6);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Eyebite');

  // Place a damage_zone sentinel on the caster for concentration-break cleanup.
  // dieCount=0 means no damage tick — the start-of-turn damage_zone loop
  // skips it. When concentration breaks, _undoEffect clears _eyebiteActive.
  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Eyebite',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 0, damageType: 'psychic' },
    sourceIsConcentration: true,
  });
  caster._eyebiteActive = { saveDC };

  // Pick the best option for this target.
  const option = pickEyebiteOption(target, caster);
  const condition = optionToCondition(option);

  const optionLabel = option.charAt(0).toUpperCase() + option.slice(1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Eyebite at ${target.name}! (DC ${saveDC} WIS — ${optionLabel} option)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  const save = rollSaveReactable(state, caster, target, 'wis', saveDC);
  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Eyebite (rolled ${save.total})`,
    target.id,
    save.roll,
  );

  if (save.success) {
    emit(
      state, 'action', caster.id,
      `${target.name} resists Eyebite — not ${optionLabel.toLowerCase()}!`,
      target.id,
    );
    return;
  }

  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Eyebite',
    effectType: 'condition_apply',
    payload: { condition },
    sourceIsConcentration: true,
  });

  // Human-readable effect description per option
  const effectDescs: Record<EyebiteOption, string> = {
    asleep:   `falls ASLEEP (unconscious, drops what's holding, attacks vs them within 5 ft are crits)!`,
    panicked: `is PANICKED (frightened — disadv on attacks while caster visible, can't approach)!`,
    sickened: `is SICKENED (poisoned — disadv on attacks and ability checks)!`,
  };

  emit(
    state, 'condition_add', caster.id,
    `${target.name} ${effectDescs[option]}`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup.
}
