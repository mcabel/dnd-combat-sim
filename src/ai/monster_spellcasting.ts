// ============================================================
// Monster Spellcasting Engine Integration
// RFC: docs/RFC-MONSTER-SPELLCASTING.md
//
// Module: src/ai/monster_spellcasting.ts
//
// Phase 1 (Session 63): At-will spells + cantrips only (no slot consumption,
//   no daily tracking). Iterates `monsterSpellcasting.atWill` +
//   `monsterSpellcasting.slots[0].spells`. For each spell name
//   (case-insensitive), looks up a `CANTRIP_TEMPLATE`. Builds a synthetic
//   spell-attack Action (attack-roll OR save-based). Weighted scoring:
//   prefer damage cantrips on full HP, defending on low HP. Returns a
//   PlannedAction (type: 'cast') or null (fall back to weapon attacks).
//
// Phase 2 (Session 75): Slot-based leveled spells — `monsterSpellSlots`
//   consumption. Iterates `monsterSpellcasting.slots[1-9].spells` (level 0
//   = cantrips, handled by Phase 1). For each spell with a slot available,
//   looks up the GENERIC_SPELLS registry. Runs the spell's shouldCast()
//   gate. Computes weight via the same scoring pipeline as Phase 1/3.
//   Consumes the slot UPFRONT and returns a PlannedAction (type:
//   'genericSpell'). Only spells in GENERIC_SPELLS are dispatchable
//   (77 of 373 unique slotted spells). Bespoke-only slotted spells
//   (Fireball, Counterspell, Dispel Magic, etc.) are Phase 4+ future work.
// Phase 3 (Session 74): daily-use spells — `monsterDailyUses` consumption.
//   Iterates `monsterSpellcasting.daily` (spell name → uses/day). For each
//   spell with remaining uses, looks up the GENERIC_SPELLS registry. Runs
//   the spell's shouldCast() gate. Computes weight via the same scoring
//   pipeline as Phase 1 (tags × context × pattern biases). Consumes the
//   daily use UPFRONT and returns a PlannedAction (type: 'genericSpell').
//   Only spells in GENERIC_SPELLS are dispatchable (105 of 420 unique daily
//   spells). Bespoke-only daily spells (Command, Hold Person, etc.) are
//   Phase 4+ future work.
// Phase 4 (DEFERRED): spell upcast, multi-target AoE, reaction spells,
//   bespoke-only daily/slotted spells via name→plan-type mapping.
//
// Autonomous decisions (RFC §9.1, Core + Sheet offline):
//   #1 = A: Only cast spells with a known template (skip unimplemented).
//   #2 = Weighted system decides (no forced opener).
//   #3 = B: Cantrip-finisher bonus when target HP ≤ cantrip avg dmg × 1.5.
//   #4 = A: Break concentration automatically (Phase 2+ — moot for Phase 1).
//   #5 = B: Situational priority for daily-use spells (Phase 3).
//   #6 = A: Skip silently when spell not in library.
//
// Dispatch path:
//   selectMonsterSpell() → PlannedAction { type: 'cast', action: syntheticAction }
//   combat.ts `case 'cast':` → resolveAttack(actor, target, action, state)
//   resolveAttack handles both attack-roll (attackType='spell') and
//   save-based (attackType='save' + saveDC + saveAbility) cantrips.
// ============================================================

import { Combatant, Battlefield, Action, PlannedAction, DamageType, AbilityScore } from '../types/core';
import { chebyshev3D } from '../engine/movement';
import { composeBiases, collectCantripBiases } from './pattern_bias';
import { requiresVisibleTarget } from '../engine/perception';
import { cantripTier } from '../engine/utils';
import { lookupGenericSpell } from '../spells/_generic_registry';

// ---- Spell Tags (RFC §4.1) ----------------------------------

export type SpellTag = 'damage' | 'cc' | 'healing' | 'defending' | 'buff' | 'utility';

// ---- Cantrip Templates (Phase 1 — top 13 combat cantrips) ----

/**
 * A cantrip template captures the mechanical essentials needed to build a
 * synthetic spell-attack Action for a monster. Derived from the PHB/XGE
 * cantrip modules (src/spells/<name>.ts). Damage scales at caster level
 * 5/11/17 (2/3/4 dice) — see `cantripDiceCount()`.
 *
 * `attackRoll: true`  → ranged/melee spell attack (attackType: 'spell').
 * `attackRoll: false` → save-based cantrip (attackType: 'save' + saveAbility).
 *
 * Phase 1 includes only combat cantrips (damage or condition applicators).
 * Utility cantrips (Mage Hand, Prestidigitation, Dancing Lights, Light,
 * Message, Minor Illusion, etc.) are intentionally excluded — they have no
 * combat effect and would waste the monster's action (Doubt #1 = A: skip).
 */
export interface CantripTemplate {
  name: string;            // canonical capitalization
  damageSides: number;     // die sides (d8 → 8, d10 → 10, d12 → 12)
  damageType: DamageType;  // 'fire' | 'cold' | 'necrotic' | etc.
  rangeFt: number;         // 0 = touch (melee spell attack)
  attackRoll: boolean;     // true = attack roll, false = save
  saveAbility?: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  tags: SpellTag[];        // primary tags for weighted scoring
  // Optional rider description (for logging only — mechanical riders like
  // Ray of Frost's speed reduction are NOT applied in Phase 1; resolveAttack
  // doesn't invoke cantrip riders. Forward-compat TODO.)
  rider?: string;
}

const CANTRIP_TEMPLATES: Record<string, CantripTemplate> = {
  // key = lowercase canonical name (case-insensitive lookup)
  'fire bolt': {
    name: 'Fire Bolt', damageSides: 10, damageType: 'fire',
    rangeFt: 120, attackRoll: true, tags: ['damage'],
  },
  'ray of frost': {
    name: 'Ray of Frost', damageSides: 8, damageType: 'cold',
    rangeFt: 60, attackRoll: true, tags: ['damage'],
    rider: 'speed reduced by 10 ft (not applied in Phase 1)',
  },
  'eldritch blast': {
    name: 'Eldritch Blast', damageSides: 10, damageType: 'force',
    rangeFt: 120, attackRoll: true, tags: ['damage'],
    rider: 'multiple beams at higher levels (Phase 1: single beam)',
  },
  'chill touch': {
    name: 'Chill Touch', damageSides: 8, damageType: 'necrotic',
    rangeFt: 120, attackRoll: true, tags: ['damage'],
    rider: 'no healing for undead target (not applied in Phase 1)',
  },
  'shocking grasp': {
    name: 'Shocking Grasp', damageSides: 8, damageType: 'lightning',
    rangeFt: 5, attackRoll: true, tags: ['damage'],
    rider: 'advantage vs metal armor (not applied in Phase 1)',
  },
  'produce flame': {
    name: 'Produce Flame', damageSides: 8, damageType: 'fire',
    rangeFt: 30, attackRoll: true, tags: ['damage'],
  },
  'thorn whip': {
    name: 'Thorn Whip', damageSides: 6, damageType: 'piercing',
    rangeFt: 30, attackRoll: true, tags: ['damage'],
    rider: 'pull up to 10 ft (not applied in Phase 1)',
  },
  'sacred flame': {
    name: 'Sacred Flame', damageSides: 8, damageType: 'radiant',
    rangeFt: 60, attackRoll: false, saveAbility: 'dex', tags: ['damage'],
    rider: 'ignores cover (not applied in Phase 1)',
  },
  'toll the dead': {
    name: 'Toll the Dead', damageSides: 8, damageType: 'necrotic',
    rangeFt: 60, attackRoll: false, saveAbility: 'wis', tags: ['damage'],
    rider: 'd12 if target missing HP (not applied in Phase 1)',
  },
  'acid splash': {
    name: 'Acid Splash', damageSides: 6, damageType: 'acid',
    rangeFt: 60, attackRoll: false, saveAbility: 'dex', tags: ['damage'],
    rider: 'can target 2 creatures within 5 ft (Phase 1: single target)',
  },
  'poison spray': {
    name: 'Poison Spray', damageSides: 12, damageType: 'poison',
    rangeFt: 10, attackRoll: false, saveAbility: 'con', tags: ['damage'],
  },
  'vicious mockery': {
    name: 'Vicious Mockery', damageSides: 4, damageType: 'psychic',
    rangeFt: 60, attackRoll: false, saveAbility: 'wis', tags: ['damage', 'cc'],
    rider: 'disadvantage on next attack (not applied in Phase 1)',
  },
  'mind sliver': {
    name: 'Mind Sliver', damageSides: 6, damageType: 'psychic',
    rangeFt: 60, attackRoll: false, saveAbility: 'int', tags: ['damage', 'cc'],
    rider: '-1d4 next save (not applied in Phase 1)',
  },
  // ── Session 63 Phase 3 additions: 4 more single-target combat cantrips ──
  // These expand monster cantrip coverage (more creatures can now cast their
  // cantrips instead of falling back to weapon attacks).
  'frostbite': {
    name: 'Frostbite', damageSides: 6, damageType: 'cold',
    rangeFt: 60, attackRoll: false, saveAbility: 'con', tags: ['damage', 'cc'],
    rider: 'disadvantage on next weapon attack (not applied in Phase 1)',
  },
  'primal savagery': {
    name: 'Primal Savagery', damageSides: 10, damageType: 'acid',
    rangeFt: 5, attackRoll: true, tags: ['damage'],
    // MELEE spell attack (touch range). Not a save.
  },
  'infestation': {
    name: 'Infestation', damageSides: 6, damageType: 'poison',
    rangeFt: 30, attackRoll: false, saveAbility: 'con', tags: ['damage', 'cc'],
    rider: 'forced movement up to 5 ft (not applied in Phase 1)',
  },
  'lightning lure': {
    name: 'Lightning Lure', damageSides: 8, damageType: 'lightning',
    rangeFt: 15, attackRoll: false, saveAbility: 'str', tags: ['damage', 'cc'],
    rider: 'pull target up to 10 ft toward caster (not applied in Phase 1)',
  },
};

// Case-insensitive lookup index (built once at module load).
const CANTRIP_BY_LOWER: Record<string, CantripTemplate> = {};
for (const [k, v] of Object.entries(CANTRIP_TEMPLATES)) {
  CANTRIP_BY_LOWER[k] = v;
}

/**
 * Look up a cantrip template by spell name (case-insensitive).
 * Returns null if the spell is not a known combat cantrip.
 *
 * Monster spell names from `monsterSpellcasting` are lowercase
 * (e.g. 'ray of frost'). This function normalizes and matches.
 *
 * Session 69 fix: also strips trailing 5etools cross-reference asterisks
 * (e.g. "fire bolt*" → "fire bolt"). The * marks spells sourced from a
 * different book than the monster's source — without this strip, monsters
 * whose atWill list contains "fire bolt*" would fail to look up the
 * Fire Bolt cantrip template and skip it entirely.
 */
export function lookupCantripTemplate(spellName: string): CantripTemplate | null {
  const normalized = spellName.toLowerCase().trim().replace(/\s*\*+\s*$/, '');
  return CANTRIP_BY_LOWER[normalized] ?? null;
}

/**
 * Session 67 — spell-coverage tracker.
 *
 * Returns the canonical (capitalized) names of every cantrip currently in
 * `CANTRIP_TEMPLATES`. Used by `scripts/scan_monster_spells.ts` to mark
 * those cantrips as "implemented" even when they are not in the spell cache
 * (the cache only covers PHB/XGE/TCE/etc. spell modules in `src/spells/`,
 * not the monster-only combat cantrip templates handled directly in this
 * module).
 */
export function listCantripTemplateNames(): string[] {
  return Object.values(CANTRIP_TEMPLATES).map(t => t.name);
}

// ---- Spell Tag Derivation (RFC §6) --------------------------

/**
 * Spell tag overrides for at-will + daily-use leveled spells.
 *
 * Phase 1 uses cantrip templates directly (tags embedded in the template).
 * Phase 3 (Session 74) uses this map to derive tags for daily-use spells
 * dispatched via the GENERIC_SPELLS registry.
 *
 * Built from category maps below to avoid duplicate-key errors and keep
 * the listings maintainable. The first tag in each array is the PRIMARY
 * tag (drives the tagMultiplier scoring table).
 *
 * Categories:
 *   - defending: self-preservation / escape (Blink, Fly, Sanctuary, etc.)
 *   - buff: enhance allies / self for combat advantage (Bless, Haste, etc.)
 *   - healing: restore HP (Cure Wounds, Aid, Mass Heal, etc.)
 *   - cc: crowd control — conditions, restraints, incapacitation
 *   - damage: direct HP damage — AoE or single-target
 *   - utility: non-combat or situational — never auto-cast in v1
 */

// Defending (self-preservation / escape):
const DEFENDING_SPELLS: string[] = [
  'Shield', 'Misty Step', 'Blink', 'Blur', 'Mage Armor', 'Gaseous Form',
  'Fly', 'Greater Invisibility', 'Invisibility', 'Mirror Image', 'Stoneskin',
  'Pass without Trace', 'Protection from Energy', 'Death Ward', 'Fire Shield',
  "Fizban's Platinum Shield", 'Globe of Invulnerability', 'Invulnerability',
  'Sanctuary', 'Armor of Agathys', 'Expeditious Retreat', 'Dimension Door',
  'Thunder Step', 'Far Step', 'Etherealness', "Leomund's Tiny Hut",
  'Nondetection', 'Mind Blank', 'Antimagic Field',
];

// Buff (enhance allies / self for combat advantage):
const BUFF_SPELLS: string[] = [
  'Bless', 'Haste', 'Heroism', 'Barkskin', 'Magic Weapon', 'Enhance Ability',
  "Crusader's Mantle", 'Holy Aura', "Tenser's Transformation",
  "Dragon's Breath", "Ashardalon's Stride", 'Gift of Alacrity',
];

// Healing (restore HP):
const HEALING_SPELLS: string[] = [
  'Cure Wounds', 'Healing Word', 'Aid', 'Mass Cure Wounds', 'Mass Heal',
  'Heal', 'Regenerate', 'Prayer of Healing', 'Revivify', 'Greater Restoration',
  'Lesser Restoration', 'Remove Curse', 'Power Word Heal', 'Goodberry',
];

// CC (crowd control — conditions, restraints, incapacitation):
const CC_SPELLS: string[] = [
  'Hold Person', 'Hold Monster', 'Banishment', 'Web', 'Entangle', 'Sleep',
  'Hypnotic Pattern', 'Confusion', 'Slow', 'Blindness/Deafness',
  'Calm Emotions', 'Crown of Madness', 'Suggestion', 'Mass Suggestion',
  'Dominate Person', 'Dominate Monster', 'Telekinesis', 'Forcecage', 'Maze',
  'Symbol', 'Planar Binding', 'Compelled Duel', 'Command', 'Faerie Fire',
  'Darkness', 'Silence', 'Gust of Wind', 'Spirit Guardians', 'Blade Barrier',
  'Wall of Fire', 'Wall of Force', 'Wall of Ice', 'Wall of Stone',
  'Wall of Thorns', 'Wind Wall', 'Antilife Shell', 'Cloudkill',
  'Cloud of Daggers', "Evard's Black Tentacles", 'Black Tentacles',
  'Insect Plague', 'Stinking Cloud', 'Sleet Storm', 'Grease', 'Spike Growth',
  'Plant Growth', "Maximilian's Earthen Grasp", "Bigby's Hand",
  'Grasping Vine', 'Reverse Gravity', 'Maelstrom', 'Whirlwind',
  'Watery Sphere', 'Vitriolic Sphere', "Otiluke's Resilient Sphere",
  'Resilient Sphere', 'Fear', 'Dissonant Whispers', 'Phantasmal Force',
  'Phantasmal Killer', 'Weird', 'Mental Prison', 'Psychic Scream',
  'Synaptic Static', "Tasha's Mind Whip", 'Mind Spike', 'Enemies Abound',
  'Enthrall', 'Fast Friends', 'Compulsion', 'Cordon of Arrows',
  'Animate Objects', 'Bones of the Earth', 'Destructive Wave', 'Earthquake',
  "Mordenkainen's Sword", "Mordenkainen's Faithful Hound", 'Faithful Hound',
  'Flaming Sphere', 'Storm Sphere', 'Storm of Vengeance',
  "Melf's Minute Meteors", 'Delayed Blast Fireball', 'Incendiary Cloud',
  'Sunburst', 'Sunbeam', 'Daylight', 'Continual Flame', 'Levitate',
  'Modify Memory', 'Polymorph', 'Power Word Stun',
];

// Damage (direct HP damage — AoE or single-target):
const DAMAGE_SPELLS: string[] = [
  'Fireball', 'Lightning Bolt', 'Cone of Cold', 'Burning Hands', 'Shatter',
  'Thunderwave', 'Scorching Ray', 'Magic Missile', 'Chromatic Orb',
  'Catapult', 'Ice Knife', "Melf's Acid Arrow", 'Ray of Enfeeblement',
  'Inflict Wounds', 'Guiding Bolt', 'Toll the Dead', 'Sacred Flame',
  'Fire Bolt', 'Ray of Frost', 'Eldritch Blast', 'Chill Touch',
  'Shocking Grasp', 'Poison Spray', 'Acid Splash', 'Produce Flame',
  'Thorn Whip', 'Primal Savagery', 'Frostbite', 'Infestation',
  'Lightning Lure', 'Vicious Mockery', 'Mind Sliver', 'Thunderclap',
  'Sword Burst', 'Word of Radiance', 'Create Bonfire', 'Booming Blade',
  'Green-Flame Blade', 'Fire Storm', 'Meteor Swarm', 'Flame Strike',
  'Crown of Stars', 'Dark Star', 'Maddening Darkness', 'Dawn', 'Moonbeam',
  'Call Lightning', 'Flaming Sphere', 'Cloud of Daggers', 'Spike Growth',
  'Guardian of Faith', 'Hunger of Hadar', 'Thunderous Smite', 'Wrathful Smite',
  'Branding Smite', 'Searing Smite', 'Blinding Smite', 'Staggering Smite',
  'Banishing Smite', 'Elemental Weapon', 'Spiritual Weapon', 'Flame Blade',
  'Shadow Blade', 'Holy Weapon', 'Vampiric Touch', 'Enervation', 'Blight',
  'Chain Lightning', 'Lightning Arrow', 'Gravity Fissure', 'Gravity Sinkhole',
  'Ravenous Void', "Abi-Dalzim's Horrid Wilting", 'Horrid Wilting',
  "Otiluke's Freezing Sphere", 'Freezing Sphere', 'Finger of Death',
  'Disintegrate', 'Immolation', 'Tsunami', 'Blade of Disaster',
  'Steel Wind Strike', 'Danse Macabre', 'Power Word Kill',
];

// Utility (non-combat or situational — never auto-cast in v1):
const UTILITY_SPELLS: string[] = [
  'Detect Magic', 'Detect Thoughts', 'Detect Evil and Good',
  'Detect Poison and Disease', 'See Invisibility', 'Identify', 'Augury',
  'Divination', 'Commune', 'Commune with Nature', 'Legend Lore', 'Scrying',
  'Clairvoyance', 'Arcane Eye', 'Find the Path', 'Locate Creature',
  'Locate Object', 'Locate Animals or Plants', 'Message', 'Sending',
  'Comprehend Languages', 'Tongues', 'Darkvision', 'Read Magic',
  'Feather Fall', 'Light', 'Dancing Lights', 'Prestidigitation',
  'Druidcraft', 'Thaumaturgy', 'Guidance', 'Resistance', 'Spare the Dying',
  'Mending', 'Shape Water', 'Mold Earth', 'Control Flames', 'Gust',
  'Minor Illusion', 'Mage Hand', 'Friends', 'Animal Friendship',
  'Animal Messenger', 'Animal Shapes', 'Beast Bond', 'Beast Sense',
  'Speak with Animals', 'Speak with Dead', 'Speak with Plants',
  'Find Familiar', 'Find Steed', 'Find Greater Steed', 'Create Food and Water',
  'Create or Destroy Water', 'Purify Food and Drink', 'Create Homunculus',
  'Unseen Servant', 'Tiny Servant', 'Jump', 'Longstrider', 'Water Breathing',
  'Water Walk', 'Spider Climb', 'Wind Walk', 'Tree Stride',
  'Transport via Plants', 'Word of Recall', 'Teleport', 'Passwall', 'Knock',
  'Arcane Lock', "Drawmij's Instant Summons", "Leomund's Secret Chest",
  "Mordenkainen's Magnificent Mansion", "Mordenkainen's Private Sanctum",
  'Forbiddance', 'Hallow', 'Unhallow', 'Temple of the Gods', 'Awaken',
  'Contact Other Plane', 'Dream', "Rary's Telepathic Bond", 'Telepathy',
];

/**
 * Build the SPELL_TAG_OVERRIDES map from the category lists.
 * This avoids TS1117 (duplicate keys) and keeps the listings deduplicated
 * + maintainable. A spell listed in multiple categories takes the LAST
 * category it appears in (priority order: utility > damage > cc > healing >
 * buff > defending). This matches the RFC §4.2 priority: utility spells are
 * never auto-cast; damage spells are preferred for offensive context.
 *
 * Phase 3 v1: the override map is the source of truth for daily-spell tags.
 * Auto-derivation from GENERIC_SPELLS metadata (RFC §6.1) is future work.
 */
function buildSpellTagOverrides(): Record<string, SpellTag[]> {
  const out: Record<string, SpellTag[]> = {};
  // Priority order (first listed = lowest priority; last wins).
  for (const name of DEFENDING_SPELLS) out[name] = ['defending'];
  for (const name of BUFF_SPELLS) out[name] = ['buff'];
  for (const name of HEALING_SPELLS) out[name] = ['healing'];
  for (const name of CC_SPELLS) out[name] = ['cc'];
  for (const name of DAMAGE_SPELLS) out[name] = ['damage'];
  for (const name of UTILITY_SPELLS) out[name] = ['utility'];
  return out;
}

export const SPELL_TAG_OVERRIDES: Record<string, SpellTag[]> = buildSpellTagOverrides();

/**
 * Derive tags for a spell. Phase 1: cantrip templates have embedded tags.
 * Phase 2 will extend this to consult GENERIC_SPELLS metadata + overrides.
 */
export function deriveSpellTags(spellName: string): SpellTag[] {
  const tmpl = lookupCantripTemplate(spellName);
  if (tmpl) return tmpl.tags;
  const override = SPELL_TAG_OVERRIDES[spellName];
  if (override) return override;
  return [];  // unknown → no tags (will be skipped by scoring)
}

// ---- Cantrip Damage Scaling (PHB p.201) ---------------------

/**
 * PHB p.201: "A cantrip's spell level increases as you gain levels.
 * The cantrip's damage increases at 5th, 11th, and 17th level."
 *
 *   caster level 1–4:  1 die
 *   caster level 5–10: 2 dice
 *   caster level 11–16: 3 dice
 *   caster level 17+:  4 dice
 *
 * Monsters use `casterLevel` (parsed from "Nth-level spellcaster" header,
 * or CR as fallback — see parser/fivetools.ts parseCasterLevel).
 *
 * RFC-UPCASTING Phase 6: refactored to delegate to cantripTier() from
 * utils.ts. The function signature is preserved for backward compat.
 */
export function cantripDiceCount(casterLevel: number | undefined): number {
  return 1 + cantripTier({ casterLevel, level: undefined } as Combatant);
}

/**
 * Average damage of NdS dice = N × (S+1) / 2, floored.
 *   1d8 → 4, 2d8 → 9, 3d8 → 13, 4d8 → 18.
 *   1d10 → 5, 2d10 → 11, 4d10 → 22.
 *
 * Used for the finisher bonus (Doubt #3) and the synthetic Action's
 * `damage.average` field.
 */
export function cantripAverageDamage(diceCount: number, sides: number): number {
  return Math.floor(diceCount * (sides + 1) / 2);
}

// ---- Spellcast Context (RFC §4.2) ---------------------------

export interface SpellcastContext {
  selfHPct: number;          // 0.0–1.0 (currentHP / maxHP)
  allyCount: number;         // living allies (excluding self)
  enemyCount: number;        // living enemies
  nearestEnemyDistFt: number;
  hasDownedAlly: boolean;    // unconscious + not dead ally
  isOutnumbered: boolean;    // enemyCount > allyCount + 1
  round: number;             // 1 = opener
}

/**
 * Build the situational context for a monster's spell selection.
 * Pure function — does not mutate. Used by computeSpellWeight().
 */
export function computeSpellcastContext(self: Combatant, bf: Battlefield): SpellcastContext {
  let allyCount = 0;
  let enemyCount = 0;
  let nearestEnemyDistFt = Infinity;
  let hasDownedAlly = false;

  for (const c of bf.combatants.values()) {
    if (c.id === self.id) continue;
    if (c.isDead) continue;
    const sameFaction = c.faction === self.faction;
    if (sameFaction) {
      if (!c.isUnconscious) allyCount++;
      else hasDownedAlly = true;  // unconscious but not dead = downed
    } else {
      if (!c.isUnconscious) {
        enemyCount++;
        const d = chebyshev3D(self.pos, c.pos) * 5;
        if (d < nearestEnemyDistFt) nearestEnemyDistFt = d;
      }
    }
  }

  const selfHPct = self.maxHP > 0 ? self.currentHP / self.maxHP : 1;

  return {
    selfHPct,
    allyCount,
    enemyCount,
    nearestEnemyDistFt,
    hasDownedAlly,
    isOutnumbered: enemyCount > allyCount + 1,
    round: bf.round,
  };
}

// ---- Weighted Scoring (RFC §4.2) ----------------------------

/**
 * Tag multiplier table (RFC §4.2). The spell's PRIMARY tag (first in the
 * template's tags array) determines the multiplier. Phase 1 simplification:
 * cantrips are almost always 'damage' (some are 'damage'+'cc' — primary
 * tag is 'damage').
 *
 * Situational overrides:
 *   - Round 1 with 3+ enemies → damage ×1.5, cc ×1.8 (prefer AoE openers)
 *   - Low HP (<30%) → defending ×1.8, healing ×2.0, damage ×0.8
 *   - Downed ally → healing ×2.5
 *   - Outnumbered → cc ×2.0, damage ×1.4
 *   - Default → all ×1.0
 */
function tagMultiplier(primaryTag: SpellTag, ctx: SpellcastContext): number {
  // Determine the dominant situation (priority order).
  if (ctx.hasDownedAlly) {
    // Phase 1: no healing cantrips, but the multiplier is defined for forward-compat.
    switch (primaryTag) {
      case 'healing': return 2.5;
      case 'damage': return 0.5;
      case 'cc': return 0.5;
      case 'defending': return 0.5;
      case 'buff': return 0.5;
      default: return 0.5;
    }
  }
  if (ctx.selfHPct < 0.30) {
    switch (primaryTag) {
      case 'healing': return 2.0;
      case 'defending': return 1.8;
      case 'damage': return 0.8;
      case 'cc': return 0.6;
      case 'buff': return 0.5;
      default: return 1.0;
    }
  }
  if (ctx.isOutnumbered) {
    switch (primaryTag) {
      case 'cc': return 2.0;
      case 'damage': return 1.4;
      case 'healing': return 1.0;
      case 'defending': return 0.8;
      case 'buff': return 1.0;
      default: return 1.0;
    }
  }
  if (ctx.round === 1 && ctx.enemyCount >= 3) {
    switch (primaryTag) {
      case 'damage': return 1.5;
      case 'cc': return 1.8;
      case 'buff': return 1.2;
      case 'healing': return 0.5;
      case 'defending': return 0.3;
      default: return 1.0;
    }
  }
  if (ctx.round === 1 && ctx.enemyCount === 1) {
    switch (primaryTag) {
      case 'damage': return 1.3;
      case 'cc': return 1.2;
      case 'buff': return 0.8;
      case 'healing': return 0.3;
      case 'defending': return 0.3;
      default: return 1.0;
    }
  }
  return 1.0;  // default
}

/**
 * Base weight: higher-level spells have higher base. Cantrips (level 0)
 * have base 1.0. This makes slotted spells preferred over cantrips when
 * both are available (Phase 2+). Phase 1 only has cantrips, so all bases
 * are 1.0 — the differentiator is the tag multiplier + finisher bonus.
 */
function baseWeight(spellLevel: number): number {
  if (spellLevel <= 0) return 1.0;
  return 1.0 + spellLevel * 0.15;  // L1=1.15, L3=1.45, L9=2.35
}

/**
 * Finisher bonus (Doubt #3 = B): when the target's current HP ≤ the cantrip's
 * average damage × 1.5, the cantrip gets a ×1.3 weight boost ("finish with a
 * cantrip, save the slot"). Phase 1 has no slots, but this bonus still makes
 * the monster prefer a cantrip that can kill over one that can't.
 *
 * `targetHP` is the best target's current HP. `cantripAvgDmg` is the cantrip's
 * average damage (diceCount × damageSides / 2 + 0.5).
 */
function finisherMultiplier(targetHP: number, cantripAvgDmg: number): number {
  if (targetHP <= cantripAvgDmg * 1.5) return 1.3;
  return 1.0;
}

/**
 * Compute the total weight for a candidate spell.
 *
 *   weight = baseWeight(level) × tagMultiplier(primaryTag, ctx)
 *            × finisherMultiplier(targetHP, avgDmg) × availabilityMultiplier
 *            × composeBiases(biases)
 *
 * Phase 1: availabilityMultiplier is always 1.0 (at-will + cantrips = infinite).
 * Phase 2: 0.0 if no slot remains, 1.0 otherwise.
 *
 * The `biases` parameter is new in RFC-PATTERN-BIAS-AI Phase 1.
 * Default [] → composeBiases([]) = 1.0 (backward-compatible).
 */
export function computeSpellWeight(
  spellName: string,
  tags: SpellTag[],
  spellLevel: number,
  avgDamage: number,
  ctx: SpellcastContext,
  targetHP: number,
  biases: number[] = [],
): number {
  if (tags.length === 0) return 0;  // no tags → skip
  const primaryTag = tags[0];
  const base = baseWeight(spellLevel);
  const tagMult = tagMultiplier(primaryTag, ctx);
  const finisher = finisherMultiplier(targetHP, avgDamage);
  const availability = 1.0;  // Phase 1: at-will = infinite
  const biasProduct = composeBiases(biases);
  return base * tagMult * finisher * availability * biasProduct;
}

// ---- Synthetic Action Builder -------------------------------

/**
 * Build a synthetic spell-attack Action for a monster cantrip.
 *
 * For attack-roll cantrips (Fire Bolt, Ray of Frost, etc.):
 *   attackType='spell', hitBonus=spellAttackBonus, range from template.
 *
 * For save-based cantrips (Sacred Flame, Toll the Dead, etc.):
 *   attackType='save', saveDC=monster's saveDC, saveAbility from template.
 *
 * Damage scales by caster level (cantripDiceCount). The `slotLevel: 0` marks
 * it as a cantrip (not counterspellable per existing getSpellInfoFromPlan,
 * and doesn't consume a spell slot).
 *
 * The monster's `spellAttackBonus` and `saveDC` come from `monsterSpellcasting`.
 * If absent (parser gap), we fall back to a +0 hit / DC 10 — the monster still
 * casts but is weak. This is a safety net; the parser populates these for all
 * 945 spellcasting monsters.
 */
export function buildCantripAction(monster: Combatant, tmpl: CantripTemplate): Action {
  const sc = monster.monsterSpellcasting;
  const hitBonus = sc?.spellAttackBonus ?? 0;
  const saveDC = sc?.saveDC ?? 10;
  const diceCount = cantripDiceCount(monster.casterLevel);
  const avg = cantripAverageDamage(diceCount, tmpl.damageSides);

  const isTouch = tmpl.rangeFt <= 5;
  const range = isTouch ? null : { normal: tmpl.rangeFt, long: tmpl.rangeFt };

  return {
    name: tmpl.name,
    isMultiattack: false,
    attackType: tmpl.attackRoll ? 'spell' : 'save',
    reach: isTouch ? tmpl.rangeFt : 0,
    range,
    hitBonus: tmpl.attackRoll ? hitBonus : 0,
    damage: {
      count: diceCount,
      sides: tmpl.damageSides,
      bonus: 0,
      average: avg,
    },
    damageType: tmpl.damageType,
    saveDC: tmpl.attackRoll ? null : saveDC,
    saveAbility: tmpl.attackRoll ? null : (tmpl.saveAbility ?? null),
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,  // cantrip
    costType: 'action',
    legendaryCost: 0,
    description: `${tmpl.name} (monster cantrip)${tmpl.rider ? ' — ' + tmpl.rider : ''}`,
  };
}

// ---- Target Selection ---------------------------------------

/**
 * Find the best target for a monster cantrip: the living enemy with the
 * LOWEST current HP within the cantrip's range (prefer kills / finishes).
 * Ties → nearest. Returns null if no enemy is in range.
 *
 * Phase 1 simplification: no LOS check here (resolveAttack enforces LOS
 * for attack-roll spells; save-based cantrips like Sacred Flame ignore
 * cover per PHB but still require "a creature you can see"). The planner's
 * detection-state map (Phase 1 of Vision/Audio) is consulted: only
 * 'visible' or 'position-known' enemies are targetable.
 */
function findBestCantripTarget(
  self: Combatant,
  bf: Battlefield,
  rangeFt: number,
  requiresVisible: boolean = false,
): Combatant | null {
  let best: Combatant | null = null;
  let bestScore = -Infinity;

  for (const c of bf.combatants.values()) {
    if (c.id === self.id) continue;
    if (c.faction === self.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    // Range check (Chebyshev distance in feet).
    const distFt = chebyshev3D(self.pos, c.pos) * 5;
    if (distFt > rangeFt) continue;

    // Detection check: skip enemies we can't see or hear.
    // (Phase 1 Vision/Audio: 'visible' or 'position-known' = targetable.)
    const detection = self.perception?.detection?.get(c.id);
    if (detection === 'hidden' || detection === 'unknown') continue;

    // ── RFC-VISION-AUDIO Phase 3 Q5: visible-target spell gating ──
    // If this cantrip requires "a creature you can see", skip enemies
    // that aren't visually detected (position-known but not visible).
    // Legacy fallback: if detection is undefined (no perception map),
    // treat the enemy as visible unless they have 'hidden'/'invisible'.
    if (requiresVisible) {
      if (detection === undefined) {
        // Legacy combatant — fall back to condition check
        if (c.conditions.has('hidden') || c.conditions.has('invisible')) continue;
      } else if (detection !== 'visible') {
        continue;
      }
    }

    // Score: prefer low-HP targets (finisher), then nearest.
    // Lower HP = higher score. Use negative HP so max() picks lowest HP.
    const hpScore = -c.currentHP;
    const distScore = -distFt * 0.01;  // tiny tiebreaker
    const score = hpScore + distScore;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// ---- Main Entry: selectMonsterSpell -------------------------

/**
 * Select the best at-will/cantrip spell for a monster to cast this turn.
 *
 * Algorithm (RFC §4.3, Phase 1 subset):
 *   1. Guard: monster has `monsterSpellcasting` and at least one candidate.
 *   2. Collect candidates: atWill + slots[0].spells (cantrips).
 *   3. For each, look up a cantrip template (case-insensitive).
 *      Skip if no template (Doubt #1 = A, #6 = A: skip unimplemented/utility).
 *   4. Find the best target in range (findBestCantripTarget).
 *      If no target in range for ANY cantrip → return null (fall to weapons).
 *   5. Compute weight for each candidate (tags × context × finisher).
 *   6. Return the highest-weight candidate as a 'cast' PlannedAction.
 *   7. Ties → highest damage sides, then alphabetical.
 *
 * Returns null if:
 *   - No `monsterSpellcasting`.
 *   - No cantrip templates match (all utility/unimplemented).
 *   - No target in range for any matching cantrip.
 *   - The monster has no action budget left (caller checks — but we guard too).
 *
 * The returned PlannedAction uses type 'cast' so it dispatches through the
 * existing `case 'cast':` branch in combat.ts → resolveAttack. No new case
 * branch is needed (RFC §5.2).
 */
export function selectMonsterSpell(
  self: Combatant,
  bf: Battlefield,
): PlannedAction | null {
  const sc = self.monsterSpellcasting;
  if (!sc) return null;

  // Collect candidate spell names (cantrips + at-will).
  // Cantrips: slots[0].spells (level 0 = at-will cantrips).
  // At-will: sc.atWill (may include leveled at-will spells — Phase 2 handles
  // those via GENERIC_SPELLS; Phase 1 only handles cantrip-template matches).
  const candidates = new Set<string>();
  if (sc.atWill) for (const s of sc.atWill) candidates.add(s);
  if (sc.slots?.[0]?.spells) for (const s of sc.slots[0].spells) candidates.add(s);

  if (candidates.size === 0) return null;

  // Build the context once.
  const ctx = computeSpellcastContext(self, bf);

  // If no living enemies at all, bail (let the planner pick a non-combat action).
  if (ctx.enemyCount === 0) return null;

  // Score each candidate cantrip.
  let bestPlan: PlannedAction | null = null;
  let bestWeight = 0;
  let bestDmgSides = 0;
  let bestName = '';

  for (const spellName of candidates) {
    const tmpl = lookupCantripTemplate(spellName);
    if (!tmpl) continue;  // Doubt #1/#6: skip unimplemented + utility cantrips

    // Find the best target in range for this cantrip.
    // ── RFC-VISION-AUDIO Phase 3 Q5: visible-target gating ──
    // If this cantrip requires "a creature you can see", only consider
    // visually detected enemies as targets.
    const target = findBestCantripTarget(self, bf, tmpl.rangeFt, requiresVisibleTarget(tmpl.name));
    if (!target) continue;  // no target in range → skip this cantrip

    // Compute average damage (for finisher bonus + scoring).
    const diceCount = cantripDiceCount(self.casterLevel);
    const avgDmg = cantripAverageDamage(diceCount, tmpl.damageSides);

    // ── RFC-PATTERN-BIAS-AI Phase 1: collect pattern biases ──
    // Each detector returns a multiplier (1.0 = neutral, >1.0 = boost,
    // <1.0 = penalise, 0.0 = veto). They compose multiplicatively.
    const biases = collectCantripBiases(
      ctx, bf, self, target, tmpl.tags, avgDmg,
      tmpl.attackRoll, tmpl.saveAbility as AbilityScore | undefined,
    );

    // Compute weight (now includes pattern bias composition).
    const weight = computeSpellWeight(
      tmpl.name, tmpl.tags, 0, avgDmg, ctx, target.currentHP, biases,
    );

    // Tie-breaking: higher weight wins; ties → higher damage sides; then alpha.
    if (weight > bestWeight
        || (weight === bestWeight && weight > 0
            && (tmpl.damageSides > bestDmgSides
                || (tmpl.damageSides === bestDmgSides && tmpl.name < bestName)))) {
      bestWeight = weight;
      bestDmgSides = tmpl.damageSides;
      bestName = tmpl.name;

      const action = buildCantripAction(self, tmpl);
      bestPlan = {
        type: 'cast',
        action,
        targetId: target.id,
        description: `${self.name} casts ${tmpl.name} at ${target.name}`,
      };
    }
  }

  return bestPlan;
}

// ---- Phase 2: Slot-Based Spells (Session 75) -----------------

/**
 * Phase 2 (Session 75): Initialize `monsterSpellSlots` from
 * `monsterSpellcasting.slots`.
 *
 * For each slot level 1-9, populates `monster.monsterSpellSlots[level] =
 * { max, remaining: max }`. Level 0 (cantrips) are at-will and NOT tracked.
 *
 * Idempotent: if `monsterSpellSlots` is already populated, this is a no-op
 * (prevents accidental reset mid-combat). Callers may safely call this
 * multiple times.
 *
 * RFC §5.3: "At combat start (in runCombat() or monsterToCombatant()),
 * initialize monsterSpellSlots from monsterSpellcasting.slots."
 *
 * v1 implementation note: Called LAZILY from selectMonsterSlottedSpell()
 * on the first invocation for each monster (same pattern as Phase 3's
 * initMonsterDailyUses). This avoids touching combat.ts init paths.
 */
export function initMonsterSpellSlots(monster: Combatant): void {
  const sc = monster.monsterSpellcasting;
  if (!sc?.slots) return;
  // Idempotent guard: don't reset an already-initialized tracker.
  if (monster.monsterSpellSlots) return;
  monster.monsterSpellSlots = {};
  for (let lvl = 1; lvl <= 9; lvl++) {
    const slotData = sc.slots[lvl];
    if (!slotData || slotData.max <= 0) continue;
    const safeMax = Math.max(0, Number(slotData.max) || 0);
    if (safeMax === 0) continue;
    monster.monsterSpellSlots[lvl] = { max: safeMax, remaining: safeMax };
  }
}

/**
 * Phase 2 (Session 75): Check if the monster has at least one spell slot
 * available at or above the given minimum level. Returns false if the
 * monster has no `monsterSpellSlots` field or no slots remain.
 *
 * Mirrors `hasSpellSlot()` from resources.ts, but checks monster slots
 * instead of PC resources.
 */
export function hasMonsterSpellSlot(
  monster: Combatant,
  minLevel = 1,
): boolean {
  if (!monster.monsterSpellSlots) return false;
  for (let lvl = minLevel; lvl <= 9; lvl++) {
    const slot = monster.monsterSpellSlots[lvl];
    if (slot && slot.remaining > 0) return true;
  }
  return false;
}

/**
 * Phase 2 (Session 75): Consume a monster spell slot of the given level
 * (or higher if the exact level is exhausted — upcast).
 *
 * Decrements `monster.monsterSpellSlots[level].remaining` by 1. If no slot
 * remains at the exact level, tries higher levels (upcast per PHB p.201).
 * Returns the slot level actually consumed, or null if no slot is available.
 *
 * Mirrors `consumeSpellSlot()` from resources.ts, but checks monster slots
 * instead of PC resources. Does NOT handle Warlock pact slots (monsters
 * don't have those).
 *
 * v1 design: called from selectMonsterSlottedSpell() BEFORE returning the
 * plan (upfront consumption, matching Phase 3's daily-use pattern and
 * PHB p.201: "Once a spell is cast, its slot is used regardless of whether
 * the spell succeeds").
 */
export function consumeMonsterSpellSlot(
  monster: Combatant,
  desiredLevel: number,
): number | null {
  if (!monster.monsterSpellSlots) return null;
  // Try desired level first, then higher (upcast)
  for (let lvl = desiredLevel; lvl <= 9; lvl++) {
    const slot = monster.monsterSpellSlots[lvl];
    if (slot && slot.remaining > 0) {
      slot.remaining--;
      return lvl;
    }
  }
  return null;
}

// ---- Phase 3: Daily-Use Spells (Session 74) ------------------

/**
 * Phase 3 (Session 74): Initialize `monsterDailyUses` from
 * `monsterSpellcasting.daily`.
 *
 * For each spell in the monster's `daily` map (spell name → uses/day),
 * populate `monster.monsterDailyUses[spellName] = { max, remaining: max }`.
 *
 * Idempotent: if `monsterDailyUses` is already populated, this is a no-op
 * (prevents accidental reset mid-combat). Callers may safely call this
 * multiple times.
 *
 * RFC §5.3: "At combat start (in runCombat() or monsterToCombatant()),
 * initialize monsterDailyUses from monsterSpellcasting.daily."
 *
 * v1 implementation note: This is called LAZILY from
 * selectMonsterDailySpell() on the first invocation for each monster. This
 * avoids touching combat.ts (no merge conflicts with concurrent workstreams)
 * and is safe because daily-use tracking is only relevant when the planner
 * is selecting spells.
 */
export function initMonsterDailyUses(monster: Combatant): void {
  const sc = monster.monsterSpellcasting;
  if (!sc?.daily) return;
  // Idempotent guard: don't reset an already-initialized tracker.
  if (monster.monsterDailyUses) return;
  monster.monsterDailyUses = {};
  for (const [spellName, max] of Object.entries(sc.daily)) {
    // max comes from the parser: parseInt(key) where key is "1e"/"2e"/"3e".
    // The parser already coerced it to a number (see parseMonsterSpellcasting
    // in src/parser/fivetools.ts).
    const safeMax = Math.max(1, Number(max) || 1);
    monster.monsterDailyUses[spellName] = { max: safeMax, remaining: safeMax };
  }
}

/**
 * Phase 3 (Session 74): Check if a monster has at least one remaining
 * daily use of the given spell. Returns false if the monster has no
 * `monsterDailyUses` field or the spell isn't tracked.
 */
export function hasMonsterDailyUseAvailable(
  monster: Combatant,
  spellName: string,
): boolean {
  if (!monster.monsterDailyUses) return false;
  const use = monster.monsterDailyUses[spellName];
  return !!use && use.remaining > 0;
}

/**
 * Phase 3 (Session 74): Consume one daily use of the given spell.
 * Decrements `monster.monsterDailyUses[spellName].remaining` by 1.
 * Returns true if consumed, false if the spell isn't tracked or has 0
 * remaining.
 *
 * v1 design: called from selectMonsterDailySpell() BEFORE returning the
 * plan (upfront consumption). This matches the RFC §5.2 guidance that
 * the planner consumes the resource, not combat.ts. The daily use is
 * "spent" the moment the monster commits to casting (PHB p.201: "Once a
 * spell is cast, its slot is used regardless of whether the spell
 * succeeds"). If the spell's shouldCast later fails in combat.ts (e.g.,
 * target moved out of range between plan and execute), the use is still
 * consumed — same as a PC losing a slot to a Counterspell.
 */
export function consumeMonsterDailyUse(
  monster: Combatant,
  spellName: string,
): boolean {
  if (!monster.monsterDailyUses) return false;
  const use = monster.monsterDailyUses[spellName];
  if (!use || use.remaining <= 0) return false;
  use.remaining--;
  return true;
}

// ---- Phase 3: Daily-Spell Tag Derivation ---------------------

/**
 * Derive tags for a daily-use spell. Uses the SPELL_TAG_OVERRIDES map
 * (case-insensitive lookup). Falls back to ['damage'] for unknown combat
 * spells — this is a conservative default that ensures most daily-use
 * spells get a non-zero weight. Utility spells explicitly mapped to
 * ['utility'] get weight 0 (skipped, per Doubt #1 = A).
 *
 * Phase 3 v1 simplification: we don't auto-derive tags from GENERIC_SPELLS
 * metadata (the GenericSpellDescriptor doesn't expose damage/heal/condition
 * fields yet — that's RFC §6.1 future work). The override map is the
 * source of truth.
 */
function getDailySpellTags(spellName: string): SpellTag[] {
  // Try exact match first.
  const exact = SPELL_TAG_OVERRIDES[spellName];
  if (exact) return exact;
  // Case-insensitive fallback (some bestiary entries use different casing).
  const lower = spellName.toLowerCase();
  for (const [key, tags] of Object.entries(SPELL_TAG_OVERRIDES)) {
    if (key.toLowerCase() === lower) return tags;
  }
  // Conservative default: assume the spell deals damage. This ensures
  // combat spells not yet in the override map still get a non-zero weight.
  // Utility spells should be explicitly added to the override map with
  // ['utility'] to be skipped.
  return ['damage'];
}

// ---- Phase 3: Daily-Spell Target Selection -------------------

/**
 * Find a target enemy for a daily-use spell. Used for offensive spells
 * that need a target (damage, single-target CC). For self-cast spells
 * (buffs, defending), the caller uses `self` as the target.
 *
 * v1: uses a generous 120-ft range (most daily spells have 60-120 ft
 * range). The spell's shouldCast() does the real range/LOS check.
 */
function findDailySpellTarget(self: Combatant, bf: Battlefield): Combatant | null {
  let best: Combatant | null = null;
  let bestScore = -Infinity;
  for (const c of bf.combatants.values()) {
    if (c.id === self.id) continue;
    if (c.faction === self.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    // Detection check: skip enemies we can't see or hear.
    const detection = self.perception?.detection?.get(c.id);
    if (detection === 'hidden' || detection === 'unknown') continue;
    // Score: prefer low-HP targets (finisher), then nearest.
    const distFt = chebyshev3D(self.pos, c.pos) * 5;
    const hpScore = -c.currentHP;
    const distScore = -distFt * 0.01;
    const score = hpScore + distScore;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// ---- Phase 3: Main Entry — selectMonsterDailySpell -----------

/**
 * Phase 3 (Session 74): Select the best daily-use spell for a monster to
 * cast this turn.
 *
 * Algorithm (RFC §4.3, Phase 3 subset):
 *   1. Guard: monster has `monsterSpellcasting.daily` and at least one
 *      spell with remaining uses.
 *   2. Lazy-init `monsterDailyUses` on first call (idempotent).
 *   3. For each daily-use spell:
 *      a. Check `monsterDailyUses[spellName].remaining > 0` (skip if 0).
 *      b. Look up in GENERIC_SPELLS via `lookupGenericSpell(spellName)`.
 *         Skip if not found (bespoke-only spells are Phase 4+ future work).
 *      c. Call `desc.shouldCast(self, bf)` to verify castability (range,
 *         concentration conflicts, target availability, etc.).
 *      d. Derive tags via `getDailySpellTags(spellName)`.
 *      e. Compute weight (baseWeight × tagMultiplier × pattern biases).
 *   4. Pick the highest-weight spell. Ties → highest spell level, then
 *      alphabetical.
 *   5. Consume the daily use UPFRONT (PHB p.201: slot used regardless of
 *      outcome).
 *   6. Return a `PlannedAction { type: 'genericSpell', spellName }`.
 *
 * Returns null if:
 *   - No `monsterSpellcasting.daily`.
 *   - All daily uses exhausted.
 *   - No daily spell is in GENERIC_SPELLS (bespoke-only spells skipped).
 *   - No daily spell passes shouldCast().
 *
 * Dispatch path: combat.ts `case 'genericSpell':` →
 * `lookupGenericSpell(plan.spellName)` → `desc.shouldCast(actor, bf)` →
 * `desc.execute(actor, state)`. The daily-use consumption happens here
 * (in the planner), not in execute() — this avoids modifying each
 * generic spell module.
 *
 * v1 scope (Session 74):
 *   - Only daily-use spells that are in GENERIC_SPELLS (105 of 420 unique
 *     daily spells). Bespoke-only daily spells (Command, Hold Person, etc.)
 *     are deferred to Phase 4.
 *   - Daily uses consumed upfront in the planner (matches RFC §5.2).
 *   - `castSlotLevel` set to the spell's level (for Counterspell / GoI
 *     accuracy, per RFC-UPCASTING Phase 1).
 *   - Pattern biases: simplified collection (no per-spell attackRoll /
 *     saveAbility info — biases default to neutral). Full bias integration
 *     is Phase 4+.
 */
export function selectMonsterDailySpell(
  self: Combatant,
  bf: Battlefield,
): PlannedAction | null {
  const sc = self.monsterSpellcasting;
  if (!sc?.daily) return null;

  // Lazy-init the daily-uses tracker (idempotent).
  if (!self.monsterDailyUses) {
    initMonsterDailyUses(self);
  }
  // Re-check after init (init may have been a no-op if daily was empty).
  if (!self.monsterDailyUses) return null;

  // Build the context once.
  const ctx = computeSpellcastContext(self, bf);

  // If no living enemies AND no downed allies, bail — most daily spells
  // need a target. (Self-buffs like Blink could fire with no enemies, but
  // they're low-value without a fight. v1: skip.)
  if (ctx.enemyCount === 0 && !ctx.hasDownedAlly) return null;

  // Find a target enemy (used for offensive spells + finisher bonus).
  const target = findDailySpellTarget(self, bf);

  // ── Synthetic action + resources for shouldCast compatibility ──
  // The generic spell modules' shouldCast() functions check two things that
  // monsters don't have:
  //   1. caster.actions.some(a => a.name === spellName)  — action presence
  //   2. hasSpellSlot(caster, level)                    — slot availability
  //
  // For monsters, daily-use spells are in `monsterSpellcasting.daily`, not
  // `actions`, and monsters have no `resources.spellSlots`. To reuse the
  // generic spells' shouldCast validation (which checks range, concentration
  // conflicts, dedup, etc.), we temporarily:
  //   - Add a synthetic Action for each daily spell to `self.actions`
  //   - Set `self.resources` to a synthetic object with all slots available
  //
  // These are cleaned up in the `finally` block below. This mutation is
  // contained to this function call and never leaks to the caller.
  //
  // Alternative considered: skip shouldCast entirely and rely on weight
  // scoring + dedup. Rejected because shouldCast also validates range,
  // target availability, and concentration conflicts — important for
  // correctness (e.g., don't cast Confusion when no enemies are in range).
  const syntheticActions: Action[] = [];
  for (const spellName of Object.keys(sc.daily)) {
    if (self.actions.some(a => a.name === spellName)) continue;  // already present
    const desc = lookupGenericSpell(spellName);
    if (!desc) continue;
    syntheticActions.push({
      name: spellName,
      isMultiattack: false,
      attackType: 'spell',
      reach: 0, range: null,
      hitBonus: 0,
      damage: { count: 0, sides: 0, bonus: 0, average: 0 },
      damageType: 'force',
      saveDC: null, saveAbility: null,
      isAoE: false, isControl: false,
      requiresConcentration: false,
      slotLevel: desc.level,
      costType: 'action', legendaryCost: 0,
      description: `${spellName} (monster daily — synthetic)`,
    } as Action);
  }
  if (syntheticActions.length > 0) {
    self.actions.push(...syntheticActions);
  }
  // Synthetic resources: all slots available (so hasSpellSlot returns true).
  // Monsters don't use slots — daily-use tracking is separate. The synthetic
  // resources are only for shouldCast validation; execute() will call
  // consumeSpellSlot() which is a no-op for monsters (returns null, doesn't
  // crash). The daily-use consumption happens in the planner (upfront).
  const originalResources = self.resources;
  if (!originalResources) {
    self.resources = {
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

  let bestPlan: PlannedAction | null = null;
  let bestWeight = 0;
  let bestLevel = -1;
  let bestName = '';

  try {
    for (const spellName of Object.keys(sc.daily)) {
      // Skip if no uses remaining.
      if (!hasMonsterDailyUseAvailable(self, spellName)) continue;

      // Look up in GENERIC_SPELLS (dispatch path).
      const desc = lookupGenericSpell(spellName);
      if (!desc) continue;  // bespoke-only — Phase 4 future work

      // Run the spell's shouldCast gate (range, concentration, target, etc.).
      // With the synthetic action + resources above, the action-presence and
      // slot-availability checks pass. The dedup check
      // (_genericSpellActiveSpells) works as-is.
      let shouldCastResult = false;
      try {
        shouldCastResult = desc.shouldCast(self, bf);
      } catch {
        // Defensive: if shouldCast throws (bug in a spell module), skip
        // this spell rather than crashing the planner.
        continue;
      }
      if (!shouldCastResult) continue;

      // Derive tags for weighted scoring.
      const tags = getDailySpellTags(spellName);
      if (tags.length === 0 || tags[0] === 'utility') continue;  // skip utility

      // Compute weight.
      //   avgDamage: 0 for non-damage spells (healing/CC/buff/defending).
      //   targetHP:  use the best target's HP for the finisher bonus
      //              (only affects damage spells).
      const avgDmg = 0;
      const targetHP = target?.currentHP ?? 100;

      // Pattern biases: simplified collection for v1.
      //   Uses the cantrip bias collector with synthetic parameters.
      //   Full per-spell bias integration is Phase 4+ future work.
      const biases = collectCantripBiases(
        ctx, bf, self, target ?? self, tags, avgDmg,
        false, undefined,  // attackRoll=false, saveAbility=undefined (neutral)
      );

      const weight = computeSpellWeight(
        spellName, tags, desc.level, avgDmg, ctx, targetHP, biases,
      );

      // Tie-breaking: higher weight wins; ties → higher level, then alpha.
      if (weight > bestWeight
          || (weight === bestWeight && weight > 0
              && (desc.level > bestLevel
                  || (desc.level === bestLevel && spellName < bestName)))) {
        bestWeight = weight;
        bestLevel = desc.level;
        bestName = spellName;

        bestPlan = {
          type: 'genericSpell',
          action: null,
          targetId: target?.id ?? self.id,
          description: `${self.name} casts ${spellName} (daily ${desc.level > 0 ? 'L' + desc.level : 'cantrip'})`,
          spellName,
          // RFC-UPCASTING Phase 1: castSlotLevel tracks the spell's level for
          // Counterspell accuracy + Globe of Invulnerability blocking.
          // Daily-use spells don't consume a slot, but their EFFECTIVE level
          // for interaction purposes is the spell's base level.
          castSlotLevel: desc.level,
        };
      }
    }
  } finally {
    // ── Cleanup: remove synthetic actions + restore resources ──
    if (syntheticActions.length > 0) {
      const syntheticNames = new Set(syntheticActions.map(a => a.name));
      self.actions = self.actions.filter(a => !syntheticNames.has(a.name));
    }
    if (!originalResources) {
      self.resources = null;
    }
  }

  // Consume the daily use UPFRONT (before returning the plan).
  // PHB p.201: "Once a spell is cast, its slot is used regardless of
  // whether the spell succeeds." Daily uses follow the same rule.
  if (bestPlan && bestName) {
    consumeMonsterDailyUse(self, bestName);
  }

  return bestPlan;
}

// ---- Phase 2: Main Entry — selectMonsterSlottedSpell --------

/**
 * Phase 2 (Session 75): Select the best slot-based leveled spell for a
 * monster to cast this turn.
 *
 * Algorithm (RFC §4.3, Phase 2 subset):
 *   1. Guard: monster has `monsterSpellcasting.slots` with at least one
 *      leveled slot (1-9) remaining.
 *   2. Lazy-init `monsterSpellSlots` on first call (idempotent).
 *   3. For each slot level 1-9, for each spell in that level's spell list:
 *      a. Check `hasMonsterSpellSlot(self, spellLevel)` (skip if no slots).
 *      b. Look up in GENERIC_SPELLS via `lookupGenericSpell(spellName)`.
 *         Skip if not found (bespoke-only spells are Phase 4+ future work).
 *      c. Call `desc.shouldCast(self, bf)` to verify castability (range,
 *         concentration conflicts, target availability, etc.).
 *      d. Derive tags via `getDailySpellTags(spellName)` (reused from Phase 3).
 *      e. Compute weight (baseWeight × tagMultiplier × pattern biases).
 *   4. Pick the highest-weight spell. Ties → highest spell level, then
 *      alphabetical.
 *   5. Consume the spell slot UPFRONT (PHB p.201: slot used regardless of
 *      outcome). Uses `consumeMonsterSpellSlot(self, spellLevel)` which
 *      tries the exact level first, then upcasts to higher levels.
 *   6. Return a `PlannedAction { type: 'genericSpell', spellName,
 *      castSlotLevel }`.
 *
 * Returns null if:
 *   - No `monsterSpellcasting.slots`.
 *   - All slots exhausted.
 *   - No slotted spell is in GENERIC_SPELLS (bespoke-only spells skipped).
 *   - No slotted spell passes shouldCast().
 *   - No living enemies AND no downed allies (most spells need a target).
 *
 * Dispatch path: same as Phase 3 — combat.ts `case 'genericSpell':` →
 * `lookupGenericSpell(plan.spellName)` → `desc.shouldCast(actor, bf)` →
 * `desc.execute(actor, state)`. The shouldCast re-check is bypassed for
 * monster spell casts (planner already validated; synthetic state cleaned
 * up). The slot consumption happens here (in the planner), not in execute()
 * — execute()'s `consumeSpellSlot()` is a safe no-op for monsters.
 *
 * v1 scope (Session 75):
 *   - Only slotted spells in GENERIC_SPELLS (77 of 373 unique slotted
 *     spells). Bespoke-only slotted spells (Fireball, Counterspell, Dispel
 *     Magic, etc.) are deferred to Phase 4.
 *   - Slots consumed upfront in the planner (matches Phase 3 pattern).
 *   - `castSlotLevel` set to the slot level consumed (for Counterspell /
 *     GoI accuracy, per RFC-UPCASTING Phase 1). Note: if the exact level
 *     is exhausted, the spell is upcast to a higher level.
 *   - Pattern biases: simplified collection (same as Phase 3).
 *   - Does NOT upcast for penetration (RFC-UPCASTING Phase 5's
 *     selectCastSlot is PC-only; monster upcast-for-penetration is Phase 4+).
 */
export function selectMonsterSlottedSpell(
  self: Combatant,
  bf: Battlefield,
): PlannedAction | null {
  const sc = self.monsterSpellcasting;
  if (!sc?.slots) return null;

  // Lazy-init the spell-slots tracker (idempotent).
  if (!self.monsterSpellSlots) {
    initMonsterSpellSlots(self);
  }
  // Re-check after init (init may have been a no-op if slots were empty).
  if (!self.monsterSpellSlots) return null;

  // Quick bail: if no slots remain at any level, skip.
  if (!hasMonsterSpellSlot(self, 1)) return null;

  // Build the context once.
  const ctx = computeSpellcastContext(self, bf);

  // If no living enemies AND no downed allies, bail — most slotted spells
  // need a target. (Self-buffs like Fly could fire with no enemies, but
  // they're low-value without a fight. v1: skip.)
  if (ctx.enemyCount === 0 && !ctx.hasDownedAlly) return null;

  // Find a target enemy (used for offensive spells + finisher bonus).
  const target = findDailySpellTarget(self, bf);

  // ── Synthetic action + resources for shouldCast compatibility ──
  // Same shim as Phase 3: temporarily add synthetic Actions for each
  // slotted spell + set synthetic resources with all slots available.
  // Cleaned up in the `finally` block.
  const syntheticActions: Action[] = [];
  for (let lvl = 1; lvl <= 9; lvl++) {
    const slotData = sc.slots[lvl];
    if (!slotData?.spells) continue;
    for (const spellName of slotData.spells) {
      if (self.actions.some(a => a.name === spellName)) continue;
      const desc = lookupGenericSpell(spellName);
      if (!desc) continue;
      syntheticActions.push({
        name: spellName,
        isMultiattack: false,
        attackType: 'spell',
        reach: 0, range: null,
        hitBonus: 0,
        damage: { count: 0, sides: 0, bonus: 0, average: 0 },
        damageType: 'force',
        saveDC: null, saveAbility: null,
        isAoE: false, isControl: false,
        requiresConcentration: false,
        slotLevel: desc.level,
        costType: 'action', legendaryCost: 0,
        description: `${spellName} (monster slotted — synthetic)`,
      } as Action);
    }
  }
  if (syntheticActions.length > 0) {
    self.actions.push(...syntheticActions);
  }
  // Synthetic resources: all slots available (so hasSpellSlot returns true).
  const originalResources = self.resources;
  if (!originalResources) {
    self.resources = {
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

  let bestPlan: PlannedAction | null = null;
  let bestWeight = 0;
  let bestLevel = -1;      // spell's GENERIC_SPELLS level (for tie-breaking)
  let bestSlotLevel = -1;  // slot level from iteration (for consumption)
  let bestName = '';

  try {
    for (let lvl = 1; lvl <= 9; lvl++) {
      const slotData = sc.slots[lvl];
      if (!slotData?.spells) continue;

      for (const spellName of slotData.spells) {
        // Skip if no slot available at this level (or higher for upcast).
        if (!hasMonsterSpellSlot(self, lvl)) continue;

        // Look up in GENERIC_SPELLS (dispatch path).
        const desc = lookupGenericSpell(spellName);
        if (!desc) continue;  // bespoke-only — Phase 4 future work

        // Run the spell's shouldCast gate.
        let shouldCastResult = false;
        try {
          shouldCastResult = desc.shouldCast(self, bf);
        } catch {
          continue;
        }
        if (!shouldCastResult) continue;

        // Derive tags for weighted scoring (reuse Phase 3's helper).
        const tags = getDailySpellTags(spellName);
        if (tags.length === 0 || tags[0] === 'utility') continue;

        // Compute weight.
        const avgDmg = 0;
        const targetHP = target?.currentHP ?? 100;

        const biases = collectCantripBiases(
          ctx, bf, self, target ?? self, tags, avgDmg,
          false, undefined,
        );

        const weight = computeSpellWeight(
          spellName, tags, desc.level, avgDmg, ctx, targetHP, biases,
        );

        // Tie-breaking: higher weight wins; ties → higher spell level, then alpha.
        if (weight > bestWeight
            || (weight === bestWeight && weight > 0
                && (desc.level > bestLevel
                    || (desc.level === bestLevel && spellName < bestName)))) {
          bestWeight = weight;
          bestLevel = desc.level;
          bestSlotLevel = lvl;
          bestName = spellName;

          bestPlan = {
            type: 'genericSpell',
            action: null,
            targetId: target?.id ?? self.id,
            description: `${self.name} casts ${spellName} (L${lvl} slot)`,
            spellName,
            // RFC-UPCASTING Phase 1: castSlotLevel tracks the slot level
            // consumed (may be higher than spell base level if upcast).
            // Set below after consumption.
            castSlotLevel: lvl,
          };
        }
      }
    }
  } finally {
    // ── Cleanup: remove synthetic actions + restore resources ──
    if (syntheticActions.length > 0) {
      const syntheticNames = new Set(syntheticActions.map(a => a.name));
      self.actions = self.actions.filter(a => !syntheticNames.has(a.name));
    }
    if (!originalResources) {
      self.resources = null;
    }
  }

  // Consume the spell slot UPFRONT (before returning the plan).
  // PHB p.201: "Once a spell is cast, its slot is used regardless of
  // whether the spell succeeds." Uses consumeMonsterSpellSlot which tries
  // the slot level the spell is prepared at first, then upcasts to higher
  // levels if that level is exhausted.
  if (bestPlan && bestName) {
    const consumedLevel = consumeMonsterSpellSlot(self, bestSlotLevel);
    if (consumedLevel !== null) {
      // Update castSlotLevel to the actual slot consumed (may be higher
      // if upcast due to exact-level exhaustion).
      bestPlan.castSlotLevel = consumedLevel;
    }
  }

  return bestPlan;
}
