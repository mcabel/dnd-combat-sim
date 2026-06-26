// ============================================================
// Sunbeam — PHB p.279
// 6th-level evocation, action, range Self (60-ft line). Canon:
// concentration, up to 1 minute (repeat action each turn). v1:
// concentration + repeat-action simplified to one-shot.
// Components: V, S, M (a magnifying glass).
//
// Effect: A beam of brilliant light flashes out from your hand in a
//         5-foot-wide, 60-foot-long line. Each creature in the line must
//         make a Constitution saving throw. On a failed save, a creature
//         takes 6d8 radiant damage and is blinded until your next turn.
//         On a successful save, it takes half as much damage and isn't
//         blinded by the spell. Undead and oozes have disadvantage on
//         this save.
//
//         Canon rider: you can re-cast the beam as an action on each of
//         your turns for the duration (concentration).
//
// v1 simplifications:
//   - Concentration + repeat-action (PHB p.279: "concentration, up to 1
//     minute"; re-cast as an action each turn): v1 simplifies to one-shot
//     (concentration: false). The per-turn re-cast is NOT modelled (same
//     gap as Vampiric Touch). Documented via `sunbeamConcentrationV1Simplified: true`.
//   - LINE shape (PHB p.279: "5-foot-wide, 60-foot-long line") — NOT a cone.
//     Use inLineFt(caster.pos, aimAt.pos, enemy.pos, 60, 5). Mirrors
//     Lightning Bolt (Session 21).
//   - Blinded on failed save (PHB p.279: "blinded until your next turn"):
//     v1 applies blinded via condition_apply (mirror Sunburst). The
//     end-of-next-turn expiry is NOT tracked (persists for v1 combat).
//   - Undead/ooze disadvantage: NOT modelled (no creature-type tag).
//   - Upcast: none (PHB p.279: 6th-level only).
//
// Migration note (Session 24): Mirrors Lightning Bolt (Session 21) line
// + Sunburst (Session 23) blinded. L6 slot.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { inLineFt, chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect, filterGoIProtectedTargets } from '../engine/spell_effects';

export const metadata = {
  name: 'Sunbeam',
  level: 6,
  school: 'evocation',
  rangeFt: 60,                   // PHB p.279: 60-ft line
  lineLengthFt: 60,              // PHB p.279
  lineWidthFt: 5,                // PHB p.279 (explicit)
  dieCount: 6,
  dieSides: 8,
  damageType: 'radiant' as const,
  concentration: false,          // v1 simplification: one-shot (canon concentration + repeat-action)
  saveAbility: 'con' as const,
  castingTime: 'action',
  sunbeamConcentrationV1Simplified: true,                             // canon concentration + repeat-action simplified to one-shot
  sunbeamUndeadOozeDisadvantageV1Simplified: true,                   // no creature-type tag
  sunbeamBlindedDurationV1Simplified: true,                           // end-of-next-turn NOT tracked
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
  if (!caster.actions.some(a => a.name === 'Sunbeam')) return null;
  if (!hasSpellSlot(caster, 6)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  let aimAt: Combatant | null = null;
  let aimThreat = -1;
  let aimDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    if (e.maxHP > aimThreat || (e.maxHP === aimThreat && distFt < aimDist)) {
      aimAt = e;
      aimThreat = e.maxHP;
      aimDist = distFt;
    }
  }
  if (!aimAt) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    if (inLineFt(caster.pos, aimAt.pos, e.pos, metadata.lineLengthFt, metadata.lineWidthFt)) {
      targets.push(e);
    }
  }
  return targets.length >= 1 ? targets : null;
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Sunbeam');
  const saveDC = action?.saveDC ?? 15;

  const slotLevel = consumeSpellSlot(caster, 6) ?? 6;

  // Session 79: exclude targets protected by Globe of Invulnerability from
  // this AoE. PHB p.245: "the spell has no effect on them." The spell still
  // fires (slot already consumed above); protected targets are simply
  // skipped in the damage loop.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Sunbeam! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.lineLengthFt}-ft × ${metadata.lineWidthFt}-ft line + blinded on fail) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
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
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Sunbeam (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + BLINDED'}`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Sunbeam: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);

    if (!save.success && !target.conditions.has('blinded')) {
      applySpellEffect(target, {
        casterId: caster.id,
        spellName: 'Sunbeam',
        effectType: 'condition_apply',
        payload: { condition: 'blinded' },
        sourceIsConcentration: false,
      });
      emit(state, 'condition_add', caster.id, `${target.name} is BLINDED by the sunbeam! (disadvantage on attacks, advantage on attacks vs them)`, target.id);
    }
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot.
}
