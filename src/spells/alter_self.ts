// ============================================================
// Alter Self — PHB p.211
//
// 2nd-level transmutation, action, range Self, concentration (10 min).
// Components: V, S.
//
// Effect: You assume a different form. When you cast the spell, choose one
//         of the following options, the effects of which last for the
//         duration of the spell:
//           Aquatic Adaptation: You adapt your body to an aquatic
//             environment, sprouting gills and growing webbing between
//             your fingers. You can breathe underwater and gain a swimming
//             speed equal to your walking speed.
//           Change Appearance: You transform your appearance. You decide
//             what you look like, including your height, weight, facial
//             features, sound of your voice, hair length, coloration, and
//             distinguishing characteristics, if any.
//           Natural Weapons: You grow claws, fangs, spines, horns, or a
//             different natural weapon of your choice. Your unarmed strikes
//             deal 1d6 bludgeoning, piercing, or slashing damage — chosen
//             when you cast the spell — and you are proficient with them.
//             Your unarmed strikes count as magical for the purpose of
//             overcoming resistance and immunity to nonmagical attacks and
//             damage.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - v1 implements ONLY the "Natural Weapons" option (the combat-relevant
//     one). The other two (Aquatic Adaptation, Change Appearance) are NOT
//     modelled — no swimming/disguise subsystem. Forward-compat TODO via
//     the metadata flags `alterSelfAquaticAdaptationV1Implemented: false`
//     and `alterSelfChangeAppearanceV1Implemented: false`.
//   - Duration: canon 10 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002). The `_alterSelfActive` scratch field
//     persists until removeEffectsFromCaster() is called (the spell uses a
//     damage_zone sentinel effect with dieCount=0 to anchor concentration-
//     break cleanup — see _undoEffect in spell_effects.ts).
//   - Natural weapons damage type: v1 always deals SLASHING (the most common
//     natural weapon type). Canon: chosen when cast. Future work could let
//     the AI pick based on the target's resistances.
//   - Magical unarmed strikes: v1's engine doesn't distinguish magical vs
//     nonmagical damage (no resistance/immunity subsystem for nonmagical B/P/S).
//     The "magical for overcoming resistance" rider is moot in v1.
//   - The buff modifies the unarmed strike's BASE damage die (1 → 1d6),
//     NOT adds a rider. resolveAttack's damage branch checks: if the action
//     is an unarmed strike (damage dice = 1 + STR mod), substitute 1d6 + STR
//     mod instead. This is a v1 simplification — the engine doesn't have a
//     clean "substitute weapon die" hook, so the damage branch checks the
//     action's damage field and overrides it.
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
  name: 'Alter Self',
  level: 2,
  school: 'transmutation',
  rangeFt: 0,       // self
  unarmedDieSides: 6,        // 1d6 (replaces 1 + STR mod)
  unarmedDamageType: 'slashing' as const,  // v1: always slashing
  concentration: true,
  castingTime: 'action',
  alterSelfAquaticAdaptationV1Implemented: false,            // aquatic adaptation NOT modelled
  alterSelfChangeAppearanceV1Implemented: false,             // change appearance NOT modelled
  alterSelfConcentrationEnforcementV1Implemented: false,     // see TG-002
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
 * Returns true if the caster should cast Alter Self this turn.
 *
 * Preconditions:
 *   - Caster has 'Alter Self' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already Alter-Self-active (re-cast would only refresh)
 *   - Caster's unarmed strike is their primary attack option — v1
 *     simplification: only cast Alter Self if the caster has NO weapon
 *     attacks (melee or ranged) in their action list. A caster with a real
 *     weapon doesn't need natural weapons. This is a v1 simplification —
 *     canon: a creature could cast Alter Self even with weapons (for the
 *     magical-unarmed-strike rider, or as a backup). Future work could be
 *     less restrictive.
 *   - At least 1 living enemy exists (the buff is useless with no enemies)
 *
 * Note: Alter Self IS concentration — it cannot be cast while concentrating
 * on another spell. The planner gates on concentration via shouldCast.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Alter Self')) return false;
  if (!hasSpellSlot(caster, 2)) return false;

  if (caster._alterSelfActive === 'naturalWeapons') return false;

  // v1: only cast if the caster has NO weapon attacks (natural weapons as
  // a fallback for spell-only casters).
  const hasWeaponAttack = caster.actions.some(a =>
    a.attackType === 'melee' || a.attackType === 'ranged'
  );
  if (hasWeaponAttack) return false;

  if (livingEnemiesOf(caster, bf).length === 0) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Alter Self:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Alter Self.
 *  4. Set `_alterSelfActive = 'naturalWeapons'` on the caster (scratch field).
 *     resolveAttack's damage branch checks this flag: if the action is an
 *     unarmed strike (damage dice = 1 + STR mod), substitute 1d6 + STR mod
 *     instead (PHB p.211).
 *  5. Attach a `damage_zone` sentinel effect (dieCount=0) to anchor
 *     concentration-break cleanup.
 *
 * v1 simplifications: only Natural Weapons option; always slashing; magical-
 * unarmed-strike rider moot in v1; concentration NOT enforced (TG-002).
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Alter Self');

  caster._alterSelfActive = 'naturalWeapons';

  // Attach a damage_zone sentinel (dieCount=0) so removeEffectsFromCaster
  // clears the scratch field on concentration break.
  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Alter Self',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 0, damageType: 'slashing' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Alter Self — Natural Weapons! (Unarmed strikes deal 1d6 ${metadata.unarmedDamageType} + STR mod)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} grows natural weapons — claws/fangs/spines! (unarmed strikes deal 1d6 ${metadata.unarmedDamageType} while active)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via the sentinel effect.
}
