// ============================================================
// Test: Advantage / Disadvantage System
// Run: ts-node src/test/adv_system.test.ts
// Covers: grantSelf, grantVulnerability, tickAdvantages,
//         querySelf, queryVulnerability, passiveBonus,
//         removeBySource, scope matching, refresh rule
// ============================================================

import {
  grantSelf, grantVulnerability, tickAdvantages,
  querySelf, queryVulnerability, passiveBonus, removeBySource,
} from '../engine/adv_system';

import { Combatant, ActionBudget, AdvantageEntry } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Minimal fixture ----------------------------------------

function freshBudget(): ActionBudget {
  return { movementFt: 30, actionUsed: false, bonusActionUsed: false,
           reactionUsed: false, freeObjectUsed: false };
}

function makeCombatant(id = 'c1'): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 20, currentHP: 20, ac: 12, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: null, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [],
    legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: freshBudget(), conditions: new Set(),
    aiProfile: 'attackNearest', perception: { targets: new Map() },
    concentration: null, deathSaves: null, resources: null,
    tempHP: 0, exhaustionLevel: 0, mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [],
  };
}

// ============================================================
// 1. Grant / Query basics
// ============================================================
console.log('\n=== 1. Grant / Query basics ===\n');

{
  const c = makeCombatant();
  grantSelf(c, 'advantage', 'attack', 'Bless', 'rounds', 5);
  const q = querySelf(c, 'attack');
  assert('grantSelf: advantage on attack', q.advantage);
  assert('grantSelf: no disadvantage yet', !q.disadvantage);
  eq('grantSelf: one entry in advantages', c.advantages.length, 1);
}

{
  const c = makeCombatant();
  grantVulnerability(c, 'disadvantage', 'attack', 'Dodge', 'until_next_turn');
  const q = queryVulnerability(c, 'attack');
  assert('grantVulnerability: disadvantage on attack', q.disadvantage);
  assert('grantVulnerability: no advantage', !q.advantage);
  eq('grantVulnerability: one entry in vulnerabilities', c.vulnerabilities.length, 1);
}

{
  // querySelf returns false when nothing granted
  const c = makeCombatant();
  const q = querySelf(c, 'attack');
  assert('querySelf: empty → no advantage', !q.advantage);
  assert('querySelf: empty → no disadvantage', !q.disadvantage);
}

// ============================================================
// 2. Scope matching
// ============================================================
console.log('\n=== 2. Scope matching ===\n');

{
  // General 'attack' entry covers specific 'attack:melee' query
  const c = makeCombatant();
  grantSelf(c, 'advantage', 'attack', 'Bless', 'permanent');
  assert('Scope: "attack" entry covers "attack:melee" query',
    querySelf(c, 'attack:melee').advantage);
  assert('Scope: "attack" entry covers "attack:ranged" query',
    querySelf(c, 'attack:ranged').advantage);
}

{
  // Specific 'attack:melee' entry does NOT cover general 'attack' query
  const c = makeCombatant();
  grantSelf(c, 'advantage', 'attack:melee', 'Reckless Attack', 'until_next_turn');
  assert('Scope: "attack:melee" entry covers "attack:melee" query',
    querySelf(c, 'attack:melee').advantage);
  assert('Scope: "attack:melee" does NOT cover general "attack" query',
    !querySelf(c, 'attack').advantage);
  assert('Scope: "attack:melee" does NOT cover "attack:ranged"',
    !querySelf(c, 'attack:ranged').advantage);
}

{
  // 'all' covers everything
  const c = makeCombatant();
  grantSelf(c, 'disadvantage', 'all', 'Hex of Doom', 'permanent');
  assert('Scope: "all" covers attack',   querySelf(c, 'attack').disadvantage);
  assert('Scope: "all" covers save:dex', querySelf(c, 'save:dex').disadvantage);
  assert('Scope: "all" covers ability',  querySelf(c, 'ability').disadvantage);
}

{
  // 'save:dex' does not cover 'save:str'
  const c = makeCombatant();
  grantSelf(c, 'advantage', 'save:dex', 'Dodge', 'until_next_turn');
  assert('Scope: "save:dex" does not cover "save:str"',
    !querySelf(c, 'save:str').advantage);
  assert('Scope: "save:dex" covers "save:dex"',
    querySelf(c, 'save:dex').advantage);
}

// ============================================================
// 3. Refresh rule
// ============================================================
console.log('\n=== 3. Refresh rule ===\n');

{
  // New entry with LONGER duration replaces the existing one
  const c = makeCombatant();
  grantSelf(c, 'advantage', 'attack', 'Bless', 'rounds', 3);
  grantSelf(c, 'advantage', 'attack', 'Faerie Fire', 'rounds', 10);
  eq('Refresh: longer duration wins — one entry', c.advantages.length, 1);
  eq('Refresh: roundsRemaining is 10', c.advantages[0].roundsRemaining, 10);
  eq('Refresh: source is updated to longer-duration grant', c.advantages[0].source, 'Faerie Fire');
}

{
  // New entry with SHORTER duration keeps existing
  const c = makeCombatant();
  grantSelf(c, 'advantage', 'attack', 'Bless', 'rounds', 10);
  grantSelf(c, 'advantage', 'attack', 'Short Source', 'rounds', 2);
  eq('Refresh: shorter duration ignored — one entry', c.advantages.length, 1);
  eq('Refresh: roundsRemaining stays at 10', c.advantages[0].roundsRemaining, 10);
}

{
  // Different scopes = separate entries, no merging
  const c = makeCombatant();
  grantSelf(c, 'advantage', 'attack', 'Bless', 'rounds', 5);
  grantSelf(c, 'advantage', 'attack:melee', 'Reckless Attack', 'until_next_turn');
  eq('Refresh: different scopes = 2 entries', c.advantages.length, 2);
}

{
  // Advantage and Disadvantage on same scope = separate entries (PHB: both active = roll once)
  const c = makeCombatant();
  grantSelf(c, 'advantage',    'attack', 'Bless', 'permanent');
  grantSelf(c, 'disadvantage', 'attack', 'Frightened', 'permanent');
  const q = querySelf(c, 'attack');
  assert('Both active: advantage true',    q.advantage);
  assert('Both active: disadvantage true', q.disadvantage);
  eq('Both stored as separate entries', c.advantages.length, 2);
}

// ============================================================
// 4. Tick / Duration expiry
// ============================================================
console.log('\n=== 4. Tick / Duration expiry ===\n');

{
  // 'until_next_turn' removed on tick
  const c = makeCombatant();
  grantSelf(c, 'advantage', 'attack:melee', 'Reckless Attack', 'until_next_turn');
  eq('Before tick: entry present', c.advantages.length, 1);
  tickAdvantages(c);
  eq('After tick: until_next_turn removed', c.advantages.length, 0);
}

{
  // 'rounds' decrements and removes at 0
  const c = makeCombatant();
  grantSelf(c, 'advantage', 'save', 'Bless', 'rounds', 2);
  tickAdvantages(c);
  eq('Rounds: 2→1 after one tick', c.advantages[0].roundsRemaining, 1);
  tickAdvantages(c);
  eq('Rounds: removed at 0', c.advantages.length, 0);
}

{
  // 'permanent' is never removed by tick
  const c = makeCombatant();
  grantSelf(c, 'advantage', 'attack', 'Feature', 'permanent');
  tickAdvantages(c);
  tickAdvantages(c);
  tickAdvantages(c);
  eq('Permanent: still present after 3 ticks', c.advantages.length, 1);
}

{
  // tickAdvantages affects both advantages[] and vulnerabilities[]
  const c = makeCombatant();
  grantSelf(c, 'advantage', 'attack:melee', 'Reckless Attack', 'until_next_turn');
  grantVulnerability(c, 'advantage', 'attack', 'Reckless Attack', 'until_next_turn');
  tickAdvantages(c);
  eq('Tick: own advantages[] cleared', c.advantages.length, 0);
  eq('Tick: vulnerabilities[] cleared', c.vulnerabilities.length, 0);
}

// ============================================================
// 5. passiveBonus
// ============================================================
console.log('\n=== 5. passiveBonus ===\n');

{
  const c = makeCombatant();
  grantSelf(c, 'advantage', 'perception', 'Keen Senses', 'permanent');
  eq('passiveBonus: advantage only → +5', passiveBonus(c, 'perception'), 5);
}

{
  const c = makeCombatant();
  grantVulnerability(c, 'disadvantage', 'perception', 'Blinded', 'permanent');
  eq('passiveBonus: disadvantage only → -5', passiveBonus(c, 'perception'), -5);
}

{
  const c = makeCombatant();
  grantSelf(c, 'advantage', 'perception', 'Keen Senses', 'permanent');
  grantVulnerability(c, 'disadvantage', 'perception', 'Blinded', 'permanent');
  eq('passiveBonus: both active → 0', passiveBonus(c, 'perception'), 0);
}

// ============================================================
// 6. removeBySource
// ============================================================
console.log('\n=== 6. removeBySource ===\n');

{
  const c = makeCombatant();
  grantSelf(c, 'advantage', 'attack', 'Bless', 'rounds', 10);
  grantSelf(c, 'advantage', 'save', 'Bless', 'rounds', 10);
  grantVulnerability(c, 'advantage', 'attack', 'Faerie Fire', 'rounds', 10);
  removeBySource(c, 'Bless');
  eq('removeBySource: removes own attack entry', c.advantages.filter(e => e.source === 'Bless').length, 0);
  eq('removeBySource: removes own save entry too', c.advantages.length, 0);
  eq('removeBySource: does not remove other sources', c.vulnerabilities.length, 1);
}

// ============================================================
// 7. Reckless Attack + Dodge integration (adv_system side only)
// ============================================================
console.log('\n=== 7. Reckless Attack + Dodge (adv_system) ===\n');

{
  // Simulate Reckless Attack grants: barb has advantage on melee, enemies have adv vs barb
  const barb = makeCombatant('barb');
  grantSelf(barb, 'advantage', 'attack:melee', 'Reckless Attack', 'until_next_turn');
  grantVulnerability(barb, 'advantage', 'attack', 'Reckless Attack', 'until_next_turn');
  assert('Reckless Attack: barb has advantage on attack:melee', querySelf(barb, 'attack:melee').advantage);
  assert('Reckless Attack: attacks vs barb have advantage', queryVulnerability(barb, 'attack').advantage);
  // Next turn: tick clears both
  tickAdvantages(barb);
  assert('Reckless Attack: own adv expires', !querySelf(barb, 'attack:melee').advantage);
  assert('Reckless Attack: exposure expires', !queryVulnerability(barb, 'attack').advantage);
}

{
  // Simulate Dodge: attacks vs dodger have disadvantage; dodger has adv on DEX saves
  const dodger = makeCombatant('dodger');
  grantVulnerability(dodger, 'disadvantage', 'attack', 'Dodge', 'until_next_turn');
  grantSelf(dodger, 'advantage', 'save:dex', 'Dodge', 'until_next_turn');
  assert('Dodge: attacks vs dodger have disadvantage', queryVulnerability(dodger, 'attack').disadvantage);
  assert('Dodge: dodger has advantage on DEX saves', querySelf(dodger, 'save:dex').advantage);
  tickAdvantages(dodger);
  assert('Dodge: attack disadvantage expires', !queryVulnerability(dodger, 'attack').disadvantage);
  assert('Dodge: DEX save advantage expires', !querySelf(dodger, 'save:dex').advantage);
}

// ---- Results ------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
