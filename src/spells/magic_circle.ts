// ============================================================
// Magic Circle — PHB p.256
//
// 3rd-level abjuration, 1-minute casting time (NOT an action; ritual),
// range 10 ft, concentration (1 hour).
// Components: V, S, M (holy water or powdered silver + iron worth ≥100 gp).
//
// Effect: You create a 10-ft-radius, 30-ft-tall cylinder of magical energy
//         centered on a point on the ground. Choose one of the following
//         creature types: celestial, elemental, fey, fiend, or undead.
//   - Inside vs chosen type: creatures of the chosen type CAN'T enter the
//     cylinder (repelled). Creatures already inside when the spell is
//     cast are TRAPPED (can't leave the cylinder).
//   - Trapped creatures of the chosen type have DISADVANTAGE on attack rolls
//     vs targets outside the cylinder.
//   - Targets outside the cylinder (vs the trapped creatures): the trapped
//     creatures CAN'T charm, frighten, or possess them (advantage on those
//     saves).
//   - Upcast: +2d4 damage per slot level above 3rd (NOT — that's Spirit
//     Guardians. Magic Circle upcast: caster picks 1 additional creature
//     type per slot level above 3rd).
//
// v1 simplifications:
//   - Casting time: canon 1 min (ritual-like). v1 allows it in combat as
//     a single action (monsters cast it mid-fight — the bestiary lists it
//     at L3 with at-will/daily pattern; we treat it as an action).
//   - Cylinder geometry: NOT modelled (no zone/area subsystem). v1 applies
//     the spell's effect to a single enemy target of the chosen type —
//     the effect mirrors the trapped-inside behavior: the target has
//     DISADVANTAGE on attacks vs everyone outside (which is everyone not
//     trapped — v1: everyone who isn't the caster).
//   - "Can't charm/frighten/possess targets outside": v1 grants the caster
//     + allies ADVANTAGE on saves vs the target's charm/frighten/possess
//     effects (modelled as `advantage_vs` with advType=advantage, applied
//     to the target — attacks/saves vs the target gain advantage).
//   - Upcast (additional creature type): NOT modelled (v1 picks 1 type).
//   - Repulsion (can't enter): NOT modelled (no movement zone subsystem).
//   - Trapped (can't leave): NOT modelled.
//
// Spell module pattern (single-target condition_apply + advantage_vs,
// concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (removeEffectsFromCaster handles conc cleanup)
//
// Combat value: MEDIUM. v1 strips the zone to a single-target debuff:
//   - Target has DISADVANTAGE on attacks (via `advantage_vs` disadvantage
//     applied to the target — attacks vs the target's victims get adv,
//     which is mechanically equivalent to "target has disadv on attacks").
//   - Caster+allies have ADV on saves vs target's charm/frighten/possess
//     (modelled by the same `advantage_vs` advantage flip — attacks/saves
//     vs the target gain advantage, covering both attacks AND saves).
//   - Combined: a single `advantage_vs` effect with advType=advantage
//     gives everyone outside the "circle" (i.e. everyone but the target)
//     advantage on attack rolls AND saves vs the target.
//   4 creatures know it (Krull, Ezmerelda d'Avenir, Rictavio, etc.).
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Magic Circle', level: 3, school: 'abjuration', rangeFt: 10,
  concentration: true, castingTime: 'action',  // v1: action (canon 1 min)
  magicCircleGeometryV1Implemented: false,   // cylinder not modelled
  magicCircleRepulsionV1Implemented: false,  // can't-enter not modelled
  magicCircleTrappedV1Implemented: false,    // can't-leave not modelled
  magicCircleUpcastV1Implemented: false,     // additional type not modelled
  magicCircleSingleTargetV1Implemented: true, // v1 reduces AoE to single target
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

/** Creature types Magic Circle can be attuned to (PHB p.256). */
const AFFECTED_TYPES = new Set(['celestial', 'elemental', 'fey', 'fiend', 'undead']);

/**
 * Pick the best creature type to attune the circle to, based on the
 * target's creatureType. Falls back to 'fiend' (most common) if the
 * target's type isn't in the list.
 */
function pickCircleType(target: Combatant): 'celestial' | 'elemental' | 'fey' | 'fiend' | 'undead' {
  const t = (target.creatureType ?? '').toLowerCase();
  if (AFFECTED_TYPES.has(t)) {
    return t as 'celestial' | 'elemental' | 'fey' | 'fiend' | 'undead';
  }
  return 'fiend';  // default — most spellcasters prepare vs fiends
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Magic Circle')) return null;
  if (!hasSpellSlot(caster, 3)) return null;
  if (caster.concentration?.active) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 10) continue;
    // Only worth casting vs an affected creature type
    const ct = (c.creatureType ?? '').toLowerCase();
    if (!AFFECTED_TYPES.has(ct)) continue;
    // Skip if already affected by this caster's Magic Circle
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Magic Circle')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Magic Circle');
  void action;
  consumeSpellSlot(caster, 3);

  // Drop stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Magic Circle');

  const circleType = pickCircleType(target);
  emit(state, 'action', caster.id,
    `${caster.name} casts Magic Circle attuned to ${circleType}s, trapping ${target.name}! (concentration; target has disadv on attacks, allies have adv on saves vs its charm/frighten/possess)`,
    target.id);

  if (target.isDead || target.isUnconscious) return;

  // v1: apply `advantage_vs` with advType=advantage to the target.
  //   - Attacks vs the target get advantage (= target has disadv on its
  //     attacks, since attacks against the trapped creature's victims
  //     roll at advantage per PHB p.256 "Disadvantage on attack rolls
  //     against targets outside the cylinder").
  //   - Saves vs the target's charm/frighten/possess get advantage.
  // (A single effect covers both — advantage_vs applies to attack rolls
  // AND saves against the bearer.)
  // The circleType is tracked in the spell log only (not the effect
  // payload — the ActiveEffect payload type doesn't have a circleType
  // field; shouldCast already gated by type at selection time).
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Magic Circle',
    effectType: 'advantage_vs',
    payload: {
      advType: 'advantage',
    },
    sourceIsConcentration: true,
    sourceCreatureType: caster.creatureType,
  });
  emit(state, 'condition_add', caster.id,
    `${target.name} is trapped inside the Magic Circle — attacks vs it have advantage; saves vs its charm/frighten/possess have advantage!`,
    target.id);
}

export function cleanup(_c: Combatant): void { /* no-op — removeEffectsFromCaster handles conc cleanup */ }
