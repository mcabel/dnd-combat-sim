// ============================================================
// Test: Warding Bond (PHB p.287)
// Covers:
//   - applyDamageWithTempHP: resistance to all damage types when bonded
//   - rollSave: +1 bonus to all saving throws when bonded
//   - resolveAttack: +1 effective AC when bonded (+1 not tested deterministically
//     due to dice, but AC guard is structural — see effectiveAC in combat.ts)
//   - applyWardingBondRedirect: caster takes the same damage as bonded creature
//   - Bond breaks when caster drops to 0 HP (checkDeath + redirect helper)
//   - Bond skips redirect if caster is already dead/unconscious
//   - wardingBond: null initialized for all new PCs and monsters
// Run: ts-node src/test/warding_bond.test.ts
// ============================================================

import { runCombat, makeFlatBattlefield } from '../engine/combat';
import { applyDamageWithTempHP, rollSave, resetBudget } from '../engine/utils';
import { loadPCStatBlocks, spawnPC }       from '../parser/pc';
import { Combatant, Action, PlayerResources } from '../types/core';
import { shouldCast as shouldCastWardingBond, execute as executeWardingBond } from '../spells/warding_bond';
import { planTurn } from '../ai/planner';
import * as fs from 'fs';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, actual: T, expected: T): void {
  assert(label, actual === expected,
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(overrides: Partial<Combatant> = {}): Combatant {
  const id = overrides.id ?? `c_${++_id}`;
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 20, currentHP: 20, ac: 14,
    speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 8, wis: 10, cha: 8,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'attackNearest',
    perception: { targets: new Map() },
    concentration: null,
    deathSaves: null,
    mountedOn: null,
    carriedBy: null,
    independentMount: false,
    role: 'regular',
    bonded: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false,
    cannotAttack: false,
    hasHands: false, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null,
    wardingBond: null, activeEffects: [],
    ...overrides,
  };
}

function fixedInit(...cs: Combatant[]): string[] { return cs.map(c => c.id); }

function meleeAction(overrides: Partial<Action> = {}): Action {
  return {
    name: 'Strike', isMultiattack: false, attackType: 'melee',
    reach: 5, range: null, hitBonus: 5,
    damage: { count: 1, sides: 6, bonus: 0, average: 3.5 },
    damageType: 'slashing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: '',
    ...overrides,
  };
}

// ============================================================
// Section 1: applyDamageWithTempHP — WB resistance (all types)
// ============================================================
console.log('\n=== 1. WB resistance in applyDamageWithTempHP ===\n');

{
  // Bonded creature: WB active → any typed damage is halved
  const bonded = makeC({ id: 'wb1', maxHP: 100, currentHP: 100,
    wardingBond: { casterId: 'caster_x' } });

  const dealt1 = applyDamageWithTempHP(bonded, 10, 'fire');
  eq('WB: 10 fire dealt = 5 (halved)',  dealt1, 5);
  eq('WB: fire HP = 95',               bonded.currentHP, 95);

  const dealt2 = applyDamageWithTempHP(bonded, 10, 'slashing');
  eq('WB: 10 slashing dealt = 5',      dealt2, 5);

  // Floor: 7 → 3
  const dealt3 = applyDamageWithTempHP(bonded, 7, 'cold');
  eq('WB: 7 cold dealt = 3 (floor)',   dealt3, 3);
}

{
  // WB halves typeless (null) damage — unlike specific resistances
  const bonded = makeC({ id: 'wb2', maxHP: 100, currentHP: 100,
    wardingBond: { casterId: 'caster_x' } });

  const dealt = applyDamageWithTempHP(bonded, 10, null);
  eq('WB: 10 typeless dealt = 5',  dealt, 5);
  eq('WB: typeless HP = 95',       bonded.currentHP, 95);
}

{
  // No bond → full damage (control: resistance does NOT apply without bond)
  const noBond = makeC({ id: 'wb3', maxHP: 100, currentHP: 100, wardingBond: null });

  const dealt = applyDamageWithTempHP(noBond, 10, 'fire');
  eq('No WB: 10 fire dealt = 10 (full)',  dealt, 10);
  eq('No WB: HP = 90',                   noBond.currentHP, 90);
}

{
  // WB + existing specific resistance: still halved once (PHB: no double-halving)
  const bonded = makeC({ id: 'wb4', maxHP: 100, currentHP: 100,
    wardingBond: { casterId: 'caster_x' },
    resistances: ['fire'] });

  // Both WB and specific resistance → still floor(10/2) = 5, not floor(5/2) = 2
  const dealt = applyDamageWithTempHP(bonded, 10, 'fire');
  eq('WB + fire resistance: dealt = 5 (single halving)', dealt, 5);
}

// ============================================================
// Section 2: rollSave — +1 bonus when bonded
// ============================================================
console.log('\n=== 2. rollSave +1 bonus ===\n');

{
  // WIS 10 → mod 0, no proficiency, no BI → total should equal roll + 1 (WB bonus)
  const bonded = makeC({ id: 'wb_save1', wis: 10,
    wardingBond: { casterId: 'caster_x' } });

  const result = rollSave(bonded, 'wis', 999 /* impossible DC — we're checking arithmetic */);
  eq('WB save: total = roll + 1 (WIS 10)', result.total, result.roll + 1);
}

{
  // WIS 10, no WB → total = roll + 0
  const noBond = makeC({ id: 'wb_save2', wis: 10, wardingBond: null });

  const result = rollSave(noBond, 'wis', 999);
  eq('No WB save: total = roll (WIS 10)', result.total, result.roll);
}

{
  // WIS 14 → mod +2 — verify +1 WB stacks correctly: total = roll + 2 + 1 = roll + 3
  const bonded = makeC({ id: 'wb_save3', wis: 14,
    wardingBond: { casterId: 'caster_x' } });

  const result = rollSave(bonded, 'wis', 999);
  eq('WB save: WIS 14 total = roll + 3 (mod 2 + WB 1)', result.total, result.roll + 3);
}

// ============================================================
// Section 3: Damage redirect via runCombat
// ============================================================
console.log('\n=== 3. Damage redirect (runCombat) ===\n');

{
  // Enemy attacks bonded creature first.
  // - Bonded takes halved damage (WB resistance)
  // - Caster takes the same amount as redirect
  // - Both start at 100 HP; enemy deals exactly 10 → each takes 5.
  const casterId  = 'wb_caster';
  const bondedId  = 'wb_bonded';
  const enemyId   = 'wb_enemy';

  const caster = makeC({
    id: casterId, name: 'Cleric (caster)',
    faction: 'party', pos: { x: 5, y: 5, z: 0 },   // far from enemy
    maxHP: 100, currentHP: 100, ac: 20, actions: [],  // survives, not targeted
  });

  const bonded = makeC({
    id: bondedId, name: 'Paladin (bonded)',
    faction: 'party', pos: { x: 1, y: 0, z: 0 },    // adjacent to enemy
    maxHP: 100, currentHP: 100, ac: 4,               // very easy to hit
    wardingBond: { casterId },
    // hitBonus: null → auto-hit so the enemy is killed deterministically on round 1.
    // With a normal attack roll a nat 1 (5%) misses, letting the enemy survive and
    // hit the bonded a second time (→ bonded HP 90, breaking the "HP > 90" assertion).
    actions: [meleeAction({ hitBonus: null,
      damage: { count: 1, sides: 1, bonus: 9, average: 10 } })],
  });

  const enemy = makeC({
    id: enemyId, name: 'Orc',
    faction: 'enemy', pos: { x: 0, y: 0, z: 0 },
    maxHP: 5, currentHP: 5, ac: 4,
    // hitBonus: null → auto-hit. A normal attack roll (even hitBonus 20 vs AC 4)
    // nat-1-misses 5% of the time (attackHits, PHB p.194); when that happens the
    // bonded takes no damage and the caster takes no redirect damage (stays at 100),
    // failing the "caster HP < 100" assertion flakily. Auto-hit exercises the
    // redirect deterministically.
    actions: [meleeAction({ hitBonus: null,
      damage: { count: 1, sides: 1, bonus: 9, average: 10 },  // exactly 10 damage
      damageType: 'slashing' })],
  });

  const bf = makeFlatBattlefield(10, 10, [caster, bonded, enemy]);
  // Enemy goes first: hits bonded → bonded takes 5 (WB halved), caster takes 5 (redirect)
  // Then bonded kills enemy. Combat ends.
  runCombat(bf, fixedInit(enemy, bonded, caster), { maxRounds: 3 });

  const finalBonded = bf.combatants.get(bondedId)!;
  const finalCaster  = bf.combatants.get(casterId)!;

  assert('Redirect: bonded took halved damage (HP > 90)',
    finalBonded.currentHP > 90,
    `HP was ${finalBonded.currentHP}`);

  assert('Redirect: caster took redirect damage (HP < 100)',
    finalCaster.currentHP < 100,
    `Caster HP was ${finalCaster.currentHP}`);

  eq('Redirect: bonded HP === caster HP (same damage taken)',
    finalBonded.currentHP, finalCaster.currentHP);
}

// ============================================================
// Section 4: Bond breaks when caster drops to 0 HP
// ============================================================
console.log('\n=== 4. Bond break on caster death ===\n');

{
  // Enemy deals 10 damage to bonded → bonded takes 5 → caster (5 HP) takes 5 → caster dies.
  // Bond should be null on bonded after the round.
  const casterId = 'wb_dying_caster';
  const bondedId = 'wb_protected';
  const enemyId  = 'wb_killer';

  const caster = makeC({
    id: casterId, name: 'Dying Cleric',
    faction: 'party', pos: { x: 5, y: 5, z: 0 },
    maxHP: 5, currentHP: 5, ac: 20,   // will die from redirect (5 damage)
    isPlayer: false,                   // monster-style: dies at 0 (no death saves)
    actions: [],
  });

  const bonded = makeC({
    id: bondedId, name: 'Bonded Warrior',
    faction: 'party', pos: { x: 1, y: 0, z: 0 },
    maxHP: 100, currentHP: 100, ac: 4,
    wardingBond: { casterId },
    actions: [meleeAction({ hitBonus: 20,
      damage: { count: 1, sides: 1, bonus: 49, average: 50 } })],  // kills enemy fast
  });

  const enemy = makeC({
    id: enemyId, name: 'Bond Breaker',
    faction: 'enemy', pos: { x: 0, y: 0, z: 0 },
    maxHP: 5, currentHP: 5, ac: 4,
    // hitBonus: null → auto-hit (resolveAttack auto-hit path). This bypasses the
    // d20 attack roll so the bonded ALWAYS takes damage on round 1. With a normal
    // attack roll (even hitBonus 20 vs AC 4), a nat 1 (5%) is an auto-miss
    // (attackHits, PHB p.194); when that happens the bonded takes no damage, the
    // caster takes no redirect damage, survives at 5 HP, and the 3 bond-break
    // assertions below fail flakily (~5% of runs). Auto-hit makes the redirect
    // deterministic while still exercising applyWardingBondRedirect + checkDeath.
    actions: [meleeAction({ hitBonus: null,
      damage: { count: 1, sides: 1, bonus: 9, average: 10 },
      damageType: 'fire' })],
  });

  const bf = makeFlatBattlefield(10, 10, [caster, bonded, enemy]);
  const result = runCombat(bf, fixedInit(enemy, bonded, caster), { maxRounds: 3 });

  const finalBonded = bf.combatants.get(bondedId)!;
  const finalCaster  = bf.combatants.get(casterId)!;

  assert('Bond break: caster died (isDead or isUnconscious)',
    finalCaster.isDead || finalCaster.isUnconscious,
    `caster HP=${finalCaster.currentHP}`);

  eq('Bond break: wardingBond cleared on bonded after caster death',
    finalBonded.wardingBond, null);

  const bondBreakEvent = result.events.find(e =>
    e.description.toLowerCase().includes('warding bond ends'));
  assert('Bond break: condition_remove event logged', bondBreakEvent !== undefined);
}

// ============================================================
// Section 5: wardingBond initialized to null for all new PCs
// ============================================================
console.log('\n=== 5. wardingBond: null for spawned PCs ===\n');

{
  const raw    = JSON.parse(fs.readFileSync('./pc_stat_blocks_lv1.json', 'utf-8'));
  const pcMap  = loadPCStatBlocks(raw);
  const cleric = spawnPC(pcMap, 'Cleric',  { x: 0, y: 0, z: 0 })!;
  const paladin = spawnPC(pcMap, 'Paladin', { x: 1, y: 0, z: 0 })!;
  const wizard  = spawnPC(pcMap, 'Wizard',  { x: 2, y: 0, z: 0 })!;

  eq('Cleric wardingBond initializes to null',  cleric.wardingBond,  null);
  eq('Paladin wardingBond initializes to null', paladin.wardingBond, null);
  eq('Wizard wardingBond initializes to null',  wizard.wardingBond,  null);
}

// ============================================================
// Shared helpers for new AI sections (6–9)
// ============================================================

import { EngineState, CombatLog } from '../engine/combat';
import { Battlefield } from '../types/core';

/** Minimal Battlefield for shouldCast / execute unit tests. */
function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>(combatants.map(c => [c.id, c]));
  return {
    width: 10, height: 10, depth: 1, cells: [],
    combatants: map, round: 1,
    obstacles: [],
    initiativeOrder: combatants.map(c => c.id),
  } as unknown as Battlefield;
}

function makeState(bf: Battlefield): EngineState {
  const log: CombatLog = { events: [], winner: null, rounds: 0 };
  return {
    battlefield: bf,
    log,
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

/** Minimal PlayerResources with wardingBond resource ready to cast. */
function wbResources(remaining = 1): PlayerResources {
  return { wardingBond: { remaining } };
}

// ============================================================
// Section 6: shouldCastWardingBond — gate conditions
// ============================================================
console.log('\n=== 6. shouldCastWardingBond — gate conditions ===\n');

{
  // 6a: Returns a target when an adjacent ally exists and resource is available
  const caster = makeC({ id: 'wb6_caster', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: wbResources(1) });
  const ally   = makeC({ id: 'wb6_ally',   faction: 'party', pos: { x: 1, y: 0, z: 0 },
    wardingBond: null });
  const bf = makeBF([caster, ally]);

  const t = shouldCastWardingBond(caster, bf);
  assert('6a: returns ally when adjacent and resource=1', t?.id === 'wb6_ally');
}

{
  // 6b: Returns null when wardingBond resource is absent (no field)
  const caster = makeC({ id: 'wb6b_caster', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: null });
  const ally   = makeC({ id: 'wb6b_ally',   faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, ally]);

  assert('6b: null when resources is null', shouldCastWardingBond(caster, bf) === null);
}

{
  // 6c: Returns null when remaining = 0
  const caster = makeC({ id: 'wb6c_caster', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: wbResources(0) });
  const ally   = makeC({ id: 'wb6c_ally',   faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, ally]);

  assert('6c: null when remaining=0', shouldCastWardingBond(caster, bf) === null);
}

{
  // 6d: Returns null when no allies within 5 ft (ally is 3 squares = 15 ft away)
  const caster = makeC({ id: 'wb6d_caster', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: wbResources(1) });
  const ally   = makeC({ id: 'wb6d_ally',   faction: 'party', pos: { x: 3, y: 0, z: 0 },
    wardingBond: null });
  const bf = makeBF([caster, ally]);

  assert('6d: null when ally out of touch range (15 ft)', shouldCastWardingBond(caster, bf) === null);
}

{
  // 6e: Returns null when the only ally is already bonded (to a different caster)
  const caster  = makeC({ id: 'wb6e_caster',  faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: wbResources(1) });
  const ally    = makeC({ id: 'wb6e_ally',    faction: 'party', pos: { x: 1, y: 0, z: 0 },
    wardingBond: { casterId: 'some_other_caster' } });
  const bf = makeBF([caster, ally]);

  assert('6e: null when only ally already bonded', shouldCastWardingBond(caster, bf) === null);
}

{
  // 6f: Returns null when caster already maintains an active bond on the field
  const caster = makeC({ id: 'wb6f_caster', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: wbResources(1) });
  const bonded = makeC({ id: 'wb6f_bonded', faction: 'party', pos: { x: 1, y: 0, z: 0 },
    wardingBond: { casterId: 'wb6f_caster' } });
  const ally2  = makeC({ id: 'wb6f_ally2', faction: 'party', pos: { x: 1, y: 1, z: 0 },
    wardingBond: null });
  const bf = makeBF([caster, bonded, ally2]);

  assert('6f: null when caster already has an active bond', shouldCastWardingBond(caster, bf) === null);
}

{
  // 6g: Skips dead allies (no dead targets returned)
  const caster = makeC({ id: 'wb6g_caster', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: wbResources(1) });
  const dead   = makeC({ id: 'wb6g_dead',   faction: 'party', pos: { x: 1, y: 0, z: 0 },
    isDead: true, wardingBond: null });
  const bf = makeBF([caster, dead]);

  assert('6g: null when only adjacent ally is dead', shouldCastWardingBond(caster, bf) === null);
}

{
  // 6h: Prefers the most vulnerable (lowest HP%) ally
  const caster  = makeC({ id: 'wb6h_caster', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: wbResources(1) });
  const healthy = makeC({ id: 'wb6h_healthy', faction: 'party', pos: { x: 1, y: 0, z: 0 },
    maxHP: 20, currentHP: 20, wardingBond: null });
  const hurt    = makeC({ id: 'wb6h_hurt',    faction: 'party', pos: { x: 0, y: 1, z: 0 },
    maxHP: 20, currentHP: 5,  wardingBond: null });
  const bf = makeBF([caster, healthy, hurt]);

  const t = shouldCastWardingBond(caster, bf);
  assert('6h: prefers hurt ally (lowest HP%)', t?.id === 'wb6h_hurt');
}

// ============================================================
// Section 7: execute — bond applied, resource decremented, events logged
// ============================================================
console.log('\n=== 7. executeWardingBond — pipeline ===\n');

function makeBFWithInit(combatants: Combatant[]): Battlefield {
  return makeBF(combatants);
}

{
  // 7a: execute sets wardingBond on target
  const caster = makeC({ id: 'wb7a_c', faction: 'party', resources: wbResources(1) });
  const ally   = makeC({ id: 'wb7a_a', faction: 'party', wardingBond: null });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  executeWardingBond(caster, ally, state);

  assert('7a: target.wardingBond set to caster id', ally.wardingBond?.casterId === 'wb7a_c');
}

{
  // 7b: execute decrements remaining from 1 → 0
  const caster = makeC({ id: 'wb7b_c', faction: 'party', resources: wbResources(1) });
  const ally   = makeC({ id: 'wb7b_a', faction: 'party', wardingBond: null });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  executeWardingBond(caster, ally, state);

  eq('7b: resource.remaining decremented to 0',
    caster.resources!.wardingBond!.remaining, 0);
}

{
  // 7c: execute logs an 'action' event
  const caster = makeC({ id: 'wb7c_c', faction: 'party', resources: wbResources(1) });
  const ally   = makeC({ id: 'wb7c_a', faction: 'party', wardingBond: null });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  executeWardingBond(caster, ally, state);

  const actionEvt = state.log.events.find(e => e.type === 'action' && e.actorId === 'wb7c_c');
  assert('7c: action event logged', actionEvt !== undefined);
}

{
  // 7d: execute logs a 'condition_add' event pointing at the ally
  const caster = makeC({ id: 'wb7d_c', faction: 'party', resources: wbResources(1) });
  const ally   = makeC({ id: 'wb7d_a', faction: 'party', wardingBond: null });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  executeWardingBond(caster, ally, state);

  const condEvt = state.log.events.find(
    e => e.type === 'condition_add' && e.targetId === 'wb7d_a',
  );
  assert('7d: condition_add event logged targeting ally', condEvt !== undefined);
}

{
  // 7e: After execute, the existing resistance + redirect mechanics fire in combat
  //     (unit-level: directly check that applyDamageWithTempHP halves damage when
  //      wardingBond is set, as already proven in Section 1 — this just confirms
  //      execute's side-effect enables those mechanics)
  const caster = makeC({ id: 'wb7e_c', faction: 'party', resources: wbResources(1) });
  const ally   = makeC({ id: 'wb7e_a', faction: 'party', maxHP: 100, currentHP: 100,
    wardingBond: null });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  executeWardingBond(caster, ally, state);
  const dealt  = applyDamageWithTempHP(ally, 10, 'fire');

  eq('7e: post-bond fire damage halved (5)', dealt, 5);
}

// ============================================================
// Section 8: planTurn — planner chooses wardingBond when gated
// ============================================================
console.log('\n=== 8. planTurn picks wardingBond ===\n');

{
  // 8a: Planner selects wardingBond when resource is available and ally is adjacent
  const caster  = makeC({
    id: 'wb8a_c', name: 'Cleric', faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    aiProfile: 'smart',
    resources: wbResources(1),
    actions: [meleeAction()],
  });
  const ally    = makeC({
    id: 'wb8a_a', faction: 'party',
    pos: { x: 1, y: 0, z: 0 },
    wardingBond: null,
    actions: [meleeAction()],
  });
  const enemy   = makeC({
    id: 'wb8a_e', faction: 'enemy',
    pos: { x: 5, y: 5, z: 0 },
    actions: [meleeAction()],
  });
  const bf = makeBFWithInit([caster, ally, enemy]);

  resetBudget(caster);
  const plan = planTurn(caster, bf);

  assert('8a: plan.action.type is wardingBond', plan.action?.type === 'wardingBond');
  assert('8a: targetId is the ally', plan.action?.targetId === 'wb8a_a');
}

{
  // 8b: Planner does NOT choose wardingBond when remaining = 0
  const caster  = makeC({
    id: 'wb8b_c', faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    aiProfile: 'smart',
    resources: wbResources(0),
    actions: [meleeAction()],
  });
  const ally    = makeC({
    id: 'wb8b_a', faction: 'party',
    pos: { x: 1, y: 0, z: 0 }, wardingBond: null,
    actions: [],
  });
  const enemy   = makeC({
    id: 'wb8b_e', faction: 'enemy',
    pos: { x: 1, y: 1, z: 0 },
    actions: [meleeAction()],
  });
  const bf = makeBFWithInit([caster, ally, enemy]);

  resetBudget(caster);
  const plan = planTurn(caster, bf);

  assert('8b: plan.action is NOT wardingBond when remaining=0',
    plan.action?.type !== 'wardingBond');
}

{
  // 8c: Planner does NOT choose wardingBond when ally is out of touch range
  const caster  = makeC({
    id: 'wb8c_c', faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    aiProfile: 'smart',
    resources: wbResources(1),
    actions: [meleeAction()],
  });
  const ally    = makeC({
    id: 'wb8c_a', faction: 'party',
    pos: { x: 5, y: 5, z: 0 },   // 5*sqrt(2)*5 ≈ 35 ft away
    wardingBond: null,
    actions: [],
  });
  const enemy   = makeC({
    id: 'wb8c_e', faction: 'enemy',
    pos: { x: 1, y: 0, z: 0 },
    actions: [meleeAction()],
  });
  const bf = makeBFWithInit([caster, ally, enemy]);

  resetBudget(caster);
  const plan = planTurn(caster, bf);

  assert('8c: wardingBond not chosen when ally out of range',
    plan.action?.type !== 'wardingBond');
}

// ============================================================
// Section 9: runCombat — Warding Bond fires and effects persist
// ============================================================
console.log('\n=== 9. runCombat — Warding Bond integration ===\n');

{
  // 9a: runCombat emits a 'condition_add' event for Warding Bond
  const caster  = makeC({
    id: 'wb9a_c', name: 'Cleric', faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    aiProfile: 'smart',
    resources: wbResources(1),
    actions: [meleeAction()],
  });
  const ally    = makeC({
    id: 'wb9a_a', name: 'Paladin', faction: 'party',
    pos: { x: 1, y: 0, z: 0 },
    maxHP: 100, currentHP: 100, ac: 20,
    wardingBond: null,
    actions: [meleeAction()],
  });
  const enemy   = makeC({
    id: 'wb9a_e', name: 'Orc', faction: 'enemy',
    pos: { x: 8, y: 0, z: 0 },
    maxHP: 5, currentHP: 5,
    actions: [meleeAction()],
  });

  const bf = makeFlatBattlefield(15, 10, [caster, ally, enemy]);
  const result = runCombat(bf, [caster.id, ally.id, enemy.id], { maxRounds: 5 });

  const bondEvt = result.events.find(
    e => e.type === 'condition_add' && e.description.toLowerCase().includes('warding bond'),
  );
  assert('9a: runCombat fires Warding Bond condition_add event', bondEvt !== undefined);
}

{
  // 9b: After runCombat, caster's resource.remaining is 0 (bond was cast)
  const caster  = makeC({
    id: 'wb9b_c', name: 'Cleric', faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    aiProfile: 'smart',
    resources: wbResources(1),
    actions: [meleeAction()],
  });
  const ally    = makeC({
    id: 'wb9b_a', name: 'Paladin', faction: 'party',
    pos: { x: 1, y: 0, z: 0 },
    maxHP: 100, currentHP: 100, ac: 20,
    wardingBond: null,
    actions: [meleeAction()],
  });
  const enemy   = makeC({
    id: 'wb9b_e', name: 'Orc', faction: 'enemy',
    pos: { x: 8, y: 0, z: 0 },
    maxHP: 5, currentHP: 5,
    actions: [meleeAction()],
  });

  const bf = makeFlatBattlefield(15, 10, [caster, ally, enemy]);
  runCombat(bf, [caster.id, ally.id, enemy.id], { maxRounds: 5 });

  const finalCaster = bf.combatants.get('wb9b_c')!;
  eq('9b: caster.resources.wardingBond.remaining is 0 after cast',
    finalCaster.resources!.wardingBond!.remaining, 0);
}

{
  // 9c: Warding Bond is NOT recast on round 2 (resource gate prevents double-cast)
  const caster  = makeC({
    id: 'wb9c_c', name: 'Cleric', faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    aiProfile: 'smart',
    resources: wbResources(1),
    actions: [meleeAction()],
  });
  const ally    = makeC({
    id: 'wb9c_a', name: 'Paladin', faction: 'party',
    pos: { x: 1, y: 0, z: 0 },
    maxHP: 200, currentHP: 200, ac: 20,
    wardingBond: null,
    actions: [meleeAction()],
  });
  const enemy   = makeC({
    id: 'wb9c_e', name: 'Troll', faction: 'enemy',
    pos: { x: 4, y: 0, z: 0 },
    maxHP: 84, currentHP: 84,
    actions: [meleeAction()],
  });

  const bf = makeFlatBattlefield(15, 10, [caster, ally, enemy]);
  const result = runCombat(bf, [caster.id, ally.id, enemy.id], { maxRounds: 5 });

  const bondEvents = result.events.filter(
    e => e.type === 'condition_add' && e.description.toLowerCase().includes('warding bond'),
  );
  assert('9c: Warding Bond cast exactly once (resource gate)', bondEvents.length === 1);
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
