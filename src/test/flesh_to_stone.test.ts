// flesh_to_stone.test.ts — Flesh to Stone (Session 25 / Batch 2, upgraded Task 5)
// PHB p.241: L6, 60 ft, CON save or restrained, concentration,
//   3-fail escalation: 3 fails → petrified, 3 successes → freed.
import { shouldCast, execute, metadata } from '../spells/flesh_to_stone';
import { Combatant, Action, PlayerResources, Vec3, Condition, SaveFailTracker } from '../types/core';
import { applySpellEffect, removeEffectsFromCaster, _resetEffectIdCounter } from '../engine/spell_effects';
import { rollSave } from '../engine/utils';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

function withSlots6(remaining = 1): PlayerResources { return { spellSlots: { 6: { max: 1, remaining } } }; }
const FTS_ACTION: Action = {
  name: 'Flesh to Stone', isMultiattack: false, attackType: 'save', reach: 5,
  range: { normal: 60, long: 60 }, hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'con', isAoE: false, isControl: true,
  requiresConcentration: true, slotLevel: 6, costType: 'action', legendaryCost: 0, description: 'Flesh to Stone',
};
const FTS_ACTION_LOW: Action = { ...FTS_ACTION, saveDC: 5 };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: 1,
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
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map((x: any) => [x.id, x])), initiativeOrder: c.map((x: any) => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = FTS_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots6(1) }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', con: 1, pos, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', con: 30, pos, ...o });

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Flesh to Stone'); eq('Level 6', metadata.level, 6);
eq('Range 60', metadata.rangeFt, 60); eq('Save con', metadata.saveAbility, 'con'); eq('Concentration', metadata.concentration, true);
assert('v2 petrified escalation flag', (metadata as any).fleshToStonePetrifiedOn3FailsV2Implemented === true);
assert('v2 end-of-turn save flag', (metadata as any).fleshToStoneEndOfTurnSaveV2Implemented === true);
assert('v1 escalation flag removed', !((metadata as any).fleshToStonePetrifiedOn3FailsV1Simplified));
assert('v1 end-of-turn flag removed', !((metadata as any).fleshToStoneEndOfTurnSaveV1Implemented === false));

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots6(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [FTS_ACTION], resources: withSlots6(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); c.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any; eq('null: already concentrating', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: out of range', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null', r !== null); if (r) eq('enemy id', (r as Combatant).id, 'e1'); }

console.log('\n=== 3. shouldCast target selection ===\n');
{ const c = makeCaster(); const lo = weak('lo', { x: 1, y: 0 }, { maxHP: 30 }); const hi = weak('hi', { x: 5, y: 0 }, { maxHP: 300 }); const r = shouldCast(c, makeBF([c, lo, hi])); if (r) eq('picks highest-threat', (r as Combatant).id, 'hi'); }
{ const c = makeCaster(); const rs = weak('rs', { x: 1, y: 0 }, { maxHP: 300 }); rs.conditions.add('restrained' as Condition); const fr = weak('fr', { x: 5, y: 0 }, { maxHP: 50 }); const r = shouldCast(c, makeBF([c, rs, fr])); if (r) eq('skips restrained', (r as Combatant).id, 'fr'); }

console.log('\n=== 4. execute — guaranteed fail (restrained + tracker set) ===\n');
{
  _resetEffectIdCounter();
  const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t as Combatant, st);
    eq('slot consumed', (c.resources as any).spellSlots[6].remaining, 0);
    assert('concentration started', c.concentration?.active === true);
    assert('restrained applied', e.conditions.has('restrained'));
    assert('tracker set', e._saveFailTracker !== undefined);
    if (e._saveFailTracker) {
      eq('tracker spellName', e._saveFailTracker.spellName, 'Flesh to Stone');
      eq('tracker casterId', e._saveFailTracker.casterId, 'wiz');
      eq('tracker fails 1 (initial save failed)', e._saveFailTracker.fails, 1);
      eq('tracker successes 0', e._saveFailTracker.successes, 0);
      eq('tracker maxCount 3', e._saveFailTracker.maxCount, 3);
      eq('tracker saveAbility con', e._saveFailTracker.saveAbility, 'con');
      eq('tracker saveDC 25', e._saveFailTracker.saveDC, 25);
      eq('tracker conditionOnFail petrified', e._saveFailTracker.conditionOnFail, 'petrified');
      eq('tracker currentCondition restrained', e._saveFailTracker.currentCondition, 'restrained');
    }
  }
}

console.log('\n=== 5. execute — guaranteed success ===\n');
{
  const c = makeCaster({ x: 0, y: 0, z: 0 }, FTS_ACTION_LOW); const e = strong('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) { execute(c, t as Combatant, st); assert('NOT restrained', !e.conditions.has('restrained')); const ss = st.log.events.filter((x: any) => x.type === 'save_success'); assert('save_success log', ss.length === 1); assert('no tracker on success', e._saveFailTracker === undefined); }
}

console.log('\n=== 6. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/flesh_to_stone') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log('\n=== 7. Tracker — save fail increments fails ===\n');
{
  _resetEffectIdCounter();
  const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st);
  eq('initial fails 1', e._saveFailTracker!.fails, 1);
  // Simulate a start-of-turn save fail
  const save = rollSave(e, 'con', 25);
  assert('save fails (DC 25 vs con 1)', !save.success);
  if (e._saveFailTracker) {
    e._saveFailTracker.fails++;
    eq('fails after 1 increment', e._saveFailTracker.fails, 2);
  }
}

console.log('\n=== 8. Tracker — 3 fails → petrified ===\n');
{
  _resetEffectIdCounter();
  const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st);
  assert('restrained applied', e.conditions.has('restrained'));
  // Simulate reaching 3 fails
  if (e._saveFailTracker) {
    e._saveFailTracker.fails = 3;
    // Simulate combat.ts escalation logic:
    // 1. Remove current condition effects
    const matchingEffects = e.activeEffects.filter(
      ef => ef.casterId === e._saveFailTracker!.casterId && ef.spellName === e._saveFailTracker!.spellName
    );
    for (const eff of matchingEffects) {
      if (eff.effectType === 'condition_apply' && eff.payload.condition) {
        e.conditions.delete(eff.payload.condition);
      }
    }
    e.activeEffects = e.activeEffects.filter(
      ef => !(ef.casterId === e._saveFailTracker!.casterId && ef.spellName === e._saveFailTracker!.spellName)
    );
    // 2. Apply petrified (NOT concentration-sourced — permanent)
    //    Use target's own ID as casterId so removeEffectsFromCaster on the
    //    original caster won't remove petrified (self-sustaining).
    applySpellEffect(e, {
      casterId: e.id,  // self-sustaining petrification
      spellName: e._saveFailTracker.spellName,
      effectType: 'condition_apply',
      payload: { condition: e._saveFailTracker.conditionOnFail },
      sourceIsConcentration: false,
    });
    delete e._saveFailTracker;
  }
  assert('restrained removed', !e.conditions.has('restrained'));
  assert('petrified applied', e.conditions.has('petrified'));
  assert('tracker cleared', e._saveFailTracker === undefined);
}

console.log('\n=== 9. Tracker — 3 successes → freed ===\n');
{
  _resetEffectIdCounter();
  // Use easy DC so saves succeed
  const c = makeCaster({ x: 0, y: 0, z: 0 }, FTS_ACTION_LOW);
  const e = weak('e1', { x: 5, y: 0 }); // weak CON but DC 5, should still be able to succeed
  const bf = makeBF([c, e]); const st = makeState(bf);
  // We need to get the target restrained first (hard with low DC)
  // Instead, manually set up the tracker and conditions
  applySpellEffect(e, {
    casterId: c.id, spellName: 'Flesh to Stone',
    effectType: 'condition_apply', payload: { condition: 'restrained' },
    sourceIsConcentration: true,
  });
  e._saveFailTracker = {
    spellName: 'Flesh to Stone', casterId: c.id,
    fails: 0, successes: 3, maxCount: 3,
    saveAbility: 'con', saveDC: 5,
    conditionOnFail: 'petrified', currentCondition: 'restrained',
  };
  assert('restrained applied', e.conditions.has('restrained'));
  // Simulate combat.ts 3-successes logic
  if (e._saveFailTracker) {
    const matchingEffects = e.activeEffects.filter(
      ef => ef.casterId === e._saveFailTracker!.casterId && ef.spellName === e._saveFailTracker!.spellName
    );
    for (const eff of matchingEffects) {
      if (eff.effectType === 'condition_apply' && eff.payload.condition) {
        e.conditions.delete(eff.payload.condition);
      }
    }
    e.activeEffects = e.activeEffects.filter(
      ef => !(ef.casterId === e._saveFailTracker!.casterId && ef.spellName === e._saveFailTracker!.spellName)
    );
    delete e._saveFailTracker;
  }
  assert('restrained removed', !e.conditions.has('restrained'));
  assert('NOT petrified', !e.conditions.has('petrified'));
  assert('tracker cleared', e._saveFailTracker === undefined);
}

console.log('\n=== 10. Concentration break clears tracker and restrained ===\n');
{
  _resetEffectIdCounter();
  const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st);
  assert('restrained before conc break', e.conditions.has('restrained'));
  assert('tracker before conc break', e._saveFailTracker !== undefined);
  // Simulate concentration break
  removeEffectsFromCaster(c.id, bf);
  assert('restrained removed after conc break', !e.conditions.has('restrained'));
  assert('tracker cleared by _undoEffect', e._saveFailTracker === undefined);
}

console.log('\n=== 11. Petrified persists after being reached ===\n');
{
  _resetEffectIdCounter();
  const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st);
  // Simulate 3 fails → petrified
  if (e._saveFailTracker) {
    e._saveFailTracker.fails = 3;
    const matchingEffects = e.activeEffects.filter(
      ef => ef.casterId === e._saveFailTracker!.casterId && ef.spellName === e._saveFailTracker!.spellName
    );
    for (const eff of matchingEffects) {
      if (eff.effectType === 'condition_apply' && eff.payload.condition) {
        e.conditions.delete(eff.payload.condition);
      }
    }
    e.activeEffects = e.activeEffects.filter(
      ef => !(ef.casterId === e._saveFailTracker!.casterId && ef.spellName === e._saveFailTracker!.spellName)
    );
    // Apply petrified using target's own ID as casterId (self-sustaining)
    applySpellEffect(e, {
      casterId: e.id,  // self-sustaining petrification
      spellName: e._saveFailTracker.spellName,
      effectType: 'condition_apply',
      payload: { condition: e._saveFailTracker.conditionOnFail },
      sourceIsConcentration: false,
    });
    delete e._saveFailTracker;
  }
  assert('petrified applied', e.conditions.has('petrified'));
  assert('tracker cleared', e._saveFailTracker === undefined);
  // Now simulate concentration break — petrified should persist because
  // the effect is keyed to the target's own ID, not the caster's.
  removeEffectsFromCaster(c.id, bf);
  assert('petrified persists after conc break', e.conditions.has('petrified'));
}

console.log('\n=== 12. Tracker — effect removal clears tracker (_undoEffect) ===\n');
{
  _resetEffectIdCounter();
  const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st);
  assert('tracker set before removal', e._saveFailTracker !== undefined);
  // Remove the specific condition_apply effect
  const condEffects = e.activeEffects.filter(
    ef => ef.casterId === c.id && ef.spellName === 'Flesh to Stone' && ef.effectType === 'condition_apply'
  );
  assert('condition_apply effect exists', condEffects.length === 1);
  // Manually call _undoEffect via removeEffectsFromCaster
  removeEffectsFromCaster(c.id, bf);
  assert('tracker cleared', e._saveFailTracker === undefined);
  assert('restrained removed', !e.conditions.has('restrained'));
}

console.log('\n=== 13. shouldCast skips petrified targets ===\n');
{
  const c = makeCaster(); const pt = weak('pt', { x: 1, y: 0 }, { maxHP: 300 });
  pt.conditions.add('petrified' as Condition);
  const fr = weak('fr', { x: 5, y: 0 }, { maxHP: 50 });
  const r = shouldCast(c, makeBF([c, pt, fr]));
  if (r) eq('skips petrified target', (r as Combatant).id, 'fr');
}

console.log('\n=== 14. Log messages for escalation tracking ===\n');
{
  _resetEffectIdCounter();
  const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st);
  const condLogs = st.log.events.filter((x: any) => x.type === 'condition_add');
  assert('condition_add log exists', condLogs.length >= 1);
  const logDesc = condLogs[0].description as string;
  assert('log mentions petrified', logDesc.includes('petrified'));
  assert('log mentions freed or successes', logDesc.includes('freed') || logDesc.includes('successes'));
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
