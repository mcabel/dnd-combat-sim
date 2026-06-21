// ============================================================
// Summon Greater Demon — XGE p.166
//
// 4th-level conjuration, action, range 60 ft, concentration (1 min).
// Components: V, S, M (a vial of blood from a humanoid killed
//             within the past 24 hours).
//
// Effect: You summon a demon from the chaos of the Abyss. You
//         choose the demon's type, which must be one of CR 5 or
//         lower. The demon disappears when it drops to 0 hit
//         points or when the spell ends.
//
// At the end of each of the demon's turns, it makes a CHA save
// against your spell DC. On a success, it breaks free and turns
// hostile to all non-demons (including the caster).
//
// v1 simplification: always summon a Barlgura (CR 5), no break-free
// mechanic — faction = caster's faction.
//
// Barlgura Stat Block (MM p.56):
//   AC: 15, HP: 52 + 15 per spell level above 4th
//   Speed: 30 ft, climb 30 ft
//   STR 18, DEX 13, CON 14, INT 7, WIS 6, CHA 6
//   Attack: Bite +6, 1d8+4 piercing + Claws +6, 1d10+4 slashing (Multiattack)
//
// v1 simplifications:
//   - Always picks Barlgura (CR 5, most common L4 choice)
//   - No break-free mechanic (faction = caster's faction)
//   - Multiattack: Bite + Claws modelled as 2 separate attack actions
//   - Summon always uses 'attackNearest' AI profile
//   - Position: always placed adjacent to caster (within 60 ft)
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
  name: 'Summon Greater Demon',
  level: 4,
  school: 'conjuration',
  rangeFt: 60,
  concentration: true,
  castingTime: 'action',
  summonGreaterDemonV1Implemented: true,
  summonGreaterDemonUpcastV1Implemented: true,
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

// ---- Barlgura stat block builder -----------------------------

/**
 * Create a Barlgura Combatant.
 * XGE summon stat blocks are NOT in the bestiary — they are built manually.
 *
 * @param caster    - the combatant who cast Summon Greater Demon
 * @param slotLevel - the spell slot level used (4–9)
 */
export function createBarlgura(
  caster: Combatant,
  slotLevel: number,
): Combatant {
  const hp = 52 + 15 * (slotLevel - 4);
  const ac = 15;

  // Multiattack: Bite + Claws (2 separate attack actions)
  const biteAction: Action = {
    name: 'Bite',
    isMultiattack: true,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 6,
    damage: { count: 1, sides: 8, bonus: 4, average: 9 },
    damageType: 'piercing',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Bite: +6 to hit, 1d8+4 piercing',
  };

  const clawsAction: Action = {
    name: 'Claws',
    isMultiattack: true,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 6,
    damage: { count: 1, sides: 10, bonus: 4, average: 10 },
    damageType: 'slashing',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Claws: +6 to hit, 1d10+4 slashing',
  };

  // Position: adjacent to caster (1 square away)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `summon_greater_demon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    name: `Barlgura (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 30,
    flySpeed: null,
    swimSpeed: null,
    burrowSpeed: null,
    str: 18,
    dex: 13,
    con: 14,
    int: 7,
    wis: 6,
    cha: 6,
    cr: 5,
    pos,
    actions: [biteAction, clawsAction],
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
    summonSpellName: 'Summon Greater Demon',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Summon Greater Demon.
 *
 * Preconditions:
 *   - Caster has 'Summon Greater Demon' in their actions
 *   - Caster has at least a 4th-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have a Summon Greater Demon active
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Summon Greater Demon')) return false;
  if (!hasSpellSlot(caster, 4)) return false;

  // Check if caster already has a Summon Greater Demon active
  const existingSummon = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Summon Greater Demon'
  );
  if (existingSummon) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Summon Greater Demon:
 *  1. Consume a spell slot (find the lowest available L4+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Summon Greater Demon.
 *  4. Create the Barlgura combatant (built manually, NOT from bestiary).
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
  startConcentration(caster, 'Summon Greater Demon');

  const summon = createBarlgura(caster, slotLevel);

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
    `${caster.name} casts Summon Greater Demon (slot L${slotLevel})! Barlgura appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
    summon.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
