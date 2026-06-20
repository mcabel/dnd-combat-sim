// ============================================================
// Power Word Kill — PHB p.266
//
// 9th-level enchantment, action, range 60 ft, NO concentration.
// Components: V.
//
// Effect: You utter a word of power that can compel one creature you
//         can see within range to die instantly. If the creature you
//         choose has 100 hit points or fewer, it dies. Otherwise, the
//         spell has no effect.
//
// Upcast: none (9th-level spell — no upcast).
//
// v1 simplifications:
//   - Range: canon 60 ft. v1 uses chebyshev3D * 5 for the distance
//     check (square approximation of euclidean range).
//   - Single-target (PHB p.266: "one creature you can see"). The
//     SPELL_DB entry has attackType:null and damage:null (a Session
//     19 bulk-data gap — Power Word Kill has no save/attack and no
//     damage roll, but it DOES have a mechanical effect: instakill
//     if HP ≤ 100). v1 implements the REAL instakill effect.
//     Documented via `powerWordKillEffectV1Implemented: true`.
//   - HP threshold (PHB p.266: "100 hit points or fewer"): v1 uses
//     `currentHP <= 100` as the gate. The spell DOES NOT fire if the
//     target's currentHP > 100 (the caster wastes the slot only if
//     they misclick — shouldCast prevents this by only returning a
//     target with currentHP ≤ 100). Documented via
//     `powerWordKillThreshold100Hp: true`.
//   - No save, no attack roll (PHB p.266: no save, no attack — the
//     creature simply dies if HP ≤ 100). This is the FIRST spell in
//     v1 with NO save and NO attack roll — the effect is purely an
//     HP check. Documented via `powerWordKillNoSaveNoAttack: true`.
//   - Death-state: v1 sets currentHP=0, isDead=true (monsters) or
//     isUnconscious=true (players — PHB p.266 says "dies" but v1
//     models player death as unconscious+death-saves; the engine's
//     applyDamage function handles this distinction. Power Word Kill
//     bypasses applyDamage and sets the flags directly, but mirrors
//     applyDamage's death path for consistency). Documented via
//     `powerWordKillDeathStateMirrorsApplyDamage: true`.
//     NOTE: PHB p.266 says the creature "dies" — for monsters, this
//     is unambiguous (isDead=true). For PCs, "dies" in 5e means
//     instant death (no death saves). v1 simplification: PCs go to
//     0 HP + unconscious (death saves apply) rather than instant
//     death, because v1's death-save subsystem is the only death
//     path for PCs and bypassing it would be inconsistent. This is
//     a conservative reading — the canon "instant death" for PCs
//     could be modelled by setting isDead=true directly. Documented
//     via `powerWordKillPcInstantDeathV1Simplified: true`.
//   - Construct/undead immunity (PHB p.266: no immunity clause —
//     PWK affects all creature types if HP ≤ 100): NOT applicable —
//     PWK has no creature-type restrictions in canon.
//   - NOT a concentration spell (PHB p.266: instantaneous).
//
// Migration note (Session 23): This spell was BULK-IMPLEMENTED in
// Session 19 as a forward-compat flag (no mechanical effect).
// Session 23 migrated it to a bespoke implementation with the REAL
// HP-check instakill effect (no save, no attack — pure HP gate).
// Removed from `_generic_registry.ts`; routed via
// `case 'powerWordKill':` in combat.ts and a planner branch in
// planner.ts. This is the FIRST spell in v1 with NO save and NO
// attack roll — a new pattern (HP-check instakill). Mirrors the
// Catapult pattern's shape (shouldCast → Combatant | null,
// execute → void) but the execute body sets HP=0 + isDead instead
// of rolling a save.
//
// Spell module pattern (HP-check instakill — new pattern, no save,
// no attack):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Power Word Kill',
  level: 9,
  school: 'enchantment',
  rangeFt: 60,                  // PHB p.266: 60 ft
  hpThreshold: 100,             // PHB p.266: 100 hit points or fewer
  concentration: false,
  saveAbility: null,            // PHB p.266: NO save
  castingTime: 'action',
  powerWordKillEffectV1Implemented: true,                            // SPELL_DB had null; v1 implements instakill
  powerWordKillThreshold100Hp: true,                                // PHB p.266: HP ≤ 100 gate
  powerWordKillNoSaveNoAttack: true,                                // FIRST spell in v1 with no save AND no attack
  powerWordKillDeathStateMirrorsApplyDamage: true,                  // sets isDead/isUnconscious like applyDamage
  powerWordKillPcInstantDeathV1Simplified: true,                    // PCs go to 0+unconscious (death saves) rather than instant death
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
 * Returns the single best target for Power Word Kill (a living enemy
 * within 60 ft whose currentHP ≤ 100), or null when the spell should
 * not be cast.
 *
 * Target priority:
 *   1. Highest-current-HP enemy within 60 ft whose currentHP ≤ 100 —
 *      Power Word Kill's instakill is best spent on the highest-HP
 *      target that's still under the 100-HP threshold (maximising the
 *      damage value of the kill). Wasting a 9th-level slot on a 5-HP
 *      goblin is poor play; the planner prefers the 95-HP ogre.
 *   2. Tie-break: highest maxHP (more "value" from the kill — a 95-HP
 *      ogre with maxHP 95 is a better kill than a 95-HP ogre with
 *      maxHP 200 who's just lightly wounded).
 *
 * Preconditions:
 *   - Caster has 'Power Word Kill' in their actions
 *   - Caster has at least one 9th-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft with currentHP ≤ 100
 *
 * Note: Power Word Kill is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 *
 * Note: This is the FIRST spell in v1 whose shouldCast gates on the
 * target's CURRENT HP (not just range/line-of-sight). The planner
 * branch reads `e.currentHP` directly — this is observable in v1
 * because all combatants' currentHP is public (the engine doesn't
 * model hidden HP). A more realistic AI would require a perception
 * check to estimate HP, but v1's planner always has full info.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Power Word Kill')) return null;
  if (!hasSpellSlot(caster, 9)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; curHP: number; maxHP: number; dist: number }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    // HP gate: only target enemies with currentHP ≤ 100 (PHB p.266).
    if (e.currentHP > metadata.hpThreshold) continue;
    candidates.push({ c: e, curHP: e.currentHP, maxHP: e.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: highest current HP first (maximise the kill value — don't
  // waste a 9th-level slot on a 5-HP goblin when a 95-HP ogre is
  // available), then highest maxHP (more value from the kill), then
  // closest.
  candidates.sort((a, b) => {
    if (a.curHP !== b.curHP) return b.curHP - a.curHP;
    if (a.maxHP !== b.maxHP) return b.maxHP - a.maxHP;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Power Word Kill:
 *  1. Consume a 9th-level spell slot (no upcast — PWK is 9th-level only).
 *  2. Re-check the HP gate (the target may have been healed above 100
 *     between planTurn and executePlannedAction — if so, log "no effect"
 *     and return without consuming... wait, the slot IS consumed per
 *     PHB p.266: "You utter a word of power" — the slot is spent
 *     regardless of whether the target dies. v1 consumes the slot
 *     unconditionally, then checks HP).
 *  3. If target.currentHP ≤ 100: set currentHP=0, apply the death
 *     state (monsters: isDead=true; PCs: isUnconscious=true + death
 *     saves). Log the death.
 *  4. If target.currentHP > 100: log "no effect" (the spell fails
 *     silently — the slot is still consumed).
 *
 * v1 simplifications: no save, no attack roll (pure HP check); PCs
 * go to 0+unconscious (death saves) rather than instant death;
 * monsters die instantly (isDead=true); NOT concentration.
 *
 * @param caster  The casting Combatant (Bard / Sorcerer / Warlock / Wizard)
 * @param target  The target Combatant (must be within 60 ft with currentHP ≤ 100 —
 *                shouldCast enforces this at plan time, but execute re-checks)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Power Word Kill');
  const saveDC = action?.saveDC ?? 13;  // unused — PWK has no save, but kept for log consistency

  // The slot is consumed UNCONDITIONALLY (PHB p.266: "You utter a
  // word of power" — the slot is spent whether or not the target dies).
  consumeSpellSlot(caster, 9);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Power Word Kill at ${target.name}! (no save, no attack — instakill if HP ≤ ${metadata.hpThreshold})`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'action', caster.id,
      `Power Word Kill: ${target.name} is already down — the word of power echoes harmlessly.`,
      target.id,
    );
    return;
  }

  // Re-check the HP gate (the target may have been healed between
  // planTurn and executePlannedAction).
  if (target.currentHP > metadata.hpThreshold) {
    emit(
      state, 'action', caster.id,
      `Power Word Kill: ${target.name} has ${target.currentHP} HP (> ${metadata.hpThreshold}) — the spell has NO EFFECT! (slot still consumed)`,
      target.id,
    );
    return;
  }

  // Instakill: set HP to 0 and apply the death state.
  // Mirrors applyDamage's death path (utils.ts:397-408) but bypasses
  // the damage roll (PWK has no damage — it just sets HP to 0).
  const killedHP = target.currentHP;
  target.currentHP = 0;

  if (target.isPlayer) {
    // v1 simplification: PCs go to 0+unconscious (death saves) rather
    // than instant death. Canon PHB p.266 says the creature "dies" —
    // for PCs, "dies" in 5e means instant death (no death saves).
    // v1 uses the unconscious path for consistency with the death-
    // save subsystem. See metadata.powerWordKillPcInstantDeathV1Simplified.
    target.isUnconscious = true;
    target.conditions.add('unconscious' as Condition);
    target.conditions.add('incapacitated' as Condition);
    emit(
      state, 'unconscious', caster.id,
      `Power Word Kill: ${target.name} drops to 0 HP and falls UNCONSCIOUS! (v1: PC instant-death simplified to unconscious+death-saves) — was ${killedHP} HP`,
      target.id, 0,
    );
  } else {
    // Monsters die instantly (isDead=true) — matches applyDamage's
    // monster death path.
    target.isDead = true;
    target.isUnconscious = true;
    target.conditions.add('unconscious' as Condition);
    target.conditions.add('incapacitated' as Condition);
    emit(
      state, 'death', caster.id,
      `Power Word Kill: ${target.name} DIES INSTANTLY! (was ${killedHP} HP ≤ ${metadata.hpThreshold} threshold — no save, no attack roll)`,
      target.id, 0,
    );
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Power Word Kill — NO-OP because:
 *   - Power Word Kill is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
