// ============================================================
// Test: Session 69 — Batch 8 out-of-combat utility spells (16 more)
//
// 16 stub spell modules (all outOfCombat: shouldCast → null, execute no-op):
//   Detect Poison and Disease  (PHB p.231): L1 Div, self, conc 10 min
//   Illusory Script            (PHB p.252): L1 Ill, touch, 1-min cast
//   Rope Trick                 (PHB p.272): L2 Trans, touch, 1 hr
//   Planar Binding             (PHB p.265): L5 Abj, 60 ft, 1-hr cast
//   Find the Path              (PHB p.240): L6 Div, self, 1-min cast, conc
//   Word of Recall             (PHB p.289): L6 Conj, 5 ft, instant
//   Contingency                (PHB p.227): L6 Evoc, self, 10-min cast
//   Demiplane                  (PHB p.231): L8 Conj, 60 ft, 1 hr
//   Telepathy                  (PHB p.281): L8 Evoc, unlimited, 24 hr
//   Astral Projection          (PHB p.215): L9 Nec, 10 ft, 1-hr cast
//   Clone                      (PHB p.222): L8 Nec, touch, 1-hr cast
//   Drawmij's Instant Summons  (PHB p.235): L6 Conj, touch, 1-min cast
//   Forbiddance                (PHB p.243): L6 Abj, touch, 10-min cast
//   Planar Ally                (PHB p.265): L6 Conj, 60 ft, 10-min cast
//   Resurrection               (PHB p.272): L7 Nec, touch, 1-hr cast
//   Simulacrum                 (PHB p.276): L7 Ill, touch, 12-hr cast
//
// Run: npx ts-node --transpile-only src/test/session69_batch8_outofcombat.test.ts
// ============================================================

import { metadata as dpdMeta, shouldCast as shouldCastDetectPoisonAndDisease, execute as executeDetectPoisonAndDisease, cleanup as cleanupDetectPoisonAndDisease } from '../spells/detect_poison_and_disease';
import { metadata as isMeta, shouldCast as shouldCastIllusoryScript, execute as executeIllusoryScript, cleanup as cleanupIllusoryScript } from '../spells/illusory_script';
import { metadata as rtMeta, shouldCast as shouldCastRopeTrick, execute as executeRopeTrick, cleanup as cleanupRopeTrick } from '../spells/rope_trick';
import { metadata as pbMeta, shouldCast as shouldCastPlanarBinding, execute as executePlanarBinding, cleanup as cleanupPlanarBinding } from '../spells/planar_binding';
import { metadata as fpMeta, shouldCast as shouldCastFindThePath, execute as executeFindThePath, cleanup as cleanupFindThePath } from '../spells/find_the_path';
import { metadata as wrMeta, shouldCast as shouldCastWordOfRecall, execute as executeWordOfRecall, cleanup as cleanupWordOfRecall } from '../spells/word_of_recall';
import { metadata as ctMeta, shouldCast as shouldCastContingency, execute as executeContingency, cleanup as cleanupContingency } from '../spells/contingency';
import { metadata as dpMeta, shouldCast as shouldCastDemiplane, execute as executeDemiplane, cleanup as cleanupDemiplane } from '../spells/demiplane';
import { metadata as tpMeta, shouldCast as shouldCastTelepathy, execute as executeTelepathy, cleanup as cleanupTelepathy } from '../spells/telepathy';
import { metadata as apMeta, shouldCast as shouldCastAstralProjection, execute as executeAstralProjection, cleanup as cleanupAstralProjection } from '../spells/astral_projection';
import { metadata as clMeta, shouldCast as shouldCastClone, execute as executeClone, cleanup as cleanupClone } from '../spells/clone';
import { metadata as disMeta, shouldCast as shouldCastDrawmajsInstantSummons, execute as executeDrawmajsInstantSummons, cleanup as cleanupDrawmajsInstantSummons } from '../spells/drawmajs_instant_summons';
import { metadata as fbMeta, shouldCast as shouldCastForbiddance, execute as executeForbiddance, cleanup as cleanupForbiddance } from '../spells/forbiddance';
import { metadata as paMeta, shouldCast as shouldCastPlanarAlly, execute as executePlanarAlly, cleanup as cleanupPlanarAlly } from '../spells/planar_ally';
import { metadata as rsMeta, shouldCast as shouldCastResurrection, execute as executeResurrection, cleanup as cleanupResurrection } from '../spells/resurrection';
import { metadata as smMeta, shouldCast as shouldCastSimulacrum, execute as executeSimulacrum, cleanup as cleanupSimulacrum } from '../spells/simulacrum';

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

  eq('returns null with full HP + nearby enemy', shouldCast(caster, bf), null);
  eq('returns null with low HP', shouldCast({ ...caster, currentHP: 1 }, bf), null);
  eq('returns null when alone', shouldCast(caster, makeBF([caster])), null);

  console.log(`\n=== ${spec.expectedName} — execute is a no-op ===`);
  const state = makeState(bf);
  const beforeHP = caster.currentHP;
  const beforeEffects = caster.activeEffects.length;
  execute(caster, state);
  eq('caster HP unchanged', caster.currentHP, beforeHP);
  eq('caster activeEffects unchanged', caster.activeEffects.length, beforeEffects);

  console.log(`\n=== ${spec.expectedName} — cleanup is a no-op ===`);
  cleanup(caster);
  eq('cleanup does not crash; HP unchanged', caster.currentHP, beforeHP);
}

runOutOfCombatChecks({
  shortName: 'detectPoisonAndDisease',
  meta: dpdMeta, shouldCast: shouldCastDetectPoisonAndDisease, execute: executeDetectPoisonAndDisease, cleanup: cleanupDetectPoisonAndDisease,
  expectedName: 'Detect Poison and Disease', expectedLevel: 1, expectedSchool: 'divination',
  expectedRangeFt: 0, expectedConcentration: true, expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'illusoryScript',
  meta: isMeta, shouldCast: shouldCastIllusoryScript, execute: executeIllusoryScript, cleanup: cleanupIllusoryScript,
  expectedName: 'Illusory Script', expectedLevel: 1, expectedSchool: 'illusion',
  expectedRangeFt: 5, expectedConcentration: false, expectedCastingTime: '1_minute',
});

runOutOfCombatChecks({
  shortName: 'ropeTrick',
  meta: rtMeta, shouldCast: shouldCastRopeTrick, execute: executeRopeTrick, cleanup: cleanupRopeTrick,
  expectedName: 'Rope Trick', expectedLevel: 2, expectedSchool: 'transmutation',
  expectedRangeFt: 5, expectedConcentration: false, expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'planarBinding',
  meta: pbMeta, shouldCast: shouldCastPlanarBinding, execute: executePlanarBinding, cleanup: cleanupPlanarBinding,
  expectedName: 'Planar Binding', expectedLevel: 5, expectedSchool: 'abjuration',
  expectedRangeFt: 60, expectedConcentration: false, expectedCastingTime: '1_hour',
});

runOutOfCombatChecks({
  shortName: 'findThePath',
  meta: fpMeta, shouldCast: shouldCastFindThePath, execute: executeFindThePath, cleanup: cleanupFindThePath,
  expectedName: 'Find the Path', expectedLevel: 6, expectedSchool: 'divination',
  expectedRangeFt: 0, expectedConcentration: true, expectedCastingTime: '1_minute',
});

runOutOfCombatChecks({
  shortName: 'wordOfRecall',
  meta: wrMeta, shouldCast: shouldCastWordOfRecall, execute: executeWordOfRecall, cleanup: cleanupWordOfRecall,
  expectedName: 'Word of Recall', expectedLevel: 6, expectedSchool: 'conjuration',
  expectedRangeFt: 5, expectedConcentration: false, expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'contingency',
  meta: ctMeta, shouldCast: shouldCastContingency, execute: executeContingency, cleanup: cleanupContingency,
  expectedName: 'Contingency', expectedLevel: 6, expectedSchool: 'evocation',
  expectedRangeFt: 0, expectedConcentration: false, expectedCastingTime: '10_minutes',
});

runOutOfCombatChecks({
  shortName: 'demiplane',
  meta: dpMeta, shouldCast: shouldCastDemiplane, execute: executeDemiplane, cleanup: cleanupDemiplane,
  expectedName: 'Demiplane', expectedLevel: 8, expectedSchool: 'conjuration',
  expectedRangeFt: 60, expectedConcentration: false, expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'telepathy',
  meta: tpMeta, shouldCast: shouldCastTelepathy, execute: executeTelepathy, cleanup: cleanupTelepathy,
  expectedName: 'Telepathy', expectedLevel: 8, expectedSchool: 'evocation',
  expectedRangeFt: 5280, expectedConcentration: false, expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'astralProjection',
  meta: apMeta, shouldCast: shouldCastAstralProjection, execute: executeAstralProjection, cleanup: cleanupAstralProjection,
  expectedName: 'Astral Projection', expectedLevel: 9, expectedSchool: 'necromancy',
  expectedRangeFt: 10, expectedConcentration: false, expectedCastingTime: '1_hour',
});

runOutOfCombatChecks({
  shortName: 'clone',
  meta: clMeta, shouldCast: shouldCastClone, execute: executeClone, cleanup: cleanupClone,
  expectedName: 'Clone', expectedLevel: 8, expectedSchool: 'necromancy',
  expectedRangeFt: 5, expectedConcentration: false, expectedCastingTime: '1_hour',
});

runOutOfCombatChecks({
  shortName: 'drawmajsInstantSummons',
  meta: disMeta, shouldCast: shouldCastDrawmajsInstantSummons, execute: executeDrawmajsInstantSummons, cleanup: cleanupDrawmajsInstantSummons,
  expectedName: "Drawmij's Instant Summons", expectedLevel: 6, expectedSchool: 'conjuration',
  expectedRangeFt: 5, expectedConcentration: false, expectedCastingTime: '1_minute',
});

runOutOfCombatChecks({
  shortName: 'forbiddance',
  meta: fbMeta, shouldCast: shouldCastForbiddance, execute: executeForbiddance, cleanup: cleanupForbiddance,
  expectedName: 'Forbiddance', expectedLevel: 6, expectedSchool: 'abjuration',
  expectedRangeFt: 5, expectedConcentration: false, expectedCastingTime: '10_minutes',
});

runOutOfCombatChecks({
  shortName: 'planarAlly',
  meta: paMeta, shouldCast: shouldCastPlanarAlly, execute: executePlanarAlly, cleanup: cleanupPlanarAlly,
  expectedName: 'Planar Ally', expectedLevel: 6, expectedSchool: 'conjuration',
  expectedRangeFt: 60, expectedConcentration: false, expectedCastingTime: '10_minutes',
});

runOutOfCombatChecks({
  shortName: 'resurrection',
  meta: rsMeta, shouldCast: shouldCastResurrection, execute: executeResurrection, cleanup: cleanupResurrection,
  expectedName: 'Resurrection', expectedLevel: 7, expectedSchool: 'necromancy',
  expectedRangeFt: 5, expectedConcentration: false, expectedCastingTime: '1_hour',
});

runOutOfCombatChecks({
  shortName: 'simulacrum',
  meta: smMeta, shouldCast: shouldCastSimulacrum, execute: executeSimulacrum, cleanup: cleanupSimulacrum,
  expectedName: 'Simulacrum', expectedLevel: 7, expectedSchool: 'illusion',
  expectedRangeFt: 5, expectedConcentration: false, expectedCastingTime: '12_hours',
});

// ============================================================
// === Integration Points Verification ===
// ============================================================
console.log('\n=== Integration Points ===');

(async () => {
  const fs = await import('fs');
  const coreSrc = fs.readFileSync(__dirname + '/../types/core.ts', 'utf8');
  const combatSrc = fs.readFileSync(__dirname + '/../engine/combat.ts', 'utf8');
  const plannerSrc = fs.readFileSync(__dirname + '/../ai/planner.ts', 'utf8');

  const cases = [
    ['detectPoisonAndDisease', 'Detect Poison and Disease', 'shouldCastDetectPoisonAndDisease'],
    ['illusoryScript',         'Illusory Script',            'shouldCastIllusoryScript'],
    ['ropeTrick',              'Rope Trick',                 'shouldCastRopeTrick'],
    ['planarBinding',          'Planar Binding',             'shouldCastPlanarBinding'],
    ['findThePath',            'Find the Path',              'shouldCastFindThePath'],
    ['wordOfRecall',           'Word of Recall',             'shouldCastWordOfRecall'],
    ['contingency',            'Contingency',                'shouldCastContingency'],
    ['demiplane',              'Demiplane',                  'shouldCastDemiplane'],
    ['telepathy',              'Telepathy',                  'shouldCastTelepathy'],
    ['astralProjection',       'Astral Projection',          'shouldCastAstralProjection'],
    ['clone',                  'Clone',                      'shouldCastClone'],
    ['drawmajsInstantSummons', "Drawmij's Instant Summons",  'shouldCastDrawmajsInstantSummons'],
    ['forbiddance',            'Forbiddance',                'shouldCastForbiddance'],
    ['planarAlly',             'Planar Ally',                'shouldCastPlanarAlly'],
    ['resurrection',           'Resurrection',               'shouldCastResurrection'],
    ['simulacrum',             'Simulacrum',                 'shouldCastSimulacrum'],
  ] as const;

  for (const [t, spellName, fnName] of cases) {
    assert(`PlannedAction type '${t}' in union`, coreSrc.includes(`| '${t}'`));
    assert(`combat.ts case '${t}'`, combatSrc.includes(`case '${t}':`));
    assert(`planner.ts branch for '${spellName}'`, plannerSrc.includes(`a.name === '${spellName}'`) || plannerSrc.includes(`a.name === "${spellName}"`));
    assert(`planner.ts import '${fnName}'`, plannerSrc.includes(`import { shouldCast as ${fnName}`));
  }
})();

// ---- results ------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
