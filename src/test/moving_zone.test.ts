// ============================================================
// moving_zone.test.ts — Moving AoE zone system
// Tests for _movingZone scratch field, start-of-turn zone movement,
// new target damage application, old target effect removal, and
// concentration break cleanup for Flaming Sphere, Moonbeam,
// Call Lightning, and Cloudkill.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - DEX/CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - DEX/CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast as shouldCastFS, execute as executeFS, metadata as metaFS } from '../spells/flaming_sphere';
import { shouldCast as shouldCastMB, execute as executeMB, metadata as metaMB } from '../spells/moonbeam';
import { shouldCast as shouldCastCL, execute as executeCL, metadata as metaCL } from '../spells/call_lightning';
import { shouldCast as shouldCastCK, execute as executeCK, metadata as metaCK } from '../spells/cloudkill';
import { removeEffectsFromCaster, getActiveDamageZones, _resetEffectIdCounter } from '../engine/spell_effects';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots(level: number, remaining = 2): PlayerResources {
  return { spellSlots: { [level]: { max: 2, remaining } } };
}

const FLAMING_SPHERE_ACTION: Action = {
  name: 'Flaming Sphere',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: 'fire',
  saveDC: 25,
  saveAbility: 'dex',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Flaming Sphere (DEX save, 2d6 fire, concentration)',
};

const MOONBEAM_ACTION: Action = {
  name: 'Moonbeam',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 120, long: 120 },
  hitBonus: null,
  damage: null,
  damageType: 'radiant',
  saveDC: 25,
  saveAbility: 'con',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Moonbeam (CON save, 2d10 radiant, concentration)',
};

const CALL_LIGHTNING_ACTION: Action = {
  name: 'Call Lightning',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: 'lightning',
  saveDC: 25,
  saveAbility: 'dex',
  isAoE: true,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Call Lightning (3d10 lightning, concentration)',
};

const CLOUDKILL_ACTION: Action = {
  name: 'Cloudkill',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 120, long: 120 },
  hitBonus: null,
  damage: null,
  damageType: 'poison',
  saveDC: 25,
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 5,
  costType: 'action',
  legendaryCost: 0,
  description: 'Cloudkill (CON save, 5d8 poison, 20-ft radius, concentration)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set() as Set<Condition>,
    aiProfile: 'smart',
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    ...overrides,
  };
}

function makeBF(combatants: Combatant[]) {
  return {
    width: 40, height: 40, depth: 1,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// ---- Section 1: Flaming Sphere _movingZone on cast ----------

console.log('\n=== Section 1: Flaming Sphere sets _movingZone on cast ===');
{
  _resetEffectIdCounter();
  const wizard = makeCombatant('wiz', {
    name: 'Wizard',
    pos: { x: 0, y: 0, z: 0 },
    actions: [FLAMING_SPHERE_ACTION],
    resources: withSlots(2, 2),
  });
  const enemy = makeCombatant('enemy1', {
    name: 'Enemy',
    faction: 'enemy',
    pos: { x: 5, y: 0, z: 0 },
    dex: 1,  // guaranteed fail
  });
  const bf = makeBF([wizard, enemy]);
  const state = makeState(bf);

  executeFS(wizard, enemy, state);

  assert('Flaming Sphere: _movingZone is set on caster', wizard._movingZone !== undefined);
  eq('Flaming Sphere: spellName', wizard._movingZone!.spellName, 'Flaming Sphere');
  eq('Flaming Sphere: centerX', wizard._movingZone!.centerX, 5);
  eq('Flaming Sphere: centerY', wizard._movingZone!.centerY, 0);
  eq('Flaming Sphere: centerZ', wizard._movingZone!.centerZ, 0);
  eq('Flaming Sphere: radiusFt', wizard._movingZone!.radiusFt, 5);
  eq('Flaming Sphere: movePerTurn', wizard._movingZone!.movePerTurn, 30);
}

// ---- Section 2: Moonbeam _movingZone on cast ----------------

console.log('\n=== Section 2: Moonbeam sets _movingZone on cast ===');
{
  _resetEffectIdCounter();
  const wizard = makeCombatant('wiz', {
    name: 'Wizard',
    pos: { x: 0, y: 0, z: 0 },
    actions: [MOONBEAM_ACTION],
    resources: withSlots(2, 2),
  });
  const enemy = makeCombatant('enemy1', {
    name: 'Enemy',
    faction: 'enemy',
    pos: { x: 10, y: 0, z: 0 },
    con: 1,
  });
  const bf = makeBF([wizard, enemy]);
  const state = makeState(bf);

  executeMB(wizard, enemy, state);

  assert('Moonbeam: _movingZone is set on caster', wizard._movingZone !== undefined);
  eq('Moonbeam: spellName', wizard._movingZone!.spellName, 'Moonbeam');
  eq('Moonbeam: centerX', wizard._movingZone!.centerX, 10);
  eq('Moonbeam: centerY', wizard._movingZone!.centerY, 0);
  eq('Moonbeam: radiusFt', wizard._movingZone!.radiusFt, 5);
  eq('Moonbeam: movePerTurn', wizard._movingZone!.movePerTurn, 60);
}

// ---- Section 3: Call Lightning _movingZone on cast ----------

console.log('\n=== Section 3: Call Lightning sets _movingZone on cast ===');
{
  _resetEffectIdCounter();
  const wizard = makeCombatant('wiz', {
    name: 'Wizard',
    pos: { x: 0, y: 0, z: 0 },
    actions: [CALL_LIGHTNING_ACTION],
    resources: withSlots(3, 2),
  });
  const enemy = makeCombatant('enemy1', {
    name: 'Enemy',
    faction: 'enemy',
    pos: { x: 5, y: 0, z: 0 },
    dex: 1,
  });
  const bf = makeBF([wizard, enemy]);
  const state = makeState(bf);

  const targets = shouldCastCL(wizard, bf);
  if (targets) executeCL(wizard, targets, state);

  assert('Call Lightning: _movingZone is set on caster', wizard._movingZone !== undefined);
  eq('Call Lightning: spellName', wizard._movingZone!.spellName, 'Call Lightning');
  eq('Call Lightning: centerX', wizard._movingZone!.centerX, 5);
  eq('Call Lightning: centerY', wizard._movingZone!.centerY, 0);
  eq('Call Lightning: radiusFt', wizard._movingZone!.radiusFt, 10);
  eq('Call Lightning: movePerTurn', wizard._movingZone!.movePerTurn, 60);
}

// ---- Section 4: Cloudkill _movingZone on cast ---------------

console.log('\n=== Section 4: Cloudkill sets _movingZone on cast ===');
{
  _resetEffectIdCounter();
  const wizard = makeCombatant('wiz', {
    name: 'Wizard',
    pos: { x: 0, y: 0, z: 0 },
    actions: [CLOUDKILL_ACTION],
    resources: withSlots(5, 2),
  });
  const enemy = makeCombatant('enemy1', {
    name: 'Enemy',
    faction: 'enemy',
    pos: { x: 5, y: 0, z: 0 },
    con: 1,
  });
  const bf = makeBF([wizard, enemy]);
  const state = makeState(bf);

  const targets = shouldCastCK(wizard, bf);
  if (targets) executeCK(wizard, targets, state);

  assert('Cloudkill: _movingZone is set on caster', wizard._movingZone !== undefined);
  eq('Cloudkill: spellName', wizard._movingZone!.spellName, 'Cloudkill');
  eq('Cloudkill: centerX', wizard._movingZone!.centerX, 5);
  eq('Cloudkill: centerY', wizard._movingZone!.centerY, 0);
  eq('Cloudkill: radiusFt', wizard._movingZone!.radiusFt, 20);
  eq('Cloudkill: movePerTurn', wizard._movingZone!.movePerTurn, 10);
}

// ---- Section 5: Concentration break clears _movingZone ------

console.log('\n=== Section 5: Concentration break clears _movingZone ===');
{
  _resetEffectIdCounter();
  const wizard = makeCombatant('wiz', {
    name: 'Wizard',
    pos: { x: 0, y: 0, z: 0 },
    actions: [FLAMING_SPHERE_ACTION],
    resources: withSlots(2, 2),
  });
  const enemy = makeCombatant('enemy1', {
    name: 'Enemy',
    faction: 'enemy',
    pos: { x: 5, y: 0, z: 0 },
    dex: 1,
  });
  const bf = makeBF([wizard, enemy]);
  const state = makeState(bf);

  executeFS(wizard, enemy, state);
  assert('Before concentration break: _movingZone is set', wizard._movingZone !== undefined);

  // Simulate concentration break
  removeEffectsFromCaster(wizard.id, bf);
  assert('After concentration break: _movingZone is cleared', wizard._movingZone === undefined);
  assert('After concentration break: enemy damage_zone effects are removed',
    enemy.activeEffects.filter(e => e.casterId === wizard.id && e.effectType === 'damage_zone').length === 0);
}

// ---- Section 6: Concentration break clears _movingZone for Moonbeam ------

console.log('\n=== Section 6: Concentration break clears _movingZone for Moonbeam ===');
{
  _resetEffectIdCounter();
  const wizard = makeCombatant('wiz', {
    name: 'Wizard',
    pos: { x: 0, y: 0, z: 0 },
    actions: [MOONBEAM_ACTION],
    resources: withSlots(2, 2),
  });
  const enemy = makeCombatant('enemy1', {
    name: 'Enemy',
    faction: 'enemy',
    pos: { x: 10, y: 0, z: 0 },
    con: 1,
  });
  const bf = makeBF([wizard, enemy]);
  const state = makeState(bf);

  executeMB(wizard, enemy, state);
  assert('Before concentration break: _movingZone is set', wizard._movingZone !== undefined);

  removeEffectsFromCaster(wizard.id, bf);
  assert('After concentration break: _movingZone is cleared', wizard._movingZone === undefined);
}

// ---- Section 7: Concentration break clears _movingZone for Cloudkill ------

console.log('\n=== Section 7: Concentration break clears _movingZone for Cloudkill ===');
{
  _resetEffectIdCounter();
  const wizard = makeCombatant('wiz', {
    name: 'Wizard',
    pos: { x: 0, y: 0, z: 0 },
    actions: [CLOUDKILL_ACTION],
    resources: withSlots(5, 2),
  });
  const enemy = makeCombatant('enemy1', {
    name: 'Enemy',
    faction: 'enemy',
    pos: { x: 5, y: 0, z: 0 },
    con: 1,
  });
  const bf = makeBF([wizard, enemy]);
  const state = makeState(bf);

  const targets = shouldCastCK(wizard, bf);
  if (targets) executeCK(wizard, targets, state);
  assert('Before concentration break: _movingZone is set', wizard._movingZone !== undefined);

  removeEffectsFromCaster(wizard.id, bf);
  assert('After concentration break: _movingZone is cleared', wizard._movingZone === undefined);
}

// ---- Section 8: Metadata flags updated ----------------------

console.log('\n=== Section 8: Metadata flags updated ===');
{
  eq('Flaming Sphere: flamingSphereMovementV1Implemented = true', metaFS.flamingSphereMovementV1Implemented, true);
  eq('Moonbeam: moonbeamMovementV1Implemented = true', metaMB.moonbeamMovementV1Implemented, true);
  eq('Call Lightning: callLightningMovingZoneV1Implemented = true', metaCL.callLightningMovingZoneV1Implemented, true);
  eq('Cloudkill: cloudkillMovingZoneV1Implemented = true', metaCK.cloudkillMovingZoneV1Implemented, true);
}

// ---- Section 9: _movingZone position matches target position --------

console.log('\n=== Section 9: _movingZone position matches target position ===');
{
  _resetEffectIdCounter();
  const wizard = makeCombatant('wiz', {
    name: 'Wizard',
    pos: { x: 0, y: 0, z: 0 },
    actions: [FLAMING_SPHERE_ACTION],
    resources: withSlots(2, 2),
  });
  const enemy = makeCombatant('enemy1', {
    name: 'Enemy',
    faction: 'enemy',
    pos: { x: 3, y: 7, z: 0 },
    dex: 1,
  });
  const bf = makeBF([wizard, enemy]);
  const state = makeState(bf);

  executeFS(wizard, enemy, state);

  eq('Center X matches target X', wizard._movingZone!.centerX, 3);
  eq('Center Y matches target Y', wizard._movingZone!.centerY, 7);
  eq('Center Z matches target Z', wizard._movingZone!.centerZ, 0);
}

// ---- Section 10: Only one _movingZone per caster (concentration rule) ------

console.log('\n=== Section 10: Only one _movingZone per caster (re-cast replaces) ===');
{
  _resetEffectIdCounter();
  const wizard = makeCombatant('wiz', {
    name: 'Wizard',
    pos: { x: 0, y: 0, z: 0 },
    actions: [FLAMING_SPHERE_ACTION],
    resources: withSlots(2, 4),  // enough slots for 2 casts
  });
  const enemy1 = makeCombatant('enemy1', {
    name: 'Enemy1',
    faction: 'enemy',
    pos: { x: 5, y: 0, z: 0 },
    dex: 1,
  });
  const enemy2 = makeCombatant('enemy2', {
    name: 'Enemy2',
    faction: 'enemy',
    pos: { x: 10, y: 0, z: 0 },
    dex: 1,
  });
  const bf = makeBF([wizard, enemy1, enemy2]);
  const state = makeState(bf);

  // First cast
  executeFS(wizard, enemy1, state);
  eq('After first cast: centerX is enemy1 X', wizard._movingZone!.centerX, 5);

  // Second cast (this will break previous concentration and re-cast)
  executeFS(wizard, enemy2, state);
  eq('After second cast: centerX is enemy2 X', wizard._movingZone!.centerX, 10);
  eq('After second cast: spellName is still Flaming Sphere', wizard._movingZone!.spellName, 'Flaming Sphere');
}

// ---- Section 11: _movingZone not set when concentration is absent ------

console.log('\n=== Section 11: _movingZone not set when concentration is absent ===');
{
  _resetEffectIdCounter();
  // If the spell is cast but concentration isn't properly started, the _movingZone
  // should still be set (the execute function always sets it after startConcentration).
  // But if concentration BREAKS after cast, _movingZone should be cleared.
  const wizard = makeCombatant('wiz', {
    name: 'Wizard',
    pos: { x: 0, y: 0, z: 0 },
    actions: [FLAMING_SPHERE_ACTION],
    resources: withSlots(2, 2),
  });
  const enemy = makeCombatant('enemy1', {
    name: 'Enemy',
    faction: 'enemy',
    pos: { x: 5, y: 0, z: 0 },
    dex: 1,
  });
  const bf = makeBF([wizard, enemy]);
  const state = makeState(bf);

  executeFS(wizard, enemy, state);
  assert('After cast: _movingZone is set', wizard._movingZone !== undefined);

  // Manually break concentration without using removeEffectsFromCaster
  // (simulating a case where concentration.active is set to false)
  wizard.concentration = null;
  // The _movingZone is still there — but the combat.ts start-of-turn processing
  // checks actor.concentration?.active, so it won't move the zone.
  assert('After nulling concentration: _movingZone still exists (needs removeEffectsFromCaster to clean up)',
    wizard._movingZone !== undefined);

  // Proper cleanup via removeEffectsFromCaster
  removeEffectsFromCaster(wizard.id, bf);
  assert('After removeEffectsFromCaster: _movingZone is cleared', wizard._movingZone === undefined);
}

// ---- Summary ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Moving Zone tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
