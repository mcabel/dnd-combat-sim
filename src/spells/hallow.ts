// ============================================================
// Hallow — PHB p.249
//
// 5th-level evocation, 24-hour cast time (out-of-combat), range touch (5 ft
// radius cast, 60-ft radius once cast), NO concentration (24-hour duration).
// Components: V, S, M (herbs, oils, incense worth ≥1000 gp, consumed).
//
// Effect: You bless an area. All creatures in the 60-ft radius take one
//         effect of your choice:
//   - Courage (+1 attack + immunity to frighten for allies)
//   - Darkness (unaffected: only fills with magical darkness)
//   - Daylight (bright light; undead/fiends take disadv on attacks)
//   - Energy Protection (resistance to a chosen damage type)
//   - Energy Vulnerability (vulnerability to a type)
//   - Extradimensional Interference (elementals/fey/celestials/fiends/undead
//     can't enter)
//   - Sounds (save vs deafened)
//   - Tongues (understand languages)
//   - etc.
//
// v1 simplifications:
//   - Cast time: canon 24 hr. v1: action (treat as "Hallow was pre-cast;
//     triggered now"). 24-hour cast is out-of-combat normally. Flagged
//     `hallowCastTimeV1Simplified: true`.
//   - Area effect: NOT modelled. v1 reduces the 60-ft radius AoE to a single
//     targeted enemy. Flagged `hallowAreaV1SimplifiedToSingleTarget: true`.
//   - Effect variety: NOT modelled. v1 ALWAYS uses "Daylight" — the
//     undead/fiend-targeting attack-disadv effect. Flagged
//     `hallowDaylightOnlyV1Implemented: true`.
//   - Duration: canon 24 hr, NO concentration. v1: encounter-duration, NO
//     concentration. The effect persists until combat ends (no dispel-on-conc
//     break — canon 24 hr is its own duration). Flagged
//     `hallowDurationV1EncounterOnly: true`.
//   - Daylight effect: modelled as `advantage_vs` with advType='advantage'
//     applied to the TARGET — attacks vs the target gain advantage (the
//     closest engine model for "target has disadv on attacks from daylight";
//     the v1 invert: PHB p.194 advantage vs them is mechanically the
//     target's attacks being at disadv — they're equally hittable, but
//     daylight makes them worse at landing hits, modelled here as enemies
//     gaining advantage in their defense which approximates the PHB
//     "disadvantage on attack rolls" from daylight).
//   - Upcast: NONE (Hallow has no upcast effect per PHB).
//   - WIS save vs the chosen creature type: NOT modelled in v1. Canon: an
//     undead/fiend entering the area must make a WIS save or be affected.
//     v1: applies the advantage_vs unconditionally to the chosen target
//     (no save — single-target debuff).
//
// Spell module pattern (single-target advantage_vs, NO concentration):
//   shouldCast(caster, bf) → Combatant | null  (highest-HP enemy undead/fiend
//     within 60 ft, not already affected; null otherwise)
//   execute(caster, target, state) → void
//   cleanup() — no-op (no concentration; effect persists until combat ends)
//
// Combat value: SITUATIONAL — only fires vs undead/fiends. ~5 creatures know
// it (per coverage report).
// ============================================================

import { Combatant, Battlefield, DamageType, ActiveEffect } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Hallow', level: 5, school: 'evocation', rangeFt: 60,
  concentration: false, castingTime: 'action',  // v1: action (canon 24 hr)
  hallowCastTimeV1Simplified: true,             // canon 24 hr → v1 action
  hallowDaylightOnlyV1Implemented: true,         // v1 always picks "Daylight"
  hallowAreaV1SimplifiedToSingleTarget: true,    // 60-ft AoE → single target
  hallowDurationV1EncounterOnly: true,           // canon 24 hr → v1 encounter
  // Session 105: the "Energy Vulnerability" effect (PHB p.249) is now
  // implemented alongside "Daylight". Unlike Daylight (which targets
  // undead/fiends), Energy Vulnerability targets ANY enemy (you'd vuln
  // whatever your party can exploit). The caster chooses the damage type.
  // Uses the S103 `damage_vulnerability` ActiveEffect pattern (the canonical,
  // regression-guarded pattern — see src/test/session104_vuln_audit.test.ts).
  // Encounter-duration (no concentration, no sourceTurnExpires — mirrors the
  // existing Daylight effect). NOT wired into the AI dispatch (case 'hallow'
  // still uses Daylight); AI effect-selection is a future session.
  hallowEnergyVulnerabilityV1Implemented: true,
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

/** Creature types Hallow (Daylight) affects — per PHB p.249 Daylight effect. */
const AFFECTED_TYPES = new Set(['undead', 'fiend']);

/**
 * Returns the highest-HP enemy undead/fiend within 60 ft (v1 trigger radius),
 * not already affected by this caster's Hallow; null otherwise.
 *
 * Range: 60 ft. Canon Hallow has a 60-ft radius once cast. v1 uses 60 ft as
 * the targeting range (single-target).
 *
 * NOT concentration-gated: Hallow has NO concentration requirement (canon
 * 24-hour duration is its own duration, independent of caster focus).
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Hallow')) return null;
  if (!hasSpellSlot(caster, 5)) return null;
  // NOT concentration-gated — Hallow has no concentration requirement.

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;
    // Only worth casting vs an undead or fiend (Daylight effect per PHB p.249)
    const ct = (c.creatureType ?? '').toLowerCase();
    if (!AFFECTED_TYPES.has(ct)) continue;
    // Skip if already affected by this caster's Hallow
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Hallow')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  consumeSpellSlot(caster, 5);
  // NOT a concentration spell — no startConcentration() call.

  emit(state, 'action', caster.id,
    `${caster.name} casts Hallow (Daylight effect) at ${target.name}! (v1: single-target; canon 24-hr cast + 60-ft AoE NOT modelled. NO concentration; encounter-duration. Target is undead/fiend — attacks vs it gain advantage, simulating PHB p.249 Daylight "disadv on attacks".)`,
    target.id);

  if (target.isDead || target.isUnconscious) return;

  // v1: apply `advantage_vs` with advType=advantage to the target.
  // PHB p.249 Daylight: undead/fiends in the area have disadvantage on
  // attack rolls. v1 inverts this to "attacks vs the target have advantage"
  // (the engine's closest model — the target is equally hittable, but the
  // daylight makes them worse at landing hits, represented mechanically as
  // enemies gaining advantage in their defense).
  // NOT concentration-sourced: Hallow is canon 24 hr, NO concentration.
  // The effect persists for the rest of the encounter.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Hallow',
    effectType: 'advantage_vs',
    payload: {
      advType: 'advantage',
    },
    sourceIsConcentration: false,
    sourceCreatureType: caster.creatureType,
  });
  emit(state, 'condition_add', caster.id,
    `${target.name} is bathed in Hallow's Daylight — attacks vs it have advantage (simulating the target's disadv on attacks per PHB p.249)! (NO concentration; encounter-duration.)`,
    target.id);
}

export function cleanup(_c: Combatant): void { /* no-op — no concentration; effect persists until combat ends */ }

// ============================================================
// Session 105 — Hallow "Energy Vulnerability" effect (PHB p.249)
//
// PHB p.249: "Energy Vulnerability. All creatures in the area have
// vulnerability to one damage type of your choice."
//
// v1 model: single-target (mirrors the Daylight v1 simplification — the
// 60-ft AoE is reduced to one targeted enemy). The caster chooses the
// damage type. Uses the S103 `damage_vulnerability` ActiveEffect pattern
// (the canonical, regression-guarded pattern — see
// src/test/session104_vuln_audit.test.ts). Encounter-duration: NO
// concentration (Hallow has none), NO sourceTurnExpires (persists until
// combat ends — mirrors the existing Daylight effect).
//
// Targeting: ANY enemy within 60 ft (not just undead/fiend — you'd vuln
// whatever your party can exploit). Picks the highest-HP enemy (the biggest
// threat — doubled damage chips through HP fastest). Skips enemies already
// vulnerable to the chosen type (innate or from another active effect) so
// the slot isn't wasted on a no-op.
//
// NOT wired into the AI dispatch (case 'hallow' in combat.ts still uses the
// Daylight effect). AI effect-selection (Daylight vs Energy Vulnerability)
// is a future session — these functions are tested directly here.
// ============================================================

/**
 * Returns the highest-HP enemy within 60 ft NOT already vulnerable to the
 * chosen damageType; null otherwise. The caster must have the Hallow action
 * and a 5th-level slot. NOT concentration-gated (Hallow has no concentration).
 */
export function shouldCastEnergyVulnerability(
  caster: Combatant,
  bf: Battlefield,
  damageType: DamageType,
): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Hallow')) return null;
  if (!hasSpellSlot(caster, 5)) return null;
  // NOT concentration-gated — Hallow has no concentration requirement.

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;
    // Skip if already vulnerable to this type (innate or from another effect)
    // — the slot would be wasted on a no-op push.
    if (c.damageVulnerabilities?.includes(damageType)) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

/**
 * Applies Hallow's Energy Vulnerability to the target: a `damage_vulnerability`
 * ActiveEffect that mirrors the chosen damageType into
 * target.damageVulnerabilities (so applyDamageWithTempHP doubles incoming
 * damage of that type, PHB p.197). Encounter-duration (no concentration, no
 * sourceTurnExpires — persists until combat ends).
 *
 * The `addedVulnerability` flag (mirroring the S36 Protection-from-Energy +
 * S103 lair-debuff-vuln pattern) records whether THIS effect actually pushed
 * the type — if the target had innate vuln to the same type (or another
 * active effect already added it), the push is a no-op and undoEffect won't
 * wrongly splice the innate entry out. (shouldCastEnergyVulnerability skips
 * already-vulnerable targets, so addedVulnerability is normally true here —
 * but the guard is kept for safety if execute is called directly.)
 */
export function executeEnergyVulnerability(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
  damageType: DamageType,
): void {
  consumeSpellSlot(caster, 5);
  // NOT a concentration spell — no startConcentration() call.

  emit(state, 'action', caster.id,
    `${caster.name} casts Hallow (Energy Vulnerability) at ${target.name} — vulnerability to ${damageType} damage! (v1: single-target; canon 24-hr cast + 60-ft AoE NOT modelled. NO concentration; encounter-duration. PHB p.249.)`,
    target.id);

  if (target.isDead || target.isUnconscious) return;

  const alreadyPresent = target.damageVulnerabilities?.includes(damageType) ?? false;
  const effect: Omit<ActiveEffect, 'id'> = {
    casterId: caster.id,
    spellName: 'Hallow',
    effectType: 'damage_vulnerability',
    payload: { damageType, addedVulnerability: !alreadyPresent },
    sourceIsConcentration: false,         // Hallow has NO concentration
    appliedTurn: state.battlefield.round,
    // sourceTurnExpires: undefined — encounter-duration (mirrors the existing
    // Daylight effect; canon 24-hr duration is its own duration, independent
    // of caster focus, and v1 bounds it to the encounter).
    sourceCreatureType: caster.creatureType,
  };
  applySpellEffect(target, effect);
  emit(state, 'condition_add', caster.id,
    `${target.name} is vulnerable to ${damageType} damage (Hallow Energy Vulnerability)! Incoming ${damageType} damage is doubled (PHB p.197). (NO concentration; encounter-duration.)`,
    target.id);
}
