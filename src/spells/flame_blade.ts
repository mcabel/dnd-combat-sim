// ============================================================
// Flame Blade — PHB p.242
//
// 2nd-level evocation, action, range Self, concentration (10 min).
// Components: V, S, M (leaves of sumac).
//
// Effect: You evoke a fiery blade in your free hand. The blade is similar
//         in size and shape to a scimitar, and it lasts for the duration.
//         If you let go of the blade, it disappears, but you can evoke the
//         blade again as a bonus action.
//
//         You can use your action to make a melee spell attack with the
//         fiery blade. On a hit, the target takes 3d6 fire damage.
//
// Upcast: +1d6 fire per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - Canon: Flame Blade creates a NEW melee weapon that the caster attacks
//     with as an action (melee spell attack, 3d6 fire). v1 instead models
//     it as a +3d6 fire RIDER on the caster's existing melee weapon attacks
//     (mirroring Shillelagh's +1d8 radiant pattern, but with a larger die
//     and fire type). This is documented via the metadata flag
//     `flameBladeAsWeaponRiderV1Simplified: true`. The canon "use your
//     action to make a melee spell attack" is approximated by the rider
//     firing on the caster's next melee weapon attack.
//   - Duration: canon 10 min concentration → v1: concentration is started
//     via startConcentration(), but the engine does NOT enforce
//     concentration checks (TG-002). The `_flameBladeActive` scratch field
//     persists until removeEffectsFromCaster() is called (the spell uses a
//     damage_zone sentinel effect with dieCount=0 to anchor concentration-
//     break cleanup — see _undoEffect in spell_effects.ts).
//   - "Let go of the blade" / re-evoke as bonus action: NOT modelled (no
//     object-tracking subsystem).
//   - Upcast: +1d6/slot-level NOT modelled — v1 always rolls 3d6 fire.
//
// Spell module pattern:
//   shouldCast(caster, bf) → boolean   (self-buff — no target)
//   execute(caster, state) → void
//   cleanup() — no-op (concentration break handled by the sentinel effect)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Flame Blade',
  level: 2,
  school: 'evocation',
  rangeFt: 0,       // self
  damageDice: 3,
  damageDieSides: 6,
  damageType: 'fire' as const,
  concentration: true,
  castingTime: 'action',
  flameBladeAsWeaponRiderV1Simplified: true,                  // canon: new melee weapon; v1: +3d6 fire rider
  flameBladeReEvokeV1Implemented: false,                     // bonus-action re-evoke NOT modelled
  flameBladeUpcastV1Implemented: false,                      // +1d6/slot-level NOT modelled
  flameBladeConcentrationEnforcementV1Implemented: false,    // see TG-002
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
 * Returns true if the caster should cast Flame Blade this turn.
 *
 * Preconditions:
 *   - Caster has 'Flame Blade' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already Flame-Blade-active (re-cast would only refresh)
 *   - Caster has at least one MELEE weapon attack (the rider fires on melee
 *     weapon attacks — a ranged-only caster gets no benefit)
 *   - At least 1 living enemy exists (the buff is useless with no enemies)
 *
 * Note: Flame Blade IS concentration — it cannot be cast while concentrating
 * on another spell. The planner gates on concentration via shouldCast.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Flame Blade')) return false;
  if (!hasSpellSlot(caster, 2)) return false;

  if (caster._flameBladeActive === true) return false;

  // Must have at least one MELEE weapon attack (the rider is melee-only).
  const hasMeleeWeaponAttack = caster.actions.some(a => a.attackType === 'melee');
  if (!hasMeleeWeaponAttack) return false;

  if (livingEnemiesOf(caster, bf).length === 0) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Flame Blade:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Flame Blade.
 *  4. Set `_flameBladeActive = true` on the caster (scratch field).
 *     resolveAttack's damage branch checks this flag and adds 3d6 fire to
 *     the caster's melee weapon attacks (melee only — NOT ranged, NOT spell).
 *  5. Attach a `damage_zone` sentinel effect (dieCount=0) to anchor
 *     concentration-break cleanup.
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Flame Blade');

  caster._flameBladeActive = true;

  // Attach a damage_zone sentinel (dieCount=0) so removeEffectsFromCaster
  // clears the scratch field on concentration break.
  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Flame Blade',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 0, damageType: 'fire' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Flame Blade! (Next melee weapon attack deals +${metadata.damageDice}d${metadata.damageDieSides} ${metadata.damageType})`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} evokes a fiery blade! (melee weapon attacks deal +${metadata.damageDice}d${metadata.damageDieSides} ${metadata.damageType} while active)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Flame Blade — called from resetBudget() at the start
 * of the caster's next turn. NO-OP in v1 because:
 *   - Flame Blade is a concentration spell; the scratch field is cleared
 *     via removeEffectsFromCaster() when concentration breaks (the damage_zone
 *     sentinel's _undoEffect clears `_flameBladeActive`).
 *   - v1 does NOT enforce concentration checks (TG-002).
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via the sentinel effect.
}
