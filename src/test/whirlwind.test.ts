// whirlwind.test.ts — Whirlwind (Session 27 — CANON DAMAGE FIX)
// PHB p.298: L7, 50-ft cone, CON save or 7d8 bludgeoning + restrained, concentration (canon damage — Session 27 fix; was dropped per plan in Batch 2).
import { shouldCast, execute, metadata, rollDamage } from '../spells/whirlwind';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

function withSlots7(remaining = 1): PlayerResources { return { spellSlots: { 7: { max: 1, remaining } } }; }
const WH_ACTION: Action = {
  name: 'Whirlwind', isMultiattack: false, attackType: 'save', reach: 5,
  range: { normal: 50, long: 50 }, hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'con', isAoE: true, isControl: true,
  requiresConcentration: true, slotLevel: 7, costType: 'action', legendaryCost: 0, description: 'Whirlwind',
};
const WH_ACTION_LOW: Action = { ...WH_ACTION, saveDC: 5 };
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
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = WH_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots7(1) }); }
function makeEnemy(id: string, pos: any, o: Partial<Combatant> = {}) { return makeCombatant(id, { name: id, faction: 'enemy', pos, ...o }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeEnemy(id, pos, { con: 1, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeEnemy(id, pos, { con: 30, ...o });

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Whirlwind'); eq('Level 7', metadata.level, 7);
eq('Range 50', metadata.rangeFt, 50); eq('Save con', metadata.saveAbility, 'con');
eq('Concentration', metadata.concentration, true);
eq('dieCount 7', metadata.dieCount, 7); eq('dieSides 8', metadata.dieSides, 8); eq('damageType bludgeoning', metadata.damageType, 'bludgeoning');
assert('canon damage flag set', metadata.whirlwindCanonDamageV1 === true);

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots7(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [WH_ACTION], resources: withSlots7(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); c.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any; eq('null: already concentrating', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: no enemy in 50ft', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null: enemy in cone range', r !== null); if (r) { assert('is array', Array.isArray(r)); eq('catches e1', r[0].id, 'e1'); } }

console.log('\n=== 3. shouldCast cone shape ===\n');
{
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const aim = weak('aim', { x: 1, y: 0 });        // nearest, sets aim +x
  const inCone = weak('inCone', { x: 3, y: 0 });  // on-axis, in cone
  const outCone = weak('outCone', { x: 0, y: 3 }); // 90° off-axis, NOT in cone
  const r = shouldCast(c, makeBF([c, aim, inCone, outCone]));
  if (r) { const ids = r.map(x => x.id).sort(); eq('catches aim+inCone, excludes outCone', ids.join(','), 'aim,inCone'); }
}

console.log('\n=== 4. execute — guaranteed fail (7d8 damage + restrained) ===\n');
{
  const c = makeCaster(); const e = weak('e1', { x: 1, y: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); eq('slot consumed', (c.resources as any).spellSlots[7].remaining, 0); assert('concentration started', c.concentration?.active === true); assert('restrained', e.conditions.has('restrained')); assert('damage dealt (HP reduced)', e.currentHP < 1000); assert('damage in 7d8 range [7..56]', e.currentHP >= 1000 - 56 && e.currentHP <= 1000 - 7); const dmg = st.log.events.filter(x => x.type === 'damage'); assert('damage log emitted', dmg.length === 1); assert('restrained is conc-sourced', e.activeEffects.some(x => x.casterId === c.id && x.spellName === 'Whirlwind' && x.sourceIsConcentration === true)); }
}

console.log('\n=== 5. execute — guaranteed success (half damage, NOT restrained) ===\n');
{
  const c = makeCaster({ x: 0, y: 0, z: 0 }, WH_ACTION_LOW); const e = strong('e1', { x: 1, y: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); assert('NOT restrained', !e.conditions.has('restrained')); assert('half damage dealt (HP reduced)', e.currentHP < 1000); assert('half-damage in [3..28] range', e.currentHP >= 1000 - 28 && e.currentHP <= 1000 - 3); const ss = st.log.events.filter(x => x.type === 'save_success'); assert('save_success log', ss.length === 1); }
}

console.log('\n=== 6. rollDamage range ===\n');
{ let min = Infinity, max = -Infinity; for (let i = 0; i < 500; i++) { const r = rollDamage(); if (r < min) min = r; if (r > max) max = r; } assert('rollDamage min >= 7', min >= 7); assert('rollDamage max <= 56', max <= 56); assert('rollDamage min < max (variance)', min < max); }

console.log('\n=== 7. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/whirlwind') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
