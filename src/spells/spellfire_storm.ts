// ============================================================
// Spellfire Storm — SCAG p.150 (Sword Coast Adventurer's Guide)
//
// 4th-level evocation, action, range 60 ft. Canon: concentration,
// up to 1 minute (DoT). v1: concentration + DoT simplified to one-shot.
// Components: V, S.
//
// Effect: You unleash a storm of spellfire at a creature within range.
//         The target takes 4d10 fire damage, plus an extra 1d10 per slot
//         level above 4th. (Canon also has a DoT rider — see below.)
//
// Upcast: +1d10 fire per slot level above 4th (not modelled in v1).
//
// v1 simplifications:
//   - Concentration + DoT (SCAG p.150: "concentration, up to 1 minute";
//     the spell deals 4d10 fire on the first turn and 2d10 at the end of
//     each subsequent turn): v1 simplifies to a single one-shot 4d10 fire
//     hit (concentration: false). The per-turn DoT is NOT modelled — v1
//     has no per-turn-action-DoT subsystem for concentration spells
//     (Witch Bolt's per-turn DoT was implemented because it uses the
//     caster's ACTION each turn; Spellfire Storm's is end-of-target-turn,
//     a different hook v1 doesn't expose). Documented via
//     `spellfireStormDoTV1Simplified: true`.
//   - Auto-hit: SCAG p.150 has NO attack roll and NO save — the target
//     always takes the damage (mirrors Spellfire Flare, Session 24).
//     Documented via `spellfireStormAutoHitV1Implemented: true`.
//   - +spellcasting ability mod: SCAG p.150 does NOT add the spellcasting
//     mod (unlike Spellfire Flare). 4d10 fire only.
//   - Upcast: NOT modelled.
//
// Migration note (Session 24): Mirrors Spellfire Flare (Session 24) but
// with 4d10 fire (no +mod), L4 slot, 60-ft range. Auto-hit single-target.
//
// Spell module pattern (auto-hit single-target — mirrors spellfire_flare.ts):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (v1 one-shot)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Spellfire Storm',
  level: 4,
  school: 'evocation',
  rangeFt: 60,                   // SCAG p.150: 60 ft
  dieCount: 4,
  dieSides: 10,
  damageType: 'fire' as const,
  concentration: false,          // v1 simplification: one-shot (canon concentration 1 min + DoT)
  castingTime: 'action',
  spellfireStormAutoHitV1Implemented: true,                           // auto-hit (no save, no attack)
  spellfireStormDoTV1Simplified: true,                                // per-turn DoT NOT modelled
  spellfireStormUpcastV1Implemented: false,                           // +1d10/slot-level NOT modelled
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
  if (!caster.actions.some(a => a.name === 'Spellfire Storm')) return null;
  if (!hasSpellSlot(caster, 4)) return null;

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
  consumeSpellSlot(caster, 4);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Spellfire Storm at ${target.name}! (AUTO-HIT — no save, no attack; ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType})`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) {
    emit(state, 'action', caster.id, `Spellfire Storm: ${target.name} is already down — the storm dissipates.`, target.id);
    return;
  }

  const dmg = rollDamage();
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);
  emit(
    state, 'damage', caster.id,
    `Spellfire Storm: ${target.name} takes ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${dmg}, auto-hit)`,
    target.id, dealt,
  );
}

export function cleanup(_c: Combatant): void {
  // No-op — v1 one-shot.
}
