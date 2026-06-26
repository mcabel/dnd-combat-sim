// ============================================================
// Sickening Radiance — XGE p.164
//
// 4th-level evocation, action, range 120 ft. Canon: concentration,
// up to 10 minutes. v1: concentration simplified to one-shot.
// Components: V, S.
//
// Effect: Dim, greenish light spreads from a point you choose within
//         range to fill a 30-foot-radius sphere for the duration. Each
//         creature in that area must make a Constitution saving throw.
//         On a failed save, a creature takes 4d10 radiant damage and
//         gains one level of exhaustion. On a successful save, a creature
//         takes half as much damage and suffers no exhaustion.
//
// Upcast: +1d10 radiant per slot level above 4th (not modelled in v1).
//
// v1 simplifications:
//   - Concentration (XGE p.164: "concentration, up to 10 minutes"): v1
//     simplifies to one-shot (concentration: false). The persistent
//     damage_zone + per-turn re-save riders are NOT modelled. One-shot
//     4d10 radiant + poisoned on fail. Documented via
//     `sickeningRadianceConcentrationV1Simplified: true`.
//   - Exhaustion (XGE p.164: "one level of exhaustion"): NOW IMPLEMENTED
//     using the exhaustion subsystem (PHB p.291). The `poisoned`
//     simplification has been replaced with proper exhaustion_level
//     increments. Documented via `sickeningRadianceExhaustionImplemented: true`.
//   - AoE shape: canon 30-ft radius sphere at a point within 120 ft.
//     v1 targets the highest-threat enemy within 120 ft as the sphere's
//     centre and applies to ALL enemies within 30 ft (chebyshev3D approx).
//     30-ft radius is larger than Shatter's 10-ft — bigger AoE.
//   - Upcast: NOT modelled.
//
// Migration note (Session 24→28): Mirrors Sunburst (Session 23) for the
// AoE save + condition_apply, but now uses exhaustion_level (PHB p.291)
// instead of the poisoned simplification. The terrain_zone still applies
// poisoned as a secondary effect for creatures starting their turn in the
// zone, but the primary on-cast effect is now exhaustion.
//
// Spell module pattern (AoE save + exhaustion — mirrors sunburst.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP, startConcentration } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect, removeEffectsFromCaster, filterGoIProtectedTargets, isProtectedByGoI } from '../engine/spell_effects';

export const metadata = {
  name: 'Sickening Radiance',
  level: 4,
  school: 'evocation',
  rangeFt: 120,                  // XGE p.164: 120 ft
  aoeRadiusFt: 30,               // XGE p.164: 30-ft radius sphere
  dieCount: 4,
  dieSides: 10,
  damageType: 'radiant' as const,
  concentration: true,           // v2: persistent terrain zone (canon concentration 10 min)
  saveAbility: 'con' as const,
  castingTime: 'action',
  sickeningRadiancePersistentV2Implemented: true,                    // v2: terrain_zone + concentration (was v1 one-shot)
  sickeningRadianceExhaustionImplemented: true,                      // exhaustion subsystem (PHB p.291)
  sickeningRadianceUpcastV1Implemented: false,                       // +1d10/slot-level NOT modelled
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Sickening Radiance')) return null;
  if (!hasSpellSlot(caster, 4)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 120) continue;
    if (e.maxHP > centerThreat || (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e;
      centerThreat = e.maxHP;
      centerDist = distFt;
    }
  }
  if (!center) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 30) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Sickening Radiance');
  const saveDC = action?.saveDC ?? 15;

  const slotLevel = consumeSpellSlot(caster, 4) ?? 4;
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Sickening Radiance');

  // Session 79 (GoI AoE exclusion follow-up): PHB p.245: "the spell has no
  // effect on them." This applies to ALL spell effects, not just damage —
  // Sickening Radiance's on-cast radiant damage + exhaustion are also blocked.
  // The spell still fires (slot already consumed above); protected targets
  // are simply skipped in the on-cast loop. The persistent terrain_zone on
  // the caster is still applied (so it can tick later if GoI expires); the
  // combat.ts terrain_zone tick loop re-checks GoI on each per-turn tick
  // using the zone's sourceSlotLevel.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Sickening Radiance! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE + exhaustion on fail, concentration) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
  );

  // Find the center (highest-threat enemy) for the terrain zone position
  const center = targets.reduce<Combatant | null>((best, t) => {
    if (t.isDead || t.isUnconscious) return best;
    if (!best || t.maxHP > best.maxHP) return t;
    return best;
  }, null);

  // Apply terrain_zone effect on the CASTER (concentration)
  // This marks a persistent 30-ft radius zone at the center position.
  // Creatures starting their turn in the zone get poisoned (secondary effect)
  // AND gain 1 level of exhaustion (XGE p.164 canon).
  //
  // Session 79: sourceSlotLevel is set so the terrain_zone tick in combat.ts
  // can re-check GoI protection on each per-turn tick.
  if (center) {
    applySpellEffect(caster, {
      casterId: caster.id,
      spellName: 'Sickening Radiance',
      effectType: 'terrain_zone',
      sourceSlotLevel: slotLevel,
      payload: {
        terrainSaveAbility: 'con' as const,
        terrainCondition: 'poisoned' as Condition,
        terrainRadiusFt: 30,
        terrainCenterX: center.pos.x,
        terrainCenterY: center.pos.y,
        terrainCenterZ: center.pos.z,
      },
      sourceIsConcentration: true,
    });
  }

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'con', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Sickening Radiance (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + EXHAUSTION (+1 level)'}`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Sickening Radiance: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);

    // On failed save: apply exhaustion_level (+1 level) per XGE p.164.
    // Exhaustion is the canon effect (replaces previous poisoned simplification).
    if (!save.success) {
      const prevLevel = target.exhaustionLevel;
      applySpellEffect(target, {
        casterId: caster.id,
        spellName: 'Sickening Radiance',
        effectType: 'exhaustion_level',
        payload: { exhaustionLevels: 1 },
        sourceIsConcentration: true,    // v2: concentration-sourced
      });
      emit(
        state, 'condition_add', caster.id,
        `${target.name} gains 1 level of EXHAUSTION from Sickening Radiance! (level ${prevLevel} → ${target.exhaustionLevel})`,
        target.id,
      );
    }
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup.
}
