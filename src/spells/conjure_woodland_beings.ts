// ============================================================
// Conjure Woodland Beings — PHB p.228
//
// 4th-level conjuration, action, range 60 ft, concentration (1 hr).
// Components: V, S, M (a holly berry).
//
// Effect: You summon fey creatures that appear in unoccupied spaces
//         that you can see within range. Choose one of the following:
//           - One fey of CR 2 or lower
//           - Two fey of CR 1 or lower
//           - Four fey of CR 1/2 or lower
//           - Eight fey of CR 1/4 or lower
//
// Each fey is considered fey for any effect that depends on its
// creature type, regardless of the form it takes. The DM has the
// creatures' statistics.
//
// KEY DIFFERENCE FROM TCE SUMMONS:
//   PHB Conjure spells pick creatures from the Monster Manual by CR,
//   rather than using a hardcoded stat block. For v1, we hardcode the
//   most common option (4 Sprites, CR 1/4 each) to avoid requiring a
//   loaded bestiary at runtime. Future versions will use cr_picker.ts
//   when bestiary loading is standardised.
//
// Sprite Stat Block (MM p.340):
//   Tiny fey, AC 15 (leather armor), HP 2 (1d4), Speed 10 ft, fly 40 ft
//   STR 3 (-4), DEX 18 (+4), CON 10 (+0), INT 14 (+2), WIS 13 (+1), CHA 11 (+0)
//   Skills: Perception +3, Stealth +7
//   Senses: passive Perception 13
//   Longsword: +2 to hit, reach 5 ft, 1 slashing damage (finesse, but Tiny
//              so used one-handed)
//   Shortbow: +6 to hit, range 40/160 ft, 1 piercing damage + DC 10 CON
//             save or poisoned for 1 minute
//   Heart Sight: touch a creature, learn its emotional state (not modelled)
//   Invisibility: turns invisible until attacks/casts/concentration ends
//                  (not modelled in v1 — combat sim assumes visible)
//
// v1 simplifications:
//   - Always picks "Eight fey of CR 1/4" option but spawns only 4 Sprites
//     for a manageable battlefield footprint (consistent with Conjure
//     Animals v1 which spawns 2 Wolves instead of the listed maximum of 8)
//   - Sprite Longsword: 1 slashing (1d4-4 from STR, but MM lists flat 1)
//     — modelled as a flat 1 damage for v1 (consistent with MM text)
//   - Sprite Shortbow poison: modelled as a saveDC 10 CON poisoned condition
//     on hit (uses the engine's poisoned condition)
//   - Heart Sight: NOT modelled (utility, not combat-relevant)
//   - Invisibility trait: NOT modelled (would interfere with combat
//     targeting; sprites are assumed visible)
//   - Position: spread adjacent to caster (4 cardinal + diagonal offsets)
//   - All sprites share caster's initiative (insertAfter caster)
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
import { CONJURE_WOODLAND_BEINGS_OPTIONS, DEFAULT_CWB_OPTION } from '../summons/cr_picker';
// Session 43 Task #21: bestiary-driven summon selection.
import { pickConjureWoodlandBeingsSummon, buildSummonCombatant } from '../summons/summon_picker';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Conjure Woodland Beings',
  level: 4,
  school: 'conjuration',
  rangeFt: 60,
  concentration: true,
  castingTime: 'action',
  conjureWoodlandBeingsV1Implemented: true,
  /** v1: hardcoded 4 Sprites. Future: CR-picker from bestiary. */
  v1DefaultOption: DEFAULT_CWB_OPTION.label,
  /** v1 simplification: spawn 4 Sprites (not the listed max of 8) */
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

// ---- Sprite stat block builder ------------------------------

/**
 * Create a Sprite Combatant (MM p.340).
 *
 * Unlike TCE summons, PHB Conjure Woodland Beings picks from the Monster
 * Manual. For v1 we build the Sprite manually (same pattern as TCE stat
 * blocks). Future: use cr_picker.ts + monsterToCombatant when bestiary is
 * available.
 *
 * @param caster - the combatant who cast Conjure Woodland Beings
 * @param index  - which sprite (0-based, for unique ID and position)
 */
export function createSprite(
  caster: Combatant,
  index: number,
): Combatant {
  // Sprite stat block (MM p.340):
  // AC: 15 (leather armor), HP: 2 (1d4), Speed: 10 ft, fly 40 ft
  // STR 3, DEX 18, CON 10, INT 14, WIS 13, CHA 11
  // Longsword: +2 to hit, 1 slashing (melee, 5 ft)
  // Shortbow: +6 to hit, 1 piercing + DC 10 CON poisoned (ranged 40/160)
  const hp = 2;
  const ac = 15;

  const longswordAction: Action = {
    name: 'Longsword',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 2,
    // MM lists flat 1 slashing for Sprite longsword — model as 1d4-3 (min 1)
    // to give a small variance while matching the average of 1.
    damage: { count: 1, sides: 4, bonus: -3, average: 1 },
    damageType: 'slashing',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Longsword: +2 to hit, 1 slashing damage.',
  };

  const shortbowAction: Action = {
    name: 'Shortbow',
    isMultiattack: false,
    attackType: 'ranged',
    reach: 40,
    range: { normal: 40, long: 160 },
    hitBonus: 6,
    damage: { count: 1, sides: 4, bonus: -3, average: 1 },
    damageType: 'piercing',
    saveDC: 10,
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Shortbow: +6 to hit, range 40/160 ft, 1 piercing + DC 10 CON or poisoned.',
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

  const id = `conjure_woodland_sprite_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    name: `Sprite (${caster.name}) #${index + 1}`,
    isPlayer: false,
    faction: caster.faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: 10,
    flySpeed: 40,
    swimSpeed: null,
    burrowSpeed: null,
    str: 3,
    dex: 18,
    con: 10,
    int: 14,
    wis: 13,
    cha: 11,
    cr: 0.25,
    pos,
    // Sprites prefer ranged shortbow but can melee — v1 uses shortbow as
    // the primary action (higher hit bonus, range advantage, poison rider)
    actions: [shortbowAction, longswordAction],
    traits: [],
    legendaryActions: [],
    legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: {
      movementFt: 10,
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
    wearingArmor: true,
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
    summonSpellName: 'Conjure Woodland Beings',
  };
}

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Conjure Woodland Beings.
 *
 * Preconditions:
 *   - Caster has 'Conjure Woodland Beings' in their actions
 *   - Caster has at least a 4th-level spell slot available
 *   - Caster is NOT already concentrating on any spell
 *   - Caster doesn't already have too many Conjure Woodland Beings summons
 *     active (cap at 4 to prevent battlefield bloat)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (caster.concentration?.active) return false;
  if (!caster.actions.some(a => a.name === 'Conjure Woodland Beings')) return false;
  if (!hasSpellSlot(caster, 4)) return false;

  // Cap: don't summon if caster already has summons from this spell
  const existingSummons = [...bf.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Woodland Beings'
  );
  if (existingSummons.length >= 4) return false;

  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Conjure Woodland Beings:
 *  1. Consume a spell slot (find the lowest available L4+ slot).
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Conjure Woodland Beings.
 *  4. Create 4 Sprite combatants (v1: hardcoded, most iconic option).
 *  5. Add sprites to battlefield combatants.
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
  startConcentration(caster, 'Conjure Woodland Beings');

  // Session 43 Task #21: bestiary-driven summon selection.
  // Tries to pick the appropriate fey from the bestiary based on slot
  // level (L4 → CR 2, L5 → CR 3, ..., L9 → CR 7). Falls back to 4 Sprites
  // (v1 hardcoded) if the bestiary is not loaded or no matching creature.
  //
  // v1 simplification: picks the "1 creature at max CR" option from the
  // PHB table. The 2/4/8-creature options are not modelled in v1.
  const pick = pickConjureWoodlandBeingsSummon(slotLevel);

  if (pick) {
    // Bestiary-driven: spawn 1 creature at the picked CR.
    const summon = buildSummonCombatant(pick, caster, 'Conjure Woodland Beings');
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
      `${caster.name} casts Conjure Woodland Beings (slot L${slotLevel})! ${pick.name} (CR ${pick.cr}) appears with ${summon.maxHP} HP, AC ${summon.ac}.`,
      summon.id,
    );
    return;
  }

  // Fallback: v1 hardcoded 4 Sprites (CR 1/4 × 4).
  // (PHB lists up to 8 CR 1/4 fey; v1 spawns 4 for a manageable footprint)
  const SPRITE_COUNT = 4;
  const spriteIds: string[] = [];

  for (let i = 0; i < SPRITE_COUNT; i++) {
    const sprite = createSprite(caster, i);
    state.battlefield.combatants.set(sprite.id, sprite);
    spriteIds.push(sprite.id);

    // Insert into initiative after the caster
    if (!state.battlefield.pendingInitiativeInserts) {
      state.battlefield.pendingInitiativeInserts = [];
    }
    state.battlefield.pendingInitiativeInserts.push({
      combatantId: sprite.id,
      insertAfterId: caster.id,
    });
  }

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Conjure Woodland Beings (slot L${slotLevel})! ${SPRITE_COUNT} Sprites appear (AC 15, HP 2 each).`,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles despawn via removeEffectsFromCaster.
}
