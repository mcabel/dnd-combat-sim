// ============================================================
// Geas — PHB p.245
//
// 5th-level enchantment, action, range 60 ft, NO concentration (30 days).
// Components: V, S, M (a black sapphire and a drop of blood).
//
// Effect: You place a magical command on a creature that you can see
//         within range, forcing it to carry out some service or refrain
//         from some action or course of activity. The target must make
//         a Wisdom saving throw. On a failed save, the creature is
//         charmed by you for the duration. While the creature is charmed,
//         it takes 5d10 psychic damage each time it acts in a manner
//         directly counter to your instructions.
//
// Upcast: 7th (+30 days), 8th (+1 yr), 9th (until dispelled) — not modelled.
//
// v1 simplifications:
//   - Damage-on-disobey (PHB p.245: "5d10 psychic damage each time it
//     acts counter to instructions"): v1 simplifies to ONE-SHOT 5d10
//     psychic on the failed save (no disobey-detection subsystem).
//     Documented via `geasDamageOnDisobeyV1SimplifiedToOneShot`.
//   - Duration: canon 30 days (no concentration). v1 has no duration
//     tracker — charmed persists for the entire combat. NOT concentration
//     (sourceIsConcentration: false).
//   - Command/instruction: NOT modelled (v1 has no behaviour-modification
//     subsystem). v1 applies charmed + one-shot damage only.
//   - Range: canon 60 ft. v1 uses chebyshev3D * 5.
//   - Upcast duration extensions NOT modelled.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-charmed + 5d10 psychic.
// Removed from `_generic_registry.ts`; routed via `case 'geas':` in
// combat.ts and a planner branch in planner.ts. Mirrors Hold Person
// (single-target save-or-condition) + one-shot damage (no concentration).
//
// Spell module pattern (single-target save + damage + condition, no conc):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (no concentration; charmed persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Geas',
  level: 5,
  school: 'enchantment',
  rangeFt: 60,                   // PHB p.245: 60 ft
  dieCount: 5,
  dieSides: 10,
  damageType: 'psychic' as const,
  concentration: false,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  geasDamageOnDisobeyV1SimplifiedToOneShot: true,          // one-shot 5d10 (canon per-disobey DoT simplified)
  geasDurationV1Simplified: true,                          // 30-day not tracked
  geasUpcastV1Implemented: false,                          // duration extensions NOT modelled
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

export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Geas (a living enemy within 60 ft,
 * not already charmed), or null when the spell should not be cast.
 * Target priority: highest-threat, then closest.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Geas')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;
    if (c.conditions.has('charmed') || c.conditions.has('incapacitated')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Geas')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Geas');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 5);

  emit(state, 'action', caster.id,
    `${caster.name} casts Geas at ${target.name}! (DC ${saveDC} WIS — 5d10 ${metadata.damageType} + charmed on fail)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Geas (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Geas — no effect!`, target.id);
    return;
  }

  // On fail: deal 5d10 psychic (one-shot, damage-on-disobey simplified) + charmed.
  const dmg = rollDamage();
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
  emit(state, 'damage', caster.id,
    `Geas: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg})`, target.id, dealt);

  if (!target.conditions.has('charmed')) {
    applySpellEffect(target, {
      casterId: caster.id, spellName: 'Geas',
      effectType: 'condition_apply', payload: { condition: 'charmed' },
      sourceIsConcentration: false,   // PHB p.245: NOT concentration (30 days)
    });
    emit(state, 'condition_add', caster.id,
      `${target.name} is CHARMED by Geas! (v1: instruction/disobey NOT modelled — charm + one-shot damage)`, target.id);
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration; charmed persists for combat */ }
