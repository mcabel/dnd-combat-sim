// ============================================================
// Conjure Minor Elementals — PHB p.226
//
// 4th-level conjuration, action, range 90 ft, concentration (1 hr).
// Components: V, S.
//
// Effect: You summon elementals that appear in unoccupied spaces that
//         you can see within range. Choose one of the following:
//           - One elemental of CR 2 or lower
//           - Two elementals of CR 1 or lower
//           - Four elementals of CR 1/2 or lower
//           - Eight elementals of CR 1/4 or lower
//
// The DM has the elementals' statistics.
//
// KEY DIFFERENCE FROM TCE SUMMONS:
//   PHB Conjure spells pick creatures from the Monster Manual by CR,
//   rather than using a hardcoded stat block. For v1, we hardcode the
//   most common option (4 Mud Mephits, CR 1/4 each) to avoid requiring
//   a loaded bestiary at runtime. Future versions will use cr_picker.ts
//   when bestiary loading is standardised.
//
// Mud Mephit Stat Block (MM p.215):
//   Small elemental, AC 11, HP 27 (6d6 + 6), Speed 20 ft, fly 20 ft, swim 20 ft
//   STR 8 (-1), DEX 12 (+1), CON 12 (+1), INT 9 (-1), WIS 11 (+0), CHA 7 (-2)
//   Skills: Perception +2, Stealth +3
//   Senses: darkvision 60 ft, passive Perception 12
//   Damage Immunities: acid, poison
//   Condition Immunities: poisoned
//   Fists: +3 to hit, reach 5 ft, 1d6+1 bludgeoning damage (melee)
//   Mud Breath (recharge 6): 5-ft range, one creature, DC 11 DEX save or
//     restrained for 1 minute (escapable as action DC 11 STR check). The
//     mephit can't use Mud Breath again until it recharges.
//   Death Burst: When the mephit dies, it explodes in a burst of mud. Each
//     Medium or smaller creature within 5 ft must succeed on a DC 11 DEX
//     save or be blinded for 1 minute.
//
// v1 simplifications:
//   - Always picks "Eight elementals of CR 1/4" option but spawns only 4
//     Mud Mephits for a manageable battlefield footprint (consistent with
//     Conjure Animals v1 which spawns 2 Wolves instead of the listed max)
//   - Mud Breath recharge: NOT modelled (would require engine support for
//     recharge-on-N+ mechanics) — mephit uses only Fists in v1
//   - Death Burst blind effect: NOT modelled (no on-death hook yet)
//   - Acid/poison immunity: modelled via the damage immunities arrays
//     (resistances/vulnerabilities/immunities)
//   - Position: spread adjacent to caster (4 cardinal + diagonal offsets)
//   - All mephits share caster's initiative (insertAfter caster)
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
import { CONJURE_MINOR_ELEMENTALS_OPTIONS, DEFAULT_CME_OPTION } from '../summons/cr_picker';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Conjure Minor Elementals',
  level: 4,
  school: 'conjuration',
  rangeFt: 90,
  concentration: true,
  castingTime: 'action',
  conjureMinorElementalsV1Implemented: true,
  /** v1: hardcoded 4 Mud Mephits. Future: CR-picker from bestiary. */
  v1DefaultOption: DEFAULT_CME_OPTION.label,
  /** v1 simplification: spawn 4 Mud Mephits (not the listed max of 8) */
  v1SpawnCount: 4,
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

// ---- Mud Mephit stat block builder --------------------------

/**
 * Create a Mud Mephit Combatant (MM p.215).
 *
 * Unlike TCE summons, PHB Conjure Minor Elementals picks from the Monster
 * Manual. For v1 we build the Mud Mephit manually (same pattern as TCE stat
 * blocks). Future: use cr_picker.ts + monsterToCombatant when bestiary is
 * available.
 *
 * @param caster - the combatant who cast Conjure Minor Elementals
 * @param index  - which mephit (0-based, for unique ID and position)
 */
export function createMudMephit(
  caster: Combatant,
  index: number,
): Combatant {
  // Mud Mephit stat block (MM p.215):
  // AC: 11, HP: 27 (6d6+6), Speed: 20 ft, fly 20 ft, swim 20 ft
  // STR 8, DEX 12, CON 12, INT 9, WIS 11, CHA 7
  // Fists: +3 to hit, 1d6+1 bludgeoning
  const hp = 27;
  const ac = 11;

  const fistsAction: Action = {
    name: 'Fists',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 3,
    damage: { count: 1, sides: 6, bonus: 1, average: 4 },
    damageType: 'bludgeoning',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Fists: +3 to hit, reach 5 ft, 1d6+1 bludgeoning damage.',
  };

  // Position: spread adjacent to caster (8 cardinal + diagonal offsets)
  const offsets = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
  ];
  const offset = offsets[index % offsets.length];
  const pos = { x: caster.pos.x + offset.x, y: caster.pos.y + offset.y, z: caster.pos.z };

  const id = `conjure_minor_mudmephit_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    name: `Mud Mephit (${caster.name}) #${index + 1}`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 20,
    flySpeed: 20,
    swimSpeed: 20,
    burrowSpeed: null,
    str: 8,
    dex: 12,
    con: 12,
    int: 9,
    wis: 11,
    cha: 7,
    cr: 0.25,
    pos,
    actions: [fistsAction],
    traits: ['Death Burst', 'Mud Breath (recharge 6)'],
    legendaryActions: [],
    legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: {
      movementFt: 20,
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
    // Mud Mephit damage immunities: acid, poison (MM p.215)
    // The Combatant type doesn't have a dedicated `immunities` array,
    // so we model these via the `resistances` array which is treated
    // as "always-half" by the engine. Future engine work may add a
    // dedicated immunities field; for now, the trait tag above
    // documents the immunity for any future consumer.
    resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    // Summon subsystem (TG-006)
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Conjure Minor Elementals',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Conjure Minor Elementals.
 *
 * Preconditions:
 *   - Caster has 'Conjure Minor Elementals' in their actions
 *   - Caster has at least a 4th-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have too many Conjure Minor Elementals
 *     summons active (cap at 4 to prevent battlefield bloat)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Conjure Minor Elementals')) return false;
  if (!hasSpellSlot(caster, 4)) return false;

  // Cap: don't summon if caster already has summons from this spell
  const existingSummons = [...bf.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Minor Elementals'
  );
  if (existingSummons.length >= 4) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Conjure Minor Elementals:
 *  1. Consume a spell slot (find the lowest available L4+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Conjure Minor Elementals.
 *  4. Create 4 Mud Mephit combatants (v1: hardcoded, most iconic option).
 *  5. Add mephits to battlefield combatants.
 *  6. Insert into initiative after the caster.
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
  startConcentration(caster, 'Conjure Minor Elementals');

  // v1: always conjure 4 Mud Mephits (CR 1/4 × 4) — the most iconic option
  // (PHB lists up to 8 CR 1/4 elementals; v1 spawns 4 for a manageable footprint)
  const MEPHIT_COUNT = 4;
  const mephitIds: string[] = [];

  for (let i = 0; i < MEPHIT_COUNT; i++) {
    const mephit = createMudMephit(caster, i);
    state.battlefield.combatants.set(mephit.id, mephit);
    mephitIds.push(mephit.id);

    // Insert into initiative after the caster
    if (!state.battlefield.pendingInitiativeInserts) {
      state.battlefield.pendingInitiativeInserts = [];
    }
    state.battlefield.pendingInitiativeInserts.push({
      combatantId: mephit.id,
      insertAfterId: caster.id,
    });
  }

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Conjure Minor Elementals (slot L${slotLevel})! ${MEPHIT_COUNT} Mud Mephits appear (AC 11, HP 27 each).`,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
