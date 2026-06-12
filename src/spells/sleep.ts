// ============================================================
// Sleep — PHB p.276
//
// 1st-level enchantment, NOT concentration
// Range: 90 ft — point within range; 20-ft sphere centred on that point
// Effect: Roll 5d8. Working from lowest to highest current HP, render each
//   creature unconscious (magical sleep) until it takes damage, another
//   creature uses an action to wake it, or 1 minute passes.
//   No attack roll, no saving throw.
//
// HP bucket mechanic:
//   budget = 5d8 (rolled once)
//   Sort living enemies (ascending currentHP).
//   For each: if currentHP ≤ remaining budget → sleep, deduct HP from budget.
//   Once budget is exhausted, remaining creatures are unaffected.
//
// Sleeping creature state:
//   isUnconscious = true
//   conditions: 'sleeping' | 'unconscious' | 'incapacitated'
//   deathSaves NOT set (not dying — just magically asleep)
//
// Wake conditions (PHB p.276 / utils.ts applyDamage):
//   • Any damage → applyDamage clears 'sleeping' before HP resolution
//   • Another creature uses their action to rouse them (NOT implemented in AI)
//   • After 1 minute / spell ends (we do not time Sleep — it lasts the encounter)
//
// Immunities (PHB p.276):
//   • Undead and creatures immune to being charmed are unaffected.
//   • We do not yet track creature type — immunity deferred (noted as a
//     known simplification).
//
// AoE simplification:
//   The PHB places the 20-ft sphere at any point within 90 ft.  AI chooses
//   the point that maximises targets.  We approximate: gather all living
//   enemies within 90 ft of the caster, then apply the HP-bucket filter.
//   At level 1 on small maps this is functionally equivalent.
//
// Spell module pattern (session 31 architecture):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie } from '../engine/utils';
import { distanceFt } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Sleep',
  level: 1,
  school: 'enchantment',
  rangeFt: 90,
  aoeSizeFt: 20,  // 20-ft radius sphere
  aoeShape: 'sphere',
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

// ---- Planner ------------------------------------------------

/**
 * Returns living enemies within 90 ft, or null if the spell should not be cast.
 *
 * Preconditions:
 *   - Caster has 'Sleep' in their actions (Sorcerer / Wizard).
 *   - Caster has at least one 1st-level slot.
 *   - At least one living enemy exists within 90 ft.
 *
 * Sleep is NOT concentration — it can be cast at any time regardless of
 * existing concentration.  The planner enforces a ≥1-viable-target check
 * (planTurn), while shouldCast itself returns any non-empty list so that
 * tests can verify gate logic independently.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Sleep')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const inRange: Combatant[] = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;       // skip allies
    if (c.isDead || c.isUnconscious) continue;        // skip dead / already unconscious

    // 90-ft range check (Chebyshev — standard PHB range for point selection)
    if (distanceFt(caster.pos, c.pos) > 90) continue;

    inRange.push(c);
  }

  return inRange.length >= 1 ? inRange : null;
}

// ---- Execution ----------------------------------------------

/**
 * Roll 5d8 HP budget, then render enemies unconscious starting from the
 * lowest current HP, until the budget is exhausted.
 *
 * 1. Consume a 1st-level slot.
 * 2. Roll 5d8 total HP budget.
 * 3. Sort targets by ascending currentHP.
 * 4. For each (ascending HP): if currentHP ≤ remaining budget → sleep.
 *    Deduct the creature's currentHP from the budget and continue.
 *    If currentHP > remaining budget → unaffected (budget exhausted).
 * 5. Log every outcome.
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],  // living enemies in range (unsorted — we sort internally)
  state: EngineState,
): void {
  consumeSpellSlot(caster, 1);

  // Roll 5d8 for total HP budget
  let budget = rollDie(8) + rollDie(8) + rollDie(8) + rollDie(8) + rollDie(8);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Sleep — rolls 5d8 = ${budget} HP budget` +
    ` (${targets.length} target${targets.length !== 1 ? 's' : ''} in range)`,
  );

  // Sort ascending by current HP — put the weakest to sleep first
  const sorted = [...targets]
    .filter(t => !t.isDead && !t.isUnconscious)  // recheck: state may have changed
    .sort((a, b) => a.currentHP - b.currentHP);

  let slept = 0;

  for (const target of sorted) {
    if (budget <= 0) {
      emit(
        state, 'action', caster.id,
        `${target.name} (${target.currentHP} HP) — budget exhausted, unaffected by Sleep`,
        target.id,
      );
      continue;
    }

    if (target.currentHP <= budget) {
      // Budget covers this creature — put them to sleep
      budget -= target.currentHP;

      target.isUnconscious = true;
      target.conditions.add('sleeping');
      target.conditions.add('unconscious');
      target.conditions.add('incapacitated');

      // Break concentration if the target was concentrating
      if (target.concentration?.active) {
        const spellName = target.concentration.spellName ?? 'spell';
        target.concentration = null;
        emit(
          state, 'condition_remove', target.id,
          `${target.name}'s concentration on ${spellName} breaks as they fall asleep!`,
          target.id,
        );
      }

      emit(
        state, 'condition_add', caster.id,
        `${target.name} (${target.currentHP} HP) falls asleep! (${budget} HP budget remaining)`,
        target.id,
      );

      slept++;
    } else {
      // Creature's HP exceeds remaining budget — unaffected
      emit(
        state, 'action', caster.id,
        `${target.name} (${target.currentHP} HP) — too many HP for remaining budget (${budget}), unaffected`,
        target.id,
      );
      // NOTE: once a creature can't be put to sleep, REMAINING budget still
      // attempts subsequent lower-HP creatures.  PHB is unambiguous: work from
      // lowest to highest, skip creatures that exceed the budget.  We continue.
    }
  }

  emit(
    state, 'action', caster.id,
    `Sleep: ${slept} creature${slept !== 1 ? 's' : ''} rendered unconscious`,
  );
}
