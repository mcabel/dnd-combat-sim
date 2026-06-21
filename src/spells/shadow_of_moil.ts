// ============================================================
// Shadow of Moil — XGE p.164 (PHB p.275)
//
// 4th-level necromancy, 1 action, range Self, concentration.
// Duration: 1 minute.
//
// Effect: Flame-like shadows wreathe your body until the spell
// ends, causing you to become heavily obscured to others. You
// have advantage on Dexterity (Stealth) checks made in dim light
// or darkness. In addition, whenever a creature hits you with a
// melee attack roll before the spell ends, that creature takes
// 2d8 necrotic damage.
//
// Upcast: see source (not modelled in v1).
//
// v1 simplifications:
//   - "Heavily obscured" → disadvantage on attacks vs caster.
//     Canon: heavily obscured = effectively invisible for targeting
//     (PHB p.183). v1 models this identically to Blur (advantage_vs
//     'disadvantage' 'attack'). The distinction between Blur's
//     sight-dependency and Shadow of Moil's heavy obscurement is
//     NOT modelled — both give disadvantage on all attacks.
//     Documented via `shadowOfMoilObscurementV1Simplified: true`.
//   - Advantage on Stealth checks in dim light/darkness: NOT
//     modelled in v1 (no stealth/darkness subsystem). Documented
//     via `shadowOfMoilStealthAdvV1Implemented: false`.
//   - 2d8 necrotic retaliation triggers on ALL attacks, not just
//     melee. Canon specifies "melee attack roll" only, but v1's
//     curse_rider mechanism does not distinguish melee vs ranged.
//     Documented via `shadowOfMoilRiderMeleeOnlyV1Implemented: false`.
//   - Concentration: canon 1 min. v1 starts concentration via
//     startConcentration(), but the engine does NOT enforce
//     concentration checks on damage taken (TG-002).
//
// Spell module pattern (mirrors Blur self-buff pattern):
//   shouldCast(caster, bf) → boolean   (self-buff — no target)
//   execute(caster, state) → void
//   metadata → spell stats
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { livingEnemiesOf, distanceFt } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Shadow of Moil',
  level: 4,
  school: 'necromancy',
  rangeFt: 0,       // self
  concentration: true,
  castingTime: 'action',
  shadowOfMoilObscurementV1Simplified: true,       // heavily obscured = Blur-like disadv
  shadowOfMoilStealthAdvV1Implemented: false,      // stealth adv in dim/dark not modelled
  shadowOfMoilRiderMeleeOnlyV1Implemented: false,   // rider fires on all attacks, not just melee
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
 * Returns true if the caster should cast Shadow of Moil this turn.
 *
 * Preconditions:
 *   - Caster has 'Shadow of Moil' in their actions
 *   - Caster has at least one 4th-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster is NOT already under Shadow of Moil (re-cast would be wasteful)
 *   - At least 1 living enemy exists within 30 ft (the rider is melee-range)
 *
 * Target priority: self only (XGE p.164: range Self). No target selection.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Shadow of Moil')) return false;
  if (!hasSpellSlot(caster, 4)) return false;

  // Skip if already Shadow of Moil'd (re-cast would only refresh — wasteful).
  if (caster.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Shadow of Moil')) return false;

  // Need at least 1 living enemy within 30 ft to justify the rider.
  // (Enemies further than 30 ft are unlikely to make melee attacks.)
  const nearbyEnemies = livingEnemiesOf(caster, bf).filter(
    e => distanceFt(caster.pos, e.pos) <= 30
  );
  if (nearbyEnemies.length === 0) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Shadow of Moil:
 *  1. Consume a 4th-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner should prevent this).
 *  3. Start concentration on Shadow of Moil.
 *  4. Apply advantage_vs 'disadvantage' 'attack' effect on the CASTER.
 *     Heavily obscured → can't see target → disadvantage on attacks vs caster.
 *     (Same mechanism as Blur.)
 *  5. Apply curse_rider effect on all enemies within 30 ft.
 *     When an enemy hits the caster with an attack, the enemy takes 2d8 necrotic.
 *     (v1: fires on ALL attacks, not just melee — see metadata flag.)
 *
 * @param caster  The casting Combatant (Warlock)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 4);

  // Safety: clean up any stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Shadow of Moil');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Shadow of Moil! (Disadvantage on attacks vs ${caster.name}; 2d8 necrotic to melee attackers)`,
    caster.id,
  );

  // 1. Heavily obscured → disadvantage on attacks vs caster (same as Blur)
  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Shadow of Moil',
    effectType: 'advantage_vs',
    payload: {
      advType: 'disadvantage',
      advScope: 'attack',   // all attack rolls against the caster
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${caster.name} is wreathed in flame-like shadows — attacks against them have disadvantage!`,
    caster.id,
  );

  // 2. Apply curse_rider on all enemies within 30 ft
  // PHB p.275: "whenever a creature hits you with a melee attack roll before
  // the spell ends, that creature takes 2d8 necrotic damage."
  // v1 simplification: rider fires on ALL attacks (melee + ranged), not just melee.
  const enemies = livingEnemiesOf(caster, state.battlefield).filter(
    e => distanceFt(caster.pos, e.pos) <= 30
  );

  for (const enemy of enemies) {
    applySpellEffect(enemy, {
      casterId: caster.id,
      spellName: 'Shadow of Moil',
      effectType: 'curse_rider',
      payload: {
        riderDie: 8,
        riderDieCount: 2,
        riderDamageType: 'necrotic',
        riderCasterId: caster.id,
      },
      sourceIsConcentration: true,
    });

    emit(
      state, 'condition_add', caster.id,
      `${enemy.name} is affected by Shadow of Moil's necrotic rider (2d8 necrotic on hit vs ${caster.name})`,
      enemy.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Shadow of Moil — called from resetBudget() at the start of
 * the caster's next turn. NO-OP in v1 because:
 *   - Shadow of Moil is a concentration spell; all effects are removed
 *     via removeEffectsFromCaster() when concentration breaks.
 *   - v1 does NOT enforce concentration checks (TG-002), so concentration
 *     effectively persists for the entire combat.
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
