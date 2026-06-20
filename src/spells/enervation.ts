// ============================================================
// Enervation — XGE p.155
//
// 5th-level necromancy, action, range 60 ft. Canon: concentration,
// up to 1 minute. v1: concentration + DoT simplified to one-shot.
// Components: V, S.
//
// Effect: A tendril of cloying black energy extends from you toward a
//         creature within range. The target must make a Dexterity saving
//         throw. On a failed save, the target takes 4d8 necrotic damage,
//         and you regain hit points equal to half the amount of damage
//         dealt. On a successful save, the target takes half as much
//         damage and you regain hit points equal to half that amount.
//
//         Canon concentration rider (XGE p.155: "concentration, up to 1
//         minute" — 4d8 necrotic on the first turn and 2d8 at the end of
//         each subsequent turn): v1 simplifies to a single one-shot.
//
// Upcast: +1d8 necrotic per slot level above 5th (not modelled in v1).
//
// v1 simplifications:
//   - Concentration + DoT (XGE p.155: "concentration, up to 1 minute";
//     4d8 first turn, 2d8/turn after): v1 simplifies to one-shot
//     (concentration: false). Per-turn DoT NOT modelled (same gap as
//     Spellfire Storm). Documented via `enervationConcentrationV1Simplified: true`.
//   - Heal amount: half the ACTUAL necrotic damage dealt (after target's
//     temp HP / resistance), per XGE p.155 ("you regain hit points equal
//     to half the amount of damage dealt"). v1 uses applyHeal(caster,
//     floor(dealt / 2)). On save success, half damage → quarter-raw heal.
//     Documented via `enervationHealBasedOnActualDamageV1: true`.
//   - Upcast: NOT modelled.
//
// Migration note (Session 24): Mirrors Vampiric Touch (Session 24) for
// the heal-caster-half rider, but with a DEX SAVE (not melee attack),
// 4d8 necrotic (vs 3d6), L5 slot, 60-ft range.
//
// Spell module pattern (single-target save + heal rider — mirrors
// vampiric_touch.ts heal + catapult.ts save):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (v1 one-shot)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP, applyHeal } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Enervation',
  level: 5,
  school: 'necromancy',
  rangeFt: 60,                   // XGE p.155: 60 ft
  dieCount: 4,
  dieSides: 8,
  damageType: 'necrotic' as const,
  healFraction: 2,               // XGE p.155: heal = half the necrotic dealt
  concentration: false,          // v1 simplification: one-shot (canon concentration 1 min + DoT)
  saveAbility: 'dex' as const,
  castingTime: 'action',
  enervationConcentrationV1Simplified: true,                           // canon concentration + DoT simplified to one-shot
  enervationHealBasedOnActualDamageV1: true,                           // heal = half actual necrotic dealt
  enervationUpcastV1Implemented: false,                                 // +1d8/slot-level NOT modelled
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
  if (!caster.actions.some(a => a.name === 'Enervation')) return null;
  if (!hasSpellSlot(caster, 5)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
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
  const action = caster.actions.find(a => a.name === 'Enervation');
  const saveDC = action?.saveDC ?? 15;

  consumeSpellSlot(caster, 5);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Enervation at ${target.name}! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, half on save + heal self for half the necrotic dealt)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(state, 'save_success', caster.id, `Enervation: ${target.name} is already down — the tendril finds no life.`, target.id);
    return;
  }

  const save = rollSave(target, 'dex', saveDC);
  const fullDmg = rollDamage();
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Enervation (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
    target.id, save.roll,
  );
  emit(state, 'damage', caster.id, `Enervation: ${target.name} takes ${dealt} ${metadata.damageType} damage`, target.id, dealt);

  // Heal the caster for half the ACTUAL necrotic damage dealt.
  const healAmount = Math.floor(dealt / metadata.healFraction);
  if (healAmount > 0) {
    const healed = applyHeal(caster, healAmount);
    emit(state, 'heal', caster.id, `Enervation: ${caster.name} siphons ${healed} HP from ${target.name} (half of ${dealt} necrotic dealt)`, caster.id, healed);
  }
}

export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot.
}
