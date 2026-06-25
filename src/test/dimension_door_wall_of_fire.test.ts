// ============================================================
// Test: Dimension Door + Wall of Fire (Session 50)
//
// Dimension Door (PHB p.233): L4, self-teleport, instantaneous.
//   - shouldCast: fires when bloodied (HP ≤ 50%) or surrounded (≥2 adj enemies)
//   - execute: teleports caster to safest cell (max min-dist from enemies)
//
// Wall of Fire (PHB p.285): L4, 120 ft, DEX save 5d8 fire, concentration.
//   - shouldCast gates: has action, L4 slot, not concentrating, enemy in range
//   - execute: on-appear DEX save 5d8 fire; apply damage_zone conc effect
//
// Run: npx ts-node --transpile-only src/test/dimension_door_wall_of_fire.test.ts
// ============================================================

import { shouldCast as shouldCastDD, execute as executeDD, metadata as ddMeta } from '../spells/dimension_door';
import { shouldCast as shouldCastWoF, execute as executeWoF, metadata as wofMeta } from '../spells/wall_of_fire';
import { shouldCast as shouldCastScrying, metadata as scryMeta } from '../spells/scrying';
import { shouldCast as shouldCastFog, metadata as fogMeta } from '../spells/fog_cloud';
import { shouldCast as shouldCastDark, metadata as darkMeta } from '../spells/darkness';
import { EngineState } from '../engine/combat';
import { Combatant, Battlefield, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 1, int: 10, wis: 1, cha: 1,
    cr: 1,
    pos: { x: 5, y: 5, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set<Condition>(),
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

function makeCaster(spellName: string, slotLevel: number, extraOverrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant('caster', {
    faction: 'party',
    pos: { x: 5, y: 5, z: 0 },
    actions: [{
      name: spellName, isMultiattack: false, attackType: 'save',
      reach: 0, range: { normal: 120, long: 120 }, hitBonus: null,
      damage: null, damageType: null, saveDC: 15, saveAbility: 'dex',
      isAoE: false, isControl: false, requiresConcentration: spellName === 'Wall of Fire',
      slotLevel, costType: 'action', legendaryCost: 0, description: spellName,
    }],
    resources: { spellSlots: { [slotLevel]: { max: 2, remaining: 2 } } } as any,
    ...extraOverrides,
  });
}

function makeBF(combatants: Combatant[]): Battlefield {
  return {
    width: 20, height: 20, depth: 1, cells: [],
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1, initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(), damageThisRound: new Map(),
    noDamageRounds: new Map(), rageDamagedSinceLastTurn: new Set(),
  } as any;
}

// ============================================================
// METADATA
// ============================================================
console.log('\n=== Dimension Door Metadata ===');
eq('name', ddMeta.name, 'Dimension Door');
eq('level 4', ddMeta.level, 4);
eq('concentration false', ddMeta.concentration, false);
eq('school conjuration', ddMeta.school, 'conjuration');
eq('teleport range 500', ddMeta.teleportRangeFt, 500);
assert('ally carry flag false', ddMeta.dimensionDoorAllyCarryV1Implemented === false);

console.log('\n=== Wall of Fire Metadata ===');
eq('name', wofMeta.name, 'Wall of Fire');
eq('level 4', wofMeta.level, 4);
eq('concentration true', wofMeta.concentration, true);
eq('school evocation', wofMeta.school, 'evocation');
eq('save dex', wofMeta.saveAbility, 'dex');
eq('range 120', wofMeta.rangeFt, 120);

console.log('\n=== Stub Metadata ===');
assert('scrying outOfCombat', scryMeta.outOfCombat === true);
assert('fog cloud geometry flag false', fogMeta.fogCloudObscurementV1Implemented === false);
assert('darkness vision flag false', darkMeta.darknessVisionV1Implemented === false);

// ============================================================
// DIMENSION DOOR — shouldCast gates
// ============================================================
console.log('\n=== Dimension Door: shouldCast gates ===');

{
  // Gate: must have Dimension Door action
  const caster = makeCaster('Dimension Door', 4);
  caster.actions = [];
  const bf = makeBF([caster]);
  assert('no action → false', !shouldCastDD(caster, bf));
}

{
  // Gate: must have L4 slot
  const caster = makeCaster('Dimension Door', 4);
  caster.resources = { spellSlots: { 4: { max: 1, remaining: 0 } } } as any;
  const bf = makeBF([caster]);
  assert('no slot → false', !shouldCastDD(caster, bf));
}

{
  // Gate: action already used
  const caster = makeCaster('Dimension Door', 4, { currentHP: 30 }); // bloodied
  caster.budget.actionUsed = true;
  const bf = makeBF([caster]);
  assert('action used → false', !shouldCastDD(caster, bf));
}

{
  // Gate: healthy + enemy at mid-range (30-60 ft) → no trigger (not closing, not escape)
  const caster = makeCaster('Dimension Door', 4, { currentHP: 100, maxHP: 100, pos: { x: 0, y: 0, z: 0 } });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 8, y: 0, z: 0 } }); // 40 ft away
  const bf = makeBF([caster, enemy]);
  assert('healthy + enemy 40ft away → null', shouldCastDD(caster, bf) === null);
}

{
  // Trigger: escape mode (HP < 30% + adjacent enemy ≤5 ft)
  const caster = makeCaster('Dimension Door', 4, { currentHP: 20, maxHP: 100, pos: { x: 5, y: 5, z: 0 } });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 6, y: 5, z: 0 } }); // 5 ft away
  const bf = makeBF([caster, enemy]);
  assert('escape mode (HP<30% + adj enemy) → fires', shouldCastDD(caster, bf) !== null);
}

{
  // Trigger: closing-distance mode (HP ≥ 30% + enemy >60 ft away)
  const caster = makeCaster('Dimension Door', 4, { currentHP: 80, maxHP: 100, pos: { x: 0, y: 0, z: 0 } });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 13, y: 0, z: 0 } }); // 65 ft away
  const bf = makeBF([caster, enemy]);
  const result = shouldCastDD(caster, bf);
  assert('closing mode (HP≥30% + enemy >60ft) → fires', result !== null);
  assert('destination moves toward enemy (x > caster.x)', result !== null && result.destination.x > caster.pos.x);
}

// ============================================================
// DIMENSION DOOR — execute: teleports caster
// ============================================================
console.log('\n=== Dimension Door: execute teleports caster ===');

{
  const caster = makeCaster('Dimension Door', 4, {
    pos: { x: 5, y: 5, z: 0 }, currentHP: 20, maxHP: 100,  // HP < 30% → escape mode
  });
  // Enemy at (5,5) neighbour — caster should move far away
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const result = shouldCastDD(caster, bf);
  assert('shouldCast returned a destination', result !== null);
  const before = { ...caster.pos };
  if (result) executeDD(caster, result.destination, state);

  assert('caster moved', caster.pos.x !== before.x || caster.pos.y !== before.y,
    `before=(${before.x},${before.y}), after=(${caster.pos.x},${caster.pos.y})`);
  assert('action used', caster.budget.actionUsed);
  assert('L4 slot consumed', (caster.resources!.spellSlots![4].remaining) === 1);
  assert('log event emitted', state.log.events.some(e => e.description.includes('Dimension Door')));
}

{
  // Caster ends up farther from enemy than before (escape mode)
  const caster = makeCaster('Dimension Door', 4, {
    pos: { x: 10, y: 10, z: 0 }, currentHP: 20, maxHP: 100,  // HP < 30% → escape mode
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 10, y: 11, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const result = shouldCastDD(caster, bf);
  assert('shouldCast returned a destination', result !== null);
  const distBefore = Math.abs(caster.pos.x - enemy.pos.x) + Math.abs(caster.pos.y - enemy.pos.y);
  if (result) executeDD(caster, result.destination, state);
  const distAfter = Math.abs(caster.pos.x - enemy.pos.x) + Math.abs(caster.pos.y - enemy.pos.y);

  assert('caster farther from enemy after teleport', distAfter >= distBefore,
    `distBefore=${distBefore}, distAfter=${distAfter}`);
}

// ============================================================
// WALL OF FIRE — shouldCast gates
// ============================================================
console.log('\n=== Wall of Fire: shouldCast gates ===');

{
  // Gate: no action
  const caster = makeCaster('Wall of Fire', 4);
  caster.actions = [];
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, enemy]);
  assert('no action → null', shouldCastWoF(caster, bf) === null);
}

{
  // Gate: no L4 slot
  const caster = makeCaster('Wall of Fire', 4);
  caster.resources = { spellSlots: { 4: { max: 1, remaining: 0 } } } as any;
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, enemy]);
  assert('no slot → null', shouldCastWoF(caster, bf) === null);
}

{
  // Gate: already concentrating
  const caster = makeCaster('Wall of Fire', 4);
  caster.concentration = { active: true, spellName: 'Entangle', dcIfHit: 10 };
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, enemy]);
  assert('concentrating → null', shouldCastWoF(caster, bf) === null);
}

{
  // Gate: no enemies in range
  const caster = makeCaster('Wall of Fire', 4);
  const ally = makeCombatant('ally', { faction: 'party', pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, ally]);
  assert('no enemies → null', shouldCastWoF(caster, bf) === null);
}

{
  // Gate: enemy out of range (> 120 ft = 24 cells)
  const caster = makeCaster('Wall of Fire', 4, { pos: { x: 0, y: 0, z: 0 } });
  // Chebyshev distance 25 cells × 5 = 125 ft > 120 ft
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 19, y: 19, z: 0 } });
  // chebyshev3D({0,0,0},{19,19,0}) = max(19,19) = 19 cells = 95ft — still in range on 20x20 grid
  // Use a 4x4 grid to force out-of-range
  const bf = { ...makeBF([caster, enemy]), width: 30, height: 30 } as any;
  // Place enemy at chebyshev 25 cells
  enemy.pos = { x: 25, y: 0, z: 0 };
  assert('enemy out of range → null', shouldCastWoF(caster, bf) === null);
}

{
  // Happy path: enemy in range, slot available, not concentrating
  const caster = makeCaster('Wall of Fire', 4, { pos: { x: 0, y: 0, z: 0 } });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const target = shouldCastWoF(caster, bf);
  assert('valid target returned', target !== null);
  assert('target is enemy', target?.id === 'enemy');
}

// ============================================================
// WALL OF FIRE — execute
// ============================================================
console.log('\n=== Wall of Fire: execute ===');

{
  // On save success: takes half damage, damage_zone applied
  const caster = makeCaster('Wall of Fire', 4, { pos: { x: 0, y: 0, z: 0 } });
  // Target with very high DEX save (wis=20 but dex matters; give high dex)
  const target = makeCombatant('tough', {
    faction: 'enemy', pos: { x: 5, y: 0, z: 0 },
    dex: 30, // +10 mod → always saves
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  executeWoF(caster, target, state);

  assert('L4 slot consumed', caster.resources!.spellSlots![4].remaining === 1);
  assert('concentration started', caster.concentration?.active === true);
  eq('concentration spell name', caster.concentration?.spellName, 'Wall of Fire');
  assert('damage_zone applied', target.activeEffects.some(e => e.spellName === 'Wall of Fire' && e.effectType === 'damage_zone'));
  assert('WoF events logged', state.log.events.some(e => e.description.includes('Wall of Fire')));
  // HP reduced (even on success, half of 5d8 ≥ 1 at minimum save roll of 1)
  assert('target took damage', target.currentHP < 100);
}

{
  // On save fail: takes full damage, damage_zone applied
  const caster = makeCaster('Wall of Fire', 4, { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('weak', {
    faction: 'enemy', pos: { x: 5, y: 0, z: 0 },
    dex: 1, // −5 mod → always fails
    maxHP: 200, currentHP: 200,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  executeWoF(caster, target, state);

  assert('target HP reduced on fail', target.currentHP < 200);
  assert('damage_zone effect active', target.activeEffects.some(e =>
    e.effectType === 'damage_zone' && e.casterId === 'caster' && e.spellName === 'Wall of Fire'));
  assert('sourceIsConcentration flag', target.activeEffects.some(e =>
    e.spellName === 'Wall of Fire' && e.sourceIsConcentration === true));
}

{
  // execute on dead target: no effect applied, no crash
  const caster = makeCaster('Wall of Fire', 4, { pos: { x: 0, y: 0, z: 0 } });
  const dead = makeCombatant('dead', {
    faction: 'enemy', pos: { x: 5, y: 0, z: 0 }, isDead: true,
  });
  const bf = makeBF([caster, dead]);
  const state = makeState(bf);

  executeWoF(caster, dead, state);

  assert('no damage_zone on dead target', !dead.activeEffects.some(e => e.effectType === 'damage_zone'));
}

// ============================================================
// STUBS
// ============================================================
console.log('\n=== Stubs: shouldCast always returns null/false ===');
{
  const caster = makeCombatant('c', { faction: 'party' });
  const bf = makeBF([caster]);
  assert('Scrying shouldCast false', shouldCastScrying(caster, bf) === false);
  assert('Fog Cloud shouldCast null', shouldCastFog(caster, bf) === null);
  assert('Darkness shouldCast null', shouldCastDark(caster, bf) === null);
}

// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
