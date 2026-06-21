// ============================================================
// Summon Celestial — TCE p.111
//
// 5th-level conjuration, action, range 30 ft, concentration (1 hr).
// Components: V, S, M (a golden reliquary worth 500+ gp).
//
// Effect: You call forth a celestial spirit. It manifests in an
//         unoccupied space that you can see within range. This
//         corporeal form uses the Celestial Spirit stat block.
//         When you cast this spell, choose "Avenger" or "Defender".
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
// Celestial Spirit Stat Block (TCE p.111):
//   AC: 13 + spell level
//   HP: 50 + 10 per spell level above 5th (50 at L5, 60 at L6, etc.)
//   Speed: 30 ft, fly 40 ft
//   STR 16, DEX 14, CON 14, INT 8, WIS 14, CHA 12
//   Multiattack: 2 attacks at L6+ slot
//   Attack (Defender): Radiant Greatsword +5, 3d8+3 radiant (melee)
//   Attack (Avenger):  Radiant Bow +5, 2d6+3 radiant (ranged, 150 ft)
//                      + 1d8 radiant bonus
//
// v1 simplifications:
//   - Always picks 'Defender' option (melee, most common for combat sim)
//   - Healing on hit (1d8+mod) NOT modelled — just damage
//   - Summon always uses 'attackNearest' AI profile
//   - Position: always placed adjacent to caster (within 30 ft)
//   - No verbal command system integration (uses default profile)
//
// TCE summon stat blocks are NOT in the bestiary. They are built
// manually as Combatant objects via createCelestialSpirit().
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
  name: 'Summon Celestial',
  level: 5,
  school: 'conjuration',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  summonCelestialV1Implemented: true,
  summonCelestialUpcastV1Implemented: true,
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

// ---- Celestial Spirit stat block builder ---------------------

/**
 * Create a Celestial Spirit Combatant.
 * TCE summon stat blocks are NOT in the bestiary — they are built manually.
 *
 * @param caster    - the combatant who cast Summon Celestial
 * @param slotLevel - the spell slot level used (5–9)
 * @param option    - 'avenger' or 'defender' (v1: always 'defender')
 */
export function createCelestialSpirit(
  caster: Combatant,
  slotLevel: number,
  option: 'avenger' | 'defender' = 'defender',
): Combatant {
  const hp = 50 + 10 * (slotLevel - 5);
  const ac = 13 + slotLevel;
  const numAttacks = slotLevel >= 6 ? 2 : 1;

  // Build attack action based on option
  let attackAction: Action;
  if (option === 'defender') {
    // Radiant Greatsword: +5 to hit, 3d8+3 radiant (melee)
    attackAction = {
      name: 'Radiant Greatsword',
      isMultiattack: numAttacks > 1,
      attackType: 'melee',
      reach: 5,
      range: { normal: 5, long: 5 },
      hitBonus: 5,
      damage: { count: 3, sides: 8, bonus: 3, average: 17 },
      damageType: 'radiant',
      saveDC: null,
      saveAbility: null,
      isAoE: false,
      isControl: false,
      requiresConcentration: false,
      slotLevel: 0,
      costType: 'action',
      legendaryCost: 0,
      description: `Radiant Greatsword: +5 to hit, 3d8+3 radiant${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
    };
  } else {
    // Radiant Bow: +5 to hit, 2d6+3 radiant (ranged, 150 ft) + 1d8 radiant bonus
    // v1: combine into single damage roll 2d6+1d8+3
    attackAction = {
      name: 'Radiant Bow',
      isMultiattack: numAttacks > 1,
      attackType: 'ranged',
      reach: 150,
      range: { normal: 150, long: 150 },
      hitBonus: 5,
      damage: { count: 2, sides: 6, bonus: 3, average: 10 },  // base 2d6+3
      damageType: 'radiant',
      saveDC: null,
      saveAbility: null,
      isAoE: false,
      isControl: false,
      requiresConcentration: false,
      slotLevel: 0,
      costType: 'action',
      legendaryCost: 0,
      description: `Radiant Bow: +5 to hit, 2d6+3 radiant + 1d8 radiant${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
    };
  }

  // Position: adjacent to caster (1 square away)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `summon_celestial_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Build attack actions array (one entry per attack for multiattack)
  const actions: Action[] = [];
  for (let i = 0; i < numAttacks; i++) {
    actions.push({
      ...attackAction,
      name: numAttacks > 1
        ? `${attackAction.name} (${i + 1}/${numAttacks})`
        : attackAction.name,
    });
  }

  return {
    id,
    name: `Celestial Spirit (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 30,
    flySpeed: 40,
    swimSpeed: null,
    burrowSpeed: null,
    str: 16,
    dex: 14,
    con: 14,
    int: 8,
    wis: 14,
    cha: 12,
    cr: 0,
    pos,
    actions,
    traits: [],
    legendaryActions: [],
    legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: {
      movementFt: 30,
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
    summonSpellName: 'Summon Celestial',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Summon Celestial.
 *
 * Preconditions:
 *   - Caster has 'Summon Celestial' in their actions
 *   - Caster has at least a 5th-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have a Summon Celestial active
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Summon Celestial')) return false;
  if (!hasSpellSlot(caster, 5)) return false;

  // Check if caster already has a Summon Celestial active
  const existingSummon = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Summon Celestial'
  );
  if (existingSummon) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Summon Celestial:
 *  1. Consume a spell slot (find the lowest available L5+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Summon Celestial.
 *  4. Create the Celestial Spirit combatant (built manually, NOT from bestiary).
 *  5. Add to battlefield combatants.
 *  6. Insert into initiative (pendingInitiativeInserts for after-caster insertion).
 *  7. Log the summon.
 */
export function execute(
  caster: Combatant,
  _target: Combatant,
  state: EngineState,
): void {
  const slotLevel = consumeSpellSlot(caster, 5);
  if (slotLevel === null) return; // no slot available (shouldn't happen if shouldCast is checked)

  // Break existing concentration (safety net)
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Summon Celestial');

  // v1 simplification: always pick 'Defender'
  const option: 'avenger' | 'defender' = 'defender';
  const summon = createCelestialSpirit(caster, slotLevel, option);

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
    `${caster.name} casts Summon Celestial (slot L${slotLevel}, ${option})! Celestial Spirit appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
    summon.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
