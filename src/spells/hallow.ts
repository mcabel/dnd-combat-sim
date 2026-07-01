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
  // Session 108: the v2 attack-roll hitChance is now data-driven instead of a
  // flat 0.65. S107 used the 5e default ~65% hit rate for ALL attack rolls
  // because the target's AC is unknown at pickHallowDamageType call time. S108
  // refines this per-action: hitChance = f(action.hitBonus, BESTIARY_MEAN_AC)
  // — the action's own to-hit bonus vs the bestiary mean AC (14.849, computed
  // from 5904 monsters in bestiaryData/*.json). A +8 to-hit action now scores
  // higher than a +2 to-hit action (it lands more often, so doubling its damage
  // is more valuable). The save-based (0.75) and auto-hit (1.0) hitChances are
  // unchanged. The dispatch wiring (S106) is still unchanged — only the
  // attack-roll hitChance inside actionDamageWeight is refined. S106 next-action
  // #9 option (b): "use the average party hitBonus vs an average enemy AC (the
  // bestiary mean)" — implemented per-action (each action's hitBonus IS a party
  // member's to-hit for that action; using it per-action preserves granularity
  // a single averaged hitBonus would erase). See bestiaryHitChance below.
  hallowEnergyVulnerabilityV2BestiaryHitChance: true,
  // Session 109: the S108 bestiaryHitChance used the GLOBAL bestiary mean AC
  // (14.849) — a single constant for all encounters. S109 refines this to be
  // ENCOUNTER-SPECIFIC: pickHallowDamageType now computes the average AC of
  // living enemies on the CURRENT battlefield (the pool from which the Hallow
  // target is drawn) and passes it to bestiaryHitChance. This gives a more
  // accurate hitChance for the actual fight: vs a low-AC enemy swarm an attack
  // roll lands more often (so doubling attack damage is more valuable), while
  // vs a high-AC boss an attack lands less often (so a save-for-half spell may
  // be the better type to double). Falls back to BESTIARY_MEAN_AC when no living
  // enemies are present (preserves all S108 unit tests, which have no enemies on
  // the battlefield → use the bestiary mean unchanged). The dispatch wiring
  // (S106) is STILL unchanged — only the AC passed into the attack-roll
  // hitChance inside actionDamageWeight is refined. S108 next-action #10: LOW
  // risk (helper-only, dispatch unchanged). See encounterAvgAC below.
  hallowEnergyVulnerabilityV2EncounterAC: true,
  // Session 110: the S109 encounterAvgAC uses the AVERAGE AC of ALL living
  // enemies — but the Hallow target is NOT drawn uniformly from this pool.
  // shouldCastEnergyVulnerability picks the HIGHEST-HP enemy within 60 ft (the
  // biggest threat). So the most accurate AC for the hitChance calculation is
  // the LIKELY TARGET's AC, not the encounter average. S109 next-action #11
  // proposed reordering the combat.ts dispatch to pick the target FIRST (MEDIUM
  // risk — touches the S106 dispatch rule). S110 achieves the same target-
  // specific accuracy at LOW risk (helper-only, dispatch UNCHANGED):
  // pickHallowDamageType now predicts the likely target itself (highest-HP
  // living enemy within 60 ft, mirroring shouldCastEnergyVulnerability's
  // selection minus the type-dependent vuln-skip) and uses THAT enemy's AC,
  // falling back to encounterAvgAC (S109 behavior) when no enemy is within
  // 60 ft. The dispatch order is still unchanged — pickHallowDamageType runs
  // first (type), shouldCastEnergyVulnerability runs second (target). See
  // likelyHallowTargetAC below.
  hallowEnergyVulnerabilityV2LikelyTargetAC: true,
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
//       • attack roll (hitBonus !== null, saveDC === null): S108 data-driven —
//         bestiaryHitChance(action.hitBonus) = f(hitBonus, BESTIARY_MEAN_AC).
//         Replaces the S107 flat 0.65 (5e default ~65%) with a per-action value
//         derived from the bestiary AC distribution. A +8 to-hit action lands
//         more often than a +2 to-hit action, so doubling its damage is more
//         valuable. (S107 used 0.65 for all attack rolls because the target AC
//         was unknown at pick time; S108 uses the bestiary mean AC 14.849 as
//         the representative enemy AC — see bestiaryHitChance below.)
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
// v2 picks cold (weight 12×3.5×0.5×0.75 = 15.75 vs fire 3×3.5×1.0×0.5576 = 5.86,
// using the S108 bestiary hitChance for hitBonus +5 vs AC 14.849; S107 used
// the flat 0.65 giving fire 6.83 — either way cold wins decisively).
// v2 is canon-better: doubling the 12d6 fireball (save-for-half, always deals
// ~42) benefits more than doubling three 1d6 cantrips (~3.5 each).
//
// Session 108 (S107 next-action #9 option b) — per-target hitChance. The S107
// flat 0.65 attack-roll hitChance is replaced by bestiaryHitChance(hitBonus),
// which computes P(hit) = clamp((21 - max(2, AC - hitBonus)) / 20, 0.05, 0.95)
// using BESTIARY_MEAN_AC = 14.849 (the mean AC across 5904 bestiary monsters).
// This is the data-driven refinement of the S107 default. The save-based (0.75)
// and auto-hit (1.0) hitChances are unchanged. The dispatch wiring (S106) is
// still unchanged — only the attack-roll hitChance inside actionDamageWeight
// is refined. Existing S107 tests (§5b/5c/5d/5e) still pass: the winners are
// preserved (cold still beats fire in §5b/§5d because 0.75 > 0.5576; fire still
// beats cold in §5c via availability; uniform-damage §5e still reduces to count
// since all attack actions share the same hitBonus → same hitChance).
// ============================================================

/**
 * Bestiary mean Armor Class, precomputed from bestiaryData/*.json (5904
 * monsters with numeric AC; computed via a one-off scan — see S108 handover).
 * Used by bestiaryHitChance() as the FALLBACK representative enemy AC when no
 * living enemies are on the battlefield at pickHallowDamageType call time (S108
 * used it unconditionally; S109 prefers the encounter-specific average AC when
 * enemies are present, falling back to this constant otherwise). 14.849 ≈ 15
 * (the modal AC; the distribution is roughly symmetric around the mean so the
 * mean is a faithful representative).
 */
const BESTIARY_MEAN_AC = 14.849;

/**
 * Expected hit chance for an attack roll vs an enemy of the given AC. Replaces
 * the S107 flat 0.65 (5e default ~65% hit rate) with a data-driven, per-action
 * value. S108 called this with the bestiary mean AC (14.849) unconditionally;
 * S109 calls it with the encounter-specific average AC of living enemies when
 * any are present (falling back to BESTIARY_MEAN_AC otherwise — see
 * encounterAvgAC). The `ac` parameter defaults to BESTIARY_MEAN_AC so direct
 * callers (and the S108 §5g unit tests) preserve their behaviour.
 *
 * Formula: P(hit) = clamp((21 - max(2, AC - hitBonus)) / 20, 0.05, 0.95)
 *   - A hit requires d20 + hitBonus >= AC, i.e. d20 >= AC - hitBonus.
 *   - nat 1 always misses  → the minimum successful roll is max(2, ceil(AC -
 *     hitBonus)); the number of successful faces is (21 - that minimum).
 *   - nat 20 always hits   → clamp the upper bound at 0.95 (1/20).
 *   - The floor 0.05 covers the degenerate case where AC - hitBonus >= 20.
 *
 * Using the MEAN AC (14.849) approximates E[P(hit | AC)] closely because the
 * hitChance function is near-linear in AC over the bestiary range (verified:
 * mean-AC approximation 0.5576 vs the full-distribution average 0.5573 for
 * hitBonus=5 — within 0.0003, well below any decision-relevant threshold). S109
 * uses the encounter-specific mean AC when available — this is MORE accurate
 * than the global bestiary mean because it reflects the actual enemies on the
 * field (a low-AC goblin swarm vs a high-AC dragon boss are very different hit
 * profiles, and the damage-type pick should reflect that).
 *
 * Examples (BESTIARY_MEAN_AC = 14.849, the S108/S109 fallback):
 *   hitBonus +5 → (21 - max(2, 9.849))  / 20 = 11.151 / 20 = 0.5576
 *   hitBonus +8 → (21 - max(2, 6.849))  / 20 = 14.151 / 20 = 0.7076
 *   hitBonus +2 → (21 - max(2, 12.849)) / 20 = 8.151  / 20 = 0.4076
 *   hitBonus +0 → (21 - max(2, 14.849)) / 20 = 6.151  / 20 = 0.3076
 *
 * S109 encounter-specific examples (low-AC enemy pool AC 10):
 *   hitBonus +5 vs AC 10 → (21 - max(2, 5)) / 20 = 16 / 20 = 0.80
 *   hitBonus +2 vs AC 10 → (21 - max(2, 8)) / 20 = 13 / 20 = 0.65
 */
export function bestiaryHitChance(hitBonus: number, ac: number = BESTIARY_MEAN_AC): number {
  const minRoll = Math.max(2, ac - hitBonus);
  const p = (21 - minRoll) / 20;
  return Math.max(0.05, Math.min(0.95, p));
}

/**
 * Computes the average (mean) AC of living enemies on the current battlefield
 * — the encounter-specific pool from which the Hallow target is drawn. S109
 * refinement of the S108 bestiaryHitChance: instead of using the GLOBAL bestiary
 * mean AC (14.849) for every encounter, pickHallowDamageType now passes this
 * encounter-specific AC to bestiaryHitChance so the attack-roll hitChance
 * reflects the actual enemies on the field. Falls back to BESTIARY_MEAN_AC when
 * no living enemies are present (preserves all S108 unit tests, which have no
 * enemies on the battlefield → use the bestiary mean unchanged).
 *
 * "Enemies" = combatants whose faction differs from the caster's, who are not
 * dead/unconscious. The MEAN (not min/max/first) is used because the hitChance
 * function is near-linear in AC over the bestiary range, so E[P(hit|AC)] ≈
 * P(hit|E[AC]) — the mean AC is the faithful representative of the pool (the
 * same reasoning S108 used to justify the bestiary MEAN over the full
 * distribution, now applied to the encounter-specific pool).
 *
 * Used by pickHallowDamageType (S109). The dispatch wiring (S106 case 'hallow'
 * in combat.ts) is unchanged — only the AC fed into the attack-roll hitChance
 * inside actionDamageWeight is refined.
 */
export function encounterAvgAC(caster: Combatant, bf: Battlefield): number {
  let sum = 0;
  let count = 0;
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;             // not the caster
    if (c.faction === caster.faction) continue;    // only enemies (opposing faction)
    if (c.isDead || c.isUnconscious) continue;     // only living enemies
    // `ac` is typed as a required number on Combatant; guard against a
    // non-finite value (NaN/Infinity would poison the mean) for safety.
    if (typeof c.ac !== 'number' || !isFinite(c.ac)) continue;
    sum += c.ac;
    count++;
  }
  return count > 0 ? sum / count : BESTIARY_MEAN_AC;
}

/**
 * Predicts the AC of the enemy that `shouldCastEnergyVulnerability` will
 * actually select as the Hallow target — the HIGHEST-HP living enemy within
 * Hallow's 60-ft range (the biggest threat, the one doubled damage chips
 * through fastest). S110 refinement of the S109 encounterAvgAC: the S109
 * helper uses the AVERAGE AC of ALL living enemies, but the Hallow target is
 * NOT drawn uniformly from that pool — `shouldCastEnergyVulnerability` picks
 * the single highest-HP enemy within 60 ft. So the most accurate AC for the
 * hitChance calculation is the LIKELY TARGET's AC, not the encounter average.
 *
 * S109 next-action #11 proposed reordering the combat.ts dispatch to pick the
 * target FIRST (MEDIUM risk — touches the S106 dispatch rule). S110 achieves
 * the same target-specific accuracy at LOW risk (helper-only, dispatch
 * UNCHANGED): `pickHallowDamageType` computes the likely target itself (using
 * the SAME selection heuristic as `shouldCastEnergyVulnerability` — highest
 * maxHP, tie-broken by nearest distance — minus the type-dependent vuln-skip,
 * which can't be applied at pick time since the damage type isn't chosen yet).
 *
 * Selection mirrors `shouldCastEnergyVulnerability`:
 *   - enemies only (faction differs from caster's)
 *   - not dead / unconscious
 *   - within 60 ft (chebyshev3D(caster.pos, c.pos) × 5 ≤ 60 — the same range
 *     gate `shouldCastEnergyVulnerability` uses; enemies beyond 60 ft can
 *     NEVER be the Hallow target so their AC must not influence the pick)
 *   - highest maxHP wins (the biggest threat); ties broken by NEAREST distance
 *     (same tie-break as `shouldCastEnergyVulnerability`); full ties keep
 *     first-seen (Map insertion order — matches the stable-sort behaviour of
 *     `shouldCastEnergyVulnerability`'s candidates.sort)
 *
 * Falls back to `encounterAvgAC(caster, bf)` (the S109 encounter average,
 * which itself falls back to BESTIARY_MEAN_AC when no living enemies are
 * present) when no enemy is within 60 ft. This preserves all S109 unit tests:
 *   - §5b-§5g (no enemies on the battlefield) → no likely target → fallback to
 *     encounterAvgAC → bestiary mean → identical S109 hitChance values.
 *   - §5h/§5i (a SINGLE enemy within 60 ft) → likely target = that enemy →
 *     its AC equals the S109 encounter average (only one enemy) → identical.
 *   - §6-§16 (enemies at AC 14, single party damage type) → likely target AC
 *     14 = encounter avg 14 → identical (and the single damage type makes the
 *     pick AC-independent anyway).
 *   - §5j (encounterAvgAC direct) → unchanged (encounterAvgAC not modified).
 *
 * The ONLY behavioural change vs S109 is in multi-enemy encounters where the
 * highest-HP enemy's AC differs from the encounter average — see §5l for the
 * flip demo (a high-HP low-AC "squishy boss" makes attack rolls land more
 * often vs the likely target than the encounter average suggests, so doubling
 * attack damage becomes the better pick).
 *
 * Used by pickHallowDamageType (S110). The dispatch wiring (S106 case 'hallow'
 * in combat.ts) is STILL unchanged — only the AC fed into the attack-roll
 * hitChance inside actionDamageWeight is refined (from encounter average to
 * likely-target-specific).
 */
export function likelyHallowTargetAC(caster: Combatant, bf: Battlefield): number {
  let best: { ac: number; maxHP: number; distFt: number } | null = null;
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;             // not the caster
    if (c.faction === caster.faction) continue;    // only enemies (opposing faction)
    if (c.isDead || c.isUnconscious) continue;     // only living enemies
    // Same finite-AC guard as encounterAvgAC (NaN/Infinity would poison the
    // pick — skip such combatants so a malformed entry can't skew the result).
    if (typeof c.ac !== 'number' || !isFinite(c.ac)) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;                     // beyond Hallow's 60-ft range
    // Mirror shouldCastEnergyVulnerability: highest maxHP wins; ties broken by
    // nearest distance; full ties keep first-seen (strict > / strict < so an
    // equal-HP equal-distance later enemy does NOT override the first-seen).
    if (best === null
      || c.maxHP > best.maxHP
      || (c.maxHP === best.maxHP && distFt < best.distFt)) {
      best = { ac: c.ac, maxHP: c.maxHP, distFt };
    }
  }
  // No enemy within 60 ft → fall back to the S109 encounter average (which
  // itself falls back to BESTIARY_MEAN_AC when no living enemies exist at all).
  // The fallback value is only used when Hallow can't target anyone nearby —
  // in that case shouldCastEnergyVulnerability returns null and EV doesn't
  // fire, so the damage-type pick is moot. Keeping the S109 fallback ensures
  // the helper never returns undefined and preserves the S109 unit tests.
  return best !== null ? best.ac : encounterAvgAC(caster, bf);
}

/**
 * Computes the per-round expected-damage weight for a damage-dealing action:
 * `expectedDamage × availability × hitChance`. See the §S107 comment above for
 * the full model. Returns 0 for actions with no damage dice. S108 refines the
 * attack-roll hitChance from the flat 0.65 to bestiaryHitChance(hitBonus). S109
 * refines it further: the AC passed to bestiaryHitChance is now the
 * encounter-specific average AC of living enemies (encounterAC, computed once
 * by pickHallowDamageType via encounterAvgAC) instead of the global bestiary
 * mean — so the hitChance reflects the actual enemies on the field. S110
 * refines the AC once more: instead of the encounter AVERAGE AC, the LIKELY
 * TARGET's AC is used (likelyHallowTargetAC — the highest-HP enemy within
 * 60 ft, mirroring shouldCastEnergyVulnerability's selection). The likely-
 * target AC is more faithful than the encounter average because the Hallow
 * target is NOT drawn uniformly from the enemy pool — it's the single
 * highest-HP enemy within range.
 */
function actionDamageWeight(a: Action, encounterAC: number): number {
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
    // Attack roll — S108 data-driven hitChance from the action's hitBonus vs
    // a representative enemy AC (replaces the S107 flat 0.65). S109 refines
    // the AC from the global bestiary mean to the ENCOUNTER-SPECIFIC average
    // AC of living enemies (encounterAC, passed in by pickHallowDamageType via
    // encounterAvgAC). A higher hitBonus lands more often, so doubling that
    // action's damage is more valuable — and vs a low-AC enemy pool an attack
    // roll lands more often still (so attack damage is worth more to double).
    hitChance = bestiaryHitChance(a.hitBonus, encounterAC);
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
 * S109 refinement: the attack-roll hitChance now uses the ENCOUNTER-SPECIFIC
 * average AC of living enemies (encounterAvgAC) instead of the global bestiary
 * mean (14.849). The encounter AC is computed ONCE here and passed to each
 * actionDamageWeight call (the AC doesn't vary per action — only the hitBonus
 * does). Falls back to the bestiary mean when no living enemies are present
 * (preserves all S108 unit tests, which have no enemies on the battlefield).
 *
 * S110 refinement: the AC passed to actionDamageWeight is now the LIKELY
 * TARGET's AC (likelyHallowTargetAC — the highest-HP living enemy within
 * Hallow's 60-ft range, mirroring shouldCastEnergyVulnerability's selection)
 * instead of the encounter AVERAGE AC. The Hallow target is NOT drawn
 * uniformly from the enemy pool — `shouldCastEnergyVulnerability` picks the
 * single highest-HP enemy within 60 ft — so the likely-target AC is a more
 * faithful representative than the encounter average. Falls back to
 * encounterAvgAC (S109 behavior) when no enemy is within 60 ft. Computed ONCE
 * here (the AC is the same for all actions; only the per-action hitBonus
 * varies). The dispatch wiring (S106 case 'hallow' in combat.ts) is STILL
 * unchanged — pickHallowDamageType runs first (type), then
 * shouldCastEnergyVulnerability runs second (target). See
 * likelyHallowTargetAC above.
 *
 * Ties broken by first-seen order (deterministic). When all party actions have
 * identical damage dice + availability + hitChance, v2 weight ∝ action count,
 * so the v1 winner is preserved (existing S106 tests with uniform-damage
 * actions still pass).
 */
export function pickHallowDamageType(caster: Combatant, bf: Battlefield): DamageType | null {
  // S110: likely-target AC (highest-HP living enemy within 60 ft, mirroring
  // shouldCastEnergyVulnerability's selection). Falls back to encounterAvgAC
  // (S109 encounter average → BESTIARY_MEAN_AC) when no enemy is within range.
  // Computed once — the AC is the same for all actions; only the per-action
  // hitBonus varies.
  const encounterAC = likelyHallowTargetAC(caster, bf);
  const weights: Partial<Record<DamageType, number>> = {};
  for (const c of bf.combatants.values()) {
    if (c.faction !== caster.faction) continue;  // only party members
    if (c.isDead || c.isUnconscious) continue;
    for (const a of c.actions) {
      // Only count actions that actually deal damage (dice + type).
      if (a.damage && a.damageType) {
        const t = a.damageType;
        const w = actionDamageWeight(a, encounterAC);
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
