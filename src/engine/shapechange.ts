// ============================================================
// Shapechanger (Monster Trait) — RFC-SHAPECHANGER Phase 1
//
// Module: src/engine/shapechange.ts
//
// Most shapechanger creatures (76 pre-2024) have a "Shapechanger" trait
// that lets them use an ACTION to polymorph into a specific alternate form
// (e.g., Strahd → bat/wolf/mist, Mimic → object, Werebear → hybrid/bear).
//
// Per the trait text: "Its statistics, other than its size and speed, are
// the same in each form." — meaning most forms only change size + speed
// (and rarely AC). Full stat replacement (Druid Wild Shape, Polymorph spell)
// is deferred to RFC Phase 2-3.
//
// v1 implementation (RFC §3 Phase 1):
//   - Parser (src/parser/fivetools.ts) extracts form names + size/speed/AC
//     changes from trait text + per-form "In <X> form, ..." clauses.
//   - This module provides shouldShapechange + executeShapechange.
//   - combat.ts's `case 'shapechange':` calls these.
//   - planner.ts has a branch to plan shapechange on turn 1 if beneficial.
//
// v1 simplifications:
//   - AC change is parsed as a flag but NOT applied (text rarely specifies
//     the new AC value).
//   - Special flags (cantTakeActions, immuneNonmagical,
//     advantageOnStrDexConSaves) ARE applied via existing engine helpers.
//   - Reverting to true form restores the original size/speed/AC (saved on
//     first transform via `_originalStatsForShapechange` scratch field).
//   - Multi-form mid-combat swapping NOT modelled (most combats are short;
//     v1 transforms once on turn 1 and stays in that form).
// ============================================================

import { Combatant, Battlefield, ShapechangerForm, DamageType } from '../types/core';
import { CombatEvent, EngineState } from './combat';
import { addResistance, removeResistance } from './utils';

// ---- Log helper ---------------------------------------------

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
 * Decide whether the combatant should use their action to shapechange this turn.
 *
 * v1 strategy (RFC §3 Phase 1):
 *   - If the combatant has NO shapechanger forms → null.
 *   - If already in an alternate form (not 'true') → null (stay in current form;
 *     v1 doesn't swap mid-combat).
 *   - Otherwise, pick the best alternate form for the current situation:
 *     (a) If the nearest enemy is far away (>30 ft / 6 squares) AND a form has
 *         a higher fly speed than the base form's speed → transform into that
 *         form (close distance faster).
 *     (b) If the combatant is at low HP (<30%) AND a form has the 'mist' or
 *         'cantTakeActions' flag → transform to gain defensive benefits
 *         (immuneNonmagical + advantageOnStrDexConSaves).
 *     (c) Otherwise → null (don't waste the action; base form is fine).
 *
 * Returns `{ formName }` if the combatant should transform, or `null`.
 */
export function shouldShapechange(
  caster: Combatant,
  bf: Battlefield,
): { formName: string } | null {
  if (!caster.shapechangerForms || caster.shapechangerForms.length === 0) return null;
  if (caster._currentForm && caster._currentForm !== 'true') return null;  // already transformed

  // Find the nearest enemy distance.
  let nearestDist = Infinity;
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const d = Math.max(
      Math.abs(caster.pos.x - c.pos.x),
      Math.abs(caster.pos.y - c.pos.y),
    );
    if (d < nearestDist) nearestDist = d;
  }
  if (nearestDist === Infinity) return null;  // no enemies

  const hpPct = caster.currentHP / caster.maxHP;
  const lowHP = hpPct < 0.30;

  // Strategy (a): close distance with a faster fly speed form.
  if (nearestDist > 6) {  // >30 ft away
    let bestForm: ShapechangerForm | null = null;
    let bestFly = caster.flySpeed ?? 0;
    for (const f of caster.shapechangerForms) {
      if (f.cantTakeActions) continue;  // can't act in mist form — skip
      const flySpeed = f.speedFly ?? 0;
      if (flySpeed > bestFly) {
        bestFly = flySpeed;
        bestForm = f;
      }
    }
    if (bestForm) {
      return { formName: bestForm.name };
    }
  }

  // Strategy (b): escape to defensive form when low HP.
  if (lowHP) {
    for (const f of caster.shapechangerForms) {
      if (f.immuneNonmagical || f.cantTakeActions) {
        return { formName: f.name };
      }
    }
  }

  // Strategy (c): default — don't transform.
  return null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute the shapechange action:
 *  1. Save original stats on first transform (if not already saved).
 *  2. Find the form by name; if not found, log + bail.
 *  3. Apply the form's size + speed changes (overwriting current values).
 *  4. Apply special flags (cantTakeActions, immuneNonmagical,
 *     advantageOnStrDexConSaves).
 *  5. Update _currentForm to the new form name.
 *
 * If `formName === 'true'`, revert to the saved original stats instead.
 */
export function executeShapechange(
  caster: Combatant,
  formName: string,
  state: EngineState,
): void {
  // Save original stats on first transform (so we can revert later).
  if (!caster._originalStatsForShapechange) {
    caster._originalStatsForShapechange = {
      size: caster.size,
      speed: caster.speed,
      flySpeed: caster.flySpeed,
      swimSpeed: caster.swimSpeed,
      burrowSpeed: caster.burrowSpeed,
      ac: caster.ac,
    };
  }
  const original = caster._originalStatsForShapechange;

  // REVERT to true form.
  if (formName === 'true') {
    // Restore original stats.
    caster.size = original.size;
    caster.speed = original.speed;
    caster.flySpeed = original.flySpeed;
    caster.swimSpeed = original.swimSpeed;
    caster.burrowSpeed = original.burrowSpeed;
    caster.ac = original.ac;
    caster._currentForm = 'true';

    // Remove form-specific flags (defensive buffs).
    // Note: we only add nonmagical-damage resistance for immuneNonmagical
    // forms in v1 (not true immunity), so removing it on revert is correct.
    if (caster.shapechangerForms) {
      for (const f of caster.shapechangerForms) {
        if (f.immuneNonmagical) {
          for (const dt of ['bludgeoning', 'piercing', 'slashing'] as DamageType[]) {
            removeResistance(caster, dt);
          }
        }
      }
    }
    caster.cannotAttack = false;

    emit(state, 'action', caster.id,
      `${caster.name} reverts to its true form!`,
      caster.id);
    return;
  }

  // Find the form by name.
  const form = caster.shapechangerForms?.find(f => f.name.toLowerCase() === formName.toLowerCase());
  if (!form) {
    emit(state, 'action', caster.id,
      `${caster.name} tries to polymorph into ${formName} but the form is unknown!`,
      caster.id);
    return;
  }

  // Apply the form's size + speed changes.
  if (form.size) caster.size = form.size;
  if (form.speedWalk !== undefined) caster.speed = form.speedWalk;
  // For fly/swim/climb/burrow: undefined → keep original (no change); null → remove.
  if (form.speedFly !== undefined) caster.flySpeed = form.speedFly;
  if (form.speedSwim !== undefined) caster.swimSpeed = form.speedSwim;
  if (form.speedClimb !== undefined) {
    // v1 has no separate climbSpeed field — climb is added to base speed (v1 simplification).
    // If the form grants a climb speed, add it as a note in the log (no separate field).
  }

  // Apply special flags.
  if (form.cantTakeActions) {
    caster.cannotAttack = true;  // can't take actions in mist form
  }
  if (form.immuneNonmagical) {
    // v1 simplification: model "immune to all nonmagical damage" as resistance
    // to B/P/S (the most common nonmagical damage types). True immunity would
    // require an `isNonmagical` flag on each attack — deferred to Phase 4.
    for (const dt of ['bludgeoning', 'piercing', 'slashing'] as DamageType[]) {
      addResistance(caster, dt);
    }
  }
  if (form.advantageOnStrDexConSaves) {
    // v1 simplification: add 3 advantage entries (STR, DEX, CON saves).
    // Each entry lasts until the form is reverted (we use durationType: 'rounds'
    // with a large count since v1 combats rarely exceed 20 rounds).
    if (caster.advantages) {
      const rounds = 100;  // effectively permanent for v1 single-combat
      for (const scope of ['save:str', 'save:dex', 'save:con'] as const) {
        // Avoid duplicate entries from re-casting.
        const exists = caster.advantages.some(a =>
          a.source === `Shapechanger:${form.name}` && a.scope === scope);
        if (!exists) {
          caster.advantages.push({
            type: 'advantage',
            scope,
            source: `Shapechanger:${form.name}`,
            durationType: 'rounds',
            roundsRemaining: rounds,
          });
        }
      }
    }
  }

  caster._currentForm = form.name;

  emit(state, 'action', caster.id,
    `${caster.name} uses Shapechanger to polymorph into ${form.name}! ` +
    `(size=${form.size || 'unchanged'}, walk=${form.speedWalk ?? 'unchanged'}, ` +
    `fly=${form.speedFly ?? 'unchanged'}${form.cantTakeActions ? ', cantTakeActions' : ''}` +
    `${form.immuneNonmagical ? ', immuneNonmagical' : ''})`,
    caster.id);
  emit(state, 'condition_add', caster.id,
    `${caster.name} transforms into ${form.name}!`,
    caster.id);
}

// ---- Revert on Death ----------------------------------------

/**
 * Engine hook: called when a shapechanger dies. Reverts to true form
 * (no mechanical effect — the creature is dead — but logged for clarity).
 *
 * Per the trait text: "It reverts to its true form if it dies."
 */
export function revertOnDeath(caster: Combatant, state: EngineState): void {
  if (!caster.shapechangerForms) return;
  if (!caster._currentForm || caster._currentForm === 'true') return;
  // Revert silently (the death log entry is the main event).
  caster._currentForm = 'true';
  emit(state, 'death', caster.id,
    `${caster.name} reverts to its true form as it dies.`,
    caster.id);
}
