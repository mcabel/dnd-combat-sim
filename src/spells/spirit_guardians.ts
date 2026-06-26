// ============================================================
// Spirit Guardians — PHB p.278
//
// 3rd-level conjuration, action, range Self (10-ft aura), concentration (10 min).
// Components: V, S, M (a holy symbol).
//
// Effect (canon): You call forth spirits to protect you. They flit around
//                 you to a distance of 15 feet for the duration. If you are
//                 good or neutral, their spectral form appears angelic or fey
//                 (your choice). If you are evil, they appear fiendish. When
//                 you cast this spell, you can designate any number of
//                 creatures you can see to be unaffected by it. An affected
//                 creature's speed is halved in the area, and when the
//                 creature enters the spell's area for the first time on a
//                 turn or starts its turn there, it must make a Wisdom
//                 saving throw. The creature takes 3d6 radiant damage on a
//                 failed save, or half as much on a successful one.
//                 (Upcast: +1d6 per slot level above 3rd.)
//
// v1 simplifications:
//   - Damage type: canon chooses radiant (good/neutral) OR necrotic (evil)
//     based on caster alignment. v1 has no alignment subsystem, so v1 picks
//     radiant — flag `spiritGuardiansDamageTypeV1SimplifiedToRadiant`.
//   - Aura radius: canon is 15 ft; v1 uses 10 ft (the task spec). Documented
//     via `spiritGuardiansAuraRadiusV1SimplifiedTo10Ft` flag.
//   - Aura movement: canon emanation is centered on the caster (moves with
//     them). v1 simplification: the effect is applied at cast time on each
//     enemy within the aura radius; enemies that enter the aura later are
//     NOT affected (no positional AoE subsystem). Flag
//     `spiritGuardiansMovingAuraV1Simplified`.
//   - Speed-halving rider NOT modelled (no per-creature speed-modifier
//     subsystem). Flag `spiritGuardiansSpeedHalvingV1NotModelled`.
//   - Persistent damage: canon says "starts its turn there" → 3d8 radiant,
//     WIS save for half. v1 also applies 3d8 on cast (the "enters the area
//     for the first time on a turn" trigger — the targets are in the area
//     when the spell is cast). Note: canon uses 3d6 (not 3d8) — task spec
//     requests 3d8; v1 follows the task spec and flags this via
//     `spiritGuardiansDieSidesV1AdjustedTo8`.
//   - Duration: canon 10 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002).
//   - Upcast: +1d6/slot-level NOT modelled.
//   - Designated-unaffected creatures: NOT modelled (the caster is the
//     caster; the v1 planner only selects enemies as targets anyway).
//
// Spell module pattern (Session 31 architecture — multi-target aura):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup(_c) — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, DamageType, AbilityScore } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster, filterGoIProtectedTargets, isProtectedByGoI } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Spirit Guardians',
  level: 3,
  school: 'conjuration',
  rangeFt: 10,          // v1 aura radius (canon: 15 ft)
  aoeSizeFt: 10,        // 10-ft aura around caster (v1 simplified)
  dieCount: 3,
  dieSides: 8,
  damageType: 'radiant' as const as DamageType,
  concentration: true,
  saveAbility: 'wis' as const as AbilityScore,
  castingTime: 'action',
  spiritGuardiansDamageTypeV1SimplifiedToRadiant: true,    // canon: radiant OR necrotic by alignment
  spiritGuardiansAuraRadiusV1SimplifiedTo10Ft: true,       // canon: 15 ft; v1: 10 ft
  spiritGuardiansMovingAuraV1Simplified: true,             // aura anchored at cast time
  spiritGuardiansSpeedHalvingV1NotModelled: true,          // speed-halving rider not in v1
  spiritGuardiansDieSidesV1AdjustedTo8: true,              // canon: d6; v1: d8 (per task spec)
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

// ---- Dice helper --------------------------------------------

/**
 * Roll `metadata.dieCount`d`metadata.dieSides` and return the total.
 */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns candidate targets for Spirit Guardians (living enemies within
 * 10 ft of the caster, not already affected by this caster's Spirit
 * Guardians), or null when the spell should not be cast.
 *
 * Target priority: closest enemies first (all within 10 ft).
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on any spell
 *   - Caster has 'Spirit Guardians' in their actions
 *   - Caster has at least one 3rd-level (or higher) slot available
 *   - At least 1 valid enemy target exists within 10 ft of the caster
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Spirit Guardians')) return null;
  if (!hasSpellSlot(caster, 3)) return null;

  const candidates: Array<{ c: Combatant; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > metadata.aoeSizeFt) continue;

    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Spirit Guardians'
    )) continue;

    candidates.push({ c, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.dist - b.dist);

  return candidates.map(e => e.c);
}

// ---- Execution ----------------------------------------------

/**
 * Execute Spirit Guardians:
 *  1. Consume a 3rd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Spirit Guardians.
 *  4. For each target (enemy within 10 ft of caster):
 *     (a) Roll WIS save vs caster's saveDC. On fail, 3d8 radiant; on success,
 *         half. Apply immediately (on-cast trigger).
 *     (b) Apply a `damage_zone` effect for persistent start-of-turn damage
 *         (3d8 radiant, WIS save for half, sourceIsConcentration: true).
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Spirit Guardians');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 3);
  const slotLevel = 3;

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Spirit Guardians');

  const names = targets.map(t => t.name).join(', ');

  // Session 78 (GoI AoE exclusion follow-up): PHB p.245: "the spell has no
  // effect on them." The spell still fires (slot already consumed above).
  // For persistent damage zones, the damage_zone EFFECT is applied to ALL
  // targets in range (so it can tick later if GoI expires), but the ON-CAST
  // damage is skipped for GoI-protected targets. The combat.ts damage_zone
  // tick loop re-checks GoI on each per-turn tick using sourceSlotLevel.
  const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id, state.battlefield);
  const excludedCount = targets.length - effectiveTargets.length;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Spirit Guardians! Spectral protectors flit around them in a 10-ft aura (DC ${saveDC} WIS, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, half on save — ${effectiveTargets.length} enem${effectiveTargets.length !== 1 ? 'ies' : 'y'}: ${names})${excludedCount > 0 ? ` (${excludedCount} excluded by Globe of Invulnerability)` : ''}`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    // Session 78: check GoI protection per-target. The caster's own GoI does
    // NOT block their own spell (PHB p.245: "cast from outside the barrier").
    const goiBlocked = target.id !== caster.id && isProtectedByGoI(target, slotLevel, state.battlefield);

    // 1. Immediate on-cast damage: WIS save for half.
    //    Skipped if the target is GoI-protected (PHB p.245: "no effect on them").
    if (!goiBlocked) {
      const save = rollSaveReactable(state, caster, target, metadata.saveAbility, saveDC);
      const fullDmg = rollDamage();
      const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
      const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

      emit(
        state,
        save.success ? 'save_success' : 'save_fail',
        caster.id,
        `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Spirit Guardians (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
        target.id, save.roll,
      );
      emit(
        state, 'damage', caster.id,
        `${target.name} takes ${dealt} ${metadata.damageType} damage from Spirit Guardians (on cast)`,
        target.id, dealt,
      );
    } else {
      emit(
        state, 'damage', caster.id,
        `${target.name} is protected by Globe of Invulnerability — on-cast damage negated (persistent effect still applied, will tick when GoI expires).`,
        target.id, 0,
      );
    }

    // 2. Apply damage_zone effect for persistent start-of-turn damage.
    //    ALWAYS applied (even to GoI-protected targets) so the spell can start
    //    ticking if GoI expires later. sourceSlotLevel is set so the combat.ts
    //    damage_zone tick loop can re-check GoI protection on each per-turn
    //    tick (PHB p.245: the spell continues to have no effect on GoI-
    //    protected creatures for as long as GoI is active).
    applySpellEffect(target, {
      casterId: caster.id,
      spellName: 'Spirit Guardians',
      effectType: 'damage_zone',
      sourceSlotLevel: slotLevel,
      payload: {
        dieCount: metadata.dieCount,
        dieSides: metadata.dieSides,
        damageType: metadata.damageType,
        saveDC,
        saveAbility: metadata.saveAbility,
      },
      sourceIsConcentration: true,
    });

    emit(
      state, 'condition_add', caster.id,
      `${target.name} is beset by spirit guardians! (will take ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} at the start of each of its turns, WIS save for half)`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
