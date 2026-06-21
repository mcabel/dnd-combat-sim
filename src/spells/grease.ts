// ============================================================
// Grease — PHB p.245
//
// 1st-level conjuration, action, range 60 ft, NO concentration (1 min).
// Components: V, S, M (a bit of pork rind or butter).
//
// Effect: Slick grease covers the ground in a 10-foot square centered on
//         a point within range. When the grease appears, each creature
//         standing in its area must succeed on a Dexterity saving throw
//         or fall prone. A creature can also fall prone when it enters
//         the grease... (persistent-difficult-terrain rider simplified.)
//
// Upcast: none (1st-level spell — no upcast).
//
// v1 simplifications:
//   - Shape: canon 10-foot square. v1 treats as a 10-ft-radius sphere
//     centered on the highest-threat enemy within 60 ft (mirrors Sunburst
//     — square approx). Documented via `greaseSquareV1SimplifiedToRadius`.
//   - Persistent terrain: v2 implements start-of-turn terrain zone check.
//     Canon says creatures entering the grease also save immediately;
//     v2 only checks at start of turn (documented via
//     `greasePersistentTerrainV2StartOfTurnOnly`). On-enter check
//     requires deeper movement system integration (v3).
//   - No damage (PHB p.245: no damage roll).
//   - Duration: canon 1 min (no concentration). v1 has no duration tracker
//     — the terrain_zone effect persists for the combat. NOT concentration.
//
// Migration note (Session 25 / Batch 2): migrated from the generic
// forward-compat flag to a bespoke DEX-save-or-prone AoE (no conc).
// Removed from `_generic_registry.ts`; routed via `case 'grease':` in
// combat.ts and a planner branch in planner.ts. Mirrors Sunburst (radius
// AoE save + condition) but prone + no damage + no conc.
//
// Spell module pattern (radius AoE save + condition, NO concentration):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   cleanup() — no-op (no concentration; prone persists for combat)
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { rollSave } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Grease', level: 1, school: 'conjuration', rangeFt: 60,
  aoeRadiusFt: 10, concentration: false, saveAbility: 'dex' as const, castingTime: 'action',
  greaseSquareV1SimplifiedToRadius: true,                      // 10-ft square → 10-ft radius
  greasePersistentTerrainV2StartOfTurnOnly: true,             // start-of-turn check; on-enter deferred to v3
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Grease')) return null;
  if (!hasSpellSlot(caster, 1)) return null;
  const enemies = livingEnemiesOf(caster, bf);
  let center: Combatant | null = null;
  let centerThreat = -1;
  let centerDist = Infinity;
  for (const e of enemies) {
    const distFt = chebyshev3D(caster.pos, e.pos) * 5;
    if (distFt > 60) continue;
    if (e.maxHP > centerThreat || (e.maxHP === centerThreat && distFt < centerDist)) {
      center = e; centerThreat = e.maxHP; centerDist = distFt;
    }
  }
  if (!center) return null;
  const targets: Combatant[] = [];
  for (const e of enemies) {
    const distFt = chebyshev3D(center.pos, e.pos) * 5;
    if (distFt <= 10) targets.push(e);
  }
  return targets.length >= 1 ? targets : null;
}

export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
  const action = caster.actions.find(a => a.name === 'Grease');
  const saveDC = action?.saveDC ?? 13;
  consumeSpellSlot(caster, 1);
  emit(state, 'action', caster.id,
    `${caster.name} casts Grease! (DC ${saveDC} DEX, prone on fail, ${metadata.aoeRadiusFt}-ft radius) — ${targets.length} creature${targets.length !== 1 ? 's' : ''} caught!`);
  // Find the center (highest-threat enemy) for the terrain zone position
  const center = targets.reduce<Combatant | null>((best, t) => {
    if (t.isDead || t.isUnconscious) return best;
    if (!best || t.maxHP > best.maxHP) return t;
    return best;
  }, null);

  // Apply terrain_zone effect on the CASTER (not concentration)
  // This marks a persistent 10-ft radius zone at the center position
  if (center) {
    applySpellEffect(caster, {
      casterId: caster.id,
      spellName: 'Grease',
      effectType: 'terrain_zone',
      payload: {
        terrainSaveAbility: 'dex' as const,
        terrainCondition: 'prone' as Condition,
        terrainRadiusFt: 10,
        terrainCenterX: center.pos.x,
        terrainCenterY: center.pos.y,
        terrainCenterZ: center.pos.z,
      },
      sourceIsConcentration: false,
    });
  }

  for (const target of targets) {
    if (target.isDead || target.isUnconscious) continue;
    const save = rollSave(target, 'dex', saveDC);
    emit(state, save.success ? 'save_success' : 'save_fail', caster.id,
      `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Grease (rolled ${save.total})${save.success ? '' : ' + PRONE'}`, target.id, save.roll);
    if (!save.success && !target.conditions.has('prone')) {
      applySpellEffect(target, { casterId: caster.id, spellName: 'Grease', effectType: 'condition_apply', payload: { condition: 'prone' }, sourceIsConcentration: false });
      emit(state, 'condition_add', caster.id, `${target.name} slips and falls PRONE!`, target.id);
    }
  }
}

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration */ }
