// ============================================================
// Flaming Sphere — PHB p.242
//
// 2nd-level conjuration, action, range 60 ft, concentration (1 min).
// Components: V, S, M (a bit of tallow, a pinch of brimstone, and a dust
//             of dried red pepper).
//
// Effect: A 5-foot-diameter sphere of fire appears in an unoccupied space
//         within range, and the duration becomes instantaneous for it. Any
//         creature within 5 feet of the sphere when it appears must make
//         a Dexterity saving throw. A creature takes 2d6 fire damage on a
//         failed save, or half as much on a successful one.
//
//         As a bonus action, you can move the sphere up to 30 feet. If you
//         ram the sphere into a creature, that creature makes the saving
//         throw, and the sphere stops moving this turn.
//
//         When you move within 5 feet of the sphere, you can take a bonus
//         action to make it deal damage. The sphere damages creatures
//         within 5 feet of it at the end of your turn.
//
// Upcast: +1d6 fire per slot level above 2nd (not modelled in v1).
//
// v1 simplifications:
//   - AoE shape: canon 5-ft sphere at a point within 60 ft. v1 simplification:
//     targets a SINGLE enemy within 60 ft (the sphere's center). The sphere
//     deals 2d6 fire to that enemy on cast (DEX save for half) AND at the
//     start of each of the target's turns (the "ends its turn there" trigger
//     is approximated by the damage_zone start-of-turn tick — slightly
//     earlier than canon's "end of caster's turn", but consistent with
//     Cloud of Daggers's timing).
//   - Sphere movement: v1 does NOT model the bonus-action sphere movement
//     (no positional AoE subsystem). The sphere is "anchored" to the target
//     for v1's purposes. Forward-compat TODO via the metadata flag
//     `flamingSphereMovementV1Implemented: false`.
//   - Multi-creature: v1 single-target only (canon 5-ft sphere could hit
//     multiple creatures). Forward-compat TODO via the metadata flag
//     `flamingSphereMultiTargetV1Implemented: false`.
//   - Duration: canon 1 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002). The damage_zone effect persists until
//     removeEffectsFromCaster() is called.
//   - Upcast: +1d6/slot-level NOT modelled — v1 always rolls 2d6 fire.
//
// v1 uses the damage_zone effect with the new `saveDC` + `saveAbility`
// payload fields (Session 17 extension). The start-of-turn damage tick
// rolls a DEX save; on success, the damage is halved.
//
// Spell module pattern:
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Flaming Sphere',
  level: 2,
  school: 'conjuration',
  rangeFt: 60,
  aoeSizeFt: 5,
  dieCount: 2,
  dieSides: 6,
  damageType: 'fire' as const,
  concentration: true,
  saveAbility: 'dex' as const,
  castingTime: 'action',
  flamingSphereMovementV1Implemented: true,                   // sphere movement modelled (v1: automatic, no action cost)
  flamingSphereMultiTargetV1Implemented: false,               // single-target only
  flamingSphereUpcastV1Implemented: false,                    // +1d6/slot-level NOT modelled
  flamingSphereConcentrationEnforcementV1Implemented: true,  // TG-002 DONE (Session 34)
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
 * Returns the single best target for Flaming Sphere (a living enemy within
 * 60 ft, not already in a Flaming Sphere zone from this caster), or null
 * when the spell should not be cast.
 *
 * Target priority: highest-threat enemy (maxHP) within 60 ft — the
 * persistent damage is most valuable against a high-HP target.
 *
 * Preconditions:
 *   - Caster has 'Flaming Sphere' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 60 ft
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Flaming Sphere')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Flaming Sphere'
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
 * Execute Flaming Sphere:
 *  1. Consume a 2nd-level spell slot.
 *  2. Break any existing concentration (safety net).
 *  3. Start concentration on Flaming Sphere.
 *  4. Roll the target's DEX save vs the caster's saveDC. On fail, 2d6 fire;
 *     on success, half (1d6). Apply immediately.
 *  5. Apply a `damage_zone` effect with saveDC + saveAbility + dieCount +
 *     dieSides + damageType. The start-of-turn damage tick (combat.ts runCombat
 *     loop) rolls the save and applies half-on-success.
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Flaming Sphere');
  const saveDC = action?.saveDC ?? 13;

  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Flaming Sphere');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Flaming Sphere at ${target.name}! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, half on save)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  // On-cast damage: DEX save for half.
  const save = rollSave(target, 'dex', saveDC);
  const fullDmg = rollDamage();
  const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
  const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

  emit(
    state,
    save.success ? 'save_success' : 'save_fail',
    caster.id,
    `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Flaming Sphere (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
    target.id, save.roll,
  );
  emit(
    state, 'damage', caster.id,
    `${target.name} takes ${dealt} ${metadata.damageType} damage from Flaming Sphere (on cast)`,
    target.id, dealt,
  );

  // Persistent damage_zone — start-of-turn tick rolls DEX save for half.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Flaming Sphere',
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
    `${target.name} is adjacent to a Flaming Sphere! (will take ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType} at the start of each of its turns, DEX save for half)`,
    target.id,
  );

  // Set _movingZone on the caster so the sphere can move at the start of
  // each of the caster's turns (v1: automatic movement toward highest-threat
  // enemy, no action cost — canon requires a bonus action to move 30 ft).
  caster._movingZone = {
    spellName: 'Flaming Sphere',
    centerX: target.pos.x,
    centerY: target.pos.y,
    centerZ: target.pos.z,
    radiusFt: 5,     // 5-ft diameter sphere (PHB p.242)
    movePerTurn: 30,  // 30 ft per turn (PHB p.242: bonus action move up to 30 ft)
  };
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
