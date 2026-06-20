// ============================================================
// Dominate Monster — PHB p.235
//
// 8th-level enchantment, action, range 60 ft, concentration (1 hr).
// Components: V, S.
//
// Effect: You attempt to beguile a creature that you can see within
//         range. It must succeed on a Wisdom saving throw or be
//         charmed by you for the duration. If you or creatures that
//         are friendly to you are fighting it, it has advantage on the
//         saving throw. While the creature is charmed, you have a
//         telepathic link with it ... you can use your action to take
//         direct and total control of the target.
//
// Upcast: none (8th-level spell — no upcast).
//
// v1 simplifications:
//   - Control/telepathy: canon lets the caster command the target's
//     actions via a telepathic link. v1 simplifies this to a pure
//     `condition_apply:charmed` (the control rider is NOT modelled —
//     v1 has no "control enemy action" subsystem). Documented via
//     `dominateMonsterControlV1Simplified: true`.
//   - Range: canon 60 ft. v1 uses chebyshev3D * 5 (square approx).
//   - Duration: canon 1 hr concentration → v1 starts concentration via
//     startConcentration(), but the engine does NOT enforce concentration
//     checks on damage taken (TG-002). The charmed condition persists
//     until removeEffectsFromCaster() is called (concentration break).
//   - Combat advantage on save (PHB p.235: "If you or creatures that
//     are friendly to you are fighting it, it has advantage on the
//     saving throw"): NOT modelled — v1's rollSave has no adv-from-combat
//     hook. Documented via `dominateMonsterCombatAdvSaveV1Simplified: true`.
//   - Creature type: any creature (unlike Dominate Person which is
//     humanoid-only). v1 does NOT verify creature type (parser tech
//     debt — TG-004). All living enemies are valid targets.
//   - NOT modelled: the saving throw to resist after taking damage
//     (PHB p.235: target can repeat the save each time it takes damage).
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-charmed (concentration).
// Removed from `_generic_registry.ts`; routed via `case 'dominateMonster':`
// in combat.ts and a planner branch in planner.ts. Mirrors Hold Person
// (single-target concentration save-or-condition) but with charmed + any
// creature + L8 slot.
//
// Spell module pattern (single-target save-or-condition, concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Dominate Monster',
  level: 8,
  school: 'enchantment',
  rangeFt: 60,                   // PHB p.235: 60 ft
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  dominateMonsterControlV1Simplified: true,               // telepathic control NOT modelled
  dominateMonsterCombatAdvSaveV1Simplified: true,         // in-combat adv on save NOT modelled
  dominateMonsterConcentrationEnforcementV1Implemented: false,  // see TG-002
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
 * Returns the single best target for Dominate Monster (a living enemy
 * within 60 ft, not already charmed/incapacitated by this caster), or
 * null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (maxHP) within 60 ft — charming the biggest
 *      attacker removes their action economy (v1: charmed only; control
 *      rider NOT modelled).
 *   2. Tie-break: closest enemy.
 *
 * Preconditions:
 *   - Caster has 'Dominate Monster' in their actions
 *   - Caster has at least one 8th-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 60 ft
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Dominate Monster')) return null;
  if (!hasSpellSlot(caster, 8)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    // Skip if already charmed or incapacitated — charm adds no value.
    if (c.conditions.has('charmed') || c.conditions.has('incapacitated')) continue;

    // Skip if already Dominate-Monster'd by this caster.
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Dominate Monster'
    )) continue;

    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Dominate Monster:
 *  1. Consume an 8th-level spell slot (no upcast — 8th-level only).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Dominate Monster.
 *  4. Roll the target's WIS save vs the caster's saveDC.
 *  5. On fail: apply charmed (condition_apply, sourceIsConcentration: true).
 *  6. On success: log the save, no effect applied.
 *
 * @param caster  The casting Combatant (Bard / Sorcerer / Warlock / Wizard)
 * @param target  The candidate from shouldCast (single enemy in range)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Dominate Monster');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 8);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Dominate Monster');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Dominate Monster at ${target.name}! (DC ${saveDC} WIS)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'wis', saveDC);
  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Dominate Monster (rolled ${save.total})`,
    target.id,
    save.roll,
  );

  if (save.success) {
    emit(
      state, 'action', caster.id,
      `${target.name} resists Dominate Monster — not charmed!`,
      target.id,
    );
    return;
  }

  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Dominate Monster',
    effectType: 'condition_apply',
    payload: { condition: 'charmed' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is CHARMED by Dominate Monster! (v1: control rider NOT modelled — charm only)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
