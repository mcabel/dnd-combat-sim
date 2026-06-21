// ============================================================
// Summon Aberration — TCE p.110
//
// 4th-level conjuration, action, range 30 ft, concentration (1 hr).
// Components: V, S, M (a pickled tentacle and an eyeball in a
//             platinum-inlaid vial).
//
// Effect: You call forth an aberrant spirit. It manifests in an
//         unoccupied space that you can see within range. This
//         corporeal form uses the Aberrant Spirit stat block.
//         When you cast this spell, choose one of the following
//         options: "Beholderkin", "Slaad", or "Star Spawn".
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
// Aberrant Spirit Stat Block (TCE p.110):
//   AC: 11 + spell level
//   HP: 40 + 10 per spell level above 4th (40 at L4, 50 at L5, etc.)
//   Speed: 30 ft (fly 30 ft for Beholderkin)
//   STR 16, DEX 10, CON 15, INT 6, WIS 10, CHA 6
//   Attack varies by option:
//     Beholderkin: Eye Ray +5, 2d8 psychic (ranged, 60 ft)
//     Slaad:       Claw +5, 1d8+3 slashing + 1d6 acid
//     Star Spawn:  Claw +5, 1d8+3 slashing + 1d8 psychic
//   At L5+: Multiattack (2 attacks)
//
// v1 simplifications:
//   - Always picks 'Slaad' option (melee, most straightforward)
//   - Summon always uses 'attackNearest' AI profile
//   - Position: always placed adjacent to caster (within 30 ft)
//   - No verbal command system integration (uses default profile)
//
// TCE summon stat blocks are NOT in the bestiary. They are built
// manually as Combatant objects via createAberrantSpirit().
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
  name: 'Summon Aberration',
  level: 4,
  school: 'conjuration',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  summonAberrationV1Implemented: true,
  summonAberrationUpcastV1Implemented: true,
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

// ---- Aberrant Spirit stat block builder ----------------------

/**
 * Create an Aberrant Spirit Combatant.
 * TCE summon stat blocks are NOT in the bestiary — they are built manually.
 *
 * @param caster    - the combatant who cast Summon Aberration
 * @param slotLevel - the spell slot level used (4–9)
 * @param option    - 'beholderkin', 'slaad', or 'starSpawn' (v1: always 'slaad')
 */
export function createAberrantSpirit(
  caster: Combatant,
  slotLevel: number,
  option: 'beholderkin' | 'slaad' | 'starSpawn' = 'slaad',
): Combatant {
  const hp = 40 + 10 * (slotLevel - 4);
  const ac = 11 + slotLevel;
  const numAttacks = slotLevel >= 5 ? 2 : 1;

  // Build attack action based on option
  let attackAction: Action;
  let speed = 30;
  let flySpeed: number | null = null;

  if (option === 'beholderkin') {
    // Eye Ray: +5, 2d8 psychic (ranged, 60 ft)
    attackAction = {
      name: 'Eye Ray',
      isMultiattack: numAttacks > 1,
      attackType: 'ranged',
      reach: 60,
      range: { normal: 60, long: 60 },
      hitBonus: 5,
      damage: { count: 2, sides: 8, bonus: 0, average: 9 },
      damageType: 'psychic',
      saveDC: null,
      saveAbility: null,
      isAoE: false,
      isControl: false,
      requiresConcentration: false,
      slotLevel: 0,
      costType: 'action',
      legendaryCost: 0,
      description: `Eye Ray: +5 to hit, 2d8 psychic (range 60 ft)${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
    };
    flySpeed = 30;
  } else if (option === 'starSpawn') {
    // Claw: +5, 1d8+3 slashing + 1d8 psychic
    attackAction = {
      name: 'Claw',
      isMultiattack: numAttacks > 1,
      attackType: 'melee',
      reach: 5,
      range: { normal: 5, long: 5 },
      hitBonus: 5,
      damage: { count: 1, sides: 8, bonus: 3, average: 8 },
      damageType: 'slashing',
      // Psychic rider: 1d8 — v1: folded into description only
      saveDC: null,
      saveAbility: null,
      isAoE: false,
      isControl: false,
      requiresConcentration: false,
      slotLevel: 0,
      costType: 'action',
      legendaryCost: 0,
      description: `Claw: +5 to hit, 1d8+3 slashing plus 1d8 psychic${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
    };
  } else {
    // Slaad: Claw +5, 1d8+3 slashing + 1d6 acid
    attackAction = {
      name: 'Claw',
      isMultiattack: numAttacks > 1,
      attackType: 'melee',
      reach: 5,
      range: { normal: 5, long: 5 },
      hitBonus: 5,
      damage: { count: 1, sides: 8, bonus: 3, average: 8 },
      damageType: 'slashing',
      // Acid rider: 1d6 — v1: folded into description only
      saveDC: null,
      saveAbility: null,
      isAoE: false,
      isControl: false,
      requiresConcentration: false,
      slotLevel: 0,
      costType: 'action',
      legendaryCost: 0,
      description: `Claw: +5 to hit, 1d8+3 slashing plus 1d6 acid${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
    };
  }

  // Position: adjacent to caster (1 square away)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `summon_aberration_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

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
    name: `Aberrant Spirit (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed,
    flySpeed,
    swimSpeed: null,
    burrowSpeed: null,
    str: 16,
    dex: 10,
    con: 15,
    int: 6,
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
    summonSpellName: 'Summon Aberration',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Summon Aberration.
 *
 * Preconditions:
 *   - Caster has 'Summon Aberration' in their actions
 *   - Caster has at least a 4th-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have a Summon Aberration active
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Summon Aberration')) return false;
  if (!hasSpellSlot(caster, 4)) return false;

  // Check if caster already has a Summon Aberration active
  const existingSummon = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Summon Aberration'
  );
  if (existingSummon) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Summon Aberration:
 *  1. Consume a spell slot (find the lowest available L4+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Summon Aberration.
 *  4. Create the Aberrant Spirit combatant (built manually, NOT from bestiary).
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
  startConcentration(caster, 'Summon Aberration');

  // v1 simplification: always pick 'Slaad'
  const option: 'beholderkin' | 'slaad' | 'starSpawn' = 'slaad';
  const summon = createAberrantSpirit(caster, slotLevel, option);

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
    `${caster.name} casts Summon Aberration (slot L${slotLevel}, ${option})! Aberrant Spirit appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
    summon.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
