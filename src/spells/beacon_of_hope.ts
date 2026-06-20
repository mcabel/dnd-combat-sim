// ============================================================
// Beacon of Hope — PHB p.217
//
// 3rd-level abjuration, 1 action, range 30 ft, concentration (1 min).
// Components: V, S.
//
// Effect: This spell bestows hope and vitality. Choose any number of
//         creatures within range. For the duration, each target has
//         advantage on Wisdom saving throws and death saving throws,
//         and regains the maximum number of hit points possible from
//         any healing.
//
// v1 simplifications:
//   - WIS-save advantage is modelled via the adv_system: for each
//     target we call grantSelf(target, 'advantage', 'save:wis', ...)
//     so the engine's rollSave() helper (which queries querySelf for
//     'save:<ability>') grants advantage on WIS saves.
//   - Death-save advantage is NOT separately modelled: the D20TestScope
//     enum has no 'save:death' subtype, and death saves are not tied
//     to an ability score. v1 only grants WIS-save advantage.
//   - The max-heal rider ("regains the maximum number of hit points
//     possible from any healing") is NOT modelled — flag
//     `beaconOfHopeMaxHealV1NotModelled`.
//
// Advantage mechanism (ally-self-advantage):
//   The `advantage_vs` ActiveEffect payload in core.ts is documented as
//   "rolls AGAINST this creature get adv/disadv" (see SpellEffectType
//   comment, src/types/core.ts line 90). The engine's applySpellEffect
//   for advantage_vs calls grantVulnerability() (src/engine/spell_effects.ts
//   line 64), which writes to `target.vulnerabilities` — that array is
//   queried by resolveAttack() (utils.ts line 686) for ATTACK rolls
//   against the target, NOT by rollSave() for the target's OWN saves.
//   rollSave() instead queries `target.advantages` via querySelf()
//   (utils.ts line 123).
//
//   Therefore advantage_vs alone CANNOT grant an ally advantage on its
//   OWN saves. We use a two-step pattern:
//     (a) Call grantSelf(target, 'advantage', 'save:wis', 'Beacon of Hope',
//         'permanent') to write the entry to target.advantages so rollSave
//         picks it up.
//     (b) Apply an advantage_vs ActiveEffect with the SAME scope as a
//         SENTINEL so removeEffectsFromCaster() (on concentration break)
//         calls removeBySource(target, 'Beacon of Hope') and cleans up
//         BOTH the target.advantages entry (from step a) and the stray
//         target.vulnerabilities entry (a harmless side-effect of step b
//         — see note below).
//
//   NOTE on the stray vulnerabilities entry: applySpellEffect(advantage_vs)
//   also calls grantVulnerability(target, 'advantage', 'save:wis', ...),
//   which writes an entry to target.vulnerabilities with scope 'save:wis'.
//   resolveAttack only ever calls queryVulnerability(target, 'attack'), and
//   scopeMatches('save:wis', 'attack') is false (no general-to-specific
//   match), so this stray entry has NO behavioural effect. It is purely a
//   data-shape impurity cleaned up on concentration break.
//
// Migration note: Session 27 Batch 3 — migrated from generic forward-compat
// stub to bespoke advantage buff. Previously this spell only set a
// `_genericSpellActiveSpells` flag with no mechanical effect; now it
// applies a real advantage grant to up to 3 allies via the adv_system.
//
// Spell module pattern (mirrors bless.ts + faerie_fire.ts):
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
  name: 'Beacon of Hope',
  level: 3,
  school: 'abjuration',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  maxTargets: 3,
  beaconOfHopeCanonV1Implemented: true,
  beaconOfHopeMaxHealV1NotModelled: true,
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
 * Returns candidate targets for Beacon of Hope (up to 3 living allies
 * within 30 ft, not already affected by this caster), or null when the
 * spell should not be cast.
 *
 * Target priority (mirrors bless.ts):
 *   1. Self (caster) — always benefits from WIS-save advantage
 *   2. Remaining allies ordered by proximity (closest first)
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on any spell
 *   - Caster has 'Beacon of Hope' in their actions
 *   - Caster has at least one 3rd-level (or higher) slot available
 *   - At least 1 valid target exists (self or ally within 30 ft)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  // Never interrupt active concentration
  if (caster.concentration?.active) return null;

  // Must have the spell and a free 3rd-level (or higher) slot
  if (!caster.actions.some(a => a.name === 'Beacon of Hope')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const candidates: Array<{ c: Combatant; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;

    // Skip if already affected by this caster (re-cast would be wasteful)
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Beacon of Hope')) continue;

    candidates.push({ c, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: self first, then closest allies
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
 * Execute Beacon of Hope:
 *  1. Consume a 3rd-level spell slot.
 *  2. Break any existing concentration (safety net — planner should prevent).
 *  3. Start concentration on Beacon of Hope.
 *  4. For each target:
 *     (a) grantSelf(target, 'advantage', 'save:wis', 'Beacon of Hope', 'permanent')
 *         — writes to target.advantages so rollSave() grants WIS-save advantage.
 *     (b) applySpellEffect(target, advantage_vs:save:wis, sourceIsConcentration: true)
 *         — SENTINEL effect so removeEffectsFromCaster() calls
 *         removeBySource(target, 'Beacon of Hope') on concentration break,
 *         cleaning up BOTH the target.advantages entry and the stray
 *         target.vulnerabilities entry.
 *
 * @param caster  The casting Combatant (Cleric)
 * @param targets Candidates from shouldCast (allies including self, in range)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 3);

  // Safety: clean up any stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Beacon of Hope');

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Beacon of Hope on ${names} (${targets.length} creature${targets.length !== 1 ? 's' : ''})!`,
  );

  for (const target of targets) {
    // Re-check liveness (stale edge case)
    if (target.isDead || target.isUnconscious) continue;

    // (a) Real effect: ally gets advantage on its own WIS saves.
    grantSelf(target, 'advantage', 'save:wis', 'Beacon of Hope', 'permanent');

    // (b) Sentinel: anchors concentration-break cleanup. The stray
    //     vulnerabilities entry (scope 'save:wis') is harmless because
    //     resolveAttack only queries queryVulnerability(target, 'attack'),
    //     and scopeMatches('save:wis', 'attack') is false.
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Beacon of Hope',
      effectType: 'advantage_vs',
      payload: {
        advType: 'advantage',
        advScope: 'save:wis',
      },
      sourceIsConcentration: true,
    });

    emit(
      state, 'condition_add', caster.id,
      `${target.name} is filled with hope — advantage on WIS saving throws!`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster,
  // which calls removeBySource(target, 'Beacon of Hope') for each affected
  // ally, purging both the advantages entry (real effect) and the
  // vulnerabilities entry (sentinel side-effect).
}
