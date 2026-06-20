// bane.test.ts — Bane (Session 27 / Batch 3)
// PHB p.216: L1, 30 ft, CHA save or -1d4 (bane_die) to attacks/saves, concentration (up to 3 enemies).
import { shouldCast, execute, metadata } from '../spells/bane';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function withSlots1(remaining = 1): PlayerResources { return { spellSlots: { 1: { max: 4, remaining } } }; }
const BANE_ACTION: Action = { name: 'Bane', isMultiattack: false, attackType: 'save', reach: 5, range: { normal: 30, long: 30 }, hitBonus: null, damage: null, damageType: null, saveDC: 25, saveAbility: 'cha', isAoE: false, isControl: true, requiresConcentration: true, slotLevel: 1, costType: 'action', legendaryCost: 0, description: 'Bane' };
const BANE_ACTION_LOW: Action = { ...BANE_ACTION, saveDC: 5 };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = BANE_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots1(1) }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', cha: 1, pos, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', cha: 30, pos, ...o });

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Bane'); eq('Level 1', metadata.level, 1); eq('Range 30', metadata.rangeFt, 30); eq('Concentration', metadata.concentration, true); eq('maxTargets 3', metadata.maxTargets, 3); assert('canon flag', metadata.baneCanonV1Implemented === true);

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots1(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [BANE_ACTION], resources: withSlots1(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); c.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any; eq('null: already concentrating', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: out of range', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null', r !== null); if (r) eq('catches e1', (r as Combatant[])[0].id, 'e1'); }

console.log('\n=== 3. shouldCast caps at 3 targets ===\n');
{ const c = makeCaster(); const es = [weak('e1', { x: 1, y: 0 }, { maxHP: 10 }), weak('e2', { x: 2, y: 0 }, { maxHP: 20 }), weak('e3', { x: 3, y: 0 }, { maxHP: 30 }), weak('e4', { x: 4, y: 0 }, { maxHP: 40 })]; const r = shouldCast(c, makeBF([c, ...es])); assert('non-null', r !== null); if (r) eq('caps at 3', (r as Combatant[]).length, 3); }

console.log('\n=== 4. execute — guaranteed fail (bane_die applied) ===\n');
{ const c = makeCaster(); const e = weak('e1', { x: 1, y: 0 }); const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t, st); eq('slot consumed', (c.resources as any).spellSlots[1].remaining, 0); assert('concentration started', c.concentration?.active === true); assert('bane_die effect on target', e.activeEffects.some(x => x.effectType === 'bane_die' && x.payload.dieSides === 4 && x.sourceIsConcentration === true)); } }

console.log('\n=== 5. execute — guaranteed success (no bane_die) ===\n');
{ const c = makeCaster({ x: 0, y: 0, z: 0 }, BANE_ACTION_LOW); const e = strong('e1', { x: 1, y: 0 }); const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t, st); assert('NO bane_die', !e.activeEffects.some(x => x.effectType === 'bane_die')); assert('still concentrating', c.concentration?.active === true); const ss = st.log.events.filter((x: any) => x.type === 'save_success'); assert('save_success log', ss.length === 1); } }

console.log('\n=== 6. already-baned enemy skipped by shouldCast ===\n');
{ const c = makeCaster(); const e = weak('e1', { x: 1, y: 0 }); e.activeEffects.push({ id: 'eff_1', casterId: c.id, spellName: 'Bane', effectType: 'bane_die', payload: { dieSides: 4 }, sourceIsConcentration: true } as any); const r = shouldCast(c, makeBF([c, e])); eq('null: already baned by this caster', r, null); }

console.log('\n=== 7. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/bane') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
