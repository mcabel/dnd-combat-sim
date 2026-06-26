// ============================================================
// Tidal Wave — XGE p.168
//
// 3rd-level conjuration, action, range 30 ft (self → 30-ft line/wave),
// NO concentration.
// Components: V, S, M (a drop of water).
//
// Effect: You conjure up a wave of water that crashes down on one
//         creature within range. The target must make a Strength
//         saving throw. On a failed save, the target takes 4d8
//         bludgeoning damage and is knocked prone. On a successful
//         save, the target takes half as much damage and isn't knocked
//         prone.
//
//         NOTE: XGE p.168 is actually single-target ("one creature").
//         The plan spec paraphrases this as a "line/wave" — v1 follows
//         the plan's line interpretation (30-ft line AoE) because the
//         plan explicitly says "approximate the 'wave' as a 30-ft line
//         via inLineFt". This is a deliberate plan-driven deviation
//         from canon (canon is single-target). See simplifications.
//
// Upcast: +1d8 bludgeoning per slot level above 3rd (not modelled).
//
// v1 simplifications:
//   - Shape: canon single-target (XGE p.168: "one creature within
//     range"). v1 follows the PLAN spec (30-ft line AoE via inLineFt)
//     — a deliberate deviation documented via
//     `tidalWaveLineShapeV1PerPlan: true`. The plan's rationale: the
//     spell's name + visual ("wave") suggests a line/wave shape, and a
//     line AoE is more tactically interesting than single-target.
//   - Line geometry: v1 aims the 30-ft line toward the highest-threat
//     enemy within 30 ft and collects all enemies inside the line
//     rectangle (via inLineFt, default 5-ft width per PHB p.204).
//   - Prone on failed save (XGE p.168): v1 applies the prone condition
//     via condition_apply (mirror Earth Tremor's prone pattern, Session 24).
//     The condition persists for the v1 combat (no stand-up hook for
//     NPC enemies). Documented via `tidalWaveProneDurationV1Simplified: true`.
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 4d8.
//     Forward-compat TODO via `tidalWaveUpcastV1Implemented: false`.
//   - NOT a concentration spell (XGE p.168: instantaneous).
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL STR save + 4d8
// bludgeoning line AoE damage + prone on failed save. Removed from
// `_generic_registry.ts`; routed via `case 'tidalWave':` in combat.ts
// and a planner branch in planner.ts. Mirrors the Lightning Bolt
// bespoke pattern (Session 21) for the line geometry + damage loop,
// plus the Earth Tremor bespoke pattern (Session 24) for the prone
// condition_apply.
//
// Spell module pattern (line AoE save + condition — mirrors
// lightning_bolt.ts + earth_tremor.ts condition_apply):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (instantaneous; prone persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { inLineFt, chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect, filterGoIProtectedTargets } from '../engine/spell_effects';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Tidal Wave',
  level: 3,
  school: 'conjuration',
  rangeFt: 30,                   // XGE p.168: 30 ft (v1: 30-ft line per plan)
  lineLengthFt: 30,              // v1 plan: 30-ft line
  lineWidthFt: 5,                // PHB p.204 (default line width)
  dieCount: 4,
  dieSides: 8,
  damageType: 'bludgeoning' as const,
  concentration: false,
  saveAbility: 'str' as const,
  castingTime: 'action',
  tidalWaveLineShapeV1PerPlan: true,                                 // canon single-target; v1 uses 30-ft line per plan
  tidalWaveProneDurationV1Simplified: true,                          // prone persists for combat (no stand-up hook)
  tidalWaveUpcastV1Implemented: false,                                // +1d8/slot-level NOT modelled
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

// ---- Dice helper --------------------------------------------

/** Roll `metadata.dieCount`d`metadata.dieSides` and return the total. */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the list of enemies caught in a Tidal Wave 30-ft × 5-ft line
 * aimed at the highest-threat enemy within 30 ft of the caster, or null
 * when the spell should not be cast.
 *
 * Target selection:
 *   1. Find the highest-threat (maxHP) living enemy within 30 ft of
 *      the caster — this is the line's aim point.
 *   2. Collect ALL living enemies inside the line rectangle from the
 *      caster to the aim point (using inLineFt).
 *
 * Preconditions:
 *   - Caster has 'Tidal Wave' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 30 ft
 *
 * Note: Tidal Wave is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Tidal Wave')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  let aimAt: Combatant | null = null;
  let aimThreat = -1;
  let aimDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 30) continue;
    if (e.maxHP > aimThreat ||
        (e.maxHP === aimThreat && distFt < aimDist)) {
      aimAt = e;
      aimThreat = e.maxHP;
      aimDist = distFt;
    }
  }

  if (!aimAt) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    if (inLineFt(caster.pos, aimAt.pos, e.pos, metadata.lineLengthFt, metadata.lineWidthFt)) {
      targets.push(e);
    }
  }

  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Tidal Wave:
 *  1. Consume a 3rd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. For each target in the list:
 *     a. Roll the target's STR save vs the caster's saveDC.
 *     b. On fail: 4d8 bludgeoning + prone (condition_apply).
 *     c. On success: half damage (floor), NO prone.
 *     d. Apply damage via applyDamageWithTempHP (handles resistances /
 *        temp HP / Warding Bond redirect).
 *     e. On failed save, apply prone via applySpellEffect (mirror
 *        Earth Tremor's prone pattern — NOT concentration; persists for
 *        the v1 combat duration).
 *     f. Log each save result + damage + condition.
 *
 * v1 simplifications: 30-ft line (plan-driven deviation from canon
 * single-target); prone persists for combat (no stand-up hook); upcast
 * NOT modelled; NOT concentration.
 *
 * @param caster  The casting Combatant (Cleric / Druid / Wizard — XGE p.168)
 * @param targets Candidates from shouldCast (all enemies in the line)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Tidal Wave');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 3);
  const slotLevel = 3;

  // Session 78 (GoI AoE exclusion follow-up): exclude targets protected by
  // Globe of Invulnerability from this AoE. PHB p.245: "the spell has no
  // effect on them." The spell still fires (slot already consumed above);
  // protected targets are simply skipped in the damage loop.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Tidal Wave! (DC ${saveDC} STR, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.lineLengthFt}-ft × ${metadata.lineWidthFt}-ft line + prone on fail) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
  );

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'str', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} STR save vs Tidal Wave (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + PRONE'}`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Tidal Wave: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );

    // On failed save: apply prone condition (mirror Earth Tremor).
    // NOT concentration — sourceIsConcentration: false. The condition
    // persists for the entire combat in v1 (no stand-up hook for NPCs).
    if (!save.success) {
      if (!target.conditions.has('prone')) {
        applySpellEffect(target, {
          casterId: caster.id,
          spellName: 'Tidal Wave',
          effectType: 'condition_apply',
          payload: { condition: 'prone' },
          sourceIsConcentration: false,   // XGE p.168: NOT concentration
        });
        emit(
          state, 'condition_add', caster.id,
          `${target.name} is KNOCKED PRONE by the wave! (melee attacks against them have advantage; their own attacks have disadvantage)`,
          target.id,
        );
      } else {
        emit(
          state, 'condition_add', caster.id,
          `${target.name} is already prone — Tidal Wave's knockdown has no additional effect.`,
          target.id,
        );
      }
    }
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Tidal Wave — NO-OP in v1 because:
 *   - Tidal Wave is NOT a concentration spell; the prone condition
 *     persists for the v1 combat duration (no stand-up hook modelled).
 */
export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; condition persists for v1 combat.
}
