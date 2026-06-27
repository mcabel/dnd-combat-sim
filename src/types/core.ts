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

/**
 * ── Session 61: Shapechanger form (RFC-SHAPECHANGER Phase 1) ──
 * Represents ONE alternate form a shapechanger creature can take.
 *
 * Most shapechanger forms only modify size + speed (and rarely AC) — the
 * creature's other stats (HP, ability scores, actions, conditions) stay
 * the same per the trait text: "Its statistics, other than its size and
 * speed, are the same in each form."
 *
 * Form name is the human-readable identifier (e.g., 'bat', 'wolf', 'mist',
 * 'humanoid'). The form 'true' is reserved for the creature's original
 * form (not stored in `shapechangerForms` — it's the implicit default).
 *
 * Special flags (e.g., mist form's `cantTakeActions` + `immuneNonmagical`)
 * are captured but selectively applied by the engine (Phase 1 only applies
 * size/speed/AC + cantTakeActions; full bespoke per-form handling is
 * deferred to RFC Phase 4).
 */
export interface ShapechangerForm {
  name: string;                              // 'bat', 'wolf', 'mist', etc.
  size?: CreatureSize;                       // if different from base
  speedWalk?: number;                        // ft — if mentioned
  speedFly?: number;                         // ft — if mentioned
  speedClimb?: number;                       // ft — if mentioned
  speedSwim?: number;                        // ft — if mentioned
  ac?: number;                               // if form has different AC
  cantTakeActions?: boolean;                 // e.g., mist form (Strahd)
  immuneNonmagical?: boolean;                // e.g., mist form (Strahd)
  advantageOnStrDexConSaves?: boolean;       // e.g., mist form (Strahd)
  description: string;                       // form's mechanic text for logging
}

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
  | 'bane_die'          // subtract a die from this creature's attack rolls & saves (Bane -1d4) — Session 27 Batch 3
  | 'condition_apply'   // apply a condition to this creature (e.g. Entangle → restrained)
  | 'hex_damage'        // +1d6 necrotic on each hit by the caster (Hex PHB p.251)
  | 'damage_zone'       // persistent damage aura on this creature (e.g. Cloud of Daggers 4d4 slashing)
  // ── Session 17 — level-2 batch 3 new effect types ───────────────────
  | 'weapon_enchant'    // flat +N to attack rolls AND damage rolls with weapons (Magic Weapon PHB p.257)
  | 'enlarge_reduce'    // enlarge/reduce weapon-damage mod + STR check adv/disadv (Enlarge/Reduce PHB p.237)
  | 'taunt'             // disadvantage on attacks vs non-caster targets (Antagonize EGtW p.150)
  // ── Bestow Curse (PHB p.214) — new effect types ────────────────────
  | 'curse_attack_disadv'  // disadvantage on attacks vs the curse caster (Bestow Curse PHB p.214 opt.1)
  | 'ability_disadvantage' // disadvantage on ability checks & saves for one ability (Bestow Curse PHB p.214 opt.2)
  | 'curse_rider'          // 1d8 necrotic when cursed target attacks the curse caster (Bestow Curse PHB p.214 opt.4)
  | 'dominated'             // charmed + incapacitated (Dominate Beast/Person/Monster PHB p.235 — control-override)
  | 'suggestion'            // charmed + disadv on own attacks (Mass Suggestion PHB p.258 — follow-a-suggestion behaviour)
  | 'terrain_zone'          // persistent terrain effect on the battlefield (Grease/Sleet Storm/Watery Sphere)
  | 'exhaustion_level'      // increment exhaustion level (Sickening Radiance XGE p.164, future spells)
  | 'spell_shield'          // blocks spells at or below a level threshold (Globe of Invulnerability PHB p.245)
  // ── Session 62 RFC-VISION-AUDIO: battlefield obstacle effect ──
  // Used by Fog Cloud (PHB p.243) and future obscurement spells (Darkness,
  // Wall of Fog, etc.). The spell module's execute() adds a vision-blocking
  // Obstacle to bf.obstacles + applies this effect to the CASTER (self-targeted,
  // sourceIsConcentration: true). When concentration breaks, _undoEffect
  // removes the obstacle from bf.obstacles by ID.
  | 'battlefield_obstacle'
  | 'invisible'             // true invisibility: attacks vs creature have disadv + own attacks have adv (PHB p.194)
  // ── Session 48 — movement_rider typed effect (replaces BB scratch fields) ──
  | 'movement_rider'        // fires when bearer willingly moves 5+ ft; cleared at bearer's next turn start
  // ── Session 27 — Batch 3 concentration buffs ────────────────────────
  // bane_die: inverse of bless_die (Bane PHB p.219: -1d4 to attacks/saves).
  // weapon_enchant extended with damageDie/damageDieCount/damageDieType
  // for spells that add extra DAMAGE DICE on weapon attacks (Divine Favor
  // +1d4 radiant, Holy Weapon +5d8 radiant, etc.) — Session 27 Batch 3.

export interface ActiveEffect {
  id: string;               // unique per instance, e.g. 'eff_1'
  casterId: string;         // ID of the Combatant who cast the spell
  spellName: string;        // canonical spell name; also used as adv_system source label
  effectType: SpellEffectType;
  /**
   * The spell slot level used when this effect was applied.
   * 0 = applied by a cantrip (e.g. Hex-like cantrip riders).
   * undefined = legacy effects created before this field existed (treat as 0).
   *
   * Used by:
   *   - Globe of Invulnerability: only blocks if sourceSlotLevel ≤ GoI threshold
   *   - Dispel Magic: DC = 10 + sourceSlotLevel (PHB p.233)
   *
   * RFC-UPCASTING Phase 2 (Session 72)
   */
  sourceSlotLevel?: number;
  payload: {
    // advantage_vs
    advType?:  'advantage' | 'disadvantage';
    advScope?: D20TestScope;
    // ac_bonus
    acBonus?:  number;
    // ac_floor
    acFloor?:  number;                // e.g. 16 for Barkskin (PHB p.217)
    // bless_die
    dieSides?: number;                // e.g. 4 for a d4 (also used by bane_die — subtracted)
    // bane_die (Session 27 Batch 3): inverse of bless_die. dieSides is the
    // die to SUBTRACT from attack rolls & saves (e.g. 4 for Bane's -1d4).
    // Read by getActiveBaneDie(); subtracted in resolveAttack + rollSave.
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
    // ── Session 36 — Protection from Energy innate-resistance fix ──────
    // When the Protection from Energy sentinel (damage_zone dieCount=0 on
    // the target) is applied, the spell may or may not have actually pushed
    // a new entry into target.resistances:
    //   - addedResistance === true  → spell pushed a new entry; _undoEffect
    //     should splice it back out on concentration break.
    //   - addedResistance === false → target had INNATE resistance to the
    //     same type (idempotent push was a no-op); _undoEffect must NOT
    //     splice (would wrongly remove the innate entry).
    //   - undefined → legacy sentinels (pre-Session 36) assume true for
    //     backwards compat (the pre-fix behavior spliced unconditionally).
    addedResistance?: boolean;
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
    // ── Session 27 Batch 3 — weapon_enchant damage DICE ────────────────
    // For spells that add extra DAMAGE DICE (not flat bonus) on weapon
    // attacks: Divine Favor (+1d4 radiant), Elemental Weapon (+1d4 fire),
    // Flame Arrows (+1d6 fire), Holy Weapon (+5d8 radiant), Shadow Blade
    // (+2d8 psychic). Read by getActiveWeaponEnchant; rolled in resolveAttack's
    // damage branch (crit doubles the dice — PHB p.196).
    damageDie?: number;               // e.g. 4 for +1d4, 8 for +1d8
    damageDieCount?: number;          // e.g. 5 for 5d8 (Holy Weapon); default 1
    damageDieType?: DamageType;       // e.g. 'radiant' for Divine Favor/Holy Weapon
    // ── enlarge_reduce (Session 17 — Enlarge/Reduce PHB p.237) ─────────
    // 'enlarge': +1d8 weapon damage, advantage on STR checks/saves.
    // 'reduce': half weapon damage, disadvantage on STR checks/saves.
    // Read by resolveAttack's damage branch (the attacker's effect) and
    // rollAbilityCheck + rollSave (the creature's own effect for STR).
    enlargeReduceMode?: 'enlarge' | 'reduce';
    // ── taunt (Antagonize EGtW p.150) ────────────────────────────────────
    // The taunted combatant has disadvantage on attack rolls against any
    // creature EXCEPT the one identified by tauntCasterId. Read by
    // getActiveTaunt() in spell_effects.ts; consumed in combat.ts resolveAttack.
    tauntCasterId?: string;            // ID of the caster — attacks vs anyone else have disadvantage
    // ── curse_attack_disadv (Bestow Curse PHB p.214 opt.1) ──────────────
    // The cursed creature has disadvantage on attack rolls against the
    // curse caster. Mirror of taunt (taunt = disadv vs non-caster;
    // curse_attack_disadv = disadv vs specific caster). Read by
    // getActiveCurseAttackDisadv() in spell_effects.ts; consumed in
    // combat.ts resolveAttack.
    curseCasterId?: string;              // ID of the curse caster — attacks vs this creature have disadvantage
    // ── ability_disadvantage (Bestow Curse PHB p.214 opt.2) ─────────────
    // The cursed creature has disadvantage on ability checks and saving
    // throws made with one chosen ability score. Read by
    // hasAbilityDisadvantage() in spell_effects.ts; consumed in
    // utils.ts rollSave and rollAbilityCheck.
    ability?: AbilityScore;             // e.g. 'wis' — disadv on WIS checks & saves
    // ── curse_rider (Bestow Curse PHB p.214 opt.4) ──────────────────────
    // The cursed creature takes 1d8 necrotic damage each time it makes
    // an attack roll or spell attack against the curse caster. Read by
    // getActiveCurseRider() in spell_effects.ts; consumed in
    // combat.ts resolveAttack.
    riderDie?: number;                  // e.g. 8 for 1d8
    riderDieCount?: number;             // e.g. 1 for 1d8
    riderDamageType?: DamageType;       // e.g. 'necrotic'
    riderCasterId?: string;             // ID of the curse caster — attacks vs this creature trigger rider
    // ── condition_apply fallHeight (Reverse Gravity PHB p.277) ──────────
    // Height in feet the creature has been lifted. When concentration
    // breaks, the creature falls and takes fall damage (PHB p.183).
    // Read by processFallDamage() in combat.ts.
    fallHeight?: number;                // e.g. 100 for 100-ft Reverse Gravity cylinder
    // ── exhaustion_level (Sickening Radiance XGE p.164, future spells) ───
    // How many exhaustion levels to add (e.g. 1 for Sickening Radiance).
    // Exhaustion is a 7-level graduated state (PHB p.291): level 6 = death.
    // NOT auto-removed on effect dispel — persists until rest/spell removal.
    exhaustionLevels?: number;
    // ── terrain_zone (Grease/Sleet Storm/Watery Sphere) ────────────────
    // Persistent terrain effect that applies a condition to creatures
    // starting their turn in the zone's radius. The effect is stored on
    // the CASTER (not the targets). At the start of each creature's turn,
    // combat.ts checks if they're within the zone's radius and rolls a
    // save if so. Read by getActiveTerrainZones() in spell_effects.ts.
    terrainSaveAbility?: 'str' | 'dex' | 'con' | 'wis';  // save type for terrain effect
    terrainCondition?: Condition;                          // condition on failed save
    terrainRadiusFt?: number;                             // radius of the terrain zone (ft)
    terrainCenterX?: number;                              // center position X (grid squares)
    terrainCenterY?: number;                              // center position Y (grid squares)
    terrainCenterZ?: number;                              // center position Z (grid squares)
    terrainDifficulty?: boolean;                          // if true, this terrain_zone marks cells as difficult terrain (PHB p.182)
    // ── battlefield_obstacle (Session 62 — Fog Cloud / obscurement spells) ──
    // The ID of the Obstacle added to bf.obstacles by the spell's execute().
    // When the effect is removed (concentration break, dispel, caster death),
    // _undoEffect removes the obstacle with this ID from bf.obstacles.
    obstacleId?: string;
    obstacleCenterX?: number;   // grid squares (for logging / debugging)
    obstacleCenterY?: number;
    obstacleCenterZ?: number;
    obstacleRadiusFt?: number;  // e.g. 20 for Fog Cloud's 20-ft sphere
    // ── Session 63: Darkness (PHB p.230) — blocks darkvision ──
    // Set to true by Darkness (magical darkness). Phase 2 vision
    // (isVisuallyDetected) will check this: if true, darkvision can't
    // penetrate the obstacle. Fog Cloud (normal obscurement) leaves this
    // undefined/false → darkvision CAN see through it in Phase 2.
    blocksDarkvision?: boolean;
    // ── movement_rider (Session 48 — replaces _boomingBladePendingDamageDice) ─
    // Fires in executeMove when the bearer willingly moves 5+ ft. Cleared
    // at the start of the bearer's next turn by the spell module's cleanup()
    // (called from resetBudget). Stored on the TARGET (the hit combatant).
    moveDamageDice?: string;      // e.g. '1d8' for Booming Blade thunder rider
    moveDamageType?: DamageType;  // e.g. 'thunder'
    // ── spell_shield (Globe of Invulnerability PHB p.245) ─────────────
    // Spells cast at blockThreshold level or lower from outside the barrier
    // have no effect. The slot is still consumed. Cantrips (level 0) are
    // NOT blocked by GoI. Upcast: L6→5, L7→6, L8→7, L9→8.
    blockThreshold?: number;       // spells at this level or below are blocked
  };
  sourceIsConcentration: boolean;     // if true, removed when caster's concentration ends
  /**
   * PHB p.254 (Invisibility) / p.254 (Greater Invisibility):
   * "The spell ends for a target that attacks or casts a spell."
   *
   * If true, this effect is automatically removed from the target when
   * the target makes an attack roll or casts a spell. Set by the
   * Invisibility spell (PHB p.254) but NOT by Greater Invisibility
   * (PHB p.254: Greater Invisibility has no ends-on-attack clause —
   * the caster stays invisible for the full duration regardless of
   * their actions).
   *
   * Implementation: combat.ts resolveAttack checks the ATTACKER's
   * activeEffects for any effect with breaksOnAttackOrCast=true and
   * removes it AFTER the attack resolves. The spell-casting path
   * (case 'summonSpell' / case 'genericSpell' in executePlannedAction)
   * does the same for the caster.
   */
  breaksOnAttackOrCast?: boolean;

  // ── TG-032: source creature type (for Nature's Ward-style immunities) ──
  // The creature type of the effect's source caster (e.g. 'fey', 'elemental',
  // 'humanoid', 'undead'). Optional — set by spell modules that apply charmed
  // / frightened conditions when the caster's type matters for immunity checks
  // (e.g. Land Druid 10 Nature's Ward: PHB p.69 "you can't be charmed or
  // frightened by fey or elementals"). When absent, the Nature's Ward fey/
  // elemental check is skipped (backward-compatible — existing spell modules
  // that don't set this behave exactly as before).
  //
  // Spell modules set this to `caster.creatureType` when constructing the
  // ActiveEffect. For PC casters, creatureType is typically undefined (PCs
  // are humanoids by default but the field isn't always populated); for
  // monster casters, fivetools.ts:1236 populates it from the 5etools type
  // field. The check in applySpellEffect compares lowercased values.
  sourceCreatureType?: string;

  // ── Session 64 RFC-COMBINING-EFFECTS Phase 1: priority activation ──
  // Per DMG p.252 "Combining Game Effects" + PHB Ch.10 "Combining Magical
  // Effects": when 2+ effects share an `effectName`, only the most potent
  // applies (power > total duration > most recently activated). Both effects
  // COEXIST in activeEffects with timers running; the loser gets
  // `suppressed: true` (dormant, not deleted). When the active expires, the
  // next-highest suppressed effect takes over. See RFC-COMBINING-EFFECTS.md.

  /**
   * Canonical effect identity — the key for same-name priority activation.
   * Two effects with the same effectName overlap (DMG p.252).
   *
   * Distinct from spellName: Blindness/Deafness spell + Darkness spell both
   * → 'blinded'; two Spirit Guardians from different clerics → 'spirit-guardians'.
   *
   * Auto-populated by applySpellEffect via resolveEffectName() when absent.
   * Spell modules can override by setting it explicitly.
   */
  effectName?: string;

  /** Originating source instance ID. When the source ends (concentration break,
   *  AoE expiry, caster death), all effects with this sourceId are removed.
   *  If absent, lifecycle is bound to casterId + sourceIsConcentration (legacy). */
  sourceId?: string;

  /** Turn number when this effect's source expires (non-concentration finite
   *  duration). reevaluateEffects removes effects where round > sourceTurnExpires.
   *  undefined = no expiry (concentration-bound or permanent). */
  sourceTurnExpires?: number;

  /** Turn number when this effect was applied. XGE final tiebreaker ("most
   *  recently activated") when potency + duration are equal. Higher = more recent.
   *  Auto-populated by applySpellEffect when absent (defaults to 0). */
  appliedTurn?: number;

  /** True = this effect is suppressed by priority activation (a higher-priority
   *  same-name effect is active). Suppressed effects stay in activeEffects with
   *  timers running; they do NOT apply their mechanics. When the active effect
   *  is removed, reevaluateEffects promotes the next-highest suppressed effect.
   *  undefined/false = active (not suppressed). */
  suppressed?: boolean;
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

  /**
   * ── Session 52 Creature Megabatch Batch 3: Recharge ──
   *
   * MM p.8 / MM p.11: "Recharge X-Y" or "Recharge X" — after a creature uses
   * a Recharge action, it can't use that action again until a certain die
   * roll is met at the START of its turn. The roll is 1d6; the action
   * recharges on a roll of `min` or higher. Bare "{@recharge}" (no number)
   * means Recharge 6 (only on a 6).
   *
   * `recharge` is set by the parser when an action name contains a
   * `{@recharge N}` or `{@recharge}` tag (the tag is stripped from `name`).
   * `recharged` tracks availability: true on spawn (available immediately),
   * set false on use, set true again at start-of-turn when the d6 roll meets
   * the threshold. The AI planner skips actions where `recharge && !recharged`.
   *
   * 84 MM creatures have recharge actions (dragons' breath weapons, mephits'
   * breath, yeti Cold Breath, etc.).
   */
  recharge?: { min: number; recharged: boolean };
  /**
   * RFC-UPCASTING Phase 6 (Session 72): When true, this cantrip does NOT
   * receive cantripTier()-based damage scaling in resolveAttack().
   *
   * Some cantrips have flat damage that never scales with caster level
   * (e.g. Magic Stone XGE p.160: always 1d6+mod regardless of level).
   * Most cantrips DO scale (PHB p.201: +1 die at levels 5/11/17).
   *
   * Default: false (all cantrips scale). Set to true for flat-damage cantrips.
   */
  noCantripScaling?: boolean;
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

/**
 * ── Session 62 RFC-VISION-AUDIO Phase 1: Detection State ──
 *
 * Per-observer, per-target detection classification. Stored on
 * `PerceptionMemory.detection` keyed by target id. Updated at the start of
 * each combatant's turn by `updateDetectionStates()` in perception.ts.
 *
 *   'visible'        — observer can see + hear the target. Normal targeting.
 *   'hidden'         — target has the 'hidden' condition (took Hide action).
 *                      Observer doesn't know their position. Can't target
 *                      directly (must guess a location).
 *   'position-known' — observer can't SEE the target (invisible, in darkness,
 *                      behind total cover) but heard them. Can target attacks
 *                      at disadvantage; CAN'T target "a creature you can see"
 *                      spells.
 *   'unknown'        — observer lost track of the target (no sound, no sight).
 *
 * v1 simplification: the detection map is OPTIONAL. Combatants created
 * without it (legacy tests, factories) skip detection-state checks and fall
 * back to the existing condition-based adv/disadv logic in attackAdvantageState.
 */
export type DetectionState = 'visible' | 'hidden' | 'position-known' | 'unknown';

export interface PerceptionMemory {
  targets: Map<string, TargetKnowledge>;
  // ── Session 62 RFC-VISION-AUDIO Phase 1 ──
  // Optional: per-target detection state from the perception subsystem.
  // Populated by updateDetectionStates() at the start of each observer's
  // turn. Absent on legacy combatants (backward-compatible).
  detection?: Map<string, DetectionState>;
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
  // ── Session 43 Task #23: Action Surge (Fighter 2+, PHB p.72) ──
  // 1 use at lv2, 2 uses at lv17. Short or long rest recovery.
  // Tracked on the sheet (sheet.resources.actionSurge) and transferred to
  // the Combatant via buildCombatant -> pcToCombatant. The planner checks
  // remaining > 0 to plan an extraAction; the engine consumes one use when
  // the extraAction executes.
  actionSurge?:        { max: number; remaining: number };   // action, short rest

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

  // ── Session 49 Task #29-follow-up-3c: Land Druid Natural Recovery ──
  // Land Druid 2 (PHB p.68): recover spell slots equal to half druid level
  // (rounded up) on a short rest, once per long rest. Slots must be 5th level
  // or lower. Tracked as usesRemaining=1; consumed on short-rest use; reset on
  // long rest.
  naturalRecovery?:    { usesRemaining: number };             // 1/day, short rest

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

  // ── Session 47 Task #29-follow-up-4: Monk Wholeness of Body ──
  // Open Hand Monk 6 (PHB p.79): self-heal action, 3 × monk level HP,
  // once per long rest. Tracked as max=1/remaining=1; consumed when used.
  wholenessOfBody?: { max: number; remaining: number };

  // ── TG-024: Monk Ki (PHB p.76) + Sorcerer Sorcery Points (PHB p.101) ──
  // Ki: monk-level points, short or long rest recovery. Populated by
  // leveler.ts (Monk 1+) and transferred via buildRawResources (builder.ts)
  // → buildResources (pc.ts). Used by Flurry of Blows / Patient Defense /
  // Step of the Wind (1 ki each), Stunning Strike (1 ki), Deflect Missiles
  // throw-back (1 ki), Diamond Soul save reroll (1 ki), Empty Body (4 ki),
  // Perfect Self (refill 4). The rest-recovery hook in character_router.ts
  // already restores ki on short/long rest.
  ki?: { max: number; remaining: number };   // short rest, Monk 1+
  // Sorcery Points: sorcerer-level points, long rest recovery only. Used by
  // Flexible Casting (convert slot↔points), Metamagic options, and subclass
  // features like Draconic Presence (5 SP). Populated by leveler.ts
  // (Sorcerer 2+) and transferred via the same pipeline as ki.
  sorceryPoints?: { max: number; remaining: number };   // long rest, Sorcerer 2+

  // ── Session 49 Task #29-follow-up-5d: Draconic Presence ──
  // Draconic Sorcerer 18 (PHB p.102): action + 5 sorcery points, frighten
  // all enemies within 60 ft (WIS save). v1 simplification: 1/combat tracked
  // here. The 5-sorcery-point cost is now payable via `sorceryPoints` above
  // (TG-024 landed the transfer); the draconicPresence engine hook can
  // decrement sorceryPoints.remaining when it fires (future TG-030-style work).
  draconicPresence?: { max: number; remaining: number };

  // Innate Spellcasting (MM p.10–11; e.g. Couatl, Drow, Druidic casters).
  // Per-spell uses-per-day tracker. Used by monsters with at-will or
  // N/day innate spellcasting. The spell names MUST match the Action.name
  // of the corresponding spell Action in the combatant's actions list.
  // The AI planner checks both spell slots AND innate uses when deciding
  // whether to cast a spell (see ai/resources.ts: hasInnateSpellUse).
  // At-will innate spells (e.g. Detect Magic) are not tracked here —
  // they're modeled as slotLevel: 0 Actions that don't consume anything.
  innateSpellcasting?: {
    [spellName: string]: { max: number; remaining: number };
  };
}

// ---- Save-fail tracker (Contagion / Flesh to Stone) -----------
// Per-target save-fail tracker for escalating conditions.
// Set on the TARGET by the spell's execute(); processed at the start
// of the target's turn in combat.ts's runCombat loop.

export interface SaveFailTracker {
  spellName: string;              // 'Contagion' or 'Flesh to Stone'
  casterId: string;               // who cast the spell
  fails: number;                  // count of failed saves (0–3)
  successes: number;              // count of successful saves (0–3)
  maxCount: number;               // 3 for both spells
  saveAbility: AbilityScore;      // 'con' for both spells
  saveDC: number;                 // the DC from the original cast
  conditionOnFail: Condition;     // condition to apply after max fails
  currentCondition: Condition;    // currently applied condition
  // Session 84 (GoI save-fail tracker): the spell's slot level, used by
  // the combat.ts save-fail tracker loop to check Globe of Invulnerability
  // protection on each per-turn save roll (PHB p.245). Contagion = 5,
  // Flesh to Stone = 6 (both fixed-level — "Upcast: none"). Optional for
  // backward compat (manual tracker constructions in tests omit it);
  // defaults to 0 in combat.ts (0 = cantrip-level = never blocked, so
  // legacy trackers without slotLevel preserve pre-Session 84 behavior).
  // Mirrors the `sourceSlotLevel` pattern on damage_zone / terrain_zone
  // effects (Sessions 78-83).
  slotLevel?: number;
}

// ---- Combatant ----------------------------------------------

export type AIProfile = 'attackNearest' | 'attackWeakest' | 'smart' | 'defend';
// 'defend': creature only retaliates if directly adjacent — never pursues.
// Assigned explicitly at spawn for creatures like Giant Fly (magic item mount).
// NOT based on INT score; a low-INT predator like a T-Rex uses 'attackNearest'.

/**
 * ── Session 91 RFC-LAIRACTIONS Phase 1: structured LairAction schema ──
 *
 * Replaces the v1 `lairActions.actions: string[]` (Session 60 stub) with a
 * structured per-action object. Each of the ~324 parsed lair-action options
 * (115 legendary groups) is read individually and tagged per [DD-4]:
 *   - `isSpell: true` ONLY when the action explicitly casts a named spell
 *     (detected via `@spell` tag or "casts <spell>" phrasing). These are
 *     blocked by Globe of Invulnerability and are counterable.
 *   - `isMagical: true` by default for all actions (MM: "magical effects").
 *     `isMagical: false` is reserved for purely physical effects (rare; the
 *     MM describes all lair actions as magical). Bypasses GoI but is
 *     suppressed by Antimagic Field (forward-compat).
 *
 * The structured fields (saveDC, damage, conditions, summons, …) are
 * extracted from the 5eTools inline tags (`@dc`, `@damage`, `@condition`,
 * `@spell`, `@creature`, …) present in the raw lair-action text. ~85% of
 * actions yield at least one structured field; the rest are `bespoke`.
 *
 * Out-of-scope (flavor/social) and deferred (awaiting-subsystem) actions are
 * tagged here so Phase 2's dispatcher can log-and-skip them. Stable IDs
 * (`lair_oos_NNN` / `lair_def_NNN`) come from the Phase 0 registry
 * (`docs/LAIR-ACTIONS-OUT-OF-SCOPE.md`) and appear in runtime logs for
 * searchability.
 *
 * Phase 1 is data-layer only: the engine stub still fires at round start and
 * logs `rawText` (no mechanical effect). Phase 2 wires `resolveLairActions`
 * + the category dispatcher; Phase 4 wires AI scoring.
 */
export type LairActionCategory =
  | 'save_damage'        // @dc + @damage (e.g., Red Dragon magma: DC 15 DEX, 6d6 fire)
  | 'save_condition'     // @dc + @condition, no @damage (e.g., Red Dragon tremor: DC 15 DEX, prone)
  | 'save_only'          // @dc, no @damage/@condition (e.g., Kraken current: DC 23 STR or pushed)
  | 'damage_no_save'     // @damage, no @dc (e.g., Kraken vulnerability — debuff; pure auto-damage is rare)
  | 'summon'             // @creature + "up to N" (e.g., Lichen Lich shambling mound)
  | 'cast_spell'         // isSpell: true, spellName set (e.g., Aboleth phantasmal force)
  | 'buff_ally'          // advantage/vulnerability granted to allies (e.g., Mummy Lord undead advantage)
  | 'debuff_enemy'       // disadvantage/vulnerability imposed on enemies (e.g., Kraken lightning vulnerability)
  | 'visibility'         // obscured/fog/darkness (in-scope non-deferred; deferred ones use category 'deferred')
  | 'spell_slot_regen'   // regain spell slot (e.g., Lich d8)
  | 'movement'           // push/pull/knock/fall (folded into save_only when a save gates it)
  | 'deferred'           // in-scope-mechanically but awaiting a subsystem (gravity, magical-darkness, …)
  | 'bespoke'            // doesn't fit any category — needs a hand-written handler (Phase 3+)
  | 'flavor';            // out-of-scope (social/narrative — no combat mechanical effect)

export interface LairAction {
  /** Stable deterministic id: `${sourceCreature}::${index}` (0-based within the group). */
  id: string;
  /** Legendary group name (e.g., "Red Dragon"). The monster's `legendaryGroup.name`. */
  sourceCreature: string;
  /** Cleaned English text — 5eTools `{@tag arg|…}` tags reduced to their first arg. For logging/fallback. */
  rawText: string;
  /** true → log only, never executed (flavor/social). See docs/LAIR-ACTIONS-OUT-OF-SCOPE.md. */
  outOfScope: boolean;
  /** Stable registry id (`lair_oos_NNN`) when outOfScope. */
  outOfScopeId?: string;
  /** Subsystem tag when deferred ('gravity' | 'magical-darkness' | 'visibility' | 'dmg-hazard' | 'meta-time' | 'meta-initiative'). */
  deferred?: string;
  /** Stable registry id (`lair_def_NNN`) when deferred. */
  deferredId?: string;

  // ── [DD-4] Magical / spell tagging (per-action, no blanket rule) ──
  /** Default true (MM: "magical effects"). False only for purely physical effects (rare → flag [VERIFY]). */
  isMagical: boolean;
  /** true ONLY when the action explicitly casts a named spell. Drives GoI/Counterspell/Dispel interactions. */
  isSpell: boolean;
  /** Canonical spell name when isSpell (e.g., 'mirage arcane'). */
  spellName?: string;
  /** Base spell level when isSpell — for the GoI threshold check. Upcast level if the text specifies one. */
  castLevel?: number;

  // ── Extracted structure (all optional — presence depends on category) ──
  /** Saving-throw DC extracted from `{@dc N}`. */
  saveDC?: number;
  /** Save ability inferred from text ("Dexterity saving throw" → 'dex'). */
  saveAbility?: AbilityScore;
  /** Damage roll from `{@damage NdN}` + type from surrounding text ("fire damage"). */
  damage?: { count: number; sides: number; type: string };
  /** Conditions from `{@condition X}` (deduped, order of first appearance). */
  conditions?: Condition[];
  /** Summoned creature + count from `{@creature X}` + "up to N"/"N corpses rise as". */
  summons?: { creature: string; count: number | string };
  /** Range in feet inferred from "within N feet (of it)". */
  rangeFt?: number;
  /** Radius in feet inferred from "N-foot-radius" / "N-foot-radius sphere". */
  radiusFt?: number;
  /** Duration in rounds: 1 = "until initiative count 20 on the next round"; 10 = "1 minute"; Infinity = "until dismissed". */
  durationRounds?: number;
  /** true = affects the lair creature's enemies; false = allies/self. Inferred from "each creature other than the [creature]" vs "the [creature] casts Haste on themself". */
  targetsEnemies: boolean;
  /** Creature-type filter (pipe-separated) from "each gnoll or hyena" → 'gnoll|hyena'. */
  targetFilter?: string;

  /** Dispatcher routing tag (Phase 2+). `cast_spell` when isSpell; else by tag presence. */
  category: LairActionCategory;
}

export interface Combatant {
  // Identity
  id: string;
  name: string;
  isPlayer: boolean;
  faction: 'party' | 'enemy' | 'neutral';

  // ── Session 52 Creature Megabatch Batch 0: sourcebook provenance ──
  // The 5etools sourcebook code this creature was loaded from (e.g. 'MM',
  // 'DMG', 'VGM', 'MTF'). Always populated for monsters by
  // monsterToCombatant(); undefined for PCs. When the same creature name
  // appears in multiple sourcebooks (a genuine reprint), monsterToCombatant
  // ALSO appends the source as a subname suffix to `name` above
  // (e.g. "Goblin (VGM)") so callers can visually differentiate them.
  // See CREATURE-MEGABATCH-MIGRATION-PLAN.md Batch 0.
  source?: string;

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

  // ── Session 46 Task #29-follow-up-2: Character level for PCs ──
  // Optional. Set by buildCombatant from the sheet's total class level.
  // Used by features that depend on proficiency bonus (Remarkable Athlete,
  // Jack of All Trades, etc.). Monsters leave this undefined — their
  // proficiency is derived from CR via proficiencyBonus(cr).
  level?: number;

  // ── Session 47 Task #29-follow-up-4: Per-class levels for PCs ──
  // Optional. Set by buildCombatant from the sheet's classLevels array.
  // Maps class name → level (e.g. { Monk: 6, Fighter: 2 }). Used by
  // features that depend on a specific class's level (e.g. Wholeness of
  // Body heals 3 × monk level, not 3 × total level). Monsters leave this
  // undefined.
  classLevels?: Record<string, number>;

  // ── Session 47 Task #29-follow-up-5: Draconic ancestry for Sorcerers ──
  // Optional. Stores the damage type associated with the Draconic Bloodline
  // ancestry (e.g. 'fire', 'cold', 'lightning', 'acid', 'poison'). Used by
  // Elemental Affinity (Draconic Sorcerer 6, PHB p.102) to add CHA mod to
  // damage of spells matching the ancestry type. Set manually in tests or
  // by the character builder (future: UI for choosing ancestry at creation).
  draconicAncestry?: string;

  // Position (grid squares; 1 square = 5ft)
  pos: Vec3;

  // Actions
  actions: Action[];
  traits: string[];                       // trait names, for Pack Tactics etc.
  legendaryActions: LegendaryAction[];
  legendaryActionPool: number;            // resets at start of own turn
  legendaryActionPoolMax: number;

  /**
   * ── Session 52 Creature Megabatch Batch 3: Legendary Resistance ──
   *
   * MM p.11: "Legendary Resistance (N/Day). If the [creature] fails a saving
   * throw, it can choose to succeed instead." Used only by legendary creatures
   * (28 in MM: ancient/adult dragons, liches, kraken, tarrasque, etc.).
   *
   * Parsed from a trait named "Legendary Resistance (N/Day)" — N extracted
   * into `max`. `remaining` decrements on use; resets to `max` only on a
   * long rest (v1: per-combat only — monsters don't short-rest in combat).
   *
   * rollSave() consults this when the save FAILS: if remaining > 0, the
   * creature (v1 simplification: always, on any failed save) spends a use to
   * force success. Emit a log line so the result is visible.
   */
  legendaryResistance?: { max: number; remaining: number };

  /**
   * ── Session 52 Creature Megabatch Batch 4b: Regeneration ──
   *
   * MM p.11 / various: "The [creature] regains N hit points at the start of
   * its turn if it has at least 1 hit point." Some creatures have a stop
   * clause ("If the troll takes acid or fire damage, this trait doesn't
   * function at the start of the troll's next turn").
   *
   * `amount` = HP regained per turn. `stopTypes` = damage types that suppress
   * regen for one turn (e.g. ['acid','fire'] for trolls). `suppressedNextTurn`
   * is set true when the creature takes a stop-type damage; resetBudget()
   * checks it at start-of-turn and skips regen if true, then clears it.
   *
   * 13 MM creatures (all slaad, trolls, oni, vampire, etc.).
   */
  regeneration?: { amount: number; stopTypes: DamageType[]; suppressedNextTurn: boolean };

  /**
   * ── Session 52 Creature Megabatch Batch 4c: Magic Weapons ──
   * MM p.11 / various: "The [creature]'s weapon attacks are magical." 19 MM
   * creatures. When true, the creature's weapon attacks bypass resistance
   * to nonmagical B/P/S (the `cond:true` form in 5etools). v1 simplification:
   * the flag is PARSED and stored, but full nonmagical-resistance bypass
   * requires re-working Batch 1's unconditional cond-resistance handling to
   * honor an `isNonmagical` attack flag — deferred. The flag is consumed in
   * applyDamageWithTempHP when the attacker is known (combat.ts passes it).
   */
  attacksAreMagical?: boolean;

  /**
   * ── Session 52 Creature Megabatch Batch 4e: Swarm ──
   * MM p.11 / various: "The swarm can't regain hit points or gain temporary
   * hit points." 10 MM swarm creatures. When true, grantTempHP + healing
   * functions are no-ops on this combatant.
   */
  cannotRegainHP?: boolean;

  /**
   * ── Session 53 Creature Megabatch Batch 4d: Death Burst ──
   * MM p.215 (Mephits), p.215 (Magmin), p.138 (Gas Spore); also BGG hulks,
   * EGW Frost Worm, GGR Galvanice Weird, and ~20 more across pre-2024 sources.
   *
   * "When the [creature] dies, it explodes in a burst of [element]. Each
   * creature within N feet of it must make a [ability] saving throw, taking
   * XdY [type] damage on a failed save, or half as much on a successful one.
   * [Optional: on a failed save, a creature has the {condition} condition.]"
   *
   * `damage` = dice to roll (count + sides + bonus). `damageType` = the
   * damage type. `saveDC` + `saveAbility` = the save that halves. `radius`
   * = feet. `conditions` = optional list of conditions to apply on a FAILED
   * save (e.g. ['blinded'] for Dust Mephit, ['restrained'] for Mud Mephit).
   * `halfOnSuccess` = true for damage-dealing bursts (typical), false for
   * condition-only bursts (Mud Mephit, Dust Mephit — no damage).
   *
   * checkDeath() in combat.ts fires this when the creature drops to 0 HP.
   * v1 simplification: the burst hits ALL non-dead combatants in radius,
   * including allies (PHB p.X: most Death Bursts don't discriminate).
   */
  deathBurst?: {
    damage: DiceExpression | null;
    damageType?: DamageType;   // undefined when damage is null (condition-only bursts)
    saveDC: number;
    saveAbility: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
    radius: number;       // in feet
    conditions?: string[]; // applied on FAILED save
    halfOnSuccess: boolean;
  };

  /**
   * ── Session 53 Creature Megabatch Batch 4e: Sunlight Sensitivity ──
   * MM p.11 / various: "While in sunlight, the [creature] has disadvantage
   * on attack rolls, as well as on Wisdom (Perception) checks that rely on
   * sight." 120 creatures across pre-2024 sources (Drow, Kobolds, etc.).
   *
   * When true AND `battlefield.lightLevel === 'daylight'`, the creature has
   * disadvantage on attack rolls + sight-based Perception checks. v1
   * simplification: the engine default is `'indoors'` (no sunlight) so the
   * penalty never fires unless the scenario explicitly sets daylight.
   */
  sunlightSensitivity?: boolean;

  /**
   * ── Session 53 Creature Megabatch Batch 4e: Avoidance ──
   * MM p.11 / various: "If the [creature] is subjected to an effect that
   * allows it to make a saving throw to take only half damage, it instead
   * takes no damage if it succeeds on the saving throw, and only half
   * damage if it fails." 8 creatures (Displacer Fiend, etc.).
   *
   * Consumed in `rollSave` callers (combat.ts applyDamage paths): when the
   * target has Avoidance AND the effect allows save-for-half, flip the
   * outcomes (success → 0 damage, failure → half damage).
   */
  avoidance?: boolean;

  /**
   * ── Session 53 Creature Megabatch Batch 4e: Ambusher ──
   * MM p.11 / various: "During the first round of combat, the [creature]
   * has advantage on attack rolls against any creature that hasn't had a
   * turn yet." 10 creatures.
   *
   * Consumed in `resolveAttack`: if `state.round === 1` AND the target
   * hasn't acted this combat (tracked via `hadTurn` flag — to be added),
   * the attacker gains advantage.
   * v1 simplification: not yet wired into resolveAttack; flag is parsed
   * and stored for future engine integration.
   */
  ambusher?: boolean;
  // ── Session 60: Ambusher wired into engine ──
  // PHB/MM: "In the first round of combat, the [creature] has advantage on
  // attack rolls against any creature that hasn't taken a turn yet."
  // The engine checks this in resolveAttack when battlefield.round === 1 AND
  // the target hasn't completed a turn yet (tracked via _hasTakenTurn).
  // v1 simplification: advantage applies on ALL attack rolls in round 1 vs
  // targets that haven't gone yet, regardless of hidden/surprised status.

  /**
   * ── Session 53 Creature Megabatch Batch 4e: Brute ──
   * MM p.11 / various: "A melee weapon deals one extra die of its damage
   * when the [creature] hits with it (included in the attack)." 14 creatures.
   *
   * v1 simplification: flag is parsed and stored. The "extra die" is
   * typically already factored into the 5etools action damage entries, so
   * no engine change needed — the flag is metadata-only for now.
   */
  brute?: boolean;

  /**
   * ── Session 53 Creature Megabatch Batch 4e: False Appearance ──
   * MM p.11 / various: "If the [creature] is motionless at the start of
   * combat, it has advantage on its initiative roll. Moreover, if a
   * creature hasn't observed the [creature] move or act, that creature
   * must succeed on a [DC] check to discern that the [creature] is
   * animate." 100 creatures (animated objects, mimics, etc.).
   *
   * v1 simplification: flag is parsed and stored. The initiative-advantage
   * effect is not yet wired (would need a hook in rollInitiative).
   */
  falseAppearance?: boolean;
  // ── Session 60: False Appearance initiative-advantage variant ──
  // 27 of 83 False Appearance creatures have the variant: "If the [creature]
  // is motionless at the start of combat, it has advantage on its initiative
  // roll." The other 56 have the disguise-only variant (no initiative effect).
  // The parser sets this flag ONLY when the trait text mentions "initiative".
  // The engine grants advantage in rollInitiative when this flag is true.
  falseAppearanceInitAdv?: boolean;

  /**
   * ── Session 53 Creature Megabatch Batch 4e: Hold Breath ──
   * MM p.11 / various: "The [creature] can hold its breath for N minutes."
   * 57 creatures. v1 metadata-only (no drowning subsystem).
   */
  holdBreathMinutes?: number;

  /**
   * ── Session 53 Creature Megabatch Batch 4e: Water Breathing ──
   * MM p.11 / various: "The [creature] can breathe only underwater."
   * 33 creatures. v1 metadata-only.
   */
  waterBreathing?: boolean;

  /**
   * ── Session 53 Creature Megabatch Batch 4e: Siege Monster ──
   * MM p.11 / various: "The [creature] deals double damage to objects and
   * structures." 71 creatures. v1 metadata-only (no object HP subsystem).
   */
  siegeMonster?: boolean;

  /**
   * ── Session 53 Creature Megabatch Batch 4f: Superior Invisibility ──
   * MM p.321 (Faerie Dragons); also MM Ghost, Specter, Will-o'-Wisp, etc.
   * "As a bonus action, the [creature] can magically turn invisible until
   * its concentration ends (as if concentrating on a spell)."
   *
   * 15 pre-2024 creatures. When true, the AI planner self-casts invisibility
   * as a bonus action at the start of combat (or when not already invisible
   * + not concentrating). The effect: adds `invisible` condition (advantage
   * on attacks, disadvantage on attacks vs creature) + starts concentration.
   * Consumes the bonus action for that turn.
   */
  superiorInvisibility?: boolean;

  /**
   * ── Session 53 Creature Megabatch Batch 4f: Incorporeal Movement ──
   * MM p.11 / various: "The [creature] can move through other creatures and
   * objects as if they were difficult terrain. It takes 5 (1d10) force
   * damage if it ends its turn inside an object."
   *
   * 51 pre-2024 creatures (Ghosts, Specters, Shadow Demons, etc.).
   * v1 simplification: METADATA-ONLY. v1's movement engine doesn't do
   * per-step collision detection (creatures can already move through each
   * other's squares — the engine just calculates terrain cost). So this
   * flag documents RAW compliance without changing behavior. Future: when
   * collision detection is added (TG-007 LOS/wall subsystem), this flag
   * bypasses creature/object blocking. The 1d10 force damage for ending
   * inside an object is also skipped (no object subsystem in v1).
   */
  incorporealMovement?: boolean;

  /**
   * ── Session 53 Creature Megabatch Batch 4g: Charge ──
   * MM p.11 / various: "If the [creature] moves at least N feet straight
   * toward a target and then hits it with a [weapon] attack on the same
   * turn, the target takes an extra XdY [type] damage. If the target is a
   * creature, it must succeed on a DC N Strength saving throw or be pushed
   * up to M feet away and knocked prone."
   *
   * 49 pre-2024 creatures. The rider fires when:
   *   - The creature moved ≥ `minMoveFt` toward the target this turn
   *     (measured as: distance at turn start - distance now ≥ minMoveFt)
   *   - The creature hits with a melee attack
   * v1 simplification: "straight toward" is approximated as net movement
   * toward the target (Chebyshev distance decreased), not a literal
   * straight-line path.
   */
  charge?: {
    minMoveFt: number;
    damage: DiceExpression;
    damageType: DamageType;
    saveDC: number;
    pushFt?: number;      // optional push distance (0 = no push)
    knockProne: boolean;  // true if failed save knocks prone
  };

  /**
   * ── Session 53 Creature Megabatch Batch 4g: Pounce ──
   * MM p.11 / various: "If the [creature] moves at least N feet straight
   * toward a creature and then hits it with a [weapon] attack on the same
   * turn, that target must succeed on a DC N Strength saving throw or be
   * knocked prone. If the target is prone, the [creature] can make one
   * [weapon] attack against it as a bonus action."
   *
   * 24 pre-2024 creatures. Same movement trigger as Charge. The rider
   * applies a STR save vs prone. The bonus-action attack is v1-deferred
   * (would need planner integration to check if target is prone + queue
   * the bonus action — complex; the prone save is the main mechanical
   * effect).
   */
  pounce?: {
    minMoveFt: number;
    saveDC: number;
    bonusActionAttackName?: string;  // e.g. "Bite" — metadata only in v1
  };

  /**
   * ── Session 53 Creature Megabatch Batch 4g: Turn-start position tracking ──
   * Internal scratch field set by resetBudget() at the start of each turn.
   * Used by Charge/Pounce to check "did the creature move ≥N ft toward the
   * target this turn?" Compares _turnStartPos → current pos vs target pos.
   * Undefined on turn 1 (before first resetBudget call) — treated as
   * current position (no movement credit).
   */
  _turnStartPos?: Vec3;

  /**
   * ── Session 53 Creature Megabatch Batch 4h: Rejuvenation ──
   * MM p.11 / various: "If the [creature] is destroyed, it gains a new body
   * in [N time] if [condition], regaining all its hit points."
   *
   * 33 pre-2024 creatures (Lich, Mummy Lord, Revenant, Guardian Naga, etc.).
   * v1 simplification: METADATA-ONLY. v1 combats are single-encounter; the
   * creature dies → combat ends. Rejuvenation only matters in multi-day
   * adventuring-day scenarios (not yet simulated). The flag records:
   *   - reformTimeHours: N (1 hour for Flameskull, 24 for Mummy Lord,
   *     1d6 days = 144-864 hours for Guardian Naga — uses the min roll)
   *   - conditionText: the "if X" clause (phylactery intact, holy water
   *     not sprinkled, etc.) — stored as-is for future display/logic
   * Future: when multi-day simulation is added, a long-rest hook can
   * check this flag + conditionText to respawn the creature.
   */
  rejuvenation?: {
    reformTimeHours: number;
    conditionText?: string;  // e.g. "if its phylactery is intact"
  };

  /**
   * ── Session 60: Monster Spellcasting (Batch 5b step 1 — metadata-only) ──
   * 945 pre-2024 creatures have spellcasting data in 5etools. This field
   * stores the parsed spellcasting info for future engine integration
   * (Batch 5b step 2: planner + engine consumption — HIGH-risk, deferred).
   *
   * The parser extracts:
   *   - saveDC + spellAttackBonus + ability from the headerEntries text
   *   - atWill: spell names from the `will` array (at-will spells)
   *   - daily: spell name → uses/day from the `daily` object (1e/2e/3e keys)
   *
   * v1: metadata-only — NOT consumed by the engine. Future work: wire into
   * the planner so monsters cast spells from their list (needs SPELL_DB
   * lookup + spell-slot/daily-use tracking + AI spell selection).
   */
  monsterSpellcasting?: {
    saveDC?: number;
    spellAttackBonus?: number;
    ability?: 'int' | 'wis' | 'cha';
    atWill?: string[];                     // spell names (at-will)
    daily?: { [spellName: string]: number }; // spell name → uses per day
    // Slot-based spells (Lich, Mage, etc.): level → { slots, spellNames }
    // 0 = cantrips (slots = undefined = at-will). 1-9 = spell levels.
    slots?: { [level: number]: { max: number; spells: string[] } };
  };

  /**
   * ── Session 63 RFC-MONSTER-SPELLCASTING Phase 2+ (forward-compat) ──
   * Runtime spell-slot tracking for monsters with `monsterSpellcasting.slots`.
   * Initialized at combat start from `monsterSpellcasting.slots` (max per
   * level, remaining = max). Consumed by `consumeMonsterSpellSlot()` when a
   * monster casts a slotted spell. Phase 1 (this session) does NOT consume
   * these — at-will + cantrips are infinite. Phase 2 wires consumption.
   *
   * Optional — absent on monsters without slot-based spellcasting and on all
   * legacy combatants (backward-compatible).
   */
  monsterSpellSlots?: { [level: number]: { max: number; remaining: number } };

  /**
   * ── Session 63 RFC-MONSTER-SPELLCASTING Phase 3+ (forward-compat) ──
   * Runtime daily-use tracking for monsters with `monsterSpellcasting.daily`.
   * Initialized at combat start from `monsterSpellcasting.daily` (max per
   * spell, remaining = max). Consumed when a monster casts a daily-use spell.
   * Phase 1 (this session) does NOT consume these. Phase 3 wires consumption.
   *
   * Optional — absent on monsters without daily-use spells (backward-compat).
   */
  monsterDailyUses?: { [spellName: string]: { max: number; remaining: number } };

  /**
   * ── Session 60: Lair Actions (Batch 5a — metadata + basic engine hook) ──
   * ── Session 91: RFC-LAIRACTIONS Phase 1 — structured schema + tagging ──
   *
   * 115 legendary groups (from legendarygroups.json) carry lair actions
   * (~324 parsed options). PHB/MM: "On initiative count 20 (losing initiative
   * ties), the [creature] takes a lair action to cause one of the following
   * effects."
   *
   * Phase 1 (this session) restructured `actions` from `string[]` →
   * `LairAction[]`. Each option is now a structured object with:
   *   - extracted mechanical fields (saveDC, damage, conditions, summons, …)
   *     pulled from the 5eTools inline tags (`@dc`, `@damage`, `@condition`,
   *     `@spell`, `@creature`, …);
   *   - per-action `isMagical` / `isSpell` / `spellName` / `castLevel`
   *     tagging per [DD-4] (no blanket rule — each action read individually);
   *   - `outOfScope` / `deferred` registry tags with stable IDs
   *     (`lair_oos_NNN` / `lair_def_NNN`) for log searchability;
   *   - a `category` for the Phase 2+ dispatcher to route on.
   *
   * The engine stub (combat.ts round-start hook) still fires and logs
   * `action.rawText` — no mechanical effect yet (Phase 2 wires
   * `resolveLairActions` + category handlers; Phase 4 wires AI scoring).
   *
   * Future work (Phases 2–6): see docs/RFC-LAIRACTIONS.md §8.
   */
  lairActions?: {
    actions: LairAction[];       // structured per-action objects (Session 91; was string[])
    initiativeCount: number;     // usually 20 (PHB default)
  };

  /**
   * ── Session 92 RFC-LAIRACTIONS Phase 2: in-lair flag ([DD-1]) ──
   *
   * Default `true` when `lairActions` is defined (set by `monsterToCombatant`
   * in `src/parser/fivetools.ts`). Can be overridden to `false` via:
   *   - scenario JSON (a dragon ambushed in a field)
   *   - character-builder monster-import path (settable toggle, default on)
   *   - direct mutation in tests
   *
   * When `isInLair === false`, the engine's `resolveLairActions(state)` skips
   * this creature entirely — even though `lairActions` is still populated on
   * the data, no lair action fires at the initiative-count-20 boundary.
   *
   * When `undefined`, the engine treats the creature as NOT in its lair (same
   * as `false`) — EXCEPT in the parser-default path, where `monsterToCombatant`
   * explicitly sets `isInLair = true` whenever `lairActions` is non-undefined,
   * so parsed lair creatures are always in-lair unless overridden.
   */
  isInLair?: boolean;

  /**
   * ── Session 92 RFC-LAIRACTIONS Phase 2: numeric initiative ([DD-2]) ──
   *
   * PHB/MM: "On initiative count 20 (losing initiative ties), the [creature]
   * takes a lair action." Resolving lair actions at the correct point in the
   * turn order requires the numeric initiative score, not just the relative
   * ordering of IDs.
   *
   * Populated by `rollInitiative()` (`src/engine/utils.ts:911`) — every
   * combatant gets its rolled initiative stored here in addition to the
   * ordered ID array that function returns. Can also be set manually in
   * tests / scenarios that pre-roll initiative (e.g. `c.initiativeScore = 25`).
   *
   * The round loop in `runCombat` (`src/engine/combat.ts`) uses this to find
   * the boundary between creatures with initiative ≥ 20 and those with < 20;
   * lair actions fire AFTER the ≥-20 creatures and BEFORE the <-20 creatures.
   *
   * When `undefined` (legacy scenarios passing only `initiative: string[]`
   * without scores), the boundary check treats the score as 0 → lair actions
   * fire at the START of the round (the original Session 60 stub behavior —
   * graceful degradation, not PHB-accurate).
   */
  initiativeScore?: number;

  /**
   * ── Session 92 RFC-LAIRACTIONS Phase 2: lair-action history ([DD-5]) ──
   *
   * PHB: "It can't use the same effect two rounds in a row." Per-creature
   * rolling window of the last 2 chosen action IDs (`LairAction.id`).
   *
   * `resolveLairActions(state)` excludes any action whose ID is in this list
   * from the candidate set. After each lair action, the chosen ID is appended
   * and the list is truncated to length 2.
   *
   * Edge case: if all available actions are in the history (only possible
   * when the creature has ≤2 options), the creature SKIPS its lair action
   * that round (PHB: "can't use the same effect two rounds in a row" — there
   * is no legal option).
   *
   * Scratch field — never serialized, cleared implicitly at combat start
   * (a fresh `Combatant` object has `undefined` here).
   */
  _lairActionHistory?: string[];

  /**
   * ── Session 61: Shapechanger (monster trait, Phase 1) ──
   * 76 pre-2024 creatures have a "Shapechanger" trait. Per the RFC
   * (docs/RFC-SHAPECHANGER.md), Phase 1 covers only the monster trait
   * (Type A — most keep their stats; only size/speed/AC change per form).
   *
   * Phase 1 design (RFC §3 Phase 1):
   *   - Parser extracts form names + size/speed/AC changes from trait text.
   *   - Engine `case 'shapechange':` swaps the listed fields, saving the
   *     original values to `_originalStatsForShapechange` on first transform
   *     so the creature can revert to its true form later.
   *   - Planner: if the creature has shapechanger forms and is in true form,
   *     consider transforming on turn 1 if beneficial (e.g., needs fly speed
   *     to reach a far enemy).
   *
   * v1 simplifications:
   *   - "Statistics, other than size and speed, are the same" → only size +
   *     speed (walk/fly/climb/swim) + AC are tracked per form. Other form
   *     text (e.g., mist form's "immune to nonmagical damage") is captured
   *     as flags but NOT all are mechanically applied (per-form bespoke
   *     implementation would be HIGH-risk; deferred to Phase 4).
   *   - "Reverts to true form if it dies" — handled in the engine's death
   *     hook (reset form for logging purposes; no mechanical effect since
   *     the creature is dead).
   *   - Druid Wild Shape (Phase 2) + Polymorph (Phase 3) NOT covered — they
   *     require full stat replacement, deferred.
   *
   * The `_currentForm` scratch field tracks which form is active. 'true'
   * means the creature is in its original (un-transformed) form.
   */
  shapechangerForms?: ShapechangerForm[];
  _currentForm?: string;                    // scratch: name of the active form ('true' = original)
  _originalStatsForShapechange?: {          // scratch: original stats for revert
    size?: CreatureSize;
    speed: number;
    flySpeed: number | null;
    swimSpeed: number | null;
    burrowSpeed: number | null;
    ac: number;
  };

  // Turn resources
  budget: ActionBudget;

  // Conditions
  conditions: Set<Condition>;

  // ── RFC-COMBINING-EFFECTS Phase 4: source-tracked condition map ──
  // Maps each condition to the Set of sourceIds that impose it.
  //   - 'non-spell' is a reserved sourceId for conditions added via
  //     addCondition() (monster traits, class features, combat mechanics).
  //   - Spell-sourced conditions use the effect.id from activeEffects.
  //
  // _rederiveConditions() rebuilds `conditions` by checking each sourceId:
  //   'non-spell' always counts; effect IDs count only if the effect
  //   still exists in activeEffects and is unsuppressed.
  //
  // This replaces the old _nonspecllConditions approach, which couldn't
  // distinguish expired spell conditions from non-spell conditions.
  _conditionSources?: Map<Condition, Set<string>>;

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
    // ── Session 24 — Witch Bolt linked-target tracking ──────────────
    // Optional: the id of the target linked to a per-turn concentration
    // DoT (Witch Bolt, PHB p.289). null/undefined for concentration
    // spells with no single linked target (Hex, Bless, Barkskin, etc.).
    // Backward-compatible: existing concentration objects don't set this
    // field, so it's undefined (treated as "no linked target").
    targetId?: string | null;
  } | null;

  // Death saving throws (PHB p.197) — PCs only
  // Monsters die outright at 0 HP; PCs fall unconscious and roll saves.
  deathSaves: {
    successes: number;           // 0–3: 3 successes = stable
    failures:  number;           // 0–3: 3 failures  = dead
  } | null;                      // null for non-PC combatants

  // Class resources (PCs only — null for monsters)
  resources: PlayerResources | null;

  // ── Session 38 — Warlock Eldritch Invocations ──
  // List of Eldritch Invocation names this combatant knows (PHB p.110).
  // Populated by the parser/leveler for Warlock PCs; undefined or empty for
  // non-Warlocks. Checked by the engine at invocation trigger points (e.g.
  // Repelling Blast fires after an Eldritch Blast hit if 'Repelling Blast'
  // is in this list).
  eldritchInvocations?: string[];

  // ── Session 42 — Warlock Pact Boon (PHB p.108) ──
  // 'chain' = Pact of the Chain (familiar variant)
  // 'blade' = Pact of the Blade (creates a pact weapon — enables Thirsting Blade)
  // 'tome'  = Pact of the Tome (3 cantrips from any class list)
  // Set at Warlock level 3 via choosePactBoon() in improvements.ts.
  // The engine checks this for Thirsting Blade (requires 'blade').
  pactBoon?: 'chain' | 'blade' | 'tome';

  // ── Session 43 — Class Features (for Extra Attack, etc.) ──
  // List of class/subclass feature NAMES the combatant has (e.g. 'Extra Attack',
  // 'Extra Attack (2)', 'Extra Attack (3)', 'Action Surge (1/rest)', etc.).
  // Populated by buildCombatant() from sheet.allFeatures (filtered to source
  // 'class' or 'subclass'). Undefined for monsters (no class features).
  // Checked by the planner to set attackCount for Extra Attack (Fighter 5+,
  // Paladin 5+, Ranger 5+, Barbarian 5+, Monk 5+) and Extra Attack (2)/(3)
  // for Fighter 11/20.
  classFeatures?: string[];

  // Temporary HP (absorbs damage before real HP)
  tempHP: number;

  // Exhaustion level (PHB p.291): 0 = none, 1–6 graduated effects.
  // Separate from conditions Set — exhaustion is a 7-level graduated state.
  exhaustionLevel: number;  // 0–6, default 0

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
  role: 'familiar' | 'mount' | 'combat_mount' | 'companion' | 'regular';  // creature type/role
  bonded: string | null;       // ID of bonded caster (for familiars) or bonded companion owner

  // Creature type (MM p.6) — e.g. 'beast', 'humanoid', 'undead', 'fiend'.
  // Set from bestiary `type` (fivetools.ts) or 'humanoid' for PCs (pc.ts).
  // Used by spells with creature-type restrictions: Animal Friendship (beast),
  // Charm Person (humanoid), Dominate Beast (beast), Dominate Person (humanoid).
  // Optional — undefined means "unknown" (spells that require a type will skip).
  // Session 27 canon fix (TG-004): closes the creature-type enforcement gap.
  creatureType?: string;

  // Per-turn flags (reset by engine at start of each turn)
  usedSneakAttackThisTurn: boolean;  // Rogue: once per turn only
  helpedThisTurn: boolean;     // Familiar/ally used Help action this turn; grants advantage to next attack
  _graspOfHadarUsedThisTurn?: boolean;  // Session 80: Grasp of Hadar once per turn (PHB p.111)

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

  // Damage immunities (PHB p.197): incoming damage of listed types is reduced to 0.
  // Populated by racial traits (e.g. Tiefling fire resistance is a resistance, not
  // immunity; construct undead are typically immune to poison), monster stat blocks
  // (e.g. Fire Elemental immune to fire, Couatl immune to radiant/psychic), and
  // spells/items (e.g. Potion of Fire Resistance gives resistance, not immunity).
  // Use addImmunity() / removeImmunity() helpers to avoid duplicates.
  // Immunity takes precedence over resistance and vulnerability — an immune creature
  // takes 0 damage regardless of any resistance/vulnerability entries.
  //
  // OPTIONAL: undefined is treated as "no immunities" (equivalent to []) for
  // backwards compatibility with existing Combatant factories that pre-date the
  // immunities field. New code should set this explicitly to [] when constructing
  // a Combatant.
  immunities?: DamageType[];

  // ── Session 52 Creature Megabatch Batch 1: damage vulnerabilities ──
  // PHB p.197: incoming damage of listed types is DOUBLED. NOTE this is
  // SEPARATE from `vulnerabilities: AdvantageEntry[]` above — that field
  // tracks d20-roll vulnerabilities (Dodge/Reckless Attack style: attacks
  // vs you have adv/disadv), NOT damage-type vulnerabilities.
  //
  // Creature Megabatch Batch 1 introduced this field so 5etools-parsed
  // creatures (e.g. Skeletons vuln to bludgeoning) gain their damage-type
  // vulnerability. applyDamageWithTempHP() in utils.ts consumes it:
  // vulnerability applies FIRST (PHB p.197) — before resistance halves
  // and before immunity zeroes (immunity still overrides vulnerability).
  //
  // OPTIONAL: undefined is treated as "no damage vulnerabilities" (equivalent
  // to []); existing test factories don't need updates.
  damageVulnerabilities?: DamageType[];

  // ── Session 52 Creature Megabatch Batch 1: condition immunities ──
  // Condition NAMES (e.g. 'charmed', 'frightened', 'paralyzed') this creature
  // is immune to, parsed from 5etools `conditionImmune`. applyCondition (the
  // internal name for `addCondition` in utils.ts) checks this and skips
  // application. PHB p.197: condition immunity = the condition is never
  // applied to the creature.
  //
  // Names are lowercased to match the engine's `Condition` type strings.
  // OPTIONAL: undefined = no condition immunities; existing factories don't
  // need updates.
  conditionImmunities?: string[];

  // ── Session 52 Creature Megabatch Batch 2: save/skill/senses proficiencies ──
  // Parsed from 5etools `save` / `skill` / `senses` / `passive` fields. These
  // let monsters use their listed save bonuses (e.g. Adult Red Dragon CON save
  // +13) instead of the default abilityMod + profBonus(CR) derivation, and
  // record vision modes + passive perception for future LOS work (TG-007).

  /** Save bonuses per ability (e.g. { con: 13, dex: 6 }). When set for an
   *  ability, rollSave() uses this TOTAL bonus instead of abilityMod + prof.
   *  The 5etools `save` field value is the full listed bonus (ability mod +
   *  proficiency already folded in) — do NOT double-add proficiency. */
  saveProficiencies?: Partial<Record<AbilityScore, number>>;

  /** Skill bonuses per skill name (e.g. { perception: 13, stealth: 6 }).
   *  Not yet consumed by the engine (no skill-check subsystem in v1 combat);
   *  recorded as metadata for future work. */
  skillProficiencies?: Record<string, number>;

  /** Vision modes + passive perception, parsed from 5etools `senses` +
   *  `passive`. Range in feet (e.g. { darkvision: 120, blindsight: 60,
   *  passivePerception: 23 }). Consumed by the perception subsystem
   *  (RFC-VISION-AUDIO Phase 2-3). */
  senses?: {
    darkvision?: number;
    blindsight?: number;
    truesight?: number;
    tremorsense?: number;
    passivePerception?: number;
    /**
     * ── Session 63 RFC-COMBINING-EFFECTS: Devil's Sight ──
     * Parsed from the "Devil's Sight" monster trait (MM: Imp, Barbed Devil,
     * Horned Devil, etc.) — "Magical darkness doesn't impede the devil's
     * darkvision" — OR granted by the Warlock Eldritch Invocation of the same
     * name (PHB p.110) — "You can see normally in darkness, both magical and
     * nonmagical, out to a range of 120 feet."
     *
     * The INVOCATION is STRONGER: it grants sight in ALL darkness (magical +
     * natural) out to 120 ft, regardless of whether the Warlock has darkvision.
     * The MONSTER TRAIT only extends existing darkvision to magical darkness.
     * Both set devilsSight = true; the builder bumps darkvision to ≥ 120 for
     * the invocation (see src/characters/builder.ts).
     *
     * Distinct from darkvision: Devil's Sight lets the creature see through
     * MAGICAL darkness (obstacles where isMagicalDarkness === true), which
     * normal darkvision cannot. Consumed by isVisionBlocked() in los.ts.
     *
     * Stored as boolean (not a range) — the range is the creature's darkvision
     * range (monster trait) or 120 ft (invocation, builder-enforced).
     */
    devilsSight?: boolean;
  };

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

  // ── Session 39 — Lance of Lethargy Eldritch Invocation (XGE p.157) ──
  // Speed reduction scratch state. Mirrors Ray of Frost's pattern:
  //   - _lanceOfLethargyOriginalSpeed: stored the first time the invocation
  //     hits (prevents double-store on multi-hit / multi-caster scenarios)
  //   - _hasLanceOfLethargy: flag indicating the speed is currently reduced
  // Cleanup is inlined in resetBudget (utils.ts) to avoid a circular
  // dependency (utils.ts ↔ _invocations.ts).
  _lanceOfLethargyOriginalSpeed?: number;
  _hasLanceOfLethargy?: boolean;

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

  // ---- Creature type flag (for spells like Spare the Dying, PHB p.277) ----
  // True when the creature is a Construct. Optional — undefined is treated as "not
  // a construct". Populated by the parser from the monster `type` field when
  // available; tests may set it directly. Used by Spare the Dying (constructs are
  // excluded), poison-based spells (constructs are immune to poison damage and
  // the poisoned condition), and other construct-specific interactions.
  isConstruct?: boolean;

  // ---- Summon subsystem (TG-006) ----
  // True when this combatant was spawned by a Summon/Conjure spell.
  // Set by spawnSummon() when the summon is created. Used by:
  //   - removeEffectsFromCaster to despawn on concentration break
  //   - AI planner to skip summoning creatures that are already summons
  //   - Combat log to tag summon-related events
  isSummon?: boolean;

  // The ID of the combatant who summoned this creature.
  // Used for: (a) concentration-break despawn, (b) faction inheritance,
  // (c) verbal command routing.
  summonerId?: string;

  // The spell name that created this summon (e.g. 'Summon Beast').
  // Used for logging and cleanup identification.
  summonSpellName?: string;

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

  // ---- Booming Blade (TCE p.106) movement rider ----
  // Session 48: migrated from scratch fields (_boomingBladePendingDamageDice /
  // _boomingBladeCasterId) to a typed ActiveEffect with effectType 'movement_rider'
  // in target.activeEffects. See RFC-001 in TEAMGOALS.md.

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

  // ---- Session 27 — Batch 3 smite spells (next-hit rider) ----
  // Generic one-shot rider for the 11 Batch 3 smite spells (Ensnaring Strike,
  // Hail of Thorns, Searing Smite, Thunderous Smite, Wrathful Smite, Zephyr
  // Strike, Blinding Smite, Lightning Arrow, Spirit Shroud, Staggering Smite,
  // Banishing Smite). Set by execute() on cast; consumed by resolveAttack's
  // damage branch on the caster's next weapon hit (melee/ranged, NOT spell).
  //
  // On consumption: rolls `count`d`dieSides` of `damageType` (crit doubles the
  // dice — PHB p.196), adds to damage, and — if `condition` is set — applies
  // that condition to the target hit (sourceIsConcentration: true so it ends
  // if the smite's concentration breaks). Then sets `_nextHitRider = null`
  // (one-shot — PHB: "the next time you hit a creature with a weapon attack").
  //
  // Each smite's cleanup() clears this if `spellName` matches (concentration
  // broke before the next hit → rider is wasted, no condition applied).
  _nextHitRider?: {
    spellName: string;
    dieSides: number;
    count: number;
    damageType: DamageType;
    condition?: Condition;     // optional: applied to the target hit (conc-sourced)
    /** Optional forced movement on hit (PHB p.282: Thunderous Smite pushes 10 ft).
     *  The target is pushed directly away from the attacker by this many feet
     *  (rounded to grid cells). Ignored on a miss. v1 does NOT model the
     *  "Large or smaller" size restriction (PHB p.282) — the push applies to
     *  any target on a hit. */
    pushFt?: number;
  } | null;

  // ---- Absorb Elements (TG-008, XGE p.150) scratch fields ----
  // Set on the CASTER when it casts Absorb Elements as a reaction to taking
  // acid/cold/fire/lightning/poison/thunder damage. Two fields:
  //
  //   _absorbElementsResistance — the damage type the caster now has
  //   resistance to (until the start of their next turn). Added to
  //   `resistances` on cast; removed by `cleanupAbsorbElements` in
  //   `resetBudget`. PHB-style: "you have resistance to that damage type
  //   until the start of your next turn."
  //
  //   _absorbElementsRider — the extra damage to add to the caster's next
  //   melee weapon attack (1d6 of the triggering type, +1d6 per slot level
  //   above 1st). Consumed by `resolveAttack`'s damage branch on the next
  //   melee hit, then cleared. PHB: "the first time you hit with a melee
  //   attack on your next turn, the target takes an additional 1d6 damage
  //   of the triggering type." v1 simplification: the rider applies on the
  //   next melee hit regardless of whose turn it is (so an OA melee hit
  //   would also consume it) — this matches the "first time you hit" wording.
  _absorbElementsResistance?: DamageType | null;
  _absorbElementsRider?: { damageType: DamageType; diceCount: number } | null;

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

  // ---- Session 60: Ambusher turn tracking ----
  // Set to true at the END of this combatant's first turn (in runCombat, after
  // executeTurnPlan completes). Used by the Ambusher trait: "In the first round
  // of combat, advantage on attack rolls against any creature that hasn't taken
  // a turn yet." The check in resolveAttack: `attacker.ambusher && round === 1
  // && !target._hasTakenTurn`. Persists for the entire combat (never reset) —
  // correct because Ambusher only fires in round 1, and by round 2 all
  // combatants have _hasTakenTurn = true.
  _hasTakenTurn?: boolean;

  // ---- Session 62 RFC-VISION-AUDIO Phase 1: Stealth roll scratch field ----
  // Set by tryHide() in perception.ts when a combatant successfully Hides.
  // Stores the Dexterity (Stealth) check total so that active Perception
  // actions (tryActivePerception) can contest it. Cleared when 'hidden' is
  // removed (attack, cast with verbal component, active Perception success).
  // v1 simplification: a single value (no per-enemy tracking); 5e RAW is
  // that one Stealth check contests all enemies' passive Perception, and
  // an active Perception check is a direct contest vs the same Stealth total.
  _stealthRoll?: number;

  // ---- Eyebite (PHB p.238) scratch field ----
  // Set on the CASTER when Eyebite is cast. Stores the save DC so that the
  // per-turn re-target can roll saves against the correct DC. While set and
  // the caster is concentrating on Eyebite, the combat.ts runCombat loop
  // automatically re-targets a new enemy at the start of the caster's turn
  // (v1 simplification: the re-target is automatic, like damage_zone ticks,
  // rather than consuming the caster's action as canon requires).
  // Concentration spell — removed by removeEffectsFromCaster when concentration
  // breaks (via damage_zone sentinel with dieCount=0 in _undoEffect).
  _eyebiteActive?: { saveDC: number };

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

  // ---- Save-fail tracker (Contagion / Flesh to Stone) -----------
  // Per-target save-fail tracker for escalating conditions.
  // Contagion (PHB p.227): hit → poisoned; 3 fails → poisoned + incapacitated;
  //   3 successes → disease ends (poisoned removed). NO concentration.
  // Flesh to Stone (PHB p.241): fail → restrained; 3 fails → petrified;
  //   3 successes → spell ends. Concentration.
  // Set by the spell's execute() and processed at the start of the target's
  // turn in combat.ts's runCombat loop. Cleared when the tracker resolves
  // (3 fails or 3 successes) or when the matching active effect is removed.
  _saveFailTracker?: SaveFailTracker;

  // ---- Reverse Gravity (PHB p.277) fall-damage scratch field ----
  // Height in feet the creature has been lifted by Reverse Gravity.
  // When concentration breaks, the creature falls back down and takes
  // fall damage: 1d6 per 10 ft (PHB p.183). For 100 ft: 10d6 bludgeoning.
  // Set by reverse_gravity.ts execute(); cleared by processFallDamage()
  // in combat.ts after concentration break removes the effect.
  _fallHeight?: number;

  // ---- Moving Zone scratch field (Flaming Sphere / Moonbeam / Call Lightning / Cloudkill) ----
  // Tracks the position of a movable damage_zone. At the start of the caster's
  // turn, the zone moves toward the highest-threat enemy and re-applies damage
  // to creatures in its new position.
  // v1 simplification: movement is automatic (no action cost), always toward
  // the highest-threat enemy. Canon requires an action/bonus action to move.
  _movingZone?: {
    spellName: string;
    centerX: number;
    centerY: number;
    centerZ: number;
    radiusFt: number;     // radius of the zone in feet
    movePerTurn: number;  // how far the zone can move each turn (ft)
  };

  // ── Session 89: Aura of Vitality per-turn re-heal ──
  // PHB p.216: "You can use a bonus action to cause one creature in the
  // aura (including you) to regain 2d6 hit points." Set when the spell is
  // cast; checked at the start of each of the caster's subsequent turns.
  // Cleared when concentration breaks (removeEffectsFromCaster) or when
  // the spell expires. The per-turn heal targets the most-wounded ally
  // (including self) within 30 ft.
  // v1 simplification: the heal fires automatically at the start of the
  // caster's turn (no bonus action cost — mirrors the Eyebite pattern).
  _auraOfVitalityActive?: {
    healDie: number;       // 6 (d6)
    healDieCount: number;  // 2 (2d6)
    rangeFt: number;       // 30
  };

  // ---- Short-rest subsystem (PHB p.186) -------------------------
  // Hit Dice: a character has hit dice equal to their level. On a short
  // rest, they can spend one or more Hit Dice to regain HP. For each Hit
  // Die spent, roll 1d(hitDieSize) + CON modifier (minimum 1).
  // hitDieSize: size of the hit die — d6/d8/d10/d12 based on class
  //   (Barbarian=d12, Fighter=d10, Bard/Cleric/Druid/Monk/Rogue/Warlock=d8,
  //    Sorcerer/Wizard=d6). Default d8 if unset.
  // hitDiceRemaining: number of hit dice still available to spend.
  //   Equal to level minus hit dice spent since last long rest.
  //   Default 1 if unset (most v1 combatants are low-level).
  // Set by the parser/PC creation code; tests may set directly.
  hitDieSize?: number;          // d6/d8/d10/d12 (default d8)
  hitDiceRemaining?: number;    // remaining hit dice (default 1)
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
  /**
   * ── Session 63 RFC-COMBINING-EFFECTS: magical darkness flag ──
   * Set to true by the Darkness spell (PHB p.230) and any other source of
   * MAGICAL darkness that explicitly blocks darkvision. Per the user's
   * directive: "magical darkness only blocks darkvision if the cause source
   * explicitly says so (e.g. the spell Darkness). Other sources will allow
   * darkvision to see."
   *
   * - Darkness spell (PHB p.230): "A creature with darkvision can't see
   *   through this darkness" → isMagicalDarkness = true, blocksVision = true.
   * - Fog Cloud (normal obscurement): isMagicalDarkness = undefined, blocksVision = true.
   * - Natural darkness (lightLevel: 'darkness'): no obstacle; handled by lightLevel.
   *
   * Devil's Sight (monster trait / Warlock invocation): "Magical darkness
   * doesn't impede the devil's darkvision." An observer with `senses.devilsSight`
   * can see through obstacles where isMagicalDarkness === true (their darkvision
   * penetrates magical darkness). Implemented in hasLineOfSight() + isVisuallyDetected().
   */
  isMagicalDarkness?: boolean;
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
  // Combatant IDs to be inserted into initiativeOrder mid-combat.
  // TCE Summon spells: "shares your initiative count, takes turn after yours"
  // PHB Conjure spells: "roll initiative as a group"
  // Processed by the runCombat loop after each actor's turn.
  pendingInitiativeInserts?: Array<{
    combatantId: string;
    insertAfterId: string;   // for TCE-style "after caster"
  }>;
  // No-damage tracking: consecutive rounds each team dealt 0 damage.
  // Reset to 0 whenever a team deals ≥1 damage in a round.
  // At 10 consecutive rounds → team is auto-defeated.
  noDamageRounds?: Map<string, number>;   // keyed by faction
  // Session 53 Batch 4e: Sunlight Sensitivity — when set to 'daylight',
  // creatures with `sunlightSensitivity: true` have disadvantage on attack
  // rolls + sight-based Perception checks. Default (absent) is treated as
  // 'indoors' (no sunlight) for v1 simplicity. Scenarios can override.
  //
  // Session 63 RFC-VISION-AUDIO Phase 2: added 'darkness' option for
  // night/underground combats. In 'darkness', normal vision CANNOT see
  // (creatures without darkvision are effectively blinded); darkvision sees
  // (as dim light); blindsight/truesight/tremorsense see normally.
  lightLevel?: 'indoors' | 'daylight' | 'dim' | 'darkness';
  // LOS/Cover: static obstacles on the map (walls, pillars, doors, fog, etc.)
  // Optional — absent means open terrain (no cover calculations).
  obstacles?: Obstacle[];
  // Difficult terrain cells from terrain_zone spells (Grease, Sleet Storm, etc.)
  // Keyed by "x,y,z" — matches posKey() format from movement.ts.
  // Added/removed when terrain_zone effects with terrainDifficulty:true are
  // applied/removed. Checked by the terrainFn passed to estimateMoveCostFt
  // in executeMove().
  difficultTerrainCells?: Set<string>;
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
  // ── Session 43 Task #23: Action Surge (Fighter 2+, PHB p.72) ──
  // An extra ACTION granted by Action Surge. Executes AFTER the main action
  // and bonus action, consuming one actionSurge use. Like the main action,
  // it can be any action type — but v1 always plans it as an Attack on the
  // same target (for damage maximization). The attackCount is set by the
  // same Extra Attack logic as the main action (so a Fighter 5+ with Action
  // Surge makes 4 attacks total: 2 from main + 2 from extra). The engine's
  // executeTurnPlan calls executePlannedAction again for this extra action.
  extraAction?: PlannedAction | null;
}

export interface PlannedAction {
  type:
    | 'attack' | 'cast' | 'dash' | 'disengage' | 'dodge'
    | 'help' | 'hide' | 'ready' | 'shove' | 'grapple' | 'escapeGrapple'
    | 'secondWind' | 'rage' | 'layOnHands' | 'bardicInspiration'
    | 'wholenessOfBody'  // Open Hand Monk 6 — self-heal 3×monk level, 1/long rest (PHB p.79)
    | 'draconicPresence' // Draconic Sorcerer 18 — frighten aura, WIS save, 1/combat (PHB p.102)
    | 'quiveringPalm'    // Open Hand Monk 17 — touch + CON save, instakill on fail / 10d10 necrotic on success, 3 ki (PHB p.80)
    | 'flurryOfBlows'    // Monk 2 — bonus action, 1 ki, 2 unarmed strikes; Open Hand Technique rider fires after (PHB p.78 + p.79)
    | 'spellHeal'    // legacy — no longer dispatched; retained for test compatibility
    | 'cureWounds'  // Cure Wounds — action, 1d8+mod heal per slot level, touch range (PHB p.230)
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
    | 'shadowOfMoil'     // Shadow of Moil — self, disadv on attacks vs caster + 2d8 necrotic rider, concentration 1 min (Warlock)
    | 'blindnessDeafness'// Blindness/Deafness — CON save or blinded, 1 min, NO concentration (Cleric/Sorcerer/Wizard)
    | 'brandingSmite'    // Branding Smite — bonus action, next weapon hit +2d6 radiant, concentration 1 min (Paladin/Ranger)
    | 'superiorInvisibility' // Session 53 Batch 4f: creature trait (Faerie Dragon, etc.) — bonus action self-cast invisibility, concentration
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
    | 'createBonfire'      // Create Bonfire — 60 ft, DEX save 1d8 fire + persistent damage_zone, concentration 1 min (cantrip)
    | 'heatMetal'          // Heat Metal — 60 ft, CON save 2d8 fire + persistent damage_zone, concentration 1 min
    | 'melfsAcidArrow'     // Melf's Acid Arrow — ranged spell attack, 4d4 acid + 2d4 delayed, 90 ft
    | 'mistyStep'          // Misty Step — BONUS ACTION, self teleport 30 ft, no concentration
    | 'invisibility'       // Invisibility — touch, grants invisible condition, concentration 1 hr
    | 'greaterInvisibility' // Greater Invisibility — self, grants invisible condition (no ends-on-attack), concentration 1 min
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
    // ── Session 23 — Real-mechanics migration batch 2 (7 high-damage spells L4-9) ──
    // Migrated from the Session 19 generic dispatch registry to bespoke
    // implementations with real mechanical effects (CON/DEX saves, HP-check
    // instakill, AoE damage + blindness). Mirrors the Session 22 bespoke
    // patterns (Catapult for single-target saves, Shatter/Fireball for AoE
    // saves, plus a NEW HP-check instakill pattern for Power Word Kill).
    // Each migrated spell:
    //   - Removed from _generic_registry.ts
    //   - Has its own case branch in combat.ts executePlannedAction
    //   - Has its own planner branch in planner.ts
    //   - Has its own test file in src/test/<spell>.test.ts
    | 'blight'             // Blight — PHB p.219: 30 ft, CON save 8d8 necrotic (half on save), single-target, NO concentration
    | 'cloudkill'          // Cloudkill — PHB p.222: 120 ft, CON save 5d8 poison (half on save), 20-ft radius AoE (v1: one-shot — moving-AoE simplified), NO concentration
    | 'disintegrate'       // Disintegrate — PHB p.233: 60 ft, DEX save 10d6+40 force (half on save), single-target + disintegrate-on-0-HP (simplified), NO concentration
    | 'harm'               // Harm — PHB p.249: 60 ft, CON save 14d6 necrotic (half on save), single-target + max-HP-reduction (simplified), NO concentration
    | 'fingerOfDeath'      // Finger of Death — PHB p.241: 60 ft, CON save 7d8+30 necrotic (half on save), single-target + zombie-raise-on-kill (simplified, TG-006 pending), NO concentration
    | 'sunburst'           // Sunburst — PHB p.284: 150 ft, CON save 12d6 radiant (half on save), 60-ft radius AoE + blinded on failed save, NO concentration
    | 'powerWordKill'      // Power Word Kill — PHB p.266: 60 ft, NO save, NO attack — instakill if currentHP ≤ 100, NO concentration
    // ── Session 24 — Megabatch batch 1 (L1 combat damage spells) ──
    // Migrated from the Session 19/20 generic dispatch registry to bespoke
    // implementations with real mechanical effects (ranged spell attacks,
    // AoE saves + conditions, auto-hit, single-target saves, and a NEW
    // per-turn concentration-DoT pattern for Witch Bolt). Mirrors the
    // Session 21/22/23 bespoke patterns (Chromatic Orb, Scorching Ray,
    // Shatter, Sunburst, Catapult, Inflict Wounds, Magic Missile).
    // Each migrated spell:
    //   - Removed from _generic_registry.ts (no longer dispatched via 'genericSpell')
    //   - Has its own case branch in combat.ts executePlannedAction
    //   - Has its own planner branch in planner.ts
    //   - Has its own test file in src/test/<spell>.test.ts
    | 'chaosBolt'           // Chaos Bolt — XGE p.151: 120 ft, ranged spell attack 2d8 random-type (chaos), crit doubles, NO concentration
    | 'earthTremor'         // Earth Tremor — XGE p.155: Self (10-ft radius), CON save 1d6 bludgeoning + prone on fail, caster excluded, NO concentration
    | 'frostFingers'        // Frost Fingers — XGE p.161: Self (15-ft cone), CON save 2d8 cold (half on save), NO concentration
    | 'magnifyGravity'      // Magnify Gravity — EGtW p.161: 60 ft, CON save 2d8 force (half on save), 10-ft radius AoE, NO concentration
    | 'rayOfSickness'       // Ray of Sickness — PHB p.271: 60 ft, ranged spell attack 2d8 poison + poisoned on hit, crit doubles, NO concentration
    | 'spellfireFlare'      // Spellfire Flare — SCAG p.149: 60 ft, AUTO-HIT 2d10+spellcasting mod fire (no save, no attack), NO concentration
    | 'wardaway'            // Wardaway: 60 ft, CON save 2d4 force (half on save), single-target, NO concentration
    | 'witchBolt'           // Witch Bolt — PHB p.289: 30 ft, ranged spell attack 1d12 lightning + concentration per-turn action DoT (auto-hit 1d12), crit doubles initial
    | 'mindSpike'           // Mind Spike — XGE p.162: 60 ft, WIS save 3d8 psychic (half on save), single-target, v1 one-shot (canon concentration simplified)
    | 'sprayOfCards'        // Spray of Cards — BMT p.50: Self (15-ft cone), DEX save 2d10 slashing + blinded on fail, NO concentration
    | 'eruptingEarth'       // Erupting Earth — XGE p.155: 60 ft, DEX save 3d12 bludgeoning (half on save), 20-ft radius AoE, NO concentration (difficult terrain simplified)
    | 'lifeTransference'    // Life Transference — XGE p.160: 60 ft, self-damage 4d8 necrotic + heal ally 2× (canon), NO concentration, NO save
    | 'pulseWave'           // Pulse Wave — EGtW p.163: Self (30-ft cone), CON save 6d6 force (half on save), NO concentration (push simplified)
    | 'tidalWave'           // Tidal Wave — XGE p.168: 30-ft line, STR save 4d8 bludgeoning + prone on fail (half on save), NO concentration (v1 line per plan; canon single-target)
    | 'vampiricTouch'       // Vampiric Touch — PHB p.287: touch (5 ft), melee spell attack 3d6 necrotic + heal self half (crit doubles), v1 one-shot (canon concentration simplified)
    | 'elementalBane'       // Elemental Bane — XGE p.154: 90 ft, WIS save 2d6 acid (half on save), single-target, v1 one-shot (canon concentration + vulnerability rider simplified)
    | 'gravitySinkhole'     // Gravity Sinkhole — EGtW p.162: 60 ft, CON save 5d10 force (half on save), 20-ft radius AoE, NO concentration (pull simplified)
    | 'iceStorm'            // Ice Storm — PHB p.254: 300 ft, DEX save 2d8 cold + 2d6 bludgeoning (half on save, dual damage), 20-ft radius AoE, NO concentration
    | 'sickeningRadiance'   // Sickening Radiance — XGE p.164: 120 ft, CON save 4d10 radiant + poisoned on fail (exhaustion simplified), 30-ft radius AoE, v1 one-shot (canon concentration simplified)
    | 'spellfireStorm'      // Spellfire Storm — SCAG p.150: 60 ft, AUTO-HIT 4d10 fire (no save, no attack), v1 one-shot (canon concentration + DoT simplified)
    | 'stormSphere'         // Storm Sphere — XGE p.166: 150 ft, CON save 6d6 thunder (half on save), 20-ft radius AoE, v1 one-shot (canon concentration + lightning rider simplified)
    | 'vitriolicSphere'     // Vitriolic Sphere — XGE p.168: 150 ft, DEX save 10d4 acid (half on save), 20-ft radius AoE, NO concentration (DoT simplified)
    | 'destructiveWave'     // Destructive Wave — PHB p.250: Self (30-ft radius), CON save 5d6 thunder + prone on fail, caster excluded, NO concentration
    | 'enervation'          // Enervation — XGE p.155: 60 ft, DEX save 4d8 necrotic + heal self half (half on save), v1 one-shot (canon concentration + DoT simplified)
    | 'flameStrike'         // Flame Strike — PHB p.243: 60 ft, DEX save 4d6 fire + 4d6 radiant (half on save, dual damage), 10-ft radius AoE, NO concentration
    | 'immolation'          // Immolation — XGE p.157: 90 ft, DEX save 8d6 fire (half on save), single-target, v1 one-shot (canon concentration + DoT simplified)
    | 'maelstrom'           // Maelstrom — XGE p.160: 120 ft, DEX save 6d6 bludgeoning + restrained on fail, 20-ft radius AoE, v1 one-shot (canon concentration simplified)
    | 'negativeEnergyFlood' // Negative Energy Flood — XGE p.162: 60 ft, CON save 5d12 necrotic (half on save), single-target, NO concentration (undead-boost simplified)
    | 'steelWindStrike'     // Steel Wind Strike — XGE p.166: 30 ft, 5 melee spell attacks 6d10 force (crit doubles), multi-target, NO concentration (teleport simplified)
    | 'synapticStatic'      // Synaptic Static — XGE p.167: 120 ft, INT save 8d6 psychic + incapacitated on fail (-1d6 simplified), 20-ft radius AoE, NO concentration
    | 'chainLightning'      // Chain Lightning — PHB p.221: 150 ft, AUTO-HIT 10d8 lightning to 1 primary + 3 arcs (4 targets max), NO concentration (v1 auto-hit per plan)
    | 'circleOfDeath'       // Circle of Death — PHB p.221: 60 ft, CON save 8d6 necrotic (half on save), 60-ft radius AoE, NO concentration
    | 'gravityFissure'      // Gravity Fissure — EGtW p.162: 100-ft line, CON save 8d8 force (half on save), NO concentration (secondary AoE + pull simplified)
    | 'mentalPrison'        // Mental Prison — XGE p.161: 60 ft, INT save 5d10 psychic (half on save), single-target, v1 one-shot (canon concentration + movement-trigger simplified)
    | 'sunbeam'             // Sunbeam — PHB p.279: 60-ft line, CON save 6d8 radiant + blinded on fail, v1 one-shot (canon concentration + repeat-action simplified)
    | 'crownOfStars'        // Crown of Stars — XGE p.152: 120 ft, ranged spell attack 4d12 radiant (crit doubles), single-target, v1 one-shot (7-mote storage simplified)
    | 'fireStorm'           // Fire Storm — PHB p.242: 150 ft, DEX save 7d10 fire (half on save), 40-ft radius AoE (canon ten-10ft-cubes simplified), NO concentration
    | 'darkStar'            // Dark Star — XGE p.153: 150 ft, CON save 8d8 necrotic + blinded on fail, 40-ft radius AoE, v1 one-shot (canon concentration + magical darkness simplified)
    | 'earthquake'          // Earthquake — PHB p.234: Self (50-ft radius per plan), AUTO-HIT 5d6 bludgeoning (no save per plan), v1 one-shot (canon concentration + multi-effect simplified)
    | 'feeblemind'          // Feeblemind — PHB p.239: 60 ft, INT save 4d6 psychic (always dealt) + incapacitated on fail (INT/CHA→1 simplified), single-target, NO concentration
    | 'incendiaryCloud'     // Incendiary Cloud — PHB p.253: 150 ft, DEX save 10d8 fire (half on save), 20-ft radius AoE, NO concentration (moving-cloud simplified)
    | 'maddeningDarkness'   // Maddening Darkness — XGE p.158: 120 ft, WIS save 8d8 psychic (half on save), 60-ft radius AoE, v1 one-shot (canon concentration + darkness rider simplified)
    | 'psychicScream'       // Psychic Scream — XGE p.163: 90 ft, INT save 14d6 psychic + stunned on fail, up to 10 targets (point-targeted), NO concentration
    | 'ravenousVoid'        // Ravenous Void — XGE p.159: 1000 ft, AUTO-HIT 5d10 force (no save per plan), 60-ft radius AoE, v1 one-shot (canon concentration + pull/restrained simplified)
    // ── Session 25 — Megabatch batch 2 (save-or-condition spells) ──
    // Migrated from the Session 19/20 generic dispatch registry to bespoke
    // implementations with real mechanical effects (WIS/CON/DEX/INT/CHA saves
    // + condition_apply, plus HP-gate conditions, AoE condition loops,
    // dual-condition, willing-target, HP-pool, and damage+condition patterns).
    // Mirrors the Session 18/22/23 bespoke save-or-condition patterns
    // (Blindness/Deafness, Hold Person, Sunburst condition loop).
    // Each migrated spell:
    //   - Removed from _generic_registry.ts (no longer dispatched via 'genericSpell')
    //   - Has its own case branch in combat.ts executePlannedAction
    //   - Has its own planner branch in planner.ts (12BG+, priority L9→L1)
    //   - Has its own test file in src/test/<spell>.test.ts
    | 'weird'              // Weird — PHB p.288: 120 ft, WIS save 4d10 psychic (half on save) + frightened on fail, 30-ft radius AoE, concentration (DoT simplified one-shot)
    | 'powerWordStun'      // Power Word Stun — PHB p.267: 60 ft, NO save, NO attack — stunned if currentHP ≤ 150, NO concentration
    | 'dominateMonster'    // Dominate Monster — PHB p.235: 60 ft, WIS save or charmed (control simplified), concentration, any creature
    | 'powerWordPain'      // Power Word Pain — XGE p.163: 60 ft, NO save/attack — 4d8 psychic + restrained if HP ≤ 60, NO concentration (slowed→restrained, DoT one-shot)
    | 'whirlwind'          // Whirlwind — PHB p.298: 50-ft cone, CON save or 7d8 bludgeoning + restrained, concentration (Session 27 canon fix: damage now rolled; was dropped per plan)
    | 'reverseGravity'     // Reverse Gravity — PHB p.277: 100 ft, 50-ft radius AoE, DEX save or restrained, concentration (fall-upward→restrained)
    | 'eyebite'            // Eyebite — PHB p.238: 60 ft, WIS save or sleeping (Asleep option), concentration, one-shot (per-turn re-target simplified)
    | 'fleshToStone'       // Flesh to Stone — PHB p.241: 60 ft, CON save or restrained, concentration (3-fail petrified simplified)
    | 'massSuggestion'     // Mass Suggestion — PHB p.258: 60 ft, WIS save or charmed, up to 12 targets, NO concentration (24-hr not tracked)
    | 'holdMonster'        // Hold Monster — PHB p.251: 60 ft, WIS save or paralyzed, concentration, any creature (mirror Hold Person L5)
    | 'contagion'          // Contagion — PHB p.227: touch (5 ft), melee spell attack + poisoned on hit, NO concentration (3-fail disease simplified; no damage)
    | 'dominatePerson'     // Dominate Person — PHB p.235: 60 ft, WIS save or charmed (control simplified), concentration, humanoid
    | 'geas'               // Geas — PHB p.245: 60 ft, WIS save or 5d10 psychic + charmed, NO concentration (30-day; damage-on-disobey one-shot)
    | 'phantasmalKiller'   // Phantasmal Killer — PHB p.265: 120 ft, WIS save or frightened + 4d10 psychic, concentration (per-turn DoT one-shot)
    | 'waterySphere'       // Watery Sphere — XGE p.170: 90 ft, 5-ft radius AoE, STR save or restrained, concentration (movement rider simplified)
    | 'dominateBeast'      // Dominate Beast — PHB p.235: 60 ft, WIS save or charmed (control simplified), concentration, beast
    | 'charmMonster'       // Charm Monster — PHB p.221: 30 ft, WIS save or charmed, NO concentration (1 hr), any creature
    | 'antagonize'        // Antagonize — EGtW p.150: 60 ft, WIS save 4d4 psychic (half on save) + frightened on fail, NO concentration (taunt→frightened)
    | 'bestowCurse'       // Bestow Curse — PHB p.214: Touch (5 ft) (Session 27 canon fix; was 60 ft per plan), WIS save or incapacitated, concentration (4 curse options simplified)
    | 'catnap'            // Catnap — XGE p.151: 30 ft, up to 3 WILLING ALLIES fall asleep (no save), NO concentration (short-rest NOT modelled)
    | 'enemiesAbound'     // Enemies Abound — XGE p.155: 120 ft, INT save or frightened, concentration (target-acquisition debuff simplified)
    | 'fastFriends'       // Fast Friends — EGtW p.151: 30 ft, WIS save or charmed, concentration (control simplified)
    | 'fear'              // Fear — PHB p.239: 30-ft cone, WIS save or frightened, concentration (Session 27 canon fix; was non-conc per plan; drop-weapon simplified)
    | 'hypnoticPattern'   // Hypnotic Pattern — PHB p.252: 120 ft, 10-ft radius AoE, WIS save or charmed+incapacitated (DUAL), concentration
    | 'inciteGreed'       // Incite Greed — EGtW p.151: 30-ft cone, WIS save or charmed, concentration
    | 'sleetStorm'        // Sleet Storm — PHB p.276: 120 ft, 20-ft radius AoE, DEX save or prone, concentration (conc-break rider simplified)
    | 'stinkingCloud'     // Stinking Cloud — PHB p.278: 90 ft, 20-ft radius AoE, CON save or poisoned+incapacitated (DUAL), concentration
    | 'evardsBlackTentacles' // Evard's Black Tentacles — PHB p.238: 90 ft, 20-ft square AoE (radius approx), DEX save 3d6 bludgeoning + restrained, concentration
    | 'pyrotechnics'      // Pyrotechnics — XGE p.162: 60 ft, 10-ft radius AoE, CON save or blinded (fireworks) OR no-save all-blinded (smoke), NO concentration (Session 27: 2-mode picker; fire-source assumed)
    | 'colorSpray'        // Color Spray — PHB p.222: 15-ft cone, 6d10 HP-pool → BLINDED (canon, no save), NO concentration (Session 26 canon fix: was unconscious in Batch 2 per plan; allies in cone ARE valid targets; temp HP does NOT count)
    | 'command'           // Command — PHB p.223: 60 ft, WIS save or incapacitated, NO concentration (commands simplified; upcast not modelled)
    | 'animalFriendship'  // Animal Friendship — PHB p.212: 30 ft, WIS save or charmed, NO concentration (Session 27 TG-004: beast-only + INT<4 NOW enforced)
    | 'causeFear'         // Cause Fear — XGE p.151: 60 ft, WIS save or frightened, NO concentration
    | 'blindnessDeafness' // Blindness/Deafness — PHB p.219: 30 ft, CON save or blinded, NO concentration (v1: always blinded)
    | 'banishment'        // Banishment — PHB p.217: 60 ft, CHA save, concentration; fey/elemental/etc removed permanently, others incapacitated
    | 'tashasHideousLaughter' // Tasha's Hideous Laughter — PHB p.282: 30 ft, WIS save or prone+incapacitated, concentration
    | 'dimensionDoor'     // Dimension Door — PHB p.233: self, ACTION teleport up to 500 ft, NO concentration (v1: caster-only, no willing-creature rider, no occupied-dest damage)
    | 'shapechange'       // Session 61 RFC-SHAPECHANGER Phase 1: monster trait — swap size/speed/AC per form (53+ creatures)
    | 'fogCloud'          // Session 62: Fog Cloud — PHB p.243: 120 ft, 20-ft sphere heavy obscurement, concentration 1 min (blocks vision; enables Hide)
    | 'darkness'          // Session 63: Darkness — PHB p.230: 60 ft, 15-ft radius magical darkness, concentration 10 min (blocks vision + darkvision; enables Hide)
    | 'wallOfFire'        // Wall of Fire — PHB p.285: 120 ft, DEX save 5d8 fire + damage_zone, concentration (L4, v1: single-target)
    | 'wallOfForce'       // Wall of Force — PHB p.285: 120 ft, NO save, conc — restrained (L5, v1: single-target capture)
    | 'wallOfIce'         // Wall of Ice — PHB p.285: 120 ft, DEX save 10d6 cold + damage_zone, conc (L6, v1: single-target)
    | 'wallOfStone'       // Wall of Stone — PHB p.287: 120 ft, DEX save 10d6 bludgeoning, conc (L5, v1: single-target damage)
    | 'maze'              // Maze — PHB p.261: 60 ft, NO save, NO conc — removed for encounter (L8, v1: no escape action)
    | 'magicCircle'       // Magic Circle — PHB p.256: 10 ft, NO save, conc — advantage_vs (L3, v1: single-target vs affected type)
    | 'antimagicField'   // Antimagic Field — PHB p.213: self, NO save, conc — incapacitate enemy casters in 10ft (L8, v1: multi-target)
    | 'mindBlank'        // Mind Blank — PHB p.260: touch, NO save, NO conc — psychic immunity (L8, v1: encounter-duration)
    | 'symbol'           // Symbol — PHB p.280: 30ft, CON save, conc — Pain (damage_zone + disadv) (L7, v1: Pain only)
    | 'createUndead'     // Create Undead — PHB p.229: 10ft, NO save, NO conc — spawn zombie (L6, v1: 1 zombie, no corpse req)
    | 'raiseDead'        // Raise Dead — PHB p.258: touch, 1-hour cast, out-of-combat (stub)
    | 'etherealness'     // Etherealness — PHB p.238: self, NO save, conc — invisible (Border Ethereal) (L7, v1: encounter)
    | 'windWalk'         // Wind Walk — PHB p.288: self, NO save, conc — mist form (fly 300 + incapacitated) (L6, v1: caster only)
    | 'gate'             // Gate — PHB p.244: 60ft, NO save, conc — spawn entity (L9, v1: generic shadow spawn)
    | 'hallow'           // Hallow — PHB p.249: 60ft, NO save, NO conc — advantage_vs (Daylight vs undead/fiend) (L5, v1: single-target)
    | 'wish'             // Wish — PHB p.288: self, NO save, NO conc — out-of-combat (stub; duplicate-any-spell deferred)
    | 'planeShift'       // Plane Shift — PHB p.266: 5ft, CHA save, NO conc — banish (removed for encounter) (L7, v1: banish-only, skip melee spell attack)
    | 'teleport'         // Teleport — PHB p.281: self, NO save, NO conc — self-escape (L7, v1: self-only, mirrors Dimension Door)
    | 'animateDead'      // Animate Dead — PHB p.213: 10ft, NO save, NO conc — spawn skeleton (L3, v1: 1 skeleton, no corpse req)
    | 'scrying'           // Scrying — PHB p.273: WIS save, 10-min cast, out-of-combat only (stub)
    // ── Session 69 Batch 5: 10 out-of-combat utility divinations (stubs) ──
    // All have shouldCast→null (never fire in combat). Modules exist so the
    // monster-spell coverage report counts them as implemented; they unlock
    // no AI behavior but stop the "unbuilt spell" warning for 313 creature-refs.
    | 'detectMagic'         // Detect Magic — PHB p.231: L1 Div, self, conc 10 min (ritual)
    | 'comprehendLanguages' // Comprehend Languages — PHB p.224: L1 Div, self, 1 hr (ritual)
    | 'identify'            // Identify — PHB p.252: L1 Div, touch, 1-min cast (ritual)
    | 'locateObject'        // Locate Object — PHB p.256: L2 Div, self, conc 10 min
    | 'clairvoyance'        // Clairvoyance — PHB p.222: L3 Div, 1 mile, conc 10 min, 10-min cast
    | 'sending'             // Sending — PHB p.274: L3 Evoc, unlimited, 1 round
    | 'tongues'             // Tongues — PHB p.283: L3 Div, touch, 1 hr
    | 'waterBreathing'      // Water Breathing — PHB p.287: L3 Trans, 30 ft, 24 hr (ritual)
    | 'divination'          // Divination — PHB p.234: L4 Div, self, instant (ritual)
    | 'locateCreature'      // Locate Creature — PHB p.256: L4 Div, self, conc 1 hr
    // ── Session 69 Batch 6: 5 more out-of-combat utility divinations (stubs) ──
    // All have shouldCast→null (never fire in combat). Modules exist so the
    // monster-spell coverage report counts them as implemented; they unlock
    // no AI behavior but stop the "unbuilt spell" warning for 102 creature-refs.
    | 'detectEvilAndGood'   // Detect Evil and Good — PHB p.231: L1 Div, self, conc 10 min
    | 'augury'              // Augury — PHB p.215: L2 Div, self, instant (ritual, 1-min cast)
    | 'revivify'            // Revivify — PHB p.272: L3 Nec, touch, instant (1-action cast, out-of-combat)
    | 'arcaneEye'           // Arcane Eye — PHB p.214: L4 Div, 30 ft, conc 1 hr
    | 'trueSeeing'          // True Seeing — PHB p.284: L6 Div, touch, 1 hr
    // ── Session 69 Batch 7: 12 more out-of-combat utility spells (stubs) ──
    // All have shouldCast→null (never fire in combat). Modules exist so the
    // monster-spell coverage report counts them as implemented.
    | 'longstrider'              // Longstrider — PHB p.256: L1 Trans, touch, 1 hr
    | 'waterWalk'                // Water Walk — PHB p.287: L3 Trans, 30 ft, 1 hr (ritual)
    | 'gentleRepose'             // Gentle Repose — PHB p.245: L2 Nec, touch, 10 days (ritual)
    | 'locateAnimalsOrPlants'    // Locate Animals or Plants — PHB p.256: L2 Div, self, instant (ritual)
    | 'commune'                  // Commune — PHB p.223: L5 Div, self, 1-min cast (ritual)
    | 'contactOtherPlane'        // Contact Other Plane — PHB p.226: L5 Div, self, 1-min cast (ritual)
    | 'dream'                    // Dream — PHB p.236: L5 Ill, special, 1-min cast
    | 'legendLore'               // Legend Lore — PHB p.254: L5 Div, self, 10-min cast
    | 'awaken'                   // Awaken — PHB p.216: L5 Trans, touch, 8-hr cast
    | 'heroesFeast'              // Heroes' Feast — PHB p.250: L6 Con, 30 ft, 10-min cast
    | 'programmedIllusion'       // Programmed Illusion — PHB p.269: L6 Ill, 120 ft, permanent
    | 'imprisonment'             // Imprisonment — PHB p.252: L9 Abj, 30 ft, 1-min cast
    // ── Session 69 Batch 8: 16 more out-of-combat utility spells (stubs) ──
    // All have shouldCast→null (never fire in combat). Modules exist so the
    // monster-spell coverage report counts them as implemented.
    | 'detectPoisonAndDisease'   // Detect Poison and Disease — PHB p.231: L1 Div, self, conc 10 min (ritual)
    | 'illusoryScript'           // Illusory Script — PHB p.252: L1 Ill, touch, 1-min cast (ritual)
    | 'ropeTrick'                // Rope Trick — PHB p.272: L2 Trans, touch, 1 hr
    | 'planarBinding'            // Planar Binding — PHB p.265: L5 Abj, 60 ft, 1-hr cast
    | 'findThePath'              // Find the Path — PHB p.240: L6 Div, self, 1-min cast, conc
    | 'wordOfRecall'             // Word of Recall — PHB p.289: L6 Conj, 5 ft, instant
    | 'contingency'              // Contingency — PHB p.227: L6 Evoc, self, 10-min cast
    | 'demiplane'                // Demiplane — PHB p.231: L8 Conj, 60 ft, 1 hr
    | 'telepathy'                // Telepathy — PHB p.281: L8 Evoc, unlimited, 24 hr
    | 'astralProjection'         // Astral Projection — PHB p.215: L9 Nec, 10 ft, 1-hr cast
    | 'clone'                    // Clone — PHB p.222: L8 Nec, touch, 1-hr cast
    | 'drawmajsInstantSummons'   // Drawmij's Instant Summons — PHB p.235: L6 Conj, touch, 1-min cast
    | 'forbiddance'              // Forbiddance — PHB p.243: L6 Abj, touch, 10-min cast (ritual)
    | 'planarAlly'               // Planar Ally — PHB p.265: L6 Conj, 60 ft, 10-min cast
    | 'resurrection'             // Resurrection — PHB p.272: L7 Nec, touch, 1-hr cast
    | 'simulacrum'               // Simulacrum — PHB p.276: L7 Ill, touch, 12-hr cast
    // ── Session 71 — Batch B/C: 6 deferred combat spell stubs ──────────────
    // Each module is a coverage stub (shouldCast always null) so the monster-
    // spell coverage report counts these spells as implemented. Real combat
    // behavior is deferred until the relevant engine subsystem (wall/zone,
    // advantage-vs-creature-type, effect-removal, teleport+AoE) is built.
    | 'thunderStep'              // Thunder Step — XGE p.168: L3 Conj, 90 ft, teleport + 3d10 thunder AoE
    | 'windWall'                 // Wind Wall — PHB p.288: L3 Evoc, 120 ft, conc, ranged-weapon-miss wall
    | 'wallOfThorns'             // Wall of Thorns — PHB p.287: L6 Conj, 120 ft, conc, damage-on-enter wall
    | 'prismaticWall'            // Prismatic Wall — PHB p.267: L9 Abj, 60 ft, 7-layer complex wall
    | 'protectionFromEvilAndGood' // Protection from Evil and Good — PHB p.270: L1 Abj, touch, conc, advantage vs creature-type
    | 'dispelEvilAndGood'        // Dispel Evil and Good — PHB p.233: L5 Abj, self, conc, break enchantment
    | 'charmPerson'       // Charm Person — PHB p.221: 30 ft, WIS save or charmed, NO concentration (Session 27 TG-004: humanoid-only NOW enforced)
    | 'compelledDuel'     // Compelled Duel — PHB p.224: 30 ft, WIS save or frightened (taunt), concentration (movement-restriction simplified)
    | 'grease'            // Grease — PHB p.245: 60 ft, 10-ft radius AoE, DEX save or prone, NO concentration (persistent-terrain simplified)
    // ── Session 27 — Batch 3 concentration buffs (23 spells) ──────────────
    // Migrated from Session 20 forward-compat stubs to bespoke implementations
    // using existing + new SpellEffectType values (bane_die, bless_die,
    // weapon_enchant with damage-dice, advantage_vs, _nextHitRider scratch).
    // 6 multi-target buffs + 17 self-buffs. Each has its own case branch in
    // combat.ts + planner branch in planner.ts (12CP+).
    | 'bane'              // Bane — PHB p.216: 30 ft, CHA save or -1d4 (bane_die), conc (up to 3 enemies)
    | 'motivationalSpeech' // Motivational Speech — AI p.77: 60 ft, +1d4 (bless_die) + 5 temp HP, conc (up to 3 allies)
    | 'ensnaringStrike'   // Ensnaring Strike — PHB p.237: self, next hit +1d6 piercing + restrained, conc (bonus action)
    | 'hailOfThorns'      // Hail of Thorns — PHB p.249: self, next ranged hit +1d10 piercing, conc (bonus action; AoE simplified)
    | 'searingSmite'      // Searing Smite — PHB p.274: self, next hit +1d6 fire, conc (bonus action; DoT simplified)
    | 'thunderousSmite'   // Thunderous Smite — PHB p.282: self, next hit +2d6 thunder, conc (bonus action; push simplified)
    | 'wrathfulSmite'     // Wrathful Smite — PHB p.289: self, next hit +1d6 psychic + frightened, conc (bonus action)
    | 'zephyrStrike'      // Zephyr Strike — XGE p.171: self, next hit +1d8 force, conc (bonus action; disengage+speed simplified)
    | 'blindingSmite'     // Blinding Smite — PHB p.219: self, next hit +3d8 radiant + blinded, conc (bonus action)
    | 'lightningArrow'    // Lightning Arrow — PHB p.255: self, next ranged hit +4d8 lightning, conc (bonus action; AoE simplified)
    | 'spiritShroud'      // Spirit Shroud — XGE/TCE: self, next hit +1d8 radiant, conc (bonus action; aura+slow simplified)
    | 'staggeringSmite'   // Staggering Smite — PHB p.279: self, next hit +4d6 psychic + stunned, conc (bonus action)
    | 'banishingSmite'    // Banishing Smite — PHB p.216: self, next hit +5d10 force, conc (bonus action; banish simplified)
    | 'divineFavor'       // Divine Favor — PHB p.234: self, +1d4 radiant on weapon attacks, conc (bonus action)
    | 'shadowBlade'       // Shadow Blade — PHB p.275: self, +2d8 psychic weapon (+1 atk), conc (bonus action; creates-weapon simplified)
    | 'elementalWeapon'   // Elemental Weapon — PHB p.234: self, +1 atk + 1d4 fire, conc (action; element-choice simplified to fire)
    | 'flameArrows'       // Flame Arrows — XGE: self, +1d6 fire on weapon attacks, conc (action)
    | 'holyWeapon'        // Holy Weapon — PHB p.275: self, +5d8 radiant + 1 atk, conc (action; dismiss-blast simplified)
    | 'swiftQuiver'       // Swift Quiver — PHB p.279: self, bonus-action extra attack, conc (bonus action; extra-attack NOT modelled — marker only)
    | 'beaconOfHope'      // Beacon of Hope — PHB p.217: 30 ft, adv on WIS saves, conc (up to 3 allies; max-heal NOT modelled)
    | 'intellectFortress' // Intellect Fortress — XGE: adv on INT/WIS/CHA saves (v1: all saves), conc (allies; psychic-resist NOT modelled)
    | 'holyAura'          // Holy Aura — PHB p.251: 30-ft aura, adv on saves, conc (all allies; light+blind-attackers simplified)
    | 'foresight'         // Foresight — PHB p.244: Touch (5 ft), adv on all d20 rolls, conc (1 ally; enemies-disadv + 8hr NOT modelled)
    // ── Session 27 — Batch 4 persistent zones + healing + temp HP (22 spells) ──
    | 'deathArmor'        // Death Armor — XGE: 5-ft aura 1d4 slashing, conc (retaliation→aura simplified)
    | 'dustDevil'         // Dust Devil — XGE: 5-ft aura 1d8 bludgeoning, conc (moving simplified)
    | 'healingSpirit'     // Healing Spirit — XGE: 30-ft aura 1d6 heal, conc (per-turn re-heal simplified to one-shot)
    | 'cacophonicShield'  // Cacophonic Shield — AI: 10-ft aura 2d6 thunder, conc
    | 'callLightning'     // Call Lightning — PHB p.220: 60 ft, 3d10 lightning zone, conc (strike-choice simplified)
    | 'hungerOfHadar'     // Hunger of Hadar — PHB p.241: 20-ft sphere, 2d6 cold + 4d6 acid (DUAL), conc
    | 'spiritGuardians'   // Spirit Guardians — PHB p.278: 10-ft aura 3d8 radiant (WIS half), conc (necrotic→radiant simplified)
    | 'guardianOfFaith'   // Guardian of Faith — PHB p.246: 10-ft zone 20d6 radiant one-shot, NO conc (budget simplified)
    | 'dawn'              // Dawn — XGE: 30-ft cylinder 4d10 radiant (CON half), conc
    | 'insectPlague'      // Insect Plague — PHB p.252: 20-ft sphere 4d10 piercing (CON half), conc
    | 'stormOfVengeance'  // Storm of Vengeance — PHB p.279: 60-ft zone 2d6 thunder + 6d6 lightning (DUAL), conc (other effects simplified)
    | 'goodberry'         // Goodberry — PHB p.246: 30 ft, 10 HP heal (multi-berry simplified), NO conc
    | 'witherAndBloom'    // Wither and Bloom — Strixhaven: 2d6 necrotic + 2d6 heal (dual target), NO conc
    | 'auraOfVitality'    // Aura of Vitality — PHB p.216: 30-ft aura 2d6 heal, conc (per-turn re-heal simplified)
    | 'massHealingWord'   // Mass Healing Word — PHB p.258: 60 ft, 1d4+mod heal up to 6, NO conc (bonus action)
    | 'massCureWounds'    // Mass Cure Wounds — PHB p.258: 60 ft, 3d8+mod heal up to 6, NO conc
    | 'heal'              // Heal — PHB p.250: 60 ft, 70 HP + remove blinded/deafened, NO conc (disease not modelled)
    | 'regenerate'        // Regenerate — PHB p.271: Touch, 4d8+mod heal, NO conc (1HP/turn not modelled)
    | 'massHeal'          // Mass Heal — PHB p.257: 60 ft, 700 HP split, NO conc
    | 'powerWordHeal'     // Power Word Heal — XGE: Touch, full HP + remove 5 conditions, NO conc
    | 'armorOfAgathys'    // Armor of Agathys — PHB p.215: self, 5 temp HP, NO conc (retaliation not modelled)
    | 'falseLife'         // False Life — PHB p.239: self, 1d4+4 temp HP, NO conc (1hr not tracked)
    | 'dispelMagic'      // Dispel Magic — PHB p.233: 120 ft, auto-dispel concentration effects + ability check vs DC 13 for non-concentration, upcast auto-dispels more, NO concentration
    // ── Session 19 — bulk-implementation generic dispatch (262 new spells L2-9) ──
    // All non-blocker in-scope spells from levels 2-9 that have not been
    // implemented as bespoke case branches are routed through 'genericSpell'.
    // The dispatch is keyed by `spellName` (see below). Each spell has its
    // own module at src/spells/<snake>.ts that exports shouldCast + execute.
    | 'summonSpell'       // Summon/Conjure spell — spawns a combatant mid-combat (TG-006)
    | 'genericSpell'
    | 'legendary'
    | 'perceive';         // Session 62 RFC-VISION-AUDIO Phase 1: active Perception action —
                          // contests hidden enemies' Stealth rolls (PHB p.177). Spends the
                          // ACTION; on success, removes 'hidden' from one hidden enemy.
  action: Action | null;
  targetId: string | null;
  description: string;
  // ── Session 42 — Thirsting Blade / Extra Attack ──────────────────────
  // Number of attacks to make when executing this plan. Default 1 (single
  // attack). Set to 2 by the planner when the actor has Thirsting Blade
  // (Warlock invocation) AND Pact of the Blade AND the action is a melee
  // weapon attack. The engine's case 'attack': branch loops resolveAttack
  // this many times.
  // Future: generalize to support Fighter 5+ Extra Attack (2), Fighter 11+
  // Extra Attack (3), etc.
  attackCount?: number;
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
  // ── RFC-UPCASTING Phase 1 (Session 72): cast slot level ──
  // The spell slot level actually spent for this spell cast.
  // Set by the planner / bespoke spell modules at plan-construction time.
  //
  // Distinct from `action.slotLevel` (the spell's BASE level).
  //   castSlotLevel = slot consumed (e.g. 5 for Fireball at L5)
  //   action.slotLevel = spell base level (e.g. 3 for Fireball)
  //
  // 0 or undefined = cantrip (no slot consumed, interaction level = 0).
  // Used by:
  //   - getSpellInfoFromPlan() → Counterspell trigger
  //   - Globe of Invulnerability blocking check
  //   - Dispel Magic accurate DC
  //   - Upcast damage scaling in execute() handlers
  castSlotLevel?: number;
  // ── TG-031: Open Hand Technique choice (Open Hand Monk 3, PHB p.79) ──
  // When the monk uses Flurry of Blows and hits, they can impose one effect
  // on the target: 'prone' (DEX save or knocked prone), 'push' (STR save or
  // pushed 15 ft), or 'disabler' (can't take reactions until end of monk's
  // next turn). Set by the planner on the 'flurryOfBlows' PlannedAction.
  // Default 'prone' if Open Hand Technique is present and no choice was set.
  // v1 simplification: rider fires once per Flurry (after the second hit),
  // not per hit (PHB p.79: "immediately after you hit" — per hit is more
  // canon-accurate but fiddly for v1).
  openHandTechniqueChoice?: 'prone' | 'push' | 'disabler';
  // ── Session 88: Eldritch Blast spread damage heuristic ──────────────
  // PHB p.237: "You can direct the beams at the same target or at different
  // ones. Make a separate attack roll for each beam."
  //
  // When the planner chooses Eldritch Blast with multiple beams (attackCount >
  // 1) AND there are other living enemies in range that are weak enough to be
  // killed by a single beam (currentHP ≤ max beam damage), the planner
  // populates this list with up to `attackCount - 1` secondary target IDs.
  //
  // Beam 1 targets `targetId` (the primary, chosen by selectTarget).
  // Beam i (i > 1) targets `secondaryTargetIds[i - 2]` if that target is
  // still alive; otherwise falls back to the primary + retarget-on-kill.
  //
  // This implements the "spread damage" AI strategy: instead of focus-firing
  // all beams on one target (Session 85 retarget-on-kill handles the case
  // where the primary dies mid-beam), spread beams across multiple weak
  // enemies to maximize kills per turn.
  //
  // Left undefined or empty: focus-fire behavior (all beams at primary,
  // retarget on kill). This is the default and backward-compat path.
  secondaryTargetIds?: string[];
}

// ============================================================
// TG-008: Reaction spell subsystem
//
// Reactions fire OUTSIDE the reactor's own turn, in response to a
// triggering event on another creature's turn. The engine emits a
// `ReactionTrigger` at each trigger point (incoming attack hit,
// incoming damage, incoming spell cast, falling). The
// `triggerReactions` helper in combat.ts iterates candidate
// reactors (the target itself for incoming_attack_hit /
// incoming_damage; all enemies within range for incoming_spell;
// all falling creatures for falling) and fires the first matching
// reaction spell from the `REACTION_SPELLS` registry.
//
// PHB p.190: each creature gets ONE reaction per round, refreshed
// at the start of its own turn. The `ActionBudget.reactionUsed`
// flag tracks this (reset by `resetBudget` in utils.ts).
// ============================================================

/**
 * Discriminated union describing the event that triggered a reaction.
 * Passed to a reaction spell's `shouldCast` and `execute` so it can
 * make trigger-aware decisions (e.g. Shield only fires on an attack
 * that +5 AC would flip to a miss; Absorb Elements only fires on
 * acid/cold/fire/lightning/poison/thunder damage).
 */
export type ReactionTrigger =
  | {
      kind: 'incoming_attack_hit';
      /** The creature making the triggering attack. */
      attacker: Combatant;
      /** The attacking action (weapon or spell with an attack roll). */
      action: Action;
      /** The raw d20 roll (1-20) of the triggering attack. */
      attackRoll: number;
      /** The total attack roll (d20 + hit bonus + modifiers). */
      attackTotal: number;
      /** The target's effective AC at the time of the hit decision
       *  (includes Shield's +5 if already active, cover, Warding Bond, etc.). */
      effectiveAC: number;
      /** True if the attack was a critical hit (nat 20 or forced crit). */
      isCrit: boolean;
    }
  | {
      kind: 'incoming_damage';
      /** The creature that dealt the triggering damage. */
      attacker: Combatant;
      /** The creature that took the damage (potential reactor). */
      target: Combatant;
      /** Net damage dealt (after resistance / immunity / temp HP). */
      amount: number;
      /** The damage type, or null if untyped. */
      damageType: DamageType | null;
      /** The action that caused the damage, if any. */
      action?: Action;
    }
  | {
      kind: 'incoming_spell';
      /** The creature in the process of casting the triggering spell. */
      caster: Combatant;
      /** Canonical spell name (e.g. 'Fireball', 'Cure Wounds'). */
      spellName: string;
      /** The spell's level (1-9). 0 = cantrip (Counterspell still works on cantrips per Sage Advice, but v1 skips cantrips). */
      level: number;
    }
  | {
      kind: 'falling';
      /** IDs of all creatures currently falling (Feather Fall can affect up to 5). */
      fallerIds: string[];
      /** Fall height in feet. */
      fallHeightFt: number;
    }
  // ── Session 37 — Shield "targeted by Magic Missile" trigger ──
  // PHB p.275 Shield: "Reaction: When you are hit by an attack or targeted
  // by Magic Missile." The `incoming_attack_hit` trigger covers the first
  // half; this trigger covers the second half.
  //
  // Magic Missile (PHB p.257) auto-hits — it has no attack roll, so it
  // bypasses the `incoming_attack_hit` trigger point in resolveAttack.
  // Instead, the `case 'magicMissile':` dispatch in combat.ts fires this
  // trigger for the target BEFORE calling executeMagicMissile. If Shield
  // negates, the dispatch skips the damage loop (MM slot is still consumed
  // — the spell was cast, just blocked).
  //
  // v1 simplification: MM currently targets a single creature (all darts
  // aimed at one target per the AI heuristic). Shield blocks ALL darts.
  // If MM ever supports multi-target darts, Shield would only block darts
  // aimed at the Shield-caster (per-dart blocking — future enhancement).
  | {
      kind: 'targeted_by_magic_missile';
      /** The creature casting Magic Missile. */
      caster: Combatant;
      /** The creature being targeted by Magic Missile (potential reactor). */
      target: Combatant;
      /** Number of darts aimed at `target` (informational; Shield blocks all regardless). */
      dartCount: number;
    }
  // ── Session 41 — Silvery Barbs save-success trigger ──
  // SCC p.38: Silvery Barbs can be cast "when a creature you can see
  // within 60 feet of you succeeds on a saving throw." The reactor is
  // the spellcaster who forced the save (NOT the saver). If Silvery
  // Barbs negates, the reroll's lower result flips the save to a
  // failure — the spell's effect then applies as if the save failed.
  //
  // Migration plan (Session 41 Task #8): spell modules call
  // `rollSaveReactable(state, caster, saver, ability, dc, isProficient?)`
  // in combat.ts instead of `rollSave` directly. The wrapper fires this
  // trigger after a successful save; if Silvery Barbs negates, the
  // wrapper returns success=false so the spell's effect branch runs.
  //
  // v1.5 scope: infrastructure added; the 110 spell modules that call
  // `rollSave` will be migrated incrementally. See Session 41 handover.
  | {
      kind: 'incoming_save_success';
      /** The creature that cast the spell forcing the save (potential reactor). */
      caster: Combatant;
      /** The creature that succeeded on the save (the saver). */
      saver: Combatant;
      /** The save ability (str/dex/con/int/wis/cha). */
      ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
      /** The save DC. */
      dc: number;
      /** The raw d20 roll (1-20) of the save. */
      roll: number;
      /** The total save result (d20 + mods). */
      total: number;
    }
  // ── Session 42 — Silvery Barbs ability-check-success trigger ──
  // SCC p.38: Silvery Barbs can be cast "when a creature you can see
  // within 60 feet of you succeeds on a saving throw OR an ability check."
  // The reactor is the OPPONENT of the checker (the one who wants the
  // check to fail). If Silvery Barbs negates, the reroll's lower result
  // flips the contest outcome.
  //
  // v1 scope: grapple/shove/escape-grapple contests. The "checker" is the
  // attacker (the one making the ability check); the "opponent" is the
  // defender (the one who would cast Silvery Barbs to flip the contest).
  // Future: extend to Counterspell and Dispel Magic ability checks.
  | {
      kind: 'incoming_ability_check_success';
      /** The creature that made the ability check (the "checker"). */
      checker: Combatant;
      /** The opponent of the checker (the one who would cast Silvery Barbs
       *  to flip the contest). For grapple: the defender. For escape
       *  grapple: the grappler. */
      opponent: Combatant;
      /** The ability used for the check (str/dex/con/int/wis/cha). */
      ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
      /** The raw d20 roll (1-20) of the check. */
      roll: number;
      /** The total check result (d20 + mods). */
      total: number;
      /** Description of the contest (e.g. "grapple", "shove", "escape grapple"). */
      contestType: string;
      // ── Session 43 Task #25: opponent's total for stricter Silvery Barbs
      // RAW compliance. PHB/SCC: "The triggering creature must reroll the d20
      // and use the lower roll." The reroll re-rolls the CHECKER's d20 only
      // (not the opponent's). To determine whether the lower roll flips the
      // contest, we compare the new checker total (lowerD20 + mods) against
      // the opponent's original total. This field carries that opponent
      // total so the reroll logic doesn't need to re-roll the opponent.
      opponentTotal?: number;
    };

/**
 * Outcome of a reaction spell execution. The engine uses this to decide
 * whether to abort the triggering action (e.g. Counterspell negates the
 * spell cast; Shield flips the hit to a miss).
 */
export type ReactionOutcome =
  /** The reaction fired but did NOT change the triggering action's outcome.
   *  Example: Absorb Elements grants resistance + a rider but the damage
   *  still applies. Hellish Rebuke deals damage to the attacker but the
   *  attacker's action still resolves. */
  | { kind: 'no_effect' }
  /** The reaction NEGATED the triggering action. The caller MUST abort
   *  the triggering action (skip damage application, skip spell execution,
   *  flip the hit to a miss, zero out fall damage, etc.).
   *  Example: Shield's +5 AC flips the hit to a miss. Counterspell
   *  succeeds on the ability check. Silvery Barbs forces a reroll that misses. */
  | { kind: 'negated'; detail?: string }
  /** The reaction fired but FAILED to negate. The triggering action
   *  resolves normally. Example: Counterspell's ability check failed. */
  | { kind: 'failed'; detail?: string };
