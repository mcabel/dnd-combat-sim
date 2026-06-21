// ============================================================
// damage_immunities.test.ts — Damage immunities field (PHB p.197)
//
// Tests for the Combatant.immunities field added in Session 32.
// Immunity reduces incoming damage of the listed types to 0.
// Immunity overrides resistance and vulnerability (PHB p.197).
//
// Tests cover:
//   1. addImmunity / removeImmunity helpers
//   2. applyDamageWithTempHP honours immunities (0 damage)
//   3. Immunity overrides resistance (immunity + resistance to same type = 0)
//   4. Couatl takes 0 radiant + 0 psychic damage
//   5. Fire Elemental takes 0 fire damage but full thunder damage
//   6. Mud Mephit takes 0 acid + 0 poison damage
//   7. Non-immune creatures take full damage (regression check)
//   8. Temp HP is NOT consumed when immunity negates damage
// ============================================================

import { Combatant, DamageType } from '../types/core';
import {
  applyDamage,
  applyDamageWithTempHP,
  addImmunity,
  removeImmunity,
  addResistance,
} from '../engine/utils';
import { createCouatl } from '../spells/conjure_celestial';
import { createFireElemental } from '../spells/conjure_elemental';
import { createMudMephit } from '../spells/conjure_minor_elementals';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

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
    conditions: new Set(),
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

// ============================================================
// 1. addImmunity / removeImmunity helpers
// ============================================================

console.log('\n=== 1. addImmunity / removeImmunity helpers ===\n');

{
  const c = makeCombatant('c1');
  eq('No immunities initially (undefined)', c.immunities, undefined);

  addImmunity(c, 'fire');
  eq('addImmunity adds fire', c.immunities?.[0], 'fire');
  eq('immunities length is 1', c.immunities?.length, 1);

  addImmunity(c, 'fire'); // idempotent
  eq('addImmunity is idempotent', c.immunities?.length, 1);

  addImmunity(c, 'poison');
  eq('addImmunity adds poison', c.immunities?.length, 2);
  assert('immunities includes fire', c.immunities!.includes('fire'));
  assert('immunities includes poison', c.immunities!.includes('poison'));

  removeImmunity(c, 'fire');
  eq('removeImmunity removes fire', c.immunities?.length, 1);
  eq('only poison remains', c.immunities?.[0], 'poison');

  removeImmunity(c, 'cold'); // not present — no-op
  eq('removeImmunity no-op for missing type', c.immunities?.length, 1);
}

// ============================================================
// 2. applyDamageWithTempHP honours immunities (0 damage)
// ============================================================

console.log('\n=== 2. applyDamageWithTempHP honours immunities ===\n');

{
  const c = makeCombatant('c2', { immunities: ['fire'] });
  const startingHP = c.currentHP;

  const dealt = applyDamageWithTempHP(c, 30, 'fire');
  eq('Fire damage to fire-immune creature: 0 dealt', dealt, 0);
  eq('HP unchanged', c.currentHP, startingHP);
}

{
  const c = makeCombatant('c3', { immunities: ['poison'] });
  const startingHP = c.currentHP;

  const dealt = applyDamageWithTempHP(c, 50, 'poison');
  eq('Poison damage to poison-immune creature: 0 dealt', dealt, 0);
  eq('HP unchanged', c.currentHP, startingHP);
}

{
  const c = makeCombatant('c4', { immunities: ['psychic'] });
  const startingHP = c.currentHP;

  // Non-matching damage type still applies
  const dealt = applyDamageWithTempHP(c, 20, 'slashing');
  assert('Slashing damage to psychic-immune creature: >0 dealt', dealt > 0);
  assert('HP reduced', c.currentHP < startingHP);
}

// ============================================================
// 3. Immunity overrides resistance
// ============================================================

console.log('\n=== 3. Immunity overrides resistance ===\n');

{
  // A creature with BOTH fire immunity AND fire resistance — immunity wins (0 damage).
  // PHB p.197: immunity overrides resistance.
  const c = makeCombatant('c5', { immunities: ['fire'], resistances: ['fire'] });
  const startingHP = c.currentHP;

  const dealt = applyDamageWithTempHP(c, 40, 'fire');
  eq('Immunity overrides resistance: 0 damage', dealt, 0);
  eq('HP unchanged', c.currentHP, startingHP);
}

{
  // Same creature without immunity — resistance halves damage.
  const c = makeCombatant('c6', { resistances: ['fire'] });
  const startingHP = c.currentHP;

  const dealt = applyDamageWithTempHP(c, 40, 'fire');
  eq('Resistance only: half damage (20)', dealt, 20);
  eq('HP reduced by 20', c.currentHP, startingHP - 20);
}

// ============================================================
// 4. Couatl takes 0 radiant + 0 psychic damage
// ============================================================

console.log('\n=== 4. Couatl immunities (radiant + psychic) ===\n');

{
  const caster = makeCombatant('caster');
  const couatl = createCouatl(caster, 7);
  const startingHP = couatl.currentHP;

  eq('Couatl has 2 immunities', couatl.immunities?.length, 2);
  assert('Couatl immune to radiant', couatl.immunities!.includes('radiant'));
  assert('Couatl immune to psychic', couatl.immunities!.includes('psychic'));

  // Radiant damage = 0
  let dealt = applyDamageWithTempHP(couatl, 25, 'radiant');
  eq('Couatl takes 0 radiant damage', dealt, 0);
  eq('Couatl HP unchanged after radiant', couatl.currentHP, startingHP);

  // Psychic damage = 0
  dealt = applyDamageWithTempHP(couatl, 30, 'psychic');
  eq('Couatl takes 0 psychic damage', dealt, 0);
  eq('Couatl HP unchanged after psychic', couatl.currentHP, startingHP);

  // Piercing damage (from a Bite attack) = full damage
  dealt = applyDamageWithTempHP(couatl, 10, 'piercing');
  assert('Couatl takes piercing damage (>0)', dealt > 0);
  eq('Couatl HP reduced by piercing', couatl.currentHP, startingHP - 10);
}

// ============================================================
// 5. Fire Elemental takes 0 fire but full thunder
// ============================================================

console.log('\n=== 5. Fire Elemental immunities (fire) ===\n');

{
  const caster = makeCombatant('caster');
  const fe = createFireElemental(caster, 5);
  const startingHP = fe.currentHP;

  eq('Fire Elemental has 1 immunity', fe.immunities?.length, 1);
  assert('Fire Elemental immune to fire', fe.immunities!.includes('fire'));

  // Fire damage = 0
  let dealt = applyDamageWithTempHP(fe, 50, 'fire');
  eq('Fire Elemental takes 0 fire damage', dealt, 0);
  eq('Fire Elemental HP unchanged after fire', fe.currentHP, startingHP);

  // Thunder damage = full
  dealt = applyDamageWithTempHP(fe, 15, 'thunder');
  assert('Fire Elemental takes thunder damage (>0)', dealt > 0);
  eq('Fire Elemental HP reduced by thunder', fe.currentHP, startingHP - 15);
}

// ============================================================
// 6. Mud Mephit takes 0 acid + 0 poison
// ============================================================

console.log('\n=== 6. Mud Mephit immunities (acid + poison) ===\n');

{
  const caster = makeCombatant('caster');
  const mephit = createMudMephit(caster, 0);
  const startingHP = mephit.currentHP;

  eq('Mud Mephit has 2 immunities', mephit.immunities?.length, 2);
  assert('Mud Mephit immune to acid', mephit.immunities!.includes('acid'));
  assert('Mud Mephit immune to poison', mephit.immunities!.includes('poison'));

  // Acid damage = 0
  let dealt = applyDamageWithTempHP(mephit, 20, 'acid');
  eq('Mud Mephit takes 0 acid damage', dealt, 0);
  eq('Mud Mephit HP unchanged after acid', mephit.currentHP, startingHP);

  // Poison damage = 0
  dealt = applyDamageWithTempHP(mephit, 15, 'poison');
  eq('Mud Mephit takes 0 poison damage', dealt, 0);
  eq('Mud Mephit HP unchanged after poison', mephit.currentHP, startingHP);

  // Bludgeoning damage (from Fists attack type) = full
  dealt = applyDamageWithTempHP(mephit, 8, 'bludgeoning');
  assert('Mud Mephit takes bludgeoning damage (>0)', dealt > 0);
  eq('Mud Mephit HP reduced by bludgeoning', mephit.currentHP, startingHP - 8);
}

// ============================================================
// 7. Non-immune creatures take full damage (regression check)
// ============================================================

console.log('\n=== 7. Non-immune creatures take full damage ===\n');

{
  // Sprite has no immunities (PHB Sprite has no damage immunities)
  // We need a Sprite factory — use conjure_woodland_beings
  const { createSprite } = require('../spells/conjure_woodland_beings');
  const caster = makeCombatant('caster');
  const sprite = createSprite(caster, 0);
  const startingHP = sprite.currentHP;

  // No immunities set
  eq('Sprite has no immunities', sprite.immunities, undefined);

  const dealt = applyDamageWithTempHP(sprite, 1, 'piercing');
  eq('Sprite takes 1 piercing damage (no immunity)', dealt, 1);
  eq('Sprite HP reduced by 1', sprite.currentHP, startingHP - 1);
}

// ============================================================
// 8. Temp HP is NOT consumed when immunity negates damage
// ============================================================

console.log('\n=== 8. Temp HP not consumed when immunity negates ===\n');

{
  const c = makeCombatant('c8', {
    immunities: ['fire'],
    tempHP: 20,
    currentHP: 50,
  });
  const startingHP = c.currentHP;
  const startingTempHP = c.tempHP;

  // Fire damage is fully negated by immunity — temp HP should NOT be touched.
  const dealt = applyDamageWithTempHP(c, 30, 'fire');
  eq('Immunity negates fire: 0 damage', dealt, 0);
  eq('Current HP unchanged', c.currentHP, startingHP);
  eq('Temp HP unchanged', c.tempHP, startingTempHP);
}

{
  // Compare: non-immune creature with temp HP — temp HP absorbs first.
  const c = makeCombatant('c9', {
    tempHP: 20,
    currentHP: 50,
  });
  const dealt = applyDamageWithTempHP(c, 30, 'fire');
  eq('Non-immune: 30 damage dealt (20 to temp, 10 to HP)', dealt, 30);
  eq('Temp HP reduced to 0', c.tempHP, 0);
  eq('Current HP reduced by 10', c.currentHP, 40);
}

// ============================================================
// 9. Backwards compat — undefined immunities = no immunities
// ============================================================

console.log('\n=== 9. Backwards compat — undefined immunities ===\n');

{
  // Combatants created without setting `immunities` should behave as if no
  // immunities exist (PHB-compliant: most creatures have no damage immunities).
  const c = makeCombatant('c10'); // no immunities field set
  const startingHP = c.currentHP;

  eq('immunities is undefined', c.immunities, undefined);

  const dealt = applyDamageWithTempHP(c, 25, 'fire');
  assert('Full damage taken (no immunity)', dealt === 25);
  eq('HP reduced by 25', c.currentHP, startingHP - 25);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
