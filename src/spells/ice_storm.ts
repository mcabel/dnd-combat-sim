// ============================================================
// Ice Storm — PHB p.254
//
// 4th-level evocation, action, range 300 ft, NO concentration.
// Components: V, S, M (a pinch of dust and a few drops of water).
//
// Effect: A hail of rock-hard ice pounds to the ground in a 20-foot-
//         radius, 40-foot-high cylinder centered on a point within range.
//         Each creature in the cylinder must make a Dexterity saving
//         throw. A creature takes 2d8 cold damage + 2d6 bludgeoning
//         damage on a failed save, or half as much on a successful one.
//
//         Hailstones turn the storm's area of effect into difficult
//         terrain until the end of your next turn.
//
// Upcast: +1d8 cold + 1d6 bludgeoning per slot level above 4th (not modelled).
//
// v1 simplifications:
//   - AoE shape: canon 20-ft radius cylinder. v1 targets the highest-
//     threat enemy within 300 ft as the cylinder's centre and applies
//     damage to ALL enemies within 20 ft of that centre (chebyshev3D —
//     square approx). Mirrors Shatter (Session 18).
//   - Dual damage type: 2d8 cold + 2d6 bludgeoning. v1 rolls each
//     separately and applies them as TWO damage applications (cold then
//     bludgeoning) so per-type resistances apply correctly. The save
//     halves BOTH (each rolled damage is halved independently on save
//     success). Documented via `iceStormDualDamageV1Implemented: true`.
//   - Difficult-terrain rider (PHB p.254): NOT modelled.
//   - Upcast: NOT modelled.
//   - NOT concentration (PHB p.254: instantaneous).
//
// Migration note (Session 24): Mirrors Shatter but with DUAL damage
// type (cold + bludgeoning), 20-ft radius, L4 slot, 300-ft range. The
// dual-damage loop applies each damage type separately so resistances
// work correctly.
//
// Spell module pattern (AoE save radius, dual damage — mirrors shatter.ts):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP, elementalAffinityBonus } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Ice Storm',
  level: 4,
  school: 'evocation',
  rangeFt: 300,                  // PHB p.254: 300 ft
  aoeRadiusFt: 20,               // PHB p.254: 20-ft radius cylinder
  dieCount: 2,                   // cold dice count
  dieSides: 8,                   // cold die sides
  bludgeonDieCount: 2,           // bludgeoning dice count (PHB p.254: 2d6)
  bludgeonDieSides: 6,
  damageType: 'cold' as const,   // primary damage type (metadata)
  concentration: false,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  iceStormDualDamageV1Implemented: true,                              // 2d8 cold + 2d6 bludgeoning, applied separately
  iceStormDifficultTerrainV1Simplified: true,                        // difficult-terrain rider NOT modelled
  iceStormUpcastV1Implemented: false,                                 // +1d8 cold + 1d6 bludgeoning NOT modelled
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

/** Roll 2d8 cold (primary). */
export function rollDamageCold(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

/** Roll 2d6 bludgeoning (secondary). */
export function rollDamageBludgeon(): number {
  let total = 0;
  for (let i = 0; i < metadata.bludgeonDieCount; i++) total += rollDie(metadata.bludgeonDieSides);
  return total;
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Ice Storm')) return null;
  if (!hasSpellSlot(caster, 4)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 300) continue;
    if (e.maxHP > centerThreat || (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e;
      centerThreat = e.maxHP;
      centerDist = distFt;
    }
  }
  if (!center) return null;

  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 20) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Ice Storm');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 4);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Ice Storm! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} cold + ${metadata.bludgeonDieCount}d${metadata.bludgeonDieSides} bludgeoning, ${metadata.aoeRadiusFt}-ft radius AoE) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`,
  );

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSaveReactable(state, caster, target, 'dex', saveDC);

    // Roll both damage types; halve each independently on save success.
    // Session 50 Task #29-follow-up-5c-3: Elemental Affinity (Draconic
    // Sorcerer 6) adds CHA mod to the COLD damage only if the caster's
    // ancestry is cold. The bludgeoning portion does NOT get EA —
    // bludgeoning is not a draconic ancestry type.
    const eaBonus = elementalAffinityBonus(caster, 'cold');
    const coldRaw = rollDamageCold() + eaBonus;
    const bludRaw = rollDamageBludgeon();
    const cold = save.success ? Math.floor(coldRaw / 2) : coldRaw;
    const blud = save.success ? Math.floor(bludRaw / 2) : bludRaw;

    // Apply each damage type separately (so resistances apply per-type).
    const coldDealt = applyDamageWithTempHP(target, cold, 'cold');
    const bludDealt = applyDamageWithTempHP(target, blud, 'bludgeoning');
    const totalDealt = coldDealt + bludDealt;

    emit(
      state,
      save.success ? 'save_success' : 'save_fail',
      caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Ice Storm (rolled ${save.total}) — ${coldDealt} cold + ${bludDealt} bludgeoning = ${totalDealt} total damage (${save.success ? 'halved' : 'full'})`,
      target.id, save.roll,
    );
    emit(state, 'damage', caster.id, `Ice Storm: ${target.name} takes ${totalDealt} damage (${coldDealt} cold + ${bludDealt} bludgeoning)`, target.id, totalDealt);
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous.
}
