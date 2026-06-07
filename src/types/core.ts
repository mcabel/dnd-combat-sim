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
  | 'grappled' | 'incapacitated' | 'invisible' | 'paralyzed'
  | 'petrified' | 'poisoned' | 'prone' | 'restrained'
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
  costType: AICostType;
  legendaryCost: number;
  description: string;
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

  // Wizard
  arcaneRecovery?:     { usesRemaining: number };             // 1/day, short rest

  // Warlock Dark One's Blessing temp HP on kill
  darkOnesBlessing?:   { amount: number };

  // Ammo tracking (4.11) — Ranger arrows, Rogue shortbow
  ammo?: {
    [weaponName: string]: { max: number; remaining: number };
  };                    // CHA mod + level temp HP on kill
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
    | 'legendary';
  action: Action | null;
  targetId: string | null;
  description: string;
}
