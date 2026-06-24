// ============================================================
// Test: Combining Game Effects — Priority Activation Pipeline
// RFC: docs/RFC-COMBINING-EFFECTS.md (Phase 1 + Phase 2 + Phase 3)
//
// Session 64 scope (Phase 1):
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
// Session 65 scope (Phase 2 + Phase 3):
//   ✅ sourceTurnExpires expiry: effects removed when bf.round > sourceTurnExpires
//   ✅ Takeover on expiry: suppressed same-name effect promotes when active expires
//   ✅ Conditions reconciled after expiry (active effect's condition re-added)
//   ✅ Blindness/Deafness expires after 10 rounds (1 min)
//   ✅ Two Blindness/Deafness: first expires, second takes over
//   ✅ Power > duration: higher-DC effect stays active despite shorter duration
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
import { Combatant, Battlefield, ActiveEffect, Vec3, Condition } from '../types/core';

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

// ============================================================
console.log('\n=== 15. Phase 2: Single effect expires (sourceTurnExpires) ===\n');
// ============================================================

{
  // Blindness/Deafness: appliedTurn=1, sourceTurnExpires=11 (1 min = 10 rounds).
  // Before expiry (round ≤ 11): effect is active, target is blinded.
  // After expiry (round > 11): effect is removed, target is no longer blinded.
  const target = makeC({ id: 'target' });
  const bf = makeBF([target]);
  bf.round = 1;

  applySpellEffect(target, {
    casterId: 'casterA', spellName: 'Blindness/Deafness',
    effectType: 'condition_apply',
    payload: { condition: 'blinded' as Condition, saveDC: 14 },
    sourceIsConcentration: false,
    appliedTurn: 1,
    sourceTurnExpires: 11,  // 1 min = 10 rounds from appliedTurn 1
  });
  reevaluateEffects(target, bf);

  eq('15a: effect in activeEffects before expiry', target.activeEffects.length, 1);
  assert('15b: target is blinded before expiry', target.conditions.has('blinded'));

  // Advance to round 11 — effect should still be active (round <= sourceTurnExpires)
  bf.round = 11;
  reevaluateEffects(target, bf);
  eq('15c: effect still in activeEffects at round 11 (boundary)', target.activeEffects.length, 1);
  assert('15d: target still blinded at round 11 (boundary)', target.conditions.has('blinded'));

  // Advance to round 12 — effect should be expired and removed
  bf.round = 12;
  reevaluateEffects(target, bf);
  eq('15e: effect removed from activeEffects after expiry', target.activeEffects.length, 0);
  assert('15f: target no longer blinded after expiry', !target.conditions.has('blinded'));
}

// ============================================================
console.log('\n=== 16. Phase 2: Takeover on expiry — same-name effect promotes ===\n');
// ============================================================

{
  // Two Blindness/Deafness castings on the same target:
  //   casterA: appliedTurn=1, sourceTurnExpires=11 (10-round duration)
  //   casterB: appliedTurn=5, sourceTurnExpires=15 (10-round duration, cast later)
  // Both impose 'blinded'. Power equal (same saveDC). Duration equal (both 10 rounds).
  // Recency tiebreak: casterB (appliedTurn 5) > casterA (appliedTurn 1) → casterB active.
  //
  // When casterB's effect expires at round 15, casterA should have already expired
  // at round 11 — so no takeover. Let's set up a more interesting scenario:
  //
  // casterA: appliedTurn=1, sourceTurnExpires=11 (10-round duration)
  // casterB: appliedTurn=5, sourceTurnExpires=25 (20-round duration — upcast or longer spell)
  // Duration tiebreak: casterB (20) > casterA (10) → casterB active.
  // When casterA expires at round 11, nothing changes (it was suppressed).
  // When casterB expires at round 25... but casterA already expired. So no takeover.
  //
  // Best scenario: casterA (longer duration, lower power) vs casterB (shorter, higher power):
  // casterA: appliedTurn=1, sourceTurnExpires=25, saveDC=13 (longer duration, weaker)
  // casterB: appliedTurn=5, sourceTurnExpires=15, saveDC=18 (shorter duration, stronger)
  // Power > duration: casterB (DC 18) is active, casterA suppressed.
  // At round 15: casterB expires → casterA promotes → target stays blinded.
  const target = makeC({ id: 'target' });
  const bf = makeBF([target]);
  bf.round = 1;

  // casterA: longer duration, weaker DC
  applySpellEffect(target, {
    casterId: 'casterA', spellName: 'Blindness/Deafness',
    effectType: 'condition_apply',
    payload: { condition: 'blinded' as Condition, saveDC: 13 },
    sourceIsConcentration: false,
    appliedTurn: 1,
    sourceTurnExpires: 25,
  });
  // casterB: shorter duration, stronger DC
  applySpellEffect(target, {
    casterId: 'casterB', spellName: 'Blindness/Deafness',
    effectType: 'condition_apply',
    payload: { condition: 'blinded' as Condition, saveDC: 18 },
    sourceIsConcentration: false,
    appliedTurn: 5,
    sourceTurnExpires: 15,
  });
  reevaluateEffects(target, bf);

  eq('16a: two blinded effects in stack', target.activeEffects.length, 2);
  assert('16b: target is blinded', target.conditions.has('blinded'));

  // Power > duration: casterB (DC 18) should be active
  const activeBefore = target.activeEffects.find(e => !e.suppressed);
  eq('16c: casterB (higher DC) is active', activeBefore?.casterId, 'casterB');

  // Advance to round 16 — casterB (sourceTurnExpires=15) expires, casterA takes over
  bf.round = 16;
  reevaluateEffects(target, bf);

  // casterB expired and removed; casterA promoted
  eq('16d: one effect remains after expiry', target.activeEffects.length, 1);
  eq('16e: remaining effect is casterA (takeover)', target.activeEffects[0].casterId, 'casterA');
  assert('16f: casterA effect is active (not suppressed)', !target.activeEffects[0].suppressed);
  assert('16g: target still blinded after takeover', target.conditions.has('blinded'));
  eq('16h: casterA sourceTurnExpires preserved', target.activeEffects[0].sourceTurnExpires, 25);

  // Advance to round 26 — casterA (sourceTurnExpires=25) also expires
  bf.round = 26;
  reevaluateEffects(target, bf);
  eq('16i: all effects expired', target.activeEffects.length, 0);
  assert('16j: target no longer blinded', !target.conditions.has('blinded'));
}

// ============================================================
console.log('\n=== 17. Phase 2: Suppressed effect expires (no impact on active) ===\n');
// ============================================================

{
  // casterA (higher DC, active): appliedTurn=1, sourceTurnExpires=25, saveDC=18
  // casterB (lower DC, suppressed): appliedTurn=5, sourceTurnExpires=15, saveDC=13
  // When casterB expires at round 15, casterA should remain active — no disruption.
  const target = makeC({ id: 'target' });
  const bf = makeBF([target]);
  bf.round = 1;

  applySpellEffect(target, {
    casterId: 'casterA', spellName: 'Blindness/Deafness',
    effectType: 'condition_apply',
    payload: { condition: 'blinded' as Condition, saveDC: 18 },
    sourceIsConcentration: false,
    appliedTurn: 1,
    sourceTurnExpires: 25,
  });
  applySpellEffect(target, {
    casterId: 'casterB', spellName: 'Blindness/Deafness',
    effectType: 'condition_apply',
    payload: { condition: 'blinded' as Condition, saveDC: 13 },
    sourceIsConcentration: false,
    appliedTurn: 5,
    sourceTurnExpires: 15,
  });
  reevaluateEffects(target, bf);

  // casterA is active (higher DC)
  const activeBefore = target.activeEffects.find(e => !e.suppressed);
  eq('17a: casterA is active before expiry', activeBefore?.casterId, 'casterA');

  // Advance to round 16 — casterB (sourceTurnExpires=15) expires (it was suppressed, no impact)
  bf.round = 16;
  reevaluateEffects(target, bf);

  eq('17b: one effect remains (casterA)', target.activeEffects.length, 1);
  eq('17c: remaining effect is casterA', target.activeEffects[0].casterId, 'casterA');
  assert('17d: casterA still active', !target.activeEffects[0].suppressed);
  assert('17e: target still blinded', target.conditions.has('blinded'));
}

// ============================================================
console.log('\n=== 18. Phase 2: Expiry + concentration break combined ===\n');
// ============================================================

{
  // casterA: concentration Bless (no sourceTurnExpires — lasts until conc breaks)
  // casterB: non-concentration Bless with sourceTurnExpires=11
  // When casterB expires, casterA (concentration) should continue active.
  // When casterA's concentration breaks, casterB already expired — no takeover.
  const fighter = makeC({ id: 'fighter' });
  const bf = makeBF([fighter]);
  bf.round = 1;

  // casterA: concentration Bless
  applySpellEffect(fighter, {
    casterId: 'clericA', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true, appliedTurn: 1,
  });
  // casterB: non-concentration Bless (e.g. from a magic item, 10 rounds)
  applySpellEffect(fighter, {
    casterId: 'clericB', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: false,
    appliedTurn: 3, sourceTurnExpires: 13,
  });
  reevaluateEffects(fighter, bf);

  // Duration tiebreak: clericA (concentration = Infinity) > clericB (10 rounds)
  // → clericA active
  const activeBefore = fighter.activeEffects.find(e => !e.suppressed);
  eq('18a: clericA (concentration, longer duration) is active', activeBefore?.casterId, 'clericA');
  eq('18b: getActiveBlessDie = 4', getActiveBlessDie(fighter), 4);

  // clericB's non-concentration Bless expires
  bf.round = 14;
  reevaluateEffects(fighter, bf);
  eq('18c: clericB expired, one effect remains', fighter.activeEffects.length, 1);
  eq('18d: remaining is clericA (concentration)', fighter.activeEffects[0].casterId, 'clericA');
  eq('18e: getActiveBlessDie = 4 (clericA still active)', getActiveBlessDie(fighter), 4);
}

// ============================================================
console.log('\n=== 19. Phase 3: Takeover-on-expiry end-to-end (Darkness + Blindness/Deafness) ===\n');
// ============================================================

{
  // RFC §8 test case 6: Darkness spell active rounds 1-10 (concentration);
  // casterB casts Blindness/Deafness at fighter round 3 (expires round 13).
  // Both impose 'blinded'. Darkness (concentration = Infinity duration) has
  // longer total duration → Darkness is active, Blindness/Deafness suppressed.
  // When Darkness ends round 10 (concentration break), Blindness/Deafness
  // promotes → target stays blinded for 3 more rounds (rounds 10-13).
  const fighter = makeC({ id: 'fighter' });
  const bf = makeBF([fighter]);
  bf.round = 1;

  // Darkness imposes 'blinded' via condition_apply (simplified for this test —
  // in the full engine, Darkness creates a battlefield_obstacle; the condition
  // is implicit from being inside the AoE. For pipeline testing, we model it
  // as a condition_apply effect with concentration).
  applySpellEffect(fighter, {
    casterId: 'casterDarkness', spellName: 'Darkness',
    effectType: 'condition_apply',
    payload: { condition: 'blinded' as Condition, saveDC: 15 },
    sourceIsConcentration: true, appliedTurn: 1,
  });

  // Round 3: Blindness/Deafness cast
  applySpellEffect(fighter, {
    casterId: 'casterBlind', spellName: 'Blindness/Deafness',
    effectType: 'condition_apply',
    payload: { condition: 'blinded' as Condition, saveDC: 14 },
    sourceIsConcentration: false,
    appliedTurn: 3,
    sourceTurnExpires: 13,  // 1 min from round 3
  });
  reevaluateEffects(fighter, bf);

  eq('19a: two blinded effects in stack', fighter.activeEffects.length, 2);
  assert('19b: target is blinded', fighter.conditions.has('blinded'));

  // Duration tiebreak: Darkness (concentration = Infinity) > Blindness/Deafness (10 rounds)
  // → Darkness is active
  const activeBefore = fighter.activeEffects.find(e => !e.suppressed);
  eq('19c: Darkness (concentration) is active', activeBefore?.casterId, 'casterDarkness');

  // Darkness concentration breaks at round 10
  removeEffectsFromCaster('casterDarkness', bf);

  // Blindness/Deafness takes over
  eq('19d: one blinded effect remains', fighter.activeEffects.length, 1);
  eq('19e: Blindness/Deafness takes over', fighter.activeEffects[0].casterId, 'casterBlind');
  assert('19f: target still blinded after takeover', fighter.conditions.has('blinded'));

  // Advance past Blindness/Deafness expiry
  bf.round = 14;
  reevaluateEffects(fighter, bf);
  eq('19g: all effects expired', fighter.activeEffects.length, 0);
  assert('19h: target no longer blinded', !fighter.conditions.has('blinded'));
}

// ============================================================
console.log('\n=== 20. Phase 2: Non-concentration ac_bonus expires ===\n');
// ============================================================

{
  // Mage Armor (non-concentration, 8hr) + Shield of Faith (concentration).
  // Both are ac_bonus effects but different effectNames ('mage-armor' vs
  // 'shield-of-faith') → they STACK (different names, not same-name overlap).
  // When Shield of Faith breaks, Mage Armor stays.
  // When Mage Armor expires, Shield of Faith stays.
  const target = makeC({ id: 'target' });
  const bf = makeBF([target]);
  bf.round = 1;

  applySpellEffect(target, {
    casterId: 'wizard', spellName: 'Mage Armor', effectType: 'ac_bonus',
    payload: { acBonus: 3 }, sourceIsConcentration: false,
    appliedTurn: 1, sourceTurnExpires: 4801,  // 8 hr = 4800 rounds
  });
  applySpellEffect(target, {
    casterId: 'cleric', spellName: 'Shield of Faith', effectType: 'ac_bonus',
    payload: { acBonus: 2 }, sourceIsConcentration: true, appliedTurn: 1,
  });
  reevaluateEffects(target, bf);

  // Different effectNames → both active (stack)
  assert('20a: both effects in stack', target.activeEffects.length === 2);
  eq('20b: ac_bonus stacks (3 + 2 = 5)', getActiveAcBonus(target), 5);

  // Shield of Faith breaks → Mage Armor still active
  removeEffectsFromCaster('cleric', bf);
  eq('20c: one effect remains (Mage Armor)', target.activeEffects.length, 1);
  eq('20d: ac_bonus = 3 (Mage Armor only)', getActiveAcBonus(target), 3);
}

// ============================================================
console.log('\n=== 21. Phase 2: No expiry for concentration effects (no sourceTurnExpires) ===\n');
// ============================================================

{
  // Concentration effects don't have sourceTurnExpires — they last until
  // concentration breaks. Advancing rounds should NOT expire them.
  const target = makeC({ id: 'target' });
  const bf = makeBF([target]);
  bf.round = 1;

  applySpellEffect(target, {
    casterId: 'clericA', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true, appliedTurn: 1,
  });
  reevaluateEffects(target, bf);

  // Advance to round 1000 — concentration effect should NOT expire
  bf.round = 1000;
  reevaluateEffects(target, bf);
  eq('21a: concentration effect not expired at round 1000', target.activeEffects.length, 1);
  eq('21b: getActiveBlessDie still 4', getActiveBlessDie(target), 4);
}

// ============================================================
console.log('\n=== 22. Phase 3: Cascading takeover with three effects ===\n');
// ============================================================

{
  // Three Blindness/Deafness effects on the same target with different expiry turns.
  // casterA: DC 18, appliedTurn=1, sourceTurnExpires=11 (10 rounds)
  // casterB: DC 16, appliedTurn=5, sourceTurnExpires=15 (10 rounds)
  // casterC: DC 14, appliedTurn=8, sourceTurnExpires=18 (10 rounds)
  //
  // Power order: casterA (18) > casterB (16) > casterC (14).
  // casterA active, casterB + casterC suppressed.
  //
  // Round 11: casterA expires → casterB promoted (next highest DC)
  // Round 15: casterB expires → casterC promoted
  // Round 18: casterC expires → all gone
  const target = makeC({ id: 'target' });
  const bf = makeBF([target]);
  bf.round = 1;

  applySpellEffect(target, {
    casterId: 'casterA', spellName: 'Blindness/Deafness',
    effectType: 'condition_apply',
    payload: { condition: 'blinded' as Condition, saveDC: 18 },
    sourceIsConcentration: false, appliedTurn: 1, sourceTurnExpires: 11,
  });
  applySpellEffect(target, {
    casterId: 'casterB', spellName: 'Blindness/Deafness',
    effectType: 'condition_apply',
    payload: { condition: 'blinded' as Condition, saveDC: 16 },
    sourceIsConcentration: false, appliedTurn: 5, sourceTurnExpires: 15,
  });
  applySpellEffect(target, {
    casterId: 'casterC', spellName: 'Blindness/Deafness',
    effectType: 'condition_apply',
    payload: { condition: 'blinded' as Condition, saveDC: 14 },
    sourceIsConcentration: false, appliedTurn: 8, sourceTurnExpires: 18,
  });
  reevaluateEffects(target, bf);

  eq('22a: three effects in stack', target.activeEffects.length, 3);
  const active0 = target.activeEffects.find(e => !e.suppressed);
  eq('22b: casterA (highest DC) is active', active0?.casterId, 'casterA');
  assert('22c: target is blinded', target.conditions.has('blinded'));

  // Round 11: casterA expires → casterB promoted
  bf.round = 12;
  reevaluateEffects(target, bf);
  eq('22d: two effects remain after casterA expires', target.activeEffects.length, 2);
  eq('22e: casterB now active (cascading takeover)', target.activeEffects.find(e => !e.suppressed)?.casterId, 'casterB');
  assert('22f: target still blinded after casterA expiry', target.conditions.has('blinded'));

  // Round 15: casterB expires → casterC promoted
  bf.round = 16;
  reevaluateEffects(target, bf);
  eq('22g: one effect remains after casterB expires', target.activeEffects.length, 1);
  eq('22h: casterC now active (cascading takeover)', target.activeEffects[0].casterId, 'casterC');
  assert('22i: target still blinded after casterB expiry', target.conditions.has('blinded'));

  // Round 18: casterC expires
  bf.round = 19;
  reevaluateEffects(target, bf);
  eq('22j: all effects expired', target.activeEffects.length, 0);
  assert('22k: target no longer blinded', !target.conditions.has('blinded'));
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('\nAll tests passed ✅');
