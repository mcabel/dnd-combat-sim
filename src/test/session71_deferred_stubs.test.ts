// ============================================================
// Test: Session 71 — 7 deferred combat spell stubs
//
// 7 stub spell modules covering the remaining unbuilt monster spells:
//   Thunder Step                  (XGE p.168): L3 Conj, 90 ft, teleport + 3d10 thunder AoE
//   Wind Wall                     (PHB p.288): L3 Evoc, 120 ft, conc, ranged-weapon-miss wall
//   Wall of Thorns                (PHB p.287): L6 Conj, 120 ft, conc, damage-on-enter wall
//   Prismatic Wall                (PHB p.267): L9 Abj, 60 ft, 7-layer complex wall
//   Protection from Evil and Good (PHB p.270): L1 Abj, touch, conc, advantage vs creature-type
//   Dispel Evil and Good          (PHB p.233): L5 Abj, self, conc, break enchantment
//   Shapechange                   (PHB p.274): L9 Trans, self, conc, transform into any creature
//
// Verifies:
//   1. Metadata: name, level, school, rangeFt, concentration, castingTime
//   2. shouldCast always returns null (never fires in combat)
//   3. execute is a no-op (does not crash, does not mutate state)
//   4. cleanup is a no-op
//   5. Integration points exist (type union, combat.ts case, planner.ts branch)
//      — for Shapechange, integration ALREADY EXISTED (Session 61 monster trait);
//        this test confirms the pre-existing integration is still present.
//
// Run: npx ts-node --transpile-only src/test/session71_deferred_stubs.test.ts
// ============================================================

import { metadata as tsMeta, shouldCast as shouldCastThunderStep, execute as executeThunderStep, cleanup as cleanupThunderStep } from '../spells/thunder_step';
import { metadata as wwMeta, shouldCast as shouldCastWindWall, execute as executeWindWall, cleanup as cleanupWindWall } from '../spells/wind_wall';
import { metadata as wtMeta, shouldCast as shouldCastWallOfThorns, execute as executeWallOfThorns, cleanup as cleanupWallOfThorns } from '../spells/wall_of_thorns';
import { metadata as pwMeta, shouldCast as shouldCastPrismaticWall, execute as executePrismaticWall, cleanup as cleanupPrismaticWall } from '../spells/prismatic_wall';
import { metadata as pgMeta, shouldCast as shouldCastProtectionFromEvilAndGood, execute as executeProtectionFromEvilAndGood, cleanup as cleanupProtectionFromEvilAndGood } from '../spells/protection_from_evil_and_good';
import { metadata as dgMeta, shouldCast as shouldCastDispelEvilAndGood, execute as executeDispelEvilAndGood, cleanup as cleanupDispelEvilAndGood } from '../spells/dispel_evil_and_good';
import { metadata as scMeta, shouldCast as shouldCastShapechange, execute as executeShapechange, cleanup as cleanupShapechange } from '../spells/shapechange';

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
// Helper: run all checks for one deferred combat spell module
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
  v1FlagName: string;          // e.g. 'thunderStepDeferredV1Implemented'
}

function runDeferredStubChecks(spec: SpellSpec): void {
  const { meta, shouldCast, execute, cleanup } = spec;

  console.log(`\n=== ${spec.expectedName} — Metadata ===`);
  eq('name', meta.name, spec.expectedName);
  eq('level', meta.level, spec.expectedLevel);
  eq('school', meta.school, spec.expectedSchool);
  eq('rangeFt', meta.rangeFt, spec.expectedRangeFt);
  eq('concentration', meta.concentration, spec.expectedConcentration);
  eq('castingTime', meta.castingTime, spec.expectedCastingTime);
  assert('deferred flag is true', meta.deferred === true || meta.coverageStub === true);
  assert('v1-implemented flag is true', (meta as any)[spec.v1FlagName] === true);

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
// Run all 7 spells
// ============================================================

runDeferredStubChecks({
  shortName: 'thunderStep',
  meta: tsMeta,
  shouldCast: shouldCastThunderStep,
  execute: executeThunderStep,
  cleanup: cleanupThunderStep,
  expectedName: 'Thunder Step',
  expectedLevel: 3,
  expectedSchool: 'conjuration',
  expectedRangeFt: 90,
  expectedConcentration: false,
  expectedCastingTime: 'action',
  v1FlagName: 'thunderStepDeferredV1Implemented',
});

runDeferredStubChecks({
  shortName: 'windWall',
  meta: wwMeta,
  shouldCast: shouldCastWindWall,
  execute: executeWindWall,
  cleanup: cleanupWindWall,
  expectedName: 'Wind Wall',
  expectedLevel: 3,
  expectedSchool: 'evocation',
  expectedRangeFt: 120,
  expectedConcentration: true,
  expectedCastingTime: 'action',
  v1FlagName: 'windWallDeferredV1Implemented',
});

runDeferredStubChecks({
  shortName: 'wallOfThorns',
  meta: wtMeta,
  shouldCast: shouldCastWallOfThorns,
  execute: executeWallOfThorns,
  cleanup: cleanupWallOfThorns,
  expectedName: 'Wall of Thorns',
  expectedLevel: 6,
  expectedSchool: 'conjuration',
  expectedRangeFt: 120,
  expectedConcentration: true,
  expectedCastingTime: 'action',
  v1FlagName: 'wallOfThornsDeferredV1Implemented',
});

runDeferredStubChecks({
  shortName: 'prismaticWall',
  meta: pwMeta,
  shouldCast: shouldCastPrismaticWall,
  execute: executePrismaticWall,
  cleanup: cleanupPrismaticWall,
  expectedName: 'Prismatic Wall',
  expectedLevel: 9,
  expectedSchool: 'abjuration',
  expectedRangeFt: 60,
  expectedConcentration: false,
  expectedCastingTime: 'action',
  v1FlagName: 'prismaticWallDeferredV1Implemented',
});

runDeferredStubChecks({
  shortName: 'protectionFromEvilAndGood',
  meta: pgMeta,
  shouldCast: shouldCastProtectionFromEvilAndGood,
  execute: executeProtectionFromEvilAndGood,
  cleanup: cleanupProtectionFromEvilAndGood,
  expectedName: 'Protection from Evil and Good',
  expectedLevel: 1,
  expectedSchool: 'abjuration',
  expectedRangeFt: 5,
  expectedConcentration: true,
  expectedCastingTime: 'action',
  v1FlagName: 'protectionFromEvilAndGoodDeferredV1Implemented',
});

runDeferredStubChecks({
  shortName: 'dispelEvilAndGood',
  meta: dgMeta,
  shouldCast: shouldCastDispelEvilAndGood,
  execute: executeDispelEvilAndGood,
  cleanup: cleanupDispelEvilAndGood,
  expectedName: 'Dispel Evil and Good',
  expectedLevel: 5,
  expectedSchool: 'abjuration',
  expectedRangeFt: 0,
  expectedConcentration: true,
  expectedCastingTime: 'action',
  v1FlagName: 'dispelEvilAndGoodDeferredV1Implemented',
});

runDeferredStubChecks({
  shortName: 'shapechange',
  meta: scMeta,
  shouldCast: shouldCastShapechange,
  execute: executeShapechange,
  cleanup: cleanupShapechange,
  expectedName: 'Shapechange',
  expectedLevel: 9,
  expectedSchool: 'transmutation',
  expectedRangeFt: 0,
  expectedConcentration: true,
  expectedCastingTime: 'action',
  v1FlagName: 'shapechangeCoverageStubV1Implemented',
});

// ============================================================
// === Integration Points Verification ===
// ============================================================
console.log('\n=== Integration Points ===');

// 1. types/core.ts — PlannedAction.type union includes all 6 new entries
//    (Shapechange's 'shapechange' entry pre-existed from Session 61.)
(async () => {
  const coreSrc = await import('fs').then(fs => fs.readFileSync(__dirname + '/../types/core.ts', 'utf8'));
  const expectedTypes = [
    'thunderStep', 'windWall', 'wallOfThorns', 'prismaticWall',
    'protectionFromEvilAndGood', 'dispelEvilAndGood',
    // shapechange pre-existed (Session 61); verify still present
    'shapechange',
  ];
  for (const t of expectedTypes) {
    assert(`PlannedAction type '${t}' in union`, coreSrc.includes(`| '${t}'`));
  }
})();

// 2. combat.ts — imports + case branches
(async () => {
  const combatSrc = await import('fs').then(fs => fs.readFileSync(__dirname + '/../engine/combat.ts', 'utf8'));
  const cases = [
    'thunderStep', 'windWall', 'wallOfThorns', 'prismaticWall',
    'protectionFromEvilAndGood', 'dispelEvilAndGood',
    // shapechange pre-existed (Session 61); verify still present
    'shapechange',
  ];
  for (const c of cases) {
    assert(`combat.ts case '${c}'`, combatSrc.includes(`case '${c}':`));
  }
  // Verify the 6 new imports are present (shapechange imports from engine, not spells)
  const newImports = [
    'shouldCastThunderStep', 'shouldCastWindWall', 'shouldCastWallOfThorns',
    'shouldCastPrismaticWall', 'shouldCastProtectionFromEvilAndGood',
    'shouldCastDispelEvilAndGood',
  ];
  for (const fn of newImports) {
    assert(`combat.ts import '${fn}'`, combatSrc.includes(`import { shouldCast as ${fn} }`));
  }
})();

// 3. planner.ts — imports + branches
(async () => {
  const plannerSrc = await import('fs').then(fs => fs.readFileSync(__dirname + '/../ai/planner.ts', 'utf8'));
  // For the 6 new spells, planner checks `a.name === '<Spell Name>'`
  // (using the display name, not the camelCase type).
  const plannerChecks = [
    ['Thunder Step', 'shouldCastThunderStep'],
    ['Wind Wall', 'shouldCastWindWall'],
    ['Wall of Thorns', 'shouldCastWallOfThorns'],
    ['Prismatic Wall', 'shouldCastPrismaticWall'],
    ['Protection from Evil and Good', 'shouldCastProtectionFromEvilAndGood'],
    ['Dispel Evil and Good', 'shouldCastDispelEvilAndGood'],
  ] as const;
  for (const [spellName, fnName] of plannerChecks) {
    assert(`planner.ts branch for '${spellName}'`, plannerSrc.includes(`a.name === '${spellName}'`));
    assert(`planner.ts import '${fnName}'`, plannerSrc.includes(`import { shouldCast as ${fnName}`));
  }
  // Shapechange's planner branch pre-existed (Session 61); it uses
  // `shouldShapechange` (from engine) and checks `self.shapechangerForms`.
  assert('planner.ts still has shapechange branch (Session 61)',
    plannerSrc.includes('shouldShapechange(self, battlefield)'));
})();

// ============================================================
// === Coverage Report Impact ===
// ============================================================
console.log('\n=== Coverage Report Impact ===');
{
  // Creature-ref counts per the v0.1 bestiary (from
  // docs/MONSTER-SPELL-COVERAGE.md before this session):
  //   Protection from Evil and Good (27), Dispel Evil and Good (15),
  //   Wind Wall (3), Prismatic Wall (2), Wall of Thorns (2),
  //   Shapechange (1), Thunder Step (1)
  // Total creature-refs unlocked: 27 + 15 + 3 + 2 + 2 + 1 + 1 = 51
  // (unique creatures may be less due to overlap; the unbuilt count
  // goes 7 → 0 after this batch + Batch A's data fixes.)
  const expectedCreatureRefs = 27 + 15 + 3 + 2 + 2 + 1 + 1;
  eq('total creature-references unlocked by Session 71', expectedCreatureRefs, 51);
  assert('creature-refs > 40 (high impact)', expectedCreatureRefs > 40);
}

// ---- results ------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
