// ============================================================
// D&D 5e Combat Sim — Core Types
// Ruleset: PHB 2014, MM 2014, SAC v2.7, Tasha's 2020
// Grid: Chebyshev 3D (all diagonals = 5ft)
// ============================================================

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type DamageType =
  | 'acid' | 'bludgeoning' | 'cold' | 'fire' | 'force'
  | 'lightning' | 'necrotic' | 'piercing' | 'poison'
  | 'psychic' | 'radiant' | 'slashing' | 'thunder';

export type Condition =
  | 'blinded' | 'charmed' | 'deafened' | 'frightened'
  | 'grappled' | 'hidden' | 'incapacitated' | 'invisible' | 'paralyzed'
  | 'petrified' | 'poisoned' | 'prone' | 'restrained'
  | 'sleeping'   // PHB p.276 — Sleep spell; wakes on any damage or action to rouse
  | 'stunned' | 'unconscious';

// PHB p.6 / MM p.6 — creature size categories
// Used for grapple/shove size enforcement (PHB p.195)
export type CreatureSize = 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge' | 'Gargantuan';

export type AbilityScore = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export type AttackType = 'melee' | 'ranged' | 'spell' | 'save' | 'special';

export type AICostType = 'action' | 'bonusAction' | 'legendaryAction' | 'reaction';

// ---- Advantage / Disadvantage System (PHB p.173) -----------

/**
 * Identifies which d20 test an advantage/disadvantage entry applies to.
 * General scopes ('attack') cover all sub-types ('attack:melee').
 * Specific scopes ('attack:melee') do NOT implicitly cover the general 'attack' scope.
 * 'all' covers every d20 test.
 */
export type D20TestScope =
  | 'attack'                                               // any attack roll
  | 'attack:melee' | 'attack:ranged' | 'attack:spell'     // specific attack types
  | 'save'                                                 // any saving throw
  | 'save:str' | 'save:dex' | 'save:con'
  | 'save:int' | 'save:wis' | 'save:cha'
  | 'ability'                                              // any ability check
  | 'ability:str' | 'ability:dex' | 'ability:con'
  | 'ability:int' | 'ability:wis' | 'ability:cha'
  | 'initiative'                                           // initiative rolls
  | 'perception'                                           // passive perception (±5 modifier)
  | 'all';                                                 // every d20 test

/**
 * Duration model for advantage/disadvantage entries.
 *   'permanent'       never expires; must be removed via removeBySource()
 *   'until_next_turn' expires at the START of this creature's next turn
 *   'rounds'          expires after roundsRemaining turns reach 0
 */
export type AdvDurationType = 'permanent' | 'until_next_turn' | 'rounds';

/**
 * One advantage or disadvantage grant on a creature.
 *
 * Refresh rule: if a new entry has the same { type, scope } as an existing one,
 * only the entry with the LONGER roundsRemaining is kept (no stacking).
 */
export interface AdvantageEntry {
  type:             'advantage' | 'disadvantage';
  scope:            D20TestScope;
  source:           string;           // human-readable label e.g. "Reckless Attack", "Dodge"
  durationType:     AdvDurationType;
  roundsRemaining:  number;           // permanent → Infinity; until_next_turn → 1; rounds → N
}

// ---- Active Spell Effects -----------------------------------
// Tracks ongoing effects placed on a Combatant by a spell.
// Effects are applied when a spell is cast and removed when:
//   - the caster's concentration breaks (sourceIsConcentration: true), or
//   - the spell ends naturally (removeEffectById called explicitly), or
//   - the caster dies / goes to 0 HP.
//
// Advantage/disadvantage effects (advantage_vs) mirror an entry in
// Combatant.vulnerabilities via adv_system.grantVulnerability; removing
// this effect also calls adv_system.removeBySource so both stay in sync.

export type SpellEffectType =
  | 'advantage_vs'      // rolls AGAINST this creature get adv/disadv (e.g. Faerie Fire)
  | 'ac_bonus'          // flat AC bonus to this creature (e.g. Shield of Faith +2)
  | 'bless_die'         // add a bonus die to this creature's attack rolls & saves (Bless 1d4)
  | 'condition_apply'   // apply a condition to this creature (e.g. Entangle → restrained)
  | 'hex_damage';       // +1d6 necrotic on each hit by the caster (Hex PHB p.251)

export interface ActiveEffect {
  id: string;               // unique per instance, e.g. 'eff_1'
  casterId: string;         // ID of the Combatant who cast the spell
  spellName: string;        // canonical spell name; also used as adv_system source label
  effectType: SpellEffectType;
  payload: {
    // advantage_vs
    advType?:  'advantage' | 'disadvantage';
    advScope?: D20TestScope;
    // ac_bonus
    acBonus?:  number;
    // bless_die
    dieSides?: number;                // e.g. 4 for a d4
    // condition_apply
    condition?: Condition;
    // hex_damage
    hexDie?: number;   // always 6 (d6); stored for extensibility
  };
  sourceIsConcentration: boolean;     // if true, removed when caster's concentration ends
}

// ---- Action -------------------------------------------------

export interface DiceExpression {
  count: number;
  sides: number;
  bonus: number;       // flat bonus/penalty
  average: number;     // pre-computed for AI scoring
}

export interface Action {
  name: string;
  isMultiattack: boolean;
  attackType: AttackType | null;
  reach: number;                          // ft, default 5
  range: { normal: number; long: number } | null;
  hitBonus: number | null;
  damage: DiceExpression | null;
  damageType: DamageType | null;
  saveDC: number | null;
  saveAbility: AbilityScore | null;
  isAoE: boolean;
  isControl: boolean;                     // grapple/restrain/stun/fear/etc.
  requiresConcentration: boolean;         // casting this replaces/starts concentration
  slotLevel?: number;                     // 0 = cantrip (free), 1+ = spell slot level required
  costType: AICostType;
  legendaryCost: number;
  description: string;
  /**
   * Bypasses cover for this action's saving throw (PHB p.272 Sacred Flame:
   * "The target gains no benefit from cover for this saving throw.").
   *
   * When true, resolveAttack's save branch skips the LOS / total-cover
   * gating entirely — Sacred Flame can target a creature even behind total
   * cover. Other save spells (default undefined/false) are subject to total
   * cover blocking per PHB line-of-effect rules.
   */
  bypassesCover?: boolean;
}

// ---- LegendaryAction ----------------------------------------

export interface LegendaryAction {
  name: string;
  cost: number;
  action: Action | null;                  // null for detect/move type
  description: string;
}

// ---- ActionBudget -------------------------------------------

export interface ActionBudget {
  movementFt: number;                     // remaining ft this turn
  actionUsed: boolean;
  bonusActionUsed: boolean;
  reactionUsed: boolean;
  freeObjectUsed: boolean;
}

// ---- Perception Memory --------------------------------------

export interface TargetKnowledge {
  lastSeenPos: Vec3;
  visibleArmorType: 'none' | 'light' | 'medium' | 'heavy' | 'natural';
  hasShield: boolean;
  isBloodied: boolean;                    // observed < 50% HP
  castAoEThisCombat: boolean;
  receivedHealingThisCombat: boolean;
  isFlying: boolean;
  isRanged: boolean;
  hasMeleeWeapon: boolean;
  // concentrationSpellActive: always false for non-psychic (never set here)
  // spellSlotsRemaining: always -1 (unknowable)
}

export interface PerceptionMemory {
  targets: Map<string, TargetKnowledge>;
}


// ---- Player Resources (level 1) ----------------------------
// Tracked per-combatant for PCs. Null for monsters.

export interface SpellSlots {
  [level: number]: { max: number; remaining: number };
}

export interface PlayerResources {
  // Spellcasters
  spellSlots?:         SpellSlots;
  pactSlots?:          { max: number; remaining: number; slotLevel: number; recoversOn: 'short' | 'long' };

  // Barbarian
  rage?:               { max: number; remaining: number; active: boolean; roundsRemaining: number };

  // Fighter
  secondWind?:         { max: number; remaining: number };   // bonus action, short rest

  // Bard
  bardicInspiration?:  { max: number; remaining: number; die: string };  // bonus action, long rest

  // Paladin
  layOnHands?:         { pool: number; remaining: number };   // action
  divineSmite?:        boolean;                               // flag: uses spell slots

  // Rogue
  sneakAttackDice?:    string;                               // e.g. "1d6"
  cunningAction?:      boolean;                              // Level 2+: Dash/Disengage/Hide as bonus action

  // Wizard
  arcaneRecovery?:     { usesRemaining: number };             // 1/day, short rest

  // Warlock Dark One's Blessing temp HP on kill
  darkOnesBlessing?:   { amount: number };

  // Warding Bond (PHB p.287): Cleric/Paladin 2nd-level spell.
  // Tracked as a dedicated resource (not a spell slot) so level-1 casters can use it
  // in test harnesses without requiring 2nd-level slots.
  // remaining: 1 = can still cast; 0 = bond already active or expended this scene.
  wardingBond?:        { remaining: number };

  // Ammo tracking (4.11) — Ranger arrows, Rogue shortbow
  ammo?: {
    [weaponName: string]: { max: number; remaining: number };
  };                    // CHA mod + level temp HP on kill

  // Hit Dice (PHB p.186) — used during Short Rests to recover HP.
  // max = character level; dieSides = class hit die (d12/d10/d8/d6).
  // Recovered on long rest: up to half max (round up), per PHB p.186.
  // Optional — absent for monsters and legacy test combatants.
  hitDice?: { max: number; remaining: number; dieSides: number };
}

// ---- Combatant ----------------------------------------------

export type AIProfile = 'attackNearest' | 'attackWeakest' | 'smart' | 'defend';
// 'defend': creature only retaliates if directly adjacent — never pursues.
// Assigned explicitly at spawn for creatures like Giant Fly (magic item mount).
// NOT based on INT score; a low-INT predator like a T-Rex uses 'attackNearest'.

export interface Combatant {
  // Identity
  id: string;
  name: string;
  isPlayer: boolean;
  faction: 'party' | 'enemy' | 'neutral';

  // Stats
  maxHP: number;
  currentHP: number;
  ac: number;
  speed: number;                          // ground ft/turn
  flySpeed: number | null;
  swimSpeed: number | null;
  burrowSpeed: number | null;
  str: number; dex: number; con: number;
  int: number; wis: number; cha: number;
  cr: number | null;                      // null for PCs

  // Position (grid squares; 1 square = 5ft)
  pos: Vec3;

  // Actions
  actions: Action[];
  traits: string[];                       // trait names, for Pack Tactics etc.
  legendaryActions: LegendaryAction[];
  legendaryActionPool: number;            // resets at start of own turn
  legendaryActionPoolMax: number;

  // Turn resources
  budget: ActionBudget;

  // Conditions
  conditions: Set<Condition>;

  // AI
  aiProfile: AIProfile;
  perception: PerceptionMemory;

  // Concentration (PHB p.203)
  // A caster can hold only one concentration spell at a time.
  // Non-psychic creatures cannot detect whether a target is concentrating.
  concentration: {
    active: boolean;
    spellName: string | null;    // name of the held spell
    dcIfHit: number;             // current DC (max(10, half last damage)
  } | null;

  // Death saving throws (PHB p.197) — PCs only
  // Monsters die outright at 0 HP; PCs fall unconscious and roll saves.
  deathSaves: {
    successes: number;           // 0–3: 3 successes = stable
    failures:  number;           // 0–3: 3 failures  = dead
  } | null;                      // null for non-PC combatants

  // Class resources (PCs only — null for monsters)
  resources: PlayerResources | null;

  // Temporary HP (absorbs damage before real HP)
  tempHP: number;

  // Mount state (PHB p.198)
  // A combatant can be a controlled mount OR a rider — never both simultaneously.
  mountedOn: string | null;    // ID of the mount this rider is on
  carriedBy: string | null;    // ID of the rider currently mounted on this creature
  //
  // independentMount: when true, the mount acts on its OWN initiative and can attack.
  //   The rider must explicitly grant independence (rare — trained war animals).
  //   Default false: controlled mount — can only Dash, Disengage, or Dodge.
  //   PHB p.198: "A controlled mount can take only the Dash, Disengage, or Dodge action."
  independentMount: boolean;   // false = controlled (default); true = acts independently

  // Familiar / companion bonding
  role: 'familiar' | 'mount' | 'companion' | 'regular';  // creature type/role
  bonded: string | null;       // ID of bonded caster (for familiars) or bonded companion owner

  // Per-turn flags (reset by engine at start of each turn)
  usedSneakAttackThisTurn: boolean;  // Rogue: once per turn only
  helpedThisTurn: boolean;     // Familiar/ally used Help action this turn; grants advantage to next attack

  // Combat capability flags
  //
  // isDefender: creature is in "defender" mode — may only Dash, Dodge, or Hide.
  //   Never attacks. Set via UI or creature config. Examples: pack animals, non-combatants.
  //   If all living creatures on a team are defenders (or cannotAttack), team is auto-defeated.
  isDefender: boolean;
  //
  // cannotAttack: statblock explicitly prohibits attacking (e.g. some familiars, pacifist NPCs).
  //   Distinct from isDefender — cannot be overridden by the user.
  cannotAttack: boolean;
  //
  // hasHands: creature has hands or tentacles → can use improvised weapon (1d4 + STR mod, no prof).
  //   Creatures without hands still get unarmed strike (1 + STR mod) as fallback.
  //   Auto-detected by parser; can be set manually.
  hasHands: boolean;

  // wearingArmor: false = unarmored — Mage Armor eligible if also no Unarmored Defense.
  // Set by pc.ts (from acFormula) and fivetools.ts (from armor data).
  // Defaults to false for monsters (natural armor != worn armor).
  wearingArmor: boolean;

  // Creature size (PHB p.6). Optional — defaults to 'Medium' in all size-check helpers.
  // Used for grapple/shove enforcement (can't target a creature > 1 size larger, PHB p.195).
  size?: CreatureSize;

  // If this creature has the 'grappled' condition, grappledBy holds the ID of the grappler.
  // Cleared when 'grappled' is removed. Used by AI to plan escapeGrapple.
  grappledBy?: string;

  // Flags
  isDead: boolean;
  isUnconscious: boolean;

  // Advantage / Disadvantage entries (PHB p.173)
  // 'advantages'     : this creature's OWN d20 rolls (attack, save, ability, initiative)
  // 'vulnerabilities': d20 rolls made AGAINST this creature (Dodge → attacks vs you have disadv;
  //                    Reckless Attack → enemies have adv vs the Barbarian)
  // Both arrays are ticked at the start of this creature's turn via tickAdvantages().
  advantages:      AdvantageEntry[];
  vulnerabilities: AdvantageEntry[];

  // Damage resistances (PHB p.197): incoming damage of listed types is halved.
  // Populated by class features (Rage → B/P/S), racial traits, spells (Stoneskin), etc.
  // Use addResistance() / removeResistance() helpers to avoid duplicates.
  resistances: DamageType[];

  // Bardic Inspiration die granted by a Bard (PHB p.54).
  // Die size (e.g. 6 for d6). Consumed on the next attack roll or saving throw.
  // null = no inspiration die held.
  bardicInspirationDie: number | null;

  // Warding Bond (PHB p.287): if non-null, this creature is the bonded target.
  // The caster identified by casterId takes the same damage whenever this creature does.
  // Grants +1 AC, +1 to saving throws, and resistance to all damage types.
  // Bond breaks when caster drops to 0 HP.  null = no bond active.
  wardingBond: { casterId: string } | null;

  // Active spell effects currently applied to this creature.
  // Managed by src/engine/spell_effects.ts — use applySpellEffect / removeEffectsFromCaster
  // rather than mutating this array directly.
  activeEffects: ActiveEffect[];

  // ---- Cantrip internal scratch fields ----------------------
  // These are transient flags/values set by cantrip modules in src/spells/ and
  // cleared by each module's cleanup() called from resetBudget() in utils.ts.
  // They are optional (undefined = effect not active) and never persisted.
  //
  // Ray of Frost (PHB p.271): speed reduction scratch state.
  _rayOfFrostOriginalSpeed?: number;
  _hasRayOfFrost?: boolean;

  // ---- Armor material (for cantrips like Shocking Grasp, PHB p.275) ----
  // True when the creature wears metal armor (chain shirt, scale mail, breastplate,
  // half plate, ring mail, chain mail, splint, plate). Optional — undefined is
  // treated as "no metal armor". Populated by the parser when armor data is
  // available; tests may set it directly.
  hasMetalArmor?: boolean;

  // ---- Creature type flag (for cantrips like Chill Touch, PHB p.221) ----
  // True when the creature is Undead. Optional — undefined is treated as "not
  // undead". Populated by the parser from the monster `type` field when armor
  // data is available (parser tech debt, same pattern as hasMetalArmor); tests
  // may set it directly.
  isUndead?: boolean;

  // ---- Chill Touch (PHB p.221) scratch fields ----
  // Set on the TARGET by Chill Touch's post-hit rider. Cleared by each module's
  // cleanup() called from resetBudget() in utils.ts.
  //
  // _chillTouchNoHealing: target cannot regain hit points until the start of
  //   the caster's next turn (PHB p.221). applyHeal() in utils.ts checks this.
  // _chillTouchDisadvVs:  if the target is undead, holds the ID of the caster
  //   against whom the undead has disadvantage on attack rolls until the end of
  //   the caster's next turn (PHB p.221). resolveAttack() in combat.ts checks
  //   this when the undead is the attacker and the caster is the target.
  _chillTouchNoHealing?: boolean;
  _chillTouchDisadvVs?: string;

  // ---- Blade Ward (PHB p.218) scratch field ----
  // Set on the CASTER when it casts Blade Ward (self-buff cantrip). While true,
  // incoming bludgeoning/piercing/slashing damage is halved (PHB p.197
  // resistance, rounded down) — applied in applyDamageWithTempHP() so it
  // composes correctly with other resistances and never double-halves.
  // Cleared by cleanup() called from resetBudget() in utils.ts.
  _bladeWardActive?: boolean;

  // ---- Vicious Mockery (PHB p.285) scratch field ----
  // Set on the TARGET when it fails its WIS save against Vicious Mockery
  // (post-hit rider dispatched from CANTRIP_EFFECTS). The target has
  // disadvantage on the NEXT attack roll it makes before the end of its
  // next turn (PHB p.285). resolveAttack() in combat.ts folds this into
  // the attack's `disadvantage` boolean when the marked creature is the
  // attacker, then CONSUMES the flag (sets it back to false) after the
  // attack roll resolves — hit or miss. This is a one-shot debuff
  // (distinct from Chill Touch's ongoing undead-disadv, which lasts the
  // whole turn). If not consumed by end of the target's next turn,
  // cleanup() called from resetBudget() clears it.
  _viciousMockeryDisadvNextAttack?: boolean;

  // ---- Mind Sliver (TCE p.108) scratch field ----
  // Set on the TARGET when it fails its INT save against Mind Sliver
  // (post-save-FAIL rider dispatched from CANTRIP_EFFECTS). The target
  // subtracts 1d4 from the NEXT saving throw it makes before the end of
  // the caster's next turn (TCE p.108). rollSave() in utils.ts folds
  // this into the save total (subtracts rollDie(value)) and CONSUMES the
  // flag (sets to undefined) after the save resolves — success or failure.
  // This is a one-shot save debuff (analogous to Vicious Mockery's one-shot
  // attack debuff, but for saves; the choke point is rollSave, not
  // resolveAttack's attack-roll branch). The stored value is the die size
  // (4 = d4) so the system is extensible to other die penalties.
  // If not consumed by the start of the target's next turn, cleanup()
  // called from resetBudget() clears it (codebase convention — slightly
  // more lenient than PHB's "end of caster's next turn", but consistent
  // with how Vicious Mockery is timed).
  _mindSliverDiePenaltyNextSave?: number;

  // ---- Booming Blade (TCE p.106) scratch fields ----
  // Set on the TARGET when it is hit by Booming Blade (post-hit rider
  // dispatched from CANTRIP_EFFECTS). The target becomes sheathed in
  // booming energy until the start of the caster's next turn. If the
  // target WILLS itself to move 5+ ft before then (i.e. executeMove is
  // called on it — forced movement like Thorn Whip pull / Thunderwave
  // push bypasses executeMove and does NOT trigger this rider), it
  // immediately takes thunder damage equal to the stored dice string
  // (e.g. '1d8') and the spell ends.
  //
  // _boomingBladePendingDamageDice: dice expression to roll on willing
  //   movement (e.g. '1d8', '2d8' at higher levels). Cleared by cleanup()
  //   called from resetBudget() if not triggered by movement before the
  //   start of the target's next turn (codebase convention — slightly
  //   more lenient than PHB's "start of caster's next turn").
  // _boomingBladeCasterId: ID of the caster who applied the rider, used
  //   for log attribution when the rider detonates. Optional.
  _boomingBladePendingDamageDice?: string;
  _boomingBladeCasterId?: string;

  // ---- Frostbite (XGE p.156) scratch field ----
  // Set on the TARGET when it fails its CON save against Frostbite
  // (post-save-FAIL rider dispatched from CANTRIP_EFFECTS). The target
  // has disadvantage on the NEXT WEAPON ATTACK roll it makes before the
  // end of its next turn (XGE p.156). resolveAttack() in combat.ts folds
  // this into the attack's `disadvantage` boolean when the marked
  // creature is the ATTACKER AND `action.attackType === 'melee' ||
  // 'ranged'` (i.e. weapon attacks ONLY — spell attacks are excluded
  // per XGE p.156's "weapon attack roll" wording), then CONSUMES the
  // flag (sets it back to false) after the attack roll resolves — hit
  // or miss. This is a one-shot debuff — distinct from Vicious Mockery,
  // which applies to ALL attack rolls (weapon + spell).
  //
  // If not consumed by end of the target's next turn, cleanup() called
  // from resetBudget() clears it (codebase convention — slightly more
  // lenient than PHB's "end of its next turn", consistent with Vicious
  // Mockery and Mind Sliver timing).
  _frostbiteDisadvNextWeaponAttack?: boolean;

  // ---- Spellcasting ability modifier (for cantrips like Green-Flame Blade) ----
  // The caster's spellcasting ability modifier (INT for Wizard, CHA for
  // Sorcerer/Warlock, WIS for Cleric/Druid). Used by cantrips whose damage
  // scales with the spellcasting modifier (e.g. Green-Flame Blade's splash
  // damage, TCE p.107: "fire damage equal to your spellcasting ability
  // modifier (minimum of 1)").
  //
  // Optional — populated by the parser from the caster's class. Tests set
  // it directly for determinism. Defaults to 3 (typical level-1 caster
  // with 16 in their spellcasting stat) via DEFAULT_SPELLCASTING_MOD in
  // the Green-Flame Blade module when undefined.
  spellcastingMod?: number;

  // ---- Caster level (for cantrips that scale by caster level) ----
  // The caster's character level (1–20). Used by cantrips whose damage
  // scales at 5/11/17 (e.g. Green-Flame Blade's splash damage, TCE p.107:
  // "At 5th level ... 1d8 + your spellcasting ability modifier").
  //
  // Optional — populated by the parser. Tests set it directly for
  // determinism. Defaults to 1 when undefined.
  casterLevel?: number;

  // ---- Shillelagh (PHB p.275) scratch field ----
  // Set on the CASTER when it casts Shillelagh (self-buff cantrip, PHB
  // p.275: "For the duration, you can use your spellcasting ability
  // instead of Strength for the attack and damage rolls of melee attacks
  // using that weapon, and the weapon's damage die becomes a d8. The
  // weapon also becomes magical, if it isn't already.").
  //
  // While `_shillelaghActive === true`, resolveAttack's attack-roll
  // branch — when `action.attackType === 'melee'` — substitutes the
  // caster's WIS modifier for the STR modifier in hitBonus, AND adds
  // +1d8 radiant damage to the damage roll (v1 simplification: the
  // cantrip's effect is modeled as +1d8 radiant, since canonically the
  // weapon damage BECOMES 1d8 but modeling that would require the
  // engine to know which Action is the "club or quarterstaff" — the
  // spell's material component. v1 sidesteps this by adding +1d8
  // radiant on top of the weapon's existing damage dice).
  //
  // v1 simplification: PHB p.275 says the duration is 1 minute (10
  // rounds). v1 treats Shillelagh as a 1-round buff (clears at the
  // start of the caster's next turn via cleanup() called from
  // resetBudget(), mirroring Blade Ward's timing). Documented via the
  // metadata flag `shillelaghDurationV1Simplified: true`. Future work:
  // a persistent-buff subsystem that tracks 1-minute durations.
  //
  // Distinct from Blade Ward (also a self-buff cantrip): Blade Ward
  // grants damage RESISTANCE (read by applyDamageWithTempHP); Shillelagh
  // grants ATTACK-ROLL substitution + BONUS DAMAGE (read by
  // resolveAttack's attack-roll branch). Both live in CANTRIP_SELF_EFFECTS.
  _shillelaghActive?: boolean;

  // ---- True Strike (PHB p.284) scratch field ----
  // Set on the CASTER when it casts True Strike (self-buff cantrip,
  // PHB p.284: "On your next turn, you gain advantage on your first
  // attack roll against the target, provided that this spell hasn't
  // ended."). v1 simplification: target-agnostic (the buff applies to
  // the caster's NEXT attack roll regardless of target — see
  // true_strike.ts header for the v1 simplification details).
  //
  // While `_trueStrikeAdvNextAttack === true`, resolveAttack's attack-
  // roll branch folds this into the `advantage` boolean (mirror
  // Frostbite's `_frostbiteDisadvNextWeaponAttack` but for ADVANTAGE
  // instead of DISADVANTAGE, and NOT restricted by attackType — True
  // Strike applies to ANY attack roll: melee, ranged, AND spell). The
  // buff is consumed (cleared) immediately after the attack roll
  // resolves — one-shot (PHB p.284: "your first attack roll",
  // singular). If not consumed by an attack before the start of the
  // caster's NEXT turn, cleanup() called from resetBudget() clears the
  // flag (v1 1-round simplification).
  //
  // Distinct from Shocking Grasp (the other advantage-granting cantrip):
  // Shocking Grasp grants advantage on the SAME turn (pre-roll, vs metal
  // armor — read by CANTRIP_ATTACK_ADVANTAGE). True Strike grants
  // advantage on a LATER turn's first attack, regardless of target
  // (scratch flag, read by resolveAttack's attack-roll branch).
  //
  // Distinct from Frostbite (the other attack-debuff cantrip): Frostbite
  // imposes DISADVANTAGE on the next WEAPON attack (the flag is set on
  // the TARGET, attack-type-restricted). True Strike grants ADVANTAGE on
  // the next attack of ANY type (the flag is set on the CASTER, no
  // attack-type restriction).
  _trueStrikeAdvNextAttack?: boolean;

  // ---- Resistance (PHB p.272) scratch field ----
  // Set on the CASTER when it casts Resistance (self-buff cantrip,
  // PHB p.272: "Once before the spell ends, the target can roll a d4
  // and add the number rolled to one saving throw of its choice.").
  // v1 simplification: self-only (the caster targets themselves — see
  // resistance.ts header for the v1 simplification details).
  //
  // While `_resistanceDieBonusNextSave` is set (the value is the die
  // size — 4 = d4), rollSave() in utils.ts rolls rollDie(value) and
  // ADDS the result to the save total (mirror Mind Sliver's subtract-
  // 1d4 logic but with the OPPOSITE SIGN), then CONSUMES the flag
  // (sets to undefined) after the save resolves — success or failure.
  // The bonus applies to ANY saving throw the caster makes while the
  // flag is set (str/dex/con/int/wis/cha). If not consumed by a save
  // before the start of the caster's NEXT turn, cleanup() called from
  // resetBudget() clears the flag (v1 1-round simplification).
  //
  // Mirrors Mind Sliver (TCE p.108) — same architecture, opposite sign:
  //   Mind Sliver: _mindSliverDiePenaltyNextSave = 4 (d4)  [debuff on enemy, SUBTRACT]
  //   Resistance:  _resistanceDieBonusNextSave  = 4 (d4)  [buff on self/ally, ADD]
  _resistanceDieBonusNextSave?: number;

  // ---- Guidance (PHB p.248) scratch field ----
  // Set on the CASTER when it casts Guidance (self-buff cantrip,
  // PHB p.248: "Once before the spell ends, the target can roll a d4
  // and add the number rolled to one ability check of its choice.").
  // v1 simplification: self-only (the caster targets themselves — see
  // guidance.ts header for the v1 simplification details).
  //
  // While `_guidanceDieBonusNextAbilityCheck` is set (the value is the
  // die size — 4 = d4), the rollAbilityCheck() choke point in utils.ts
  // (IMPLEMENTED in Session 14) will roll rollDie(value) and ADD the
  // result to the ability-check total (mirror Resistance's save-bonus
  // integration, but for ability checks instead of saves), then CONSUME
  // the flag (sets to undefined). The flag is set on cast by
  // guidance.ts's applySelfEffect and CONSUMED by the next ability
  // check (any ability). If the caster makes no ability check before
  // their next turn, cleanup() called from resetBudget() clears the
  // flag as a safety net (v1 1-round simplification). The metadata
  // flag `guidanceAbilityCheckIntegrationV1Implemented` is now `true`
  // (flipped in Session 14). The remaining v1 simplifications are
  // concentration (1-round vs canon 1-minute concentration) and
  // touch-ally (self-only vs canon any willing creature).
  //
  // Mirrors Resistance (PHB p.272) — same architecture, same die
  // size (4 = d4), same one-shot consume semantics, but for ABILITY
  // CHECKS instead of SAVES:
  //   Resistance: _resistanceDieBonusNextSave        = 4 (d4)  [save bonus, consumed by rollSave]
  //   Guidance:   _guidanceDieBonusNextAbilityCheck  = 4 (d4)  [ability-check bonus, consumed by rollAbilityCheck]
  _guidanceDieBonusNextAbilityCheck?: number;

  // ---- Friends (PHB p.244) scratch field ----
  // Set on the CASTER when it casts Friends (self-buff cantrip,
  // PHB p.244: "For the duration, you have advantage on all Charisma
  // checks directed at one creature of your choice that isn't hostile
  // toward you."). v1 simplification: target-agnostic (the buff
  // applies to the next CHA check regardless of target — see
  // friends.ts header for the v1 simplification details).
  //
  // While `_friendsAdvNextChaCheck === true`, the rollAbilityCheck()
  // choke point in utils.ts (IMPLEMENTED in Session 14) folds this
  // into the advantage boolean for Charisma checks (mirror True
  // Strike's attack-roll advantage integration, but for CHA checks
  // instead of ATTACK rolls), then CONSUMES the flag (set to false).
  // The flag is set on cast by friends.ts's applySelfEffect and
  // CONSUMED by the next CHA check. If the caster makes no CHA check
  // before their next turn, cleanup() called from resetBudget()
  // clears the flag as a safety net (v1 1-round simplification). The
  // metadata flag `friendsAbilityCheckIntegrationV1Implemented` is
  // now `true` (flipped in Session 14). The remaining v1
  // simplifications are concentration (1-round vs canon 1-minute
  // concentration), target-agnostic (next CHA check regardless of
  // target vs canon "directed at one creature"), and hostility-
  // backlash (skipped vs canon hostility-on-end).
  //
  // Mirrors True Strike (PHB p.284) — same architecture, same
  // one-shot consume semantics, but for CHA CHECKS instead of ATTACK
  // rolls:
  //   True Strike: _trueStrikeAdvNextAttack   = true  [attack advantage, consumed by resolveAttack]
  //   Friends:     _friendsAdvNextChaCheck    = true  [CHA-check advantage, consumed by rollAbilityCheck]
  _friendsAdvNextChaCheck?: boolean;

  // ---- Light (PHB p.255) scratch field ----
  // Set on the TARGET when it is touched by Light (touch cantrip,
  // PHB p.255: "the object sheds bright light in a 20-foot radius
  // and dim light for an additional 20 feet"). v1 simplification:
  // the engine's computeLOS does not yet model light-radius-based
  // vision changes (forward-compat TODO via the metadata flag
  // `lightVisionIntegrationV1Implemented: false`). The flag is set
  // for forward-compatibility — the future vision subsystem will
  // read it. v1 still clears the flag at the start of the caster's
  // NEXT turn via cleanup() called from resetBudget() (v1 1-round
  // simplification — canonically the spell lasts 1 hour).
  //
  // Distinct from the other cantrip scratch fields: Light's flag is
  // set on the TARGET (the object/creature shedding light), not the
  // CASTER. This is the same target-set pattern as Spare the Dying's
  // `_isStabilized` flag (also a touch cantrip).
  _lightSourceActive?: boolean;

  // ---- Spare the Dying (PHB p.277) scratch field ----
  // Set on the TARGET when it is touched by Spare the Dying (touch
  // cantrip, PHB p.277: "You touch a living creature that has 0 hit
  // points. The creature becomes stable."). The flag indicates the
  // creature has been stabilized and should no longer make death
  // saving throws (PHB p.197: a stable creature is no longer dying
  // but remains at 0 HP and unconscious).
  //
  // The engine's rollDeathSave() in utils.ts currently checks
  // `pc.isUnconscious && !pc.isDead` to decide whether to roll —
  // future work should also check `_isStabilized` to skip the roll
  // (forward-compat TODO). v1 sets the flag and resets
  // `deathSaves = { successes: 0, failures: 0 }` (mirror
  // rollDeathSave's "stable" outcome — the existing engine reset
  // convention for stable creatures).
  //
  // v1 simplification: PHB p.277 canonically excludes undead and
  // constructs ("This spell has no effect on undead or constructs.").
  // v1 does NOT model the type exclusion (forward-compat TODO via
  // the metadata flag `spareTheDyingTypeExclusionV1Implemented:
  // false`). The handler still fizzles on monsters (PHB p.197:
  // monsters die at 0 HP — Spare the Dying has no effect).
  _isStabilized?: boolean;

  // ---- Mending (PHB p.259) scratch field ----
  // Set on the TARGET when it is touched by Mending (touch cantrip,
  // PHB p.259: "This spell repairs a single break or tear in an object
  // you touch, such as broken chain link, two halves of a broken key,
  // a torn cloak, or a leaking wineskin."). v1 simplification: the
  // engine does NOT yet model an object-state subsystem (no system
  // tracks broken/mended objects — forward-compat TODO via the
  // metadata flag `mendingObjectStateIntegrationV1Implemented: false`,
  // a sibling to Light's `lightVisionIntegrationV1Implemented`). The
  // flag is set for forward-compatibility — the future object-state
  // subsystem will read it. v1 still clears the flag at the start of
  // the caster's NEXT turn via cleanup() called from resetBudget() (v1
  // 1-round simplification — canonically the spell is INSTANT, but the
  // engine treats Mending as a 1-action spell for v1 simplicity, and
  // the cleanup is defensive).
  //
  // CANON CASTING TIME: 1 MINUTE (PHB p.259 — "time":[{"number":1,
  // "unit":"minute"}] per the 5etools JSON). This is the FIRST cantrip
  // with a non-action casting time (1 min = 10 rounds = out-of-combat
  // only per PHB p.192 casting-time rules). v1 simplification: the
  // engine treats Mending as a standard ACTION for engine simplicity
  // (canon: 1 min; v1: 1 action) — documented via the metadata flag
  // `mendingCastingTimeV1Simplified: true`. The cleanup's 1-round
  // window is therefore a v1 artifact (canonically the spell is
  // instant, so there's nothing to clean up — but v1 clears the
  // forward-compat flag defensively to match the other touch cantrip
  // patterns).
  //
  // Distinct from the other cantrip scratch fields: Mending's flag is
  // set on the TARGET (the object being repaired), not the CASTER.
  // This is the same target-set pattern as Light's `_lightSourceActive`
  // flag and Spare the Dying's `_isStabilized` flag (also touch
  // cantrips).
  _mended?: boolean;
}

// ---- Obstacle -----------------------------------------------
// PHB Ch.10, DMG Ch.8: static map obstacles for LOS and cover.
// All coordinates are in grid squares (1 GS = 5 ft).
//
//   blocksMovement: true  → physical line of effect blocked (wall, pillar, closed door)
//                           determines cover category (+2 / +5 AC) and total cover
//   blocksVision:   true  → visual line of sight blocked (fog cloud, curtain, magical darkness)
//                           attacks against obscured targets have Disadvantage
//   isOpen:         true  → bypasses BOTH flags (open door, open window, portcullis up)

export interface Obstacle {
  id: string;
  x: number;        // grid square of left edge
  y: number;        // grid square of top edge
  z: number;        // reserved for future 3D — use 0 for flat encounters
  width: number;    // extent on X axis (grid squares)
  depth: number;    // extent on Y axis (grid squares)
  height: number;   // reserved for future 3D — use 1 for flat encounters
  blocksMovement: boolean;
  blocksVision: boolean;
  isOpen?: boolean;
}

// ---- Battlefield --------------------------------------------

export type TerrainType = 'normal' | 'difficult' | 'water';

export interface Cell {
  terrain: TerrainType;
  elevation: number;                      // ft above ground floor
}

export interface Battlefield {
  width: number;                          // grid squares
  height: number;
  depth: number;                          // Z levels
  cells: Cell[][][];                      // [x][y][z]
  combatants: Map<string, Combatant>;
  round: number;
  initiativeOrder: string[];              // combatant IDs in init order
  // 4.12: Command hook — keyed by minion ID, value is profile to apply this turn
  // Set by a controller before the minion's turn. No action cost per RAW.
  pendingCommands?: Map<string, AIProfile>;
  // No-damage tracking: consecutive rounds each team dealt 0 damage.
  // Reset to 0 whenever a team deals ≥1 damage in a round.
  // At 10 consecutive rounds → team is auto-defeated.
  noDamageRounds?: Map<string, number>;   // keyed by faction
  // LOS/Cover: static obstacles on the map (walls, pillars, doors, fog, etc.)
  // Optional — absent means open terrain (no cover calculations).
  obstacles?: Obstacle[];
}

// ---- TurnPlan (output of AI) --------------------------------

export interface TurnPlan {
  combatantId: string;
  targetId: string | null;
  action: PlannedAction | null;
  bonusAction: PlannedAction | null;
  reaction: PlannedAction | null;         // prepared, fires reactively
  moveBefore: Vec3 | null;               // position before action
  moveAfter: Vec3 | null;                // position after action
}

export interface PlannedAction {
  type:
    | 'attack' | 'cast' | 'dash' | 'disengage' | 'dodge'
    | 'help' | 'hide' | 'ready' | 'shove' | 'grapple' | 'escapeGrapple'
    | 'secondWind' | 'rage' | 'layOnHands' | 'bardicInspiration'
    | 'spellHeal'    // Cure Wounds (action) or Healing Word (bonus action)
    | 'faerieFire'     // Faerie Fire AoE control (concentration)
    | 'bless'          // Bless up to 3 allies — +1d4 to attacks and saves (concentration)
    | 'entangle'       // Entangle AoE control — STR save or restrained (concentration)
    | 'thunderwave'    // Thunderwave — CON save, 2d8 thunder + push 10ft (no concentration)
    | 'armsOfHadar'   // Arms of Hadar — STR save, 2d6 necrotic + lose reaction (no concentration, circle AoE)
    | 'sleep'         // Sleep — 5d8 HP bucket, no save, renders enemies unconscious (no concentration)
    | 'wardingBond'    // Warding Bond — buff adjacent ally (touch range, no concentration)
    | 'shieldOfFaith'  // Shield of Faith — +2 AC to one ally (bonus action, concentration)
    | 'hex'            // Hex — bonus action, concentration, +1d6 necrotic on each hit (Warlock)
    | 'mageArmor'      // Mage Armor — self, no concentration, AC = 13 + DEX (Wizard/Sorcerer)
    | 'magicMissile'   // Magic Missile — 3 auto-hit darts 1d4+1 force each, 120 ft (Wizard/Sorcerer)
    | 'burningHands'   // Burning Hands — DEX save, 3d6 fire, 15-ft cone (Sorcerer/Wizard)
    | 'dissonantWhispers' // Dissonant Whispers — WIS save, 3d6 psychic + forced flee (Bard)
    | 'shield'         // Shield — reaction, +5 AC, blocks Magic Missile (Wizard/Sorcerer)
    | 'guidingBolt'    // Guiding Bolt — ranged spell attack, 4d6 radiant, next attack vs target has advantage (Cleric)
    | 'healingWord'    // Healing Word — bonus action, 1d4+WIS heal at 60 ft (Cleric/Druid/Bard)
    | 'legendary';
  action: Action | null;
  targetId: string | null;
  description: string;
  // For healing actions (secondWind, layOnHands, spellHeal): HP restored this action.
  healAmount?: number;
}
