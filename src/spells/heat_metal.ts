// ============================================================
// Heat Metal — PHB p.250
//
// 2nd-level transmutation, action, range 60 ft, concentration (1 min).
// Components: V, S, M (a piece of iron and a flame).
//
// Effect: Choose a manufactured metal object, such as a metal weapon or a
//         suit of heavy or medium metal armor, that you can see within range.
//         You cause the object to glow red-hot. Any creature in physical
//         contact with the object takes 2d8 fire damage when you cast the
//         spell. Until the spell ends, you can use a bonus action on each of
//         your subsequent turns to cause this damage again.
//
//         If a creature is holding or wearing the object and takes damage
//         from this spell, the creature must succeed on a Constitution
//         saving throw or drop the object. If it doesn't drop the object,
//         it has disadvantage on attack rolls and ability checks until the
//         spell ends.
//
// Upcast: +1d8 fire per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - Targeting: v1 targets a creature (the holder/wearer), not the object
//     directly. The spell still deals 2d8 fire on cast and 2d8 fire at the
//     start of each of the target's turns (the "bonus action on each of
//     your subsequent turns" is approximated by the damage_zone start-of-
//     turn tick on the TARGET's turn, not the caster's — this is a v1
//     timing simplification). Forward-compat TODO via the metadata flag
//     `heatMetalBonusActionRepeatV1Implemented: false`.
//   - CON save to drop object: v1 does NOT model the "drop the object"
//     mechanic (no object-tracking subsystem). The CON save IS rolled on
//     cast (for logging purposes), but failure doesn't cause the target to
//     drop anything. Forward-compat TODO via the metadata flag
//     `heatMetalDropObjectV1Implemented: false`.
//   - Disadvantage on attacks/ability checks (while holding the hot object):
//     v1 does NOT model this rider (forward-compat TODO via the metadata flag
//     `heatMetalHoldingDisadvantageV1Implemented: false`).
//   - No save on the persistent damage (PHB p.250: the damage is automatic;
//     the CON save is only to drop the object, which v1 doesn't model).
//   - Metal-object requirement: v1 does NOT verify the target is wearing/
//     holding metal (no `hasMetalArmor` check on the target — the parser
//     tech debt is tracked in TG-004). All living enemies are valid targets.
//   - Duration: canon 1 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002).
//   - Upcast: +1d8/slot-level NOT modelled — v1 always rolls 2d8 fire.
//
// Spell module pattern:
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Heat Metal',
  level: 2,
  school: 'transmutation',
  rangeFt: 60,
  dieCount: 2,
  dieSides: 8,
  damageType: 'fire' as const,
  concentration: true,
  saveAbility: 'con' as const,        // CON save to drop object (v1: rolled for logging only)
  castingTime: 'action',
  heatMetalBonusActionRepeatV1Implemented: false,             // bonus-action repeat NOT modelled
  heatMetalDropObjectV1Implemented: false,                    // drop-object mechanic NOT modelled
  heatMetalHoldingDisadvantageV1Implemented: false,           // holding disadv NOT modelled
  heatMetalMetalObjectCheckV1Implemented: false,              // metal-object check skipped (TG-004)
  heatMetalUpcastV1Implemented: false,                        // +1d8/slot-level NOT modelled
  heatMetalConcentrationEnforcementV1Implemented: true,      // TG-002 DONE (Session 34)
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

export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Heat Metal (a living enemy within 60 ft,
 * not already Heat-Metal'd by this caster), or null when the spell should
 * not be cast.
 *
 * Target priority: highest-threat enemy (maxHP) within 60 ft — the
 * persistent 2d8 fire/turn is most valuable against a high-HP target.
 *
 * Preconditions:
 *   - Caster has 'Heat Metal' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 60 ft
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Heat Metal')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Heat Metal'
    )) continue;

    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Heat Metal:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Heat Metal.
 *  4. Roll 2d8 fire and apply to the target immediately (no save — the
 *     damage is automatic per PHB p.250).
 *  5. Roll the target's CON save (for logging only — v1 does NOT model the
 *     "drop the object" mechanic).
 *  6. Apply a `damage_zone` effect (2d8 fire, NO save on tick — the damage
 *     is automatic). The start-of-turn damage tick (combat.ts runCombat loop)
 *     applies 2d8 fire each turn.
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Heat Metal');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Heat Metal');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Heat Metal on ${target.name}'s equipment! (${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, no save on damage)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  // On-cast damage: 2d8 fire (no save — automatic per PHB p.250).
  const immediateDmg = rollDamage();
  const dealtImmediate = applyDamageWithTempHP(target, immediateDmg, metadata.damageType);
  emit(
    state, 'damage', caster.id,
    `${target.name} takes ${dealtImmediate} ${metadata.damageType} damage from Heat Metal (on cast: ${metadata.dieCount}d${metadata.dieSides}=${immediateDmg})`,
    target.id, dealtImmediate,
  );

  // CON save (for logging only — v1 does NOT model the drop-object mechanic).
  const save = rollSaveReactable(state, caster, target, 'con', saveDC);
  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Heat Metal (rolled ${save.total}) — ${save.success ? 'holds firm' : 'would drop the object if modelled (v1: no drop mechanic)'}!`,
    target.id, save.roll,
  );

  // Persistent damage_zone — 2d8 fire/turn, NO save (automatic per PHB p.250).
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Heat Metal',
    effectType: 'damage_zone',
    payload: {
      dieCount: metadata.dieCount,
      dieSides: metadata.dieSides,
      damageType: metadata.damageType,
      // No saveDC / saveAbility — damage is automatic.
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name}'s equipment glows red-hot! (will take ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} at the start of each of its turns)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
