// ============================================================
// Antagonize — EGtW p.150 (Explorer's Guide to Wildemount)
//
// 1st-level enchantment, action, range 60 ft, NO concentration (v1).
// Components: V.
//
// Effect: You unleash an insulting tirade at one creature you can see
//         within range. The target must make a Wisdom saving throw.
//         On a failed save, it takes 4d4 psychic damage and has
//         disadvantage on attack rolls against creatures other than
//         you until the start of your next turn.
//
// Upcast: +1d4/slot-level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Taunt (canon: "disadvantage on attacks vs others"): simplified to
//     `condition_apply:frightened` (the closest disabling condition —
//     frightened grants a similar "disadv on attacks" while caster visible).
//     Documented via `antagonizeTauntV1SimplifiedToFrightened`.
//   - Duration: canon "until start of your next turn". v1 has no end-of-
//     turn expiry hook — frightened persists for the v1 combat. NOT
//     concentration (sourceIsConcentration: false). Documented via
//     `antagonizeDurationV1Simplified`.
//   - Concentration: canon NO concentration (instantaneous effect). v1
//     matches (NOT concentration).
//   - Damage on save: v1 deals HALF damage on a successful save (mirror
//     Sunburst/Weird), NO frightened. (Canon: save negates damage — v1
//     half-on-save is a minor deviation for consistency with the
//     damage+condition pattern.)
//   - Upcast: +1d4/slot-level NOT modelled — v1 always rolls 4d4.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save + 4d4 psychic + frightened.
// Removed from `_generic_registry.ts`; routed via `case 'antagonize':` in
// combat.ts and a planner branch in planner.ts. Mirrors Hold Person
// (single-target save-or-condition) + one-shot damage (no concentration).
//
// Spell module pattern (single-target save + damage + condition, no conc):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (no concentration; frightened persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Antagonize',
  level: 1,
  school: 'enchantment',
  rangeFt: 60,
  dieCount: 4,
  dieSides: 4,
  damageType: 'psychic' as const,
  concentration: false,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  antagonizeTauntV1SimplifiedToFrightened: true,           // taunt → frightened
  antagonizeDurationV1Simplified: true,                    // end-of-next-turn not tracked
  antagonizeUpcastV1Implemented: false,                    // +1d4/slot-level NOT modelled
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
 * Returns the single best target for Antagonize (a living enemy within 60 ft,
 * not already frightened), or null when the spell should not be cast.
 * Target priority: highest-threat, then lowest current HP (kill-shot bias).
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Antagonize')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;
    if (c.conditions.has('frightened')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Antagonize')) continue;
    candidates.push({ c, threat: c.maxHP, curHP: c.currentHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.curHP - b.curHP);
  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Antagonize');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 1);

  emit(state, 'action', caster.id,
    `${caster.name} casts Antagonize at ${target.name}! (DC ${saveDC} WIS — ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} + frightened on fail)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'wis', saveDC);
  const fullDmg = rollDamage();
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Antagonize (rolled ${save.total}) — ${dealt} ${metadata.damageType}${save.success ? '' : ' + FRIGHTENED'}`, target.id, save.roll);
  emit(state, 'damage', caster.id,
    `Antagonize: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);

  if (!save.success && !target.conditions.has('frightened')) {
    applySpellEffect(target, {
      casterId: caster.id, spellName: 'Antagonize',
      effectType: 'condition_apply', payload: { condition: 'frightened' },
      sourceIsConcentration: false,
    });
    emit(state, 'condition_add', caster.id,
      `${target.name} is FRIGHTENED by the tirade! (taunt simplified; disadv on attacks while caster visible)`, target.id);
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration; frightened persists */ }
