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
import {
  pickConjureCelestialSummon,
  buildSummonCombatant,
} from '../summons/summon_picker';

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
  //
  // Innate Spellcasting (MM p.43, CHA-based, DC 14 per bestiary JSON):
  //   At will: detect evil and good, detect magic, detect thoughts (utility — not modelled)
  //   3/day each: bless, create food and water, cure wounds, lesser restoration,
  //               protection from poison, sanctuary, shield
  //   1/day each: dream, greater restoration, scrying (out-of-combat — not modelled)
  //
  // Session 41 Task #2: added bless + cure wounds + sanctuary as Action
  // objects with 3/day innate spellcasting resource tracking. The Couatl's
  // aiProfile is now 'smart' (was 'attackNearest') so the AI planner can
  // invoke shouldCastBless / shouldCastCureWounds — both functions were
  // updated this session to accept innate spell uses as alternative to
  // standard spell slots.
  //
  // Combat-relevant innate spells added (3/day each):
  //   - Bless (L1, concentration, action): +1d4 to attack rolls + saves for 3 allies
  //   - Cure Wounds (L1, action): 1d8+WIS healing to touched ally
  //   - Sanctuary (L1, bonus action): ward ally vs attacks (v1 forward-compat flag)
  //   - Shield (L1, reaction): +5 AC vs triggering attack; blocks Magic Missile
  //     (Session 44 Task #20 — wired into reaction_registry via the
  //     hasInnateSpellUse fallback in triggerReactions)
  //
  // Skipped (out-of-combat or situation):
  //   - Create Food and Water (out-of-combat)
  //   - Lesser Restoration, Protection from Poison (need condition tracking —
  //     innate counters are tracked in resources.innateSpellcasting but no
  //     Action objects are created for them; future: add condition-aware AI)
  //   - Dream, Greater Restoration, Scrying (out-of-combat)
  const hp = 97;
  const ac = 19;

  // Innate spell save DC (MM p.43 — CHA-based, DC 14)
  const innateSaveDC = 14;
  // Innate spell attack bonus = prof (CR 4 = +2) + CHA mod (+4) = +6
  const innateSpellAttackBonus = 6;

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

  // ---- Innate Spellcasting Actions (Session 41 Task #2) ----
  // These are Action objects that the AI planner can select. The
  // resources.innateSpellcasting field tracks the 3/day cap per spell.
  // slotLevel: 0 ensures the slot-gate filter doesn't drop them.
  // The execute functions in bless.ts / cure_wounds.ts / sanctuary.ts
  // were updated this session to consume innate uses as a fallback
  // when no spell slot is available.

  const blessAction: Action = {
    name: 'Bless',
    isMultiattack: false,
    attackType: null,           // no attack roll, no save — willing targets
    reach: 30,
    range: { normal: 30, long: 30 },
    hitBonus: null,
    damage: null,
    damageType: null,
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 0,               // innate — never consumes a slot
    costType: 'action',
    legendaryCost: 0,
    description: 'Innate Bless (3/day): up to 3 allies in 30 ft gain +1d4 to attack rolls and saves.',
  };

  const cureWoundsAction: Action = {
    name: 'Cure Wounds',
    isMultiattack: false,
    attackType: null,           // no attack roll, no save — heal
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: null,
    damage: null,
    damageType: null,
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,               // innate — never consumes a slot
    costType: 'action',
    legendaryCost: 0,
    description: 'Innate Cure Wounds (3/day): touch — target regains 1d8+4 HP (WIS +4).',
  };

  const sanctuaryAction: Action = {
    name: 'Sanctuary',
    isMultiattack: false,
    attackType: null,           // no attack roll, no save — willing target
    reach: 30,
    range: { normal: 30, long: 30 },
    hitBonus: null,
    damage: null,
    damageType: null,
    saveDC: innateSaveDC,        // WIS save DC for attackers who target the warded creature
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,               // innate — never consumes a slot
    costType: 'bonusAction',
    legendaryCost: 0,
    description: 'Innate Sanctuary (3/day, bonus action): ward an ally in 30 ft — attackers must WIS save or lose target.',
  };

  // ── Session 44 Task #20: Shield innate action ──
  // PHB p.275: "When you are hit by an attack or targeted by Magic Missile,
  // you can cast Shield as a reaction." The Couatl's innate Shield (3/day)
  // is wired into the reaction_registry via the `Shield` action name —
  // triggerReactions checks `reactor.actions.some(a => a.name === 'Shield')`
  // and now also accepts `hasInnateSpellUse(reactor, 'Shield')` as an
  // alternative to `hasSpellSlot(reactor, 1)` (Session 44 Task #20 change
  // in combat.ts). shield.ts executeReaction was updated to consume an
  // innate use when no spell slot is available (mirrors cure_wounds.ts).
  //
  // costType: 'reaction' (not 'action') — Shield is ONLY cast as a reaction,
  // never as a main action. The planner's action-selection logic ignores
  // actions with costType 'reaction' for the main-action slot.
  const shieldAction: Action = {
    name: 'Shield',
    isMultiattack: false,
    attackType: null,           // no attack roll, no save — self-buff
    reach: 0,                   // self
    range: { normal: 0, long: 0 },
    hitBonus: null,
    damage: null,
    damageType: null,
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,               // innate — never consumes a slot
    costType: 'reaction',       // Shield is only cast as a reaction
    legendaryCost: 0,
    description: 'Innate Shield (3/day, reaction): +5 AC including against the triggering attack; blocks Magic Missile.',
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
    // Couatl has 2 attacks + 4 innate spells:
    //   - Bite (poison/unconscious)
    //   - Constrict (grapple/restrain)
    //   - Bless (innate 3/day, concentration buff)
    //   - Cure Wounds (innate 3/day, heal)
    //   - Sanctuary (innate 3/day, bonus-action ward)
    //   - Shield (innate 3/day, reaction +5 AC — Session 44 Task #20)
    actions: [biteAction, constrictAction, blessAction, cureWoundsAction, sanctuaryAction, shieldAction],
    traits: [
      'Magic Weapons',
      'Shielded Mind',
      'Innate Spellcasting (DC 14, CHA-based — Session 41 Task #2)',
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
    // Session 41 Task #2: switched from 'attackNearest' to 'smart' so the
    // AI planner can invoke shouldCastBless / shouldCastCureWounds (both
    // updated this session to accept innate spell uses as alternative to
    // standard spell slots). The 'smart' profile still falls through to
    // selectAction (Bite or Constrict) when no spell is appropriate.
    aiProfile: 'smart' as AIProfile,
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: null,
    // Innate spellcasting: 3/day each for bless, cure wounds, sanctuary,
    // shield (Session 44 Task #20), lesser restoration, protection from
    // poison (Session 44 Task #20 — tracked but not yet AI-cast; needs
    // condition tracking for blinded/deafened/paralyzed/poisoned).
    // Initialized here so the AI planner (shouldCastBless, shouldCastCW)
    // and the spell execute functions can decrement the counter.
    //
    // Shield's counter is consumed by shield.ts executeReaction (which
    // falls back to consumeInnateSpellUse when no spell slot is available,
    // mirroring cure_wounds.ts).
    //
    // Lesser Restoration + Protection from Poison counters are tracked
    // here for completeness (MM p.43 lists them as 3/day each) but no
    // Action object is created for them — they need condition tracking
    // (blinded/deafened/paralyzed/poisoned) which is out of v1 scope.
    // Future: add condition-aware AI + execute functions.
    resources: {
      innateSpellcasting: {
        'Bless':                { max: 3, remaining: 3 },
        'Cure Wounds':          { max: 3, remaining: 3 },
        'Sanctuary':            { max: 3, remaining: 3 },
        'Shield':               { max: 3, remaining: 3 },  // Session 44 Task #20
        'Lesser Restoration':   { max: 3, remaining: 3 },  // tracked, not yet cast
        'Protection from Poison': { max: 3, remaining: 3 }, // tracked, not yet cast
      },
    },
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
    // Couatl: immune to radiant and psychic damage (MM p.43).
    // Enforced via applyDamageWithTempHP's immunity check (PHB p.197).
    immunities: ['radiant', 'psychic'],
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
 *  4. Create the celestial combatant.
 *     - Session 41 Task #3: bestiary integration. Tries to pick the
 *       appropriate celestial from the bestiary based on slot level
 *       (L7 → Couatl CR 4, L8 → Unicorn CR 5 in MM, L9 → CR 6 — no
 *       CR 6 celestials in MM, falls back to Couatl).
 *     - Falls back to the hardcoded createCouatl() if the bestiary is
 *       not loaded or no matching creature is found.
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

  // Session 41 Task #3: bestiary-driven summon selection.
  // L7: Couatl (canonical, only CR 4 celestial in MM).
  // L8: Unicorn (CR 5 celestial in MM) — NEW in Session 41.
  // L9: no CR 6 celestials in MM; picker returns null → fall back to Couatl.
  // L7 also returns null if bestiary isn't loaded → fall back to createCouatl.
  const pick = pickConjureCelestialSummon(slotLevel);
  let summon: Combatant;
  let summonName: string;
  if (pick) {
    summon = buildSummonCombatant(pick, caster, 'Conjure Celestial');
    summonName = pick.name;
  } else {
    // Fallback: hardcoded Couatl stat block (v1 behavior).
    summon = createCouatl(caster, slotLevel);
    summonName = 'Couatl';
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
    `${caster.name} casts Conjure Celestial (slot L${slotLevel})! ${summonName} appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
    summon.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
