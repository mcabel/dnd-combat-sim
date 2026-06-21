// ============================================================
// Entangle — PHB p.238
//
// 1st-level conjuration, concentration (up to 1 min)
// Range: 90 ft   AoE: 20-ft square
// Effect: STR save or restrained for duration.
//         Restrained creatures: speed 0, disadvantage on attack rolls,
//         attacks vs them have advantage.
//         Removed when concentration breaks.
//
// Simplifications:
//   - AoE: targets ALL living enemies within 90 ft (not just those in
//     a specific 20-ft square). True square targeting deferred until a
//     positional AoE system exists.
//   - Break-free: restrained creatures do NOT attempt to break free with
//     their action (STR check vs DC). They remain restrained until
//     concentration ends. This can be added as an AI improvement later.
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster, applyTerrainDifficulty } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Entangle',
  level: 1,
  school: 'conjuration',
  rangeFt: 90,
  aoeSizeFt: 20,       // 20-ft square
  concentration: true,
  saveAbility: 'str' as const,
  castingTime: 'action',
  entangleDifficultTerrainV1Implemented: true,  // PHB p.238: area becomes difficult terrain
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
 * Returns candidate targets for Entangle (living enemies within 90 ft, not already
 * restrained by this caster's Entangle), or null when the spell should not be cast.
 *
 * Preconditions:
 *   - Caster has 'Entangle' in their actions (parsed from prepared spells)
 *   - Caster has at least one 1st-level slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 90 ft
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  // Never interrupt active concentration
  if (caster.concentration?.active) return null;

  // Must have the spell and a free slot
  if (!caster.actions.some(a => a.name === 'Entangle')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const targets: Combatant[] = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 90) continue;

    // Skip if already restrained by this caster's Entangle
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Entangle')) {
      continue;
    }
    targets.push(c);
  }

  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Entangle:
 *  1. Consume a 1st-level spell slot.
 *  2. Break any existing concentration (safety net — planner prevents this normally).
 *  3. Start concentration on Entangle.
 *  4. For each target: roll STR save vs caster's saveDC.
 *     - Fail → apply condition_apply:restrained via ActiveEffect (auto-cleans on break).
 *     - Success → no effect (but the grasping weeds remain in the zone).
 *
 * @param caster  The casting Combatant (Druid)
 * @param targets Candidates from shouldCast (living enemies in range)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Entangle');
  const saveDC = action?.saveDC ?? 13;
  const bf = state.battlefield;

  consumeSpellSlot(caster, 1);

  // Safety: clean up stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, bf);
  }
  startConcentration(caster, 'Entangle');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Entangle (DC ${saveDC} STR) targeting ${targets.length} creature${targets.length !== 1 ? 's' : ''}!`,
  );

  // Apply terrain_zone effect on the CASTER for difficult terrain.
  // PHB p.238: "grasping plants sprout... area becomes difficult terrain."
  // Center on the first target's position (zone center approximation).
  // The terrain zone also carries the STR save → restrained mechanic for
  // start-of-turn terrain checks.
  const zoneCenter = targets.find(t => !t.isDead && !t.isUnconscious);
  if (zoneCenter) {
    const terrainEffect = applySpellEffect(caster, {
      casterId: caster.id,
      spellName: 'Entangle',
      effectType: 'terrain_zone',
      payload: {
        terrainSaveAbility: 'str' as const,
        terrainCondition: 'restrained' as Condition,
        terrainRadiusFt: 20,
        terrainCenterX: zoneCenter.pos.x,
        terrainCenterY: zoneCenter.pos.y,
        terrainCenterZ: zoneCenter.pos.z,
        terrainDifficulty: true,
      },
      sourceIsConcentration: true,
    });
    applyTerrainDifficulty(bf, terrainEffect);
  }

  let restrained = 0;
  for (const target of targets) {
    // Re-check liveness (stale edge case)
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSave(target, 'str', saveDC);
    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} STR save vs Entangle (rolled ${save.total})`,
      target.id,
      save.roll,
    );

    if (!save.success) {
      applySpellEffect(target, {
        casterId: caster.id,
        spellName: 'Entangle',
        effectType: 'condition_apply',
        payload: { condition: 'restrained' },
        sourceIsConcentration: true,
      });
      emit(
        state, 'condition_add', caster.id,
        `${target.name} is restrained by Entangle — speed 0, disadvantage on attacks, attacks against them have advantage!`,
        target.id,
      );
      restrained++;
    }
  }

  if (restrained === 0) {
    emit(
      state, 'action', caster.id,
      `${caster.name}'s Entangle: all targets saved — none restrained.`,
    );
  }
}
