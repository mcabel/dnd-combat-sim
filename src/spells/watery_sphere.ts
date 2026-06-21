// ============================================================
// Watery Sphere — XGE p.170
//
// 4th-level conjuration, action, range 90 ft, concentration (1 min).
// Components: V, S, M (a droplet of water).
//
// Effect: You conjure up a sphere of water with a 5-foot radius on a
//         point you can see within range. The sphere can hover in the
//         air... Any creature in the sphere's space must make a Strength
//         save. On a successful save, the creature is ejected from the
//         sphere to the nearest unoccupied space. A Huge or larger
//         creature succeeds on the save automatically. On a failed save,
//         the creature is restrained by the sphere.
//
// Upcast: none (4th-level spell — no upcast).
//
// v1 simplifications:
//   - Shape: canon 5-ft-radius sphere centered on a point within 90 ft.
//     v1 centers the sphere on the highest-threat enemy within 90 ft
//     (mirrors Sunburst) and collects all enemies within 5 ft (chebyshev).
//   - Movement rider (PHB p.170: the sphere moves 30 ft/turn, carrying
//     restrained creatures): NOT modelled. v1 applies restrained only.
//   - Persistent terrain: v2 implements start-of-turn terrain zone check.
//     Canon says creatures in the sphere's space must save each turn;
//     v2 checks at start of turn (documented via
//     `waterySpherePersistentTerrainV2StartOfTurnOnly`). On-enter check
//     requires deeper movement system integration (v3).
//   - Size-based auto-success (Huge+): NOT enforced (no creature-size tag).
//   - Concentration: canon 1 min. v1 starts concentration; not enforced
//     on damage (TG-002). restrained is sourceIsConcentration: true.
//   - Eject-on-save (canon: success ejects to nearest space): v1 simply
//     applies no condition on success (position unchanged).
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke STR-save-or-restrained AoE (conc).
// Removed from `_generic_registry.ts`; routed via `case 'waterySphere':`
// in combat.ts and a planner branch in planner.ts. Mirrors Sunburst
// (radius AoE save + condition) + Hold Person (concentration), tiny radius.
//
// Spell module pattern (radius AoE save + condition, concentration):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Watery Sphere',
  level: 4,
  school: 'conjuration',
  rangeFt: 90,                   // XGE p.170: 90 ft
  aoeRadiusFt: 5,                // XGE p.170: 5-ft radius sphere
  concentration: true,
  saveAbility: 'str' as const,
  castingTime: 'action',
  waterySphereMovementRiderV1Simplified: true,              // moving-sphere NOT modelled
  waterySphereSizeAutoSuccessV1Simplified: true,            // Huge+ auto-success NOT enforced
  waterySpherePersistentTerrainV2StartOfTurnOnly: true,     // start-of-turn check; on-enter deferred to v3
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
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

// ---- Planner ------------------------------------------------

/**
 * Returns the list of enemies caught in a Watery Sphere 5-ft-radius sphere
 * centered on the highest-threat enemy within 90 ft, or null when the
 * spell should not be cast. (The tiny radius usually catches 1-2 enemies.)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Watery Sphere')) return null;
  if (!hasSpellSlot(caster, 4)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 90) continue;
    if (e.maxHP > centerThreat || (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e; centerThreat = e.maxHP; centerDist = distFt;
    }
  }
  if (!center) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 5) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Watery Sphere');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 4);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Watery Sphere');

  emit(state, 'action', caster.id,
    `${caster.name} casts Watery Sphere! (DC ${saveDC} STR, restrained on fail, ${metadata.aoeRadiusFt}-ft radius) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`);

  // Find the center (highest-threat enemy) for the terrain zone position
  const center = targets.reduce<Combatant | null>((best, t) => {
    if (t.isDead || t.isUnconscious) return best;
    if (!best || t.maxHP > best.maxHP) return t;
    return best;
  }, null);

  // Apply terrain_zone effect on the CASTER (concentration)
  // This marks a persistent 5-ft radius zone at the center position
  if (center) {
    applySpellEffect(caster, {
      casterId: caster.id,
      spellName: 'Watery Sphere',
      effectType: 'terrain_zone',
      payload: {
        terrainSaveAbility: 'str' as const,
        terrainCondition: 'restrained' as Condition,
        terrainRadiusFt: 5,
        terrainCenterX: center.pos.x,
        terrainCenterY: center.pos.y,
        terrainCenterZ: center.pos.z,
      },
      sourceIsConcentration: true,
    });
  }

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;
    const save = rollSave(target, 'str', saveDC);
    emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} STR save vs Watery Sphere (rolled ${save.total})${save.success ? '' : ' + RESTRAINED'}`, target.id, save.roll);

    if (!save.success && !target.conditions.has('restrained')) {
      applySpellEffect(target, {
        casterId: caster.id, spellName: 'Watery Sphere',
        effectType: 'condition_apply', payload: { condition: 'restrained' },
        sourceIsConcentration: true,
      });
      emit(state, 'condition_add', caster.id,
        `${target.name} is RESTRAINED in the watery sphere! (speed 0, disadv on attacks/DEX)`, target.id);
    }
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
