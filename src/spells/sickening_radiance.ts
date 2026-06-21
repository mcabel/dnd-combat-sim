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
//   - Exhaustion (XGE p.164: "one level of exhaustion"): v1 has NO
//     exhaustion subsystem (6 levels is too complex for v1). v1 applies
//     the POISONED condition as a conservative simplification
//     (poisoned ≈ "sickened" — disadvantage on attacks/ability checks,
//     a reasonable mechanical proxy). Documented via
//     `sickeningRadianceExhaustionToPoisonedV1: true`.
//   - AoE shape: canon 30-ft radius sphere at a point within 120 ft.
//     v1 targets the highest-threat enemy within 120 ft as the sphere's
//     centre and applies to ALL enemies within 30 ft (chebyshev3D approx).
//     30-ft radius is larger than Shatter's 10-ft — bigger AoE.
//   - Upcast: NOT modelled.
//
// Migration note (Session 24): Mirrors Sunburst (Session 23) for the
// AoE save + condition_apply, but with poisoned (exhaustion simplified)
// instead of blinded, 4d10 radiant instead of 12d6, 30-ft radius
// instead of 60-ft, L4 slot.
//
// Spell module pattern (AoE save + condition — mirrors sunburst.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP, startConcentration } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';

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
  sickeningRadianceExhaustionToPoisonedV1: true,                     // exhaustion simplified to poisoned
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

  consumeSpellSlot(caster, 4);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Sickening Radiance');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Sickening Radiance! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE + poisoned [exhaustion simplified] on fail, concentration) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  // Find the center (highest-threat enemy) for the terrain zone position
  const center = targets.reduce<Combatant | null>((best, t) => {
    if (t.isDead || t.isUnconscious) return best;
    if (!best || t.maxHP > best.maxHP) return t;
    return best;
  }, null);

  // Apply terrain_zone effect on the CASTER (concentration)
  // This marks a persistent 30-ft radius zone at the center position
  if (center) {
    applySpellEffect(caster, {
      casterId: caster.id,
      spellName: 'Sickening Radiance',
      effectType: 'terrain_zone',
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

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSave(target, 'con', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Sickening Radiance (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + POISONED (exhaustion simplified)'}`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Sickening Radiance: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);

    // On failed save: apply poisoned (exhaustion simplified to poisoned).
    if (!save.success && !target.conditions.has('poisoned')) {
      applySpellEffect(target, {
        casterId: caster.id,
        spellName: 'Sickening Radiance',
        effectType: 'condition_apply',
        payload: { condition: 'poisoned' },
        sourceIsConcentration: true,    // v2: concentration-sourced
      });
      emit(
        state, 'condition_add', caster.id,
        `${target.name} is SICKENED (poisoned, v1 simplification of exhaustion) by the radiance! (disadvantage on attacks and ability checks)`,
        target.id,
      );
    }
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup.
}
