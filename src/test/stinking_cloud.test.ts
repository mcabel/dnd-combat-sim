// stinking_cloud.test.ts — Stinking Cloud (Session 25 / Batch 2, v2 terrain_zone Session 29)
// PHB p.278: L3, 90 ft, 20-ft radius AoE, CON save or poisoned+incapacitated (DUAL), concentration.
import { shouldCast, execute, metadata } from '../spells/stinking_cloud';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function withSlots3(remaining = 1): PlayerResources { return { spellSlots: { 3: { max: 1, remaining } } }; }
const SC_ACTION: Action = { name: 'Stinking Cloud', isMultiattack: false, attackType: 'save', reach: 5, range: { normal: 90, long: 90 }, hitBonus: null, damage: null, damageType: null, saveDC: 25, saveAbility: 'con', isAoE: true, isControl: true, requiresConcentration: true, slotLevel: 3, costType: 'action', legendaryCost: 0, description: 'Stinking Cloud' };
const SC_ACTION_LOW: Action = { ...SC_ACTION, saveDC: 5 };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 90, height: 90, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = SC_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots3(1) }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', con: 1, pos, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', con: 30, pos, ...o });

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Stinking Cloud'); eq('Level 3', metadata.level, 3); eq('Range 90', metadata.rangeFt, 90);
eq('AoE 20', metadata.aoeRadiusFt, 20); eq('Save con', metadata.saveAbility, 'con'); eq('Concentration', metadata.concentration, true);
assert('V2 terrain zone implemented', metadata.stinkingCloudTerrainZoneV2Implemented === true);
assert('V2 incapacitated simplified to poisoned only', metadata.stinkingCloudTerrainIncapacitatedV2SimplifiedToPoisonedOnly === true);

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots3(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [SC_ACTION], resources: withSlots3(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); c.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any; eq('null: already concentrating', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: out of range', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null', r !== null); if (r) { assert('is array', Array.isArray(r)); eq('catches e1', r[0].id, 'e1'); } }

console.log('\n=== 3. shouldCast AoE shape (20-ft radius) ===\n');
{ const c = makeCaster(); const center = weak('center', { x: 5, y: 0 }, { maxHP: 300 }); const near = weak('near', { x: 8, y: 0 }, { maxHP: 50 }); const far = weak('far', { x: 11, y: 0 }, { maxHP: 200 }); const r = shouldCast(c, makeBF([c, center, near, far])); if (r) { const ids = r.map(x => x.id).sort(); eq('catches center+near (≤20ft), excludes far (30ft)', ids.join(','), 'center,near'); } }

console.log('\n=== 4. execute — guaranteed fail (poisoned AND incapacitated) ===\n');
{ const c = makeCaster(); const e1 = weak('e1', { x: 5, y: 0 }); const e2 = weak('e2', { x: 8, y: 0 }); const bf = makeBF([c, e1, e2]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t, st); eq('slot consumed', (c.resources as any).spellSlots[3].remaining, 0); assert('concentration started', c.concentration?.active === true); assert('e1 poisoned (DUAL)', e1.conditions.has('poisoned')); assert('e1 incapacitated (DUAL)', e1.conditions.has('incapacitated')); assert('e2 poisoned (DUAL)', e2.conditions.has('poisoned')); assert('e2 incapacitated (DUAL)', e2.conditions.has('incapacitated')); } }

console.log('\n=== 5. execute — guaranteed success (no conditions) ===\n');
{ const c = makeCaster({ x: 0, y: 0, z: 0 }, SC_ACTION_LOW); const e = strong('e1', { x: 5, y: 0 }); const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf); if (t) { execute(c, t, st); assert('NOT poisoned', !e.conditions.has('poisoned')); assert('NOT incapacitated', !e.conditions.has('incapacitated')); } }

console.log('\n=== 6. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/stinking_cloud') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log('\n=== 7. terrain_zone effect on caster (v2) ===\n');
{
  const c = makeCaster();
  const e1 = weak('e1', { x: 5, y: 0 }, { maxHP: 300 });
  const bf = makeBF([c, e1]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    const tz = c.activeEffects.find(e => e.effectType === 'terrain_zone');
    assert('terrain_zone exists on caster', tz !== undefined);
    if (tz) {
      eq('terrainCondition', tz.payload.terrainCondition, 'poisoned');
      eq('terrainSaveAbility', tz.payload.terrainSaveAbility, 'con');
      eq('terrainRadiusFt', tz.payload.terrainRadiusFt, 20);
      eq('terrainCenterX', tz.payload.terrainCenterX, 5);
      eq('terrainCenterY', tz.payload.terrainCenterY, 0);
      eq('terrainCenterZ', tz.payload.terrainCenterZ, 0);
      eq('sourceIsConcentration', tz.sourceIsConcentration, true);
      eq('casterId', tz.casterId, 'wiz');
      eq('spellName', tz.spellName, 'Stinking Cloud');
    }
  }
}

console.log('\n=== 8. terrain_zone cleanup on concentration break (v2) ===\n');
{
  const c = makeCaster();
  const e1 = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e1]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    assert('e1 has poisoned before cleanup', e1.conditions.has('poisoned'));
    assert('e1 has incapacitated before cleanup', e1.conditions.has('incapacitated'));
    assert('caster has terrain_zone before cleanup', c.activeEffects.some(e => e.effectType === 'terrain_zone'));
    // Simulate concentration break
    const { removeEffectsFromCaster } = require('../engine/spell_effects') as any;
    removeEffectsFromCaster(c.id, bf);
    assert('e1 no longer poisoned after conc break', !e1.conditions.has('poisoned'));
    assert('e1 no longer incapacitated after conc break', !e1.conditions.has('incapacitated'));
    assert('caster terrain_zone removed after conc break', !c.activeEffects.some(e => e.effectType === 'terrain_zone'));
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
