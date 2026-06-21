// ============================================================
// Summon Undead — TCE p.113
//
// 3rd-level necromancy, action, range 30 ft, concentration (1 hr).
// Components: V, S, M (a finger bone).
//
// Effect: You call forth an undead spirit. It manifests in an
//         unoccupied space that you can see within range. This
//         corporeal form uses the Undead Spirit stat block. When
//         you cast this spell, choose one of the following options:
//         Ghostly, Putrid, or Skeletal.
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
// Undead Spirit Stat Block (TCE p.113):
//   AC: 11 + level of spell
//   HP: 30 + 10 per spell level above 3rd (30 at L3, 40 at L4, etc.)
//   Speed: Putrid 20 ft + climb 20 ft; Ghostly 30 ft fly; Skeletal 30 ft
//   STR 12, DEX 14, CON 12, INT 6, WIS 10, CHA 8
//   Attack varies by option:
//     Ghostly:  Wisdom Drain +5, 1d6+2 necrotic (disadv on next attack)
//     Putrid:   Rotting Claw +5, 1d6+2 slashing + 1d6 poison
//     Skeletal: Longbow +5, 1d8+2 piercing (ranged, 150 ft)
//   At L5+: Multiattack (2 attacks)
//
// v1 simplifications:
//   - Always picks 'Putrid' option (melee, most straightforward)
//   - Ghostly's Wisdom Drain disadv NOT modelled (just damage)
//   - Skeletal's ranged option NOT modelled (would need different AI)
//   - Summon always uses 'attackNearest' AI profile
//   - Position: always placed adjacent to caster (within 30 ft)
//   - No verbal command system integration (uses default profile)
//
// TCE summon stat blocks are NOT in the bestiary. They are built
// manually as Combatant objects via createUndeadSpirit().
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
  name: 'Summon Undead',
  level: 3,
  school: 'necromancy',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  summonUndeadV1Implemented: true,
  summonUndeadUpcastV1Implemented: true,
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

// ---- Undead Spirit stat block builder -----------------------

/**
 * Create an Undead Spirit Combatant.
 * TCE summon stat blocks are NOT in the bestiary — they are built manually.
 *
 * @param caster    - the combatant who cast Summon Undead
 * @param slotLevel - the spell slot level used (3–9)
 * @param option    - 'ghostly', 'putrid', or 'skeletal' (v1: always 'putrid')
 */
export function createUndeadSpirit(
  caster: Combatant,
  slotLevel: number,
  option: 'ghostly' | 'putrid' | 'skeletal' = 'putrid',
): Combatant {
  const hp = 30 + 10 * (slotLevel - 3);
  const ac = 11 + slotLevel;
  const numAttacks = slotLevel >= 5 ? 2 : 1;

  // Build attack action based on option
  let attackAction: Action;
  let speed = 30;
  let climbSpeed = 0;
  let flySpeed: number | null = null;

  if (option === 'ghostly') {
    // Wisdom Drain: +5, 1d6+2 necrotic
    attackAction = {
      name: 'Wisdom Drain',
      isMultiattack: numAttacks > 1,
      attackType: 'melee',
      reach: 5,
      range: { normal: 5, long: 5 },
      hitBonus: 5,
      damage: { count: 1, sides: 6, bonus: 2, average: 6 },
      damageType: 'necrotic',
      saveDC: null,
      saveAbility: null,
      isAoE: false,
      isControl: false,
      requiresConcentration: false,
      slotLevel: 0,
      costType: 'action',
      legendaryCost: 0,
      description: `Wisdom Drain: +5 to hit, 1d6+2 necrotic${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
    };
    flySpeed = 30;
  } else if (option === 'skeletal') {
    // Longbow: +5, 1d8+2 piercing (ranged, 150 ft)
    attackAction = {
      name: 'Longbow',
      isMultiattack: numAttacks > 1,
      attackType: 'ranged',
      reach: 150,
      range: { normal: 150, long: 600 },
      hitBonus: 5,
      damage: { count: 1, sides: 8, bonus: 2, average: 7 },
      damageType: 'piercing',
      saveDC: null,
      saveAbility: null,
      isAoE: false,
      isControl: false,
      requiresConcentration: false,
      slotLevel: 0,
      costType: 'action',
      legendaryCost: 0,
      description: `Longbow: +5 to hit, 1d8+2 piercing (range 150/600)${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
    };
  } else {
    // Putrid: Rotting Claw +5, 1d6+2 slashing + 1d6 poison
    attackAction = {
      name: 'Rotting Claw',
      isMultiattack: numAttacks > 1,
      attackType: 'melee',
      reach: 5,
      range: { normal: 5, long: 5 },
      hitBonus: 5,
      damage: { count: 1, sides: 6, bonus: 2, average: 6 },
      damageType: 'slashing',
      saveDC: null,
      saveAbility: null,
      isAoE: false,
      isControl: false,
      requiresConcentration: false,
      slotLevel: 0,
      costType: 'action',
      legendaryCost: 0,
      description: `Rotting Claw: +5 to hit, 1d6+2 slashing plus 1d6 poison${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
    };
    speed = 20;
    climbSpeed = 20;
  }

  // Position: adjacent to caster (1 square away)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `summon_undead_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

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
    name: `Undead Spirit (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed,
    flySpeed,
    swimSpeed: null,
    burrowSpeed: null,
    str: 12,
    dex: 14,
    con: 12,
    int: 6,
    wis: 10,
    cha: 8,
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
    summonSpellName: 'Summon Undead',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Summon Undead.
 *
 * Preconditions:
 *   - Caster has 'Summon Undead' in their actions
 *   - Caster has at least a 3rd-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have a Summon Undead active
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Summon Undead')) return false;
  if (!hasSpellSlot(caster, 3)) return false;

  // Check if caster already has a Summon Undead active
  const existingSummon = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Summon Undead'
  );
  if (existingSummon) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Summon Undead:
 *  1. Consume a spell slot (find the lowest available L3+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Summon Undead.
 *  4. Create the Undead Spirit combatant (built manually, NOT from bestiary).
 *  5. Add to battlefield combatants.
 *  6. Insert into initiative (pendingInitiativeInserts for after-caster insertion).
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
  startConcentration(caster, 'Summon Undead');

  // v1 simplification: always pick 'Putrid'
  const option: 'ghostly' | 'putrid' | 'skeletal' = 'putrid';
  const summon = createUndeadSpirit(caster, slotLevel, option);

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
    `${caster.name} casts Summon Undead (slot L${slotLevel}, ${option})! Undead Spirit appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
    summon.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
