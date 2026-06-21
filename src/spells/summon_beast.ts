// ============================================================
// Summon Beast — TCE p.111
//
// 2nd-level conjuration, action, range 30 ft, concentration (1 hr).
// Components: V, S, M (a feather, tuft of fur, and fish inside a
//             gilt-lined crab claw).
//
// Effect: You call forth a bestial spirit. It manifests in an
//         unoccupied space that you can see within range. This
//         corporeal form uses the Bestial Spirit stat block. When
//         you cast this spell, choose one of the following options:
//         Air, Land, or Water.
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
// Bestial Spirit Stat Block (TCE p.111):
//   AC: 11 + level of spell
//   HP: 20 + 5 per spell level above 2nd (20 at L2, 25 at L3, etc.)
//   Speed: Air 30 ft fly / Land 30 ft climb / Water 30 ft swim
//           (all also have 30 ft base speed)
//   STR 14, DEX 12, CON 13, INT 4, WIS 10, CHA 6
//   Multiattack: 2 attacks at L5+ slot
//   Attack: +5 to hit, 1d6+2 bludgeoning/piercing/slashing
//
// v1 simplifications:
//   - Always picks 'Land' option (most common for melee combat)
//   - No multiattack at L5+ yet (forward-compat flag)
//   - Summon always uses 'attackNearest' AI profile
//   - Position: always placed adjacent to caster (within 30 ft)
//   - No verbal command system integration (uses default profile)
//
// TCE summon stat blocks are NOT in the bestiary. They are built
// manually as Combatant objects via createBestialSpirit().
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
  name: 'Summon Beast',
  level: 2,
  school: 'conjuration',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  summonBeastV1Implemented: true,
  summonBeastUpcastV1Implemented: true,
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

// ---- Bestial Spirit stat block builder ----------------------

/**
 * Create a Bestial Spirit Combatant.
 * TCE summon stat blocks are NOT in the bestiary — they are built manually.
 *
 * @param caster   - the combatant who cast Summon Beast
 * @param slotLevel - the spell slot level used (2–9)
 * @param option   - 'air', 'land', or 'water' (v1: always 'land')
 */
export function createBestialSpirit(
  caster: Combatant,
  slotLevel: number,
  option: 'air' | 'land' | 'water' = 'land',
): Combatant {
  const hp = 20 + 5 * (slotLevel - 2);
  const ac = 11 + slotLevel;
  const numAttacks = slotLevel >= 5 ? 2 : 1;

  // Build melee attack action(s)
  const attackAction: Action = {
    name: 'Maul',
    isMultiattack: numAttacks > 1,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 5,
    damage: { count: 1, sides: 6, bonus: 2, average: 6 },
    damageType: 'bludgeoning',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: `Maul: +5 to hit, 1d6+2 bludgeoning${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
  };

  // Position: adjacent to caster (1 square away)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  // Speed based on option
  let speed = 30;
  let flySpeed: number | null = null;
  let swimSpeed: number | null = null;
  let climbSpeed = 0;
  if (option === 'air') {
    flySpeed = 30;
  } else if (option === 'land') {
    climbSpeed = 30;
  } else if (option === 'water') {
    swimSpeed = 30;
  }

  const id = `summon_beast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Build attack actions array (one entry per attack for multiattack)
  const actions: Action[] = [];
  for (let i = 0; i < numAttacks; i++) {
    actions.push({
      ...attackAction,
      name: numAttacks > 1 ? `Maul (${i + 1}/${numAttacks})` : 'Maul',
    });
  }

  return {
    id,
    name: `Bestial Spirit (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed,
    flySpeed,
    swimSpeed,
    burrowSpeed: null,
    str: 14,
    dex: 12,
    con: 13,
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
    summonSpellName: 'Summon Beast',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Summon Beast.
 *
 * Preconditions:
 *   - Caster has 'Summon Beast' in their actions
 *   - Caster has at least a 2nd-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have a Summon Beast active
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Summon Beast')) return false;
  if (!hasSpellSlot(caster, 2)) return false;

  // Check if caster already has a Summon Beast active
  const existingSummon = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Summon Beast'
  );
  if (existingSummon) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Summon Beast:
 *  1. Consume a spell slot (find the lowest available L2+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Summon Beast.
 *  4. Create the Bestial Spirit combatant (built manually, NOT from bestiary).
 *  5. Add to battlefield combatants.
 *  6. Insert into initiative (pendingInitiativeInserts for after-caster insertion).
 *  7. Log the summon.
 */
export function execute(
  caster: Combatant,
  _target: Combatant,
  state: EngineState,
): void {
  const slotLevel = consumeSpellSlot(caster, 2);
  if (slotLevel === null) return; // no slot available (shouldn't happen if shouldCast is checked)

  // Break existing concentration (safety net)
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Summon Beast');

  // v1 simplification: always pick 'Land'
  const option: 'air' | 'land' | 'water' = 'land';
  const summon = createBestialSpirit(caster, slotLevel, option);

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
    `${caster.name} casts Summon Beast (slot L${slotLevel}, ${option})! Bestial Spirit appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
    summon.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
