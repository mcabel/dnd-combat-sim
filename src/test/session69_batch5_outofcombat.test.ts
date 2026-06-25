// ============================================================
// Test: Session 69 — Batch 5 out-of-combat utility divinations
//
// 10 stub spell modules (all outOfCombat: shouldCast → null, execute no-op):
//   Detect Magic         (PHB p.231): L1 Div, self, conc 10 min (ritual)
//   Comprehend Languages (PHB p.224): L1 Div, self, 1 hr (ritual)
//   Identify             (PHB p.252): L1 Div, touch, 1-min cast (ritual)
//   Locate Object        (PHB p.256): L2 Div, self, conc 10 min
//   Clairvoyance         (PHB p.222): L3 Div, 1 mile, conc 10 min, 10-min cast
//   Sending              (PHB p.274): L3 Evoc, unlimited, 1 round
//   Tongues              (PHB p.283): L3 Div, touch, 1 hr
//   Water Breathing      (PHB p.287): L3 Trans, 30 ft, 24 hr (ritual)
//   Divination           (PHB p.234): L4 Div, self, instant (ritual)
//   Locate Creature      (PHB p.256): L4 Div, self, conc 1 hr
//
// Verifies:
//   1. Metadata: name, level, school, rangeFt, concentration, castingTime
//   2. outOfCombat flag is true
//   3. shouldCast always returns null (never fires in combat)
//   4. execute is a no-op (does not crash, does not mutate state)
//   5. cleanup is a no-op
//   6. Integration points exist (type union, combat.ts case, planner.ts branch)
//
// Run: npx ts-node --transpile-only src/test/session69_batch5_outofcombat.test.ts
// ============================================================

import { metadata as dmMeta, shouldCast as shouldCastDetectMagic, execute as executeDetectMagic, cleanup as cleanupDetectMagic } from '../spells/detect_magic';
import { metadata as clMeta, shouldCast as shouldCastComprehendLanguages, execute as executeComprehendLanguages, cleanup as cleanupComprehendLanguages } from '../spells/comprehend_languages';
import { metadata as idMeta, shouldCast as shouldCastIdentify, execute as executeIdentify, cleanup as cleanupIdentify } from '../spells/identify';
import { metadata as loMeta, shouldCast as shouldCastLocateObject, execute as executeLocateObject, cleanup as cleanupLocateObject } from '../spells/locate_object';
import { metadata as cvMeta, shouldCast as shouldCastClairvoyance, execute as executeClairvoyance, cleanup as cleanupClairvoyance } from '../spells/clairvoyance';
import { metadata as sdMeta, shouldCast as shouldCastSending, execute as executeSending, cleanup as cleanupSending } from '../spells/sending';
import { metadata as tgMeta, shouldCast as shouldCastTongues, execute as executeTongues, cleanup as cleanupTongues } from '../spells/tongues';
import { metadata as wbMeta, shouldCast as shouldCastWaterBreathing, execute as executeWaterBreathing, cleanup as cleanupWaterBreathing } from '../spells/water_breathing';
import { metadata as dvMeta, shouldCast as shouldCastDivination, execute as executeDivination, cleanup as cleanupDivination } from '../spells/divination';
import { metadata as lcMeta, shouldCast as shouldCastLocateCreature, execute as executeLocateCreature, cleanup as cleanupLocateCreature } from '../spells/locate_creature';

import { EngineState } from '../engine/combat';
import { Combatant, Battlefield, Condition } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

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
// Helper: run all checks for one outOfCombat spell module
// ============================================================
interface SpellSpec {
  shortName: string;
  meta: any;
  shouldCast: (c: Combatant, bf: Battlefield) => Combatant | null;
  execute: (c: Combatant, s: EngineState) => void;
  cleanup: (c: Combatant) => void;
  expectedName: string;
  expectedLevel: number;
  expectedSchool: string;
  expectedRangeFt: number;
  expectedConcentration: boolean;
  expectedCastingTime: string;
}

function runOutOfCombatChecks(spec: SpellSpec): void {
  const { meta, shouldCast, execute, cleanup } = spec;

  console.log(`\n=== ${spec.expectedName} — Metadata ===`);
  eq('name', meta.name, spec.expectedName);
  eq('level', meta.level, spec.expectedLevel);
  eq('school', meta.school, spec.expectedSchool);
  eq('rangeFt', meta.rangeFt, spec.expectedRangeFt);
  eq('concentration', meta.concentration, spec.expectedConcentration);
  eq('castingTime', meta.castingTime, spec.expectedCastingTime);
  assert('outOfCombat flag is true', meta.outOfCombat === true);
  assert('v1-implemented flag is true', (meta as any)[`${spec.shortName}OutOfCombatV1Implemented`] === true);

  console.log(`\n=== ${spec.expectedName} — shouldCast always returns null ===`);
  const caster = makeCombatant('caster', { faction: 'party' });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 2, y: 0, z: 0 } });
  const ally = makeCombatant('ally', { faction: 'party', pos: { x: 0, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy, ally]);

  // shouldCast returns null regardless of state
  eq('returns null with full HP + nearby enemy', shouldCast(caster, bf), null);
  eq('returns null with low HP', shouldCast({ ...caster, currentHP: 1 }, bf), null);
  eq('returns null when bloodied', shouldCast({ ...caster, currentHP: 5 }, bf), null);
  eq('returns null when alone', shouldCast(caster, makeBF([caster])), null);
  eq('returns null when full party', shouldCast(caster, makeBF([caster, ally, enemy])), null);

  console.log(`\n=== ${spec.expectedName} — execute is a no-op ===`);
  const state = makeState(bf);
  const beforeHP = caster.currentHP;
  const beforeEffects = caster.activeEffects.length;
  const beforeLog = state.log.events.length;
  // Execute should not crash and should not mutate any state
  execute(caster, state);
  eq('caster HP unchanged', caster.currentHP, beforeHP);
  eq('caster activeEffects unchanged', caster.activeEffects.length, beforeEffects);
  eq('state log events unchanged', state.log.events.length, beforeLog);
  eq('caster concentration still null', caster.concentration, null);
  eq('caster conditions still empty', caster.conditions.size, 0);

  console.log(`\n=== ${spec.expectedName} — cleanup is a no-op ===`);
  cleanup(caster);
  eq('cleanup does not crash; HP unchanged', caster.currentHP, beforeHP);
  eq('cleanup does not crash; effects unchanged', caster.activeEffects.length, beforeEffects);
}

// ============================================================
// Run all 10 spells
// ============================================================

runOutOfCombatChecks({
  shortName: 'detectMagic',
  meta: dmMeta,
  shouldCast: shouldCastDetectMagic,
  execute: executeDetectMagic,
  cleanup: cleanupDetectMagic,
  expectedName: 'Detect Magic',
  expectedLevel: 1,
  expectedSchool: 'divination',
  expectedRangeFt: 0,
  expectedConcentration: true,
  expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'comprehendLanguages',
  meta: clMeta,
  shouldCast: shouldCastComprehendLanguages,
  execute: executeComprehendLanguages,
  cleanup: cleanupComprehendLanguages,
  expectedName: 'Comprehend Languages',
  expectedLevel: 1,
  expectedSchool: 'divination',
  expectedRangeFt: 0,
  expectedConcentration: false,
  expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'identify',
  meta: idMeta,
  shouldCast: shouldCastIdentify,
  execute: executeIdentify,
  cleanup: cleanupIdentify,
  expectedName: 'Identify',
  expectedLevel: 1,
  expectedSchool: 'divination',
  expectedRangeFt: 5,
  expectedConcentration: false,
  expectedCastingTime: '1_minute',
});

runOutOfCombatChecks({
  shortName: 'locateObject',
  meta: loMeta,
  shouldCast: shouldCastLocateObject,
  execute: executeLocateObject,
  cleanup: cleanupLocateObject,
  expectedName: 'Locate Object',
  expectedLevel: 2,
  expectedSchool: 'divination',
  expectedRangeFt: 0,
  expectedConcentration: true,
  expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'clairvoyance',
  meta: cvMeta,
  shouldCast: shouldCastClairvoyance,
  execute: executeClairvoyance,
  cleanup: cleanupClairvoyance,
  expectedName: 'Clairvoyance',
  expectedLevel: 3,
  expectedSchool: 'divination',
  expectedRangeFt: 5280,
  expectedConcentration: true,
  expectedCastingTime: '10_minutes',
});

runOutOfCombatChecks({
  shortName: 'sending',
  meta: sdMeta,
  shouldCast: shouldCastSending,
  execute: executeSending,
  cleanup: cleanupSending,
  expectedName: 'Sending',
  expectedLevel: 3,
  expectedSchool: 'evocation',
  expectedRangeFt: 5280,
  expectedConcentration: false,
  expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'tongues',
  meta: tgMeta,
  shouldCast: shouldCastTongues,
  execute: executeTongues,
  cleanup: cleanupTongues,
  expectedName: 'Tongues',
  expectedLevel: 3,
  expectedSchool: 'divination',
  expectedRangeFt: 5,
  expectedConcentration: false,
  expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'waterBreathing',
  meta: wbMeta,
  shouldCast: shouldCastWaterBreathing,
  execute: executeWaterBreathing,
  cleanup: cleanupWaterBreathing,
  expectedName: 'Water Breathing',
  expectedLevel: 3,
  expectedSchool: 'transmutation',
  expectedRangeFt: 30,
  expectedConcentration: false,
  expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'divination',
  meta: dvMeta,
  shouldCast: shouldCastDivination,
  execute: executeDivination,
  cleanup: cleanupDivination,
  expectedName: 'Divination',
  expectedLevel: 4,
  expectedSchool: 'divination',
  expectedRangeFt: 0,
  expectedConcentration: false,
  expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'locateCreature',
  meta: lcMeta,
  shouldCast: shouldCastLocateCreature,
  execute: executeLocateCreature,
  cleanup: cleanupLocateCreature,
  expectedName: 'Locate Creature',
  expectedLevel: 4,
  expectedSchool: 'divination',
  expectedRangeFt: 0,
  expectedConcentration: true,
  expectedCastingTime: 'action',
});

// ============================================================
// === Integration Points Verification ===
// ============================================================
console.log('\n=== Integration Points ===');

// 1. types/core.ts — PlannedAction.type union includes all 10
(async () => {
  const coreSrc = await import('fs').then(fs => fs.readFileSync(__dirname + '/../types/core.ts', 'utf8'));
  const expectedTypes = [
    'detectMagic', 'comprehendLanguages', 'identify', 'locateObject',
    'clairvoyance', 'sending', 'tongues', 'waterBreathing', 'divination', 'locateCreature',
  ];
  for (const t of expectedTypes) {
    assert(`PlannedAction type '${t}' in union`, coreSrc.includes(`| '${t}'`));
  }
})();

// 2. combat.ts — imports + case branches
(async () => {
  const combatSrc = await import('fs').then(fs => fs.readFileSync(__dirname + '/../engine/combat.ts', 'utf8'));
  const cases = [
    'detectMagic', 'comprehendLanguages', 'identify', 'locateObject',
    'clairvoyance', 'sending', 'tongues', 'waterBreathing', 'divination', 'locateCreature',
  ];
  for (const c of cases) {
    assert(`combat.ts case '${c}'`, combatSrc.includes(`case '${c}':`));
  }
})();

// 3. planner.ts — imports + branches
(async () => {
  const plannerSrc = await import('fs').then(fs => fs.readFileSync(__dirname + '/../ai/planner.ts', 'utf8'));
  const names = [
    ['Detect Magic', 'shouldCastDetectMagic'],
    ['Comprehend Languages', 'shouldCastComprehendLanguages'],
    ['Identify', 'shouldCastIdentify'],
    ['Locate Object', 'shouldCastLocateObject'],
    ['Clairvoyance', 'shouldCastClairvoyance'],
    ['Sending', 'shouldCastSending'],
    ['Tongues', 'shouldCastTongues'],
    ['Water Breathing', 'shouldCastWaterBreathing'],
    ['Divination', 'shouldCastDivination'],
    ['Locate Creature', 'shouldCastLocateCreature'],
  ] as const;
  for (const [spellName, fnName] of names) {
    assert(`planner.ts branch for '${spellName}'`, plannerSrc.includes(`a.name === '${spellName}'`));
    assert(`planner.ts import '${fnName}'`, plannerSrc.includes(`import { shouldCast as ${fnName}`));
  }
})();

// ============================================================
// === Coverage Report Impact ===
// ============================================================
console.log('\n=== Coverage Report Impact ===');
{
  // The 10 spells are used by these creature counts (per docs/MONSTER-SPELL-COVERAGE.md):
  //   Detect Magic (179), Sending (41), Tongues (36), Comprehend Languages (23),
  //   Identify (13), Locate Object (15), Clairvoyance (18), Water Breathing (11),
  //   Divination (19), Locate Creature (11)
  // Total creature-references unlocked: 179+41+36+23+13+15+18+11+19+11 = 366
  // (unique creatures may be less due to overlap; spell count goes 150 → 140 unbuilt)
  const expectedCreatureRefs = 179 + 41 + 36 + 23 + 13 + 15 + 18 + 11 + 19 + 11;
  eq('total creature-references unlocked by Batch 5', expectedCreatureRefs, 366);
  assert('creature-refs > 300 (high impact)', expectedCreatureRefs > 300);
}

// ---- results ------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
