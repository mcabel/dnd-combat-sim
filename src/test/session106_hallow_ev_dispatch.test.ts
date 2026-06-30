// ============================================================
// Test: Session 106 — Hallow Energy Vulnerability AI dispatch wiring
//
// Validates the S105 handover next-action #6 (remaining): wire Hallow's
// "Energy Vulnerability" effect into the AI dispatch (case 'hallow' in
// combat.ts). The S105 deliverable implemented the effect + tested it
// directly (session105_hallow_energy_vuln.test.ts); the S106 deliverable
// adds the effect-SELECTION rule:
//   1. If the target is undead/fiend → Daylight (canon-accurate).
//   2. Else (no undead/fiend) → Energy Vulnerability with the party's most
//      common damage type (inferred from party members' actions via
//      pickHallowDamageType). The party would vuln whatever they can exploit.
//
// Coverage:
//   1. Metadata flag hallowEnergyVulnerabilityV1Wired = true
//   2-5. pickHallowDamageType: most common party damage type
//   6. Dispatch: undead target → Daylight (advantage_vs effect)
//   7. Dispatch: fiend target → Daylight
//   8. Dispatch: humanoid target + party fire → Energy Vulnerability (fire)
//   9. Dispatch: humanoid target + party radiant → EV (radiant)
//  10. Dispatch: humanoid target + NO party damage type → no cast (slot preserved)
//  11. Dispatch: humanoid target already vulnerable to party type → no EV (slot preserved)
//  12. Dispatch: no AI target, undead present → Daylight (shouldCastHallow fallback)
//  13. Dispatch: no AI target, no undead, humanoid + party fire → EV (shouldCastEnergyVulnerability fallback)
//  14. Dispatch: no AI target, no undead, no party damage type → no cast
//  15. Regression: existing Daylight dispatch still works (session68 pattern)
//
// Run: npx ts-node --transpile-only src/test/session106_hallow_ev_dispatch.test.ts
// ============================================================

import {
  execute as executeHallow,
  shouldCast as shouldCastHallow,
  shouldCastEnergyVulnerability,
  executeEnergyVulnerability,
  pickHallowDamageType,
  bestiaryHitChance,
  metadata as halMeta,
} from '../spells/hallow';
import { executePlannedAction, EngineState } from '../engine/combat';
import { applySpellEffect, undoEffect } from '../engine/spell_effects';
import { Combatant, Battlefield, Condition, DamageType, Action, PlannedAction, AbilityScore } from '../types/core';

// ---- Test harness -------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
/** Floating-point approximate equality (tolerance 1e-4) — for hitChance weights. */
function approx(label: string, a: number, b: number): void {
  assert(label, Math.abs(a - b) < 1e-4, `got ${a}, want ${b} (diff ${a - b})`);
}

// ---- Factories (mirror session105_hallow_energy_vuln.test.ts) -----

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos: { x: 1, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set<Condition>(),
    aiProfile: 'smart',
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    creatureType: 'humanoid',
    ...overrides,
  };
}

/** A damage-dealing action (for party members — used by pickHallowDamageType). */
function makeDamageAction(name: string, damageType: DamageType): Action {
  return {
    name, isMultiattack: false, attackType: 'melee',
    reach: 5, range: null, hitBonus: 5,
    damage: { count: 1, sides: 8, bonus: 3 }, damageType,
    saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: name,
  } as Action;
}

/**
 * S107 v2 flexible damage-action factory. Accepts overrides for damage dice
 * (count/sides/bonus), slotLevel (0=cantrip, 1+=slotted), hitBonus vs saveDC
 * (attack vs save-based), and recharge. Used by the v2 weighting tests (§5b-d)
 * to construct actions with differing damage magnitudes / availability / hit
 * chances so the v2 weighting differences are observable.
 */
function makeDamageActionV2(
  name: string,
  damageType: DamageType,
  opts: {
    count?: number; sides?: number; bonus?: number;
    slotLevel?: number;
    hitBonus?: number | null; saveDC?: number | null; saveAbility?: AbilityScore | null;
    recharge?: { min: number; recharged: boolean };
  } = {},
): Action {
  const count = opts.count ?? 1;
  const sides = opts.sides ?? 8;
  const bonus = opts.bonus ?? 3;
  const hitBonus = opts.hitBonus !== undefined ? opts.hitBonus : 5;
  const saveDC = opts.saveDC !== undefined ? opts.saveDC : null;
  const saveAbility = opts.saveAbility !== undefined ? opts.saveAbility : null;
  const a: Action = {
    name, isMultiattack: false,
    attackType: saveDC !== null ? 'save' as const : 'melee',
    reach: saveDC !== null ? 0 : 5,
    range: saveDC !== null ? { normal: 120, long: 120 } : null,
    hitBonus, damage: { count, sides, bonus }, damageType,
    saveDC, saveAbility,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: name,
  } as Action;
  if (opts.slotLevel !== undefined) a.slotLevel = opts.slotLevel;
  if (opts.recharge !== undefined) a.recharge = opts.recharge;
  return a;
}

function makeCaster(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    faction: 'party',
    actions: [{
      name: 'Hallow', isMultiattack: false, attackType: 'save' as const,
      reach: 0, range: { normal: 120, long: 120 }, hitBonus: null,
      damage: null, damageType: null, saveDC: 20, saveAbility: 'dex' as const,
      isAoE: false, isControl: true, requiresConcentration: true,
      slotLevel: 5, costType: 'action' as const, legendaryCost: 0, description: 'Hallow',
    }],
    resources: { spellSlots: { 5: { max: 2, remaining: 2 } } } as any,
    ...overrides,
  });
}

function makeBF(combatants: Combatant[]): Battlefield {
  return {
    width: 20, height: 20, depth: 1, cells: [],
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1, initiativeOrder: combatants.map(c => c.id),
  } as any;
}
function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(), damageThisRound: new Map(),
    noDamageRounds: new Map(), rageDamagedSinceLastTurn: new Set(),
  } as any;
}

/** Build a PlannedAction for Hallow with an optional targetId. */
function hallowPlan(targetId: string | null = null): PlannedAction {
  return {
    type: 'hallow', action: null, targetId, description: 'Cast Hallow',
  } as PlannedAction;
}

/** Find the first ActiveEffect on a combatant with the given spellName + effectType. */
function findEffect(c: Combatant, spellName: string, effectType: string) {
  return c.activeEffects.find(e => e.spellName === spellName && e.effectType === effectType);
}

// ============================================================
// 1. Metadata flag
// ============================================================
console.log('\n--- 1. Metadata: hallowEnergyVulnerabilityV1Wired ---');
eq('S106 wired flag = true', (halMeta as any).hallowEnergyVulnerabilityV1Wired, true);
eq('S105 implemented flag still true', (halMeta as any).hallowEnergyVulnerabilityV1Implemented, true);
eq('Daylight flag still true (unchanged)', (halMeta as any).hallowDaylightOnlyV1Implemented, true);
eq('S107 v2 weighted flag = true', (halMeta as any).hallowEnergyVulnerabilityV2Weighted, true);
eq('S108 v2 bestiary hitChance flag = true', (halMeta as any).hallowEnergyVulnerabilityV2BestiaryHitChance, true);

// ============================================================
// 2. pickHallowDamageType: single party member, single damage type
// ============================================================
console.log('\n--- 2. pickHallowDamageType: single party member, single type ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  // Party fighter with a fire longsword (synthetic).
  const fighter = makeCombatant('fighter', {
    faction: 'party', pos: { x: 6, y: 5, z: 0 },
    actions: [makeDamageAction('Fire Slash', 'fire')],
  });
  eq('returns fire (single party member, single type)',
    pickHallowDamageType(caster, makeBF([caster, fighter])), 'fire');
}

// ============================================================
// 3. pickHallowDamageType: multiple types → most common wins
// ============================================================
console.log('\n--- 3. pickHallowDamageType: most common type wins ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const fighter = makeCombatant('fighter', {
    faction: 'party', pos: { x: 6, y: 5, z: 0 },
    actions: [makeDamageAction('Slash', 'slashing'), makeDamageAction('Slash2', 'slashing')],
  });
  const cleric = makeCombatant('cleric', {
    faction: 'party', pos: { x: 7, y: 5, z: 0 },
    actions: [makeDamageAction('Mace', 'bludgeoning')],
  });
  // slashing: 2, bludgeoning: 1 → slashing wins.
  eq('returns slashing (2) over bludgeoning (1)',
    pickHallowDamageType(caster, makeBF([caster, fighter, cleric])), 'slashing');
}

// ============================================================
// 4. pickHallowDamageType: ties → first-seen wins (deterministic)
// ============================================================
console.log('\n--- 4. pickHallowDamageType: ties → first-seen wins ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const fighter = makeCombatant('fighter', {
    faction: 'party', pos: { x: 6, y: 5, z: 0 },
    actions: [makeDamageAction('Radiant Smite', 'radiant')],  // first-seen
  });
  const rogue = makeCombatant('rogue', {
    faction: 'party', pos: { x: 7, y: 5, z: 0 },
    actions: [makeDamageAction('Piercing Stab', 'piercing')],  // tie, second-seen
  });
  // radiant: 1, piercing: 1 → tie → first-seen (radiant) wins.
  eq('tie → first-seen (radiant) wins',
    pickHallowDamageType(caster, makeBF([caster, fighter, rogue])), 'radiant');
}

// ============================================================
// 5. pickHallowDamageType: no party damage actions → null
// ============================================================
console.log('\n--- 5. pickHallowDamageType: no damage actions → null ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  // Caster's only action is Hallow (no damageType). No other party members.
  eq('null when no party damage actions',
    pickHallowDamageType(caster, makeBF([caster])), null);
}

// ============================================================
// 5b. S107 v2 weighting: higher damage outscores more common
//     (v1 picked the most COMMON type; v2 picks the type with the highest
//     expected-damage-per-round weight. Party: 3 fire cantrips (1d6 each,
//     attack, hitBonus +5) + 1 cold fireball (12d6, slotted spell, save-based).
//     v1 would pick fire (count 3); v2 picks cold. Weights (S108 bestiary
//     hitChance for hitBonus +5 vs AC 14.849 = 0.5576):
//       cold = 12×3.5×0.5×0.75 = 15.75
//       fire = 3×3.5×1.0×0.5576 = 5.855
//     cold wins decisively. v2 is canon-better — doubling the 12d6 fireball
//     benefits more than tripling 1d6 cantrip hits.)
// ============================================================
console.log('\n--- 5b. S107 v2: higher damage outscores more common ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  // Fighter with three 1d6 fire cantrips (attack-based, repeatable, hitBonus +5).
  const fighter = makeCombatant('fighter', {
    faction: 'party', pos: { x: 6, y: 5, z: 0 },
    actions: [
      makeDamageActionV2('Fire Bolt 1', 'fire', { count: 1, sides: 6, bonus: 0, slotLevel: 0 }),
      makeDamageActionV2('Fire Bolt 2', 'fire', { count: 1, sides: 6, bonus: 0, slotLevel: 0 }),
      makeDamageActionV2('Fire Bolt 3', 'fire', { count: 1, sides: 6, bonus: 0, slotLevel: 0 }),
    ],
  });
  // Wizard with one 12d6 cold fireball (slotted L3, save-based).
  const wizard = makeCombatant('wizard', {
    faction: 'party', pos: { x: 7, y: 5, z: 0 },
    actions: [makeDamageActionV2('Cold Fireball', 'cold',
      { count: 12, sides: 6, bonus: 0, slotLevel: 3, hitBonus: null, saveDC: 15, saveAbility: 'dex' as AbilityScore })],
  });
  // v2 (S108): cold weight 15.75 > fire weight 5.855 (bestiary hitChance 0.5576).
  eq('v2 picks cold (12d6 fireball) over fire (3× 1d6 cantrip)',
    pickHallowDamageType(caster, makeBF([caster, fighter, wizard])), 'cold');
}

// ============================================================
// 5c. S107 v2 weighting: cantrip availability outscores slotted spell
//     (equal dice + equal hitChance, but cantrip is repeatable (1.0) while
//     slotted spell is limited (0.5). Party: 1 fire cantrip (1d8+3, hitBonus +5)
//     + 1 cold slotted spell (1d8+3, L3, hitBonus +5). v1: tie (count 1 each)
//     → first-seen (cold, placed first). v2 (S108 bestiary hitChance 0.5576 for
//     hitBonus +5):
//       fire  = 7.5×1.0×0.5576 = 4.182
//       cold  = 7.5×0.5×0.5576 = 2.091
//     → fire wins (cantrip availability). Same winner as v1 here, but for a
//     DIFFERENT reason — and since cold is first-seen, v2 picks fire (weight)
//     while v1 would pick cold (first-seen tie-break).)
// ============================================================
console.log('\n--- 5c. S107 v2: cantrip availability outscores slotted (equal dice) ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  // Cold slotted spell FIRST (to show v2 doesn't just use first-seen tie-break).
  const wizard = makeCombatant('wizard', {
    faction: 'party', pos: { x: 7, y: 5, z: 0 },
    actions: [makeDamageActionV2('Cold Lance', 'cold',
      { count: 1, sides: 8, bonus: 3, slotLevel: 3 })],
  });
  const fighter = makeCombatant('fighter', {
    faction: 'party', pos: { x: 6, y: 5, z: 0 },
    actions: [makeDamageActionV2('Fire Slash', 'fire',
      { count: 1, sides: 8, bonus: 3, slotLevel: 0 })],
  });
  // v1 would pick cold (first-seen, tie count 1=1). v2 picks fire (cantrip
  // availability 1.0 > slotted 0.5; fire 4.182 > cold 2.091).
  eq('v2 picks fire (cantrip, repeatable) over cold (slotted, limited) — NOT first-seen',
    pickHallowDamageType(caster, makeBF([caster, wizard, fighter])), 'fire');
}

// ============================================================
// 5d. S107 v2 weighting: save-based hitChance (0.75) > attack (bestiary)
//     (equal dice + equal availability, but save-based actions have a higher
//     expected-damage multiplier (save-for-half → 0.75) than attack rolls
//     (S108 bestiary hitChance for hitBonus +5 = 0.5576). Party: 1 fire attack
//     (1d8+3, hitBonus +5) + 1 cold save spell (1d8+3, saveDC 15). v1: tie
//     (count 1 each) → first-seen (fire). v2 (S108):
//       fire  = 7.5×1.0×0.5576 = 4.182
//       cold  = 7.5×1.0×0.75   = 5.625
//     → cold wins (save-for-half higher expected hit). The margin is WIDER under
//     S108 than S107 (0.75 vs 0.5576 > 0.75 vs 0.65) — the data-driven attack
//     hitChance is lower than the 5e default because the bestiary mean AC
//     (14.85) is tough for a +5 to-hit (~56% hit, not 65%).)
// ============================================================
console.log('\n--- 5d. S107 v2: save-based hitChance outscores attack (equal dice) ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  // Fire attack FIRST (to show v2 doesn't just use first-seen tie-break).
  const fighter = makeCombatant('fighter', {
    faction: 'party', pos: { x: 6, y: 5, z: 0 },
    actions: [makeDamageActionV2('Fire Slash', 'fire',
      { count: 1, sides: 8, bonus: 3, hitBonus: 5, saveDC: null })],
  });
  const wizard = makeCombatant('wizard', {
    faction: 'party', pos: { x: 7, y: 5, z: 0 },
    actions: [makeDamageActionV2('Cold Burst', 'cold',
      { count: 1, sides: 8, bonus: 3, hitBonus: null, saveDC: 15, saveAbility: 'dex' as AbilityScore })],
  });
  // v1 would pick fire (first-seen, tie count 1=1). v2 picks cold (save-based
  // hitChance 0.75 > attack bestiary 0.5576; cold 5.625 > fire 4.182).
  eq('v2 picks cold (save-for-half, 0.75) over fire (attack, bestiary 0.5576) — NOT first-seen',
    pickHallowDamageType(caster, makeBF([caster, fighter, wizard])), 'cold');
}

// ============================================================
// 5e. S107 v2 regression: v1 tests still pass (uniform damage → v2 ∝ count)
//     (When all party actions have identical dice + availability + hitChance,
//      v2 weight ∝ action count, so the v1 winner is preserved. §2-§4 above
//      use makeDamageAction (1d8+3, attack, no slot) for all actions — v2
//      reduces to count, so slashing (2) > bludgeoning (1), ties → first-seen.
//      This §5e is an explicit regression guard: 2 fire + 1 cold, all 1d8+3
//      attack cantrips (hitBonus +5) → fire (count 2, weight 2×4.182=8.364 >
//      cold 4.182, using S108 bestiary hitChance 0.5576).)
// ============================================================
console.log('\n--- 5e. S107 v2 regression: uniform damage → v2 ∝ count (v1 preserved) ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const fighter = makeCombatant('fighter', {
    faction: 'party', pos: { x: 6, y: 5, z: 0 },
    actions: [makeDamageAction('Fire 1', 'fire'), makeDamageAction('Fire 2', 'fire')],
  });
  const cleric = makeCombatant('cleric', {
    faction: 'party', pos: { x: 7, y: 5, z: 0 },
    actions: [makeDamageAction('Cold 1', 'cold')],
  });
  // All 1d8+3 attack cantrips (hitBonus +5) → v2 weight ∝ count → fire (2) > cold (1).
  eq('v2 uniform-damage: fire (2) > cold (1) — v1 count winner preserved',
    pickHallowDamageType(caster, makeBF([caster, fighter, cleric])), 'fire');
}

// ============================================================
// 5f. S108 per-target hitChance: higher hitBonus attack outscores lower
//     (S108 replaces the flat 0.65 attack hitChance with bestiaryHitChance(
//     hitBonus). Two actions with IDENTICAL dice + availability but DIFFERENT
//     hitBonuses now get different weights: the higher-hitBonus action lands
//     more often, so doubling its damage is more valuable. Party: 1 cold attack
//     (1d8+3, hitBonus +2, low) FIRST + 1 fire attack (1d8+3, hitBonus +8, high).
//     S107 (flat 0.65): tie (same dice, same availability, same flat hitChance)
//     → first-seen cold. S108 (bestiary hitChance):
//       cold = 7.5×1.0×0.4076 = 3.057  (hitBonus +2 → 0.4076)
//       fire = 7.5×1.0×0.7076 = 5.307  (hitBonus +8 → 0.7076)
//     → fire wins (higher hitBonus → higher hitChance → higher weight). NOT
//     first-seen — this is the S108 behavioural difference from S107: under S107
//     cold would win (first-seen tie); under S108 fire wins (per-target weight).)
// ============================================================
console.log('\n--- 5f. S108 per-target hitChance: higher hitBonus outscores lower ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  // Cold attack FIRST (low hitBonus +2) — would win under S107 (first-seen tie).
  const rogue = makeCombatant('rogue', {
    faction: 'party', pos: { x: 7, y: 5, z: 0 },
    actions: [makeDamageActionV2('Cold Dagger', 'cold',
      { count: 1, sides: 8, bonus: 3, hitBonus: 2, saveDC: null, slotLevel: 0 })],
  });
  // Fire attack SECOND (high hitBonus +8).
  const fighter = makeCombatant('fighter', {
    faction: 'party', pos: { x: 6, y: 5, z: 0 },
    actions: [makeDamageActionV2('Fire Greatsword', 'fire',
      { count: 1, sides: 8, bonus: 3, hitBonus: 8, saveDC: null, slotLevel: 0 })],
  });
  // S107 flat 0.65: tie (cold 4.875 = fire 4.875) → first-seen cold. S108:
  // fire 5.307 > cold 3.057 → fire wins (per-target hitChance).
  eq('S108 picks fire (hitBonus +8, hc 0.7076) over cold (hitBonus +2, hc 0.4076) — NOT first-seen',
    pickHallowDamageType(caster, makeBF([caster, rogue, fighter])), 'fire');
}

// ============================================================
// 5g. S108 bestiaryHitChance: direct value verification
//     (bestiaryHitChance(hitBonus) = clamp((21 - max(2, 14.849 - hitBonus))/20,
//     0.05, 0.95). Verifies the data-driven hitChance values that replaced the
//     S107 flat 0.65. The bestiary mean AC 14.849 is tough for low hitBonuses
//     and easy for high hitBonuses — capturing the per-action granularity S107
//     lacked.)
// ============================================================
console.log('\n--- 5g. S108 bestiaryHitChance direct value verification ---');
{
  // hitBonus +5 vs AC 14.849 → (21 - 9.849)/20 = 0.55755.
  approx('bestiaryHitChance(+5) ≈ 0.5576 (was flat 0.65 in S107)',
    bestiaryHitChance(5), 0.5576);
  // hitBonus +8 vs AC 14.849 → (21 - 6.849)/20 = 0.70755.
  approx('bestiaryHitChance(+8) ≈ 0.7076 (high hitBonus → high hitChance)',
    bestiaryHitChance(8), 0.7076);
  // hitBonus +2 vs AC 14.849 → (21 - 12.849)/20 = 0.40755 (float: 0.4075499...).
  approx('bestiaryHitChance(+2) ≈ 0.4076 (low hitBonus → low hitChance)',
    bestiaryHitChance(2), 0.4076);
  // hitBonus +0 vs AC 14.849 → (21 - 14.849)/20 = 0.30755.
  approx('bestiaryHitChance(+0) ≈ 0.3076 (no bonus → ~31% vs mean-AC enemy)',
    bestiaryHitChance(0), 0.3076);
  // Degenerate high hitBonus → clamped to 0.95 (nat 20 always hits floor is
  // 1/20 = 0.05; the upper clamp is 0.95 because nat 1 always misses even when
  // hitBonus >= AC). hitBonus +30 vs AC 14.849 → (21 - max(2, -15.151))/20 =
  // (21-2)/20 = 0.95.
  eq('bestiaryHitChance(+30) clamped to 0.95 (nat 1 always misses)',
    bestiaryHitChance(30), 0.95);
  // Degenerate low hitBonus → clamped to 0.05 (nat 20 always hits). hitBonus
  // -10 vs AC 14.849 → (21 - max(2, 24.849))/20 = (21-24.849)/20 = negative →
  // clamped to 0.05.
  eq('bestiaryHitChance(-10) clamped to 0.05 (nat 20 always hits)',
    bestiaryHitChance(-10), 0.05);
  // Monotonicity: higher hitBonus → higher (or equal) hitChance.
  assert('bestiaryHitChance is monotonic non-decreasing in hitBonus',
    bestiaryHitChance(0) <= bestiaryHitChance(2) &&
    bestiaryHitChance(2) <= bestiaryHitChance(5) &&
    bestiaryHitChance(5) <= bestiaryHitChance(8) &&
    bestiaryHitChance(8) <= bestiaryHitChance(30));
}

// ============================================================
// 6. Dispatch: undead target → Daylight (advantage_vs effect)
// ============================================================
console.log('\n--- 6. Dispatch: undead target → Daylight ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const zombie = makeCombatant('zombie', {
    pos: { x: 6, y: 5, z: 0 }, creatureType: 'undead', maxHP: 60, currentHP: 60,
  });
  const state = makeState(makeBF([caster, zombie]));
  executePlannedAction(caster, hallowPlan('zombie'), state);
  // Daylight applies advantage_vs effect.
  const eff = findEffect(zombie, 'Hallow', 'advantage_vs');
  assert('undead target got advantage_vs (Daylight)', !!eff);
  eq('advantage_vs payload advType = advantage', (eff as any)?.payload?.advType, 'advantage');
  // No damage_vulnerability effect (not EV).
  assert('undead target did NOT get damage_vulnerability (not EV)',
    !findEffect(zombie, 'Hallow', 'damage_vulnerability'));
  // Slot consumed.
  eq('5th-level slot consumed', (caster.resources as any).spellSlots[5].remaining, 1);
  // Log mentions Daylight.
  const dayLog = state.log.events.some(e => /Daylight/i.test(e.description));
  assert('log mentions Daylight', dayLog);
}

// ============================================================
// 7. Dispatch: fiend target → Daylight
// ============================================================
console.log('\n--- 7. Dispatch: fiend target → Daylight ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const demon = makeCombatant('demon', {
    pos: { x: 6, y: 5, z: 0 }, creatureType: 'fiend',
  });
  const state = makeState(makeBF([caster, demon]));
  executePlannedAction(caster, hallowPlan('demon'), state);
  assert('fiend target got advantage_vs (Daylight)',
    !!findEffect(demon, 'Hallow', 'advantage_vs'));
}

// ============================================================
// 8. Dispatch: humanoid target + party fire → Energy Vulnerability (fire)
// ============================================================
console.log('\n--- 8. Dispatch: humanoid target + party fire → EV (fire) ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const fighter = makeCombatant('fighter', {
    faction: 'party', pos: { x: 4, y: 5, z: 0 },
    actions: [makeDamageAction('Fire Slash', 'fire')],
  });
  const orc = makeCombatant('orc', {
    pos: { x: 6, y: 5, z: 0 }, creatureType: 'humanoid',
  });
  const state = makeState(makeBF([caster, fighter, orc]));
  executePlannedAction(caster, hallowPlan('orc'), state);
  // EV applies damage_vulnerability effect.
  const eff = findEffect(orc, 'Hallow', 'damage_vulnerability');
  assert('humanoid target got damage_vulnerability (EV)', !!eff);
  eq('EV payload damageType = fire (party most common)', (eff as any)?.payload?.damageType, 'fire');
  eq('EV addedVulnerability = true (fresh target)', (eff as any)?.payload?.addedVulnerability, true);
  // No advantage_vs (not Daylight).
  assert('humanoid target did NOT get advantage_vs (not Daylight)',
    !findEffect(orc, 'Hallow', 'advantage_vs'));
  // Slot consumed.
  eq('5th-level slot consumed', (caster.resources as any).spellSlots[5].remaining, 1);
  // Log mentions Energy Vulnerability + fire.
  const evLog = state.log.events.some(e => /Energy Vulnerability/i.test(e.description) && /fire/i.test(e.description));
  assert('log mentions Energy Vulnerability + fire', evLog);
  // target.damageVulnerabilities includes fire.
  assert('orc.damageVulnerabilities includes fire',
    orc.damageVulnerabilities?.includes('fire') === true);
}

// ============================================================
// 9. Dispatch: humanoid target + party radiant → EV (radiant)
// ============================================================
console.log('\n--- 9. Dispatch: humanoid target + party radiant → EV (radiant) ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const cleric = makeCombatant('cleric', {
    faction: 'party', pos: { x: 4, y: 5, z: 0 },
    actions: [makeDamageAction('Guiding Bolt', 'radiant')],
  });
  const orc = makeCombatant('orc', {
    pos: { x: 6, y: 5, z: 0 }, creatureType: 'humanoid',
  });
  const state = makeState(makeBF([caster, cleric, orc]));
  executePlannedAction(caster, hallowPlan('orc'), state);
  const eff = findEffect(orc, 'Hallow', 'damage_vulnerability');
  eq('EV payload damageType = radiant (party most common)', (eff as any)?.payload?.damageType, 'radiant');
}

// ============================================================
// 10. Dispatch: humanoid target + NO party damage type → no cast (slot preserved)
// ============================================================
console.log('\n--- 10. Dispatch: humanoid target + no party damage type → no cast ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const orc = makeCombatant('orc', {
    pos: { x: 6, y: 5, z: 0 }, creatureType: 'humanoid',
  });
  const state = makeState(makeBF([caster, orc]));
  executePlannedAction(caster, hallowPlan('orc'), state);
  // No Daylight (orc not undead/fiend), no EV (no party damage type) → no cast.
  assert('no advantage_vs applied', !findEffect(orc, 'Hallow', 'advantage_vs'));
  assert('no damage_vulnerability applied', !findEffect(orc, 'Hallow', 'damage_vulnerability'));
  eq('slot preserved (not consumed)', (caster.resources as any).spellSlots[5].remaining, 2);
}

// ============================================================
// 11. Dispatch: humanoid target already vulnerable to party type → no EV (slot preserved)
// ============================================================
console.log('\n--- 11. Dispatch: target already vulnerable → no EV ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const fighter = makeCombatant('fighter', {
    faction: 'party', pos: { x: 4, y: 5, z: 0 },
    actions: [makeDamageAction('Fire Slash', 'fire')],
  });
  const orc = makeCombatant('orc', {
    pos: { x: 6, y: 5, z: 0 }, creatureType: 'humanoid',
    damageVulnerabilities: ['fire'],  // already vulnerable to fire
  });
  const state = makeState(makeBF([caster, fighter, orc]));
  executePlannedAction(caster, hallowPlan('orc'), state);
  // AI target is already vulnerable → EV skipped. No undead/fiend → Daylight skipped.
  // shouldCastEnergyVulnerability also skips already-vulnerable. → no cast.
  assert('no advantage_vs (not undead/fiend)', !findEffect(orc, 'Hallow', 'advantage_vs'));
  assert('no NEW damage_vulnerability effect', !findEffect(orc, 'Hallow', 'damage_vulnerability'));
  eq('slot preserved (already vulnerable — no wasted slot)',
    (caster.resources as any).spellSlots[5].remaining, 2);
}

// ============================================================
// 12. Dispatch: no AI target, undead present → Daylight (shouldCastHallow fallback)
// ============================================================
console.log('\n--- 12. Dispatch: no AI target, undead present → Daylight fallback ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const zombie = makeCombatant('zombie', {
    pos: { x: 6, y: 5, z: 0 }, creatureType: 'undead', maxHP: 60, currentHP: 60,
  });
  const state = makeState(makeBF([caster, zombie]));
  executePlannedAction(caster, hallowPlan(null), state);  // no AI target
  // shouldCastHallow finds the undead → Daylight.
  assert('undead got advantage_vs (Daylight fallback)',
    !!findEffect(zombie, 'Hallow', 'advantage_vs'));
  eq('slot consumed', (caster.resources as any).spellSlots[5].remaining, 1);
}

// ============================================================
// 13. Dispatch: no AI target, no undead, humanoid + party fire → EV fallback
// ============================================================
console.log('\n--- 13. Dispatch: no AI target, no undead, party fire → EV fallback ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const fighter = makeCombatant('fighter', {
    faction: 'party', pos: { x: 4, y: 5, z: 0 },
    actions: [makeDamageAction('Fire Slash', 'fire')],
  });
  const orc = makeCombatant('orc', {
    pos: { x: 6, y: 5, z: 0 }, creatureType: 'humanoid', maxHP: 80, currentHP: 80,
  });
  const state = makeState(makeBF([caster, fighter, orc]));
  executePlannedAction(caster, hallowPlan(null), state);  // no AI target
  // No undead → shouldCastHallow null. Party has fire → EV finds orc.
  const eff = findEffect(orc, 'Hallow', 'damage_vulnerability');
  assert('orc got damage_vulnerability (EV fallback)', !!eff);
  eq('EV damageType = fire', (eff as any)?.payload?.damageType, 'fire');
  eq('slot consumed', (caster.resources as any).spellSlots[5].remaining, 1);
}

// ============================================================
// 14. Dispatch: no AI target, no undead, no party damage type → no cast
// ============================================================
console.log('\n--- 14. Dispatch: no AI target, no undead, no party damage → no cast ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const orc = makeCombatant('orc', {
    pos: { x: 6, y: 5, z: 0 }, creatureType: 'humanoid',
  });
  const state = makeState(makeBF([caster, orc]));
  executePlannedAction(caster, hallowPlan(null), state);
  assert('no advantage_vs', !findEffect(orc, 'Hallow', 'advantage_vs'));
  assert('no damage_vulnerability', !findEffect(orc, 'Hallow', 'damage_vulnerability'));
  eq('slot preserved', (caster.resources as any).spellSlots[5].remaining, 2);
}

// ============================================================
// 15. Regression: existing Daylight dispatch still works (session68 pattern)
// ============================================================
console.log('\n--- 15. Regression: Daylight still works via direct execute ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const zombie = makeCombatant('zombie', {
    pos: { x: 6, y: 5, z: 0 }, creatureType: 'undead',
  });
  const state = makeState(makeBF([caster, zombie]));
  // Direct executeHallow (Daylight) — the S68/S105 path.
  executeHallow(caster, zombie, state);
  assert('direct executeHallow applies advantage_vs',
    !!findEffect(zombie, 'Hallow', 'advantage_vs'));
  eq('slot consumed by direct executeHallow',
    (caster.resources as any).spellSlots[5].remaining, 1);
}

// ============================================================
// 16. Integration: EV vuln doubles damage via applyDamageWithTempHP
// ============================================================
console.log('\n--- 16. Integration: EV vuln doubles damage ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const fighter = makeCombatant('fighter', {
    faction: 'party', pos: { x: 4, y: 5, z: 0 },
    actions: [makeDamageAction('Fire Slash', 'fire')],
  });
  const orc = makeCombatant('orc', {
    pos: { x: 6, y: 5, z: 0 }, creatureType: 'humanoid',
    maxHP: 100, currentHP: 100,
  });
  const state = makeState(makeBF([caster, fighter, orc]));
  executePlannedAction(caster, hallowPlan('orc'), state);
  // Apply 10 fire damage → doubled to 20 (vuln).
  const { applyDamageWithTempHP } = require('../engine/utils');
  const hpBefore = orc.currentHP;
  applyDamageWithTempHP(orc, 10, 'fire' as DamageType);
  eq('fire damage doubled (100 - 20 = 80)', orc.currentHP, hpBefore - 20);
}

// ---- Results ------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
