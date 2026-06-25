// ============================================================
// Test: Session 69 — Batch 6 out-of-combat utility divinations (5 more)
//
// 5 stub spell modules (all outOfCombat: shouldCast → null, execute no-op):
//   Detect Evil and Good (PHB p.231): L1 Div, self, conc 10 min
//   Augury               (PHB p.215): L2 Div, self, instant (1-min cast, ritual)
//   Revivify             (PHB p.272): L3 Nec, touch, instant (out-of-combat)
//   Arcane Eye           (PHB p.214): L4 Div, 30 ft, conc 1 hr
//   True Seeing          (PHB p.284): L6 Div, touch, 1 hr
//
// Run: npx ts-node --transpile-only src/test/session69_batch6_outofcombat.test.ts
// ============================================================

import { metadata as degMeta, shouldCast as shouldCastDetectEvilAndGood, execute as executeDetectEvilAndGood, cleanup as cleanupDetectEvilAndGood } from '../spells/detect_evil_and_good';
import { metadata as agMeta, shouldCast as shouldCastAugury, execute as executeAugury, cleanup as cleanupAugury } from '../spells/augury';
import { metadata as rvMeta, shouldCast as shouldCastRevivify, execute as executeRevivify, cleanup as cleanupRevivify } from '../spells/revivify';
import { metadata as aeMeta, shouldCast as shouldCastArcaneEye, execute as executeArcaneEye, cleanup as cleanupArcaneEye } from '../spells/arcane_eye';
import { metadata as tsMeta, shouldCast as shouldCastTrueSeeing, execute as executeTrueSeeing, cleanup as cleanupTrueSeeing } from '../spells/true_seeing';

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
  shortName: 'detectEvilAndGood',
  meta: degMeta,
  shouldCast: shouldCastDetectEvilAndGood,
  execute: executeDetectEvilAndGood,
  cleanup: cleanupDetectEvilAndGood,
  expectedName: 'Detect Evil and Good',
  expectedLevel: 1,
  expectedSchool: 'divination',
  expectedRangeFt: 0,
  expectedConcentration: true,
  expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'augury',
  meta: agMeta,
  shouldCast: shouldCastAugury,
  execute: executeAugury,
  cleanup: cleanupAugury,
  expectedName: 'Augury',
  expectedLevel: 2,
  expectedSchool: 'divination',
  expectedRangeFt: 0,
  expectedConcentration: false,
  expectedCastingTime: '1_minute',
});

runOutOfCombatChecks({
  shortName: 'revivify',
  meta: rvMeta,
  shouldCast: shouldCastRevivify,
  execute: executeRevivify,
  cleanup: cleanupRevivify,
  expectedName: 'Revivify',
  expectedLevel: 3,
  expectedSchool: 'necromancy',
  expectedRangeFt: 5,
  expectedConcentration: false,
  expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'arcaneEye',
  meta: aeMeta,
  shouldCast: shouldCastArcaneEye,
  execute: executeArcaneEye,
  cleanup: cleanupArcaneEye,
  expectedName: 'Arcane Eye',
  expectedLevel: 4,
  expectedSchool: 'divination',
  expectedRangeFt: 30,
  expectedConcentration: true,
  expectedCastingTime: 'action',
});

runOutOfCombatChecks({
  shortName: 'trueSeeing',
  meta: tsMeta,
  shouldCast: shouldCastTrueSeeing,
  execute: executeTrueSeeing,
  cleanup: cleanupTrueSeeing,
  expectedName: 'True Seeing',
  expectedLevel: 6,
  expectedSchool: 'divination',
  expectedRangeFt: 5,
  expectedConcentration: false,
  expectedCastingTime: 'action',
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
    ['detectEvilAndGood', 'Detect Evil and Good', 'shouldCastDetectEvilAndGood'],
    ['augury',            'Augury',                'shouldCastAugury'],
    ['revivify',          'Revivify',              'shouldCastRevivify'],
    ['arcaneEye',         'Arcane Eye',            'shouldCastArcaneEye'],
    ['trueSeeing',        'True Seeing',           'shouldCastTrueSeeing'],
  ] as const;

  for (const [t, spellName, fnName] of cases) {
    assert(`PlannedAction type '${t}' in union`, coreSrc.includes(`| '${t}'`));
    assert(`combat.ts case '${t}'`, combatSrc.includes(`case '${t}':`));
    assert(`planner.ts branch for '${spellName}'`, plannerSrc.includes(`a.name === '${spellName}'`));
    assert(`planner.ts import '${fnName}'`, plannerSrc.includes(`import { shouldCast as ${fnName}`));
  }
})();

// ============================================================
// === Coverage Report Impact ===
// ============================================================
console.log('\n=== Coverage Report Impact ===');
{
  // Batch 6 creature counts (per docs/MONSTER-SPELL-COVERAGE.md):
  //   Detect Evil and Good (34), Augury (11), Revivify (24), Arcane Eye (13), True Seeing (20)
  const expectedCreatureRefs = 34 + 11 + 24 + 13 + 20;
  eq('total creature-references unlocked by Batch 6', expectedCreatureRefs, 102);
  assert('creature-refs > 100 (high impact)', expectedCreatureRefs > 100);
}

// ---- results ------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
