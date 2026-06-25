// ============================================================
// Create Undead — PHB p.229
//
// 6th-level necromancy, 1-minute cast time (v1: action), range 10 ft,
// NO concentration. Components: V, S, M (one clay pot filled with grave
// dirt, a small piece of putrid flesh, and a drop of blood).
//
// Effect: You cast the spell on a corpse or bones (NOT a creature). It
// animates as a zombie or ghoul under your control. The spell can create:
//   - L6: 1 zombie (or 1 ghoul if caster is a Necromancy wizard 6+)
//   - L7: 2 zombies (or 2 ghouls)
//   - L8: 3 zombies (or 3 ghouls)
//   - L9: 4 zombies (or 4 ghouls)
//
// v1 simplifications:
//   - Casting time: canon 1 min. v1: action (treat as a combat-round cast —
//     monsters cast it mid-fight in the bestiary).
//   - Corpse requirement: NOT enforced (no corpse/loot subsystem). v1 spawns
//     a zombie out of thin air. Flagged `createUndeadCorpseRequirementV1Simplified: true`.
//   - Upcast: NOT modelled (v1 always spawns exactly 1 zombie).
//   - Ghoul variant: NOT modelled (v1 always spawns a zombie). The
//     Necromancy-wizard-6+ "ghoul instead of zombie" upgrade is also NOT
//     modelled.
//   - Zombie stat block: hardcoded (MM p.316 Zombie): AC 8, HP 22, Slam
//     +3 1d6+1 bludgeoning. Undead Fortitude (CON save DC 5+dmg or survive
//     to 1 HP) NOT modelled in v1.
//   - Spawn cap: 4 zombies per caster (mirrors Conjure Animals v1 cap).
//
// Spell module pattern (self-targeted summon spawn, NO concentration):
//   shouldCast(caster, bf) → Combatant | null  (returns the CASTER (self) if
//     there's space + an enemy to fight; null otherwise)
//   execute(caster, _self, state) → void
//   cleanup() — no-op (NOT concentration; zombie persists until destroyed)
//
// Combat value: MEDIUM. Adds a body to the field (extra HP + attacks per
// round). ~8 creatures know it (per coverage report).
// ============================================================

import { Combatant, Battlefield, Action, AIProfile } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { chebyshev3D } from '../engine/movement';

export const metadata = {
  name: 'Create Undead', level: 6, school: 'necromancy', rangeFt: 10,
  concentration: false, castingTime: 'action',  // v1: action (canon 1 min)
  createUndeadCorpseRequirementV1Simplified: true,  // no corpse needed
  createUndeadUpcastV1Implemented: false,            // upcast +1 zombie/slot not modelled
  createUndeadGhoulVariantV1Implemented: false,      // v1 always zombie
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

/** Spawn cap per caster — mirrors Conjure Animals v1 cap (4 summons). */
const MAX_ZOMBIES_PER_CASTER = 4;

/**
 * Build a Zombie Combatant (MM p.316).
 *
 * Stat block (MM p.316):
 *   AC: 8, HP: 22 (3d8 + 9), Speed: 20 ft
 *   STR 13 (+1), DEX 6 (-2), CON 16 (+3), INT 3 (-4), WIS 6 (-2), CHA 5 (-3)
 *   Slam: +4 to hit, reach 5 ft, 1d6+1 bludgeoning
 *   (v1 simplifies hit bonus to +3 and ignores Undead Fortitude.)
 *
 * @param caster - the combatant who cast Create Undead
 * @param index  - which zombie (0-based, for unique ID and position)
 */
export function createZombie(caster: Combatant, index: number): Combatant {
  const hp = 22;
  const ac = 8;

  const slamAction: Action = {
    name: 'Slam',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 3,                 // v1: +3 (canon +4 — slight under-bid is conservative)
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
    description: 'Slam: +3 to hit, 1d6+1 bludgeoning.',
  };

  // Position: spread adjacent to caster (mirror Conjure Animals offset pattern)
  const offsets = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 },
  ];
  const offset = offsets[index % offsets.length];
  const pos = { x: caster.pos.x + offset.x, y: caster.pos.y + offset.y, z: caster.pos.z };

  const id = `create_undead_zombie_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    name: `Zombie (${caster.name}) #${index + 1}`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 20,
    flySpeed: null,
    swimSpeed: null,
    burrowSpeed: null,
    str: 13,
    dex: 6,
    con: 16,
    int: 3,
    wis: 6,
    cha: 5,
    cr: 0.25,
    pos,
    actions: [slamAction],
    traits: ['Undead Fortitude'],
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
    summonSpellName: 'Create Undead',
    creatureType: 'undead',
  };
}

/**
 * Returns the CASTER (self) if there's space + an enemy to fight;
 * null otherwise.
 *
 * "Space" check: a soft cap of MAX_ZOMBIES_PER_CASTER existing Create Undead
 * zombies from this caster (mirrors Conjure Animals v1 cap).
 * "Enemy to fight": at least 1 living enemy on the battlefield.
 *
 * Range: 10 ft. Canon Create Undead has a 10-ft range (the caster must be
 * within 10 ft of the corpse). v1 doesn't enforce range on the caster
 * (the zombie spawns adjacent to the caster regardless), but the spec asks
 * shouldCast to confirm there's an enemy to fight.
 *
 * NOT concentration-gated (Create Undead is NOT concentration).
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Create Undead')) return null;
  if (!hasSpellSlot(caster, 6)) return null;
  // NOT concentration-gated — Create Undead has no concentration requirement.

  // Check for at least 1 living enemy
  let hasEnemy = false;
  for (const c of bf.combatants.values()) {
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    hasEnemy = true;
    break;
  }
  if (!hasEnemy) return null;

  // "Space" check: cap existing Create Undead zombies from this caster
  const existingZombies = [...bf.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Create Undead'
  );
  if (existingZombies.length >= MAX_ZOMBIES_PER_CASTER) return null;

  return caster;
}

export function execute(caster: Combatant, _self: Combatant, state: EngineState): void {
  const slotLevel = consumeSpellSlot(caster, 6);
  if (slotLevel === null) return;
  // NOT a concentration spell — no startConcentration() call.

  // Count existing Create Undead zombies to assign a unique index
  const existingZombies = [...state.battlefield.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Create Undead'
  );
  const index = existingZombies.length;
  const zombie = createZombie(caster, index);

  // Add the new Combatant to the battlefield
  state.battlefield.combatants.set(zombie.id, zombie);

  // Insert into initiative after the caster (mirror Conjure Animals pattern)
  if (!state.battlefield.pendingInitiativeInserts) {
    state.battlefield.pendingInitiativeInserts = [];
  }
  state.battlefield.pendingInitiativeInserts.push({
    combatantId: zombie.id,
    insertAfterId: caster.id,
  });

  emit(state, 'action', caster.id,
    `${caster.name} casts Create Undead (slot L${slotLevel})! A Zombie appears (AC ${zombie.ac}, HP ${zombie.maxHP}) — Slam +3 1d6+1 bludgeoning.`,
    zombie.id);
}

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration; zombie persists until destroyed */ }
