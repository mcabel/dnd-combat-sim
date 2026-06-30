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

import { Combatant, Battlefield, DamageType, ActiveEffect, Action, DiceExpression } from '../types/core';
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
  // existing Daylight effect).
  hallowEnergyVulnerabilityV1Implemented: true,
  // Session 106: Energy Vulnerability is now WIRED into the AI dispatch
  // (case 'hallow' in combat.ts). The effect-selection rule (S106):
  //   1. If the target is undead/fiend → Daylight (canon-accurate; the
  //      PHB-intended use — undead/fiends have disadv on attacks in daylight).
  //   2. Else (no undead/fiend, but there are other enemies) → Energy
  //      Vulnerability with the party's most common damage type (inferred
  //      from party members' actions via pickHallowDamageType). The party
  //      would vuln whatever damage type they can exploit.
  // This expands Hallow's combat value beyond just undead/fiends — it's now
  // a general-purpose offensive debuff when no undead/fiend is present.
  hallowEnergyVulnerabilityV1Wired: true,
  // Session 107: pickHallowDamageType now uses a v2 WEIGHTED model (damage
  // dice × availability × hit chance) instead of the v1 action-count heuristic.
  // v1 counted each damage-dealing action as 1 vote — a 1d6 cantrip counted
  // the same as a 12d6 fireball. v2 weights by expected damage per round, so
  // the type that benefits MOST from being doubled is picked (a 12d6 fireball
  // outscores three 1d6 fire cantrips). The dispatch wiring (S106) is
  // unchanged — only the type-selection heuristic is refined. See
  // pickHallowDamageType + actionDamageWeight below for the model.
  hallowEnergyVulnerabilityV2Weighted: true,
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

// ============================================================
// Session 106 — Hallow effect-selection: pickHallowDamageType
//
// When Hallow's Daylight effect doesn't apply (no undead/fiend target), the
// AI falls back to Energy Vulnerability. The damage type is chosen by scanning
// ALL party members' actions for the damage type with the highest EXPECTED
// DAMAGE PER ROUND — the type that benefits MOST from being doubled. The
// caster would vuln whatever the party can exploit (so doubled damage actually
// fires).
//
// Session 107 (S106 next-action #5) — v2 WEIGHTED model. v1 counted each
// damage-dealing action as 1 vote (a 1d6 cantrip counted the same as a 12d6
// fireball). v2 weights each action by:
//   weight = expectedDamage × availability × hitChance
// where:
//   - expectedDamage = the action's per-hit average (DiceExpression.average,
//     computed as count×(sides+1)/2+bonus if `average` is missing — some test
//     factories omit it).
//   - availability = how often the action is used per round:
//       • cantrip/weapon (slotLevel 0 or undefined): 1.0 (repeatable every turn)
//       • slotted spell (slotLevel >= 1): 0.5 (limited slots — conservative; a
//         caster might cast it 1-2x then fall back to cantrips; over a 5-round
//         combat ~0.5 avg/round)
//       • recharge action: multiplied by the recharge probability (Recharge N →
//         available on N-6 → (7-N)/6; e.g. Recharge 5-6 → 2/6 ≈ 0.33)
//   - hitChance = probability the damage is dealt:
//       • attack roll (hitBonus !== null, saveDC === null): 0.65 (typical vs a
//         reasonable AC; the actual target AC is unknown at pick time, so use
//         the 5e default ~65% hit rate)
//       • saving throw (saveDC !== null): 0.75 (save-for-half expected value:
//         50% fail → full damage, 50% succeed → half → 0.5×1.0 + 0.5×0.5 = 0.75)
//       • neither (auto-hit / damage_no_save): 1.0
// The type with the highest total weight wins. Ties broken by first-seen
// order (deterministic — same as v1, preserved so existing S106 tests that
// use uniform-damage actions still pass: when all actions have the same dice,
// v2 weight ∝ count, so the v1 winner is preserved).
// Returns null if no party member has a damage-dealing action (EV can't fire).
//
// v2 vs v1 behavioural difference: v2 picks the type with the highest damage
// CONTRIBUTION, not the highest action COUNT. Example: a party with three 1d6
// fire cantrips + one 12d6 cold fireball (slotted) — v1 picks fire (count 3),
// v2 picks cold (weight 12×3.5×0.5×0.75 = 15.75 vs fire 3×3.5×1.0×0.65 = 6.83).
// v2 is canon-better: doubling the 12d6 fireball (save-for-half, always deals
// ~42) benefits more than doubling three 1d6 cantrips (~3.5 each).
// ============================================================

/**
 * Computes the per-round expected-damage weight for a damage-dealing action:
 * `expectedDamage × availability × hitChance`. See the §S107 comment above for
 * the full model. Returns 0 for actions with no damage dice.
 */
function actionDamageWeight(a: Action): number {
  const d = a.damage!;
  // Expected damage per hit: use pre-computed average if present, else compute
  // (some test factories create DiceExpression without the `average` field).
  const expectedDmg = typeof d.average === 'number'
    ? d.average
    : d.count * (d.sides + 1) / 2 + d.bonus;

  // Availability: how often the action is used per round.
  let availability = 1.0;  // default: repeatable (cantrip / weapon attack)
  if (a.slotLevel !== undefined && a.slotLevel >= 1) {
    // Slotted spell — limited slots. Conservative 0.5 (a caster might cast it
    // 1-2x then fall back to cantrips; over a 5-round combat ~0.5 avg/round).
    availability = 0.5;
  }
  if (a.recharge) {
    // Recharge action — available only when the d6 roll meets the threshold.
    // Recharge N → available on N, N+1, ... 6 → (7 - N) / 6 probability.
    // (Recharge 5-6 → 2/6 ≈ 0.33; Recharge 6 → 1/6 ≈ 0.17.)
    availability *= (7 - a.recharge.min) / 6;
  }

  // Hit chance: probability the damage is dealt.
  let hitChance = 1.0;  // default: auto-hit (damage_no_save, etc.)
  if (a.hitBonus !== null && a.saveDC === null) {
    // Attack roll — flat 0.65 (typical vs reasonable AC; target AC unknown at
    // pick time, so use the 5e default ~65% hit rate).
    hitChance = 0.65;
  } else if (a.saveDC !== null) {
    // Saving throw — save-for-half expected value ~0.75 (50% fail → full,
    // 50% succeed → half → 0.5×1.0 + 0.5×0.5 = 0.75).
    hitChance = 0.75;
  }

  return expectedDmg * availability * hitChance;
}

/**
 * Scans all party members' actions for the damage type with the highest total
 * expected-damage-per-round weight (S107 v2 model: damage dice × availability
 * × hit chance). Returns the type that benefits MOST from being doubled, or
 * null if no party member has a damage-dealing action. Used by the Hallow AI
 * dispatch (S106) to pick the Energy Vulnerability damage type.
 *
 * Ties broken by first-seen order (deterministic). When all party actions have
 * identical damage dice + availability + hitChance, v2 weight ∝ action count,
 * so the v1 winner is preserved (existing S106 tests with uniform-damage
 * actions still pass).
 */
export function pickHallowDamageType(caster: Combatant, bf: Battlefield): DamageType | null {
  const weights: Partial<Record<DamageType, number>> = {};
  for (const c of bf.combatants.values()) {
    if (c.faction !== caster.faction) continue;  // only party members
    if (c.isDead || c.isUnconscious) continue;
    for (const a of c.actions) {
      // Only count actions that actually deal damage (dice + type).
      if (a.damage && a.damageType) {
        const t = a.damageType;
        const w = actionDamageWeight(a);
        weights[t] = (weights[t] ?? 0) + w;
      }
    }
  }
  let best: DamageType | null = null;
  let bestWeight = -1;  // -1 so a 0-weight type (degenerate) still wins if it's first-seen
  for (const t of Object.keys(weights) as DamageType[]) {
    const w = weights[t] ?? 0;
    // Strict > so the first-seen type wins ties (Object.keys iterates in
    // insertion order = first-seen order; a later type with equal weight does
    // NOT override). Matches v1 tie-break.
    if (w > bestWeight) {
      best = t;
      bestWeight = w;
    }
  }
  return best;
}
