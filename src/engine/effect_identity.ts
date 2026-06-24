// ============================================================
// Effect Identity Registry — RFC-COMBINING-EFFECTS Phase 1
//
// Module: src/engine/effect_identity.ts
//
// Maps (spellName, effectType, payload) → canonical `effectName` string.
// Two effects with the same `effectName` overlap (DMG p.252 "Combining
// Game Effects"); only the most potent applies while their durations
// overlap. Effects with different `effectName`s stack (PHB p.205
// "Combining Magical Effects" — different spells add together).
//
// The priority-activation pipeline (src/engine/effect_pipeline.ts) groups
// active effects by `effectName` to decide which ones to suppress.
//
// Phase 1 (this module): the registry + resolver. Spell modules don't need
// to change — applySpellEffect() calls resolveEffectName() automatically
// when effectName is absent on the effect def.
// ============================================================

import { ActiveEffect } from '../types/core';

/**
 * Maps a spell's name to a canonical `effectName` — the identity key used
 * by the priority-activation pipeline.
 *
 * Two effects with the same `effectName` overlap (DMG p.252). Effects with
 * different `effectName`s stack (PHB p.205 "different spells add together").
 *
 * Entries here are the EXCEPTIONS — spells whose effect identity differs
 * from their spellName. The default (resolveEffectName fallback) is
 * `spellName-lowercased:effectType`, which is correct for most spells
 * (two Fireballs from different casters don't impose a persistent effect,
 * so they don't need an entry).
 *
 * The registry grows as spell modules are wired in. Phase 1 includes the
 * most common same-name overlap cases.
 */
export const EFFECT_IDENTITY_REGISTRY: Record<string, string> = {
  // ── Conditions imposed by different sources, all → canonical condition name ──
  // Blindness/Deafness (spell) + Darkness (spell: "creatures inside are
  // effectively blinded") + Blinding Smite (weapon rider) all impose 'blinded'.
  // Two of these on the same target → only the most potent applies.
  'Blindness/Deafness': 'blinded',
  'Darkness':           'blinded',   // PHB p.230: creatures inside effectively blinded
  'Blinding Smite':     'blinded',   // PHB p.224: weapon rider that blinds on hit
  'Power Word Stun':    'stunned',
  'Stunning Strike':    'stunned',

  // ── Concentration buffs: same spell name → same effect identity ──
  // Two clerics casting Bless on the same fighter → 'bless' overlaps.
  'Bless':              'bless',
  'Bane':               'bane',
  'Shield of Faith':    'shield-of-faith',
  'Mage Armor':         'mage-armor',
  'Barkskin':           'barkskin',
  'Magic Weapon':       'magic-weapon',
  'Spiritual Weapon':   'spiritual-weapon',

  // ── Persistent AoE damage auras ──
  // Two clerics' Spirit Guardians auras on a shared target → only one ticks.
  'Spirit Guardians':   'spirit-guardians',
  'Cloud of Daggers':   'cloud-of-daggers',
  'Moonbeam':           'moonbeam',
  'Cloudkill':          'cloudkill',
  'Blade Barrier':      'blade-barrier',
  'Wall of Fire':       'wall-of-fire',
  'Flaming Sphere':     'flaming-sphere',
  'Spike Growth':       'spike-growth',
  'Sickening Radiance': 'sickening-radiance',
};

/**
 * Resolve the canonical `effectName` for an effect being applied.
 *
 * Priority:
 *   1. If the spellName is in EFFECT_IDENTITY_REGISTRY, use that.
 *   2. If effectType is 'battlefield_obstacle', use `obstacle:${obstacleId}`
 *      (co-located obstacles priority-activate; offset obstacles coexist).
 *   3. If effectType is 'damage_zone', include center coords so overlapping
 *      AoEs priority-activate but offset AoEs coexist.
 *   4. Default: `${spellName-lowercased}:${effectType}` (different effects
 *      from the same spell don't collide).
 *
 * This is called by applySpellEffect() when `effectName` is absent on the
 * input def. Spell modules can override by setting `effectName` explicitly.
 */
export function resolveEffectName(
  spellName: string,
  effectType: string,
  payload: Record<string, unknown>,
): string {
  // 1. Direct registry lookup by spell name.
  const direct = EFFECT_IDENTITY_REGISTRY[spellName];
  if (direct) return direct;

  // 2. Battlefield obstacles: include obstacleId so co-located obstacles
  //    priority-activate but offset obstacles coexist.
  if (effectType === 'battlefield_obstacle' && payload.obstacleId) {
    return `obstacle:${payload.obstacleId}`;
  }

  // 3. Damage zones: include center coords so overlapping AoEs priority-activate.
  if (effectType === 'damage_zone' && payload.terrainCenterX !== undefined) {
    const x = payload.terrainCenterX;
    const y = payload.terrainCenterY;
    return `${spellName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${x},${y}`;
  }

  // 4. Default: spell name lowercased + effectType (so different effects from
  //    the same spell don't collide — e.g. Hex's hex_damage and its condition
  //    are distinct effects).
  return `${spellName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${effectType}`;
}

/**
 * Convenience: resolve effectName from an ActiveEffect def (the Omit<ActiveEffect,'id'>
 * shape that applySpellEffect receives). Uses the effect's explicit effectName
 * if present, otherwise resolves via the registry.
 */
export function resolveEffectNameFromDef(
  def: Pick<ActiveEffect, 'spellName' | 'effectType' | 'payload' | 'effectName'>,
): string {
  if (def.effectName) return def.effectName;
  return resolveEffectName(def.spellName, def.effectType, def.payload as Record<string, unknown>);
}
