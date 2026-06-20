// ============================================================
// Command — PHB p.223
//
// 1st-level enchantment, action, range 60 ft, NO concentration (1 round).
// Components: V, M (a drop of blood).
//
// Effect: You speak a one-word command to a creature you can see within
//         range. The target must succeed on a Wisdom saving throw or
//         follow the command (approach, drop, flee, grovel, halt).
//
// Upcast: +1 target per slot-level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Command options (PHB p.223: approach/drop/flee/grovel/halt): v1
//     simplifies ALL to `condition_apply:incapacitated` (the net effect of
//     most commands is "the target does not take their normal action this
//     turn" — approximated by incapacitated). Documented via
//     `commandOptionsV1SimplifiedToIncapacitated`.
//   - Duration: canon 1 round. v1 has no end-of-turn expiry hook —
//     incapacitated persists for the v1 combat. NOT concentration.
//   - Upcast: +1 target/slot-level NOT modelled — v1 targets 1 creature.
//   - Language requirement (PHB p.223: target must understand you): NOT
//     enforced.
//   - Undead immunity (PHB p.223): NOT enforced.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-incapacitated (no conc).
// Removed from `_generic_registry.ts`; routed via `case 'command':` in
// combat.ts and a planner branch in planner.ts. Mirrors Blindness/Deafness
// (single-target save-or-condition, no conc) but incapacitated.
//
// Spell module pattern (single-target save-or-condition, NO concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (no concentration; incapacitated persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Command',
  level: 1,
  school: 'enchantment',
  rangeFt: 60,                   // PHB p.223: 60 ft
  concentration: false,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  commandOptionsV1SimplifiedToIncapacitated: true,         // approach/drop/flee/grovel/halt → incapacitated
  commandUpcastV1Implemented: false,                        // +1 target/slot-level NOT modelled
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

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Command')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;
    if (c.conditions.has('incapacitated')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Command')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Command');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 1);

  emit(state, 'action', caster.id, `${caster.name} casts Command at ${target.name}! (DC ${saveDC} WIS — incapacitated on fail)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Command (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Command — no effect!`, target.id);
    return;
  }

  applySpellEffect(target, {
    casterId: caster.id, spellName: 'Command',
    effectType: 'condition_apply', payload: { condition: 'incapacitated' },
    sourceIsConcentration: false,
  });
  emit(state, 'condition_add', caster.id,
    `${target.name} is INCAPACITATED by Command! (v1: approach/drop/flee/grovel/halt simplified — can't take actions)`, target.id);
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration; incapacitated persists */ }
