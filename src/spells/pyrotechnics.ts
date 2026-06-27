// ============================================================
// Pyrotechnics — XGE p.162
//
// 2nd-level transmutation, action, range 60 ft, NO concentration (1 min).
// Components: V, S.
//
// Effect: Choose an existing flame you can see within range. The flame
//         either blossoms with a deafening boom OR thick black smoke
//         billows forth.
//   - Fireworks mode: Each creature in a 10-ft-radius sphere centered on
//     the flame makes a CON save or is blinded for the duration.
//   - Smoke mode: A 10-ft-radius sphere of thick smoke heavily obscures
//     the area for the duration (no save — terrain).
//
// Upcast: none (2nd-level spell — no upcast).
//
// v1 simplifications:
//   - Fire-source requirement (XGE p.162: "existing flame you can see"):
//     simplified — assume always available. v1 centers the AoE on the
//     highest-threat enemy within 60 ft (mirrors Sunburst). Documented
//     via `pyrotechnicsFireSourceV1Simplified`.
//   - Shape: canon 10-ft-radius sphere. v1 uses chebyshev (square approx).
//   - Blinded duration: canon 1 min. Tracked via sourceTurnExpires
//     (Session 82, RFC-COMBINING-EFFECTS Phase 2): the blinded
//     condition_apply effect gets appliedTurn + sourceTurnExpires =
//     round + 10, so reevaluateEffects removes it once the 1-min cap
//     elapses (mirroring Blindness/Deafness / Sunburst / Color Spray).
//     NOT concentration (sourceIsConc: false).
//   - Smoke mode (Session 27 canon fix): canon creates a heavily obscured
//     sphere (terrain). v1 has no persistent-terrain/vision subsystem, so
//     smoke mode applies `blinded` to ALL creatures in the sphere (no save)
//     for the combat — PHB p.183: a creature in a heavily obscured area is
//     "effectively blinded". The smoke mode is exposed via `executeSmoke()`;
//     the v1 planner defaults to fireworks (more universally useful). Both
//     modes are tested. Documented via `pyrotechnicsSmokeModeV1Implemented`.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke CON-save-or-blinded AoE (no conc).
// Session 27 canon fix: added the 2nd (smoke) mode per XGE p.162.
// Removed from `_generic_registry.ts`; routed via `case 'pyrotechnics':`
// in combat.ts and a planner branch in planner.ts. Mirrors Sunburst
// (radius AoE save + condition) but blinded + no damage + no conc.
//
// Spell module pattern (radius AoE save + condition, NO concentration):
//   shouldCast(caster, bf) → Combatant[] | null   (shared by both modes)
//   execute(caster, targets, state) → void          (FIREWORKS mode — default)
//   executeSmoke(caster, targets, state) → void     (SMOKE mode — no save, all blinded)
//   cleanup() — no-op (no concentration; blinded persists for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Pyrotechnics',
  level: 2,
  school: 'transmutation',
  rangeFt: 60,                   // XGE p.162: 60 ft
  aoeRadiusFt: 10,               // XGE p.162: 10-ft radius sphere
  concentration: false,
  saveAbility: 'con' as const,
  castingTime: 'action',
  pyrotechnicsFireSourceV1Simplified: true,                 // fire-source assumed available
  pyrotechnicsFireworksModeV1Default: true,                 // planner picks fireworks by default
  pyrotechnicsSmokeModeV1Implemented: true,                 // Session 27: smoke mode available (executeSmoke)
  pyrotechnicsBlindedDurationV1Implemented: true,           // Session 82: 1-min tracked via sourceTurnExpires (both modes)
} as const;

export type PyrotechnicsMode = 'fireworks' | 'smoke';

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

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Pyrotechnics')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    if (e.maxHP > centerThreat || (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e; centerThreat = e.maxHP; centerDist = distFt;
    }
  }
  if (!center) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 10) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  executeFireworks(caster, targets, state);
}

/** FIREWORKS mode — CON save or blinded (default). */
export function executeFireworks(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Pyrotechnics');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  emit(state, 'action', caster.id,
    `${caster.name} casts Pyrotechnics (FIREWORKS)! (DC ${saveDC} CON, blinded on fail, ${metadata.aoeRadiusFt}-ft radius — fire-source assumed) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`);

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;
    const save = rollSaveReactable(state, caster, target, 'con', saveDC);
    emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Pyrotechnics (rolled ${save.total})${save.success ? '' : ' + BLINDED'}`, target.id, save.roll);

    if (!save.success && !target.conditions.has('blinded')) {
      const round = state.battlefield.round;
      applySpellEffect(target, {
        casterId: caster.id, spellName: 'Pyrotechnics',
        effectType: 'condition_apply', payload: { condition: 'blinded' },
        sourceIsConcentration: false,
        appliedTurn: round,
        sourceTurnExpires: round + 10,  // 1 min = 10 rounds (XGE p.162)
      });
      emit(state, 'condition_add', caster.id, `${target.name} is BLINDED by the flash! (disadv on attacks, adv on attacks vs them)`, target.id);
    }
  }
}

/** SMOKE mode — NO save, ALL creatures in sphere blinded (heavily obscured terrain). */
export function executeSmoke(caster: Combatant, targets: Combatant[], state: EngineState): void {
  consumeSpellSlot(caster, 2);

  emit(state, 'action', caster.id,
    `${caster.name} casts Pyrotechnics (SMOKE)! (NO save, ${metadata.aoeRadiusFt}-ft radius heavily obscured — all in sphere blinded; fire-source assumed) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`);

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;
    if (target.conditions.has('blinded')) {
      emit(state, 'condition_add', caster.id, `${target.name} is already blinded — smoke has no additional effect.`, target.id);
      continue;
    }
    const round = state.battlefield.round;
    applySpellEffect(target, {
      casterId: caster.id, spellName: 'Pyrotechnics',
      effectType: 'condition_apply', payload: { condition: 'blinded' },
      sourceIsConcentration: false,
      appliedTurn: round,
      sourceTurnExpires: round + 10,  // 1 min = 10 rounds (XGE p.162)
    });
    emit(state, 'condition_add', caster.id, `${target.name} is BLINDED by the thick smoke! (heavily obscured — no save; disadv on attacks, adv on attacks vs them)`, target.id);
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration; blinded persists */ }
