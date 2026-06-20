// color_spray.test.ts — Color Spray (Session 26 — CANON FIX)
// PHB p.222: L1, 15-ft cone, 6d10 HP-pool → BLINDED (canon, not unconscious),
//   no save, NO concentration. Allies in the cone ARE valid targets per canon.
//   Already-blinded / unconscious / 0-HP creatures are immune (skipped).
//   TEMP HP does NOT reduce the pool — only current HP.
import { shouldCast, execute, metadata, rollHpPool } from '../spells/color_spray';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function withSlots1(remaining = 1): PlayerResources { return { spellSlots: { 1: { max: 4, remaining } } }; }
const CS_ACTION: Action = { name: 'Color Spray', isMultiattack: false, attackType: null, reach: 5, range: { normal: 15, long: 15 }, hitBonus: null, damage: null, damageType: null, saveDC: null, saveAbility: null, isAoE: true, isControl: false, requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0, description: 'Color Spray' };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [CS_ACTION], resources: withSlots1(1) }); }
function makeEnemy(id: string, pos: any, o: Partial<Combatant> = {}) { return makeCombatant(id, { name: id, faction: 'enemy', pos, ...o }); }
function makeAlly(id: string, pos: any, o: Partial<Combatant> = {}) { return makeCombatant(id, { name: id, faction: 'party', pos, ...o }); }

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Color Spray'); eq('Level 1', metadata.level, 1); eq('Range 15 (cone)', metadata.rangeFt, 15);
eq('Die 6d10', metadata.dieCount, 6); eq('Die sides 10', metadata.dieSides, 10);
eq('Save null (HP-pool)', metadata.saveAbility, null); eq('NOT concentration', metadata.concentration, false);
// Canon-blinded flag (Session 26 fix):
assert('canon blinded flag set', metadata.colorSprayCanonBlindedV1 === true);
assert('allies valid flag set', metadata.colorSprayAlliesValidTargetsV1 === true);
assert('temp HP not counted flag set', metadata.colorSprayTempHpNotCountedV1 === true);
// Removed: the old "blinded→unconscious" deviation flag must be GONE.
assert('old blinded→unconscious flag removed', !('colorSprayBlindedV1SimplifiedToUnconscious' in metadata));

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots1(1) }); eq('null: no action', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 })])) === null, true); }
{ const c = makeCombatant('wiz', { actions: [CS_ACTION], resources: withSlots1(0) }); eq('null: no slots', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 })])) === null, true); }
{ const c = makeCaster(); eq('null: no enemy in 15ft cone', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 50, y: 0 })])) === null, true); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 })])); assert('non-null: enemy in cone', r !== null); if (r) { assert('is array', Array.isArray(r)); eq('catches e1', r[0].id, 'e1'); } }

console.log('\n=== 3. shouldCast cone shape ===\n');
{ const c = makeCaster(); const aim = makeEnemy('aim', { x: 1, y: 0 }); const inCone = makeEnemy('inCone', { x: 2, y: 0 }); const outCone = makeEnemy('outCone', { x: 0, y: 2 }); const r = shouldCast(c, makeBF([c, aim, inCone, outCone])); if (r) { const ids = r.map(x => x.id).sort(); eq('catches aim+inCone, excludes outCone', ids.join(','), 'aim,inCone'); } }

console.log('\n=== 4. execute — HP-pool covers 3 low-HP enemies (all BLINDED, NOT unconscious) ===\n');
{
  const c = makeCaster(); const e1 = makeEnemy('e1', { x: 1, y: 0 }, { currentHP: 1, maxHP: 10 }); const e2 = makeEnemy('e2', { x: 2, y: 0 }, { currentHP: 1, maxHP: 10 }); const e3 = makeEnemy('e3', { x: 3, y: 0 }, { currentHP: 1, maxHP: 10 });
  const bf = makeBF([c, e1, e2, e3]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); eq('slot consumed', (c.resources as any).spellSlots[1].remaining, 0);
    // CANON: blinded applied (not unconscious)
    assert('e1 blinded (condition)', e1.conditions.has('blinded'));
    assert('e2 blinded (condition)', e2.conditions.has('blinded'));
    assert('e3 blinded (condition)', e3.conditions.has('blinded'));
    // CANON: NOT unconscious (Batch 2 was unconscious; Session 26 fix reverts to canon)
    assert('e1 NOT unconscious (flag)', e1.isUnconscious === false);
    assert('e2 NOT unconscious (flag)', e2.isUnconscious === false);
    assert('e3 NOT unconscious (flag)', e3.isUnconscious === false);
    assert('e1 NOT unconscious (condition)', !e1.conditions.has('unconscious'));
    assert('e1 NOT incapacitated (was Batch 2 over-application)', !e1.conditions.has('incapacitated'));
    assert('NOT concentrating', !(c.concentration?.active));
  }
}

console.log('\n=== 5. execute — HP-pool cannot cover high-HP enemy (NOT blinded) ===\n');
{
  const c = makeCaster(); const e = makeEnemy('e1', { x: 1, y: 0 }, { currentHP: 1000, maxHP: 1000 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); assert('NOT blinded (1000 HP > 6d10 max 60)', !e.conditions.has('blinded')); assert('NOT unconscious', !e.isUnconscious && !e.conditions.has('unconscious')); }
}

console.log('\n=== 6. execute — mixed HP: lowest always affected, highest maybe not ===\n');
{
  // HP 2 (always covered: 2 ≤ 6 min budget) + HP 1000 (never covered: > 60 max budget).
  const c = makeCaster(); const lo = makeEnemy('lo', { x: 1, y: 0 }, { currentHP: 2, maxHP: 10 }); const hi = makeEnemy('hi', { x: 2, y: 0 }, { currentHP: 1000, maxHP: 2000 });
  const bf = makeBF([c, lo, hi]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); assert('lo (2 HP) always blinded', lo.conditions.has('blinded')); assert('hi (1000 HP) never blinded', !hi.conditions.has('blinded')); }
}

console.log('\n=== 7. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/color_spray') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log('\n=== 8. rollHpPool (6d10) — range 6–60 ===\n');
{ let mn = Infinity, mx = -Infinity; for (let i = 0; i < 1000; i++) { const r = rollHpPool(); if (r < mn) mn = r; if (r > mx) mx = r; } assert(`min ≥ 6 (${mn})`, mn >= 6); assert(`max ≤ 60 (${mx})`, mx <= 60); }

console.log('\n=== 9. CANON: allies in cone are valid HP-pool targets (low-HP ally gets blinded) ===\n');
{
  // 1 low-HP ally (1 HP) + 1 low-HP enemy (1 HP) both in cone — both blinded (canon).
  const c = makeCaster(); const ally = makeAlly('ally', { x: 1, y: 0 }, { currentHP: 1, maxHP: 10 }); const foe = makeEnemy('foe', { x: 2, y: 0 }, { currentHP: 1, maxHP: 10 });
  const bf = makeBF([c, ally, foe]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    assert('shouldCast catches BOTH ally and enemy (canon: allies valid)', t.length === 2);
    execute(c, t, st);
    assert('low-HP ally blinded (canon — friendly fire)', ally.conditions.has('blinded'));
    assert('low-HP enemy blinded', foe.conditions.has('blinded'));
  }
}

console.log('\n=== 10. CANON: high-HP ally in cone is unaffected (HP > budget) ===\n');
{
  // 1 high-HP ally (1000 HP) + 1 low-HP enemy (1 HP) both in cone — ally safe, enemy blinded.
  const c = makeCaster(); const ally = makeAlly('ally', { x: 1, y: 0 }, { currentHP: 1000, maxHP: 2000 }); const foe = makeEnemy('foe', { x: 2, y: 0 }, { currentHP: 1, maxHP: 10 });
  const bf = makeBF([c, ally, foe]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    assert('high-HP ally NOT blinded (1000 HP > 60 max budget)', !ally.conditions.has('blinded'));
    assert('low-HP enemy blinded', foe.conditions.has('blinded'));
  }
}

console.log('\n=== 11. CANON: already-blinded creature is skipped (immune — does NOT reduce pool) ===\n');
{
  // already-blinded enemy + 1 low-HP enemy — the blinded one is immune, skipped,
  // does NOT reduce the pool. The fresh enemy is blinded.
  const c = makeCaster(); const alreadyBlind = makeEnemy('blind1', { x: 1, y: 0 }, { currentHP: 1, maxHP: 10, conditions: new Set(['blinded'] as any) }); const fresh = makeEnemy('fresh', { x: 2, y: 0 }, { currentHP: 1, maxHP: 10 });
  const bf = makeBF([c, alreadyBlind, fresh]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    // shouldCast should EXCLUDE the already-blinded creature from targets
    assert('shouldCast excludes already-blinded (immune)', !t.some(x => x.id === 'blind1'));
    assert('shouldCast includes fresh enemy', t.some(x => x.id === 'fresh'));
    execute(c, t, st);
    assert('fresh enemy blinded', fresh.conditions.has('blinded'));
  }
}

console.log('\n=== 12. CANON: already-unconscious creature is skipped (immune) ===\n');
{
  // already-unconscious enemy + 1 fresh low-HP enemy.
  const c = makeCaster(); const down = makeEnemy('down', { x: 1, y: 0 }, { currentHP: 1, maxHP: 10, isUnconscious: true }); const fresh = makeEnemy('fresh', { x: 2, y: 0 }, { currentHP: 1, maxHP: 10 });
  const bf = makeBF([c, down, fresh]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    assert('shouldCast excludes already-unconscious', !t.some(x => x.id === 'down'));
    assert('shouldCast includes fresh', t.some(x => x.id === 'fresh'));
    execute(c, t, st);
    assert('fresh enemy blinded', fresh.conditions.has('blinded'));
  }
}

console.log('\n=== 13. CANON: 0-HP creature is skipped (PHB p.222 — unaffected at 0 HP) ===\n');
{
  const c = makeCaster(); const zero = makeEnemy('zero', { x: 1, y: 0 }, { currentHP: 0, maxHP: 10 }); const fresh = makeEnemy('fresh', { x: 2, y: 0 }, { currentHP: 1, maxHP: 10 });
  const bf = makeBF([c, zero, fresh]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    assert('shouldCast excludes 0-HP creature', !t.some(x => x.id === 'zero'));
    execute(c, t, st);
    assert('fresh enemy blinded', fresh.conditions.has('blinded'));
    assert('0-HP creature NOT blinded (already immune)', !zero.conditions.has('blinded'));
  }
}

console.log('\n=== 14. CANON: TEMP HP does NOT count toward pool subtraction ===\n');
{
  // Creature with 5 current HP + 50 temp HP — pool should subtract only 5 (the
  // real current HP), leaving plenty of budget for other targets.
  // Setup: 1 enemy (5 currentHP, 50 tempHP) + 1 enemy (5 currentHP, 0 tempHP).
  // Both should be blinded if the pool behaves canonically (5+5=10 ≤ min budget 6? no — 10 > 6).
  // Use 3 HP + 3 HP = 6 total (always covered by min budget 6).
  const c = makeCaster();
  const withTemp = makeEnemy('wtmp', { x: 1, y: 0 }, { currentHP: 3, maxHP: 100, tempHP: 50 });
  const noTemp = makeEnemy('notmp', { x: 2, y: 0 }, { currentHP: 3, maxHP: 100, tempHP: 0 });
  const bf = makeBF([c, withTemp, noTemp]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    // Both consume only 3 each from the pool (= 6 total, within min budget 6).
    // If temp HP were incorrectly counted (3 + 50 = 53), the second creature
    // would not be covered by a budget ≤ ~7. So both being blinded confirms
    // temp HP was ignored.
    assert('creature WITH temp HP blinded (3 currentHP only counted)', withTemp.conditions.has('blinded'));
    assert('creature WITHOUT temp HP blinded', noTemp.conditions.has('blinded'));
    // Sanity: temp HP value should be UNCHANGED (the spell does not touch temp HP)
    eq('temp HP unchanged on wtmp', withTemp.tempHP, 50);
  }
}

console.log('\n=== 15. CANON: temporary-max-HP buffs (Aid-style) DO count (real current HP) ===\n');
{
  // Aid raises both maxHP and currentHP by 5. Such a creature's currentHP is
  // valid HP for Color Spray target selection (per the user's canon note).
  // Setup: enemy with currentHP=8 maxHP=8 (simulating Aid-boosted) + 1 fresh 1-HP enemy.
  // Pool: 6d10 (min 6). Sort: 1 HP first, then 8 HP. 1 + 8 = 9 > 6 min budget —
  // so the second creature might or might not be blinded depending on the roll.
  // Test with budget guaranteed ≥ 9 by forcing HP values that always fit min budget.
  // Use 1 HP + 4 HP (= 5 total ≤ 6 min budget). Both blinded.
  const c = makeCaster();
  const aidBoosted = makeEnemy('aid', { x: 1, y: 0 }, { currentHP: 4, maxHP: 4 /* was 0, +4 from Aid */ });
  const fresh = makeEnemy('fresh', { x: 2, y: 0 }, { currentHP: 1, maxHP: 10 });
  const bf = makeBF([c, aidBoosted, fresh]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    assert('Aid-boosted creature blinded (current HP counts, even though maxHP was raised)', aidBoosted.conditions.has('blinded'));
    assert('fresh enemy blinded', fresh.conditions.has('blinded'));
  }
}

console.log('\n=== 16. CANON: weakest affected first even with mixed factions ===\n');
{
  // 1 low-HP ally (1 HP) + 1 higher-HP enemy (5 HP). Pool may be tight.
  // The 1 HP ally is sorted first and (if budget allows) is blinded BEFORE the enemy.
  // With min budget 6: 1 + 5 = 6 — both should be blinded.
  const c = makeCaster(); const ally = makeAlly('ally', { x: 1, y: 0 }, { currentHP: 1, maxHP: 10 }); const foe = makeEnemy('foe', { x: 2, y: 0 }, { currentHP: 5, maxHP: 10 });
  const bf = makeBF([c, ally, foe]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    // With min budget 6, both should be blinded (1 + 5 = 6).
    // This confirms weakest-first ordering across factions.
    assert('1 HP ally blinded (sorted first)', ally.conditions.has('blinded'));
    assert('5 HP enemy blinded (sorted second, covered by remaining budget)', foe.conditions.has('blinded'));
  }
}

console.log('\n=== 17. Caster is never caught in their own cone ===\n');
{
  // Caster at (0,0) aims at enemy at (1,0) — cone points east. Caster must NOT
  // be in the target list.
  const c = makeCaster({ x: 5, y: 5 }); const e = makeEnemy('e1', { x: 6, y: 5 });
  const bf = makeBF([c, e]); const t = shouldCast(c, bf);
  if (t) { assert('caster NOT in own target list', !t.some(x => x.id === 'wiz')); }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
