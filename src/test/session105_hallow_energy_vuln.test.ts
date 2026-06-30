// ============================================================
// Test: Session 105 — Hallow "Energy Vulnerability" effect (PHB p.249)
//
// Validates the S104 handover next-action #6: implement Hallow's "Energy
// Vulnerability" effect using the S103 `damage_vulnerability` ActiveEffect
// pattern (the canonical, regression-guarded pattern — see
// src/test/session104_vuln_audit.test.ts).
//
// PHB p.249: "Energy Vulnerability. All creatures in the area have
// vulnerability to one damage type of your choice."
//
// v1 model (mirrors the existing Daylight v1 simplification):
//   - 60-ft AoE → single targeted enemy
//   - 24-hr cast → action (treat as pre-cast)
//   - 24-hr duration → encounter-duration (NO concentration, NO sourceTurnExpires)
//   - Caster chooses the damage type
//
// Coverage (24 assertions):
//   1. Metadata flag hallowEnergyVulnerabilityV1Implemented = true
//   2. shouldCastEnergyVulnerability: picks highest-HP enemy within 60 ft (any type)
//   3. shouldCast: null when no slot
//   4. shouldCast: null when no spell action
//   5. shouldCast: null when target too far (> 60 ft)
//   6. shouldCast: NOT concentration-gated
//   7. shouldCast: skips already-vulnerable targets
//   8. shouldCast: picks highest-HP among multiple candidates
//   9. shouldCast: null when all candidates already vulnerable
//  10. execute: consumes a 5th-level slot
//  11. execute: NOT concentrating (Hallow has no concentration)
//  12. execute: applies damage_vulnerability ActiveEffect
//  13. execute: payload.damageType + addedVulnerability=true (fresh target)
//  14. execute: sourceIsConcentration=false
//  15. execute: NO sourceTurnExpires (encounter-duration)
//  16. execute: target.damageVulnerabilities includes the type
//  17. execute: logs fire (action + condition_add)
//  18. execute: log mentions Energy Vulnerability + the damage type
//  19. INTEGRATION: applyDamageWithTempHP doubles the vuln-type damage
//  20. INTEGRATION: non-vuln damage type is NOT doubled
//  21. addedVulnerability=false when target has innate vuln (undo-safe)
//  22. execute: dead/unconscious target → effect not applied (slot still consumed)
//  23. Regression: existing Daylight effect still works (execute, not executeEnergyVulnerability)
//  24. S104 vuln audit regression: Hallow still uses the ActiveEffect pattern (no direct push)
//
// Run: npx ts-node --transpile-only src/test/session105_hallow_energy_vuln.test.ts
// ============================================================

import {
  execute as executeHallow,
  shouldCast as shouldCastHallow,
  shouldCastEnergyVulnerability,
  executeEnergyVulnerability,
  metadata as halMeta,
} from '../spells/hallow';
import { applySpellEffect, undoEffect } from '../engine/spell_effects';
import { applyDamageWithTempHP } from '../engine/utils';
import { EngineState } from '../engine/combat';
import { Combatant, Battlefield, Condition, DamageType } from '../types/core';

// ---- Test harness -------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Factories (mirror session68_batch3_spells.test.ts) -----

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
    ...overrides,
  };
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

// ============================================================
// 1. Metadata flag
// ============================================================
console.log('\n--- 1. Metadata: hallowEnergyVulnerabilityV1Implemented ---');
eq('Energy Vulnerability v1 flag = true', (halMeta as any).hallowEnergyVulnerabilityV1Implemented, true);
eq('Daylight v1 flag still true (unchanged)', (halMeta as any).hallowDaylightOnlyV1Implemented, true);
eq('NO concentration (unchanged)', halMeta.concentration, false);

// ============================================================
// 2-9. shouldCastEnergyVulnerability
// ============================================================
console.log('\n--- 2. shouldCast: picks highest-HP enemy within 60 ft (any type) ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const orc = makeCombatant('orc', { pos: { x: 6, y: 5, z: 0 }, maxHP: 80, currentHP: 80 });  // 5 ft away, humanoid
  eq('picks humanoid enemy in range (any type)', shouldCastEnergyVulnerability(caster, makeBF([caster, orc]), 'fire')?.id, 'orc');
}

console.log('\n--- 3. shouldCast: null when no slot ---');
{
  const caster = makeCaster('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    resources: { spellSlots: { 5: { max: 2, remaining: 0 } } } as any,
  });
  const orc = makeCombatant('orc', { pos: { x: 6, y: 5, z: 0 } });
  eq('null when no 5th-level slot', shouldCastEnergyVulnerability(caster, makeBF([caster, orc]), 'fire'), null);
}

console.log('\n--- 4. shouldCast: null when no spell action ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 }, actions: [] });
  const orc = makeCombatant('orc', { pos: { x: 6, y: 5, z: 0 } });
  eq('null when no Hallow action', shouldCastEnergyVulnerability(caster, makeBF([caster, orc]), 'fire'), null);
}

console.log('\n--- 5. shouldCast: null when target too far (> 60 ft) ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const farOrc = makeCombatant('farorc', { pos: { x: 18, y: 5, z: 0 } });  // 65 ft away
  eq('null when target > 60 ft', shouldCastEnergyVulnerability(caster, makeBF([caster, farOrc]), 'fire'), null);
}

console.log('\n--- 6. shouldCast: NOT concentration-gated ---');
{
  const caster = makeCaster('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    concentration: { active: true, spellName: 'X' } as any,
  });
  const orc = makeCombatant('orc', { pos: { x: 6, y: 5, z: 0 } });
  eq('NOT gated by concentration (Hallow has no conc)', shouldCastEnergyVulnerability(caster, makeBF([caster, orc]), 'fire')?.id, 'orc');
}

console.log('\n--- 7. shouldCast: skips already-vulnerable targets ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const vulnOrc = makeCombatant('vulnorc', {
    pos: { x: 6, y: 5, z: 0 }, maxHP: 90, currentHP: 90,
    damageVulnerabilities: ['fire' as DamageType],
  });
  const plainOrc = makeCombatant('plainorc', { pos: { x: 7, y: 5, z: 0 }, maxHP: 70, currentHP: 70 });
  // vulnOrc is higher HP (90) but already fire-vulnerable → skip to plainOrc (70).
  eq('skips already-vulnerable target, picks next', shouldCastEnergyVulnerability(caster, makeBF([caster, vulnOrc, plainOrc]), 'fire')?.id, 'plainorc');
}

console.log('\n--- 8. shouldCast: picks highest-HP among multiple candidates ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const weak = makeCombatant('weak', { pos: { x: 6, y: 5, z: 0 }, maxHP: 50, currentHP: 50 });
  const strong = makeCombatant('strong', { pos: { x: 7, y: 5, z: 0 }, maxHP: 120, currentHP: 120 });
  eq('picks highest-HP candidate (120 > 50)', shouldCastEnergyVulnerability(caster, makeBF([caster, weak, strong]), 'cold')?.id, 'strong');
}

console.log('\n--- 9. shouldCast: null when all candidates already vulnerable ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const v1 = makeCombatant('v1', { pos: { x: 6, y: 5, z: 0 }, damageVulnerabilities: ['fire' as DamageType] });
  const v2 = makeCombatant('v2', { pos: { x: 7, y: 5, z: 0 }, damageVulnerabilities: ['fire' as DamageType] });
  eq('null when all in-range enemies already fire-vulnerable', shouldCastEnergyVulnerability(caster, makeBF([caster, v1, v2]), 'fire'), null);
}

// ============================================================
// 10-18. executeEnergyVulnerability
// ============================================================
console.log('\n--- 10-18. execute: applies damage_vulnerability ActiveEffect ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const orc = makeCombatant('orc', { pos: { x: 6, y: 5, z: 0 }, maxHP: 200, currentHP: 200 });
  const bf = makeBF([caster, orc]);
  const state = makeState(bf);

  executeEnergyVulnerability(caster, orc, state, 'fire');

  // 10. slot consumed
  eq('10. 5th-level slot consumed (2 → 1)', (caster.resources as any).spellSlots[5].remaining, 1);
  // 11. NOT concentrating
  eq('11. NOT concentrating (Hallow has no conc)', caster.concentration, null);
  // 12. damage_vulnerability ActiveEffect applied
  const vulnEffect = orc.activeEffects.find(e => e.spellName === 'Hallow' && e.effectType === 'damage_vulnerability');
  assert('12. damage_vulnerability ActiveEffect applied', vulnEffect !== undefined);
  if (vulnEffect) {
    // 13. payload
    eq('13a. payload.damageType = fire', (vulnEffect.payload as any).damageType, 'fire');
    eq('13b. payload.addedVulnerability = true (fresh target)', (vulnEffect.payload as any).addedVulnerability, true);
    // 14. not concentration-sourced
    eq('14. sourceIsConcentration = false', vulnEffect.sourceIsConcentration, false);
    // 15. no sourceTurnExpires (encounter-duration)
    eq('15. NO sourceTurnExpires (encounter-duration)', vulnEffect.sourceTurnExpires, undefined);
  }
  // 16. damageVulnerabilities includes fire
  assert('16. target.damageVulnerabilities includes fire', orc.damageVulnerabilities?.includes('fire') === true);
  // 17. logs fire (action + condition_add)
  assert('17. ≥2 events logged (action + condition_add)', state.log.events.length >= 2);
  // 18. log mentions Energy Vulnerability + fire
  assert('18a. log mentions Energy Vulnerability', state.log.events.some(e => e.description.includes('Energy Vulnerability')));
  assert('18b. log mentions fire damage type', state.log.events.some(e => e.description.includes('fire')));
}

// ============================================================
// 19-20. INTEGRATION: applyDamageWithTempHP doubles vuln-type damage
// ============================================================
console.log('\n--- 19. INTEGRATION: fire damage doubled after Hallow Energy Vulnerability ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const orc = makeCombatant('orc', { pos: { x: 6, y: 5, z: 0 }, maxHP: 200, currentHP: 200 });
  const bf = makeBF([caster, orc]);
  const state = makeState(bf);

  // Before Hallow: 10 fire damage → 10 (no vuln).
  const beforeHP = orc.currentHP;
  const dmgBefore = applyDamageWithTempHP(orc, 10, 'fire');
  eq('19a. before Hallow: 10 fire damage = 10 (no vuln)', dmgBefore, 10);
  eq('19b. HP dropped by 10', orc.currentHP, beforeHP - 10);

  // Apply Hallow Energy Vulnerability (fire).
  executeEnergyVulnerability(caster, orc, state, 'fire');

  // After Hallow: 10 fire damage → 20 (vuln doubles, PHB p.197).
  const afterHP = orc.currentHP;
  const dmgAfter = applyDamageWithTempHP(orc, 10, 'fire');
  eq('19c. after Hallow: 10 fire damage = 20 (vuln doubles)', dmgAfter, 20);
  eq('19d. HP dropped by 20', orc.currentHP, afterHP - 20);
}

console.log('\n--- 20. INTEGRATION: non-vuln damage type is NOT doubled ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const orc = makeCombatant('orc', { pos: { x: 6, y: 5, z: 0 }, maxHP: 200, currentHP: 200 });
  const bf = makeBF([caster, orc]);
  const state = makeState(bf);

  // Apply Hallow Energy Vulnerability (fire).
  executeEnergyVulnerability(caster, orc, state, 'fire');

  // Cold damage is NOT doubled (only fire is the vuln type).
  const beforeHP = orc.currentHP;
  const dmg = applyDamageWithTempHP(orc, 10, 'cold');
  eq('20a. cold damage NOT doubled (only fire is vuln)', dmg, 10);
  eq('20b. HP dropped by 10 (not 20)', orc.currentHP, beforeHP - 10);
}

// ============================================================
// 21. addedVulnerability=false when target has innate vuln (undo-safe)
// ============================================================
console.log('\n--- 21. addedVulnerability=false when target has innate vuln (undo-safe) ---');
{
  // Skeleton has innate bludgeoning vuln (per bestiary). Simulate by pre-seeding.
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const skel = makeCombatant('skel', {
    pos: { x: 6, y: 5, z: 0 }, maxHP: 200, currentHP: 200,
    damageVulnerabilities: ['bludgeoning' as DamageType],  // innate
  });
  const bf = makeBF([caster, skel]);
  const state = makeState(bf);

  // Execute directly (shouldCast would skip innate-vuln targets; execute is
  // called directly to verify the undo-safe guard).
  executeEnergyVulnerability(caster, skel, state, 'bludgeoning');

  const vulnEffect = skel.activeEffects.find(e => e.spellName === 'Hallow' && e.effectType === 'damage_vulnerability');
  assert('21a. effect applied', vulnEffect !== undefined);
  // addedVulnerability=false → undoEffect won't splice the innate entry.
  eq('21b. addedVulnerability=false (innate vuln present)', (vulnEffect?.payload as any).addedVulnerability, false);
  // damageVulnerabilities still has bludgeoning (the push was a no-op since already present).
  assert('21c. damageVulnerabilities still has bludgeoning', skel.damageVulnerabilities?.includes('bludgeoning') === true);

  // Undo the effect — the innate bludgeoning entry must NOT be spliced out.
  // (undoEffect undoes the MECHANICAL effect — it does NOT remove the
  // ActiveEffect from the array; that's removeEffectById's job. The key
  // assertion here is 21d: the innate vuln is preserved because
  // addedVulnerability=false → undoEffect's splice guard skips it.)
  if (vulnEffect) {
    undoEffect(skel, vulnEffect);
  }
  assert('21d. after undo: innate bludgeoning vuln PRESERVED (not spliced)', skel.damageVulnerabilities?.includes('bludgeoning') === true);
}

// ============================================================
// 22. execute: dead/unconscious target → effect not applied (slot still consumed)
// ============================================================
console.log('\n--- 22. execute: dead target → effect not applied (slot still consumed) ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const deadOrc = makeCombatant('deadorc', { pos: { x: 6, y: 5, z: 0 }, isDead: true });
  const bf = makeBF([caster, deadOrc]);
  const state = makeState(bf);

  executeEnergyVulnerability(caster, deadOrc, state, 'fire');

  // Slot still consumed (execute always consumes — mirrors the Daylight execute).
  eq('22a. slot consumed even for dead target', (caster.resources as any).spellSlots[5].remaining, 1);
  // No effect applied.
  eq('22b. no damage_vulnerability effect on dead target', deadOrc.activeEffects.length, 0);
  // No condition_add log (only the action log fires).
  const condLogs = state.log.events.filter(e => e.type === 'condition_add');
  eq('22c. no condition_add log for dead target', condLogs.length, 0);
}

// ============================================================
// 23. Regression: existing Daylight effect still works
// ============================================================
console.log('\n--- 23. Regression: existing Daylight execute still works ---');
{
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const undead = makeCombatant('zombie', { creatureType: 'undead', pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, undead]);
  const state = makeState(bf);

  executeHallow(caster, undead, state);  // Daylight execute

  // Daylight applies advantage_vs (NOT damage_vulnerability).
  const advEffect = undead.activeEffects.find(e => e.spellName === 'Hallow' && e.effectType === 'advantage_vs');
  assert('23a. Daylight still applies advantage_vs', advEffect !== undefined);
  const vulnEffect = undead.activeEffects.find(e => e.spellName === 'Hallow' && e.effectType === 'damage_vulnerability');
  assert('23b. Daylight does NOT apply damage_vulnerability', vulnEffect === undefined);
  assert('23c. Daylight log mentions Daylight', state.log.events.some(e => e.description.includes('Daylight')));
}

// ============================================================
// 24. S104 vuln audit regression: Hallow uses the ActiveEffect pattern
//     (no direct damageVulnerabilities.push in the spell module)
// ============================================================
console.log('\n--- 24. S104 audit regression: Hallow uses ActiveEffect (no direct push) ---');
{
  // The S104 vuln audit (session104_vuln_audit.test.ts) confirmed that NO spell
  // module directly mutates damageVulnerabilities — they all use the
  // damage_vulnerability ActiveEffect pattern. Hallow's new Energy Vulnerability
  // MUST follow the same pattern. Verify by checking that executeEnergyVulnerability
  // adds an ActiveEffect (not a bare push) and that undoEffect correctly removes
  // the vuln (proving it's effect-tracked, not a permanent mutation).
  const caster = makeCaster('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const orc = makeCombatant('orc', { pos: { x: 6, y: 5, z: 0 }, maxHP: 200, currentHP: 200 });
  const bf = makeBF([caster, orc]);
  const state = makeState(bf);

  executeEnergyVulnerability(caster, orc, state, 'lightning');

  // Effect-tracked: an ActiveEffect exists.
  const eff = orc.activeEffects.find(e => e.spellName === 'Hallow' && e.effectType === 'damage_vulnerability');
  assert('24a. ActiveEffect created (not a bare push)', eff !== undefined);
  // The vuln is present.
  assert('24b. lightning vuln present after apply', orc.damageVulnerabilities?.includes('lightning') === true);

  // Undo removes the vuln (proving it's effect-tracked, not permanent).
  // (undoEffect splices the vuln type for addedVulnerability=true effects.)
  if (eff) undoEffect(orc, eff);
  assert('24c. lightning vuln REMOVED after undo (effect-tracked)', orc.damageVulnerabilities?.includes('lightning') === false);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
