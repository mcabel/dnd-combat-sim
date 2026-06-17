// ============================================================
// dissonant_whispers.test.ts  —  PHB p.234
//
// Sections:
//   1. shouldCast gates         (6 tests)
//   2. execute — damage & save  (8 tests)
//   3. Forced flee mechanic     (6 tests)
//   4. Deafened auto-success    (3 tests)
//   5. Planner integration      (5 tests)
//   6. End-to-end               (4 tests)
//
// Run: ts-node src/test/dissonant_whispers.test.ts
// ============================================================

import * as fs from 'fs';
import { shouldCast, execute, RANGE_FT } from '../spells/dissonant_whispers';
import { planTurn } from '../ai/planner';
import { spawnPC, loadPCStatBlocks } from '../parser/pc';
import { loadBestiaryJson, monsterToCombatant } from '../parser/fivetools';
import { EngineState } from '../engine/combat';
import { Combatant, Battlefield, PlayerResources, Vec3 } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Factories ----------------------------------------------

function withSlot(remaining = 1): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

function makeC(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [],
    legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart' as any,
    perception: { targets: new Map() } as any,
    concentration: null, deathSaves: null, resources: null,
    tempHP: 0, mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null, activeEffects: [],
    ...overrides,
  };
}

const DW_ACTION: any = {
  name: 'Dissonant Whispers', isMultiattack: false, attackType: 'save',
  reach: 60, range: { normal: 60, long: 60 }, hitBonus: null,
  damage: { count: 3, sides: 6, bonus: 0, average: 10.5 }, damageType: 'psychic',
  saveDC: 13, saveAbility: 'wis', isAoE: false, isControl: false,
  requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0,
  description: 'Dissonant Whispers',
};

function makeBard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeC('bard', { faction: 'party', pos, actions: [DW_ACTION], resources: withSlot(2) });
}

function makeEnemy(id: string, pos: Vec3, wis = 10): Combatant {
  return makeC(id, { faction: 'enemy', pos, wis });
}

function makeBF(all: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of all) map.set(c.id, c);
  return { combatants: map, round: 1, initiativeOrder: all.map(c => c.id), obstacles: [], width: 20, height: 20, depth: 1, cells: [] } as unknown as Battlefield;
}

function makeState(bf: Battlefield): EngineState {
  return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), noDamageRounds: new Map(), rageDamagedSinceLastTurn: new Set() };
}

// ---- Loaders ------------------------------------------------

const rawPCs = JSON.parse(fs.readFileSync('pc_stat_blocks_lv1.json', 'utf8'));
const pcMap = loadPCStatBlocks(rawPCs);
const bestiaryRaw = JSON.parse(fs.readFileSync('bestiaryData/bestiary-mm-2014.json', 'utf8'));
const bestiary = loadBestiaryJson(bestiaryRaw);

function spawnClass(cls: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnPC(pcMap, cls, pos);
  if (!c) throw new Error(`Unknown class: ${cls}`);
  return c;
}
function spawnMonster(name: string, id: string, pos: Vec3 = { x: 2, y: 0, z: 0 }): Combatant {
  const t = bestiary.get(name.toLowerCase());
  if (!t) throw new Error(`Monster not found: ${name}`);
  const c = monsterToCombatant(t, pos);
  c.id = id; return c;
}

// ---- 1. shouldCast gates ------------------------------------

console.log('\n1. shouldCast gates');

{
  const b = makeBard(); const e = makeEnemy('e1', { x: 2, y: 0, z: 0 });
  assert('returns target when slot + enemy within 60 ft', shouldCast(b, makeBF([b, e])) !== null);
}

{
  const b = makeBard(); b.resources = withSlot(0);
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  assert('returns null when no spell slot', shouldCast(b, makeBF([b, e])) === null);
}

{
  // 13 cells = 65 ft > RANGE_FT (60)
  const b = makeBard({ x: 0, y: 0, z: 0 });
  const e = makeEnemy('e1', { x: 13, y: 0, z: 0 });
  assert('returns null when enemy beyond 60 ft', shouldCast(b, makeBF([b, e])) === null);
}

{
  const b = makeBard(); b.actions = [];
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  assert('returns null when no Dissonant Whispers action', shouldCast(b, makeBF([b, e])) === null);
}

{
  const b = makeBard(); const e = makeEnemy('e1', { x: 1, y: 0, z: 0 }); e.isDead = true;
  assert('returns null when only enemy is dead', shouldCast(b, makeBF([b, e])) === null);
}

{
  // Picks nearest of two enemies
  const b = makeBard({ x: 0, y: 0, z: 0 });
  const near = makeEnemy('near', { x: 1, y: 0, z: 0 });
  const far = makeEnemy('far', { x: 8, y: 0, z: 0 });
  const result = shouldCast(b, makeBF([b, near, far]));
  assert('targets nearest enemy', result?.id === 'near');
}

// ---- 2. execute — damage & saves ----------------------------

console.log('\n2. execute — damage and WIS save');

{
  // Slot consumed
  const b = makeBard(); b.resources = withSlot(1);
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  execute(b, e, makeState(makeBF([b, e])));
  eq('slot consumed after execute', b.resources!.spellSlots![1].remaining, 0);
}

{
  // Action event logged
  const b = makeBard(); const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const state = makeState(makeBF([b, e]));
  execute(b, e, state);
  assert('action event logged with spell name',
    state.log.events.some(ev => ev.type === 'action' && ev.description.includes('Dissonant Whispers')));
}

{
  // Damage event logged
  const b = makeBard(); const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const state = makeState(makeBF([b, e]));
  execute(b, e, state);
  assert('damage event logged for target',
    state.log.events.some(ev => ev.type === 'damage' && ev.targetId === 'e1'));
}

{
  // Low-WIS target takes damage (wis 1 → always fails DC 13)
  const b = makeBard(); const e = makeEnemy('e1', { x: 1, y: 0, z: 0 }, 1);
  e.currentHP = 30;
  execute(b, e, makeState(makeBF([b, e])));
  assert('low-WIS target HP reduced (always fails DC 13)', e.currentHP < 30);
}

{
  // High-WIS target (wis 30, +10 mod) passes DC 13 ~90% of the time.
  // Loop 10 trials to guarantee at least one save_success.
  let gotSuccess = false;
  for (let i = 0; i < 10 && !gotSuccess; i++) {
    const b2 = makeBard(); const e2 = makeEnemy(`ewis${i}`, { x: 1, y: 0, z: 0 }, 30);
    const st2 = makeState(makeBF([b2, e2]));
    execute(b2, e2, st2);
    if (st2.log.events.some(ev => ev.type === 'save_success')) gotSuccess = true;
  }
  assert('save_success logged for wis-30 target (10 trials)', gotSuccess);
}

{
  // Minimum half damage: 3d6 min=3, half=1
  const b = makeBard(); const e = makeEnemy('e1', { x: 1, y: 0, z: 0 }, 30);
  e.currentHP = 40;
  execute(b, e, makeState(makeBF([b, e])));
  assert('wis-30 target HP < 40 (at least 1 damage from half)', e.currentHP < 40);
}

{
  // save_fail logged for wis-1 target across 10 trials
  let gotFail = false;
  for (let i = 0; i < 10 && !gotFail; i++) {
    const b = makeBard(); const e = makeEnemy(`e${i}`, { x: 1, y: 0, z: 0 }, 1);
    const state = makeState(makeBF([b, e]));
    execute(b, e, state);
    if (state.log.events.some(ev => ev.type === 'save_fail')) gotFail = true;
  }
  assert('save_fail logged for wis-1 target', gotFail);
}

{
  // damage value in event is positive
  const b = makeBard(); const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const state = makeState(makeBF([b, e]));
  execute(b, e, state);
  const dmgEvt = state.log.events.find(ev => ev.type === 'damage' && ev.targetId === 'e1');
  assert('damage event value > 0', (dmgEvt?.value ?? 0) > 0);
}

// ---- 3. Forced flee mechanic --------------------------------

console.log('\n3. Forced flee mechanic');

{
  // Failed save: reaction consumed
  const b = makeBard(); const e = makeEnemy('e1', { x: 1, y: 0, z: 0 }, 1); // wis 1 = always fail
  let reactionConsumed = false;
  for (let i = 0; i < 15 && !reactionConsumed; i++) {
    const b2 = makeBard(); const e2 = makeEnemy(`e${i}`, { x: 1, y: 0, z: 0 }, 1);
    e2.budget.reactionUsed = false;
    execute(b2, e2, makeState(makeBF([b2, e2])));
    if (e2.budget.reactionUsed) reactionConsumed = true;
  }
  assert('reaction consumed on failed WIS save', reactionConsumed);
}

{
  // Failed save: target moves away (pos changes)
  let moved = false;
  for (let i = 0; i < 15 && !moved; i++) {
    const b = makeBard({ x: 0, y: 0, z: 0 }); const e = makeEnemy(`e${i}`, { x: 1, y: 0, z: 0 }, 1);
    const startX = e.pos.x;
    execute(b, e, makeState(makeBF([b, e])));
    if (e.pos.x !== startX || e.pos.y !== 0) moved = true;
  }
  assert('target position changes on failed save (forced flee)', moved);
}

{
  // Failed save: target moves AWAY from caster, not toward
  let movedAway = false;
  for (let i = 0; i < 15 && !movedAway; i++) {
    const b = makeBard({ x: 0, y: 0, z: 0 }); const e = makeEnemy(`e${i}`, { x: 3, y: 0, z: 0 }, 1);
    const startX = e.pos.x;
    execute(b, e, makeState(makeBF([b, e])));
    // Target was at x=3 (right of caster at x=0), should move further right
    if (e.pos.x > startX) movedAway = true;
  }
  assert('target flees away from caster (x increases when target east of caster)', movedAway);
}

{
  // Successful save: reaction NOT consumed
  const b = makeBard(); const e = makeEnemy('e1', { x: 1, y: 0, z: 0 }, 30); // always saves
  e.budget.reactionUsed = false;
  execute(b, e, makeState(makeBF([b, e])));
  assert('reaction NOT consumed on successful save (wis 30)', !e.budget.reactionUsed);
}

{
  // Successful save: position unchanged
  const b = makeBard({ x: 0, y: 0, z: 0 }); const e = makeEnemy('e1', { x: 3, y: 0, z: 0 }, 30);
  const startPos = { ...e.pos };
  execute(b, e, makeState(makeBF([b, e])));
  assert('position unchanged on successful save (wis 30)',
    e.pos.x === startPos.x && e.pos.y === startPos.y);
}

{
  // Reaction already used: no double-consumption, but still moves
  let tested = false;
  for (let i = 0; i < 15 && !tested; i++) {
    const b = makeBard({ x: 0, y: 0, z: 0 }); const e = makeEnemy(`e${i}`, { x: 2, y: 0, z: 0 }, 1);
    e.budget.reactionUsed = true; // already spent
    const startX = e.pos.x;
    execute(b, e, makeState(makeBF([b, e])));
    // reaction stays true, may or may not move depending on implementation
    tested = e.budget.reactionUsed === true; // must remain true, not flipped back
  }
  assert('reaction stays consumed when already used before cast', tested);
}

// ---- 4. Deafened auto-success (PHB p.234) -------------------

console.log('\n4. Deafened creature auto-succeeds');

{
  // Deafened → save_success logged without rolling
  const b = makeBard(); const e = makeEnemy('e1', { x: 1, y: 0, z: 0 }, 1); // would fail otherwise
  e.conditions = new Set(['deafened']);
  const state = makeState(makeBF([b, e]));
  execute(b, e, state);
  assert('save_success logged for deafened target', state.log.events.some(ev => ev.type === 'save_success' && ev.targetId === 'e1'));
}

{
  // Deafened → no forced movement
  const b = makeBard({ x: 0, y: 0, z: 0 }); const e = makeEnemy('e1', { x: 2, y: 0, z: 0 }, 1);
  e.conditions = new Set(['deafened']);
  e.budget.reactionUsed = false;
  const startPos = { ...e.pos };
  execute(b, e, makeState(makeBF([b, e])));
  assert('deafened target does not flee', e.pos.x === startPos.x && e.pos.y === startPos.y);
}

{
  // Deafened → still takes half damage (auto-success = half)
  const b = makeBard(); const e = makeEnemy('e1', { x: 1, y: 0, z: 0 }, 1);
  e.conditions = new Set(['deafened']); e.currentHP = 40;
  execute(b, e, makeState(makeBF([b, e])));
  assert('deafened target takes half damage (auto-success half)', e.currentHP < 40);
}

// ---- 5. Planner integration ---------------------------------

console.log('\n5. Planner integration');

{
  // Full Bard plans dissonantWhispers vs enemy in range
  const bard = spawnClass('Bard', { x: 0, y: 0, z: 0 });
  const orc = spawnMonster('orc', 'orc1', { x: 5, y: 0, z: 0 }); // 25 ft — in range
  const plan = planTurn(bard, makeBF([bard, orc]));
  assert('Bard plans dissonantWhispers vs orc at 25 ft', plan.action?.type === 'dissonantWhispers');
}

{
  // Enemy beyond 60 ft → Bard falls back to weapon
  const bard = spawnClass('Bard', { x: 0, y: 0, z: 0 });
  const orc = spawnMonster('orc', 'orc1', { x: 15, y: 0, z: 0 }); // 75 ft
  const plan = planTurn(bard, makeBF([bard, orc]));
  assert('Bard does NOT plan dissonantWhispers when enemy at 75 ft',
    plan.action?.type !== 'dissonantWhispers');
}

{
  // No slot → falls back
  const bard = spawnClass('Bard', { x: 0, y: 0, z: 0 });
  if (bard.resources?.spellSlots) Object.keys(bard.resources.spellSlots).forEach(k => { (bard.resources!.spellSlots as any)[k].remaining = 0; });
  const orc = spawnMonster('orc', 'orc1', { x: 3, y: 0, z: 0 });
  const plan = planTurn(bard, makeBF([bard, orc]));
  assert('Bard does not plan dissonantWhispers with 0 slots',
    plan.action?.type !== 'dissonantWhispers');
}

{
  // Wizard does NOT plan dissonantWhispers (wrong class)
  const wiz = spawnClass('Wizard', { x: 0, y: 0, z: 0 });
  const orc = spawnMonster('orc', 'orc1', { x: 3, y: 0, z: 0 });
  const plan = planTurn(wiz, makeBF([wiz, orc]));
  assert('Wizard never plans dissonantWhispers', plan.action?.type !== 'dissonantWhispers');
}

{
  // plan.targetId set
  const bard = spawnClass('Bard', { x: 0, y: 0, z: 0 });
  const orc = spawnMonster('orc', 'orc1', { x: 3, y: 0, z: 0 });
  const plan = planTurn(bard, makeBF([bard, orc]));
  if (plan.action?.type === 'dissonantWhispers') {
    assert('plan.targetId is set', !!plan.targetId);
  } else {
    assert('plan set (DW or fallback)', plan.action !== null);
  }
}

// ---- 6. End-to-end ------------------------------------------

console.log('\n6. End-to-end');

{
  // Enemy HP reduced
  const bard = spawnClass('Bard', { x: 0, y: 0, z: 0 });
  const orc = spawnMonster('orc', 'orc1', { x: 3, y: 0, z: 0 });
  orc.currentHP = 30; const start = orc.currentHP;
  const bf = makeBF([bard, orc]);
  execute(bard, orc, makeState(bf));
  assert('orc HP reduced after Dissonant Whispers', orc.currentHP < start);
}

{
  // Slot decremented
  const bard = spawnClass('Bard', { x: 0, y: 0, z: 0 });
  const orc = spawnMonster('orc', 'orc1', { x: 3, y: 0, z: 0 });
  const slotsBefore = bard.resources?.spellSlots?.[1]?.remaining ?? 0;
  execute(bard, orc, makeState(makeBF([bard, orc])));
  assert('slot decremented after cast',
    (bard.resources?.spellSlots?.[1]?.remaining ?? 0) < slotsBefore);
}

{
  // After second cast slot at 0 → shouldCast returns null
  const bard = spawnClass('Bard', { x: 0, y: 0, z: 0 });
  if (bard.resources?.spellSlots?.[1]) bard.resources.spellSlots[1].remaining = 1;
  const orc = spawnMonster('orc', 'orc1', { x: 3, y: 0, z: 0 });
  const bf = makeBF([bard, orc]);
  execute(bard, orc, makeState(bf));
  assert('shouldCast returns null after last slot spent', shouldCast(bard, bf) === null);
}

{
  // Low-WIS orc (wis=8 in MM) fails more than half the time across 20 trials
  let fails = 0;
  for (let i = 0; i < 20; i++) {
    const bard = spawnClass('Bard', { x: 0, y: 0, z: 0 });
    const orc = spawnMonster('orc', `orc${i}`, { x: 3, y: 0, z: 0 });
    const state = makeState(makeBF([bard, orc]));
    execute(bard, orc, state);
    if (state.log.events.some(ev => ev.type === 'save_fail')) fails++;
  }
  // Orc WIS mod = -1, DC 13 → needs 14+ on d20, fail ~65% of time. Expect ≥8/20.
  assert(`orc fails WIS save majority of time (${fails}/20 fails, expect ≥8)`, fails >= 8);
}

// ---- Results ------------------------------------------------

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
