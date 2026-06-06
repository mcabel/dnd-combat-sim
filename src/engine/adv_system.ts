// ============================================================
// Advantage / Disadvantage System (PHB p.173)
// Ruleset: PHB 2014 / SAC v2.7
//
// Two arrays per Combatant:
//   advantages[]     — applies to this creature's OWN d20 rolls
//   vulnerabilities[] — applies to rolls made AGAINST this creature
//
// Refresh rule: if a new entry has the same {type, scope} as an existing
// one, keep only the entry with the LONGER roundsRemaining (no stacking).
//
// Duration tick: call tickAdvantages(c) at the START of each creature's
// turn to expire 'until_next_turn' entries and count down 'rounds' entries.
//
// Passive scores: advantage → +5, disadvantage → -5, both → 0 (PHB p.175).
// ============================================================

import { Combatant, AdvantageEntry, AdvDurationType, D20TestScope } from '../types/core';
import type { AttackType } from '../types/core';

// ---- Scope matching -----------------------------------------

/**
 * Returns true if an entry's scope applies to the given query context.
 *
 * Matching rules:
 *   'all'          → matches any query
 *   'attack'       → matches 'attack', 'attack:melee', 'attack:ranged', 'attack:spell'
 *   'attack:melee' → matches only 'attack:melee'
 *   'save'         → matches 'save', 'save:str', etc.
 *   etc.
 */
function scopeMatches(entryScope: D20TestScope, queryScope: D20TestScope): boolean {
  if (entryScope === 'all')                return true;
  if (entryScope === queryScope)           return true;
  // General scope covers specific sub-types: 'attack' covers 'attack:melee'
  if (queryScope.startsWith(entryScope + ':')) return true;
  return false;
}

// ---- Internal refresh helper --------------------------------

function addOrRefresh(arr: AdvantageEntry[], entry: AdvantageEntry): void {
  const idx = arr.findIndex(e => e.type === entry.type && e.scope === entry.scope);
  if (idx === -1) {
    arr.push(entry);
    return;
  }
  // Refresh rule: keep whichever duration is longer
  if (entry.roundsRemaining > arr[idx].roundsRemaining) {
    arr[idx] = entry;
  }
  // If existing is longer, ignore the new entry
}

function makeEntry(
  type:         'advantage' | 'disadvantage',
  scope:        D20TestScope,
  source:       string,
  durationType: AdvDurationType,
  rounds:       number,
): AdvantageEntry {
  const roundsRemaining =
    durationType === 'permanent'       ? Infinity :
    durationType === 'until_next_turn' ? 1        : rounds;
  return { type, scope, source, durationType, roundsRemaining };
}

// ---- Grant --------------------------------------------------

/**
 * Grant advantage or disadvantage on this creature's OWN rolls.
 *
 * @param c            The creature receiving the grant
 * @param type         'advantage' or 'disadvantage'
 * @param scope        Which test this applies to (e.g. 'attack:melee', 'save:dex')
 * @param source       Label for logging/removal (e.g. 'Reckless Attack')
 * @param durationType 'permanent' | 'until_next_turn' | 'rounds'
 * @param rounds       Only used when durationType === 'rounds'
 */
export function grantSelf(
  c:            Combatant,
  type:         'advantage' | 'disadvantage',
  scope:        D20TestScope,
  source:       string,
  durationType: AdvDurationType,
  rounds       = 1,
): void {
  addOrRefresh(c.advantages, makeEntry(type, scope, source, durationType, rounds));
}

/**
 * Grant advantage or disadvantage on rolls made AGAINST this creature.
 *
 * Examples:
 *   Dodge       → grantVulnerability(dodger, 'disadvantage', 'attack', 'Dodge', 'until_next_turn')
 *   Reckless    → grantVulnerability(barb,   'advantage',    'attack', 'Reckless Attack', 'until_next_turn')
 *   Faerie Fire → grantVulnerability(target, 'advantage',    'attack', 'Faerie Fire', 'rounds', 10)
 */
export function grantVulnerability(
  c:            Combatant,
  type:         'advantage' | 'disadvantage',
  scope:        D20TestScope,
  source:       string,
  durationType: AdvDurationType,
  rounds       = 1,
): void {
  addOrRefresh(c.vulnerabilities, makeEntry(type, scope, source, durationType, rounds));
}

// ---- Tick ---------------------------------------------------

/**
 * Called at the START of this creature's turn.
 *   - Removes all 'until_next_turn' entries (they lasted one full round).
 *   - Decrements roundsRemaining on 'rounds' entries; removes those that hit 0.
 *   - 'permanent' entries are never touched here.
 */
export function tickAdvantages(c: Combatant): void {
  for (const arr of [c.advantages, c.vulnerabilities]) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i];
      if (e.durationType === 'until_next_turn') {
        arr.splice(i, 1);
      } else if (e.durationType === 'rounds') {
        e.roundsRemaining--;
        if (e.roundsRemaining <= 0) arr.splice(i, 1);
      }
      // 'permanent' untouched
    }
  }
}

// ---- Query --------------------------------------------------

/**
 * Returns whether this creature currently has advantage and/or disadvantage
 * on its OWN rolls matching the given scope.
 *
 * PHB p.173: if both are true, the creature rolls a single die (neither applies).
 * This function returns the raw booleans — the caller applies the cancel-out rule.
 */
export function querySelf(
  c:     Combatant,
  scope: D20TestScope,
): { advantage: boolean; disadvantage: boolean } {
  let adv = false, disadv = false;
  for (const e of c.advantages) {
    if (!scopeMatches(e.scope, scope)) continue;
    if (e.type === 'advantage')    adv    = true;
    if (e.type === 'disadvantage') disadv = true;
  }
  return { advantage: adv, disadvantage: disadv };
}

/**
 * Returns whether rolls made AGAINST this creature currently have
 * advantage and/or disadvantage.
 */
export function queryVulnerability(
  c:     Combatant,
  scope: D20TestScope,
): { advantage: boolean; disadvantage: boolean } {
  let adv = false, disadv = false;
  for (const e of c.vulnerabilities) {
    if (!scopeMatches(e.scope, scope)) continue;
    if (e.type === 'advantage')    adv    = true;
    if (e.type === 'disadvantage') disadv = true;
  }
  return { advantage: adv, disadvantage: disadv };
}

// ---- Passive score modifier ---------------------------------

/**
 * Returns the passive score modifier for the given scope.
 * PHB p.175: advantage → +5, disadvantage → −5, both active → +0.
 * Checks both own entries and vulnerability entries (rare but possible for perception).
 */
export function passiveBonus(c: Combatant, scope: D20TestScope): number {
  const s = querySelf(c, scope);
  const v = queryVulnerability(c, scope);
  const hasAdv   = s.advantage   || v.advantage;
  const hasDisadv = s.disadvantage || v.disadvantage;
  if (hasAdv   && !hasDisadv) return  5;
  if (hasDisadv && !hasAdv)   return -5;
  return 0; // both active, or neither
}

// ---- Remove -------------------------------------------------

/**
 * Remove all entries (own + vulnerability) whose source matches.
 * Use when a spell or feature ends before its natural expiry.
 */
export function removeBySource(c: Combatant, source: string): void {
  c.advantages      = c.advantages.filter(e => e.source !== source);
  c.vulnerabilities = c.vulnerabilities.filter(e => e.source !== source);
}
