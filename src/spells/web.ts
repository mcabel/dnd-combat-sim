// ============================================================
// Web — PHB p.287
//
// 2nd-level conjuration, action, range 60 ft, concentration (1 min).
// Components: V, S, M (a bit of spiderweb).
//
// Effect: You conjure a mass of thick, sticky webbing at a point of your
//         choice within range. The webs fill a 20-foot cube from that
//         point for the duration. The webs are difficult terrain and
//         lightly obscure their area.
//
//         If the webs aren't anchored between two solid masses (such as
//         walls or trees) or layered across a solid surface (such as the
//         ground or floor), the conjured web collapses on itself, and
//         the spell ends at the start of your next turn. Webs layered
//         over a flat surface have a depth of 5 feet.
//
//         Each creature that starts its turn in the webs or that enters
//         them during its turn must make a Dexterity saving throw. On a
//         failed save, the creature is restrained as long as it remains
//         in the webs or until it breaks free.
//
//         A creature restrained by the webs can use its action to make a
//         Strength check against your spell save DC. If it succeeds, it
//         is freed from the restraining mass.
//
//         The webs are flammable. Any 5-foot cube of webs exposed to
//         fire burns away in 1 round, dealing 2d4 fire damage to any
//         creature that starts its turn in the fire.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - Duration: canon 1 min concentration → v1: concentration is started
//     via startConcentration(), but the engine does NOT yet enforce
//     concentration checks on damage taken (forward-compat TODO; see
//     TG-002 in TEAMGOALS.md). The restrained condition persists until
//     removeEffectsFromCaster() is called.
//   - AoE / cube shape: canon Web fills a 20-ft cube. v1 simplification:
//     Web targets ONE creature (the highest-threat enemy within 60 ft —
//     mirror Levitate / Hold Person pattern). The cube/difficult-terrain
//     geometry is NOT modelled. Forward-compat TODO via the metadata flag
//     `webDifficultTerrainV1Implemented: false`.
//   - End-of-turn DEX save: canon says "Each creature that starts its
//     turn in the webs or that enters them during its turn must make a
//     Dexterity saving throw." v1 rolls the save ONCE at cast time and
//     applies restrained for the entire combat (or until concentration
//     breaks). Forward-compat TODO via the metadata flag
//     `webEscapeActionV1Implemented: false` (the STR-check escape is
//     also NOT modelled).
//   - Fire destruction: canon "The webs are flammable... burns away in
//     1 round, dealing 2d4 fire damage." v1 does NOT model this
//     (no fire-spread subsystem). Forward-compat TODO via the metadata
//     flag `webDestructionV1Implemented: false`.
//   - Upcast: — (no At Higher Levels entry). v1 always targets a single
//     creature. Forward-compat TODO via `webUpcastV1Implemented: false`.
//   - Concentration enforcement: v1 does NOT enforce concentration
//     checks (TG-002). The restrained condition persists for the entire
//     combat (or until concentration breaks).
//
// Spell module pattern (mirrors levitate.ts — DEX save-or-restrained):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   metadata → spell stats
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster, applyTerrainDifficulty } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Web',
  level: 2,
  school: 'conjuration',
  rangeFt: 60,
  concentration: true,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  webDifficultTerrainV1Implemented: true,              // PHB p.287: webs are difficult terrain
  webDestructionV1Implemented: false,                  // fire destruction NOT modelled
  webEscapeActionV1Implemented: false,                 // STR-check escape + end-of-turn DEX save NOT modelled
  webUpcastV1Implemented: false,                       // no At Higher Levels entry — single target only
  webConcentrationEnforcementV1Implemented: true,     // TG-002 DONE (Session 34)
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
 * Returns the single best target for Web (a living enemy within 60 ft, not
 * already restrained or Web'd by this caster), or null when the spell should
 * not be cast.
 *
 * Target priority: highest-threat enemy (maxHP) within 60 ft — restraining the
 * biggest attacker removes their movement and grants advantage to melee allies.
 *
 * Preconditions:
 *   - Caster has 'Web' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Web IS concentration — it cannot be cast while concentrating on
 * another spell. The planner gates on concentration via shouldCast.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Web')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    // Skip if already restrained/incapacitated (no stacking).
    if (c.conditions.has('restrained') || c.conditions.has('incapacitated')) continue;

    // Skip if already Web'd by this caster (re-cast would only refresh the
    // duration — wasteful in v1 since the end-of-turn save isn't modelled).
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Web'
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
 * Execute Web:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Web.
 *  4. Roll the target's DEX save vs the caster's saveDC.
 *  5. On fail: apply condition_apply:restrained effect on the target.
 *     - The effect has sourceIsConcentration: true (removed when the
 *       caster's concentration breaks).
 *  6. On success: log the save, no effect applied.
 *
 * v1 simplifications: cube/difficult-terrain NOT modelled (single target);
 * end-of-turn DEX save + STR-check escape NOT modelled; fire destruction NOT
 * modelled; concentration NOT enforced (TG-002). The restrained condition
 * persists for the entire combat (or until concentration breaks).
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Web');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Web');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Web at ${target.name}! (DC ${saveDC} DEX)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  // Apply terrain_zone effect on the CASTER for difficult terrain.
  // PHB p.287: "The webs are difficult terrain and lightly obscure their area."
  // The terrain zone also carries the DEX save → restrained mechanic for
  // start-of-turn terrain checks (creatures starting their turn in the webs
  // must save or become restrained).
  const terrainEffect = applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Web',
    effectType: 'terrain_zone',
    payload: {
      terrainSaveAbility: 'dex' as const,
      terrainCondition: 'restrained' as Condition,
      terrainRadiusFt: 20,
      terrainCenterX: target.pos.x,
      terrainCenterY: target.pos.y,
      terrainCenterZ: target.pos.z,
      terrainDifficulty: true,
    },
    sourceIsConcentration: true,
  });
  applyTerrainDifficulty(state.battlefield, terrainEffect);

  const save = rollSave(target, 'dex', saveDC);
  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Web (rolled ${save.total})`,
    target.id, save.roll,
  );

  if (save.success) {
    emit(
      state, 'action', caster.id,
      `${target.name} dodges the webs — not restrained!`,
      target.id,
    );
    return;
  }

  // Apply restrained condition (PHB p.292: speed 0, attack rolls vs target
  // have advantage, target has disadvantage on attacks and DEX saves).
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Web',
    effectType: 'condition_apply',
    payload: { condition: 'restrained' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is caught in the WEB! (restrained — speed 0, attacks vs them have advantage, they have disadv on attacks/Dex saves)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
