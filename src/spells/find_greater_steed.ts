// ============================================================
// Find Greater Steed — XGE p.156
//
// 4th-level conjuration, action, range 30 ft, Instantaneous.
// Components: V, S.
//
// Effect: You summon a spirit that assumes the form of a loyal,
//         majestic mount. Appearing in an unoccupied space within
//         range, the steed takes on a form you choose: a griffon,
//         a pegasus, a peryton, a dire wolf, a rhinoceros, or a
//         saber-toothed tiger.
//
// KEY DIFFERENCES FROM TCE SUMMONS:
//   1. NOT concentration — Instantaneous. The steed persists
//      until killed or dismissed.
//   2. After spawning, mount the caster on the steed using
//      mountCreature() from src/summons/mount.ts.
//   3. The Griffon IS a combat_mount (can attack AND be ridden).
//
// v1 simplification:
//   - Always conjure a Griffon (most iconic).
//   - NOT concentration (Instantaneous).
//   - After spawning, auto-mount the caster on the steed.
//
// Griffon stat block (MM p.174):
//   AC: 12, HP: 59, Speed: 30 ft, fly 80 ft
//   STR 18, DEX 15, CON 16, INT 2, WIS 13, CHA 8
//   Multiattack: Beak +5 (1d8+4 piercing) + Claws +5 (2d6+4 slashing)
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
  name: 'Find Greater Steed',
  level: 4,
  school: 'conjuration',
  rangeFt: 30,
  concentration: false,       // Instantaneous — NOT concentration
  castingTime: 'action',
  findGreaterSteedV1Implemented: true,
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

// ---- Griffon stat block builder -----------------------------

/**
 * Create a Griffon Combatant (MM p.174).
 * v1: Always conjure a Griffon — the most iconic greater steed.
 *
 * @param caster - the combatant who cast Find Greater Steed
 */
export function createGriffon(caster: Combatant): Combatant {
  // Griffon stat block (MM p.174):
  // AC: 12, HP: 59, Speed: 30 ft, fly 80 ft
  // STR 18, DEX 15, CON 16, INT 2, WIS 13, CHA 8
  // Multiattack: Beak + Claws
  const hp = 59;
  const ac = 12;

  const beakAction: Action = {
    name: 'Beak',
    isMultiattack: true,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 5,
    damage: { count: 1, sides: 8, bonus: 4, average: 8 },
    damageType: 'piercing',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Beak: +5 to hit, 1d8+4 piercing (Multiattack part 1)',
  };

  const clawsAction: Action = {
    name: 'Claws',
    isMultiattack: true,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 5,
    damage: { count: 2, sides: 6, bonus: 4, average: 11 },
    damageType: 'slashing',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Claws: +5 to hit, 2d6+4 slashing (Multiattack part 2)',
  };

  // Position: adjacent to caster (within 30 ft)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `find_greater_steed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    name: `Griffon (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 30,
    flySpeed: 80,
    swimSpeed: null,
    burrowSpeed: null,
    str: 18,
    dex: 15,
    con: 16,
    int: 2,
    wis: 13,
    cha: 8,
    cr: 2,
    size: 'Large',
    pos,
    actions: [beakAction, clawsAction],
    traits: [],
    legendaryActions: [],
    legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: {
      movementFt: 80,     // Uses fly speed as primary movement
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
    summonSpellName: 'Find Greater Steed',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Find Greater Steed.
 *
 * Preconditions:
 *   - Caster has 'Find Greater Steed' in their actions
 *   - Caster has at least a 4th-level spell slot available
 *   - Caster doesn't already have a Find Greater Steed active
 *   - Caster is NOT currently mounted on another creature
 *
 * NOTE: NOT a concentration spell — does NOT check
 * caster.concentration?.active.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  // NOT concentration — don't check caster.concentration?.active
  if (!caster.actions.some(a => a.name === 'Find Greater Steed')) return false;
  if (!hasSpellSlot(caster, 4)) return false;

  // Check if caster already has a Find Greater Steed active
  const existingSteed = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Find Greater Steed'
  );
  if (existingSteed) return false;

  // Can't mount if already mounted
  if (caster.mountedOn !== null) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Find Greater Steed:
 *  1. Consume a spell slot (find the lowest available L4+ slot).
 *  2. Create the Griffon combatant.
 *  3. Add to battlefield combatants.
 *  4. Insert into initiative after the caster.
 *  5. Mount the caster on the steed.
 *  6. Log the summon.
 *
 * NOTE: No concentration start — Find Greater Steed is Instantaneous.
 */
export function execute(
  caster: Combatant,
  _target: Combatant,
  state: EngineState,
): void {
  const slotLevel = consumeSpellSlot(caster, 4);
  if (slotLevel === null) return; // no slot available

  // No concentration — this is an Instantaneous spell

  const steed = createGriffon(caster);

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
    `${caster.name} casts Find Greater Steed! Griffon appears (AC ${steed.ac}, HP ${steed.maxHP}, fly 80 ft) and ${caster.name} mounts it.`,
    steed.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; steed persists until killed or dismissed.
}
