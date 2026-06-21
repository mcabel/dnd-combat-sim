// ============================================================
// Spell Effects Registry (ActiveEffect lifecycle management)
//
// Provides:
//   applySpellEffect(target, effectDef)   — attach an effect to a combatant
//   removeEffectsFromCaster(casterId, bf) — cleanup all effects from one caster
//   removeEffectById(targetId, id, bf)    — remove a single named effect
//
// All concentration-break call sites in combat.ts call removeEffectsFromCaster
// BEFORE nulling caster.concentration, so effects are gone before state reads.
//
// Effect types and lifecycle:
//   advantage_vs    — mirrors a grantVulnerability() entry; uses 'permanent' duration
//                     so adv_system ticking doesn't expire it prematurely. Removed
//                     via removeBySource() on cleanup.
//   ac_bonus        — read by resolveAttack() in combat.ts; no immediate side-effect.
//   bless_die       — read by roll helpers at attack / save resolution time.
//   condition_apply — applies a Condition to the target immediately; removed on cleanup.
//
// NOTE: startConcentration() in utils.ts silently drops existing concentration but
// does NOT call removeEffectsFromCaster. Callers that replace concentration with a
// new spell should call removeEffectsFromCaster(casterId, bf) first. This is safe to
// defer until the first ActiveEffect-using concentration spell is implemented.
// ============================================================

import { ActiveEffect, Combatant, Battlefield, SpellEffectType, DamageType, AbilityScore, Condition, Vec3, TerrainType } from '../types/core';
import { grantVulnerability, grantSelf, removeBySource } from './adv_system';

// ---- ID generator -------------------------------------------

let _nextId = 1;

/** Deterministic unique IDs for effects. Resets only on module reload. */
function nextEffectId(): string {
  return `eff_${_nextId++}`;
}

/** Exposed for tests that need a predictable counter reset. */
export function _resetEffectIdCounter(): void {
  _nextId = 1;
}

// ---- Apply --------------------------------------------------

/**
 * Attach an active effect to a target combatant.
 * Applies immediate side-effects (advantage entry, condition) where applicable.
 * Returns the full ActiveEffect including its generated id.
 *
 * @param target  The combatant receiving the effect
 * @param def     Everything except the id field
 */
export function applySpellEffect(
  target: Combatant,
  def: Omit<ActiveEffect, 'id'>,
): ActiveEffect {
  const effect: ActiveEffect = { ...def, id: nextEffectId() };
  target.activeEffects.push(effect);

  switch (effect.effectType) {
    case 'advantage_vs':
      // Mirror into the adv_system so resolveAttack queryVulnerability() picks it up.
      // Use 'permanent' — we manage the lifecycle via activeEffects, not adv ticking.
      grantVulnerability(
        target,
        effect.payload.advType!,
        effect.payload.advScope!,
        effect.spellName,
        'permanent',
      );
      break;

    case 'condition_apply':
      target.conditions.add(effect.payload.condition!);
      break;

    case 'dominated':
      target.conditions.add('charmed');
      target.conditions.add('incapacitated');
      break;

    case 'suggestion':
      // PHB p.258: target pursues a course of action ("Don't fight").
      // Modeled as charmed (can't attack the caster) + disadvantage on the
      // target's own attack rolls (following the suggestion — won't fight effectively).
      target.conditions.add('charmed');
      grantSelf(target, 'disadvantage', 'attack', effect.spellName, 'permanent');
      break;

    case 'exhaustion_level':
      // PHB p.291: exhaustion is a 7-level graduated state.
      // Increment the target's exhaustion level by the payload amount (default 1).
      // Level 6 = death (PHB p.291: "Death").
      target.exhaustionLevel = Math.min(6, target.exhaustionLevel + (effect.payload.exhaustionLevels ?? 1));
      if (target.exhaustionLevel >= 6) {
        target.isDead = true;
        if (target.isPlayer) target.isUnconscious = true;
      }
      break;

    case 'invisible':
      // PHB p.194: true invisibility
      // 1. Disadvantage on attacks vs this creature (can't see target)
      grantVulnerability(target, 'disadvantage', 'attack', effect.spellName, 'permanent');
      // 2. Advantage on own attack rolls (unseen attacker, PHB p.194)
      grantSelf(target, 'advantage', 'attack', effect.spellName, 'permanent');
      // 3. Add the invisible condition (for OA immunity, etc.)
      target.conditions.add('invisible');
      break;

    case 'taunt':
    case 'curse_attack_disadv':
    case 'ability_disadvantage':
    case 'curse_rider':
    case 'ac_bonus':
    case 'ac_floor':
    case 'bless_die':
    case 'bane_die':
    case 'damage_zone':
    case 'weapon_enchant':
    case 'enlarge_reduce':
    case 'terrain_zone':
      // No immediate side-effect — read at resolution time.
      // (damage_zone: the start-of-turn damage tick is in combat.ts's
      // runCombat loop, right after resetBudget.)
      // (terrain_zone: the start-of-turn terrain check is in combat.ts's
      // runCombat loop, after damage_zone ticks.)
      break;
  }

  return effect;
}

// ---- Remove -------------------------------------------------

/**
 * Remove ALL active effects placed by a specific caster across the entire battlefield.
 * Call this whenever a caster's concentration breaks or they die.
 *
 * Side-effects undone:
 *   advantage_vs    → removeBySource(target, spellName)
 *   condition_apply → target.conditions.delete(condition)
 *   ac_bonus        → no undo needed (read from array at resolve time)
 *   ac_floor        → no undo needed (read from array at resolve time)
 *   bless_die       → no undo needed (read from array at resolve time)
 */
export function removeEffectsFromCaster(casterId: string, bf: Battlefield): void {
  // Collect the spell names being removed (needed for _movingZone cleanup below)
  const spellNames = new Set<string>();

  for (const combatant of bf.combatants.values()) {
    const owned = combatant.activeEffects.filter(e => e.casterId === casterId);
    if (owned.length === 0) continue;

    for (const e of owned) {
      // Track spell names for _movingZone cleanup
      spellNames.add(e.spellName);
      // Remove difficult terrain cells BEFORE undoing the effect
      if (e.effectType === 'terrain_zone' && e.payload.terrainDifficulty) {
        removeTerrainDifficulty(bf, e);
      }
      _undoEffect(combatant, e);
    }

    combatant.activeEffects = combatant.activeEffects.filter(e => e.casterId !== casterId);
  }

  // ── Moving Zone cleanup ──
  // When effects from this caster are removed (e.g. concentration break),
  // also clear the caster's _movingZone scratch field if it belongs to one
  // of the spells being removed. This ensures the moving zone stops
  // processing at the start of the caster's next turn.
  const caster = bf.combatants.get(casterId);
  if (caster?._movingZone && spellNames.has(caster._movingZone.spellName)) {
    delete caster._movingZone;
  }

  // ── Despawn summons (TG-006) ──
  // When a caster's concentration breaks, all their summons are removed.
  const summonsToDespawn = [...bf.combatants.values()].filter(
    c => c.isSummon && c.summonerId === casterId
  );
  for (const summon of summonsToDespawn) {
    // Remove the summon from the battlefield
    bf.combatants.delete(summon.id);
    // Remove from initiative order
    const initIdx = bf.initiativeOrder.indexOf(summon.id);
    if (initIdx !== -1) bf.initiativeOrder.splice(initIdx, 1);
    // Clean up any pending commands for this summon
    bf.pendingCommands?.delete(summon.id);
    // Remove any pending initiative inserts for this summon
    if (bf.pendingInitiativeInserts) {
      bf.pendingInitiativeInserts = bf.pendingInitiativeInserts.filter(
        i => i.combatantId !== summon.id
      );
    }
  }
}

/**
 * Remove a single effect by its id from a specific combatant.
 * Use when a spell ends early (dispelled, duration expired) without the full
 * caster-sweep of removeEffectsFromCaster.
 */
export function removeEffectById(
  targetId: string,
  effectId: string,
  bf: Battlefield,
): void {
  const target = bf.combatants.get(targetId);
  if (!target) return;

  const effect = target.activeEffects.find(e => e.id === effectId);
  if (!effect) return;

  // Remove difficult terrain cells BEFORE undoing the effect
  if (effect.effectType === 'terrain_zone' && effect.payload.terrainDifficulty) {
    removeTerrainDifficulty(bf, effect);
  }
  _undoEffect(target, effect);
  target.activeEffects = target.activeEffects.filter(e => e.id !== effectId);
}

// ---- Helpers ------------------------------------------------

function _undoEffect(target: Combatant, effect: ActiveEffect): void {
  switch (effect.effectType) {
    case 'advantage_vs':
      // Removes ALL vulnerability entries with this source label — safe because
      // each concentration spell can only be cast once (no stacking).
      removeBySource(target, effect.spellName);
      break;

    case 'condition_apply':
      target.conditions.delete(effect.payload.condition!);
      // Clear save-fail tracker if this effect belongs to a tracker spell
      // (Contagion / Flesh to Stone). When the condition is removed (e.g.
      // by concentration break or removeEffectsFromCaster), the tracker
      // should also be cleared so no further save processing happens.
      if (target._saveFailTracker &&
          target._saveFailTracker.spellName === effect.spellName &&
          target._saveFailTracker.casterId === effect.casterId) {
        delete target._saveFailTracker;
      }
      break;

    case 'dominated':
      target.conditions.delete('charmed');
      target.conditions.delete('incapacitated');
      break;

    case 'suggestion':
      target.conditions.delete('charmed');
      removeBySource(target, effect.spellName);
      break;

    case 'exhaustion_level':
      // Exhaustion doesn't auto-undo on effect removal — it persists
      // (PHB p.291: exhaustion is removed by rest/spells, not by dispel)
      break;

    case 'invisible':
      // Remove the invisible condition + both adv_system entries
      target.conditions.delete('invisible');
      removeBySource(target, effect.spellName);
      break;

    case 'taunt':
    case 'curse_attack_disadv':
    case 'ability_disadvantage':
    case 'curse_rider':
    case 'ac_bonus':
    case 'ac_floor':
    case 'bless_die':
    case 'bane_die':
    case 'weapon_enchant':
    case 'enlarge_reduce':
    case 'terrain_zone':
      // Read-only at resolution — nothing to undo structurally.
      break;

    case 'damage_zone':
      // Read-only at resolution — nothing to undo structurally.
      //
      // Session 17: some concentration spells use a `damage_zone` effect with
      // `dieCount: 0` as a SENTINEL to anchor concentration-break cleanup for
      // their scratch-field buffs (the scratch field is the real mechanic; the
      // sentinel effect is just a lifecycle anchor so removeEffectsFromCaster
      // clears it). When such a sentinel is removed, clear the matching
      // scratch field. The start-of-turn damage tick naturally skips
      // dieCount=0 effects (the existing `if (dieCount <= 0) continue;` check).
      if ((effect.payload.dieCount ?? 0) === 0) {
        switch (effect.spellName) {
          case 'Flame Blade':
            delete target._flameBladeActive;
            break;
          case 'Alter Self':
            delete target._alterSelfActive;
            break;
          case 'Enhance Ability':
            delete target._enhanceAbilityActive;
            break;
          case 'Silence':
            delete target._silenceZoneActive;
            break;
          // ── Session 18 (Group C/D/E) — forward-compat flag scratch fields ──
          case 'Detect Thoughts':
            delete target._detectThoughtsActive;
            break;
          case 'Spider Climb':
            delete target._spiderClimbActive;
            break;
          case 'Pass without Trace':
            delete target._passWithoutTraceActive;
            break;
          case 'Zone of Truth':
            delete target._zoneOfTruthActive;
            break;
          case 'Enthrall':
            delete target._enthrallActive;
            break;
          // ── Session 18 (Group A) — Ray of Enfeeblement scratch field ──
          case 'Ray of Enfeeblement':
            delete target._rayOfEnfeeblementActive;
            break;
          // ── Session 28 — Eyebite scratch field ──
          // When the Eyebite sentinel (damage_zone dieCount=0 on the caster)
          // is removed (concentration break), clear the _eyebiteActive scratch
          // field so per-turn re-target stops.
          case 'Eyebite':
            delete target._eyebiteActive;
            break;
        }
      }
      break;
  }
}

// ---- AC bonus query (used by combat.ts resolveAttack) -------

/**
 * Sum all ac_bonus effects currently active on a combatant.
 * Called inline when computing effectiveAC.
 */
export function getActiveAcBonus(c: Combatant): number {
  return c.activeEffects
    .filter(e => e.effectType === 'ac_bonus')
    .reduce((sum, e) => sum + (e.payload.acBonus ?? 0), 0);
}

// ---- AC floor query (used by combat.ts resolveAttack) -------

/**
 * Returns the highest ac_floor value currently active on a combatant, or 0 if
 * none. PHB p.217 (Barkskin): "the target's AC can't be less than 16". When
 * multiple ac_floor effects are active (e.g. from different casters — rare but
 * possible), the highest floor wins (mirror getActiveBlessDie's max-roll
 * semantics). Called inline by resolveAttack when computing effectiveAC —
 * effective AC = max(natural AC, ac_floor) + ac_bonus + wardingBond + cover.
 */
export function getActiveAcFloor(c: Combatant): number {
  return c.activeEffects
    .filter(e => e.effectType === 'ac_floor')
    .reduce((max, e) => Math.max(max, e.payload.acFloor ?? 0), 0);
}

// ---- Bless die query (used by combat.ts / utils.ts) ---------

/**
 * Returns the largest bless_die sides active on a combatant, or 0 if none.
 * Per RAW, Bless doesn't stack — only the highest-sided die applies if somehow
 * two bless effects were present (edge case, but guarded).
 */
export function getActiveBlessDie(c: Combatant): number {
  return c.activeEffects
    .filter(e => e.effectType === 'bless_die')
    .reduce((max, e) => Math.max(max, e.payload.dieSides ?? 0), 0);
}

/**
 * Returns the largest bane_die sides active on a combatant, or 0 if none.
 * Bane (PHB p.219): -1d4 to attack rolls & saving throws. The value is
 * SUBTRACTED at resolution time (mirror getActiveBlessDie but inverse).
 * Session 27 Batch 3.
 */
export function getActiveBaneDie(c: Combatant): number {
  return c.activeEffects
    .filter(e => e.effectType === 'bane_die')
    .reduce((max, e) => Math.max(max, e.payload.dieSides ?? 0), 0);
}

// ---- Hex damage query (used by combat.ts) -------------------

/**
 * Returns the hex die size (6) if `target` has an active Hex cast by `attackerId`,
 * or 0 if the target is not hexed by that attacker.
 * PHB p.251: the bonus damage applies only when the Hex caster hits the hexed target.
 */
export function getActiveHexDie(target: Combatant, attackerId: string): number {
  const effect = target.activeEffects.find(
    e => e.effectType === 'hex_damage' && e.casterId === attackerId
  );
  return effect?.payload.hexDie ?? 0;
}

// ---- Damage zone query (used by combat.ts runCombat loop) ---

/**
 * Returns all active damage_zone effects on a combatant. Each entry deals
 * `dieCount`d`dieSides` `damageType` damage at the start of the combatant's
 * turn (PHB p.222 Cloud of Daggers: "starts its turn there"). Multiple
 * damage_zone effects from different casters all tick independently (rare
 * but possible — e.g. two Cloud of Daggers casters overlapping zones).
 *
 * Called by the start-of-turn damage tick in combat.ts's runCombat loop
 * (right after resetBudget). The damage is applied via applyDamageWithTempHP
 * so resistances / temp HP / Warding Bond redirect all work as expected.
 *
 * Session 17: damage_zone effects with `dieCount === 0` are SENTINELS
 * (no damage tick) — they anchor concentration-break cleanup for scratch-
 * field buffs (Flame Blade, Alter Self, Enhance Ability). The caller
 * (combat.ts start-of-turn tick) already skips dieCount=0 via the
 * `if (dieCount <= 0 || dieSides <= 0) continue;` check, so this query
 * can return them safely.
 */
export function getActiveDamageZones(c: Combatant): ActiveEffect[] {
  return c.activeEffects.filter(e => e.effectType === 'damage_zone');
}

// ---- Weapon enchant query (Session 17 — Magic Weapon PHB p.257) ---

/**
 * Returns the sum of all `weapon_enchant` effects' attackBonus and
 * damageBonus on a combatant. Each entry is a flat +N to attack rolls
 * AND damage rolls with weapon attacks (melee/ranged, NOT spell).
 * Called by resolveAttack's attack-roll branch (adds to attack total)
 * and damage branch (adds to weapon damage).
 *
 * v1: Magic Weapon (PHB p.257) is the only source of weapon_enchant
 * effects in v1. The bonus is +1 at 2nd level (upcast +2/+3 NOT modelled).
 * Multiple weapon_enchant effects would stack (rare — PHB p.205 "magical
 * effects on the same target don't stack" usually applies, but v1 allows
 * stacking for simplicity).
 */
export function getActiveWeaponEnchant(c: Combatant): { attackBonus: number; damageBonus: number; damageDie: number; damageDieCount: number; damageDieType?: DamageType } {
  let attackBonus = 0;
  let damageBonus = 0;
  let damageDie = 0;
  let damageDieCount = 0;
  let damageDieType: DamageType | undefined;
  for (const e of c.activeEffects) {
    if (e.effectType !== 'weapon_enchant') continue;
    attackBonus += e.payload.attackBonus ?? 0;
    damageBonus  += e.payload.damageBonus  ?? 0;
    // Session 27 Batch 3: extra damage die (Divine Favor, Holy Weapon, etc.)
    if (damageDie === 0 && (e.payload.damageDie ?? 0) > 0) {
      damageDie = e.payload.damageDie ?? 0;
      damageDieCount = e.payload.damageDieCount ?? 1;
      damageDieType = e.payload.damageDieType;
    }
  }
  return { attackBonus, damageBonus, damageDie, damageDieCount, damageDieType };
}

// ---- Taunt query (Antagonize EGtW p.150) --------------------

/**
 * Returns the taunt caster ID if the combatant is taunted, or null if not.
 * A taunted creature has disadvantage on attack rolls against any target
 * EXCEPT the taunt caster (EGtW p.150: "disadvantage on attack rolls
 * against creatures other than you"). Consumed in combat.ts resolveAttack.
 *
 * If multiple taunt effects are active (rare — would require two casters),
 * the first one found wins (v1 simplification).
 */
export function getActiveTaunt(c: Combatant): string | null {
  const taunt = c.activeEffects.find(e => e.effectType === 'taunt');
  return taunt?.payload.tauntCasterId ?? null;
}

// ---- Enlarge/Reduce query (Session 17 — Enlarge/Reduce PHB p.237) ---

/**
 * Returns the active `enlarge_reduce` mode on a combatant, or null if none.
 *   'enlarge' → +1d8 weapon damage, advantage on STR checks/saves.
 *   'reduce'  → half weapon damage, disadvantage on STR checks/saves.
 *   null      → no Enlarge/Reduce effect active.
 *
 * Called by:
 *   - resolveAttack's damage branch (the ATTACKER's effect — modifies
 *     outgoing weapon damage).
 *   - rollAbilityCheck (the creature's OWN effect — STR check adv/disadv).
 *   - rollSave (the creature's OWN effect — STR save adv/disadv).
 *
 * If multiple enlarge_reduce effects are active on the same creature
 * (rare — would require two casters), the first one found wins (v1
 * simplification — PHB p.205 says magical effects don't stack anyway).
 */
export function getActiveEnlargeReduce(c: Combatant): 'enlarge' | 'reduce' | null {
  for (const e of c.activeEffects) {
    if (e.effectType !== 'enlarge_reduce') continue;
    return e.payload.enlargeReduceMode ?? null;
  }
  return null;
}

// ---- Curse attack disadv query (Bestow Curse PHB p.214 opt.1) ----

/**
 * Returns the list of curse-caster IDs that the combatant has disadvantage
 * on attack rolls against. A creature affected by Bestow Curse (opt.1) has
 * disadvantage on attack rolls against the creature that cast the curse
 * (PHB p.214: "the target has disadvantage on attack rolls against you").
 *
 * Consumed in combat.ts resolveAttack — if the attacker attacks a creature
 * whose ID appears in this list, the attack has disadvantage.
 *
 * Mirror of taunt (taunt = disadv vs non-caster; curse_attack_disadv =
 * disadv vs specific caster). Multiple curse effects from different casters
 * can stack (each adds one ID to the list).
 */
export function getActiveCurseAttackDisadv(c: Combatant): string[] {
  const casterIds: string[] = [];
  for (const e of c.activeEffects) {
    if (e.effectType !== 'curse_attack_disadv') continue;
    if (e.payload.curseCasterId) casterIds.push(e.payload.curseCasterId);
  }
  return casterIds;
}

// ---- Ability disadvantage query (Bestow Curse PHB p.214 opt.2) ----

/**
 * Returns true if the combatant has disadvantage on ability checks and
 * saving throws with the given ability score (Bestow Curse PHB p.214 opt.2:
 * "disadvantage on ability checks and saving throws made with that
 * ability score").
 *
 * Consumed in utils.ts rollSave and rollAbilityCheck.
 */
export function hasAbilityDisadvantage(c: Combatant, ability: AbilityScore): boolean {
  return c.activeEffects.some(
    e => e.effectType === 'ability_disadvantage' && e.payload.ability === ability
  );
}

// ---- Terrain zone query (Grease/Sleet Storm/Watery Sphere) ----

/**
 * Represents a persistent terrain zone on the battlefield.
 * When a creature starts its turn in or enters the zone's radius,
 * it must make a save or suffer the zone's condition (e.g. prone,
 * restrained). The zone is stored as a terrain_zone effect on the
 * CASTER — this interface extracts the zone definition for easy
 * consumption by combat.ts's start-of-turn terrain check.
 *
 * v1 simplification: only start-of-turn check is implemented.
 * Canon says creatures entering the zone also save immediately;
 * this requires deeper movement system integration (v2).
 */
export interface TerrainZone {
  casterId: string;
  spellName: string;
  condition?: Condition;                    // optional: zones with only difficult terrain (no save/condition)
  saveAbility?: 'str' | 'dex' | 'con' | 'wis'; // optional: only needed when condition is set
  radiusFt: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  sourceIsConcentration: boolean;
  terrainDifficulty?: boolean;              // if true, this zone marks cells as difficult terrain
}

/**
 * Returns all active terrain zones on the battlefield.
 * Iterates over all combatants' activeEffects, collects terrain_zone effects,
 * and extracts them into TerrainZone objects for consumption by combat.ts.
 *
 * Called by the start-of-turn terrain check in combat.ts's runCombat loop
 * (after damage_zone ticks and save-fail tracker processing).
 */
export function getActiveTerrainZones(bf: Battlefield): TerrainZone[] {
  const zones: TerrainZone[] = [];
  for (const c of bf.combatants.values()) {
    for (const e of c.activeEffects) {
      if (e.effectType !== 'terrain_zone') continue;
      zones.push({
        casterId: e.casterId,
        spellName: e.spellName,
        condition: e.payload.terrainCondition,
        saveAbility: e.payload.terrainSaveAbility,
        radiusFt: e.payload.terrainRadiusFt!,
        centerX: e.payload.terrainCenterX!,
        centerY: e.payload.terrainCenterY!,
        centerZ: e.payload.terrainCenterZ!,
        sourceIsConcentration: e.sourceIsConcentration,
        terrainDifficulty: e.payload.terrainDifficulty,
      });
    }
  }
  return zones;
}

// ---- Curse rider query (Bestow Curse PHB p.214 opt.4) ----

/**
 * Returns the active curse rider info if the attacker has a curse_rider
 * effect and the target is the riderCasterId, or null if not applicable.
 * Bestow Curse PHB p.214 opt.4: "each time the target makes an attack roll
 * or spell attack against you, it takes 1d8 necrotic damage."
 *
 * The rider applies when the ATTACKER (who has the curse_rider effect)
 * attacks the curse caster (identified by riderCasterId). The attacker
 * takes necrotic damage (self-damage).
 *
 * Consumed in combat.ts resolveAttack's damage branch.
 */
export function getActiveCurseRider(
  attacker: Combatant,
  targetId: string,
): { die: number; count: number; damageType: DamageType } | null {
  const effect = attacker.activeEffects.find(
    e => e.effectType === 'curse_rider' && e.payload.riderCasterId === targetId
  );
  if (!effect) return null;
  const die = effect.payload.riderDie ?? 0;
  const count = effect.payload.riderDieCount ?? 1;
  const damageType = effect.payload.riderDamageType ?? 'necrotic';
  if (die <= 0) return null;
  return { die, count, damageType };
}

// ---- Terrain difficulty (terrain_zone with terrainDifficulty) ----

/**
 * Mark cells within a terrain zone's radius as difficult terrain.
 * Called when a terrain_zone effect with terrainDifficulty:true is applied.
 *
 * PHB p.182: "You move at half speed in difficult terrain — moving 1 foot in
 * difficult terrain costs 2 feet of movement." Each square costs 10ft instead
 * of 5ft (see squareCostFt in movement.ts).
 *
 * The cells are tracked in Battlefield.difficultTerrainCells (a Set of "x,y,z"
 * keys matching posKey format). Movement code checks this set via a terrainFn
 * callback passed to estimateMoveCostFt.
 */
export function applyTerrainDifficulty(bf: Battlefield, effect: ActiveEffect): void {
  if (effect.effectType !== 'terrain_zone') return;
  if (!effect.payload.terrainDifficulty) return;

  const radiusFt = effect.payload.terrainRadiusFt ?? 0;
  const radiusSquares = Math.ceil(radiusFt / 5);
  const cx = effect.payload.terrainCenterX ?? 0;
  const cy = effect.payload.terrainCenterY ?? 0;
  const cz = effect.payload.terrainCenterZ ?? 0;

  if (!bf.difficultTerrainCells) bf.difficultTerrainCells = new Set();

  for (let dx = -radiusSquares; dx <= radiusSquares; dx++) {
    for (let dy = -radiusSquares; dy <= radiusSquares; dy++) {
      // Chebyshev radius check
      if (Math.max(Math.abs(dx), Math.abs(dy)) > radiusSquares) continue;
      const key = `${cx + dx},${cy + dy},${cz}`;
      bf.difficultTerrainCells.add(key);
    }
  }
}

/**
 * Remove cells from the difficult terrain set for a terrain zone effect.
 * Called when the effect is removed (concentration break, dispel, etc.).
 */
export function removeTerrainDifficulty(bf: Battlefield, effect: ActiveEffect): void {
  if (effect.effectType !== 'terrain_zone') return;
  if (!effect.payload.terrainDifficulty) return;
  if (!bf.difficultTerrainCells) return;

  const radiusFt = effect.payload.terrainRadiusFt ?? 0;
  const radiusSquares = Math.ceil(radiusFt / 5);
  const cx = effect.payload.terrainCenterX ?? 0;
  const cy = effect.payload.terrainCenterY ?? 0;
  const cz = effect.payload.terrainCenterZ ?? 0;

  for (let dx = -radiusSquares; dx <= radiusSquares; dx++) {
    for (let dy = -radiusSquares; dy <= radiusSquares; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > radiusSquares) continue;
      const key = `${cx + dx},${cy + dy},${cz}`;
      bf.difficultTerrainCells.delete(key);
    }
  }
}

/**
 * Returns a terrainFn callback suitable for estimateMoveCostFt that checks
 * Battlefield.difficultTerrainCells. If the cell is in the set, returns
 * 'difficult'; otherwise 'normal'.
 *
 * Usage: estimateMoveCostFt(from, to, hasClimb, hasSwim, makeTerrainFn(bf))
 */
export function makeTerrainFn(bf: Battlefield): (pos: Vec3) => TerrainType {
  return (pos: Vec3): TerrainType => {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (bf.difficultTerrainCells?.has(key)) return 'difficult';
    // Also check the static cells array if present
    if (bf.cells && Array.isArray(bf.cells) && bf.cells[pos.x]?.[pos.y]?.[pos.z]) {
      return bf.cells[pos.x][pos.y][pos.z].terrain;
    }
    return 'normal';
  };
}

/** Returns the target's current exhaustion level (PHB p.291). */
export function getExhaustionLevel(c: Combatant): number {
  return c.exhaustionLevel;
}
