// ============================================================
// Bestow Curse — PHB p.214
//
// 3rd-level necromancy, action, range Touch (5 ft), concentration (1 min).
// Components: V, S.
//
// Effect: You touch a creature, and that creature must succeed on a
//         Wisdom saving throw or become cursed for the duration. Choose
//         one of the following effects:
//         (1) disadv on attacks vs you,
//         (2) disadv on one ability's checks & saves,
//         (3) save-or-incapacitated each turn,
//         (4) +1d8 necrotic rider when attacking you.
//
// Upcast: 4th (8 hr no conc), 5th+ (until dispelled) — not modelled in v1.
//
// v2 (this version): full 4-option implementation with AI-driven selection.
//   - Option 1: curse_attack_disadv effect (disadv on attacks vs curse caster)
//   - Option 2: ability_disadvantage effect (disadv on one ability's checks & saves)
//   - Option 3: condition_apply:incapacitated (save-or-waste-action each turn;
//               v2 simplification: no start-of-turn re-save hook — same as v1)
//   - Option 4: curse_rider effect (1d8 necrotic when cursed target attacks caster)
//
// v1 simplifications (superseded by v2):
//   - All 4 curse options simplified to incapacitated (documented via
//     bestowCurseOptionsV1SimplifiedToIncapacitated — now removed).
//   - Range: canon Touch (5 ft). Session 27 canon fix — NOW canon Touch
//     (was 60 ft per plan in Batch 2). Documented via
//     `bestowCurseCanonTouchRangeV1`.
//   - Concentration: canon 1 min concentration. v1 starts concentration;
//     not enforced on damage (TG-002). All effects are conc-sourced.
//   - Upcast duration extensions (no-conc at 4th) NOT modelled.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke WIS-save-or-incapacitated (concentration).
// Session 27 canon fix: reverted range to canon Touch (was 60 ft per plan).
// Removed from `_generic_registry.ts`; routed via `case 'bestowCurse':` in
// combat.ts and a planner branch in planner.ts.
//
// Spell module pattern (single-target save-or-condition, concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, AbilityScore } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Curse option type ----------------------------------------

/**
 * The 4 canon curse options from PHB p.214:
 *   disadv_attacks_vs_caster — "disadvantage on attack rolls against you"
 *   disadv_ability           — "disadvantage on ability checks and saving throws made with that ability score"
 *   incapacitated_resave     — "must make a Wisdom saving throw at the start of each of its turns. If it fails, it wastes its action that turn"
 *   necrotic_rider           — "each time the target makes an attack roll or spell attack against you, it takes 1d8 necrotic damage"
 */
export type CurseOption =
  | 'disadv_attacks_vs_caster'
  | 'disadv_ability'
  | 'incapacitated_resave'
  | 'necrotic_rider';

// ---- Metadata -------------------------------------------------

export const metadata = {
  name: 'Bestow Curse',
  level: 3,
  school: 'necromancy',
  rangeFt: 5,                    // canon Touch (Session 27 fix; was 60 ft per plan)
  concentration: true,
  saveAbility: 'wis' as const,
  castingTime: 'action',
  bestowCurseOptionsV2Implemented: true,                    // 4 canon curse options with proper effects
  bestowCurseCanonTouchRangeV1: true,                       // Session 27: canon Touch range (was 60 ft per plan)
  bestowCurseConcentrationEnforcementV1Implemented: false,
  bestowCurseUpcastV1Implemented: false,                    // duration extensions NOT modelled
} as const;

// ---- Local log helper -----------------------------------------

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

// ---- AI curse option selection --------------------------------

/**
 * Pick the best curse option for the tactical situation.
 *
 * Strategy:
 *   1. High-HP target (>30) → necrotic_rider (they'll attack and take damage)
 *   2. General threat → disadv_attacks_vs_caster (always useful — protect yourself)
 *
 * Note: disadv_ability and incapacitated_resave are available for future AI
 * refinement (e.g. disadv on WIS saves for spellcaster targets,
 * incapacitated_resave for control-heavy strategies). For v2, the AI
 * focuses on the two most universally useful options.
 */
export function pickCurseOption(caster: Combatant, target: Combatant): CurseOption {
  // +1d8 necrotic rider for high-HP targets (they'll likely attack and take damage)
  if (target.maxHP > 30) return 'necrotic_rider';
  // Disadv on attacks vs caster — always useful
  return 'disadv_attacks_vs_caster';
}

// ---- Planner --------------------------------------------------

/**
 * Returns the single best target for Bestow Curse (a living enemy within Touch
 * range (5 ft), not already cursed by this caster), or null when the spell
 * should not be cast.
 * Target priority: highest-threat, then closest.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Bestow Curse')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;   // canon Touch range (Session 27 fix; was 60 ft)
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Bestow Curse')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

// ---- Human-readable descriptions per option -------------------

function curseDescription(option: CurseOption): string {
  switch (option) {
    case 'disadv_attacks_vs_caster': return 'Curse of Attack Disadvantage (disadv on attacks vs caster)';
    case 'disadv_ability':           return 'Curse of Ability Disadvantage (disadv on one ability\'s checks & saves)';
    case 'incapacitated_resave':     return 'Curse of Incapacitation (save-or-waste-action each turn)';
    case 'necrotic_rider':           return 'Curse of Necrotic Rider (+1d8 necrotic when attacking caster)';
  }
}

// ---- Execution ------------------------------------------------

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Bestow Curse');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 3);
  if (caster.concentration?.active) removeEffectsFromCaster(caster.id, state.battlefield);
  startConcentration(caster, 'Bestow Curse');

  emit(state, 'action', caster.id, `${caster.name} casts Bestow Curse at ${target.name}! (DC ${saveDC} WIS)`, target.id);
  if (target.isDead || target.isUnconscious) return;

  const save = rollSave(target, 'wis', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Bestow Curse (rolled ${save.total})`, target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Bestow Curse — not cursed!`, target.id);
    return;
  }

  // Pick the best curse option for this tactical situation
  const option = pickCurseOption(caster, target);

  emit(state, 'action', caster.id,
    `${target.name} is CURSED by Bestow Curse! [${curseDescription(option)}]`, target.id);

  switch (option) {
    case 'disadv_attacks_vs_caster':
      // Option 1 (PHB p.214): "the target has disadvantage on attack rolls against you"
      applySpellEffect(target, {
        casterId: caster.id, spellName: 'Bestow Curse',
        effectType: 'curse_attack_disadv', payload: { curseCasterId: caster.id },
        sourceIsConcentration: true,
      });
      break;

    case 'disadv_ability':
      // Option 2 (PHB p.214): "disadvantage on ability checks and saving throws
      // made with that ability score" — AI picks WIS as default (most common save)
      applySpellEffect(target, {
        casterId: caster.id, spellName: 'Bestow Curse',
        effectType: 'ability_disadvantage', payload: { ability: 'wis' as AbilityScore },
        sourceIsConcentration: true,
      });
      break;

    case 'incapacitated_resave':
      // Option 3 (PHB p.214): "must make a Wisdom saving throw at the start of
      // each of its turns. If it fails, it wastes its action that turn."
      // v2 simplification: apply incapacitated (same as v1); start-of-turn
      // re-save hook not modelled yet.
      applySpellEffect(target, {
        casterId: caster.id, spellName: 'Bestow Curse',
        effectType: 'condition_apply', payload: { condition: 'incapacitated' },
        sourceIsConcentration: true,
      });
      break;

    case 'necrotic_rider':
      // Option 4 (PHB p.214): "each time the target makes an attack roll or
      // spell attack against you, it takes 1d8 necrotic damage"
      applySpellEffect(target, {
        casterId: caster.id, spellName: 'Bestow Curse',
        effectType: 'curse_rider', payload: {
          riderDie: 8,
          riderDieCount: 1,
          riderDamageType: 'necrotic',
          riderCasterId: caster.id,
        },
        sourceIsConcentration: true,
      });
      break;
  }
}

// ---- Cleanup --------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — concentration break handles cleanup */ }
