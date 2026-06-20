// ============================================================
// Holy Aura — PHB p.251
//
// 8th-level abjuration, 1 action, range Self (30-ft aura), concentration (1 min).
// Components: V, S, M (a tiny reliquary worth 1,000+ gp).
//
// Effect: Divine light washes out from you and coalesces in a soft radiance
//         in a 30-foot radius around you. Creatures of your choice in that
//         radius when you cast this spell shed dim light in a 5-foot radius
//         and have advantage on all saving throws against spells and other
//         magical effects. Any attacker has disadvantage on attack rolls
//         against creatures affected by this spell. The spell fails to
//         affect a creature with total cover from you.
//
// v1 simplifications:
//   - Scope simplification: canon grants advantage on saves vs spells and
//     magical effects. The D20TestScope enum has no 'save:spells' subtype,
//     so we use the general 'save' scope (covers all saves) — flag
//     `holyAuraScopeV1SimplifiedToAllSaves`. This is a slight over-buff
//     (also grants adv on non-spell saves) but is simpler than tracking
//     spell-vs-non-spell save sources.
//   - Light rider (5-ft dim light shed by affected allies) NOT modelled —
//     flag `holyAuraLightAndBlindRidersV1Simplified`.
//   - Blind-attacker rider (attackers have disadvantage on attack rolls
//     vs affected allies) NOT modelled — flag
//     `holyAuraLightAndBlindRidersV1Simplified`. (This would require a
//     `grantVulnerability(target, 'disadvantage', 'attack', ...)` per
//     ally, which is straightforward to add in a future pass but is
//     omitted from v1 to keep the migration atomic with the other 3
//     advantage_vs spells in this batch.)
//   - maxTargets: 99 (effectively unlimited — all allies within 30 ft).
//   - Canon range is "Self (30-ft aura)" — v1 treats this as 30-ft range
//     targeting all allies within 30 ft (mirror bless.ts pattern, but
//     with no cap).
//
// Advantage mechanism (ally-self-advantage):
//   Same two-step pattern as beacon_of_hope.ts and intellect_fortress.ts:
//     (a) grantSelf(target, 'advantage', 'save', 'Holy Aura', 'permanent')
//         — writes to target.advantages so rollSave() grants save advantage.
//     (b) applySpellEffect(target, advantage_vs:save, sourceIsConcentration: true)
//         — SENTINEL effect for concentration-break cleanup.
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
// applies a real advantage grant to all allies within 30 ft via the
// adv_system.
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
  name: 'Holy Aura',
  level: 8,
  school: 'abjuration',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  maxTargets: 99, // effectively unlimited within 30 ft aura
  holyAuraCanonV1Implemented: true,
  holyAuraScopeV1SimplifiedToAllSaves: true,
  holyAuraLightAndBlindRidersV1Simplified: true,
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
 * Returns candidate targets for Holy Aura (all living allies within 30 ft,
 * not already affected by this caster), or null when the spell should not
 * be cast.
 *
 * Target priority (mirrors bless.ts):
 *   1. Self (caster) — always benefits from save advantage
 *   2. Remaining allies ordered by proximity (closest first)
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on any spell
 *   - Caster has 'Holy Aura' in their actions
 *   - Caster has at least one 8th-level (or higher) slot available
 *   - At least 1 valid target exists (self or ally within 30 ft)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;

  if (!caster.actions.some(a => a.name === 'Holy Aura')) return null;
  if (!hasSpellSlot(caster, 8)) return null;

  const candidates: Array<{ c: Combatant; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;

    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Holy Aura')) continue;

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
 * Execute Holy Aura:
 *  1. Consume an 8th-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Holy Aura.
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
  consumeSpellSlot(caster, 8);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Holy Aura');

  const names = targets.map(t => t.name).join(', ');
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Holy Aura on ${names} (${targets.length} creature${targets.length !== 1 ? 's' : ''})!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    grantSelf(target, 'advantage', 'save', 'Holy Aura', 'permanent');

    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Holy Aura',
      effectType: 'advantage_vs',
      payload: {
        advType: 'advantage',
        advScope: 'save',
      },
      sourceIsConcentration: true,
    });

    emit(
      state, 'condition_add', caster.id,
      `${target.name} is wreathed in divine radiance — advantage on all saving throws!`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster,
  // which calls removeBySource(target, 'Holy Aura') for each affected ally.
}
