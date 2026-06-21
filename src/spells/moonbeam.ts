// ============================================================
// Moonbeam — PHB p.261
//
// 2nd-level evocation, action, range 120 ft, concentration (1 min).
// Components: V, S, M (several seeds of any moonflower seed and a piece
//             of opalescent feldspar).
//
// Effect: A silvery beam of pale light shines down in a 5-foot-radius,
//         40-foot-high cylinder centered on a point within range. Until
//         the spell ends, a creature takes 2d10 radiant damage when it
//         enters the spell's area for the first time on a turn or starts
//         its turn there.
//
//         Shapechangers make their saving throw with disadvantage.
//
// Upcast: +1d10 radiant per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - AoE shape: canon 5-ft radius cylinder at a point within 120 ft.
//     v1 simplification: targets a SINGLE enemy within 120 ft (the
//     cylinder's center). The cylinder is canonically a 5-ft radius
//     (10-ft diameter) so it can hit a few clustered creatures, but v1
//     picks the highest-threat enemy as the cylinder's center and
//     applies damage to that enemy only. Forward-compat TODO via the
//     metadata flag `moonbeamCylinderAoeV1Implemented: false`.
//   - Cylinder movement: PHB p.261 says "you can use an action to move
//     the beam up to 60 feet in any direction." v1 does NOT model the
//     action-move (no positional AoE subsystem). The beam is anchored
//     to the target for v1's purposes. Forward-compat TODO via the
//     metadata flag `moonbeamMovementV1Implemented: false`.
//   - Persistent damage: PHB p.261 says "A creature takes 2d10 radiant
//     damage when it enters the spell's area for the first time on a
//     turn OR starts its turn there." v1 implements BOTH triggers:
//       1. On cast: 2d10 radiant to the target (the "enters the area
//          for the first time on a turn" trigger — the target is in
//          the area when the spell is cast).
//       2. At the start of each of the target's turns: 2d10 radiant
//          (the "starts its turn there" trigger) via the `damage_zone`
//          effect type + a start-of-turn hook in combat.ts's runCombat
//          loop. CON save for half.
//   - Duration: canon 1 min concentration → v1: concentration is
//     started via startConcentration(), but NOT enforced (TG-002).
//   - Upcast: +1d10/slot-level NOT modelled — v1 always rolls 2d10
//     radiant. Forward-compat TODO via `moonbeamUpcastV1Implemented: false`.
//   - Shapechanger disadvantage: v1 has no "shapechanger" creature
//     type tag — the disadvantage on the CON save is NOT applied.
//     Documented via the implicit metadata flag (no separate flag —
//     the engine has no creature-type subsystem to gate on).
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (concentration break handled by removeEffectsFromCaster)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Moonbeam',
  level: 2,
  school: 'evocation',
  rangeFt: 120,
  dieCount: 2,
  dieSides: 10,
  damageType: 'radiant' as const,
  concentration: true,
  saveAbility: 'con' as const,
  castingTime: 'action',
  moonbeamCylinderAoeV1Implemented: false,                      // single-target only
  moonbeamMovementV1Implemented: true,                           // beam movement modelled (v1: automatic, no action cost)
  moonbeamUpcastV1Implemented: false,                            // +1d10/slot-level NOT modelled
  moonbeamConcentrationEnforcementV1Implemented: true,          // TG-002 DONE (Session 34)
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

/**
 * Roll `metadata.dieCount`d`metadata.dieSides` and return the total.
 * Used for both the on-cast damage and the persistent start-of-turn damage.
 */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Moonbeam (a living enemy within
 * 120 ft, not already in a Moonbeam cylinder from this caster), or null
 * when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (highest maxHP) within 120 ft — the
 *      persistent 2d10 radiant/turn is most valuable against a high-HP
 *      target that will survive multiple rounds.
 *   2. Tie-break: closest enemy.
 *
 * Preconditions:
 *   - Caster has 'Moonbeam' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 120 ft
 *
 * Note: Moonbeam IS concentration — it cannot be cast while
 * concentrating on another spell. The planner gates on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Moonbeam')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 120) continue;

    // Skip if already in a Moonbeam cylinder from this caster (re-cast
    // would only refresh the duration — wasteful in v1).
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Moonbeam'
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
 * Execute Moonbeam:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Moonbeam.
 *  4. Roll the target's CON save vs the caster's saveDC. On fail, 2d10
 *     radiant; on success, half (floor). Apply immediately.
 *  5. Apply a `damage_zone` effect with saveDC + saveAbility + dieCount +
 *     dieSides + damageType. The start-of-turn damage tick (combat.ts
 *     runCombat loop) rolls the save and applies half-on-success.
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Moonbeam');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Moonbeam');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Moonbeam at ${target.name}! (DC ${saveDC} CON, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, half on save)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  // On-cast damage: CON save for half.
  const save = rollSave(target, 'con', saveDC);
  const fullDmg = rollDamage();
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} CON save vs Moonbeam (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
    target.id, save.roll,
  );
  emit(
    state, 'damage', caster.id,
    `${target.name} takes ${dealt} ${metadata.damageType} damage from Moonbeam (on cast)`,
    target.id, dealt,
  );

  // Persistent damage_zone — start-of-turn tick rolls CON save for half.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Moonbeam',
    effectType: 'damage_zone',
    payload: {
      dieCount: metadata.dieCount,
      dieSides: metadata.dieSides,
      damageType: metadata.damageType,
      saveDC,
      saveAbility: metadata.saveAbility,
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is bathed in moonlight! (will take ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} at the start of each of its turns, CON save for half)`,
    target.id,
  );

  // Set _movingZone on the caster so the beam can move at the start of
  // each of the caster's turns (v1: automatic movement toward highest-threat
  // enemy, no action cost — canon requires an action to move 60 ft).
  caster._movingZone = {
    spellName: 'Moonbeam',
    centerX: target.pos.x,
    centerY: target.pos.y,
    centerZ: target.pos.z,
    radiusFt: 5,     // 5-ft radius cylinder (PHB p.261)
    movePerTurn: 60,  // 60 ft per turn (PHB p.261: action move up to 60 ft)
  };
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Moonbeam — NO-OP in v1 because:
 *   - Moonbeam is a concentration spell; the damage_zone effect is removed
 *     via removeEffectsFromCaster() when concentration breaks.
 *   - v1 does NOT enforce concentration checks (TG-002), so concentration
 *     effectively persists for the entire combat.
 *
 * Exported for symmetry with the other spell modules' cleanup pattern.
 * The start-of-turn damage tick (the "starts its turn there" trigger)
 * is handled by a separate hook in combat.ts's runCombat loop, NOT by
 * this cleanup function.
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
