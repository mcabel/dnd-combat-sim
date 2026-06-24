// ============================================================
// Darkness — PHB p.230
//
// 2nd-level evocation, action, range 60 ft, concentration (10 min).
// Components: V, M (bat fur and a drop of pitch or piece of coal).
//
// Effect: Magical darkness spreads from a point you choose within range
//   to fill a 15-foot-radius sphere for the duration. The darkness spreads
//   around corners. A creature with darkvision can't see through this
//   darkness, and nonmagical light can't illuminate it.
//
//   If the point you choose is on an object you are holding or one that
//   isn't being worn or carried, the darkness emanates from the object and
//   moves with it. Completely covering the source of the darkness with an
//   opaque object, such as a bowl or a helm, blocks the darkness.
//
//   If any of this spell's area overlaps with an area of light created by
//   a spell of 2nd level or lower, the spell that created the light is
//   dispelled.
//
// Upcast: No additional effect per slot level above 2nd (PHB has no upcast).
//
// v1 simplifications:
//   - AoE shape: canon 15-ft radius sphere centered on a point within 60 ft.
//     v1 places the darkness centered on the CASTER's position (self-centered),
//     mirroring the Fog Cloud v1 pattern. Canon allows placing it anywhere
//     within 60 ft, but the tactical use is almost always to obscure the
//     caster + allies. Documented via the metadata flag
//     `darknessRemotePlacementV1Implemented: false`.
//   - Heavy obscurement: modelled as a vision-blocking Obstacle on
//     bf.obstacles (blocksVision: true, blocksMovement: false). The Darkness
//     obstacle is a 15-ft-radius square (v1 simplification — a sphere is
//     approximated as a square grid region, 7×7 squares centered on caster).
//     When concentration breaks, the obstacle is removed via the
//     'battlefield_obstacle' ActiveEffect + removeBattlefieldObstacle().
//   - Vision subsystem integration (Session 62 RFC-VISION-AUDIO Phase 1):
//     creatures behind the darkness have no LOS to each other → enables the
//     generalized Hide action (any creature behind darkness can take the Hide
//     action). Attacks through the darkness have disadvantage (vision blocked
//     — handled by the existing losDisadvantage check in resolveAttack).
//   - "Blocks darkvision" (PHB): this is the KEY difference from Fog Cloud —
//     even creatures with darkvision can't see through magical darkness.
//     Phase 1 vision (isVisuallyDetected) doesn't consume darkvision yet, so
//     in Phase 1 Darkness behaves identically to Fog Cloud (blocks LOS for
//     everyone). Phase 2 (RFC-VISION-AUDIO §4.3) will extend isVisuallyDetected
//     to check darkvision — at that point, the obstacle's `blocksDarkvision`
//     payload flag (set below) will make Darkness block darkvision while Fog
//     Cloud doesn't. Documented via `darknessBlocksDarkvisionV1Implemented: false`.
//   - "Nonmagical light can't illuminate": NOT modelled (no light-source
//     system in v1).
//   - "Dispels L2-or-lower light spells": NOT modelled (no light-spell
//     tracking in v1). Forward-compat TODO.
//   - "Source on an object, moves with it": NOT modelled (v1 self-centers).
//   - "Covering the source blocks the darkness": NOT modelled.
//   - Duration: canon 10 min concentration → v1: concentration persists for
//     the entire combat (no concentration-check-on-damage yet, TG-002).
//
// Spell module pattern (Session 31 architecture — mirrors Fog Cloud):
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
  name: 'Darkness',
  level: 2,
  school: 'evocation',
  rangeFt: 60,
  aoeSizeFt: 15,       // 15-ft radius sphere (canon)
  concentration: true,
  castingTime: 'action',
  // v1 simplification flags:
  darknessRemotePlacementV1Implemented: false,    // self-centered only
  darknessUpcastV1Implemented: false,             // no upcast effect (canon)
  darknessLightDispelV1Implemented: false,        // no light-spell dispel
  darknessObjectSourceV1Implemented: false,       // no moveable-object source
  darknessCoverSourceV1Implemented: false,        // no cover-to-block
  darknessBlocksDarkvisionV1Implemented: false,   // Phase 2 vision needed
  darknessVisionSubsystemV1Implemented: true,     // Session 62: blocks LOS + enables Hide
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
 * Returns the caster itself if Darkness should be cast, or null.
 *
 * Darkness is a SELF-CENTERED defensive/control spell — it blocks vision for
 * everyone in the sphere (including the caster). The tactical use is:
 *   - Break line of sight so enemies can't target the caster with
 *     "creature you can see" spells or ranged attacks (without disadv).
 *   - Enable the generalized Hide action (any creature behind darkness can
 *     take the Hide action per Session 62 RFC-VISION-AUDIO Phase 1).
 *   - Against darkvision-reliant enemies (Drow, Dwarves, etc.), Darkness is
 *     STRONGER than Fog Cloud because it blocks darkvision too (Phase 2).
 *
 * Preconditions:
 *   - Caster has 'Darkness' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - Caster is NOT already concentrating on any spell
 *   - There is at least one living enemy on the battlefield
 *   - The caster is NOT already inside a Darkness/Fog Cloud (re-cast is wasteful)
 *
 * v1 AI strategy: cast Darkness when:
 *   (a) The caster is at low HP (< 50%) AND there are enemies within
 *       45 ft (break LOS to escape targeting), OR
 *   (b) The caster is outnumbered (enemies > allies) AND has allies who
 *       could benefit from hiding (enable ally Hide actions), OR
 *   (c) Round 1 opener for a support caster with no better concentration
 *       spell available (rare — usually Bless/Haste is better).
 *
 * Darkness is PREFERRED over Fog Cloud when the caster has both, because:
 *   - Darkness blocks darkvision (Phase 2) — stronger vs many monsters.
 *   - Darkness is L2 (higher slot) — the caster chose to invest more.
 * The planner ordering ensures Darkness fires BEFORE Fog Cloud if both
 * shouldCast return true (Darkness branch is above Fog Cloud branch).
 *
 * Returns the caster (self-targeted) or null.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Darkness')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  // Check for living enemies.
  const enemies = [...bf.combatants.values()].filter(
    c => c.faction !== caster.faction && !c.isDead && !c.isUnconscious
  );
  if (enemies.length === 0) return null;

  // Don't re-cast if already inside a Darkness or Fog Cloud (check activeEffects).
  const alreadyObscured = caster.activeEffects.some(
    e => (e.spellName === 'Darkness' || e.spellName === 'Fog Cloud')
      && e.effectType === 'battlefield_obstacle'
  );
  if (alreadyObscured) return null;

  // Strategy (a): low HP + enemies within 45 ft → break LOS to escape.
  // (45 ft = 15-ft radius darkness covers the caster + ~3 squares around.)
  const hpPct = caster.currentHP / caster.maxHP;
  const nearEnemy = enemies.some(e => chebyshev3D(caster.pos, e.pos) * 5 <= 45);
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
  // Darkness is low priority).
  if (bf.round === 1 && allies.length > 0 && hpPct >= 0.50) {
    // Only if the caster has no other concentration spells in their action list
    // (Bless, Bane, etc. would be better). This is a weak heuristic — the
    // planner ordering ensures Darkness fires AFTER Bless/etc.
    const hasBetterConcSpell = caster.actions.some(a =>
      ['Bless', 'Bane', 'Shield of Faith', 'Faerie Fire', 'Entangle', 'Hold Person',
       'Web', 'Fog Cloud'].includes(a.name)
    );
    if (!hasBetterConcSpell) {
      return caster;
    }
  }

  return null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Darkness:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Darkness.
 *  4. Create a vision-blocking Obstacle on bf.obstacles centered on the caster.
 *     The obstacle is a square approximating the 15-ft radius sphere
 *     (v1 simplification — a 7×7 grid square centered on the caster).
 *  5. Apply a 'battlefield_obstacle' ActiveEffect on the CASTER (self-targeted,
 *     sourceIsConcentration: true) so the obstacle is removed when concentration
 *     breaks (via removeEffectsFromCaster → removeBattlefieldObstacle).
 *
 * v1 simplifications: self-centered (no remote placement); square AoE
 * (not sphere); no upcast; no light-dispel; no object-source; no cover-source.
 * "Blocks darkvision" is a Phase 2 vision feature (flagged in payload for
 * forward-compat — `blocksDarkvision: true`).
 *
 * @param caster  The casting Combatant (Sorcerer/Warlock/Wizard/etc.)
 * @param _target Unused (self-targeted spell — target is the caster)
 * @param state   Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  _target: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  // Safety: clean up any stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Darkness');

  const bf = state.battlefield;

  // Create the darkness obstacle. v1: 7×7 grid square centered on the caster
  // (approximates a 15-ft radius sphere — 3 squares in each direction = 15 ft).
  // The obstacle is vision-blocking, NOT movement-blocking (darkness doesn't
  // block movement — creatures can walk through it).
  const radiusSquares = 3;  // 3 squares = 15 ft
  const cx = caster.pos.x;
  const cy = caster.pos.y;
  const obstacleId = `darkness-${caster.id}-${bf.round}`;
  const darknessObstacle: Obstacle = {
    id: obstacleId,
    x: cx - radiusSquares,
    y: cy - radiusSquares,
    z: caster.pos.z,
    width: radiusSquares * 2 + 1,   // 7 squares wide
    depth: radiusSquares * 2 + 1,   // 7 squares deep
    height: 1,
    blocksMovement: false,
    blocksVision: true,
    isMagicalDarkness: true,   // Session 63: blocks darkvision; Devil's Sight penetrates
  };

  // Add the obstacle to the battlefield.
  if (!bf.obstacles) bf.obstacles = [];
  bf.obstacles.push(darknessObstacle);

  // Apply the ActiveEffect on the caster (self-targeted) so concentration
  // break removes the obstacle. The payload includes `blocksDarkvision: true`
  // for Phase 2 forward-compat (isVisuallyDetected will check this to decide
  // whether darkvision can penetrate the obstacle).
  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Darkness',
    effectType: 'battlefield_obstacle',
    payload: {
      obstacleId,
      obstacleCenterX: cx,
      obstacleCenterY: cy,
      obstacleCenterZ: caster.pos.z,
      obstacleRadiusFt: 15,
      blocksDarkvision: true,   // Phase 2: isVisuallyDetected will consume this
    },
    sourceIsConcentration: true,
  });

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Darkness! A 15-ft sphere of magical darkness fills the area (blocks vision + darkvision; enables Hide).`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} is shrouded in magical darkness! (heavily obscured — even darkvision can't see through it)`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Darkness — called from resetBudget() at the start of
 * the caster's next turn. NO-OP because:
 *   - Darkness is a concentration spell; the battlefield obstacle is
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
