// ============================================================
// Intellect Fortress — TCE p.107
//
// 3rd-level abjuration, 1 action, range Self (30-ft aura), concentration (1 hr).
// Components: V, S.
//
// Effect: For the duration, you or one willing creature you can see within
//         range has resistance to psychic damage, as well as advantage on
//         Intelligence, Wisdom, and Charisma saving throws.
//
// v1 simplifications:
//   - Scope simplification: canon grants advantage on INT, WIS, AND CHA
//     saves. The D20TestScope enum has no combined int_wis_cha scope, so
//     we use the general 'save' scope (covers all six ability saves) —
//     flag `intellectFortressScopeV1SimplifiedToAllSaves`. This is a
//     slight over-buff (also grants adv on STR/DEX/CON saves) but is
//     simpler than applying three separate advantage effects.
//   - Psychic damage resistance is NOT modelled — flag
//     `intellectFortressPsychicResistanceV1NotModelled`.
//   - Canon range is "Self (30-ft aura)" but v1 treats this as
//     range 30 ft targeting up to 3 allies (mirror bless.ts target
//     pattern). Self-targeting is allowed.
//
// Advantage mechanism (ally-self-advantage):
//   Same two-step pattern as beacon_of_hope.ts:
//     (a) grantSelf(target, 'advantage', 'save', 'Intellect Fortress',
//         'permanent') — writes to target.advantages so rollSave() grants
//         advantage on ALL saves (simplified from INT/WIS/CHA only).
//     (b) applySpellEffect(target, advantage_vs:save, sourceIsConcentration: true)
//         — SENTINEL effect so removeEffectsFromCaster() calls
//         removeBySource(target, 'Intellect Fortress') on concentration break.
//
//   NOTE on the stray vulnerabilities entry: applySpellEffect(advantage_vs)
//   also calls grantVulnerability(target, 'advantage', 'save', ...). The
//   engine's resolveAttack only queries queryVulnerability(target, 'attack'),
//   and scopeMatches('save', 'attack') is false, so this stray entry has
//   NO behavioural effect.
//
// Migration note: Session 27 Batch 3 — migrated from generic forward-compat
// stub to bespoke advantage buff. Previously this spell only set a
// `_genericSpellActiveSpells` flag with no mechanical effect; now it
// applies a real advantage grant to up to 3 allies via the adv_system.
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
  name: 'Intellect Fortress',
  level: 3,
  school: 'abjuration',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  maxTargets: 3,
  intellectFortressCanonV1Implemented: true,
  intellectFortressScopeV1SimplifiedToAllSaves: true,
  intellectFortressPsychicResistanceV1NotModelled: true,
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
 * Returns candidate targets for Intellect Fortress (up to 3 living allies
 * within 30 ft, not already affected by this caster), or null when the
 * spell should not be cast.
 *
 * Target priority (mirrors bless.ts):
 *   1. Self (caster) — always benefits from save advantage
 *   2. Remaining allies ordered by proximity (closest first)
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on any spell
 *   - Caster has 'Intellect Fortress' in their actions
 *   - Caster has at least one 3rd-level (or higher) slot available
 *   - At least 1 valid target exists (self or ally within 30 ft)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;

  if (!caster.actions.some(a => a.name === 'Intellect Fortress')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const candidates: Array<{ c: Combatant; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;

    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Intellect Fortress')) continue;

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
 * Execute Intellect Fortress:
 *  1. Consume a 3rd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Intellect Fortress.
 *  4. For each target:
 *     (a) grantSelf(target, 'advantage', 'save', ...) — real effect.
 *     (b) applySpellEffect(target, advantage_vs:save, sourceIsConcentration: true)
 *         — SENTINEL for concentration-break cleanup.
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 3);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Intellect Fortress');

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Intellect Fortress on ${names} (${targets.length} creature${targets.length !== 1 ? 's' : ''})!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    grantSelf(target, 'advantage', 'save', 'Intellect Fortress', 'permanent');

    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Intellect Fortress',
      effectType: 'advantage_vs',
      payload: {
        advType: 'advantage',
        advScope: 'save',
      },
      sourceIsConcentration: true,
    });

    emit(
      state, 'condition_add', caster.id,
      `${target.name} is shielded by Intellect Fortress — advantage on all saving throws!`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster,
  // which calls removeBySource(target, 'Intellect Fortress') for each
  // affected ally.
}
