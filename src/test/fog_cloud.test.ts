// ============================================================
// Test: Fog Cloud — PHB p.243
//
// Session 62 scope:
//   ✅ Metadata shape
//   ✅ shouldCast gates (has spell, has slot, not concentrating, enemies present)
//   ✅ shouldCast strategy (low HP + near enemy, outnumbered + allies, round-1 opener)
//   ✅ execute: slot consumed, concentration started, obstacle added to bf.obstacles
//   ✅ execute: ActiveEffect applied on caster (battlefield_obstacle, sourceIsConcentration)
//   ✅ Vision subsystem integration: fog blocks LOS (hasLineOfSight returns false)
//   ✅ Hide integration: canTakeHideAction returns true behind fog
//   ✅ Concentration break: removeEffectsFromCaster removes the obstacle
//
// Run: ts-node src/test/fog_cloud.test.ts
// ============================================================

import { shouldCast, execute, metadata } from '../spells/fog_cloud';
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

function fogCloudAction(): Action {
  return {
    name: 'Fog Cloud', isMultiattack: false,
    attackType: 'spell', reach: 0, range: { normal: 120, long: 120 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: null, saveAbility: null,
    isAoE: true, isControl: false, requiresConcentration: true,
    costType: 'action', legendaryCost: 0, description: '',
  };
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
    width: 30, height: 30, depth: 1, cells: [],
    combatants: map, round: 1,
    initiativeOrder: combatants.map(c => c.id),
    obstacles: obstacles.length > 0 ? obstacles : undefined,
  };
}

function slots(max: number, remaining?: number): PlayerResources {
  return {
    spellSlots: { 1: { max, remaining: remaining ?? max } },
  } as unknown as PlayerResources;
}

// ============================================================
console.log('\n=== 1. Metadata ===\n');
// ============================================================

{
  eq('1a: name', metadata.name, 'Fog Cloud');
  eq('1b: level', metadata.level, 1);
  eq('1c: school', metadata.school, 'conjuration');
  eq('1d: rangeFt', metadata.rangeFt, 120);
  eq('1e: aoeSizeFt (20-ft radius)', metadata.aoeSizeFt, 20);
  eq('1f: concentration', metadata.concentration, true);
  eq('1g: castingTime', metadata.castingTime, 'action');
  assert('1h: vision subsystem flag', metadata.fogCloudVisionSubsystemV1Implemented === true);
}

// ============================================================
console.log('\n=== 2. shouldCast gates ===\n');
// ============================================================

{
  // No 'Fog Cloud' in actions → null
  const c = makeC({ id: 'c1', resources: slots(2) });
  eq('2a: No Fog Cloud action → null', shouldCast(c, makeBF([])), null);

  // Has action but no slot → null
  const c2 = makeC({ id: 'c2', actions: [fogCloudAction()], resources: slots(0, 0) });
  eq('2b: No slot available → null', shouldCast(c2, makeBF([])), null);

  // Already concentrating → null
  const c3 = makeC({
    id: 'c3', actions: [fogCloudAction()], resources: slots(2),
    concentration: { active: true, spellName: 'Bless', dcIfHit: 10 } as any,
  });
  eq('2c: Already concentrating → null', shouldCast(c3, makeBF([])), null);

  // Has action + slot + not concentrating, but no enemies → null
  const c4 = makeC({ id: 'c4', actions: [fogCloudAction()], resources: slots(2), faction: 'party' });
  const ally = makeC({ id: 'ally', faction: 'party', pos: { x: 5, y: 0, z: 0 } });
  eq('2d: No enemies → null', shouldCast(c4, makeBF([c4, ally])), null);
}

// ============================================================
console.log('\n=== 3. shouldCast strategy ===\n');
// ============================================================

{
  // Strategy (a): low HP (<50%) + enemy within 60 ft → cast
  const lowHp = makeC({
    id: 'lowhp', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [fogCloudAction()], resources: slots(2),
    maxHP: 30, currentHP: 10,  // 33% HP
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });  // 25 ft away
  const result = shouldCast(lowHp, makeBF([lowHp, enemy]));
  assert('3a: Low HP + near enemy → cast (returns self)',
    result !== null && result.id === 'lowhp');

  // Low HP but enemy far away (>60 ft) → strategy (a) doesn't fire
  const lowHp2 = makeC({
    id: 'lowhp2', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [fogCloudAction()], resources: slots(2),
    maxHP: 30, currentHP: 10,
  });
  const farEnemy = makeC({ id: 'fare', faction: 'enemy', pos: { x: 15, y: 0, z: 0 } });  // 75 ft away
  const result2 = shouldCast(lowHp2, makeBF([lowHp2, farEnemy]));
  // Strategy (a) doesn't fire, but strategy (c) might (round 1 + allies).
  // No allies here → (c) doesn't fire either → null.
  eq('3b: Low HP but no near enemy + no allies → null', result2, null);
}

{
  // Strategy (b): outnumbered + allies → cast
  const caster = makeC({
    id: 'caster', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [fogCloudAction()], resources: slots(2),
    maxHP: 30, currentHP: 30,  // full HP
  });
  const ally = makeC({ id: 'ally', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const e1 = makeC({ id: 'e1', faction: 'enemy', pos: { x: 10, y: 0, z: 0 } });
  const e2 = makeC({ id: 'e2', faction: 'enemy', pos: { x: 11, y: 0, z: 0 } });
  const e3 = makeC({ id: 'e3', faction: 'enemy', pos: { x: 12, y: 0, z: 0 } });
  // 3 enemies > 1 ally + 1 = 2 → outnumbered
  const result = shouldCast(caster, makeBF([caster, ally, e1, e2, e3]));
  assert('3c: Outnumbered + allies → cast (returns self)',
    result !== null && result.id === 'caster');
}

{
  // Already inside a Fog Cloud (has battlefield_obstacle effect) → don't re-cast
  const inFog = makeC({
    id: 'infog', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [fogCloudAction()], resources: slots(2),
    maxHP: 30, currentHP: 10,  // low HP (strategy a)
    activeEffects: [{
      id: 'eff1', casterId: 'infog', spellName: 'Fog Cloud',
      effectType: 'battlefield_obstacle', payload: { obstacleId: 'fogcloud-infog-1' },
      sourceIsConcentration: true,
    }] as any,
  });
  const enemy = makeC({ id: 'en', faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  eq('3d: Already in Fog Cloud → null (no re-cast)', shouldCast(inFog, makeBF([inFog, enemy])), null);
}

// ============================================================
console.log('\n=== 4. execute: slot + concentration + obstacle ===\n');
// ============================================================

{
  const caster = makeC({
    id: 'caster', faction: 'party', pos: { x: 10, y: 10, z: 0 },
    actions: [fogCloudAction()], resources: slots(2),
    maxHP: 30, currentHP: 10,
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 12, y: 10, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  // Slot consumed
  eq('4a: Slot consumed (1 remaining)', caster.resources!.spellSlots![1].remaining, 1);

  // Concentration started
  assert('4b: Concentration active', caster.concentration?.active === true);
  eq('4c: Concentration spellName', caster.concentration?.spellName, 'Fog Cloud');

  // Obstacle added to bf.obstacles
  assert('4d: Obstacle added to bf.obstacles', bf.obstacles !== undefined && bf.obstacles.length === 1);
  const fog = bf.obstacles[0];
  eq('4e: Obstacle blocksVision', fog.blocksVision, true);
  eq('4f: Obstacle does NOT blockMovement', fog.blocksMovement, false);
  eq('4g: Obstacle ID format', fog.id.startsWith('fogcloud-caster-'), true);

  // The fog is centered on the caster (10,10) with radius 4 squares → x=[6,14], y=[6,14]
  eq('4h: Obstacle x (center 10 - radius 4)', fog.x, 6);
  eq('4i: Obstacle y (center 10 - radius 4)', fog.y, 6);
  eq('4j: Obstacle width (9 squares)', fog.width, 9);
  eq('4k: Obstacle depth (9 squares)', fog.depth, 9);

  // ActiveEffect applied on caster
  const effect = caster.activeEffects.find(e => e.spellName === 'Fog Cloud');
  assert('4l: ActiveEffect applied on caster', effect !== undefined);
  eq('4m: effectType = battlefield_obstacle', effect?.effectType, 'battlefield_obstacle');
  eq('4n: sourceIsConcentration = true', effect?.sourceIsConcentration, true);
  eq('4o: obstacleId matches', effect?.payload.obstacleId, fog.id);

  // Log events
  const castEvent = state.log.events.find((e: CombatEvent) => e.type === 'action' && e.description.includes('casts Fog Cloud'));
  assert('4p: "casts Fog Cloud" log event', castEvent !== undefined);
}

// ============================================================
console.log('\n=== 5. Vision subsystem integration ===\n');
// ============================================================

{
  // After Fog Cloud is cast, LOS through the fog is blocked.
  const caster = makeC({
    id: 'caster', faction: 'party', pos: { x: 10, y: 10, z: 0 },
    actions: [fogCloudAction()], resources: slots(2),
    maxHP: 30, currentHP: 10,
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 20, y: 10, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  // Before cast: enemy can see caster (open field)
  assert('5a: Before cast — enemy has LOS to caster',
    hasLineOfSight(enemy, caster, bf) === true);

  execute(caster, caster, state);

  // After cast: fog is at x=[6,14], y=[6,14]. Caster at (10,10) is inside.
  // Enemy at (20,10) → rays from (20,10) to (10,10) pass through x=[14,6] at y=10 → inside fog → blocked.
  assert('5b: After cast — enemy LOS to caster blocked by fog',
    hasLineOfSight(enemy, caster, bf) === false);
}

// ============================================================
console.log('\n=== 6. Hide action integration ===\n');
// ============================================================

{
  // After Fog Cloud, the caster can take the Hide action (obscurement available).
  const caster = makeC({
    id: 'caster', faction: 'party', pos: { x: 10, y: 10, z: 0 },
    actions: [fogCloudAction()], resources: slots(2),
    maxHP: 30, currentHP: 10,
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 20, y: 10, z: 0 } });
  const bf = makeBF([caster, enemy]);

  // Before cast: caster can't hide (open field, enemy has LOS)
  assert('6a: Before cast — cannot hide (open field)', canTakeHideAction(caster, bf) === false);

  const state = makeState(bf);
  execute(caster, caster, state);

  // After cast: fog blocks enemy LOS → caster can hide
  assert('6b: After cast — can hide (fog blocks enemy LOS)', canTakeHideAction(caster, bf) === true);
}

// ============================================================
console.log('\n=== 7. Concentration break removes obstacle ===\n');
// ============================================================

{
  const caster = makeC({
    id: 'caster', faction: 'party', pos: { x: 10, y: 10, z: 0 },
    actions: [fogCloudAction()], resources: slots(2),
    maxHP: 30, currentHP: 10,
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 20, y: 10, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);
  assert('7a: Obstacle added', bf.obstacles.length === 1);

  // Simulate concentration break
  removeEffectsFromCaster(caster.id, bf);

  // Obstacle removed
  assert('7b: Obstacle removed after concentration break', bf.obstacles.length === 0);

  // ActiveEffect removed
  const effect = caster.activeEffects.find(e => e.spellName === 'Fog Cloud');
  assert('7c: ActiveEffect removed', effect === undefined);

  // LOS restored
  assert('7d: LOS restored after fog disperses',
    hasLineOfSight(enemy, caster, bf) === true);
}

// ============================================================
console.log('\n=== 8. Integration: runCombat ===\n');
// ============================================================

{
  // Full combat: low-HP caster casts Fog Cloud round 1.
  //
  // The enemy is a harmless "training dummy" (cannotAttack: true, no
  // actions) so it can never damage the caster → concentration never
  // breaks → the Fog Cloud obstacle persists.
  //
  // PREVIOUS (flaky) APPROACH: enemy had a Shortbow with hitBonus -20,
  // intending "never hits". But a natural 20 on the d20 is ALWAYS a
  // critical hit regardless of hitBonus (PHB p.194). The crit + Sneak
  // Attack damage (which fires even at disadvantage — separate bug)
  // dealt 9-10 damage, either killing the caster (10 HP) outright or
  // breaking concentration via the save. This produced ~3-7% test
  // flakiness that CI occasionally hit (see Session 79 handover).
  //
  // The caster's faction ('party') is NOT auto-defeated by
  // teamHasNoAttackCapability because canDealDamage() falls back to
  // "improvised unarmed is always available" for non-cannotAttack
  // creatures. The enemy faction WILL be auto-defeated at end of round
  // 1, but that happens AFTER the caster's turn — obstacle +
  // concentration are already set by then, and auto-defeat doesn't
  // kill anyone.
  const caster = makeC({
    id: 'caster', faction: 'party', pos: { x: 0, y: 5, z: 0 },
    actions: [fogCloudAction()], resources: slots(2),
    maxHP: 30, currentHP: 10,  // low HP → strategy (a) fires
    dex: 14, wis: 12,
  });
  const enemy = makeC({
    id: 'enemy', faction: 'enemy', pos: { x: 5, y: 5, z: 0 },
    actions: [],            // harmless training dummy
    cannotAttack: true,     // cannot use improvised unarmed fallback
    maxHP: 100, currentHP: 100, ac: 15,
  });
  const bf = makeFlatBattlefield(20, 10, [caster, enemy]);

  const result = runCombat(bf, ['caster', 'enemy'], { maxRounds: 1 });

  // Verify Fog Cloud was cast
  const castEvent = result.events.find(
    (e: CombatEvent) => e.type === 'action' && e.actorId === 'caster' && e.description.includes('Fog Cloud')
  );
  assert('8a: Fog Cloud cast in round 1', castEvent !== undefined);

  // Verify obstacle was added
  assert('8b: bf.obstacles has the fog', bf.obstacles !== undefined && bf.obstacles.some(o => o.id.startsWith('fogcloud-')));

  // Verify concentration is active
  assert('8c: Caster concentrating on Fog Cloud',
    caster.concentration?.active === true && caster.concentration?.spellName === 'Fog Cloud');
}

// ============================================================

console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('\nAll tests passed ✅');
else              process.exit(1);
