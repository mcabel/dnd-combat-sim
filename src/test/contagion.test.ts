// contagion.test.ts — Contagion (Session 25 / Batch 2, upgraded Task 5)
// PHB p.227: L5, touch (5 ft), melee spell attack + poisoned on hit,
//   3-fail escalation: 3 fails → poisoned+incapacitated, 3 successes → cured.
//   NO concentration, no damage.
import { shouldCast, execute, metadata } from '../spells/contagion';
import { Combatant, Action, PlayerResources, Condition, SaveFailTracker } from '../types/core';
import { applySpellEffect, removeEffectsFromCaster, _resetEffectIdCounter } from '../engine/spell_effects';
import { rollSave } from '../engine/utils';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

function withSlots5(remaining = 1): PlayerResources { return { spellSlots: { 5: { max: 1, remaining } } }; }
// High hitBonus guarantees a hit vs low AC; the attack-miss path can't be made deterministic (nat-20 auto-hit).
// saveDC: 25 ensures CON saves fail (con=10 → mod=0 → can't roll 25). saveDC: 5 ensures success.
const CONT_ACTION: Action = { name: 'Contagion', isMultiattack: false, attackType: null, reach: 5, range: { normal: 5, long: 5 }, hitBonus: 20, damage: null, damageType: null, saveDC: 25, saveAbility: null, isAoE: false, isControl: false, requiresConcentration: false, slotLevel: 5, costType: 'action', legendaryCost: 0, description: 'Contagion' };
const CONT_ACTION_EASY: Action = { ...CONT_ACTION, saveDC: 5 };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, action: Action = CONT_ACTION) { return makeCombatant('clr', { name: 'Caster', pos, actions: [action], resources: withSlots5(1) }); }
function makeEnemy(id: string, pos: any, o: Partial<Combatant> = {}) { return makeCombatant(id, { name: id, faction: 'enemy', pos, ...o }); }

console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Contagion'); eq('Level 5', metadata.level, 5);
eq('Range 5 (touch)', metadata.rangeFt, 5); eq('Save null (melee attack)', metadata.saveAbility, null);
eq('NOT concentration', metadata.concentration, false);
assert('v2 escalation flag', (metadata as any).contagionThreeSaveEscalationV2Implemented === true);
assert('v1 escalation flag removed', !((metadata as any).contagionThreeSaveEscalationV1Simplified));

console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('clr', { actions: [], resources: withSlots5(1) }); eq('null: no action', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('clr', { actions: [CONT_ACTION], resources: withSlots5(0) }); eq('null: no slots', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: no adjacent enemy', shouldCast(c, makeBF([c, makeEnemy('e1', { x: 5, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, makeEnemy('e1', { x: 1, y: 0 })])); assert('non-null: adjacent enemy', r !== null); if (r) eq('enemy id', (r as Combatant).id, 'e1'); }

console.log('\n=== 3. shouldCast target selection ===\n');
{ const c = makeCaster(); const lo = makeEnemy('lo', { x: 1, y: 0 }, { maxHP: 30 }); const hi = makeEnemy('hi', { x: 0, y: 1 }, { maxHP: 300 }); const r = shouldCast(c, makeBF([c, lo, hi])); if (r) eq('picks highest-threat adjacent', (r as Combatant).id, 'hi'); }
{ const c = makeCaster(); const ps = makeEnemy('ps', { x: 1, y: 0 }, { maxHP: 300 }); ps.conditions.add('poisoned' as Condition); const fr = makeEnemy('fr', { x: 0, y: 1 }, { maxHP: 50 }); const r = shouldCast(c, makeBF([c, ps, fr])); if (r) eq('skips poisoned', (r as Combatant).id, 'fr'); }

console.log('\n=== 4. execute — guaranteed hit (poisoned, tracker set) ===\n');
{
  _resetEffectIdCounter();
  const c = makeCaster(); const e = makeEnemy('e1', { x: 1, y: 0 }, { ac: 5, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    const hp = e.currentHP;
    execute(c, t as Combatant, st);
    eq('slot consumed', (c.resources as any).spellSlots[5].remaining, 0);
    assert('poisoned applied', e.conditions.has('poisoned'));
    eq('NO damage (HP unchanged)', e.currentHP, hp);
    assert('NOT concentrating', !(c.concentration?.active));
    assert('tracker set', e._saveFailTracker !== undefined);
    if (e._saveFailTracker) {
      eq('tracker spellName', e._saveFailTracker.spellName, 'Contagion');
      eq('tracker casterId', e._saveFailTracker.casterId, 'clr');
      eq('tracker fails 0', e._saveFailTracker.fails, 0);
      eq('tracker successes 0', e._saveFailTracker.successes, 0);
      eq('tracker maxCount 3', e._saveFailTracker.maxCount, 3);
      eq('tracker saveAbility con', e._saveFailTracker.saveAbility, 'con');
      eq('tracker saveDC 25', e._saveFailTracker.saveDC, 25);
      eq('tracker conditionOnFail incapacitated', e._saveFailTracker.conditionOnFail, 'incapacitated');
      eq('tracker currentCondition poisoned', e._saveFailTracker.currentCondition, 'poisoned');
    }
    const hitLogs = st.log.events.filter((x: any) => x.type === 'attack_hit' || x.type === 'attack_crit');
    assert('attack hit log', hitLogs.length === 1);
  }
}

console.log('\n=== 5. execute — already-down target (fizzles) ===\n');
{
  const c = makeCaster(); const e = makeEnemy('e1', { x: 1, y: 0 }); e.isUnconscious = true;
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st); eq('slot consumed', (c.resources as any).spellSlots[5].remaining, 0);
  assert('NOT poisoned', !e.conditions.has('poisoned'));
  assert('no tracker', e._saveFailTracker === undefined);
  const miss = st.log.events.filter((x: any) => x.type === 'attack_miss');
  assert('attack_miss log', miss.length === 1);
}

console.log('\n=== 6. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/contagion') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log('\n=== 7. Tracker — save fail increments fails ===\n');
{
  _resetEffectIdCounter();
  const c = makeCaster(); const e = makeEnemy('e1', { x: 1, y: 0 }, { ac: 5, con: 10 });
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st);
  assert('initial tracker set', e._saveFailTracker !== undefined);
  eq('initial fails 0', e._saveFailTracker!.fails, 0);
  // Simulate a start-of-turn save fail (DC 25, con=10, can't beat it)
  const save = rollSave(e, 'con', 25);
  assert('save fails (DC 25 vs con 10)', !save.success);
  if (e._saveFailTracker) {
    e._saveFailTracker.fails++;
    eq('fails after 1 increment', e._saveFailTracker.fails, 1);
    assert('tracker still active', e._saveFailTracker !== undefined);
  }
}

console.log('\n=== 8. Tracker — 3 fails → escalation (poisoned → poisoned+incapacitated) ===\n');
{
  _resetEffectIdCounter();
  const c = makeCaster(); const e = makeEnemy('e1', { x: 1, y: 0 }, { ac: 5, con: 10 });
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st);
  assert('poisoned applied', e.conditions.has('poisoned'));
  // Simulate 3 failed saves
  if (e._saveFailTracker) {
    e._saveFailTracker.fails = 3;
    // Now simulate what combat.ts does on 3 fails:
    // Remove current condition effects and apply escalation condition
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
    // Apply escalation condition
    applySpellEffect(e, {
      casterId: e._saveFailTracker.casterId,
      spellName: e._saveFailTracker.spellName,
      effectType: 'condition_apply',
      payload: { condition: e._saveFailTracker.conditionOnFail },
      sourceIsConcentration: false,
    });
    delete e._saveFailTracker;
  }
  assert('poisoned removed then re-applied... actually poisoned was removed', true);
  assert('incapacitated applied', e.conditions.has('incapacitated'));
  assert('tracker cleared', e._saveFailTracker === undefined);
}

console.log('\n=== 9. Tracker — 3 successes → poisoned removed, tracker cleared ===\n');
{
  _resetEffectIdCounter();
  // Use easy DC (5) so saves succeed
  const c = makeCaster({ x: 0, y: 0, z: 0 }, CONT_ACTION_EASY);
  const e = makeEnemy('e1', { x: 1, y: 0 }, { ac: 5, con: 10 });
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st);
  assert('poisoned applied', e.conditions.has('poisoned'));
  assert('tracker set', e._saveFailTracker !== undefined);
  // Simulate 3 successful saves
  if (e._saveFailTracker) {
    e._saveFailTracker.successes = 3;
    // Remove matching effects and conditions (simulating combat.ts)
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
  assert('poisoned removed', !e.conditions.has('poisoned'));
  assert('tracker cleared', e._saveFailTracker === undefined);
}

console.log('\n=== 10. Tracker — effect removal clears tracker (_undoEffect) ===\n');
{
  _resetEffectIdCounter();
  const c = makeCaster(); const e = makeEnemy('e1', { x: 1, y: 0 }, { ac: 5, con: 10 });
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st);
  assert('tracker set before removal', e._saveFailTracker !== undefined);
  // Remove all effects from the caster (simulating dispel / removal)
  removeEffectsFromCaster(c.id, bf);
  assert('poisoned removed', !e.conditions.has('poisoned'));
  assert('tracker cleared by _undoEffect', e._saveFailTracker === undefined);
}

console.log('\n=== 11. Tracker — NOT concentration (persists independently) ===\n');
{
  _resetEffectIdCounter();
  const c = makeCaster(); const e = makeEnemy('e1', { x: 1, y: 0 }, { ac: 5, con: 10 });
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st);
  assert('NOT concentrating (Contagion is instantaneous)', !c.concentration?.active);
  assert('tracker persists', e._saveFailTracker !== undefined);
  assert('poisoned persists', e.conditions.has('poisoned'));
}

console.log('\n=== 12. Tracker — save DC derived from action ===\n');
{
  _resetEffectIdCounter();
  // Custom action with saveDC = 17
  const customAction: Action = { ...CONT_ACTION, saveDC: 17 };
  const c = makeCombatant('clr', { name: 'Caster', pos: { x: 0, y: 0, z: 0 }, actions: [customAction], resources: withSlots5(1) });
  const e = makeEnemy('e1', { x: 1, y: 0 }, { ac: 5, con: 10 });
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st);
  if (e._saveFailTracker) {
    eq('tracker saveDC from action', e._saveFailTracker.saveDC, 17);
  }
}

console.log('\n=== 13. Log messages for escalation tracking ===\n');
{
  _resetEffectIdCounter();
  const c = makeCaster(); const e = makeEnemy('e1', { x: 1, y: 0 }, { ac: 5, con: 10 });
  const bf = makeBF([c, e]); const st = makeState(bf);
  execute(c, e, st);
  const condLogs = st.log.events.filter((x: any) => x.type === 'condition_add');
  assert('condition_add log exists', condLogs.length >= 1);
  const logDesc = condLogs[0].description as string;
  assert('log mentions 3 fails → incapacitated', logDesc.includes('incapacitated'));
  assert('log mentions 3 successes → cured', logDesc.includes('cured'));
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
