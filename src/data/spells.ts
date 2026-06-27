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
  /**
   * True if this spell has no in-combat use (ritual, divination, utility).
   * The AI planner skips spells with no `shouldCast` module; this flag is a
   * secondary safety net for Batch 5b monster-spellcasting integration —
   * when the engine wires up monster spell selection it checks this tag before
   * attempting to cast.  Spells with outOfCombat=true are never selected.
   */
  outOfCombat?: boolean;
  /**
   * True if cantrip damage should NOT scale with caster level (e.g. Eldritch
   * Blast, which scales by adding MORE BEAMS rather than bigger dice). When
   * true, the engine skips cantripTier scaling on this spell's damage dice.
   */
  noCantripScaling?: boolean;
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

  // ── Session 17 — level-2 batch 3 (15 new PHB level-2 spells) ──────────

  'enlarge/reduce': {
    // 2nd-level transmutation, action, 30 ft, CON save, concentration 1 min.
    // v1: mode = 'reduce' (enemy) or 'enlarge' (ally); size change NOT modelled.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'con',
    isAoE: false,
    isControl: true,          // buff/debuff
    requiresConcentration: true,
    slotLevel: 2,
  },

  'enhance ability': {
    // 2nd-level transmutation, action, touch, concentration 1 hr.
    // Grants advantage on one ability's checks. No damage, no save.
    attackType: null,
    rangeNormal: 5,    // touch
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'flame blade': {
    // 2nd-level evocation, action, self, concentration 10 min.
    // v1: +3d6 fire rider on melee weapon attacks (canon: new melee weapon).
    attackType: null,
    rangeNormal: 0,    // self
    damage: { count: 3, sides: 6, bonus: 0, average: avg(3, 6) },
    damageType: 'fire',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'flaming sphere': {
    // 2nd-level conjuration, action, 60 ft, DEX save 2d6 fire, concentration 1 min.
    // Persistent damage_zone with save for half.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 2, sides: 6, bonus: 0, average: avg(2, 6) },
    damageType: 'fire',
    saveAbility: 'dex',
    isAoE: true,              // canon: 5-ft sphere (v1: single-target)
    isControl: true,          // persistent damage zone
    requiresConcentration: true,
    slotLevel: 2,
  },

  'heat metal': {
    // 2nd-level transmutation, action, 60 ft, 2d8 fire + persistent damage_zone
    // (no save on damage), concentration 1 min.
    attackType: null,         // damage applied in execute(), not via resolveAttack
    rangeNormal: 60,
    damage: { count: 2, sides: 8, bonus: 0, average: avg(2, 8) },
    damageType: 'fire',
    saveAbility: 'con',       // CON save (for logging only — drop-object NOT modelled)
    isAoE: false,
    isControl: true,          // persistent damage zone
    requiresConcentration: true,
    slotLevel: 2,
  },

  "melf's acid arrow": {
    // 2nd-level evocation, action, 90 ft, ranged spell attack, 4d4 acid +
    // 2d4 delayed (damage_zone with ticksRemaining: 1). NO concentration.
    attackType: 'spell',      // ranged spell attack (resolved in execute())
    rangeNormal: 90,
    damage: { count: 4, sides: 4, bonus: 0, average: avg(4, 4) },
    damageType: 'acid',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'misty step': {
    // 2nd-level conjuration, BONUS ACTION, self, NO concentration.
    // Teleport up to 30 ft. No damage, no save.
    attackType: null,
    rangeNormal: 0,    // self
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
    bonusAction: true,
  },

  'invisibility': {
    // 2nd-level illusion, action, touch, concentration 1 hr.
    // Grants invisible condition. v1: ends-on-attack NOT modelled.
    attackType: null,
    rangeNormal: 5,    // touch
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: true,          // grants a condition (invisible)
    requiresConcentration: true,
    slotLevel: 2,
  },

  'gust of wind': {
    // 2nd-level evocation, action, line 60 ft, STR save or pushed 15 ft,
    // concentration 1 min. v1: single-target, one-shot push.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,             // no damage — push only
    damageType: null,
    saveAbility: 'str',
    isAoE: true,              // canon: line 60 ft (v1: single-target)
    isControl: true,          // push effect
    requiresConcentration: true,
    slotLevel: 2,
  },

  'levitate': {
    // 2nd-level transmutation, action, 60 ft, CON save or restrained (v1),
    // concentration 10 min.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'con',
    isAoE: false,
    isControl: true,          // imposes restrained condition (v1)
    requiresConcentration: true,
    slotLevel: 2,
  },

  'lesser restoration': {
    // 2nd-level abjuration, action, touch, NO concentration.
    // Ends blinded/deafened/paralyzed/poisoned. v1: removes ALL listed.
    attackType: null,
    rangeNormal: 5,    // touch
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: true,          // removes control conditions
    requiresConcentration: false,
    slotLevel: 2,
  },

  'magic weapon': {
    // 2nd-level transmutation, action, touch, concentration 1 hr.
    // Weapon +1 to attack and damage rolls.
    attackType: null,
    rangeNormal: 5,    // touch
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'cordon of arrows': {
    // 2nd-level transmutation, action, 5 ft, DEX save 1d6 piercing,
    // 4-piece damage_zone (ticksRemaining: 4). NO concentration.
    attackType: 'save',
    rangeNormal: 5,
    damage: { count: 1, sides: 6, bonus: 0, average: avg(1, 6) },
    damageType: 'piercing',
    saveAbility: 'dex',       // v1: DEX save (canon: ranged spell attack)
    isAoE: false,
    isControl: true,          // persistent damage zone
    requiresConcentration: false,
    slotLevel: 2,
  },

  'alter self': {
    // 2nd-level transmutation, action, self, concentration 10 min.
    // v1: Natural Weapons only (unarmed strikes → 1d6 slashing).
    attackType: null,
    rangeNormal: 0,    // self
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'darkvision': {
    // 2nd-level transmutation, action, touch, NO concentration, 8 hr.
    // v1: forward-compat flag only (vision subsystem not implemented).
    attackType: null,
    rangeNormal: 5,    // touch
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  // ── Session 18 — level-2 batch 4 (20 new PHB level-2 spells) ──────────

  'moonbeam': {
    // 2nd-level evocation, action, 120 ft, CON save 2d10 radiant (half on save),
    // persistent damage_zone 2d10 radiant/turn (CON save for half), concentration 1 min.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 2, sides: 10, bonus: 0, average: avg(2, 10) },
    damageType: 'radiant',
    saveAbility: 'con',
    isAoE: true,              // canon: 5-ft cylinder (v1: single-target)
    isControl: true,          // persistent damage zone
    requiresConcentration: true,
    slotLevel: 2,
  },

  'scorching ray': {
    // 2nd-level evocation, action, 120 ft, 3 ranged spell attacks 2d6 fire each.
    // NO concentration. v1: multi-attack pattern (NEW).
    attackType: 'spell',      // ranged spell attack (3 attacks in execute())
    rangeNormal: 120,
    damage: { count: 2, sides: 6, bonus: 0, average: avg(2, 6) },
    damageType: 'fire',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'shatter': {
    // 2nd-level evocation, action, 60 ft, CON save 3d8 thunder (half on save),
    // 10-ft radius AoE. NO concentration.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 3, sides: 8, bonus: 0, average: avg(3, 8) },
    damageType: 'thunder',
    saveAbility: 'con',
    isAoE: true,
    aoeRadius: 10,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'spike growth': {
    // 2nd-level transmutation, action, 150 ft, 2d4 piercing damage_zone/turn,
    // NO on-cast damage, concentration 10 min.
    attackType: null,         // no on-cast damage; persistent via damage_zone
    rangeNormal: 150,
    damage: { count: 2, sides: 4, bonus: 0, average: avg(2, 4) },
    damageType: 'piercing',
    isAoE: true,              // canon: 20-ft radius (v1: single-target)
    isControl: true,          // persistent damage zone
    requiresConcentration: true,
    slotLevel: 2,
  },

  'spiritual weapon': {
    // 2nd-level evocation, BONUS ACTION, 60 ft, melee spell attack 1d8 force +
    // persistent damage_zone 1d8 force/turn (ticksRemaining: 10), NO concentration, 1 min.
    attackType: 'spell',      // melee spell attack (resolved in execute())
    rangeNormal: 60,
    damage: { count: 1, sides: 8, bonus: 0, average: avg(1, 8) },
    damageType: 'force',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
    bonusAction: true,
  },

  'phantasmal force': {
    // 2nd-level illusion, action, 60 ft, INT save 1d6 psychic + persistent
    // damage_zone 1d6 psychic/turn (no save), concentration 1 min. On save
    // success: NO effect (target disbelieves).
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 1, sides: 6, bonus: 0, average: avg(1, 6) },
    damageType: 'psychic',
    saveAbility: 'int',
    isAoE: false,
    isControl: true,          // persistent damage zone
    requiresConcentration: true,
    slotLevel: 2,
  },

  'ray of enfeeblement': {
    // 2nd-level necromancy, action, 60 ft, ranged spell attack, target deals
    // half weapon damage, concentration 1 min. NO damage on hit.
    attackType: 'spell',      // ranged spell attack (resolved in execute())
    rangeNormal: 60,
    damage: null,             // NO direct damage; sets scratch field
    damageType: null,
    isAoE: false,
    isControl: true,          // debuff — half weapon damage
    requiresConcentration: true,
    slotLevel: 2,
  },

  'web': {
    // 2nd-level conjuration, action, 60 ft, DEX save or restrained,
    // concentration 1 min. v1: single-target (canon: 20-ft cube AoE).
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'dex',
    isAoE: true,              // canon: 20-ft cube (v1: single-target)
    isControl: true,          // restrained condition
    requiresConcentration: true,
    slotLevel: 2,
  },

  'silence': {
    // 2nd-level illusion, action, 120 ft, AoE blocks verbal spells (forward-
    // compat flag), concentration 10 min. NO save.
    attackType: null,
    rangeNormal: 120,
    damage: null,
    damageType: null,
    isAoE: true,              // canon: 20-ft radius sphere (v1: single-target)
    isControl: true,          // blocks verbal spells (forward-compat)
    requiresConcentration: true,
    slotLevel: 2,
  },

  'suggestion': {
    // 2nd-level enchantment, action, 30 ft, WIS save or charmed, concentration
    // (canon: 8 hr; v1: 1 min simplification).
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: true,          // charmed condition
    requiresConcentration: true,
    slotLevel: 2,
  },

  'zone of truth': {
    // 2nd-level enchantment, action, 60 ft, CHA save, can't lie in 15-ft radius
    // (forward-compat flag), concentration 10 min.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'cha',
    isAoE: true,              // canon: 15-ft radius (v1: single-target)
    isControl: true,          // truth-enforcement (forward-compat)
    requiresConcentration: true,
    slotLevel: 2,
  },

  'enthrall': {
    // 2nd-level enchantment, action, 60 ft, WIS save (multi-target up to 3),
    // disadv on Perception (forward-compat flag on caster), concentration 1 min.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: true,          // perception debuff (forward-compat)
    requiresConcentration: true,
    slotLevel: 2,
  },

  'detect thoughts': {
    // 2nd-level divination, action, self (5-ft aura), WIS save probe (forward-
    // compat flag on caster), concentration 1 min.
    attackType: null,
    rangeNormal: 5,           // self aura
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'see invisibility': {
    // 2nd-level divination, action, self, see invisible 60 ft (forward-compat
    // flag), NO concentration, 1 hr.
    attackType: null,
    rangeNormal: 0,           // self
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'spider climb': {
    // 2nd-level transmutation, action, touch, climb speed (forward-compat
    // flag), concentration 1 hr.
    attackType: null,
    rangeNormal: 5,           // touch
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'pass without trace': {
    // 2nd-level abjuration, action, self, +10 stealth aura (forward-compat
    // flag), concentration 1 hr.
    attackType: null,
    rangeNormal: 0,           // self
    damage: null,
    damageType: null,
    isAoE: true,              // canon: 30-ft radius aura (v1: self)
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'protection from poison': {
    // 2nd-level abjuration, action, touch, removes poisoned + advantage on saves
    // vs poison (forward-compat flag), NO concentration, 1 hr.
    attackType: null,
    rangeNormal: 5,           // touch
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: true,          // removes poisoned condition
    requiresConcentration: false,
    slotLevel: 2,
  },

  'prayer of healing': {
    // 2nd-level evocation, action (canon: 10 min — v1: action simplification),
    // 30 ft, 2d8+spellcasting heal up to 3 creatures, NO concentration.
    attackType: null,
    rangeNormal: 30,
    damage: null,             // healing, not damage
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'knock': {
    // 2nd-level transmutation, action, 60 ft, opens objects (forward-compat
    // flag), NO concentration.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'arcane lock': {
    // 2nd-level abjuration, action, touch, locks object (forward-compat flag),
    // permanent, NO concentration.
    attackType: null,
    rangeNormal: 5,           // touch
    damage: null,
    damageType: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  // ── Session 19 — bulk-implementation generic spells (262 new spells) ──
  // Each entry maps the lowercase spell name to a SpellTemplate. The
  // `attackType` field is set from the raw 5etools data: 'spell' for
  // melee/ranged spell attacks, 'save' for save-based spells, null for
  // utility / buff / forward-compat-only spells. The actual mechanical
  // effect of each spell is NOT applied in v1 — the spell module at
  // src/spells/<snake>.ts sets a forward-compat flag only.
  "aganazzar's scorcher": {
    // Session 19 bulk: 2-level evocation, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: { count: 3, sides: 8, bonus: 0, average: 14 },
    damageType: 'fire',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'air bubble': {
    // Session 19 bulk: 2-level conjuration, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'animal messenger': {
    // Session 19 bulk: 2-level enchantment, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'beast sense': {
    // Session 19 bulk: 2-level divination, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'borrowed knowledge': {
    // Session 19 bulk: 2-level divination, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'continual flame': {
    // Session 19 bulk: 2-level evocation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'death armor': {
    // Session 19 bulk: 2-level necromancy, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: { count: 2, sides: 4, bonus: 0, average: 5 },
    damageType: 'necrotic',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  "deryan's helpful homunculi": {
    // Session 19 bulk: 2-level conjuration, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  "dragon's breath": {
    // Session 19 bulk: 2-level transmutation, range 5 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 5,
    damage: { count: 3, sides: 6, bonus: 0, average: 10 },
    damageType: 'acid',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
    bonusAction: true,
  },

  'dust devil': {
    // Session 19 bulk: 2-level conjuration, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 1, sides: 8, bonus: 0, average: 4 },
    damageType: 'bludgeoning',
    saveAbility: 'str',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'earthbind': {
    // Session 19 bulk: 2-level transmutation, range 300 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 300,
    damage: null,
    damageType: null,
    saveAbility: 'str',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  "elminster's elusion": {
    // Session 19 bulk: 2-level abjuration, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
    bonusAction: true,
  },

  'find traps': {
    // Session 19 bulk: 2-level divination, range 120 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 120,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'flock of familiars': {
    // Session 19 bulk: 2-level conjuration, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  "fortune's favor": {
    // Session 19 bulk: 2-level divination, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'gift of gab': {
    // Session 19 bulk: 2-level enchantment, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'healing spirit': {
    // Session 19 bulk: 2-level conjuration, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
    bonusAction: true,
  },

  'homunculus servant': {
    // Session 19 bulk: 2-level conjuration, range 10 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 10,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'immovable object': {
    // Session 19 bulk: 2-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  "jim's glowing coin": {
    // Session 19 bulk: 2-level enchantment, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'kinetic jaunt': {
    // Session 19 bulk: 2-level transmutation, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: { count: 1, sides: 8, bonus: 0, average: 4 },
    damageType: 'force',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
    bonusAction: true,
  },

  'magic mouth': {
    // Session 19 bulk: 2-level illusion, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  "maximilian's earthen grasp": {
    // Session 19 bulk: 2-level transmutation, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: { count: 2, sides: 6, bonus: 0, average: 7 },
    damageType: 'bludgeoning',
    saveAbility: 'str',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'mind spike': {
    // Session 19 bulk: 2-level divination, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 3, sides: 8, bonus: 0, average: 14 },
    damageType: 'psychic',
    saveAbility: 'wis',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  "nathair's mischief": {
    // Session 19 bulk: 2-level illusion, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'dex',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  "nystul's magic aura": {
    // Session 19 bulk: 2-level illusion, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'pyrotechnics': {
    // Session 19 bulk: 2-level transmutation, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  "rime's binding ice": {
    // Session 19 bulk: 2-level evocation, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: { count: 3, sides: 8, bonus: 0, average: 14 },
    damageType: 'cold',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'shadow blade': {
    // Session 19 bulk: 2-level illusion, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: { count: 2, sides: 8, bonus: 0, average: 9 },
    damageType: 'psychic',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
    bonusAction: true,
  },

  'skywrite': {
    // Session 19 bulk: 2-level transmutation, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  "snilloc's snowball swarm": {
    // Session 19 bulk: 2-level evocation, range 90 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 90,
    damage: { count: 3, sides: 6, bonus: 0, average: 10 },
    damageType: 'cold',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'spray of cards': {
    // Session 19 bulk: 2-level conjuration, range 15 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 15,
    damage: { count: 2, sides: 10, bonus: 0, average: 11 },
    damageType: 'force',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  "tasha's mind whip": {
    // Session 19 bulk: 2-level enchantment, range 90 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 90,
    damage: { count: 3, sides: 6, bonus: 0, average: 10 },
    damageType: 'psychic',
    saveAbility: 'int',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'vortex warp': {
    // Session 19 bulk: 2-level conjuration, range 90 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 90,
    damage: null,
    damageType: null,
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'warding wind': {
    // Session 19 bulk: 2-level evocation, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'warp sense': {
    // Session 19 bulk: 2-level divination, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'wither and bloom': {
    // Session 19 bulk: 2-level necromancy, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 2, sides: 6, bonus: 0, average: 7 },
    damageType: 'necrotic',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 2,
  },

  'wristpocket': {
    // Session 19 bulk: 2-level conjuration, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 2,
  },

  'antagonize': {
    // Session 19 bulk: 3-level enchantment, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: { count: 4, sides: 4, bonus: 0, average: 10 },
    damageType: 'psychic',
    saveAbility: 'wis',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  "ashardalon's stride": {
    // Session 19 bulk: 3-level transmutation, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: { count: 1, sides: 6, bonus: 0, average: 4 },
    damageType: 'fire',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
    bonusAction: true,
  },

  'aura of vitality': {
    // Session 19 bulk: 3-level evocation, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'beacon of hope': {
    // Session 19 bulk: 3-level abjuration, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'bestow curse': {
    // Session 19 bulk: 3-level necromancy, range 5 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 5,
    damage: { count: 1, sides: 8, bonus: 0, average: 4 },
    damageType: 'necrotic',
    saveAbility: 'wis',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'blinding smite': {
    // Session 19 bulk: 3-level evocation, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 3, sides: 8, bonus: 0, average: 14 },
    damageType: 'radiant',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
    bonusAction: true,
  },

  'blink': {
    // Session 19 bulk: 3-level transmutation, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'cacophonic shield': {
    // Session 19 bulk: 3-level evocation, range 10 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 10,
    damage: { count: 3, sides: 6, bonus: 0, average: 10 },
    damageType: 'thunder',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'call lightning': {
    // Session 19 bulk: 3-level conjuration, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 3, sides: 10, bonus: 0, average: 16 },
    damageType: 'lightning',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'catnap': {
    // Session 19 bulk: 3-level enchantment, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'create food and water': {
    // Session 19 bulk: 3-level conjuration, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  "crusader's mantle": {
    // Session 19 bulk: 3-level evocation, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: { count: 1, sides: 4, bonus: 0, average: 2 },
    damageType: 'radiant',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'daylight': {
    // Session 19 bulk: 3-level evocation, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'elemental weapon': {
    // Session 19 bulk: 3-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: { count: 1, sides: 4, bonus: 0, average: 2 },
    damageType: 'acid',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'enemies abound': {
    // Session 19 bulk: 3-level enchantment, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: null,
    damageType: null,
    saveAbility: 'int',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'erupting earth': {
    // Session 19 bulk: 3-level transmutation, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 3, sides: 12, bonus: 0, average: 20 },
    damageType: 'bludgeoning',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'fast friends': {
    // Session 19 bulk: 3-level enchantment, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'fear': {
    // Session 19 bulk: 3-level illusion, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'feign death': {
    // Session 19 bulk: 3-level necromancy, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'fireball': {
    // Session 19 bulk: 3-level evocation, range 150 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 150,
    damage: { count: 8, sides: 6, bonus: 0, average: 28 },
    damageType: 'fire',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'flame arrows': {
    // Session 19 bulk: 3-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: { count: 1, sides: 6, bonus: 0, average: 4 },
    damageType: 'fire',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'fly': {
    // Session 19 bulk: 3-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  "galder's tower": {
    // Session 19 bulk: 3-level conjuration, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'gaseous form': {
    // Session 19 bulk: 3-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'haste': {
    // Session 19 bulk: 3-level transmutation, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'hunger of hadar': {
    // Session 19 bulk: 3-level conjuration, range 150 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 150,
    damage: { count: 2, sides: 6, bonus: 0, average: 7 },
    damageType: 'acid',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'hypnotic pattern': {
    // Session 19 bulk: 3-level illusion, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'incite greed': {
    // Session 19 bulk: 3-level enchantment, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'intellect fortress': {
    // Session 19 bulk: 3-level abjuration, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  "laeral's silver lance": {
    // Session 19 bulk: 3-level evocation, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 3, sides: 10, bonus: 0, average: 16 },
    damageType: 'force',
    saveAbility: 'str',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  "leomund's tiny hut": {
    // Session 19 bulk: 3-level evocation, range 10 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 10,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'life transference': {
    // Session 19 bulk: 3-level necromancy, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: { count: 4, sides: 8, bonus: 0, average: 18 },
    damageType: 'necrotic',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'lightning arrow': {
    // Session 19 bulk: 3-level transmutation, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 4, sides: 8, bonus: 0, average: 18 },
    damageType: 'lightning',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
    bonusAction: true,
  },

  'lightning bolt': {
    // Session 19 bulk: 3-level evocation, range 100 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 100,
    damage: { count: 8, sides: 6, bonus: 0, average: 28 },
    damageType: 'lightning',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'linked glyphs': {
    // Session 19 bulk: 3-level abjuration, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'major image': {
    // Session 19 bulk: 3-level illusion, range 120 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 120,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'mass healing word': {
    // Session 19 bulk: 3-level evocation, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
    bonusAction: true,
  },

  'meld into stone': {
    // Session 19 bulk: 3-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: { count: 6, sides: 6, bonus: 0, average: 21 },
    damageType: 'bludgeoning',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  "melf's minute meteors": {
    // Session 19 bulk: 3-level evocation, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 2, sides: 6, bonus: 0, average: 7 },
    damageType: 'fire',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'motivational speech': {
    // Session 19 bulk: 3-level enchantment, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'nondetection': {
    // Session 19 bulk: 3-level abjuration, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'phantom steed': {
    // Session 19 bulk: 3-level illusion, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'plant growth': {
    // Session 19 bulk: 3-level transmutation, range 150 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 150,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'pulse wave': {
    // Session 19 bulk: 3-level evocation, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: { count: 6, sides: 6, bonus: 0, average: 21 },
    damageType: 'force',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'remove curse': {
    // Session 19 bulk: 3-level abjuration, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'sleet storm': {
    // Session 19 bulk: 3-level conjuration, range 150 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 150,
    damage: null,
    damageType: null,
    saveAbility: 'dex',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'slow': {
    // Session 19 bulk: 3-level transmutation, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'speak with dead': {
    // Session 19 bulk: 3-level necromancy, range 10 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 10,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'speak with plants': {
    // Session 19 bulk: 3-level transmutation, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'spirit guardians': {
    // Session 19 bulk: 3-level conjuration, range 15 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 15,
    damage: { count: 3, sides: 8, bonus: 0, average: 14 },
    damageType: 'necrotic',
    saveAbility: 'wis',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'spirit shroud': {
    // Session 19 bulk: 3-level necromancy, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: { count: 1, sides: 8, bonus: 0, average: 4 },
    damageType: 'radiant',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
    bonusAction: true,
  },

  'stinking cloud': {
    // Session 19 bulk: 3-level conjuration, range 90 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 90,
    damage: null,
    damageType: null,
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  "syluné's viper": {
    // Session 19 bulk: 3-level conjuration, range 0 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 0,
    damage: { count: 1, sides: 6, bonus: 0, average: 4 },
    damageType: 'force',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
    bonusAction: true,
  },

  'tidal wave': {
    // Session 19 bulk: 3-level conjuration, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 4, sides: 8, bonus: 0, average: 18 },
    damageType: 'bludgeoning',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'tiny servant': {
    // Session 19 bulk: 3-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
  },

  'vampiric touch': {
    // Session 19 bulk: 3-level necromancy, range 0 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 0,
    damage: { count: 3, sides: 6, bonus: 0, average: 10 },
    damageType: 'necrotic',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 3,
  },

  'aura of life': {
    // Session 19 bulk: 4-level abjuration, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'aura of purity': {
    // Session 19 bulk: 4-level abjuration, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'backlash': {
    // Session 19 bulk: 4-level abjuration, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 4, sides: 6, bonus: 0, average: 14 },
    damageType: 'force',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  'blight': {
    // Session 19 bulk: 4-level necromancy, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: { count: 8, sides: 8, bonus: 0, average: 36 },
    damageType: 'necrotic',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  'charm monster': {
    // Session 19 bulk: 4-level enchantment, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  'compulsion': {
    // Session 19 bulk: 4-level enchantment, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'confusion': {
    // Session 19 bulk: 4-level enchantment, range 90 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 90,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'control water': {
    // Session 19 bulk: 4-level transmutation, range 300 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 300,
    damage: { count: 2, sides: 8, bonus: 0, average: 9 },
    damageType: 'bludgeoning',
    saveAbility: 'str',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'death ward': {
    // Session 19 bulk: 4-level abjuration, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  'dominate beast': {
    // Session 19 bulk: 4-level enchantment, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'doomtide': {
    // Session 19 bulk: 4-level conjuration, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 5, sides: 6, bonus: 0, average: 18 },
    damageType: 'psychic',
    saveAbility: 'wis',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'elemental bane': {
    // Session 19 bulk: 4-level transmutation, range 90 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 90,
    damage: { count: 2, sides: 6, bonus: 0, average: 7 },
    damageType: 'acid',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  "evard's black tentacles": {
    // Session 19 bulk: 4-level conjuration, range 90 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 90,
    damage: { count: 3, sides: 6, bonus: 0, average: 10 },
    damageType: 'bludgeoning',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'fabricate': {
    // Session 19 bulk: 4-level transmutation, range 120 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 120,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  'fire shield': {
    // Session 19 bulk: 4-level evocation, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: { count: 2, sides: 8, bonus: 0, average: 9 },
    damageType: 'cold',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  'freedom of movement': {
    // Session 19 bulk: 4-level abjuration, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  "galder's speedy courier": {
    // Session 19 bulk: 4-level conjuration, range 10 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 10,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  'gate seal': {
    // Session 19 bulk: 4-level abjuration, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  'giant insect': {
    // Session 19 bulk: 4-level transmutation, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'grasping vine': {
    // Session 19 bulk: 4-level conjuration, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'dex',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
    bonusAction: true,
  },

  'gravity sinkhole': {
    // Session 19 bulk: 4-level evocation, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 5, sides: 10, bonus: 0, average: 28 },
    damageType: 'force',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  'guardian of faith': {
    // Session 19 bulk: 4-level conjuration, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: 'radiant',
    saveAbility: 'dex',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  'guardian of nature': {
    // Session 19 bulk: 4-level transmutation, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: { count: 1, sides: 6, bonus: 0, average: 4 },
    damageType: 'force',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
    bonusAction: true,
  },

  'hallucinatory terrain': {
    // Session 19 bulk: 4-level illusion, range 300 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 300,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  'ice storm': {
    // Session 19 bulk: 4-level evocation, range 300 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 300,
    damage: { count: 2, sides: 8, bonus: 0, average: 9 },
    damageType: 'bludgeoning',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  "mordenkainen's faithful hound": {
    // Session 19 bulk: 4-level conjuration, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: { count: 4, sides: 8, bonus: 0, average: 18 },
    damageType: 'piercing',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  "mordenkainen's private sanctum": {
    // Session 19 bulk: 4-level abjuration, range 120 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 120,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  "otiluke's resilient sphere": {
    // Session 19 bulk: 4-level evocation, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'dex',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'phantasmal killer': {
    // Session 19 bulk: 4-level illusion, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 4, sides: 10, bonus: 0, average: 22 },
    damageType: 'psychic',
    saveAbility: 'wis',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'polymorph': {
    // Session 19 bulk: 4-level transmutation, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  "raulothim's psychic lance": {
    // Session 19 bulk: 4-level enchantment, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 7, sides: 6, bonus: 0, average: 24 },
    damageType: 'psychic',
    saveAbility: 'int',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  'shadow of moil': {
    // Session 19 bulk: 4-level necromancy, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: { count: 2, sides: 8, bonus: 0, average: 9 },
    damageType: 'necrotic',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'sickening radiance': {
    // Session 19 bulk: 4-level evocation, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 4, sides: 10, bonus: 0, average: 22 },
    damageType: 'radiant',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'spellfire storm': {
    // Session 19 bulk: 4-level evocation, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 4, sides: 10, bonus: 0, average: 22 },
    damageType: 'radiant',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'spirit of death': {
    // Session 19 bulk: 4-level necromancy, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'staggering smite': {
    // Session 19 bulk: 4-level evocation, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 4, sides: 6, bonus: 0, average: 14 },
    damageType: 'psychic',
    saveAbility: 'wis',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
    bonusAction: true,
  },

  'stone shape': {
    // Session 19 bulk: 4-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  'stoneskin': {
    // Session 19 bulk: 4-level abjuration, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'storm sphere': {
    // Session 19 bulk: 4-level evocation, range 150 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 150,
    damage: { count: 2, sides: 6, bonus: 0, average: 7 },
    damageType: 'bludgeoning',
    saveAbility: 'str',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  'vitriolic sphere': {
    // Session 19 bulk: 4-level evocation, range 150 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 150,
    damage: { count: 10, sides: 4, bonus: 0, average: 25 },
    damageType: 'acid',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 4,
  },

  'watery sphere': {
    // Session 19 bulk: 4-level conjuration, range 90 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 90,
    damage: null,
    damageType: null,
    saveAbility: 'str',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 4,
  },

  "alustriel's mooncloak": {
    // Session 19 bulk: 5-level abjuration, range 20 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 20,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'animate objects': {
    // Session 19 bulk: 5-level transmutation, range 120 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 120,
    damage: null,
    damageType: 'bludgeoning',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'antilife shell': {
    // Session 19 bulk: 5-level abjuration, range 10 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 10,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'banishing smite': {
    // Session 19 bulk: 5-level abjuration, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: { count: 5, sides: 10, bonus: 0, average: 28 },
    damageType: 'force',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
    bonusAction: true,
  },

  "bigby's hand": {
    // Session 19 bulk: 5-level evocation, range 120 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 120,
    damage: { count: 4, sides: 8, bonus: 0, average: 18 },
    damageType: 'bludgeoning',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'circle of power': {
    // Session 19 bulk: 5-level abjuration, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'cloudkill': {
    // Session 19 bulk: 5-level conjuration, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 5, sides: 8, bonus: 0, average: 22 },
    damageType: 'poison',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'commune with nature': {
    // Session 19 bulk: 5-level divination, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'cone of cold': {
    // Session 19 bulk: 5-level evocation, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 8, sides: 8, bonus: 0, average: 36 },
    damageType: 'cold',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'contagion': {
    // Session 19 bulk: 5-level necromancy, range 5 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'control winds': {
    // Session 19 bulk: 5-level transmutation, range 300 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 300,
    damage: null,
    damageType: null,
    saveAbility: 'str',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'create spelljamming helm': {
    // Session 19 bulk: 5-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'creation': {
    // Session 19 bulk: 5-level illusion, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'danse macabre': {
    // Session 19 bulk: 5-level necromancy, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'dawn': {
    // Session 19 bulk: 5-level evocation, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 4, sides: 10, bonus: 0, average: 22 },
    damageType: 'radiant',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'destructive wave': {
    // Session 19 bulk: 5-level evocation, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: { count: 5, sides: 6, bonus: 0, average: 18 },
    damageType: 'necrotic',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'dominate person': {
    // Session 19 bulk: 5-level enchantment, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'enervation': {
    // Session 19 bulk: 5-level necromancy, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 2, sides: 8, bonus: 0, average: 9 },
    damageType: 'necrotic',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'flame strike': {
    // Session 19 bulk: 5-level evocation, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 4, sides: 6, bonus: 0, average: 14 },
    damageType: 'fire',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'geas': {
    // Session 19 bulk: 5-level enchantment, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 5, sides: 10, bonus: 0, average: 28 },
    damageType: 'psychic',
    saveAbility: 'wis',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'greater restoration': {
    // Session 19 bulk: 5-level abjuration, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'hold monster': {
    // Session 19 bulk: 5-level enchantment, range 90 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 90,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'holy weapon': {
    // Session 19 bulk: 5-level evocation, range 5 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 5,
    damage: { count: 2, sides: 8, bonus: 0, average: 9 },
    damageType: 'radiant',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
    bonusAction: true,
  },

  'immolation': {
    // Session 19 bulk: 5-level evocation, range 90 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 90,
    damage: { count: 8, sides: 6, bonus: 0, average: 28 },
    damageType: 'fire',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'insect plague': {
    // Session 19 bulk: 5-level conjuration, range 300 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 300,
    damage: { count: 4, sides: 10, bonus: 0, average: 22 },
    damageType: 'piercing',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'maelstrom': {
    // Session 19 bulk: 5-level evocation, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 6, sides: 6, bonus: 0, average: 21 },
    damageType: 'bludgeoning',
    saveAbility: 'str',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'mass cure wounds': {
    // Session 19 bulk: 5-level evocation, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'mislead': {
    // Session 19 bulk: 5-level illusion, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'modify memory': {
    // Session 19 bulk: 5-level enchantment, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'negative energy flood': {
    // Session 19 bulk: 5-level necromancy, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 5, sides: 12, bonus: 0, average: 32 },
    damageType: 'necrotic',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'passwall': {
    // Session 19 bulk: 5-level transmutation, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  "rary's telepathic bond": {
    // Session 19 bulk: 5-level divination, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'seeming': {
    // Session 19 bulk: 5-level illusion, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'cha',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'skill empowerment': {
    // Session 19 bulk: 5-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  "songal's elemental suffusion": {
    // Session 19 bulk: 5-level transmutation, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 2, sides: 6, bonus: 0, average: 7 },
    damageType: 'acid',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'steel wind strike': {
    // Session 19 bulk: 5-level conjuration, range 30 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 30,
    damage: { count: 6, sides: 10, bonus: 0, average: 33 },
    damageType: 'force',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'swift quiver': {
    // Session 19 bulk: 5-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
    bonusAction: true,
  },

  'synaptic static': {
    // Session 19 bulk: 5-level enchantment, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 8, sides: 6, bonus: 0, average: 28 },
    damageType: 'psychic',
    saveAbility: 'int',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'telekinesis': {
    // Session 19 bulk: 5-level transmutation, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'temporal shunt': {
    // Session 19 bulk: 5-level transmutation, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'transmute rock': {
    // Session 19 bulk: 5-level transmutation, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 4, sides: 8, bonus: 0, average: 18 },
    damageType: 'bludgeoning',
    saveAbility: 'str',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 5,
  },

  'tree stride': {
    // Session 19 bulk: 5-level conjuration, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'wrath of nature': {
    // Session 19 bulk: 5-level evocation, range 120 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 120,
    damage: { count: 4, sides: 6, bonus: 0, average: 14 },
    damageType: 'bludgeoning',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 5,
  },

  'arcane gate': {
    // Session 19 bulk: 6-level conjuration, range 500 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 500,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  'blade barrier': {
    // Session 19 bulk: 6-level evocation, range 90 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 90,
    damage: { count: 6, sides: 10, bonus: 0, average: 33 },
    damageType: 'slashing',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  'bones of the earth': {
    // Session 19 bulk: 6-level transmutation, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 6, sides: 6, bonus: 0, average: 21 },
    damageType: 'bludgeoning',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  'chain lightning': {
    // Session 19 bulk: 6-level evocation, range 150 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 150,
    damage: { count: 10, sides: 8, bonus: 0, average: 45 },
    damageType: 'lightning',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  'circle of death': {
    // Session 19 bulk: 6-level necromancy, range 150 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 150,
    damage: { count: 8, sides: 6, bonus: 0, average: 28 },
    damageType: 'necrotic',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  'create homunculus': {
    // Session 19 bulk: 6-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: { count: 2, sides: 4, bonus: 0, average: 5 },
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  'dirge': {
    // Session 19 bulk: 6-level enchantment, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 3, sides: 10, bonus: 0, average: 16 },
    damageType: 'necrotic',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  'disintegrate': {
    // Session 19 bulk: 6-level transmutation, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: 'force',
    saveAbility: 'dex',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  'druid grove': {
    // Session 19 bulk: 6-level abjuration, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  "elminster's effulgent spheres": {
    // Session 19 bulk: 6-level evocation, range 0 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 0,
    damage: { count: 3, sides: 6, bonus: 0, average: 10 },
    damageType: 'acid',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  'eyebite': {
    // Session 19 bulk: 6-level necromancy, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  "fizban's platinum shield": {
    // Session 19 bulk: 6-level abjuration, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
    bonusAction: true,
  },

  'flesh to stone': {
    // Session 19 bulk: 6-level transmutation, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  'globe of invulnerability': {
    // Session 19 bulk: 6-level abjuration, range 10 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 10,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  'gravity fissure': {
    // Session 19 bulk: 6-level evocation, range 100 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 100,
    damage: { count: 8, sides: 8, bonus: 0, average: 36 },
    damageType: 'force',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  'harm': {
    // Session 19 bulk: 6-level necromancy, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 14, sides: 6, bonus: 0, average: 49 },
    damageType: 'necrotic',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  'heal': {
    // Session 19 bulk: 6-level evocation, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  'investiture of flame': {
    // Session 19 bulk: 6-level transmutation, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 1, sides: 10, bonus: 0, average: 6 },
    damageType: 'fire',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  'investiture of ice': {
    // Session 19 bulk: 6-level transmutation, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 4, sides: 6, bonus: 0, average: 14 },
    damageType: 'cold',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  'investiture of stone': {
    // Session 19 bulk: 6-level transmutation, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: 'dex',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  'investiture of wind': {
    // Session 19 bulk: 6-level transmutation, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 2, sides: 10, bonus: 0, average: 11 },
    damageType: 'bludgeoning',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  'mass suggestion': {
    // Session 19 bulk: 6-level enchantment, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  'mental prison': {
    // Session 19 bulk: 6-level illusion, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 5, sides: 10, bonus: 0, average: 28 },
    damageType: 'psychic',
    saveAbility: 'int',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  'move earth': {
    // Session 19 bulk: 6-level transmutation, range 120 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 120,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  "otiluke's freezing sphere": {
    // Session 19 bulk: 6-level evocation, range 300 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 300,
    damage: { count: 10, sides: 6, bonus: 0, average: 35 },
    damageType: 'cold',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  "otto's irresistible dance": {
    // Session 19 bulk: 6-level enchantment, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  'primordial ward': {
    // Session 19 bulk: 6-level abjuration, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  'scatter': {
    // Session 19 bulk: 6-level conjuration, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  'soul cage': {
    // Session 19 bulk: 6-level necromancy, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  'sunbeam': {
    // Session 19 bulk: 6-level evocation, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 6, sides: 8, bonus: 0, average: 27 },
    damageType: 'radiant',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  "tasha's otherworldly guise": {
    // Session 19 bulk: 6-level transmutation, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
    bonusAction: true,
  },

  "tenser's transformation": {
    // Session 19 bulk: 6-level transmutation, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 2, sides: 12, bonus: 0, average: 13 },
    damageType: 'force',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 6,
  },

  'transport via plants': {
    // Session 19 bulk: 6-level conjuration, range 10 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 10,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 6,
  },

  'crown of stars': {
    // Session 19 bulk: 7-level evocation, range 0 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 0,
    damage: { count: 4, sides: 12, bonus: 0, average: 26 },
    damageType: 'radiant',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 7,
  },

  'delayed blast fireball': {
    // Session 19 bulk: 7-level evocation, range 150 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 150,
    damage: { count: 12, sides: 6, bonus: 0, average: 42 },
    damageType: 'fire',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 7,
  },

  'divine word': {
    // Session 19 bulk: 7-level evocation, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'cha',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 7,
    bonusAction: true,
  },

  'draconic transformation': {
    // Session 19 bulk: 7-level transmutation, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 6, sides: 8, bonus: 0, average: 27 },
    damageType: 'force',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 7,
    bonusAction: true,
  },

  'finger of death': {
    // Session 19 bulk: 7-level necromancy, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: 'necrotic',
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 7,
  },

  'fire storm': {
    // Session 19 bulk: 7-level evocation, range 150 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 150,
    damage: { count: 7, sides: 10, bonus: 0, average: 38 },
    damageType: 'fire',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 7,
  },

  'forcecage': {
    // Session 19 bulk: 7-level evocation, range 100 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 100,
    damage: null,
    damageType: null,
    saveAbility: 'cha',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 7,
  },

  'mirage arcane': {
    // Session 19 bulk: 7-level illusion, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 7,
  },

  "mordenkainen's magnificent mansion": {
    // Session 19 bulk: 7-level conjuration, range 300 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 300,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 7,
  },

  "mordenkainen's sword": {
    // Session 19 bulk: 7-level evocation, range 60 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 60,
    damage: { count: 3, sides: 10, bonus: 0, average: 16 },
    damageType: 'force',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 7,
  },

  'power word pain': {
    // Session 19 bulk: 7-level enchantment, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 7,
  },

  'prismatic spray': {
    // Session 19 bulk: 7-level evocation, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 10, sides: 6, bonus: 0, average: 35 },
    damageType: 'acid',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 7,
  },

  'project image': {
    // Session 19 bulk: 7-level illusion, range 500 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 500,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 7,
  },

  'regenerate': {
    // Session 19 bulk: 7-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 7,
  },

  'reverse gravity': {
    // Session 19 bulk: 7-level transmutation, range 100 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 100,
    damage: null,
    damageType: null,
    saveAbility: 'dex',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 7,
  },

  'sequester': {
    // Session 19 bulk: 7-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 7,
  },

  "simbul's synostodweomer": {
    // Session 19 bulk: 7-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 7,
  },

  'tether essence': {
    // Session 19 bulk: 7-level necromancy, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 7,
  },

  'whirlwind': {
    // Session 19 bulk: 7-level evocation, range 300 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 300,
    damage: { count: 10, sides: 6, bonus: 0, average: 35 },
    damageType: 'bludgeoning',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 7,
  },

  "abi-dalzim's horrid wilting": {
    // Session 19 bulk: 8-level necromancy, range 150 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 150,
    damage: { count: 12, sides: 8, bonus: 0, average: 54 },
    damageType: 'necrotic',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 8,
  },

  'animal shapes': {
    // Session 19 bulk: 8-level transmutation, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 8,
  },

  'antipathy/sympathy': {
    // Session 19 bulk: 8-level enchantment, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 8,
  },

  'control weather': {
    // Session 19 bulk: 8-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 8,
  },

  'dark star': {
    // Session 19 bulk: 8-level evocation, range 150 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 150,
    damage: { count: 8, sides: 10, bonus: 0, average: 44 },
    damageType: 'force',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 8,
  },

  'dominate monster': {
    // Session 19 bulk: 8-level enchantment, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 8,
  },

  'earthquake': {
    // Session 19 bulk: 8-level evocation, range 500 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 500,
    damage: { count: 5, sides: 6, bonus: 0, average: 18 },
    damageType: 'bludgeoning',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 8,
  },

  'feeblemind': {
    // Session 19 bulk: 8-level enchantment, range 150 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 150,
    damage: { count: 4, sides: 6, bonus: 0, average: 14 },
    damageType: 'psychic',
    saveAbility: 'int',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 8,
  },

  'glibness': {
    // Session 19 bulk: 8-level transmutation, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 8,
  },

  'holy aura': {
    // Session 19 bulk: 8-level abjuration, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 8,
  },

  'holy star of mystra': {
    // Session 19 bulk: 8-level evocation, range 0 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 8,
    bonusAction: true,
  },

  'illusory dragon': {
    // Session 19 bulk: 8-level illusion, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 7, sides: 6, bonus: 0, average: 24 },
    damageType: 'acid',
    saveAbility: 'wis',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 8,
  },

  'incendiary cloud': {
    // Session 19 bulk: 8-level conjuration, range 150 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 150,
    damage: { count: 10, sides: 8, bonus: 0, average: 45 },
    damageType: 'fire',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 8,
  },

  'maddening darkness': {
    // Session 19 bulk: 8-level evocation, range 150 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 150,
    damage: { count: 8, sides: 8, bonus: 0, average: 36 },
    damageType: 'psychic',
    saveAbility: 'wis',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 8,
  },

  'power word stun': {
    // Session 19 bulk: 8-level enchantment, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 8,
  },

  'reality break': {
    // Session 19 bulk: 8-level conjuration, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 6, sides: 12, bonus: 0, average: 39 },
    damageType: 'psychic',
    saveAbility: 'wis',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 8,
  },

  'sunburst': {
    // Session 19 bulk: 8-level evocation, range 150 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 150,
    damage: { count: 12, sides: 6, bonus: 0, average: 42 },
    damageType: 'radiant',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 8,
  },

  'tsunami': {
    // Session 19 bulk: 8-level conjuration, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 6, sides: 10, bonus: 0, average: 33 },
    damageType: 'bludgeoning',
    saveAbility: 'str',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 8,
  },

  'blade of disaster': {
    // Session 19 bulk: 9-level conjuration, range 60 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 60,
    damage: { count: 4, sides: 12, bonus: 0, average: 26 },
    damageType: 'force',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 9,
    bonusAction: true,
  },

  'foresight': {
    // Session 19 bulk: 9-level divination, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 9,
  },

  'invulnerability': {
    // Session 19 bulk: 9-level abjuration, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 9,
  },

  'mass heal': {
    // Session 19 bulk: 9-level evocation, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 9,
  },

  'mass polymorph': {
    // Session 19 bulk: 9-level transmutation, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 9,
  },

  'meteor swarm': {
    // Session 19 bulk: 9-level evocation, range 1 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 1,
    damage: { count: 20, sides: 6, bonus: 0, average: 70 },
    damageType: 'bludgeoning',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 9,
  },

  'power word heal': {
    // Session 19 bulk: 9-level evocation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 9,
  },

  'power word kill': {
    // Session 19 bulk: 9-level enchantment, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 9,
  },

  'psychic scream': {
    // Session 19 bulk: 9-level enchantment, range 90 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 90,
    damage: { count: 14, sides: 6, bonus: 0, average: 49 },
    damageType: 'psychic',
    saveAbility: 'int',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 9,
  },

  'ravenous void': {
    // Session 19 bulk: 9-level evocation, range 1000 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 1000,
    damage: { count: 5, sides: 10, bonus: 0, average: 28 },
    damageType: 'force',
    saveAbility: 'str',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 9,
  },

  'storm of vengeance': {
    // Session 19 bulk: 9-level conjuration, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 2, sides: 6, bonus: 0, average: 7 },
    damageType: 'acid',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 9,
  },

  'time ravage': {
    // Session 19 bulk: 9-level necromancy, range 90 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 90,
    damage: { count: 10, sides: 12, bonus: 0, average: 65 },
    damageType: 'necrotic',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 9,
  },

  'time stop': {
    // Session 19 bulk: 9-level transmutation, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 9,
  },

  'weird': {
    // Session 19 bulk: 9-level illusion, range 120 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 120,
    damage: { count: 4, sides: 10, bonus: 0, average: 22 },
    damageType: 'psychic',
    saveAbility: 'wis',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 9,
  },


  // ── Session 20 — bulk-implementation L1 spells (51 new spells) ──
  // Each entry maps the lowercase spell name to a SpellTemplate. The
  // `attackType` field is set from the raw 5etools data: 'spell' for
  // melee/ranged spell attacks, 'save' for save-based spells, null for
  // utility / buff / forward-compat-only spells. The actual mechanical
  // effect of each spell is NOT applied in v1 — the spell module at
  // src/spells/<snake>.ts sets a forward-compat flag only.
  'alarm': {
    // Session 20 bulk: 1-level abjuration, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'animal friendship': {
    // Session 20 bulk: 1-level enchantment, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'armor of agathys': {
    // Session 20 bulk: 1-level abjuration, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: 'cold',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'bane': {
    // Session 20 bulk: 1-level enchantment, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'cha',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
  },

  'beast bond': {
    // Session 20 bulk: 1-level divination, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
  },

  'catapult': {
    // Session 20 bulk: 1-level transmutation, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 3, sides: 8, bonus: 0, average: 14 },
    damageType: 'bludgeoning',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'cause fear': {
    // Session 20 bulk: 1-level necromancy, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
  },

  'ceremony': {
    // Session 20 bulk: 1-level abjuration, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'chaos bolt': {
    // Session 20 bulk: 1-level evocation, range 120 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 120,
    damage: null,
    damageType: 'acid',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'charm person': {
    // Session 20 bulk: 1-level enchantment, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  // 'chromatic orb' already exists in SPELL_DB (pre-Session-20) — not re-added here.

  'color spray': {
    // Session 20 bulk: 1-level illusion, range 15 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 15,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'command': {
    // Session 20 bulk: 1-level enchantment, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'compelled duel': {
    // Session 20 bulk: 1-level enchantment, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
    bonusAction: true,
  },

  'create or destroy water': {
    // Session 20 bulk: 1-level transmutation, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'disguise self': {
    // Session 20 bulk: 1-level illusion, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'distort value': {
    // Session 20 bulk: 1-level illusion, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'divine favor': {
    // Session 20 bulk: 1-level evocation, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: { count: 1, sides: 4, bonus: 0, average: 2 },
    damageType: 'radiant',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
    bonusAction: true,
  },

  'earth tremor': {
    // Session 20 bulk: 1-level evocation, range 10 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 10,
    damage: { count: 1, sides: 6, bonus: 0, average: 4 },
    damageType: 'bludgeoning',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'ensnaring strike': {
    // Session 20 bulk: 1-level conjuration, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 1, sides: 6, bonus: 0, average: 4 },
    damageType: 'piercing',
    saveAbility: 'str',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
    bonusAction: true,
  },

  'expeditious retreat': {
    // Session 20 bulk: 1-level transmutation, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
    bonusAction: true,
  },

  'false life': {
    // Session 20 bulk: 1-level necromancy, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'frost fingers': {
    // Session 20 bulk: 1-level evocation, range 15 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 15,
    damage: { count: 2, sides: 8, bonus: 0, average: 9 },
    damageType: 'cold',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'gift of alacrity': {
    // Session 20 bulk: 1-level divination, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'goodberry': {
    // Session 20 bulk: 1-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'grease': {
    // Session 20 bulk: 1-level conjuration, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: 'dex',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'hail of thorns': {
    // Session 20 bulk: 1-level conjuration, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 1, sides: 10, bonus: 0, average: 6 },
    damageType: 'piercing',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
    bonusAction: true,
  },

  'heroism': {
    // Session 20 bulk: 1-level enchantment, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
  },

  "hunter's mark": {
    // Session 20 bulk: 1-level divination, range 90 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 90,
    damage: { count: 1, sides: 6, bonus: 0, average: 4 },
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
    bonusAction: true,
  },

  'ice knife': {
    // Session 20 bulk: 1-level conjuration, range 60 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 60,
    damage: { count: 1, sides: 10, bonus: 0, average: 6 },
    damageType: 'cold',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'inflict wounds': {
    // Session 20 bulk: 1-level necromancy, range 5 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 5,
    damage: { count: 3, sides: 10, bonus: 0, average: 16 },
    damageType: 'necrotic',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  "jim's magic missile": {
    // Session 20 bulk: 1-level evocation, range 120 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 120,
    damage: { count: 2, sides: 4, bonus: 0, average: 5 },
    damageType: 'force',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'jump': {
    // Session 20 bulk: 1-level transmutation, range 5 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'magnify gravity': {
    // Session 20 bulk: 1-level transmutation, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 2, sides: 8, bonus: 0, average: 9 },
    damageType: 'force',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'purify food and drink': {
    // Session 20 bulk: 1-level transmutation, range 10 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 10,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'ray of sickness': {
    // Session 20 bulk: 1-level necromancy, range 60 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 60,
    damage: { count: 2, sides: 8, bonus: 0, average: 9 },
    damageType: 'poison',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'sanctuary': {
    // Session 20 bulk: 1-level abjuration, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
    bonusAction: true,
  },

  'searing smite': {
    // Session 20 bulk: 1-level evocation, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 1, sides: 6, bonus: 0, average: 4 },
    damageType: 'fire',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
    bonusAction: true,
  },

  'silent image': {
    // Session 20 bulk: 1-level illusion, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
  },

  'snare': {
    // Session 20 bulk: 1-level abjuration, range 5 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 5,
    damage: null,
    damageType: null,
    saveAbility: 'dex',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'speak with animals': {
    // Session 20 bulk: 1-level divination, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'spellfire flare': {
    // Session 20 bulk: 1-level evocation, range 60 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 60,
    damage: { count: 2, sides: 10, bonus: 0, average: 11 },
    damageType: 'radiant',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  "tasha's caustic brew": {
    // Session 20 bulk: 1-level evocation, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: { count: 2, sides: 4, bonus: 0, average: 5 },
    damageType: 'acid',
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
  },

  "tasha's hideous laughter": {
    // Session 20 bulk: 1-level enchantment, range 30 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
  },

  "tenser's floating disk": {
    // Session 20 bulk: 1-level conjuration, range 30 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 30,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'thunderous smite': {
    // Session 20 bulk: 1-level evocation, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 2, sides: 6, bonus: 0, average: 7 },
    damageType: 'thunder',
    saveAbility: 'str',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
    bonusAction: true,
  },

  'unseen servant': {
    // Session 20 bulk: 1-level conjuration, range 60 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 60,
    damage: null,
    damageType: null,
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'wardaway': {
    // Session 20 bulk: 1-level abjuration, range 60 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 2, sides: 4, bonus: 0, average: 5 },
    damageType: 'force',
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
  },

  'witch bolt': {
    // Session 20 bulk: 1-level evocation, range 30 ft, forward-compat flag.
    attackType: 'spell',
    rangeNormal: 30,
    damage: { count: 1, sides: 12, bonus: 0, average: 6 },
    damageType: 'lightning',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
  },

  'wrathful smite': {
    // Session 20 bulk: 1-level evocation, range 0 ft, forward-compat flag.
    attackType: 'save',
    rangeNormal: 0,
    damage: { count: 1, sides: 6, bonus: 0, average: 4 },
    damageType: 'psychic',
    saveAbility: 'wis',
    isAoE: true,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
    bonusAction: true,
  },

  'zephyr strike': {
    // Session 20 bulk: 1-level transmutation, range 0 ft, forward-compat flag.
    attackType: null,
    rangeNormal: 0,
    damage: { count: 1, sides: 8, bonus: 0, average: 4 },
    damageType: 'force',
    saveAbility: undefined,
    isAoE: false,
    isControl: false,
    requiresConcentration: true,
    slotLevel: 1,
    bonusAction: true,
  },

  // ---- Combat Cantrips (slotLevel: 0) --------------------------
  // Added in Session 41 to support the cantrip pipeline in pcToCombatant
  // (Task #15 from Session 40 handover). Previously, cantrips only worked
  // if they were duplicated in the weapons array (as pc_stat_blocks_lv1.json
  // does for level-1 PCs). With these entries, cantrips in
  // spellcasting.cantrips are now converted to Actions automatically.
  //
  // Damage values below are the BASE cantrip damage (1st-level caster);
  // the AI planner / parser is expected to scale at 5/11/17. slotLevel: 0
  // means the action never consumes a spell slot (the AI slot-gate skips
  // slotLevel > 0 spells when out of slots, so cantrips always pass).
  //
  // Riders (slow on Ray of Frost, pull on Thorn Whip, prone on Sapping
  // Sting, etc.) are NOT modeled here — they're applied by the per-cantrip
  // engine modules (e.g. src/spells/ray_of_frost.ts) which fire from
  // CANTRIP_EFFECTS in src/engine/cantrip_effects.ts. The SPELL_DB entry
  // just provides the basic attack/save/damage template.

  'fire bolt': {
    // Ranged spell attack, 120 ft, 1d10 fire. No rider.
    attackType: 'spell',
    rangeNormal: 120,
    damage: { count: 1, sides: 10, bonus: 0, average: avg(1, 10, 0) },
    damageType: 'fire',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'eldritch blast': {
    // Ranged spell attack, 120 ft, 1d10 force. Riders (Repelling Blast,
    // Agonizing Blast, Grasp of Hadar, Lance of Lethargy) fire from
    // _invocations.ts based on the attacker's eldritchInvocations list.
    // Session 80: noCantripScaling=true — EB scales by adding MORE BEAMS
    // (not bigger dice). Each beam stays 1d10; the attackCount pattern
    // in the planner sets beam count from cantripTier() + 1.
    attackType: 'spell',
    rangeNormal: 120,
    damage: { count: 1, sides: 10, bonus: 0, average: avg(1, 10, 0) },
    damageType: 'force',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    noCantripScaling: true,
  },

  'ray of frost': {
    // Ranged spell attack, 60 ft, 1d8 cold. Rider: -10 ft speed (in cantrip_effects.ts).
    attackType: 'spell',
    rangeNormal: 60,
    damage: { count: 1, sides: 8, bonus: 0, average: avg(1, 8, 0) },
    damageType: 'cold',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'sacred flame': {
    // No attack roll, DEX save, 60 ft, 1d8 radiant. No rider.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 1, sides: 8, bonus: 0, average: avg(1, 8, 0) },
    damageType: 'radiant',
    saveAbility: 'dex',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'vicious mockery': {
    // No attack roll, WIS save, 60 ft, 1d4 psychic. Rider: disadvantage on
    // target's next attack roll (in cantrip_effects.ts).
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 1, sides: 4, bonus: 0, average: avg(1, 4, 0) },
    damageType: 'psychic',
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'poison spray': {
    // No attack roll, CON save, 10 ft, 1d12 poison. No rider.
    attackType: 'save',
    rangeNormal: 10,
    damage: { count: 1, sides: 12, bonus: 0, average: avg(1, 12, 0) },
    damageType: 'poison',
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'chill touch': {
    // Ranged spell attack, 120 ft, 1d8 necrotic. Rider: target can't
    // regain HP (in cantrip_effects.ts).
    attackType: 'spell',
    rangeNormal: 120,
    damage: { count: 1, sides: 8, bonus: 0, average: avg(1, 8, 0) },
    damageType: 'necrotic',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'toll the dead': {
    // No attack roll, WIS save, 60 ft, 1d8 necrotic (or 1d12 if target
    // missing HP). v1 simplification: always 1d8 — the planner can't see
    // current HP to decide which die to use; the cantrip_effects engine
    // module handles the actual roll.
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 1, sides: 8, bonus: 0, average: avg(1, 8, 0) },
    damageType: 'necrotic',
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'produce flame': {
    // Ranged spell attack, 30 ft, 1d8 fire. No rider.
    attackType: 'spell',
    rangeNormal: 30,
    damage: { count: 1, sides: 8, bonus: 0, average: avg(1, 8, 0) },
    damageType: 'fire',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'thorn whip': {
    // Melee spell attack, 30 ft, 1d6 piercing. Rider: pull target up to
    // 10 ft (in cantrip_effects.ts).
    attackType: 'spell',
    rangeNormal: 30,
    damage: { count: 1, sides: 6, bonus: 0, average: avg(1, 6, 0) },
    damageType: 'piercing',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'acid splash': {
    // No attack roll, DEX save, 60 ft, 1d6 acid. v1 simplification: single
    // target only (PHB allows up to 2 creatures within 5 ft of each other).
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 1, sides: 6, bonus: 0, average: avg(1, 6, 0) },
    damageType: 'acid',
    saveAbility: 'dex',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'thunderclap': {
    // No attack roll, CON save, 5 ft self-centered AoE, 1d6 thunder.
    attackType: 'save',
    rangeNormal: 5,
    damage: { count: 1, sides: 6, bonus: 0, average: avg(1, 6, 0) },
    damageType: 'thunder',
    saveAbility: 'con',
    isAoE: true,
    aoeRadius: 5,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'sword burst': {
    // No attack roll, STR save, 5 ft self-centered AoE, 1d6 force.
    attackType: 'save',
    rangeNormal: 5,
    damage: { count: 1, sides: 6, bonus: 0, average: avg(1, 6, 0) },
    damageType: 'force',
    saveAbility: 'str',
    isAoE: true,
    aoeRadius: 5,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'lightning lure': {
    // No attack roll, DEX save, 30 ft, 1d8 lightning. Rider: pull target
    // 10 ft (in cantrip_effects.ts).
    attackType: 'save',
    rangeNormal: 30,
    damage: { count: 1, sides: 8, bonus: 0, average: avg(1, 8, 0) },
    damageType: 'lightning',
    saveAbility: 'dex',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'infestation': {
    // No attack roll, CON save, 30 ft, 1d6 poison. Rider: target moves 5 ft
    // in random direction (in cantrip_effects.ts).
    attackType: 'save',
    rangeNormal: 30,
    damage: { count: 1, sides: 6, bonus: 0, average: avg(1, 6, 0) },
    damageType: 'poison',
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'mind sliver': {
    // No attack roll, INT save, 60 ft, 1d6 psychic. Rider: -1d4 to target's
    // next save (in cantrip_effects.ts).
    attackType: 'save',
    rangeNormal: 60,
    damage: { count: 1, sides: 6, bonus: 0, average: avg(1, 6, 0) },
    damageType: 'psychic',
    saveAbility: 'int',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'primal savagery': {
    // Melee spell attack, 5 ft touch, 1d10 acid. No rider.
    attackType: 'spell',
    rangeNormal: 5,
    damage: { count: 1, sides: 10, bonus: 0, average: avg(1, 10, 0) },
    damageType: 'acid',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'shocking grasp': {
    // Melee spell attack, 5 ft touch, 1d8 lightning. Rider: target can't
    // take reactions (in cantrip_effects.ts).
    attackType: 'spell',
    rangeNormal: 5,
    damage: { count: 1, sides: 8, bonus: 0, average: avg(1, 8, 0) },
    damageType: 'lightning',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'sapping sting': {
    // No attack roll, CON save, 30 ft, 1d6 necrotic. Rider: knock target
    // prone (in cantrip_effects.ts).
    attackType: 'save',
    rangeNormal: 30,
    damage: { count: 1, sides: 6, bonus: 0, average: avg(1, 6, 0) },
    damageType: 'necrotic',
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  'create bonfire': {
    // No attack roll, DEX save, 5 ft (creates a 5-ft cube bonfire), 1d8 fire.
    // v1 simplification: single-target model (the actual bonfire is a
    // persistent area; the cantrip_effects engine module handles that).
    attackType: 'save',
    rangeNormal: 5,
    damage: { count: 1, sides: 8, bonus: 0, average: avg(1, 8, 0) },
    damageType: 'fire',
    saveAbility: 'dex',
    isAoE: true,
    aoeRadius: 5,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
  },

  // ── Out-of-combat utility spells ─────────────────────────────────────────
  //
  // These spells have NO mechanical effect during a v1 combat encounter.
  // They appear in 945 monster spellcasting lists parsed in Session 60
  // (Batch 5b step 1).  They are registered here so that the Batch 5b step 2
  // engine integration (monster spell selection) can look them up, see
  // outOfCombat=true, and skip them rather than throwing a "spell not found"
  // warning.
  //
  // The AI planner already ignores spells with no bespoke shouldCast module;
  // outOfCombat=true is a belt-and-suspenders guard for direct SPELL_DB lookup.
  //
  // Source: PHB 2014 (all 10 spells). requiresConcentration matches canon.

  'detect magic': {
    // 1st-level divination (ritual). Sense magic within 30 ft.  Canon: conc, 10 min.
    attackType: null, rangeNormal: 0, damage: null, damageType: null,
    isAoE: false, isControl: false, requiresConcentration: true, slotLevel: 1,
    outOfCombat: true,
  },

  'comprehend languages': {
    // 1st-level divination (ritual). Understand spoken/written language. 1 hr.
    attackType: null, rangeNormal: 0, damage: null, damageType: null,
    isAoE: false, isControl: false, requiresConcentration: false, slotLevel: 1,
    outOfCombat: true,
  },

  'identify': {
    // 1st-level divination (ritual). Touch. Learn properties of a magic item.
    attackType: null, rangeNormal: 5, damage: null, damageType: null,
    isAoE: false, isControl: false, requiresConcentration: false, slotLevel: 1,
    outOfCombat: true,
  },

  'locate object': {
    // 2nd-level divination. Self. Sense direction to an object within 1,000 ft.
    // Canon: concentration, 10 min.
    attackType: null, rangeNormal: 0, damage: null, damageType: null,
    isAoE: false, isControl: false, requiresConcentration: true, slotLevel: 2,
    outOfCombat: true,
  },

  'clairvoyance': {
    // 3rd-level divination. Range 1 mile. Invisible sensor — see/hear. Conc, 10 min.
    attackType: null, rangeNormal: 5280, damage: null, damageType: null,
    isAoE: false, isControl: false, requiresConcentration: true, slotLevel: 3,
    outOfCombat: true,
  },

  'sending': {
    // 3rd-level evocation. Range unlimited. 25-word telepathic message, 1 reply.
    attackType: null, rangeNormal: 5280, damage: null, damageType: null,
    isAoE: false, isControl: false, requiresConcentration: false, slotLevel: 3,
    outOfCombat: true,
  },

  'tongues': {
    // 3rd-level divination. Touch. Understand any spoken language. 1 hr.
    attackType: null, rangeNormal: 5, damage: null, damageType: null,
    isAoE: false, isControl: false, requiresConcentration: false, slotLevel: 3,
    outOfCombat: true,
  },

  'water breathing': {
    // 3rd-level transmutation (ritual). Range 30 ft. Up to 10 creatures. 24 hr.
    attackType: null, rangeNormal: 30, damage: null, damageType: null,
    isAoE: false, isControl: false, requiresConcentration: false, slotLevel: 3,
    outOfCombat: true,
  },

  'divination': {
    // 4th-level divination (ritual). Self. Receive an omen about a course of action.
    attackType: null, rangeNormal: 0, damage: null, damageType: null,
    isAoE: false, isControl: false, requiresConcentration: false, slotLevel: 4,
    outOfCombat: true,
  },

  'locate creature': {
    // 4th-level divination. Self. Sense direction to a creature within 1,000 ft.
    // Canon: concentration, 1 hr.
    attackType: null, rangeNormal: 0, damage: null, damageType: null,
    isAoE: false, isControl: false, requiresConcentration: true, slotLevel: 4,
    outOfCombat: true,
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
