// reverse_gravity.test.ts — Reverse Gravity (Session 25 / Batch 2)
// PHB p.277: L7, 100 ft, 50-ft radius AoE, DEX save or restrained, concentration.
import { shouldCast, execute, metadata } from '../spells/reverse_gravity';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

function withSlots7(remaining = 1): PlayerResources { return { spellSlots: { 7: { max: 1, remaining } } }; }
const RG_ACTION: Action = {
  name: 'Reverse Gravity', isMultiattack: false, attackType: 'save', reach: 5,
  range: { normal: 100, long: 100 }, hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: true,
  requiresConcentration: true, slotLevel: 7, costType: 'action', legendaryCost: 0, description: 'Reverse Gravity',
};
const RG_ACTION_LOW: Action = { ...RG_ACTION, saveDC: 5 };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: 1,
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any,
    concentration: null, deathSaves: null, resources: null, tempHP: 0,
    mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false,
    hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides,
    pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) },
  };
}
function makeBF(c: Combatant[]) { return { width: 120, height: 120, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = RG_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots7(1) }); }
function makeEnemy(id: string, pos: any, o: Partial<Combatant> = {}) { return makeCombatant(id, { name: id, faction: 'enemy', pos, ...o }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeEnemy(id, pos, { dex: 1, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeEnemy(id, pos, { dex: 30, ...o });

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Reverse Gravity'); eq('Level 7', metadata.level, 7);
eq('Range 100', metadata.rangeFt, 100); eq('AoE 50', metadata.aoeRadiusFt, 50);
eq('Save dex', metadata.saveAbility, 'dex'); eq('Concentration', metadata.concentration, true);

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots7(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [RG_ACTION], resources: withSlots7(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); c.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any; eq('null: already concentrating', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: no enemy in 100ft', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null: enemy in range', r !== null); if (r) { assert('is array', Array.isArray(r)); eq('catches e1', r[0].id, 'e1'); } }

console.log('\n=== 3. shouldCast AoE shape ===\n');
{
  const c = makeCaster();
  const center = weak('center', { x: 5, y: 0 }, { maxHP: 300 });
  const near = weak('near', { x: 7, y: 0 }, { maxHP: 50 });
  const far = weak('far', { x: 12, y: 0 }, { maxHP: 200 });   // 35 ft from center > 30... wait AoE is 50
  // far at (12,0): chebyshev(center(5,0)→(12,0)) = 7×5 = 35 ft ≤ 50 → CAUGHT. Need farther for exclusion.
  const tooFar = weak('tooFar', { x: 16, y: 0 }, { maxHP: 250 }); // chebyshev(5→16)=11×5=55 > 50 → excluded
  const r = shouldCast(c, makeBF([c, center, near, far, tooFar]));
  if (r) { const ids = r.map(x => x.id).sort(); eq('catches center+near+far (≤50ft of center), excludes tooFar', ids.join(','), 'center,far,near'); }
}

console.log('\n=== 4. execute — guaranteed fail (restrained) ===\n');
{
  const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); eq('slot consumed', (c.resources as any).spellSlots[7].remaining, 0); assert('concentration started', c.concentration?.active === true); assert('restrained', e.conditions.has('restrained')); assert('no damage', e.currentHP === 1000); }
}

console.log('\n=== 5. execute — guaranteed success ===\n');
{
  const c = makeCaster({ x: 0, y: 0, z: 0 }, RG_ACTION_LOW); const e = strong('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); assert('NOT restrained', !e.conditions.has('restrained')); const ss = st.log.events.filter(x => x.type === 'save_success'); assert('save_success log', ss.length === 1); }
}

console.log('\n=== 6. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/reverse_gravity') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
