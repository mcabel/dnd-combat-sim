// ============================================================
// Level 1 PC Spell Database
// Maps spell names (lowercase) to Action-like templates.
// The parser (pc.ts) looks up spells here when building a PC's
// action list from preparedSpells / spells_1st / spellbook.
//
// Scope: PHB 2014 — Level 1 spells used by PCs in pc_stat_blocks_lv1.json
//
// Cantrips are in the weapons array → not needed here.
// Utility / out-of-combat spells (Detect Magic, Find Familiar, etc.)
// are skipped — the AI has no use for them in combat.
// Healing spells are also skipped here — they require ally-targeting
// logic not yet implemented (deferred to a future session).
//
// Each entry is a Partial<Action>; the parser fills in:
//   hitBonus   ← sp.spellAttackBonus  (spell attack roll spells)
//   saveDC     ← sp.saveDC            (save-based spells)
//   description ← generated
// ============================================================

export interface SpellTemplate {
  /** 'spell' = spell attack roll; 'save' = saving throw; null = auto-hit */
  attackType: 'spell' | 'save' | null;
  /** Range in ft (for canReach checks) */
  rangeNormal: number;
  damage: { count: number; sides: number; bonus: number; average: number } | null;
  damageType: string | null;
  /** For save-based spells */
  saveAbility?: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  isAoE: boolean;
  /** AoE radius in ft (used by findBestAoECluster) */
  aoeRadius?: number;
  isControl: boolean;
  requiresConcentration: boolean;
  /** 1 = consumes a 1st-level slot */
  slotLevel: number;
  /** Bonus-action cost instead of action */
  bonusAction?: boolean;
}

// ---- Helpers ------------------------------------------------

function avg(count: number, sides: number, bonus = 0): number {
  return Math.round(count * ((sides + 1) / 2) + bonus);
}

// ---- Level 1 combat spells ----------------------------------

/**
 * Combat-relevant Level 1 spells usable by PCs in the stat block file.
 * Key = lowercase spell name (must match preparedSpells / spells_1st entries).
 *
 * Omitted (non-combat / pure utility):
 *   detect magic, find familiar, goodberry, mage armor, protection from evil
 *   and good, charm person (mostly out-of-combat), shield (reaction — not
 *   actionable by current planner), sleep (HP-bucket mechanic — complex).
 *
 * Omitted (healing / ally-targeting — deferred):
 *   cure wounds, healing word, shield of faith
 */
export const SPELL_DB: Record<string, SpellTemplate> = {

  // ---- Healing (action / bonus action) --------------------
  // These have no damage and attackType null — they are NOT selected by selectAction.
  // The planner explicitly checks for them by name via shouldCastCureWounds /
  // shouldCastHealingWord. Adding them to the DB only so the parser creates Action
  // objects for them (used by the name-checks in planner.ts).

  'cure wounds': {
    attackType: null,    // touch range, no attack roll
    rangeNormal: 5,      // touch
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
    // costType defaults to 'action'
  },

  'healing word': {
    attackType: null,    // 60ft range, no attack roll
    rangeNormal: 60,
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
    bonusAction: true,   // bonus action cast
  },

  // ---- Buff spells (ally-targeting) -----------------------
  // attackType null — NOT selected by selectAction.
  // Planner checks by name via shouldCastBless in spells/bless.ts.

  'bless': {
    attackType: null,    // 30ft range, no attack roll, no save — willing targets
    rangeNormal: 30,
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
    // costType defaults to 'action'
  },

  // ---- Cleric ---------------------------------------------

  'guiding bolt': {
    // Ranged spell attack, 120 ft. On hit: 4d6 radiant + next attack vs target has advantage.
    // PHB p.248. Dispatched via case 'guidingBolt'.
    attackType: 'spell',
    rangeNormal: 120,
    damage: { count: 4, sides: 6, bonus: 0, average: avg(4, 6) },
    damageType: 'radiant',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  // ---- Bard -----------------------------------------------

  'dissonant whispers': {
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 3, sides: 6, bonus: 0, average: avg(3, 6) },
    damageType: 'psychic',
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  // ---- Sorcerer / Wizard ----------------------------------

  'chromatic orb': {
    // Ranged spell attack; damage type chosen by caster — use thunder as default
    attackType: 'spell',
    rangeNormal: 90,
    damage: { count: 3, sides: 8, bonus: 0, average: avg(3, 8) },
    damageType: 'thunder',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'magic missile': {
    // Auto-hit (no attack roll); 3 darts, each 1d4+1 force — modelled as one roll
    attackType: null,  // hitBonus: null → auto-hit path in resolveAttack
    rangeNormal: 120,
    damage: { count: 3, sides: 4, bonus: 3, average: avg(3, 4, 3) },
    damageType: 'force',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'burning hands': {
    // 1st-level evocation, NOT concentration, 15-ft cone (Self).
    // DEX save: fail = 3d6 fire; success = half. Dispatched via case 'burningHands'.
    attackType: null,
    rangeNormal: 15,
    damage: { count: 3, sides: 6, bonus: 0, average: avg(3, 6, 0) },
    damageType: 'fire',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'sleep': {
    // 1st-level enchantment, NOT concentration, range 90ft, 20-ft sphere.
    // No attack roll, no save — HP bucket mechanic handled entirely in the spell module.
    // attackType: null keeps it out of selectAction (engine dispatches via case 'sleep').
    attackType: null,
    rangeNormal: 90,
    damage: null,       // damage is emergent (5d8 HP threshold), not a dice formula
    damageType: null,
    isAoE: true,
    aoeRadius: 20,
    isControl: true,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'thunderwave': {
    // 15-ft cube centred on caster; CON save, 2d8 thunder + push on fail
    attackType: 'save',
    rangeNormal: 15,      // self-centred, radius 15 ft
    damage: { count: 2, sides: 8, bonus: 0, average: avg(2, 8) },
    damageType: 'thunder',
    saveAbility: 'con',
    isAoE: true,
    aoeRadius: 15,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  // ---- Druid ----------------------------------------------

  'entangle': {
    // 20-ft square; STR save or restrained, concentration
    attackType: 'save',
    rangeNormal: 90,
    damage: null,
    damageType: null,
    saveAbility: 'str',
    isAoE: true,
    aoeRadius: 20,
    isControl: true,
    requiresConcentration: true,
    slotLevel: 1,
  },

  'faerie fire': {
    // 20-ft cube; DEX save or outlined (attacks against have advantage), concentration
    // Modelled as control (isControl: true); no direct damage
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'dex',
    isAoE: true,
    aoeRadius: 20,
    isControl: true,
    requiresConcentration: true,
    slotLevel: 1,
  },

  // ---- Warlock --------------------------------------------

  'arms of hadar': {
    // 10-ft radius sphere centred on caster; STR save, 2d6 necrotic
    attackType: 'save',
    rangeNormal: 10,      // self-centred
    damage: { count: 2, sides: 6, bonus: 0, average: avg(2, 6) },
    damageType: 'necrotic',
    saveAbility: 'str',
    isAoE: true,
    aoeRadius: 10,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'mage armor': {
    // 1st-level abjuration, no concentration, touch, 8 hrs.
    // Sets AC = 13 + DEX mod for unarmored targets. Dispatched via case 'mageArmor'.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    isAoE: false,
    aoeRadius: 0,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'hex': {
    // 1st-level enchantment, concentration, range 90 ft, single target.
    // Cast as bonus action. +1d6 necrotic on each hit by caster.
    // attackType: null — dispatched via case 'hex', not selectAction.
    attackType: null,
    rangeNormal: 90,
    damage: { count: 1, sides: 6, bonus: 0, average: 3.5 },
    damageType: 'necrotic',
    isAoE: false,
    aoeRadius: 0,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
  },

  // ---- Level 2 spells (PHB p.211–273) ----------------------
  // Added by Cantrip-z workstream pivot (Session 15 → 16). These are
  // leveled spells, NOT cantrips — the Cantrip-z workstream pivoted to
  // level-2 spell implementation per user instruction; see
  // zHANDOVER-SESSION-16.md for the pivot rationale. Each spell is
  // dispatched via a case branch in combat.ts (not selectAction) —
  // attackType: null means the planner's selectAction skips them.

  'aid': {
    // 2nd-level abjuration, action, range 30 ft, no concentration, 8 hr.
    // Up to 3 allies: +5 max HP & +5 current HP each.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'barkskin': {
    // 2nd-level transmutation, action, touch, concentration 1 hr.
    // Target's AC can't be less than 16 (ac_floor effect).
    attackType: null,
    rangeNormal: 5,    // touch
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'blur': {
    // 2nd-level illusion, action, self, concentration 1 min.
    // Disadvantage on attack rolls vs caster (advantage_vs disadv attack).
    attackType: null,
    rangeNormal: 0,    // self
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'blindness/deafness': {
    // 2nd-level necromancy, action, range 30 ft, NO concentration (1 min).
    // CON save or blinded (v1 always picks blinded).
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'con',
    isAoE: false,
    isControl: true,        // imposes a debilitating condition
    requiresConcentration: false,
    slotLevel: 2,
  },

  'branding smite': {
    // 2nd-level evocation, BONUS ACTION, self, concentration 1 min.
    // Next weapon hit deals +2d6 radiant (consumed on next hit).
    attackType: null,
    rangeNormal: 0,    // self
    damage: { count: 2, sides: 6, bonus: 0, average: avg(2, 6) },
    damageType: 'radiant',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
    bonusAction: true,
  },

  'calm emotions': {
    // 2nd-level enchantment, action, 60 ft, concentration 1 min.
    // Removes charmed/frightened from allies (v1: allies voluntarily fail save).
    // No damage, no save in v1 (allies voluntarily fail). attackType null —
    // NOT selected by selectAction; dispatched via a case branch in combat.ts.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    isAoE: true,             // canon: 20-ft-radius sphere (v1: all allies within 60 ft)
    isControl: true,         // removes control conditions (charmed/frightened)
    requiresConcentration: true,
    slotLevel: 2,
  },

  'cloud of daggers': {
    // 2nd-level conjuration, action, 60 ft, concentration 1 min.
    // 4d4 slashing on cast (no save) + persistent damage_zone effect.
    // attackType null — NOT selected by selectAction (dispatched via case
    // branch in combat.ts). The damage is applied inside execute(), not
    // via resolveAttack's save branch.
    attackType: null,
    rangeNormal: 60,
    damage: { count: 4, sides: 4, bonus: 0, average: avg(4, 4) },
    damageType: 'slashing',
    isAoE: true,             // canon: 5-ft cube (v1: single-target)
    isControl: true,         // persistent damage zone controls enemy positioning
    requiresConcentration: true,
    slotLevel: 2,
  },

  'crown of madness': {
    // 2nd-level enchantment, action, 120 ft, WIS save or charmed, concentration 1 min.
    // v1: forced-attack rider NOT modelled; charmed condition only.
    attackType: 'save',
    rangeNormal: 120,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: true,         // imposes charmed condition
    requiresConcentration: true,
    slotLevel: 2,
  },

  'hold person': {
    // 2nd-level enchantment, action, 60 ft, WIS save or paralyzed, concentration 1 min.
    // v1: end-of-turn save NOT modelled.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: true,         // imposes paralyzed condition
    requiresConcentration: true,
    slotLevel: 2,
  },

  'mirror image': {
    // 2nd-level illusion, action, self, NO concentration, 1 min.
    // 3 illusory duplicates; attackers must roll d20 to retarget.
    // No damage, no save. attackType null — NOT selected by selectAction.
    attackType: null,
    rangeNormal: 0,    // self
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

};

// ---- Lookup helper ------------------------------------------

/**
 * Returns the SpellTemplate for the given spell name, or null if it's
 * not in the combat database (utility / heal / unsupported).
 * Case-insensitive.
 */
export function lookupSpell(name: string): SpellTemplate | null {
  return SPELL_DB[name.toLowerCase()] ?? null;
}
