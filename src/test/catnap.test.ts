// catnap.test.ts — Catnap (Session 25 / Batch 2, upgraded Session 28)
// XGE p.151: L3, 30 ft, up to 3 WILLING ALLIES fall asleep (no save), NO concentration.
// v2: Short-rest benefit — spend 1 Hit Die to heal 1d(hitDieSize) + CON mod (min 1).
import { shouldCast, execute, metadata } from '../spells/catnap';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function withSlots3(remaining = 1): PlayerResources { return { spellSlots: { 3: { max: 1, remaining } } }; }
const CAT_ACTION: Action = { name: 'Catnap', isMultiattack: false, attackType: null, reach: 5, range: { normal: 30, long: 30 }, hitBonus: null, damage: null, damageType: null, saveDC: null, saveAbility: null, isAoE: true, isControl: false, requiresConcentration: false, slotLevel: 3, costType: 'action', legendaryCost: 0, description: 'Catnap' };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, exhaustionLevel: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [CAT_ACTION], resources: withSlots3(1) }); }
// Allies share the caster's faction ('party'); enemies are 'enemy'.
const ally = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'party', pos, ...o });
const enemy = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', pos, ...o });

// ============================================================
// 1. Metadata
// ============================================================
console.log('\n=== 1. Metadata ===\n');
eq('Name', metadata.name, 'Catnap'); eq('Level 3', metadata.level, 3); eq('Range 30', metadata.rangeFt, 30);
eq('Max targets 3', metadata.maxTargets, 3); eq('Save null (willing)', metadata.saveAbility, null); eq('NOT concentration', metadata.concentration, false);
assert('Short-rest benefit V2 implemented', (metadata as any).catnapShortRestBenefitV2Implemented === true);
assert('Hit die healing V2 implemented', (metadata as any).catnapHitDieHealingV2Implemented === true);

// ============================================================
// 2. shouldCast gates
// ============================================================
console.log('\n=== 2. shouldCast gates ===\n');
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots3(1) }); eq('null: no action', shouldCast(c, makeBF([c, ally('a1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [CAT_ACTION], resources: withSlots3(0) }); eq('null: no slots', shouldCast(c, makeBF([c, ally('a1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: no allies in range', shouldCast(c, makeBF([c, enemy('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: ally out of range', shouldCast(c, makeBF([c, ally('a1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, ally('a1', { x: 1, y: 0 })])); assert('non-null: ally in range', r !== null); if (r) { assert('is array', Array.isArray(r)); eq('catches a1', r[0].id, 'a1'); } }

// ============================================================
// 3. shouldCast targets ALLIES (not enemies)
// ============================================================
console.log('\n=== 3. shouldCast targets ALLIES (not enemies) ===\n');
{ const c = makeCaster(); const a = ally('a1', { x: 1, y: 0 }); const e = enemy('e1', { x: 2, y: 0 }); const r = shouldCast(c, makeBF([c, a, e])); if (r) { eq('only the ally (not the enemy)', r.length, 1); eq('ally id', r[0].id, 'a1'); } }

// ============================================================
// 4. shouldCast 3-target cap
// ============================================================
console.log('\n=== 4. shouldCast 3-target cap ===\n');
{
  const c = makeCaster();
  const allies: Combatant[] = [];
  for (let i = 0; i < 5; i++) allies.push(ally(`a${i}`, { x: 1 + (i % 3), y: Math.floor(i / 3), z: 0 }));
  const r = shouldCast(c, makeBF([c, ...allies]));
  if (r) eq('caps at 3 targets (5 allies)', r.length, 3);
}

// ============================================================
// 5. execute — allies fall asleep (no save) + short-rest healing
// ============================================================
console.log('\n=== 5. execute — allies fall asleep + short-rest healing ===\n');
{
  const c = makeCaster();
  const a1 = ally('a1', { x: 1, y: 0 }, { currentHP: 80, hitDieSize: 8, hitDiceRemaining: 1 });
  const a2 = ally('a2', { x: 2, y: 0 }, { currentHP: 60, hitDieSize: 10, hitDiceRemaining: 2 });
  const bf = makeBF([c, a1, a2]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    eq('slot consumed', (c.resources as any).spellSlots[3].remaining, 0);
    assert('NOT concentrating', !(c.concentration?.active));
    assert('a1 sleeping', a1.conditions.has('sleeping'));
    assert('a2 sleeping', a2.conditions.has('sleeping'));
    // Short-rest healing: a1 healed (was 80/100, now > 80)
    assert('a1 healed (HP increased from 80)', a1.currentHP > 80);
    // a2 healed (was 60/100, now > 60)
    assert('a2 healed (HP increased from 60)', a2.currentHP > 60);
    // a2 spent a hit die (was 2, now 1)
    eq('a2 hit dice decremented', a2.hitDiceRemaining, 1);
    // a1 spent a hit die (was 1, now 0)
    eq('a1 hit dice decremented', a1.hitDiceRemaining, 0);
    // Check heal events in log
    const healEvents = st.log.events.filter((x: any) => x.type === 'heal');
    eq('2 heal events', healEvents.length, 2);
  }
}

// ============================================================
// 6. Hit die healing: d8 + CON mod (minimum 1)
// ============================================================
console.log('\n=== 6. Hit die healing: d8 + CON mod (minimum 1) ===\n');
{
  // CON 10 → +0 mod; default d8; minimum 1 HP heal
  const c = makeCaster();
  const a1 = ally('a1', { x: 1, y: 0 }, { currentHP: 50, con: 10, hitDieSize: 8, hitDiceRemaining: 1 });
  const bf = makeBF([c, a1]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    // HP must have increased by at least 1 (minimum 1 even if die roll is 1 and CON mod is 0)
    assert('a1 healed at least 1 HP', a1.currentHP >= 51);
    const healEvent = st.log.events.find((x: any) => x.type === 'heal');
    assert('heal event present', !!healEvent);
  }
}
{
  // CON 6 → -2 mod; d8; roll 1 → 1 + (-2) = -1 → minimum 1
  const c = makeCaster();
  const a1 = ally('a1', { x: 1, y: 0 }, { currentHP: 50, con: 6, hitDieSize: 8, hitDiceRemaining: 1 });
  const bf = makeBF([c, a1]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    // Even with -2 CON mod, minimum heal is 1
    assert('a1 healed at least 1 HP (CON penalty, min 1)', a1.currentHP >= 51);
    const healEvent = st.log.events.find((x: any) => x.type === 'heal');
    assert('heal event present (CON penalty)', !!healEvent);
  }
}
{
  // CON 18 → +4 mod; d8; heals roll + 4
  const c = makeCaster();
  const a1 = ally('a1', { x: 1, y: 0 }, { currentHP: 50, con: 18, hitDieSize: 8, hitDiceRemaining: 1 });
  const bf = makeBF([c, a1]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    // 1d8 + 4: min 5, max 12
    assert('a1 healed (CON bonus)', a1.currentHP >= 55 && a1.currentHP <= 62);
  }
}

// ============================================================
// 7. Hit die healing capped at maxHP
// ============================================================
console.log('\n=== 7. Hit die healing capped at maxHP ===\n');
{
  const c = makeCaster();
  // Ally at 99/100 HP with d8 + CON(10) = at most 8+0=8, but capped at 100
  const a1 = ally('a1', { x: 1, y: 0 }, { maxHP: 100, currentHP: 99, hitDieSize: 8, hitDiceRemaining: 1 });
  const bf = makeBF([c, a1]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    eq('HP capped at maxHP', a1.currentHP, 100);
    // Hit die is still spent even if most healing is wasted
    eq('hit die still spent', a1.hitDiceRemaining, 0);
  }
}

// ============================================================
// 8. No healing when at maxHP
// ============================================================
console.log('\n=== 8. No healing when at maxHP ===\n');
{
  const c = makeCaster();
  const a1 = ally('a1', { x: 1, y: 0 }, { maxHP: 100, currentHP: 100, hitDieSize: 8, hitDiceRemaining: 1 });
  const bf = makeBF([c, a1]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    eq('HP unchanged (already max)', a1.currentHP, 100);
    // Hit die NOT spent when at max HP
    eq('hit die NOT spent at max HP', a1.hitDiceRemaining, 1);
    const noHealEvent = st.log.events.find((x: any) => x.type === 'heal');
    assert('no heal event (at max HP)', !noHealEvent);
    const maxHPMsg = st.log.events.find((x: any) => x.description?.includes('already at max HP'));
    assert('max HP message logged', !!maxHPMsg);
  }
}

// ============================================================
// 9. No healing when no hit dice remaining
// ============================================================
console.log('\n=== 9. No healing when no hit dice remaining ===\n');
{
  const c = makeCaster();
  const a1 = ally('a1', { x: 1, y: 0 }, { currentHP: 50, hitDieSize: 8, hitDiceRemaining: 0 });
  const bf = makeBF([c, a1]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    eq('HP unchanged (no hit dice)', a1.currentHP, 50);
    const noDiceMsg = st.log.events.find((x: any) => x.description?.includes('no hit dice remaining'));
    assert('no hit dice message logged', !!noDiceMsg);
  }
}

// ============================================================
// 10. Default hitDieSize = d8, hitDiceRemaining = 1 (backward compat)
// ============================================================
console.log('\n=== 10. Default hitDieSize = d8, hitDiceRemaining = 1 ===\n');
{
  const c = makeCaster();
  // Ally WITHOUT hitDieSize/hitDiceRemaining fields
  const a1 = ally('a1', { x: 1, y: 0 }, { currentHP: 80 });
  const bf = makeBF([c, a1]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    // Should still get short-rest healing with default d8, 1 hit die
    assert('a1 healed with defaults', a1.currentHP > 80);
    const healEvent = st.log.events.find((x: any) => x.type === 'heal');
    assert('heal event with defaults', !!healEvent);
    // Check log mentions d8 (default)
    if (healEvent) {
      assert('log mentions d8 default', (healEvent as any).description?.includes('d8'));
    }
  }
}

// ============================================================
// 11. Multiple allies receive healing independently
// ============================================================
console.log('\n=== 11. Multiple allies receive healing independently ===\n');
{
  const c = makeCaster();
  const a1 = ally('a1', { x: 1, y: 0 }, { currentHP: 30, hitDieSize: 12, hitDiceRemaining: 3, con: 16 });
  const a2 = ally('a2', { x: 2, y: 0 }, { currentHP: 70, hitDieSize: 6, hitDiceRemaining: 1, con: 8 });
  const bf = makeBF([c, a1, a2]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    // a1: d12 + 3 CON mod
    assert('a1 healed (d12 +3 CON)', a1.currentHP > 30);
    eq('a1 hit dice decremented', a1.hitDiceRemaining, 2);
    // a2: d6 + (-1) CON mod, min 1
    assert('a2 healed (d6 -1 CON, min 1)', a2.currentHP > 70);
    eq('a2 hit dice decremented', a2.hitDiceRemaining, 0);
    const healEvents = st.log.events.filter((x: any) => x.type === 'heal');
    eq('2 heal events for 2 allies', healEvents.length, 2);
  }
}

// ============================================================
// 12. Backward compatibility: already-sleeping ally still gets short-rest healing
// ============================================================
console.log('\n=== 12. Already-sleeping ally still gets short-rest healing ===\n');
{
  const c = makeCaster();
  const a1 = ally('a1', { x: 1, y: 0 }, { currentHP: 50, hitDieSize: 8, hitDiceRemaining: 1 });
  a1.conditions.add('sleeping'); // already asleep
  const bf = makeBF([c, a1]);
  const st = makeState(bf);
  const t = shouldCast(c, bf);
  if (t) {
    execute(c, t, st);
    // shouldCast skips sleeping allies — so t should be empty
    // Actually, shouldCast checks conditions.has('sleeping') and skips
    // Let's verify: shouldCast returns null for a sleeping-only ally
  }
}
{
  // Simulate directly calling execute with a sleeping ally
  const c = makeCaster();
  const a1 = ally('a1', { x: 1, y: 0 }, { currentHP: 50, hitDieSize: 8, hitDiceRemaining: 1 });
  a1.conditions.add('sleeping'); // already asleep
  const bf = makeBF([c, a1]);
  const st = makeState(bf);
  // Call execute directly with the sleeping ally
  execute(c, [a1], st);
  // Still sleeping, still gets short-rest healing
  assert('a1 still sleeping', a1.conditions.has('sleeping'));
  assert('a1 healed despite being asleep', a1.currentHP > 50);
  eq('hit die spent', a1.hitDiceRemaining, 0);
  const alreadyMsg = st.log.events.find((x: any) => x.description?.includes('already asleep'));
  assert('already asleep message logged', !!alreadyMsg);
}

// ============================================================
// 13. Cleanup no-op
// ============================================================
console.log('\n=== 13. Cleanup no-op ===\n');
{ let ok = true; try { (require('../spells/catnap') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
