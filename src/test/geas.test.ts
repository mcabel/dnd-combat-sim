// geas.test.ts — Geas (Session 25 / Batch 2)
// PHB p.245: L5, 60 ft, WIS save or 5d10 psychic + charmed, NO concentration (30 days, one-shot dmg).
import { shouldCast, execute, metadata, rollDamage } from '../spells/geas';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function withSlots5(remaining = 1): PlayerResources { return { spellSlots: { 5: { max: 1, remaining } } }; }
const GEAS_ACTION: Action = { name: 'Geas', isMultiattack: false, attackType: 'save', reach: 5, range: { normal: 60, long: 60 }, hitBonus: null, damage: null, damageType: null, saveDC: 25, saveAbility: 'wis', isAoE: false, isControl: true, requiresConcentration: false, slotLevel: 5, costType: 'action', legendaryCost: 0, description: 'Geas' };
const GEAS_ACTION_LOW: Action = { ...GEAS_ACTION, saveDC: 5 };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, exhaustionLevel: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = GEAS_ACTION) { return makeCombatant('clr', { name: 'Caster', pos, actions: [a], resources: withSlots5(1) }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', wis: 1, pos, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', wis: 30, pos, ...o });

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Geas'); eq('Level 5', metadata.level, 5); eq('Range 60', metadata.rangeFt, 60);
eq('Die 5d10', metadata.dieCount, 5); eq('Damage psychic', metadata.damageType, 'psychic');
eq('Save wis', metadata.saveAbility, 'wis'); eq('NOT concentration', metadata.concentration, false);
console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('clr', { actions: [], resources: withSlots5(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('clr', { actions: [GEAS_ACTION], resources: withSlots5(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: out of range', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null', r !== null); if (r) eq('enemy id', (r as Combatant).id, 'e1'); }
console.log('\n=== 3. shouldCast target selection ===\n');
{ const c = makeCaster(); const lo = weak('lo', { x: 1, y: 0 }, { maxHP: 30 }); const hi = weak('hi', { x: 5, y: 0 }, { maxHP: 300 }); const r = shouldCast(c, makeBF([c, lo, hi])); if (r) eq('picks highest-threat', (r as Combatant).id, 'hi'); }
{ const c = makeCaster(); const ch = weak('ch', { x: 1, y: 0 }, { maxHP: 300 }); ch.conditions.add('charmed' as Condition); const fr = weak('fr', { x: 5, y: 0 }, { maxHP: 50 }); const r = shouldCast(c, makeBF([c, ch, fr])); if (r) eq('skips charmed', (r as Combatant).id, 'fr'); }
console.log('\n=== 4. execute — guaranteed fail (5d10 + charmed) ===\n');
{ const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 }, { maxHP: 1000, currentHP: 1000 }); const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { const hp = e.currentHP; execute(c, t as Combatant, st); eq('slot consumed', (c.resources as any).spellSlots[5].remaining, 0); const d = hp - e.currentHP; assert(`5d10 damage (5-50): ${d}`, d >= 5 && d <= 50); assert('charmed applied', e.conditions.has('charmed')); assert('NOT concentrating', !(c.concentration?.active)); } }
console.log('\n=== 5. execute — guaranteed success (no damage, no charm) ===\n');
{ const c = makeCaster({ x: 0, y: 0, z: 0 }, GEAS_ACTION_LOW); const e = strong('e1', { x: 5, y: 0 }, { maxHP: 1000, currentHP: 1000 }); const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { const hp = e.currentHP; execute(c, t as Combatant, st); eq('NO damage (save negates)', e.currentHP, hp); assert('NOT charmed', !e.conditions.has('charmed')); } }
console.log('\n=== 6. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/geas') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }
console.log('\n=== 7. rollDamage ===\n');
{ let mn = Infinity, mx = -Infinity; for (let i = 0; i < 1000; i++) { const r = rollDamage(); if (r < mn) mn = r; if (r > mx) mx = r; } assert(`min ≥ 5 (${mn})`, mn >= 5); assert(`max ≤ 50 (${mx})`, mx <= 50); }
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
