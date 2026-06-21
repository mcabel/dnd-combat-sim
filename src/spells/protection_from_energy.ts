// ============================================================
// Protection from Energy — PHB p.266
//
// 3rd-level abjuration, action, range Touch (5 ft), concentration 10 min.
// Components: V, S.   Classes: Cleric, Druid, Ranger, Sorcerer, Wizard.
//
// Effect: For the duration, the willing creature has resistance to
//   one damage type of your choice: acid, cold, fire, lightning, or
//   thunder.
//
// Upcast: When you cast this spell using a spell slot of 4th level or
//   higher, you may target one additional creature for each slot level
//   above 3rd. (NOT modelled in v1 — single target only.)
//
// v1 simplifications:
//   - Single-target only (touch range = 5 ft). Upcast +1 target/slot
//     NOT modelled (`protectionFromEnergyUpcastV1Implemented: false`).
//   - Damage-type choice: the AI picks the most common eligible damage
//     type dealt by living enemies' actions (acid/cold/fire/lightning/
//     thunder). Defaults to fire if no eligible type found. The caster
//     can also pass `damageType` to `execute` for testing or scripted
//     scenarios.
//   - 10-minute concentration duration not tracked — concentration is
//     started but cleanup is via removeEffectsFromCaster on
//     concentration break (PHB p.203 damage check).
//   - The resistance is added to `target.resistances` directly AND
//     tracked via a `damage_zone` sentinel effect (dieCount=0) sourced
//     from the caster. When concentration breaks, _undoEffect's
//     'Protection from Energy' case removes the resistance from
//     `target.resistances` (only the one we added — innate resistance
//     to the same type is left intact).
//
// Spell module pattern (mirrors Protection from Poison / Shield of Faith):
//   shouldCast(caster, bf) → boolean         (generic-registry shape)
//   pickDamageType(caster, bf) → DamageType  (AI helper)
//   pickTarget(caster, bf) → Combatant | null (AI helper)
//   execute(caster, state) → void             (re-queries target + type)
//   executeWithTarget(caster, target, state, damageType) → void  (test entry)
// ============================================================

import { Combatant, Battlefield, DamageType } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Protection from Energy',
  level: 3,
  school: 'abjuration',
  rangeFt: 5,       // touch
  concentration: true,
  castingTime: 'action',
  protectionFromEnergyUpcastV1Implemented: false,   // +1 target/slot NOT modelled
  protectionFromEnergyConcentrationEnforcementV1Implemented: true,  // TG-002 DONE (Session 34)
  protectionFromEnergyEligibleTypes: ['acid', 'cold', 'fire', 'lightning', 'thunder'] as const,
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

// ---- Eligible damage types ----------------------------------

const ELIGIBLE: ReadonlySet<DamageType> = new Set<DamageType>([
  'acid', 'cold', 'fire', 'lightning', 'thunder',
]);

// ---- Target picker ------------------------------------------

/**
 * Pick the best ally target for Protection from Energy.
 *
 * Target priority:
 *   1. Self (caster) — if no ally in range benefits more.
 *   2. Lowest-HP% ally within 5 ft (touch range).
 *
 * Excludes:
 *   - Dead / unconscious allies
 *   - Allies already affected by THIS caster's Protection from Energy
 *     (no stacking).
 */
export function pickTarget(caster: Combatant, bf: Battlefield): Combatant | null {
  const candidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;

    // Skip if already affected by this caster's Protection from Energy.
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Protection from Energy'
    )) continue;

    candidates.push({ c, hpPct: c.currentHP / c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: allies first (lowest HP%, then closest), self LAST as a fallback.
  // Rationale: Protection from Energy is most useful on a tanky ally who
  // will be taking the brunt of elemental attacks. Self-cast is the
  // fallback when no ally is in touch range.
  candidates.sort((a, b) => {
    const aSelf = a.c.id === caster.id ? 1 : 0;
    const bSelf = b.c.id === caster.id ? 1 : 0;
    if (aSelf !== bSelf) return aSelf - bSelf;  // self LAST
    if (Math.abs(a.hpPct - b.hpPct) > 0.01) return a.hpPct - b.hpPct;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Damage type picker -------------------------------------

/**
 * Pick the best damage type for Protection from Energy based on the
 * enemies' actions. Returns the most common eligible damage type
 * (acid/cold/fire/lightning/thunder) dealt by living enemies' actions.
 * Defaults to 'fire' if no eligible type is found.
 */
export function pickDamageType(caster: Combatant, bf: Battlefield): DamageType {
  const counts = new Map<DamageType, number>();

  for (const e of bf.combatants.values()) {
    if (e.isDead || e.isUnconscious) continue;
    if (e.faction === caster.faction) continue;  // skip allies
    for (const a of e.actions) {
      const dt = a.damageType as DamageType | undefined;
      if (dt && ELIGIBLE.has(dt)) {
        counts.set(dt, (counts.get(dt) ?? 0) + 1);
      }
    }
  }

  let best: DamageType = 'fire';
  let bestCount = 0;
  for (const [dt, n] of counts) {
    if (n > bestCount) {
      best = dt;
      bestCount = n;
    }
  }
  return best;
}

// ---- shouldCast (generic-registry shape) --------------------

/**
 * Returns true if the caster should cast Protection from Energy this turn.
 *
 * Preconditions:
 *   - Caster has 'Protection from Energy' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - Caster is NOT already concentrating (would replace own concentration)
 *   - At least 1 valid ally target exists within 5 ft
 */
export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Protection from Energy')) return false;
  if (!hasSpellSlot(caster, 3)) return false;
  if (caster.concentration?.active) return false;
  return pickTarget(caster, bf) !== null;
}

// ---- execute (generic-registry shape) -----------------------

/**
 * Execute Protection from Energy (re-queries for the best target + damage
 * type). Generic-registry compatible — called via `case 'genericSpell':`
 * in combat.ts.
 */
export function execute(caster: Combatant, state: EngineState): void {
  const target = pickTarget(caster, state.battlefield);
  if (!target) return;  // no valid target — silent no-op (shouldCast gating)
  const damageType = pickDamageType(caster, state.battlefield);
  executeWithTarget(caster, target, state, damageType);
}

// ---- executeWithTarget (test entry point) -------------------

/**
 * Apply Protection from Energy to a specific target with a specific
 * damage type. Used by `execute` (re-queries) and by tests (scripted).
 *
 * Steps:
 *  1. Consume a 3rd-level spell slot.
 *  2. Clean up any stale concentration (safety net).
 *  3. Start concentration on Protection from Energy.
 *  4. Add `damageType` to `target.resistances` (idempotent).
 *  5. Apply a `damage_zone` sentinel effect (dieCount=0) on the target,
 *     sourced from the caster — this is the lifecycle anchor for
 *     concentration-break cleanup. When removeEffectsFromCaster removes
 *     this sentinel, _undoEffect's 'Protection from Energy' case
 *     removes the resistance we added.
 */
export function executeWithTarget(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
  damageType: DamageType,
): void {
  consumeSpellSlot(caster, 3);

  // Safety: clean up any stale concentration before starting new.
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Protection from Energy');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Protection from Energy on ${target.name} — gains resistance to ${damageType}!`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  // 1. Add the resistance directly (immediate effect — applyDamageWithTempHP
  //    queries target.resistances at damage resolution time).
  if (!target.resistances.includes(damageType)) {
    target.resistances.push(damageType);
  }

  // 2. Apply the sentinel effect (lifecycle anchor for concentration break).
  //    payload.damageType is read by _undoEffect's 'Protection from Energy'
  //    case in spell_effects.ts to know which resistance to remove.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Protection from Energy',
    effectType: 'damage_zone',
    payload: {
      dieCount: 0,        // sentinel — skipped by start-of-turn damage tick
      dieSides: 0,
      damageType,
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} gains resistance to ${damageType} damage! (concentration)`,
    target.id,
  );
}

// ---- cleanup ------------------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn from
 * resetBudget(). No-op for Protection from Energy — the 10-minute
 * concentration duration is not tracked in v1; cleanup happens via
 * removeEffectsFromCaster when concentration breaks (which calls
 * _undoEffect's 'Protection from Energy' case).
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via _undoEffect.
}
