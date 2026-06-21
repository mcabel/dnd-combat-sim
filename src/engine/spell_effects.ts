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

import { ActiveEffect, Combatant, Battlefield, SpellEffectType, DamageType } from '../types/core';
import { grantVulnerability, removeBySource } from './adv_system';

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

    case 'taunt':
    case 'ac_bonus':
    case 'ac_floor':
    case 'bless_die':
    case 'bane_die':
    case 'damage_zone':
    case 'weapon_enchant':
    case 'enlarge_reduce':
      // No immediate side-effect — read at resolution time.
      // (damage_zone: the start-of-turn damage tick is in combat.ts's
      // runCombat loop, right after resetBudget.)
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
  for (const combatant of bf.combatants.values()) {
    const owned = combatant.activeEffects.filter(e => e.casterId === casterId);
    if (owned.length === 0) continue;

    for (const e of owned) {
      _undoEffect(combatant, e);
    }

    combatant.activeEffects = combatant.activeEffects.filter(e => e.casterId !== casterId);
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
      break;

    case 'taunt':
    case 'ac_bonus':
    case 'ac_floor':
    case 'bless_die':
    case 'bane_die':
    case 'weapon_enchant':
    case 'enlarge_reduce':
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
