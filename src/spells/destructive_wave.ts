// ============================================================
// Destructive Wave — PHB p.250 (Paladin spell)
//
// 5th-level evocation, action, range Self (30-ft radius),
// NO concentration.
// Components: V.
//
// Effect: You strike the ground, creating a burst of divine energy
//         that ripples outward from you. Each other creature within 30
//         feet of you must make a Constitution saving throw. On a failed
//         save, a creature takes 5d6 thunder damage plus 5d6 radiant or
//         necrotic damage (your choice), and is knocked prone. On a
//         successful save, the creature takes half as much damage and
//         isn't knocked prone.
//
//         NOTE: PHB p.250 has TWO damage components: 5d6 thunder +
//         5d6 (radiant OR necrotic, caster's choice). The plan spec
//         paraphrases this as "5d6 thunder/necrotic" — v1 follows the
//         plan's simplification (5d6 thunder only; the radiant/necrotic
//         choice + second 5d6 is dropped). See simplifications.
//
// Upcast: none (PHB p.250: 5th-level only).
//
// v1 simplifications:
//   - Damage: canon 5d6 thunder + 5d6 (radiant OR necrotic). v1 follows
//     the plan's simplified spec (5d6 thunder only). The radiant/necrotic
//     choice + second 5d6 is NOT modelled. Documented via
//     `destructiveWaveThunderOnlyV1PerPlan: true`.
//   - AoE shape: canon 30-ft radius sphere centred on the CASTER (PHB p.250:
//     "Self (30-foot radius)"). v1 collects ALL living enemies within 30 ft
//     of the caster (chebyshev3D approx). The caster is EXCLUDED (PHB p.250:
//     "Each other creature"). Mirrors Earth Tremor (Session 24).
//   - Prone on failed save: v1 applies prone via condition_apply (mirror
//     Earth Tremor). Persists for v1 combat (no stand-up hook for NPCs).
//   - Targets enemies only (PHB p.250: "each other creature" — but the
//     Paladin's divine energy is hostile; v1 targets enemies only, NOT
//     allies, per the plan's "targets only enemies" note).
//   - NOT concentration (PHB p.250: instantaneous).
//
// Migration note (Session 24): Mirrors Earth Tremor (Session 24) for the
// self-centred AoE + prone, but with 5d6 thunder (L5), 30-ft radius
// (larger), and NO concentration (Earth Tremor is also no-concentration).
//
// Spell module pattern (self-centred AoE save + condition — mirrors
// earth_tremor.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (instantaneous; prone persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect, filterGoIProtectedTargets } from '../engine/spell_effects';

export const metadata = {
  name: 'Destructive Wave',
  level: 5,
  school: 'evocation',
  rangeFt: 0,                    // PHB p.250: Self (30-ft radius)
  aoeRadiusFt: 30,               // PHB p.250: 30-ft radius
  dieCount: 5,
  dieSides: 6,
  damageType: 'thunder' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  destructiveWaveThunderOnlyV1PerPlan: true,                          // canon 5d6 thunder + 5d6 (radiant/necrotic); v1 follows plan (5d6 thunder only)
  destructiveWaveProneDurationV1Simplified: true,                    // prone persists for combat (no stand-up hook)
  destructiveWaveEnemiesOnlyV1: true,                                 // targets enemies only (not allies)
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
  if (!caster.actions.some(a => a.name === 'Destructive Wave')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt <= 30) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Destructive Wave');
  const saveDC = action?.saveDC ?? 15;

  const slotLevel = consumeSpellSlot(caster, 5) ?? 5;

  // Session 79 (GoI AoE exclusion): exclude targets protected by Globe of
  // Invulnerability. PHB p.245: "the spell has no effect on them." The spell
  // still fires (slot already consumed above); protected targets are simply
  // skipped in the damage loop (and thus also skip the prone rider).
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id, state.battlefield);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Destructive Wave! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius self-centred AoE + prone on fail) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
  );

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
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Destructive Wave (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + PRONE'}`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Destructive Wave: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);

    if (!save.success && !target.conditions.has('prone')) {
      applySpellEffect(target, {
        casterId: caster.id,
        spellName: 'Destructive Wave',
        effectType: 'condition_apply',
        payload: { condition: 'prone' },
        sourceIsConcentration: false,
      });
      emit(state, 'condition_add', caster.id, `${target.name} is KNOCKED PRONE by the divine wave!`, target.id);
    }
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; prone persists for v1 combat.
}
