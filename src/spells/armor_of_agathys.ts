// ============================================================
// Armor of Agathys — PHB p.215
//
// 1st-level abjuration, action, NO concentration
// Range: Self   Components: V, S, M (a cup of water)
// Duration: 1 hour
//
// Canon effect: A protective magical force surrounds you, manifesting
//   as a spectral frost that covers you and your gear. You gain 5
//   temporary hit points for the duration. If a creature hits you
//   with a melee attack while you have these hit points, the creature
//   takes 5 cold damage.
//
// Upcast: +5 temp HP AND +5 cold damage per slot level above 1st
//   (not modelled in v1).
//
// v1 simplifications:
//   - Grants 5 temp HP (canon) — applies the standard "temp HP doesn't
//     stack" rule: target.tempHP = Math.max(target.tempHP, 5).
//   - Retaliation cold damage NOT modelled (no on-attacked hook in v1).
//     Flag: armorOfAgathysRetaliationV1NotModelled
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
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Armor of Agathys',
  level: 1,
  school: 'abjuration',
  rangeFt: 0,
  tempHP: 5,
  retaliationDamage: 5,
  retaliationType: 'cold',
  concentration: false,
  castingTime: 'action',
  armorOfAgathysRetaliationV1NotModelled: true,
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
 * Returns true if the caster should cast Armor of Agathys this turn.
 *
 * Preconditions:
 *   1. Caster has 'Armor of Agathys' in their actions.
 *   2. Caster has at least one 1st-level-or-higher spell slot.
 *   3. Caster does NOT already have temp HP from this spell
 *      (re-cast would be wasted in v1 since retaliation isn't modelled
 *      and temp HP doesn't stack — only the higher of old/new is kept).
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Armor of Agathys')) return false;
  if (!hasSpellSlot(caster, 1)) return false;
  if (caster._genericSpellActiveSpells?.has('Armor of Agathys')) return false;
  return true;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Armor of Agathys:
 *  1. Consume a 1st-level spell slot.
 *  2. Set caster._genericSpellActiveSpells marker (so shouldCast gates
 *     re-cast while the buff is active).
 *  3. Set caster.tempHP = Math.max(caster.tempHP, 5) — temp HP doesn't
 *     stack (PHB p.198).
 *  4. Log: spell cast + condition_add (buff marker).
 *
 * @param caster  The casting Combatant (Warlock)
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
  caster._genericSpellActiveSpells.add('Armor of Agathys');

  const prevTempHP = caster.tempHP;
  caster.tempHP = Math.max(caster.tempHP, metadata.tempHP);
  const gained = caster.tempHP - prevTempHP;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Armor of Agathys! (+${metadata.tempHP} temp HP${gained < metadata.tempHP ? ` — only +${gained} (did not stack with existing ${prevTempHP})` : ''}; retaliation NOT modelled in v1)`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} gains spectral frost armor (+${gained} temp HP, now ${caster.tempHP}).`,
    caster.id, gained,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — temp HP persists until consumed (canon 1 hr >> combat).
  // The activeSpells marker persists for combat duration.
}
