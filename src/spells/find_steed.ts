// ============================================================
// Find Steed — PHB p.240
//
// 2nd-level conjuration, action, range 30 ft, Instantaneous.
// Components: V, S.
//
// Effect: You summon a spirit that assumes the form of an
//         unusually intelligent, strong, and loyal steed,
//         creating a long-lasting bond with it. Appearing in
//         an unoccupied space within range, the steed takes on
//         a form you choose: a warhorse, a pony, a camel, an
//         elk, or a mastiff.
//
// The steed has the statistics of the chosen form, though it
// is a celestial, fey, or fiend (your choice) instead of its
// normal type.
//
// While mounted on your steed, you make any ability check or
// saving throw related to your mount with advantage.
//
// KEY DIFFERENCES FROM TCE SUMMONS:
//   1. NOT concentration — Instantaneous. The steed persists
//      until killed or dismissed.
//   2. After spawning, mount the caster on the steed using
//      mountCreature() from src/summons/mount.ts.
//   3. The Warhorse IS a combat_mount (can attack AND be ridden).
//
// v1 simplification:
//   - Always conjure a Warhorse (most iconic mount).
//   - NOT concentration (Instantaneous).
//   - After spawning, auto-mount the caster on the steed.
//
// Warhorse stat block (MM p.340):
//   AC: 11, HP: 19, Speed: 60 ft
//   STR 18, DEX 12, CON 16, INT 6, WIS 12, CHA 7
//   Hooves: +6 to hit, 2d6+4 bludgeoning
//
// Spell module pattern:
//   shouldCast(caster, bf) → boolean
//   execute(caster, target, state) → void
//   cleanup() — no-op (no concentration)
// ============================================================

import { Combatant, Battlefield, Action, AIProfile } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { mountCreature } from '../summons/mount';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Find Steed',
  level: 2,
  school: 'conjuration',
  rangeFt: 30,
  concentration: false,       // Instantaneous — NOT concentration
  castingTime: 'action',
  findSteedV1Implemented: true,
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
  state.log.events.push({
    round: state.battlefield.round,
    actorId,
    type,
    targetId,
    value,
    description: desc,
  });
}

// ---- Warhorse stat block builder ----------------------------

/**
 * Create a Warhorse Combatant (MM p.340).
 * v1: Always conjure a Warhorse — the most iconic mount.
 *
 * @param caster - the combatant who cast Find Steed
 */
export function createWarhorse(caster: Combatant): Combatant {
  // Warhorse stat block (MM p.340):
  // AC: 11, HP: 19, Speed: 60 ft
  // STR 18, DEX 12, CON 16, INT 6, WIS 12, CHA 7
  // Hooves: +6 to hit, 2d6+4 bludgeoning
  const hp = 19;
  const ac = 11;

  const hoovesAction: Action = {
    name: 'Hooves',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 6,
    damage: { count: 2, sides: 6, bonus: 4, average: 11 },
    damageType: 'bludgeoning',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Hooves: +6 to hit, 2d6+4 bludgeoning',
  };

  // Position: adjacent to caster (within 30 ft)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `find_steed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    name: `Warhorse (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 60,
    flySpeed: null,
    swimSpeed: null,
    burrowSpeed: null,
    str: 18,
    dex: 12,
    con: 16,
    int: 6,
    wis: 12,
    cha: 7,
    cr: 0.5,
    size: 'Large',
    pos,
    actions: [hoovesAction],
    traits: [],
    legendaryActions: [],
    legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: {
      movementFt: 60,
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
    role: 'combat_mount',
    bonded: caster.id,
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
    summonSpellName: 'Find Steed',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Find Steed.
 *
 * Preconditions:
 *   - Caster has 'Find Steed' in their actions
 *   - Caster has at least a 2nd-level spell slot available
 *   - Caster doesn't already have a Find Steed active
 *   - Caster is NOT currently mounted on another creature
 *
 * NOTE: NOT a concentration spell — does NOT check
 * caster.concentration?.active.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  // NOT concentration — don't check caster.concentration?.active
  if (!caster.actions.some(a => a.name === 'Find Steed')) return false;
  if (!hasSpellSlot(caster, 2)) return false;

  // Check if caster already has a Find Steed active
  const existingSteed = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Find Steed'
  );
  if (existingSteed) return false;

  // Can't mount if already mounted
  if (caster.mountedOn !== null) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Find Steed:
 *  1. Consume a spell slot (find the lowest available L2+ slot).
 *  2. Create the Warhorse combatant.
 *  3. Add to battlefield combatants.
 *  4. Insert into initiative after the caster.
 *  5. Mount the caster on the steed.
 *  6. Log the summon.
 *
 * NOTE: No concentration start — Find Steed is Instantaneous.
 */
export function execute(
  caster: Combatant,
  _target: Combatant,
  state: EngineState,
): void {
  const slotLevel = consumeSpellSlot(caster, 2);
  if (slotLevel === null) return; // no slot available

  // No concentration — this is an Instantaneous spell

  const steed = createWarhorse(caster);

  // Add to battlefield
  state.battlefield.combatants.set(steed.id, steed);

  // Insert into initiative after the caster
  if (!state.battlefield.pendingInitiativeInserts) {
    state.battlefield.pendingInitiativeInserts = [];
  }
  state.battlefield.pendingInitiativeInserts.push({
    combatantId: steed.id,
    insertAfterId: caster.id,
  });

  // Mount the caster on the steed
  mountCreature(caster, steed);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Find Steed! Warhorse appears (AC ${steed.ac}, HP ${steed.maxHP}) and ${caster.name} mounts it.`,
    steed.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; steed persists until killed or dismissed.
}
