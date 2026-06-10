// ============================================================
// Faerie Fire — PHB p.239
//
// 1st-level evocation, concentration (up to 1 min)
// Range: 60 ft   AoE: 20-ft cube
// Effect: DEX save or outlined in faint light — all attacks vs outlined creatures
//         have advantage. Dispelled when concentration breaks.
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Faerie Fire',
  level: 1,
  school: 'evocation',
  rangeFt: 60,
  aoeSizeFt: 20,
  concentration: true,
  saveAbility: 'dex' as const,
  castingTime: 'action',
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
 * Returns candidate targets for Faerie Fire (living enemies within 60 ft, not already
 * outlined by this caster), or null when the spell should not be cast.
 *
 * Preconditions:
 *   - Caster has 'Faerie Fire' in their actions (parsed from prepared spells)
 *   - Caster has at least one 1st-level slot available
 *   - Caster is NOT already concentrating on any spell (don't drop active concentration)
 *   - At least 1 valid enemy target exists
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  // Never interrupt active concentration (AI doesn't swap concentration spells mid-combat)
  if (caster.concentration?.active) return null;

  // Must have the spell and a free 1st-level (or higher) slot
  if (!caster.actions.some(a => a.name === 'Faerie Fire')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const targets: Combatant[] = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;
    // Skip if already outlined by this caster (shouldn't happen given the concentration
    // check above, but guard defensively)
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Faerie Fire')) {
      continue;
    }
    targets.push(c);
  }

  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Faerie Fire:
 *  1. Consume a 1st-level spell slot.
 *  2. Break any existing concentration (safety net — planner should prevent this).
 *  3. Start concentration on Faerie Fire.
 *  4. For each target: roll DEX save vs caster's saveDC.
 *     - Fail → apply advantage_vs:attack via ActiveEffect registry (auto-cleans on conc. break).
 *     - Success → no effect.
 *
 * @param caster  The casting Combatant
 * @param targets Candidates from shouldCast (living enemies in range)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Faerie Fire');
  const saveDC = action?.saveDC ?? 13;
  const bf = state.battlefield;

  consumeSpellSlot(caster, 1);

  // Safety: if caster is somehow concentrating, clean up before starting new concentration.
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, bf);
  }
  startConcentration(caster, 'Faerie Fire');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Faerie Fire (DC ${saveDC} DEX) targeting ${targets.length} creature${targets.length !== 1 ? 's' : ''}!`,
  );

  let outlined = 0;
  for (const target of targets) {
    // Re-check liveness (targets could theoretically be stale in edge cases)
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSave(target, 'dex', saveDC);
    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Faerie Fire (rolled ${save.total})`,
      target.id,
      save.roll,
    );

    if (!save.success) {
      applySpellEffect(target, {
        casterId: caster.id,
        spellName: 'Faerie Fire',
        effectType: 'advantage_vs',
        payload: {
          advType: 'advantage',
          advScope: 'attack',
        },
        sourceIsConcentration: true,
      });
      emit(
        state, 'condition_add', caster.id,
        `${target.name} is outlined by Faerie Fire — all attacks against them have advantage!`,
        target.id,
      );
      outlined++;
    }
  }

  if (outlined === 0) {
    // All targets saved — caster is concentrating but with no active outlines.
    // Concentration remains until broken; nothing to track further.
    emit(
      state, 'action', caster.id,
      `${caster.name}'s Faerie Fire: all targets saved — no creatures outlined.`,
    );
  }
}
