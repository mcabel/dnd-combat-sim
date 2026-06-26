// ============================================================
// Sunburst — PHB p.284
//
// 8th-level evocation, action, range 150 ft, NO concentration.
// Components: V, S, M (a piece of sunstone and a glowing ember).
//
// Effect: Brilliant sunlight flashes in a 60-foot-radius sphere
//         centered on a point you choose within range. Each creature
//         in that area must make a Constitution saving throw. On a
//         failed save, a creature takes 12d6 radiant damage and is
//         blinded for 1 minute. On a successful save, it takes half
//         as much damage and isn't blinded by this spell. Undead and
//         oozes have disadvantage on this save.
//
//         A creature blinded by this spell makes another Constitution
//         saving throw at the end of each of its turns. On a
//         successful save, it is no longer blinded.
//
// Upcast: +2d6 radiant per slot level above 8th (not modelled in v1).
//
// v1 simplifications:
//   - Range: canon 150 ft. v1 uses chebyshev3D * 5 for the distance
//     check (square approximation of euclidean range).
//   - AoE: canon 60-ft radius sphere. v1 uses chebyshev3D — square
//     approximation of the sphere (same as Fireball / Shatter).
//   - Blindness on failed save (PHB p.284: "blinded for 1 minute"):
//     v1 applies the blinded condition via condition_apply (mirror
//     Blindness/Deafness's pattern, Session 18). The 1-minute
//     duration is NOT tracked — the condition persists for the
//     entire combat in v1 (matching the Blindness/Deafness v1
//     simplification). Documented via
//     `sunburstBlindnessDurationV1Simplified: true`.
//   - End-of-turn CON save to end blindness (PHB p.284: "makes
//     another Constitution saving throw at the end of each of its
//     turns"): NOT modelled — v1 has no end-of-turn save hook for
//     conditions (same gap as Blindness/Deafness). Documented via
//     `sunburstEndOfTurnSaveV1Implemented: false`.
//   - Undead/ooze disadvantage (PHB p.284: "Undead and oozes have
//     disadvantage on this save"): NOT modelled — v1 has no
//     creature-type tag. Documented via
//     `sunburstUndeadOozeDisadvantageV1Simplified: true`.
//   - Upcast: +2d6/slot-level NOT modelled — v1 always rolls 12d6
//     radiant. Forward-compat TODO via `sunburstUpcastV1Implemented: false`.
//   - NOT a concentration spell (PHB p.284: instantaneous — the
//     blindness rider is a 1-minute non-concentration effect).
//
// Migration note (Session 23): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect).
// Session 23 migrated it to a bespoke implementation with REAL CON
// save + 12d6 radiant AoE damage + blinded condition on failed save.
// Removed from `_generic_registry.ts`; routed via `case 'sunburst':`
// in combat.ts and a planner branch in planner.ts. Mirrors the
// Fireball bespoke pattern (Session 22) for the AoE save damage,
// plus the Blindness/Deafness bespoke pattern (Session 18) for the
// condition_apply on failed save.
//
// Spell module pattern (AoE save + condition — mirrors fireball.ts
// for the AoE shape + damage, plus blindness_deafness.ts for the
// condition_apply):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (v1: blindness persists for combat, no
//              concentration to break)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect } from '../engine/spell_effects';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Sunburst',
  level: 8,
  school: 'evocation',
  rangeFt: 150,                 // PHB p.284: 150 ft
  aoeRadiusFt: 60,              // PHB p.284: 60-ft radius sphere
  dieCount: 12,
  dieSides: 6,
  damageType: 'radiant' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  sunburstBlindnessDurationV1Simplified: true,                      // 1-min not tracked (persists for combat)
  sunburstEndOfTurnSaveV1Implemented: false,                        // end-of-turn save skipped
  sunburstUndeadOozeDisadvantageV1Simplified: true,                 // no creature-type tag in v1
  sunburstUpcastV1Implemented: true,                                // +2d6/slot-level modelled
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

/** Roll `count`d`metadata.dieSides` and return the total. */
export function rollDamage(count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the list of enemies caught in a Sunburst 60-ft-radius
 * sphere centered on the highest-threat enemy within 150 ft of the
 * caster, or null when the spell should not be cast.
 *
 * Target selection:
 *   1. Find the highest-threat (maxHP) living enemy within 150 ft of
 *      the caster — this is the sphere's center.
 *   2. Collect ALL living enemies within 60 ft of that center (using
 *      chebyshev3D — square approximation of the sphere).
 *
 * Preconditions:
 *   - Caster has 'Sunburst' in their actions
 *   - Caster has at least one 8th-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 150 ft
 *
 * Note: Sunburst is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Sunburst')) return null;
  if (!hasSpellSlot(caster, 8)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  // Find highest-threat enemy within 150 ft of the caster (sphere center).
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 150) continue;
    // Threat proxy: maxHP. Tie-break: closest to caster.
    if (e.maxHP > centerThreat ||
        (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e;
      centerThreat = e.maxHP;
      centerDist = distFt;
    }
  }

  if (!center) return null;

  // Collect all enemies within 60 ft of the center (chebyshev3D * 5).
  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 60) targets.push(e);
  }

  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Sunburst:
 *  1. Consume an 8th-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. For each target in the list:
 *     a. Roll the target's CON save vs the caster's saveDC.
 *     b. On fail: 12d6 radiant damage + blinded condition (condition_apply).
 *     c. On success: half damage (floor), NO blindness.
 *     d. Apply damage via applyDamageWithTempHP (handles resistances / temp HP /
 *        Warding Bond redirect).
 *     e. On failed save, apply blinded via applySpellEffect (mirror
 *        Blindness/Deafness's pattern — the condition persists for
 *        the entire combat in v1, no concentration).
 *     f. Log each save result + damage + condition.
 *
 * v1 simplifications: 60-ft radius (chebyshev square approximation);
 * blindness 1-min duration NOT tracked (persists for combat);
 * end-of-turn save to end blindness NOT modelled; undead/ooze
 * disadvantage NOT applied; upcast NOT modelled; NOT concentration.
 *
 * @param caster  The casting Combatant (Druid / Sorcerer / Wizard)
 * @param targets Candidates from shouldCast (all enemies in the 60-ft sphere)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Sunburst');
  const saveDC = action?.saveDC ?? 13;

  const slotLevel = consumeSpellSlot(caster, 8) ?? 8;
  const diceCount = 12 + 2 * Math.max(0, slotLevel - 8);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Sunburst at L${slotLevel}! (DC ${saveDC} CON, ${diceCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE + blinded on fail) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'con', saveDC);
    const fullDmg = rollDamage(diceCount);
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Sunburst (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${diceCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + BLINDED'}`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Sunburst: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );

    // On failed save: apply blinded condition (mirror Blindness/Deafness).
    // NOT concentration — sourceIsConcentration: false. The condition
    // persists for the entire combat in v1 (1-min duration not tracked).
    if (!save.success) {
      // Skip if already blinded (re-apply would be a no-op but the log
      // would be misleading).
      if (!target.conditions.has('blinded')) {
        applySpellEffect(target, {
          casterId: caster.id,
          spellName: 'Sunburst',
          effectType: 'condition_apply',
          payload: { condition: 'blinded' },
          sourceIsConcentration: false,   // PHB p.284: NOT concentration
        });
        emit(
          state, 'condition_add', caster.id,
          `${target.name} is BLINDED by the sunlight! (disadvantage on attacks, advantage on attacks vs them)`,
          target.id,
        );
      } else {
        emit(
          state, 'condition_add', caster.id,
          `${target.name} is already blinded — Sunburst's blindness has no additional effect.`,
          target.id,
        );
      }
    }
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Sunburst — NO-OP in v1 because:
 *   - Sunburst is NOT a concentration spell; the blinded condition
 *     persists for the v1 combat duration (1-min not tracked).
 *   - v1 does NOT model the end-of-turn CON save (PHB p.284).
 *
 * A future implementation that adds the end-of-turn save would need
 * to hook into the target's turn-end (same gap as Blindness/Deafness).
 */
export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; condition persists for v1 combat.
}
