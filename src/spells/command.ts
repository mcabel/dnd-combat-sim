// ============================================================
// Command — PHB p.223
//
// 1st-level enchantment, action, range 60 ft, NO concentration (1 round).
// Components: V, M (a drop of blood).
//
// Effect: You speak a one-word command to a creature you can see within
//         range. The target must succeed on a Wisdom saving throw or
//         follow the command (approach, drop, flee, grovel, halt).
//
// Upcast: +1 target per slot-level above 1st (not modelled in v1).
//
// Command options and their v2 modelling:
//   - Approach: target moves toward caster, ends turn within 5 ft.
//     v2: incapacitated (v1 has no forced-movement hook; the creature
//     can't take its normal action).
//   - Drop: target drops whatever it is holding.
//     v2: incapacitated (v1 has no weapon-drop subsystem; the creature
//     spends its action dropping things).
//   - Flee: target spends its turn moving away by the fastest means.
//     v2: frightened (closest canon match — disadv on attacks while
//     caster visible, can't willingly move closer).
//   - Grovel: target falls prone and ends its turn.
//     v2: prone + incapacitated (dual condition — falls prone AND
//     can't act).
//   - Halt: target doesn't move and takes no actions.
//     v2: incapacitated (can't move or act).
//
// AI selection priority (based on tactical distance):
//   ≤30 ft → Grovel (prone + incapacitated — most disabling)
//   ≤60 ft → Flee  (frightened — disadv on attacks, can't approach)
//   >60 ft → Halt  (incapacitated — safe general-purpose)
//
// v1 simplifications still in effect:
//   - Duration: canon 1 round. v1 has no end-of-turn expiry hook —
//     conditions persist for the v1 combat. NOT concentration.
//   - Upcast: +1 target/slot-level NOT modelled — v1 targets 1 creature.
//   - Language requirement (PHB p.223: target must understand you): NOT
//     enforced.
//   - Undead immunity (PHB p.223): NOT enforced.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-incapacitated (no conc).
// Removed from `_generic_registry.ts`; routed via `case 'command':` in
// combat.ts and a planner branch in planner.ts. Mirrors Blindness/Deafness
// (single-target save-or-condition, no conc) but incapacitated.
//
// Session 28 upgrade: expanded from single incapacitated to 5 command
// options with appropriate condition mapping and AI selection.
//
// Spell module pattern (single-target save-or-condition, NO concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (no concentration; conditions persist for combat)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Command Option Type ------------------------------------

export type CommandOption = 'approach' | 'drop' | 'flee' | 'grovel' | 'halt';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Command',
  level: 1,
  school: 'enchantment',
  rangeFt: 60,                   // PHB p.223: 60 ft
  concentration: false,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  commandOptionsV2Implemented: true,                          // 5 command options with proper condition mapping
  commandUpcastV1Implemented: false,                          // +1 target/slot-level NOT modelled
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

// ---- AI Command Selection -----------------------------------

/** AI picks the best command option for the tactical situation */
export function pickCommandOption(caster: Combatant, target: Combatant): CommandOption {
  const distFt = chebyshev3D(caster.pos, target.pos) * 5;
  // Grovel (prone + incapacitated) — most disabling for close targets
  if (distFt <= 30) return 'grovel';
  // Flee (frightened) — disadv on attacks while caster visible, can't approach
  if (distFt <= 60) return 'flee';
  // Halt (incapacitated) — safe general-purpose option for far targets
  return 'halt';
}

/** Map a command option to the condition(s) it applies */
function commandConditions(option: CommandOption): Array<'incapacitated' | 'prone' | 'frightened'> {
  switch (option) {
    case 'approach': return ['incapacitated'];  // v1: no forced-movement; creature can't take its action
    case 'drop':     return ['incapacitated'];  // v1: no weapon-drop; creature can't take its action
    case 'flee':     return ['frightened'];      // disadv on attacks while caster visible, can't approach
    case 'grovel':   return ['prone', 'incapacitated'];  // falls prone AND can't act
    case 'halt':     return ['incapacitated'];  // can't move or act
  }
}

/** Human-readable description of a command option's effect */
function commandDescription(option: CommandOption): string {
  switch (option) {
    case 'approach': return 'incapacitated (forced approach — no forced-movement in v1)';
    case 'drop':     return 'incapacitated (drops held items — no weapon-drop in v1)';
    case 'flee':     return 'FRIGHTENED (flees from caster — disadv on attacks, can\'t approach)';
    case 'grovel':   return 'PRONE + INCAPACITATED (falls prone and ends turn)';
    case 'halt':     return 'INCAPACITATED (can\'t move or act)';
  }
}

// ---- Planner ------------------------------------------------

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Command')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;
    if (c.conditions.has('incapacitated')) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Command')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Command');
  const saveDC = action?.saveDC ?? 13;

  // Pick the best command option for this tactical situation
  const option = pickCommandOption(caster, target);
  const conditions = commandConditions(option);

  consumeSpellSlot(caster, 1);

  emit(state, 'action', caster.id,
    `${caster.name} casts Command [${option}] at ${target.name}! (DC ${saveDC} WIS — ${commandDescription(option)} on fail)`,
    target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Command [${option}] (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Command [${option}] — no effect!`, target.id);
    return;
  }

  // Apply each condition for this command option
  for (const condition of conditions) {
    applySpellEffect(target, {
      casterId: caster.id, spellName: 'Command',
      effectType: 'condition_apply', payload: { condition },
      sourceIsConcentration: false,
    });
  }
  emit(state, 'condition_add', caster.id,
    `${target.name} is ${commandDescription(option)} by Command [${option}]!`, target.id);
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration; conditions persist */ }
