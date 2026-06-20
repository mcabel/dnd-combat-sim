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
  | 'ac_floor'          // AC minimum / floor (e.g. Barkskin sets AC ≥ 16 — PHB p.217)
  | 'bless_die'         // add a bonus die to this creature's attack rolls & saves (Bless 1d4)
  | 'condition_apply'   // apply a condition to this creature (e.g. Entangle → restrained)
  | 'hex_damage'        // +1d6 necrotic on each hit by the caster (Hex PHB p.251)
  | 'damage_zone'       // persistent damage aura on this creature (e.g. Cloud of Daggers 4d4 slashing)
  // ── Session 17 — level-2 batch 3 new effect types ───────────────────
  | 'weapon_enchant'    // flat +N to attack rolls AND damage rolls with weapons (Magic Weapon PHB p.257)
  | 'enlarge_reduce';   // enlarge/reduce weapon-damage mod + STR check adv/disadv (Enlarge/Reduce PHB p.237)

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
    // ac_floor
    acFloor?:  number;                // e.g. 16 for Barkskin (PHB p.217)
    // bless_die
    dieSides?: number;                // e.g. 4 for a d4
    // condition_apply
    condition?: Condition;
    // hex_damage
    hexDie?: number;   // always 6 (d6); stored for extensibility
    // damage_zone — persistent damage aura (e.g. Cloud of Daggers PHB p.222)
    // Deals `dieCount`d`dieSides` `damageType` damage at the start of each
    // affected creature's turn (PHB p.222: "starts its turn there"). The
    // effect is applied on cast; the start-of-turn damage tick is in
    // combat.ts's runCombat loop (right after resetBudget). Removed when
    // the caster's concentration breaks (sourceIsConcentration: true).
    dieCount?: number;                // e.g. 4 for 4d4
    damageType?: DamageType;          // e.g. 'slashing' for Cloud of Daggers
    // ── Session 17 additions (level-2 batch 3) ─────────────────────────
    // saveDC + saveAbility: if present, the start-of-turn damage tick rolls
    // a save; on success, the damage is halved (PHB p.242 Flaming Sphere:
    // "must make a Dexterity saving throw. A creature takes 2d6 fire damage
    // on a failed save, or half as much on a successful one."). Omitted for
    // Cloud of Daggers (no save) — backward-compatible.
    saveDC?: number;                  // e.g. 13 for a DC 13 DEX save
    saveAbility?: AbilityScore;       // e.g. 'dex' for Flaming Sphere
    // ticksRemaining: if present, the effect ticks only this many times
    // before being automatically removed. Used by spells with a fixed
    // number of damage instances (e.g. Cordon of Arrows PHB p.228: "the
    // ground or surface ... shoots forth ... one piece ... of ammunition
    // ... when a creature moves into ... or ends its turn there" — 4 pieces
    // total; Melf's Acid Arrow delayed 2d4 — 1 tick). Omitted for Cloud of
    // Daggers (infinite ticks while concentration lasts) — backward-compatible.
    ticksRemaining?: number;          // e.g. 4 for Cordon of Arrows
    // ── weapon_enchant (Session 17 — Magic Weapon PHB p.257) ───────────
    // Flat +N to attack rolls AND damage rolls with weapon attacks
    // (melee/ranged, NOT spell). Read by resolveAttack's attack-roll branch
    // (adds to attack total) and damage branch (adds to weapon damage).
    attackBonus?: number;             // e.g. 1 for Magic Weapon (v1: no upcast)
    damageBonus?: number;             // e.g. 1 for Magic Weapon (v1: no upcast)
    // ── enlarge_reduce (Session 17 — Enlarge/Reduce PHB p.237) ─────────
    // 'enlarge': +1d8 weapon damage, advantage on STR checks/saves.
    // 'reduce': half weapon damage, disadvantage on STR checks/saves.
    // Read by resolveAttack's damage branch (the attacker's effect) and
    // rollAbilityCheck + rollSave (the creature's own effect for STR).
    enlargeReduceMode?: 'enlarge' | 'reduce';
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

  // ---- Aid (PHB p.211) scratch field ----
  // Set on the TARGET when it is buffed by Aid (2nd-level abjuration,
  // PHB p.211: "Each target's hit point maximum and current hit points
  // increase by 5 for the duration."). v1 simplification: the spell's
  // 8-hour duration >> combat length, so the buff is applied directly
  // to maxHP and currentHP with no cleanup (the HP increase persists
  // for the combat). The `_aidHPBonus` field tracks how much HP was
  // added so a future cleanup subsystem (or dispel magic) can reverse
  // it — forward-compat TODO via the metadata flag
  // `aidHPCleanupV1Implemented: false`. v1 NEVER reads this field; it
  // is set for future use only.
  //
  // Distinct from Warding Bond (also a 2nd-level buff): Warding Bond
  // uses a structured `wardingBond: { casterId }` field on Combatant
  // (read by combat.ts for +1 AC, +1 saves, damage redirect). Aid uses
  // a simple number scratch field because its only effect is +max HP
  // (applied directly to maxHP/currentHP at cast time).
  _aidHPBonus?: number;

  // ---- Branding Smite (PHB p.219) scratch field ----
  // Set on the CASTER when it casts Branding Smite (2nd-level
  // evocation, bonus action, PHB p.219: "The next time you hit a
  // creature with a weapon attack before this spell ends, the weapon
  // gleams with astral radiance as you strike. The attack deals an
  // extra 2d6 radiant damage to the target...").
  //
  // While `_brandingSmiteActive === true`, resolveAttack's damage
  // section — when `action.attackType === 'melee' || 'ranged'`
  // (weapon attacks, NOT spell attacks — PHB p.219 explicitly says
  // "weapon attack") — rolls an extra 2d6 radiant damage and adds it
  // to the damage total, then CONSUMES the flag (sets to false —
  // one-shot, mirror Shillelagh's +1d8 radiant pattern but
  // one-shot-consume instead of per-attack). Crit doubles the dice
  // (PHB p.196 — mirror Shillelagh's crit handling).
  //
  // v1 simplifications:
  //   1. Duration: canon 1 min (10 rounds) concentration → v1 1-round
  //      scratch flag, clears at the start of the caster's NEXT turn
  //      via cleanup() called from resetBudget() (mirror True Strike
  //      / Blade Ward / Shillelagh timing). Documented via the
  //      metadata flag `brandingSmiteDurationV1Simplified: true`.
  //   2. Concentration: canonically a concentration spell, but v1
  //      treats it as a 1-round self-buff (concentration not enforced
  //      — forward-compat TODO; see TG-002 in TEAMGOALS.md).
  //   3. Invisibility suppression: PHB p.219 also says the target
  //      "becomes visible if it's invisible, and the target sheds dim
  //      light in a 5-foot radius and can't become invisible until
  //      the spell ends." v1 does NOT model this (no invisibility
  //      subsystem — forward-compat TODO via the metadata flag
  //      `brandingSmiteInvisibilitySuppressionV1Implemented: false`).
  //
  // Mirrors Shillelagh (PHB p.275) — same self-buff + radiant damage
  // pattern, but:
  //   Shillelagh:     _shillelaghActive     = true  [melee-only, persistent, +1d8 radiant]
  //   Branding Smite: _brandingSmiteActive  = true  [weapon-only, one-shot, +2d6 radiant]
  _brandingSmiteActive?: boolean;

  // ---- Mirror Image (PHB p.260) scratch field ----
  // Set on the CASTER when it casts Mirror Image (2nd-level illusion,
  // PHB p.260: "Three illusory duplicates of yourself appear in your
  // space... Each time a creature targets you with an attack during the
  // spell's duration, roll a d20 to determine whether the attack instead
  // targets one of your duplicates."). The field tracks the number of
  // remaining duplicates (3 → 2 → 1 → 0). When the count reaches 0, the
  // spell ends (PHB p.260: "The spell ends when all three duplicates are
  // destroyed.").
  //
  // While `_mirrorImageDuplicates > 0`, resolveAttack's attack-roll
  // branch (in combat.ts) rolls a d20 BEFORE the normal attack roll to
  // determine whether the attack is retargeted to a duplicate:
  //   3 duplicates: d20 ≥ 6  retargets to a duplicate
  //   2 duplicates: d20 ≥ 8  retargets to a duplicate
  //   1 duplicate:  d20 ≥ 11 retargets to a duplicate
  // If retargeted, a SEPARATE attack roll is made against the duplicate's
  // AC (10 + caster's DEX mod). On a hit, one duplicate is destroyed
  // (decrement the counter). The attack doesn't affect the real caster.
  // On a miss, the attack simply misses (no effect on the caster or any
  // duplicate).
  //
  // v1 simplifications:
  //   1. Duration: canon 1 min (10 rounds), NO concentration → v1 does
  //      NOT track the duration. The spell lasts until all duplicates
  //      are destroyed (the canon end condition). If the caster is never
  //      attacked, the spell persists for the entire combat. Documented
  //      via the metadata flag `mirrorImageDurationV1Simplified: true`.
  //   2. Sight-dependency immunity: PHB p.260 says "A creature is
  //      unaffected by this spell if it can't see, if it relies on senses
  //      other than sight, such as blindsight, or if it can perceive
  //      illusions as false, as with truesight." v1 does NOT model this
  //      — all attackers are subject to the retargeting roll. The
  //      `isBlindImmune` flag does NOT exist on Combatant yet — adding
  //      it is part of TG-004 (parser tech debt) in TEAMGOALS.md.
  //      Documented via the metadata flag
  //      `mirrorImageSightDependencyV1Implemented: false`.
  //   3. NOT a concentration spell (PHB p.260: no concentration noted).
  //      The duplicates persist regardless of the caster's condition
  //      (incapacitated, etc.) until all are destroyed or the 1-min
  //      duration expires (v1 simplification: duration not tracked).
  //
  // Distinct from other self-buff scratch fields: Mirror Image is the
  // FIRST self-buff that modifies an incoming attack's TARGET (not the
  // attack roll, damage, or AC). The retargeting logic lives in
  // resolveAttack's pre-roll section.
  _mirrorImageDuplicates?: number;

  // ---- Session 17 — level-2 batch 3 scratch fields ---------------------------
  // These scratch fields are set by the 15 new level-2 spell modules added in
  // Session 17 (Enlarge/Reduce, Enhance Ability, Flame Blade, Magic Weapon,
  // Alter Self, Melf's Acid Arrow, Darkvision). They are optional (undefined
  // = effect not active) and never persisted. All but `_darkvisionActive` are
  // concentration-bound (cleaned by removeEffectsFromCaster when concentration
  // breaks); `_darkvisionActive` is a forward-compat flag with no v1 mechanic
  // (like `_lightSourceActive`).

  // ---- Enlarge/Reduce (PHB p.237) scratch field ----
  // Set on the TARGET (the affected creature) when it fails its CON save vs
  // Enlarge/Reduce. Values: 'enlarge' (buff — +1d8 weapon damage, advantage
  // on STR checks) or 'reduce' (debuff — half weapon damage, disadvantage on
  // STR checks). While set:
  //   - resolveAttack's damage branch checks the ATTACKER's flag:
  //     'enlarge' → +1d8 weapon damage (melee/ranged, NOT spell).
  //     'reduce'  → weapon damage (melee/ranged, NOT spell) is halved (PHB
  //                 p.197 resistance, rounded down — but NOT actual resistance,
  //                 so it composes with other resistances by halving first).
  //   - rollAbilityCheck checks the creature's flag for STR checks:
  //     'enlarge' → advantage on STR checks (PHB p.237).
  //     'reduce'  → disadvantage on STR checks (PHB p.237).
  // Concentration spell — removed by removeEffectsFromCaster when the caster's
  // concentration breaks. v1 simplification: size change (size category) NOT
  // modelled (no size-modifier subsystem for weapon dice / carrying capacity).
  _enlargeReduceActive?: 'enlarge' | 'reduce';

  // ---- Enhance Ability (PHB p.237) scratch field ----
  // Set on the TARGET (the buffed ally) when Enhance Ability is cast on them.
  // Value: the ability score that gains advantage on ability checks (PHB p.237:
  // "For the duration, the target has advantage on one ability check of the
  // chosen type, which is chosen when you cast this spell."). While set,
  // rollAbilityCheck grants advantage on ability checks of the matching ability.
  // Concentration spell — removed by removeEffectsFromCaster when concentration
  // breaks. v1 simplification: the per-spell die (e.g. Bear's Endurance adds
  // 2d6 to one check) is NOT modelled (advantage only — forward-compat TODO
  // via the metadata flag `enhanceAbilityTempHPV1Implemented: false` and
  // `enhanceAbilityBonusDieV1Implemented: false`).
  _enhanceAbilityActive?: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

  // ---- Flame Blade (PHB p.242) scratch field ----
  // Set on the CASTER when Flame Blade is cast (self-buff). While true, the
  // caster's melee weapon attacks deal +3d6 fire damage (v1 simplification —
  // canon: Flame Blade creates a NEW melee weapon that the caster attacks
  // with as an action, dealing 3d6 fire on a melee spell attack; v1 models it
  // as a +3d6 fire rider on existing melee weapon attacks, mirroring
  // Shillelagh's +1d8 radiant pattern but with a larger die and fire type).
  // Concentration spell — removed by removeEffectsFromCaster when concentration
  // breaks. v1 simplification documented via `flameBladeAsWeaponRiderV1Simplified: true`.
  _flameBladeActive?: boolean;

  // ---- Magic Weapon (PHB p.257) scratch field ----
  // Set on the TARGET (the weapon's wielder) when Magic Weapon is cast on
  // their weapon. Value: the +N bonus to attack rolls AND damage rolls with
  // that weapon (PHB p.257: "+1 to attack and damage rolls"; upcast +2/+3
  // NOT modelled in v1). While set, resolveAttack's attack-roll branch adds
  // the bonus to the attack total, and the damage branch adds it to weapon
  // damage (melee/ranged, NOT spell). Concentration spell — removed by
  // removeEffectsFromCaster when concentration breaks. v1 simplification:
  // the bonus applies to ALL of the wielder's weapon attacks (canon: a
  // specific weapon — v1 doesn't track per-weapon state).
  _magicWeaponBonus?: number;

  // ---- Alter Self (PHB p.211) scratch field ----
  // Set on the CASTER when Alter Self is cast (self-buff). v1 implements
  // ONLY the "Natural Weapons" option (PHB p.211: "Your unarmed strikes deal
  // 1d6 bludgeoning, piercing, or slashing damage — chosen when you cast the
  // spell — and you are proficient with them."). While set to 'naturalWeapons',
  // resolveAttack's damage branch checks: if the action is an unarmed strike
  // (damage 1 + STR mod), substitute 1d6 + STR mod instead. Concentration
  // spell — removed by removeEffectsFromCaster when concentration breaks.
  // v1 simplification: the other two options (Aquatic Adaptation, Change
  // Appearance) are NOT modelled (no swimming/disguise subsystem).
  _alterSelfActive?: 'naturalWeapons';

  // ---- Melf's Acid Arrow (PHB p.259) scratch field ----
  // Set on the TARGET when Melf's Acid Arrow hits (ranged spell attack).
  // PHB p.259: "On a hit, the target takes 4d4 acid damage immediately and
  // 2d4 acid damage at the end of its next turn." v1 models the delayed 2d4
  // acid as a damage_zone effect with `ticksRemaining: 1` (one tick at the
  // start of the target's next turn — slightly earlier than canon's "end of
  // its next turn", but consistent with the damage_zone start-of-tick timing
  // established by Cloud of Daggers in Session 16). This scratch field is
  // NOT used in v1 (the delayed damage is tracked via the damage_zone effect,
  // not via a scratch field) — kept here for forward-compat if a future
  // refactor moves delayed-damage tracking to a Combatant field.
  // (Reserved — currently always undefined.)

  // ---- Darkvision (PHB p.230) scratch field ----
  // Set on the TARGET when Darkvision is cast on them (touch). v1 has no
  // vision subsystem (computeLOS does not query darkvision), so this flag is
  // FORWARD-COMPAT only — set for future use, never read in v1. Like Light's
  // `_lightSourceActive` pattern. NOT a concentration spell (PHB p.230: 8 hr,
  // no concentration) — v1 applies the flag with no cleanup (persists for
  // the combat, like Aid's `_aidHPBonus`).
  _darkvisionActive?: boolean;

  // ---- Session 18 — level-2 batch 4 scratch fields ---------------------------
  // These scratch fields are set by the 20 new level-2 spell modules added in
  // Session 18. All are optional (undefined = effect not active) and never
  // persisted. Concentration-bound ones are cleaned by removeEffectsFromCaster
  // via the damage_zone sentinel pattern (dieCount=0).

  // ---- Ray of Enfeeblement (PHB p.271) scratch field ----
  // Set on the TARGET (the enfeebled creature) when Ray of Enfeeblement hits.
  // PHB p.271: "On a hit, the target deals only half damage with weapon
  // attacks that use Strength." v1 simplification: applies to ALL weapon
  // attacks (melee/ranged, NOT spell — mirror Enlarge/Reduce 'reduce' pattern
  // but on a target, not the attacker). resolveAttack's damage branch checks
  // the ATTACKER's flag: if true, halve the weapon damage (rounded down —
  // PHB p.197 resistance, but NOT actual resistance so it composes by halving
  // first). Concentration spell — removed by removeEffectsFromCaster when
  // the caster's concentration breaks.
  _rayOfEnfeeblementActive?: boolean;

  // ---- Silence (PHB p.275) scratch field ----
  // Set on the TARGET (caster) when Silence is cast (the silence zone is
  // anchored to the caster in v1's single-target simplification). PHB p.275:
  // "For the duration, no sound can be created within or pass through a
  // 20-foot-radius sphere centered on a point you choose within range." v1
  // has no spell-block subsystem — this flag is FORWARD-COMPAT only. Like
  // Darkvision's `_darkvisionActive`. Concentration spell (PHB p.275: 10 min).
  _silenceZoneActive?: boolean;

  // ---- Zone of Truth (PHB p.289) scratch field ----
  // Set on the TARGET (the truth-bound creature) when Zone of Truth is cast
  // on them. PHB p.289: "For the duration, you know if a creature speaks
  // truth... a creature can't speak a deliberate lie while in the 15-foot-
  // radius sphere centered on you." v1 has no lie/speech subsystem — this
  // flag is FORWARD-COMPAT only. Concentration spell (PHB p.289: 10 min).
  _zoneOfTruthActive?: boolean;

  // ---- Enthrall (PHB p.238) scratch field ----
  // Set on the CASTER when Enthrall is cast (self-buff). PHB p.238: "You
  // weave a distracting string of words, causing creatures of your choice
  // that you can see within range and that can hear you to make a Wisdom
  // saving throw. On a failed save, the targets have disadvantage on
  // Perception checks and Perception checks made to hear anything but you
  // for the duration." v1 has no perception subsystem — this flag is
  // FORWARD-COMPAT only. Concentration spell (PHB p.238: 1 min).
  _enthrallActive?: boolean;

  // ---- Detect Thoughts (PHB p.231) scratch field ----
  // Set on the CASTER when Detect Thoughts is cast (self-buff aura). PHB
  // p.231: "For the duration, you can read the thoughts of certain creatures."
  // v1 has no mind-reading subsystem — this flag is FORWARD-COMPAT only.
  // Concentration spell (PHB p.231: 1 min, concentration).
  _detectThoughtsActive?: boolean;

  // ---- See Invisibility (PHB p.274) scratch field ----
  // Set on the CASTER when See Invisibility is cast (self-buff). PHB p.274:
  // "For the duration, you see invisible creatures and objects as if they
  // were visible." v1 has no invisibility-detection subsystem — this flag is
  // FORWARD-COMPAT only (would extend computeLOS to ignore the invisible
  // condition). NOT a concentration spell (PHB p.274: 1 hr, no concentration)
  // — v1 applies the flag with no cleanup (persists for the combat, like
  // Darkvision's `_darkvisionActive`).
  _seeInvisibilityActive?: boolean;

  // ---- Spider Climb (PHB p.277) scratch field ----
  // Set on the TARGET (the climbing creature) when Spider Climb is cast on
  // them. PHB p.277: "the target gains the ability to move up, down, and
  // across vertical surfaces and upside down along ceilings, while leaving
  // its hands free." v1 has no climb-speed subsystem — this flag is
  // FORWARD-COMPAT only. Concentration spell (PHB p.277: 1 hr, concentration).
  _spiderClimbActive?: boolean;

  // ---- Pass without Trace (PHB p.264) scratch field ----
  // Set on the CASTER when Pass without Trace is cast (self-buff aura). PHB
  // p.264: "Each creature you choose within 30 feet of you (including you)
  // gains a +10 bonus to Dexterity (Stealth) checks." v1 has no stealth
  // subsystem — this flag is FORWARD-COMPAT only. Concentration spell (PHB
  // p.264: 1 hr, concentration).
  _passWithoutTraceActive?: boolean;

  // ---- Protection from Poison (PHB p.270) scratch field ----
  // Set on the TARGET (the protected creature) when Protection from Poison
  // is cast on them. PHB p.270: "For the duration, the target has advantage
  // on saving throws against being poisoned, and it has resistance to poison
  // damage." v1 has no poison-resistance subsystem — this flag is
  // FORWARD-COMPAT only (would extend rollSave to grant advantage vs CON
  // saves that are poison-related, and applyDamage to halve poison damage).
  // NOT a concentration spell (PHB p.270: 1 hr, no concentration) — v1
  // applies the flag with no cleanup.
  _protectionFromPoisonActive?: boolean;

  // ---- Knock (PHB p.254) scratch field ----
  // Set on the TARGET (the unlocked object) when Knock is cast on it. PHB
  // p.254: "Choose an object that you can see within range. The spell can
  // open a stuck, barred, or locked door, container, or other barrier."
  // v1 has no object/lock subsystem — this flag is FORWARD-COMPAT only. NOT
  // a concentration spell (PHB p.254: instantaneous, no concentration).
  _knockActive?: boolean;

  // ---- Arcane Lock (PHB p.215) scratch field ----
  // Set on the TARGET (the locked object) when Arcane Lock is cast on it.
  // PHB p.215: "You touch a closed door, window, gate, chest, or other
  // entryway, and it becomes locked for the duration." v1 has no
  // object/lock subsystem — this flag is FORWARD-COMPAT only. NOT a
  // concentration spell (PHB p.215: permanent, no concentration).
  _arcaneLockActive?: boolean;

  // ---- Session 19 — generic forward-compat spell-active flag ----
  // Tracks which Session 19 bulk-implemented spells are currently "active"
  // on this combatant. Each spell module's `shouldCast` checks this Set
  // to prevent re-casting an already-active spell in v1 (no-op). The actual
  // mechanical effect of each spell is NOT applied in v1 — the flag is
  // FORWARD-COMPAT only, mirroring the Session 17/18 pattern established
  // by Darkvision, Arcane Lock, Knock, See Invisibility, etc.
  //
  // Why a Set<string> instead of per-spell boolean fields? Session 19
  // adds 262 spells in one bulk pass; adding 262 individual Combatant
  // scratch fields would bloat the type and the existing pattern of
  // per-spell fields (Darkvision, Knock, etc.) was designed for the
  // bespoke-implemented spells. The bulk-implemented spells use this
  // generic Set instead. A future implementation that gives a spell a
  // real mechanical effect can migrate it to a bespoke scratch field
  // (and remove it from the generic registry).
  _genericSpellActiveSpells?: Set<string>;
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
    | 'aid'              // Aid — multi-ally HP buff (+5 max & current HP), 8 hr, no concentration (Cleric/Paladin)
    | 'barkskin'         // Barkskin — touch, AC floor 16, concentration 1 hr (Druid/Ranger)
    | 'blur'             // Blur — self, disadv on attacks vs caster, concentration 1 min (Wizard/Sorcerer)
    | 'blindnessDeafness'// Blindness/Deafness — CON save or blinded, 1 min, NO concentration (Cleric/Sorcerer/Wizard)
    | 'brandingSmite'    // Branding Smite — bonus action, next weapon hit +2d6 radiant, concentration 1 min (Paladin/Ranger)
    | 'calmEmotions'     // Calm Emotions — 60 ft, removes charmed/frightened from allies, concentration 1 min (Bard/Cleric/Druid/Paladin)
    | 'cloudOfDaggers'   // Cloud of Daggers — 60 ft, 4d4 slashing + persistent damage_zone, concentration 1 min (Bard/Sorcerer/Warlock/Wizard)
    | 'crownOfMadness'   // Crown of Madness — 120 ft, WIS save or charmed, concentration 1 min (Bard/Sorcerer/Warlock/Wizard)
    | 'holdPerson'       // Hold Person — 60 ft, WIS save or paralyzed, concentration 1 min (Bard/Cleric/Druid/Paladin/Sorcerer/Warlock/Wizard)
    | 'mirrorImage'      // Mirror Image — self, 3 duplicates, NO concentration, 1 min (Bard/Sorcerer/Warlock/Wizard)
    // ── Session 17 — level-2 batch 3 (15 new PHB level-2 spells) ──
    | 'enlargeReduce'      // Enlarge/Reduce — 30 ft, CON save, size/damage buff/debuff, concentration 1 min
    | 'enhanceAbility'     // Enhance Ability — touch, advantage on one ability's checks, concentration 1 hr
    | 'flameBlade'         // Flame Blade — self, +3d6 fire on melee weapon attacks, concentration 10 min
    | 'flamingSphere'      // Flaming Sphere — 60 ft, DEX save 2d6 fire + persistent damage_zone, concentration 1 min
    | 'heatMetal'          // Heat Metal — 60 ft, CON save 2d8 fire + persistent damage_zone, concentration 1 min
    | 'melfsAcidArrow'     // Melf's Acid Arrow — ranged spell attack, 4d4 acid + 2d4 delayed, 90 ft
    | 'mistyStep'          // Misty Step — BONUS ACTION, self teleport 30 ft, no concentration
    | 'invisibility'       // Invisibility — touch, grants invisible condition, concentration 1 hr
    | 'gustOfWind'         // Gust of Wind — line 60 ft, STR save or pushed 15 ft, concentration 1 min
    | 'levitate'           // Levitate — 60 ft, CON save or restrained (v1), concentration 10 min
    | 'lesserRestoration'  // Lesser Restoration — touch, ends blinded/deafened/poisoned/paralyzed, no concentration
    | 'magicWeapon'        // Magic Weapon — touch, weapon +1, concentration 1 hr
    | 'cordonOfArrows'     // Cordon of Arrows — 5 ft, DEX save 1d6 piercing, 4-piece damage_zone, 1 min
    | 'alterSelf'          // Alter Self — self, natural weapons (1d6 unarmed), concentration 10 min
    | 'darkvision'         // Darkvision — touch, grants darkvision 60 ft (forward-compat), 8 hr, no concentration
    // ── Session 18 — level-2 batch 4 (20 new PHB level-2 spells) ──
    | 'moonbeam'            // Moonbeam — 120 ft, CON save 2d10 radiant + persistent damage_zone, concentration 1 min
    | 'scorchingRay'        // Scorching Ray — 120 ft, 3 ranged spell attacks 2d6 fire each (multi-attack)
    | 'shatter'             // Shatter — 60 ft, CON save 3d8 thunder, 10-ft radius AoE
    | 'spikeGrowth'         // Spike Growth — 150 ft, 2d4 piercing damage_zone terrain, concentration 10 min
    | 'spiritualWeapon'     // Spiritual Weapon — 60 ft, melee spell attack 1d8 force + persistent damage_zone, BONUS ACTION, NO concentration, 1 min
    | 'phantasmalForce'     // Phantasmal Force — 60 ft, INT save 1d6 psychic + persistent damage_zone, concentration 1 min
    | 'rayOfEnfeeblement'   // Ray of Enfeeblement — 60 ft, ranged spell attack, target deals half weapon damage, concentration 1 min
    | 'web'                 // Web — 60 ft, DEX save or restrained, concentration 1 min
    | 'silence'             // Silence — 120 ft, AoE blocks verbal spells (forward-compat), concentration 10 min
    | 'suggestion'          // Suggestion — 30 ft, WIS save or charmed, concentration 8 hr (concentration 1 min in v1)
    | 'zoneOfTruth'         // Zone of Truth — 60 ft, CHA save, can't lie in 15-ft radius (forward-compat), concentration 10 min
    | 'enthrall'            // Enthrall — 60 ft, WIS save, disadv on Perception (forward-compat), concentration 1 min
    | 'detectThoughts'      // Detect Thoughts — self, WIS save mind-reading probe (forward-compat), concentration 1 min
    | 'seeInvisibility'     // See Invisibility — self, see invisible 60 ft (forward-compat), NO concentration, 1 hr
    | 'spiderClimb'         // Spider Climb — touch, climb speed (forward-compat), concentration 1 hr
    | 'passWithoutTrace'    // Pass without Trace — self, +10 stealth aura (forward-compat), concentration 1 hr
    | 'protectionFromPoison' // Protection from Poison — touch, removes poisoned + advantage on saves vs poison (forward-compat), NO concentration, 1 hr
    | 'prayerOfHealing'     // Prayer of Healing — 30 ft, 2d8+spellcasting heal up to 3 creatures (v1: action cast), NO concentration
    | 'knock'               // Knock — 60 ft, opens objects (forward-compat), NO concentration
    | 'arcaneLock'          // Arcane Lock — touch, locks object (forward-compat), permanent, NO concentration
    // ── Session 21 — Real-mechanics migration (7 combat damage spells) ──
    // Migrated from the Session 19/20 generic dispatch registry to bespoke
    // implementations with real mechanical effects (DEX/CON saves, spell
    // attack rolls, AoE damage). Mirrors the Session 18 bespoke pattern
    // (Moonbeam / Shatter / Scorching Ray). Each migrated spell:
    //   - Removed from _generic_registry.ts
    //   - Has its own case branch in combat.ts executePlannedAction
    //   - Has its own planner branch in planner.ts
    //   - Has its own test file in src/test/<spell>.test.ts
    | 'fireball'            // Fireball — PHB p.241: 150 ft, DEX save 8d6 fire (half on save), 20-ft radius AoE, NO concentration
    | 'lightningBolt'       // Lightning Bolt — PHB p.255: 100-ft × 5-ft line from caster, DEX save 8d6 lightning (half on save), NO concentration
    | 'coneOfCold'          // Cone of Cold — PHB p.229: self (60-ft cone), CON save 8d8 cold (half on save), NO concentration
    | 'inflictWounds'       // Inflict Wounds — PHB p.253: touch (5 ft), melee spell attack 3d10 necrotic (crit doubles), NO concentration
    | 'chromaticOrb'        // Chromatic Orb — PHB p.221: 90 ft, ranged spell attack 3d8 chosen-elemental (picker avoids resistances, crit doubles), NO concentration
    | 'catapult'            // Catapult — XGE p.15: 60 ft, DEX save 3d8 bludgeoning (half on save), single-target, NO concentration
    | 'iceKnife'            // Ice Knife — XGE p.157: 60 ft, ranged spell attack 1d10 piercing + 2d6 cold DEX save 5-ft radius AoE (explodes on hit or miss), NO concentration
    // ── Session 19 — bulk-implementation generic dispatch (262 new spells L2-9) ──
    // All non-blocker in-scope spells from levels 2-9 that have not been
    // implemented as bespoke case branches are routed through 'genericSpell'.
    // The dispatch is keyed by `spellName` (see below). Each spell has its
    // own module at src/spells/<snake>.ts that exports shouldCast + execute.
    | 'genericSpell'
    | 'legendary';
  action: Action | null;
  targetId: string | null;
  description: string;
  // For healing actions (secondWind, layOnHands, spellHeal): HP restored this action.
  healAmount?: number;
  // ── Session 19 — generic spell dispatch ──────────────────────────────
  // When `type === 'genericSpell'`, this field carries the canonical spell
  // name (e.g. 'Fireball', 'Beacon of Hope'). combat.ts's
  // `case 'genericSpell':` branch looks up the spell module via the
  // `genericSpellRegistry` (in src/spells/_generic_registry.ts) and calls
  // its `shouldCast` + `execute`. This avoids adding 262 individual case
  // branches for the Session 19 bulk-implementation pass.
  spellName?: string;
}
