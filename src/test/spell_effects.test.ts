// ============================================================
// spell_effects.test.ts — ActiveEffect registry unit tests
//
// Tests:
//   1. applySpellEffect — registration and immediate side-effects
//   2. removeEffectsFromCaster — caster-sweep across battlefield
//   3. removeEffectById — single-target removal
//   4. getActiveAcBonus — AC stacking reads
//   5. getActiveBlessDie — bless die max reads
//   6. Integration: concentration break cleans up effects
// ============================================================

import {
  applySpellEffect, removeEffectsFromCaster, removeEffectById,
  getActiveAcBonus, getActiveBlessDie, _resetEffectIdCounter,
} from '../engine/spell_effects';
import { queryVulnerability, removeBySource } from '../engine/adv_system';
import { Combatant, Battlefield, ActiveEffect } from '../types/core';

// ---- Minimal Combatant factory ------------------------------

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 30, currentHP: 30, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 12, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'aggressive' as any,
    perception: { knownEnemyPositions: new Map(), lastSeenPositions: new Map() } as any,
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
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

function makeBattlefield(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    combatants: map,
    round: 1,
    initiative: combatants.map(c => ({ id: c.id, initiative: 10 })),
    obstacles: [],
  } as unknown as Battlefield;
}

// ---- Test runner --------------------------------------------

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    _resetEffectIdCounter();
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function assertEqual<T>(a: T, b: T, msg?: string): void {
  if (a !== b) throw new Error(`${msg ?? ''} expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`);
}

// =============================================================
// Section 1: applySpellEffect — advantage_vs (Faerie Fire)
// =============================================================

console.log('\n1. applySpellEffect — advantage_vs');

test('registers effect in target.activeEffects', () => {
  const target = makeCombatant('goblin');
  applySpellEffect(target, {
    casterId: 'elf', spellName: 'Faerie Fire', effectType: 'advantage_vs',
    payload: { advType: 'advantage', advScope: 'attack' },
    sourceIsConcentration: true,
  });
  assertEqual(target.activeEffects.length, 1, 'activeEffects.length');
  assertEqual(target.activeEffects[0].spellName, 'Faerie Fire');
});

test('mirrors into vulnerabilities array (adv_system)', () => {
  const target = makeCombatant('goblin');
  applySpellEffect(target, {
    casterId: 'elf', spellName: 'Faerie Fire', effectType: 'advantage_vs',
    payload: { advType: 'advantage', advScope: 'attack' },
    sourceIsConcentration: true,
  });
  const q = queryVulnerability(target, 'attack');
  assert(q.advantage, 'attacks against target should have advantage');
  assert(!q.disadvantage, 'should not have disadvantage');
});

test('generated id is unique per application', () => {
  const a = makeCombatant('a');
  const b = makeCombatant('b');
  const e1 = applySpellEffect(a, {
    casterId: 'elf', spellName: 'Faerie Fire', effectType: 'advantage_vs',
    payload: { advType: 'advantage', advScope: 'attack' }, sourceIsConcentration: true,
  });
  const e2 = applySpellEffect(b, {
    casterId: 'elf', spellName: 'Faerie Fire', effectType: 'advantage_vs',
    payload: { advType: 'advantage', advScope: 'attack' }, sourceIsConcentration: true,
  });
  assert(e1.id !== e2.id, `ids should differ: ${e1.id} vs ${e2.id}`);
});

// =============================================================
// Section 2: applySpellEffect — ac_bonus (Shield of Faith)
// =============================================================

console.log('\n2. applySpellEffect — ac_bonus');

test('ac_bonus does not touch vulnerabilities or conditions', () => {
  const target = makeCombatant('paladin');
  applySpellEffect(target, {
    casterId: 'cleric', spellName: 'Shield of Faith', effectType: 'ac_bonus',
    payload: { acBonus: 2 }, sourceIsConcentration: true,
  });
  assertEqual(target.vulnerabilities.length, 0, 'no vulns added');
  assertEqual(target.conditions.size, 0, 'no conditions added');
  assertEqual(target.activeEffects.length, 1, 'registered in activeEffects');
});

test('getActiveAcBonus returns sum of ac_bonus effects', () => {
  const target = makeCombatant('paladin');
  applySpellEffect(target, {
    casterId: 'cleric', spellName: 'Shield of Faith', effectType: 'ac_bonus',
    payload: { acBonus: 2 }, sourceIsConcentration: true,
  });
  assertEqual(getActiveAcBonus(target), 2, 'single bonus');
});

test('getActiveAcBonus returns 0 with no effects', () => {
  const target = makeCombatant('fighter');
  assertEqual(getActiveAcBonus(target), 0, 'no effects → 0');
});

test('getActiveAcBonus sums multiple distinct ac_bonus effects', () => {
  const target = makeCombatant('fighter');
  applySpellEffect(target, {
    casterId: 'a', spellName: 'Shield of Faith', effectType: 'ac_bonus',
    payload: { acBonus: 2 }, sourceIsConcentration: true,
  });
  applySpellEffect(target, {
    casterId: 'b', spellName: 'Other Buff', effectType: 'ac_bonus',
    payload: { acBonus: 1 }, sourceIsConcentration: false,
  });
  assertEqual(getActiveAcBonus(target), 3, 'sum of 2+1');
});

// =============================================================
// Section 3: applySpellEffect — bless_die (Bless)
// =============================================================

console.log('\n3. applySpellEffect — bless_die');

test('getActiveBlessDie returns 0 when no bless active', () => {
  const c = makeCombatant('rogue');
  assertEqual(getActiveBlessDie(c), 0);
});

test('getActiveBlessDie returns die sides when bless active', () => {
  const c = makeCombatant('rogue');
  applySpellEffect(c, {
    casterId: 'cleric', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true,
  });
  assertEqual(getActiveBlessDie(c), 4);
});

test('getActiveBlessDie returns highest when two bless effects present', () => {
  const c = makeCombatant('rogue');
  applySpellEffect(c, {
    casterId: 'a', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true,
  });
  applySpellEffect(c, {
    casterId: 'b', spellName: 'Greater Bless', effectType: 'bless_die',
    payload: { dieSides: 6 }, sourceIsConcentration: false,
  });
  assertEqual(getActiveBlessDie(c), 6, 'should return max');
});

// =============================================================
// Section 4: applySpellEffect — condition_apply (Entangle)
// =============================================================

console.log('\n4. applySpellEffect — condition_apply');

test('applies restrained condition to target', () => {
  const target = makeCombatant('orc');
  applySpellEffect(target, {
    casterId: 'druid', spellName: 'Entangle', effectType: 'condition_apply',
    payload: { condition: 'restrained' }, sourceIsConcentration: true,
  });
  assert(target.conditions.has('restrained'), 'restrained condition should be set');
});

test('registered in activeEffects with correct spellName', () => {
  const target = makeCombatant('orc');
  applySpellEffect(target, {
    casterId: 'druid', spellName: 'Entangle', effectType: 'condition_apply',
    payload: { condition: 'restrained' }, sourceIsConcentration: true,
  });
  assertEqual(target.activeEffects[0].spellName, 'Entangle');
  assertEqual(target.activeEffects[0].payload.condition, 'restrained');
});

// =============================================================
// Section 5: removeEffectsFromCaster — caster sweep
// =============================================================

console.log('\n5. removeEffectsFromCaster');

test('removes advantage_vs entry and clears vulnerabilities', () => {
  const caster = makeCombatant('elf');
  const goblin = makeCombatant('goblin');
  const orc    = makeCombatant('orc');
  const bf = makeBattlefield([caster, goblin, orc]);

  applySpellEffect(goblin, {
    casterId: 'elf', spellName: 'Faerie Fire', effectType: 'advantage_vs',
    payload: { advType: 'advantage', advScope: 'attack' }, sourceIsConcentration: true,
  });
  applySpellEffect(orc, {
    casterId: 'elf', spellName: 'Faerie Fire', effectType: 'advantage_vs',
    payload: { advType: 'advantage', advScope: 'attack' }, sourceIsConcentration: true,
  });

  assert(queryVulnerability(goblin, 'attack').advantage, 'goblin adv before');
  assert(queryVulnerability(orc, 'attack').advantage, 'orc adv before');

  removeEffectsFromCaster('elf', bf);

  assert(!queryVulnerability(goblin, 'attack').advantage, 'goblin adv removed');
  assert(!queryVulnerability(orc, 'attack').advantage, 'orc adv removed');
  assertEqual(goblin.activeEffects.length, 0, 'goblin activeEffects cleared');
  assertEqual(orc.activeEffects.length, 0, 'orc activeEffects cleared');
});

test('removes restrained condition when Entangle ends', () => {
  const druid = makeCombatant('druid');
  const orc = makeCombatant('orc');
  const bf = makeBattlefield([druid, orc]);

  applySpellEffect(orc, {
    casterId: 'druid', spellName: 'Entangle', effectType: 'condition_apply',
    payload: { condition: 'restrained' }, sourceIsConcentration: true,
  });
  assert(orc.conditions.has('restrained'), 'restrained before');

  removeEffectsFromCaster('druid', bf);

  assert(!orc.conditions.has('restrained'), 'restrained removed after concentration breaks');
});

test('does not remove effects from a different caster', () => {
  const clericA = makeCombatant('clericA');
  const clericB = makeCombatant('clericB');
  const target  = makeCombatant('fighter');
  const bf = makeBattlefield([clericA, clericB, target]);

  applySpellEffect(target, {
    casterId: 'clericA', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true,
  });

  removeEffectsFromCaster('clericB', bf);   // different caster

  assertEqual(target.activeEffects.length, 1, 'clericA bless should remain');
  assertEqual(getActiveBlessDie(target), 4, 'die value intact');
});

test('is a no-op when caster has placed no effects', () => {
  const stranger = makeCombatant('stranger');
  const target = makeCombatant('target');
  const bf = makeBattlefield([stranger, target]);

  // Should not throw
  removeEffectsFromCaster('stranger', bf);
  assertEqual(target.activeEffects.length, 0);
});

test('only removes concentration effects, leaves non-concentration effects', () => {
  const caster = makeCombatant('caster');
  const target = makeCombatant('target');
  const bf = makeBattlefield([caster, target]);

  applySpellEffect(target, {
    casterId: 'caster', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true,
  });
  applySpellEffect(target, {
    casterId: 'caster', spellName: 'Permanent Buff', effectType: 'ac_bonus',
    payload: { acBonus: 1 }, sourceIsConcentration: false,
  });

  // removeEffectsFromCaster removes ALL caster effects (caller is responsible
  // for only calling it on concentration break)
  removeEffectsFromCaster('caster', bf);
  assertEqual(target.activeEffects.length, 0, 'all effects from this caster removed');
});

// =============================================================
// Section 6: removeEffectById
// =============================================================

console.log('\n6. removeEffectById');

test('removes a single effect by id', () => {
  const caster = makeCombatant('caster');
  const target = makeCombatant('target');
  const bf = makeBattlefield([caster, target]);

  const e = applySpellEffect(target, {
    casterId: 'caster', spellName: 'Shield of Faith', effectType: 'ac_bonus',
    payload: { acBonus: 2 }, sourceIsConcentration: true,
  });

  removeEffectById('target', e.id, bf);
  assertEqual(target.activeEffects.length, 0, 'effect removed');
  assertEqual(getActiveAcBonus(target), 0, 'ac bonus gone');
});

test('leaves other effects intact when removing by id', () => {
  const caster = makeCombatant('caster');
  const target = makeCombatant('target');
  const bf = makeBattlefield([caster, target]);

  const e1 = applySpellEffect(target, {
    casterId: 'caster', spellName: 'Shield of Faith', effectType: 'ac_bonus',
    payload: { acBonus: 2 }, sourceIsConcentration: true,
  });
  applySpellEffect(target, {
    casterId: 'caster', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true,
  });

  removeEffectById('target', e1.id, bf);
  assertEqual(target.activeEffects.length, 1, 'bless remains');
  assertEqual(target.activeEffects[0].spellName, 'Bless');
});

test('is a no-op for unknown target id', () => {
  const caster = makeCombatant('caster');
  const bf = makeBattlefield([caster]);
  // Should not throw
  removeEffectById('nonexistent', 'eff_99', bf);
});

test('is a no-op for unknown effect id on valid target', () => {
  const target = makeCombatant('target');
  const bf = makeBattlefield([target]);
  applySpellEffect(target, {
    casterId: 'x', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true,
  });
  // Should not throw; target.activeEffects should be untouched
  removeEffectById('target', 'eff_999', bf);
  assertEqual(target.activeEffects.length, 1);
});

// =============================================================
// Section 7: Multiple effects coexist on one target
// =============================================================

console.log('\n7. Multiple effects on one target');

test('advantage_vs and ac_bonus from same caster both active', () => {
  const caster = makeCombatant('caster');
  const target = makeCombatant('target');

  applySpellEffect(target, {
    casterId: 'caster', spellName: 'Faerie Fire', effectType: 'advantage_vs',
    payload: { advType: 'advantage', advScope: 'attack' }, sourceIsConcentration: true,
  });
  applySpellEffect(target, {
    casterId: 'caster', spellName: 'Shield of Faith', effectType: 'ac_bonus',
    payload: { acBonus: 2 }, sourceIsConcentration: true,
  });

  assert(queryVulnerability(target, 'attack').advantage, 'adv active');
  assertEqual(getActiveAcBonus(target), 2, 'ac bonus active');
  assertEqual(target.activeEffects.length, 2);
});

test('effects from two different casters both tracked correctly', () => {
  const casterA = makeCombatant('casterA');
  const casterB = makeCombatant('casterB');
  const target  = makeCombatant('target');
  const bf = makeBattlefield([casterA, casterB, target]);

  applySpellEffect(target, {
    casterId: 'casterA', spellName: 'Faerie Fire', effectType: 'advantage_vs',
    payload: { advType: 'advantage', advScope: 'attack' }, sourceIsConcentration: true,
  });
  applySpellEffect(target, {
    casterId: 'casterB', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true,
  });

  // Break casterA's concentration — only Faerie Fire removed
  removeEffectsFromCaster('casterA', bf);

  assert(!queryVulnerability(target, 'attack').advantage, 'faerie fire gone');
  assertEqual(getActiveBlessDie(target), 4, 'bless still active');
  assertEqual(target.activeEffects.length, 1, 'one effect remains');
});

// ---- Results ------------------------------------------------

console.log(`\n─────────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('\nAll tests passed ✅');
else process.exit(1);
