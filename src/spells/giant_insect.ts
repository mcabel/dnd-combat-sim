// ============================================================
// Giant Insect — PHB p.245
//
// 4-level transmutation, 1 action, range 30 ft, concentration.
// Duration: 10 minutes.
//
// Effect: You transform up to ten centipedes, three spiders, five wasps, or one scorpion within range into giant versions of their natural forms for the duration. A centipede becomes a {@creature giant centiped
//
// Upcast: see source (not modelled in v1).
//
// v1 simplifications:
//   - v1 models this spell as a FORWARD-COMPAT flag only (Session 19 bulk
//     implementation). The spell consumes a slot and sets the flag
//     `_genericSpellActiveSpells` on the caster; the actual mechanical
//     effect (damage / save / condition / buff) is NOT applied in v1.
//     A future implementation should extend the relevant engine subsystem
//     (damage_zone for persistent damage, condition_apply for conditions,
//     advantage_vs for buffs, etc.) to consume this flag and apply the
//     real effect. This mirrors the Session 17/18 forward-compat pattern
//     established by Darkvision, Arcane Lock, Knock, See Invisibility.
//   - Concentration spell (forward-compat flag persists for combat).
//
// Spell module pattern (mirrors Darkvision / Arcane Lock forward-compat
// self-buff pattern):
//   shouldCast(caster, bf) → boolean
//   execute(caster, state) → void
//   cleanup() — no-op (forward-compat flag persists for combat)
// ============================================================

import { Combatant, Battlefield, Action, AIProfile } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Giant Insect',
  level: 4,
  school: 'transmutation',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  giantInsectV1Simplified: true,
  // S116: Arasta's lair-action "casts the giant insect spell (spiders only)"
  // now summons 3 giant spider combatants (was forward-compat flag only).
  giantInsectLairSummonV1Implemented: true,
  // S117: Arasta's lair-action now despawns the previous spider batch before
  // summoning a new one on re-use (canon: "lasts until she uses this lair
  // action again"). The lair-specific shouldCastLairGiantInsect re-fires each
  // round (no _genericSpellActiveSpells flag gate), so executeLair can despawn
  // the old spiders + summon new ones.
  giantInsectLairDespawnOnReuseV2Implemented: true,
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

// ---- Planner ------------------------------------------------

/**
 * Returns true if the caster should cast Giant Insect this turn.
 *
 * Preconditions:
 *   - Caster has 'Giant Insect' in their actions
 *   - Caster has at least one 4-level-or-higher slot available
 *   - Caster is NOT already Giant Insect-active (re-cast would be a no-op in v1)
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Giant Insect')) return false;
  if (!hasSpellSlot(caster, 4)) return false;
  if (caster._genericSpellActiveSpells?.has('Giant Insect')) return false;
  return true;
}

/**
 * S117 v2: Lair-specific shouldCast for Giant Insect (despawn-on-reuse).
 *
 * Unlike the regular `shouldCast` (above — shared with the GENERIC_SPELLS
 * registry for the player/monster spell path), the lair version does NOT check
 * the `_genericSpellActiveSpells` flag. This lets the lair action re-fire each
 * round so `executeLair` can despawn the old spiders + summon new ones (canon:
 * "lasts until she uses this lair action again").
 *
 * Returns the caster if there is at least one living enemy (the lair creature
 * wouldn't waste the lair action with no one to fight); null otherwise.
 *
 * Used by `dispatchBespokeLairSpell`'s shouldCast switch (combat.ts ~L8217) —
 * replaces the S116 `shouldCastGiantInsect ? creature : null` conversion.
 */
export function shouldCastLairGiantInsect(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Giant Insect')) return null;
  // No _genericSpellActiveSpells flag check — lair action re-fires each round
  // (canon: "lasts until she uses this lair action again"). executeLair despawns
  // the old spiders before summoning new ones.
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    return caster;  // at least one living enemy → fire
  }
  return null;  // no living enemies → skip (canon-accurate)
}

// ---- Execution ----------------------------------------------

/**
 * Execute Giant Insect:
 *  1. Consume a 4-level spell slot.
 *  2. Set the flag on the caster's `_genericSpellActiveSpells` Set.
 *  3. Log the cast.
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 4);

  if (!caster._genericSpellActiveSpells) {
    caster._genericSpellActiveSpells = new Set<string>();
  }
  caster._genericSpellActiveSpells.add('Giant Insect');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Giant Insect! (v1: forward-compat flag set; mechanical effect not yet implemented)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} is affected by Giant Insect. (v1: forward-compat flag set; no mechanical effect until engine subsystem is implemented)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — forward-compat flag persists for combat.
}

// ============================================================
// S116: Lair-action summoning (Arasta "spiders only")
// ============================================================
//
// Arasta's lair text (MOT::1): "Arasta casts the giant insect spell (spiders
// only). It lasts until she uses this lair action again or until she dies."
//
// The player spell transforms EXISTING Tiny beasts (centipedes/spiders/wasps/
// scorpions) into giant versions — not applicable in a lair-action context
// (no existing beasts). The lair action effectively SUMMONS giant spiders.
// Per the spell, the "spiders only" variant transforms up to 3 spiders →
// the lair action summons 3 giant spiders.
//
// This is SEPARATE from the regular `execute` (player spell — forward-compat
// flag only, concentration, consumes a slot). The lair dispatcher calls this
// `executeLair` (NOT the regular execute) via callExecuteByPlanType's
// 'giantInsect' case.
//
// v1 implementation:
//   - Summons 3 Giant Spider combatants (built manually from MM p.328 stats:
//     CR 1, 26 HP, AC 14, STR 14/DEX 16/CON 12/INT 2/WIS 11/CHA 4, speed 30
//     walk + 30 climb, Bite +5 1d8+3 piercing). Placed at 3 distinct adjacent
//     squares near the caster (within the spell's 30-ft range).
//   - Each spider is marked isSummon=true, summonerId=caster.id,
//     summonSpellName='Giant Insect', faction=caster.faction. They despawn
//     on caster death via removeEffectsFromCaster (which despawns summons by
//     summonerId) — matches "lasts until she dies".
//   - The "lasts until she uses this lair action again" cleanup is NOT
//     modelled (deferred — same out-of-scope note as spike growth in S114).
//   - v1 spider attack simplification: Bite models 1d8+3 piercing only; the
//     DC 11 Con-save vs 2d8 poison + the paralyzed-at-0-HP rider are NOT
//     modelled (the Action type's single-damage field can't represent the
//     conditional poison cleanly). The Web (recharge 5) restraint attack is
//     also skipped. A future session could extend the Action type for
//     save-or-secondary-damage attacks.
//   - Does NOT consume a spell slot or start concentration (lair action —
//     suppress mode; the dispatcher sets suppressConcentration=true).
//   - Sets the _genericSpellActiveSpells flag (forward-compat tracking, kept
//     for consistency with the player spell path).
//   - Inserts the spiders into initiative after the caster via
//     pendingInitiativeInserts (mirrors summon_beast.ts).
// ============================================================

/** Number of giant spiders summoned by Arasta's lair action (per the spell's "3 spiders" count). */
const LAIR_SPIDER_COUNT = 3;

/**
 * Build a Giant Spider Action (Bite) from MM p.328 stats.
 * v1: piercing only (poison save + paralyzed rider deferred — see header).
 */
function buildBiteAction(): Action {
  return {
    name: 'Bite',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 5,                // DEX 16 (+3) + PB +2 = +5
    damage: { count: 1, sides: 8, bonus: 3, average: 7 },  // 1d8+3
    damageType: 'piercing',
    saveDC: null,               // v1: no poison save modelled
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Bite: +5 to hit, 1d8+3 piercing (v1: poison save deferred)',
  };
}

/**
 * Create a Giant Spider Combatant (MM p.328) as a summon of `caster`.
 *
 * Stats: CR 1, 26 HP, AC 14, STR 14/DEX 16/CON 12/INT 2/WIS 11/CHA 4,
 * speed 30 walk + 30 climb, blindsight 10, darkvision 60, stealth +7.
 * Traits (Spider Climb / Web Sense / Web Walker) are NOT modelled in v1
 * (they're movement/perception utilities with no combat-mechanical effect
 * in the current engine).
 *
 * @param caster  the lair creature (Arasta) who cast Giant Insect
 * @param index   0-based index used for positioning + ID disambiguation
 */
export function createGiantSpider(caster: Combatant, index: number): Combatant {
  // Position: 3 distinct adjacent squares around the caster (within 30-ft range).
  // Offsets: (1,0), (-1,0), (0,1) — forms an L around the caster.
  const offsets = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
  ];
  const off = offsets[index % offsets.length];
  const pos = { x: caster.pos.x + off.dx, y: caster.pos.y + off.dy, z: caster.pos.z };

  const id = `giant_spider_${caster.id}_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`;
  const speed = 30;

  return {
    id,
    name: `Giant Spider (${caster.name})`,
    isPlayer: false,
    faction: caster.faction,
    creatureType: 'beast',
    maxHP: 26,
    currentHP: 26,
    ac: 14,
    speed,
    flySpeed: null,
    swimSpeed: null,
    burrowSpeed: null,
    climbSpeed: 30,
    str: 14,
    dex: 16,
    con: 12,
    int: 2,
    wis: 11,
    cha: 4,
    cr: 1,
    pos,
    actions: [buildBiteAction()],
    traits: [],
    legendaryActions: [],
    legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: {
      movementFt: speed,
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
    immunities: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    // Summon subsystem (TG-006) — despawn on caster death via removeEffectsFromCaster
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Giant Insect',
  } as Combatant;
}

/**
 * Lair-action execute for Giant Insect — Arasta "spiders only" (S116 + S117 v2).
 *
 * S117 v2 despawn-on-reuse: BEFORE summoning new spiders, despawn any existing
 * giant-insect spiders from this caster (canon: "lasts until she uses this lair
 * action again" — when Arasta re-uses the lair action, the old spiders vanish
 * and new ones appear). Mirrors the removeEffectsFromCaster despawn pattern
 * (spell_effects.ts:289) but filtered to summonSpellName='Giant Insect' (not
 * all the caster's summons — Arasta might have other summons in a future
 * engine). S116 only despawned on caster death; S117 adds despawn-on-reuse.
 *
 * Summons 3 giant spider combatants on the caster's faction. Does NOT consume
 * a slot or start concentration (suppress mode). Sets the forward-compat flag.
 * The spiders also despawn on caster death (removeEffectsFromCaster → despawn
 * by summonerId).
 *
 * @param caster  the lair creature (Arasta)
 * @param state   engine state
 */
export function executeLair(caster: Combatant, state: EngineState): void {
  const bf = state.battlefield;

  // ── S117 v2: despawn existing giant-insect spiders before summoning new ──
  // Canon: "It lasts until she uses this lair action again or until she dies."
  // When Arasta re-uses the lair action, the previous spiders vanish + new ones
  // appear. Filter by summonerId + summonSpellName (NOT all summons — only the
  // Giant Insect lair-summoned spiders). Mirrors removeEffectsFromCaster's
  // despawn loop (spell_effects.ts:294-308) but targeted.
  const oldSpiders = [...bf.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Giant Insect'
  );
  for (const spider of oldSpiders) {
    bf.combatants.delete(spider.id);
    const initIdx = bf.initiativeOrder.indexOf(spider.id);
    if (initIdx !== -1) bf.initiativeOrder.splice(initIdx, 1);
    bf.pendingCommands?.delete(spider.id);
    if (bf.pendingInitiativeInserts) {
      bf.pendingInitiativeInserts = bf.pendingInitiativeInserts.filter(
        i => i.combatantId !== spider.id
      );
    }
  }
  if (oldSpiders.length > 0) {
    emit(
      state, 'action', caster.id,
      `${caster.name}'s previous ${oldSpiders.length} giant spider${oldSpiders.length === 1 ? '' : 's'} ` +
      `vanish as she re-uses the lair action (canon: "lasts until she uses this lair action again").`,
      caster.id,
    );
  }

  // Set the forward-compat flag (kept for consistency with the player spell path
  // + tracking). NOTE: the lair path now uses shouldCastLairGiantInsect (which
  // does NOT check this flag), so the flag no longer gates the lair re-cast.
  if (!caster._genericSpellActiveSpells) {
    caster._genericSpellActiveSpells = new Set<string>();
  }
  caster._genericSpellActiveSpells.add('Giant Insect');

  let summoned = 0;
  for (let i = 0; i < LAIR_SPIDER_COUNT; i++) {
    const spider = createGiantSpider(caster, i);
    bf.combatants.set(spider.id, spider);

    // Insert into initiative after the caster (mirrors summon_beast.ts).
    if (!bf.pendingInitiativeInserts) {
      bf.pendingInitiativeInserts = [];
    }
    bf.pendingInitiativeInserts.push({
      combatantId: spider.id,
      insertAfterId: caster.id,
    });
    summoned++;
  }

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Giant Insect (spiders only) via lair action! ${summoned} giant spiders ` +
    `appear and obey ${caster.name}'s commands (they last until she uses this lair action again ` +
    `or until she dies). Each spider: 26 HP, AC 14, Bite +5 1d8+3 piercing.`,
    caster.id,
  );
}
