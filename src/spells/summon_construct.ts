// ============================================================
// Summon Construct — TCE p.111
//
// 4th-level conjuration, action, range 30 ft, concentration (1 hr).
// Components: V, S, M (a tiny compass and a lock of hair from a
//            _constructor_).
//
// Effect: You call forth a construct spirit. It manifests in an
//         unoccupied space that you can see within range. This
//         corporeal form uses the Construct Spirit stat block.
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
// Construct Spirit Stat Block (TCE p.111):
//   AC: 13 + spell level
//   HP: 40 + 10 per spell level above 4th (40 at L4, 50 at L5, etc.)
//   Speed: 30 ft
//   STR 18, DEX 10, CON 14, INT 4, WIS 10, CHA 6
//   Attack: Slam +6, 1d8+4 bludgeoning
//   At L5+: Multiattack (2 attacks)
//
// v1 simplifications:
//   - No option picker (all options are similar enough)
//   - Summon always uses 'attackNearest' AI profile
//   - Position: always placed adjacent to caster (within 30 ft)
//   - No verbal command system integration (uses default profile)
//
// TCE summon stat blocks are NOT in the bestiary. They are built
// manually as Combatant objects via createConstructSpirit().
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
  name: 'Summon Construct',
  level: 4,
  school: 'conjuration',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  summonConstructV1Implemented: true,
  summonConstructUpcastV1Implemented: true,
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

// ---- Construct Spirit stat block builder ---------------------

/**
 * Create a Construct Spirit Combatant.
 * TCE summon stat blocks are NOT in the bestiary — they are built manually.
 *
 * @param caster    - the combatant who cast Summon Construct
 * @param slotLevel - the spell slot level used (4–9)
 */
export function createConstructSpirit(
  caster: Combatant,
  slotLevel: number,
): Combatant {
  const hp = 40 + 10 * (slotLevel - 4);
  const ac = 13 + slotLevel;
  const numAttacks = slotLevel >= 5 ? 2 : 1;

  // Build melee attack action(s)
  // Slam: +6 to hit, 1d8+4 bludgeoning
  const attackAction: Action = {
    name: 'Slam',
    isMultiattack: numAttacks > 1,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 6,
    damage: { count: 1, sides: 8, bonus: 4, average: 9 },
    damageType: 'bludgeoning',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: `Slam: +6 to hit, 1d8+4 bludgeoning${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
  };

  // Position: adjacent to caster (1 square away)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `summon_construct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Build attack actions array (one entry per attack for multiattack)
  const actions: Action[] = [];
  for (let i = 0; i < numAttacks; i++) {
    actions.push({
      ...attackAction,
      name: numAttacks > 1 ? `Slam (${i + 1}/${numAttacks})` : 'Slam',
    });
  }

  return {
    id,
    name: `Construct Spirit (${caster.name})`,
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
    dex: 10,
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
    summonSpellName: 'Summon Construct',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Summon Construct.
 *
 * Preconditions:
 *   - Caster has 'Summon Construct' in their actions
 *   - Caster has at least a 4th-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have a Summon Construct active
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Summon Construct')) return false;
  if (!hasSpellSlot(caster, 4)) return false;

  // Check if caster already has a Summon Construct active
  const existingSummon = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Summon Construct'
  );
  if (existingSummon) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Summon Construct:
 *  1. Consume a spell slot (find the lowest available L4+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Summon Construct.
 *  4. Create the Construct Spirit combatant (built manually, NOT from bestiary).
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
  startConcentration(caster, 'Summon Construct');

  const summon = createConstructSpirit(caster, slotLevel);

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
    `${caster.name} casts Summon Construct (slot L${slotLevel})! Construct Spirit appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
    summon.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
