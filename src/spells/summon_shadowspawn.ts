// ============================================================
// Summon Shadowspawn — TCE p.113
//
// 3rd-level conjuration, action, range 30 ft, concentration (1 hr).
// Components: V, S, M (tear of a hero).
//
// Effect: You call forth a shadow spirit. It manifests in an
//         unoccupied space that you can see within range. This
//         corporeal form uses the Shadow Spirit stat block.
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
// Shadow Spirit Stat Block (TCE p.113):
//   AC: 11 + level of spell
//   HP: 30 + 10 per spell level above 3rd (30 at L3, 40 at L4, etc.)
//   Speed: 30 ft
//   STR 14, DEX 14, CON 12, INT 4, WIS 10, CHA 6
//   Attack: Bite +5, 1d6+2 piercing + 1d4 cold
//   Special: Target must make WIS save or be frightened
//   At L5+: Multiattack (2 attacks)
//
// v1 simplifications:
//   - Frighten condition NOT modelled (just damage)
//   - Summon always uses 'attackNearest' AI profile
//   - Position: always placed adjacent to caster (within 30 ft)
//   - No verbal command system integration (uses default profile)
//
// TCE summon stat blocks are NOT in the bestiary. They are built
// manually as Combatant objects via createShadowSpirit().
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
  name: 'Summon Shadowspawn',
  level: 3,
  school: 'conjuration',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  summonShadowspawnV1Implemented: true,
  summonShadowspawnUpcastV1Implemented: true,
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

// ---- Shadow Spirit stat block builder -----------------------

/**
 * Create a Shadow Spirit Combatant.
 * TCE summon stat blocks are NOT in the bestiary — they are built manually.
 *
 * @param caster    - the combatant who cast Summon Shadowspawn
 * @param slotLevel - the spell slot level used (3–9)
 */
export function createShadowSpirit(
  caster: Combatant,
  slotLevel: number,
): Combatant {
  const hp = 30 + 10 * (slotLevel - 3);
  const ac = 11 + slotLevel;
  const numAttacks = slotLevel >= 5 ? 2 : 1;

  // Build melee attack action(s)
  // Bite: +5 to hit, 1d6+2 piercing + 1d4 cold
  const attackAction: Action = {
    name: 'Bite',
    isMultiattack: numAttacks > 1,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 5,
    damage: { count: 1, sides: 6, bonus: 2, average: 6 },
    damageType: 'piercing',
    // Cold rider: 1d4 cold — v1: folded into description only; the engine's
    // damage resolver handles the primary dice.
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: `Bite: +5 to hit, 1d6+2 piercing plus 1d4 cold${numAttacks > 1 ? ' (Multiattack: 2 attacks)' : ''}`,
  };

  // Position: adjacent to caster (1 square away)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `summon_shadowspawn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

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
    name: `Shadow Spirit (${caster.name})`,
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
    con: 12,
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
    summonSpellName: 'Summon Shadowspawn',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Summon Shadowspawn.
 *
 * Preconditions:
 *   - Caster has 'Summon Shadowspawn' in their actions
 *   - Caster has at least a 3rd-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have a Summon Shadowspawn active
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Summon Shadowspawn')) return false;
  if (!hasSpellSlot(caster, 3)) return false;

  // Check if caster already has a Summon Shadowspawn active
  const existingSummon = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Summon Shadowspawn'
  );
  if (existingSummon) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Summon Shadowspawn:
 *  1. Consume a spell slot (find the lowest available L3+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Summon Shadowspawn.
 *  4. Create the Shadow Spirit combatant (built manually, NOT from bestiary).
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
  startConcentration(caster, 'Summon Shadowspawn');

  const summon = createShadowSpirit(caster, slotLevel);

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
    `${caster.name} casts Summon Shadowspawn (slot L${slotLevel})! Shadow Spirit appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
    summon.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
