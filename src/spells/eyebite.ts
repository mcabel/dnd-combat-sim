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
//         On each of your turns until the spell ends, you can use your
//         action to target another creature.
//
// Upcast: none (6th-level spell — no upcast).
//
// v1 simplifications:
//   - Effect choice: canon lets the caster pick Asleep/Panicked/Sickened
//     each turn. v1 ALWAYS picks Asleep → `condition_apply:sleeping`
//     (the most disabling of the three; Panicked ≈ frightened, Sickened
//     ≈ poisoned — both partial). Documented via
//     `eyebiteAlwaysPicksAsleepV1Simplified`.
//   - Per-turn re-targeting (PHB p.238: "On each of your turns... you
//     can use your action to target another creature"): v1 simplifies
//     to ONE-SHOT — a single target on the cast turn. The repeat-action
//     rider is NOT modelled. Documented via
//     `eyebitePerTurnRetargetV1Simplified`.
//   - Range: canon 60 ft. v1 uses chebyshev3D * 5 (square approx).
//   - Concentration: canon 1 min concentration. v1 starts concentration
//     via startConcentration(); engine does NOT enforce concentration
//     checks on damage taken (TG-002). The sleeping is
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

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
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
  eyebiteAlwaysPicksAsleepV1Simplified: true,               // v1: always Asleep → sleeping
  eyebitePerTurnRetargetV1Simplified: true,                 // one-shot (canon per-turn re-target simplified)
  eyebiteWakeOnDamageV1Simplified: true,                    // no wake-on-damage hook
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
 * Returns the single best target for Eyebite (a living enemy within 60 ft,
 * not already sleeping/incapacitated), or null when the spell should not
 * be cast.
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
 *  4. Roll the target's WIS save; on fail apply sleeping (conc-sourced).
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

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Eyebite at ${target.name}! (DC ${saveDC} WIS — Asleep option)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'wis', saveDC);
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
      `${target.name} resists Eyebite — not asleep!`,
      target.id,
    );
    return;
  }

  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Eyebite',
    effectType: 'condition_apply',
    payload: { condition: 'sleeping' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} falls ASLEEP (unconscious, drops what's holding, attacks vs them within 5 ft are crits)!`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup.
}
