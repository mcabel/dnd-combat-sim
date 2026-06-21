// eyebite.test.ts — Eyebite v2 (Session 28)
// PHB p.238: L6, 60 ft, WIS save, 3 options (Asleep/Panicked/Sickened),
//   concentration, per-turn re-target.
import { shouldCast, execute, metadata, pickEyebiteOption, optionToCondition, EyebiteOption } from '../spells/eyebite';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';
import { applySpellEffect, removeEffectsFromCaster, _resetEffectIdCounter } from '../engine/spell_effects';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

function withSlots6(remaining = 1): PlayerResources { return { spellSlots: { 6: { max: 1, remaining } } }; }
const EB_ACTION: Action = {
  name: 'Eyebite', isMultiattack: false, attackType: 'save', reach: 5,
  range: { normal: 60, long: 60 }, hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'wis', isAoE: false, isControl: true,
  requiresConcentration: true, slotLevel: 6, costType: 'action', legendaryCost: 0, description: 'Eyebite',
};
const EB_ACTION_LOW: Action = { ...EB_ACTION, saveDC: 5 };
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
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map((x: any) => [x.id, x])), initiativeOrder: c.map((x: any) => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = EB_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots6(1) }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', wis: 1, pos, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', wis: 30, pos, ...o });

// =====================================================================
console.log('\n=== 1. Metadata ===\n');
// =====================================================================
eq('Name', metadata.name, 'Eyebite');
eq('Level 6', metadata.level, 6);
eq('Range 60', metadata.rangeFt, 60);
eq('Save wis', metadata.saveAbility, 'wis');
eq('Concentration', metadata.concentration, true);
eq('v2 options flag', (metadata as any).eyebiteOptionsV2Implemented, true);
eq('v2 re-target flag', (metadata as any).eyebitePerTurnRetargetV2Implemented, true);
eq('v1 re-target action cost flag', (metadata as any).eyebitePerTurnRetargetActionCostV1Simplified, true);
eq('v1 wake-on-damage flag', (metadata as any).eyebiteWakeOnDamageV1Simplified, true);
assert('v1 always-asleep flag REMOVED', (metadata as any).eyebiteAlwaysPicksAsleepV1Simplified === undefined);
assert('v1 one-shot flag REMOVED', (metadata as any).eyebitePerTurnRetargetV1Simplified === undefined);

// =====================================================================
console.log('\n=== 2. optionToCondition ===\n');
// =====================================================================
eq('asleep → sleeping', optionToCondition('asleep'), 'sleeping');
eq('panicked → frightened', optionToCondition('panicked'), 'frightened');
eq('sickened → poisoned', optionToCondition('sickened'), 'poisoned');

// =====================================================================
console.log('\n=== 3. pickEyebiteOption — distance-based AI ===\n');
// =====================================================================
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // ≤20 ft → panicked (frightened)
  const close = weak('close', { x: 2, y: 0, z: 0 });  // 2 squares = 10 ft
  eq('10 ft → panicked', pickEyebiteOption(close, caster), 'panicked');
  const at20 = weak('at20', { x: 4, y: 0, z: 0 });    // 4 squares = 20 ft
  eq('20 ft → panicked', pickEyebiteOption(at20, caster), 'panicked');

  // ≤40 ft → sickened (poisoned)
  const mid = weak('mid', { x: 5, y: 0, z: 0 });      // 5 squares = 25 ft
  eq('25 ft → sickened', pickEyebiteOption(mid, caster), 'sickened');
  const at40 = weak('at40', { x: 8, y: 0, z: 0 });    // 8 squares = 40 ft
  eq('40 ft → sickened', pickEyebiteOption(at40, caster), 'sickened');

  // >40 ft → asleep (sleeping)
  const far = weak('far', { x: 9, y: 0, z: 0 });      // 9 squares = 45 ft
  eq('45 ft → asleep', pickEyebiteOption(far, caster), 'asleep');
  const veryFar = weak('veryFar', { x: 12, y: 0, z: 0 }); // 60 ft
  eq('60 ft → asleep', pickEyebiteOption(veryFar, caster), 'asleep');

  // Diagonal distance (chebyshev)
  const diag15 = weak('diag15', { x: 2, y: 2, z: 0 });  // max(2,2) = 2 sq = 10 ft
  eq('diagonal 10 ft → panicked', pickEyebiteOption(diag15, caster), 'panicked');
  const diag30 = weak('diag30', { x: 4, y: 5, z: 0 });  // max(4,5) = 5 sq = 25 ft
  eq('diagonal 25 ft → sickened', pickEyebiteOption(diag30, caster), 'sickened');
}

// =====================================================================
console.log('\n=== 4. shouldCast gates ===\n');
// =====================================================================
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots6(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [EB_ACTION], resources: withSlots6(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); c.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any; eq('null: already concentrating', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: out of range', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null', r !== null); if (r) eq('enemy id', (r as Combatant).id, 'e1'); }

// =====================================================================
console.log('\n=== 5. shouldCast target selection ===\n');
// =====================================================================
{ const c = makeCaster(); const lo = weak('lo', { x: 1, y: 0 }, { maxHP: 30 }); const hi = weak('hi', { x: 5, y: 0 }, { maxHP: 300 }); const r = shouldCast(c, makeBF([c, lo, hi])); if (r) eq('picks highest-threat', (r as Combatant).id, 'hi'); }
{ const c = makeCaster(); const sl = weak('sl', { x: 1, y: 0 }, { maxHP: 300 }); sl.conditions.add('sleeping' as Condition); const fr = weak('fr', { x: 5, y: 0 }, { maxHP: 50 }); const r = shouldCast(c, makeBF([c, sl, fr])); if (r) eq('skips sleeping', (r as Combatant).id, 'fr'); }
{ const c = makeCaster(); const inc = weak('inc', { x: 1, y: 0 }, { maxHP: 300 }); inc.conditions.add('incapacitated' as Condition); const fr = weak('fr', { x: 5, y: 0 }, { maxHP: 50 }); const r = shouldCast(c, makeBF([c, inc, fr])); if (r) eq('skips incapacitated', (r as Combatant).id, 'fr'); }

// =====================================================================
console.log('\n=== 6. execute — Asleep option (distant target) ===\n');
// =====================================================================
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e = weak('e1', { x: 9, y: 0, z: 0 });  // 45 ft → asleep
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t as Combatant, st);
    eq('slot consumed', (c.resources as any).spellSlots[6].remaining, 0);
    assert('concentration started', c.concentration?.active === true);
    assert('sleeping applied', e.conditions.has('sleeping'));
    assert('_eyebiteActive set', c._eyebiteActive !== undefined);
    eq('_eyebiteActive.saveDC', c._eyebiteActive!.saveDC, 25);
    // Sentinel effect present on caster
    const sentinel = c.activeEffects.find(eff => eff.effectType === 'damage_zone' && eff.spellName === 'Eyebite');
    assert('sentinel on caster', sentinel !== undefined);
    if (sentinel) {
      eq('sentinel dieCount', sentinel!.payload.dieCount, 0);
      eq('sentinel dieSides', sentinel!.payload.dieSides, 0);
    }
    // Condition effect on target
    const condEff = e.activeEffects.find(eff => eff.spellName === 'Eyebite' && eff.effectType === 'condition_apply');
    assert('condition effect on target', condEff !== undefined);
    if (condEff) eq('condition is sleeping', condEff!.payload.condition, 'sleeping');
  }
}

// =====================================================================
console.log('\n=== 7. execute — Panicked option (close target) ===\n');
// =====================================================================
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e = weak('e1', { x: 2, y: 0, z: 0 });  // 10 ft → panicked
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t as Combatant, st);
    assert('frightened applied', e.conditions.has('frightened'));
    assert('NOT sleeping', !e.conditions.has('sleeping'));
    assert('NOT poisoned', !e.conditions.has('poisoned'));
    const condEff = e.activeEffects.find(eff => eff.spellName === 'Eyebite' && eff.effectType === 'condition_apply');
    if (condEff) eq('condition is frightened', condEff!.payload.condition, 'frightened');
  }
}

// =====================================================================
console.log('\n=== 8. execute — Sickened option (mid-range target) ===\n');
// =====================================================================
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e = weak('e1', { x: 5, y: 0, z: 0 });  // 25 ft → sickened
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t as Combatant, st);
    assert('poisoned applied', e.conditions.has('poisoned'));
    assert('NOT sleeping', !e.conditions.has('sleeping'));
    assert('NOT frightened', !e.conditions.has('frightened'));
    const condEff = e.activeEffects.find(eff => eff.spellName === 'Eyebite' && eff.effectType === 'condition_apply');
    if (condEff) eq('condition is poisoned', condEff!.payload.condition, 'poisoned');
  }
}

// =====================================================================
console.log('\n=== 9. execute — guaranteed save success ===\n');
// =====================================================================
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 }, EB_ACTION_LOW);  // saveDC 5
  const e = strong('e1', { x: 9, y: 0, z: 0 });  // wis:30 → always passes DC 5
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t as Combatant, st);
    assert('NOT sleeping', !e.conditions.has('sleeping'));
    assert('NOT frightened', !e.conditions.has('frightened'));
    assert('NOT poisoned', !e.conditions.has('poisoned'));
    const ss = st.log.events.filter((x: any) => x.type === 'save_success');
    assert('save_success log', ss.length === 1);
  }
}

// =====================================================================
console.log('\n=== 10. execute — concentration + sentinel lifecycle ===\n');
// =====================================================================
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e = weak('e1', { x: 5, y: 0, z: 0 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  execute(c, e, st);

  // Verify initial state
  assert('_eyebiteActive set', c._eyebiteActive !== undefined);
  assert('concentration active', c.concentration?.active === true);

  // Simulate concentration break
  removeEffectsFromCaster(c.id, bf);

  // After cleanup
  assert('_eyebiteActive cleared after conc break', c._eyebiteActive === undefined);
  assert('condition removed from target', !e.conditions.has('poisoned'));
  // Target's active effects cleared
  const targetEffects = e.activeEffects.filter(eff => eff.casterId === c.id && eff.spellName === 'Eyebite');
  eq('target Eyebite effects cleared', targetEffects.length, 0);
  // Caster's sentinel cleared
  const casterEffects = c.activeEffects.filter(eff => eff.casterId === c.id && eff.spellName === 'Eyebite');
  eq('caster Eyebite effects cleared', casterEffects.length, 0);
}

// =====================================================================
console.log('\n=== 11. execute — log messages ===\n');
// =====================================================================
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e = weak('e1', { x: 2, y: 0, z: 0 });  // 10 ft → panicked
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  execute(c, e, st);
  const descs = st.log.events.map((ev: any) => ev.description);
  assert('log has "Panicked option"', descs.some((d: any) => d.includes('Panicked option')));
  assert('log has "PANICKED"', descs.some((d: any) => d.includes('PANICKED')));
}
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e = weak('e1', { x: 5, y: 0, z: 0 });  // 25 ft → sickened
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  execute(c, e, st);
  const descs = st.log.events.map((ev: any) => ev.description);
  assert('log has "Sickened option"', descs.some((d: any) => d.includes('Sickened option')));
  assert('log has "SICKENED"', descs.some((d: any) => d.includes('SICKENED')));
}
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e = weak('e1', { x: 9, y: 0, z: 0 });  // 45 ft → asleep
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  execute(c, e, st);
  const descs = st.log.events.map((ev: any) => ev.description);
  assert('log has "Asleep option"', descs.some((d: any) => d.includes('Asleep option')));
  assert('log has "ASLEEP"', descs.some((d: any) => d.includes('ASLEEP')));
}

// =====================================================================
console.log('\n=== 12. Cleanup no-op ===\n');
// =====================================================================
{ let ok = true; try { (require('../spells/eyebite') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

// =====================================================================
console.log('\n=== 13. Per-turn re-target — manual simulation ===\n');
// =====================================================================
// Test the re-target logic manually (same logic that combat.ts uses)
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = weak('e1', { x: 2, y: 0, z: 0 });  // 10 ft → close → panicked
  const e2 = weak('e2', { x: 9, y: 0, z: 0 });  // 45 ft → far → asleep
  const bf = makeBF([c, e1, e2]);
  const st = makeState(bf);

  // Initial cast on e1 (highest threat if maxHP higher, or closer)
  // Let's give e1 higher maxHP so it's picked first
  e1.maxHP = 200;
  e2.maxHP = 100;
  execute(c, e1, st);

  assert('e1 has condition after initial cast', e1.conditions.has('frightened'));
  assert('_eyebiteActive set', c._eyebiteActive !== undefined);
  eq('saveDC stored', c._eyebiteActive!.saveDC, 25);

  // Simulate per-turn re-target (same logic as combat.ts)
  // After e1 is already affected, re-target should find e2
  if (c._eyebiteActive && c.concentration?.active && c.concentration.spellName === 'Eyebite') {
    const saveDC = c._eyebiteActive.saveDC;
    const eyebiteTargets: Combatant[] = [];
    for (const combatant of bf.combatants.values()) {
      if (combatant.id === c.id) continue;
      if (combatant.faction === c.faction) continue;
      if (combatant.isDead || combatant.isUnconscious) continue;
      const { chebyshev3D: cheb } = require('../engine/movement');
      const distFt = cheb(c.pos, combatant.pos) * 5;
      if (distFt > 60) continue;
      if (combatant.activeEffects.some((e: any) => e.casterId === c.id && e.spellName === 'Eyebite' && e.effectType === 'condition_apply')) continue;
      if (combatant.conditions.has('sleeping') || combatant.conditions.has('incapacitated')) continue;
      eyebiteTargets.push(combatant);
    }

    eq('re-target finds 1 candidate', eyebiteTargets.length, 1);
    if (eyebiteTargets.length > 0) {
      eq('re-target finds e2', eyebiteTargets[0].id, 'e2');
    }
  }
}

// =====================================================================
console.log('\n=== 14. Re-target skips already-affected targets ===\n');
// =====================================================================
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = weak('e1', { x: 2, y: 0, z: 0 }, { maxHP: 200 });
  const e2 = weak('e2', { x: 5, y: 0, z: 0 }, { maxHP: 100 });
  const bf = makeBF([c, e1, e2]);
  const st = makeState(bf);

  // Cast on e1
  execute(c, e1, st);

  // Mark e2 as also already affected by this caster's Eyebite
  applySpellEffect(e2, {
    casterId: c.id,
    spellName: 'Eyebite',
    effectType: 'condition_apply',
    payload: { condition: 'sleeping' as Condition },
    sourceIsConcentration: true,
  });

  // Re-target should find NO valid targets
  if (c._eyebiteActive && c.concentration?.active && c.concentration.spellName === 'Eyebite') {
    const eyebiteTargets: Combatant[] = [];
    for (const combatant of bf.combatants.values()) {
      if (combatant.id === c.id) continue;
      if (combatant.faction === c.faction) continue;
      if (combatant.isDead || combatant.isUnconscious) continue;
      if (combatant.activeEffects.some((e: any) => e.casterId === c.id && e.spellName === 'Eyebite' && e.effectType === 'condition_apply')) continue;
      if (combatant.conditions.has('sleeping') || combatant.conditions.has('incapacitated')) continue;
      eyebiteTargets.push(combatant);
    }
    eq('no valid re-targets when all affected', eyebiteTargets.length, 0);
  }
}

// =====================================================================
console.log('\n=== 15. Re-target skips sleeping/incapacitated targets ===\n');
// =====================================================================
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = weak('e1', { x: 2, y: 0, z: 0 }, { maxHP: 200 });
  const e2 = weak('e2', { x: 5, y: 0, z: 0 }, { maxHP: 100 });
  e2.conditions.add('sleeping' as Condition);  // sleeping from another source
  const bf = makeBF([c, e1, e2]);
  const st = makeState(bf);

  execute(c, e1, st);

  // Re-target: e2 is sleeping → should be skipped even though not affected by this Eyebite
  if (c._eyebiteActive && c.concentration?.active && c.concentration.spellName === 'Eyebite') {
    const eyebiteTargets: Combatant[] = [];
    for (const combatant of bf.combatants.values()) {
      if (combatant.id === c.id) continue;
      if (combatant.faction === c.faction) continue;
      if (combatant.isDead || combatant.isUnconscious) continue;
      if (combatant.activeEffects.some((e: any) => e.casterId === c.id && e.spellName === 'Eyebite' && e.effectType === 'condition_apply')) continue;
      if (combatant.conditions.has('sleeping') || combatant.conditions.has('incapacitated')) continue;
      eyebiteTargets.push(combatant);
    }
    eq('no valid re-targets when remaining targets sleeping', eyebiteTargets.length, 0);
  }
}

// =====================================================================
console.log('\n=== 16. Re-target skips out-of-range targets ===\n');
// =====================================================================
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = weak('e1', { x: 2, y: 0, z: 0 }, { maxHP: 200 });
  const e2 = weak('e2', { x: 50, y: 0, z: 0 }, { maxHP: 100 });  // 250 ft → out of range
  const bf = makeBF([c, e1, e2]);
  const st = makeState(bf);

  execute(c, e1, st);

  if (c._eyebiteActive && c.concentration?.active && c.concentration.spellName === 'Eyebite') {
    const { chebyshev3D: cheb } = require('../engine/movement');
    const eyebiteTargets: Combatant[] = [];
    for (const combatant of bf.combatants.values()) {
      if (combatant.id === c.id) continue;
      if (combatant.faction === c.faction) continue;
      if (combatant.isDead || combatant.isUnconscious) continue;
      const distFt = cheb(c.pos, combatant.pos) * 5;
      if (distFt > 60) continue;
      if (combatant.activeEffects.some((e: any) => e.casterId === c.id && e.spellName === 'Eyebite' && e.effectType === 'condition_apply')) continue;
      if (combatant.conditions.has('sleeping') || combatant.conditions.has('incapacitated')) continue;
      eyebiteTargets.push(combatant);
    }
    eq('out-of-range target not found', eyebiteTargets.length, 0);
  }
}

// =====================================================================
console.log('\n=== 17. Sentinel effect is damage_zone with dieCount=0 ===\n');
// =====================================================================
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e = weak('e1', { x: 2, y: 0, z: 0 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  execute(c, e, st);

  const sentinel = c.activeEffects.find(eff => eff.effectType === 'damage_zone' && eff.spellName === 'Eyebite');
  assert('sentinel exists', sentinel !== undefined);
  if (sentinel) {
    eq('effectType', sentinel!.effectType, 'damage_zone');
    eq('dieCount', sentinel!.payload.dieCount, 0);
    eq('dieSides', sentinel!.payload.dieSides, 0);
    eq('damageType', sentinel!.payload.damageType, 'psychic');
    eq('casterId', sentinel!.casterId, c.id);
    eq('sourceIsConcentration', sentinel!.sourceIsConcentration, true);
  }
}

// =====================================================================
console.log('\n=== 18. Concentration break clears _eyebiteActive ===\n');
// =====================================================================
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e = weak('e1', { x: 2, y: 0, z: 0 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  execute(c, e, st);

  assert('_eyebiteActive set before break', c._eyebiteActive !== undefined);

  removeEffectsFromCaster(c.id, bf);

  assert('_eyebiteActive cleared', c._eyebiteActive === undefined);
  assert('target condition removed', !e.conditions.has('frightened'));
}

// =====================================================================
console.log('\n=== 19. Dead target — no effect applied ===\n');
// =====================================================================
{
  _resetEffectIdCounter();
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e = weak('e1', { x: 2, y: 0, z: 0 });
  e.isDead = true;
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  // shouldCast skips dead targets, so force-execute
  execute(c, e, st);
  assert('no condition on dead target', !e.conditions.has('frightened'));
  // But concentration still started and sentinel placed
  assert('concentration started even for dead target', c.concentration?.active === true);
  assert('_eyebiteActive set', c._eyebiteActive !== undefined);
}

// =====================================================================
console.log('\n=== 20. shouldCast skips already-eyebited targets ===\n');
// =====================================================================
{
  const c = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = weak('e1', { x: 2, y: 0, z: 0 });
  // Mark e1 as already affected by this caster's Eyebite
  e1.activeEffects.push({
    id: 'eff_test',
    casterId: c.id,
    spellName: 'Eyebite',
    effectType: 'condition_apply',
    payload: { condition: 'frightened' as Condition },
    sourceIsConcentration: true,
  });
  const bf = makeBF([c, e1]);
  const r = shouldCast(c, bf);
  eq('null: already eyebited by same caster', r, null);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
