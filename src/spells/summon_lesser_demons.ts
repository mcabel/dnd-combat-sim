// ============================================================
// Summon Lesser Demons — XGE p.167
//
// 3rd-level conjuration, action, range 60 ft, concentration (1 min).
// Components: V, S, M (a vial of blood from an intelligent humanoid).
//
// Effect: You summon forth demons from the chaos of the Abyss.
//         Roll 1d6+3 to determine how many Dretches (CR 1/4) appear.
//         At L6+: 1 Vrock (CR 3). At L8+: 1 Hezrou (CR 8).
//
// The summoned demons are HOSTILE to everyone — they attack the
// nearest non-demon creature, including the caster.
//
// Dretch Stat Block (MM p.60):
//   AC: 11, HP: 18, Speed: 20 ft
//   STR 11, DEX 11, CON 12, INT 5, WIS 8, CHA 3
//   Attack: Bite +2, 1d6 piercing + Claws +2, 1d4 slashing (Multiattack)
//
// v1 simplifications:
//   - Always spawns 2 Dretches (fixed count, not 1d6+3 random)
//   - No Vrock/Hezrou upcast variants (would require different stat blocks)
//   - Faction = caster's faction (canon: hostile to all, but v1 simplifies)
//   - Multiattack: Bite + Claws modelled as 2 separate attack actions
//   - Summon always uses 'attackNearest' AI profile
//   - Position: always placed adjacent to caster (within 60 ft)
//
// SPECIAL: This spell spawns MULTIPLE creatures (2 Dretches). The
// execute() function creates 2 Combatant objects, adds both to the
// battlefield, and adds both to pendingInitiativeInserts. The
// concentration break will despawn ALL of them because they all
// share summonerId = caster.id.
//
// Spell module pattern:
//   shouldCast(caster, bf) → boolean
//   execute(caster, target, state) → void
//   cleanup() — no-op
// ============================================================

import { Combatant, Battlefield, Action, AIProfile } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollDie } from '../engine/utils';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Summon Lesser Demons',
  level: 3,
  school: 'conjuration',
  rangeFt: 60,
  concentration: true,
  castingTime: 'action',
  summonLesserDemonsV1Implemented: true,
  summonLesserDemonsUpcastV1Implemented: true,
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

// ---- Dretch stat block builder -------------------------------

/** Number of Dretches spawned by v1 Summon Lesser Demons */
const NUM_DRETCHES = 2;

/**
 * Create a Dretch Combatant.
 * XGE summon stat blocks are NOT in the bestiary — they are built manually.
 *
 * @param caster   - the combatant who cast Summon Lesser Demons
 * @param index    - which dretch (0-based) for unique naming/positioning
 */
export function createDretch(
  caster: Combatant,
  index: number,
): Combatant {
  const hp = 18;
  const ac = 11;

  // Multiattack: Bite + Claws (2 separate attack actions)
  const biteAction: Action = {
    name: 'Bite',
    isMultiattack: true,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 2,
    damage: { count: 1, sides: 6, bonus: 0, average: 4 },
    damageType: 'piercing',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Bite: +2 to hit, 1d6 piercing',
  };

  const clawsAction: Action = {
    name: 'Claws',
    isMultiattack: true,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 2,
    damage: { count: 1, sides: 4, bonus: 0, average: 3 },
    damageType: 'slashing',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Claws: +2 to hit, 1d4 slashing',
  };

  // Position: adjacent to caster, offset by index to avoid overlap
  const pos = { x: caster.pos.x + 1 + index, y: caster.pos.y, z: caster.pos.z };

  const id = `summon_lesser_demon_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    name: `Dretch ${index + 1} (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 20,
    flySpeed: null,
    swimSpeed: null,
    burrowSpeed: null,
    str: 11,
    dex: 11,
    con: 12,
    int: 5,
    wis: 8,
    cha: 3,
    cr: 0,
    pos,
    actions: [biteAction, clawsAction],
    traits: [],
    legendaryActions: [],
    legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: {
      movementFt: 20,
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
    hasHands: true,
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
    summonSpellName: 'Summon Lesser Demons',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Summon Lesser Demons.
 *
 * Preconditions:
 *   - Caster has 'Summon Lesser Demons' in their actions
 *   - Caster has at least a 3rd-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have a Summon Lesser Demons active
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Summon Lesser Demons')) return false;
  if (!hasSpellSlot(caster, 3)) return false;

  // Check if caster already has a Summon Lesser Demons active
  const existingSummon = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Summon Lesser Demons'
  );
  if (existingSummon) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Summon Lesser Demons:
 *  1. Consume a spell slot (find the lowest available L3+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Summon Lesser Demons.
 *  4. Create 2 Dretch combatants (built manually, NOT from bestiary).
 *  5. Add both to battlefield combatants.
 *  6. Insert both into initiative (pendingInitiativeInserts for after-caster insertion).
 *  7. Log the summon.
 */
export function execute(
  caster: Combatant,
  _target: Combatant,
  state: EngineState,
): void {
  const slotLevel = consumeSpellSlot(caster, 3);
  if (slotLevel === null) return; // no slot available (shouldn't happen if shouldCast is checked)

  // Break existing concentration (safety net)
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Summon Lesser Demons');

  // v1 simplification: always spawn 2 Dretches
  const dretches: Combatant[] = [];
  for (let i = 0; i < NUM_DRETCHES; i++) {
    dretches.push(createDretch(caster, i));
  }

  // Add all dretches to battlefield and initiative
  if (!state.battlefield.pendingInitiativeInserts) {
    state.battlefield.pendingInitiativeInserts = [];
  }

  for (const dretch of dretches) {
    state.battlefield.combatants.set(dretch.id, dretch);
    state.battlefield.pendingInitiativeInserts.push({
      combatantId: dretch.id,
      insertAfterId: caster.id,
    });
  }

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Summon Lesser Demons (slot L${slotLevel})! ${NUM_DRETCHES} Dretches appear (HP 18, AC 11 each).`,
    dretches[0].id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
