// ============================================================
// Conjure Celestial — PHB p.225
//
// 7th-level conjuration, action, range 90 ft, concentration (1 hr).
// Components: V, S.
//
// Effect: You summon a celestial of challenge rating 4 or lower, which
//         appears in an unoccupied space that you can see within range.
//         The celestial disappears when it drops to 0 hit points or
//         when the spell ends.
//
//         The celestial is friendly to you and your companions for the
//         duration. Roll initiative for the celestial, which has its
//         own turns. It obeys your verbal commands (no action required
//         by you). If you don't issue any, it defends itself from
//         hostile creatures but otherwise takes no actions.
//
//         At Higher Levels. When you cast this spell using a spell
//         slot of 8th level or higher, the challenge rating increases
//         by 1 for each slot level above 7th.
//
// IMPORTANT — DO NOT CONFUSE WITH TCE SUMMON CELESTIAL (L5):
//   The Tasha's Cauldron spell "Summon Celestial" (TCE p.111, L5)
//   summons a "Celestial Spirit" with a hardcoded stat block that
//   scales with slot level. The PHB spell "Conjure Celestial" (PHB
//   p.225, L7) summons a real celestial from the Monster Manual by
//   CR. They are different spells — this module implements the PHB
//   L7 spell. The TCE L5 spell lives in `summon_celestial.ts`.
//
// KEY DIFFERENCE FROM CONJURE ELEMENTAL / CONJURE FEY:
//   Conjure Celestial starts at CR 4 (not CR = slotLevel) and scales
//   by +1 CR per slot level above 7th: L7 → CR 4, L8 → CR 5, L9 → CR 6.
//   v1 picks the Couatl (CR 4) as the default — this is the only CR 4
//   celestial in the Monster Manual and therefore the canonical L7
//   default. Upcast support is documented but v1 still spawns the
//   same Couatl stat block regardless of slot level (the Couatl is
//   CR 4 and therefore valid for any L7+ slot per the spell's
//   CR-scaling rule).
//
// Couatl Stat Block (MM p.43):
//   Medium celestial, AC 19 (natural armor), HP 97 (13d8 + 39),
//   Speed 30 ft, fly 90 ft
//   STR 16 (+3), DEX 20 (+5), CON 17 (+3), INT 18 (+4), WIS 20 (+5), CHA 18 (+4)
//   Skills: Perception +9
//   Senses: truesight 120 ft, passive Perception 19
//   Languages: Celestial, Common, telepathy 120 ft
//   Damage Immunities: radiant, psychic
//   Condition Immunities: charmed, frightened
//   Magic Weapons: the couatl's weapon attacks are magical
//   Shielded Mind: immune to scrying and to any effect that would
//     sense its emotions, read its thoughts, or detect its location
//   Bite: +8 to hit, reach 5 ft, 1d6+5 piercing + DC 13 CON save or
//         poisoned for 24h. Until this poison ends, the target is
//         unconscious. Another creature can use its action to shake
//         the target awake.
//   Constrict: +6 to hit, reach 10 ft, 2d6+3 bludgeoning + grappled
//              (escape DC 15). Until this grapple ends, the target is
//              restrained, and the couatl can't constrict another target.
//   Change Shape: polymorph into a humanoid or beast of CR ≤ its own,
//                 or back into its true form (not modelled in v1 — utility)
//   Innate Spellcasting (Cha, DC 16): at-will detect evil/good, detect
//     magic, detect thoughts; 3/day bless, create food and water, cure
//     wounds, lesser restoration, protection from poison, sanctuary;
//     1/day dream, greater restoration, scrying (NOT modelled in v1 —
//     would require AI planner integration)
//
// v1 simplifications:
//   - Always picks the Couatl (CR 4) for the default L7 cast
//   - Upcast L8-L9: same Couatl stat block (still valid — CR 4
//     fits within the maxCR = 4 + (slotLevel - 7) constraint).
//     A future v2 should pick higher-CR celestials (e.g. Pegasus CR 2
//     is below the cap, but no CR 5-6 celestials exist in the MM —
//     v2 would need to pull from VGM/MTF/etc.).
//   - Innate Spellcasting: NOT modelled (would require AI planner
//     integration for spell-like abilities)
//   - Change Shape: NOT modelled (utility, not combat-relevant)
//   - Truesight 120 ft: NOT modelled (perception system uses a simpler
//     model; couatl's high WIS already gives it strong passive perception)
//   - Shielded Mind: NOT modelled (no scrying mechanic in combat sim)
//   - Magic Weapons: NOT modelled (engine doesn't distinguish magic vs
//     non-magic weapon attacks for damage resistance purposes)
//   - Bite poison (unconscious): modelled as a DC 13 CON save on hit
//     via the attack's saveDC/saveAbility fields. The poisoned condition
//     is applied via the standard engine condition system; the
//     "unconscious while poisoned" rider is NOT modelled in v1 (no
//     conditional unconsciousness mechanic).
//   - Constrict grapple: modelled as a DC 15 save on hit (the engine's
//     grapple/restrain mechanic integration is partial — the save DC
//     is recorded on the action for future integration).
//   - Radiant/psychic damage immunity: documented in traits but not
//     enforced (Combatant type lacks a dedicated immunities field).
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
import { CONJURE_CELESTIAL_OPTIONS, DEFAULT_CC_OPTION } from '../summons/cr_picker';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Conjure Celestial',
  level: 7,
  school: 'conjuration',
  rangeFt: 90,
  concentration: true,
  castingTime: 'action',
  conjureCelestialV1Implemented: true,
  /** v1: hardcoded 1 Couatl. Future: CR-picker from bestiary. */
  v1DefaultOption: DEFAULT_CC_OPTION.label,
  /** v1 simplification: always spawns Couatl (CR 4) regardless of slot level */
  v1DefaultCreature: 'Couatl',
  /** Upcast is documented but the stat block stays the same in v1 */
  conjureCelestialUpcastV1Implemented: true,
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

// ---- Couatl stat block builder ------------------------------

/**
 * Create a Couatl Combatant (MM p.43).
 *
 * Unlike TCE summons, PHB Conjure Celestial picks from the Monster Manual.
 * For v1 we build the Couatl manually (same pattern as TCE stat blocks).
 * Future: use cr_picker.ts + monsterToCombatant when bestiary is
 * available, and pick the celestial type from the slot level.
 *
 * @param caster    - the combatant who cast Conjure Celestial
 * @param slotLevel - the spell slot level used (7–9). v1 ignores the slot
 *                    level and always uses the Couatl stat block
 *                    (CR 4, valid for any L7+ slot per the spell text).
 */
export function createCouatl(
  caster: Combatant,
  slotLevel: number,
): Combatant {
  // Couatl stat block (MM p.43):
  // AC: 19 (natural armor), HP: 97 (13d8+39), Speed: 30 ft, fly 90 ft
  // STR 16, DEX 20, CON 17, INT 18, WIS 20, CHA 18
  // Bite: +8 to hit, 1d6+5 piercing + DC 13 CON or poisoned (unconscious)
  // Constrict: +6 to hit, 2d6+3 bludgeoning + DC 15 STR or grappled+restrained
  const hp = 97;
  const ac = 19;

  const biteAction: Action = {
    name: 'Bite',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 8,
    damage: { count: 1, sides: 6, bonus: 5, average: 8 },
    damageType: 'piercing',
    saveDC: 13,
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Bite: +8 to hit, reach 5 ft, 1d6+5 piercing + DC 13 CON or poisoned (unconscious).',
  };

  const constrictAction: Action = {
    name: 'Constrict',
    isMultiattack: false,
    attackType: 'melee',
    reach: 10,
    range: { normal: 10, long: 10 },
    hitBonus: 6,
    damage: { count: 2, sides: 6, bonus: 3, average: 10 },
    damageType: 'bludgeoning',
    saveDC: 15,
    saveAbility: 'str',
    isAoE: false,
    isControl: true,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Constrict: +6 to hit, reach 10 ft, 2d6+3 bludgeoning + DC 15 STR or grappled+restrained.',
  };

  // Position: adjacent to caster (1 square away)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `conjure_celestial_couatl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    name: `Couatl (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 30,
    flySpeed: 90,
    swimSpeed: null,
    burrowSpeed: null,
    str: 16,
    dex: 20,
    con: 17,
    int: 18,
    wis: 20,
    cha: 18,
    cr: 4,
    pos,
    // Couatl has 2 attacks: Bite (poison/unconscious) and Constrict (grapple)
    // v1 uses Bite as the primary action (higher hit bonus, cleaner mechanic)
    actions: [biteAction, constrictAction],
    traits: [
      'Magic Weapons',
      'Shielded Mind',
      'Innate Spellcasting (DC 16)',
      'Change Shape',
      'Truesight 120 ft',
      'Damage Immunities: radiant, psychic',
      'Condition Immunities: charmed, frightened',
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
    hasHands: false, // Couatl is a winged serpent — no hands
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
    summonSpellName: 'Conjure Celestial',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Conjure Celestial.
 *
 * Preconditions:
 *   - Caster has 'Conjure Celestial' in their actions
 *   - Caster has at least a 7th-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have a Conjure Celestial active
 *     (cap at 1 — like Conjure Elemental/Fey, Conjure Celestial summons
 *     a single powerful creature, not a pack)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Conjure Celestial')) return false;
  if (!hasSpellSlot(caster, 7)) return false;

  // Cap: don't summon if caster already has a Conjure Celestial active
  const existingSummon = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Celestial'
  );
  if (existingSummon) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Conjure Celestial:
 *  1. Consume a spell slot (find the lowest available L7+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Conjure Celestial.
 *  4. Create the Couatl combatant (built manually, NOT from bestiary).
 *  5. Add to battlefield combatants.
 *  6. Insert into initiative (pendingInitiativeInserts for after-caster insertion).
 *  7. Log the summon.
 */
export function execute(
  caster: Combatant,
  _target: Combatant,
  state: EngineState,
): void {
  const slotLevel = consumeSpellSlot(caster, 7);
  if (slotLevel === null) return; // no slot available (shouldn't happen if shouldCast is checked)

  // Break existing concentration (safety net)
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Conjure Celestial');

  // v1 simplification: always spawn a Couatl (CR 4). The Couatl stat
  // block is valid for any L7+ slot per the spell's CR-scaling rule.
  // A future v2 should pick higher-CR celestials when bestiary loading
  // is standardised (no CR 5-6 celestials exist in the MM, so v2 would
  // need to pull from VGM/MTF/etc.).
  const summon = createCouatl(caster, slotLevel);

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
    `${caster.name} casts Conjure Celestial (slot L${slotLevel})! Couatl appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
    summon.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
