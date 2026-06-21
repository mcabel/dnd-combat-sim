// ============================================================
// Sleet Storm — PHB p.276
//
// 3rd-level conjuration, action, range 120 ft, concentration (1 min).
// Components: V, S, M (dust and water).
//
// Effect: Until the spell ends, freezing rain and sleet fall in a
//         20-foot-tall cylinder centered on a point you choose within
//         range. The ground in the area is covered with slick ice. Each
//         creature in the area must make a Dexterity saving throw. On a
//         failed save, the creature falls prone. (Concentration-break
//         rider + difficult-terrain simplified away in v1.)
//
// Upcast: none (3rd-level spell — no upcast).
//
// v1 simplifications:
//   - Shape: canon 20-ft-radius cylinder. v1 centers on highest-threat
//     enemy within 120 ft (mirrors Sunburst); 20-ft radius (chebyshev).
//   - Concentration-break rider (PHB p.276: "creatures concentrating must
//     make a CON save or lose concentration"): simplified away. v1 applies
//     prone only. Documented via `sleetStormConcentrationBreakV1Simplified`.
//   - Difficult terrain (PHB p.276: "ground is difficult terrain"): NOT
//     modelled (v1 has no terrain subsystem). Documented via
//     `sleetStormDifficultTerrainV1Simplified`.
//   - Persistent terrain: v2 implements start-of-turn terrain zone check.
//     Canon says creatures entering the sleet also save immediately;
//     v2 only checks at start of turn (documented via
//     `sleetStormPersistentTerrainV2StartOfTurnOnly`). On-enter check
//     requires deeper movement system integration (v3).
//   - No damage (PHB p.276: no damage roll).
//   - Concentration: canon 1 min. v1 starts concentration; not enforced
//     on damage (TG-002). prone is conc-sourced.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke DEX-save-or-prone AoE (concentration).
// Removed from `_generic_registry.ts`; routed via `case 'sleetStorm':` in
// combat.ts and a planner branch in planner.ts. Mirrors Sunburst (radius
// AoE save + condition) but prone + concentration, no damage.
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
  name: 'Sleet Storm',
  level: 3,
  school: 'conjuration',
  rangeFt: 120,                  // PHB p.276: 120 ft
  aoeRadiusFt: 20,               // PHB p.276: 20-ft radius cylinder
  concentration: true,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  sleetStormConcentrationBreakV1Simplified: true,          // conc-break rider simplified away
  sleetStormDifficultTerrainV1Simplified: true,            // terrain NOT modelled
  sleetStormPersistentTerrainV2StartOfTurnOnly: true,     // start-of-turn check; on-enter deferred to v3
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

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Sleet Storm')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 120) continue;
    if (e.maxHP > centerThreat || (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e; centerThreat = e.maxHP; centerDist = distFt;
    }
  }
  if (!center) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 20) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Sleet Storm');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 3);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Sleet Storm');

  emit(state, 'action', caster.id,
    `${caster.name} casts Sleet Storm! (DC ${saveDC} DEX, prone on fail, ${metadata.aoeRadiusFt}-ft radius) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`);

  // Find the center (highest-threat enemy) for the terrain zone position
  const center = targets.reduce<Combatant | null>((best, t) => {
    if (t.isDead || t.isUnconscious) return best;
    if (!best || t.maxHP > best.maxHP) return t;
    return best;
  }, null);

  // Apply terrain_zone effect on the CASTER (concentration)
  // This marks a persistent 20-ft radius zone at the center position
  if (center) {
    applySpellEffect(caster, {
      casterId: caster.id,
      spellName: 'Sleet Storm',
      effectType: 'terrain_zone',
      payload: {
        terrainSaveAbility: 'dex' as const,
        terrainCondition: 'prone' as Condition,
        terrainRadiusFt: 20,
        terrainCenterX: center.pos.x,
        terrainCenterY: center.pos.y,
        terrainCenterZ: center.pos.z,
      },
      sourceIsConcentration: true,
    });
  }

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;
    const save = rollSave(target, 'dex', saveDC);
    emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Sleet Storm (rolled ${save.total})${save.success ? '' : ' + PRONE'}`, target.id, save.roll);

    if (!save.success && !target.conditions.has('prone')) {
      applySpellEffect(target, {
        casterId: caster.id, spellName: 'Sleet Storm',
        effectType: 'condition_apply', payload: { condition: 'prone' },
        sourceIsConcentration: true,
      });
      emit(state, 'condition_add', caster.id, `${target.name} is knocked PRONE by the sleet! (disadv on attacks, adv on melee attacks vs them)`, target.id);
    }
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
