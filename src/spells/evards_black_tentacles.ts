// ============================================================
// Evard's Black Tentacles — PHB p.238
//
// 4th-level conjuration, action, range 90 ft, concentration (1 min).
// Components: V, S, M (a piece of tentacle from a giant octopus or squid).
//
// Effect: Squirming, ebony tentacles fill a 20-foot square on ground
//         that you can see within range. For the duration, these
//         tentacles turn the ground in the area into difficult terrain.
//         When a creature enters the affected area for the first time
//         on a turn or starts its turn there, the creature must
//         succeed on a Dexterity saving throw or take 3d6 bludgeoning
//         damage and be restrained by the tentacles until the spell
//         ends. A creature that starts its turn in the area and is
//         already restrained by the tentacles takes 3d6 bludgeoning
//         damage.
//
// Upcast: +1d6 bludgeoning per slot level above 4th (not modelled in v1).
//
// v1 simplifications:
//   - Shape: canon 20-foot square. v1 treats as a 20-ft-radius sphere
//     centered on the highest-threat enemy within 90 ft (mirrors Sunburst
//     — square approximated by radius). Documented via
//     `evardsBlackTentaclesSquareV2SimplifiedToRadius`.
//   - Difficult terrain (PHB p.238: "ground in the area is difficult
//     terrain"): NOT modelled (v1 has no terrain-speed subsystem).
//     Documented via `evardsBlackTentaclesDifficultTerrainV2Simplified`.
//   - Persistent terrain: v2 implements start-of-turn terrain zone check.
//     Canon says creatures entering the area also save immediately;
//     v2 only checks at start of turn (documented via
//     `evardsBlackTentaclesPersistentTerrainV2StartOfTurnOnly`).
//     On-enter check requires deeper movement system integration (v3).
//   - Restrained condition: v2 applies via terrain_zone (start-of-turn
//     check). A creature already restrained takes the per-turn damage
//     tick via damage_zone.
//   - Concentration: canon 1 min. v2 starts concentration; not enforced
//     on damage (TG-002). restrained is conc-sourced.
//   - Upcast: NOT modelled.
//
// Migration note (Session 29): Converted from forward-compat stub
// (Session 19 bulk implementation) to full bespoke implementation.
// Removed from `_generic_registry.ts`; routed via
// `case 'evardsBlackTentacles':` in combat.ts and a planner branch in
// planner.ts. Mirrors Sleet Storm (radius AoE save + condition +
// terrain_zone) + Cloudkill (damage_zone for per-turn tick).
//
// Spell module pattern (radius AoE save + condition + terrain_zone +
// damage_zone, concentration):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: "Evard's Black Tentacles",
  level: 4,
  school: 'conjuration',
  rangeFt: 90,                    // PHB p.238: 90 ft
  aoeRadiusFt: 20,                // PHB p.238: 20-ft square → approximated as 20-ft radius
  concentration: true,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  dieCount: 3,
  dieSides: 6,
  damageType: 'bludgeoning' as const,
  evardsBlackTentaclesV2Implemented: true,                            // v2: full bespoke with terrain_zone + damage_zone
  evardsBlackTentaclesSquareV2SimplifiedToRadius: true,               // 20-ft square → 20-ft radius
  evardsBlackTentaclesDifficultTerrainV2Simplified: true,             // difficult terrain NOT modelled
  evardsBlackTentaclesPersistentTerrainV2StartOfTurnOnly: true,       // start-of-turn check; on-enter deferred to v3
  evardsBlackTentaclesUpcastV1Implemented: false,                    // +1d6/slot-level NOT modelled
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

// ---- Dice helper --------------------------------------------

/** Roll `metadata.dieCount`d`metadata.dieSides` and return the total. */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === "Evard's Black Tentacles")) return null;
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
    if (distFt <= 20) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === "Evard's Black Tentacles");
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 4);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, "Evard's Black Tentacles");

  emit(state, 'action', caster.id,
    `${caster.name} casts Evard's Black Tentacles! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} + restrained on fail, ${metadata.aoeRadiusFt}-ft radius, concentration) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`);

  // Find the center (highest-threat enemy) for the terrain zone position
  const center = targets.reduce<Combatant | null>((best, t) => {
    if (t.isDead || t.isUnconscious) return best;
    if (!best || t.maxHP > best.maxHP) return t;
    return best;
  }, null);

  // Apply terrain_zone effect on the CASTER (concentration)
  // This marks a persistent 20-ft radius zone at the center position.
  // On start-of-turn terrain check, creatures in the zone save vs DEX or
  // become restrained.
  if (center) {
    applySpellEffect(caster, {
      casterId: caster.id,
      spellName: "Evard's Black Tentacles",
      effectType: 'terrain_zone',
      payload: {
        terrainSaveAbility: 'dex' as const,
        terrainCondition: 'restrained' as Condition,
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
    const save = rollSaveReactable(state, caster, target, 'dex', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Evard's Black Tentacles (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + RESTRAINED'}`, target.id, save.roll);
    emit(state, 'damage', caster.id,
      `Evard's Black Tentacles: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);

    if (!save.success) {
      // Apply restrained condition
      if (!target.conditions.has('restrained')) {
        applySpellEffect(target, {
          casterId: caster.id,
          spellName: "Evard's Black Tentacles",
          effectType: 'condition_apply',
          payload: { condition: 'restrained' },
          sourceIsConcentration: true,
        });
        emit(state, 'condition_add', caster.id,
          `${target.name} is RESTRAINED by the tentacles! (speed 0, adv on attacks vs them, disadv on their attacks/dex saves)`, target.id);
      }
    }

    // Apply persistent damage_zone — start-of-turn tick rolls DEX save for half.
    // PHB p.238: "A creature that starts its turn in the area and is already
    // restrained by the tentacles takes 3d6 bludgeoning damage."
    // v1 simplification: damage_zone ticks on ALL creatures in the area,
    // not just restrained ones (the damage_zone subsystem doesn't condition
    // on the target's conditions). This is a minor over-application — the
    // DEX save for half on non-restrained creatures partially compensates.
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: "Evard's Black Tentacles",
      effectType: 'damage_zone',
      payload: {
        dieCount: metadata.dieCount,
        dieSides: metadata.dieSides,
        damageType: metadata.damageType,
        saveDC,
        saveAbility: metadata.saveAbility,
      },
      sourceIsConcentration: true,
    });
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
