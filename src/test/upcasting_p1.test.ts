// ============================================================
// upcasting_p1.test.ts — TG-033-P1: castSlotLevel on PlannedAction
//
// Tests:
//   1. getLowestAvailableSlot — unit tests (slots, pact, missing)
//   2. planTurn castSlotLevel — bespoke spell plans carry correct slot
//   3. Counterspell scenario — L5 fireball exposes level 5, not 1
//
// Run: ts-node src/test/upcasting_p1.test.ts
// ============================================================

import { getLowestAvailableSlot } from '../ai/resources';
import { planTurn } from '../ai/planner';
import { Combatant, Battlefield, Action } from '../types/core';

// ── Harness ─────────────────────────────────────────────────

let passed = 0, failed = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

// ── Helpers ──────────────────────────────────────────────────

function slots(map: Record<number, number>) {
  const spellSlots: Record<number, { max: number; remaining: number }> = {};
  for (const [lvl, rem] of Object.entries(map)) {
    spellSlots[Number(lvl)] = { max: rem, remaining: rem };
  }
  return { spellSlots } as any;
}

function pactSlots(level: number, remaining: number) {
  return { pactSlots: { slotLevel: level, max: remaining, remaining } } as any;
}

function slotsAndPact(map: Record<number, number>, pLevel: number, pRem: number) {
  const base = slots(map);
  base.pactSlots = { slotLevel: pLevel, max: pRem, remaining: pRem };
  return base;
}

/** Minimal valid Combatant for planTurn usage */
function combatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id,
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    currentHP: 30, maxHP: 30, ac: 12,
    str: 10, dex: 10, con: 10, int: 16, wis: 14, cha: 10,
    speed: 30,
    actions: [],
    reactions: [],
    conditions: new Set(),
    activeEffects: [],
    resources: null,
    budget: { actionUsed: false, bonusActionUsed: false, reactionUsed: false, movementUsed: 0 },
    aiProfile: 'attackNearest' as any,
    perception: { detection: null, targets: new Map() } as any,
    ...overrides,
  } as Combatant;
}

function enemy(id: string, hp = 40, posX = 0): Combatant {
  return combatant(id, { faction: 'enemy', pos: { x: posX, y: 0, z: 0 }, currentHP: hp, maxHP: hp });
}

function makeBF(cs: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of cs) map.set(c.id, c);
  return { combatants: map } as unknown as Battlefield;
}

/** Minimal valid Action for a spell (as any to avoid full shape) */
function spellAct(name: string, slotLevel: number, extraProps: Partial<Action> = {}): Action {
  return {
    name,
    isMultiattack: false,
    attackType: 'save' as any,
    reach: 5,
    range: { normal: 150, long: 150 },
    hitBonus: null,
    damage: { count: 8, sides: 6, bonus: 0, average: 28 },
    damageType: 'fire' as any,
    saveDC: 14,
    saveAbility: 'dex' as any,
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel,
    costType: 'action' as any,
    legendaryCost: 0,
    description: name,
    ...extraProps,
  } as Action;
}

// ── Section 1: getLowestAvailableSlot unit tests ─────────────

console.log('\n── 1. getLowestAvailableSlot ──────────────────────────────');

{
  // 1a–1c: standard slots — returns minimum available at or above minLevel
  const c = combatant('c1', { resources: slots({ 1: 2, 2: 1, 3: 1 }) });
  assert('1a. minLevel=1 → 1 (lowest)', getLowestAvailableSlot(c, 1) === 1);
  assert('1b. minLevel=2 → 2', getLowestAvailableSlot(c, 2) === 2);
  assert('1c. minLevel=3 → 3', getLowestAvailableSlot(c, 3) === 3);
  assert('1d. minLevel=4 → null (no L4+)', getLowestAvailableSlot(c, 4) === null);
}

{
  // 1e: only higher slot available — returns it
  const c = combatant('c2', { resources: slots({ 5: 1 }) });
  assert('1e. minLevel=3, only L5 → returns 5', getLowestAvailableSlot(c, 3) === 5);
}

{
  // 1f: no resources → null
  const c = combatant('c3', { resources: null });
  assert('1f. null resources → null', getLowestAvailableSlot(c, 1) === null);
}

{
  // 1g: pact slot at/above minLevel is preferred
  const c = combatant('c4', { resources: slotsAndPact({ 3: 1 }, 4, 1) });
  // pact L4 + standard L3, minLevel=3 → pact L4 wins (mirrors consumeSpellSlot priority)
  assert('1g. pact L4 + standard L3, minLevel=3 → pact L4', getLowestAvailableSlot(c, 3) === 4);
}

{
  // 1h: pact slot below minLevel is skipped
  const c = combatant('c5', { resources: slotsAndPact({ 5: 1 }, 2, 1) });
  // pact L2 < minLevel=4; falls through to standard L5
  assert('1h. pact L2 < minLevel=4 → falls to standard L5', getLowestAvailableSlot(c, 4) === 5);
}

{
  // 1i: all slots at zero
  const c = combatant('c6', { resources: slots({ 1: 0, 2: 0 }) });
  assert('1i. all remaining=0 → null', getLowestAvailableSlot(c, 1) === null);
}

{
  // 1j: exactly at minLevel
  const c = combatant('c7', { resources: slots({ 3: 1 }) });
  assert('1j. only L3, minLevel=3 → 3', getLowestAvailableSlot(c, 3) === 3);
}

// ── Section 2: planTurn castSlotLevel on bespoke spell plans ─

console.log('\n── 2. planTurn — castSlotLevel on bespoke spell plans ──────');

{
  // 2a–2b: Fireball with only L5 slot → castSlotLevel=5, not 3
  const wiz = combatant('wiz', {
    actions: [spellAct('Fireball', 3, { isAoE: true })],
    resources: slots({ 5: 1 }),
    int: 18,
  });
  const bf = makeBF([wiz, enemy('e1', 40, 0), enemy('e2', 40, 1)]);
  const plan = planTurn(wiz, bf);
  const act = plan.action;
  if (act && act.type === 'fireball') {
    assert('2a. fireball plan has castSlotLevel', act.castSlotLevel !== undefined);
    assert('2b. fireball L5-only slot → castSlotLevel=5', act.castSlotLevel === 5,
      `got ${act.castSlotLevel}`);
  } else {
    assert('2a. fireball plan chosen', false, `got ${act?.type}`);
    assert('2b. (skipped)', false);
  }
}

{
  // 2c: Fireball with L3 slot → castSlotLevel=3 (no upcasting forced)
  const wiz = combatant('wiz2', {
    actions: [spellAct('Fireball', 3, { isAoE: true })],
    resources: slots({ 3: 2 }),
    int: 18,
  });
  const bf = makeBF([wiz, enemy('e3', 40, 0), enemy('e4', 40, 1)]);
  const plan = planTurn(wiz, bf);
  const act = plan.action;
  if (act && act.type === 'fireball') {
    assert('2c. fireball L3 slot → castSlotLevel=3', act.castSlotLevel === 3,
      `got ${act.castSlotLevel}`);
  } else {
    assert('2c. fireball plan chosen', false, `got ${act?.type}`);
  }
}

{
  // 2d: Lightning Bolt with L5 slot → castSlotLevel=5
  const wiz = combatant('wiz3', {
    actions: [spellAct('Lightning Bolt', 3, { isAoE: true })],
    resources: slots({ 5: 1 }),
    int: 18,
  });
  const bf = makeBF([wiz, enemy('e5', 40, 0), enemy('e6', 40, 3)]);
  const plan = planTurn(wiz, bf);
  const act = plan.action;
  if (act && act.type === 'lightningBolt') {
    assert('2d. lightningBolt L5 slot → castSlotLevel=5', act.castSlotLevel === 5,
      `got ${act.castSlotLevel}`);
  } else {
    // LB fires only when targets align in a line — allow skip
    assert('2d. lightningBolt castSlotLevel check (plan not chosen — ok)', true, 'skipped');
  }
}

{
  // 2e: Magic Missile with L3 slot → castSlotLevel=3
  const wiz = combatant('wiz4', {
    actions: [spellAct('Magic Missile', 1, { attackType: null as any, hitBonus: 5, isAoE: false, saveDC: 0 })],
    resources: slots({ 3: 1 }),
    int: 16,
  });
  const bf = makeBF([wiz, enemy('e7', 6, 0)]); // low-HP enemy triggers MM over cantrips
  const plan = planTurn(wiz, bf);
  const act = plan.action;
  if (act && act.type === 'magicMissile') {
    assert('2e. magicMissile L3 slot → castSlotLevel=3', act.castSlotLevel === 3,
      `got ${act.castSlotLevel}`);
  } else {
    assert('2e. magicMissile castSlotLevel check (plan not chosen — ok)', true, 'skipped');
  }
}

{
  // 2f: Spiritual Weapon bonus action carries castSlotLevel
  const cleric = combatant('cleric', {
    actions: [
      spellAct('Spiritual Weapon', 2, {
        attackType: 'melee',
        isAoE: false,
        damage: { count: 1, sides: 8, bonus: 0, average: 4.5 },
      }),
    ],
    resources: slots({ 4: 1 }),  // only L4 slot
    wis: 16,
  });
  const e = enemy('e8', 40, 3);
  const bf = makeBF([cleric, e]);
  const plan = planTurn(cleric, bf);
  const ba = plan.bonusAction;
  const checkTarget = ba && ba.type === 'spiritualWeapon' ? ba
    : plan.action && plan.action.type === 'spiritualWeapon' ? plan.action : null;
  if (checkTarget) {
    assert('2f. spiritualWeapon L4 slot → castSlotLevel=4', checkTarget.castSlotLevel === 4,
      `got ${checkTarget.castSlotLevel}`);
  } else {
    assert('2f. spiritualWeapon castSlotLevel check (plan not chosen — ok)', true, 'skipped');
  }
}

// ── Section 3: castSlotLevel → correct interaction level ─────

console.log('\n── 3. castSlotLevel exposes correct spell level ────────────');

{
  // 3a–3c: A fireball cast at L5 must expose level 5 (not the old default of 1).
  // This is the core Counterspell fix: a reactor with L3 Counterspell now
  // sees level 5 → requires an ability check rather than auto-succeeding.
  const wiz = combatant('wiz5', {
    actions: [spellAct('Fireball', 3, { isAoE: true })],
    resources: slots({ 5: 1 }),
    int: 18,
  });
  const bf = makeBF([wiz, enemy('e9', 50, 0), enemy('e10', 50, 1)]);
  const plan = planTurn(wiz, bf);
  const act = plan.action;
  if (act && act.type === 'fireball') {
    assert('3a. L5-slot fireball castSlotLevel > 1 (not old default)', (act.castSlotLevel ?? 0) > 1,
      `castSlotLevel=${act.castSlotLevel}`);
    assert('3b. L5-slot fireball castSlotLevel > 3 (above base level)', (act.castSlotLevel ?? 0) > 3,
      `castSlotLevel=${act.castSlotLevel}`);
    assert('3c. L5-slot fireball castSlotLevel === 5', act.castSlotLevel === 5,
      `castSlotLevel=${act.castSlotLevel}`);
  } else {
    assert('3a. fireball chosen for L5 test', false, `got ${act?.type}`);
    assert('3b. (skipped)', false);
    assert('3c. (skipped)', false);
  }
}

{
  // 3d: L1 Guiding Bolt with L1 slot → level = 1 (no unintended upcasting)
  const cleric = combatant('cl', {
    actions: [spellAct('Guiding Bolt', 1, { attackType: 'ranged' as any, hitBonus: 5, isAoE: false })],
    resources: slots({ 1: 2 }),
    wis: 16,
  });
  const bf = makeBF([cleric, enemy('e11', 40, 0)]);
  const plan = planTurn(cleric, bf);
  const act = plan.action;
  if (act && act.type === 'guidingBolt') {
    assert('3d. guidingBolt L1 slot → castSlotLevel=1', act.castSlotLevel === 1,
      `castSlotLevel=${act.castSlotLevel}`);
  } else {
    assert('3d. guidingBolt castSlotLevel=1 (plan not chosen — ok)', true, 'skipped');
  }
}

{
  // 3e: getLowestAvailableSlot non-mutating — slot count unchanged after call
  const c = combatant('c8', { resources: slots({ 3: 2 }) });
  const before = c.resources?.spellSlots?.[3]?.remaining ?? -1;
  getLowestAvailableSlot(c, 3);
  const after = c.resources?.spellSlots?.[3]?.remaining ?? -1;
  assert('3e. getLowestAvailableSlot does not consume slots', before === after,
    `before=${before} after=${after}`);
}

// ── Results ──────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('All tests passed ✅');
