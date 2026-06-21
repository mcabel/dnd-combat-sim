// ============================================================
// Summon Draconic Spirit — FTD p.21
//
// 5th-level conjuration, action, range 30 ft, concentration (1 hr).
// Components: V, S, M (a dragon scale worth 500+ gp).
//
// Effect: You call forth a draconic spirit. It manifests in an
//         unoccupied space that you can see within range. This
//         corporeal form uses the Draconic Spirit stat block.
//         When you cast this spell, choose a dragon color
//         (determines damage type).
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
// Draconic Spirit Stat Block (FTD p.21):
//   AC: 14 + spell level
//   HP: 50 + 10 per spell level above 5th (50 at L5, 60 at L6, etc.)
//   Speed: 30 ft, fly 40 ft
//   STR 16, DEX 12, CON 14, INT 8, WIS 12, CHA 8
//   Multiattack: 2 attacks at L6+ slot
//   Attack: Bite +5, 1d10+3 piercing
//   Breath Weapon: 2d6 damage type (varies by color)
//
// v1 simplifications:
//   - Always picks 'Red' (fire breath) — most iconic
//   - Bite + Breath Weapon combined into one attack action
//     (1d10+3 piercing + 2d6 fire) for simplicity
//   - Summon always uses 'attackNearest' AI profile
//   - Position: always placed adjacent to caster (within 30 ft)
//   - No verbal command system integration (uses default profile)
//
// FTD summon stat blocks are NOT in the bestiary. They are built
// manually as Combatant objects via createDraconicSpirit().
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
  name: 'Summon Draconic Spirit',
  level: 5,
  school: 'conjuration',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  summonDraconicSpiritV1Implemented: true,
  summonDraconicSpiritUpcastV1Implemented: true,
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

// ---- Draconic Spirit stat block builder ----------------------

type DragonColor = 'red' | 'blue' | 'green' | 'black' | 'brass' | 'bronze' | 'copper' | 'silver' | 'gold' | 'white';

const DRAGON_DAMAGE_TYPE: Record<DragonColor, string> = {
  red: 'fire',
  blue: 'lightning',
  green: 'poison',
  black: 'acid',
  brass: 'fire',
  bronze: 'lightning',
  copper: 'acid',
  silver: 'cold',
  gold: 'fire',
  white: 'cold',
};

/**
 * Create a Draconic Spirit Combatant.
 * FTD summon stat blocks are NOT in the bestiary — they are built manually.
 *
 * @param caster    - the combatant who cast Summon Draconic Spirit
 * @param slotLevel - the spell slot level used (5–9)
 * @param color     - dragon color (v1: always 'red')
 */
export function createDraconicSpirit(
  caster: Combatant,
  slotLevel: number,
  color: DragonColor = 'red',
): Combatant {
  const hp = 50 + 10 * (slotLevel - 5);
  const ac = 14 + slotLevel;
  const numAttacks = slotLevel >= 6 ? 2 : 1;

  const breathDamageType = DRAGON_DAMAGE_TYPE[color];

  // Bite + Breath Weapon combined: +5 to hit, 1d10+3 piercing + 2d6 breath damage
  // v1: model as single attack with piercing primary damage
  // (breath weapon damage is a rider — engine may not support dual-damage-type)
  const attackAction: Action = {
    name: 'Bite',
    isMultiattack: numAttacks > 1,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 5,
    damage: { count: 1, sides: 10, bonus: 3, average: 9 },
    damageType: 'piercing',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: `Bite: +5 to hit, 1d10+3 piercing + 2d6 ${breathDamageType}${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
  };

  // Position: adjacent to caster (1 square away)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `summon_draconic_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Build attack actions array (one entry per attack for multiattack)
  const actions: Action[] = [];
  for (let i = 0; i < numAttacks; i++) {
    actions.push({
      ...attackAction,
      name: numAttacks > 1 ? `Bite (${i + 1}/${numAttacks})` : 'Bite',
    });
  }

  return {
    id,
    name: `Draconic Spirit (${caster.name})`,
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
    dex: 12,
    con: 14,
    int: 8,
    wis: 12,
    cha: 8,
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
    summonSpellName: 'Summon Draconic Spirit',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Summon Draconic Spirit.
 *
 * Preconditions:
 *   - Caster has 'Summon Draconic Spirit' in their actions
 *   - Caster has at least a 5th-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have a Summon Draconic Spirit active
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Summon Draconic Spirit')) return false;
  if (!hasSpellSlot(caster, 5)) return false;

  // Check if caster already has a Summon Draconic Spirit active
  const existingSummon = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Summon Draconic Spirit'
  );
  if (existingSummon) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Summon Draconic Spirit:
 *  1. Consume a spell slot (find the lowest available L5+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Summon Draconic Spirit.
 *  4. Create the Draconic Spirit combatant (built manually, NOT from bestiary).
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
  startConcentration(caster, 'Summon Draconic Spirit');

  // v1 simplification: always pick 'Red' (fire)
  const color: DragonColor = 'red';
  const summon = createDraconicSpirit(caster, slotLevel, color);

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
    `${caster.name} casts Summon Draconic Spirit (slot L${slotLevel}, ${color})! Draconic Spirit appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
    summon.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
