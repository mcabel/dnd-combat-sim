// ============================================================
// Find Familiar — PHB p.240
//
// 1st-level conjuration (ritual), action, range 10 ft,
// Instantaneous. Components: V, S, M (charcoal, incense, herbs
// that must be consumed in a brass brazier worth 10 gp).
//
// Effect: You gain the service of a familiar, a spirit that takes
//         an animal form you choose: bat, cat, crab, frog (toad),
//         hawk, lizard, octopus, owl, poisonous snake, fish
//         (seahorse), rat, raven, sea horse, spider, or weasel.
//
// The familiar has the statistics of the chosen form, though it
// is a celestial, fey, or fiend (your choice) instead of a beast.
// Your familiar acts independently of you, but it always obeys
// your commands. In combat, it rolls its own initiative and acts
// on its own turn.
//
// KEY DIFFERENCES FROM TCE SUMMONS:
//   1. NOT concentration — Instantaneous. The familiar persists
//      until killed or dismissed. No concentration-break despawn.
//   2. Familiar does NOT attack — it uses the Help action (grants
//      advantage to an ally's next attack vs a target within 5 ft).
//   3. Flyby: doesn't provoke opportunity attacks.
//
// v1 simplification:
//   - Always conjure an Owl (the most combat-useful familiar —
//     Flyby + Help action).
//   - NOT concentration (PHB says Instantaneous).
//   - Familiar does NOT attack (cannotAttack: true, aiProfile: 'defend').
//   - Help action modelled via helpedThisTurn flag on the Combatant.
//
// Owl stat block (MM p.335):
//   AC: 11, HP: 1, Speed: 5 ft, fly 60 ft
//   STR 3, DEX 13, CON 8, INT 2, WIS 12, CHA 7
//   Flyby: doesn't provoke opportunity attacks
//   Keen Sight: advantage on Perception checks using sight
//
// Spell module pattern:
//   shouldCast(caster, bf) → boolean
//   execute(caster, target, state) → void
//   cleanup() — no-op (no concentration)
// ============================================================

import { Combatant, Battlefield, Action, AIProfile } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Find Familiar',
  level: 1,
  school: 'conjuration',
  rangeFt: 10,
  concentration: false,       // Instantaneous — NOT concentration
  castingTime: 'action',
  findFamiliarV1Implemented: true,
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

// ---- Owl stat block builder ---------------------------------

/**
 * Create an Owl Familiar Combatant (MM p.335).
 * v1: Always conjure an Owl — the most combat-useful familiar
 * (Flyby + Help action).
 *
 * @param caster - the combatant who cast Find Familiar
 */
export function createOwlFamiliar(caster: Combatant): Combatant {
  // Owl stat block (MM p.335):
  // AC: 11, HP: 1, Speed: 5 ft, fly 60 ft
  // STR 3, DEX 13, CON 8, INT 2, WIS 12, CHA 7
  const hp = 1;
  const ac = 11;

  // Position: adjacent to caster (within 10 ft)
  const pos = { x: caster.pos.x + 1, y: caster.pos.y, z: caster.pos.z };

  const id = `find_familiar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    name: `Owl Familiar (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 5,
    flySpeed: 60,
    swimSpeed: null,
    burrowSpeed: null,
    str: 3,
    dex: 13,
    con: 8,
    int: 2,
    wis: 12,
    cha: 7,
    cr: 0,
    size: 'Tiny',
    pos,
    actions: [],           // Familiar does NOT attack — no attack actions
    traits: ['Flyby', 'Keen Sight'],
    legendaryActions: [],
    legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: {
      movementFt: 60,     // Uses fly speed as primary movement
      actionUsed: false,
      bonusActionUsed: false,
      reactionUsed: false,
      freeObjectUsed: false,
    },
    conditions: new Set(),
    aiProfile: 'defend' as AIProfile,
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    mountedOn: null,
    carriedBy: null,
    independentMount: false,
    role: 'familiar',
    bonded: caster.id,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false,
    cannotAttack: true,    // Familiars can't attack (PHB p.240)
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
    summonSpellName: 'Find Familiar',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Find Familiar.
 *
 * Preconditions:
 *   - Caster has 'Find Familiar' in their actions
 *   - Caster has at least a 1st-level spell slot available
 *   - Caster doesn't already have a Find Familiar active
 *
 * NOTE: NOT a concentration spell — does NOT check
 * caster.concentration?.active.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  // NOT concentration — don't check caster.concentration?.active
  if (!caster.actions.some(a => a.name === 'Find Familiar')) return false;
  if (!hasSpellSlot(caster, 1)) return false;

  // Check if caster already has a Find Familiar active
  const existingFamiliar = [...bf.combatants.values()].some(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Find Familiar'
  );
  if (existingFamiliar) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Find Familiar:
 *  1. Consume a spell slot (find the lowest available L1+ slot).
 *  2. Create the Owl Familiar combatant.
 *  3. Add to battlefield combatants.
 *  4. Insert into initiative after the caster.
 *  5. Log the summon.
 *
 * NOTE: No concentration start — Find Familiar is Instantaneous.
 */
export function execute(
  caster: Combatant,
  _target: Combatant,
  state: EngineState,
): void {
  const slotLevel = consumeSpellSlot(caster, 1);
  if (slotLevel === null) return; // no slot available

  // No concentration — this is an Instantaneous spell

  const familiar = createOwlFamiliar(caster);

  // Add to battlefield
  state.battlefield.combatants.set(familiar.id, familiar);

  // Insert into initiative after the caster
  if (!state.battlefield.pendingInitiativeInserts) {
    state.battlefield.pendingInitiativeInserts = [];
  }
  state.battlefield.pendingInitiativeInserts.push({
    combatantId: familiar.id,
    insertAfterId: caster.id,
  });

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Find Familiar! Owl Familiar appears (AC ${familiar.ac}, HP ${familiar.maxHP}, Flyby).`,
    familiar.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; familiar persists until killed or dismissed.
}
