// ============================================================
// Power Word Pain — XGE p.163
//
// 7th-level enchantment, action, range 60 ft, NO concentration.
// Components: V.
//
// Effect: You speak a word of power that causes one creature you can
//         see within range to suffer wracking pain. The target must
//         have 60 hit points or fewer. On a failed... [the target]
//         is slowed and takes 4d8 psychic damage.
//         (XGE p.163 — simplified per plan.)
//
// Upcast: none (7th-level spell — no upcast).
//
// v1 simplifications:
//   - Range: canon 60 ft. v1 uses chebyshev3D * 5 (square approx).
//   - HP threshold (XGE p.163: "60 hit points or fewer"): v1 uses
//     `currentHP ≤ 60` as the gate. shouldCast only returns targets
//     with currentHP ≤ 60. Documented via `powerWordPainThreshold60Hp`.
//   - No save, no attack roll (XGE p.163: no save, no attack — the
//     effect fires purely on the HP gate). Mirrors Power Word Kill/Stun's
//     pure-HP-gate pattern. Documented via `powerWordPainNoSaveNoAttack`.
//   - "Slowed" condition (XGE p.163): v1 has no `slowed` condition_apply
//     type — slowed is simplified to `restrained` (the closest disabling
//     condition available in v1's engine: speed 0, attacks have adv vs
//     target, target's attacks have disadv). Documented via
//     `powerWordPainSlowedSimplifiedToRestrained`.
//   - DoT: canon deals 4d8 psychic per turn while slowed. v1 simplifies
//     to ONE-SHOT 4d8 psychic on the cast. Documented via
//     `powerWordPainDotV1Simplified`.
//   - NOT a concentration spell (XGE p.163: instantaneous — the slow is
//     a non-concentration effect). The restrained persists for the v1
//     combat duration (no end-of-turn expiry hook).
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke HP-gate + damage + condition. Removed
// from `_generic_registry.ts`; routed via `case 'powerWordPain':` in
// combat.ts and a planner branch in planner.ts. Mirrors Power Word Kill
// (HP-gate) + applies 4d8 psychic damage + restrained (slowed simplified).
//
// Spell module pattern (HP-gate + damage + condition — no save/attack):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous; restrained persists via condition_apply)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Power Word Pain',
  level: 7,
  school: 'enchantment',
  rangeFt: 60,                   // XGE p.163: 60 ft
  hpThreshold: 60,               // XGE p.163: 60 hit points or fewer
  dieCount: 4,
  dieSides: 8,
  damageType: 'psychic' as const,
  concentration: false,
  saveAbility: null,             // XGE p.163: NO save
  castingTime: 'action',
  powerWordPainThreshold60Hp: true,                        // XGE p.163: HP ≤ 60 gate
  powerWordPainNoSaveNoAttack: true,                       // no save AND no attack
  powerWordPainSlowedSimplifiedToRestrained: true,         // no `slowed` condition; uses restrained
  powerWordPainDotV1Simplified: true,                      // one-shot 4d8 (canon per-turn DoT simplified)
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
 * Returns the single best target for Power Word Pain (a living enemy
 * within 60 ft whose currentHP ≤ 60), or null when the spell should
 * not be cast.
 *
 * Target priority:
 *   1. Highest-current-HP enemy within 60 ft whose currentHP ≤ 60 —
 *      maximising the disable value (a 55-HP threat is a better target
 *      than a 10-HP minion).
 *   2. Tie-break: highest maxHP, then closest.
 *
 * Preconditions:
 *   - Caster has 'Power Word Pain' in their actions
 *   - Caster has at least one 7th-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft with currentHP ≤ 60
 *
 * Note: Power Word Pain is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Power Word Pain')) return null;
  if (!hasSpellSlot(caster, 7)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; curHP: number; maxHP: number; dist: number }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    if (e.currentHP > metadata.hpThreshold) continue;
    if (e.conditions.has('restrained')) continue;
    candidates.push({ c: e, curHP: e.currentHP, maxHP: e.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.curHP !== b.curHP) return b.curHP - a.curHP;
    if (a.maxHP !== b.maxHP) return b.maxHP - a.maxHP;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Power Word Pain:
 *  1. Consume a 7th-level spell slot (no upcast — 7th-level only).
 *  2. Re-check the HP gate (target may have been healed above 60 between
 *     planTurn and executePlannedAction — if so, log "no effect" and
 *     return; slot still consumed).
 *  3. If currentHP ≤ 60: deal 4d8 psychic + apply restrained (slowed
 *     simplified). NOT concentration.
 *
 * @param caster  The casting Combatant (Sorcerer / Warlock / Wizard)
 * @param target  The target Combatant (within 60 ft, currentHP ≤ 60)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 7);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Power Word Pain at ${target.name}! (no save, no attack — 4d8 ${metadata.damageType} + restrained if HP ≤ ${metadata.hpThreshold})`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'action', caster.id,
      `Power Word Pain: ${target.name} is already down — the word of power echoes harmlessly.`,
      target.id,
    );
    return;
  }

  if (target.currentHP > metadata.hpThreshold) {
    emit(
      state, 'action', caster.id,
      `Power Word Pain: ${target.name} has ${target.currentHP} HP (> ${metadata.hpThreshold}) — the spell has NO EFFECT! (slot still consumed)`,
      target.id,
    );
    return;
  }

  // Deal 4d8 psychic + apply restrained (slowed simplified).
  const dmg = rollDamage();
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
  emit(
    state, 'damage', caster.id,
    `Power Word Pain: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg})`,
    target.id, dealt,
  );

  if (!target.conditions.has('restrained')) {
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Power Word Pain',
      effectType: 'condition_apply',
      payload: { condition: 'restrained' },
      sourceIsConcentration: false,
    });
    emit(
      state, 'condition_add', caster.id,
      `${target.name} is RESTRAINED (slowed simplified)! (speed 0, disadv on attacks/DEX, adv on attacks vs them)`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous cast; restrained persists via condition_apply.
}
