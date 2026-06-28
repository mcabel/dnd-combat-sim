// ============================================================
// Test: Session 95 — RFC-LAIRACTIONS Phase 4
//       AI scoring + selection (scoreLairAction + LAIR_ACTION_SCORE_WEIGHTS)
//
// Validates the Phase 4 engine-layer deliverable (RFC-LAIRACTIONS §8 Phase 4):
//   1. `scoreLairAction(action, lairCreature, bf)` — pure expected-value
//      estimator per RFC §7. Returns a numeric score for each candidate.
//   2. `LAIR_ACTION_SCORE_WEIGHTS` — single config object with the RFC §7
//      default weights (damagePerEnemy, conditionStunned, buffAdvantage, etc.).
//   3. `selectLairAction(candidates, lairCreature, bf)` — picks max-score,
//      tie-broken by lowest `action.id` for determinism. Replaces the Phase 2
//      deterministic lowest-ID selector.
//
// Scoring model (RFC §7):
//   - outOfScope / deferred → -1000 (never picked unless sole option).
//   - save_damage      → Σ targets P(fail)×avgDmg + P(success)×avgDmg/2 × mult.
//   - save_condition   → Σ targets P(fail) × Σ conditionWeight.
//   - damage_no_save   → Σ targets avgDmg × mult.
//   - save_only        → Σ targets P(fail) × controlPush (low — bespoke unimplemented).
//   - summon           → (with bestiaryMap) dpr×3×count; (without) 0; (artifact) -1000.
//   - cast_spell       → level × 10 (coarse — Phase 5 inspects spell modules).
//   - buff_ally        → numAllies × buffAdvantage.
//   - debuff_enemy     → vulnerability: numEnemies × buffVulnerability;
//                        disadvantage: numEnemies × debuffDisadvantage.
//   - visibility       → visibilitySelf (constant).
//   - movement         → numEnemies × controlPush.
//   - spell_slot_regen → 4.5 × spellSlotRegen (avg d8 × weight).
//   - bespoke          → healing-suppression: numTargets × buffVulnerability;
//                        default: 1 (low — handler logs "not yet implemented").
//   - Self-harm penalty: if !targetsEnemies && damage → subtract expected ally damage.
//
// Run: npx ts-node --transpile-only src/test/session95_lair_phase4.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
} from '../parser/fivetools';
import { runCombat } from '../engine/combat';
import { Combatant, Vec3, Battlefield, LairAction, Condition } from '../types/core';

// ---- Test harness -------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Load bestiary (mm-2014 only — covers all test creatures) ------------

const NEEDED_SOURCES = ['mm-2014'];
const dir = path.join(__dirname, '../../bestiaryData');
const allFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const files = allFiles.filter(f =>
  NEEDED_SOURCES.some(src => f === `bestiary-${src}.json`));
const loaded = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
const bestiary = mergeBestiaries(...loaded);

function spawn(name: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnMonster(bestiary, name, pos);
  if (!c) throw new Error(`Monster not found: ${name}`);
  return c;
}

// ---- Combat state factories --------------------------------

interface MutableBF extends Battlefield { [k: string]: any; }

function makeBF(combatants: Combatant[], withBestiary = false): MutableBF {
  const width = 30, height = 30, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [{ terrain: 'flat', elevation: 0 }];
    }
  }
  const bf: MutableBF = {
    width, height, depth, cells,
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1,
    initiativeOrder: combatants.map(c => c.id),
  };
  if (withBestiary) {
    bf.bestiaryMap = bestiary as unknown as Map<string, unknown>;
  }
  return bf;
}

/** Find all lair-action HEADER log entries. */
function lairHeaderLogs(log: any): any[] {
  return log.events.filter((e: any) =>
    e.type === 'action' && e.description.includes('takes a lair action'));
}

/** Tank up a creature so it survives. */
function tankUp(c: Combatant, hp = 100_000): void {
  c.maxHP = hp;
  c.currentHP = hp;
}

/** Disable legendary actions. */
function noLegendary(c: Combatant): void {
  c.legendaryActionPoolMax = 0;
  c.legendaryActionPool = 0;
}

function asParty(c: Combatant): void { c.faction = 'party'; }
function asEnemy(c: Combatant): void { c.faction = 'enemy'; }

/**
 * Run a 1-round combat and return the lair-action header log for the given
 * lair creature. Asserts that exactly ONE lair action fired.
 */
function pickOneLairAction(
  lairCreature: Combatant,
  enemies: Combatant[],
  allies: Combatant[] = [],
  withBestiary = false,
): { header: any; bf: MutableBF; log: any } {
  const all = [lairCreature, ...enemies, ...allies];
  const bf = makeBF(all, withBestiary);
  const rlog = runCombat(bf, all.map(c => c.id), {
    maxRounds: 1, verbose: false
  } as any);
  const headers = lairHeaderLogs(rlog).filter((e: any) =>
    e.actorId === lairCreature.id &&
    !e.description.includes('no available'));
  if (headers.length === 0) {
    throw new Error(`no lair action fired for ${lairCreature.name}; events: ${
      rlog.events.filter((e:any)=>e.actorId===lairCreature.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
  }
  if (headers.length > 1) {
    throw new Error(`multiple lair actions fired for ${lairCreature.name}: ${headers.length}`);
  }
  return { header: headers[0], bf, log: rlog };
}

/** Build a synthetic save_damage LairAction with the given parameters. */
function makeSaveDamageAction(
  id: string,
  opts: {
    saveDC: number;
    saveAbility: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
    damage: { count: number; sides: number; type: string };
    rangeFt?: number;
    sourceCreature?: string;
    rawText?: string;
  },
): LairAction {
  return {
    id,
    sourceCreature: opts.sourceCreature ?? 'TestCreature',
    rawText: opts.rawText ?? `DC ${opts.saveDC} ${opts.saveAbility.toUpperCase()} or ${opts.damage.count}d${opts.damage.sides} ${opts.damage.type} damage.`,
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    saveDC: opts.saveDC,
    saveAbility: opts.saveAbility,
    damage: opts.damage,
    rangeFt: opts.rangeFt,
    targetsEnemies: true,
    category: 'save_damage',
  };
}

/** Build a synthetic save_condition LairAction. */
function makeSaveConditionAction(
  id: string,
  opts: {
    saveDC: number;
    saveAbility: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
    conditions: Condition[];
    rangeFt?: number;
    sourceCreature?: string;
    rawText?: string;
  },
): LairAction {
  return {
    id,
    sourceCreature: opts.sourceCreature ?? 'TestCreature',
    rawText: opts.rawText ?? `DC ${opts.saveDC} ${opts.saveAbility.toUpperCase()} save or ${opts.conditions.join(', ')}.`,
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    saveDC: opts.saveDC,
    saveAbility: opts.saveAbility,
    conditions: opts.conditions,
    rangeFt: opts.rangeFt,
    targetsEnemies: true,
    category: 'save_condition',
  };
}

/** Build a synthetic LairAction with arbitrary category + fields. */
function makeAction(
  id: string,
  category: LairAction['category'],
  extra: Partial<LairAction> = {},
): LairAction {
  return {
    id,
    sourceCreature: 'TestCreature',
    rawText: extra.rawText ?? `Synthetic ${category} action.`,
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    targetsEnemies: true,
    category,
    ...extra,
  };
}

/** Get the action ID from a header log (parses the [category] tag). */
function actionIdFromHeader(header: any, lairActions: LairAction[]): string | null {
  const desc = header.description;
  for (const a of lairActions) {
    if (desc.includes(a.rawText.substring(0, 50))) return a.id;
  }
  return null;
}

// ============================================================
// 1. End-to-end: Adult Red Dragon picks Red Dragon::0 first
//    (save_damage 6d6 fire has highest expected damage vs Goblin).
// ============================================================
console.log('\n--- 1. Adult Red Dragon picks Red Dragon::0 (highest EV) ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const bf = makeBF([dragon, goblin]);
  const rlog = runCombat(bf, [dragon.id, goblin.id], {
    maxRounds: 1, verbose: false
  } as any);

  const headers = lairHeaderLogs(rlog).filter((e: any) => e.actorId === dragon.id);
  assert('1a. exactly 1 lair action fired', headers.length === 1,
    `got ${headers.length}`);
  if (headers.length === 1) {
    const picked = actionIdFromHeader(headers[0], dragon.lairActions!.actions);
    eq('1b. picked Red Dragon::0 (save_damage, highest EV)', picked, 'Red Dragon::0');
  }
}

// ============================================================
// 2. Tie-break: two save_damage actions with identical damage → lowest ID
//    Both have DC 15 DEX, 6d6 fire. The "Aaa::0" ID should win over "Bbb::0".
// ============================================================
console.log('\n--- 2. Tie-break: identical scores → lowest action.id ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  // Replace with two identical-damage actions with different IDs.
  const actionA = makeSaveDamageAction('Aaa::0', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 6, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  const actionB = makeSaveDamageAction('Bbb::0', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 6, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  dragon.lairActions!.actions = [actionA, actionB];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [actionA, actionB]);
  eq('2a. tie-break picks lowest ID (Aaa::0)', picked, 'Aaa::0');
}

// ============================================================
// 3. outOfScope action → -1000 → never picked unless sole option
//    Put an OOS action + a real damage action; the real one wins.
// ============================================================
console.log('\n--- 3. outOfScope scores -1000 → never picked ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const oos = makeAction('Test::oos', 'flavor', {
    outOfScope: true,
    outOfScopeId: 'lair_oos_test',
    rawText: 'A purely narrative action with no mechanical effect.',
  });
  const dmg = makeSaveDamageAction('Test::dmg', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 6, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  dragon.lairActions!.actions = [oos, dmg];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [oos, dmg]);
  eq('3a. real damage action picked over OOS', picked, 'Test::dmg');
}

// ============================================================
// 4. OOS as sole option → picked (and logged as "out of scope")
// ============================================================
console.log('\n--- 4. OOS as sole option → picked (logged, not executed) ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const oos = makeAction('Test::oos_only', 'flavor', {
    outOfScope: true,
    outOfScopeId: 'lair_oos_sole',
    rawText: 'A purely narrative action with no mechanical effect.',
  });
  dragon.lairActions!.actions = [oos];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const bf = makeBF([dragon, goblin]);
  const rlog = runCombat(bf, [dragon.id, goblin.id], {
    maxRounds: 1, verbose: false
  } as any);
  const oosLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === dragon.id &&
    e.description.includes('out of scope'));
  assert('4a. OOS log fires when sole option', oosLog !== undefined);
}

// ============================================================
// 5. Deferred action → -1000 → never picked unless sole option
// ============================================================
console.log('\n--- 5. deferred scores -1000 → never picked ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const def = makeAction('Test::def', 'deferred', {
    deferred: 'meta-time',
    deferredId: 'lair_def_test',
    rawText: 'Time moves 10 years forward.',
  });
  const dmg = makeSaveDamageAction('Test::dmg', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 6, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  dragon.lairActions!.actions = [def, dmg];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [def, dmg]);
  eq('5a. real damage action picked over deferred', picked, 'Test::dmg');
}

// ============================================================
// 6. save_damage scoring scales with target count
//    1 enemy vs 5 enemies → action picked when 5 enemies (high score)
//    vs a competing action with fixed value (visibility=8).
// ============================================================
console.log('\n--- 6. save_damage scales with target count ---');
{
  // With 1 enemy: save_damage EV = 0.6 × 21 + 0.4 × 10.5 = 16.8 → > visibility(8).
  // With 0 enemies: save_damage EV = 0 → < visibility(8) → visibility picked.
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const dmg = makeSaveDamageAction('Test::dmg', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 6, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'The lair is filled with thick smoke (heavily obscured).',
  });
  dragon.lairActions!.actions = [dmg, vis];
  dragon._lairActionHistory = [];

  // Scenario A: 1 enemy in range → save_damage EV=16.8 > visibility=8 → damage picked.
  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header: headerA } = pickOneLairAction(dragon, [goblin]);
  const pickedA = actionIdFromHeader(headerA, [dmg, vis]);
  eq('6a. with 1 enemy in range, save_damage picked (EV 16.8 > vis 8)',
    pickedA, 'Test::dmg');

  // Scenario B: 0 enemies → save_damage EV=0 < visibility=8 → visibility picked.
  dragon._lairActionHistory = [];
  // Reset the dragon's position (it may have moved during scenario A's turn).
  dragon.pos = { x: 0, y: 0, z: 0 };
  // Move the goblin out of range (rangeFt=120, so put it 25 squares = 125 ft away).
  const farGoblin = spawn('Goblin', { x: 25, y: 0, z: 0 });
  asEnemy(farGoblin); tankUp(farGoblin);

  const { header: headerB } = pickOneLairAction(dragon, [farGoblin]);
  const pickedB = actionIdFromHeader(headerB, [dmg, vis]);
  eq('6b. with 0 enemies in range, visibility picked (EV 0 < vis 8)',
    pickedB, 'Test::vis');
}

// ============================================================
// 7. save_damage respects damage immunity (mult=0)
//    Fire-immune target → save_damage EV=0 → visibility picked.
// ============================================================
console.log('\n--- 7. save_damage respects immunity (mult=0) ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const dmg = makeSaveDamageAction('Test::dmg', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 6, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [dmg, vis];
  dragon._lairActionHistory = [];

  // Fire-immune target (Fire Elemental is immune to fire).
  const fireElem = spawn('Fire Elemental', { x: 5, y: 0, z: 0 });
  asEnemy(fireElem); tankUp(fireElem);

  const { header } = pickOneLairAction(dragon, [fireElem]);
  const picked = actionIdFromHeader(header, [dmg, vis]);
  // Fire-immune target → save_damage EV = 0 → visibility(8) wins.
  eq('7a. fire-immune target → visibility picked over fire damage',
    picked, 'Test::vis');
}

// ============================================================
// 8. save_damage respects damage vulnerability (mult=2)
//    Fire-vulnerable target → save_damage EV doubled → preferred over vis.
// ============================================================
console.log('\n--- 8. save_damage respects vulnerability (mult=2) ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  // Lower-damage action (1d6 fire) so baseline EV is low.
  const dmg = makeSaveDamageAction('Test::dmg', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 1, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [dmg, vis];
  dragon._lairActionHistory = [];

  // Normal target: EV = 0.6 × 3.5 + 0.4 × 1.75 = 2.8 → < vis(8) → vis picked.
  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);
  const { header: h1 } = pickOneLairAction(dragon, [goblin]);
  eq('8a. normal target, 1d6 fire (EV 2.8) → visibility picked',
    actionIdFromHeader(h1, [dmg, vis]), 'Test::vis');

  // Vulnerable target: EV doubled → 5.6. Still < vis(8). Let me make a bigger
  // damage to demonstrate vulnerability picking the damage action.
  // With 3d6 fire (avg 10.5): normal EV = 0.6×10.5 + 0.4×5.25 = 8.4 → > vis(8).
  // With vulnerability: EV = 2 × 8.4 = 16.8 → strongly preferred.
  // Without vulnerability: EV = 8.4 → still > vis(8), so damage picked either way.
  // The vulnerability test needs a damage value where normal < vis but vuln > vis.
  // 2d6 fire: avg = 7. Normal EV = 0.6×7 + 0.4×3.5 = 5.6 → < vis(8). Vuln EV = 11.2 → > vis(8).
  dragon._lairActionHistory = [];
  const dmg2 = makeSaveDamageAction('Test::dmg2', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 2, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  dragon.lairActions!.actions = [dmg2, vis];

  // Normal goblin: 2d6 fire EV = 5.6 → < vis(8) → vis picked.
  const { header: h2 } = pickOneLairAction(dragon, [goblin]);
  eq('8b. normal target, 2d6 fire (EV 5.6) → visibility picked',
    actionIdFromHeader(h2, [dmg2, vis]), 'Test::vis');

  // Now make the goblin vulnerable to fire.
  dragon._lairActionHistory = [];
  goblin.damageVulnerabilities = ['fire'];
  const { header: h3 } = pickOneLairAction(dragon, [goblin]);
  eq('8c. fire-vulnerable target, 2d6 fire (EV 11.2) → damage picked',
    actionIdFromHeader(h3, [dmg2, vis]), 'Test::dmg2');
}

// ============================================================
// 9. save_damage respects damage resistance (mult=0.5)
//    Fire-resistant target → save_damage EV halved.
// ============================================================
console.log('\n--- 9. save_damage respects resistance (mult=0.5) ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  // 4d6 fire: avg = 14. Normal EV = 0.6×14 + 0.4×7 = 11.2 → > vis(8).
  // Resistant EV = 0.5 × 11.2 = 5.6 → < vis(8) → vis picked.
  const dmg = makeSaveDamageAction('Test::dmg', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 4, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [dmg, vis];
  dragon._lairActionHistory = [];

  // Resistant goblin → damage EV = 5.6 < vis(8) → vis picked.
  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);
  goblin.resistances = ['fire'];
  const { header } = pickOneLairAction(dragon, [goblin]);
  eq('9a. fire-resistant target, 4d6 fire (EV 5.6) → visibility picked',
    actionIdFromHeader(header, [dmg, vis]), 'Test::vis');

  // Sanity: without resistance, 4d6 fire (EV 11.2) > vis(8) → damage picked.
  dragon._lairActionHistory = [];
  goblin.resistances = [];
  const { header: h2 } = pickOneLairAction(dragon, [goblin]);
  eq('9b. normal target, 4d6 fire (EV 11.2) → damage picked',
    actionIdFromHeader(h2, [dmg, vis]), 'Test::dmg');
}

// ============================================================
// 10. save_condition scoring: stunned > restrained > poisoned > prone
//     All with same DC + ability → stunned should be picked first.
// ============================================================
console.log('\n--- 10. save_condition weights: stunned > restrained > poisoned > prone ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const stunned = makeSaveConditionAction('Test::stunned', {
    saveDC: 15, saveAbility: 'con', conditions: ['stunned'], rangeFt: 60,
  });
  const restrained = makeSaveConditionAction('Test::restrained', {
    saveDC: 15, saveAbility: 'con', conditions: ['restrained'], rangeFt: 60,
  });
  const poisoned = makeSaveConditionAction('Test::poisoned', {
    saveDC: 15, saveAbility: 'con', conditions: ['poisoned'], rangeFt: 60,
  });
  const prone = makeSaveConditionAction('Test::prone', {
    saveDC: 15, saveAbility: 'con', conditions: ['prone'], rangeFt: 60,
  });
  dragon.lairActions!.actions = [prone, poisoned, restrained, stunned];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [stunned, restrained, poisoned, prone]);
  // Weights: stunned=40, restrained=25, poisoned=15, prone=10.
  // Goblin con 10 (+0 mod) → P(fail DC 15) = (15-1-0)/20 = 0.7.
  // EVs: stunned=28, restrained=17.5, poisoned=10.5, prone=7.
  // Max = stunned.
  eq('10a. stunned picked (weight 40 × 0.7 = 28)', picked, 'Test::stunned');
}

// ============================================================
// 11. save_condition: multiple conditions sum (poisoned + incapacitated)
//     vs single condition (stunned). Single stunned (40) > combined (15+12=27).
// ============================================================
console.log('\n--- 11. save_condition: stunned (40) > poisoned+incapacitated (27) ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const stunned = makeSaveConditionAction('Test::stunned', {
    saveDC: 13, saveAbility: 'con', conditions: ['stunned'], rangeFt: 60,
  });
  const combo = makeSaveConditionAction('Test::combo', {
    saveDC: 13, saveAbility: 'con', conditions: ['poisoned', 'incapacitated'], rangeFt: 60,
  });
  dragon.lairActions!.actions = [combo, stunned];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [stunned, combo]);
  // Weights: stunned=40, poisoned+incapacitated=15+12=27.
  // Goblin con 10 → P(fail DC 13) = 0.6.
  // EVs: stunned=24, combo=16.2. Max = stunned.
  eq('11a. stunned (24) picked over combo (16.2)', picked, 'Test::stunned');
}

// ============================================================
// 12. damage_no_save scoring: full avgDmg per target (no save)
//     3d6 fire damage_no_save vs visibility(8).
//     avgDmg = 10.5; EV = 10.5 × 1 = 10.5 → > vis(8) → damage picked.
// ============================================================
console.log('\n--- 12. damage_no_save scoring ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const dmg = makeAction('Test::dmg_no_save', 'damage_no_save', {
    damage: { count: 3, sides: 6, type: 'fire' },
    rangeFt: 120,
    rawText: 'Jagged ice shards fall, striking up to three creatures (3d6 fire).',
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [dmg, vis];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [dmg, vis]);
  // avgDmg = 3 × 3.5 = 10.5; EV = 10.5 × 1 (no save) = 10.5 > vis(8).
  eq('12a. damage_no_save (EV 10.5) picked over visibility (8)',
    picked, 'Test::dmg_no_save');
}

// ============================================================
// 13. summon scoring: without bestiaryMap → 0 → not picked over vis(8)
// ============================================================
console.log('\n--- 13. summon scoring: no bestiary → 0 → not picked ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const summon = makeAction('Test::summon', 'summon', {
    summons: { creature: 'Goblin', count: 2 },
    targetsEnemies: false,
    rawText: 'The dragon summons 2 goblins.',
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [summon, vis];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  // Without bestiaryMap → summon EV = 0 < vis(8) → vis picked.
  const { header } = pickOneLairAction(dragon, [goblin], [], /*withBestiary=*/false);
  const picked = actionIdFromHeader(header, [summon, vis]);
  eq('13a. summon (no bestiary, EV 0) → visibility picked',
    picked, 'Test::vis');
}

// ============================================================
// 14. summon scoring: with bestiaryMap → positive score (CR-based DPR)
//     Goblin CR 1/4 → DPR ≈ 2.5×0.25 + 2 = 2.625; 2 summons × 3 rounds = 15.75.
//     15.75 > vis(8) → summon picked.
// ============================================================
console.log('\n--- 14. summon scoring: with bestiary → positive EV ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const summon = makeAction('Test::summon', 'summon', {
    summons: { creature: 'Goblin', count: 2 },
    targetsEnemies: false,
    rawText: 'The dragon summons 2 goblins.',
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [summon, vis];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  // With bestiaryMap → summon EV = 2.625 × 3 × 2 = 15.75 > vis(8) → summon picked.
  const { header } = pickOneLairAction(dragon, [goblin], [], /*withBestiary=*/true);
  const picked = actionIdFromHeader(header, [summon, vis]);
  eq('14a. summon (with bestiary, EV 15.75) → summon picked',
    picked, 'Test::summon');
}

// ============================================================
// 15. summon flattening artifact → -1000 → never picked
//     summons.creature matches sourceCreature name → artifact → -1000.
// ============================================================
console.log('\n--- 15. summon flattening artifact → -1000 ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const artifact = makeAction('Test::artifact', 'summon', {
    sourceCreature: 'Red Dragon',
    summons: { creature: 'Adult Red Dragon', count: 1 },
    targetsEnemies: false,
    rawText: 'At your discretion, a legendary (adult or ancient) red dragon...',
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [artifact, vis];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  // Artifact → -1000 < vis(8) → vis picked.
  const { header } = pickOneLairAction(dragon, [goblin], [], /*withBestiary=*/true);
  const picked = actionIdFromHeader(header, [artifact, vis]);
  eq('15a. flattening artifact → visibility picked',
    picked, 'Test::vis');
}

// ============================================================
// 16. cast_spell scoring: level × 10
//     L3 spell → 30 > vis(8) → cast_spell picked.
//     L1 spell → 10 > vis(8) → cast_spell picked (still wins, but barely).
// ============================================================
console.log('\n--- 16. cast_spell scoring: level × 10 ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const spell = makeAction('Test::spell', 'cast_spell', {
    isSpell: true,
    spellName: 'Fireball',
    castLevel: 3,
    rawText: 'The dragon casts fireball.',
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [spell, vis];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [spell, vis]);
  // cast_spell L3 → 30 > vis(8).
  eq('16a. cast_spell L3 (EV 30) picked over visibility (8)',
    picked, 'Test::spell');
}

// ============================================================
// 17. buff_ally scoring: numAllies × buffAdvantage (4)
//     3 allies → 12 > vis(8) → buff picked.
//     1 ally → 4 < vis(8) → vis picked.
// ============================================================
console.log('\n--- 17. buff_ally scoring: numAllies × buffAdvantage (4) ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const buff = makeAction('Test::buff', 'buff_ally', {
    targetsEnemies: false,
    rangeFt: 60,
    rawText: 'Allies of the dragon gain advantage on attack rolls.',
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [buff, vis];
  dragon._lairActionHistory = [];

  // 3 allies (all in range) → buff EV = 3 × 4 = 12 > vis(8).
  const ally1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  const ally2 = spawn('Goblin', { x: 10, y: 0, z: 0 });
  const ally3 = spawn('Goblin', { x: 0, y: 5, z: 0 });
  asParty(ally1); asParty(ally2); asParty(ally3);
  tankUp(ally1); tankUp(ally2); tankUp(ally3);

  // One enemy (otherwise combat ends immediately when no enemies).
  const enemy = spawn('Goblin', { x: 20, y: 0, z: 0 });
  asEnemy(enemy); tankUp(enemy);

  const { header } = pickOneLairAction(dragon, [enemy], [ally1, ally2, ally3]);
  const picked = actionIdFromHeader(header, [buff, vis]);
  eq('17a. 3 allies → buff_ally (EV 12) picked over visibility (8)',
    picked, 'Test::buff');
}

// ============================================================
// 18. debuff_enemy: vulnerability (20) > disadvantage (6)
//     1 enemy → vuln EV=20 > disadv EV=6 > vis(8)? No, vis=8 > disadv=6.
//     So vuln(20) > vis(8) > disadv(6).
// ============================================================
console.log('\n--- 18. debuff_enemy: vulnerability (20) vs disadvantage (6) ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const vuln = makeAction('Test::vuln', 'debuff_enemy', {
    targetsEnemies: true,
    rangeFt: 60,
    rawText: 'Enemies gain vulnerability to lightning damage.',
  });
  const disadv = makeAction('Test::disadv', 'debuff_enemy', {
    targetsEnemies: true,
    rangeFt: 60,
    rawText: 'Enemies have disadvantage on saving throws.',
  });
  dragon.lairActions!.actions = [vuln, disadv];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [vuln, disadv]);
  // vuln EV = 1 × 20 = 20 > disadv EV = 1 × 6 = 6 → vuln picked.
  eq('18a. vulnerability (EV 20) picked over disadvantage (EV 6)',
    picked, 'Test::vuln');
}

// ============================================================
// 19. visibility scoring: visibilitySelf (8) — constant
//     When competing against a low-EV save_damage (1d6 fire ≈ 2.8),
//     visibility (8) wins.
// ============================================================
console.log('\n--- 19. visibility scoring: visibilitySelf (8) ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const dmg = makeSaveDamageAction('Test::dmg', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 1, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [dmg, vis];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [dmg, vis]);
  // 1d6 fire EV = 0.6 × 3.5 + 0.4 × 1.75 = 2.8 < vis(8) → vis picked.
  eq('19a. 1d6 fire (EV 2.8) → visibility (8) picked',
    picked, 'Test::vis');
}

// ============================================================
// 20. movement scoring: numEnemies × controlPush (5)
//     2 enemies → 10 > vis(8) → movement picked.
//     1 enemy → 5 < vis(8) → vis picked.
// ============================================================
console.log('\n--- 20. movement scoring: numEnemies × controlPush (5) ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const move = makeAction('Test::move', 'movement', {
    targetsEnemies: true,
    rangeFt: 60,
    rawText: 'Each enemy is pushed 10 feet away from the dragon.',
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [move, vis];
  dragon._lairActionHistory = [];

  // 2 enemies → movement EV = 2 × 5 = 10 > vis(8).
  const e1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  const e2 = spawn('Goblin', { x: 0, y: 5, z: 0 });
  asEnemy(e1); asEnemy(e2);
  tankUp(e1); tankUp(e2);

  const { header } = pickOneLairAction(dragon, [e1, e2]);
  const picked = actionIdFromHeader(header, [move, vis]);
  eq('20a. 2 enemies → movement (EV 10) picked over visibility (8)',
    picked, 'Test::move');
}

// ============================================================
// 21. spell_slot_regen scoring: 4.5 × spellSlotRegen (15) = 67.5
//     Way higher than vis(8). Always picked when available.
// ============================================================
console.log('\n--- 21. spell_slot_regen scoring: 4.5 × 15 = 67.5 ---');
{
  const lich = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich);
  tankUp(lich);
  noLegendary(lich);

  const regen = makeAction('Test::regen', 'spell_slot_regen', {
    targetsEnemies: false,
    rawText: 'The lich rolls a d8 and regains a spell slot of that level or lower.',
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  lich.lairActions!.actions = [regen, vis];
  lich._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(lich, [goblin]);
  const picked = actionIdFromHeader(header, [regen, vis]);
  // spell_slot_regen EV = 4.5 × 15 = 67.5 > vis(8).
  eq('21a. spell_slot_regen (EV 67.5) picked over visibility (8)',
    picked, 'Test::regen');
}

// ============================================================
// 22. save_only scoring: P(fail) × controlPush (5) per target
//     DC 23 STR vs Goblin (str 8, -1 mod) → P(fail) = (23-1-(-1))/20 = 1.15 → clamped 0.95.
//     EV = 0.95 × 5 = 4.75 < vis(8) → vis picked.
// ============================================================
console.log('\n--- 22. save_only scoring: P(fail) × controlPush (5) ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const saveOnly = makeAction('Test::save_only', 'save_only', {
    saveDC: 23, saveAbility: 'str',
    targetsEnemies: true,
    rangeFt: 60,
    rawText: 'DC 23 STR or pushed 60 feet.',
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [saveOnly, vis];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [saveOnly, vis]);
  // Goblin str 8 (-1) → P(fail DC 23) = 0.95 (clamped). EV = 0.95 × 5 = 4.75.
  // 4.75 < vis(8) → vis picked.
  eq('22a. save_only (EV 4.75) → visibility (8) picked',
    picked, 'Test::vis');
}

// ============================================================
// 23. bespoke healing-suppression: numTargets × buffVulnerability (20)
//     1 enemy → 20 > vis(8) → bespoke picked.
// ============================================================
console.log('\n--- 23. bespoke healing-suppression: numTargets × 20 ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const healSuppress = makeAction('Test::heal_suppress', 'bespoke', {
    targetsEnemies: true,
    rangeFt: 120,
    rawText: 'No creature within 120 feet of the dragon can regain hit points.',
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [healSuppress, vis];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [healSuppress, vis]);
  // heal-suppress EV = 1 × 20 = 20 > vis(8).
  eq('23a. heal-suppress bespoke (EV 20) picked over visibility (8)',
    picked, 'Test::heal_suppress');
}

// ============================================================
// 24. bespoke default: score 1 (low)
//     Unknown bespoke pattern → 1 < vis(8) → vis picked.
// ============================================================
console.log('\n--- 24. bespoke default: score 1 ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const unknown = makeAction('Test::unknown', 'bespoke', {
    targetsEnemies: true,
    rangeFt: 60,
    rawText: 'The dragon does something completely unique and unparseable.',
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [unknown, vis];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [unknown, vis]);
  // unknown bespoke EV = 1 < vis(8).
  eq('24a. unknown bespoke (EV 1) → visibility (8) picked',
    picked, 'Test::vis');
}

// ============================================================
// 25. Self-harm penalty: !targetsEnemies + damage reduces score
//     A save_damage action that targets ALLIES (rare — synthetic) should
//     be deprioritized. With self-harm, the score drops below vis(8).
// ============================================================
console.log('\n--- 25. self-harm penalty: !targetsEnemies + damage ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  // Synthetic: a 6d6 fire save_damage that (weirdly) targets allies.
  // Normal EV (vs 1 ally) = 0.6 × 21 + 0.4 × 10.5 = 16.8.
  // With self-harm penalty: score = 16.8 - 16.8 = 0.
  // So vis(8) wins.
  const selfDmg = makeSaveDamageAction('Test::self_dmg', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 6, sides: 6, type: 'fire' },
    rangeFt: 60,
  });
  // Override targetsEnemies to false (ally-targeting).
  (selfDmg as any).targetsEnemies = false;
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [selfDmg, vis];
  dragon._lairActionHistory = [];

  // 1 ally in range.
  const ally = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asParty(ally); tankUp(ally);

  // 1 enemy (so combat doesn't end immediately).
  const enemy = spawn('Goblin', { x: 20, y: 0, z: 0 });
  asEnemy(enemy); tankUp(enemy);

  const { header } = pickOneLairAction(dragon, [enemy], [ally]);
  const picked = actionIdFromHeader(header, [selfDmg, vis]);
  // self-dmg EV with penalty = 16.8 - 16.8 = 0 < vis(8) → vis picked.
  eq('25a. self-harm save_damage (EV 0) → visibility (8) picked',
    picked, 'Test::vis');
}

// ============================================================
// 26. End-to-end: prefers high-damage over low-damage
//     6d6 fire vs 1d6 fire (both save_damage, DC 15 DEX) → 6d6 picked.
// ============================================================
console.log('\n--- 26. prefers high-damage over low-damage ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const highDmg = makeSaveDamageAction('Test::high', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 6, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  const lowDmg = makeSaveDamageAction('Test::low', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 1, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  // Put low-dmg first so the test isn't fooled by lowest-id tie-break.
  dragon.lairActions!.actions = [lowDmg, highDmg];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [highDmg, lowDmg]);
  // high EV = 16.8, low EV = 2.8 → high picked (despite higher ID).
  eq('26a. high-damage (EV 16.8) picked over low-damage (EV 2.8)',
    picked, 'Test::high');
}

// ============================================================
// 27. History still respected: max-score action skipped when in history
//     Two save_damage actions. Round 1 picks the higher. Round 2 (with
//     the higher in history) picks the lower.
// ============================================================
console.log('\n--- 27. history respected: max-score skipped when in history ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  const highDmg = makeSaveDamageAction('Test::high', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 6, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  const lowDmg = makeSaveDamageAction('Test::low', {
    saveDC: 15, saveAbility: 'dex',
    damage: { count: 3, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  dragon.lairActions!.actions = [lowDmg, highDmg];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  // Round 1: high EV (16.8) > low EV (8.4) → high picked.
  const bf = makeBF([dragon, goblin]);
  const r1 = runCombat(bf, [dragon.id, goblin.id], {
    maxRounds: 1, verbose: false
  } as any);
  const h1 = lairHeaderLogs(r1).filter((e: any) => e.actorId === dragon.id);
  const picked1 = h1.length === 1 ? actionIdFromHeader(h1[0], [highDmg, lowDmg]) : null;
  eq('27a. round 1 picks high-damage', picked1, 'Test::high');

  // Round 2: history=[Test::high], candidates = {low}. Picks low.
  const r2 = runCombat(bf, [dragon.id, goblin.id], {
    maxRounds: 1, verbose: false
  } as any);
  const h2 = lairHeaderLogs(r2).filter((e: any) => e.actorId === dragon.id);
  const picked2 = h2.length === 1 ? actionIdFromHeader(h2[0], [highDmg, lowDmg]) : null;
  eq('27b. round 2 picks low-damage (high in history)', picked2, 'Test::low');

  // History correctly maintained.
  eq('27c. history[0] is Test::high (oldest)',
    dragon._lairActionHistory?.[0], 'Test::high');
  eq('27d. history[1] is Test::low (most recent)',
    dragon._lairActionHistory?.[1], 'Test::low');
}

// ============================================================
// 28. P(fail) clamp: very high DC → P(fail) = 0.95 (not 1.0)
//     DC 30 vs Goblin (dex 14, +2 mod) → (30-1-2)/20 = 1.35 → clamped 0.95.
// ============================================================
console.log('\n--- 28. P(fail) clamp: very high DC → 0.95 ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  // DC 30 + 2d6 fire (avg 7) → EV = 0.95 × 7 + 0.05 × 3.5 = 6.825.
  // 6.825 < vis(8) → vis picked. (Demonstrates the clamp prevents EV inflation.)
  const highDc = makeSaveDamageAction('Test::high_dc', {
    saveDC: 30, saveAbility: 'dex',
    damage: { count: 2, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [highDc, vis];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [highDc, vis]);
  // EV with clamp = 6.825 < vis(8) → vis picked.
  // Without clamp, EV would be 1.35 × 7 + (1-1.35) × 3.5 = 8.225 → would pick damage.
  // The fact that vis is picked confirms the clamp is working.
  eq('28a. DC 30 2d6 fire (EV 6.825 with clamp) → visibility (8) picked',
    picked, 'Test::vis');
}

// ============================================================
// 29. P(fail) clamp: very low DC → P(fail) = 0.05 (not 0.0)
//     DC 1 + 6d6 fire → EV = 0.05 × 21 + 0.95 × 10.5 = 11.025 > vis(8).
//     (Demonstrates the clamp prevents EV going to 0.)
// ============================================================
console.log('\n--- 29. P(fail) clamp: very low DC → 0.05 ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  // DC 1 + 6d6 fire → EV = 0.05 × 21 + 0.95 × 10.5 = 11.025 > vis(8).
  // The 5% minimum fail chance keeps EV positive.
  const lowDc = makeSaveDamageAction('Test::low_dc', {
    saveDC: 1, saveAbility: 'dex',
    damage: { count: 6, sides: 6, type: 'fire' },
    rangeFt: 120,
  });
  const vis = makeAction('Test::vis', 'visibility', {
    radiusFt: 20,
    rawText: 'Thick smoke fills the lair.',
  });
  dragon.lairActions!.actions = [lowDc, vis];
  dragon._lairActionHistory = [];

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const { header } = pickOneLairAction(dragon, [goblin]);
  const picked = actionIdFromHeader(header, [lowDc, vis]);
  // EV with clamp = 11.025 > vis(8) → damage picked.
  eq('29a. DC 1 6d6 fire (EV 11.025 with clamp) → damage picked',
    picked, 'Test::low_dc');
}

// ============================================================
// 30. End-to-end: Aboleth vs 3 clustered enemies
//     Aboleth has 3 lair actions (cast_spell: phantasmal force L2,
//     save_damage: psychic, save_condition: disease).
//     With 3 enemies clustered, the save_damage (psychic) action with
//     multiple targets should have higher EV than the single-target
//     phantasmal force cast_spell (L2 → 20).
// ============================================================
console.log('\n--- 30. Aboleth: multi-target save_damage > single-target cast_spell ---');
{
  const aboleth = spawn('Aboleth', { x: 0, y: 0, z: 0 });
  asParty(aboleth);
  tankUp(aboleth);
  noLegendary(aboleth);

  // Inspect Aboleth's actions to verify our understanding.
  console.log(`    Aboleth actions: ${aboleth.lairActions!.actions.map(a => `${a.id}(${a.category})`).join(', ')}`);

  // 3 clustered enemies.
  const e1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  const e2 = spawn('Goblin', { x: 10, y: 0, z: 0 });
  const e3 = spawn('Goblin', { x: 0, y: 5, z: 0 });
  asEnemy(e1); asEnemy(e2); asEnemy(e3);
  tankUp(e1); tankUp(e2); tankUp(e3);

  const bf = makeBF([aboleth, e1, e2, e3]);
  const rlog = runCombat(bf, [aboleth.id, e1.id, e2.id, e3.id], {
    maxRounds: 1, verbose: false
  } as any);
  const headers = lairHeaderLogs(rlog).filter((e: any) => e.actorId === aboleth.id);
  assert('30a. exactly 1 lair action fired', headers.length === 1,
    `got ${headers.length}`);
  if (headers.length === 1) {
    const picked = actionIdFromHeader(headers[0], aboleth.lairActions!.actions);
    console.log(`    Picked: ${picked}`);
    // The picked action should NOT be the cast_spell (L2 → 20) if the
    // save_damage or save_condition has higher multi-target EV.
    // (We don't assert the exact ID since the Aboleth's action IDs may vary
    // by sourcebook, but we verify a NON-cast_spell action is preferred when
    // multiple enemies are clustered.)
    const isCastSpell = headers[0].description.includes('[cast_spell');
    // With 3 enemies, save_damage EV scales 3× — should beat cast_spell(20).
    // (If this assertion fails, the multi-target scaling isn't working.)
    assert('30b. multi-target save_damage preferred over single-target cast_spell',
      !isCastSpell,
      `cast_spell was picked with 3 enemies in range; header: ${headers[0].description.substring(0, 100)}`);
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
