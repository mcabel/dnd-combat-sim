// ============================================================
// Wall of Fire — PHB p.285
//
// 4th-level evocation, action, range 120 ft, concentration (1 min).
// Components: V, S, M (a small piece of phosphorus).
//
// Effect: Create a wall (60-ft line × 20-ft high × 1-ft thick, or 20-ft
//         diameter ring) on a solid surface within 120 ft. Opaque.
//         On appear: each creature in wall area makes DEX save → 5d8 fire
//         (half on success).
//         Ongoing: one side deals 5d8 fire to creatures within 10 ft OR
//         inside wall at end of their turn.
//
// Upcast: +1d8 fire per slot level above 4th (not modelled in v1).
//
// v1 simplifications:
//   - Wall geometry: NOT modelled (no wall/zone subsystem). v1 targets a
//     single enemy as if they were inside the wall and applies the damage.
//   - AoE: v1 targets single best enemy (mirror: Flaming Sphere pattern).
//   - Ongoing: damage_zone effect on targeted enemy; DEX save half each tick.
//   - Wall sides / direction: NOT modelled.
//   - Opaque blocking: NOT modelled (requires TG-007 wall subsystem).
//   - Upcast: NOT modelled.
//
// Spell module pattern (single-target zone damage, concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (removeEffectsFromCaster handles conc cleanup)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster, isProtectedByGoI } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Wall of Fire', level: 4, school: 'evocation', rangeFt: 120,
  concentration: true, saveAbility: 'dex' as const, castingTime: 'action',
  wallOfFireGeometryV1Implemented: false,   // wall shape not modelled
  wallOfFireMultiTargetV1Implemented: false, // AoE reduced to single target
  wallOfFireUpcastV1Implemented: false,      // upcast not modelled
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

function rollFireDamage(): number {
  let total = 0;
  for (let i = 0; i < 5; i++) total += rollDie(8);
  return total;
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Wall of Fire')) return null;
  if (!hasSpellSlot(caster, 4)) return null;
  if (caster.concentration?.active) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 120) continue;
    // Skip if already in a Wall of Fire zone from this caster
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Wall of Fire')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Wall of Fire');
  const saveDC = action?.saveDC ?? 14;
  const slotLevel = consumeSpellSlot(caster, 4) ?? 4;

  // Drop stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Wall of Fire');

  emit(state, 'action', caster.id,
    `${caster.name} casts Wall of Fire at ${target.name}! (DC ${saveDC} DEX)`, target.id);

  if (target.isDead || target.isUnconscious) return;

  // Session 79 (GoI AoE exclusion follow-up): PHB p.245: "the spell has no
  // effect on them." The spell still fires (slot already consumed above).
  // For persistent damage zones, the damage_zone EFFECT is applied to the
  // target (so it can tick later if GoI expires), but the ON-CAST (on-appear)
  // damage is skipped if the target is GoI-protected. The caster's own GoI
  // does NOT block their own spell (PHB p.245: "cast from outside the barrier").
  const goiBlocked = target.id !== caster.id && isProtectedByGoI(target, slotLevel);

  // On-appear damage: DEX save, 5d8 fire (half on success). Skipped if GoI-protected.
  if (!goiBlocked) {
    const appearSave = rollSaveReactable(state, caster, target, 'dex', saveDC);
    const appearDmg = rollFireDamage();
    const finalDmg = appearSave.success ? Math.floor(appearDmg / 2) : appearDmg;

    emit(state, appearSave.success ? 'save_success' : 'save_fail', caster.id,
      `${target.name} ${appearSave.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Wall of Fire — takes ${finalDmg} fire (rolled ${appearDmg}${appearSave.success ? ', halved' : ''})`,
      target.id, appearSave.roll);

    const dealtOnAppear = applyDamageWithTempHP(target, finalDmg, 'fire');
    emit(state, 'damage', caster.id,
      `Wall of Fire deals ${dealtOnAppear} fire to ${target.name} (appears)`, target.id, dealtOnAppear);
  } else {
    emit(state, 'damage', caster.id,
      `${target.name} is protected by Globe of Invulnerability — on-cast damage negated (persistent effect still applied, will tick when GoI expires).`,
      target.id, 0);
  }

  if (target.isDead || target.isUnconscious) return;

  // Ongoing: damage_zone with DEX save half each tick.
  //
  // ALWAYS applied (even to GoI-protected targets) so the spell can start
  // ticking if GoI expires later. sourceSlotLevel is set so the combat.ts
  // damage_zone tick loop can re-check GoI protection on each per-turn
  // tick (PHB p.245: the spell continues to have no effect on GoI-
  // protected creatures for as long as GoI is active).
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Wall of Fire',
    effectType: 'damage_zone',
    sourceSlotLevel: slotLevel,
    payload: {
      dieCount: 5,
      dieSides: 8,
      damageType: 'fire',
      saveDC,
      saveAbility: 'dex',
    },
    sourceIsConcentration: true,
    sourceCreatureType: caster.creatureType,
  });
  emit(state, 'action', caster.id,
    `Wall of Fire zone surrounds ${target.name} — 5d8 fire (DEX save half) each turn until concentration ends`, target.id);
}

export function cleanup(_c: Combatant): void { /* no-op — removeEffectsFromCaster handles conc cleanup */ }
