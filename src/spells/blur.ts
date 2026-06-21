// ============================================================
// Blur — PHB p.219
//
// 2nd-level illusion, action, range Self, concentration (1 min).
// Components: V only.
//
// Effect: Your body becomes blurred, shifting and wavering to all
//         who can see you. For the duration, any creature has
//         disadvantage on attack rolls against you. An attacker is
//         immune to this effect if it doesn't rely on sight, as with
//         blindsight, or can see through illusions, as with truesight.
//
// v1 simplifications:
//   - Duration: canon 1 min concentration → v1: concentration is started
//     via startConcentration(), but the engine does NOT yet enforce
//     concentration checks on damage taken (forward-compat TODO; see
//     TG-002 in TEAMGOALS.md). The disadvantage effect persists until
//     removeEffectsFromCaster() is called.
//   - Sight-dependency immunity (blindsight / truesight attackers): v1
//     does NOT model this — all attackers suffer disadvantage. Documented
//     via the metadata flag `blurSightDependencyV1Implemented: false`.
//     The `isBlindImmune` flag does NOT exist on Combatant yet — adding
//     it is part of TG-004 (parser tech debt) in TEAMGOALS.md.
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → boolean   (self-buff — no target)
//   execute(caster, state) → void
//   metadata → spell stats
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Blur',
  level: 2,
  school: 'illusion',
  rangeFt: 0,       // self
  concentration: true,
  castingTime: 'action',
  blurConcentrationEnforcementV1Implemented: true,  // TG-002 DONE (Session 34)
  blurSightDependencyV1Implemented: false,           // blindsight/truesight immunity
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
 * Returns true if the caster should cast Blur this turn.
 *
 * Preconditions:
 *   - Caster has 'Blur' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster is NOT already Blurred (re-cast would be wasteful)
 *   - At least 1 living enemy exists (the buff is useless with no attackers)
 *
 * Target priority: self only (PHB p.219: range Self). No target selection.
 *
 * Note: Blur is best when the caster expects to be attacked (in melee
 * range or visible to ranged enemies). v1's shouldCast fires whenever
 * an enemy exists — the AI planner can be more selective in future work.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Blur')) return false;
  if (!hasSpellSlot(caster, 2)) return false;

  // Skip if already Blurred (re-cast would only refresh the duration — wasteful).
  if (caster.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Blur')) return false;

  // Need at least 1 living enemy to justify the buff.
  if (livingEnemiesOf(caster, bf).length === 0) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Blur:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner should prevent this).
 *  3. Start concentration on Blur.
 *  4. Apply advantage_vs 'disadvantage' 'attack' effect on the CASTER.
 *     The effect mirrors into adv_system.grantVulnerability, which is
 *     consulted by attackAdvantageState() in utils.ts — attacks against
 *     the caster will have disadvantage while the effect is active.
 *
 * @param caster  The casting Combatant (Wizard / Sorcerer)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  // Safety: clean up any stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Blur');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Blur! (Disadvantage on attack rolls against ${caster.name})`,
    caster.id,
  );

  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Blur',
    effectType: 'advantage_vs',
    payload: {
      advType: 'disadvantage',
      advScope: 'attack',   // all attack rolls against the caster
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${caster.name}'s body becomes blurred — attacks against them have disadvantage!`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Blur — called from resetBudget() at the start of
 * the caster's next turn. NO-OP in v1 because:
 *   - Blur is a concentration spell; the disadvantage effect is removed
 *     via removeEffectsFromCaster() when concentration breaks.
 *   - v1 does NOT enforce concentration checks (TG-002), so concentration
 *     effectively persists for the entire combat.
 *
 * Exported for symmetry with the other spell modules' cleanup pattern.
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
