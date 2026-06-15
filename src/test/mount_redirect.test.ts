// ============================================================
// Test: ST-5 Mount ↔ Rider redirect helpers
// Run: ts-node src/test/mount_redirect.test.ts
// Covers: checkMountedCombatant, checkProtectionStyle,
//         checkInterceptionReduction
// ============================================================

import {
  checkMountedCombatant,
  checkProtectionStyle,
  checkInterceptionReduction,
} from '../engine/mount_redirect';

import { Combatant, Action, Battlefield, ActionBudget } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Minimal fixture builders --------------------------------

function freshBudget(): ActionBudget {
  return { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };
}

function makeCombatant(overrides: Partial<Combatant>): Combatant {
  return {
    id: 'c-default',
    name: 'TestCreature',
    isPlayer: false,
    faction: 'party',
    maxHP: 20, currentHP: 20,
    ac: 12, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: null,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [],
    legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: freshBudget(),
    conditions: new Set(),
    aiProfile: 'attackNearest',
    perception: { targets: new Map() },
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular',
    bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [],
    ...overrides,
  };
}

/** Build a mount+rider pair with the given rider traits, and a Battlefield containing both. */
function makeMountedPair(riderTraits: string[] = []) {
  const mount = makeCombatant({ id: 'mount-1', name: 'Giant Fly', role: 'mount', carriedBy: 'rider-1' });
  const rider = makeCombatant({ id: 'rider-1', name: 'Fighter', isPlayer: true,
    traits: riderTraits, mountedOn: 'mount-1' });
  const map = new Map<string, Combatant>([['mount-1', mount], ['rider-1', rider]]);
  const bf: Battlefield = { width: 10, height: 10, depth: 1, cells: [],
    combatants: map, round: 1, initiativeOrder: ['rider-1', 'mount-1'] };
  return { mount, rider, bf };
}

/** Standard melee attack action (attack roll, not save). */
function meleeAction(): Action {
  return {
    name: 'Longsword', isMultiattack: false, attackType: 'melee',
    reach: 5, range: null, hitBonus: 3,
    damage: { count: 1, sides: 8, bonus: 1, average: 5.5 },
    damageType: 'slashing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: 'Longsword attack',
  };
}

/** Save-based action (Fireball etc.) — cannot be redirected. */
function saveAction(): Action {
  return {
    name: 'Fireball', isMultiattack: false, attackType: 'save',
    reach: 0, range: { normal: 150, long: 150 }, hitBonus: null,
    damage: { count: 8, sides: 6, bonus: 0, average: 28 },
    damageType: 'fire', saveDC: 15, saveAbility: 'dex',
    isAoE: true, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: 'Fireball',
  };
}

/** Auto-hit action (Magic Missile style: hitBonus = null, attackType ≠ 'save'). */
function autoHitAction(): Action {
  return {
    name: 'Magic Missile', isMultiattack: false, attackType: 'spell',
    reach: 0, range: { normal: 120, long: 120 }, hitBonus: null,
    damage: { count: 1, sides: 4, bonus: 1, average: 3.5 },
    damageType: 'force', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: 'Magic Missile',
  };
}

// ============================================================
// 1. Mounted Combatant (ST-5A)
// ============================================================
console.log('\n=== 1. Mounted Combatant ===\n');

{
  // 1.1 — riderless mount: no redirect
  const mount = makeCombatant({ id: 'm1', role: 'mount', carriedBy: null });
  const map = new Map<string, Combatant>([['m1', mount]]);
  const bf: Battlefield = { width: 10, height: 10, depth: 1, cells: [],
    combatants: map, round: 1, initiativeOrder: ['m1'] };
  const result = checkMountedCombatant(mount, meleeAction(), bf);
  assert('Riderless mount → no redirect', result === null);
}

{
  // 1.2 — rider has feat, save action: no redirect (saves cannot be redirected)
  const { mount, rider, bf } = makeMountedPair(['Mounted Combatant']);
  const result = checkMountedCombatant(mount, saveAction(), bf);
  assert('Save action → no redirect even with feat', result === null,
    `got rider ${result?.id}`);
}

{
  // 1.3 — rider has feat, auto-hit action: no redirect (hitBonus === null)
  const { mount, rider, bf } = makeMountedPair(['Mounted Combatant']);
  const result = checkMountedCombatant(mount, autoHitAction(), bf);
  assert('Auto-hit action → no redirect even with feat', result === null,
    `got rider ${result?.id}`);
}

{
  // 1.4 — rider has feat, standard attack: returns rider
  const { mount, rider, bf } = makeMountedPair(['Mounted Combatant']);
  const result = checkMountedCombatant(mount, meleeAction(), bf);
  assert('Standard melee → returns rider', result?.id === 'rider-1',
    `got ${result?.id}`);
}

{
  // 1.5 — rider is dead: no redirect
  const { mount, rider, bf } = makeMountedPair(['Mounted Combatant']);
  rider.isDead = true;
  const result = checkMountedCombatant(mount, meleeAction(), bf);
  assert('Dead rider → no redirect', result === null);
}

{
  // 1.6 — rider is unconscious: no redirect
  const { mount, rider, bf } = makeMountedPair(['Mounted Combatant']);
  rider.isUnconscious = true;
  const result = checkMountedCombatant(mount, meleeAction(), bf);
  assert('Unconscious rider → no redirect', result === null);
}

// ============================================================
// 2. Fighting Style: Protection (ST-5B)
// ============================================================
console.log('\n=== 2. Fighting Style: Protection ===\n');

{
  // 2.1 — rider has style, reaction free: returns rider, reactionUsed becomes true
  const { mount, rider, bf } = makeMountedPair(['Fighting Style (Protection)']);
  assert('Protection: reaction starts free', !rider.budget.reactionUsed);
  const result = checkProtectionStyle(mount, bf);
  assert('Protection: returns rider', result?.id === 'rider-1', `got ${result?.id}`);
  assert('Protection: reactionUsed marked true', rider.budget.reactionUsed);
}

{
  // 2.2 — reaction already used: returns null
  const { mount, rider, bf } = makeMountedPair(['Fighting Style (Protection)']);
  rider.budget.reactionUsed = true;
  const result = checkProtectionStyle(mount, bf);
  assert('Protection: reaction used → null', result === null);
}

{
  // 2.3 — rider lacks style: returns null
  const { mount, rider, bf } = makeMountedPair([]);
  const result = checkProtectionStyle(mount, bf);
  assert('Protection: no style → null', result === null);
}

{
  // 2.4 — riderless mount: returns null
  const mount = makeCombatant({ id: 'm2', role: 'mount', carriedBy: null });
  const map = new Map<string, Combatant>([['m2', mount]]);
  const bf: Battlefield = { width: 10, height: 10, depth: 1, cells: [],
    combatants: map, round: 1, initiativeOrder: ['m2'] };
  const result = checkProtectionStyle(mount, bf);
  assert('Protection: riderless → null', result === null);
}

// ============================================================
// 3. Fighting Style: Interception (ST-5C)
// ============================================================
console.log('\n=== 3. Fighting Style: Interception ===\n');

{
  // 3.1 — rider has style, reaction free: returns positive reduction; reactionUsed marked
  const { mount, rider, bf } = makeMountedPair(['Fighting Style (Interception)']);
  const dmg = 20;
  const { reduction, rider: r } = checkInterceptionReduction(mount, dmg, bf);
  assert('Interception: rider returned', r?.id === 'rider-1', `got ${r?.id}`);
  assert('Interception: reduction > 0', reduction > 0, `got ${reduction}`);
  assert('Interception: reduction ≤ dmg', reduction <= dmg, `got ${reduction}`);
  assert('Interception: reactionUsed marked', rider.budget.reactionUsed);
  // 1d10 (1–10) + prof (2) → minimum 3, maximum 12
  assert('Interception: reduction in valid range [3,12]', reduction >= 3 && reduction <= 12,
    `got ${reduction}`);
}

{
  // 3.2 — reduction capped when dmg is tiny (e.g. 1 damage, reduction never exceeds dmg)
  const { mount, bf } = makeMountedPair(['Fighting Style (Interception)']);
  const dmg = 1;
  const { reduction } = checkInterceptionReduction(mount, dmg, bf);
  assert('Interception: reduction capped to dmg', reduction <= dmg, `got ${reduction}`);
}

{
  // 3.3 — reaction already used: returns 0
  const { mount, rider, bf } = makeMountedPair(['Fighting Style (Interception)']);
  rider.budget.reactionUsed = true;
  const { reduction } = checkInterceptionReduction(mount, 15, bf);
  eq('Interception: reaction used → reduction 0', reduction, 0);
}

{
  // 3.4 — riderless mount: returns 0, rider null
  const mount = makeCombatant({ id: 'm3', role: 'mount', carriedBy: null });
  const map = new Map<string, Combatant>([['m3', mount]]);
  const bf: Battlefield = { width: 10, height: 10, depth: 1, cells: [],
    combatants: map, round: 1, initiativeOrder: ['m3'] };
  const { reduction, rider } = checkInterceptionReduction(mount, 15, bf);
  eq('Interception: riderless → reduction 0', reduction, 0);
  assert('Interception: riderless → rider null', rider === null);
}

// ---- Results ------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
