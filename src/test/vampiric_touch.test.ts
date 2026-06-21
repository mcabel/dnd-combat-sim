// ============================================================
// vampiric_touch.test.ts — Vampiric Touch bespoke spell module (Session 24)
// PHB p.287: 3rd-level necromancy, action, range Touch (5 ft). Canon:
// concentration, up to 1 minute. v1: concentration simplified to a
// single one-shot melee spell attack (the repeat-attack rider is NOT
// modelled — same gap as Witch Bolt's DoT, but Witch Bolt's DoT is its
// PRIMARY effect while Vampiric Touch's repeat is a secondary rider).
// Effect: melee spell attack vs AC. On hit: 3d6 necrotic damage, and
// the CASTER regains HP equal to half the ACTUAL necrotic damage dealt
// (after the target's temp HP / resistance). On crit: 6d6 (PHB p.196 —
// dice doubled).
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors inflict_wounds.test.ts structure (melee spell attack) but
// with Vampiric Touch's stats (L3, 3d6 necrotic, 5-ft touch range, crit
// doubles, heal-caster-half rider). Uses withSlots3.
//
// Attack rolls use deterministic hit-bonus extremes:
//   - hitBonus: 100  → guaranteed hit (nat 1 → 1+100=101 ≥ AC 14)
//                       5% chance of nat-20 crit (6d6 instead of 3d6)
//   - hitBonus: -100 → guaranteed miss (nat 20 auto-crits per PHB p.194)
//                       5% chance of crit-hit; tests accept either outcome
// Crit-doubling is verified deterministically by calling
// rollDamage(isCrit=true) and rollDamage(isCrit=false) directly.
//
// Heal rider: caster heals floor(dealt/2). To make the heal OBSERVABLE
// (applyHeal returns the actual HP restored, capped at max-current),
// the caster must be INJURED (currentHP < maxHP). The test sets caster
// currentHP=500 with maxHP=1000 so the full 1-18 heal is absorbed.
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/vampiric_touch';
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

function withSlots3(remaining = 2): PlayerResources {
  return { spellSlots: { 3: { max: 2, remaining } } };
}

/** Guaranteed-hit action: hitBonus +100 vs AC 14 → nat 1 hits (101 ≥ 14) */
const VT_ACTION: Action = {
  name: 'Vampiric Touch',
  isMultiattack: false,
  attackType: 'spell',  // melee spell attack (uses 'spell' per inflict_wounds)
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: 100,        // guaranteed hit (nat 1 → 101 ≥ AC 14)
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Vampiric Touch (melee spell attack, 3d6 necrotic, heal self half damage, crit 6d6)',
};

/** Guaranteed-miss action: hitBonus -100 → only nat-20 crits can hit */
const VT_ACTION_MISS: Action = {
  ...VT_ACTION,
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

/** Cleric at pos (0,0,0) with Vampiric Touch + 2 3rd-level slots.
 *  Caster is INJURED (currentHP=500 < maxHP=1000) so the heal rider is
 *  observable — applyHeal returns the actual HP restored, capped at
 *  max-current. With a 1-18 heal, 500 HP of headroom is more than enough. */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = VT_ACTION): Combatant {
  return makeCombatant('cleric', {
    name: 'Cleric',
    pos,
    actions: [action],
    resources: withSlots3(2),
    maxHP: 1000,
    currentHP: 500,     // injured — can absorb up to 500 HP heal
  });
}

/** Enemy with AC 14 (default); adjacent to caster if pos = (1,0,0) */
function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Vampiric Touch', metadata.name, 'Vampiric Touch');
eq('Level is 3', metadata.level, 3);
eq('School is necromancy', metadata.school, 'necromancy');
eq('Range is 5 ft (touch)', metadata.rangeFt, 5);
eq('Die count is 3', metadata.dieCount, 3);
eq('Die sides is 6', metadata.dieSides, 6);
eq('Damage type is necrotic', metadata.damageType, 'necrotic');
eq('Heal fraction is 2 (heal = floor(dealt/2))', metadata.healFraction, 2);
eq('Not concentration (v1 one-shot)', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Vampiric Touch action → null
{
  const caster = makeCombatant('cleric', { actions: [], resources: withSlots3(2) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Vampiric Touch action', shouldCast(caster, bf), null);
}
// 2b. No 3rd-level slots → null
{
  const caster = makeCombatant('cleric', { actions: [VT_ACTION], resources: withSlots3(0) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 3rd-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in touch range → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Enemy 3 squares away (chebyshev = 3, distFt = 15 > 5 ft touch)
  const enemy = makeEnemy('e1', { x: 3, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no adjacent enemy', shouldCast(caster, bf), null);
}
// 2d. Single adjacent enemy → returns that enemy (single Combatant, not array)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when adjacent enemy exists', result !== null);
  if (result) eq('Returns the single enemy (Combatant, not array)', (result as Combatant).id, 'e1');
}

// ---- 3. shouldCast target selection (single adjacent enemy) --------

console.log('\n=== 3. shouldCast target selection ===\n');

// 3a. Highest-threat adjacent enemy is chosen (maxHP tiebreak)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const lowT = makeEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeEnemy('highT', { x: 0, y: 1, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks highest-threat adjacent enemy (highT)', (result as Combatant).id, 'highT');
  }
}

// 3b. Non-adjacent high-threat enemy is NOT chosen — returns null if no adjacency
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Both enemies 2+ squares away (chebyshev ≥ 2 → distFt ≥ 10 > 5 ft touch)
  // (1,0,0) is adjacent (chebyshev=1); (2,0,0) is NOT for touch range
  const far1 = makeEnemy('far1', { x: 2, y: 0, z: 0 }, { maxHP: 300 });
  const far2 = makeEnemy('far2', { x: 0, y: 2, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, far1, far2]);
  eq('Returns null when no enemies within 5 ft touch', shouldCast(caster, bf), null);
}

// 3c. Diagonal adjacency counts (chebyshev = 1)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Diagonal enemy at (1,1,0) — chebyshev = 1, distFt = 5 → adjacent
  const diag = makeEnemy('diag', { x: 1, y: 1, z: 0 }, { maxHP: 100 });
  const bf = makeBF([caster, diag]);
  const result = shouldCast(caster, bf);
  assert('Diagonal adjacency (chebyshev=1) qualifies for touch', result !== null);
  if (result) eq('Picks the diagonal adjacent enemy', (result as Combatant).id, 'diag');
}

// ---- 4. execute — guaranteed hit (hitBonus +100) — damage + heal ---

console.log('\n=== 4. execute — guaranteed hit (damage + heal) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast returns the adjacent enemy', target !== null);
  if (target) {
    const casterHPBefore = caster.currentHP;
    const enemyHPBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 4a. Slot consumed
    eq('Slot consumed (3rd level: 2 → 1)',
      (caster.resources as any).spellSlots[3].remaining, 1);
    // 4b. Damage applied: 3d6 (range 3-18) on hit, 6d6 (range 6-36) on nat-20 crit
    const dmgDealt = enemyHPBefore - enemy.currentHP;
    assert(`Damage in 3d6 OR 6d6 range (3-36): got ${dmgDealt}`,
      dmgDealt >= 3 && dmgDealt <= 36);
    // 4c. Caster heals floor(dealt/2): range 1-18 (covers crit case floor(36/2)=18)
    const healed = caster.currentHP - casterHPBefore;
    assert(`Caster heal in 1-18 range (floor(dmg/2)): got ${healed}`,
      healed >= 1 && healed <= 18);
    // 4d. Heal = floor(dealt / 2) EXACTLY (the vampiric_touch heal formula)
    eq('Heal = floor(dealt / 2)', healed, Math.floor(dmgDealt / 2));
    // 4e. Log events — action + (attack_hit OR attack_crit) + damage + heal
    const actions = state.log.events.filter(e => e.type === 'action');
    assert('Action log emitted', actions.length >= 1);
    const hitOrCrit = state.log.events.filter(
      e => e.type === 'attack_hit' || e.type === 'attack_crit');
    eq('Exactly 1 attack_hit/attack_crit event emitted', hitOrCrit.length, 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage log emitted (on enemy)', dmgLogs.length, 1);
    if (dmgLogs.length === 1) {
      eq('Damage log targetId is enemy', dmgLogs[0].targetId, enemy.id);
    }
    const healLogs = state.log.events.filter((e: any) => e.type === 'heal');
    eq('Heal log emitted (on caster)', healLogs.length, 1);
    if (healLogs.length === 1) {
      eq('Heal log targetId is caster', healLogs[0].targetId, caster.id);
    }
  }
}

// ---- 5. execute — guaranteed miss (hitBonus -100) — no damage, no heal ----

console.log('\n=== 5. execute — guaranteed miss (no damage, no heal) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, VT_ACTION_MISS);
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const casterHPBefore = caster.currentHP;
    const enemyHPBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 5a. Slot still consumed on miss
    eq('Slot consumed even on miss (3rd level: 2 → 1)',
      (caster.resources as any).spellSlots[3].remaining, 1);
    // 5b. Damage is 0 (miss) OR 6-36 (rare nat-20 crit-hit, 5% chance)
    const dmgDealt = enemyHPBefore - enemy.currentHP;
    assert(`Damage in [0, 36] (miss or rare crit): got ${dmgDealt}`,
      dmgDealt >= 0 && dmgDealt <= 36);
    // 5c. No plain attack_hit event (nat 20 → crit path; otherwise miss)
    const hitEvents = state.log.events.filter(e => e.type === 'attack_hit');
    eq('No plain attack_hit event (miss or crit only)', hitEvents.length, 0);
    // 5d. Either attack_miss OR attack_crit was emitted (1 attack roll total)
    const missEvents = state.log.events.filter(e => e.type === 'attack_miss');
    const critEvents = state.log.events.filter(e => e.type === 'attack_crit');
    eq('Exactly 1 attack event (miss or crit)', missEvents.length + critEvents.length, 1);
    // 5e. INVARIANT: heal log count == damage log count. The heal rider
    //     NEVER fires without a corresponding damage event (on true miss:
    //     both 0; on rare crit: both 1). This verifies the heal is gated
    //     on damage dealt, not on the attack roll alone.
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    const healLogs = state.log.events.filter((e: any) => e.type === 'heal');
    eq('Damage log count == Heal log count (rider fires iff damage dealt)',
      dmgLogs.length, healLogs.length);
    // 5f. Caster HP delta: 0 on true miss, 3-18 on rare crit (heal = floor(dmg/2))
    const casterHPDelta = Math.abs(caster.currentHP - casterHPBefore);
    assert(`Caster HP delta in [0, 18] (0 on miss, 3-18 on rare crit): got ${casterHPDelta}`,
      casterHPDelta >= 0 && casterHPDelta <= 18);
  }
}

// ---- 6. rollDamage — isCrit=false returns 3d6 (range 3-18) --------

console.log('\n=== 6. rollDamage(isCrit=false) — 3d6 ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(false);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(false) min >= 3 (got ${min})`, min >= 3);
  assert(`rollDamage(false) max <= 18 (got ${max})`, max <= 18);
}

// ---- 7. rollDamage — isCrit=true returns 6d6 (range 6-36) ---------

console.log('\n=== 7. rollDamage(isCrit=true) — 6d6 ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(true);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(true) min >= 6 (got ${min})`, min >= 6);
  assert(`rollDamage(true) max <= 36 (got ${max})`, max <= 36);
}

// ---- 8. Cleanup is a no-op ------------------------------------

console.log('\n=== 8. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/vampiric_touch') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
