// ============================================================
// invisible_effect.test.ts — True Invisibility effect
// PHB p.194: An invisible creature is impossible to see without
// the aid of magic or a special sense.
//   - Attacks vs the creature have disadvantage (can't see target)
//   - The creature's own attacks have advantage (unseen attacker)
//   - The creature can't be targeted directly (not modelled in v1)
//
// Tests:
//   1. 'invisible' effect grants disadv on attacks vs target
//   2. 'invisible' effect grants adv on own attack rolls
//   3. 'invisible' effect adds the 'invisible' condition
//   4. Both effects removed on concentration break
//   5. Integration: Invisibility spell applies invisible effect
//
// Run: ts-node --transpile-only src/test/invisible_effect.test.ts
// ============================================================

import { applySpellEffect, removeEffectsFromCaster, _resetEffectIdCounter } from '../engine/spell_effects';
import { querySelf, queryVulnerability } from '../engine/adv_system';
import { shouldCast, execute } from '../spells/invisibility';
import { Combatant, Action, PlayerResources, Vec3 } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Factories ----------------------------------------------

function withSlots2(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

const INVIS_ACTION: Action = {
  name: 'Invisibility',
  isMultiattack: false,
  attackType: null,
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Invisibility',
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

function makeBF(combatants: Combatant[]) {
  return {
    width: 30, height: 30, depth: 1,
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

// ============================================================
// Section 1 — 'invisible' effect grants disadvantage on attacks vs target
// ============================================================

console.log('\n--- Section 1: Disadvantage on attacks vs invisible creature ---');

{
  _resetEffectIdCounter();
  const target = makeCombatant('wizard');

  // Before: no vulnerability entries
  const before = queryVulnerability(target, 'attack');
  assert('1a: no disadv on attacks vs target before effect', !before.disadvantage);

  // Apply invisible effect
  applySpellEffect(target, {
    casterId: 'caster1',
    spellName: 'Invisibility',
    effectType: 'invisible',
    payload: {},
    sourceIsConcentration: true,
  });

  const after = queryVulnerability(target, 'attack');
  assert('1b: disadv on attacks vs target after invisible effect', after.disadvantage);
  assert('1c: no adv on attacks vs target', !after.advantage);
}

// ============================================================
// Section 2 — 'invisible' effect grants advantage on own attack rolls
// ============================================================

console.log('\n--- Section 2: Advantage on own attack rolls ---');

{
  _resetEffectIdCounter();
  const target = makeCombatant('wizard');

  // Before: no self-advantage entries
  const before = querySelf(target, 'attack');
  assert('2a: no adv on own attacks before effect', !before.advantage);

  // Apply invisible effect
  applySpellEffect(target, {
    casterId: 'caster1',
    spellName: 'Invisibility',
    effectType: 'invisible',
    payload: {},
    sourceIsConcentration: true,
  });

  const after = querySelf(target, 'attack');
  assert('2b: adv on own attack rolls after invisible effect', after.advantage);
  assert('2c: no disadv on own attack rolls', !after.disadvantage);
}

// ============================================================
// Section 3 — 'invisible' effect adds the 'invisible' condition
// ============================================================

console.log('\n--- Section 3: Invisible condition added ---');

{
  _resetEffectIdCounter();
  const target = makeCombatant('wizard');

  assert('3a: not invisible before effect', !target.conditions.has('invisible'));

  applySpellEffect(target, {
    casterId: 'caster1',
    spellName: 'Invisibility',
    effectType: 'invisible',
    payload: {},
    sourceIsConcentration: true,
  });

  assert('3b: invisible condition after effect', target.conditions.has('invisible'));
}

// ============================================================
// Section 4 — Both effects removed on concentration break
// ============================================================

console.log('\n--- Section 4: Effects removed on concentration break ---');

{
  _resetEffectIdCounter();
  const target = makeCombatant('wizard');
  const caster = makeCombatant('caster1');

  applySpellEffect(target, {
    casterId: 'caster1',
    spellName: 'Invisibility',
    effectType: 'invisible',
    payload: {},
    sourceIsConcentration: true,
  });

  // Verify effects are active
  assert('4a: invisible before break', target.conditions.has('invisible'));
  assert('4b: vulnerability before break', queryVulnerability(target, 'attack').disadvantage);
  assert('4c: self-adv before break', querySelf(target, 'attack').advantage);

  // Simulate concentration break
  const bf = makeBF([caster, target]);
  removeEffectsFromCaster('caster1', bf);

  // Verify all effects removed
  assert('4d: invisible condition removed', !target.conditions.has('invisible'));
  assert('4e: vulnerability removed', !queryVulnerability(target, 'attack').disadvantage);
  assert('4f: self-advantage removed', !querySelf(target, 'attack').advantage);
  assert('4g: activeEffects array empty for this caster',
    !target.activeEffects.some(e => e.casterId === 'caster1'));
}

// ============================================================
// Section 5 — Integration: Invisibility spell applies invisible effect
// ============================================================

console.log('\n--- Section 5: Integration — Invisibility spell ---');

{
  const caster = makeCombatant('wizard1', {
    name: 'Wizard',
    faction: 'party',
    actions: [INVIS_ACTION],
    resources: withSlots2(2),
  });
  const ally = makeCombatant('ally1', { name: 'Ally', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  // Verify invisible condition
  assert('5a: ally has invisible condition', ally.conditions.has('invisible'));

  // Verify advantage on own attacks
  const selfResult = querySelf(ally, 'attack');
  assert('5b: ally has advantage on own attacks', selfResult.advantage);

  // Verify disadvantage on attacks vs ally
  const vulnResult = queryVulnerability(ally, 'attack');
  assert('5c: attacks vs ally have disadvantage', vulnResult.disadvantage);

  // Verify active effect
  const invEff = ally.activeEffects.find(e => e.effectType === 'invisible');
  assert('5d: active effect has type invisible', invEff !== undefined);
  assert('5e: effect sourceIsConcentration', invEff?.sourceIsConcentration === true);
  eq('5f: effect spellName', invEff?.spellName, 'Invisibility');
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
