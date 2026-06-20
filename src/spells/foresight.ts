// ============================================================
// Foresight — PHB p.244
//
// 9th-level divination, 1 minute casting time, range Touch (5 ft).
// Canon duration: 8 hours (NO concentration).
// Components: V, S, M (a hummingbird feather).
//
// Effect: You touch a willing creature and bestow a limited ability to see
//         into the immediate future. For the duration, the target can't be
//         surprised and has advantage on attack rolls, ability checks, and
//         saving throws. Other creatures have disadvantage on attack rolls
//         against the target for the duration.
//
// v1 simplifications:
//   - Canon is NOT a concentration spell (8-hour duration). v1 simplifies
//     to concentration for combat duration tracking — flag
//     `foresight8hrDurationV1SimplifiedToConc`. The "can't be surprised"
//     rider is not modelled (no surprise subsystem in v1).
//   - Canon casting time is 1 minute; v1 treats this as 'action' for
//     combat castability (otherwise it could never be cast in combat).
//     This is a v1 simplification noted here, not flagged in metadata
//     (the canonical action-economy model doesn't distinguish 1-min
//     casts from 1-action casts — both consume the caster's turn).
//   - Enemies-disadvantage rider NOT modelled — flag
//     `foresightEnemiesDisadvV1NotModelled`. (This would require applying
//     `grantVulnerability(enemy, 'disadvantage', 'attack', ...)` to EVERY
//     enemy combatant for the duration, which is a stretch beyond the
//     4-spell scope of this batch. A future pass could add this.)
//
// Advantage mechanism (ally-self-advantage):
//   Same two-step pattern as beacon_of_hope.ts, intellect_fortress.ts,
//   and holy_aura.ts, with ONE KEY DIFFERENCE for Foresight:
//
//   The grantSelf scope is 'all' (advantage on attack rolls, ability
//   checks, AND saving throws). However, we MUST NOT use 'all' as the
//   sentinel's advScope, because applySpellEffect(advantage_vs) also
//   calls grantVulnerability(target, 'advantage', 'all', ...) which
//   would write a vulnerabilities entry with scope 'all'. The engine's
//   resolveAttack() queries queryVulnerability(target, 'attack'), and
//   scopeMatches('all', 'attack') returns TRUE — this would grant
//   attackers ADVANTAGE vs the Foresight-buffed ally, which is the
//   OPPOSITE of canon (canon gives attackers DISADVANTAGE).
//
//   To avoid this harmful side-effect, the SENTINEL uses a narrow scope
//   ('save') which is harmless for attack queries (scopeMatches('save',
//   'attack') is false). The grantSelf uses 'all' for the real effect.
//
//     (a) grantSelf(target, 'advantage', 'all', 'Foresight', 'permanent')
//         — writes to target.advantages so rollSave(), rollAbilityCheck(),
//         AND resolveAttack() (the attacker's OWN attack roll) all grant
//         advantage. This is the REAL effect.
//     (b) applySpellEffect(target, advantage_vs:save, sourceIsConcentration: true)
//         — SENTINEL effect (narrow 'save' scope) for concentration-break
//         cleanup. The stray vulnerabilities entry has scope 'save' which
//         scopeMatches('save', 'attack')=false — harmless.
//
//   On concentration break, removeEffectsFromCaster() calls
//   removeBySource(target, 'Foresight') which purges BOTH the advantages
//   entry (real effect) and the vulnerabilities entry (sentinel side-effect),
//   since both have source 'Foresight'.
//
// Migration note: Session 27 Batch 3 — migrated from generic forward-compat
// stub to bespoke advantage buff. Previously this spell only set a
// `_genericSpellActiveSpells` flag with no mechanical effect; now it
// applies a real advantage grant to one ally via the adv_system.
//
// Spell module pattern (mirrors bless.ts + beacon_of_hope.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup(_c) — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { grantSelf } from '../engine/adv_system';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Foresight',
  level: 9,
  school: 'divination',
  rangeFt: 5, // Touch
  concentration: true, // v1 simplification (canon: 8 hr, no conc)
  castingTime: 'action', // v1 simplification (canon: 1 min)
  maxTargets: 1,
  foresightCanonV1Implemented: true,
  foresightEnemiesDisadvV1NotModelled: true,
  foresight8hrDurationV1SimplifiedToConc: true,
} as const;

// ---- Local log helper ---------------------------------------

function emit(
  state: EngineState,
  type: CombatEvent['type'],
  actorId: string,
  desc: string,
  targetId?: string,
  value?: number,
): void {
  state.log.events.push({
    round: state.battlefield.round,
    actorId,
    type,
    targetId,
    value,
    description: desc,
  });
}

// ---- Planner ------------------------------------------------

/**
 * Returns candidate targets for Foresight (up to 1 living ally within
 * Touch range — 5 ft, not already affected by this caster), or null
 * when the spell should not be cast.
 *
 * Target priority (mirrors bless.ts):
 *   1. Self (caster) — always benefits from full-d20 advantage
 *   2. Remaining allies ordered by proximity (closest first)
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on any spell
 *   - Caster has 'Foresight' in their actions
 *   - Caster has at least one 9th-level slot available
 *   - At least 1 valid target exists (self or ally within 5 ft)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;

  if (!caster.actions.some(a => a.name === 'Foresight')) return null;
  if (!hasSpellSlot(caster, 9)) return null;

  const candidates: Array<{ c: Combatant; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue; // Touch range

    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Foresight')) continue;

    candidates.push({ c, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aSelf = a.c.id === caster.id ? 0 : 1;
    const bSelf = b.c.id === caster.id ? 0 : 1;
    if (aSelf !== bSelf) return aSelf - bSelf;
    return a.dist - b.dist;
  });

  return candidates.slice(0, metadata.maxTargets).map(e => e.c);
}

// ---- Execution ----------------------------------------------

/**
 * Execute Foresight:
 *  1. Consume a 9th-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Foresight (v1 simplification — canon is 8-hr
 *     non-concentration, but v1 uses concentration for combat tracking).
 *  4. For the target:
 *     (a) grantSelf(target, 'advantage', 'all', 'Foresight', 'permanent')
 *         — REAL effect: advantage on ALL d20 rolls (attacks, saves,
 *         ability checks).
 *     (b) applySpellEffect(target, advantage_vs:save, sourceIsConcentration: true)
 *         — SENTINEL with narrow 'save' scope (NOT 'all') so the stray
 *         vulnerabilities entry doesn't grant attackers advantage vs
 *         the target.
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 9);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Foresight');

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Foresight on ${names} (${targets.length} creature${targets.length !== 1 ? 's' : ''})!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    // (a) REAL effect — advantage on all of the target's own d20 rolls.
    grantSelf(target, 'advantage', 'all', 'Foresight', 'permanent');

    // (b) SENTINEL — narrow 'save' scope (NOT 'all') to avoid the harmful
    //     side-effect where grantVulnerability(..., 'all', ...) would
    //     grant attackers advantage vs the Foresight-buffed target.
    //     scopeMatches('save', 'attack') is false → no behaviour change.
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Foresight',
      effectType: 'advantage_vs',
      payload: {
        advType: 'advantage',
        advScope: 'save',
      },
      sourceIsConcentration: true,
    });

    emit(
      state, 'condition_add', caster.id,
      `${target.name} sees into the immediate future — advantage on ALL d20 rolls!`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster,
  // which calls removeBySource(target, 'Foresight') for the buffed ally,
  // purging both the advantages entry (real effect, scope 'all') and the
  // vulnerabilities entry (sentinel side-effect, scope 'save').
}
