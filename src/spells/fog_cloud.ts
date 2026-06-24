// ============================================================
// Fog Cloud — PHB p.243
//
// 1st-level conjuration, action, range 120 ft, concentration (1 min).
// Components: V, S, M (powdered chalk and powdered antimony).
//
// Effect: You create a 20-foot-radius sphere of fog centered on a point
//   within range. The sphere spreads around corners, and its area is
//   heavily obscured. It lasts for the duration or until a wind of
//   moderate or greater speed (at least 10 miles per hour) disperses it.
//
// Upcast: +20 ft radius per slot level above 1st (not modelled in v1).
//
// v1 simplifications:
//   - AoE shape: canon 20-ft sphere centered on a point within 120 ft.
//     v1 places the fog centered on the CASTER's position (self-centered).
//     Canon allows placing it anywhere within 120 ft, but the tactical
//     use is almost always to obscure the caster + allies. v1 simplifies
//     to self-centered; the caster can move out of the fog on their
//     next turn to attack from concealment. Documented via the metadata
//     flag `fogCloudRemotePlacementV1Implemented: false`.
//   - Heavy obscurement: modelled as a vision-blocking Obstacle on
//     bf.obstacles (blocksVision: true, blocksMovement: false). The
//     Fog Cloud obstacle is a 20-ft-radius square (v1 simplification —
//     a sphere is approximated as a square grid region). When
//     concentration breaks, the obstacle is removed via the
//     'battlefield_obstacle' ActiveEffect + removeBattlefieldObstacle().
//   - Vision subsystem integration (Session 62 RFC-VISION-AUDIO Phase 1):
//     creatures behind the fog have no LOS to each other → enables the
//     generalized Hide action (any creature behind fog can take the Hide
//     action). Attacks through the fog have disadvantage (vision blocked
//     — handled by the existing losDisadvantage check in resolveAttack).
//   - Wind dispersal: NOT modelled (no wind system in v1).
//   - Upcast: +20 ft radius per slot level NOT modelled — v1 always
//     uses 20-ft radius. Forward-compat TODO via
//     `fogCloudUpcastV1Implemented: false`.
//   - Duration: canon 1 min concentration → v1: concentration is started
//     via startConcentration(); the fog persists until concentration
//     breaks (removeEffectsFromCaster removes the obstacle).
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant | null  (returns self if conditions met)
//   execute(caster, target, state) → void
//   metadata → spell stats
//   cleanup() — no-op (concentration break handles cleanup)
// ============================================================

import { Combatant, Battlefield, Obstacle } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Fog Cloud',
  level: 1,
  school: 'conjuration',
  rangeFt: 120,
  aoeSizeFt: 20,       // 20-ft radius sphere (canon)
  concentration: true,
  castingTime: 'action',
  // v1 simplification flags:
  fogCloudRemotePlacementV1Implemented: false,   // self-centered only
  fogCloudUpcastV1Implemented: false,            // +20 ft/slot-level not modelled
  fogCloudWindDispersalV1Implemented: false,     // no wind system
  fogCloudVisionSubsystemV1Implemented: true,    // Session 62: blocks LOS + enables Hide
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
 * Returns the caster itself if Fog Cloud should be cast, or null.
 *
 * Fog Cloud is a SELF-CENTERED defensive spell — it blocks vision for
 * everyone in the sphere (including the caster). The tactical use is:
 *   - Break line of sight so enemies can't target the caster with
 *     "creature you can see" spells or ranged attacks (without disadv).
 *   - Enable the generalized Hide action (any creature behind fog can
 *     take the Hide action per Session 62 RFC-VISION-AUDIO Phase 1).
 *
 * Preconditions:
 *   - Caster has 'Fog Cloud' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - There is at least one living enemy on the battlefield
 *   - The caster is NOT already inside a Fog Cloud (re-cast is wasteful)
 *
 * v1 AI strategy: cast Fog Cloud when:
 *   (a) The caster is at low HP (< 50%) AND there are enemies within
 *       60 ft (break LOS to escape targeting), OR
 *   (b) The caster is outnumbered (enemies > allies) AND has allies who
 *       could benefit from hiding (enable ally Hide actions), OR
 *   (c) Round 1 opener for a support caster with no better concentration
 *       spell available (rare — usually Bless/Haste is better).
 *
 * Returns the caster (self-targeted) or null.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Fog Cloud')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  // Check for living enemies.
  const enemies = [...bf.combatants.values()].filter(
    c => c.faction !== caster.faction && !c.isDead && !c.isUnconscious
  );
  if (enemies.length === 0) return null;

  // Don't re-cast if already inside a Fog Cloud (check activeEffects).
  const alreadyInFog = caster.activeEffects.some(
    e => e.spellName === 'Fog Cloud' && e.effectType === 'battlefield_obstacle'
  );
  if (alreadyInFog) return null;

  // Strategy (a): low HP + enemies within 60 ft → break LOS to escape.
  const hpPct = caster.currentHP / caster.maxHP;
  const nearEnemy = enemies.some(e => chebyshev3D(caster.pos, e.pos) * 5 <= 60);
  if (hpPct < 0.50 && nearEnemy) {
    return caster;
  }

  // Strategy (b): outnumbered + has allies who could hide.
  const allies = [...bf.combatants.values()].filter(
    c => c.faction === caster.faction && c.id !== caster.id
      && !c.isDead && !c.isUnconscious
  );
  if (enemies.length > allies.length + 1 && allies.length > 0) {
    return caster;
  }

  // Strategy (c): round 1 opener for support caster (only if no better
  // concentration spell is available — checked by the planner ordering;
  // Fog Cloud is low priority).
  if (bf.round === 1 && allies.length > 0 && hpPct >= 0.50) {
    // Only if the caster has no other concentration spells in their action list
    // (Bless, Bane, etc. would be better). This is a weak heuristic — the
    // planner ordering ensures Fog Cloud fires AFTER Bless/etc.
    const hasBetterConcSpell = caster.actions.some(a =>
      ['Bless', 'Bane', 'Shield of Faith', 'Faerie Fire', 'Entangle'].includes(a.name)
    );
    if (!hasBetterConcSpell) {
      return caster;
    }
  }

  return null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Fog Cloud:
 *  1. Consume a 1st-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Fog Cloud.
 *  4. Create a vision-blocking Obstacle on bf.obstacles centered on the caster.
 *     The obstacle is a square approximating the 20-ft radius sphere
 *     (v1 simplification — a 9×9 grid square centered on the caster).
 *  5. Apply a 'battlefield_obstacle' ActiveEffect on the CASTER (self-targeted,
 *     sourceIsConcentration: true) so the obstacle is removed when concentration
 *     breaks (via removeEffectsFromCaster → removeBattlefieldObstacle).
 *
 * v1 simplifications: self-centered (no remote placement); square AoE
 * (not sphere); no upcast; no wind dispersal.
 *
 * @param caster  The casting Combatant (Druid/Ranger/Sorcerer/Wizard)
 * @param _target Unused (self-targeted spell — target is the caster)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  _target: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 1);

  // Safety: clean up any stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Fog Cloud');

  const bf = state.battlefield;

  // Create the fog obstacle. v1: 9×9 grid square centered on the caster
  // (approximates a 20-ft radius sphere — 4 squares in each direction = 20 ft).
  // The obstacle is vision-blocking, NOT movement-blocking (fog doesn't
  // block movement — creatures can walk through it).
  const radiusSquares = 4;  // 4 squares = 20 ft
  const cx = caster.pos.x;
  const cy = caster.pos.y;
  const obstacleId = `fogcloud-${caster.id}-${bf.round}`;
  const fogObstacle: Obstacle = {
    id: obstacleId,
    x: cx - radiusSquares,
    y: cy - radiusSquares,
    z: caster.pos.z,
    width: radiusSquares * 2 + 1,   // 9 squares wide
    depth: radiusSquares * 2 + 1,   // 9 squares deep
    height: 1,
    blocksMovement: false,
    blocksVision: true,
  };

  // Add the obstacle to the battlefield.
  if (!bf.obstacles) bf.obstacles = [];
  bf.obstacles.push(fogObstacle);

  // Apply the ActiveEffect on the caster (self-targeted) so concentration
  // break removes the obstacle.
  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Fog Cloud',
    effectType: 'battlefield_obstacle',
    payload: {
      obstacleId,
      obstacleCenterX: cx,
      obstacleCenterY: cy,
      obstacleCenterZ: caster.pos.z,
      obstacleRadiusFt: 20,
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Fog Cloud! A 20-ft sphere of thick fog fills the area (blocks vision, enables Hide).`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} is shrouded in fog! (heavily obscured — enemies can't see through it)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Fog Cloud — called from resetBudget() at the start of
 * the caster's next turn. NO-OP because:
 *   - Fog Cloud is a concentration spell; the battlefield obstacle is
 *     removed via removeEffectsFromCaster() → removeBattlefieldObstacle()
 *     when concentration breaks.
 *   - v1 does NOT enforce concentration checks on damage taken (TG-002),
 *     so concentration effectively persists for the entire combat.
 *
 * Exported for symmetry with the other spell modules' cleanup pattern.
 */
export function cleanup(_c: Combatant): void {
  // No-op — concentration break handles cleanup via removeEffectsFromCaster.
}
