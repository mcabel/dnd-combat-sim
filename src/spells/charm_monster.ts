// ============================================================
// Charm Monster — PHB p.221
//
// 4th-level enchantment, action, range 30 ft, NO concentration (1 hr).
// Components: V, S.
//
// Effect: You attempt to charm a creature you can see within range. It
//         must make a Wisdom saving throw, and it does so with advantage
//         if you or your companions are fighting it. On a failed save,
//         the creature is charmed by you for the duration.
//
// Upcast: +1 target per slot-level above 4th (not modelled in v1).
//
// v1 simplifications:
//   - NO concentration (PHB p.221: 1 hr, no concentration). The charmed
//     persists for the v1 combat duration (no duration tracker).
//   - Single-target (canon: one creature; upcast +1 target/slot). v1
//     always targets one creature; upcast NOT modelled.
//   - Combat advantage on save (PHB p.221: "with advantage if you or
//     your companions are fighting it"): NOT modelled. Documented via
//     `charmMonsterCombatAdvSaveV1Simplified`.
//   - Range: canon 30 ft. v1 uses chebyshev3D * 5.
//   - Any creature (unlike Charm Person which is humanoid-only — but v1
//     doesn't check creature type anyway).
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-charmed (NO concentration).
// Removed from `_generic_registry.ts`; routed via `case 'charmMonster':`
// in combat.ts and a planner branch in planner.ts. Mirrors Hold Person
// (single-target save-or-condition) but charmed + no concentration + L4.
//
// Spell module pattern (single-target save-or-condition, NO concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (no concentration; charmed persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Charm Monster',
  level: 4,
  school: 'enchantment',
  rangeFt: 30,                   // PHB p.221: 30 ft
  concentration: false,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  charmMonsterCombatAdvSaveV1Simplified: true,              // in-combat adv on save NOT modelled
  charmMonsterUpcastV1Implemented: false,                   // +1 target/slot-level NOT modelled
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

/**
 * Returns the single best target for Charm Monster (a living enemy within
 * 30 ft, not already charmed), or null when the spell should not be cast.
 * Target priority: highest-threat, then closest.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Charm Monster')) return null;
  if (!hasSpellSlot(caster, 4)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;
    if (c.conditions.has('charmed') || c.conditions.has('incapacitated')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Charm Monster')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Charm Monster');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 4);

  emit(state, 'action', caster.id, `${caster.name} casts Charm Monster at ${target.name}! (DC ${saveDC} WIS)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSaveReactable(state, caster, target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Charm Monster (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Charm Monster — not charmed!`, target.id);
    return;
  }

  applySpellEffect(target, {
    casterId: caster.id, spellName: 'Charm Monster',
    effectType: 'condition_apply', payload: { condition: 'charmed' },
    sourceIsConcentration: false,   // PHB p.221: NOT concentration (1 hr)
    appliedTurn: state.battlefield.round,
    sourceTurnExpires: state.battlefield.round + 600,   // PHB p.221: 1 hr = 600 rounds
  });
  emit(state, 'condition_add', caster.id,
    `${target.name} is CHARMED by Charm Monster! (disadv on attacks vs caster, caster has adv on social)`, target.id);
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration; charmed persists for combat */ }
