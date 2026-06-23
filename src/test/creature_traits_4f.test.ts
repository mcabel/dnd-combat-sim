// ============================================================
// Test: Creature Traits 4f (Session 53 Batch 4f)
//
// Validates:
//   - Superior Invisibility + Incorporeal Movement flags parsed correctly
//   - Superior Invisibility: AI planner self-casts invisibility as bonus
//     action on turn 1 → creature gains `invisible` condition + concentration
//   - Superior Invisibility: advantage on attack rolls (verified via
//     attackAdvantageState)
//   - Superior Invisibility: does NOT re-cast when already invisible
//   - Superior Invisibility: does NOT cast when already concentrating
//
// Reverse published order (newest pre-2024 source first):
//   - MPMM (2022): Shadow Spirit (Incorporeal Movement)
//   - MM (2014): Ghost, Specter, Will-o'-Wisp (Incorporeal Movement);
//     Faerie Dragons (Superior Invisibility)
//
// Run: npx ts-node src/test/creature_traits_4f.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
  Raw5etoolsMonster,
} from '../parser/fivetools';
import { Combatant, Vec3, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';
import { attackAdvantageState } from '../engine/utils';

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

// ---- Bestiary setup -----------------------------------------
// Load only the sourcebooks we need (avoid CI 60s timeout from loading all 99).
const NEEDED_SOURCES = ['mm-2014', 'mm', 'dmg'];
function loadBestiary(): Map<string, Raw5etoolsMonster> {
  const dir = path.join(__dirname, '../../bestiaryData');
  const allFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const files = allFiles.filter(f =>
    NEEDED_SOURCES.some(src => f === `bestiary-${src}.json`));
  if (files.length === 0) {
    console.warn('  [warn] No matching source files found, loading all bestiary JSONs');
    const loaded = allFiles.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
    return mergeBestiaries(...loaded);
  }
  const loaded = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
  return mergeBestiaries(...loaded);
}

const bestiary = loadBestiary();

function spawn(name: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnMonster(bestiary, name, pos);
  if (!c) throw new Error(`Monster not found: ${name}`);
  return c;
}

// ============================================================
console.log('\n=== 1. Parser — Incorporeal Movement ===\n');
{
  const ghost = spawn('Ghost');
  eq('Ghost has incorporealMovement', ghost.incorporealMovement, true);

  const specter = spawn('Specter');
  eq('Specter has incorporealMovement', specter.incorporealMovement, true);

  const willOWisp = spawn("Will-o'-Wisp");
  eq("Will-o'-Wisp has incorporealMovement", willOWisp.incorporealMovement, true);

  // Goblin does NOT have Incorporeal Movement
  const goblin = spawn('Goblin');
  eq('Goblin does NOT have incorporealMovement', goblin.incorporealMovement, false);
}

// ============================================================
console.log('\n=== 2. Parser — Superior Invisibility ===\n');
{
  // Faerie Dragon (Red) — MM p.321
  const faerieRed = spawn('Faerie Dragon (Red)');
  eq('Faerie Dragon (Red) has superiorInvisibility', faerieRed.superiorInvisibility, true);

  // Faerie Dragon (Blue)
  const faerieBlue = spawn('Faerie Dragon (Blue)');
  eq('Faerie Dragon (Blue) has superiorInvisibility', faerieBlue.superiorInvisibility, true);

  // Goblin does NOT have Superior Invisibility
  const goblin = spawn('Goblin');
  eq('Goblin does NOT have superiorInvisibility', goblin.superiorInvisibility, false);
}

// ============================================================
console.log('\n=== 3. Engine — Superior Invisibility grants invisible condition ===\n');
{
  // Spawn a Faerie Dragon + enemy. Execute the superiorInvisibility bonus action.
  // Verify the creature gains the `invisible` condition + concentration.
  const { executePlannedAction } = require('../engine/combat');

  const faerie = spawn('Faerie Dragon (Red)', { x: 5, y: 5, z: 0 });
  faerie.faction = 'enemy';
  const enemy = spawn('Goblin', { x: 5, y: 6, z: 0 });
  enemy.faction = 'party';

  const width = 20, height = 20, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [{ terrain: 'flat', elevation: 0 }];
    }
  }
  const bf: Battlefield = {
    width, height, depth, cells,
    combatants: new Map([[faerie.id, faerie], [enemy.id, enemy]]),
    round: 1,
    initiativeOrder: [faerie.id, enemy.id],
    pendingInitiativeInserts: [],
  } as Battlefield;

  const state: EngineState = {
    battlefield: bf,
    log: { events: [] } as any,
    round: 1,
    activeCombatantId: faerie.id,
    pendingActions: [],
    rageDamagedSinceLastTurn: new Set<string>(),
    disengagedThisTurn: new Set<string>(),
    damageThisRound: new Map<string, number>(),
    noDamageRounds: new Map<string, number>(),
  } as unknown as EngineState;

  // Before: not invisible, no concentration
  eq('Faerie NOT invisible before bonus action', faerie.conditions.has('invisible'), false);
  eq('Faerie NOT concentrating before bonus action', faerie.concentration?.active ?? false, false);

  // Execute the superiorInvisibility bonus action
  executePlannedAction(faerie, {
    type: 'superiorInvisibility',
    action: null,
    targetId: faerie.id,
    description: 'Faerie Dragon uses Superior Invisibility',
  }, state);

  // After: invisible + concentrating
  eq('Faerie IS invisible after bonus action', faerie.conditions.has('invisible'), true);
  eq('Faerie IS concentrating after bonus action', faerie.concentration?.active, true);
  eq('Faerie concentration spellName = Superior Invisibility',
    faerie.concentration?.spellName, 'Superior Invisibility');

  // Log mentions Superior Invisibility
  const log = (state.log.events as any[]).find(e =>
    e.description && e.description.includes('Superior Invisibility'));
  assert('Log mentions Superior Invisibility', log !== undefined);
}

// ============================================================
console.log('\n=== 4. Engine — Superior Invisibility grants attack advantage ===\n');
{
  // Spawn a Faerie Dragon, grant it invisible condition (simulate Superior
  // Invisibility already cast). Verify attackAdvantageState returns advantage.
  const faerie = spawn('Faerie Dragon (Red)', { x: 5, y: 5, z: 0 });
  faerie.conditions.add('invisible');

  const enemy = spawn('Goblin', { x: 5, y: 6, z: 0 });

  // attackAdvantageState(attacker, target, attackType) returns {advantage, disadvantage}
  const advState = attackAdvantageState(faerie, enemy, 'melee');
  assert('Invisible attacker has advantage on attack', advState.advantage === true);
}

// ============================================================
console.log('\n=== 5. Engine — Superior Invisibility imposes disadvantage on attacks vs creature ===\n');
{
  // Spawn a Faerie Dragon with invisible condition. An attacker targeting
  // the invisible Faerie should have disadvantage.
  const faerie = spawn('Faerie Dragon (Red)', { x: 5, y: 5, z: 0 });
  faerie.conditions.add('invisible');

  const attacker = spawn('Goblin', { x: 5, y: 6, z: 0 });

  const advState = attackAdvantageState(attacker, faerie, 'melee');
  assert('Attack vs invisible creature has disadvantage', advState.disadvantage === true);
}

// ============================================================
console.log('\n=== 6. Planner — Superior Invisibility fires on turn 1 (bonus action) ===\n');
{
  // Spawn a Faerie Dragon + enemy. Call planTurn. Verify the bonus action
  // is 'superiorInvisibility'.
  const { planTurn } = require('../engine/combat');
  // planTurn lives in ai/planner.ts — re-import
  const { planTurn: plannerPlanTurn } = require('../ai/planner');

  const faerie = spawn('Faerie Dragon (Red)', { x: 5, y: 5, z: 0 });
  faerie.faction = 'enemy';
  faerie.budget = { movementFt: faerie.speed ?? 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  const enemy = spawn('Goblin', { x: 5, y: 6, z: 0 });
  enemy.faction = 'party';

  const width = 20, height = 20, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [{ terrain: 'flat', elevation: 0 }];
    }
  }
  const bf: Battlefield = {
    width, height, depth, cells,
    combatants: new Map([[faerie.id, faerie], [enemy.id, enemy]]),
    round: 1,
    initiativeOrder: [faerie.id, enemy.id],
    pendingInitiativeInserts: [],
  } as Battlefield;

  const plan = plannerPlanTurn(faerie, bf);
  assert('Planner picks superiorInvisibility as bonus action',
    plan.bonusAction?.type === 'superiorInvisibility');
}

// ============================================================
console.log('\n=== 7. Planner — Superior Invisibility does NOT fire when already invisible ===\n');
{
  const { planTurn: plannerPlanTurn } = require('../ai/planner');

  const faerie = spawn('Faerie Dragon (Red)', { x: 5, y: 5, z: 0 });
  faerie.faction = 'enemy';
  faerie.conditions.add('invisible'); // already invisible
  faerie.budget = { movementFt: faerie.speed ?? 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  const enemy = spawn('Goblin', { x: 5, y: 6, z: 0 });
  enemy.faction = 'party';

  const width = 20, height = 20, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [{ terrain: 'flat', elevation: 0 }];
    }
  }
  const bf: Battlefield = {
    width, height, depth, cells,
    combatants: new Map([[faerie.id, faerie], [enemy.id, enemy]]),
    round: 1,
    initiativeOrder: [faerie.id, enemy.id],
    pendingInitiativeInserts: [],
  } as Battlefield;

  const plan = plannerPlanTurn(faerie, bf);
  assert('Planner does NOT pick superiorInvisibility when already invisible',
    plan.bonusAction?.type !== 'superiorInvisibility');
}

// ============================================================
console.log('\n=== 8. Planner — Superior Invisibility does NOT fire when already concentrating ===\n');
{
  const { planTurn: plannerPlanTurn } = require('../ai/planner');

  const faerie = spawn('Faerie Dragon (Red)', { x: 5, y: 5, z: 0 });
  faerie.faction = 'enemy';
  faerie.concentration = { active: true, spellName: 'Some Other Spell', dcIfHit: 10 };
  faerie.budget = { movementFt: faerie.speed ?? 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  const enemy = spawn('Goblin', { x: 5, y: 6, z: 0 });
  enemy.faction = 'party';

  const width = 20, height = 20, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [{ terrain: 'flat', elevation: 0 }];
    }
  }
  const bf: Battlefield = {
    width, height, depth, cells,
    combatants: new Map([[faerie.id, faerie], [enemy.id, enemy]]),
    round: 1,
    initiativeOrder: [faerie.id, enemy.id],
    pendingInitiativeInserts: [],
  } as Battlefield;

  const plan = plannerPlanTurn(faerie, bf);
  assert('Planner does NOT pick superiorInvisibility when already concentrating',
    plan.bonusAction?.type !== 'superiorInvisibility');
}

// ============================================================
console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFailed tests above ↑'); process.exit(1); }
console.log('\nAll tests passed ✅');
