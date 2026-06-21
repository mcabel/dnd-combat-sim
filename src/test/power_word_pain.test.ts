// power_word_pain.test.ts — Power Word Pain (Session 25 / Batch 2)
// XGE p.163: L7, 60 ft, NO save/attack. HP ≤ 60 → 4d8 psychic + restrained.
import { shouldCast, execute, metadata, rollDamage } from '../spells/power_word_pain';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

function withSlots7(remaining = 1): PlayerResources { return { spellSlots: { 7: { max: 1, remaining } } }; }
const PWP_ACTION: Action = {
  name: 'Power Word Pain', isMultiattack: false, attackType: null, reach: 5,
  range: { normal: 60, long: 60 }, hitBonus: null, damage: null, damageType: null,
  saveDC: null, saveAbility: null, isAoE: false, isControl: true,
  requiresConcentration: false, slotLevel: 7, costType: 'action', legendaryCost: 0,
  description: 'Power Word Pain',
};
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party', maxHP: 200, currentHP: 200, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: 1,
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any,
    concentration: null, deathSaves: null, resources: null, tempHP: 0,
    exhaustionLevel: 0,
    mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false,
    hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides,
    pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) },
  };
}
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map((x: any) => [x.id, x])), initiativeOrder: c.map((x: any) => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [PWP_ACTION], resources: withSlots7(1) }); }
function makeEnemy(id: string, pos: any, o: Partial<Combatant> = {}) { return makeCombatant(id, { name: id, faction: 'enemy', pos, ...o }); }

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Power Word Pain');
eq('Level 7', metadata.level, 7);
eq('Range 60', metadata.rangeFt, 60);
eq('HP threshold 60', metadata.hpThreshold, 60);
eq('Die 4d8', metadata.dieCount, 4); eq('Die sides 8', metadata.dieSides, 8);
eq('Damage psychic', metadata.damageType, 'psychic');
eq('Not concentration', metadata.concentration, false);
eq('Save null', metadata.saveAbility, null);

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots7(1) }); eq('null: no action', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 }, { currentHP: 50 })])), null); }
{ const c = makeCombatant('wiz', { actions: [PWP_ACTION], resources: withSlots7(0) }); eq('null: no slots', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 }, { currentHP: 50 })])), null); }
{ const c = makeCaster(); eq('null: enemy HP > 60', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 }, { currentHP: 200 })])), null); }
{ const c = makeCaster(); eq('null: out of range', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 50, y: 0 }, { currentHP: 50 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 }, { currentHP: 50 })])); assert('non-null: enemy ≤60 in range', r !== null); if (r) eq('enemy id', (r as Combatant).id, 'e1'); }

console.log('\n=== 3. shouldCast target selection ===\n');
{ const c = makeCaster(); const lo = makeEnemy('lo', { x: 1, y: 0 }, { currentHP: 30, maxHP: 30 }); const hi = makeEnemy('hi', { x: 5, y: 0 }, { currentHP: 55, maxHP: 55 }); const r = shouldCast(c, makeBF([c, lo, hi])); if (r) eq('picks highest-cur-HP ≤60', (r as Combatant).id, 'hi'); }
{ const c = makeCaster(); const res = makeEnemy('res', { x: 1, y: 0 }, { currentHP: 50 }); res.conditions.add('restrained' as Condition); const fr = makeEnemy('fr', { x: 5, y: 0 }, { currentHP: 40 }); const r = shouldCast(c, makeBF([c, res, fr])); if (r) eq('skips restrained', (r as Combatant).id, 'fr'); }

console.log('\n=== 4. execute — HP ≤ 60 → damage + restrained ===\n');
{
  const c = makeCaster(); const e = makeEnemy('e1', { x: 1, y: 0 }, { currentHP: 50, maxHP: 200 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { const hp = e.currentHP; execute(c, t as Combatant, st); eq('slot consumed', (c.resources as any).spellSlots[7].remaining, 0); const d = hp - e.currentHP; assert(`4d8 damage (4-32): ${d}`, d >= 4 && d <= 32); assert('restrained applied', e.conditions.has('restrained')); assert('NOT concentrating', !(c.concentration?.active)); }
}

console.log('\n=== 5. execute — HP > 60 → no effect ===\n');
{
  const c = makeCaster(); const e = makeEnemy('e1', { x: 1, y: 0 }, { currentHP: 50, maxHP: 300 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { e.currentHP = 100; execute(c, t as Combatant, st); eq('slot consumed', (c.resources as any).spellSlots[7].remaining, 0); assert('NOT restrained', !e.conditions.has('restrained')); const ne = st.log.events.filter((x: any) => x.description.includes('NO EFFECT')); assert('NO EFFECT log', ne.length === 1); }
}

console.log('\n=== 6. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/power_word_pain') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log('\n=== 7. rollDamage ===\n');
{ let mn = Infinity, mx = -Infinity; for (let i = 0; i < 1000; i++) { const r = rollDamage(); if (r < mn) mn = r; if (r > mx) mx = r; } assert(`min ≥ 4 (${mn})`, mn >= 4); assert(`max ≤ 32 (${mx})`, mx <= 32); }

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
