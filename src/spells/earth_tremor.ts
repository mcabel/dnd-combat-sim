// ============================================================
// Earth Tremor — XGE p.155
//
// 1st-level transmutation, action, range Self (10-ft radius),
// NO concentration.
// Components: V, S.
//
// Effect: You cause a tremor in the ground within range. Each creature
//         other than you in that area must make a Constitution saving
//         throw. On a failed save, a creature takes 1d6 bludgeoning
//         damage and is knocked prone. On a successful save, the
//         creature takes half as much damage and isn't knocked prone.
//
//         Make a melee spell attack against each creature in a 5-foot
//         ... (the "difficult terrain" rider is the second paragraph;
//         v1 does NOT model terrain — see simplifications).
//
// Upcast: +1d6 damage per slot level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - AoE shape: canon 10-ft radius sphere centered on the CASTER
//     (XGE p.155: "Self (10-foot radius)"). v1 collects all living
//     enemies within 10 ft of the caster (chebyshev3D — square
//     approximation of the sphere). The caster is EXCLUDED per
//     XGE p.155 ("Each creature other than you").
//   - Prone on failed save (XGE p.155: "knocked prone"): v1 applies
//     the prone condition via condition_apply. The condition persists
//     for the entire combat in v1 (no end-of-turn stand-up hook for
//     NPC enemies; players can use half-movement to stand — that's
//     handled by the movement subsystem, not here). Documented via
//     `earthTremorProneDurationV1Simplified: true`.
//   - Difficult-terrain rider (XGE p.155: "the ground becomes
//     difficult terrain"): NOT modelled — v1 has no terrain subsystem.
//     Documented via `earthTremorDifficultTerrainV1Simplified: true`.
//   - Upcast: +1d6/slot-level NOT modelled — v1 always rolls 1d6.
//     Forward-compat TODO via `earthTremorUpcastV1Implemented: false`.
//   - NOT a concentration spell (XGE p.155: instantaneous).
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 20 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL CON save + 1d6
// bludgeoning AoE damage + prone on failed save. Removed from
// `_generic_registry.ts`; routed via `case 'earthTremor':` in
// combat.ts and a planner branch in planner.ts. Mirrors the Sunburst
// bespoke pattern (Session 23) for the AoE save + condition_apply,
// but centred on the CASTER (not a chosen point) and excluding the
// caster.
//
// Spell module pattern (self-centred AoE save + condition — mirrors
// sunburst.ts but the centre is the caster and the caster is excluded):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (instantaneous; prone persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { applySpellEffect } from '../engine/spell_effects';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Earth Tremor',
  level: 1,
  school: 'transmutation',
  rangeFt: 0,                    // XGE p.155: Self (10-ft radius) — caster is the centre
  aoeRadiusFt: 10,               // XGE p.155: 10-ft radius
  dieCount: 1,
  dieSides: 6,
  damageType: 'bludgeoning' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  earthTremorProneDurationV1Simplified: true,                        // prone persists for combat (no stand-up hook)
  earthTremorDifficultTerrainV1Simplified: true,                    // no terrain subsystem in v1
  earthTremorUpcastV1Implemented: false,                            // +1d6/slot-level NOT modelled
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
 * Returns the list of living enemies caught in an Earth Tremor 10-ft
 * radius centred on the CASTER (the caster is excluded per XGE p.155),
 * or null when the spell should not be cast.
 *
 * Target selection:
 *   1. Collect ALL living enemies within 10 ft of the caster (using
 *      chebyshev3D — square approximation of the sphere).
 *   2. The caster is excluded (XGE p.155: "Each creature other than
 *      you").
 *
 * Preconditions:
 *   - Caster has 'Earth Tremor' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - At least 1 living enemy is within 10 ft of the caster
 *
 * Note: Earth Tremor is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Earth Tremor')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const targets: Combatant[] = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt <= 10) targets.push(e);
  }

  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Earth Tremor:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. For each target in the list:
 *     a. Roll the target's CON save vs the caster's saveDC.
 *     b. On fail: 1d6 bludgeoning + prone (condition_apply).
 *     c. On success: half damage (floor), NO prone.
 *     d. Apply damage via applyDamageWithTempHP (handles resistances /
 *        temp HP / Warding Bond redirect).
 *     e. On failed save, apply prone via applySpellEffect (mirror
 *        Sunburst's blinded pattern — NOT concentration; persists for
 *        the v1 combat duration).
 *     f. Log each save result + damage + condition.
 *
 * v1 simplifications: self-centred 10-ft radius (chebyshev square);
 * caster excluded; prone persists for combat (no stand-up hook);
 * difficult-terrain rider NOT modelled; upcast NOT modelled; NOT
 * concentration.
 *
 * @param caster  The casting Combatant (Druid / Sorcerer / Wizard — XGE p.155)
 * @param targets Candidates from shouldCast (all enemies within 10 ft of the caster)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Earth Tremor');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Earth Tremor! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius self-centred AoE + prone on fail) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'con', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Earth Tremor (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + PRONE'}`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Earth Tremor: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );

    // On failed save: apply prone condition (mirror Sunburst's blinded).
    // NOT concentration — sourceIsConcentration: false. The condition
    // persists for the entire combat in v1 (no stand-up hook for NPCs).
    if (!save.success) {
      if (!target.conditions.has('prone')) {
        applySpellEffect(target, {
          casterId: caster.id,
          spellName: 'Earth Tremor',
          effectType: 'condition_apply',
          payload: { condition: 'prone' },
          sourceIsConcentration: false,   // XGE p.155: NOT concentration
        });
        emit(
          state, 'condition_add', caster.id,
          `${target.name} is KNOCKED PRONE by the tremor! (melee attacks against them have advantage; their own attacks have disadvantage)`,
          target.id,
        );
      } else {
        emit(
          state, 'condition_add', caster.id,
          `${target.name} is already prone — Earth Tremor's knockdown has no additional effect.`,
          target.id,
        );
      }
    }
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Earth Tremor — NO-OP in v1 because:
 *   - Earth Tremor is NOT a concentration spell; the prone condition
 *     persists for the v1 combat duration (no stand-up hook modelled).
 */
export function cleanup(_c: Combatant): void {
  // No-op — NOT concentration; condition persists for v1 combat.
}
