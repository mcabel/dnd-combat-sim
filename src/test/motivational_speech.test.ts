// motivational_speech.test.ts — Motivational Speech (Session 27 / Batch 3)
// AI p.77: L3, 60 ft, up to 3 allies +1d4 (bless_die) + 5 temp HP, concentration.
import { shouldCast, execute, metadata } from '../spells/motivational_speech';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function withSlots3(remaining = 1): PlayerResources { return { spellSlots: { 3: { max: 1, remaining } } }; }
const MS_ACTION: Action = { name: 'Motivational Speech', isMultiattack: false, attackType: null, reach: 5, range: { normal: 60, long: 60 }, hitBonus: null, damage: null, damageType: null, saveDC: null, saveAbility: null, isAoE: false, isControl: false, requiresConcentration: true, slotLevel: 3, costType: 'action', legendaryCost: 0, description: 'Motivational Speech' };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, exhaustionLevel: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = MS_ACTION) { return makeCombatant('bard', { name: 'Caster', pos, actions: [a], resources: withSlots3(1) }); }
const ally = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'party', pos, ...o });

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Motivational Speech'); eq('Level 3', metadata.level, 3); eq('Range 60', metadata.rangeFt, 60); eq('Concentration', metadata.concentration, true); eq('maxTargets 3', metadata.maxTargets, 3); eq('tempHP 5', metadata.tempHP, 5); assert('canon flag', metadata.motivationalSpeechCanonV1Implemented === true);

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('bard', { actions: [], resources: withSlots3(1) }); eq('null: no action', shouldCast(c, makeBF([c, ally('a1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('bard', { actions: [MS_ACTION], resources: withSlots3(0) }); eq('null: no slots', shouldCast(c, makeBF([c, ally('a1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); c.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any; eq('null: already concentrating', shouldCast(c, makeBF([c, ally('a1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, ally('a1', { x: 50, y: 0 })])); assert('non-null (self always in range)', r !== null); if (r) eq('only self (ally out of range)', (r as Combatant[]).length, 1); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, ally('a1', { x: 1, y: 0 })])); assert('non-null (self + ally)', r !== null); if (r) { const arr = r as Combatant[]; assert('includes self', arr.some(x => x.id === 'bard')); assert('includes ally', arr.some(x => x.id === 'a1')); } }

console.log('\n=== 3. shouldCast caps at 3 + self-first ===\n');
{ const c = makeCaster(); const allies = [ally('a1', { x: 1, y: 0 }), ally('a2', { x: 2, y: 0 }), ally('a3', { x: 3, y: 0 }), ally('a4', { x: 4, y: 0 })]; const r = shouldCast(c, makeBF([c, ...allies])); assert('non-null', r !== null); if (r) { const arr = r as Combatant[]; eq('caps at 3', arr.length, 3); eq('self first', arr[0].id, 'bard'); } }

console.log('\n=== 4. execute — bless_die + temp HP applied ===\n');
{ const c = makeCaster(); const a = ally('a1', { x: 1, y: 0 }); const bf = makeBF([c, a]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t, st); eq('slot consumed', (c.resources as any).spellSlots[3].remaining, 0); assert('concentration started', c.concentration?.active === true); assert('bless_die on ally', a.activeEffects.some(x => x.effectType === 'bless_die' && x.payload.dieSides === 4 && x.sourceIsConcentration === true)); eq('tempHP set to 5', a.tempHP, 5); } }

console.log('\n=== 5. execute — temp HP does not stack (keeps higher) ===\n');
{ const c = makeCaster(); const a = ally('a1', { x: 1, y: 0 }, { tempHP: 10 }); const bf = makeBF([c, a]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t, st); eq('tempHP stays 10 (higher)', a.tempHP, 10); } }

console.log('\n=== 6. already-buffed ally skipped ===\n');
{ const c = makeCaster(); const a = ally('a1', { x: 1, y: 0 }); a.activeEffects.push({ id: 'eff_1', casterId: c.id, spellName: 'Motivational Speech', effectType: 'bless_die', payload: { dieSides: 4 }, sourceIsConcentration: true } as any); const r = shouldCast(c, makeBF([c, a])); if (r) eq('skips already-buffed ally (only self)', (r as Combatant[]).length, 1); }

console.log('\n=== 7. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/motivational_speech') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
