// ============================================================
// Fog Cloud — PHB p.243
//
// 1st-level conjuration, action, range 120 ft, concentration (1 hr).
// Components: V, S.
//
// Effect: Creates a 20-ft-radius sphere of heavy obscurement. Blocks
//         line of sight. Creatures inside are heavily obscured.
//
// v1 implementation (Session 69 — implements the TG-010 obstacle
// subsystem that the Session 62 test expected):
//   - Self-centered: the fog sphere is centered on the caster (v1
//     simplification — canon allows placing the point of origin
//     anywhere within range).
//   - Obstacle: adds a vision-blocking Obstacle to bf.obstacles (9×9
//     grid — 20-ft radius = 4 squares each direction + center = 9 wide).
//     blocksVision=true, blocksMovement=false.
//   - ActiveEffect: a 'battlefield_obstacle' effect on the caster with
//     sourceIsConcentration=true. removeEffectsFromCaster (called on
//     concentration break) removes the obstacle via removeBattlefieldObstacle.
//   - Darkvision: Fog Cloud does NOT block darkvision (it's normal
//     obscurement, not magical darkness). The isMagicalDarkness flag is
//     NOT set on the obstacle. blocksDarkvision is NOT set in the payload
//     (distinguishes from Darkness).
//   - Upcast: +5-ft radius per slot level above 1st (NOT modelled in v1).
//
// shouldCast strategies (mirrors Darkness):
//   (a) Low HP (<50%) + enemy within 60 ft → cast (defensive retreat).
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
  name: 'Fog Cloud', level: 1, school: 'conjuration', rangeFt: 120,
  concentration: true, castingTime: 'action', aoeSizeFt: 20,
  fogCloudVisionSubsystemV1Implemented: true,
  fogCloudObscurementV1Implemented: true,  // backward-compat flag
  fogCloudUpcastV1Implemented: false,
} as const;

function emit(state: EngineState, type: CombatEvent['type'], actorId: string, desc: string, targetId?: string, value?: number): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

/** 20-ft radius = 4 grid squares each direction (5 ft/square). */
const RADIUS_SQUARES = 4;
const RADIUS_FT = 20;

/**
 * Build the fog-cloud Obstacle (9×9 grid centered on caster).
 * blocksVision=true, blocksMovement=false, isMagicalDarkness=undefined.
 */
function buildObstacle(caster: Combatant): Obstacle {
  const id = `fogcloud-${caster.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    x: caster.pos.x - RADIUS_SQUARES,
    y: caster.pos.y - RADIUS_SQUARES,
    z: caster.pos.z,
    width: RADIUS_SQUARES * 2 + 1,   // 9
    depth: RADIUS_SQUARES * 2 + 1,   // 9
    height: 1,
    blocksMovement: false,
    blocksVision: true,
    // isMagicalDarkness NOT set — Fog Cloud is normal obscurement.
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

/** Concentration spells that are "better" than Fog Cloud (opener check). */
const BETTER_CONC_SPELLS = new Set([
  'Bless', 'Bane', 'Hold Person', 'Hold Monster', 'Banishment',
  'Web', 'Entangle', 'Spirit Guardians', 'Greater Invisibility',
  'Invisibility', 'Polymorph', 'Confusion', 'Fear', 'Slow',
  'Wall of Fire', 'Wall of Force', 'Wall of Ice', 'Wall of Stone',
  'Sunbeam', 'Sunburst',
]);

/**
 * Returns the CASTER (self) if Fog Cloud should be cast; null otherwise.
 *
 * Strategies (first match wins):
 *   (a) Low HP (<50%) + enemy within 60 ft → defensive retreat.
 *   (b) Outnumbered (enemies > allies + 1) + has allies → cover for allies.
 *   (c) Round 1 + ally present + no better conc spell → opener.
 *
 * Gates: has 'Fog Cloud' action, has L1+ slot, not concentrating, has
 * living enemies, not already inside a Fog Cloud/Darkness obstacle.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Fog Cloud')) return null;
  if (!hasSpellSlot(caster, 1)) return null;
  if (caster.concentration?.active) return null;
  if (alreadyInObstacle(caster)) return null;

  const { enemies, allies } = countFactions(caster, bf);
  if (enemies === 0) return null;

  const hpPct = caster.currentHP / caster.maxHP;
  const nearEnemyFt = nearestEnemyDistFt(caster, bf);

  // (a) Low HP + near enemy (within 60 ft)
  if (hpPct < 0.5 && nearEnemyFt <= 60) return caster;

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
  const slotLevel = consumeSpellSlot(caster, 1);
  if (slotLevel === null) return;

  // Drop any existing concentration effects before starting new (defensive)
  startConcentration(caster, 'Fog Cloud');

  // Build + add the obstacle
  const obstacle = buildObstacle(caster);
  if (!state.battlefield.obstacles) state.battlefield.obstacles = [];
  state.battlefield.obstacles.push(obstacle);

  // Apply the ActiveEffect on the caster (battlefield_obstacle, conc-sourced)
  const effect: Omit<ActiveEffect, 'id'> = {
    casterId: caster.id,
    spellName: 'Fog Cloud',
    effectType: 'battlefield_obstacle',
    payload: {
      obstacleId: obstacle.id,
      obstacleCenterX: caster.pos.x,
      obstacleCenterY: caster.pos.y,
      obstacleCenterZ: caster.pos.z,
      obstacleRadiusFt: RADIUS_FT,
      // blocksDarkvision NOT set — Fog Cloud is normal obscurement.
    },
    sourceIsConcentration: true,
    appliedTurn: state.battlefield.round,
  };
  applySpellEffect(caster, effect);

  emit(state, 'action', caster.id,
    `${caster.name} casts Fog Cloud (slot L${slotLevel})! A 20-ft sphere of heavy fog appears, centered on ${caster.name} (obscures vision, enables Hide).`);
}

export function cleanup(_c: Combatant): void { /* no-op — removeEffectsFromCaster handles conc cleanup */ }
