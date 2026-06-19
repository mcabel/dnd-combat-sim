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

import { ActiveEffect, Combatant, Battlefield, SpellEffectType } from '../types/core';
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

    case 'ac_bonus':
    case 'ac_floor':
    case 'bless_die':
      // No immediate side-effect — read at resolution time.
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

    case 'ac_bonus':
    case 'ac_floor':
    case 'bless_die':
      // Read-only at resolution — nothing to undo structurally.
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
