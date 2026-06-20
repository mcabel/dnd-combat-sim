// contagion.test.ts — Contagion (Session 25 / Batch 2)
// PHB p.227: L5, touch (5 ft), melee spell attack + poisoned on hit, NO concentration, no damage.
import { shouldCast, execute, metadata } from '../spells/contagion';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

function withSlots5(remaining = 1): PlayerResources { return { spellSlots: { 5: { max: 1, remaining } } }; }
// High hitBonus guarantees a hit vs low AC; the attack-miss path can't be made deterministic (nat-20 auto-hit).
const CONT_ACTION: Action = { name: 'Contagion', isMultiattack: false, attackType: null, reach: 5, range: { normal: 5, long: 5 }, hitBonus: 20, damage: null, damageType: null, saveDC: null, saveAbility: null, isAoE: false, isControl: false, requiresConcentration: false, slotLevel: 5, costType: 'action', legendaryCost: 0, description: 'Contagion' };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }) { return makeCombatant('clr', { name: 'Caster', pos, actions: [CONT_ACTION], resources: withSlots5(1) }); }
function makeEnemy(id: string, pos: any, o: Partial<Combatant> = {}) { return makeCombatant(id, { name: id, faction: 'enemy', pos, ...o }); }

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Contagion'); eq('Level 5', metadata.level, 5);
eq('Range 5 (touch)', metadata.rangeFt, 5); eq('Save null (melee attack)', metadata.saveAbility, null);
eq('NOT concentration', metadata.concentration, false);

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('clr', { actions: [], resources: withSlots5(1) }); eq('null: no action', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('clr', { actions: [CONT_ACTION], resources: withSlots5(0) }); eq('null: no slots', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: no adjacent enemy', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 5, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 })])); assert('non-null: adjacent enemy', r !== null); if (r) eq('enemy id', (r as Combatant).id, 'e1'); }

console.log('\n=== 3. shouldCast target selection ===\n');
{ const c = makeCaster(); const lo = makeEnemy('lo', { x: 1, y: 0 }, { maxHP: 30 }); const hi = makeEnemy('hi', { x: 0, y: 1 }, { maxHP: 300 }); const r = shouldCast(c, makeBF([c, lo, hi])); if (r) eq('picks highest-threat adjacent', (r as Combatant).id, 'hi'); }
{ const c = makeCaster(); const ps = makeEnemy('ps', { x: 1, y: 0 }, { maxHP: 300 }); ps.conditions.add('poisoned' as Condition); const fr = makeEnemy('fr', { x: 0, y: 1 }, { maxHP: 50 }); const r = shouldCast(c, makeBF([c, ps, fr])); if (r) eq('skips poisoned', (r as Combatant).id, 'fr'); }

console.log('\n=== 4. execute — guaranteed hit (poisoned, no damage) ===\n');
{
  const c = makeCaster(); const e = makeEnemy('e1', { x: 1, y: 0 }, { ac: 5, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { const hp = e.currentHP; execute(c, t as Combatant, st); eq('slot consumed', (c.resources as any).spellSlots[5].remaining, 0); assert('poisoned applied', e.conditions.has('poisoned')); eq('NO damage (HP unchanged)', e.currentHP, hp); assert('NOT concentrating', !(c.concentration?.active)); const hitLogs = st.log.events.filter((x: any) => x.type === 'attack_hit' || x.type === 'attack_crit'); assert('attack hit log', hitLogs.length === 1); }
}

console.log('\n=== 5. execute — already-down target (fizzles) ===\n');
{
  const c = makeCaster(); const e = makeEnemy('e1', { x: 1, y: 0 }); e.isUnconscious = true;
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st); eq('slot consumed', (c.resources as any).spellSlots[5].remaining, 0); assert('NOT poisoned', !e.conditions.has('poisoned')); const miss = st.log.events.filter((x: any) => x.type === 'attack_miss'); assert('attack_miss log', miss.length === 1);
}

console.log('\n=== 6. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/contagion') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
