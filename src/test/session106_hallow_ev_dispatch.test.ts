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
  metadata as halMeta,
} from '../spells/hallow';
import { executePlannedAction, EngineState } from '../engine/combat';
import { applySpellEffect, undoEffect } from '../engine/spell_effects';
import { Combatant, Battlefield, Condition, DamageType, Action, PlannedAction } from '../types/core';

// ---- Test harness -------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
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
