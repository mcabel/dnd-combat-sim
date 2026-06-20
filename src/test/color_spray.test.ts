// color_spray.test.ts — Color Spray (Session 25 / Batch 2)
// PHB p.222: L1, 15-ft cone, 6d10 HP-pool → unconscious (no save), NO concentration.
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

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Color Spray'); eq('Level 1', metadata.level, 1); eq('Range 15 (cone)', metadata.rangeFt, 15);
eq('Die 6d10', metadata.dieCount, 6); eq('Die sides 10', metadata.dieSides, 10);
eq('Save null (HP-pool)', metadata.saveAbility, null); eq('NOT concentration', metadata.concentration, false);
console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots1(1) }); eq('null: no action', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [CS_ACTION], resources: withSlots1(0) }); eq('null: no slots', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: no enemy in 15ft cone', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 })])); assert('non-null: enemy in cone', r !== null); if (r) { assert('is array', Array.isArray(r)); eq('catches e1', r[0].id, 'e1'); } }
console.log('\n=== 3. shouldCast cone shape ===\n');
{ const c = makeCaster(); const aim = makeEnemy('aim', { x: 1, y: 0 }); const inCone = makeEnemy('inCone', { x: 2, y: 0 }); const outCone = makeEnemy('outCone', { x: 0, y: 2 }); const r = shouldCast(c, makeBF([c, aim, inCone, outCone])); if (r) { const ids = r.map(x => x.id).sort(); eq('catches aim+inCone, excludes outCone', ids.join(','), 'aim,inCone'); } }
console.log('\n=== 4. execute — HP-pool covers 3 low-HP enemies (all unconscious) ===\n');
{
  const c = makeCaster(); const e1 = makeEnemy('e1', { x: 1, y: 0 }, { currentHP: 1, maxHP: 10 }); const e2 = makeEnemy('e2', { x: 2, y: 0 }, { currentHP: 1, maxHP: 10 }); const e3 = makeEnemy('e3', { x: 3, y: 0 }, { currentHP: 1, maxHP: 10 });
  const bf = makeBF([c, e1, e2, e3]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); eq('slot consumed', (c.resources as any).spellSlots[1].remaining, 0); assert('e1 unconscious (flag)', e1.isUnconscious === true); assert('e2 unconscious (flag)', e2.isUnconscious === true); assert('e3 unconscious (flag)', e3.isUnconscious === true); assert('e1 unconscious (condition)', e1.conditions.has('unconscious')); assert('NOT concentrating', !(c.concentration?.active)); }
}
console.log('\n=== 5. execute — HP-pool cannot cover high-HP enemy (not unconscious) ===\n');
{
  const c = makeCaster(); const e = makeEnemy('e1', { x: 1, y: 0 }, { currentHP: 1000, maxHP: 1000 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); assert('NOT unconscious (1000 HP > 6d10 max 60)', !e.isUnconscious && !e.conditions.has('unconscious')); }
}
console.log('\n=== 6. execute — mixed HP: lowest always affected, highest maybe not ===\n');
{
  // HP 2 (always covered: 2 ≤ 6 min budget) + HP 1000 (never covered: > 60 max budget).
  const c = makeCaster(); const lo = makeEnemy('lo', { x: 1, y: 0 }, { currentHP: 2, maxHP: 10 }); const hi = makeEnemy('hi', { x: 2, y: 0 }, { currentHP: 1000, maxHP: 2000 });
  const bf = makeBF([c, lo, hi]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); assert('lo (2 HP) always unconscious', lo.isUnconscious === true); assert('hi (1000 HP) never unconscious', !hi.isUnconscious); }
}
console.log('\n=== 7. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/color_spray') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }
console.log('\n=== 8. rollHpPool (6d10) ===\n');
{ let mn = Infinity, mx = -Infinity; for (let i = 0; i < 1000; i++) { const r = rollHpPool(); if (r < mn) mn = r; if (r > mx) mx = r; } assert(`min ≥ 6 (${mn})`, mn >= 6); assert(`max ≤ 60 (${mx})`, mx <= 60); }
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
