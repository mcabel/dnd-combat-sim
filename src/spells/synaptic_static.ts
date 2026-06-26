// ============================================================
// Synaptic Static — XGE p.167
//
// 5th-level evocation, action, range 120 ft, NO concentration.
// Components: V, S, M (a bit of brimstone).
//
// Effect: You choose a point within range and cause psychic energy to
//         explode. Each creature in a 20-foot-radius sphere centered on
//         that point must make an Intelligence saving throw. On a failed
//         save, a creature takes 8d6 psychic damage and is unable to
//         think clearly. On a successful save, a creature takes half as
//         much damage.
//
//         NOTE: XGE p.167's "unable to think clearly" rider is a -1d6 to
//         attack rolls and ability checks. v1 simplifies this to the
//         `incapacitated` condition (no existing -1d6 debuff effect type).
//         See simplifications.
//
// Upcast: +1d6 psychic per slot level above 5th (not modelled in v1).
//
// v1 simplifications:
//   - -1d6 to attacks/ability checks rider (XGE p.167): v1 has no -1d6
//     debuff effect type. v1 simplifies to the `incapacitated` condition
//     (can't take actions — a stronger but v1-implementable proxy). This
//     is a conservative simplification (incapacitated is more severe than
//     -1d6). Documented via `synapticStaticMinus1d6ToIncapacitatedV1: true`.
//   - AoE shape: 20-ft radius sphere at a point within 120 ft. v1 targets
//     the highest-threat enemy within 120 ft as the sphere's centre and
//     applies to ALL enemies within 20 ft (chebyshev3D approx).
//   - Save ability: INT (XGE p.167).
//   - Upcast: NOT modelled.
//   - NOT concentration (XGE p.167: instantaneous).
//
// Migration note (Session 24): Mirrors Sunburst (Session 23) for the AoE
// save + condition_apply, but with incapacitated (vs blinded), 8d6
// psychic (vs 12d6 radiant), 20-ft radius (vs 60-ft), L5 slot, 120-ft
// range, INT save (vs CON).
//
// Spell module pattern (AoE save + condition — mirrors sunburst.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (instantaneous; incapacitated persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect, filterGoIProtectedTargets } from '../engine/spell_effects';

export const metadata = {
  name: 'Synaptic Static',
  level: 5,
  school: 'evocation',
  rangeFt: 120,                  // XGE p.167: 120 ft
  aoeRadiusFt: 20,               // XGE p.167: 20-ft radius
  dieCount: 8,
  dieSides: 6,
  damageType: 'psychic' as const,
  concentration: false,
  saveAbility: 'int' as const,
  castingTime: 'action',
  synapticStaticMinus1d6ToIncapacitatedV1: true,                      // -1d6 rider simplified to incapacitated
  synapticStaticUpcastV1Implemented: false,                            // +1d6/slot-level NOT modelled
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
  if (!caster.actions.some(a => a.name === 'Synaptic Static')) return null;
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
  const action = caster.actions.find(a => a.name === 'Synaptic Static');
  const saveDC = action?.saveDC ?? 15;

  const slotLevel = consumeSpellSlot(caster, 5) ?? 5;

  // Session 79 (GoI AoE exclusion): exclude targets protected by Globe of
  // Invulnerability. PHB p.245: "the spell has no effect on them." The spell
  // still fires (slot already consumed above); protected targets are simply
  // skipped in the damage loop (and thus also skip the incapacitated rider).
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Synaptic Static! (DC ${saveDC} INT, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE + incapacitated on fail [-1d6 simplified]) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
  );

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'int', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} INT save vs Synaptic Static (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + INCAPACITATED (-1d6 simplified)'}`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Synaptic Static: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);

    if (!save.success && !target.conditions.has('incapacitated')) {
      applySpellEffect(target, {
        casterId: caster.id,
        spellName: 'Synaptic Static',
        effectType: 'condition_apply',
        payload: { condition: 'incapacitated' },
        sourceIsConcentration: false,
      });
      emit(state, 'condition_add', caster.id, `${target.name} is INCAPACITATED by the psychic static! (can't take actions — v1 simplification of the -1d6 rider)`, target.id);
    }
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; incapacitated persists for v1 combat.
}
