// ============================================================
// Thunderwave — PHB p.282
//
// 1st-level evocation, NOT concentration
// Range: Self (15-ft cube emanating from caster)
// Effect: CON save — fail: 2d8 thunder + pushed 10 ft; success: half damage, no push.
//         Audible from 300 ft (flavour; no mechanical effect modelled).
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   metadata → spell stats
//
// Simplifications:
//   - AoE: targets ALL living enemies within 15 ft (not just those in the
//     specific 15-ft cube face chosen by the caster). True directional-cube
//     targeting deferred until a positional AoE system exists.
//   - Allies are excluded from shouldCast targets to avoid friendly fire
//     in AI planning. In real play, allies in range would also be targeted.
//   - Push mechanic: implemented by directly mutating target.pos by 2 grid
//     cells (10 ft) along the displacement vector from caster. Obstacles and
//     grid bounds are not checked (deferred to a physics pass).
//   - AI threshold: cast when ≥2 enemies in 15 ft OR (1 enemy AND slot conserve
//     is not needed). For simplicity, shouldCast returns targets when ≥1 enemy
//     in range; the planner enforces the ≥2 threshold.
// ============================================================

import { Combatant, Battlefield, Vec3 } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamage } from '../engine/utils';
import { chebyshev3D, pushAway } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { filterGoIProtectedTargets } from '../engine/spell_effects';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Thunderwave',
  level: 1,
  school: 'evocation',
  rangeFt: 15,
  aoeSizeFt: 15,       // 15-ft cube
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  thunderwaveUpcastV1Implemented: true,                            // +1d8/slot-level modelled via consumeSpellSlot return
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

// ---- Push helper removed — now uses pushAway() from movement.ts ----

// ---- Planner ------------------------------------------------

/**
 * Returns living enemies within 15 ft, or null when the spell should not be cast.
 *
 * Preconditions:
 *   - Caster has 'Thunderwave' in their actions
 *   - Caster has at least one 1st-level slot available
 *   - At least 1 valid enemy exists within 15 ft
 *
 * Note: Thunderwave is NOT concentration — it can be cast while concentrating on
 * Entangle/Faerie Fire/Bless etc. The planner enforces a ≥2-enemy threshold to
 * justify spending a slot (see planTurn). shouldCast itself returns any non-empty
 * target list so tests can verify the raw gate logic independently.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  // Must have the spell and a free slot
  if (!caster.actions.some(a => a.name === 'Thunderwave')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const targets: Combatant[] = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;   // skip allies (AI simplification)
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 15) continue;

    targets.push(c);
  }

  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Thunderwave:
 *  1. Consume a 1st-level spell slot.
 *  2. For each target: roll CON save vs caster's saveDC (from action, default 13).
 *     - Fail  → full 2d8 thunder damage + push 10 ft (2 grid cells) away from caster.
 *     - Success → half damage, no push.
 *  3. Log every event.
 *
 * @param caster  The casting Combatant (Druid or Wizard)
 * @param targets Candidates from shouldCast (enemies within 15 ft)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Thunderwave');
  const saveDC = action?.saveDC ?? 13;

  const slotLevel = consumeSpellSlot(caster, 1) ?? 1;
  const diceCount = 2 + Math.max(0, slotLevel - 1);

  // Session 77 (RFC-UPCASTING Phase 4 follow-up): exclude targets protected
  // by Globe of Invulnerability from this AoE. PHB p.245: "the spell has no
  // effect on them." The spell still fires (slot already consumed above);
  // protected targets are simply skipped in the damage loop (no damage,
  // no push — Thunderwave's full effect is negated per PHB p.245).
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id, state.battlefield);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Thunderwave at L${slotLevel} (DC ${saveDC} CON, ${diceCount}d8 thunder) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} in range${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
  );

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'con', saveDC);

    // Roll ${diceCount}d8 thunder damage
    let dmgRoll = 0;
    for (let i = 0; i < diceCount; i++) dmgRoll += rollDie(8);
    const dmgFinal = save.success ? Math.floor(dmgRoll / 2) : dmgRoll;

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Thunderwave (rolled ${save.total}) — takes ${dmgFinal} thunder damage${!save.success ? ' and is pushed 10 ft' : ''}`,
      target.id,
      save.roll,
    );

    applyDamage(target, dmgFinal);

    emit(
      state, 'damage', caster.id,
      `${target.name} takes ${dmgFinal} thunder damage from Thunderwave`,
      target.id,
      dmgFinal,
    );

    if (!save.success) {
      // Push 10 ft away from caster (PHB p.283)
      const oldPos: Vec3 = { ...target.pos };
      pushAway(target, caster.pos, 10);
      emit(
        state, 'move', caster.id,
        `${target.name} is pushed 10 ft away from ${caster.name} (${oldPos.x},${oldPos.y}) → (${target.pos.x},${target.pos.y})`,
        target.id,
      );
    }
  }
}
