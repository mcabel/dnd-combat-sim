// ============================================================
// Summon Elemental — TCE p.112
//
// 4th-level conjuration, action, range 30 ft, concentration (1 hr).
// Components: V, S, M (air, pebble, fire, or water in a gold-inlaid
//             vial worth at least 400 gp).
//
// Effect: You call forth an elemental spirit. It manifests in an
//         unoccupied space that you can see within range. This
//         corporeal form uses the Elemental Spirit stat block.
//         When you cast this spell, choose one of the following
//         options: "Air", "Earth", "Fire", or "Water".
//
// The creature disappears when it drops to 0 hit points or when
// the spell ends.
//
// The creature is an ally to you and your companions. In combat,
// the creature shares your initiative count, but it takes its turn
// immediately after yours. It obeys verbal commands (no action
// required by you). If you don't issue any, it takes the Dodge
// action and uses its move to avoid danger.
//
// Elemental Spirit Stat Block (TCE p.112):
//   AC: 11 + spell level
//   HP: 40 + 10 per spell level above 4th (40 at L4, 50 at L5, etc.)
//   Speed: varies (Air: fly 60 ft, Earth: 30 ft, Fire: 40 ft, Water: swim 40 ft)
//   STR 16, DEX 12, CON 14, INT 4, WIS 10, CHA 6
//   Attack varies by option:
//     Air:   Wind Slam +5, 1d8+3 bludgeoning + 1d4 cold
//     Earth: Rocky Bludgeon +5, 1d8+3 bludgeoning
//     Fire:  Fire Strike +5, 1d8+3 fire
//     Water: Water Strike +5, 1d8+3 bludgeoning + 1d4 cold
//   At L5+: Multiattack (2 attacks)
//
// v1 simplifications:
//   - Always picks 'Fire' option (most common choice)
//   - Summon always uses 'attackNearest' AI profile
//   - Position: always placed adjacent to caster (within 30 ft)
//   - No verbal command system integration (uses default profile)
//
// TCE summon stat blocks are NOT in the bestiary. They are built
// manually as Combatant objects via createElementalSpirit().
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
  name: 'Summon Elemental',
  level: 4,
  school: 'conjuration',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  summonElementalV1Implemented: true,
  summonElementalUpcastV1Implemented: true,
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

// ---- Elemental Spirit stat block builder ---------------------

/**
 * Create an Elemental Spirit Combatant.
 * TCE summon stat blocks are NOT in the bestiary — they are built manually.
 *
 * @param caster    - the combatant who cast Summon Elemental
 * @param slotLevel - the spell slot level used (4–9)
 * @param option    - 'air', 'earth', 'fire', or 'water' (v1: always 'fire')
 */
export function createElementalSpirit(
  caster: Combatant,
  slotLevel: number,
  option: 'air' | 'earth' | 'fire' | 'water' = 'fire',
): Combatant {
  const hp = 40 + 10 * (slotLevel - 4);
  const ac = 11 + slotLevel;
  const numAttacks = slotLevel >= 5 ? 2 : 1;

  // Build attack action and speed based on option
  let attackAction: Action;
  let speed = 30;
  let flySpeed: number | null = null;
  let swimSpeed: number | null = null;

  if (option === 'air') {
    // Wind Slam: +5, 1d8+3 bludgeoning + 1d4 cold
    attackAction = {
      name: 'Wind Slam',
      isMultiattack: numAttacks > 1,
      attackType: 'melee',
      reach: 5,
      range: { normal: 5, long: 5 },
      hitBonus: 5,
      damage: { count: 1, sides: 8, bonus: 3, average: 8 },
      damageType: 'bludgeoning',
      saveDC: null,
      saveAbility: null,
      isAoE: false,
      isControl: false,
      requiresConcentration: false,
      slotLevel: 0,
      costType: 'action',
      legendaryCost: 0,
      description: `Wind Slam: +5 to hit, 1d8+3 bludgeoning plus 1d4 cold${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
    };
    flySpeed = 60;
  } else if (option === 'earth') {
    // Rocky Bludgeon: +5, 1d8+3 bludgeoning
    attackAction = {
      name: 'Rocky Bludgeon',
      isMultiattack: numAttacks > 1,
      attackType: 'melee',
      reach: 5,
      range: { normal: 5, long: 5 },
      hitBonus: 5,
      damage: { count: 1, sides: 8, bonus: 3, average: 8 },
      damageType: 'bludgeoning',
      saveDC: null,
      saveAbility: null,
      isAoE: false,
      isControl: false,
      requiresConcentration: false,
      slotLevel: 0,
      costType: 'action',
      legendaryCost: 0,
      description: `Rocky Bludgeon: +5 to hit, 1d8+3 bludgeoning${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
    };
    speed = 30;
  } else if (option === 'fire') {
    // Fire Strike: +5, 1d8+3 fire
    attackAction = {
      name: 'Fire Strike',
      isMultiattack: numAttacks > 1,
      attackType: 'melee',
      reach: 5,
      range: { normal: 5, long: 5 },
      hitBonus: 5,
      damage: { count: 1, sides: 8, bonus: 3, average: 8 },
      damageType: 'fire',
      saveDC: null,
      saveAbility: null,
      isAoE: false,
      isControl: false,
      requiresConcentration: false,
      slotLevel: 0,
      costType: 'action',
      legendaryCost: 0,
      description: `Fire Strike: +5 to hit, 1d8+3 fire${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
    };
    speed = 40;
  } else {
    // Water: Water Strike +5, 1d8+3 bludgeoning + 1d4 cold
    attackAction = {
      name: 'Water Strike',
      isMultiattack: numAttacks > 1,
      attackType: 'melee',
      reach: 5,
      range: { normal: 5, long: 5 },
      hitBonus: 5,
      damage: { count: 1, sides: 8, bonus: 3, average: 8 },
      damageType: 'bludgeoning',
      saveDC: null,
      saveAbility: null,
      isAoE: false,
      isControl: false,
      requiresConcentration: false,
      slotLevel: 0,
      costType: 'action',
      legendaryCost: 0,
      description: `Water Strike: +5 to hit, 1d8+3 bludgeoning plus 1d4 cold${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
    };
    swimSpeed = 40;
  }

  // Position: adjacent to caster (1 square away)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `summon_elemental_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Build attack actions array (one entry per attack for multiattack)
  const actions: Action[] = [];
  for (let i = 0; i < numAttacks; i++) {
    actions.push({
      ...attackAction,
      name: numAttacks > 1 ? `${attackAction.name} (${i + 1}/${numAttacks})` : attackAction.name,
    });
  }

  return {
    id,
    name: `Elemental Spirit (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed,
    flySpeed,
    swimSpeed,
    burrowSpeed: null,
    str: 16,
    dex: 12,
    con: 14,
    int: 4,
    wis: 10,
    cha: 6,
    cr: 0,
    pos,
    actions,
    traits: [],
    legendaryActions: [],
    legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: {
      movementFt: speed,
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
    summonSpellName: 'Summon Elemental',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Summon Elemental.
 *
 * Preconditions:
 *   - Caster has 'Summon Elemental' in their actions
 *   - Caster has at least a 4th-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have a Summon Elemental active
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Summon Elemental')) return false;
  if (!hasSpellSlot(caster, 4)) return false;

  // Check if caster already has a Summon Elemental active
  const existingSummon = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Summon Elemental'
  );
  if (existingSummon) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Summon Elemental:
 *  1. Consume a spell slot (find the lowest available L4+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Summon Elemental.
 *  4. Create the Elemental Spirit combatant (built manually, NOT from bestiary).
 *  5. Add to battlefield combatants.
 *  6. Insert into initiative (pendingInitiativeInserts for after-caster insertion).
 *  7. Log the summon.
 */
export function execute(
  caster: Combatant,
  _target: Combatant,
  state: EngineState,
): void {
  const slotLevel = consumeSpellSlot(caster, 4);
  if (slotLevel === null) return; // no slot available (shouldn't happen if shouldCast is checked)

  // Break existing concentration (safety net)
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Summon Elemental');

  // v1 simplification: always pick 'Fire'
  const option: 'air' | 'earth' | 'fire' | 'water' = 'fire';
  const summon = createElementalSpirit(caster, slotLevel, option);

  // Add to battlefield
  state.battlefield.combatants.set(summon.id, summon);

  // Insert into initiative after the caster
  if (!state.battlefield.pendingInitiativeInserts) {
    state.battlefield.pendingInitiativeInserts = [];
  }
  state.battlefield.pendingInitiativeInserts.push({
    combatantId: summon.id,
    insertAfterId: caster.id,
  });

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Summon Elemental (slot L${slotLevel}, ${option})! Elemental Spirit appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
    summon.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
