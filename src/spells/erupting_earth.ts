// ============================================================
// Erupting Earth — XGE p.155
//
// 3rd-level transmutation, action, range 60 ft, NO concentration.
// Components: V, S, M (a piece of obsidian).
//
// Effect: Choose a point on the ground you can see within range. A
//         fountain of churned earth and stone erupts in a 20-foot cube
//         centered on that point. Each creature in that area must make
//         a Dexterity saving throw. A creature takes 3d12 bludgeoning
//         damage on a failed save, or half as much on a successful one.
//         Additionally, the ground in that area becomes difficult terrain
//         until the spell ends.
//
// Upcast: +1d12 bludgeoning per slot level above 3rd (not modelled in v1).
//
// v1 simplifications:
//   - AoE shape: canon 20-ft cube centred on a point within 60 ft. v1
//     simplification: targets the highest-threat enemy within 60 ft as
//     the cube's centre, and applies the damage to ALL enemies within
//     20 ft of that centre (using chebyshev3D — square approximation
//     of the cube). Mirrors the Shatter bespoke pattern (Session 18)
//     but with a 20-ft radius instead of 10 ft. Documented via
//     `eruptingEarthCubeToRadiusV1Simplified: true`.
//   - Difficult-terrain rider (XGE p.155: "the ground becomes difficult
//     terrain until the spell ends"): NOT modelled — v1 has no terrain
//     subsystem. Documented via
//     `eruptingEarthDifficultTerrainV1Simplified: true`.
//   - Upcast: +1d12/slot-level NOT modelled — v1 always rolls 3d12.
//     Forward-compat TODO via `eruptingEarthUpcastV1Implemented: false`.
//   - NOT a concentration spell (XGE p.155: instantaneous — the
//     difficult-terrain rider is the only persistent effect, which v1
//     does NOT model).
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL DEX save + 3d12
// bludgeoning AoE damage. Removed from `_generic_registry.ts`; routed
// via `case 'eruptingEarth':` in combat.ts and a planner branch in
// planner.ts. Mirrors the Shatter bespoke pattern (Session 18) but with
// 3d12 bludgeoning, 20-ft radius, L3 slot.
//
// Spell module pattern (AoE save radius — mirrors shatter.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (instantaneous in v1)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { filterGoIProtectedTargets } from '../engine/spell_effects';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Erupting Earth',
  level: 3,
  school: 'transmutation',
  rangeFt: 60,                   // XGE p.155: 60 ft
  aoeRadiusFt: 20,               // XGE p.155: 20-ft cube → v1 20-ft radius
  dieCount: 3,
  dieSides: 12,
  damageType: 'bludgeoning' as const,
  concentration: false,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  eruptingEarthCubeToRadiusV1Simplified: true,                        // 20-ft cube approximated as 20-ft radius
  eruptingEarthDifficultTerrainV1Simplified: true,                   // no terrain subsystem in v1
  eruptingEarthUpcastV1Implemented: false,                            // +1d12/slot-level NOT modelled
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
 * Returns the list of enemies caught in an Erupting Earth 20-ft-radius
 * cube centred on the highest-threat enemy within 60 ft of the caster,
 * or null when the spell should not be cast.
 *
 * Target selection:
 *   1. Find the highest-threat (maxHP) living enemy within 60 ft of
 *      the caster — this is the cube's centre.
 *   2. Collect ALL living enemies within 20 ft of that centre (using
 *      chebyshev3D — square approximation of the cube).
 *
 * Preconditions:
 *   - Caster has 'Erupting Earth' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Erupting Earth is NOT concentration in v1 (canon instantaneous
 * + difficult-terrain rider, which v1 does NOT model). The planner
 * should NOT gate on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Erupting Earth')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    if (e.maxHP > centerThreat ||
        (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e;
      centerThreat = e.maxHP;
      centerDist = distFt;
    }
  }

  if (!center) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 20) targets.push(e);
  }

  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Erupting Earth:
 *  1. Consume a 3rd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. For each target in the list:
 *     a. Roll the target's DEX save vs the caster's saveDC.
 *     b. On fail: 3d12 bludgeoning. On success: half (floor).
 *     c. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *        Warding Bond redirect).
 *     d. Log each save result + damage.
 *
 * v1 simplifications: 20-ft cube approximated as 20-ft radius (chebyshev
 * square); difficult-terrain rider NOT modelled; upcast NOT modelled;
 * NOT concentration.
 *
 * @param caster  The casting Combatant (Druid / Sorcerer / Wizard — XGE p.155)
 * @param targets Candidates from shouldCast (all enemies in the 20-ft cube)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Erupting Earth');
  const saveDC = action?.saveDC ?? 15;

  const slotLevel = consumeSpellSlot(caster, 3) ?? 3;

  // Session 79 (GoI AoE exclusion): exclude targets protected by Globe of
  // Invulnerability. PHB p.245: "the spell has no effect on them." The spell
  // still fires (slot already consumed above); protected targets are simply
  // skipped in the damage loop.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Erupting Earth! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.aoeRadiusFt}-ft radius AoE) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
  );

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'dex', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Erupting Earth (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Erupting Earth: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Erupting Earth — NO-OP because:
 *   - Erupting Earth is instantaneous in v1 (the difficult-terrain
 *     rider is NOT modelled).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
