// ============================================================
// Test: Session 81 — RFC-COMBINING-EFFECTS Phase 2 increment
//       sourceTurnExpires on non-concentration 1-min blinded
//       conditions (Sunburst, Color Spray)
//
// PHB p.284 (Sunburst): "blinded for 1 minute."
// PHB p.222 (Color Spray): blinded for 1 minute.
//
// Both spells apply a non-concentration `blinded` condition_apply
// effect. Prior to Session 81, neither set `sourceTurnExpires`, so
// the blinded condition persisted for the entire combat. Session 81
// (RFC-COMBINING-EFFECTS Phase 2) mirrors the existing Blindness/
// Deafness pattern: the effect now carries `appliedTurn` and
// `sourceTurnExpires = round + 10`, so the pipeline's
// `reevaluateEffects` removes the condition once the 1-min cap
// elapses.
//
// The end-of-turn CON save to end blindness early (Sunburst PHB
// p.284; Color Spray PHB p.222) remains a separate unimplemented
// simplification (same gap as Blindness/Deafness).
//
// Run: npx ts-node --transpile-only src/test/session81_source_turn_expires.test.ts
// ============================================================

import { Combatant, Action, PlayerResources, Condition, ActiveEffect } from '../types/core';
import { execute as sbExecute } from '../spells/sunburst';
import { execute as csExecute } from '../spells/color_spray';
import { reevaluateEffects } from '../engine/effect_pipeline';
import { EngineState } from '../engine/combat';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Shared helpers -----------------------------------------

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 1000, currentHP: 1000, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 1, con: 1, int: 10, wis: 16, cha: 10,  // con 1 → fails CON save
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
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

function makeBF(combatants: Combatant[], round = 1) {
  return {
    width: 60, height: 60, depth: 5,
    cells: new Map(),
    round,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: any): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

function withSlots(slots: { [level: number]: { max: number; remaining: number } }): PlayerResources {
  return { spellSlots: slots };
}

const SUNBURST_ACTION: Action = {
  name: 'Sunburst', isMultiattack: false, attackType: 'save',
  reach: 5, range: { normal: 60, long: 60 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'con', isAoE: true, isControl: false,
  requiresConcentration: false, slotLevel: 8, costType: 'action',
  legendaryCost: 0, description: 'Sunburst',
};

const COLOR_SPRAY_ACTION: Action = {
  name: 'Color Spray', isMultiattack: false, attackType: 'save',
  reach: 5, range: { normal: 15, long: 15 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'con', isAoE: true, isControl: false,
  requiresConcentration: false, slotLevel: 1, costType: 'action',
  legendaryCost: 0, description: 'Color Spray',
};

// ============================================================
// Phase 1 — Sunburst: blinded effect carries sourceTurnExpires
// ============================================================

console.log('\n=== Phase 1 — Sunburst: effect carries sourceTurnExpires ===\n');

{
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [SUNBURST_ACTION],
    resources: withSlots({ 8: { max: 1, remaining: 1 } }),
    int: 20,
  });
  const enemy = makeCombatant('e1', {
    faction: 'enemy', con: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemy], 1);  // round 1
  const state = makeState(bf);

  sbExecute(caster, [enemy], state);

  // Blinded applied.
  assert('1a. Enemy blinded after Sunburst', enemy.conditions.has('blinded'));

  // The condition_apply effect carries sourceTurnExpires + appliedTurn.
  const eff = enemy.activeEffects.find(
    e => e.effectType === 'condition_apply' && e.payload?.condition === 'blinded' && e.spellName === 'Sunburst',
  );
  assert('1b. Sunburst blinded effect exists', eff !== undefined);
  eq('1c. appliedTurn = 1 (cast on round 1)', eff!.appliedTurn, 1);
  eq('1d. sourceTurnExpires = 11 (round 1 + 10 = 1 min)', eff!.sourceTurnExpires, 11);
  assert('1e. sourceIsConcentration = false (non-concentration)', eff!.sourceIsConcentration === false);
}

// ============================================================
// Phase 2 — Sunburst: blinded expires after 10 rounds (1 min)
// ============================================================

console.log('\n=== Phase 2 — Sunburst: blinded expires after 10 rounds ===\n');

{
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [SUNBURST_ACTION],
    resources: withSlots({ 8: { max: 1, remaining: 1 } }),
    int: 20,
  });
  const enemy = makeCombatant('e1', {
    faction: 'enemy', con: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemy], 1);  // round 1
  const state = makeState(bf);

  sbExecute(caster, [enemy], state);
  assert('2a. Blinded present at round 1', enemy.conditions.has('blinded'));

  // Boundary: round 11 == sourceTurnExpires → still active (round <= sourceTurnExpires)
  bf.round = 11;
  reevaluateEffects(enemy, bf);
  assert('2b. Blinded still present at round 11 (boundary)', enemy.conditions.has('blinded'));
  eq('2c. Effect still in activeEffects at round 11', enemy.activeEffects.length, 1);

  // Round 12 > sourceTurnExpires(11) → expired & removed.
  bf.round = 12;
  reevaluateEffects(enemy, bf);
  assert('2d. Blinded removed after round 12 (1-min expiry)', !enemy.conditions.has('blinded'));
  eq('2e. Effect removed from activeEffects after expiry', enemy.activeEffects.length, 0);
}

// ============================================================
// Phase 3 — Color Spray: blinded effect carries sourceTurnExpires
// ============================================================

console.log('\n=== Phase 3 — Color Spray: effect carries sourceTurnExpires ===\n');

{
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [COLOR_SPRAY_ACTION],
    resources: withSlots({ 1: { max: 1, remaining: 1 } }),
    int: 20,
  });
  // Low-HP enemy so the 6d10 HP budget covers it.
  const enemy = makeCombatant('e1', {
    faction: 'enemy', con: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 5, currentHP: 5,
  });
  const bf = makeBF([caster, enemy], 1);  // round 1
  const state = makeState(bf);

  csExecute(caster, [enemy], state);

  assert('3a. Enemy blinded after Color Spray', enemy.conditions.has('blinded'));

  const eff = enemy.activeEffects.find(
    e => e.effectType === 'condition_apply' && e.payload?.condition === 'blinded' && e.spellName === 'Color Spray',
  );
  assert('3b. Color Spray blinded effect exists', eff !== undefined);
  eq('3c. appliedTurn = 1 (cast on round 1)', eff!.appliedTurn, 1);
  eq('3d. sourceTurnExpires = 11 (round 1 + 10 = 1 min)', eff!.sourceTurnExpires, 11);
  assert('3e. sourceIsConcentration = false (non-concentration)', eff!.sourceIsConcentration === false);
}

// ============================================================
// Phase 4 — Color Spray: blinded expires after 10 rounds (1 min)
// ============================================================

console.log('\n=== Phase 4 — Color Spray: blinded expires after 10 rounds ===\n');

{
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [COLOR_SPRAY_ACTION],
    resources: withSlots({ 1: { max: 1, remaining: 1 } }),
    int: 20,
  });
  const enemy = makeCombatant('e1', {
    faction: 'enemy', con: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 5, currentHP: 5,
  });
  const bf = makeBF([caster, enemy], 1);  // round 1
  const state = makeState(bf);

  csExecute(caster, [enemy], state);
  assert('4a. Blinded present at round 1', enemy.conditions.has('blinded'));

  bf.round = 11;
  reevaluateEffects(enemy, bf);
  assert('4b. Blinded still present at round 11 (boundary)', enemy.conditions.has('blinded'));

  bf.round = 12;
  reevaluateEffects(enemy, bf);
  assert('4c. Blinded removed after round 12 (1-min expiry)', !enemy.conditions.has('blinded'));
  eq('4d. Effect removed from activeEffects after expiry', enemy.activeEffects.length, 0);
}

// ============================================================
// Phase 5 — Metadata flags
// ============================================================

console.log('\n=== Phase 5 — Metadata flags ===\n');

{
  const sbMeta = require('../spells/sunburst').metadata;
  eq('5a. sunburstBlindnessDurationV1Simplified = false (Session 81)', sbMeta.sunburstBlindnessDurationV1Simplified, false);
  eq('5b. sunburstBlindnessDurationV1Implemented = true (Session 81)', sbMeta.sunburstBlindnessDurationV1Implemented, true);
  // End-of-turn save still unimplemented (separate simplification).
  eq('5c. sunburstEndOfTurnSaveV1Implemented still false', sbMeta.sunburstEndOfTurnSaveV1Implemented, false);

  const csMeta = require('../spells/color_spray').metadata;
  eq('5d. colorSprayBlindedDurationV1Implemented = true (Session 81)', csMeta.colorSprayBlindedDurationV1Implemented, true);
}

// ============================================================
// Phase 6 — Source-code presence checks
// ============================================================

console.log('\n=== Phase 6 — Source-code presence checks ===\n');

{
  const fs = require('fs');
  const path = require('path');

  const sbSrc = fs.readFileSync(path.join(__dirname, '..', 'spells', 'sunburst.ts'), 'utf8');
  assert('6a. Sunburst sets appliedTurn + sourceTurnExpires',
    sbSrc.includes('appliedTurn: round') &&
    sbSrc.includes('sourceTurnExpires: round + 10'));

  const csSrc = fs.readFileSync(path.join(__dirname, '..', 'spells', 'color_spray.ts'), 'utf8');
  assert('6b. Color Spray sets appliedTurn + sourceTurnExpires',
    csSrc.includes('appliedTurn: round') &&
    csSrc.includes('sourceTurnExpires: round + 10'));
}

// ============================================================
// Results
// ============================================================

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n❌ SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('\nAll tests passed ✅');
}
