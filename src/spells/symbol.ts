// ============================================================
// Symbol — PHB p.280
//
// 7th-level abjuration, 1-hour casting time (ritual-like), range touch,
// concentration (10 min after triggered). Components: V, S, M (mercury,
// phosphorus, powdered diamond worth ≥50 gp, opal worth ≥100 gp).
//
// Effect: You draw a glyph on a surface (or in the air). When a creature
// touches the glyph or enters a 10-ft area around it, it triggers. Choose
// one of 7 effects:
//   - Death    (CON save or 10d10 necrotic)
//   - Discord  (CON save or 1 min bickering; disadv on attacks + ability checks)
//   - Fear     (WIS save or frightened for 1 min; drop weapon if holding)
//   - Hopelessness (CHA save or cannot take attack actions or target with harmful spells for 1 min)
//   - Pain     (CON save or 1d4 psychic each turn + disadv on attacks while in area)
//   - Sleep    (CON save or unconscious for 10 min)
//   - Stunning (WIS save or stunned for 1 min)
//
// Upcast: +1 effect per slot level above 7th (each additional glyph can
// store a different effect). NOT modelled in v1.
//
// v1 simplifications:
//   - Casting time: canon 1 hour. v1: action (treat as "Symbol was pre-placed;
//     triggered now"). 1-hour cast is out-of-combat normally.
//   - Glyph placement: NOT modelled. v1 treats the spell as an instantaneous
//     targeted debuff on a single enemy within 30 ft (v1 trigger radius).
//   - Trigger AoE: NOT modelled. v1 picks the highest-HP enemy within 30 ft
//     and applies the effect directly.
//   - Effect variety: NOT modelled. v1 ALWAYS uses "Pain" (CON save → 1d4
//     psychic damage each turn + disadv on attacks while in area).
//   - "10-ft area" tracking: NOT modelled. v1 applies the effect as a
//     persistent `damage_zone` on the target (1d4 psychic, no save on tick —
//     pain is ongoing per PHB p.280) PLUS `advantage_vs` with
//     advType='disadvantage' (representing the target's attacks having disadv).
//   - Upcast: NOT modelled.
//   - "Leaves the area ends effect": NOT modelled (no zone subsystem).
//
// Spell module pattern (single-target debuff + DoT, concentration):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (removeEffectsFromCaster handles conc cleanup)
//
// Combat value: MEDIUM. Single-target DoT + attack disadv. ~10 creatures
// know it (per coverage report).
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Symbol', level: 7, school: 'abjuration', rangeFt: 30,
  concentration: true, saveAbility: 'con' as const, castingTime: 'action',
  symbolCastTimeV1Simplified: true,           // canon 1 hour → v1 action
  symbolGlyphPlacementV1Implemented: false,    // no glyph-on-surface subsystem
  symbolEffectPainOnlyV1Implemented: true,     // v1 always picks "Pain"
  symbolUpcastV1Implemented: false,            // additional glyphs not modelled
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Symbol')) return null;
  if (!hasSpellSlot(caster, 7)) return null;
  if (caster.concentration?.active) return null;  // can't concentrate on 2 spells

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 30) continue;
    // Skip if already affected by this caster's Symbol
    if (c.activeEffects.some(e => e.casterId === caster.id && e.spellName === 'Symbol')) continue;
    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.threat !== b.threat ? b.threat - a.threat : a.dist - b.dist);
  return candidates[0].c;
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Symbol');
  const saveDC = action?.saveDC ?? 17;
  consumeSpellSlot(caster, 7);

  // Drop stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Symbol');

  emit(state, 'action', caster.id,
    `${caster.name} casts Symbol (Pain) at ${target.name}! (v1: trigger-radius 30 ft, canon 1-hour cast; DC ${saveDC} CON)`,
    target.id);

  if (target.isDead || target.isUnconscious) return;

  // Pain: CON save; on fail, target takes 1d4 psychic each turn + disadv on attacks.
  const save = rollSaveReactable(state, caster, target, 'con', saveDC);
  emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Symbol (Pain) (rolled ${save.total})`,
    target.id, save.roll);

  if (save.success) {
    emit(state, 'action', caster.id, `${target.name} resists Symbol (Pain)!`, target.id);
    return;
  }

  // Apply (a) damage_zone: 1d4 psychic per turn, NO save on tick (PHB p.280 Pain)
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Symbol',
    effectType: 'damage_zone',
    payload: {
      dieCount: 1,
      dieSides: 4,
      damageType: 'psychic',
      // No saveDC/saveAbility on the tick — Pain is automatic per PHB p.280
    },
    sourceIsConcentration: true,
    sourceCreatureType: caster.creatureType,
  });
  // Apply (b) advantage_vs with advType='disadvantage' (target's attacks have disadv)
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Symbol',
    effectType: 'advantage_vs',
    payload: {
      advType: 'disadvantage',
    },
    sourceIsConcentration: true,
    sourceCreatureType: caster.creatureType,
  });
  emit(state, 'condition_add', caster.id,
    `${target.name} is afflicted by Symbol (Pain) — 1d4 psychic each turn + attacks have disadvantage (concentration)!`,
    target.id);
}

export function cleanup(_c: Combatant): void { /* no-op — removeEffectsFromCaster handles conc cleanup */ }
