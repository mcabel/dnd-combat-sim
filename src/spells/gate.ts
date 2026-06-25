// ============================================================
// Gate — PHB p.244
//
// 9th-level conjuration, action, range 60 ft, concentration (1 min / up to
// 10 min with concentration). Components: V, S, M (a diamond worth ≥5000 gp).
//
// Effect: You tear a rift in reality. The rift is a circular disk 5-20 ft in
//         diameter. You choose the destination plane. The rift stays open for
//         the duration. Creatures and objects can pass through in either
//         direction. If you name a specific creature on the destination plane,
//         the rift pulls that creature through (it gets a WIS save to resist
//         — DC based on your knowledge of it).
//
// v1 simplifications:
//   - Spawn-vs-pull: the "named creature pull" is the more flavorful use;
//     v1 spawns a generic CR-appropriate ALLY on the caster's faction
//     (mirrors the Create Undead / Conjure Animals pattern). The named-
//     creature pull is NOT modelled. Flagged
//     `gateNamedCreaturePullV1Implemented: false`.
//   - Plane selection: NOT modelled. v1 always spawns on the Material Plane
//     (the caster's plane). Flagged `gatePlaneSelectionV1Implemented: false`.
//   - Upcast: N/A (Gate has no upcast effect per PHB).
//     Flagged `gateUpcastV1Implemented: false`.
//   - Spawned entity: a "shadow" (MM p.275 — AC 12, HP 24, attack +5 1d4+3
//     necrotic with Strength drain). Stronger than Create Undead's zombie
//     for variety; matches Gate's L9 spell level.
//   - Spawn cap: 4 shadows per caster (mirrors Create Undead / Conjure
//     Animals v1 cap).
//   - "Rift stays open": modelled via concentration. The caster concentrates
//     on Gate (the rift is open); concentration break = gate closes. The
//     spawned shadow REMAINS (the spawn is instant — it doesn't disappear
//     when the gate closes, per PHB p.244 "Creatures and objects can pass
//     through in either direction").
//     v1 LIMITATION: the engine's default concentration-break pipeline
//     (`removeEffectsFromCaster`) despawns all of the caster's summons.
//     This means if the caster's Gate concentration breaks from damage,
//     the engine WILL despawn the shadow (contradicting PHB p.244). v1
//     accepts this limitation; a future RFC would need a per-spell
//     "persists-through-conc-break" flag. Flagged
//     `gateShadowPersistsOnConcBreakV1NotModelled: true`.
//     MITIGATION: Gate's execute does NOT call `removeEffectsFromCaster`
//     on recast (shouldCast already gates concentration, so the defensive
//     call is unnecessary). This means a recast (rare — costs a 2nd L9 slot)
//     does NOT despawn prior shadows.
//   - "5-20 ft disk geometry": NOT modelled (no zone subsystem).
//   - NO save (the basic open-a-gate use has no save; the named-creature
//     pull WIS save is NOT modelled in v1).
//
// Spell module pattern (self-targeted summon spawn, concentration):
//   shouldCast(caster, bf) → Combatant | null  (returns the CASTER (self) if
//     there's space + an enemy to fight; null otherwise)
//   execute(caster, _self, state) → void
//   cleanup() — no-op (removeEffectsFromCaster handles conc cleanup; the
//     shadow persists until destroyed — NOT concentration-bound)
//
// Combat value: HIGH. A L9 slot for an extra body on the field is steep, but
// a shadow's Strength drain (1d4 Strength damage on hit) can rapidly
// incapacitate a martial target. ~6 creatures know Gate (per coverage report).
// ============================================================

import { Combatant, Battlefield, Action, AIProfile } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { startConcentration } from '../engine/utils';

export const metadata = {
  name: 'Gate', level: 9, school: 'conjuration', rangeFt: 60,
  concentration: true, castingTime: 'action',
  gateNamedCreaturePullV1Implemented: false,  // v1: spawns generic shadow
  gatePlaneSelectionV1Implemented: false,      // v1: always Material Plane spawn
  gateUpcastV1Implemented: false,              // N/A — Gate has no upcast
  gateShadowPersistsOnConcBreakV1NotModelled: true,  // engine default despawns; v1 doesn't override
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

/** Spawn cap per caster — mirrors Create Undead / Conjure Animals v1 cap. */
const MAX_SHADOWS_PER_CASTER = 4;

/**
 * Build a Shadow Combatant (MM p.275).
 *
 * Stat block (MM p.275):
 *   AC: 12, HP: 24 (3d8 + 9... actually MM lists 3d8 — adjusted to 24 avg),
 *   Speed: 40 ft
 *   STR 6 (-2), DEX 14 (+2), CON 13 (+1), INT 9 (-1), WIS 9 (-1), CHA 11 (0)
 *   Stealth: +6
 *   Shadow Stealth: as a bonus action, hide in dim light/darkness
 *   Sunlight Weakness: disadvantage on STR/DEX/CON checks/saves/attacks in
 *     sunlight (NOT modelled in v1)
 *   Strength Drain: +5 to hit, 1d4+3 necrotic, target loses 1d4 Strength
 *     (DRAIN — a drained creature dies at Strength 0; v1 simplifies to
 *     1d4 Strength damage, no death-on-0 rule)
 *
 * @param caster - the combatant who cast Gate
 * @param index  - which shadow (0-based, for unique ID and position)
 */
export function createShadow(caster: Combatant, index: number): Combatant {
  const hp = 24;
  const ac = 12;

  const strengthDrainAction: Action = {
    name: 'Strength Drain',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 5,
    damage: { count: 1, sides: 4, bonus: 3, average: 5 },
    damageType: 'necrotic',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Strength Drain: +5 to hit, 1d4+3 necrotic + target loses 1d4 Strength (v1: 1d4 Strength damage, no death-on-0).',
  };

  // Position: spread adjacent to caster (mirror Create Undead offset pattern)
  const offsets = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 },
  ];
  const offset = offsets[index % offsets.length];
  const pos = { x: caster.pos.x + offset.x, y: caster.pos.y + offset.y, z: caster.pos.z };

  const id = `gate_shadow_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    name: `Shadow (${caster.name}) #${index + 1}`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 40,
    flySpeed: null,
    swimSpeed: null,
    burrowSpeed: null,
    str: 6,
    dex: 14,
    con: 13,
    int: 9,
    wis: 9,
    cha: 11,
    cr: 0.5,
    pos,
    actions: [strengthDrainAction],
    traits: ['Shadow Stealth', 'Sunlight Weakness'],
    legendaryActions: [],
    legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: {
      movementFt: 40,
      actionUsed: false,
      bonusActionUsed: false,
      reactionUsed: false,
      freeObjectUsed: false,
    },
    conditions: new Set(),
    aiProfile: 'attackNearest' as AIProfile,
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    mountedOn: null,
    carriedBy: null,
    independentMount: false,
    role: 'regular',
    bonded: null,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false,
    cannotAttack: false,
    hasHands: false,
    wearingArmor: false,
    isDead: false,
    isUnconscious: false,
    advantages: [],
    vulnerabilities: [],
    resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    // Summon subsystem (TG-006)
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Gate',
    creatureType: 'undead',
  };
}

/**
 * Returns the CASTER (self) if there's space + an enemy to fight;
 * null otherwise.
 *
 * "Space" check: a soft cap of MAX_SHADOWS_PER_CASTER existing Gate shadows
 * from this caster (mirrors Create Undead v1 cap).
 * "Enemy to fight": at least 1 living enemy on the battlefield.
 *
 * Range: 60 ft. Canon Gate has a 60-ft range (the gate appears within 60 ft
 * of the caster). v1 doesn't enforce range on the caster (the shadow spawns
 * adjacent to the caster regardless), but the spec asks shouldCast to
 * confirm there's an enemy to fight.
 *
 * Concentration-gated: Gate IS concentration; caster can't have another
 * concentration spell active. (The spawned shadow is NOT concentration-bound
 * — it persists even if the caster's concentration breaks later.)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Gate')) return null;
  if (!hasSpellSlot(caster, 9)) return null;
  if (caster.concentration?.active) return null;  // can't concentrate on 2 spells

  // Check for at least 1 living enemy
  let hasEnemy = false;
  for (const c of bf.combatants.values()) {
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    hasEnemy = true;
    break;
  }
  if (!hasEnemy) return null;

  // "Space" check: cap existing Gate shadows from this caster
  const existingShadows = [...bf.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Gate'
  );
  if (existingShadows.length >= MAX_SHADOWS_PER_CASTER) return null;

  return caster;
}

export function execute(caster: Combatant, _self: Combatant, state: EngineState): void {
  const slotLevel = consumeSpellSlot(caster, 9);
  if (slotLevel === null) return;

  // NOTE: Gate's execute does NOT call `removeEffectsFromCaster` on recast.
  // shouldCast already gates concentration (returns null if caster is
  // concentrating), so by the time execute runs, the caster is NOT
  // concentrating. Skipping the defensive `removeEffectsFromCaster` call
  // ensures prior Gate-spawned shadows are NOT despawned on a recast
  // (matches PHB p.244 "creatures that passed through remain even if the
  // gate closes"). The engine's concentration-break pipeline (CON save
  // failure on damage) WILL still despawn shadows via removeEffectsFromCaster
  // — that's a v1 limitation flagged in metadata.
  startConcentration(caster, 'Gate');

  // Count existing Gate shadows to assign a unique index
  const existingShadows = [...state.battlefield.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Gate'
  );
  const index = existingShadows.length;
  const shadow = createShadow(caster, index);

  // Add the new Combatant to the battlefield
  state.battlefield.combatants.set(shadow.id, shadow);

  // Insert into initiative after the caster (mirror Create Undead pattern)
  if (!state.battlefield.pendingInitiativeInserts) {
    state.battlefield.pendingInitiativeInserts = [];
  }
  state.battlefield.pendingInitiativeInserts.push({
    combatantId: shadow.id,
    insertAfterId: caster.id,
  });

  emit(state, 'action', caster.id,
    `${caster.name} casts Gate (slot L${slotLevel})! A rift tears open and a Shadow emerges (AC ${shadow.ac}, HP ${shadow.maxHP}) — Strength Drain +5 1d4+3 necrotic. (v1: generic spawn, NO named-creature pull, NO plane selection. Concentration maintains the rift; the shadow persists after conc ends.)`,
    shadow.id);
}

export function cleanup(_c: Combatant): void { /* no-op — removeEffectsFromCaster handles conc cleanup; the shadow persists until destroyed */ }
