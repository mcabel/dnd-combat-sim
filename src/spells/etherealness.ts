// ============================================================
// Etherealness — PHB p.238
//
// 7th-level transmutation, action, range self, concentration (up to 8 hours).
// Components: V, S.
//
// Effect: You step into the Border Ethereal. You remain on the same plane but
//         in the Ethereal Plane. You can see/hear the plane you came from
//         (60 ft), but everything looks gray. You can move in any direction.
//         Other creatures on the Material Plane can't see/affect you, and you
//         can't affect them. You're immune to damage from non-ethereal sources.
//
// v1 simplifications:
//   - Plane-shift subsystem: NOT modelled. The Border Ethereal is a separate
//     "plane" that coexists with the Material; v1 collapses this to a
//     defensive "untargetable" buff on the caster. Flagged
//     `etherealnessPlaneShiftV1Implemented: false`.
//   - "Can't affect material" / "immune to non-ethereal damage": NOT enforced.
//     v1 lets the caster keep acting normally — they just gain the invisible
//     effect's mechanical benefits (attacks vs them have disadv; their attacks
//     have adv). Flagged `etherealnessCanAffectMaterialV1Implemented: false`.
//   - Duration: canon 8 hours. v1: encounter-only (concentration enforced;
//     breaks when combat ends or caster drops concentration). Flagged
//     `etherealnessDurationV1EncounterOnly: true`.
//   - Border Ethereal marker: modelled via the `invisible` effectType
//     (the closest existing engine effect — PHB p.194). The caster gains the
//     `invisible` condition (attacks vs them have disadv; their attacks have
//     adv). Flagged `etherealnessBorderEtherealV1Implemented: true`.
//   - "See 60 ft into Material": informational only (no vision subsystem).
//   - "Move in any direction": NOT modelled (no flySpeed granted; v1 keeps
//     the caster's existing movement mode).
//   - NO save (target is self), NO upcast (Etherealness has no upcast effect).
//
// Spell module pattern (self-targeted defensive buff, concentration):
//   shouldCast(caster, bf) → Combatant | null  (returns the CASTER (self) if
//     the caster is below 50% HP — defensive escape; null otherwise)
//   execute(caster, _self, state) → void
//   cleanup() — no-op (removeEffectsFromCaster handles conc cleanup)
//
// Combat value: SITUATIONAL — defensive escape only. ~14 casters know it
// (per coverage report: liches, ancient dragons, etc.).
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, addCondition } from '../engine/utils';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Etherealness', level: 7, school: 'transmutation', rangeFt: 0,
  concentration: true, castingTime: 'action',
  etherealnessBorderEtherealV1Implemented: true,    // invisible effect + condition
  etherealnessPlaneShiftV1Implemented: false,        // no plane-shift subsystem
  etherealnessCanAffectMaterialV1Implemented: false, // caster keeps acting (canon forbids)
  etherealnessDurationV1EncounterOnly: true,         // canon 8 hr → v1 encounter
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

/**
 * Returns the CASTER (self) when the caster is below 50% HP (defensive escape);
 * null otherwise.
 *
 * Range: self (0 ft). Etherealness targets the caster only — no save, no
 * targeting choice. The 50%-HP gate is the v1 defensive heuristic: the
 * caster only "flees" to the Border Ethereal when wounded. A full-HP caster
 * has no incentive to step out of the Material Plane mid-fight.
 *
 * Concentration-gated: Etherealness IS concentration; caster can't have
 * another concentration spell active.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  void bf;  // Etherealness doesn't scan the battlefield — it's purely self-targeted
  if (!caster.actions.some(a => a.name === 'Etherealness')) return null;
  if (!hasSpellSlot(caster, 7)) return null;
  if (caster.concentration?.active) return null;  // can't concentrate on 2 spells

  // Defensive escape: only when caster is below 50% HP
  const hpPct = caster.maxHP > 0 ? caster.currentHP / caster.maxHP : 1;
  if (hpPct >= 0.5) return null;

  // Skip if already Ethereal (no stacking)
  if (caster.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Etherealness')) return null;

  return caster;
}

export function execute(caster: Combatant, _self: Combatant, state: EngineState): void {
  consumeSpellSlot(caster, 7);

  // Drop stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Etherealness');

  emit(state, 'action', caster.id,
    `${caster.name} casts Etherealness, stepping into the Border Ethereal! (concentration; v1: invisible effect — attacks vs ${caster.name} have disadv, ${caster.name}'s attacks have adv. Canon: caster can't affect Material Plane — v1 does NOT enforce.)`,
    caster.id);

  if (caster.isDead || caster.isUnconscious) return;

  // Apply the `invisible` effectType — the engine's closest model for
  // "untargetable from the Material Plane". PHB p.194: invisible attackers
  // gain advantage; attacks vs invisible defenders have disadv.
  // sourceIsConcentration: true → effect ends when concentration breaks.
  // NOT setting `breaksOnAttackOrCast: true` — Etherealness (unlike the
  // L2 Invisibility spell, PHB p.254) has NO "ends on attack" clause.
  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Etherealness',
    effectType: 'invisible',
    payload: {},
    sourceIsConcentration: true,
    sourceCreatureType: caster.creatureType,
  });
  // Explicitly add the `invisible` condition (idempotent — applySpellEffect
  // also adds it; we mirror Wall of Force's defensive double-call pattern).
  addCondition(caster, 'invisible');

  emit(state, 'condition_add', caster.id,
    `${caster.name} is now on the Border Ethereal — INVISIBLE (attacks vs them have disadv; their attacks have adv). Concentration maintains the effect.`,
    caster.id);

  // Informational log: full plane-shift subsystem not built (v1 simplification).
  emit(state, 'action', caster.id,
    `(v1: Etherealness collapses the Border Ethereal to an invisibility effect. Plane-shift subsystem, Material-affect restriction, and 8-hour duration are NOT modelled — encounter-only.)`,
    caster.id);
}

export function cleanup(_c: Combatant): void { /* no-op — removeEffectsFromCaster handles conc cleanup */ }
