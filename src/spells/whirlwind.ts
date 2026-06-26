// ============================================================
// Whirlwind — PHB p.298 (XGE variant p.170)
//
// 7th-level evocation, action, range 50 ft (cone), concentration (1 min).
// Components: V, M (a handful of dust and a few drops of water).
//
// Effect: A whirlwind of air howls in a 50-foot cone from you. Each
//         creature in that area must make a Constitution saving throw.
//         On a failed save, a creature takes 7d8 bludgeoning damage
//         (canon — Session 27 fix; was dropped per plan in Batch 2) and
//         is restrained by the wind. On a successful save, a creature
//         takes half damage and is NOT restrained.
//
// Upcast: +1d8/slot-level above 7th (not modelled in v1).
//
// v1 simplifications:
//   - Shape: canon 50-ft cone from caster. v1 uses inConeFt aimed at
//     the nearest living enemy within 50 ft (mirrors Spray of Cards).
//   - Damage: canon 7d8 bludgeoning. Session 27 canon fix: damage is now
//     rolled and applied (half on save). Was dropped per plan in Batch 2.
//     Documented via `whirlwindCanonDamageV1`.
//   - Restraint duration: canon 1 min (or until target escapes with an
//     action + STR check). v1 has no escape-action hook — restrained
//     persists for the entire combat (or until concentration breaks).
//   - Concentration: canon 1 min concentration. v1 starts concentration
//     via startConcentration(); engine does NOT enforce concentration
//     checks on damage taken (TG-002). The restrained + damage are
//     sourceIsConcentration: true (restrained ends on conc break; damage
//     is already dealt and NOT reverted).
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 7d8.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke CON-save-or-restrained cone (conc).
// Session 27 canon fix: added canon 7d8 bludgeoning damage (was dropped).
// Removed from `_generic_registry.ts`; routed via `case 'whirlwind':`
// in combat.ts and a planner branch in planner.ts. Mirrors Sunburst
// (cone AoE save + damage + condition) + Hold Person (concentration).
//
// Spell module pattern (cone AoE save + damage + condition, concentration):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, DamageType } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster, filterGoIProtectedTargets } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { inConeFt, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Whirlwind',
  level: 7,
  school: 'evocation',
  rangeFt: 50,                   // PHB p.298: 50-ft cone
  concentration: true,
  saveAbility: 'con' as const,
  castingTime: 'action',
  dieCount: 7,                   // PHB p.298: 7d8 bludgeoning (Session 27 canon fix)
  dieSides: 8,
  damageType: 'bludgeoning' as DamageType,
  whirlwindCanonDamageV1: true,                            // Session 27: canon 7d8 damage (was dropped per plan)
  whirlwindEscapeActionV1Simplified: true,                // no STR-check escape hook
  whirlwindUpcastV1Implemented: false,                    // +1d8/slot-level NOT modelled
} as const;

const CONE_RANGE_FT = 50;
const CONE_HALF_ANGLE_DEG = 26.57;   // arctan(0.5) — standard D&D cone (width = length at base)

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

// ---- Dice helper --------------------------------------------

/** Roll `metadata.dieCount`d`metadata.dieSides` and return the total. */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the list of enemies caught in a Whirlwind 50-ft cone aimed at
 * the nearest living enemy within 50 ft, or null when the spell should
 * not be cast.
 *
 * Target selection:
 *   1. Find the nearest living enemy within 50 ft (euclidean dist) —
 *      this sets the cone's aim direction.
 *   2. Collect ALL living enemies inside the cone (via inConeFt).
 *
 * Preconditions:
 *   - Caster has 'Whirlwind' in their actions
 *   - Caster has at least one 7th-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 living enemy is within 50 ft (cone range)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Whirlwind')) return null;
  if (!hasSpellSlot(caster, 7)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  let nearest: Combatant | null = null;
  let nearestDistFt = Infinity;
  for (const e of enemies) {
    const dx = e.pos.x - caster.pos.x;
    const dy = e.pos.y - caster.pos.y;
    const distFt = Math.sqrt(dx * dx + dy * dy) * 5;
    if (distFt <= CONE_RANGE_FT && distFt < nearestDistFt) {
      nearest = e;
      nearestDistFt = distFt;
    }
  }
  if (!nearest) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    if (inConeFt(caster.pos, nearest.pos, e.pos, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT)) {
      targets.push(e);
    }
  }
  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Whirlwind:
 *  1. Consume a 7th-level spell slot.
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Whirlwind.
 *  4. For each target in the cone: roll CON save; on fail apply restrained
 *     (sourceIsConcentration: true). No damage (per plan).
 *
 * @param caster  The casting Combatant (Druid / Sorcerer / Wizard)
 * @param targets Candidates from shouldCast (all enemies in the 50-ft cone)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Whirlwind');
  const saveDC = action?.saveDC ?? 13;

  const slotLevel = consumeSpellSlot(caster, 7) ?? 7;

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Whirlwind');

  // Session 79: exclude targets protected by Globe of Invulnerability from
  // this AoE. PHB p.245: "the spell has no effect on them." The spell still
  // fires (slot already consumed above); protected targets are simply
  // skipped in the damage loop.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id, state.battlefield);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Whirlwind! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} + restrained on fail, ${CONE_RANGE_FT}-ft cone, concentration) — ${effectiveTargets.length} creature${effectiveTargets.length !== 1 ? 's' : ''} caught${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}!`,
  );

  for (const target of effectiveTargets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'con', saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Whirlwind (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})${save.success ? '' : ' + RESTRAINED'}`,
      target.id, save.roll,
    );
    emit(
      state, 'damage', caster.id,
      `Whirlwind: ${target.name} takes ${dealt} ${metadata.damageType} damage`,
      target.id, dealt,
    );

    if (!save.success && !target.conditions.has('restrained')) {
      applySpellEffect(target, {
        casterId: caster.id,
        spellName: 'Whirlwind',
        effectType: 'condition_apply',
        payload: { condition: 'restrained' },
        sourceIsConcentration: true,
      });
      emit(
        state, 'condition_add', caster.id,
        `${target.name} is RESTRAINED by the whirlwind! (speed 0, disadv on attacks/DEX, adv on attacks vs them)`,
        target.id,
      );
    }
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup.
}
