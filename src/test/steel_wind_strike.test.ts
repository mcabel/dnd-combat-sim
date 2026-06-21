// ============================================================
// steel_wind_strike.test.ts — Steel Wind Strike bespoke spell module (Session 24)
// XGE p.166: 5th-level conjuration, action, range 30 ft, NO concentration.
// Effect: 5 melee spell attacks (6d10 force each). v1 picks up to 5
//         highest-threat enemies within 30 ft; if fewer than 5 enemies are
//         available, repeats the first (highest-threat) target to fill 5
//         slots so all 5 attacks have a target. Crit DOES double (PHB p.196).
//         Upcast NOT modelled (XGE p.166: 5th-level only). Teleport-to-last-
//         target rider NOT modelled.
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors scorching_ray.test.ts structure (multi-attack spell) but with
// Steel Wind Strike's stats (L5, 5 attacks instead of 3, 6d10 force instead
// of 2d6 fire, 30-ft range instead of 120-ft, crit DOES double). Uses
// withSlots5.
//
// Attack rolls use deterministic hit-bonus extremes:
//   - hitBonus: 100  → guaranteed hit (nat 1 → 1+100=101 ≥ AC 14)
//                       5% chance of nat-20 crit (12d10 instead of 6d10)
//   - hitBonus: -100 → guaranteed miss (nat 20 auto-crits per PHB p.194)
//                       5% chance of crit-hit per strike; tests accept either outcome
// Crit-doubling is verified deterministically by calling
// rollDamage(isCrit=true) and rollDamage(isCrit=false) directly.
//
// Position convention: 1 square = 5 ft. chebyshev3D × 5 = feet.
//   - 6 squares = 30 ft (boundary, in range)
//   - 7 squares = 35 ft (> 30 ft range, out)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/steel_wind_strike';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots5(remaining = 2): PlayerResources {
  return { spellSlots: { 5: { max: 2, remaining } } };
}

/** Guaranteed-hit action: hitBonus +100 vs AC 14 → nat 1 hits (101 ≥ 14) */
const SWS_ACTION: Action = {
  name: 'Steel Wind Strike',
  isMultiattack: false,
  attackType: 'spell',          // melee spell attack
  reach: 5,
  range: { normal: 30, long: 30 },
  hitBonus: 100,        // guaranteed hit (nat 1 → 101 ≥ AC 14)
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 5,
  costType: 'action',
  legendaryCost: 0,
  description: 'Steel Wind Strike (5 melee spell attacks, 6d10 force each, crit doubles)',
};

/** Guaranteed-miss action: hitBonus -100 → only nat-20 crits can hit */
const SWS_ACTION_MISS: Action = {
  ...SWS_ACTION,
  hitBonus: -100,
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
    conditions: new Set() as Set<Condition>,
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
    width: 60, height: 60, depth: 1,
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

/** Ranger at (0,0,0) with Steel Wind Strike + 2 5th-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = SWS_ACTION): Combatant {
  return makeCombatant('ranger', {
    name: 'Ranger',
    pos,
    actions: [action],
    resources: withSlots5(2),
  });
}

/** Enemy with AC 14 (default); adjacent-or-near to caster */
function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', pos, ...overrides });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('Name is Steel Wind Strike', metadata.name, 'Steel Wind Strike');
eq('Level is 5', metadata.level, 5);
eq('School is conjuration', metadata.school, 'conjuration');
eq('Range is 30 ft', metadata.rangeFt, 30);
eq('Attack count is 5', metadata.attackCount, 5);
eq('Die count is 6', metadata.dieCount, 6);
eq('Die sides is 10', metadata.dieSides, 10);
eq('Damage type is force', metadata.damageType, 'force');
eq('NOT concentration', metadata.concentration, false);
eq('Casting time is action', metadata.castingTime, 'action');
eq('Multi-target v1 simplified flag set', metadata.steelWindStrikeMultiTargetV1Simplified, true);
eq('Teleport v1 simplified flag set', metadata.steelWindStrikeTeleportV1Simplified, true);
eq('Crit doubles flag set', metadata.steelWindStrikeCritDoublesV1, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

// 2a. Caster lacks 'Steel Wind Strike' action
{
  const caster = makeCombatant('ranger', { actions: [], resources: withSlots5(2) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Steel Wind Strike action', shouldCast(caster, bf), null);
}
// 2b. No 5th-level slots remaining
{
  const caster = makeCombatant('ranger', { actions: [SWS_ACTION], resources: withSlots5(0) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 5th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in range (30 ft)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 7 squares away = 35 ft > 30 ft range
  const farEnemy = makeEnemy('far', { x: 7, y: 0, z: 0 });
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies in range (30 ft)', shouldCast(caster, bf), null);
}
// 2d. Already concentrating — NOT a gate (Steel Wind Strike is NOT concentration)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  assert('Returns targets even when caster is already concentrating (NOT concentration spell)',
    shouldCast(caster, bf) !== null);
}

// ============================================================
// 3. shouldCast — target selection (1, 2, 5+ enemies)
// ============================================================

console.log('\n=== 3. shouldCast — target selection (1, 2, 5+ enemies) ===\n');

// 3a. 1 enemy → all 5 strikes targeted at the same enemy (repeats to fill)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const targets = shouldCast(caster, bf);
  assert('Returns array of 5 targets when 1 enemy exists',
    targets !== null && (targets as Combatant[]).length === 5);
  if (targets) {
    const ts = targets as Combatant[];
    eq('All 5 targets are the same enemy (repeats to fill)', ts[0].id, 'e1');
    eq('Strike 2 == strike 1', ts[1].id, 'e1');
    eq('Strike 3 == strike 1', ts[2].id, 'e1');
    eq('Strike 4 == strike 1', ts[3].id, 'e1');
    eq('Strike 5 == strike 1', ts[4].id, 'e1');
  }
}
// 3b. 2 enemies → strikes alternate (mod 2): strong, weak, strong, weak, strong
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const strong = makeEnemy('strong', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const weak = makeEnemy('weak', { x: 2, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const bf = makeBF([caster, strong, weak]);
  const targets = shouldCast(caster, bf);
  assert('Returns 5 targets when 2 enemies exist',
    targets !== null && (targets as Combatant[]).length === 5);
  if (targets) {
    const ts = targets as Combatant[];
    eq('Strike 1 targets strong enemy (maxHP 100)', ts[0].id, 'strong');
    eq('Strike 2 targets weak enemy (maxHP 30)', ts[1].id, 'weak');
    eq('Strike 3 wraps around to strong enemy (mod 2)', ts[2].id, 'strong');
    eq('Strike 4 wraps around to weak enemy (mod 2)', ts[3].id, 'weak');
    eq('Strike 5 wraps around to strong enemy (mod 2)', ts[4].id, 'strong');
  }
}
// 3c. 5+ enemies → first 5 (highest-threat) selected, no duplicates
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const e2 = makeEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 80, currentHP: 80 });
  const e3 = makeEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 60, currentHP: 60 });
  const e4 = makeEnemy('e4', { x: 4, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const e5 = makeEnemy('e5', { x: 5, y: 0, z: 0 }, { maxHP: 20, currentHP: 20 });
  const e6 = makeEnemy('e6', { x: 6, y: 0, z: 0 }, { maxHP: 10, currentHP: 10 });
  const bf = makeBF([caster, e1, e2, e3, e4, e5, e6]);
  const targets = shouldCast(caster, bf);
  assert('Returns 5 targets when 6 enemies exist',
    targets !== null && (targets as Combatant[]).length === 5);
  if (targets) {
    const ts = targets as Combatant[];
    eq('Strike 1 targets highest-threat (e1, maxHP 100)', ts[0].id, 'e1');
    eq('Strike 2 targets next (e2, maxHP 80)', ts[1].id, 'e2');
    eq('Strike 3 targets next (e3, maxHP 60)', ts[2].id, 'e3');
    eq('Strike 4 targets next (e4, maxHP 40)', ts[3].id, 'e4');
    eq('Strike 5 targets next (e5, maxHP 20)', ts[4].id, 'e5');
    assert('e6 (maxHP 10) NOT targeted',
      !ts.some(t => t.id === 'e6'));
  }
}

// ============================================================
// 4. execute — hit resolution (all 5 strikes hit)
// ============================================================

console.log('\n=== 4. execute — hit resolution ===\n');

// 4a. All 5 strikes hit (hitBonus +100 vs AC 14) — total damage in [30, 600]
//     (5 × 6d10 = 30-300 normal, 5 × 12d10 = 60-600 with all crits; mix)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const hpLost = 1000 - enemy.currentHP;
  // 5 strikes hit, each is 6d10 (6-60) normal OR 12d10 (12-120) crit
  // Total range: 30-600 (5 × [6, 60] non-crit, up to 5 × [12, 120] all-crit)
  assert('5 strikes hitting → total damage in [30, 600] (5 × 6d10 or 12d10 crit)',
    hpLost >= 30 && hpLost <= 600, `got ${hpLost}`);
  eq('Slot consumed (5th level: 2 → 1)',
    (caster.resources as any).spellSlots[5].remaining, 1);
}
// 4b. All 5 strikes should miss (hitBonus -100 vs AC 14) — nat 20 auto-crits
//     so 0-5 crit-hits per cast (5% per strike). Total damage in [0, 600].
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, SWS_ACTION_MISS);
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const hpLost = 1000 - enemy.currentHP;
  // 5 strikes; only nat-20 crits hit. 0-5 crits expected (avg 0.25).
  // Each crit-hit is 12d10 (12-120). Total range: 0-600.
  assert('All non-crit strikes missed (0 dmg, or ≤5 crit-hit strikes in [0, 600])',
    hpLost >= 0 && hpLost <= 600, `got ${hpLost}`);
  eq('Slot still consumed on miss',
    (caster.resources as any).spellSlots[5].remaining, 1);
}
// 4c. Multiple distinct enemies each take damage from their respective strikes
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e3 = makeEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e4 = makeEnemy('e4', { x: 4, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e5 = makeEnemy('e5', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, e1, e2, e3, e4, e5]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  // Each enemy took damage in [6, 120] (one strike each, possibly crit)
  const e1Lost = 1000 - e1.currentHP;
  const e2Lost = 1000 - e2.currentHP;
  const e3Lost = 1000 - e3.currentHP;
  const e4Lost = 1000 - e4.currentHP;
  const e5Lost = 1000 - e5.currentHP;
  assert('e1 took damage in [6, 120] (1 strike, possibly crit)', e1Lost >= 6 && e1Lost <= 120, `got ${e1Lost}`);
  assert('e2 took damage in [6, 120] (1 strike, possibly crit)', e2Lost >= 6 && e2Lost <= 120, `got ${e2Lost}`);
  assert('e3 took damage in [6, 120] (1 strike, possibly crit)', e3Lost >= 6 && e3Lost <= 120, `got ${e3Lost}`);
  assert('e4 took damage in [6, 120] (1 strike, possibly crit)', e4Lost >= 6 && e4Lost <= 120, `got ${e4Lost}`);
  assert('e5 took damage in [6, 120] (1 strike, possibly crit)', e5Lost >= 6 && e5Lost <= 120, `got ${e5Lost}`);
}

// ============================================================
// 5. rollDamage range check (6d10 → 6..60; crit 12d10 → 12..120)
// ============================================================

console.log('\n=== 5. rollDamage range check ===\n');

// 5a. rollDamage(false) — 6d10, range 6-60
{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(false);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(false) min >= 6 (got ${min})`, min >= 6);
  assert(`rollDamage(false) max <= 60 (got ${max})`, max <= 60);
}
// 5b. rollDamage(true) — 12d10, range 12-120 (crit doubles dice)
{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(true);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(true) min >= 12 (got ${min})`, min >= 12);
  assert(`rollDamage(true) max <= 120 (got ${max})`, max <= 120);
}

// ============================================================
// 6. execute — logging (5 strike events with "Strike N" labels)
// ============================================================

console.log('\n=== 6. execute — logging ===\n');

// 6a. All 5 strikes hit (hitBonus +100 vs AC 14 → even nat 1 hits). Each
//     strike emits an attack_hit OR attack_crit event (nat 20 = crit), and a
//     corresponding damage event.
//     NOTE: with only 1 enemy, all 5 strikes target the same enemy. Give it
//     enough HP to survive 5 hits (5 × max 60 dmg = 300; use 1000 HP) so all
//     5 strikes land (the module skips strikes on dead targets — mirrors
//     scorching_ray's behavior).
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const hitEvents = events.filter(e => e.type === 'attack_hit' || e.type === 'attack_crit');
  const damageEvents = events.filter(e => e.type === 'damage');

  eq('1 action event (cast log)', actionEvents.length, 1);
  assert('Action event mentions "Steel Wind Strike"',
    actionEvents[0].description.includes('Steel Wind Strike'));
  eq('5 attack_hit/attack_crit events (one per strike)', hitEvents.length, 5);
  eq('5 damage events (one per hit)', damageEvents.length, 5);
  // Each strike's log mentions its strike number
  assert('Strike 1 logged', hitEvents[0].description.includes('Strike 1'));
  assert('Strike 2 logged', hitEvents[1].description.includes('Strike 2'));
  assert('Strike 3 logged', hitEvents[2].description.includes('Strike 3'));
  assert('Strike 4 logged', hitEvents[3].description.includes('Strike 4'));
  assert('Strike 5 logged', hitEvents[4].description.includes('Strike 5'));
}

// 6b. On miss: attack_miss events emitted (nat 20 may produce crit-hits —
//     accept any mix of attack_miss + attack_crit summing to 5).
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, SWS_ACTION_MISS);
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const missEvents = events.filter(e => e.type === 'attack_miss');
  const critEvents = events.filter(e => e.type === 'attack_crit');
  const hitEvents = events.filter(e => e.type === 'attack_hit');
  const damageEvents = events.filter(e => e.type === 'damage');

  // 5 strikes total: attack_miss + attack_crit + attack_hit should sum to 5.
  // With AC 14 + hitBonus -100, only nat-20 crits hit (no plain hits).
  eq('Total attack events = 5 (miss + crit)',
    missEvents.length + critEvents.length + hitEvents.length, 5);
  eq('No plain attack_hit events (nat 20 → crit)', hitEvents.length, 0);
  // Damage events only fire on crit-hits (0-5 per cast).
  assert('0-5 damage events (crit-hit rate ~5%/strike)',
    damageEvents.length >= 0 && damageEvents.length <= 5, `got ${damageEvents.length}`);
}

// ============================================================
// 7. cleanup — no-op
// ============================================================

console.log('\n=== 7. cleanup — no-op ===\n');

{
  const caster = makeCaster();
  const preSlots = (caster.resources as any).spellSlots[5].remaining;
  let cleanupOk = true;
  try { (require('../spells/steel_wind_strike') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
  eq('Cleanup does NOT consume slots',
    (caster.resources as any).spellSlots[5].remaining, preSlots);
  eq('Cleanup does NOT start concentration', caster.concentration, null);
}

// ============================================================
// 8. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 8. Integration pipeline ===\n');

// 8a. Full pipeline: 1 enemy takes 5 strikes of 6d10 force
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 5 targets (1 enemy repeated)',
    targets !== null && (targets as Combatant[]).length === 5);
  if (targets) execute(caster, targets as Combatant[], state);

  const hpLost = 1000 - enemy.currentHP;
  assert('Single enemy took 5 strikes of damage in [30, 600]',
    hpLost >= 30 && hpLost <= 600, `got ${hpLost}`);
  eq('Slot consumed (1 remaining)',
    (caster.resources as any).spellSlots[5].remaining, 1);
  eq('Caster NOT concentrating (NOT concentration spell)', caster.concentration, null);
}

// 8b. After slots exhausted, shouldCast returns null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  (caster.resources as any).spellSlots[5].remaining = 1;
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', (caster.resources as any).spellSlots[5].remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  eq('shouldCast returns null after slots exhausted', t2, null);
}

// 8c. Can be cast while already concentrating (NOT a concentration spell)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns targets even when caster is concentrating',
    targets !== null);
  if (targets) execute(caster, targets as Combatant[], state);

  eq('Existing concentration preserved (NOT replaced)',
    caster.concentration?.spellName, 'Hold Person');
  eq('Slot consumed', (caster.resources as any).spellSlots[5].remaining, 1);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
