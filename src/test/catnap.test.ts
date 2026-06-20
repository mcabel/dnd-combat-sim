// catnap.test.ts — Catnap (Session 25 / Batch 2)
// XGE p.151: L3, 30 ft, up to 3 WILLING ALLIES fall asleep (no save), NO concentration.
import { shouldCast, execute, metadata } from '../spells/catnap';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function withSlots3(remaining = 1): PlayerResources { return { spellSlots: { 3: { max: 1, remaining } } }; }
const CAT_ACTION: Action = { name: 'Catnap', isMultiattack: false, attackType: null, reach: 5, range: { normal: 30, long: 30 }, hitBonus: null, damage: null, damageType: null, saveDC: null, saveAbility: null, isAoE: true, isControl: false, requiresConcentration: false, slotLevel: 3, costType: 'action', legendaryCost: 0, description: 'Catnap' };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [CAT_ACTION], resources: withSlots3(1) }); }
// Allies share the caster's faction ('party'); enemies are 'enemy'.
const ally = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'party', pos, ...o });
const enemy = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', pos, ...o });

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Catnap'); eq('Level 3', metadata.level, 3); eq('Range 30', metadata.rangeFt, 30);
eq('Max targets 3', metadata.maxTargets, 3); eq('Save null (willing)', metadata.saveAbility, null); eq('NOT concentration', metadata.concentration, false);
console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots3(1) }); eq('null: no action', shouldCast(c, makeBF([c, ally('a1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [CAT_ACTION], resources: withSlots3(0) }); eq('null: no slots', shouldCast(c, makeBF([c, ally('a1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: no allies in range', shouldCast(c, makeBF([c, enemy('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: ally out of range', shouldCast(c, makeBF([c, ally('a1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, ally('a1', { x: 1, y: 0 })])); assert('non-null: ally in range', r !== null); if (r) { assert('is array', Array.isArray(r)); eq('catches a1', r[0].id, 'a1'); } }
console.log('\n=== 3. shouldCast targets ALLIES (not enemies) ===\n');
{ const c = makeCaster(); const a = ally('a1', { x: 1, y: 0 }); const e = enemy('e1', { x: 2, y: 0 }); const r = shouldCast(c, makeBF([c, a, e])); if (r) { eq('only the ally (not the enemy)', r.length, 1); eq('ally id', r[0].id, 'a1'); } }
console.log('\n=== 4. shouldCast 3-target cap ===\n');
{
  const c = makeCaster();
  const allies: Combatant[] = [];
  for (let i = 0; i < 5; i++) allies.push(ally(`a${i}`, { x: 1 + (i % 3), y: Math.floor(i / 3), z: 0 }));
  const r = shouldCast(c, makeBF([c, ...allies]));
  if (r) eq('caps at 3 targets (5 allies)', r.length, 3);
}
console.log('\n=== 5. execute — allies fall asleep (no save) ===\n');
{ const c = makeCaster(); const a1 = ally('a1', { x: 1, y: 0 }); const a2 = ally('a2', { x: 2, y: 0 }); const bf = makeBF([c, a1, a2]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t, st); eq('slot consumed', (c.resources as any).spellSlots[3].remaining, 0); assert('NOT concentrating', !(c.concentration?.active)); assert('a1 sleeping', a1.conditions.has('sleeping')); assert('a2 sleeping', a2.conditions.has('sleeping')); const saveFails = st.log.events.filter((x: any) => x.type === 'save_fail'); assert('NO save_fail logs (willing, no save)', saveFails.length === 0); } }
console.log('\n=== 6. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/catnap') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
