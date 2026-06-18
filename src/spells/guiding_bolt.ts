// ============================================================
// Guiding Bolt — PHB p.248
// 1st-level evocation, action, NOT concentration
// Range: 120 ft
// Effect: Ranged spell attack.
//   On a hit:
//     - 4d6 radiant damage (crit = 8d6)
//     - The next attack roll made against the target before the
//       end of the caster's next turn has advantage.
//
// Advantage mark lifecycle:
//   Applied:    on hit, via 'advantage_vs' ActiveEffect (permanent)
//   Consumed:   on the first attack roll made against the target
//               (handled in resolveAttack in combat.ts)
//   Fallback:   removed at start of caster's next turn
//               (cleanupMarks called from combat.ts turn loop)
//
// Upcast: +1d6 radiant per slot level above 1st (not modelled — lv1 only).
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, target, bf) → boolean
//   execute(caster, target, state) → void
//   cleanupMarks(caster, bf) → void      (fallback expiry)
//   consumeMark(target) → boolean         (consume on first attack)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import {
  rollAttack, rollDamage, applyDamageWithTempHP,
  resolveAttackAdvantage, attackHits,
} from '../engine/utils';
import { applySpellEffect, getActiveAcBonus } from '../engine/spell_effects';
import { removeBySource } from '../engine/adv_system';
import { distanceFt } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Guiding Bolt',
  level: 1,
  school: 'evocation',
  rangeFt: 120,
  damageCount: 4,
  damageDie: 6,
  damageType: 'radiant' as const,
  concentration: false,
  castingTime: 'action',
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

// ---- shouldCast ---------------------------------------------

/**
 * Returns true when Guiding Bolt should be cast this turn.
 *
 * Conditions:
 *   1. Caster has 'Guiding Bolt' in their actions
 *   2. Caster has at least one 1st-level spell slot
 *   3. Target is within 120 ft
 *   4. Target is alive and not unconscious
 *   5. Target is not already marked by this caster (avoid slot waste)
 */
export function shouldCast(
  caster: Combatant,
  target: Combatant,
  _bf: Battlefield,
): boolean {
  if (!caster.actions.some(a => a.name === 'Guiding Bolt')) return false;
  if (!hasSpellSlot(caster, 1)) return false;
  if (target.isDead || target.isUnconscious) return false;
  if (distanceFt(caster.pos, target.pos) > 120) return false;

  // Already marked by this caster — don't waste another slot
  const alreadyMarked = target.activeEffects.some(
    e => e.spellName === 'Guiding Bolt' && e.casterId === caster.id,
  );
  if (alreadyMarked) return false;

  return true;
}

// ---- execute ------------------------------------------------

/**
 * Cast Guiding Bolt at target.
 *   1. Consume a 1st-level spell slot.
 *   2. Make a ranged spell attack (hitBonus from caster's action).
 *   3. On hit: deal 4d6 (or 8d6 on crit) radiant damage.
 *   4. On hit: apply 'advantage_vs' mark — the next attack against
 *              the target before end of caster's next turn has advantage.
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Guiding Bolt');
  const hitBonus = action?.hitBonus ?? 0;
  const bf = state.battlefield;

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Guiding Bolt at ${target.name}!`,
    target.id,
  );

  // Advantage state for the caster's attack roll (e.g. prone target, invisible, etc.)
  const advState = resolveAttackAdvantage(caster, target, 'ranged');

  const result = rollAttack(hitBonus, advState.advantage, advState.disadvantage);

  // Effective AC: include AC bonus effects (Shield of Faith, etc.)
  const effectiveAC = target.ac + (target.wardingBond ? 1 : 0) + getActiveAcBonus(target);
  const hits = attackHits(result.roll, result.total, effectiveAC);

  if (!hits) {
    emit(
      state, 'attack_miss', caster.id,
      `${caster.name} misses ${target.name} with Guiding Bolt `
      + `(rolled ${result.roll}+${hitBonus}=${result.total} vs AC ${effectiveAC})`,
      target.id, result.roll,
    );
    return;
  }

  const isCrit = result.isCrit;
  emit(
    state, isCrit ? 'attack_crit' : 'attack_hit', caster.id,
    `${caster.name} ${isCrit ? 'CRITS' : 'hits'} ${target.name} with Guiding Bolt `
    + `(${result.total} vs AC ${effectiveAC})`,
    target.id, result.roll,
  );

  // Damage: 4d6 radiant (8d6 on crit)
  const dmgExpr = {
    count: metadata.damageCount,
    sides: metadata.damageDie,
    bonus: 0,
    average: 14,
  };
  const dmg = rollDamage(dmgExpr, isCrit);
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state, 'damage', caster.id,
    `Guiding Bolt: ${dealt} radiant damage to ${target.name}${isCrit ? ' (CRIT)' : ''}`,
    target.id, dealt,
  );

  if (dealt > 0) state.rageDamagedSinceLastTurn.add(target.id);

  // Track faction damage for 10-round no-damage rule
  if (dealt > 0) {
    const prev = state.damageThisRound.get(caster.faction) ?? 0;
    state.damageThisRound.set(caster.faction, prev + dealt);
  }

  // Apply advantage mark: next attack roll against this target has advantage (PHB p.248).
  // Consumed by the first attack made against the target (handled in combat.ts resolveAttack).
  // Falls back to expiry at start of caster's next turn via cleanupMarks.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Guiding Bolt',
    effectType: 'advantage_vs',
    payload: {
      advType: 'advantage',
      advScope: 'attack',
    },
    sourceIsConcentration: false,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is illuminated by Guiding Bolt — the next attack against them has advantage!`,
    target.id,
  );
}

// ---- consumeMark --------------------------------------------

/**
 * Consume the Guiding Bolt advantage mark on `target` (any caster).
 * Called from resolveAttack in combat.ts when any attack is made against the target.
 * Returns true if a mark was present and consumed, false otherwise.
 *
 * Removes ONLY the oldest/first mark found (one attack consumes one mark).
 */
export function consumeMark(target: Combatant): boolean {
  const idx = target.activeEffects.findIndex(
    e => e.spellName === 'Guiding Bolt' && e.effectType === 'advantage_vs',
  );
  if (idx === -1) return false;

  const effect = target.activeEffects[idx];
  removeBySource(target, 'Guiding Bolt');
  target.activeEffects.splice(idx, 1);
  return true;
}

// ---- cleanupMarks -------------------------------------------

/**
 * Remove all Guiding Bolt advantage marks placed by `caster` across the battlefield.
 * Called at the start of the caster's next turn as a fallback expiry.
 * (Primary expiry: consumeMark in resolveAttack.)
 */
export function cleanupMarks(caster: Combatant, bf: Battlefield): void {
  for (const target of bf.combatants.values()) {
    const hasGBMark = target.activeEffects.some(
      e => e.spellName === 'Guiding Bolt' && e.casterId === caster.id && e.effectType === 'advantage_vs',
    );
    if (!hasGBMark) continue;

    removeBySource(target, 'Guiding Bolt');
    target.activeEffects = target.activeEffects.filter(
      e => !(e.spellName === 'Guiding Bolt' && e.casterId === caster.id),
    );
  }
}
