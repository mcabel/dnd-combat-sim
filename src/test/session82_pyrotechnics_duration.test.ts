// ============================================================
// Test: Session 82 — RFC-COMBINING-EFFECTS Phase 2
//       sourceTurnExpires on Pyrotechnics (1-min blinded, both modes)
//
// XGE p.162 Pyrotechnics: 2nd-level, NO concentration, 1-min duration.
//   - FIREWORKS mode: CON save or blinded for the duration.
//   - SMOKE mode: NO save, ALL creatures in sphere blinded (heavily
//     obscured terrain) for the duration.
//
// Prior state: neither mode set sourceTurnExpires, so the blinded
// condition persisted for the entire combat. Session 82 mirrors the
// existing Blindness/Deafness / Sunburst / Color Spray pattern: both
// modes now set appliedTurn + sourceTurnExpires = round + 10, so
// reevaluateEffects removes the blinded condition once the 1-min cap
// elapses.
//
// Run: npx ts-node --transpile-only src/test/session82_pyrotechnics_duration.test.ts
// ============================================================

import { Combatant, Action, PlayerResources, Condition } from '../types/core';
import { executeFireworks, executeSmoke, metadata } from '../spells/pyrotechnics';
import { reevaluateEffects } from '../engine/effect_pipeline';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

const PYRO_ACTION: Action = {
  name: 'Pyrotechnics', isMultiattack: false, attackType: 'save',
  reach: 5, range: { normal: 60, long: 60 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'con', isAoE: true, isControl: true,
  requiresConcentration: false, slotLevel: 2, costType: 'action',
  legendaryCost: 0, description: 'Pyrotechnics',
};

function withSlots2(remaining = 1): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 1, int: 10, wis: 10, cha: 10,  // con 1 → fails CON save
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
    width: 60, height: 60, depth: 1,
    cells: new Map(),
    round,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// ============================================================
// Phase 1 — FIREWORKS mode: effect carries sourceTurnExpires
// ============================================================

console.log('\n=== Phase 1 — FIREWORKS: effect carries sourceTurnExpires ===\n');

{
  const caster = makeCombatant('wiz', {
    actions: [PYRO_ACTION], resources: withSlots2(1), pos: { x: 0, y: 0, z: 0 },
  });
  const enemy = makeCombatant('e1', {
    faction: 'enemy', con: 1, pos: { x: 5, y: 0, z: 0 },
  });
  const bf = makeBF([caster, enemy], 1);
  const state = makeState(bf);

  executeFireworks(caster, [enemy], state);

  assert('1a. Enemy blinded after FIREWORKS', enemy.conditions.has('blinded'));

  const eff = enemy.activeEffects.find(
    e => e.effectType === 'condition_apply' && e.payload?.condition === 'blinded' && e.spellName === 'Pyrotechnics',
  );
  assert('1b. Pyrotechnics blinded effect exists', eff !== undefined);
  eq('1c. appliedTurn = 1 (cast on round 1)', eff!.appliedTurn, 1);
  eq('1d. sourceTurnExpires = 11 (round 1 + 10 = 1 min)', eff!.sourceTurnExpires, 11);
  assert('1e. sourceIsConcentration = false (non-concentration)', eff!.sourceIsConcentration === false);
}

// ============================================================
// Phase 2 — FIREWORKS: blinded expires after 10 rounds (1 min)
// ============================================================

console.log('\n=== Phase 2 — FIREWORKS: blinded expires after 10 rounds ===\n');

{
  const caster = makeCombatant('wiz', {
    actions: [PYRO_ACTION], resources: withSlots2(1), pos: { x: 0, y: 0, z: 0 },
  });
  const enemy = makeCombatant('e1', {
    faction: 'enemy', con: 1, pos: { x: 5, y: 0, z: 0 },
  });
  const bf = makeBF([caster, enemy], 1);
  const state = makeState(bf);

  executeFireworks(caster, [enemy], state);
  assert('2a. Blinded present at round 1', enemy.conditions.has('blinded'));

  bf.round = 11;
  reevaluateEffects(enemy, bf);
  assert('2b. Blinded still present at round 11 (boundary)', enemy.conditions.has('blinded'));
  eq('2c. Effect still in activeEffects at round 11', enemy.activeEffects.length, 1);

  bf.round = 12;
  reevaluateEffects(enemy, bf);
  assert('2d. Blinded removed after round 12 (1-min expiry)', !enemy.conditions.has('blinded'));
  eq('2e. Effect removed from activeEffects after expiry', enemy.activeEffects.length, 0);
}

// ============================================================
// Phase 3 — SMOKE mode: effect carries sourceTurnExpires
// ============================================================

console.log('\n=== Phase 3 — SMOKE: effect carries sourceTurnExpires ===\n');

{
  const caster = makeCombatant('wiz', {
    actions: [PYRO_ACTION], resources: withSlots2(1), pos: { x: 0, y: 0, z: 0 },
  });
  // SMOKE has no save — even a high-CON enemy is blinded.
  const enemy = makeCombatant('e1', {
    faction: 'enemy', con: 30, pos: { x: 5, y: 0, z: 0 },
  });
  const bf = makeBF([caster, enemy], 1);
  const state = makeState(bf);

  executeSmoke(caster, [enemy], state);

  assert('3a. Enemy blinded after SMOKE (no save)', enemy.conditions.has('blinded'));

  const eff = enemy.activeEffects.find(
    e => e.effectType === 'condition_apply' && e.payload?.condition === 'blinded' && e.spellName === 'Pyrotechnics',
  );
  assert('3b. Pyrotechnics blinded effect exists', eff !== undefined);
  eq('3c. appliedTurn = 1 (cast on round 1)', eff!.appliedTurn, 1);
  eq('3d. sourceTurnExpires = 11 (round 1 + 10 = 1 min)', eff!.sourceTurnExpires, 11);
  assert('3e. sourceIsConcentration = false (non-concentration)', eff!.sourceIsConcentration === false);
}

// ============================================================
// Phase 4 — SMOKE: blinded expires after 10 rounds (1 min)
// ============================================================

console.log('\n=== Phase 4 — SMOKE: blinded expires after 10 rounds ===\n');

{
  const caster = makeCombatant('wiz', {
    actions: [PYRO_ACTION], resources: withSlots2(1), pos: { x: 0, y: 0, z: 0 },
  });
  const enemy = makeCombatant('e1', {
    faction: 'enemy', con: 30, pos: { x: 5, y: 0, z: 0 },
  });
  const bf = makeBF([caster, enemy], 1);
  const state = makeState(bf);

  executeSmoke(caster, [enemy], state);
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
// Phase 5 — Metadata flag
// ============================================================

console.log('\n=== Phase 5 — Metadata flag ===\n');

{
  eq('5a. pyrotechnicsBlindedDurationV1Implemented = true (Session 82)',
    metadata.pyrotechnicsBlindedDurationV1Implemented, true);
  // Prior flags unchanged.
  eq('5b. pyrotechnicsSmokeModeV1Implemented still true',
    metadata.pyrotechnicsSmokeModeV1Implemented, true);
  eq('5c. concentration still false', metadata.concentration, false);
}

// ============================================================
// Phase 6 — Source-code presence checks
// ============================================================

console.log('\n=== Phase 6 — Source-code presence checks ===\n');

{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'spells', 'pyrotechnics.ts'), 'utf8');

  // Both modes (FIREWORKS + SMOKE) set appliedTurn + sourceTurnExpires.
  // Anchor on the function declarations (not the header comments which also
  // mention the function names).
  const fwStart = src.indexOf('export function executeFireworks');
  const smStart = src.indexOf('export function executeSmoke');
  const fireworksBlock = src.slice(fwStart, smStart);
  const smokeBlock = src.slice(smStart);
  assert('6a. FIREWORKS mode sets appliedTurn + sourceTurnExpires',
    fireworksBlock.includes('appliedTurn: round') &&
    fireworksBlock.includes('sourceTurnExpires: round + 10'));
  assert('6b. SMOKE mode sets appliedTurn + sourceTurnExpires',
    smokeBlock.includes('appliedTurn: round') &&
    smokeBlock.includes('sourceTurnExpires: round + 10'));
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
