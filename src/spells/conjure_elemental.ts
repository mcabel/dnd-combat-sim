// ============================================================
// Conjure Elemental — PHB p.225
//
// 5th-level conjuration, action, range 90 ft, concentration (1 hr).
// Components: V, S, M (burning incense for air; soft clay for earth;
//                    phosphorus for fire; water and sand for water).
//
// Effect: You call forth an elemental servant. Choose an area of air,
//         earth, fire, or water that fills a 10-foot cube within range.
//         An elemental of CR 5 or lower appropriate to the area you
//         chose appears in an unoccupied space within 10 feet of it.
//
//         The elemental disappears when it drops to 0 hit points or
//         when the spell ends.
//
//         The elemental is friendly to you and your companions for the
//         duration. Roll initiative for the elemental, which has its
//         own turns. It obeys verbal commands (no action required by
//         you). If you don't issue any, it defends itself from hostile
//         creatures but otherwise takes no actions.
//
//         If your concentration is broken, the elemental doesn't
//         disappear. Instead, you lose control of the elemental, it
//         becomes hostile toward you and your companions, and it might
//         attack. An uncontrolled elemental can't be dismissed by you,
//         and it disappears 1d4 hours after the spell ends.
//
//         At Higher Levels. When you cast this spell using a spell
//         slot of 6th level or higher, the CR of the elemental is
//         increased by 1 for each slot level above 5th.
//
// KEY DIFFERENCE FROM CONJURE ANIMALS:
//   Conjure Elemental summons a single elemental whose CR scales with
//   the slot level used (CR 5 at L5, CR 6 at L6, ..., CR 9 at L9).
//   v1 picks the Fire Elemental (CR 5) as the default at L5 — this is
//   the most iconic combat option. Upcast support is documented but
//   v1 still spawns the same Fire Elemental stat block regardless of
//   slot level (the Fire Elemental is CR 5 and therefore valid for
//   L5+ slots per the spell's CR-scaling rule).
//
// Fire Elemental Stat Block (MM p.125):
//   Large elemental, AC 13, HP 102 (12d10 + 36), Speed 50 ft
//   STR 10 (+0), DEX 17 (+3), CON 16 (+3), INT 6 (-2), WIS 10 (+0), CHA 7 (-2)
//   Damage Immunities: fire
//   Condition Immunities: exhaustion, grappled, paralyzed, petrified,
//                          poisoned, prone, restrained, unconscious
//   Senses: darkvision 60 ft, passive Perception 10
//   Languages: Ignan
//   Multiattack: The elemental makes two touch attacks.
//   Touch: +6 to hit, reach 5 ft, 2d6+3 fire damage (one target). If the
//          target is a creature or flammable object, it ignites. Until a
//          creature takes an action to douse the fire, the target takes
//          1d6 fire damage at the start of each of its turns.
//   Fire Form: The elemental can move through a space as narrow as 1 inch
//              without squeezing. A creature that touches the elemental or
//              hits it with a melee attack within 5 ft takes 1d6 fire damage.
//              The elemental can enter a hostile creature's space and stop
//              there. The first time it enters a creature's space on a turn,
//              that creature takes 1d6 fire damage and catches fire.
//
// v1 simplifications:
//   - Always picks the Fire Elemental (CR 5) for the default L5 cast
//   - Upcast L6-L9: same Fire Elemental stat block (still valid — CR 5
//     fits within the maxCR = slotLevel constraint). A future v2 should
//     pick higher-CR elementals (e.g. Salamander CR 5, Dao CR 11, etc.)
//     from the bestiary based on the slot level.
//   - Ignite-on-hit: NOT modelled in v1 (no ongoing-damage hook yet)
//   - Fire Form: NOT modelled in v1 (no occupy-hostile-space mechanic)
//   - Concentration break: the elemental does NOT become hostile (v1
//     uses the standard "despawn on concentration break" behaviour
//     shared with all TG-006 summons for engine consistency)
//   - Position: 1 square adjacent to caster
//   - Shares caster's initiative (insertAfter caster)
//
// Spell module pattern:
//   shouldCast(caster, bf) → boolean
//   execute(caster, target, state) → void
//   cleanup() — no-op
// ============================================================

import { Combatant, Battlefield, Action, AIProfile } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { CONJURE_ELEMENTAL_OPTIONS, DEFAULT_CE_OPTION } from '../summons/cr_picker';
// Session 43 Task #21: bestiary-driven summon selection.
import { pickConjureElementalSummon, buildSummonCombatant } from '../summons/summon_picker';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Conjure Elemental',
  level: 5,
  school: 'conjuration',
  rangeFt: 90,
  concentration: true,
  castingTime: 'action',
  conjureElementalV1Implemented: true,
  /** v1: hardcoded 1 Fire Elemental. Future: CR-picker from bestiary. */
  v1DefaultOption: DEFAULT_CE_OPTION.label,
  /** v1 simplification: always spawns Fire Elemental (CR 5) regardless of slot level */
  v1DefaultCreature: 'Fire Elemental',
  /** Upcast is documented but the stat block stays the same in v1 */
  conjureElementalUpcastV1Implemented: true,
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

// ---- Fire Elemental stat block builder ----------------------

/**
 * Create a Fire Elemental Combatant (MM p.125).
 *
 * Unlike TCE summons, PHB Conjure Elemental picks from the Monster Manual.
 * For v1 we build the Fire Elemental manually (same pattern as TCE stat
 * blocks). Future: use cr_picker.ts + monsterToCombatant when bestiary is
 * available, and pick the elemental type from the slot level.
 *
 * @param caster    - the combatant who cast Conjure Elemental
 * @param slotLevel - the spell slot level used (5–9). v1 ignores the slot
 *                    level and always uses the Fire Elemental stat block
 *                    (CR 5, valid for any L5+ slot per the spell text).
 */
export function createFireElemental(
  caster: Combatant,
  slotLevel: number,
): Combatant {
  // Fire Elemental stat block (MM p.125):
  // AC: 13, HP: 102 (12d10+36), Speed: 50 ft
  // STR 10, DEX 17, CON 16, INT 6, WIS 10, CHA 7
  // Multiattack: 2 touch attacks
  // Touch: +6 to hit, 2d6+3 fire damage
  const hp = 102;
  const ac = 13;
  const numAttacks = 2; // Multiattack

  const touchAction: Action = {
    name: 'Touch',
    isMultiattack: true,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 6,
    damage: { count: 2, sides: 6, bonus: 3, average: 10 },
    damageType: 'fire',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Touch: +6 to hit, reach 5 ft, 2d6+3 fire damage. (Multiattack: 2 touches)',
  };

  // Position: adjacent to caster (1 square away)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `conjure_elemental_fire_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Build attack actions array (one entry per attack for multiattack)
  const actions: Action[] = [];
  for (let i = 0; i < numAttacks; i++) {
    actions.push({
      ...touchAction,
      name: numAttacks > 1
        ? `${touchAction.name} (${i + 1}/${numAttacks})`
        : touchAction.name,
    });
  }

  return {
    id,
    name: `Fire Elemental (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 50,
    flySpeed: null,
    swimSpeed: null,
    burrowSpeed: null,
    str: 10,
    dex: 17,
    con: 16,
    int: 6,
    wis: 10,
    cha: 7,
    cr: 5,
    pos,
    actions,
    traits: ['Fire Form', 'Ignite', 'Water Susceptibility (half speed in water)'],
    legendaryActions: [],
    legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: {
      movementFt: 50,
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
    hasHands: false,
    wearingArmor: false,
    isDead: false,
    isUnconscious: false,
    advantages: [],
    vulnerabilities: [],
    // Fire Elemental: immune to fire (MM p.125).
    // Enforced via applyDamageWithTempHP's immunity check (PHB p.197).
    immunities: ['fire'],
    resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    // Summon subsystem (TG-006)
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Conjure Elemental',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Conjure Elemental.
 *
 * Preconditions:
 *   - Caster has 'Conjure Elemental' in their actions
 *   - Caster has at least a 5th-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have a Conjure Elemental active
 *     (cap at 1 — unlike Conjure Animals, Conjure Elemental summons a
 *     single powerful creature, not a pack)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Conjure Elemental')) return false;
  if (!hasSpellSlot(caster, 5)) return false;

  // Cap: don't summon if caster already has a Conjure Elemental active
  const existingSummon = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Elemental'
  );
  if (existingSummon) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Conjure Elemental:
 *  1. Consume a spell slot (find the lowest available L5+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Conjure Elemental.
 *  4. Create the Fire Elemental combatant (built manually, NOT from bestiary).
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
  startConcentration(caster, 'Conjure Elemental');

  // Session 43 Task #21: bestiary-driven summon selection.
  // Tries to pick the appropriate elemental from the bestiary based on
  // slot level (L5 → CR 5, L6 → CR 6, L7-L9 → highest available CR ≤ 9).
  // Falls back to the hardcoded createFireElemental() if the bestiary
  // is not loaded or no matching creature is found.
  const pick = pickConjureElementalSummon(slotLevel);
  let summon: Combatant;
  let summonName: string;
  if (pick) {
    summon = buildSummonCombatant(pick, caster, 'Conjure Elemental');
    summonName = pick.name;
  } else {
    // Fallback: hardcoded Fire Elemental stat block (v1 behavior).
    summon = createFireElemental(caster, slotLevel);
    summonName = 'Fire Elemental';
  }

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
    `${caster.name} casts Conjure Elemental (slot L${slotLevel})! ${summonName} appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
    summon.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
