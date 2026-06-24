// ============================================================
// Test: Darkness — PHB p.230
//
// Session 63 scope:
//   ✅ Metadata shape (L2 evocation, 60 ft range, 15-ft radius, concentration)
//   ✅ shouldCast gates (has spell, has L2 slot, not concentrating, enemies present)
//   ✅ shouldCast strategy (low HP + near enemy, outnumbered + allies, round-1 opener)
//   ✅ shouldCast doesn't re-cast when already inside Darkness/Fog Cloud
//   ✅ execute: L2 slot consumed, concentration started, obstacle added to bf.obstacles
//   ✅ execute: obstacle is 7×7 grid (15-ft radius square approximation)
//   ✅ execute: ActiveEffect applied on caster (battlefield_obstacle, sourceIsConcentration)
//   ✅ execute: payload includes blocksDarkvision: true (Phase 2 forward-compat)
//   ✅ Vision subsystem integration: darkness blocks LOS (hasLineOfSight returns false)
//   ✅ Hide integration: canTakeHideAction returns true behind darkness
//   ✅ Concentration break: removeEffectsFromCaster removes the obstacle
//   ✅ Planner integration: caster casts Darkness in full combat
//   ✅ Darkness vs Fog Cloud: Darkness preferred when both available (planner order)
//
// Run: npx ts-node --transpile-only src/test/darkness.test.ts
// ============================================================

import { shouldCast, execute, metadata } from '../spells/darkness';
import { runCombat, makeFlatBattlefield, CombatEvent } from '../engine/combat';
import { hasLineOfSight } from '../engine/los';
import { canTakeHideAction } from '../engine/perception';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { Combatant, Action, PlayerResources, Vec3, Obstacle } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
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

function darknessAction(): Action {
  return {
    name: 'Darkness', isMultiattack: false,
    attackType: 'spell', reach: 0, range: { normal: 60, long: 60 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: null, saveAbility: null,
    isAoE: true, isControl: false, requiresConcentration: true,
    costType: 'action', legendaryCost: 0, description: '',
  };
}

function withL2Slots(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [] },
    disengagedThisTurn: new Set(),
    rageDamagedSinceLastTurn: new Set(),
    pendingReactions: [],
  };
}

function makeBF(combatants: Combatant[], obstacles: Obstacle[] = []): any {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    width: 20, height: 20, depth: 1, cells: [],
    combatants: map, round: 1,
    initiativeOrder: combatants.map(c => c.id),
    obstacles: obstacles.length > 0 ? obstacles : undefined,
  };
}

// ============================================================
console.log('\n=== 1. Metadata ===\n');
// ============================================================

{
  eq('1a: name = Darkness', metadata.name, 'Darkness');
  eq('1b: level = 2', metadata.level, 2);
  eq('1c: school = evocation', metadata.school, 'evocation');
  eq('1d: rangeFt = 60', metadata.rangeFt, 60);
  eq('1e: aoeSizeFt = 15', metadata.aoeSizeFt, 15);
  eq('1f: concentration = true', metadata.concentration, true);
  eq('1g: castingTime = action', metadata.castingTime, 'action');
  assert('1h: darknessVisionSubsystemV1Implemented = true', metadata.darknessVisionSubsystemV1Implemented === true);
  assert('1i: darknessBlocksDarkvisionV1Implemented = false (Phase 2)', metadata.darknessBlocksDarkvisionV1Implemented === false);
  assert('1j: darknessRemotePlacementV1Implemented = false', metadata.darknessRemotePlacementV1Implemented === false);
}

// ============================================================
console.log('\n=== 2. shouldCast gates ===\n');
// ============================================================

{
  const caster = makeC({
    id: 'caster', actions: [darknessAction()], resources: withL2Slots(2),
    pos: { x: 5, y: 5, z: 0 },
  });
  const enemy = makeC({ id: 'enemy', faction: 'party', pos: { x: 7, y: 5, z: 0 } });
  const bf = makeBF([caster, enemy]);

  // Happy path: has spell, slot, no conc, enemies present, low HP + near.
  caster.currentHP = 10;  // < 50%
  eq('2a: shouldCast returns caster (low HP + near enemy)', shouldCast(caster, bf)?.id, 'caster');

  // No spell in actions → null
  caster.actions = [];
  eq('2b: no Darkness action → null', shouldCast(caster, bf), null);
  caster.actions = [darknessAction()];

  // No L2 slot → null
  caster.resources = withL2Slots(0);
  eq('2c: no L2 slot → null', shouldCast(caster, bf), null);
  caster.resources = withL2Slots(2);

  // Already concentrating → null
  caster.concentration = { active: true, spellName: 'Bless' } as any;
  eq('2d: already concentrating → null', shouldCast(caster, bf), null);
  caster.concentration = null;

  // No enemies → null
  const deadEnemy = makeC({ id: 'dead', faction: 'party', pos: { x: 7, y: 5, z: 0 }, isDead: true });
  eq('2e: no living enemies → null', shouldCast(caster, makeBF([caster, deadEnemy])), null);

  // Already inside Darkness → null (re-cast wasteful)
  caster.activeEffects = [{
    id: 'eff1', casterId: 'caster', spellName: 'Darkness',
    effectType: 'battlefield_obstacle', payload: {}, sourceIsConcentration: true,
  } as any];
  eq('2f: already inside Darkness → null', shouldCast(caster, bf), null);
  caster.activeEffects = [];

  // Already inside Fog Cloud → null (re-cast wasteful)
  caster.activeEffects = [{
    id: 'eff2', casterId: 'caster', spellName: 'Fog Cloud',
    effectType: 'battlefield_obstacle', payload: {}, sourceIsConcentration: true,
  } as any];
  eq('2g: already inside Fog Cloud → null', shouldCast(caster, bf), null);
  caster.activeEffects = [];
}

// ============================================================
console.log('\n=== 3. shouldCast strategy ===\n');
// ============================================================

{
  // Strategy (a): low HP + near enemy (within 45 ft)
  const caster = makeC({
    id: 'caster', actions: [darknessAction()], resources: withL2Slots(2),
    maxHP: 100, currentHP: 40, pos: { x: 0, y: 0, z: 0 },  // 40% HP
  });
  const nearEnemy = makeC({ id: 'near', faction: 'party', pos: { x: 5, y: 0, z: 0 } });  // 25 ft
  const bf = makeBF([caster, nearEnemy]);
  eq('3a: low HP (40%) + near enemy (25 ft) → cast', shouldCast(caster, bf)?.id, 'caster');

  // Low HP but enemy too far (> 45 ft)
  const farEnemy = makeC({ id: 'far', faction: 'party', pos: { x: 10, y: 0, z: 0 } });  // 50 ft
  eq('3b: low HP but enemy at 50 ft (> 45) → null', shouldCast(caster, makeBF([caster, farEnemy])), null);

  // Strategy (b): outnumbered + allies
  const caster2 = makeC({
    id: 'caster2', actions: [darknessAction()], resources: withL2Slots(2),
    maxHP: 100, currentHP: 90, pos: { x: 0, y: 0, z: 0 },  // 90% HP (not low)
  });
  const ally = makeC({ id: 'ally', faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const e1 = makeC({ id: 'e1', faction: 'party', pos: { x: 5, y: 0, z: 0 } });
  const e2 = makeC({ id: 'e2', faction: 'party', pos: { x: 6, y: 0, z: 0 } });
  const e3 = makeC({ id: 'e3', faction: 'party', pos: { x: 7, y: 0, z: 0 } });
  // 3 enemies, 0 allies (excluding caster) → outnumbered (3 > 0+1)
  eq('3c: outnumbered (3 enemies, 0 allies) but no allies → null', shouldCast(caster2, makeBF([caster2, e1, e2, e3])), null);
  // 3 enemies + 1 ally → outnumbered + has allies → cast
  eq('3d: outnumbered (3 enemies) + 1 ally → cast', shouldCast(caster2, makeBF([caster2, ally, e1, e2, e3]))?.id, 'caster2');

  // Strategy (c): round 1 opener, no better conc spell
  const caster3 = makeC({
    id: 'caster3', actions: [darknessAction()], resources: withL2Slots(2),
    maxHP: 100, currentHP: 100, pos: { x: 0, y: 0, z: 0 },  // full HP
  });
  const ally3 = makeC({ id: 'ally3', faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const enemy3 = makeC({ id: 'enemy3', faction: 'party', pos: { x: 8, y: 0, z: 0 } });  // 40 ft (not near for strat a)
  const bf3 = makeBF([caster3, ally3, enemy3]);
  eq('3e: round 1 + ally + no better conc spell → cast', shouldCast(caster3, bf3)?.id, 'caster3');

  // Has a better conc spell (Bless) → null for strategy (c)
  caster3.actions = [darknessAction(), { ...darknessAction(), name: 'Bless' }];
  eq('3f: round 1 but has Bless (better conc) → null', shouldCast(caster3, bf3), null);
}

// ============================================================
console.log('\n=== 4. execute — basic mechanics ===\n');
// ============================================================

{
  const caster = makeC({
    id: 'caster', actions: [darknessAction()], resources: withL2Slots(2),
    pos: { x: 5, y: 5, z: 0 },
  });
  const enemy = makeC({ id: 'enemy', faction: 'party', pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  // L2 slot consumed
  eq('4a: L2 slot consumed', caster.resources?.spellSlots?.[2].remaining, 1);
  // Concentration started
  assert('4b: concentration active', caster.concentration?.active === true);
  eq('4c: concentrating on Darkness', caster.concentration?.spellName, 'Darkness');
  // Obstacle added to bf
  const obstacles = bf.obstacles ?? [];
  eq('4d: one obstacle added', obstacles.length, 1);
  const obs = obstacles[0];
  eq('4e: obstacle id starts with darkness-', String(obs.id).startsWith('darkness-'), true);
  eq('4f: obstacle blocksVision = true', obs.blocksVision, true);
  eq('4g: obstacle blocksMovement = false', obs.blocksMovement, false);
  // 7×7 grid (3 squares radius each direction = 7 wide)
  eq('4h: obstacle width = 7', obs.width, 7);
  eq('4i: obstacle depth = 7', obs.depth, 7);
  // Centered on caster
  eq('4j: obstacle x = caster.x - 3 = 2', obs.x, 2);
  eq('4k: obstacle y = caster.y - 3 = 2', obs.y, 2);
  eq('4l: obstacle z = caster.z = 0', obs.z, 0);
}

// ============================================================
console.log('\n=== 5. execute — ActiveEffect on caster ===\n');
// ============================================================

{
  const caster = makeC({
    id: 'caster', actions: [darknessAction()], resources: withL2Slots(2),
    pos: { x: 5, y: 5, z: 0 },
  });
  const enemy = makeC({ id: 'enemy', faction: 'party', pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  const effect = caster.activeEffects.find(e => e.spellName === 'Darkness');
  assert('5a: Darkness ActiveEffect on caster', effect !== undefined);
  if (effect) {
    eq('5b: effectType = battlefield_obstacle', effect.effectType, 'battlefield_obstacle');
    eq('5c: sourceIsConcentration = true', effect.sourceIsConcentration, true);
    eq('5d: casterId = caster', effect.casterId, 'caster');
    // Payload fields
    assert('5e: payload.obstacleId starts with darkness-', String(effect.payload.obstacleId ?? '').startsWith('darkness-'));
    eq('5f: payload.obstacleRadiusFt = 15', effect.payload.obstacleRadiusFt, 15);
    eq('5g: payload.obstacleCenterX = 5', effect.payload.obstacleCenterX, 5);
    eq('5h: payload.obstacleCenterY = 5', effect.payload.obstacleCenterY, 5);
    // KEY: blocksDarkvision flag (Phase 2 forward-compat)
    eq('5i: payload.blocksDarkvision = true (Darkness blocks darkvision)', effect.payload.blocksDarkvision, true);
  }
}

// ============================================================
console.log('\n=== 6. Vision subsystem integration ===\n');
// ============================================================

{
  const caster = makeC({
    id: 'caster', actions: [darknessAction()], resources: withL2Slots(2),
    pos: { x: 5, y: 5, z: 0 },
  });
  const enemy = makeC({ id: 'enemy', faction: 'party', pos: { x: 6, y: 5, z: 0 } });
  const farEnemy = makeC({ id: 'far', faction: 'party', pos: { x: 12, y: 5, z: 0 } });  // outside darkness
  const bf = makeBF([caster, enemy, farEnemy]);
  const state = makeState(bf);

  // Before cast: caster can see both enemies
  assert('6a: before cast, caster sees near enemy', hasLineOfSight(caster, enemy, bf));
  assert('6b: before cast, caster sees far enemy', hasLineOfSight(caster, farEnemy, bf));

  execute(caster, caster, state);

  // After cast: darkness obstacle blocks LOS through it.
  // The far enemy is at x=12, darkness covers x=2..8. Caster at x=5 (inside).
  // LOS from caster (inside darkness) to far enemy (outside) should be blocked
  // because the ray passes through the darkness obstacle.
  // (Exact behavior depends on LOS implementation — the obstacle blocksVision
  // flag is checked by hasLineOfSight.)
  // The near enemy is also inside the darkness (x=6 is within x=2..8).
  // Both are in the darkness → LOS is blocked by the obstacle.
  assert('6c: after cast, caster LOS to near enemy blocked by darkness',
    !hasLineOfSight(caster, enemy, bf),
    `LOS was ${hasLineOfSight(caster, enemy, bf)}`);

  // canTakeHideAction: darkness provides obscurement → can hide
  assert('6d: canTakeHideAction true behind darkness', canTakeHideAction(caster, bf));
}

// ============================================================
console.log('\n=== 7. Concentration break removes obstacle ===\n');
// ============================================================

{
  const caster = makeC({
    id: 'caster', actions: [darknessAction()], resources: withL2Slots(2),
    pos: { x: 5, y: 5, z: 0 },
  });
  const enemy = makeC({ id: 'enemy', faction: 'party', pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);
  eq('7a: obstacle present after cast', (bf.obstacles ?? []).length, 1);
  eq('7b: ActiveEffect present after cast', caster.activeEffects.length, 1);

  // Simulate concentration break
  removeEffectsFromCaster(caster.id, bf);

  eq('7c: obstacle removed after concentration break', (bf.obstacles ?? []).length, 0);
  eq('7d: ActiveEffect removed after concentration break',
    caster.activeEffects.filter(e => e.spellName === 'Darkness').length, 0);
}

// ============================================================
console.log('\n=== 8. Planner integration — caster casts Darkness in combat ===\n');
// ============================================================

{
  // Full combat: a low-HP caster with Darkness vs an enemy. The caster
  // should cast Darkness on round 1 (low HP + near enemy strategy).
  const caster = makeC({
    id: 'caster', name: 'Warlock', faction: 'party',
    maxHP: 40, currentHP: 15, ac: 13, speed: 30,  // 37.5% HP (low)
    str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 16,
    cr: 3, pos: { x: 5, y: 5, z: 0 },
    actions: [darknessAction(), {
      name: 'Eldritch Blast', isMultiattack: false,
      attackType: 'spell', reach: 0, range: { normal: 120, long: 120 },
      hitBonus: 5, damage: { count: 1, sides: 10, bonus: 0, average: 5 },
      damageType: 'force', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      slotLevel: 0, costType: 'action', legendaryCost: 0, description: '',
    }],
    resources: withL2Slots(2),
  });
  const enemy = makeC({
    id: 'enemy', name: 'Orc', faction: 'enemy',
    maxHP: 30, currentHP: 30, ac: 13, pos: { x: 7, y: 5, z: 0 },  // 10 ft away
    actions: [{
      name: 'Greataxe', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 5, damage: { count: 1, sides: 12, bonus: 3, average: 9 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });

  const bf = makeFlatBattlefield(15, 15, [caster, enemy]);
  const result = runCombat(bf, ['caster', 'enemy'], { maxRounds: 1 });

  // The caster should have cast Darkness on round 1.
  const darknessEvent = result.events.find(
    e => e.actorId === 'caster' && /Darkness/i.test(e.description)
  );
  assert('8a: caster casts Darkness in round 1', darknessEvent !== undefined,
    `events: ${result.events.filter(e=>e.actorId==='caster').map(e=>e.description).join('; ')}`);

  // Verify the darkness obstacle was added to the battlefield.
  const obstacleEvent = result.events.find(
    e => e.actorId === 'caster' && /magical darkness/i.test(e.description)
  );
  assert('8b: darkness obstacle logged', obstacleEvent !== undefined);
}

// ============================================================
console.log('\n=== 9. Darkness vs Fog Cloud — planner preference ===\n');
// ============================================================

{
  // A caster with BOTH Darkness and Fog Cloud at low HP should cast Darkness
  // (the Darkness planner branch sits ABOVE Fog Cloud).
  const caster = makeC({
    id: 'caster', name: 'DualCaster', faction: 'party',
    maxHP: 40, currentHP: 15, ac: 13, pos: { x: 5, y: 5, z: 0 },
    actions: [darknessAction(), {
      name: 'Fog Cloud', isMultiattack: false,
      attackType: 'spell', reach: 0, range: { normal: 120, long: 120 },
      hitBonus: null, damage: null, damageType: null,
      saveDC: null, saveAbility: null,
      isAoE: true, isControl: false, requiresConcentration: true,
      costType: 'action', legendaryCost: 0, description: '',
    }],
    resources: { spellSlots: { 1: { max: 2, remaining: 2 }, 2: { max: 2, remaining: 2 } } },
  });
  const enemy = makeC({
    id: 'enemy', faction: 'enemy', pos: { x: 7, y: 5, z: 0 },
    maxHP: 30, currentHP: 30, ac: 13,
    actions: [{
      name: 'Club', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 4, damage: { count: 1, sides: 6, bonus: 2, average: 5 },
      damageType: 'bludgeoning', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });

  const bf = makeFlatBattlefield(15, 15, [caster, enemy]);
  const result = runCombat(bf, ['caster', 'enemy'], { maxRounds: 1 });

  // Caster should cast Darkness (not Fog Cloud) — Darkness branch fires first.
  const darknessEvent = result.events.find(
    e => e.actorId === 'caster' && /casts Darkness/i.test(e.description)
  );
  const fogCloudEvent = result.events.find(
    e => e.actorId === 'caster' && /casts Fog Cloud/i.test(e.description)
  );
  assert('9a: caster casts Darkness (preferred over Fog Cloud)', darknessEvent !== undefined,
    `events: ${result.events.filter(e=>e.actorId==='caster').map(e=>e.description).join('; ')}`);
  assert('9b: caster does NOT cast Fog Cloud (Darkness won)', fogCloudEvent === undefined);
}

// ============================================================
console.log('\n=== 10. Backward-compat — Fog Cloud unaffected ===\n');
// ============================================================

{
  // Fog Cloud should still work exactly as before (no regression from Darkness).
  // Quick smoke test: Fog Cloud shouldCast + execute still work.
  const { shouldCast: shouldCastFC, execute: executeFC } = require('../spells/fog_cloud');
  const caster = makeC({
    id: 'fc_caster', pos: { x: 5, y: 5, z: 0 },
    maxHP: 40, currentHP: 15,  // low HP
    actions: [{
      name: 'Fog Cloud', isMultiattack: false,
      attackType: 'spell', reach: 0, range: { normal: 120, long: 120 },
      hitBonus: null, damage: null, damageType: null,
      saveDC: null, saveAbility: null,
      isAoE: true, isControl: false, requiresConcentration: true,
      costType: 'action', legendaryCost: 0, description: '',
    }],
    resources: { spellSlots: { 1: { max: 2, remaining: 2 } } },
  });
  const enemy = makeC({ id: 'fc_enemy', faction: 'party', pos: { x: 7, y: 5, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCastFC(caster, bf);
  assert('10a: Fog Cloud shouldCast still works', target !== null);
  if (target) {
    executeFC(caster, target, state);
    assert('10b: Fog Cloud execute still works (obstacle added)', (bf.obstacles ?? []).length === 1);
    // Fog Cloud obstacle should NOT have blocksDarkvision in its effect payload.
    const fcEffect = caster.activeEffects.find(e => e.spellName === 'Fog Cloud');
    assert('10c: Fog Cloud payload.blocksDarkvision undefined (not Darkness)',
      fcEffect?.payload?.blocksDarkvision === undefined,
      `got ${fcEffect?.payload?.blocksDarkvision}`);
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('\nAll tests passed ✅');
