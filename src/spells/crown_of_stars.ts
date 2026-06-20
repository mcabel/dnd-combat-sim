// ============================================================
// Crown of Stars — XGE p.152
// 7th-level evocation, action, range Self. Canon: no concentration, 1 hour
// (7 motes; 1 mote = bonus-action ranged spell attack 4d12 radiant).
// v1: 7-mote storage simplified to a single one-shot attack.
// Components: V, S.
//
// Effect: Seven star-like points of light appear and orbit your head. You
//         can use your action (or bonus action) to send one of them
//         streaking toward a target within 120 feet. Make a ranged spell
//         attack. On a hit, the target takes 4d12 radiant damage. Whether
//         you hit or miss, the mote is expended. The spell ends when all
//         seven motes are expended or the spell ends.
//
// v1 simplifications:
//   - 7-mote storage (XGE p.152: "seven motes"; 1 mote per action/bonus
//     action for up to 7 turns): v1 simplifies to a single one-shot
//     attack (4d12 radiant). The per-turn mote expenditure is NOT modelled
//     (same gap as Witch Bolt's per-turn DoT, but Crown of Stars is a
//     RESOURCE pool, not a concentration DoT — v1 has no per-turn resource
//     tracking for it). Documented via `crownOfStars7MoteStorageV1Simplified: true`.
//   - Range: canon 120 ft (XGE p.152). v1 uses 120 ft.
//   - Hit bonus: v1 falls back to the action's hitBonus. If null, falls
//     back to abilityMod(caster.int) (Wizard primary — Crown of Stars is
//     a Wizard/Sorcerer spell, XGE p.152). Mirrors Scorching Ray.
//   - Crit DOES double the dice (standard PHB p.196 crit rule for spell
//     attacks). Documented via `crownOfStarsCritDoublesV1: true`.
//   - NOT concentration (XGE p.152: "no concentration, 1 hour" — the 1-hr
//     duration is the mote storage, which v1 simplifies away).
//
// Migration note (Session 24): Mirrors Chromatic Orb (Session 21) for the
// single-target ranged spell attack pattern, but 4d12 radiant, L7 slot,
// 120-ft range.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollAttack, rollDie, applyDamageWithTempHP, abilityMod } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Crown of Stars',
  level: 7,
  school: 'evocation',
  rangeFt: 120,                  // XGE p.152: 120 ft
  dieCount: 4,
  dieSides: 12,
  damageType: 'radiant' as const,
  concentration: false,
  castingTime: 'action',
  crownOfStars7MoteStorageV1Simplified: true,                          // 7-mote storage simplified to single one-shot attack
  crownOfStarsCritDoublesV1: true,                                    // crit doubles the 4d12 (PHB p.196)
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function rollDamage(isCrit = false): number {
  let total = 0;
  const rolls = isCrit ? metadata.dieCount * 2 : metadata.dieCount;
  for (let i = 0; i < rolls; i++) total += rollDie(metadata.dieSides);
  return total;
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Crown of Stars')) return null;
  if (!hasSpellSlot(caster, 7)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  const candidates: Array<{ c: Combatant; threat: number; curHP: number; dist: number }> = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 120) continue;
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
  const action = caster.actions.find(a => a.name === 'Crown of Stars');
  const hitBonus = action?.hitBonus ?? abilityMod(caster.int);

  consumeSpellSlot(caster, 7);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Crown of Stars! (ranged spell attack, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} on hit [1 mote, v1: 7-mote storage simplified], crit doubles dice)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(state, 'attack_miss', caster.id, `Crown of Stars: ${target.name} is already down — the mote streaks past.`, target.id);
    return;
  }

  const result = rollAttack(hitBonus, false, false);
  const effectiveAC = target.ac;

  if (result.total < effectiveAC && !result.isCrit) {
    emit(
      state, 'attack_miss', caster.id,
      `${caster.name} misses ${target.name} with Crown of Stars mote (rolled ${result.roll}+${hitBonus}=${result.total} vs AC ${effectiveAC}) — no radiant damage!`,
      target.id, result.roll,
    );
    return;
  }

  emit(
    state, result.isCrit ? 'attack_crit' : 'attack_hit', caster.id,
    `${caster.name} ${result.isCrit ? 'CRITS' : 'hits'} ${target.name} with a Crown of Stars mote (${result.total} vs AC ${effectiveAC})`,
    target.id, result.roll,
  );

  const dmg = rollDamage(result.isCrit);
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
  emit(
    state, 'damage', caster.id,
    `Crown of Stars: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg}${result.isCrit ? ', CRIT doubled' : ''})`,
    target.id, dealt,
  );
}

export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot.
}
