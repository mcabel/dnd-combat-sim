// ============================================================
// Conjure Fey — PHB p.226
//
// 6th-level conjuration, action, range 90 ft, concentration (1 hr).
// Components: V, S, M (a holly berry).
//
// Effect: You summon a fey creature of challenge rating 6 or lower,
//         which appears in an unoccupied space that you can see within
//         range. The fey disappears when it drops to 0 hit points or
//         when the spell ends.
//
//         The fey is friendly to you and your companions for the
//         duration. Roll initiative for the fey, which has its own
//         turns. It obeys your verbal commands (no action required by
//         you). If you don't issue any, it defends itself from hostile
//         creatures but otherwise takes no actions.
//
//         At Higher Levels. When you cast this spell using a spell
//         slot of 7th level or higher, the challenge rating increases
//         by 1 for each slot level above 6th.
//
// KEY DIFFERENCE FROM CONJURE ELEMENTAL:
//   Conjure Fey is the L6 sibling of Conjure Elemental (L5). Both
//   summon a single creature whose CR scales with the slot level.
//   v1 picks the Green Hag (CR 3) as the default — this is the
//   highest-CR fey in the Monster Manual that fits within the L6
//   cap (CR ≤ 6). Upcast support is documented but v1 still spawns
//   the same Green Hag stat block regardless of slot level (the
//   Green Hag is CR 3 and therefore valid for any L6+ slot per the
//   spell's CR-scaling rule).
//
// Green Hag Stat Block (MM p.177):
//   Medium fey, AC 17 (natural armor), HP 82 (11d8 + 33), Speed 30 ft
//   STR 18 (+4), DEX 12 (+1), CON 16 (+3), INT 13 (+1), WIS 14 (+2), CHA 14 (+2)
//   Skills: Arcana +3, Deception +4, Perception +4, Stealth +3
//   Senses: darkvision 60 ft, passive Perception 14
//   Languages: Common, Sylvan
//   Claws: +6 to hit, reach 5 ft, 2d8+4 slashing damage (melee)
//   Illusory Appearance: cover self in illusion to look like another
//     Medium humanoid (not modelled in v1 — utility, not combat-relevant)
//   Invisible Passage: turn invisible until attacks/casts/concentration
//     ends (not modelled in v1 — would interfere with combat targeting)
//   Innate Spellcasting (Cha, DC 12): at-will dancing lights, minor
//     illusion, vicious mockery (NOT modelled in v1 — would require
//     integrating the hag's at-will spellcasting into the AI planner)
//   Mimicry: mimic animal sounds and humanoid voices (DC 14 Insight to
//     detect) (not modelled — utility)
//   Amphibious: can breathe air and water (modelled via swimSpeed = 30)
//
// v1 simplifications:
//   - Always picks the Green Hag (CR 3) for the default L6 cast
//   - Upcast L7-L9: same Green Hag stat block (still valid — CR 3
//     fits within the maxCR = slotLevel constraint). A future v2 should
//     pick higher-CR fey from a wider bestiary (e.g. Yeth Hound CR 4
//     from MTF, Korred CR 4 from VGM) based on the slot level.
//   - Innate Spellcasting: NOT modelled (would require AI planner
//     integration for at-will cantrips)
//   - Illusory Appearance + Invisible Passage: NOT modelled (utility/
//     stealth, not combat-relevant for a summoned creature)
//   - Mimicry: NOT modelled (utility)
//   - Concentration break: standard despawn behaviour (consistent with
//     all other TG-006 summons)
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
import { CONJURE_FEY_OPTIONS, DEFAULT_CF_OPTION } from '../summons/cr_picker';
// Session 43 Task #21: bestiary-driven summon selection.
import { pickConjureFeySummon, buildSummonCombatant } from '../summons/summon_picker';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Conjure Fey',
  level: 6,
  school: 'conjuration',
  rangeFt: 90,
  concentration: true,
  castingTime: 'action',
  conjureFeyV1Implemented: true,
  /** v1: hardcoded 1 Green Hag. Future: CR-picker from bestiary. */
  v1DefaultOption: DEFAULT_CF_OPTION.label,
  /** v1 simplification: always spawns Green Hag (CR 3) regardless of slot level */
  v1DefaultCreature: 'Green Hag',
  /** Upcast is documented but the stat block stays the same in v1 */
  conjureFeyUpcastV1Implemented: true,
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

// ---- Green Hag stat block builder ---------------------------

/**
 * Create a Green Hag Combatant (MM p.177).
 *
 * Unlike TCE summons, PHB Conjure Fey picks from the Monster Manual.
 * For v1 we build the Green Hag manually (same pattern as TCE stat
 * blocks). Future: use cr_picker.ts + monsterToCombatant when bestiary
 * is available, and pick the fey type from the slot level.
 *
 * @param caster    - the combatant who cast Conjure Fey
 * @param slotLevel - the spell slot level used (6–9). v1 ignores the slot
 *                    level and always uses the Green Hag stat block
 *                    (CR 3, valid for any L6+ slot per the spell text).
 */
export function createGreenHag(
  caster: Combatant,
  slotLevel: number,
): Combatant {
  // Green Hag stat block (MM p.177):
  // AC: 17 (natural armor), HP: 82 (11d8+33), Speed: 30 ft
  // STR 18, DEX 12, CON 16, INT 13, WIS 14, CHA 14
  // Claws: +6 to hit, 2d8+4 slashing
  const hp = 82;
  const ac = 17;

  const clawsAction: Action = {
    name: 'Claws',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 6,
    damage: { count: 2, sides: 8, bonus: 4, average: 13 },
    damageType: 'slashing',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Claws: +6 to hit, reach 5 ft, 2d8+4 slashing damage.',
  };

  // Innate Spellcasting (MM p.177): at-will vicious mockery.
  // DC 12 (Cha), 60 ft, WIS save or 1d4 psychic + disadv on next attack.
  // The Hag is a CR 3 creature with both a strong melee Claws attack and
  // a ranged cantrip. The AI planner (selectAction) will choose Vicious
  // Mockery when the target is out of melee reach or when the disadv
  // rider is more valuable than the extra damage.
  // This is the first summon with at-will innate spellcasting (Session 32).
  const viciousMockeryAction: Action = {
    name: 'Vicious Mockery',
    isMultiattack: false,
    attackType: 'save',
    reach: 60,
    range: { normal: 60, long: 60 },
    hitBonus: null,
    damage: { count: 1, sides: 4, bonus: 0, average: 2 },
    damageType: 'psychic',
    saveDC: 12,  // Green Hag innate spellcasting DC (MM p.177)
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,  // cantrip — no slot
    costType: 'action',
    legendaryCost: 0,
    description: 'Vicious Mockery (innate): DC 12 WIS save or 1d4 psychic + disadv on next attack.',
  };

  // Position: adjacent to caster (1 square away)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `conjure_fey_greenhag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    name: `Green Hag (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 30,
    flySpeed: null,
    swimSpeed: 30, // Amphibious — can breathe water
    burrowSpeed: null,
    str: 18,
    dex: 12,
    con: 16,
    int: 13,
    wis: 14,
    cha: 14,
    cr: 3,
    pos,
    // Both Claws (melee) and Vicious Mockery (innate cantrip, ranged save)
    // are available. The AI planner will choose based on target reach and
    // expected damage — Vicious Mockery is preferred when the target is out
    // of melee reach or when the disadv rider is tactically valuable.
    actions: [clawsAction, viciousMockeryAction],
    traits: [
      'Amphibious',
      'Mimicry',
      'Illusory Appearance',
      'Invisible Passage',
      'Innate Spellcasting (at-will: dancing lights, minor illusion, vicious mockery)',
    ],
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
    wearingArmor: false, // Natural armor, not worn armor
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
    summonSpellName: 'Conjure Fey',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Conjure Fey.
 *
 * Preconditions:
 *   - Caster has 'Conjure Fey' in their actions
 *   - Caster has at least a 6th-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have a Conjure Fey active
 *     (cap at 1 — like Conjure Elemental, Conjure Fey summons a single
 *     powerful creature, not a pack)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Conjure Fey')) return false;
  if (!hasSpellSlot(caster, 6)) return false;

  // Cap: don't summon if caster already has a Conjure Fey active
  const existingSummon = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Fey'
  );
  if (existingSummon) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Conjure Fey:
 *  1. Consume a spell slot (find the lowest available L6+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Conjure Fey.
 *  4. Create the Green Hag combatant (built manually, NOT from bestiary).
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
  startConcentration(caster, 'Conjure Fey');

  // Session 43 Task #21: bestiary-driven summon selection.
  // Tries to pick the appropriate fey from the bestiary based on slot
  // level (L6+ → highest-CR fey ≤ slot level). Falls back to the
  // hardcoded createGreenHag() if the bestiary is not loaded or no
  // matching creature is found.
  const pick = pickConjureFeySummon(slotLevel);
  let summon: Combatant;
  let summonName: string;
  if (pick) {
    summon = buildSummonCombatant(pick, caster, 'Conjure Fey');
    summonName = pick.name;
  } else {
    // Fallback: hardcoded Green Hag stat block (v1 behavior).
    summon = createGreenHag(caster, slotLevel);
    summonName = 'Green Hag';
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
    `${caster.name} casts Conjure Fey (slot L${slotLevel})! ${summonName} appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
    summon.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
