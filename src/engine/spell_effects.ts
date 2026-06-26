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
// ── Session 64 RFC-COMBINING-EFFECTS Phase 1: priority activation ──
import { resolveEffectNameFromDef } from './effect_identity';
import { reevaluateEffects, isActive } from './effect_pipeline';

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

// ---- RFC-COMBINING-EFFECTS Phase 4: condition source tracking helpers ----

/** Reserved sourceId for conditions from non-spell sources (combat mechanics, etc.) */
const NON_SPELL_SOURCE = 'non-spell';

/**
 * Register a sourceId as imposing a condition on the target.
 * Used by applySpellEffect (sourceId = effect.id) and addCondition
 * (sourceId = 'non-spell'). The pipeline's _rederiveConditions()
 * rebuilds the conditions Set by checking which sourceIds are still valid.
 */
function _addConditionSource(target: Combatant, condition: Condition, sourceId: string): void {
  if (!target._conditionSources) target._conditionSources = new Map();
  let sources = target._conditionSources.get(condition);
  if (!sources) { sources = new Set(); target._conditionSources.set(condition, sources); }
  sources.add(sourceId);
}

/**
 * Remove a sourceId from imposing a condition on the target.
 * Used by undoEffect when a spell effect is removed. After removal,
 * if no other sourceId backs the condition, _rederiveConditions()
 * will correctly exclude it from the rebuilt Set.
 *
 * IMPORTANT: we do NOT delete the entry from _conditionSources even
 * if the sourceIds Set becomes empty. Empty entries serve as "tombstones"
 * that tell _rederiveConditions this condition was previously spell-sourced
 * (not a non-spell condition that was set directly on the Set).
 */
function _removeConditionSource(target: Combatant, condition: Condition, sourceId: string): void {
  const sources = target._conditionSources?.get(condition);
  if (sources) {
    sources.delete(sourceId);
    // Do NOT delete the entry even if empty — it serves as a tombstone
  }
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
  // ── Session 64 RFC-COMBINING-EFFECTS Phase 1 ──
  // Auto-populate effectName via the identity registry when absent, so spell
  // modules don't all need updating in lock-step. Spell modules can override
  // by setting effectName explicitly on the def.
  const effectName = def.effectName ?? resolveEffectNameFromDef(def);
  const effect: ActiveEffect = {
    ...def,
    effectName,
    appliedTurn: def.appliedTurn ?? 0,   // default 0; spell modules with bf in scope can pass bf.round
    id: nextEffectId(),
  };
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
      // Session 47 Task #29-follow-up-3: Nature's Ward (Land Druid 10) immunity.
      // PHB p.68: immune to poison. If the target has Nature's Ward, skip
      // applying the 'poisoned' condition. The fey/elemental charm/frighten
      // immunity is not checked here (requires source-creature-type tracking).
      if (effect.payload.condition === 'poisoned' && target.classFeatures?.includes("Nature's Ward")) {
        break; // immune — do not apply
      }
      // ── TG-032: Nature's Ward fey/elemental charm/frighten immunity ──
      // PHB p.69: "Starting at 10th level, you can't be charmed or frightened
      // by fey or elementals." If the target has Nature's Ward AND the effect
      // carries a sourceCreatureType of 'fey' or 'elemental' AND the condition
      // is charmed or frightened, skip application. Backward-compatible: if
      // sourceCreatureType is absent (legacy spell modules), the check is a
      // no-op and the condition applies as before.
      if (
        target.classFeatures?.includes("Nature's Ward") &&
        (effect.payload.condition === 'charmed' || effect.payload.condition === 'frightened') &&
        (effect.sourceCreatureType === 'fey' || effect.sourceCreatureType === 'elemental')
      ) {
        break; // immune — fey/elemental source cannot charm/frighten Nature's Ward target
      }
      // ── RFC-COMBINING-EFFECTS Phase 4: source-tracked conditions ──
      // Add to conditions Set for immediate visibility AND register the source
      // in _conditionSources so the pipeline can correctly re-derive later.
      target.conditions.add(effect.payload.condition!);
      _addConditionSource(target, effect.payload.condition!, effect.id);
      break;

    case 'dominated':
      target.conditions.add('charmed');
      target.conditions.add('incapacitated');
      _addConditionSource(target, 'charmed', effect.id);
      _addConditionSource(target, 'incapacitated', effect.id);
      break;

    case 'suggestion':
      // PHB p.258: target pursues a course of action ("Don't fight").
      // Modeled as charmed (can't attack the caster) + disadvantage on the
      // target's own attack rolls (following the suggestion — won't fight effectively).
      target.conditions.add('charmed');
      _addConditionSource(target, 'charmed', effect.id);
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
      _addConditionSource(target, 'invisible', effect.id);
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
    case 'movement_rider':
    case 'spell_shield':
      // No immediate side-effect — read at resolution time.
      // (damage_zone: the start-of-turn damage tick is in combat.ts's
      // runCombat loop, right after resetBudget.)
      // (terrain_zone: the start-of-turn terrain check is in combat.ts's
      // runCombat loop, after damage_zone ticks.)
      // (movement_rider: fires in executeMove when bearer willingly moves
      // 5+ ft; cleared at start of bearer's next turn by cleanup().)
      // (spell_shield: checked by isProtectedByGoI() in combat.ts before
      // spell execution; no structural mutation on apply.)
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
      // ── Session 62: remove battlefield obstacle (Fog Cloud, etc.) ──
      if (e.effectType === 'battlefield_obstacle') {
        removeBattlefieldObstacle(bf, e);
      }
      undoEffect(combatant, e);
    }

    combatant.activeEffects = combatant.activeEffects.filter(e => e.casterId !== casterId);

    // ── Session 64 RFC-COMBINING-EFFECTS Phase 1 ──
    // After removing this caster's effects, re-evaluate priority activation
    // so any suppressed same-name effects from OTHER casters promote to
    // active immediately (no 1-round gap). E.g. cleric A's Bless breaks →
    // cleric B's suppressed Bless promotes to active right now.
    reevaluateEffects(combatant, bf);
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
  // ── Session 62: remove battlefield obstacle (Fog Cloud, etc.) ──
  if (effect.effectType === 'battlefield_obstacle') {
    removeBattlefieldObstacle(bf, effect);
  }
  undoEffect(target, effect);
  target.activeEffects = target.activeEffects.filter(e => e.id !== effectId);

  // ── Fix: rebuild conditions Set after effect removal ──
  // undoEffect() calls _removeConditionSource() (removes the effect's
  // sourceId from _conditionSources) but does NOT rebuild the `conditions`
  // Set. Without this reevaluateEffects() call, the conditions Set stays
  // stale — e.g. Invisibility's breaksOnAttackOrCast removes the
  // activeEffect but `target.conditions.has('invisible')` still returns
  // true. Mirrors removeEffectsFromCaster (line ~258) which calls
  // reevaluateEffects after removing concentration-bound effects.
  reevaluateEffects(target, bf);
}

// ---- Helpers ------------------------------------------------

/**
 * Undo the structural side-effects of an ActiveEffect on a combatant.
 * Called when an effect is removed (concentration break, expiry, dispel).
 *
 * Exported for use by the effect-pipeline expiry step (Phase 2).
 */
export function undoEffect(target: Combatant, effect: ActiveEffect): void {
  switch (effect.effectType) {
    case 'advantage_vs':
      // Removes ALL vulnerability entries with this source label — safe because
      // each concentration spell can only be cast once (no stacking).
      removeBySource(target, effect.spellName);
      break;

    case 'condition_apply':
      // ── RFC-COMBINING-EFFECTS Phase 4: source-tracked conditions ──
      // Remove this effect's sourceId from _conditionSources. The pipeline's
      // _rederiveConditions() will rebuild the Set from remaining sources.
      // If another same-name effect is suppressed and takes over, its sourceId
      // remains in _conditionSources and the condition persists — this fixes
      // the pre-existing bug where Darkness ending wrongly removed 'blinded'
      // even though Blindness/Deafness was still active (just was suppressed).
      _removeConditionSource(target, effect.payload.condition!, effect.id);
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
      // ── RFC-COMBINING-EFFECTS Phase 4: source-tracked conditions ──
      _removeConditionSource(target, 'charmed', effect.id);
      _removeConditionSource(target, 'incapacitated', effect.id);
      break;

    case 'suggestion':
      // ── RFC-COMBINING-EFFECTS Phase 4: source-tracked conditions ──
      _removeConditionSource(target, 'charmed', effect.id);
      removeBySource(target, effect.spellName);
      break;

    case 'exhaustion_level':
      // Exhaustion doesn't auto-undo on effect removal — it persists
      // (PHB p.291: exhaustion is removed by rest/spells, not by dispel)
      break;

    case 'invisible':
      // ── RFC-COMBINING-EFFECTS Phase 4: source-tracked conditions ──
      _removeConditionSource(target, 'invisible', effect.id);
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
    case 'movement_rider':
    case 'spell_shield':
      // Read-only at resolution — nothing to undo structurally.
      // (spell_shield: the effect is simply removed from activeEffects;
      //  no structural state was mutated on apply.)
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
          // ── Session 34 — Protection from Energy resistance removal ──
          // ── Session 36 — innate-resistance fix ──
          // When the sentinel (damage_zone dieCount=0 on the target, with
          // payload.damageType set) is removed (concentration break), remove
          // the resistance we added to target.resistances — BUT only if the
          // spell actually added it (payload.addedResistance === true).
          //
          // Session 36 fix: if the target had INNATE resistance to the same
          // type the spell grants, the spell's idempotent push was a no-op
          // (addedResistance === false). In that case we must NOT splice —
          // doing so would wrongly remove the innate entry. Only the type
          // we added is removed; innate resistance to other types is always
          // preserved.
          //
          // Backwards compat: payload.addedResistance === undefined (legacy
          // pre-Session 36 sentinels) → assume true (the original Session 34
          // behavior spliced unconditionally).
          case 'Protection from Energy': {
            const dt = effect.payload.damageType;
            const added = effect.payload.addedResistance !== false;  // default true
            if (dt && added) {
              const idx = target.resistances.indexOf(dt);
              if (idx >= 0) target.resistances.splice(idx, 1);
            }
            break;
          }
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
    .filter(e => e.effectType === 'ac_bonus' && isActive(e))
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
    .filter(e => e.effectType === 'ac_floor' && isActive(e))
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
    .filter(e => e.effectType === 'bless_die' && isActive(e))
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
    .filter(e => e.effectType === 'bane_die' && isActive(e))
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
  return c.activeEffects.filter(e => e.effectType === 'damage_zone' && isActive(e));
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
    if (!isActive(e)) continue;  // Session 64: suppressed effects don't apply
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
 * ── Session 62 RFC-VISION-AUDIO: remove a battlefield obstacle ──
 *
 * Called when a 'battlefield_obstacle' effect is removed (concentration
 * break, dispel, caster death). Removes the obstacle with the stored ID
 * from bf.obstacles. Used by Fog Cloud and future obscurement spells.
 *
 * Safe if the obstacle was already removed (e.g. manual cleanup).
 */
export function removeBattlefieldObstacle(bf: Battlefield, effect: ActiveEffect): void {
  if (effect.effectType !== 'battlefield_obstacle') return;
  const obstacleId = effect.payload.obstacleId;
  if (!obstacleId) return;
  if (!bf.obstacles) return;

  const idx = bf.obstacles.findIndex(o => o.id === obstacleId);
  if (idx >= 0) {
    bf.obstacles.splice(idx, 1);
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

// ---- Globe of Invulnerability (PHB p.245) ─────────────────

/**
 * Returns true if `target` is protected by Globe of Invulnerability (PHB p.245).
 *
 * PHB p.245: "An immobile, faintly shimmering barrier springs into existence
 * in a 10-foot radius around you... Any spell of 5th level or lower cast
 * from outside the barrier can't affect creatures or objects within it."
 *
 * Upcast: L6→blocks ≤5, L7→blocks ≤6, L8→blocks ≤7, L9→blocks ≤8.
 * Cantrips (level 0) are NOT blocked by GoI.
 *
 * Session 80: Now checks both the target's own GoI AND any nearby GoI
 * caster within 10 ft (Chebyshev 3D). The `bf` parameter enables spatial
 * queries; if omitted, falls back to self-only check (backward compat for
 * tests that don't pass a battlefield).
 */
export function isProtectedByGoI(target: Combatant, castLevel: number, bf?: Battlefield): boolean {
  if (castLevel <= 0) return false;  // cantrips never blocked
  // 1) Target's own GoI effect
  if (target.activeEffects?.some(eff =>
    eff.effectType === 'spell_shield' &&
    eff.spellName === 'Globe of Invulnerability' &&
    castLevel <= (eff.payload.blockThreshold ?? 0)
  )) return true;

  // 2) Any nearby GoI caster within 10 ft (PHB p.245: 10-ft radius)
  if (bf) {
    for (const c of bf.combatants.values()) {
      if (c.isDead || c.isUnconscious) continue;
      if (c.id === target.id) continue;  // already checked above
      // Does this combatant have an active GoI?
      const goiEff = c.activeEffects?.find(eff =>
        eff.effectType === 'spell_shield' &&
        eff.spellName === 'Globe of Invulnerability' &&
        castLevel <= (eff.payload.blockThreshold ?? 0)
      );
      if (!goiEff) continue;
      // Is the target within 10 ft of this GoI caster? (Chebyshev 3D)
      // 10 ft = 2 squares (each square = 5 ft)
      const dx = Math.abs(target.pos.x - c.pos.x);
      const dy = Math.abs(target.pos.y - c.pos.y);
      const dz = Math.abs(target.pos.z - c.pos.z);
      const chebyshev = Math.max(dx, dy, dz);
      if (chebyshev <= 2) return true;  // within 10-ft radius
    }
  }
  return false;
}

/**
 * Filter a list of AoE spell targets, removing those protected by Globe of
 * Invulnerability (PHB p.245). The caster's own GoI does NOT block their
 * own spells (PHB p.245: "cast from outside the barrier").
 *
 * Used by AoE spell execute() functions to exclude GoI-protected targets
 * from spell effects (damage, conditions, etc.). PHB p.245: "the spell has
 * no effect on them" — this applies to ALL spell effects, not just damage.
 * The spell still fires (slot consumed, action used); only the protected
 * targets are skipped.
 *
 * Session 77 (RFC-UPCASTING Phase 4 follow-up): closes the
 * `globeOfInvulnerabilityAoEV1Simplified: true` gap for the 5 core
 * damage AoE spells (fireball, lightning_bolt, burning_hands, shatter,
 * thunderwave).
 *
 * Session 78: extended to 12 more spells (arms_of_hadar, hunger_of_hadar,
 * call_lightning, cloud_of_daggers, flaming_sphere, ice_knife,
 * spirit_guardians, guardian_of_faith, dawn, sunburst, tidal_wave,
 * stinking_cloud). For persistent damage_zone spells, the effect IS applied
 * to GoI-protected targets (so it can tick later if GoI expires), but the
 * on-cast damage is skipped. The combat.ts damage_zone tick loop re-checks
 * GoI on each per-turn tick using the zone's sourceSlotLevel.
 *
 * Session 79: extended to 36 more spells — ALL remaining damage AoE spells
 * now covered. Pattern A (instantaneous, 23 spells): chain_lightning,
 * circle_of_death, cone_of_cold, dark_star, destructive_wave, earth_tremor,
 * earthquake, erupting_earth, fire_storm, flame_strike, frost_fingers,
 * gravity_fissure, gravity_sinkhole, incendiary_cloud, maddening_darkness,
 * magnify_gravity, pulse_wave, ravenous_void, spray_of_cards, storm_sphere,
 * sunbeam, synaptic_static, weird, whirlwind. Pattern B (persistent
 * damage_zone, 6 spells): cloudkill, death_armor, dust_devil, insect_plague,
 * storm_of_vengeance. Pattern B terrain_zone (3 spells):
 * evards_black_tentacles, maelstrom, sickening_radiance. Pattern B
 * single-target persistent (4 spells): moonbeam, spike_growth, wall_of_fire,
 * wall_of_ice. With this, `globeOfInvulnerabilityAoEV1Simplified` is flipped
 * to `false` and `globeOfInvulnerabilityAoEPartialV1Implemented` is removed —
 * GoI AoE exclusion is now complete (v1).
 *
 * @param targets   Candidate targets in the AoE
 * @param castLevel The actual spell slot level consumed (e.g. 3 for L3 Fireball).
 *                  Pass 0 for cantrips — cantrips are never blocked by GoI
 *                  (PHB p.245) so the filter is a no-op.
 * @param casterId  The casting combatant's ID. PHB p.245: spells cast from
 *                  outside the barrier are blocked; the GoI caster is at the
 *                  center, so their own spells are NOT blocked.
 * @param bf        The battlefield (optional). If provided, enables 10-ft radius
 *                  ally protection — any target within 10 ft of a GoI caster
 *                  (including the GoI caster itself) is also protected.
 *                  If omitted, only the target's own GoI effect is checked
 *                  (backward compat).
 * @returns Filtered target list (GoI-protected targets removed).
 */
export function filterGoIProtectedTargets(
  targets: Combatant[],
  castLevel: number,
  casterId: string,
  bf?: Battlefield,
): Combatant[] {
  // PHB p.245: cantrips (level 0) are never blocked by GoI.
  if (castLevel <= 0) return targets;
  return targets.filter(t => {
    // PHB p.245: "cast from outside the barrier" — the GoI caster is at the
    // center of the barrier, so their own spells are NOT blocked.
    if (t.id === casterId) return true;
    return !isProtectedByGoI(t, castLevel, bf);
  });
}
