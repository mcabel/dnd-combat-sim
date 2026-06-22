// ============================================================
// Arms of Hadar — PHB p.215
//
// 1st-level conjuration, NOT concentration
// Range: Self (10-ft radius sphere centred on caster)
// Effect: STR save vs caster's saveDC
//   Fail  → 2d6 necrotic damage + can't take reactions until start of next turn
//   Success → half damage, no reaction loss
//
// AoE shape: circle (Euclidean distance ≤ 10 ft from caster centre).
// This is deliberately different from Thunderwave, which is a cube emanating
// from the caster's perimeter.  Here the spell originates at the caster's
// space and radiates outward; the 10-ft radius is measured Euclidean-style
// to produce a true circle rather than the square approximation Chebyshev
// would create (a corner cell 2 squares diagonally = ~14 ft, not 10 ft).
//
// "Lose reaction" mechanic:
//   target.budget.reactionUsed = true  — prevents OA and mounted-redirect
//   reactions until the target's own turn start (resetBudget clears this).
//
// Spell module pattern (session 31 architecture):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   metadata → spell stats
//
// Simplifications:
//   - Allies are excluded from shouldCast targets (AI simplification —
//     in real play allies in the 10-ft radius would also be affected).
//   - AI threshold: ≥2 enemies in range (planner enforces this, shouldCast
//     returns any non-empty list so tests can verify gate logic independently).
//   - Undead and constructs are stated by the PHB to be unaffected.  We do
//     not yet track creature type, so this is deferred.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamage } from '../engine/utils';
import { euclideanDistFt } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Arms of Hadar',
  level: 1,
  school: 'conjuration',
  rangeFt: 0,           // self-centred
  aoeSizeFt: 10,        // 10-ft radius sphere
  aoeShape: 'circle',   // Euclidean, not cube
  concentration: false,
  saveAbility: 'str' as const,
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
 * Returns living enemies within the 10-ft Euclidean radius, or null when the
 * spell should not be cast.
 *
 * Preconditions:
 *   - Caster has 'Arms of Hadar' in their actions
 *   - Caster has at least one spell slot (pact or standard) available
 *   - At least 1 valid enemy exists within 10 ft (Euclidean)
 *
 * Note: Arms of Hadar is NOT concentration — it can be cast while
 * concentrating on Hex or any other concentration spell.
 * The planner enforces a ≥2-enemy threshold to justify spending a slot
 * (see planTurn). shouldCast itself returns any non-empty target list so
 * tests can verify the raw gate logic independently.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Arms of Hadar')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const targets: Combatant[] = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;   // skip allies (AI simplification)
    if (c.isDead || c.isUnconscious) continue;

    // Circle AoE: Euclidean distance, not Chebyshev.
    // A cell 2 squares diagonally away is ~14.1 ft — correctly outside a 10-ft radius.
    if (euclideanDistFt(caster.pos, c.pos) > 10) continue;

    targets.push(c);
  }

  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Arms of Hadar:
 *  1. Consume a 1st-level spell slot (pact slot if Warlock, standard slot otherwise).
 *  2. For each target: roll STR save vs caster's saveDC (from action, default 13).
 *     - Fail  → full 2d6 necrotic + set reactionUsed = true (lose reaction).
 *     - Success → half damage, reaction unaffected.
 *  3. Log every event.
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Arms of Hadar');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 1);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Arms of Hadar (DC ${saveDC} STR) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} in the 10-ft radius!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'str', saveDC);

    // Roll full 2d6 necrotic damage
    const dmgRoll = rollDie(6) + rollDie(6);
    const dmgFinal = save.success ? Math.floor(dmgRoll / 2) : dmgRoll;

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} STR save vs Arms of Hadar (rolled ${save.total})` +
      ` — takes ${dmgFinal} necrotic damage${!save.success ? ' and loses their reaction' : ''}`,
      target.id,
      save.roll,
    );

    applyDamage(target, dmgFinal);

    emit(
      state, 'damage', caster.id,
      `${target.name} takes ${dmgFinal} necrotic damage from Arms of Hadar`,
      target.id,
      dmgFinal,
    );

    if (!save.success) {
      // PHB p.215: "Until the start of your next turn, you can't take reactions."
      // We model this by setting reactionUsed, which resetBudget clears at the
      // start of the target's own turn.
      target.budget.reactionUsed = true;

      emit(
        state, 'condition_add', caster.id,
        `${target.name} can't take reactions until the start of their next turn`,
        target.id,
      );
    }
  }
}
