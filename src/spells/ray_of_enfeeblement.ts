// ============================================================
// Ray of Enfeeblement — PHB p.271
//
// 2nd-level necromancy, action, range 60 ft, concentration (1 min).
// Components: V, S.
//
// Effect: A black beam of enervating energy springs from your finger
//         toward a creature within range. Make a ranged spell attack
//         against the target. On a hit, the target deals only half damage
//         with weapon attacks that use Strength, until the spell ends.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - Strength-weapon-only: PHB p.271 says "weapon attacks that use
//     Strength." v1 simplification: applies to ALL weapon attacks
//     (melee/ranged, NOT spell — mirror Enlarge/Reduce 'reduce' pattern
//     but on a target, not the attacker). The +DEX/+STR distinction is
//     not tracked per-attack. Documented via the metadata flag
//     `rayOfEnfeeblementStrOnlyV1Simplified: true`.
//   - Scratch-field mechanic: while the target has
//     `_rayOfEnfeeblementActive === true`, resolveAttack's damage branch
//     (in combat.ts) checks the ATTACKER's flag and halves the weapon
//     damage (PHB p.197 resistance — but NOT actual resistance so it
//     composes by halving first). The scratch field is set on the
//     enfeebled TARGET, but read on the ATTACKER when the attacker
//     attacks anyone (the attacker IS the enfeebled target — the enfeeble
//     makes the enfeebled creature's own weapon attacks deal half damage).
//   - Damage_zone sentinel: a damage_zone effect with dieCount=0 anchors
//     concentration-break cleanup. removeEffectsFromCaster's _undoEffect
//     branch for 'Ray of Enfeeblement' clears the scratch field on
//     concentration break. The start-of-turn damage tick naturally skips
//     dieCount=0 effects (the existing `if (dieCount <= 0) continue;` check).
//     (The _undoEffect branch for Ray of Enfeeblement is implemented in
//     a separate task — this module only writes the scratch field + the
//     sentinel effect.)
//   - On cast: ranged spell attack vs target AC. NO damage on the attack
//     itself (canon: the spell does no damage — just applies the debuff).
//   - On miss: spell is wasted (slot consumed, no effect).
//   - Duration: canon 1 min concentration → v1: concentration is started,
//     but NOT enforced (TG-002).
//   - Upcast: N/A (no At Higher Levels entry).
//   - Single-target (PHB p.271: "a creature").
//
// Spell module pattern (mirrors melf_s_acid_arrow.ts's ranged spell
// attack pattern, but with NO damage roll on hit):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (concentration break handles scratch-field cleanup
//                  via the sentinel effect's _undoEffect branch)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { rollAttack, abilityMod, startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Ray of Enfeeblement',
  level: 2,
  school: 'necromancy',
  rangeFt: 60,
  concentration: true,
  castingTime: 'action',
  rayOfEnfeeblementStrOnlyV1Simplified: true,                     // v1: applies to ALL weapon attacks (canon: STR-only)
  rayOfEnfeeblementUpcastV1Implemented: false,                    // (no upcast entry — placeholder)
  rayOfEnfeeblementConcentrationEnforcementV1Implemented: false,  // see TG-002
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

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Ray of Enfeeblement (a living enemy
 * within 60 ft that has at least one weapon attack in its action list),
 * or null when the spell should not be cast.
 *
 * Target priority:
 *   1. Highest-threat enemy (maxHP) within 60 ft that has at least one
 *      action with attackType 'melee' or 'ranged' (v1 simplification —
 *      the debuff is wasted on a creature with no weapon attacks).
 *   2. Tie-break: closest enemy.
 *
 * Preconditions:
 *   - Caster has 'Ray of Enfeeblement' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target with a weapon attack exists within 60 ft
 *
 * Note: Ray of Enfeeblement IS concentration — it cannot be cast while
 * concentrating on another spell. The planner gates on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Ray of Enfeeblement')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    // v1 gate: target must have at least one weapon attack (melee/ranged).
    // The debuff is wasted on a creature with no weapon attacks.
    const hasWeaponAttack = c.actions.some(a =>
      a.attackType === 'melee' || a.attackType === 'ranged'
    );
    if (!hasWeaponAttack) continue;

    // Skip if already enfeebled by this caster.
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Ray of Enfeeblement'
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
 * Execute Ray of Enfeeblement:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Ray of Enfeeblement.
 *  4. Make a ranged spell attack vs the target's AC.
 *     - Attack bonus = caster's spellcasting mod (INT for Wizard, CHA for
 *       Warlock, WIS for Cleric — Ray of Enfeeblement is on the Warlock
 *       list so CHA is canon). v1 uses the action's hitBonus if set,
 *       else falls back to CHA mod.
 *  5. On hit:
 *     - Set `target._rayOfEnfeeblementActive = true` (scratch field).
 *       resolveAttack's damage branch checks the ATTACKER's flag and
 *       halves weapon damage if true. (The enfeebled TARGET is the
 *       attacker when it attacks anyone — the enfeeble makes the
 *       enfeebled creature's own weapon attacks deal half damage.)
 *     - Apply a damage_zone SENTINEL effect (dieCount=0) to anchor
 *       concentration-break cleanup. The sentinel has sourceIsConcentration:
 *       true (removed when concentration breaks). The _undoEffect branch
 *       for 'Ray of Enfeeblement' (in spell_effects.ts — separate task)
 *       clears the scratch field on removal.
 *  6. On miss: NO scratch field, NO sentinel — spell wasted (slot consumed).
 *
 * v1 simplifications: applies to ALL weapon attacks (canon: STR-only);
 * no damage on the attack (canon: no damage); upcast N/A; concentration
 * NOT enforced (TG-002).
 *
 * @param caster  The casting Combatant (Warlock/Wizard/Sorcerer)
 * @param target  The candidate from shouldCast (single enemy with weapon attacks in range)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Ray of Enfeeblement');
  // Ray of Enfeeblement is on the Warlock list (CHA). Fall back to CHA mod.
  const hitBonus = action?.hitBonus ?? abilityMod(caster.cha);

  consumeSpellSlot(caster, 2);

  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Ray of Enfeeblement');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Ray of Enfeeblement at ${target.name}! (ranged spell attack, no damage, enfeeble on hit, concentration 1 min)`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  const result = rollAttack(hitBonus, false, false);
  const effectiveAC = target.ac;

  if (result.total < effectiveAC && !result.isCrit) {
    emit(
      state, 'attack_miss', caster.id,
      `${caster.name} misses ${target.name} with Ray of Enfeeblement (rolled ${result.roll}+${hitBonus}=${result.total} vs AC ${effectiveAC}) — no enfeeble!`,
      target.id, result.roll,
    );
    return;
  }

  emit(
    state, result.isCrit ? 'attack_crit' : 'attack_hit', caster.id,
    `${caster.name} ${result.isCrit ? 'CRITS' : 'hits'} ${target.name} with Ray of Enfeeblement (${result.total} vs AC ${effectiveAC}) — enfeebled!`,
    target.id, result.roll,
  );

  // On hit: set the scratch field (read by resolveAttack's damage branch).
  target._rayOfEnfeeblementActive = true;

  // Attach a damage_zone SENTINEL (dieCount=0) so removeEffectsFromCaster
  // clears the scratch field on concentration break. The sentinel itself
  // deals no damage (the start-of-turn tick skips dieCount=0 effects).
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Ray of Enfeeblement',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 0, damageType: 'necrotic' },
    sourceIsConcentration: true,
  });

  emit(
    state, 'condition_add', caster.id,
    `${target.name} is enfeebled! (weapon attacks deal half damage while active)`,
    target.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Ray of Enfeeblement — NO-OP in v1 because:
 *   - The scratch field + sentinel effect are cleaned via
 *     removeEffectsFromCaster's _undoEffect branch for 'Ray of
 *     Enfeeblement' (separate task in spell_effects.ts), which fires
 *     when the caster's concentration breaks.
 *   - v1 does NOT enforce concentration checks (TG-002), so concentration
 *     effectively persists for the entire combat.
 *
 * Exported for symmetry with the other spell modules' cleanup pattern.
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via the sentinel effect.
}
