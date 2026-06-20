// ============================================================
// False Life — PHB p.239
//
// 1st-level necromancy, action, NO concentration
// Range: Self   Components: V, S, M (a small amount of alcohol or
//   distilled spirits)
// Duration: 1 hour
//
// Canon effect: Bolstering yourself with a necromantic facsimile of
//   life, you gain 1d4 + 4 temporary hit points for the duration.
//
// Upcast: +5 temp HP per slot level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - Grants 1d4 + 4 temp HP (canon).
//   - Temp HP doesn't stack (PHB p.198): caster.tempHP = Math.max(
//     caster.tempHP, rollDie(4) + 4).
//   - 1-hour duration NOT tracked — temp HP persists until consumed.
//   - Upcast NOT modelled.
//
// Spell module pattern (self-buff temp HP):
//   shouldCast(caster, bf) → boolean
//   execute(caster, state) → void
//   metadata → spell stats
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie } from '../engine/utils';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'False Life',
  level: 1,
  school: 'necromancy',
  rangeFt: 0,
  tempHPDie: 4,
  tempHPDieCount: 1,
  tempHPBonus: 4,
  concentration: false,
  castingTime: 'action',
  falseLifeCanonV1Implemented: true,
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
 * Returns true if the caster should cast False Life this turn.
 *
 * Preconditions:
 *   1. Caster has 'False Life' in their actions.
 *   2. Caster has at least one 1st-level-or-higher spell slot.
 *   3. Caster is NOT already False-Life-active (re-cast would be wasted
 *      since temp HP doesn't stack — only the higher of old/new is kept
 *      and 1d4+4 has a max of 8, less than what a 1st-level slot should
 *      yield against existing temp HP from a stronger source).
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'False Life')) return false;
  if (!hasSpellSlot(caster, 1)) return false;
  if (caster._genericSpellActiveSpells?.has('False Life')) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute False Life:
 *  1. Consume a 1st-level spell slot.
 *  2. Set caster._genericSpellActiveSpells marker (so shouldCast gates
 *     re-cast while the buff is active).
 *  3. Roll 1d4 + 4 → set caster.tempHP = Math.max(caster.tempHP, roll).
 *     (Temp HP doesn't stack — PHB p.198.)
 *  4. Log: spell cast + condition_add (buff marker).
 *
 * @param caster  The casting Combatant (Sorcerer / Wizard / Warlock)
 * @param state   Current EngineState (for logging)
 */
export function execute(
  caster: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 1);

  if (!caster._genericSpellActiveSpells) {
    caster._genericSpellActiveSpells = new Set<string>();
  }
  caster._genericSpellActiveSpells.add('False Life');

  let roll = metadata.tempHPBonus;
  for (let i = 0; i < metadata.tempHPDieCount; i++) {
    roll += rollDie(metadata.tempHPDie);
  }

  const prevTempHP = caster.tempHP;
  caster.tempHP = Math.max(caster.tempHP, roll);
  const gained = caster.tempHP - prevTempHP;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts False Life! (1d4+4 = ${roll} temp HP${gained < roll ? ` — only +${gained} (did not stack with existing ${prevTempHP})` : ''})`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} gains necromantic vitality (+${gained} temp HP, now ${caster.tempHP}).`,
    caster.id, gained,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — temp HP persists until consumed (canon 1 hr >> combat).
  // The activeSpells marker persists for combat duration.
}
