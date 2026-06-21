// watery_sphere.test.ts — Watery Sphere (Session 25 / Batch 2, terrain v2 Session 28)
// XGE p.170: L4, 90 ft, 5-ft radius AoE, STR save or restrained, concentration.
import { shouldCast, execute, metadata } from '../spells/watery_sphere';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';
import { getActiveTerrainZones, TerrainZone } from '../engine/spell_effects';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function withSlots4(remaining = 1): PlayerResources { return { spellSlots: { 4: { max: 1, remaining } } }; }
const WS_ACTION: Action = { name: 'Watery Sphere', isMultiattack: false, attackType: 'save', reach: 5, range: { normal: 90, long: 90 }, hitBonus: null, damage: null, damageType: null, saveDC: 25, saveAbility: 'str', isAoE: true, isControl: true, requiresConcentration: true, slotLevel: 4, costType: 'action', legendaryCost: 0, description: 'Watery Sphere' };
const WS_ACTION_LOW: Action = { ...WS_ACTION, saveDC: 5 };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, exhaustionLevel: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 90, height: 90, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = WS_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots4(1) }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', str: 1, pos, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', str: 30, pos, ...o });

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Watery Sphere'); eq('Level 4', metadata.level, 4); eq('Range 90', metadata.rangeFt, 90);
eq('AoE 5', metadata.aoeRadiusFt, 5); eq('Save str', metadata.saveAbility, 'str'); eq('Concentration', metadata.concentration, true);
assert('v2 terrain flag', (metadata as any).waterySpherePersistentTerrainV2StartOfTurnOnly === true);

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots4(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [WS_ACTION], resources: withSlots4(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); c.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any; eq('null: already concentrating', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: out of range', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null', r !== null); if (r) { assert('is array', Array.isArray(r)); eq('catches e1', r[0].id, 'e1'); } }

console.log('\n=== 3. shouldCast tiny AoE (5-ft radius) ===\n');
{
  const c = makeCaster();
  const center = weak('center', { x: 5, y: 0 }, { maxHP: 300 });      // 25ft from caster, chosen as center
  const adj = weak('adj', { x: 6, y: 0 }, { maxHP: 50 });             // 5ft from center → caught
  const excl = weak('excl', { x: 8, y: 0 }, { maxHP: 200 });          // 15ft from center (> 5) → excluded
  const r = shouldCast(c, makeBF([c, center, adj, excl]));
  if (r) { const ids = r.map(x => x.id).sort(); eq('catches center+adj (≤5ft), excludes excl', ids.join(','), 'adj,center'); }
}

console.log('\n=== 4. execute — guaranteed fail (restrained) ===\n');
{ const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 }, { maxHP: 1000, currentHP: 1000 }); const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t, st); eq('slot consumed', (c.resources as any).spellSlots[4].remaining, 0); assert('concentration started', c.concentration?.active === true); assert('restrained', e.conditions.has('restrained')); assert('no damage', e.currentHP === 1000); } }

console.log('\n=== 5. execute — guaranteed success ===\n');
{ const c = makeCaster({ x: 0, y: 0, z: 0 }, WS_ACTION_LOW); const e = strong('e1', { x: 5, y: 0 }); const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t, st); assert('NOT restrained', !e.conditions.has('restrained')); const ss = st.log.events.filter((x: any) => x.type === 'save_success'); assert('save_success log', ss.length === 1); } }

console.log('\n=== 6. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/watery_sphere') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

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
    eq('spell name', z.spellName, 'Watery Sphere');
    eq('save ability', z.saveAbility, 'str');
    eq('condition', z.condition, 'restrained');
    eq('radius', z.radiusFt, 5);
    eq('center X', z.centerX, 5);  // enemy at x:5
    eq('center Y', z.centerY, 0);
    eq('center Z', z.centerZ, 0);
    eq('IS concentration-sourced', z.sourceIsConcentration, true);
    eq('caster ID', z.casterId, 'wiz');
  }
}

console.log('\n=== 8. Terrain zone removed on concentration break ===\n');
{
  const c = makeCaster();
  const e = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); }
  eq('zone before conc break', getActiveTerrainZones(bf).length, 1);
  // Simulate concentration break by removing effects from caster
  const { removeEffectsFromCaster } = require('../engine/spell_effects');
  removeEffectsFromCaster('wiz', bf);
  eq('zone after conc break', getActiveTerrainZones(bf).length, 0);
}

console.log('\n=== 9. Terrain zone uses STR save (not DEX) ===\n');
{
  const c = makeCaster();
  const e = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); }
  const zones = getActiveTerrainZones(bf);
  if (zones.length > 0) {
    eq('save ability is STR', zones[0].saveAbility, 'str');
    eq('condition is restrained', zones[0].condition, 'restrained');
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
