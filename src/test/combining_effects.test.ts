// ============================================================
// Test: Combining Game Effects — Priority Activation Pipeline
// RFC: docs/RFC-COMBINING-EFFECTS.md (Phase 1)
//
// Session 64 scope:
//   ✅ Same-name effects coexist in activeEffects (not deduped/removed)
//   ✅ Only the active (top-priority) effect applies; rest suppressed
//   ✅ Priority order: power > total duration > most recently activated
//   ✅ Takeover-on-expiry: when active removed, suppressed promotes
//   ✅ Suppressed effect's timer (appliedTurn) preserved
//   ✅ Different-name effects stack (Bless + Bane)
//   ✅ Read helpers (getActiveBlessDie, getActiveAcBonus, etc.) filter !suppressed
//   ✅ removeEffectsFromCaster triggers immediate re-evaluation
//   ✅ Effect identity registry (Blindness/Deafness + Darkness → 'blinded')
//
// Run: npx ts-node --transpile-only src/test/combining_effects.test.ts
// ============================================================

import {
  applySpellEffect,
  removeEffectsFromCaster,
  getActiveBlessDie,
  getActiveBaneDie,
  getActiveAcBonus,
  getActiveAcFloor,
  getActiveDamageZones,
  getActiveWeaponEnchant,
} from '../engine/spell_effects';
import {
  reevaluateEffects,
  compareByPriority,
  comparePotency,
  isActive,
} from '../engine/effect_pipeline';
import {
  resolveEffectName,
  resolveEffectNameFromDef,
  EFFECT_IDENTITY_REGISTRY,
} from '../engine/effect_identity';
import { runCombat, makeFlatBattlefield } from '../engine/combat';
import { Combatant, Battlefield, ActiveEffect, Vec3 } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(o: Partial<Combatant> = {}): Combatant {
  const id = `c${++_id}`;
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 30, currentHP: 30, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart',
    perception: { targets: new Map() },
    concentration: null,
    deathSaves: null,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null, activeEffects: [],
    ...o,
  };
}

function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    width: 30, height: 30, depth: 1, cells: [],
    combatants: map, round: 1,
    initiativeOrder: combatants.map(c => c.id),
  };
}

/** Helper: apply a bless_die effect from a caster to a target. */
function applyBless(target: Combatant, casterId: string, dieSides = 4, appliedTurn = 0): ActiveEffect {
  return applySpellEffect(target, {
    casterId,
    spellName: 'Bless',
    effectType: 'bless_die',
    payload: { dieSides },
    sourceIsConcentration: true,
    appliedTurn,
  });
}

/** Helper: apply a bane_die effect from a caster to a target. */
function applyBane(target: Combatant, casterId: string, dieSides = 4, appliedTurn = 0): ActiveEffect {
  return applySpellEffect(target, {
    casterId,
    spellName: 'Bane',
    effectType: 'bane_die',
    payload: { dieSides },
    sourceIsConcentration: true,
    appliedTurn,
  });
}

// ============================================================
console.log('\n=== 1. Effect identity registry ===\n');
// ============================================================

{
  eq('1a: Bless → bless', EFFECT_IDENTITY_REGISTRY['Bless'], 'bless');
  eq('1b: Spirit Guardians → spirit-guardians', EFFECT_IDENTITY_REGISTRY['Spirit Guardians'], 'spirit-guardians');
  eq('1c: Blindness/Deafness → blinded', EFFECT_IDENTITY_REGISTRY['Blindness/Deafness'], 'blinded');
  eq('1d: Darkness → blinded', EFFECT_IDENTITY_REGISTRY['Darkness'], 'blinded');

  // resolveEffectName
  eq('1e: resolveEffectName(Bless, bless_die) → bless', resolveEffectName('Bless', 'bless_die', {}), 'bless');
  eq('1f: resolveEffectName(Fireball, damage_zone) → fireball:damage_zone (default)', resolveEffectName('Fireball', 'damage_zone', {}), 'fireball:damage_zone');

  // Obstacle: includes obstacleId
  eq('1g: resolveEffectName(Fog Cloud, battlefield_obstacle, {obstacleId: fog-1}) → obstacle:fog-1',
    resolveEffectName('Fog Cloud', 'battlefield_obstacle', { obstacleId: 'fog-1' }), 'obstacle:fog-1');

  // Unknown spell → default spellName:effectType
  eq('1h: resolveEffectName(Unknown Spell, ac_bonus) → unknown-spell:ac_bonus',
    resolveEffectName('Unknown Spell', 'ac_bonus', {}), 'unknown-spell:ac_bonus');
}

// ============================================================
console.log('\n=== 2. applySpellEffect auto-populates effectName ===\n');
// ============================================================

{
  const target = makeC({ id: 'target' });
  const eff = applyBless(target, 'clericA', 4, 1);

  eq('2a: effect has effectName = bless', eff.effectName, 'bless');
  eq('2b: effect has appliedTurn = 1', eff.appliedTurn, 1);
  eq('2c: effect suppressed = false (default)', eff.suppressed, undefined);

  // Unknown spell → auto-resolved effectName
  const target2 = makeC({ id: 'target2' });
  const eff2 = applySpellEffect(target2, {
    casterId: 'wizard',
    spellName: 'Custom Spell',
    effectType: 'ac_bonus',
    payload: { acBonus: 2 },
    sourceIsConcentration: false,
  });
  eq('2d: unknown spell effectName auto-resolved', eff2.effectName, 'custom-spell:ac_bonus');
}

// ============================================================
console.log('\n=== 3. Two Bless effects coexist + only active applies ===\n');
// ============================================================

{
  const fighter = makeC({ id: 'fighter' });
  const bf = makeBF([fighter]);

  // Two clerics cast Bless on the fighter.
  applyBless(fighter, 'clericA', 4, 1);
  applyBless(fighter, 'clericB', 4, 2);

  eq('3a: both effects in activeEffects', fighter.activeEffects.length, 2);

  // Re-evaluate priority activation.
  reevaluateEffects(fighter, bf);

  // Both effects still in the stack (not removed).
  eq('3b: both effects still in activeEffects after reevaluate', fighter.activeEffects.length, 2);

  // Exactly one is active, one is suppressed.
  const active = fighter.activeEffects.filter(e => !e.suppressed);
  const suppressed = fighter.activeEffects.filter(e => e.suppressed);
  eq('3c: exactly 1 active bless', active.length, 1);
  eq('3d: exactly 1 suppressed bless', suppressed.length, 1);

  // getActiveBlessDie returns 4 (one die, not two — only active applies).
  eq('3e: getActiveBlessDie = 4 (only active applies)', getActiveBlessDie(fighter), 4);

  // The suppressed one's appliedTurn is preserved (timer running).
  assert('3f: suppressed effect retains appliedTurn',
    suppressed[0].appliedTurn !== undefined);
}

// ============================================================
console.log('\n=== 4. Takeover on concentration break ===\n');
// ============================================================

{
  const fighter = makeC({ id: 'fighter' });
  const clericA = makeC({ id: 'clericA', faction: 'party' });
  const clericB = makeC({ id: 'clericB', faction: 'party' });
  const bf = makeBF([fighter, clericA, clericB]);

  // Both clerics cast Bless on the fighter.
  applyBless(fighter, 'clericA', 4, 1);
  applyBless(fighter, 'clericB', 4, 2);
  reevaluateEffects(fighter, bf);

  // Before break: getActiveBlessDie = 4.
  eq('4a: getActiveBlessDie = 4 before break', getActiveBlessDie(fighter), 4);
  assert('4b: both effects in stack before break', fighter.activeEffects.length === 2);

  // Cleric A's concentration breaks.
  removeEffectsFromCaster('clericA', bf);

  // Cleric A's effect removed; cleric B's effect promoted to active.
  eq('4c: clericA effect removed from stack', fighter.activeEffects.length, 1);
  eq('4d: remaining effect from clericB', fighter.activeEffects[0].casterId, 'clericB');
  assert('4e: clericB effect is active (not suppressed)',
    !fighter.activeEffects[0].suppressed);

  // getActiveBlessDie is STILL 4 — cleric B's Bless takes over.
  eq('4f: getActiveBlessDie = 4 after break (takeover)', getActiveBlessDie(fighter), 4);
}

// ============================================================
console.log('\n=== 5. Priority order: power > duration > recency ===\n');
// ============================================================

{
  const fighter = makeC({ id: 'fighter' });
  const bf = makeBF([fighter]);

  // Two Shield of Faith (ac_bonus) effects: +2 AC and +3 AC (different potency).
  // The +3 should be the active one (higher power).
  applySpellEffect(fighter, {
    casterId: 'clericA', spellName: 'Shield of Faith', effectType: 'ac_bonus',
    payload: { acBonus: 2 }, sourceIsConcentration: true, appliedTurn: 1,
  });
  applySpellEffect(fighter, {
    casterId: 'clericB', spellName: 'Shield of Faith', effectType: 'ac_bonus',
    payload: { acBonus: 3 }, sourceIsConcentration: true, appliedTurn: 2,
  });
  reevaluateEffects(fighter, bf);

  // Only the +3 applies (higher power wins).
  eq('5a: getActiveAcBonus = 3 (higher power wins)', getActiveAcBonus(fighter), 3);
  assert('5b: both effects still in stack', fighter.activeEffects.length === 2);

  // The +2 is suppressed.
  const suppressed = fighter.activeEffects.find(e => e.payload.acBonus === 2);
  assert('5c: +2 effect is suppressed', suppressed?.suppressed === true);
}

// ============================================================
console.log('\n=== 6. Different-name effects stack (Bless + Bane) ===\n');
// ============================================================

{
  const fighter = makeC({ id: 'fighter' });
  const bf = makeBF([fighter]);

  // Bless (effectName 'bless') + Bane (effectName 'bane') — different names → both active.
  applyBless(fighter, 'clericA', 4, 1);
  applyBane(fighter, 'clericB', 4, 1);
  reevaluateEffects(fighter, bf);

  // Both effects are active (different effectNames → no overlap).
  eq('6a: getActiveBlessDie = 4 (Bless active)', getActiveBlessDie(fighter), 4);
  eq('6b: getActiveBaneDie = 4 (Bane active)', getActiveBaneDie(fighter), 4);
  assert('6c: both effects active (not suppressed)',
    fighter.activeEffects.every(e => !e.suppressed));
  eq('6d: both effects in stack', fighter.activeEffects.length, 2);
}

// ============================================================
console.log('\n=== 7. Two Magic Weapon enchants — only active applies ===\n');
// ============================================================

{
  const fighter = makeC({ id: 'fighter' });
  const bf = makeBF([fighter]);

  // Two clerics cast Magic Weapon on the fighter (+1 each).
  applySpellEffect(fighter, {
    casterId: 'clericA', spellName: 'Magic Weapon', effectType: 'weapon_enchant',
    payload: { attackBonus: 1, damageBonus: 1 }, sourceIsConcentration: true, appliedTurn: 1,
  });
  applySpellEffect(fighter, {
    casterId: 'clericB', spellName: 'Magic Weapon', effectType: 'weapon_enchant',
    payload: { attackBonus: 1, damageBonus: 1 }, sourceIsConcentration: true, appliedTurn: 2,
  });
  reevaluateEffects(fighter, bf);

  // Only +1/+1 (not +2/+2 — only the active one applies).
  const ench = getActiveWeaponEnchant(fighter);
  eq('7a: attackBonus = 1 (only active applies)', ench.attackBonus, 1);
  eq('7b: damageBonus = 1 (only active applies)', ench.damageBonus, 1);
  assert('7c: both effects in stack', fighter.activeEffects.length === 2);

  // Break clericA's concentration → clericB takes over (still +1/+1).
  removeEffectsFromCaster('clericA', bf);
  const ench2 = getActiveWeaponEnchant(fighter);
  eq('7d: after break, attackBonus = 1 (takeover)', ench2.attackBonus, 1);
  eq('7e: after break, damageBonus = 1 (takeover)', ench2.damageBonus, 1);
}

// ============================================================
console.log('\n=== 8. Two Spirit Guardians damage zones — only active ticks ===\n');
// ============================================================

{
  const fighter = makeC({ id: 'fighter' });
  const bf = makeBF([fighter]);

  // Two clerics' Spirit Guardians auras overlap on the fighter.
  // ClericA is level 8+ (4d8 damage); clericB is level 5-7 (3d8).
  // Per RFC §4.4: damage_zone potency = dieCount × dieSides. 4×8=32 > 3×8=24,
  // so clericA is more potent → active.
  applySpellEffect(fighter, {
    casterId: 'clericA', spellName: 'Spirit Guardians', effectType: 'damage_zone',
    payload: { dieCount: 4, dieSides: 8, damageType: 'radiant', saveDC: 15, saveAbility: 'wis' },
    sourceIsConcentration: true, appliedTurn: 1,
  });
  applySpellEffect(fighter, {
    casterId: 'clericB', spellName: 'Spirit Guardians', effectType: 'damage_zone',
    payload: { dieCount: 3, dieSides: 8, damageType: 'radiant', saveDC: 13, saveAbility: 'wis' },
    sourceIsConcentration: true, appliedTurn: 2,
  });
  reevaluateEffects(fighter, bf);

  // getActiveDamageZones returns only 1 (clericA — more potent: 4d8 > 3d8).
  const zones = getActiveDamageZones(fighter);
  eq('8a: only 1 active damage zone', zones.length, 1);
  eq('8b: active zone is clericA (more potent: 4d8 > 3d8)', zones[0].casterId, 'clericA');
  assert('8c: both zones in stack', fighter.activeEffects.length === 2);

  // Break clericA's concentration → clericB takes over.
  removeEffectsFromCaster('clericA', bf);
  const zones2 = getActiveDamageZones(fighter);
  eq('8d: after break, 1 active damage zone', zones2.length, 1);
  eq('8e: active zone is clericB (takeover)', zones2[0].casterId, 'clericB');
}

// ============================================================
console.log('\n=== 9. Priority tiebreak: duration > recency ===\n');
// ============================================================

{
  const fighter = makeC({ id: 'fighter' });
  const bf = makeBF([fighter]);

  // Two Bless effects with EQUAL potency (both d4) but different durations.
  // Effect A: appliedTurn 1, sourceTurnExpires 10 (9-round duration).
  // Effect B: appliedTurn 3, sourceTurnExpires 7 (4-round duration).
  // Power is equal (both d4). Duration: A (9) > B (4). So A wins.
  applySpellEffect(fighter, {
    casterId: 'clericA', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: false,
    sourceTurnExpires: 10, appliedTurn: 1,
  });
  applySpellEffect(fighter, {
    casterId: 'clericB', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: false,
    sourceTurnExpires: 7, appliedTurn: 3,
  });
  reevaluateEffects(fighter, bf);

  // Effect A (longer duration) should be active.
  const active = fighter.activeEffects.find(e => !e.suppressed);
  eq('9a: longer-duration effect is active', active?.casterId, 'clericA');
}

// ============================================================
console.log('\n=== 10. Priority tiebreak: recency (when power + duration equal) ===\n');
// ============================================================

{
  const fighter = makeC({ id: 'fighter' });
  const bf = makeBF([fighter]);

  // Two Bless effects: equal potency (d4), equal duration (concentration = Infinity).
  // Tiebreak by recency: effect B (appliedTurn 5) > effect A (appliedTurn 1).
  applyBless(fighter, 'clericA', 4, 1);
  applyBless(fighter, 'clericB', 4, 5);
  reevaluateEffects(fighter, bf);

  // Effect B (more recent) should be active.
  const active = fighter.activeEffects.find(e => !e.suppressed);
  eq('10a: most-recent effect is active (recency tiebreak)', active?.casterId, 'clericB');
}

// ============================================================
console.log('\n=== 11. isActive helper + compareByPriority ===\n');
// ============================================================

{
  const eff1: ActiveEffect = {
    id: 'e1', casterId: 'c1', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true, effectName: 'bless',
    appliedTurn: 1, suppressed: false,
  };
  const eff2: ActiveEffect = {
    id: 'e2', casterId: 'c2', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true, effectName: 'bless',
    appliedTurn: 3, suppressed: true,
  };

  assert('11a: isActive(eff1) = true (suppressed=false)', isActive(eff1));
  assert('11b: isActive(eff2) = false (suppressed=true)', !isActive(eff2));

  // compareByPriority: eff2 (appliedTurn 3) > eff1 (appliedTurn 1) by recency.
  // Both same power + duration (concentration = Infinity). So eff2 sorts first.
  // compareByPriority returns negative if a should sort first.
  const cmp = compareByPriority(eff1, eff2);
  assert('11c: compareByPriority(eff1, eff2) > 0 (eff2 wins by recency)', cmp > 0);

  // Potency: same dieSides → 0.
  eq('11d: comparePotency equal dieSides = 0', comparePotency(eff1, eff2), 0);
}

// ============================================================
console.log('\n=== 12. End-to-end: two clerics Bless fighter in combat ===\n');
// ============================================================

{
  // Full combat: two allied clerics cast Bless on a fighter; one cleric's
  // concentration breaks (killed); the other's Bless takes over.
  const fighter = makeC({
    id: 'fighter', name: 'Fighter', faction: 'party',
    maxHP: 50, currentHP: 50, ac: 18, pos: { x: 5, y: 5, z: 0 },
    actions: [{
      name: 'Longsword', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 7, damage: { count: 1, sides: 8, bonus: 3, average: 7 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });

  // Manually apply two Bless effects (simulating two clerics casting).
  applyBless(fighter, 'clericA', 4, 1);
  applyBless(fighter, 'clericB', 4, 1);
  const bf = makeBF([fighter]);
  reevaluateEffects(fighter, bf);

  // Both effects live in the stack; only one applies.
  eq('12a: two bless effects in stack', fighter.activeEffects.length, 2);
  eq('12b: getActiveBlessDie = 4', getActiveBlessDie(fighter), 4);

  // Simulate clericA dying → concentration breaks.
  removeEffectsFromCaster('clericA', bf);

  // ClericB's Bless takes over.
  eq('12c: one bless effect remains after clericA dies', fighter.activeEffects.length, 1);
  eq('12d: remaining bless from clericB', fighter.activeEffects[0].casterId, 'clericB');
  eq('12e: getActiveBlessDie = 4 (takeover)', getActiveBlessDie(fighter), 4);
}

// ============================================================
console.log('\n=== 13. Backward-compat: single-caster unaffected ===\n');
// ============================================================

{
  const fighter = makeC({ id: 'fighter' });
  const bf = makeBF([fighter]);

  // Single Bless — no same-name overlap.
  applyBless(fighter, 'clericA', 4, 1);
  reevaluateEffects(fighter, bf);

  eq('13a: single bless active', getActiveBlessDie(fighter), 4);
  assert('13b: single effect not suppressed', !fighter.activeEffects[0].suppressed);
  eq('13c: single effect in stack', fighter.activeEffects.length, 1);
}

// ============================================================
console.log('\n=== 14. Three same-name effects: top active, rest suppressed ===\n');
// ============================================================

{
  const fighter = makeC({ id: 'fighter' });
  const bf = makeBF([fighter]);

  // Three Bless effects from three clerics (all d4, all concentration).
  // Recency tiebreak: clericC (turn 5) > clericB (turn 3) > clericA (turn 1).
  applyBless(fighter, 'clericA', 4, 1);
  applyBless(fighter, 'clericB', 4, 3);
  applyBless(fighter, 'clericC', 4, 5);
  reevaluateEffects(fighter, bf);

  eq('14a: three effects in stack', fighter.activeEffects.length, 3);
  eq('14b: getActiveBlessDie = 4 (one active)', getActiveBlessDie(fighter), 4);

  const active = fighter.activeEffects.filter(e => !e.suppressed);
  const suppressed = fighter.activeEffects.filter(e => e.suppressed);
  eq('14c: 1 active', active.length, 1);
  eq('14d: 2 suppressed', suppressed.length, 2);
  eq('14e: active is clericC (most recent)', active[0].casterId, 'clericC');

  // Remove clericC → clericB (next most recent) takes over.
  removeEffectsFromCaster('clericC', bf);
  eq('14f: 2 effects remain', fighter.activeEffects.length, 2);
  eq('14g: getActiveBlessDie = 4 (clericB takeover)', getActiveBlessDie(fighter), 4);
  const active2 = fighter.activeEffects.filter(e => !e.suppressed);
  eq('14h: active is clericB now', active2[0].casterId, 'clericB');
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('\nAll tests passed ✅');
