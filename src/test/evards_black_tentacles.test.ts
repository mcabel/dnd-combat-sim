// evards_black_tentacles.test.ts — Evard's Black Tentacles (Session 29)
// PHB p.238: L4, 90 ft, 20-ft square AoE (radius approx), DEX save 3d6 bludgeoning + restrained, concentration.
import { shouldCast, execute, metadata, rollDamage } from '../spells/evards_black_tentacles';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function withSlots4(remaining = 1): PlayerResources { return { spellSlots: { 4: { max: 1, remaining } } }; }
const EBT_ACTION: Action = { name: "Evard's Black Tentacles", isMultiattack: false, attackType: 'save', reach: 5, range: { normal: 90, long: 90 }, hitBonus: null, damage: null, damageType: null, saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: true, requiresConcentration: true, slotLevel: 4, costType: 'action', legendaryCost: 0, description: "Evard's Black Tentacles" };
const EBT_ACTION_LOW: Action = { ...EBT_ACTION, saveDC: 5 };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, exhaustionLevel: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 90, height: 90, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = EBT_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots4(1) }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', dex: 1, pos, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', dex: 30, pos, ...o });

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, "Evard's Black Tentacles");
eq('Level 4', metadata.level, 4);
eq('Range 90', metadata.rangeFt, 90);
eq('AoE 20', metadata.aoeRadiusFt, 20);
eq('Save dex', metadata.saveAbility, 'dex');
eq('Concentration', metadata.concentration, true);
eq('Die count 3', metadata.dieCount, 3);
eq('Die sides 6', metadata.dieSides, 6);
eq('Damage type bludgeoning', metadata.damageType, 'bludgeoning');
assert('V2 implemented', metadata.evardsBlackTentaclesV2Implemented === true);

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots4(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [EBT_ACTION], resources: withSlots4(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); c.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any; eq('null: already concentrating', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: out of range', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null', r !== null); if (r) { assert('is array', Array.isArray(r)); eq('catches e1', r[0].id, 'e1'); } }

console.log('\n=== 3. shouldCast AoE shape (20-ft radius) ===\n');
{
  const c = makeCaster();
  const center = weak('center', { x: 5, y: 0 }, { maxHP: 300 });
  const near = weak('near', { x: 8, y: 0 }, { maxHP: 50 });
  const far = weak('far', { x: 11, y: 0 }, { maxHP: 200 });
  const r = shouldCast(c, makeBF([c, center, near, far]));
  if (r) {
    const ids = r.map(x => x.id).sort();
    eq('catches center+near (≤20ft), excludes far (30ft)', ids.join(','), 'center,near');
  }
}

console.log('\n=== 4. execute — guaranteed fail (restrained + damage) ===\n');
{
  const c = makeCaster();
  const e1 = weak('e1', { x: 5, y: 0 });
  const e2 = weak('e2', { x: 8, y: 0 });
  const bf = makeBF([c, e1, e2]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    eq('slot consumed', (c.resources as any).spellSlots[4].remaining, 0);
    assert('concentration started', c.concentration?.active === true);
    assert('e1 restrained', e1.conditions.has('restrained'));
    assert('e2 restrained', e2.conditions.has('restrained'));
    assert('e1 took damage', e1.currentHP < 100);
    assert('e2 took damage', e2.currentHP < 100);
    // Check terrain_zone on caster
    const terrainZones = c.activeEffects.filter(e => e.effectType === 'terrain_zone');
    eq('terrain_zone on caster', terrainZones.length, 1);
    eq('terrain_zone condition', terrainZones[0].payload.terrainCondition, 'restrained');
    // Check damage_zone on targets
    const e1DmgZones = e1.activeEffects.filter(e => e.effectType === 'damage_zone');
    eq('damage_zone on e1', e1DmgZones.length, 1);
    const e2DmgZones = e2.activeEffects.filter(e => e.effectType === 'damage_zone');
    eq('damage_zone on e2', e2DmgZones.length, 1);
  }
}

console.log('\n=== 5. execute — guaranteed success (no restrained, half damage) ===\n');
{
  const c = makeCaster({ x: 0, y: 0, z: 0 }, EBT_ACTION_LOW);
  const e = strong('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    assert('NOT restrained', !e.conditions.has('restrained'));
    // Still takes half damage (save for half)
    assert('took some damage (half)', e.currentHP < 100);
    // Still gets damage_zone (for persistent tick)
    const eDmgZones = e.activeEffects.filter((e: any) => e.effectType === 'damage_zone');
    eq('damage_zone on target (even on save success)', eDmgZones.length, 1);
  }
}

console.log('\n=== 6. terrain_zone properties ===\n');
{
  const c = makeCaster();
  const e1 = weak('e1', { x: 5, y: 0 }, { maxHP: 300 });
  const bf = makeBF([c, e1]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    const tz = c.activeEffects.find(e => e.effectType === 'terrain_zone');
    assert('terrain_zone exists', tz !== undefined);
    if (tz) {
      eq('terrainCondition', tz.payload.terrainCondition, 'restrained');
      eq('terrainSaveAbility', tz.payload.terrainSaveAbility, 'dex');
      eq('terrainRadiusFt', tz.payload.terrainRadiusFt, 20);
      eq('terrainCenterX', tz.payload.terrainCenterX, 5);
      eq('terrainCenterY', tz.payload.terrainCenterY, 0);
      eq('terrainCenterZ', tz.payload.terrainCenterZ, 0);
      eq('sourceIsConcentration', tz.sourceIsConcentration, true);
    }
  }
}

console.log('\n=== 7. damage_zone properties ===\n');
{
  const c = makeCaster();
  const e1 = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e1]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    const dz = e1.activeEffects.find(e => e.effectType === 'damage_zone');
    assert('damage_zone exists', dz !== undefined);
    if (dz) {
      eq('dieCount', dz.payload.dieCount, 3);
      eq('dieSides', dz.payload.dieSides, 6);
      eq('damageType', dz.payload.damageType, 'bludgeoning');
      eq('saveDC', dz.payload.saveDC, 25);
      eq('saveAbility', dz.payload.saveAbility, 'dex');
      eq('sourceIsConcentration', dz.sourceIsConcentration, true);
    }
  }
}

console.log('\n=== 8. rollDamage range ===\n');
{
  // Roll damage many times and check range is 3-18 (3d6)
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 100; i++) {
    const dmg = rollDamage();
    if (dmg < min) min = dmg;
    if (dmg > max) max = dmg;
  }
  assert('min >= 3', min >= 3);
  assert('max <= 18', max <= 18);
}

console.log('\n=== 9. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/evards_black_tentacles') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log('\n=== 10. Concentration effects cleanup on break ===\n');
{
  const c = makeCaster();
  const e1 = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e1]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    assert('e1 has restrained before cleanup', e1.conditions.has('restrained'));
    // Simulate concentration break by removing effects from caster
    const { removeEffectsFromCaster } = require('../engine/spell_effects') as any;
    removeEffectsFromCaster(c.id, bf);
    assert('e1 no longer restrained after conc break', !e1.conditions.has('restrained'));
    assert('caster terrain_zone removed', c.activeEffects.filter((e: any) => e.effectType === 'terrain_zone').length === 0);
    assert('target damage_zone removed', e1.activeEffects.filter((e: any) => e.effectType === 'damage_zone').length === 0);
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
