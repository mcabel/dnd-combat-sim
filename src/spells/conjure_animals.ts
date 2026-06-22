// ============================================================
// Conjure Animals — PHB p.225
//
// 3rd-level conjuration, action, range 60 ft, concentration (1 hr).
// Components: V, S.
//
// Effect: You summon fey spirits that take the form of beasts and
//         appear in unoccupied spaces that you can see within range.
//         Choose one of the following options:
//           - One beast of challenge rating 2 or lower
//           - Two beasts of challenge rating 1 or lower
//           - Three beasts of challenge rating 1/2 or lower
//           - Four beasts of challenge rating 1/4 or lower
//           - Eight beasts of challenge rating 1/4 or lower
//
// The DM has the beasts' statistics. At the start of each of its
// turns, each summoned beast obeys your verbal commands (no action
// required by you).
//
// KEY DIFFERENCE FROM TCE SUMMONS:
//   PHB Conjure spells pick creatures from the Monster Manual by CR,
//   rather than using a hardcoded stat block. For v1, we hardcode the
//   most common option (2 Wolves, CR 1/4 each) to avoid requiring a
//   loaded bestiary at runtime. Future versions will use cr_picker.ts
//   when bestiary loading is standardised.
//
// Wolf Stat Block (MM p.341):
//   AC: 13, HP: 11 (2d8 + 2), Speed: 40 ft
//   STR 12 (+1), DEX 15 (+2), CON 12 (+1), INT 3 (-4), WIS 12 (+1), CHA 6 (-2)
//   Skills: Perception +3, Stealth +4
//   Senses: passive Perception 13
//   Bite: +4 to hit, reach 5 ft, 2d6+2 piercing;
//         DC 11 STR save or knocked prone
//   Pack Tactics: advantage on attack rolls vs a creature within 5 ft
//                 of an ally that isn't incapacitated
//
// v1 simplifications:
//   - Always picks "Two beasts of CR 1 or lower" (2 Wolves)
//     — the most iconic and commonly chosen option
//   - Pack Tactics: modelled as advantage when an ally is adjacent
//     to the target (handled by hasPackTacticsAdvantage in utils)
//   - Knock Prone on Bite: NOT modelled in v1 (no prone mechanic yet)
//   - Position: both wolves placed adjacent to caster
//   - Both wolves share caster's initiative (insertAfter caster)
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
import { CONJURE_ANIMALS_OPTIONS, DEFAULT_CA_OPTION } from '../summons/cr_picker';
// Session 43 Task #21: bestiary-driven summon selection.
// Session 44 Task #28: multi-creature option (8 wolves) preferred when bestiary loaded.
import {
  pickConjureAnimalsSummon,
  pickConjureAnimalsSummonMulti,
  buildSummonCombatant,
} from '../summons/summon_picker';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Conjure Animals',
  level: 3,
  school: 'conjuration',
  rangeFt: 60,
  concentration: true,
  castingTime: 'action',
  conjureAnimalsV1Implemented: true,
  /** v1: hardcoded 2 Wolves. Future: CR-picker from bestiary. */
  v1DefaultOption: DEFAULT_CA_OPTION.label,
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

// ---- Wolf stat block builder --------------------------------

/**
 * Create a Wolf Combatant (MM p.341).
 *
 * Unlike TCE summons, PHB Conjure Animals picks from the Monster Manual.
 * For v1 we build the Wolf manually (same pattern as TCE stat blocks).
 * Future: use cr_picker.ts + monsterToCombatant when bestiary is available.
 *
 * @param caster - the combatant who cast Conjure Animals
 * @param index  - which wolf (0-based, for unique ID and position)
 */
export function createWolf(
  caster: Combatant,
  index: number,
): Combatant {
  // Wolf stat block (MM p.341):
  // AC: 13, HP: 11, Speed: 40 ft
  // STR 12, DEX 15, CON 12, INT 3, WIS 12, CHA 6
  // Bite: +4 to hit, 2d6+2 piercing; DC 11 STR save or knocked prone
  const hp = 11;
  const ac = 13;

  const biteAction: Action = {
    name: 'Bite',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 4,
    damage: { count: 2, sides: 6, bonus: 2, average: 9 },
    damageType: 'piercing',
    saveDC: 11,
    saveAbility: 'str',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Bite: +4 to hit, 2d6+2 piercing. DC 11 STR save or knocked prone.',
  };

  // Position: spread adjacent to caster
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

  const id = `conjure_animals_wolf_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    name: `Wolf (${caster.name}) #${index + 1}`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 40,
    flySpeed: null,
    swimSpeed: null,
    burrowSpeed: null,
    str: 12,
    dex: 15,
    con: 12,
    int: 3,
    wis: 12,
    cha: 6,
    cr: 0.25,
    pos,
    actions: [biteAction],
    traits: ['Pack Tactics'],
    legendaryActions: [],
    legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: {
      movementFt: 40,
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
    resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    // Summon subsystem (TG-006)
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Conjure Animals',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Conjure Animals.
 *
 * Preconditions:
 *   - Caster has 'Conjure Animals' in their actions
 *   - Caster has at least a 3rd-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have too many Conjure Animals summons active
 *     (cap at 4 to prevent battlefield bloat)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Conjure Animals')) return false;
  if (!hasSpellSlot(caster, 3)) return false;

  // Cap: don't summon if caster already has summons from this spell
  const existingSummons = [...bf.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Animals'
  );
  if (existingSummons.length >= 4) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Conjure Animals:
 *  1. Consume a spell slot (find the lowest available L3+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Conjure Animals.
 *  4. Try multi-creature bestiary-driven spawn (8 wolves, Session 44 Task #28).
 *     If bestiary is empty or no CR 1/4 beast found, try single-creature spawn
 *     (1 beast at max CR, Session 43 Task #21). If that also fails, fall back
 *     to v1 hardcoded 2 Wolves.
 *  5. Add summons to battlefield combatants.
 *  6. Insert into initiative after the caster.
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
  startConcentration(caster, 'Conjure Animals');

  // ── Session 44 Task #28: multi-creature bestiary-driven spawn ──
  // Try the "8 beasts of CR 1/4" option first (the most iconic Conjure
  // Animals loadout — 8 Wolves with Pack Tactics). The slot-level
  // multiplier (1×/2×/3×) is applied to the count, capped at 8.
  const multiPicks = pickConjureAnimalsSummonMulti(slotLevel);

  if (multiPicks.length > 0) {
    // Spawn N creatures, spreading them around the caster.
    const offsets = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 },
    ];
    for (let i = 0; i < multiPicks.length; i++) {
      const offset = offsets[i % offsets.length];
      const pos = {
        x: caster.pos.x + offset.x,
        y: caster.pos.y + offset.y,
        z: caster.pos.z,
      };
      const summon = buildSummonCombatant(multiPicks[i], caster, 'Conjure Animals', pos);
      // Append index to the name for distinguishability.
      summon.name = `${multiPicks[i].name} (${caster.name}) #${i + 1}`;
      state.battlefield.combatants.set(summon.id, summon);
      if (!state.battlefield.pendingInitiativeInserts) {
        state.battlefield.pendingInitiativeInserts = [];
      }
      state.battlefield.pendingInitiativeInserts.push({
        combatantId: summon.id,
        insertAfterId: caster.id,
      });
    }
    const firstName = multiPicks[0].name;
    const count = multiPicks.length;
    emit(
      state, 'action', caster.id,
      `${caster.name} casts Conjure Animals (slot L${slotLevel})! ${count} ${firstName}s appear (CR ${multiPicks[0].cr} each).`,
    );
    return;
  }

  // ── Session 43 Task #21: single-creature bestiary-driven spawn ──
  // Tries to pick the appropriate beast from the bestiary based on slot
  // level (L3 → CR 2, L4 → CR 3, ..., L9 → CR 8). Falls back to 2 Wolves
  // (v1 hardcoded) if the bestiary is not loaded or no matching creature.
  const pick = pickConjureAnimalsSummon(slotLevel);

  if (pick) {
    // Bestiary-driven: spawn 1 creature at the picked CR.
    const summon = buildSummonCombatant(pick, caster, 'Conjure Animals');
    state.battlefield.combatants.set(summon.id, summon);
    if (!state.battlefield.pendingInitiativeInserts) {
      state.battlefield.pendingInitiativeInserts = [];
    }
    state.battlefield.pendingInitiativeInserts.push({
      combatantId: summon.id,
      insertAfterId: caster.id,
    });
    emit(
      state, 'action', caster.id,
      `${caster.name} casts Conjure Animals (slot L${slotLevel})! ${pick.name} (CR ${pick.cr}) appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
      summon.id,
    );
    return;
  }

  // Fallback: v1 hardcoded 2 Wolves (CR 1/4 × 2).
  const WOLF_COUNT = 2;
  const wolfIds: string[] = [];

  for (let i = 0; i < WOLF_COUNT; i++) {
    const wolf = createWolf(caster, i);
    state.battlefield.combatants.set(wolf.id, wolf);
    wolfIds.push(wolf.id);

    // Insert into initiative after the caster
    if (!state.battlefield.pendingInitiativeInserts) {
      state.battlefield.pendingInitiativeInserts = [];
    }
    state.battlefield.pendingInitiativeInserts.push({
      combatantId: wolf.id,
      insertAfterId: caster.id,
    });
  }

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Conjure Animals (slot L${slotLevel})! ${WOLF_COUNT} Wolves appear (AC 13, HP 11 each).`,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
