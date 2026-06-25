// ============================================================
// Darkness — PHB p.230
//
// 2nd-level evocation, action, range 60 ft, concentration (10 min).
// Components: V, M (bat fur and a drop of pitch or piece of coal).
//
// Effect: Creates a 15-ft-radius sphere of magical darkness. Darkvision
//         cannot see through it. Non-magical light cannot illuminate
//         within it. Creatures inside are heavily obscured (blinded).
//
// v1 implementation (Session 69 — implements the TG-010 obstacle
// subsystem that the Session 63 test expected):
//   - Self-centered: the darkness sphere is centered on the caster (v1
//     simplification — canon allows placing the point of origin
//     anywhere within range). Flagged `darknessRemotePlacementV1Implemented:
//     false`.
//   - Obstacle: adds a vision-blocking Obstacle to bf.obstacles (7×7
//     grid — 15-ft radius = 3 squares each direction + center = 7 wide).
//     blocksVision=true, blocksMovement=false, isMagicalDarkness=true.
//   - ActiveEffect: a 'battlefield_obstacle' effect on the caster with
//     sourceIsConcentration=true. removeEffectsFromCaster (called on
//     concentration break) removes the obstacle via removeBattlefieldObstacle.
//   - blocksDarkvision: Darkness is MAGICAL darkness — it explicitly
//     blocks darkvision (PHB p.230: "A creature with darkvision can't
//     see through this darkness"). The payload sets blocksDarkvision=true
//     and the obstacle sets isMagicalDarkness=true. Phase 2 vision
//     (isVisuallyDetected) will check these; v1 just flags them.
//     Flagged `darknessBlocksDarkvisionV1Implemented: false` (Phase 2).
//   - Devil's Sight (monster trait / Warlock invocation): an observer
//     with `senses.devilsSight` can see through magical darkness.
//     hasLineOfSight() checks isMagicalDarkness + devilsSight (Phase 2).
//
// shouldCast strategies (mirrors Fog Cloud with tighter range):
//   (a) Low HP (<50%) + enemy within 45 ft → cast (defensive retreat).
//       (45 ft, not 60 — Darkness has 60-ft range but the 15-ft radius
//       means the enemy should be close enough to be affected.)
//   (b) Outnumbered (enemies > allies + 1) + has allies → cast (cover).
//   (c) Round 1 + ally present + no better conc spell → cast (opener).
//
// Spell module pattern (self-targeted obscurement, concentration):
//   shouldCast(caster, bf) → Combatant | null  (returns the CASTER)
//   execute(caster, _self, state) → void
//   cleanup() — no-op (removeEffectsFromCaster handles conc cleanup)
// ============================================================

import { Combatant, Battlefield, Obstacle, ActiveEffect } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';
import { startConcentration } from '../engine/utils';
import { applySpellEffect } from '../engine/spell_effects';
import { chebyshev3D } from '../engine/movement';

export const metadata = {
  name: 'Darkness', level: 2, school: 'evocation', rangeFt: 60,
  concentration: true, castingTime: 'action', aoeSizeFt: 15,
  darknessVisionSubsystemV1Implemented: true,
  darknessVisionV1Implemented: true,           // backward-compat flag
  darknessBlocksDarkvision: true,              // backward-compat flag
  darknessBlocksDarkvisionV1Implemented: false, // Phase 2 vision feature
  darknessRemotePlacementV1Implemented: false,
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

/** 15-ft radius = 3 grid squares each direction (5 ft/square). */
const RADIUS_SQUARES = 3;
const RADIUS_FT = 15;

/**
 * Build the darkness Obstacle (7×7 grid centered on caster).
 * blocksVision=true, blocksMovement=false, isMagicalDarkness=true.
 */
function buildObstacle(caster: Combatant): Obstacle {
  const id = `darkness-${caster.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    x: caster.pos.x - RADIUS_SQUARES,
    y: caster.pos.y - RADIUS_SQUARES,
    z: caster.pos.z,
    width: RADIUS_SQUARES * 2 + 1,   // 7
    depth: RADIUS_SQUARES * 2 + 1,   // 7
    height: 1,
    blocksMovement: false,
    blocksVision: true,
    isMagicalDarkness: true,  // Darkness is MAGICAL darkness — blocks darkvision
  };
}

/** Count living enemies and allies (excluding self). */
function countFactions(caster: Combatant, bf: Battlefield): { enemies: number; allies: number } {
  let enemies = 0, allies = 0;
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction === caster.faction) allies++;
    else enemies++;
  }
  return { enemies, allies };
}

/** Nearest living enemy chebyshev distance in ft (or Infinity). */
function nearestEnemyDistFt(caster: Combatant, bf: Battlefield): number {
  let min = Infinity;
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (c.faction === caster.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    const d = chebyshev3D(caster.pos, c.pos) * 5;
    if (d < min) min = d;
  }
  return min;
}

/** True if caster already has a battlefield_obstacle effect (Fog Cloud/Darkness). */
function alreadyInObstacle(caster: Combatant): boolean {
  return caster.activeEffects.some(
    e => e.effectType === 'battlefield_obstacle' &&
         (e.spellName === 'Fog Cloud' || e.spellName === 'Darkness')
  );
}

/** Concentration spells that are "better" than Darkness (opener check). */
const BETTER_CONC_SPELLS = new Set([
  'Bless', 'Bane', 'Hold Person', 'Hold Monster', 'Banishment',
  'Web', 'Entangle', 'Spirit Guardians', 'Greater Invisibility',
  'Invisibility', 'Polymorph', 'Confusion', 'Fear', 'Slow',
  'Wall of Fire', 'Wall of Force', 'Wall of Ice', 'Wall of Stone',
  'Sunbeam', 'Sunburst',
]);

/**
 * Returns the CASTER (self) if Darkness should be cast; null otherwise.
 *
 * Strategies (first match wins):
 *   (a) Low HP (<50%) + enemy within 45 ft → defensive retreat.
 *   (b) Outnumbered (enemies > allies + 1) + has allies → cover for allies.
 *   (c) Round 1 + ally present + no better conc spell → opener.
 *
 * Gates: has 'Darkness' action, has L2+ slot, not concentrating, has
 * living enemies, not already inside a Fog Cloud/Darkness obstacle.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Darkness')) return null;
  if (!hasSpellSlot(caster, 2)) return null;
  if (caster.concentration?.active) return null;
  if (alreadyInObstacle(caster)) return null;

  const { enemies, allies } = countFactions(caster, bf);
  if (enemies === 0) return null;

  const hpPct = caster.currentHP / caster.maxHP;
  const nearEnemyFt = nearestEnemyDistFt(caster, bf);

  // (a) Low HP + near enemy (within 45 ft)
  if (hpPct < 0.5 && nearEnemyFt <= 45) return caster;

  // (b) Outnumbered + has allies
  if (enemies > allies + 1 && allies > 0) return caster;

  // (c) Round 1 opener + ally + no better conc spell
  if (bf.round <= 1 && allies > 0) {
    const hasBetterConc = caster.actions.some(a => BETTER_CONC_SPELLS.has(a.name));
    if (!hasBetterConc) return caster;
  }

  return null;
}

export function execute(caster: Combatant, _self: Combatant, state: EngineState): void {
  const slotLevel = consumeSpellSlot(caster, 2);
  if (slotLevel === null) return;

  // Drop any existing concentration effects before starting new (defensive)
  startConcentration(caster, 'Darkness');

  // Build + add the obstacle
  const obstacle = buildObstacle(caster);
  if (!state.battlefield.obstacles) state.battlefield.obstacles = [];
  state.battlefield.obstacles.push(obstacle);

  // Apply the ActiveEffect on the caster (battlefield_obstacle, conc-sourced)
  const effect: Omit<ActiveEffect, 'id'> = {
    casterId: caster.id,
    spellName: 'Darkness',
    effectType: 'battlefield_obstacle',
    payload: {
      obstacleId: obstacle.id,
      obstacleCenterX: caster.pos.x,
      obstacleCenterY: caster.pos.y,
      obstacleCenterZ: caster.pos.z,
      obstacleRadiusFt: RADIUS_FT,
      blocksDarkvision: true,  // Darkness is MAGICAL darkness — blocks darkvision
    },
    sourceIsConcentration: true,
    appliedTurn: state.battlefield.round,
  };
  applySpellEffect(caster, effect);

  emit(state, 'action', caster.id,
    `${caster.name} casts Darkness (slot L${slotLevel})! A 15-ft sphere of magical darkness appears, centered on ${caster.name} (blocks vision + darkvision, enables Hide).`);
}

export function cleanup(_c: Combatant): void { /* no-op — removeEffectsFromCaster handles conc cleanup */ }
