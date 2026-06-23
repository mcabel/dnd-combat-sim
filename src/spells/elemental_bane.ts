// ============================================================
// Elemental Bane — XGE p.154 (also EGtW p.158)
//
// 4th-level transmutation, action, range 90 ft, CONCENTRATION (1 min).
// v1: concentration simplified to one-shot (see simplifications).
// Components: V, S.
//
// Effect: Choose one creature you can see within range, and choose acid,
//         cold, fire, lightning, or poison damage. The target must make
//         a Wisdom saving throw. On a failed save, the target takes 2d6
//         acid damage (v1: always acid — see simplifications). For the
//         duration, the target loses resistance to the chosen damage
//         type, and the first time each turn you deal damage of the
//         chosen type to the target, it takes an additional 2d6 damage.
//
// Upcast: +1d6 damage per slot level above 4th (not modelled in v1).
//
// v1 simplifications:
//   - Concentration (XGE p.154: "concentration, up to 1 minute"): v1
//     simplifies to one-shot (concentration: false). The "lose resistance
//     to chosen element" + "first-time-each-turn +2d6" riders are NOT
//     modelled — v1 has no per-turn damage-tracking subsystem. One-shot
//     2d6 damage only. Documented via
//     `elementalBaneConcentrationV1Simplified: true`.
//   - Damage type choice (XGE p.154: caster chooses acid/cold/fire/
//     lightning/poison): v1 ALWAYS uses acid (the simplest choice — no
//     target-resistance picker needed). Documented via
//     `elementalBaneAcidTypeV1Default: true`.
//   - Vulnerability rider ("the target loses resistance to the chosen
//     damage type"): NOT modelled — v1 has no vulnerability_add effect
//     type. Documented via `elementalBaneVulnerabilityV1Simplified: true`.
//   - Per-turn +2d6 rider: NOT modelled (no per-turn damage tracking).
//   - Save ability: WIS (XGE p.154).
//   - Upcast: +1d6/slot-level NOT modelled. Documented via
//     `elementalBaneUpcastV1Implemented: false`.
//
// Migration note (Session 24): Mirrors the Catapult bespoke pattern
// (Session 21) but with WIS save, 2d6 acid, L4 slot, 90-ft range.
//
// Spell module pattern (single-target save — mirrors catapult.ts):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (v1 one-shot)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP, elementalAffinityBonus } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Elemental Bane',
  level: 4,
  school: 'transmutation',
  rangeFt: 90,                   // XGE p.154: 90 ft
  dieCount: 2,
  dieSides: 6,
  damageType: 'acid' as const,   // v1 default (caster choice simplified)
  concentration: false,          // v1 simplification: one-shot (canon concentration 1 min)
  saveAbility: 'wis' as const,
  castingTime: 'action',
  elementalBaneConcentrationV1Simplified: true,                       // canon concentration simplified to one-shot
  elementalBaneAcidTypeV1Default: true,                               // caster choice simplified to acid
  elementalBaneVulnerabilityV1Simplified: true,                       // vulnerability rider NOT modelled
  elementalBaneUpcastV1Implemented: false,                             // +1d6/slot-level NOT modelled
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Elemental Bane')) return null;
  if (!hasSpellSlot(caster, 4)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 90) continue;
    candidates.push({ c: e, threat: e.maxHP, curHP: e.currentHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    if (a.curHP !== b.curHP) return a.curHP - b.curHP;
    return a.dist - b.dist;
  });
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Elemental Bane');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 4);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Elemental Bane at ${target.name}! (DC ${saveDC} WIS, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, half on save)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(state, 'save_success', caster.id, `Elemental Bane: ${target.name} is already down — the bane finds no essence.`, target.id);
    return;
  }

  const save = rollSaveReactable(state, caster, target, 'wis', saveDC);
  // Session 51 Task #29-follow-up-5c-4: Elemental Affinity (Draconic
  // Sorcerer 6) adds CHA mod to the acid damage if the caster's ancestry
  // is acid. The bonus is added BEFORE save halving (so it IS halved on
  // save success — consistent with the v1 model where the bonus is part
  // of the total damage roll).
  const eaBonus = elementalAffinityBonus(caster, metadata.damageType);
  const fullDmg = rollDamage() + eaBonus;
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Elemental Bane (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${eaBonus > 0 ? ` + ${eaBonus} EA` : ''}${save.success ? ', halved' : ''})`,
    target.id, save.roll,
  );
  emit(state, 'damage', caster.id, `Elemental Bane: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);
}

export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot (canon concentration simplified away).
}
