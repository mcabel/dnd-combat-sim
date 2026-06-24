// ============================================================
// Test: Session 61 — Dimension Door (PHB p.233)
//
// Dimension Door (L4 conjuration, action, self, NO concentration):
//   - Teleports caster up to 500 ft (clamped to 30x30 grid in v1).
//   - v1: caster-only (no willing-creature rider, no occupied-dest damage).
//   - shouldCast returns { destination } | null.
//   - Trigger conditions:
//       (a) Closing distance: nearest enemy >60 ft (12 squares) away, HP≥30%.
//       (b) Escape: nearest enemy ≤5 ft (1 square) away, HP<30%.
//
// Run: npx ts-node --transpile-only src/test/dimension_door.test.ts
// ============================================================

import { execute as executeDimensionDoor, shouldCast as shouldCastDimensionDoor, metadata as ddMeta } from '../spells/dimension_door';
import { EngineState } from '../engine/combat';
import { Combatant, Battlefield, Action, Condition, Vec3 } from '../types/core';

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
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos: { x: 1, y: 0, z: 0 },
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

function makeCaster(id: string, slotLevel = 4, hp = 100, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    faction: 'party',
    maxHP: 100, currentHP: hp,
    pos,
    actions: [{
      name: 'Dimension Door', isMultiattack: false, attackType: 'special',
      reach: 0, range: { normal: 0, long: 0 }, hitBonus: null,
      damage: null, damageType: null, saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      slotLevel, costType: 'action', legendaryCost: 0, description: 'Dimension Door',
    }],
    resources: { spellSlots: { [slotLevel]: { max: 2, remaining: 2 } } } as any,
  });
}

function makeBF(combatants: Combatant[]): Battlefield {
  return {
    width: 30, height: 30, depth: 1, cells: [],
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
console.log('\n=== Dimension Door Metadata ===');
eq('name', ddMeta.name, 'Dimension Door');
eq('level 4', ddMeta.level, 4);
eq('NO concentration', ddMeta.concentration, false);
eq('castingTime action', ddMeta.castingTime, 'action');
eq('teleport range 500 ft', ddMeta.teleportRangeFt, 500);

// ============================================================
console.log('\n=== shouldCast: closing distance (>60 ft from enemy) ===');
{
  // Caster at (1,0); enemy at (20,20). Chebyshev distance = 20 squares = 100 ft > 60 ft → fires.
  const caster = makeCaster('wizard', 4, 100, { x: 1, y: 0, z: 0 });
  const enemy = makeCombatant('goblin', { faction: 'enemy', pos: { x: 20, y: 20, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const result = shouldCastDimensionDoor(caster, bf);
  assert('fires when far from enemy (closing distance)', result !== null);
  if (result) {
    // Destination should move toward the enemy (positive x and positive y direction).
    assert('destination is toward enemy (x > caster.x)', result.destination.x > caster.pos.x);
    assert('destination is toward enemy (y > caster.y)', result.destination.y >= caster.pos.y);
    // v1 grid is 30x30 → destination clamped to [0, 29].
    assert('destination x in bounds [0,29]', result.destination.x >= 0 && result.destination.x <= 29);
    assert('destination y in bounds [0,29]', result.destination.y >= 0 && result.destination.y <= 29);
  }
}

// ============================================================
console.log('\n=== shouldCast: skip when already within 60 ft ===');
{
  // Caster at (1,0); enemy at (7,0). Chebyshev = 6 squares = 30 ft < 60 ft → skip.
  const caster = makeCaster('wizard', 4, 100, { x: 1, y: 0, z: 0 });
  const enemy = makeCombatant('goblin', { faction: 'enemy', pos: { x: 7, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const result = shouldCastDimensionDoor(caster, bf);
  assert('skip when within 60 ft (overkill)', result === null);
}

// ============================================================
console.log('\n=== shouldCast: escape mode (HP<30%, enemy adjacent) ===');
{
  // Caster at (5,5), HP 20/100 = 20%. Enemy at (6,5) — adjacent (1 square = 5 ft). → escape.
  const caster = makeCaster('wizard', 4, 20, { x: 5, y: 5, z: 0 });
  const enemy = makeCombatant('goblin', { faction: 'enemy', pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const result = shouldCastDimensionDoor(caster, bf);
  assert('fires in escape mode (low HP + adjacent enemy)', result !== null);
  if (result) {
    // Destination should be AWAY from the enemy (x decreasing).
    assert('destination is away from enemy (x < caster.x)', result.destination.x < caster.pos.x);
  }
}

// ============================================================
console.log('\n=== shouldCast: escape mode skipped when enemy far ===');
{
  // Caster HP 20/100 but enemy is 20 squares away — no need to escape.
  const caster = makeCaster('wizard', 4, 20, { x: 5, y: 5, z: 0 });
  const enemy = makeCombatant('goblin', { faction: 'enemy', pos: { x: 25, y: 25, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const result = shouldCastDimensionDoor(caster, bf);
  assert('skip escape when enemy already far', result === null);
}

// ============================================================
console.log('\n=== shouldCast gates (no slot / no action / no enemy) ===');
{
  // No L4 slot → null
  const casterNoSlot = makeCaster('wizard', 4);
  casterNoSlot.resources!.spellSlots![4].remaining = 0;
  const enemy = makeCombatant('goblin', { faction: 'enemy', pos: { x: 20, y: 20, z: 0 } });
  assert('no slot → null', shouldCastDimensionDoor(casterNoSlot, makeBF([casterNoSlot, enemy])) === null);

  // No 'Dimension Door' action → null
  const casterNoAction = makeCombatant('wiz', { faction: 'party', pos: { x: 1, y: 0, z: 0 },
    resources: { spellSlots: { 4: { max: 2, remaining: 2 } } } as any });
  assert('no action → null', shouldCastDimensionDoor(casterNoAction, makeBF([casterNoAction, enemy])) === null);

  // No enemies → null
  const caster = makeCaster('wizard', 4, 100, { x: 1, y: 0, z: 0 });
  assert('no enemy → null', shouldCastDimensionDoor(caster, makeBF([caster])) === null);
}

// ============================================================
console.log('\n=== execute: teleports caster + consumes slot ===');
{
  const caster = makeCaster('wizard', 4, 100, { x: 1, y: 0, z: 0 });
  const enemy = makeCombatant('goblin', { faction: 'enemy', pos: { x: 20, y: 20, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const result = shouldCastDimensionDoor(caster, bf);
  assert('shouldCast returned a destination', result !== null);
  if (result) {
    const slotBefore = caster.resources!.spellSlots![4].remaining;
    const fromPos = { ...caster.pos };
    executeDimensionDoor(caster, result.destination, state);
    eq('slot consumed (decremented)', caster.resources!.spellSlots![4].remaining, slotBefore - 1);
    eq('caster moved (x changed)', caster.pos.x !== fromPos.x || caster.pos.y !== fromPos.y, true);
    // Log should mention the spell name.
    const mentioned = state.log.events.some(e => e.description.includes('Dimension Door'));
    assert('log mentions Dimension Door', mentioned);
  }
}

// ============================================================
console.log('\n=== execute: NOT concentration (preserves existing concentration) ===');
{
  const caster = makeCaster('wizard', 4, 100, { x: 1, y: 0, z: 0 });
  // Pretend caster is already concentrating on something else.
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 } as any;
  const enemy = makeCombatant('goblin', { faction: 'enemy', pos: { x: 20, y: 20, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const result = shouldCastDimensionDoor(caster, bf);
  if (result) executeDimensionDoor(caster, result.destination, state);
  assert('existing concentration preserved (still Bless)', caster.concentration?.spellName === 'Bless');
}

// ============================================================
console.log('\n=== cleanup: no-op ===');
{
  const caster = makeCaster('wizard', 4);
  // cleanup should not throw and should not modify the caster.
  const before = JSON.stringify({ hp: caster.currentHP, pos: caster.pos });
  executeDimensionDoor as any; // just ensure module loads
  // cleanup takes a Combatant; we call it via the module's export.
  const { cleanup } = require('../spells/dimension_door');
  cleanup(caster);
  const after = JSON.stringify({ hp: caster.currentHP, pos: caster.pos });
  assert('cleanup is no-op (state unchanged)', before === after);
}

// ---- Results ------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
