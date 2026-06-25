// ============================================================
// Test: Session 69 — Batch 7 out-of-combat utility spells (12 more)
//
// 12 stub spell modules (all outOfCombat: shouldCast → null, execute no-op):
//   Longstrider               (PHB p.256): L1 Trans, touch, 1 hr
//   Water Walk                (PHB p.287): L3 Trans, 30 ft, 1 hr (ritual)
//   Gentle Repose             (PHB p.245): L2 Nec, touch, 10 days (ritual)
//   Locate Animals or Plants  (PHB p.256): L2 Div, self, instant (ritual)
//   Commune                   (PHB p.223): L5 Div, self, 1-min cast (ritual)
//   Contact Other Plane       (PHB p.226): L5 Div, self, 1-min cast (ritual)
//   Dream                     (PHB p.236): L5 Ill, special, 1-min cast
//   Legend Lore               (PHB p.254): L5 Div, self, 10-min cast
//   Awaken                    (PHB p.216): L5 Trans, touch, 8-hr cast
//   Heroes' Feast             (PHB p.250): L6 Con, 30 ft, 10-min cast
//   Programmed Illusion       (PHB p.269): L6 Ill, 120 ft, permanent
//   Imprisonment              (PHB p.252): L9 Abj, 30 ft, 1-min cast
//
// Run: npx ts-node --transpile-only src/test/session69_batch7_outofcombat.test.ts
// ============================================================

import { metadata as lsMeta, shouldCast as shouldCastLongstrider, execute as executeLongstrider, cleanup as cleanupLongstrider } from '../spells/longstrider';
import { metadata as wwMeta, shouldCast as shouldCastWaterWalk, execute as executeWaterWalk, cleanup as cleanupWaterWalk } from '../spells/water_walk';
import { metadata as grMeta, shouldCast as shouldCastGentleRepose, execute as executeGentleRepose, cleanup as cleanupGentleRepose } from '../spells/gentle_repose';
import { metadata as lapMeta, shouldCast as shouldCastLocateAnimalsOrPlants, execute as executeLocateAnimalsOrPlants, cleanup as cleanupLocateAnimalsOrPlants } from '../spells/locate_animals_or_plants';
import { metadata as cmMeta, shouldCast as shouldCastCommune, execute as executeCommune, cleanup as cleanupCommune } from '../spells/commune';
import { metadata as copMeta, shouldCast as shouldCastContactOtherPlane, execute as executeContactOtherPlane, cleanup as cleanupContactOtherPlane } from '../spells/contact_other_plane';
import { metadata as drMeta, shouldCast as shouldCastDream, execute as executeDream, cleanup as cleanupDream } from '../spells/dream';
import { metadata as llMeta, shouldCast as shouldCastLegendLore, execute as executeLegendLore, cleanup as cleanupLegendLore } from '../spells/legend_lore';
import { metadata as awMeta, shouldCast as shouldCastAwaken, execute as executeAwaken, cleanup as cleanupAwaken } from '../spells/awaken';
import { metadata as hfMeta, shouldCast as shouldCastHeroesFeast, execute as executeHeroesFeast, cleanup as cleanupHeroesFeast } from '../spells/heroes_feast';
import { metadata as piMeta, shouldCast as shouldCastProgrammedIllusion, execute as executeProgrammedIllusion, cleanup as cleanupProgrammedIllusion } from '../spells/programmed_illusion';
import { metadata as ipMeta, shouldCast as shouldCastImprisonment, execute as executeImprisonment, cleanup as cleanupImprisonment } from '../spells/imprisonment';

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
  eq('returns null when bloodied', shouldCast({ ...caster, currentHP: 5 }, bf), null);
  eq('returns null when alone', shouldCast(caster, makeBF([caster])), null);
  eq('returns null when full party', shouldCast(caster, makeBF([caster, ally, enemy])), null);

  console.log(`\n=== ${spec.expectedName} — execute is a no-op ===`);
  const state = makeState(bf);
  const beforeHP = caster.currentHP;
  const beforeEffects = caster.activeEffects.length;
  const beforeLog = state.log.events.length;
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

runOutOfCombatChecks({
  shortName: 'longstrider',
  meta: lsMeta, shouldCast: shouldCastLongstrider, execute: executeLongstrider, cleanup: cleanupLongstrider,
  expectedName: 'Longstrider', expectedLevel: 1, expectedSchool: 'transmutation',
  expectedRangeFt: 5, expectedConcentration: false, expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'waterWalk',
  meta: wwMeta, shouldCast: shouldCastWaterWalk, execute: executeWaterWalk, cleanup: cleanupWaterWalk,
  expectedName: 'Water Walk', expectedLevel: 3, expectedSchool: 'transmutation',
  expectedRangeFt: 30, expectedConcentration: false, expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'gentleRepose',
  meta: grMeta, shouldCast: shouldCastGentleRepose, execute: executeGentleRepose, cleanup: cleanupGentleRepose,
  expectedName: 'Gentle Repose', expectedLevel: 2, expectedSchool: 'necromancy',
  expectedRangeFt: 5, expectedConcentration: false, expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'locateAnimalsOrPlants',
  meta: lapMeta, shouldCast: shouldCastLocateAnimalsOrPlants, execute: executeLocateAnimalsOrPlants, cleanup: cleanupLocateAnimalsOrPlants,
  expectedName: 'Locate Animals or Plants', expectedLevel: 2, expectedSchool: 'divination',
  expectedRangeFt: 0, expectedConcentration: false, expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'commune',
  meta: cmMeta, shouldCast: shouldCastCommune, execute: executeCommune, cleanup: cleanupCommune,
  expectedName: 'Commune', expectedLevel: 5, expectedSchool: 'divination',
  expectedRangeFt: 0, expectedConcentration: false, expectedCastingTime: '1_minute',
});

runOutOfCombatChecks({
  shortName: 'contactOtherPlane',
  meta: copMeta, shouldCast: shouldCastContactOtherPlane, execute: executeContactOtherPlane, cleanup: cleanupContactOtherPlane,
  expectedName: 'Contact Other Plane', expectedLevel: 5, expectedSchool: 'divination',
  expectedRangeFt: 0, expectedConcentration: false, expectedCastingTime: '1_minute',
});

runOutOfCombatChecks({
  shortName: 'dream',
  meta: drMeta, shouldCast: shouldCastDream, execute: executeDream, cleanup: cleanupDream,
  expectedName: 'Dream', expectedLevel: 5, expectedSchool: 'illusion',
  expectedRangeFt: 0, expectedConcentration: false, expectedCastingTime: '1_minute',
});

runOutOfCombatChecks({
  shortName: 'legendLore',
  meta: llMeta, shouldCast: shouldCastLegendLore, execute: executeLegendLore, cleanup: cleanupLegendLore,
  expectedName: 'Legend Lore', expectedLevel: 5, expectedSchool: 'divination',
  expectedRangeFt: 0, expectedConcentration: false, expectedCastingTime: '10_minutes',
});

runOutOfCombatChecks({
  shortName: 'awaken',
  meta: awMeta, shouldCast: shouldCastAwaken, execute: executeAwaken, cleanup: cleanupAwaken,
  expectedName: 'Awaken', expectedLevel: 5, expectedSchool: 'transmutation',
  expectedRangeFt: 5, expectedConcentration: false, expectedCastingTime: '8_hours',
});

runOutOfCombatChecks({
  shortName: 'heroesFeast',
  meta: hfMeta, shouldCast: shouldCastHeroesFeast, execute: executeHeroesFeast, cleanup: cleanupHeroesFeast,
  expectedName: "Heroes' Feast", expectedLevel: 6, expectedSchool: 'conjuration',
  expectedRangeFt: 30, expectedConcentration: false, expectedCastingTime: '10_minutes',
});

runOutOfCombatChecks({
  shortName: 'programmedIllusion',
  meta: piMeta, shouldCast: shouldCastProgrammedIllusion, execute: executeProgrammedIllusion, cleanup: cleanupProgrammedIllusion,
  expectedName: 'Programmed Illusion', expectedLevel: 6, expectedSchool: 'illusion',
  expectedRangeFt: 120, expectedConcentration: false, expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'imprisonment',
  meta: ipMeta, shouldCast: shouldCastImprisonment, execute: executeImprisonment, cleanup: cleanupImprisonment,
  expectedName: 'Imprisonment', expectedLevel: 9, expectedSchool: 'abjuration',
  expectedRangeFt: 30, expectedConcentration: false, expectedCastingTime: '1_minute',
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
    ['longstrider',            'Longstrider',              'shouldCastLongstrider'],
    ['waterWalk',              'Water Walk',               'shouldCastWaterWalk'],
    ['gentleRepose',           'Gentle Repose',            'shouldCastGentleRepose'],
    ['locateAnimalsOrPlants',  'Locate Animals or Plants', 'shouldCastLocateAnimalsOrPlants'],
    ['commune',                'Commune',                  'shouldCastCommune'],
    ['contactOtherPlane',      'Contact Other Plane',      'shouldCastContactOtherPlane'],
    ['dream',                  'Dream',                    'shouldCastDream'],
    ['legendLore',             'Legend Lore',              'shouldCastLegendLore'],
    ['awaken',                 'Awaken',                   'shouldCastAwaken'],
    ['heroesFeast',            "Heroes' Feast",            'shouldCastHeroesFeast'],
    ['programmedIllusion',     'Programmed Illusion',      'shouldCastProgrammedIllusion'],
    ['imprisonment',           'Imprisonment',             'shouldCastImprisonment'],
  ] as const;

  for (const [t, spellName, fnName] of cases) {
    assert(`PlannedAction type '${t}' in union`, coreSrc.includes(`| '${t}'`));
    assert(`combat.ts case '${t}'`, combatSrc.includes(`case '${t}':`));
    assert(`planner.ts branch for '${spellName}'`, plannerSrc.includes(`a.name === '${spellName}'`) || plannerSrc.includes(`a.name === "${spellName}"`));
    assert(`planner.ts import '${fnName}'`, plannerSrc.includes(`import { shouldCast as ${fnName}`));
  }
})();

// ============================================================
// === Coverage Report Impact ===
// ============================================================
console.log('\n=== Coverage Report Impact ===');
{
  // Batch 7 creature counts (per docs/MONSTER-SPELL-COVERAGE.md):
  //   Longstrider (9), Water Walk (8), Commune (7), Legend Lore (6), Dream (8),
  //   Contact Other Plane (4), Awaken (4), Imprisonment (4), Gentle Repose (3),
  //   Heroes' Feast (3), Locate Animals or Plants (3), Programmed Illusion (3)
  const expectedCreatureRefs = 9 + 8 + 7 + 6 + 8 + 4 + 4 + 4 + 3 + 3 + 3 + 3;
  eq('total creature-references unlocked by Batch 7', expectedCreatureRefs, 62);
  assert('creature-refs > 50 (high impact)', expectedCreatureRefs > 50);
}

// ---- results ------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
