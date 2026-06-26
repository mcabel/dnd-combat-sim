// ============================================================
// Lightning Bolt — PHB p.255
//
// 3rd-level evocation, action, range 100 ft (self → 100-ft line),
// NO concentration.
// Components: V, S, M (a bit of fur and an amber, crystal, or glass rod).
//
// Effect: A stroke of lightning forming a line 100 feet long and 5
//         feet wide blasts out from you in a direction you choose.
//         Each creature in the line must make a Dexterity saving
//         throw. A creature takes 8d6 lightning damage on a failed
//         save, or half as much on a successful one.
//
//         The lightning ignites flammable objects in the area that
//         aren't being worn or carried.
//
// Upcast: +1d6 lightning per slot level above 3rd (not modelled in v1).
//
// v1 simplifications:
//   - Line shape: canon 100-ft × 5-ft line from the caster's space
//     in a chosen direction. v1 aims the line toward the highest-
//     threat enemy within 100 ft and collects all enemies inside the
//     line rectangle (via the new `inLineFt` helper in movement.ts).
//     v1 uses a thin-rectangle approximation (perpendicular distance
//     <= 2.5 ft from the centre line). Forward-compat TODO via the
//     metadata flag `lightningBoltExactLineGeometryV1Simplified: true`.
//   - Object damage / flammable ignition (PHB p.255): NOT modelled
//     — v1 has no object HP subsystem.
//   - Upcast: +1d6/slot-level NOT modelled — v1 always rolls 8d6
//     lightning. Forward-compat TODO via
//     `lightningBoltUpcastV1Implemented: false`.
//   - NOT a concentration spell (PHB p.255: instantaneous).
//
// Migration note (Session 21): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect).
// Session 21 migrated it to a bespoke implementation with REAL DEX
// save + 8d6 lightning damage via the new `inLineFt` helper. Removed
// from `_generic_registry.ts`; routed via `case 'lightningBolt':` in
// combat.ts and a planner branch in planner.ts. Mirrors the Burning
// Hands bespoke pattern (Session 17) but uses inLineFt instead of
// inConeFt.
//
// Spell module pattern (line AoE save — new pattern, mirrors
// shatter.ts but with `inLineFt` instead of `chebyshev3D`):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP, elementalAffinityBonus } from '../engine/utils';
import { inLineFt, chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { filterGoIProtectedTargets } from '../engine/spell_effects';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Lightning Bolt',
  level: 3,
  school: 'evocation',
  rangeFt: 100,                // PHB p.255: 100-ft line
  lineLengthFt: 100,           // PHB p.255
  lineWidthFt: 5,              // PHB p.204 (default line width)
  dieCount: 8,
  dieSides: 6,
  damageType: 'lightning' as const,
  concentration: false,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  lightningBoltExactLineGeometryV1Simplified: true,                // thin-rectangle approx
  lightningBoltUpcastV1Implemented: true,                          // +1d6/slot-level modelled via consumeSpellSlot return
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

/** Roll `diceCount`d`metadata.dieSides` and return the total. */
export function rollDamage(diceCount: number = metadata.dieCount): number {
  let total = 0;
  for (let i = 0; i < diceCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the list of enemies caught in a Lightning Bolt 100-ft × 5-ft
 * line aimed at the highest-threat enemy within 100 ft of the caster,
 * or null when the spell should not be cast.
 *
 * Target selection:
 *   1. Find the highest-threat (maxHP) living enemy within 100 ft of
 *      the caster — this is the line's aim point.
 *   2. Collect ALL living enemies inside the line rectangle from the
 *      caster to the aim point (using inLineFt).
 *
 * Preconditions:
 *   - Caster has 'Lightning Bolt' in their actions
 *   - Caster has at least one 3rd-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 100 ft
 *
 * Note: Lightning Bolt is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Lightning Bolt')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  // Find highest-threat enemy within 100 ft of the caster (line aim point).
  let aimAt: Combatant | null = null;
  let aimThreat = -1;
  let aimDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 100) continue;
    // Threat proxy: maxHP. Tie-break: closest to caster.
    if (e.maxHP > aimThreat ||
        (e.maxHP === aimThreat && distFt < aimDist)) {
      aimAt = e;
      aimThreat = e.maxHP;
      aimDist = distFt;
    }
  }

  if (!aimAt) return null;

  // Collect all enemies inside the line rectangle from caster to aimAt.
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
 * Execute Lightning Bolt:
 *  1. Consume a 3rd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. For each target in the list:
 *     a. Roll the target's DEX save vs the caster's saveDC.
 *     b. On fail: 8d6 lightning. On success: half (floor).
 *     c. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *        Warding Bond redirect).
 *     d. Log each save result + damage.
 *
 * v1 simplifications: 100-ft × 5-ft line (thin-rectangle approximation);
 * object damage / flammable ignition NOT modelled; upcast NOT modelled;
 * NOT concentration.
 *
 * @param caster  The casting Combatant (Sorcerer / Wizard / Storm Cleric
 *                via domain / some Warlock patrons, etc.)
 * @param targets Candidates from shouldCast (all enemies in the line)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Lightning Bolt');
  const saveDC = action?.saveDC ?? 15;

  const slotLevel = consumeSpellSlot(caster, 3) ?? 3;
  const diceCount = 8 + Math.max(0, slotLevel - 3);

  // Session 77 (RFC-UPCASTING Phase 4 follow-up): exclude targets protected
  // by Globe of Invulnerability from this AoE. PHB p.245: "the spell has no
  // effect on them." The spell still fires (slot already consumed above);
  // protected targets are simply skipped in the damage loop.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Lightning Bolt at L${slotLevel}! (DC ${saveDC} DEX, ${diceCount}d${metadata.dieSides} ${metadata.damageType}, ${metadata.lineLengthFt}-ft × ${metadata.lineWidthFt}-ft line) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
  );

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'dex', saveDC);
    // Session 48 Task #29-follow-up-5c: Elemental Affinity (Draconic Sorcerer 6)
    const eaBonus = elementalAffinityBonus(caster, metadata.damageType);
    const fullDmg = rollDamage(diceCount) + eaBonus;
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Lightning Bolt (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${diceCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Lightning Bolt: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Lightning Bolt — NO-OP because:
 *   - Lightning Bolt is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
