// ============================================================
// Animate Dead — PHB p.213
//
// 3rd-level necromancy, 1-minute cast time (v1: action), range 10 ft,
// NO concentration. Components: V, S, M (a drop of blood, a piece of
// flesh, and a pinch of bone dust).
//
// Effect: Your spell imbues a corpse or a pile of bones with a foul
//         mimicry of life, raising it as a zombie or skeleton (your
//         choice). The target is under your control for 24 hours,
//         after which it stops obeying any command. If you cast this
//         spell again, you can reassert control over up to 4 of your
//         existing undead (resetting the 24-hour timer).
//
// v1 simplifications:
//   - Casting time: canon 1 min. v1: action (treat as a combat-round cast —
//     monsters cast it mid-fight in the bestiary).
//   - Corpse requirement: NOT enforced (no corpse/loot subsystem). v1 spawns
//     a skeleton out of thin air. Flagged `animateDeadCorpseRequirementV1Simplified: true`.
//   - Zombie vs Skeleton choice: v1 always spawns a SKELETON (MM p.305) to
//     differentiate from Create Undead (which spawns a zombie). The
//     "caster's choice" is NOT modelled. Flagged
//     `animateDeadZombieVariantV1Implemented: false`.
//   - Upcast: NOT modelled (canon: upcast does NOT create more undead — it
//     only reasserts control over more existing undead; v1 doesn't track
//     the 24-hour timer or reassert mechanic).
//     Flagged `animateDeadUpcastReassertV1Implemented: false`.
//   - 24-hour duration: NOT tracked (v1: encounter-duration; skeleton
//     persists until destroyed).
//   - Skeleton stat block: hardcoded (MM p.305 Skeleton): AC 13, HP 13,
//     Shortsword +4 1d6+2 piercing. The Shortbow ranged attack is NOT
//     modelled in v1 (melee-only for AI simplicity).
//   - Spawn cap: 4 skeletons per caster (mirrors Create Undead / Conjure
//     Animals / Gate v1 cap).
//
// Spell module pattern (self-targeted summon spawn, NO concentration):
//   shouldCast(caster, bf) → Combatant | null  (returns the CASTER (self) if
//     there's space + an enemy to fight; null otherwise)
//   execute(caster, _self, state) → void
//   cleanup() — no-op (NOT concentration; skeleton persists until destroyed)
//
// Combat value: MEDIUM. Adds a body to the field (extra HP + attacks per
// round). Lower slot than Create Undead (L3 vs L6) but weaker spawn
// (Skeleton HP 13 vs Zombie HP 22). ~24 creatures know it (per coverage
// report — rank #8 most-common unbuilt monster spell).
// ============================================================

import { Combatant, Battlefield, Action, AIProfile } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Animate Dead', level: 3, school: 'necromancy', rangeFt: 10,
  concentration: false, castingTime: 'action',  // v1: action (canon 1 min)
  animateDeadCorpseRequirementV1Simplified: true,   // no corpse needed
  animateDeadZombieVariantV1Implemented: false,     // v1 always skeleton
  animateDeadUpcastReassertV1Implemented: false,    // upcast reassert not modelled
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

/** Spawn cap per caster — mirrors Create Undead / Conjure Animals / Gate v1 cap. */
const MAX_SKELETONS_PER_CASTER = 4;

/**
 * Build a Skeleton Combatant (MM p.305).
 *
 * Stat block (MM p.305):
 *   AC: 13, HP: 13 (2d8 + 4), Speed: 30 ft
 *   STR 10 (0), DEX 14 (+2), CON 15 (+2), INT 6 (-2), WIS 8 (-1), CHA 5 (-3)
 *   Shortsword: +4 to hit, reach 5 ft, 1d6+2 piercing
 *   Shortbow: +4 to hit, range 80/320, 1d6+2 piercing (NOT modelled in v1)
 *
 * Contrast with Create Undead's Zombie (MM p.316): AC 8, HP 22, Slam +3
 * 1d6+1. Skeleton is squishier (HP 13 vs 22) but more accurate (+4 vs +3)
 * and higher AC (13 vs 8). L3 vs L6 slot.
 *
 * @param caster - the combatant who cast Animate Dead
 * @param index  - which skeleton (0-based, for unique ID and position)
 */
export function createSkeleton(caster: Combatant, index: number): Combatant {
  const hp = 13;
  const ac = 13;

  const shortswordAction: Action = {
    name: 'Shortsword',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 4,
    damage: { count: 1, sides: 6, bonus: 2, average: 5 },
    damageType: 'piercing',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Shortsword: +4 to hit, 1d6+2 piercing. (v1: Shortbow ranged attack NOT modelled.)',
  };

  // Position: spread adjacent to caster (mirror Create Undead / Gate offset pattern)
  const offsets = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 },
  ];
  const offset = offsets[index % offsets.length];
  const pos = { x: caster.pos.x + offset.x, y: caster.pos.y + offset.y, z: caster.pos.z };

  const id = `animate_dead_skeleton_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    name: `Skeleton (${caster.name}) #${index + 1}`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 30,
    flySpeed: null,
    swimSpeed: null,
    burrowSpeed: null,
    str: 10,
    dex: 14,
    con: 15,
    int: 6,
    wis: 8,
    cha: 5,
    cr: 0.25,
    pos,
    actions: [shortswordAction],
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
    summonSpellName: 'Animate Dead',
    creatureType: 'undead',
  };
}

/**
 * Returns the CASTER (self) if there's space + an enemy to fight;
 * null otherwise.
 *
 * "Space" check: a soft cap of MAX_SKELETONS_PER_CASTER existing Animate
 * Dead skeletons from this caster (mirrors Create Undead v1 cap).
 * "Enemy to fight": at least 1 living enemy on the battlefield.
 *
 * Range: 10 ft. Canon Animate Dead has a 10-ft range (the caster must be
 * within 10 ft of the corpse). v1 doesn't enforce range on the caster
 * (the skeleton spawns adjacent to the caster regardless), but the spec
 * asks shouldCast to confirm there's an enemy to fight.
 *
 * NOT concentration-gated (Animate Dead is NOT concentration).
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Animate Dead')) return null;
  if (!hasSpellSlot(caster, 3)) return null;
  // NOT concentration-gated — Animate Dead has no concentration requirement.

  // Check for at least 1 living enemy
  let hasEnemy = false;
  for (const c of bf.combatants.values()) {
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    hasEnemy = true;
    break;
  }
  if (!hasEnemy) return null;

  // "Space" check: cap existing Animate Dead skeletons from this caster
  const existingSkeletons = [...bf.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Animate Dead'
  );
  if (existingSkeletons.length >= MAX_SKELETONS_PER_CASTER) return null;

  return caster;
}

export function execute(caster: Combatant, _self: Combatant, state: EngineState): void {
  const slotLevel = consumeSpellSlot(caster, 3);
  if (slotLevel === null) return;
  // NOT a concentration spell — no startConcentration() call.

  // Count existing Animate Dead skeletons to assign a unique index
  const existingSkeletons = [...state.battlefield.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Animate Dead'
  );
  const index = existingSkeletons.length;
  const skeleton = createSkeleton(caster, index);

  // Add the new Combatant to the battlefield
  state.battlefield.combatants.set(skeleton.id, skeleton);

  // Insert into initiative after the caster (mirror Create Undead / Gate pattern)
  if (!state.battlefield.pendingInitiativeInserts) {
    state.battlefield.pendingInitiativeInserts = [];
  }
  state.battlefield.pendingInitiativeInserts.push({
    combatantId: skeleton.id,
    insertAfterId: caster.id,
  });

  emit(state, 'action', caster.id,
    `${caster.name} casts Animate Dead (slot L${slotLevel})! A Skeleton appears (AC ${skeleton.ac}, HP ${skeleton.maxHP}) — Shortsword +4 1d6+2 piercing.`,
    skeleton.id);
}

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration; skeleton persists until destroyed */ }
