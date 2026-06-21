// grease.test.ts — Grease (Session 25 / Batch 2, terrain v2 Session 28)
// PHB p.245: L1, 60 ft, 10-ft radius AoE, DEX save or prone, NO concentration.
import { shouldCast, execute, metadata } from '../spells/grease';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';
import { getActiveTerrainZones, TerrainZone } from '../engine/spell_effects';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function withSlots1(remaining = 1): PlayerResources { return { spellSlots: { 1: { max: 4, remaining } } }; }
const GR_ACTION: Action = { name: 'Grease', isMultiattack: false, attackType: 'save', reach: 5, range: { normal: 60, long: 60 }, hitBonus: null, damage: null, damageType: null, saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: true, requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0, description: 'Grease' };
const GR_ACTION_LOW: Action = { ...GR_ACTION, saveDC: 5 };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = GR_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots1(1) }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', dex: 1, pos, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', dex: 30, pos, ...o });

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Grease'); eq('Level 1', metadata.level, 1); eq('Range 60', metadata.rangeFt, 60);
eq('AoE 10', metadata.aoeRadiusFt, 10); eq('Save dex', metadata.saveAbility, 'dex'); eq('NOT concentration', metadata.concentration, false);
assert('v2 terrain flag', (metadata as any).greasePersistentTerrainV2StartOfTurnOnly === true);
assert('v1 terrain flag removed', !('greasePersistentTerrainV1Simplified' in metadata));

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots1(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [GR_ACTION], resources: withSlots1(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: out of range', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null', r !== null); if (r) { assert('is array', Array.isArray(r)); eq('catches e1', r[0].id, 'e1'); } }

console.log('\n=== 3. shouldCast AoE shape (10-ft radius) ===\n');
{ const c = makeCaster(); const center = weak('center', { x: 5, y: 0 }, { maxHP: 300 }); const near = weak('near', { x: 6, y: 0 }, { maxHP: 50 }); const far = weak('far', { x: 9, y: 0 }, { maxHP: 200 }); const r = shouldCast(c, makeBF([c, center, near, far])); if (r) { const ids = r.map(x => x.id).sort(); eq('catches center+near (≤10ft), excludes far (20ft)', ids.join(','), 'center,near'); } }

console.log('\n=== 4. execute — guaranteed fail (prone) ===\n');
{ const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 }); const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t, st); eq('slot consumed', (c.resources as any).spellSlots[1].remaining, 0); assert('NOT concentrating', !(c.concentration?.active)); assert('prone applied', e.conditions.has('prone')); } }

console.log('\n=== 5. execute — guaranteed success ===\n');
{ const c = makeCaster({ x: 0, y: 0, z: 0 }, GR_ACTION_LOW); const e = strong('e1', { x: 5, y: 0 }); const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t, st); assert('NOT prone', !e.conditions.has('prone')); const ss = st.log.events.filter((x: any) => x.type === 'save_success'); assert('save_success log', ss.length === 1); } }

console.log('\n=== 6. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/grease') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log('\n=== 7. Terrain zone effect on cast ===\n');
{
  const c = makeCaster();
  const e = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); }
  // The terrain_zone effect should be on the CASTER
  const zones = getActiveTerrainZones(bf);
  eq('1 terrain zone', zones.length, 1);
  if (zones.length > 0) {
    const z = zones[0];
    eq('spell name', z.spellName, 'Grease');
    eq('save ability', z.saveAbility, 'dex');
    eq('condition', z.condition, 'prone');
    eq('radius', z.radiusFt, 10);
    eq('center X', z.centerX, 5);  // enemy at x:5
    eq('center Y', z.centerY, 0);
    eq('center Z', z.centerZ, 0);
    eq('NOT concentration-sourced', z.sourceIsConcentration, false);
    eq('caster ID', z.casterId, 'wiz');
  }
}

console.log('\n=== 8. Terrain zone center is highest-threat target ===\n');
{
  const c = makeCaster();
  const e1 = weak('e1', { x: 5, y: 0 }, { maxHP: 50 });
  const e2 = weak('e2', { x: 6, y: 0 }, { maxHP: 200 });  // highest threat
  const bf = makeBF([c, e1, e2]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); }
  const zones = getActiveTerrainZones(bf);
  if (zones.length > 0) {
    // Center should be at e2 (maxHP: 200) not e1 (maxHP: 50)
    eq('center X at e2', zones[0].centerX, 6);
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
