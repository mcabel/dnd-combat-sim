// ============================================================
// Spellfire Flare — SCAG p.149 (Sword Coast Adventurer's Guide)
//
// 1st-level evocation, action, range 60 ft, NO concentration.
// Components: V, S.
//
// Effect: You hurl a sphere of spellfire at a creature within range.
//         Make a ranged spell attack... NO — Spellfire Flare is an
//         AUTO-HIT spell: the target takes 2d10 fire damage + your
//         spellcasting ability modifier, with no attack roll and no
//         saving throw. (SCAG p.149: "The target takes 2d10 fire
//         damage, plus an extra 1d10 per slot level above 1st, and
//         takes an additional amount of fire damage equal to your
//         spellcasting ability modifier.")
//
// Upcast: +1d10 fire per slot level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Auto-hit: SCAG p.149 has NO attack roll and NO save — the
//     target always takes the damage. v1 mirrors this exactly (the
//     FIRST auto-hit SINGLE-TARGET damage spell — Magic Missile is
//     multi-dart auto-hit; Spellfire Flare is one big auto-hit blast).
//     Documented via `spellfireFlareAutoHitV1Implemented: true`.
//   - Spellcasting ability modifier: v1 has no generic "primary
//     spellcasting ability" field on Combatant. v1 falls back to
//     abilityMod(caster.cha) (Sorcerer primary — Spellfire Flare is a
//     Sorcerer-associated spell, SCAG p.149). If the action's hitBonus
//     is populated (some parsers store the spellcasting mod there for
//     spell attacks), v1 prefers that. Documented via
//     `spellfireFlareSpellcastingModFromCha: true`.
//   - Upcast: +1d10/slot-level NOT modelled — v1 always rolls 2d10+mod.
//     Forward-compat TODO via `spellfireFlareUpcastV1Implemented: false`.
//   - NOT a concentration spell (SCAG p.149: instantaneous).
//
// Migration note (Session 24): This spell was BULK-IMPLEMENTED in
// Session 20 as a forward-compat flag (no mechanical effect). Session
// 24 migrated it to a bespoke implementation with REAL auto-hit 2d10+mod
// fire damage. Removed from `_generic_registry.ts`; routed via
// `case 'spellfireFlare':` in combat.ts and a planner branch in
// planner.ts. Mirrors the Catapult bespoke pattern (Session 21) for
// the single-target shape (shouldCast → Combatant | null,
// execute → (caster, target, state)), but the execute body skips the
// save/attack entirely (like Magic Missile) — it just applies damage.
//
// Spell module pattern (single-target auto-hit damage — mirrors
// catapult.ts shape, magic_missile.ts damage application):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP, abilityMod } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Spellfire Flare',
  level: 1,
  school: 'evocation',
  rangeFt: 60,                   // SCAG p.149: 60 ft
  dieCount: 2,
  dieSides: 10,
  damageType: 'fire' as const,
  concentration: false,
  castingTime: 'action',
  spellfireFlareAutoHitV1Implemented: true,                          // auto-hit (no save, no attack)
  spellfireFlareSpellcastingModFromCha: true,                        // +spellcasting mod = CHA (Sorcerer)
  spellfireFlareUpcastV1Implemented: false,                          // +1d10/slot-level NOT modelled
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
 * Roll `metadata.dieCount`d`metadata.dieSides` and return the total.
 * (No crit — Spellfire Flare is auto-hit, so there's no attack roll to
 * crit on. The `includeMod` parameter adds the spellcasting modifier,
 * matching SCAG p.149's "plus your spellcasting ability modifier".)
 */
export function rollDamage(includeMod = true, spellcastingMod = 0): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  if (includeMod) total += spellcastingMod;
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Spellfire Flare (a living enemy
 * within 60 ft), or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 60 ft — Spellfire
 *      Flare's 2d10+mod (avg 11+mod) auto-hit fire damage is a
 *      guaranteed chunk, best spent against a high-HP target.
 *   2. Tie-break: lowest current HP (more likely to drop the target —
 *      since the damage is guaranteed, the kill-shot bias is strong).
 *
 * Preconditions:
 *   - Caster has 'Spellfire Flare' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - At least 1 valid enemy target exists within 60 ft
 *
 * Note: Spellfire Flare is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Spellfire Flare')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];

  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    candidates.push({ c: e, threat: e.maxHP, curHP: e.currentHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: highest threat first, then lowest current HP (kill-shot bias —
  // auto-hit makes the kill-shot reliable), then closest.
  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    if (a.curHP !== b.curHP) return a.curHP - b.curHP;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Spellfire Flare:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. NO attack roll, NO saving throw (SCAG p.149: auto-hit).
 *  3. Roll 2d10 fire + spellcasting ability modifier.
 *  4. Apply via applyDamageWithTempHP (handles resistances / temp HP /
 *     Warding Bond redirect).
 *  5. Log the auto-hit + damage.
 *
 * v1 simplifications: auto-hit (no save, no attack); +spellcasting mod
 * = CHA (Sorcerer); upcast NOT modelled; NOT concentration.
 *
 * @param caster  The casting Combatant (Sorcerer — SCAG p.149)
 * @param target  The target Combatant (must be within 60 ft — shouldCast enforces)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  // Spellcasting ability modifier: v1 has no generic field, so fall back
  // to CHA (Sorcerer — Spellfire Flare's primary class, SCAG p.149).
  const spellcastingMod = abilityMod(caster.cha);

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Spellfire Flare at ${target.name}! (AUTO-HIT — no save, no attack; ${metadata.dieCount}d${metadata.dieSides}+${spellcastingMod} ${metadata.damageType})`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(
      state, 'action', caster.id,
      `Spellfire Flare: ${target.name} is already down — the flare dissipates.`,
      target.id,
    );
    return;
  }

  // Auto-hit: roll 2d10 + spellcasting mod fire damage.
  const dmg = rollDamage(true, spellcastingMod);
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
  emit(
    state, 'damage', caster.id,
    `Spellfire Flare: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}+${spellcastingMod}=${dmg}, auto-hit)`,
    target.id, dealt,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Spellfire Flare — NO-OP because:
 *   - Spellfire Flare is instantaneous (no persistent effect).
 *   - No concentration, no scratch field, no damage_zone sentinel.
 */
export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell, nothing to clean up.
}
