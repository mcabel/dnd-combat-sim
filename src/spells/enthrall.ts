// ============================================================
// Enthrall — PHB p.238
//
// 2nd-level enchantment, action, range 60 ft, concentration (1 min).
// Components: V, S.
//
// Effect: You weave a distracting string of words, causing creatures of
//         your choice that you can see within range and that can hear you
//         to make a Wisdom saving throw. On a failed save, the targets
//         have disadvantage on Perception checks and Perception checks made
//         to hear anything but you for the duration.
//
//         A creature that can't hear you is unaffected by this spell.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - v1 has NO perception subsystem (the engine has no concept of
//     "Perception check" or "hearing"). This spell sets a forward-compat
//     flag `_enthrallActive` on the CASTER (self — the caster is the one
//     enthralling, and the flag denotes "the caster is currently enthralling
//     N creatures"). Like Darkvision's `_darkvisionActive` pattern, but
//     with a sentinel effect for cleanup because Enthrall IS concentration.
//   - v1 simplification: canon Enthrall targets up to N creatures that can
//     hear the caster (no explicit max — the range is 60 ft and the caster's
//     voice carries). v1 caps at 3 highest-threat enemies within 60 ft
//     (forward-compat TODO via the metadata flag
//     `enthrallPerceptionDisadvV1Implemented: false`).
//   - Multi-target save: each target rolls WIS independently. v1 logs each
//     save result but the flag is set on the CASTER (single source of the
//     enthralling effect), not per-target (the perception-disadvantage
//     would only apply to targets that failed their save, but v1's forward-
//     compat flag doesn't distinguish per-target).
//   - Duration: canon 1 min concentration → v1: concentration is started
//     via startConcentration(), but NOT enforced (TG-002). The flag
//     persists until removeEffectsFromCaster() is called.
//   - Upcast: — (no At Higher Levels entry). v1 always targets up to 3
//     creatures. Forward-compat TODO via `enthrallUpcastV1Implemented: false`.
//   - Concentration enforcement: v1 does NOT enforce concentration
//     checks (TG-002).
//
// Spell module pattern (mirrors darkvision.ts forward-compat flag pattern
// BUT with concentration AND a per-target WIS save AND a multi-target
// shouldCast returning Combatant[]):
//   shouldCast(caster, bf) → Combatant[]   (up to 3 enemies)
//   execute(caster, targets, state) → void
//   metadata → spell stats
//   cleanup() — no-op (concentration break handled by sentinel effect)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Enthrall',
  level: 2,
  school: 'enchantment',
  rangeFt: 60,
  maxTargets: 3,
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  enthrallPerceptionDisadvV1Implemented: false,             // perception subsystem NOT modelled
  enthrallUpcastV1Implemented: false,                       // no At Higher Levels entry — max 3 targets
  enthrallConcentrationEnforcementV1Implemented: true,     // TG-002 DONE (Session 34)
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
 * Returns up to 3 best targets for Enthrall (living enemies within 60 ft, not
 * already Enthralled by this caster), or an empty array when the spell
 * should not be cast.
 *
 * Target priority: highest-threat enemies (maxHP) within 60 ft — enthralling
 * the biggest attackers imposes disadvantage on their Perception checks
 * (v1: forward-compat flag only).
 *
 * Preconditions:
 *   - Caster has 'Enthrall' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Enthrall IS concentration — it cannot be cast while concentrating on
 * another spell. The planner gates on concentration via shouldCast.
 *
 * Note: v1 caps at 3 targets (forward-compat TODO via
 * `enthrallPerceptionDisadvV1Implemented: false`).
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] {
  if (caster.concentration?.active) return [];
  if (!caster.actions.some(a => a.name === 'Enthrall')) return [];
  if (!hasSpellSlot(caster, 2)) return [];

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    // Skip if already Enthralled by this caster (re-cast would only refresh
    // the duration — wasteful in v1).
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Enthrall'
    )) continue;

    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  // Cap at 3 highest-threat targets (v1 simplification).
  return candidates.slice(0, 3).map(x => x.c);
}

// ---- Execution ----------------------------------------------

/**
 * Execute Enthrall:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Enthrall.
 *  4. Set `caster._enthrallActive = true` (forward-compat flag — the caster
 *     is the one enthralling; the flag denotes "caster is currently enthralling
 *     N creatures").
 *  5. Attach a `damage_zone` sentinel effect (dieCount=0, dieSides=0) to the
 *     CASTER so removeEffectsFromCaster clears the flag on concentration
 *     break. The sentinel has `sourceIsConcentration: true`.
 *  6. For each target: roll the target's WIS save vs the caster's saveDC.
 *     Log each save result. (v1: no per-target condition applied — the
 *     perception-disadvantage is forward-compat only.)
 *
 * v1 simplifications: perception subsystem NOT modelled (forward-compat flag
 * only); max 3 targets; concentration NOT enforced (TG-002). The flag
 * persists for the entire combat (or until concentration breaks).
 *
 * @param caster   The casting Combatant (Bard/Sorcerer/Warlock/Wizard)
 * @param targets  The candidates from shouldCast (up to 3 enemies in range)
 * @param state    Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Enthrall');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Enthrall');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Enthrall at ${targets.length} target${targets.length === 1 ? '' : 's'}! (DC ${saveDC} WIS)`,
    targets[0]?.id,
  );

  // Set the caster's forward-compat flag (caster is enthralling).
  caster._enthrallActive = true;

  // Attach a damage_zone sentinel (dieCount=0) to the CASTER so
  // removeEffectsFromCaster clears the `_enthrallActive` flag on
  // concentration break.
  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Enthrall',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });

  // Roll each target's WIS save (v1: log each result; no per-target
  // condition applied — perception-disadvantage is forward-compat only).
  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'wis', saveDC);
    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Enthrall (rolled ${save.total})`,
      target.id, save.roll,
    );

    emit(
      state, 'action', caster.id,
      save.success
        ? `${target.name} resists Enthrall — can hear everything normally!`
        : `${target.name} is ENTHRALLED! (v1: forward-compat flag; perception disadvantage NOT modelled)`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via the sentinel effect.
}
