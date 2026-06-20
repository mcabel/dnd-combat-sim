// ============================================================
// Animal Friendship — PHB p.212
//
// 1st-level enchantment, action, range 30 ft, NO concentration (24 hr).
// Components: V, S, M (a morsel of food).
//
// Effect: This spell lets you convince a beast that you mean it no harm.
//         Choose a beast that you can see within range. It must see and
//         hear you. If the beast's Intelligence is 4 or higher, the spell
//         has no effect. Otherwise, the beast must succeed on a Wisdom
//         saving throw or be charmed by you for the spell's duration.
//
// Upcast: +1 target per slot-level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Beast-only restriction (PHB p.212: "Choose a beast"): Session 27
//     canon fix (TG-004) — NOW ENFORCED via `creatureType === 'beast'`.
//     Was not enforced in Batch 2 (v1 had no creature-type tag).
//     Documented via `animalFriendshipBeastTypeCheckV1Implemented`.
//   - INT ≥4 immunity (PHB p.212): Session 27 canon fix — NOW ENFORCED.
//     Targets with `int >= 4` are skipped (spell has no effect on them).
//     Documented via `animalFriendshipInt4ImmunityV1Implemented`.
//   - Duration: canon 24 hr (no concentration). v1 has no duration tracker
//     — charmed persists for the v1 combat. NOT concentration.
//   - Upcast: +1 target/slot-level NOT modelled.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-charmed (no conc).
// Session 27 canon fix: added beast-type + INT<4 enforcement (TG-004).
// Removed from `_generic_registry.ts`; routed via `case 'animalFriendship':`
// in combat.ts and a planner branch in planner.ts. Mirrors Blindness/Deafness.
//
// Spell module pattern (single-target save-or-condition, NO concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (no concentration; charmed persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Animal Friendship', level: 1, school: 'enchantment', rangeFt: 30,
  concentration: false, saveAbility: 'wis' as const, castingTime: 'action',
  animalFriendshipBeastTypeCheckV1Implemented: true,   // Session 27 TG-004: beast-only enforced
  animalFriendshipInt4ImmunityV1Implemented: true,    // Session 27: INT≥4 immunity enforced
  animalFriendshipUpcastV1Implemented: false,
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Animal Friendship')) return null;
  if (!hasSpellSlot(caster, 1)) return null;
  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    // TG-004 (Session 27 canon fix): beast-only restriction.
    if (c.creatureType !== 'beast') continue;
    // PHB p.212: INT ≥4 → spell has no effect (skip such targets).
    if (c.int >= 4) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;
    if (c.conditions.has('charmed') || c.conditions.has('incapacitated')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Animal Friendship')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Animal Friendship');
  const saveDC = action?.saveDC ?? 13;
  consumeSpellSlot(caster, 1);
  emit(state, 'action', caster.id, `${caster.name} casts Animal Friendship at ${target.name}! (DC ${saveDC} WIS)`, target.id);
  if (target.isDead || target.isUnconscious) return;
  // Defensive re-check (target may have changed between plan + execute):
  if (target.creatureType !== 'beast') { emit(state, 'action', caster.id, `${target.name} is not a beast — Animal Friendship has no effect!`, target.id); return; }
  if (target.int >= 4) { emit(state, 'action', caster.id, `${target.name} has INT ${target.int} (≥4) — Animal Friendship has no effect!`, target.id); return; }
  const save = rollSave(target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Animal Friendship (rolled ${save.total})`, target.id, save.roll);
  if (save.success) { emit(state, 'action', caster.id, `${target.name} resists Animal Friendship — not charmed!`, target.id); return; }
  applySpellEffect(target, { casterId: caster.id, spellName: 'Animal Friendship', effectType: 'condition_apply', payload: { condition: 'charmed' }, sourceIsConcentration: false });
  emit(state, 'condition_add', caster.id, `${target.name} is CHARMED by Animal Friendship! (beast-only + INT<4 enforced)`, target.id);
}

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration */ }
