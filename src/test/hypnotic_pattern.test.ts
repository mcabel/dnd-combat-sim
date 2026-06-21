// hypnotic_pattern.test.ts — Hypnotic Pattern (Session 25 / Batch 2)
// PHB p.252: L3, 120 ft, 10-ft radius AoE, WIS save or charmed+incapacitated (DUAL), concentration.
import { shouldCast, execute, metadata } from '../spells/hypnotic_pattern';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function withSlots3(remaining = 1): PlayerResources { return { spellSlots: { 3: { max: 1, remaining } } }; }
const HP_ACTION: Action = { name: 'Hypnotic Pattern', isMultiattack: false, attackType: 'save', reach: 5, range: { normal: 120, long: 120 }, hitBonus: null, damage: null, damageType: null, saveDC: 25, saveAbility: 'wis', isAoE: true, isControl: true, requiresConcentration: true, slotLevel: 3, costType: 'action', legendaryCost: 0, description: 'Hypnotic Pattern' };
const HP_ACTION_LOW: Action = { ...HP_ACTION, saveDC: 5 };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, exhaustionLevel: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 120, height: 120, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = HP_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots3(1) }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', wis: 1, pos, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', wis: 30, pos, ...o });

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Hypnotic Pattern'); eq('Level 3', metadata.level, 3); eq('Range 120', metadata.rangeFt, 120);
eq('AoE 10', metadata.aoeRadiusFt, 10); eq('Save wis', metadata.saveAbility, 'wis'); eq('Concentration', metadata.concentration, true);
console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots3(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [HP_ACTION], resources: withSlots3(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); c.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any; eq('null: already concentrating', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: out of range', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null', r !== null); if (r) { assert('is array', Array.isArray(r)); eq('catches e1', r[0].id, 'e1'); } }
console.log('\n=== 3. shouldCast AoE shape (10-ft radius) ===\n');
{ const c = makeCaster(); const center = weak('center', { x: 5, y: 0 }, { maxHP: 300 }); const near = weak('near', { x: 6, y: 0 }, { maxHP: 50 }); const far = weak('far', { x: 9, y: 0 }, { maxHP: 200 }); const r = shouldCast(c, makeBF([c, center, near, far])); if (r) { const ids = r.map(x => x.id).sort(); eq('catches center+near (≤10ft), excludes far (20ft)', ids.join(','), 'center,near'); } }
console.log('\n=== 4. execute — guaranteed fail (charmed AND incapacitated) ===\n');
{ const c = makeCaster(); const e1 = weak('e1', { x: 5, y: 0 }); const e2 = weak('e2', { x: 6, y: 0 }); const bf = makeBF([c, e1, e2]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t, st); eq('slot consumed', (c.resources as any).spellSlots[3].remaining, 0); assert('concentration started', c.concentration?.active === true); assert('e1 charmed (DUAL)', e1.conditions.has('charmed')); assert('e1 incapacitated (DUAL)', e1.conditions.has('incapacitated')); assert('e2 charmed (DUAL)', e2.conditions.has('charmed')); assert('e2 incapacitated (DUAL)', e2.conditions.has('incapacitated')); } }
console.log('\n=== 5. execute — guaranteed success (no conditions) ===\n');
{ const c = makeCaster({ x: 0, y: 0, z: 0 }, HP_ACTION_LOW); const e = strong('e1', { x: 5, y: 0 }); const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t, st); assert('NOT charmed', !e.conditions.has('charmed')); assert('NOT incapacitated', !e.conditions.has('incapacitated')); } }
console.log('\n=== 6. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/hypnotic_pattern') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
