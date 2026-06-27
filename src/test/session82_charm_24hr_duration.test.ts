// ============================================================
// Test: Session 82 — RFC-COMBINING-EFFECTS Phase 2
//       sourceTurnExpires on 24-hr non-concentration charm spells
//       (Animal Friendship, Mass Suggestion)
//
// PHB p.212 Animal Friendship: 1st-level, NO concentration, 24-hr
//   charmed (beast-only, INT<4).
// PHB p.258 Mass Suggestion: 6th-level, NO concentration, 24-hr
//   suggestion effect (charmed + disadv on attacks).
//
// Prior state: neither set sourceTurnExpires, so the charmed/
// suggestion effect persisted for the entire combat. Session 82
// mirrors the existing charm_person (1-hr) pattern, scaled to 24 hr:
// both now set appliedTurn + sourceTurnExpires = round + 14400
// (24 hr = 14400 rounds).
//
// Combat rarely reaches 24 h, so the on-expiry removal is unlikely
// to fire in normal play — but the value is set for correctness and
// long-running sim scenarios. This test verifies the effect carries
// the correct fields AND that a synthetic round > sourceTurnExpires
// correctly expires the effect via reevaluateEffects.
//
// Run: npx ts-node --transpile-only src/test/session82_charm_24hr_duration.test.ts
// ============================================================

import { Combatant, Action, PlayerResources, Condition } from '../types/core';
import { execute as afExecute } from '../spells/animal_friendship';
import { execute as msExecute, metadata as msMeta } from '../spells/mass_suggestion';
import { metadata as afMeta } from '../spells/animal_friendship';
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

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 1, con: 10, int: 2, wis: 1, cha: 10,  // wis 1 → fails WIS save; int 2 → Animal Friendship eligible
    cr: 1, creatureType: 'beast',
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

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

function withSlots(level: number, remaining = 1): PlayerResources {
  return { spellSlots: { [level]: { max: 2, remaining } } };
}

const AF_ACTION: Action = {
  name: 'Animal Friendship', isMultiattack: false, attackType: 'save',
  reach: 5, range: { normal: 30, long: 30 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'wis', isAoE: false, isControl: true,
  requiresConcentration: false, slotLevel: 1, costType: 'action',
  legendaryCost: 0, description: 'Animal Friendship',
};

const MS_ACTION: Action = {
  name: 'Mass Suggestion', isMultiattack: false, attackType: 'save',
  reach: 5, range: { normal: 60, long: 60 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'wis', isAoE: true, isControl: true,
  requiresConcentration: false, slotLevel: 6, costType: 'action',
  legendaryCost: 0, description: 'Mass Suggestion',
};

// ============================================================
// Phase 1 — Animal Friendship: effect carries sourceTurnExpires
// ============================================================

console.log('\n=== Phase 1 — Animal Friendship: 24-hr sourceTurnExpires ===\n');

{
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [AF_ACTION], resources: withSlots(1, 1),
  });
  const beast = makeCombatant('wolf', {
    creatureType: 'beast', int: 2, wis: 1, pos: { x: 1, y: 0, z: 0 },
  });
  const bf = makeBF([caster, beast], 1);
  const state = makeState(bf);

  afExecute(caster, beast, state);

  assert('1a. Beast charmed after Animal Friendship', beast.conditions.has('charmed'));

  const eff = beast.activeEffects.find(
    e => e.spellName === 'Animal Friendship' && e.effectType === 'condition_apply',
  );
  assert('1b. Animal Friendship effect exists', eff !== undefined);
  eq('1c. appliedTurn = 1', eff!.appliedTurn, 1);
  eq('1d. sourceTurnExpires = 14401 (round 1 + 14400 = 24 hr)', eff!.sourceTurnExpires, 14401);
  assert('1e. sourceIsConcentration = false', eff!.sourceIsConcentration === false);
}

// ============================================================
// Phase 2 — Animal Friendship: expires at round 14402 (24 hr)
// ============================================================

console.log('\n=== Phase 2 — Animal Friendship: synthetic 24-hr expiry ===\n');

{
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [AF_ACTION], resources: withSlots(1, 1),
  });
  const beast = makeCombatant('wolf', {
    creatureType: 'beast', int: 2, wis: 1, pos: { x: 1, y: 0, z: 0 },
  });
  const bf = makeBF([caster, beast], 1);
  const state = makeState(bf);

  afExecute(caster, beast, state);
  assert('2a. Charmed present at round 1', beast.conditions.has('charmed'));

  // Boundary: round == sourceTurnExpires (14401) → still active.
  bf.round = 14401;
  reevaluateEffects(beast, bf);
  assert('2b. Charmed still present at round 14401 (boundary)', beast.conditions.has('charmed'));

  // Round 14402 > sourceTurnExpires(14401) → expired.
  bf.round = 14402;
  reevaluateEffects(beast, bf);
  assert('2c. Charmed removed after round 14402 (24-hr expiry)', !beast.conditions.has('charmed'));
  eq('2d. Effect removed from activeEffects', beast.activeEffects.length, 0);
}

// ============================================================
// Phase 3 — Mass Suggestion: effect carries sourceTurnExpires
// ============================================================

console.log('\n=== Phase 3 — Mass Suggestion: 24-hr sourceTurnExpires ===\n');

{
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [MS_ACTION], resources: withSlots(6, 1),
  });
  const enemy = makeCombatant('e1', {
    wis: 1, pos: { x: 5, y: 0, z: 0 },
  });
  const bf = makeBF([caster, enemy], 1);
  const state = makeState(bf);

  msExecute(caster, [enemy], state);

  assert('3a. Enemy charmed after Mass Suggestion', enemy.conditions.has('charmed'));

  const eff = enemy.activeEffects.find(
    e => e.spellName === 'Mass Suggestion' && e.effectType === 'suggestion',
  );
  assert('3b. Mass Suggestion suggestion effect exists', eff !== undefined);
  eq('3c. appliedTurn = 1', eff!.appliedTurn, 1);
  eq('3d. sourceTurnExpires = 14401 (round 1 + 14400 = 24 hr)', eff!.sourceTurnExpires, 14401);
  assert('3e. sourceIsConcentration = false', eff!.sourceIsConcentration === false);
}

// ============================================================
// Phase 4 — Mass Suggestion: expires at round 14402 (24 hr)
// ============================================================

console.log('\n=== Phase 4 — Mass Suggestion: synthetic 24-hr expiry ===\n');

{
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [MS_ACTION], resources: withSlots(6, 1),
  });
  const enemy = makeCombatant('e1', {
    wis: 1, pos: { x: 5, y: 0, z: 0 },
  });
  const bf = makeBF([caster, enemy], 1);
  const state = makeState(bf);

  msExecute(caster, [enemy], state);
  assert('4a. Charmed present at round 1', enemy.conditions.has('charmed'));

  bf.round = 14401;
  reevaluateEffects(enemy, bf);
  assert('4b. Charmed still present at round 14401 (boundary)', enemy.conditions.has('charmed'));

  bf.round = 14402;
  reevaluateEffects(enemy, bf);
  assert('4c. Charmed removed after round 14402 (24-hr expiry)', !enemy.conditions.has('charmed'));
  eq('4d. Effect removed from activeEffects', enemy.activeEffects.length, 0);
}

// ============================================================
// Phase 5 — Metadata flags
// ============================================================

console.log('\n=== Phase 5 — Metadata flags ===\n');

{
  eq('5a. animalFriendshipDurationV1Implemented = true (Session 82)',
    afMeta.animalFriendshipDurationV1Implemented, true);
  eq('5b. massSuggestionDurationV1Implemented = true (Session 82)',
    msMeta.massSuggestionDurationV1Implemented, true);
  eq('5c. massSuggestionDurationV1Simplified = false (Session 82)',
    msMeta.massSuggestionDurationV1Simplified, false);
  // Prior flags unchanged.
  eq('5d. Animal Friendship concentration still false', afMeta.concentration, false);
  eq('5e. Mass Suggestion concentration still false', msMeta.concentration, false);
}

// ============================================================
// Phase 6 — Source-code presence checks
// ============================================================

console.log('\n=== Phase 6 — Source-code presence checks ===\n');

{
  const fs = require('fs');
  const path = require('path');

  const afSrc = fs.readFileSync(path.join(__dirname, '..', 'spells', 'animal_friendship.ts'), 'utf8');
  assert('6a. Animal Friendship sets appliedTurn + sourceTurnExpires (14400)',
    afSrc.includes('appliedTurn: round') &&
    afSrc.includes('sourceTurnExpires: round + 14400'));

  const msSrc = fs.readFileSync(path.join(__dirname, '..', 'spells', 'mass_suggestion.ts'), 'utf8');
  assert('6b. Mass Suggestion sets appliedTurn + sourceTurnExpires (14400)',
    msSrc.includes('appliedTurn: round') &&
    msSrc.includes('sourceTurnExpires: round + 14400'));
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
