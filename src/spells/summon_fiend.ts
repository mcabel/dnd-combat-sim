// ============================================================
// Summon Fiend — TCE p.112
//
// 6th-level conjuration, action, range 30 ft, concentration (1 hr).
// Components: V, S, M (a vial of blood from an intelligent humanoid
//             killed within the past 24 hours).
//
// Effect: You call forth a fiendish spirit. It manifests in an
//         unoccupied space that you can see within range. This
//         corporeal form uses the Fiendish Spirit stat block.
//         When you cast this spell, choose "Demon", "Devil",
//         or "Yugoloth".
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
// Fiendish Spirit Stat Block (TCE p.112):
//   AC: 13 + spell level
//   HP: 60 + 10 per spell level above 6th (60 at L6, 70 at L7, etc.)
//   Speed: 30 ft
//   STR 14, DEX 14, CON 14, INT 6, WIS 10, CHA 8
//   Multiattack: 2 attacks at L7+ slot
//   Attack varies by option:
//     Demon:    Bite +5, 1d8+2 piercing + 1d6 poison
//     Devil:    Fiendish Blade +5, 1d8+2 slashing + 1d6 fire
//     Yugoloth: Claws +5, 1d8+2 slashing + 1d6 necrotic
//
// v1 simplifications:
//   - Always picks 'Devil' option (fire + slashing, iconic)
//   - Primary damage is slashing (1d8+2), fire rider (1d6)
//     modelled as single-damage-type slashing for v1
//   - Summon always uses 'attackNearest' AI profile
//   - Position: always placed adjacent to caster (within 30 ft)
//   - No verbal command system integration (uses default profile)
//
// TCE summon stat blocks are NOT in the bestiary. They are built
// manually as Combatant objects via createFiendishSpirit().
//
// Spell module pattern:
//   shouldCast(caster, bf) → boolean
//   execute(caster, target, state) → void
//   cleanup() — no-op
// ============================================================

import { Combatant, Battlefield, Action, AIProfile, DamageType } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollDie } from '../engine/utils';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Summon Fiend',
  level: 6,
  school: 'conjuration',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  summonFiendV1Implemented: true,
  summonFiendUpcastV1Implemented: true,
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

// ---- Fiendish Spirit stat block builder ---------------------

type FiendOption = 'demon' | 'devil' | 'yugoloth';

const FIEND_ATTACK: Record<FiendOption, { name: string; damageType: DamageType; riderDamageType: DamageType }> = {
  demon:    { name: 'Bite',           damageType: 'piercing', riderDamageType: 'poison' },
  devil:    { name: 'Fiendish Blade', damageType: 'slashing', riderDamageType: 'fire' },
  yugoloth: { name: 'Claws',          damageType: 'slashing', riderDamageType: 'necrotic' },
};

/**
 * Create a Fiendish Spirit Combatant.
 * TCE summon stat blocks are NOT in the bestiary — they are built manually.
 *
 * @param caster    - the combatant who cast Summon Fiend
 * @param slotLevel - the spell slot level used (6–9)
 * @param option    - 'demon', 'devil', or 'yugoloth' (v1: always 'devil')
 */
export function createFiendishSpirit(
  caster: Combatant,
  slotLevel: number,
  option: FiendOption = 'devil',
): Combatant {
  const hp = 60 + 10 * (slotLevel - 6);
  const ac = 13 + slotLevel;
  const numAttacks = slotLevel >= 7 ? 2 : 1;

  const fiendInfo = FIEND_ATTACK[option];

  // Attack: +5 to hit, 1d8+2 primary + 1d6 rider
  // v1: model as single damage type (primary only — rider noted in description)
  const attackAction: Action = {
    name: fiendInfo.name,
    isMultiattack: numAttacks > 1,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 5,
    damage: { count: 1, sides: 8, bonus: 2, average: 7 },
    damageType: fiendInfo.damageType,
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: `${fiendInfo.name}: +5 to hit, 1d8+2 ${fiendInfo.damageType} + 1d6 ${fiendInfo.riderDamageType}${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
  };

  // Position: adjacent to caster (1 square away)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `summon_fiend_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Build attack actions array (one entry per attack for multiattack)
  const actions: Action[] = [];
  for (let i = 0; i < numAttacks; i++) {
    actions.push({
      ...attackAction,
      name: numAttacks > 1 ? `${fiendInfo.name} (${i + 1}/${numAttacks})` : fiendInfo.name,
    });
  }

  return {
    id,
    name: `Fiendish Spirit (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 30,
    flySpeed: null,
    swimSpeed: null,
    burrowSpeed: null,
    str: 14,
    dex: 14,
    con: 14,
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
    summonSpellName: 'Summon Fiend',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Summon Fiend.
 *
 * Preconditions:
 *   - Caster has 'Summon Fiend' in their actions
 *   - Caster has at least a 6th-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have a Summon Fiend active
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Summon Fiend')) return false;
  if (!hasSpellSlot(caster, 6)) return false;

  // Check if caster already has a Summon Fiend active
  const existingSummon = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Summon Fiend'
  );
  if (existingSummon) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Summon Fiend:
 *  1. Consume a spell slot (find the lowest available L6+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Summon Fiend.
 *  4. Create the Fiendish Spirit combatant (built manually, NOT from bestiary).
 *  5. Add to battlefield combatants.
 *  6. Insert into initiative (pendingInitiativeInserts for after-caster insertion).
 *  7. Log the summon.
 */
export function execute(
  caster: Combatant,
  _target: Combatant,
  state: EngineState,
): void {
  const slotLevel = consumeSpellSlot(caster, 6);
  if (slotLevel === null) return; // no slot available (shouldn't happen if shouldCast is checked)

  // Break existing concentration (safety net)
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Summon Fiend');

  // v1 simplification: always pick 'Devil'
  const option: FiendOption = 'devil';
  const summon = createFiendishSpirit(caster, slotLevel, option);

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
    `${caster.name} casts Summon Fiend (slot L${slotLevel}, ${option})! Fiendish Spirit appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
    summon.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
