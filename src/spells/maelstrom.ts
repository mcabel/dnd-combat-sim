// ============================================================
// Maelstrom — XGE p.160 (also EGtW p.161)
//
// 5th-level evocation, action, range 120 ft. Canon: concentration, up
// to 1 minute. v1: concentration simplified to one-shot.
// Components: V, S, M (a paper or leaf in the shape of a funnel).
//
// Effect: A mass of 5-foot-deep water appears in a 20-foot-radius
//         circle centered on a point you can see within range. The area
//         is difficult terrain. Each creature in the area must make a
//         Strength saving throw. On a failed save, a creature takes 6d6
//         bludgeoning damage and is pulled 10 feet toward the center. On
//         a successful save, the creature takes half as much damage and
//         isn't pulled.
//
//         NOTE: XGE p.160 actually has no "restrained" — it has "pulled
//         10 ft toward center". The plan spec says "restrained on fail"
//         — v1 follows the plan's interpretation (restrained is a more
//         v1-implementable effect than forced movement). See simplifications.
//
// Upcast: +1d6 bludgeoning per slot level above 5th (not modelled in v1).
//
// v1 simplifications:
//   - Concentration (XGE p.160: "concentration, up to 1 minute"): v1
//     simplifies to one-shot (concentration: false). The persistent
//     whirlpool + difficult terrain + per-turn re-save are NOT modelled.
//     One-shot 6d6 bludgeoning + restrained on fail. Documented via
//     `maelstromConcentrationV1Simplified: true`.
//   - Pull 10 ft toward center (XGE p.160): NOT modelled — v1 has no
//     forced-movement subsystem. v1 follows the plan spec (restrained on
//     fail instead of pull). Documented via `maelstromPullToRestrainedV1PerPlan: true`.
//   - Difficult terrain + water effect: NOT modelled.
//   - AoE shape: 20-ft radius circle at a point within 120 ft. v1 targets
//     the highest-threat enemy within 120 ft as the centre and applies
//     to ALL enemies within 20 ft (chebyshev3D approx).
//   - Save ability: DEX (per plan spec — XGE p.160 canon is actually STR;
//     v1 follows the plan's DEX). Documented via `maelstromDexSaveV1PerPlan: true`.
//   - Upcast: NOT modelled.
//
// Migration note (Session 24): Mirrors Sunburst (Session 23) for the AoE
// save + condition_apply, but with restrained (vs blinded), 6d6
// bludgeoning (vs 12d6 radiant), 20-ft radius (vs 60-ft), L5 slot, 120-ft
// range.
//
// Spell module pattern (AoE save + condition — mirrors sunburst.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (v1 one-shot)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect } from '../engine/spell_effects';

export const metadata = {
  name: 'Maelstrom',
  level: 5,
  school: 'evocation',
  rangeFt: 120,                  // XGE p.160: 120 ft
  aoeRadiusFt: 20,               // XGE p.160: 20-ft radius
  dieCount: 6,
  dieSides: 6,
  damageType: 'bludgeoning' as const,
  concentration: false,          // v1 simplification: one-shot (canon concentration 1 min)
  saveAbility: 'dex' as const,   // v1 follows plan (canon is STR)
  castingTime: 'action',
  maelstromConcentrationV1Simplified: true,                           // canon concentration simplified to one-shot
  maelstromPullToRestrainedV1PerPlan: true,                           // canon pull-10ft → v1 restrained (per plan)
  maelstromDexSaveV1PerPlan: true,                                    // v1 uses DEX (canon is STR)
  maelstromUpcastV1Implemented: false,                                 // +1d6/slot-level NOT modelled
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
  if (!caster.actions.some(a => a.name === 'Maelstrom')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

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
    if (distFt <= 20) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Maelstrom');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 5);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Maelstrom! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE + restrained on fail) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSave(target, 'dex', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Maelstrom (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + RESTRAINED'}`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Maelstrom: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);

    if (!save.success && !target.conditions.has('restrained')) {
      applySpellEffect(target, {
        casterId: caster.id,
        spellName: 'Maelstrom',
        effectType: 'condition_apply',
        payload: { condition: 'restrained' },
        sourceIsConcentration: false,
      });
      emit(state, 'condition_add', caster.id, `${target.name} is caught in the MAELSTROM and restrained! (speed 0, attacks vs them have advantage, their attacks have disadvantage)`, target.id);
    }
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot.
}
