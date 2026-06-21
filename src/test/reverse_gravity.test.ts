// reverse_gravity.test.ts — Reverse Gravity (Session 25 / Batch 2 → Session 28 v2)
// PHB p.277: L7, 100 ft, 50-ft radius AoE, DEX save or restrained, concentration.
// v2: Failed save → restrained + _fallHeight=100; concentration break → fall damage.
import { shouldCast, execute, metadata } from '../spells/reverse_gravity';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

function withSlots7(remaining = 1): PlayerResources { return { spellSlots: { 7: { max: 1, remaining } } }; }
const RG_ACTION: Action = {
  name: 'Reverse Gravity', isMultiattack: false, attackType: 'save', reach: 5,
  range: { normal: 100, long: 100 }, hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: true,
  requiresConcentration: true, slotLevel: 7, costType: 'action', legendaryCost: 0, description: 'Reverse Gravity',
};
const RG_ACTION_LOW: Action = { ...RG_ACTION, saveDC: 5 };
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
function makeBF(c: Combatant[]) { return { width: 120, height: 120, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = RG_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots7(1) }); }
function makeEnemy(id: string, pos: any, o: Partial<Combatant> = {}) { return makeCombatant(id, { name: id, faction: 'enemy', pos, ...o }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeEnemy(id, pos, { dex: 1, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeEnemy(id, pos, { dex: 30, ...o });

// ---- v2 helper: processFallDamage (mirrors combat.ts) ----
// For testing, we simulate what happens when removeEffectsFromCaster is called
// and then processFallDamage would fire.
import { rollDie, applyDamageWithTempHP } from '../engine/utils';

function processFallDamage(state: any): void {
  const bf = state.battlefield;
  for (const c of bf.combatants.values()) {
    if (!c._fallHeight || c._fallHeight <= 0) continue;
    if (c.isDead) { delete c._fallHeight; continue; }
    const hasRGEffect = c.activeEffects.some((e: any) => e.spellName === 'Reverse Gravity');
    if (hasRGEffect) continue;
    const fallHeight = c._fallHeight;
    const diceCount = Math.min(Math.floor(fallHeight / 10), 20);
    let fallDmg = 0;
    for (let i = 0; i < diceCount; i++) fallDmg += rollDie(6);
    const dealt = applyDamageWithTempHP(c, fallDmg, 'bludgeoning');
    state.log.events.push({
      round: bf.round, actorId: c.id, type: 'damage', targetId: c.id, value: dealt,
      description: `${c.name} falls ${fallHeight} ft and takes ${dealt} bludgeoning damage! (Reverse Gravity ended)`,
    });
    if (c.currentHP <= 0 && !c.isPlayer) c.isDead = true;
    if (c.currentHP <= 0 && c.isPlayer) c.isUnconscious = true;
    delete c._fallHeight;
  }
}

// ============================================================
// 1. Metadata
// ============================================================
console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Reverse Gravity'); eq('Level 7', metadata.level, 7);
eq('Range 100', metadata.rangeFt, 100); eq('AoE 50', metadata.aoeRadiusFt, 50);
eq('Save dex', metadata.saveAbility, 'dex'); eq('Concentration', metadata.concentration, true);
assert('v2 fall damage flag', (metadata as any).reverseGravityFallDamageV2 === true);
assert('v1 simplified flags removed', (metadata as any).reverseGravityFallUpwardSimplifiedToRestrained === undefined);
assert('v1 fall simplified flag removed', (metadata as any).reverseGravityFallDamageV1Simplified === undefined);

// ============================================================
// 2. shouldCast gates
// ============================================================
console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots7(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [RG_ACTION], resources: withSlots7(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); c.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any; eq('null: already concentrating', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: no enemy in 100ft', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null: enemy in range', r !== null); if (r) { assert('is array', Array.isArray(r)); eq('catches e1', r[0].id, 'e1'); } }

// ============================================================
// 3. shouldCast AoE shape
// ============================================================
console.log('\n=== 3. shouldCast AoE shape ===\n');
{
  const c = makeCaster();
  const center = weak('center', { x: 5, y: 0 }, { maxHP: 300 });
  const near = weak('near', { x: 7, y: 0 }, { maxHP: 50 });
  const far = weak('far', { x: 12, y: 0 }, { maxHP: 200 });
  const tooFar = weak('tooFar', { x: 16, y: 0 }, { maxHP: 250 });
  const r = shouldCast(c, makeBF([c, center, near, far, tooFar]));
  if (r) { const ids = r.map(x => x.id).sort(); eq('catches center+near+far (≤50ft of center), excludes tooFar', ids.join(','), 'center,far,near'); }
}

// ============================================================
// 4. execute — guaranteed fail (restrained + _fallHeight)
// ============================================================
console.log('\n=== 4. execute — guaranteed fail (restrained + _fallHeight) ===\n');
{
  const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    eq('slot consumed', (c.resources as any).spellSlots[7].remaining, 0);
    assert('concentration started', c.concentration?.active === true);
    assert('restrained', e.conditions.has('restrained'));
    assert('no immediate damage', e.currentHP === 1000);
    // v2: _fallHeight set
    eq('_fallHeight set to 100', e._fallHeight, 100);
  }
}

// ============================================================
// 5. execute — guaranteed success
// ============================================================
console.log('\n=== 5. execute — guaranteed success ===\n');
{
  const c = makeCaster({ x: 0, y: 0, z: 0 }, RG_ACTION_LOW); const e = strong('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    assert('NOT restrained', !e.conditions.has('restrained'));
    assert('no _fallHeight on success', (e as any)._fallHeight === undefined);
    const ss = st.log.events.filter(x => x.type === 'save_success');
    assert('save_success log', ss.length === 1);
  }
}

// ============================================================
// 6. Cleanup no-op
// ============================================================
console.log('\n=== 6. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/reverse_gravity') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

// ============================================================
// 7. Fall damage on concentration break (v2 core mechanic)
// ============================================================
console.log('\n=== 7. Fall damage on concentration break ===\n');
{
  const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 }, { maxHP: 200, currentHP: 200 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    assert('pre-break: restrained', e.conditions.has('restrained'));
    eq('pre-break: _fallHeight', e._fallHeight, 100);

    // Simulate concentration break: remove effects, then process fall damage
    removeEffectsFromCaster(c.id, bf);
    processFallDamage(st);

    assert('post-break: NOT restrained', !e.conditions.has('restrained'));
    assert('post-break: took fall damage (HP < 200)', e.currentHP < 200);
    assert('post-break: _fallHeight cleared', e._fallHeight === undefined);
    // Fall damage for 100 ft = 10d6 bludgeoning (range: 10–60)
    assert('post-break: fall damage in range [10, 60]', e.currentHP >= 200 - 60 && e.currentHP <= 200 - 10);
    // Log entry
    const fallLogs = st.log.events.filter((x: any) => x.type === 'damage' && x.description?.includes('falls 100 ft'));
    assert('fall damage logged', fallLogs.length === 1);
  }
}

// ============================================================
// 8. Fall damage respects temp HP
// ============================================================
console.log('\n=== 8. Fall damage respects temp HP ===\n');
{
  const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 }, { maxHP: 200, currentHP: 200, tempHP: 30 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    const hpBeforeFall = e.currentHP;
    const tempBefore = e.tempHP;

    removeEffectsFromCaster(c.id, bf);
    processFallDamage(st);

    // Temp HP should absorb some damage before current HP is reduced
    assert('temp HP reduced or zero', e.tempHP < tempBefore || e.tempHP === 0);
    // Current HP should be reduced (fall damage = 10d6 = 10–60, temp HP = 30)
    assert('current HP reduced', e.currentHP < hpBeforeFall);
  }
}

// ============================================================
// 9. Fall damage kills low-HP creature
// ============================================================
console.log('\n=== 9. Fall damage kills low-HP creature ===\n');
{
  const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 }, { maxHP: 5, currentHP: 5 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    removeEffectsFromCaster(c.id, bf);
    processFallDamage(st);

    // 5 HP creature vs 10d6 (min 10) — guaranteed to die
    assert('creature is dead', e.isDead);
    eq('HP at 0', e.currentHP, 0);
    assert('_fallHeight cleared', e._fallHeight === undefined);
  }
}

// ============================================================
// 10. Multiple targets fall independently
// ============================================================
console.log('\n=== 10. Multiple targets fall independently ===\n');
{
  const c = makeCaster();
  const e1 = weak('e1', { x: 5, y: 0 }, { maxHP: 200, currentHP: 200 });
  const e2 = weak('e2', { x: 6, y: 0 }, { maxHP: 200, currentHP: 200 });
  const bf = makeBF([c, e1, e2]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    assert('e1 restrained', e1.conditions.has('restrained'));
    assert('e2 restrained', e2.conditions.has('restrained'));
    eq('e1 _fallHeight', e1._fallHeight, 100);
    eq('e2 _fallHeight', e2._fallHeight, 100);

    removeEffectsFromCaster(c.id, bf);
    processFallDamage(st);

    // Both should have taken damage (independently rolled)
    assert('e1 took fall damage', e1.currentHP < 200);
    assert('e2 took fall damage', e2.currentHP < 200);
    assert('e1 NOT restrained', !e1.conditions.has('restrained'));
    assert('e2 NOT restrained', !e2.conditions.has('restrained'));
    assert('e1 _fallHeight cleared', e1._fallHeight === undefined);
    assert('e2 _fallHeight cleared', e2._fallHeight === undefined);

    // 2 fall damage log entries
    const fallLogs = st.log.events.filter((x: any) => x.type === 'damage' && x.description?.includes('falls 100 ft'));
    eq('2 fall damage logs', fallLogs.length, 2);
  }
}

// ============================================================
// 11. Successful save → no fall damage on concentration break
// ============================================================
console.log('\n=== 11. Successful save → no fall damage on concentration break ===\n');
{
  const c = makeCaster({ x: 0, y: 0, z: 0 }, RG_ACTION_LOW);
  const e = strong('e1', { x: 5, y: 0 }, { maxHP: 200, currentHP: 200 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    assert('NOT restrained', !e.conditions.has('restrained'));
    assert('no _fallHeight', e._fallHeight === undefined);

    // Even if we break concentration, no fall damage
    removeEffectsFromCaster(c.id, bf);
    processFallDamage(st);

    eq('no fall damage taken', e.currentHP, 200);
  }
}

// ============================================================
// 12. Dead creatures skip fall damage (just clear _fallHeight)
// ============================================================
console.log('\n=== 12. Dead creatures skip fall damage ===\n');
{
  const c = makeCaster();
  const e = weak('e1', { x: 5, y: 0 }, { maxHP: 200, currentHP: 200 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    // Kill the creature before concentration breaks
    e.currentHP = 0;
    e.isDead = true;

    removeEffectsFromCaster(c.id, bf);
    processFallDamage(st);

    // _fallHeight should be cleared without applying damage
    assert('_fallHeight cleared for dead creature', e._fallHeight === undefined);
    // No fall damage log for dead creatures
    const fallLogs = st.log.events.filter((x: any) => x.type === 'damage' && x.description?.includes('falls 100 ft'));
    eq('no fall damage log for dead creature', fallLogs.length, 0);
  }
}

// ============================================================
// 13. Effect payload contains fallHeight
// ============================================================
console.log('\n=== 13. Effect payload contains fallHeight ===\n');
{
  const c = makeCaster(); const e = weak('e1', { x: 5, y: 0 });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    const rgEffect = e.activeEffects.find((ef: any) => ef.spellName === 'Reverse Gravity');
    assert('RG effect exists', !!rgEffect);
    eq('effect payload.fallHeight', (rgEffect as any)?.payload?.fallHeight, 100);
  }
}

// ============================================================
// 14. Fall damage respects resistance
// ============================================================
console.log('\n=== 14. Fall damage respects bludgeoning resistance ===\n');
{
  const c = makeCaster();
  const e = weak('e1', { x: 5, y: 0 }, { maxHP: 200, currentHP: 200, resistances: ['bludgeoning'] });
  const bf = makeBF([c, e]); const st = makeState(bf); const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    removeEffectsFromCaster(c.id, bf);
    processFallDamage(st);

    // With resistance, fall damage should be halved
    // 10d6 range 10–60, halved = 5–30
    assert('resistant creature took less damage', e.currentHP >= 200 - 30 && e.currentHP <= 200 - 5);
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
