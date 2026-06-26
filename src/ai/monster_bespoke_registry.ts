// ============================================================
// Monster Bespoke Spell Registry
// RFC: docs/RFC-MONSTER-SPELLCASTING.md — Phase 4 (Session 76)
//
// Module: src/ai/monster_bespoke_registry.ts
//
// Maps bestiary spell names to bespoke plan types (case branches in
// combat.ts). This closes the Phase 4 gap: ~611 unique bespoke-only
// spells (Fireball, Command, Hold Person, Cure Wounds, etc.) were
// silently skipped by Phase 2/3 because they're not in GENERIC_SPELLS.
//
// Architecture:
//   - The planner (selectMonsterSlottedSpell / selectMonsterDailySpell)
//     checks GENERIC_SPELLS first (Phase 2/3 path). If not found, it
//     consults this registry. If found here, the plan type is set to
//     the bespoke case name (e.g. 'fireball') instead of 'genericSpell'.
//   - combat.ts's executePlannedAction detects monster-bespoke plan
//     types and attaches synthetic state (action + resources) before
//     the switch. The existing bespoke case branch then handles
//     shouldCast + execute normally. Synthetic state is cleaned up
//     after the switch.
//
// Design decisions:
//   - NO shouldCast imports: the planner does NOT call shouldCast for
//     bespoke spells (only for generic spells). Instead, it relies on
//     weight scoring + tag filtering + target selection. combat.ts's
//     case branch calls shouldCast at execute time. If shouldCast
//     fails, the spell doesn't fire — but the slot/daily use was
//     already consumed (same as PC spellcasting where a spell can be
//     "wasted" if the target dies between plan and execute).
//   - Reaction spells (Shield, Counterspell, Absorb Elements,
//     Hellish Rebuke, Silvery Barbs, Feather Fall) are EXCLUDED —
//     they're triggered by the reaction system, not proactively cast.
//   - Utility spells (Detect Magic, Identify, etc.) are INCLUDED but
//     their tags are ['utility'] → weight 0 → skipped by the planner.
//   - Spell names are case-insensitive (bestiary uses lowercase).
//   - Variant names like "plane shift (self only)" are normalized
//     (parentheticals stripped) before lookup.
//
// Coverage: ~180 bespoke spells mapped (top combat-relevant spells
// used by monsters, covering ~700 of 770 creatures with bespoke-only
// spells).
// ============================================================

import { SpellTag } from './monster_spellcasting';
import { Combatant, Action } from '../types/core';

export interface MonsterBespokeEntry {
  canonicalName: string;  // Title Case (e.g. 'Fireball') — used for synthetic action.name
  planType: string;       // bespoke case name in combat.ts (e.g. 'fireball')
  level: number;          // spell level (for weight scoring + castSlotLevel)
  tags: SpellTag[];       // for weighted scoring (reuses SPELL_TAG_OVERRIDES categories)
}

// ---- Category arrays (organized by tag for maintainability) ----
// Each entry: [canonicalName, planType, level]

const DEFENDING_BESPOQUE: [string, string, number][] = [
  ['Mage Armor', 'mageArmor', 1],
  ['Mirror Image', 'mirrorImage', 2],
  ['Misty Step', 'mistyStep', 2],
  ['Blur', 'blur', 2],
  ['Invisibility', 'invisibility', 2],
  ['Greater Invisibility', 'greaterInvisibility', 4],
  ['Barkskin', 'barkskin', 2],
  ['Pass Without Trace', 'passWithoutTrace', 2],
  ['Darkvision', 'darkvision', 2],
  ['See Invisibility', 'seeInvisibility', 2],
  ['Spider Climb', 'spiderClimb', 2],
  ['Alter Self', 'alterSelf', 2],
  ['Levitate', 'levitate', 2],
  ['Shadow of Moil', 'shadowOfMoil', 4],
  ['Superior Invisibility', 'superiorInvisibility', 4],
  ['Death Armor', 'deathArmor', 2],
  ['Dust Devil', 'dustDevil', 2],
  ['Cacophonic Shield', 'cacophonicShield', 2],
  ['Armor of Agathys', 'armorOfAgathys', 1],
  ['False Life', 'falseLife', 1],
  ['Thunder Step', 'thunderStep', 3],
  ['Dimension Door', 'dimensionDoor', 4],
  ['Etherealness', 'etherealness', 7],
  ['Wind Walk', 'windWalk', 6],
  ['Teleport', 'teleport', 7],
  ['Misty Step', 'mistyStep', 2],
  ['Shadow Blade', 'shadowBlade', 2],
  ['Shield of Faith', 'shieldOfFaith', 1],  // concentration buff but defending-oriented
  ['Warding Bond', 'wardingBond', 2],
];

const BUFF_BESPOQUE: [string, string, number][] = [
  ['Bless', 'bless', 1],
  ['Bane', 'bane', 1],
  ['Enhance Ability', 'enhanceAbility', 2],
  ['Enlarge/Reduce', 'enlargeReduce', 2],
  ['Magic Weapon', 'magicWeapon', 2],
  ['Spiritual Weapon', 'spiritualWeapon', 2],
  ['Flame Blade', 'flameBlade', 2],
  ['Elemental Weapon', 'elementalWeapon', 3],
  ['Holy Weapon', 'holyWeapon', 5],
  ['Divine Favor', 'divineFavor', 1],
  ['Beacon of Hope', 'beaconOfHope', 3],
  ['Holy Aura', 'holyAura', 8],
  ['Foresight', 'foresight', 9],
  ['Intellect Fortress', 'intellectFortress', 3],
  ['Motivational Speech', 'motivationalSpeech', 3],
  ['Spirit Shroud', 'spiritShroud', 3],
  ['Swift Quiver', 'swiftQuiver', 5],
  ['Flame Arrows', 'flameArrows', 3],
  ['Aura of Vitality', 'auraOfVitality', 3],
];

const HEALING_BESPOQUE: [string, string, number][] = [
  ['Cure Wounds', 'cureWounds', 1],
  ['Healing Word', 'healingWord', 1],
  ['Aid', 'aid', 2],
  ['Prayer of Healing', 'prayerOfHealing', 2],
  ['Mass Healing Word', 'massHealingWord', 3],
  ['Mass Cure Wounds', 'massCureWounds', 5],
  ['Heal', 'heal', 6],
  ['Mass Heal', 'massHeal', 7],
  ['Regenerate', 'regenerate', 7],
  ['Power Word Heal', 'powerWordHeal', 9],
  ['Revivify', 'revivify', 3],
  ['Lesser Restoration', 'lesserRestoration', 2],
  ['Protection from Poison', 'protectionFromPoison', 2],
  ['Lay on Hands', 'layOnHands', 1],  // class feature, but has a case branch
  ['Wholeness of Body', 'wholenessOfBody', 3],  // class feature
  ['Goodberry', 'goodberry', 1],
  ['Healing Spirit', 'healingSpirit', 2],
  ['Wither and Bloom', 'witherAndBloom', 2],
  ['Aura of Vitality', 'auraOfVitality', 3],  // also in buff
];

const CC_BESPOQUE: [string, string, number][] = [
  ['Command', 'command', 1],
  ['Hold Person', 'holdPerson', 2],
  ['Hold Monster', 'holdMonster', 5],
  ['Banishment', 'banishment', 4],
  ['Sleep', 'sleep', 1],
  ['Entangle', 'entangle', 1],
  ['Web', 'web', 2],
  ['Spike Growth', 'spikeGrowth', 2],
  ['Sleet Storm', 'sleetStorm', 3],
  ['Stinking Cloud', 'stinkingCloud', 3],
  ["Evard's Black Tentacles", 'evardsBlackTentacles', 4],
  ['Black Tentacles', 'evardsBlackTentacles', 4],
  ['Cloud of Daggers', 'cloudOfDaggers', 2],
  ['Hypnotic Pattern', 'hypnoticPattern', 3],
  ['Fear', 'fear', 3],
  ['Blindness/Deafness', 'blindnessDeafness', 2],
  ['Calm Emotions', 'calmEmotions', 2],
  ['Crown of Madness', 'crownOfMadness', 2],
  ['Suggestion', 'suggestion', 2],
  ['Mass Suggestion', 'massSuggestion', 6],
  ['Dominate Person', 'dominatePerson', 5],
  ['Dominate Monster', 'dominateMonster', 8],
  ['Dominate Beast', 'dominateBeast', 4],
  ['Charm Person', 'charmPerson', 1],
  ['Charm Monster', 'charmMonster', 4],
  ['Compelled Duel', 'compelledDuel', 1],
  ['Tasha\'s Hideous Laughter', 'tashasHideousLaughter', 1],
  ['Cause Fear', 'causeFear', 1],
  ['Bestow Curse', 'bestowCurse', 3],
  ['Contagion', 'contagion', 5],
  ['Geas', 'geas', 5],
  ['Phantasmal Force', 'phantasmalForce', 2],
  ['Phantasmal Killer', 'phantasmalKiller', 4],
  ['Weird', 'weird', 9],
  ['Mental Prison', 'mentalPrison', 6],
  ['Psychic Scream', 'psychicScream', 9],
  ['Synaptic Static', 'synapticStatic', 5],
  ['Mind Spike', 'mindSpike', 2],
  ['Enemies Abound', 'enemiesAbound', 3],
  ['Enthrall', 'enthrall', 2],
  ['Fast Friends', 'fastFriends', 3],
  ['Incite Greed', 'inciteGreed', 3],
  ['Antagonize', 'antagonize', 1],
  ['Catnap', 'catnap', 3],
  ['Color Spray', 'colorSpray', 1],
  ['Pyrotechnics', 'pyrotechnics', 2],
  ['Grease', 'grease', 1],
  ['Gust of Wind', 'gustOfWind', 2],
  ['Wall of Fire', 'wallOfFire', 4],
  ['Wall of Force', 'wallOfForce', 5],
  ['Wall of Ice', 'wallOfIce', 6],
  ['Wall of Stone', 'wallOfStone', 5],
  ['Wall of Thorns', 'wallOfThorns', 6],
  ['Wind Wall', 'windWall', 3],
  ['Prismatic Wall', 'prismaticWall', 9],
  ['Maze', 'maze', 8],
  ['Magic Circle', 'magicCircle', 3],
  ['Forbiddance', 'forbiddance', 6],
  ['Hallow', 'hallow', 5],
  ['Symbol', 'symbol', 7],
  ['Planar Binding', 'planarBinding', 5],
  ['Faerie Fire', 'faerieFire', 1],
  ['Darkness', 'darkness', 2],
  ['Silence', 'silence', 2],
  ['Fog Cloud', 'fogCloud', 1],
  ['Watery Sphere', 'waterySphere', 4],
  ['Whirlwind', 'whirlwind', 7],
  ['Reverse Gravity', 'reverseGravity', 7],
  ['Maelstrom', 'maelstrom', 5],
  ['Earthquake', 'earthquake', 8],
  ['Flesh to Stone', 'fleshToStone', 6],
  ['Eyebite', 'eyebite', 6],
  ['Power Word Stun', 'powerWordStun', 8],
  ['Power Word Pain', 'powerWordPain', 1],
  ['Feeblemind', 'feeblemind', 8],
  ['Programmed Illusion', 'programmedIllusion', 6],
  ['Imprisonment', 'imprisonment', 6],
  ['Cordon of Arrows', 'cordonOfArrows', 2],
  ['Animal Friendship', 'animalFriendship', 1],
];

const DAMAGE_BESPOQUE: [string, string, number][] = [
  ['Fireball', 'fireball', 3],
  ['Lightning Bolt', 'lightningBolt', 3],
  ['Cone of Cold', 'coneOfCold', 5],
  ['Burning Hands', 'burningHands', 1],
  ['Thunderwave', 'thunderwave', 1],
  ['Shatter', 'shatter', 2],
  ['Magic Missile', 'magicMissile', 1],
  ['Chromatic Orb', 'chromaticOrb', 1],
  ['Catapult', 'catapult', 1],
  ['Ice Knife', 'iceKnife', 1],
  ['Melf\'s Acid Arrow', 'melfsAcidArrow', 2],
  ['Ray of Enfeeblement', 'rayOfEnfeeblement', 2],
  ['Scorching Ray', 'scorchingRay', 2],
  ['Inflict Wounds', 'inflictWounds', 1],
  ['Guiding Bolt', 'guidingBolt', 1],
  ['Moonbeam', 'moonbeam', 2],
  ['Flaming Sphere', 'flamingSphere', 2],
  ['Heat Metal', 'heatMetal', 2],
  ['Create Bonfire', 'createBonfire', 0],
  ['Blight', 'blight', 4],
  ['Cloudkill', 'cloudkill', 5],
  ['Disintegrate', 'disintegrate', 6],
  ['Harm', 'harm', 6],
  ['Finger of Death', 'fingerOfDeath', 7],
  ['Sunburst', 'sunburst', 8],
  ['Sunbeam', 'sunbeam', 6],
  ['Power Word Kill', 'powerWordKill', 9],
  ['Chaos Bolt', 'chaosBolt', 1],
  ['Earth Tremor', 'earthTremor', 1],
  ['Frost Fingers', 'frostFingers', 1],
  ['Magnify Gravity', 'magnifyGravity', 1],
  ['Ray of Sickness', 'rayOfSickness', 1],
  ['Witch Bolt', 'witchBolt', 1],
  ['Spray of Cards', 'sprayOfCards', 1],
  ['Erupting Earth', 'eruptingEarth', 3],
  ['Life Transference', 'lifeTransference', 3],
  ['Pulse Wave', 'pulseWave', 3],
  ['Tidal Wave', 'tidalWave', 3],
  ['Vampiric Touch', 'vampiricTouch', 3],
  ['Elemental Bane', 'elementalBane', 4],
  ['Gravity Sinkhole', 'gravitySinkhole', 4],
  ['Ice Storm', 'iceStorm', 4],
  ['Sickening Radiance', 'sickeningRadiance', 4],
  ['Storm Sphere', 'stormSphere', 4],
  ['Vitriolic Sphere', 'vitriolicSphere', 4],
  ['Destructive Wave', 'destructiveWave', 5],
  ['Enervation', 'enervation', 5],
  ['Flame Strike', 'flameStrike', 5],
  ['Immolation', 'immolation', 5],
  ['Negative Energy Flood', 'negativeEnergyFlood', 5],
  ['Steel Wind Strike', 'steelWindStrike', 5],
  ['Chain Lightning', 'chainLightning', 6],
  ['Circle of Death', 'circleOfDeath', 6],
  ['Gravity Fissure', 'gravityFissure', 6],
  ['Crown of Stars', 'crownOfStars', 7],
  ['Fire Storm', 'fireStorm', 7],
  ['Dark Star', 'darkStar', 8],
  ['Incendiary Cloud', 'incendiaryCloud', 8],
  ['Maddening Darkness', 'maddeningDarkness', 8],
  ['Ravenous Void', 'ravenousVoid', 9],
  ['Dissonant Whispers', 'dissonantWhispers', 1],
  ['Arms of Hadar', 'armsOfHadar', 1],
  ['Hex', 'hex', 1],
  ['Call Lightning', 'callLightning', 3],
  ['Hunger of Hadar', 'hungerOfHadar', 3],
  ['Spirit Guardians', 'spiritGuardians', 3],
  ['Guardian of Faith', 'guardianOfFaith', 4],
  ['Dawn', 'dawn', 5],
  ['Insect Plague', 'insectPlague', 5],
  ['Storm of Vengeance', 'stormOfVengeance', 9],
  ['Spellfire Flare', 'spellfireFlare', 1],
  ['Spellfire Storm', 'spellfireStorm', 4],
  ['Wardaway', 'wardaway', 1],
  ['Flame Arrows', 'flameArrows', 3],  // also in buff
];

const UTILITY_BESPOQUE: [string, string, number][] = [
  // These have case branches but shouldCast always returns null/false in combat.
  // Included for completeness — the planner's tag filter (utility → weight 0)
  // ensures they're never auto-cast.
  ['Detect Magic', 'detectMagic', 1],
  ['Detect Thoughts', 'detectThoughts', 2],
  ['Detect Evil and Good', 'detectEvilAndGood', 1],
  ['Detect Poison and Disease', 'detectPoisonAndDisease', 1],
  ['Identify', 'identify', 1],
  ['Comprehend Languages', 'comprehendLanguages', 1],
  ['Augury', 'augury', 2],
  ['Divination', 'divination', 4],
  ['Commune', 'commune', 5],
  ['Legend Lore', 'legendLore', 5],
  ['Scrying', 'scrying', 5],
  ['Clairvoyance', 'clairvoyance', 3],
  ['Arcane Eye', 'arcaneEye', 4],
  ['Find the Path', 'findThePath', 6],
  ['Locate Creature', 'locateCreature', 4],
  ['Locate Object', 'locateObject', 2],
  ['Locate Animals or Plants', 'locateAnimalsOrPlants', 2],
  ['Sending', 'sending', 3],
  ['Tongues', 'tongues', 3],
  ['Water Breathing', 'waterBreathing', 3],
  ['Water Walk', 'waterWalk', 3],
  ['Longstrider', 'longstrider', 1],
  ['Gentle Repose', 'gentleRepose', 2],
  ['Contact Other Plane', 'contactOtherPlane', 5],
  ['Dream', 'dream', 5],
  ['Awaken', 'awaken', 5],
  ["Heroes' Feast", 'heroesFeast', 6],
  ['Illusory Script', 'illusoryScript', 1],
  ['Rope Trick', 'ropeTrick', 2],
  ['Telepathy', 'telepathy', 8],
  ['Astral Projection', 'astralProjection', 9],
  ['Clone', 'clone', 8],
  ["Drawmij's Instant Summons", 'drawmajsInstantSummons', 6],
  ['Planar Ally', 'planarAlly', 6],
  ['Resurrection', 'resurrection', 7],
  ['Simulacrum', 'simulacrum', 7],
  ['Contingency', 'contingency', 6],
  ['Demiplane', 'demiplane', 8],
  ['Create Undead', 'createUndead', 6],
  ['Raise Dead', 'raiseDead', 5],
  ['Animate Dead', 'animateDead', 3],
  ['Gate', 'gate', 9],
  ['Wish', 'wish', 9],
  ['Plane Shift', 'planeShift', 7],
  ['Word of Recall', 'wordOfRecall', 6],
  ['Protection from Evil and Good', 'protectionFromEvilAndGood', 1],
  ['Dispel Evil and Good', 'dispelEvilAndGood', 5],
  ['Shapechange', 'shapechange', 9],
  ['Knock', 'knock', 2],
  ['Arcane Lock', 'arcaneLock', 2],
];

// ---- Build the registry --------------------------------------

/**
 * Build the registry from category arrays.
 * Priority order (last wins for spells listed in multiple categories):
 * utility > damage > cc > healing > buff > defending
 * This matches SPELL_TAG_OVERRIDES priority.
 */
function buildMonsterBespokeRegistry(): {
  byNameLower: Map<string, MonsterBespokeEntry>;
  byPlanType: Map<string, MonsterBespokeEntry>;
} {
  const byNameLower = new Map<string, MonsterBespokeEntry>();
  const byPlanType = new Map<string, MonsterBespokeEntry>();

  const add = (canonicalName: string, planType: string, level: number, tags: SpellTag[]) => {
    const entry: MonsterBespokeEntry = { canonicalName, planType, level, tags };
    byNameLower.set(canonicalName.toLowerCase(), entry);
    // Don't overwrite if already present (first registration wins for plan type)
    if (!byPlanType.has(planType)) {
      byPlanType.set(planType, entry);
    }
  };

  // Priority order: defending (lowest) → buff → healing → cc → damage → utility (highest)
  for (const [name, planType, level] of DEFENDING_BESPOQUE) add(name, planType, level, ['defending']);
  for (const [name, planType, level] of BUFF_BESPOQUE) add(name, planType, level, ['buff']);
  for (const [name, planType, level] of HEALING_BESPOQUE) add(name, planType, level, ['healing']);
  for (const [name, planType, level] of CC_BESPOQUE) add(name, planType, level, ['cc']);
  for (const [name, planType, level] of DAMAGE_BESPOQUE) add(name, planType, level, ['damage']);
  for (const [name, planType, level] of UTILITY_BESPOQUE) add(name, planType, level, ['utility']);

  return { byNameLower, byPlanType };
}

const REGISTRY = buildMonsterBespokeRegistry();

// ---- Public API ----------------------------------------------

/**
 * Normalize a spell name for lookup: trim, strip trailing parentheticals
 * like "(self only)" or "(as an action)", lowercase.
 *
 * The bestiary stores spell names in lowercase with optional parenthetical
 * variants (e.g. "plane shift (self only)", "scrying (as an action)").
 * The parser strips parentheticals for daily spells but NOT for slot spells.
 * This function normalizes both.
 */
function normalizeSpellName(name: string): string {
  return name
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, '')  // strip trailing parentheticals
    .trim()
    .toLowerCase();
}

/**
 * Look up a bespoke spell by its name (case-insensitive, parenthetical-
 * tolerant). Returns the entry or null if not a registered monster-bespoke
 * spell.
 *
 * Used by the planner (selectMonsterSlottedSpell / selectMonsterDailySpell)
 * to discover bespoke spells that aren't in GENERIC_SPELLS.
 */
export function lookupMonsterBespokeByName(name: string): MonsterBespokeEntry | null {
  if (!name) return null;
  const normalized = normalizeSpellName(name);
  return REGISTRY.byNameLower.get(normalized) ?? null;
}

/**
 * Look up a bespoke spell by its plan type (e.g. 'fireball', 'command').
 * Returns the entry or null if not a registered monster-bespoke plan type.
 *
 * Used by combat.ts to detect monster-bespoke plan types and attach
 * synthetic state before the switch.
 */
export function lookupMonsterBespokeByPlanType(planType: string): MonsterBespokeEntry | null {
  if (!planType) return null;
  return REGISTRY.byPlanType.get(planType) ?? null;
}

/**
 * Check if a plan type is a registered monster-bespoke spell.
 * Convenience wrapper around lookupMonsterBespokeByPlanType.
 */
export function isMonsterBespokePlanType(planType: string): boolean {
  return REGISTRY.byPlanType.has(planType);
}

/**
 * Returns the canonical names of every registered monster-bespoke spell.
 * Used by tests + the scan script to mark these spells as "implemented"
 * for monster spellcasting.
 */
export function listMonsterBespokeSpellNames(): string[] {
  return Array.from(REGISTRY.byNameLower.values()).map(e => e.canonicalName);
}

// ---- Synthetic State Helper (for combat.ts dispatch) ----------

/**
 * Attach synthetic action + resources to a monster for a bespoke spell
 * cast. Returns a cleanup function that removes the synthetic state.
 *
 * Used by combat.ts's executePlannedAction to re-establish the synthetic
 * state that was cleaned up after planning. The bespoke shouldCast
 * functions (e.g. shouldCastFireball) check:
 *   1. `caster.actions.some(a => a.name === 'Fireball')` — action presence
 *   2. `hasSpellSlot(caster, 3)` — slot availability
 *
 * Monsters don't have either (their spells are in `monsterSpellcasting`,
 * not `actions`, and they have no `resources.spellSlots`). This helper
 * temporarily adds both so the bespoke shouldCast passes.
 *
 * The synthetic action uses the CANONICAL Title Case name (e.g.
 * 'Fireball') so the bespoke shouldCast's `a.name === 'Fireball'` check
 * matches.
 *
 * The synthetic resources provide all slots L1-9 as available (so
 * `hasSpellSlot` returns true for any level). The actual slot/daily-use
 * consumption happens in the planner (upfront) — execute()'s call to
 * `consumeSpellSlot()` is a safe no-op for monsters (returns null when
 * `resources` is null OR when the slot is already exhausted — doesn't
 * crash).
 *
 * Cleanup is idempotent: calling the returned function multiple times
 * is safe (the filter + null-set are no-ops after the first call).
 */
export function attachMonsterBespokeSyntheticState(
  monster: Combatant,
  canonicalName: string,
  level: number,
): () => void {
  // Add synthetic action if not already present.
  const hadAction = monster.actions.some(a => a.name === canonicalName);
  if (!hadAction) {
    monster.actions.push({
      name: canonicalName,
      isMultiattack: false,
      attackType: 'spell',
      reach: 0, range: null,
      hitBonus: 0,
      damage: { count: 0, sides: 0, bonus: 0, average: 0 },
      damageType: 'force',
      saveDC: monster.monsterSpellcasting?.saveDC ?? null,
      saveAbility: null,
      isAoE: false, isControl: false,
      requiresConcentration: false,
      slotLevel: level,
      costType: 'action', legendaryCost: 0,
      description: `${canonicalName} (monster bespoke — synthetic, execute-time)`,
    } as Action);
  }

  // Set synthetic resources if not already present.
  const originalResources = monster.resources;
  if (!originalResources) {
    monster.resources = {
      spellSlots: {
        1: { max: 4, remaining: 4 },
        2: { max: 3, remaining: 3 },
        3: { max: 3, remaining: 3 },
        4: { max: 3, remaining: 3 },
        5: { max: 2, remaining: 2 },
        6: { max: 1, remaining: 1 },
        7: { max: 1, remaining: 1 },
        8: { max: 1, remaining: 1 },
        9: { max: 1, remaining: 1 },
      },
    } as any;
  }

  let cleaned = false;
  return () => {
    if (cleaned) return;  // idempotent
    cleaned = true;
    if (!hadAction) {
      monster.actions = monster.actions.filter(a => a.name !== canonicalName);
    }
    if (!originalResources) {
      monster.resources = null;
    }
  };
}
