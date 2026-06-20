// ============================================================
// Disintegrate — PHB p.233
//
// 6th-level transmutation, action, range 60 ft, NO concentration.
// Components: V, S, M (a lodestone and a pinch of dust).
//
// Effect: A thin green ray springs from your pointing finger to a
//         target that you can see within range. The target must make
//         a Dexterity saving throw. On a failed save, the target
//         takes 10d6 + 40 force damage. If this damage reduces the
//         target to 0 hit points, it is disintegrated.
//
//         A disintegrated creature and everything it is wearing and
//         carrying, except magic items, are reduced to a pile of fine
//         gray dust. The creature can be restored to life only by
//         means of a true resurrection or a wish spell.
//
//         The spell automatically disintegrates a Large or smaller
//         nonmagical object or a creation of magical force. If the
//         target is a Huge or larger object or creation of force,
//         this spell disintegrates a 10-foot-cube portion of it.
//
// Upcast: +3d6 force per slot level above 6th (not modelled in v1).
//
// v1 simplifications:
//   - Range: canon 60 ft. v1 uses chebyshev3D * 5 for the distance
//     check (square approximation of euclidean range).
//   - Single-target (PHB p.233: "a target that you can see"). The
//     SPELL_DB entry has damage:null (a Session 19 bulk-data gap —
//     Disintegrate's damage is 10d6+40, not null). v1 implements the
//     REAL 10d6+40 force damage. Documented via
//     `disintegrateDamageV1Implemented: true`.
//   - Disintegrate-on-0-HP (PHB p.233: "reduced to a pile of fine
//     gray dust. The creature can be restored to life only by true
//     resurrection or wish"): NOT modelled as a special death-state —
//     v1 has no "disintegrated" flag on Combatant, and the death
//     state (isDead=true) is identical whether the creature died
//     normally or was disintegrated. The flavour difference (no
//     resurrection except true resurrection/wish) is NOT enforced
//     because v1 has no resurrection subsystem. Documented via
//     `disintegrateOnZeroHpV1Simplified: true`.
//   - Object/force-creation disintegration (PHB p.233: "automatically
//     disintegrates a Large or smaller nonmagical object or a creation
//     of magical force"): NOT modelled — v1 has no object HP subsystem.
//   - Upcast: +3d6/slot-level NOT modelled — v1 always rolls 10d6+40
//     force. Forward-compat TODO via `disintegrateUpcastV1Implemented: false`.
//   - NOT a concentration spell (PHB p.233: instantaneous).
//   - Flat bonus: +40 force is added to the dice total (not doubled
//     on anything — Disintegrate is a save spell, not an attack, so
//     there's no crit). This is the FIRST spell in v1 with a flat
//     damage bonus on a save spell (mirror the attack-roll flat-bonus
//     pattern from Scorching Ray's +spellcasting-mod).
//
// Migration note (Session 23): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect).
// Session 23 migrated it to a bespoke implementation with REAL DEX
// save + 10d6+40 force damage. Removed from `_generic_registry.ts`;
// routed via `case 'disintegrate':` in combat.ts and a planner branch
// in planner.ts. Mirrors the Catapult bespoke pattern (Session 22)
// but with a flat +40 bonus on top of the dice.
//
// Spell module pattern (single-target save with flat bonus — mirrors
// catapult.ts but with DEX save, 10d6+40 force, 60-ft range, L6 slot,
// and a flatDamageBonus field):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Disintegrate',
  level: 6,
  school: 'transmutation',
  rangeFt: 60,                  // PHB p.233: 60 ft
  dieCount: 10,
  dieSides: 6,
  flatDamageBonus: 40,          // PHB p.233: +40 force on top of 10d6
  damageType: 'force' as const,
  concentration: false,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  disintegrateDamageV1Implemented: true,                            // SPELL_DB had null; v1 implements 10d6+40
  disintegrateOnZeroHpV1Simplified: true,                           // no "disintegrated" death-state in v1
  disintegrateObjectV1Simplified: true,                             // no object HP subsystem in v1
  disintegrateUpcastV1Implemented: false,                           // +3d6/slot-level NOT modelled
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

/**
 * Roll `metadata.dieCount`d`metadata.dieSides` + `flatDamageBonus`
 * and return the total. The flat bonus is added AFTER the dice (it
 * is NOT halved on a save — PHB p.233: "10d6 + 40 force damage. If
 * this damage reduces the target to 0 hit points, it is disintegrated."
 * — the half-on-save rule applies to the TOTAL damage, not just the
 * dice. v1 halves the total (dice + bonus) on a save, matching the
 * Shatter / Catapult half-on-save pattern.)
 *
 * @param includeFlat  If true (default), add the flat +40 bonus.
 *                     Exposed for tests that want to inspect the
 *                     dice-only total.
 */
export function rollDamage(includeFlat = true): number {
  let dice = 0;
  for (let i = 0; i < metadata.dieCount; i++) dice += rollDie(metadata.dieSides);
  return includeFlat ? dice + metadata.flatDamageBonus : dice;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Disintegrate (a living enemy
 * within 60 ft), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Lowest current HP enemy within 60 ft whose currentHP ≤ the
 *      spell's average damage (10d6+40 avg = 75) — Disintegrate's
 *      disintegrate-on-0-HP rider makes it a premier kill-shot spell.
 *      v1 simplification: even though the disintegrate death-state
 *      isn't modelled, the spell still deals 10d6+40 (avg 75) force,
 *      so prioritising low-HP targets maximises the chance of a kill.
 *   2. Tie-break: highest maxHP (more "value" from the kill).
 *
 * Preconditions:
 *   - Caster has 'Disintegrate' in their actions
 *   - Caster has at least one 6th-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Disintegrate is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Disintegrate')) return null;
  if (!hasSpellSlot(caster, 6)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; curHP: number; threat: number; dist: number }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    candidates.push({ c: e, curHP: e.currentHP, threat: e.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: lowest current HP first (kill-shot bias), then highest
  // threat (more value from the kill), then closest.
  candidates.sort((a, b) => {
    if (a.curHP !== b.curHP) return a.curHP - b.curHP;
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Disintegrate:
 *  1. Consume a 6th-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Roll the target's DEX save vs the caster's saveDC.
 *  3. On fail: 10d6+40 force. On success: half (floor) — both dice
 *     AND flat bonus are halved (v1 simplification matching the
 *     Shatter / Catapult half-on-save pattern; canon is debatable
 *     but halving the total is the conservative reading).
 *  4. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *     Warding Bond redirect).
 *  5. Log the save result + damage.
 *
 * v1 simplifications: disintegrate-on-0-HP death-state NOT modelled
 * (creature just dies normally at 0 HP); object/force-creation
 * disintegration NOT modelled; upcast NOT modelled; NOT concentration;
 * flat bonus IS halved on save (conservative reading).
 *
 * @param caster  The casting Combatant (Sorcerer / Wizard)
 * @param target  The target Combatant (must be within 60 ft — shouldCast enforces)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Disintegrate');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 6);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Disintegrate at ${target.name}! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides}+${metadata.flatDamageBonus} ${metadata.damageType}, half on save)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'save_success', caster.id,
      `Disintegrate: ${target.name} is already down — green ray fizzles.`,
      target.id,
    );
    return;
  }

  const save = rollSave(target, 'dex', saveDC);
  const fullDmg = rollDamage();
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Disintegrate (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}+${metadata.flatDamageBonus}=${fullDmg}${save.success ? ', halved' : ''})`,
    target.id, save.roll,
  );
  emit(
    state, 'damage', caster.id,
    `Disintegrate: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
    target.id, dealt,
  );

  // v1 simplification: disintegrate-on-0-HP is NOT modelled as a
  // special death-state. The creature just dies normally at 0 HP
  // (applyDamageWithTempHP → applyDamage sets isDead=true for
  // monsters). The flavour "reduced to fine gray dust" is logged
  // only when the damage kills the target.
  if (target.isDead) {
    emit(
      state, 'death', caster.id,
      `Disintegrate: ${target.name} is reduced to a pile of fine gray dust! (v1: disintegrate death-state not modelled — treated as normal death)`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Disintegrate — NO-OP because:
 *   - Disintegrate is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
