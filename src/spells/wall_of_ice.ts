// ============================================================
// Wall of Ice — PHB p.285 (EE p.20 / XGE p.170 reprint)
//
// 6th-level evocation, action, range 120 ft, concentration (10 min).
// Components: V, S, M (a small piece of quartz).
//
// Effect: You create a wall of ice on a solid surface within range. You
//         can form it into a hemispherical dome (up to 10-ft radius) OR
//         a flat wall (up to ten 10×10 panels).
//   - On appear: each creature in the wall's area makes a DEX save →
//     10d6 cold (half on success).
//   - The wall is an opaque solid object; creatures can't pass through.
//   - One side of the wall (caster's choice) deals 5d6 cold to creatures
//     within 10 ft OR inside the wall at the end of their turns.
//   - If the wall is broken (≥30 damage in a 10×10 panel), the panel
//     collapses; creatures in that area take 5d6 cold (DEX save half).
//   - Upcast: +1d6 (appear) +1d6 (ongoing) per slot level above 6th.
//
// v1 simplifications (mirror Wall of Fire v1):
//   - Wall geometry: NOT modelled (no wall/zone subsystem). v1 targets a
//     single enemy as if they were inside the wall and applies the damage.
//   - AoE: v1 targets single best enemy (same as Wall of Fire v1).
//   - On-appear: DEX save 10d6 cold (half on success).
//   - Ongoing: damage_zone effect on targeted enemy; DEX save half each tick.
//   - Wall sides / direction / panel-break: NOT modelled.
//   - Opaque blocking: NOT modelled (requires TG-007 wall subsystem).
//   - Upcast: NOT modelled.
//
// Spell module pattern (single-target zone damage, concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (removeEffectsFromCaster handles conc cleanup)
//
// Combat value: HIGH. Stronger than Wall of Fire (L6 vs L4; 10d6 vs 5d8
// appear; 5d6 ongoing cold vs fire). 9 creatures know it (Levistus,
// Biomancer, Zegana, etc.).
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster, isProtectedByGoI } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Wall of Ice', level: 6, school: 'evocation', rangeFt: 120,
  concentration: true, saveAbility: 'dex' as const, castingTime: 'action',
  wallOfIceGeometryV1Implemented: false,    // wall shape not modelled
  wallOfIceMultiTargetV1Implemented: false,  // AoE reduced to single target
  wallOfIceUpcastV1Implemented: false,       // upcast not modelled
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

function rollColdDamage(dieCount: number): number {
  let total = 0;
  for (let i = 0; i < dieCount; i++) total += rollDie(6);
  return total;
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Wall of Ice')) return null;
  if (!hasSpellSlot(caster, 6)) return null;
  if (caster.concentration?.active) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 120) continue;
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Wall of Ice')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Wall of Ice');
  const saveDC = action?.saveDC ?? 16;
  const slotLevel = consumeSpellSlot(caster, 6) ?? 6;

  // Drop stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Wall of Ice');

  emit(state, 'action', caster.id,
    `${caster.name} casts Wall of Ice at ${target.name}! (DC ${saveDC} DEX, 10d6 cold on appear)`, target.id);

  if (target.isDead || target.isUnconscious) return;

  // Session 79 (GoI AoE exclusion follow-up): PHB p.245: "the spell has no
  // effect on them." The spell still fires (slot already consumed above).
  // For persistent damage zones, the damage_zone EFFECT is applied to the
  // target (so it can tick later if GoI expires), but the ON-CAST (on-appear)
  // damage is skipped if the target is GoI-protected. The caster's own GoI
  // does NOT block their own spell (PHB p.245: "cast from outside the barrier").
  const goiBlocked = target.id !== caster.id && isProtectedByGoI(target, slotLevel, state.battlefield);

  // On-appear damage: DEX save, 10d6 cold (half on success). Skipped if GoI-protected.
  if (!goiBlocked) {
    const appearSave = rollSaveReactable(state, caster, target, 'dex', saveDC);
    const appearDmg = rollColdDamage(10);
    const finalDmg = appearSave.success ? Math.floor(appearDmg / 2) : appearDmg;

    emit(state, appearSave.success ? 'save_success' : 'save_fail', caster.id,
      `${target.name} ${appearSave.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Wall of Ice — takes ${finalDmg} cold (rolled ${appearDmg}${appearSave.success ? ', halved' : ''})`,
      target.id, appearSave.roll);

    const dealtOnAppear = applyDamageWithTempHP(target, finalDmg, 'cold');
    emit(state, 'damage', caster.id,
      `Wall of Ice deals ${dealtOnAppear} cold to ${target.name} (appears)`, target.id, dealtOnAppear);
  } else {
    emit(state, 'damage', caster.id,
      `${target.name} is protected by Globe of Invulnerability — on-cast damage negated (persistent effect still applied, will tick when GoI expires).`,
      target.id, 0);
  }

  if (target.isDead || target.isUnconscious) return;

  // Ongoing: damage_zone with DEX save half each tick (5d6 cold per PHB).
  //
  // ALWAYS applied (even to GoI-protected targets) so the spell can start
  // ticking if GoI expires later. sourceSlotLevel is set so the combat.ts
  // damage_zone tick loop can re-check GoI protection on each per-turn
  // tick (PHB p.245: the spell continues to have no effect on GoI-
  // protected creatures for as long as GoI is active).
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Wall of Ice',
    effectType: 'damage_zone',
    sourceSlotLevel: slotLevel,
    payload: {
      dieCount: 5,
      dieSides: 6,
      damageType: 'cold',
      saveDC,
      saveAbility: 'dex',
    },
    sourceIsConcentration: true,
    sourceCreatureType: caster.creatureType,
  });
  emit(state, 'action', caster.id,
    `Wall of Ice surrounds ${target.name} — 5d6 cold (DEX save half) each turn until concentration ends`, target.id);
}

export function cleanup(_c: Combatant): void { /* no-op — removeEffectsFromCaster handles conc cleanup */ }
