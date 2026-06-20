// ============================================================
// Finger of Death — PHB p.241
//
// 7th-level necromancy, action, range 60 ft, NO concentration.
// Components: V, S.
//
// Effect: You send negative energy coursing through a creature that
//         you can see within range, causing it searing pain. The
//         target must make a Constitution saving throw. It takes
//         7d8 + 30 necrotic damage on a failed save, or half as
//         much damage on a successful one.
//
//         A humanoid killed by this spell is raised at the start of
//         your next turn as a zombie that is permanently under your
//         command. The zombie acts as a member of your faction and
//         follows your orders (v1: simplified — see below).
//
// Upcast: +1d8 necrotic per slot level above 7th (not modelled in v1).
//
// v1 simplifications:
//   - Range: canon 60 ft. v1 uses chebyshev3D * 5 for the distance
//     check (square approximation of euclidean range).
//   - Single-target (PHB p.241: "a creature that you can see"). The
//     SPELL_DB entry has damage:null (a Session 19 bulk-data gap —
//     Finger of Death's damage is 7d8+30, not null). v1 implements
//     the REAL 7d8+30 necrotic damage. Documented via
//     `fingerOfDeathDamageV1Implemented: true`.
//   - Zombie-raise on-kill (PHB p.241: "A humanoid killed by this
//     spell is raised at the start of your next turn as a zombie
//     that is permanently under your command"): NOT modelled — v1
//     has no summon subsystem (TG-006 is still OPEN — see
//     TG-006-SUMMON-PLAN.md for the 4-phase plan). The damage is
//     applied normally; if the target dies, it just dies (no zombie
//     is raised). Documented via
//     `fingerOfDeathZombieRaiseV1Simplified: true`. A future
//     implementation should hook into the TG-006 summon subsystem
//     once it's built (phase 1 of the plan covers permanent summons).
//   - Humanoid-only restriction (PHB p.241: "A humanoid killed"):
//     moot in v1 since the zombie-raise is not modelled.
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 7d8+30
//     necrotic. Forward-compat TODO via
//     `fingerOfDeathUpcastV1Implemented: false`.
//   - NOT a concentration spell (PHB p.241: instantaneous — the
//     zombie-raise is permanent, not a concentration effect).
//   - Flat bonus: +30 necrotic is added to the dice total (mirrors
//     Disintegrate's +40 flat bonus pattern from Session 23).
//
// Migration note (Session 23): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect).
// Session 23 migrated it to a bespoke implementation with REAL CON
// save + 7d8+30 necrotic damage (the zombie-raise rider is
// simplified away pending the TG-006 summon subsystem). Removed
// from `_generic_registry.ts`; routed via `case 'fingerOfDeath':`
// in combat.ts and a planner branch in planner.ts. Mirrors the
// Catapult bespoke pattern (Session 22) but with a flat +30 bonus
// on top of the dice (same pattern as Disintegrate's +40).
//
// Spell module pattern (single-target save with flat bonus — mirrors
// disintegrate.ts but with CON save, 7d8+30 necrotic, 60-ft range,
// L7 slot):
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
  name: 'Finger of Death',
  level: 7,
  school: 'necromancy',
  rangeFt: 60,                  // PHB p.241: 60 ft
  dieCount: 7,
  dieSides: 8,
  flatDamageBonus: 30,          // PHB p.241: +30 necrotic on top of 7d8
  damageType: 'necrotic' as const,
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  fingerOfDeathDamageV1Implemented: true,                            // SPELL_DB had null; v1 implements 7d8+30
  fingerOfDeathZombieRaiseV1Simplified: true,                       // TG-006 summon subsystem not yet built
  fingerOfDeathUpcastV1Implemented: false,                          // +1d8/slot-level NOT modelled
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
 * IS halved on a save — see Disintegrate's halving note for the
 * reasoning; canon is debatable but halving the total is the
 * conservative reading).
 *
 * @param includeFlat  If true (default), add the flat +30 bonus.
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
 * Returns the single best target for Finger of Death (a living enemy
 * within 60 ft), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 60 ft — Finger of
 *      Death's 7d8+30 (avg 61.5) necrotic is the highest single-
 *      target damage of the Session 23 batch (tied with Disintegrate
 *      at avg 75 for the kill-shot role, but FoD's higher floor
 *      makes it better vs high-HP targets).
 *   2. Tie-break: lowest current HP (more likely to drop the target —
 *      and a kill is the goal since the zombie-raise rider would
 *      fire on a kill, though the rider is simplified away in v1).
 *
 * Preconditions:
 *   - Caster has 'Finger of Death' in their actions
 *   - Caster has at least one 7th-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Finger of Death is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Finger of Death')) return null;
  if (!hasSpellSlot(caster, 7)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    candidates.push({ c: e, threat: e.maxHP, curHP: e.currentHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: highest threat first, then lowest current HP (kill-shot bias),
  // then closest.
  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    if (a.curHP !== b.curHP) return a.curHP - b.curHP;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Finger of Death:
 *  1. Consume a 7th-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Roll the target's CON save vs the caster's saveDC.
 *  3. On fail: 7d8+30 necrotic. On success: half (floor) — both dice
 *     AND flat bonus are halved (v1 simplification matching the
 *     Disintegrate half-on-save pattern).
 *  4. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *     Warding Bond redirect).
 *  5. Log the save result + damage.
 *
 * v1 simplifications: zombie-raise-on-kill NOT modelled (TG-006
 * summon subsystem pending); humanoid-only restriction moot;
 * upcast NOT modelled; NOT concentration; flat bonus IS halved on
 * save (conservative reading).
 *
 * @param caster  The casting Combatant (Sorcerer / Warlock / Wizard)
 * @param target  The target Combatant (must be within 60 ft — shouldCast enforces)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Finger of Death');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 7);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Finger of Death at ${target.name}! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides}+${metadata.flatDamageBonus} ${metadata.damageType}, half on save)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'save_success', caster.id,
      `Finger of Death: ${target.name} is already down — negative energy dissipates.`,
      target.id,
    );
    return;
  }

  const save = rollSave(target, 'con', saveDC);
  const fullDmg = rollDamage();
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Finger of Death (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}+${metadata.flatDamageBonus}=${fullDmg}${save.success ? ', halved' : ''})`,
    target.id, save.roll,
  );
  emit(
    state, 'damage', caster.id,
    `Finger of Death: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
    target.id, dealt,
  );

  // v1 simplification: zombie-raise-on-kill is NOT modelled (TG-006
  // summon subsystem pending). The creature just dies normally at 0
  // HP. The flavour "raised as a zombie under your command" is logged
  // only when the damage kills the target — but no zombie is actually
  // added to the battlefield.
  if (target.isDead) {
    emit(
      state, 'death', caster.id,
      `Finger of Death: ${target.name} succumbs to the necrotic energy! (v1: zombie-raise not modelled — TG-006 summon subsystem pending)`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Finger of Death — NO-OP because:
 *   - Finger of Death is instantaneous (no persistent effect in v1 —
 *     the zombie-raise rider is simplified away pending TG-006).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
