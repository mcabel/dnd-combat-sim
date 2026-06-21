// mass_suggestion.test.ts — Mass Suggestion (Session 25 / Batch 2, upgraded Session 28)
// PHB p.258: L6, 60 ft, WIS save or suggestion (charmed + disadv on attacks), up to 12 targets, NO concentration (24 hr).
import { shouldCast, execute, metadata } from '../spells/mass_suggestion';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';
import { removeEffectsFromCaster } from '../engine/spell_effects';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

function withSlots6(remaining = 1): PlayerResources { return { spellSlots: { 6: { max: 1, remaining } } }; }
const MS_ACTION: Action = {
  name: 'Mass Suggestion', isMultiattack: false, attackType: 'save', reach: 5,
  range: { normal: 60, long: 60 }, hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'wis', isAoE: true, isControl: true,
  requiresConcentration: false, slotLevel: 6, costType: 'action', legendaryCost: 0, description: 'Mass Suggestion',
};
const MS_ACTION_LOW: Action = { ...MS_ACTION, saveDC: 5 };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10, cr: 1,
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any,
    concentration: null, deathSaves: null, resources: null, tempHP: 0,
    exhaustionLevel: 0,
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
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = MS_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots6(1) }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', wis: 1, pos, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', wis: 30, pos, ...o });

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Mass Suggestion'); eq('Level 6', metadata.level, 6);
eq('Range 60', metadata.rangeFt, 60); eq('Max targets 12', metadata.maxTargets, 12);
eq('Save wis', metadata.saveAbility, 'wis'); eq('NOT concentration', metadata.concentration, false);
assert('V2 behaviour flag', (metadata as any).massSuggestionBehaviourV2Implemented === true);
assert('V1 behaviour flag removed', !('massSuggestionBehaviourV1SimplifiedToCharmed' in metadata));

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots6(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [MS_ACTION], resources: withSlots6(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: out of range', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null: enemy in range', r !== null); if (r) { assert('is array', Array.isArray(r)); eq('catches e1', r[0].id, 'e1'); } }

console.log('\n=== 3. shouldCast 12-target cap ===\n');
{
  const c = makeCaster();
  const enemies: Combatant[] = [];
  for (let i = 0; i < 15; i++) enemies.push(weak(`e${i}`, { x: 1 + (i % 5), y: Math.floor(i / 5), z: 0 }, { maxHP: 100 + i }));
  const r = shouldCast(c, makeBF([c, ...enemies]));
  if (r) { eq('caps at 12 targets (15 enemies)', r.length, 12); }
}

console.log('\n=== 4. execute — guaranteed fail (suggestion: charmed + disadv on attacks) ===\n');
{
  const c = makeCaster(); const e1 = weak('e1', { x: 1, y: 0 }); const e2 = weak('e2', { x: 2, y: 0 });
  const bf = makeBF([c, e1, e2]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); eq('slot consumed', (c.resources as any).spellSlots[6].remaining, 0); assert('NOT concentrating', !(c.concentration?.active)); assert('e1 charmed', e1.conditions.has('charmed')); assert('e2 charmed', e2.conditions.has('charmed'));
    // NEW: verify suggestion effect applies disadvantage on attack rolls
    const e1Adv = e1.advantages.find(a => a.source === 'Mass Suggestion');
    const e2Adv = e2.advantages.find(a => a.source === 'Mass Suggestion');
    assert('e1 has disadv on attacks (advantages entry)', !!e1Adv);
    assert('e1 disadv type is disadvantage', e1Adv?.type === 'disadvantage');
    assert('e1 disadv scope is attack', e1Adv?.scope === 'attack');
    assert('e2 has disadv on attacks (advantages entry)', !!e2Adv);
    // NEW: verify effect type is 'suggestion'
    const e1Effect = e1.activeEffects.find(e => e.spellName === 'Mass Suggestion');
    assert('e1 effect type is suggestion', e1Effect?.effectType === 'suggestion');
  }
}

console.log('\n=== 5. execute — guaranteed success (no effect) ===\n');
{
  const c = makeCaster({ x: 0, y: 0, z: 0 }, MS_ACTION_LOW); const e1 = strong('e1', { x: 1, y: 0 });
  const bf = makeBF([c, e1]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { execute(c, t, st); assert('NOT charmed', !e1.conditions.has('charmed')); const ss = st.log.events.filter(x => x.type === 'save_success'); assert('save_success log', ss.length === 1);
    // NEW: no disadv on attacks when save succeeds
    const e1Adv = e1.advantages.find(a => a.source === 'Mass Suggestion');
    assert('no disadv on attacks after save success', !e1Adv);
  }
}

console.log('\n=== 6. suggestion effect undo — charmed removed + disadv removed ===\n');
{
  const c = makeCaster(); const e1 = weak('e1', { x: 1, y: 0 });
  const bf = makeBF([c, e1]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    assert('e1 charmed before undo', e1.conditions.has('charmed'));
    assert('e1 has disadv before undo', e1.advantages.some(a => a.source === 'Mass Suggestion'));

    // Remove effects from caster (simulates concentration break or dispel)
    removeEffectsFromCaster(c.id, bf);

    assert('e1 NOT charmed after undo', !e1.conditions.has('charmed'));
    assert('e1 no disadv after undo', !e1.advantages.some(a => a.source === 'Mass Suggestion'));
    assert('e1 no active effects after undo', e1.activeEffects.length === 0);
  }
}

console.log('\n=== 7. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/mass_suggestion') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
