// ============================================================
// Bane — PHB p.216
//
// 1st-level enchantment, action, range 30 ft, concentration (1 min).
// Components: V, S, M (a drop of blood).
//
// Effect: Up to three creatures of your choice that you can see within
//         range must make Charisma saving throws. Whenever a target that
//         fails this saving throw makes an attack roll or a saving throw
//         before the spell ends, the target must roll a d4 and subtract
//         the number rolled from the attack roll or saving throw.
//
// Upcast: +1 target per slot-level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - v1 implements the canon -1d4 via the new `bane_die` effect (inverse
//     of Bless's `bless_die`). Session 27 Batch 3 — migrated from the
//     generic forward-compat stub to a bespoke CHA-save-or-bane_die.
//   - Upcast (+1 target/slot-level) NOT modelled.
//   - Concentration: canon 1 min. v1 starts concentration; not enforced on
//     damage (TG-002). The bane_die is sourceIsConcentration: true.
//
// Spell module pattern (multi-target save-or-debuff, concentration):
//   shouldCast(caster, bf) → Combatant[] | null   (up to 3 enemies)
//   execute(caster, targets, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Bane',
  level: 1,
  school: 'enchantment',
  rangeFt: 30,
  concentration: true,
  castingTime: 'action',
  maxTargets: 3,
  baneCanonV1Implemented: true,            // Session 27 Batch 3: real -1d4 via bane_die
  baneUpcastV1Implemented: false,
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
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

// ---- Planner ------------------------------------------------

/**
 * Returns up to 3 living enemies within 30 ft (not already baned by this
 * caster), or null when the spell should not be cast.
 * Target priority: highest-threat, then closest.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Bane')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Bane')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates.slice(0, metadata.maxTargets).map(e => e.c);
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Bane');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 1);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Bane');

  const names = targets.map(t => t.name).join(', ');
  emit(state, 'action', caster.id,
    `${caster.name} casts Bane on ${names}! (DC ${saveDC} CHA, -1d4 to attacks/saves on fail)`, caster.id);

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;
    const save = rollSave(target, 'cha', saveDC);
    emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CHA save vs Bane (rolled ${save.total})${save.success ? '' : ' + BANE (-1d4)'}`, target.id, save.roll);

    if (save.success) {
      emit(state, 'action', caster.id, `${target.name} resists Bane — not baned!`, target.id);
      continue;
    }
    applySpellEffect(target, {
      casterId: caster.id, spellName: 'Bane',
      effectType: 'bane_die', payload: { dieSides: 4 },
      sourceIsConcentration: true,
    });
    emit(state, 'condition_add', caster.id,
      `${target.name} is BANED! (-1d4 to attack rolls & saving throws)`, target.id);
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
