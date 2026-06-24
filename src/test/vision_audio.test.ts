// ============================================================
// Test: Vision + Audio Subsystem (RFC-VISION-AUDIO Phase 1)
//
// Session 62 scope:
//   ✅ Sound detection: passivePerception × 5ft (Chebyshev)
//   ✅ Generalized Hide action (any creature, requires obscurement)
//   ✅ 4-state detection model (visible / hidden / position-known / unknown)
//   ✅ Active Perception (Search action) — contests hidden Stealth
//   ✅ Stealth break on cast (verbal component)
//   ✅ Detection state refresh at turn start
//
// User's 6 answers (from zHANDOVER-SESSION-60.md):
//   1. Sound formula: pp × 5ft (Chebyshev)
//   2. Hide requires obscurement (smoke/fog/invisibility/darkness/obstacles)
//   3. Hidden persists until noisy activity (cast/attack); whisper ok, voice warning breaks
//   4. 4-state detection model
//   5. Use existing lightLevel field
//   6. Active perception allowed (spends action)
//
// Run: ts-node src/test/vision_audio.test.ts
// ============================================================

import {
  isAudiblyDetected,
  isVisuallyDetected,
  getDetectionState,
  canTakeHideAction,
  tryHide,
  tryActivePerception,
  breaksStealthOnCast,
  getPassivePerception,
  chebyshevDistanceFt,
  countHiddenEnemies,
  countTargetableEnemies,
  nearestHiddenEnemy,
} from '../engine/perception';
import { runCombat, makeFlatBattlefield, CombatEvent, EngineState } from '../engine/combat';
import { planTurn } from '../ai/planner';
import { Combatant, Battlefield, Obstacle, Action, Vec3, PlayerResources } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(o: Partial<Combatant> = {}): Combatant {
  const id = `c${++_id}`;
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 30, currentHP: 30, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart',
    perception: { targets: new Map() },
    concentration: null,
    deathSaves: null,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null, activeEffects: [],
    ...o,
  };
}

function fogCloud(x: number, y: number, w = 1, d = 1): Obstacle {
  return {
    id: `fog-${x}-${y}`, x, y, z: 0,
    width: w, depth: d, height: 1,
    blocksMovement: false, blocksVision: true,
  };
}

function makeBF(combatants: Combatant[], obstacles: Obstacle[] = []): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    width: 30, height: 30, depth: 1, cells: [],
    combatants: map, round: 1,
    initiativeOrder: combatants.map(c => c.id),
    obstacles: obstacles.length > 0 ? obstacles : undefined,
  };
}

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [] },
    disengagedThisTurn: new Set(),
    rageDamagedSinceLastTurn: new Set(),
    pendingReactions: [],
  } as unknown as EngineState;
}

function meleeAction(name = 'Shortsword', hitBonus = 5): Action {
  return {
    name, isMultiattack: false,
    attackType: 'melee', reach: 5, range: null,
    hitBonus, damage: { count: 1, sides: 6, bonus: 3, average: 6 },
    damageType: 'piercing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: '',
  };
}

// ============================================================
console.log('\n=== 1. Passive Perception helper ===\n');
// ============================================================

{
  // Creature with senses.passivePerception = 15
  const c = makeC({ id: 'goblin', wis: 8, senses: { passivePerception: 15 } });
  eq('1a: senses.passivePerception used when present', getPassivePerception(c), 15);

  // Creature without senses field → 10 + WIS mod
  const c2 = makeC({ id: 'wolf', wis: 12 });  // WIS mod +1
  eq('1b: fallback 10 + WIS mod when senses absent', getPassivePerception(c2), 11);

  // Creature with WIS 20 (mod +5) and no senses field
  const c3 = makeC({ id: 'dragon', wis: 20 });
  eq('1c: WIS 20 → passive 15', getPassivePerception(c3), 15);

  // Creature with WIS 10 (mod 0) and no senses field
  const c4 = makeC({ id: 'zombie', wis: 10 });
  eq('1d: WIS 10 → passive 10', getPassivePerception(c4), 10);
}

// ============================================================
console.log('\n=== 2. Chebyshev distance (ft) ===\n');
// ============================================================

{
  const a = makeC({ id: 'a', pos: { x: 0, y: 0, z: 0 } });
  const b = makeC({ id: 'b', pos: { x: 3, y: 4, z: 0 } });  // Cheb = 4 squares = 20 ft
  eq('2a: Chebyshev (3,4,0) = 20 ft', chebyshevDistanceFt(a, b), 20);

  const c = makeC({ id: 'c', pos: { x: 5, y: 5, z: 0 } });
  eq('2b: Chebyshev (5,5,0) = 25 ft', chebyshevDistanceFt(a, c), 25);

  const d = makeC({ id: 'd', pos: { x: 0, y: 0, z: 2 } });  // 2 squares up = 10 ft
  eq('2c: Chebyshev (0,0,2) = 10 ft (3D)', chebyshevDistanceFt(a, d), 10);

  eq('2d: Same position = 0 ft', chebyshevDistanceFt(a, a), 0);
}

// ============================================================
console.log('\n=== 3. Sound detection (pp × 5ft, Chebyshev) ===\n');
// ============================================================

{
  // Goblin pp=9 → sound range 45 ft
  // Target at 40 ft (8 squares) → detected
  const goblin = makeC({ id: 'goblin', senses: { passivePerception: 9 } });
  const target = makeC({ id: 'target', pos: { x: 8, y: 0, z: 0 } });  // 40 ft
  assert('3a: Goblin (pp 9) detects target at 40 ft (≤ 45 ft)',
    isAudiblyDetected(goblin, target) === true);

  // Target at 50 ft (10 squares) → NOT detected (50 > 45)
  const target2 = makeC({ id: 't2', pos: { x: 10, y: 0, z: 0 } });  // 50 ft
  assert('3b: Goblin (pp 9) does NOT detect target at 50 ft (> 45 ft)',
    isAudiblyDetected(goblin, target2) === false);

  // Adult Red Dragon pp=23 → sound range 115 ft
  // Target at 100 ft (20 squares) → detected
  const dragon = makeC({ id: 'dragon', senses: { passivePerception: 23 } });
  const target3 = makeC({ id: 't3', pos: { x: 20, y: 0, z: 0 } });  // 100 ft
  assert('3c: Dragon (pp 23) detects target at 100 ft (≤ 115 ft)',
    isAudiblyDetected(dragon, target3) === true);

  // Hidden target → NOT detected by sound (hidden suppresses sound)
  const hiddenTarget = makeC({ id: 'hidden', pos: { x: 2, y: 0, z: 0 }, conditions: new Set(['hidden'] as any) });
  assert('3d: Hidden target NOT detected by sound (suppressed)',
    isAudiblyDetected(goblin, hiddenTarget) === false);

  // Dead target → NOT detected
  const deadTarget = makeC({ id: 'dead', pos: { x: 2, y: 0, z: 0 }, isDead: true });
  assert('3e: Dead target NOT detected by sound',
    isAudiblyDetected(goblin, deadTarget) === false);

  // Deafened observer → can't hear
  const deafGoblin = makeC({ id: 'deaf', senses: { passivePerception: 9 }, conditions: new Set(['deafened'] as any) });
  assert('3f: Deafened observer does NOT detect by sound',
    isAudiblyDetected(deafGoblin, target) === false);

  // Boundary: exactly at range (45 ft = 9 squares)
  const targetEdge = makeC({ id: 'edge', pos: { x: 9, y: 0, z: 0 } });  // 45 ft
  assert('3g: Target exactly at 45 ft (boundary) → detected (≤)',
    isAudiblyDetected(goblin, targetEdge) === true);
}

// ============================================================
console.log('\n=== 4. Visual detection (Phase 1 — LOS + not invisible/hidden) ===\n');
// ============================================================

{
  const bf = makeBF([]);
  const observer = makeC({ id: 'obs', pos: { x: 0, y: 0, z: 0 } });
  const target = makeC({ id: 'tgt', pos: { x: 5, y: 0, z: 0 } });

  assert('4a: Open field — target visible', isVisuallyDetected(observer, target, bf) === true);

  // Invisible target → not visible
  const invisibleTarget = makeC({ id: 'inv', pos: { x: 5, y: 0, z: 0 }, conditions: new Set(['invisible'] as any) });
  assert('4b: Invisible target NOT visually detected', isVisuallyDetected(observer, invisibleTarget, bf) === false);

  // Hidden target → not visible
  const hiddenTarget = makeC({ id: 'hid', pos: { x: 5, y: 0, z: 0 }, conditions: new Set(['hidden'] as any) });
  assert('4c: Hidden target NOT visually detected', isVisuallyDetected(observer, hiddenTarget, bf) === false);

  // Blinded observer → can't see
  const blindObs = makeC({ id: 'blind', pos: { x: 0, y: 0, z: 0 }, conditions: new Set(['blinded'] as any) });
  assert('4d: Blinded observer does NOT visually detect', isVisuallyDetected(blindObs, target, bf) === false);

  // Behind fog (vision-blocking obstacle)
  // Observer/target at y=2 so rays pass through fog interior (fog y=[0,5], shrunk to [eps, 5-eps]).
  const fogObs = makeC({ id: 'fog-obs', pos: { x: 0, y: 2, z: 0 } });
  const fogTgt = makeC({ id: 'fog-tgt2', pos: { x: 5, y: 2, z: 0 } });
  const bfFog = makeBF([fogObs, fogTgt], [fogCloud(1, 0, 3, 5)]);  // fog at x=[1,4], blocks LOS
  assert('4e: Target behind fog → NOT visually detected',
    isVisuallyDetected(fogObs, fogTgt, bfFog) === false);

  // Dead target → not visible
  const deadTarget = makeC({ id: 'dead', pos: { x: 5, y: 0, z: 0 }, isDead: true });
  assert('4f: Dead target NOT visually detected', isVisuallyDetected(observer, deadTarget, bf) === false);
}

// ============================================================
console.log('\n=== 5. Detection state (4-state model) ===\n');
// ============================================================

{
  const bf = makeBF([]);
  const observer = makeC({ id: 'obs', pos: { x: 0, y: 2, z: 0 }, senses: { passivePerception: 10 } });

  // Visible target
  const visTarget = makeC({ id: 'vis', pos: { x: 2, y: 2, z: 0 } });
  eq('5a: Visible target → "visible"', getDetectionState(observer, visTarget, bf), 'visible');

  // Hidden target → 'hidden' (regardless of sound/LOS)
  const hiddenTarget = makeC({ id: 'hid', pos: { x: 2, y: 2, z: 0 }, conditions: new Set(['hidden'] as any) });
  eq('5b: Hidden target → "hidden"', getDetectionState(observer, hiddenTarget, bf), 'hidden');

  // Invisible target within sound range → 'position-known'
  const invNear = makeC({ id: 'inv-near', pos: { x: 2, y: 2, z: 0 }, conditions: new Set(['invisible'] as any) });
  eq('5c: Invisible target within sound range → "position-known"', getDetectionState(observer, invNear, bf), 'position-known');

  // Invisible target OUTSIDE sound range → 'unknown'
  const invFar = makeC({ id: 'inv-far', pos: { x: 30, y: 2, z: 0 }, conditions: new Set(['invisible'] as any) });  // 150 ft > 50 ft range
  eq('5d: Invisible target outside sound range → "unknown"', getDetectionState(observer, invFar, bf), 'unknown');

  // Target behind fog, within sound range → 'position-known'
  // Observer at (0,2), target at (5,2), fog at x=[1,4] y=[0,5] → fog blocks LOS.
  // Distance = 5 squares = 25 ft, within pp=10 → 50ft sound range.
  const fogTarget = makeC({ id: 'fog-tgt', pos: { x: 5, y: 2, z: 0 } });
  const bfFog = makeBF([observer, fogTarget], [fogCloud(1, 0, 3, 5)]);
  eq('5e: Target behind fog (within sound) → "position-known"',
    getDetectionState(observer, fogTarget, bfFog), 'position-known');

  // Target behind fog, OUTSIDE sound range → 'unknown'
  // Observer at (0,2), target at (30,2) → 150 ft, outside pp=10 → 50ft range.
  const farTarget = makeC({ id: 'far', pos: { x: 30, y: 2, z: 0 } });
  const bfFogFar = makeBF([observer, farTarget], [fogCloud(1, 0, 28, 5)]);
  eq('5f: Target behind fog (outside sound) → "unknown"',
    getDetectionState(observer, farTarget, bfFogFar), 'unknown');

  // Dead target → 'unknown'
  const deadTarget = makeC({ id: 'dead', pos: { x: 2, y: 2, z: 0 }, isDead: true });
  eq('5g: Dead target → "unknown"', getDetectionState(observer, deadTarget, bf), 'unknown');
}

// ============================================================
console.log('\n=== 6. Hide action requirements (user answer #2) ===\n');
// ============================================================

{
  // Open field, no obstacles, not invisible → can't hide
  const c = makeC({ id: 'c', pos: { x: 0, y: 0, z: 0 } });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 10, y: 0, z: 0 } });
  const bf = makeBF([c, enemy]);
  assert('6a: Open field (no obscurement) → cannot hide', canTakeHideAction(c, bf) === false);

  // Invisible creature → can hide anywhere
  const invC = makeC({ id: 'inv-c', pos: { x: 0, y: 0, z: 0 }, conditions: new Set(['invisible'] as any) });
  const bf2 = makeBF([invC, enemy]);
  assert('6b: Invisible creature → can hide (even in open)', canTakeHideAction(invC, bf2) === true);

  // Behind fog (vision obstacle), no enemy LOS → can hide
  const fogHider = makeC({ id: 'fog-hider', faction: 'party', pos: { x: 0, y: 2, z: 0 } });
  const fogEnemy = makeC({ id: 'fog-enemy', faction: 'enemy', pos: { x: 15, y: 2, z: 0 } });
  const bfFog = makeBF([fogHider, fogEnemy], [fogCloud(2, 0, 12, 5)]);
  assert('6c: Behind fog (no enemy LOS) → can hide', canTakeHideAction(fogHider, bfFog) === true);

  // Behind fog BUT enemy has LOS around the fog → cannot hide
  const exposedHider = makeC({ id: 'exp-hider', faction: 'party', pos: { x: 0, y: 2, z: 0 } });
  const closeEnemy = makeC({ id: 'close-enemy', faction: 'enemy', pos: { x: 1, y: 2, z: 0 } });  // adjacent, no fog between
  const bfExposed = makeBF([exposedHider, closeEnemy], [fogCloud(10, 0, 5, 5)]);  // fog far away
  assert('6d: Fog exists but enemy has LOS → cannot hide', canTakeHideAction(exposedHider, bfExposed) === false);

  // Dim light → can hide (light obscurement)
  const dimHider = makeC({ id: 'dim-hider', pos: { x: 0, y: 0, z: 0 } });
  const dimEnemy = makeC({ id: 'dim-enemy', faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bfDim = makeBF([dimHider, dimEnemy]);
  bfDim.lightLevel = 'dim';
  assert('6e: Dim light (light obscurement) → can hide', canTakeHideAction(dimHider, bfDim) === true);

  // Indoors (default) with no obstacles → cannot hide
  const indoorHider = makeC({ id: 'ind-hider', pos: { x: 0, y: 0, z: 0 } });
  const indoorEnemy = makeC({ id: 'ind-enemy', faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bfIndoor = makeBF([indoorHider, indoorEnemy]);
  bfIndoor.lightLevel = 'indoors';
  assert('6f: Indoors (default light) no obstacles → cannot hide', canTakeHideAction(indoorHider, bfIndoor) === false);
}

// ============================================================
console.log('\n=== 7. Generalized Hide action (tryHide) ===\n');
// ============================================================

{
  // Non-Rogue creature behind fog, high DEX → should successfully hide
  const hider = makeC({
    id: 'hider', faction: 'party', pos: { x: 0, y: 2, z: 0 },
    dex: 30,  // mod +10; stealth roll min = 20 - 1 + 10 = 29 (prof 0 for non-rogue)
    wis: 10,
  });
  const enemy = makeC({
    id: 'enemy', faction: 'enemy', pos: { x: 15, y: 2, z: 0 },
    wis: 10,  // passive perception 10
  });
  const bf = makeBF([hider, enemy], [fogCloud(2, 0, 12, 5)]);
  const state = makeState(bf);

  tryHide(hider, state);

  assert('7a: Non-Rogue behind fog gains hidden condition',
    hider.conditions.has('hidden') === true);
  assert('7b: Stealth roll stored in _stealthRoll',
    hider._stealthRoll !== undefined && hider._stealthRoll > 10);

  const hideEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'condition_add' && e.actorId === 'hider' && e.description.includes('Hides')
  );
  assert('7c: "Hides!" log event fires', hideEvent !== undefined);
}

{
  // Creature in open field (no obscurement) → tryHide logs "Exposed" and does NOT grant hidden
  const exposed = makeC({ id: 'exposed', faction: 'party', pos: { x: 0, y: 0, z: 0 }, dex: 30 });
  const enemy = makeC({ id: 'enemy2', faction: 'enemy', pos: { x: 10, y: 0, z: 0 } });
  const bf = makeBF([exposed, enemy]);  // no obstacles
  const state = makeState(bf);

  tryHide(exposed, state);

  assert('7d: Open field hide → no hidden condition',
    exposed.conditions.has('hidden') === false);
  const exposedEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.actorId === 'exposed' && e.description.includes('Exposed')
  );
  assert('7e: "Exposed!" log event fires', exposedEvent !== undefined);
}

{
  // Stealth failure: low DEX vs high-PP enemy
  const weakHider = makeC({
    id: 'weak', faction: 'party', pos: { x: 0, y: 2, z: 0 },
    dex: 2,  // mod -4; max stealth roll = 20 - 4 = 16
    wis: 10,
  });
  const perceptive = makeC({
    id: 'perceptive', faction: 'enemy', pos: { x: 15, y: 2, z: 0 },
    wis: 30,  // passive perception = 10 + 10 = 20
    senses: { passivePerception: 20 },
  });
  const bf = makeBF([weakHider, perceptive], [fogCloud(2, 0, 12, 5)]);
  const state = makeState(bf);

  tryHide(weakHider, state);

  assert('7f: Stealth failure (16 < 20) → no hidden condition',
    weakHider.conditions.has('hidden') === false);
  const detectedEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.actorId === 'weak' && e.description.includes('Detected')
  );
  assert('7g: "Detected!" log event fires', detectedEvent !== undefined);
}

// ============================================================
console.log('\n=== 8. Active Perception (Search action) ===\n');
// ============================================================

{
  // Hidden enemy with stored Stealth roll. Observer takes Search action.
  // High-WIS observer should beat a low Stealth roll.
  const hidden = makeC({
    id: 'hidden-enemy', faction: 'enemy', pos: { x: 10, y: 0, z: 0 },
    conditions: new Set(['hidden'] as any),
    _stealthRoll: 12,  // low stealth roll
  });
  const searcher = makeC({
    id: 'searcher', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    wis: 30,  // mod +10; perception check min = 20 + 10 = 30 (prof 0)
    traits: ['Perception'],  // grants proficiency
    cr: 5,  // prof +3
  });
  const bf = makeBF([hidden, searcher]);
  const state = makeState(bf);

  const revealed = tryActivePerception(searcher, state);

  assert('8a: Active Perception reveals hidden enemy', revealed === true);
  assert('8b: Hidden enemy loses hidden condition',
    hidden.conditions.has('hidden') === false);
  assert('8c: _stealthRoll cleared after reveal',
    hidden._stealthRoll === undefined);

  const spotEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'condition_remove' && e.actorId === 'searcher' && e.description.includes('spots')
  );
  assert('8d: "spots" log event fires', spotEvent !== undefined);
}

{
  // No hidden enemies → action wasted
  const searcher = makeC({ id: 'searcher2', faction: 'party', pos: { x: 0, y: 0, z: 0 }, wis: 20 });
  const visible = makeC({ id: 'visible2', faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });  // not hidden
  const bf = makeBF([searcher, visible]);
  const state = makeState(bf);

  const revealed = tryActivePerception(searcher, state);
  assert('8e: No hidden enemies → returns false', revealed === false);

  const noHiddenEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.actorId === 'searcher2' && e.description.includes('no hidden')
  );
  assert('8f: "no hidden enemies" log event fires', noHiddenEvent !== undefined);
}

{
  // Active Perception FAILURE: high Stealth vs low WIS
  const hidden = makeC({
    id: 'stealthy', faction: 'enemy', pos: { x: 10, y: 0, z: 0 },
    conditions: new Set(['hidden'] as any),
    _stealthRoll: 30,  // very high stealth
  });
  const weakSearcher = makeC({
    id: 'weak-searcher', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    wis: 1,  // mod -5; max perception = 20 - 5 = 15
  });
  const bf = makeBF([hidden, weakSearcher]);
  const state = makeState(bf);

  const revealed = tryActivePerception(weakSearcher, state);
  assert('8g: Active Perception failure (15 < 30) → returns false', revealed === false);
  assert('8h: Hidden enemy keeps hidden condition on failure',
    hidden.conditions.has('hidden') === true);

  const failEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.actorId === 'weak-searcher' && e.description.includes('fails to spot')
  );
  assert('8i: "fails to spot" log event fires', failEvent !== undefined);
}

// ============================================================
console.log('\n=== 9. Stealth break on cast (user answer #3) ===\n');
// ============================================================

{
  // Default spell (verbal) breaks stealth
  assert('9a: Fireball breaks stealth (verbal component)', breaksStealthOnCast('Fireball') === true);
  assert('9b: Magic Missile breaks stealth', breaksStealthOnCast('Magic Missile') === true);
  assert('9c: Unknown spell → breaks stealth (safe default)', breaksStealthOnCast('Some New Spell') === true);
  assert('9d: Undefined spell name → breaks stealth', breaksStealthOnCast(undefined) === true);

  // Silent spells (S-only component) do NOT break stealth
  assert('9e: Counterspell does NOT break stealth (S only)', breaksStealthOnCast('Counterspell') === false);
  assert('9f: Message cantrip does NOT break stealth (whisper)', breaksStealthOnCast('Message') === false);
}

// ============================================================
console.log('\n=== 10. Count helpers (for planner) ===\n');
// ============================================================

{
  const self = makeC({ id: 'self', faction: 'party', pos: { x: 0, y: 0, z: 0 } });
  const visible = makeC({ id: 'vis', faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const hidden = makeC({
    id: 'hid', faction: 'enemy', pos: { x: 10, y: 0, z: 0 },
    conditions: new Set(['hidden'] as any),
  });
  const dead = makeC({ id: 'dead', faction: 'enemy', pos: { x: 15, y: 0, z: 0 }, isDead: true });
  const ally = makeC({ id: 'ally', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([self, visible, hidden, dead, ally]);

  eq('10a: countHiddenEnemies = 1', countHiddenEnemies(self, bf), 1);
  // countTargetableEnemies uses legacy fallback (no detection map): hidden = untargetable
  eq('10b: countTargetableEnemies (legacy) = 1 (visible only)', countTargetableEnemies(self, bf), 1);

  const nearest = nearestHiddenEnemy(self, bf);
  assert('10c: nearestHiddenEnemy returns the hidden enemy', nearest?.id === 'hid');
}

// ============================================================
console.log('\n=== 11. Planner: active Perception when all enemies hidden ===\n');
// ============================================================

{
  // All enemies hidden → planner should choose 'perceive' action
  const searcher = makeC({
    id: 'searcher', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    wis: 16, actions: [meleeAction()],
  });
  const hiddenEnemy = makeC({
    id: 'hidden-foe', faction: 'enemy', pos: { x: 10, y: 0, z: 0 },
    conditions: new Set(['hidden'] as any),
    actions: [meleeAction('Claw', 3)],
    maxHP: 500, currentHP: 500, ac: 30,  // near-immortal
  });
  const bf = makeBF([searcher, hiddenEnemy]);

  const plan = planTurn(searcher, bf);

  assert('11a: All enemies hidden → planner chooses perceive',
    plan.action?.type === 'perceive',
    `got ${plan.action?.type}`);
}

{
  // One visible + one hidden enemy → planner attacks (not perceive)
  const attacker = makeC({
    id: 'attacker', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    wis: 16, actions: [meleeAction()],
  });
  const visible = makeC({
    id: 'vis-foe', faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    actions: [meleeAction('Claw', 3)],
    maxHP: 500, currentHP: 500, ac: 10,
  });
  const hidden = makeC({
    id: 'hid-foe', faction: 'enemy', pos: { x: 10, y: 0, z: 0 },
    conditions: new Set(['hidden'] as any),
    actions: [meleeAction('Claw', 3)],
    maxHP: 500, currentHP: 500, ac: 30,
  });
  const bf = makeBF([attacker, visible, hidden]);

  const plan = planTurn(attacker, bf);

  assert('11b: Some enemies visible → planner attacks (not perceive)',
    plan.action?.type === 'attack',
    `got ${plan.action?.type}`);
}

// ============================================================
console.log('\n=== 12. Planner: generalized Hide action (low-HP non-Rogue) ===\n');
// ============================================================

{
  // Low-HP creature behind fog → planner chooses Hide action
  const lowHpHider = makeC({
    id: 'low-hp', faction: 'party', pos: { x: 0, y: 2, z: 0 },
    dex: 16, wis: 10,
    maxHP: 30, currentHP: 5,  // < 30% HP
    actions: [meleeAction()],
  });
  const enemy = makeC({
    id: 'enemy3', faction: 'enemy', pos: { x: 15, y: 2, z: 0 },
    actions: [meleeAction('Claw', 3)],
    maxHP: 100, currentHP: 100, ac: 14,
  });
  const bf = makeBF([lowHpHider, enemy], [fogCloud(2, 0, 12, 5)]);

  const plan = planTurn(lowHpHider, bf);

  assert('12a: Low-HP creature behind fog → planner chooses hide',
    plan.action?.type === 'hide',
    `got ${plan.action?.type}`);
}

{
  // Full-HP creature behind fog → planner attacks (Hide only for low HP)
  const fullHpHider = makeC({
    id: 'full-hp', faction: 'party', pos: { x: 0, y: 2, z: 0 },
    dex: 16, wis: 10,
    maxHP: 30, currentHP: 30,  // full HP
    actions: [meleeAction()],
  });
  const enemy = makeC({
    id: 'enemy4', faction: 'enemy', pos: { x: 1, y: 2, z: 0 },
    actions: [meleeAction('Claw', 3)],
    maxHP: 100, currentHP: 100, ac: 14,
  });
  const bf = makeBF([fullHpHider, enemy], [fogCloud(10, 0, 5, 5)]);  // fog elsewhere

  const plan = planTurn(fullHpHider, bf);
  assert('12b: Full-HP creature → planner attacks (not hide)',
    plan.action?.type === 'attack',
    `got ${plan.action?.type}`);
}

{
  // Low-HP creature in OPEN FIELD (no obscurement) → planner does NOT hide
  // (can't hide without obscurement). Falls back to self-preserve (retreat/dodge).
  const openHider = makeC({
    id: 'open-hider', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    dex: 16, wis: 10,
    maxHP: 30, currentHP: 5,  // low HP
    actions: [meleeAction()],
  });
  const enemy = makeC({
    id: 'enemy5', faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    actions: [meleeAction('Claw', 3)],
    maxHP: 100, currentHP: 100, ac: 14,
  });
  const bf = makeBF([openHider, enemy]);  // no obstacles

  const plan = planTurn(openHider, bf);
  assert('12c: Low-HP in open field → planner does NOT choose hide (cannot hide)',
    plan.action?.type !== 'hide',
    `got ${plan.action?.type}`);
}

// ============================================================
console.log('\n=== 13. Integration: detection state refresh at turn start ===\n');
// ============================================================

{
  // Run a 1-round combat. After the first combatant's turn starts, all
  // observers should have detection maps populated.
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 2, z: 0 },
    dex: 30, wis: 10,
    resources: { cunningAction: true } as unknown as PlayerResources,
    actions: [],
    maxHP: 100, currentHP: 100,
  });
  const enemy = makeC({
    id: 'enemy6', faction: 'enemy', pos: { x: 15, y: 2, z: 0 },
    wis: 10,
    actions: [meleeAction('Claw', 3)],
    maxHP: 500, currentHP: 500, ac: 30,
  });
  const bf = makeFlatBattlefield(20, 5, [rogue, enemy]);
  bf.obstacles = [fogCloud(2, 0, 12, 5)];

  const result = runCombat(bf, ['rogue', 'enemy6'], { maxRounds: 1 });

  // After turn start, enemy's perception.detection should be populated.
  // The rogue is behind fog (no LOS from enemy) but within sound range (75 ft, pp=10 → 50 ft; rogue at 75 ft away).
  // Rogue at (0,2), enemy at (15,2): distance = 15 squares = 75 ft. Enemy pp=10 → sound range 50 ft. 75 > 50 → unknown.
  assert('13a: Enemy detection map populated after turn start',
    enemy.perception.detection !== undefined && enemy.perception.detection.size > 0);

  // If the rogue successfully hid (bonus action), enemy should see rogue as 'hidden'.
  // If the rogue didn't hide (failed or didn't try), enemy should see rogue as 'unknown'
  // (behind fog, outside sound range). Either way, the detection state should be set.
  const rogueState = enemy.perception.detection?.get('rogue');
  assert('13b: Enemy has detection state for rogue',
    rogueState !== undefined,
    `got ${rogueState}`);
  assert('13c: Rogue is "hidden" or "unknown" (behind fog, outside sound)',
    rogueState === 'hidden' || rogueState === 'unknown',
    `got ${rogueState}`);
}

// ============================================================
console.log('\n=== 14. Integration: stealth break on cast (verbal spell) ===\n');
// ============================================================

{
  // Hidden caster casts a spell → should be revealed.
  // We simulate this by pre-setting 'hidden' + _stealthRoll, then running a
  // combat where the hidden creature casts a spell (Magic Missile).
  const hiddenCaster = makeC({
    id: 'hidden-caster', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    dex: 20, wis: 10, cha: 16,
    conditions: new Set(['hidden'] as any),
    _stealthRoll: 25,
    resources: {
      spellSlots: { 1: { max: 2, remaining: 2 } },
    } as unknown as PlayerResources,
    actions: [{
      name: 'Magic Missile', isMultiattack: false,
      attackType: 'spell', reach: 0, range: { normal: 120, long: 120 },
      hitBonus: null,  // auto-hit
      damage: { count: 3, sides: 4, bonus: 1, average: 7 },
      damageType: 'force', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
      slotLevel: 1,
    }],
    maxHP: 100, currentHP: 100,
  });
  const enemy = makeC({
    id: 'enemy7', faction: 'enemy', pos: { x: 5, y: 0, z: 0 },
    actions: [meleeAction('Claw', 3)],
    maxHP: 500, currentHP: 500, ac: 30,
    wis: 10,
  });
  const bf = makeFlatBattlefield(10, 5, [hiddenCaster, enemy]);

  const result = runCombat(bf, ['hidden-caster', 'enemy7'], { maxRounds: 1 });

  // After casting Magic Missile, the hidden caster should be revealed.
  const revealEvent = result.events.find(
    (e: CombatEvent) => e.type === 'condition_remove' && e.actorId === 'hidden-caster' && e.description.includes('revealed after casting')
  );
  assert('14a: Hidden caster revealed after casting verbal spell',
    revealEvent !== undefined,
    revealEvent ? '' : `events: ${result.events.filter((e: CombatEvent) => e.actorId === 'hidden-caster').map((e: CombatEvent) => e.type + ':' + e.description).join('; ')}`);
}

// ============================================================
console.log('\n=== 15. Backward-compat: legacy combatants (no detection map) ===\n');
// ============================================================

{
  // Combatants created without perception.detection should still work.
  // The engine lazy-inits the map on first updateDetectionStates call.
  const c1 = makeC({ id: 'legacy1', faction: 'party', pos: { x: 0, y: 0, z: 0 } });
  const c2 = makeC({ id: 'legacy2', faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  // perception.detection is undefined (legacy)
  assert('15a: Legacy combatant has no detection map initially',
    c1.perception.detection === undefined);

  const bf = makeBF([c1, c2]);
  // Run a 1-round combat — updateDetectionStates should lazy-init.
  const result = runCombat(bf, ['legacy1', 'legacy2'], { maxRounds: 1 });

  assert('15b: Legacy combatant gets detection map after turn start',
    c1.perception.detection !== undefined);
  assert('15c: Legacy combatant detects visible enemy',
    c1.perception.detection?.get('legacy2') === 'visible');
}

// ============================================================

console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('\nAll tests passed ✅');
else              process.exit(1);
