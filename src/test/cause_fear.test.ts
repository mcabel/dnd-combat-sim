// cause_fear.test.ts — Cause Fear (Session 25 / Batch 2)
// XGE p.151: L1, 60 ft, WIS save or frightened, NO concentration.
import { shouldCast, execute, metadata } from '../spells/cause_fear';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function withSlots1(remaining = 1): PlayerResources { return { spellSlots: { 1: { max: 4, remaining } } }; }
const CF_ACTION: Action = { name: 'Cause Fear', isMultiattack: false, attackType: 'save', reach: 5, range: { normal: 60, long: 60 }, hitBonus: null, damage: null, damageType: null, saveDC: 25, saveAbility: 'wis', isAoE: false, isControl: true, requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0, description: 'Cause Fear' };
const CF_ACTION_LOW: Action = { ...CF_ACTION, saveDC: 5 };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, exhaustionLevel: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = CF_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots1(1) }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', wis: 1, pos, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', wis: 30, pos, ...o });

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Cause Fear'); eq('Level 1', metadata.level, 1); eq('Range 60', metadata.rangeFt, 60); eq('Save wis', metadata.saveAbility, 'wis'); eq('NOT concentration', metadata.concentration, false);
console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots1(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [CF_ACTION], resources: withSlots1(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: out of range', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null', r !== null); if (r) eq('enemy id', (r as Combatant).id, 'e1'); }
console.log('\n=== 3. shouldCast target selection ===\n');
{ const c = makeCaster(); const lo = weak('lo', { x: 1, y: 0 }, { maxHP: 30 }); const hi = weak('hi', { x: 5, y: 0 }, { maxHP: 300 }); const r = shouldCast(c, makeBF([c, lo, hi])); if (r) eq('picks highest-threat', (r as Combatant).id, 'hi'); }
{ const c = makeCaster(); const fr = weak('fr', { x: 1, y: 0 }, { maxHP: 300 }); fr.conditions.add('frightened' as Condition); const fresh = weak('fresh', { x: 5, y: 0 }, { maxHP: 50 }); const r = shouldCast(c, makeBF([c, fr, fresh])); if (r) eq('skips frightened', (r as Combatant).id, 'fresh'); }
console.log('\n=== 4. execute — guaranteed fail (frightened) ===\n');
{ const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 }); const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t as Combatant, st); eq('slot consumed', (c.resources as any).spellSlots[1].remaining, 0); assert('NOT concentrating', !(c.concentration?.active)); assert('frightened applied', e.conditions.has('frightened')); } }
console.log('\n=== 5. execute — guaranteed success ===\n');
{ const c = makeCaster({ x: 0, y: 0, z: 0 }, CF_ACTION_LOW); const e = strong('e1', { x: 5, y: 0 }); const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t as Combatant, st); assert('NOT frightened', !e.conditions.has('frightened')); const ss = st.log.events.filter((x: any) => x.type === 'save_success'); assert('save_success log', ss.length === 1); } }
console.log('\n=== 6. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/cause_fear') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
