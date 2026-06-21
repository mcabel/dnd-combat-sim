// dominate_beast.test.ts — Dominate Beast v2 (Session 28)
// PHB p.235: L4, 60 ft, WIS save or dominated (charmed + incapacitated),
//   concentration, beast-only.
import { shouldCast, execute, metadata } from '../spells/dominate_beast';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function withSlots4(remaining = 1): PlayerResources { return { spellSlots: { 4: { max: 1, remaining } } }; }
const DB_ACTION: Action = { name: 'Dominate Beast', isMultiattack: false, attackType: 'save', reach: 5, range: { normal: 60, long: 60 }, hitBonus: null, damage: null, damageType: null, saveDC: 25, saveAbility: 'wis', isAoE: false, isControl: true, requiresConcentration: true, slotLevel: 4, costType: 'action', legendaryCost: 0, description: 'Dominate Beast' };
const DB_ACTION_LOW: Action = { ...DB_ACTION, saveDC: 5 };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, exhaustionLevel: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = DB_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots4(1) }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', wis: 1, pos, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', wis: 30, pos, ...o });

// ---- 1. Metadata v2 ----

console.log('\n=== 1. Metadata v2 ===\n');
eq('Name', metadata.name, 'Dominate Beast');
eq('Level 4', metadata.level, 4);
eq('Range 60', metadata.rangeFt, 60);
eq('Save wis', metadata.saveAbility, 'wis');
eq('Concentration', metadata.concentration, true);
assert('v2 control flag', (metadata as any).dominateBeastControlV2Implemented === true);
assert('v2 beast type check flag', (metadata as any).dominateBeastBeastTypeCheckV2Implemented === true);
assert('v1 control flag removed', !(metadata as any).dominateBeastControlV1Simplified);
assert('v1 beast type check flag removed', !(metadata as any).dominateBeastBeastTypeCheckV1Implemented);

// ---- 2. shouldCast gates ----

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots4(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [DB_ACTION], resources: withSlots4(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); c.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any; eq('null: already concentrating', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: out of range', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null', r !== null); if (r) eq('enemy id', (r as Combatant).id, 'e1'); }

// ---- 3. shouldCast target selection ----

console.log('\n=== 3. shouldCast target selection ===\n');
{ const c = makeCaster(); const lo = weak('lo', { x: 1, y: 0 }, { maxHP: 30 }); const hi = weak('hi', { x: 5, y: 0 }, { maxHP: 300 }); const r = shouldCast(c, makeBF([c, lo, hi])); if (r) eq('picks highest-threat', (r as Combatant).id, 'hi'); }

// ---- 4. Creature-type enforcement ----

console.log('\n=== 4. Creature-type enforcement ===\n');
{
  // Beast — should be valid target
  const c = makeCaster();
  const beast = weak('beast', { x: 1, y: 0 }, { creatureType: 'beast' } as any);
  const r = shouldCast(c, makeBF([c, beast]));
  assert('beast is valid target', r !== null);
  if (r) eq('beast id', (r as Combatant).id, 'beast');
}
{
  // Humanoid — should be skipped
  const c = makeCaster();
  const humanoid = weak('hum', { x: 1, y: 0 }, { creatureType: 'humanoid' } as any);
  const r = shouldCast(c, makeBF([c, humanoid]));
  eq('humanoid is NOT valid target', r, null);
}
{
  // Undead — should be skipped
  const c = makeCaster();
  const undead = weak('und', { x: 1, y: 0 }, { creatureType: 'undead' } as any);
  const r = shouldCast(c, makeBF([c, undead]));
  eq('undead is NOT valid target', r, null);
}
{
  // creatureType undefined — permissive (allow)
  const c = makeCaster();
  const unknown = weak('unk', { x: 1, y: 0 });
  const r = shouldCast(c, makeBF([c, unknown]));
  assert('undefined creatureType is allowed', r !== null);
}
{
  // Mix: beast + humanoid — should pick the beast
  const c = makeCaster();
  const beast = weak('beast', { x: 1, y: 0 }, { maxHP: 50, creatureType: 'beast' } as any);
  const humanoid = weak('hum', { x: 1, y: 0 }, { maxHP: 300, creatureType: 'humanoid' } as any);
  const r = shouldCast(c, makeBF([c, beast, humanoid]));
  if (r) eq('picks beast over humanoid', (r as Combatant).id, 'beast');
}

// ---- 5. execute — dominated effect (charmed + incapacitated) ----

console.log('\n=== 5. execute — dominated effect ===\n');
{
  const c = makeCaster();
  const e = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t as Combatant, st);
    eq('slot consumed', (c.resources as any).spellSlots[4].remaining, 0);
    assert('concentration started', c.concentration?.active === true);
    assert('charmed applied', e.conditions.has('charmed'));
    assert('incapacitated applied', e.conditions.has('incapacitated'));
    // Check activeEffects has dominated type
    const domEffect = e.activeEffects.find(eff => eff.effectType === 'dominated');
    assert('dominated effect present', domEffect !== undefined);
    if (domEffect) {
      eq('effect spellName', domEffect.spellName, 'Dominate Beast');
      eq('effect casterId', domEffect.casterId, 'wiz');
      assert('sourceIsConcentration', domEffect.sourceIsConcentration === true);
    }
  }
}

// ---- 6. execute — guaranteed success (no charm) ----

console.log('\n=== 6. execute — guaranteed success ===\n');
{
  const c = makeCaster({ x: 0, y: 0, z: 0 }, DB_ACTION_LOW);
  const e = strong('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t as Combatant, st);
    assert('NOT charmed', !e.conditions.has('charmed'));
    assert('NOT incapacitated', !e.conditions.has('incapacitated'));
    const ss = st.log.events.filter((x: any) => x.type === 'save_success');
    assert('save_success log', ss.length === 1);
  }
}

// ---- 7. Concentration break removes both conditions ----

console.log('\n=== 7. Concentration break removes both conditions ===\n');
{
  const c = makeCaster();
  const e = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t as Combatant, st);
    assert('charmed before break', e.conditions.has('charmed'));
    assert('incapacitated before break', e.conditions.has('incapacitated'));
    // Simulate concentration break
    removeEffectsFromCaster(c.id, bf);
    assert('charmed removed after break', !e.conditions.has('charmed'));
    assert('incapacitated removed after break', !e.conditions.has('incapacitated'));
    assert('no dominated effect remaining', !e.activeEffects.some(eff => eff.effectType === 'dominated'));
  }
}

// ---- 8. Already dominated target skipped by shouldCast ----

console.log('\n=== 8. Already dominated target skipped ===\n');
{
  const c = makeCaster();
  const e = weak('e1', { x: 1, y: 0 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  // First cast dominates the target
  execute(c, e, st);
  assert('target is charmed', e.conditions.has('charmed'));
  // Second cast — caster is concentrating, so shouldCast returns null
  eq('null: already concentrating', shouldCast(c, bf), null);
}

// ---- 9. Log messages ----

console.log('\n=== 9. Log messages ===\n');
{
  const c = makeCaster();
  const e = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  execute(c, e, st);
  const domLogs = st.log.events.filter((x: any) => x.description && x.description.includes('DOMINATED'));
  assert('DOMINATED in log', domLogs.length > 0);
  const charmOnlyLogs = st.log.events.filter((x: any) => x.description && x.description.includes('charm only'));
  assert('No "charm only" log', charmOnlyLogs.length === 0);
}

// ---- 10. Cleanup no-op ----

console.log('\n=== 10. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/dominate_beast') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
