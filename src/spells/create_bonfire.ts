// ============================================================
// Create Bonfire — XGE p.152 (reprinted from EEPC p.16)
// Level 0 conjuration cantrip
//
// Casting time: action
// Range: 60 ft (the bonfire is created at a target point within
//   range — NOT caster-centered)
// Components: V + S (no material)
// Duration: Concentration, up to 1 minute
// Effect: You create a bonfire on ground that you can see within
//   range. Until the spell ends, the magic bonfire fills a
//   5-foot cube. Any creature in the bonfire's space when you
//   cast the spell must succeed on a Dexterity saving throw or
//   take 1d8 fire damage. A creature must also make the saving
//   throw when it moves into the bonfire's space for the first
//   time on a turn or ends its turn there.
//   The bonfire ignites flammable objects in its area that
//   aren't being worn or carried.
//
// Scaling: +1d8 at 5th level (2d8), 11th (3d8), 17th (4d8).
//
// ────────────────────────────────────────────────────────────
// Implementation (v2 — persistent damage_zone via Session 28
// engine mechanism):
// ────────────────────────────────────────────────────────────
// Create Bonfire is a persistent ground hazard cantrip.
// Canonically it has THREE damage triggers:
//
//   (1) ON-CAST: any creature in the bonfire's space when the
//       spell is cast makes a DEX save (1d8 fire on fail / half
//       on success).
//   (2) MOVE-INTO: a creature that moves into the space for the
//       first time on a turn makes the save.
//   (3) END-TURN: a creature that ends its turn in the space
//       makes the save.
//
// v2 implements triggers (1) and (3):
//   - Trigger (1): on-cast DEX save + damage (handled in execute).
//   - Trigger (3): persistent `damage_zone` effect on the target
//     (mirrors Flaming Sphere PHB p.242 pattern). The start-of-
//     turn damage tick in combat.ts rolls a DEX save for half.
//     This approximates the canon "starts its turn there" trigger
//     slightly earlier (start-of-turn vs canon end-of-turn), but
//     is consistent with Cloud of Daggers and Flaming Sphere.
//   - Trigger (2): NOT yet implemented — requires a hook in
//     executeMove (movement subsystem integration). Documented as
//     `bonfireMoveIntoV2Implemented: false` in metadata.
//
// v1 implemented ONLY trigger (1) via resolveAttack's save branch
// with no persistent effect. v2 adds the damage_zone + concentration
// using the Session 28 engine mechanisms.
//
// Routing:
//   - The AI planner emits a `createBonfire` PlannedAction (type
//     field) with a primary target within 60 ft.
//   - executePlannedAction's `case 'createBonfire':` calls this
//     module's shouldCast + execute.
//   - execute handles: on-cast DEX save + damage, start
//     concentration, apply damage_zone effect.
//
// Concentration: Create Bonfire requires concentration (XGE p.152
// "Duration: Concentration, up to 1 minute"). v2 starts
// concentration on the caster; the damage_zone effect has
// sourceIsConcentration: true so removeEffectsFromCaster cleans it
// up when concentration breaks.
//
// The "ignites flammable objects" clause is a narrative/flavor
// rider that has no mechanical effect on creatures and is
// therefore not modeled.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { rollSaveReactable, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Create Bonfire',
  level: 0,
  school: 'conjuration',
  /** Range: 60 ft (XGE p.152: "on ground that you can see within range"). */
  rangeFt: 60,
  /**
   * Concentration required (XGE p.152: "Duration: Concentration,
   * up to 1 minute"). v2 starts concentration and applies a
   * damage_zone effect that is cleaned up when concentration breaks.
   */
  concentration: true as const,
  castingTime: 'action',
  damageDice: '1d8',
  damageType: 'fire' as const,
  dieCount: 1,
  dieSides: 8,
  saveAbility: 'dex' as const,
  /** Scales at levels 5/11/17 (XGE p.152). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d8', '3d8', '4d8'] as const,
  /** Components: V + S (no M). */
  components: { v: true, s: true, m: false } as const,
  /**
   * v2: persistent damage_zone now implemented. Triggers (1) on-cast
   * and (3) start-of-turn are implemented. Trigger (2) move-into is
   * not yet implemented (requires movement subsystem hook).
   */
  bonfirePersistentV2Implemented: true as const,
  /**
   * Move-into trigger NOT yet implemented (requires a hook in
   * executeMove). Documented as a forward-compat flag.
   */
  bonfireMoveIntoV2Implemented: false as const,
  /**
   * Size of the bonfire's space in feet (XGE p.152: "fills a
   * 5-foot cube").
   */
  bonfireSizeFt: 5 as const,
} as const;

// ---- shouldCast ---------------------------------------------

/**
 * Returns the best target for Create Bonfire (a living enemy within
 * 60 ft, not already in a Create Bonfire zone from this caster),
 * or null when the spell should not be cast.
 *
 * Preconditions:
 *   - Caster is NOT already concentrating on any spell
 *   - At least 1 valid enemy target exists within 60 ft
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;

  // Find the best target: highest-threat (maxHP) enemy within 60 ft
  // not already in a Create Bonfire zone from this caster.
  const candidates: Array<{ c: Combatant; threat: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > metadata.rangeFt) continue;

    // Already in a Create Bonfire zone from this caster — skip
    if (c.activeEffects.some(e =>
      e.casterId === caster.id && e.spellName === 'Create Bonfire'
    )) continue;

    candidates.push({ c, threat: c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Priority: highest threat (maxHP), then closest
  candidates.sort((a, b) => {
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- execute ------------------------------------------------

/**
 * Execute Create Bonfire:
 *  1. Break any existing concentration (safety net).
 *  2. Start concentration on Create Bonfire.
 *  3. Roll the target's DEX save vs the caster's saveDC. On fail,
 *     1d8 fire; on success, half.
 *  4. Apply a `damage_zone` effect with saveDC + saveAbility. The
 *     start-of-turn damage tick (combat.ts runCombat loop) rolls
 *     the save and applies half-on-success.
 *
 * Does NOT consume a spell slot — this is a cantrip (level 0).
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  const action = caster.actions.find(a => a.name === 'Create Bonfire');
  const saveDC = action?.saveDC ?? 13;

  // Break existing concentration before starting new one
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Create Bonfire');

  // On-cast damage: DEX save for half
  if (!target.isDead && !target.isUnconscious) {
    const save = rollSaveReactable(state, caster, target, metadata.saveAbility, saveDC);
    const fullDmg = rollDamage();
    const dmg = save.success ? Math.floor(fullDmg / 2) : fullDmg;
    const dealt = applyDamageWithTempHP(target, dmg, metadata.damageType);

    state.log.events.push({
      round: state.battlefield.round ?? 0,
      actorId: caster.id,
      type: save.success ? 'save_success' : 'save_fail',
      targetId: target.id,
      description: `${target.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} DEX save vs Create Bonfire (rolled ${save.total}) — ${dealt} ${metadata.damageType} damage (${metadata.dieCount}d${metadata.dieSides}=${fullDmg}${save.success ? ', halved' : ''})`,
      value: save.roll,
    });
    state.log.events.push({
      round: state.battlefield.round ?? 0,
      actorId: caster.id,
      type: 'damage',
      targetId: target.id,
      description: `${target.name} takes ${dealt} ${metadata.damageType} damage from Create Bonfire (on cast)`,
      value: dealt,
    });
  }

  // Persistent damage_zone — start-of-turn tick rolls DEX save for half.
  // Mirrors Flaming Sphere PHB p.242 pattern exactly.
  applySpellEffect(target, {
    casterId: caster.id,
    spellName: 'Create Bonfire',
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

  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: caster.id,
    type: 'action',
    targetId: target.id,
    description: `${caster.name} casts Create Bonfire at ${target.name}! (DC ${saveDC} DEX, ${metadata.dieCount}d${metadata.dieSides} ${metadata.damageType}, half on save, persistent)`,
  });
}

// ---- Dice helper --------------------------------------------

/**
 * Roll `metadata.dieCount`d`metadata.dieSides` and return the total.
 */
export function rollDamage(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}
