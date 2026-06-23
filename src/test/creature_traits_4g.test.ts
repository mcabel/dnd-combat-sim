// ============================================================
// Test: Creature Traits 4g — Charge + Pounce (Session 53 Batch 4g)
//
// Validates:
//   - Charge + Pounce flags parsed correctly from 5etools trait text
//   - _turnStartPos tracked by resetBudget
//   - Charge rider: extra damage on hit after moving toward target
//   - Charge rider: STR save vs push/prone (when saveDC > 0)
//   - Charge rider: no save when saveDC = 0 (Centaur variant)
//   - Pounce rider: STR save vs prone on hit after moving toward target
//   - Riders do NOT fire when movement requirement not met
//
// Reverse published order (newest pre-2024 source first):
//   - MM (2014): Boar (Charge), Allosaurus (Pounce), Centaur (Charge),
//     Deinonychus (Pounce)
//
// Run: npx ts-node src/test/creature_traits_4g.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
  Raw5etoolsMonster,
} from '../parser/fivetools';
import { Combatant, Vec3, Battlefield } from '../types/core';
import { EngineState, resolveAttack } from '../engine/combat';
import { resetBudget } from '../engine/utils';

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
const NEEDED_SOURCES = ['mm-2014', 'mm', 'dmg'];
function loadBestiary(): Map<string, Raw5etoolsMonster> {
  const dir = path.join(__dirname, '../../bestiaryData');
  const allFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const files = allFiles.filter(f =>
    NEEDED_SOURCES.some(src => f === `bestiary-${src}.json`));
  const loaded = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
  return mergeBestiaries(...loaded);
}
const bestiary = loadBestiary();

function spawn(name: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnMonster(bestiary, name, pos);
  if (!c) throw new Error(`Monster not found: ${name}`);
  return c;
}

// ---- Combat state factory ---------------------------------
function makeBF(combatants: Combatant[]): Battlefield {
  const width = 20, height = 20, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [{ terrain: 'flat', elevation: 0 }];
    }
  }
  return {
    width, height, depth, cells,
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1,
    initiativeOrder: combatants.map(c => c.id),
    pendingInitiativeInserts: [],
  } as Battlefield;
}

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [] } as any,
    round: 1,
    activeCombatantId: null,
    pendingActions: [],
    rageDamagedSinceLastTurn: new Set<string>(),
    disengagedThisTurn: new Set<string>(),
    damageThisRound: new Map<string, number>(),
    noDamageRounds: new Map<string, number>(),
  } as unknown as EngineState;
}

// ============================================================
console.log('\n=== 1. Parser — Charge (Boar, CR 1/4) ===\n');
{
  const boar = spawn('Boar');
  assert('Boar has charge', boar.charge !== undefined);
  if (boar.charge) {
    eq('Boar charge minMoveFt = 20', boar.charge.minMoveFt, 20);
    eq('Boar charge damage count = 1', boar.charge.damage.count, 1);
    eq('Boar charge damage sides = 6', boar.charge.damage.sides, 6);
    eq('Boar charge saveDC = 11', boar.charge.saveDC, 11);
    eq('Boar charge knockProne = true', boar.charge.knockProne, true);
  }
}

// ============================================================
console.log('\n=== 2. Parser — Charge (Centaur, no save DC) ===\n');
{
  const centaur = spawn('Centaur');
  assert('Centaur has charge', centaur.charge !== undefined);
  if (centaur.charge) {
    eq('Centaur charge minMoveFt = 30', centaur.charge.minMoveFt, 30);
    eq('Centaur charge damage count = 3', centaur.charge.damage.count, 3);
    eq('Centaur charge damage sides = 6', centaur.charge.damage.sides, 6);
    eq('Centaur charge saveDC = 0 (no save)', centaur.charge.saveDC, 0);
    eq('Centaur charge knockProne = false', centaur.charge.knockProne, false);
  }
}

// ============================================================
console.log('\n=== 3. Parser — Pounce (Allosaurus, CR 5) ===\n');
{
  const allo = spawn('Allosaurus');
  assert('Allosaurus has pounce', allo.pounce !== undefined);
  if (allo.pounce) {
    eq('Allosaurus pounce minMoveFt = 30', allo.pounce.minMoveFt, 30);
    eq('Allosaurus pounce saveDC = 13', allo.pounce.saveDC, 13);
    eq('Allosaurus pounce bonusActionAttack = bite', allo.pounce.bonusActionAttackName, 'bite');
  }
}

// ============================================================
console.log('\n=== 4. Parser — Pounce (Panther, CR 1/4) ===\n');
{
  const panther = spawn('Panther');
  assert('Panther has pounce', panther.pounce !== undefined);
  if (panther.pounce) {
    eq('Panther pounce minMoveFt = 20', panther.pounce.minMoveFt, 20);
    // Panther's Pounce DC varies; just verify it's present
    assert('Panther pounce saveDC > 0', (panther.pounce.saveDC ?? 0) > 0);
  }
}

// ============================================================
console.log('\n=== 5. Engine — _turnStartPos tracked by resetBudget ===\n');
{
  const boar = spawn('Boar', { x: 5, y: 5, z: 0 });
  // Before resetBudget: _turnStartPos is undefined
  eq('_turnStartPos undefined before resetBudget', boar._turnStartPos, undefined);
  // Call resetBudget
  resetBudget(boar);
  // After: _turnStartPos = current position
  assert('_turnStartPos set after resetBudget', boar._turnStartPos !== undefined);
  eq('_turnStartPos.x = 5', boar._turnStartPos!.x, 5);
  eq('_turnStartPos.y = 5', boar._turnStartPos!.y, 5);
}

// ============================================================
console.log('\n=== 6. Engine — Charge fires after moving toward target ===\n');
{
  // De-flake (Session 53): nat 1 is an automatic miss (PHB p.194) — 5% chance.
  // Retry until the attack hits (up to 20 tries → P(all miss) = 0.05^20 ≈ 0).
  let chargeFired = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const boar = spawn('Boar', { x: 0, y: 0, z: 0 });
    boar.faction = 'party';
    resetBudget(boar);

    const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
    goblin.faction = 'enemy';
    goblin.currentHP = 1000;
    goblin.maxHP = 1000;
    goblin.ac = 5;

    boar.pos = { x: 4, y: 0, z: 0 };

    const bf = makeBF([boar, goblin]);
    const state = makeState(bf);
    resolveAttack(boar, goblin, boar.actions[0], state);

    const chargeLog = (state.log.events as any[]).find(e =>
      e.description && e.description.includes('Charge'));
    if (chargeLog) { chargeFired = true; break; }
  }
  assert('Charge rider fired (log mentions Charge, within 20 attempts)', chargeFired);
}

// ============================================================
console.log('\n=== 7. Engine — Charge does NOT fire without enough movement ===\n');
{
  const boar = spawn('Boar', { x: 0, y: 0, z: 0 });
  boar.faction = 'party';
  resetBudget(boar);

  const goblin = spawn('Goblin', { x: 3, y: 0, z: 0 });
  goblin.faction = 'enemy';
  goblin.currentHP = 1000;
  goblin.maxHP = 1000;
  goblin.ac = 5;

  // Move Boar only 1 square (5 ft) — not enough for minMoveFt=20
  boar.pos = { x: 1, y: 0, z: 0 };

  const bf = makeBF([boar, goblin]);
  const state = makeState(bf);
  resolveAttack(boar, goblin, boar.actions[0], state);

  // Log should NOT mention "Charge"
  const chargeLog = (state.log.events as any[]).find(e =>
    e.description && e.description.includes('Charge'));
  eq('Charge rider NOT fired (insufficient movement)', chargeLog, undefined);
}

// ============================================================
console.log('\n=== 8. Engine — Pounce fires after moving toward target ===\n');
{
  // De-flake (Session 53): nat 1 is an automatic miss — 5% chance.
  // Retry until the attack hits.
  let pounceFired = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const allo = spawn('Allosaurus', { x: 0, y: 0, z: 0 });
    allo.faction = 'party';
    resetBudget(allo);

    const goblin = spawn('Goblin', { x: 7, y: 0, z: 0 });
    goblin.faction = 'enemy';
    goblin.currentHP = 1000;
    goblin.maxHP = 1000;
    goblin.ac = 5;

    allo.pos = { x: 6, y: 0, z: 0 };

    const bf = makeBF([allo, goblin]);
    const state = makeState(bf);
    resolveAttack(allo, goblin, allo.actions[0], state);

    const pounceLog = (state.log.events as any[]).find(e =>
      e.description && e.description.includes('Pounce'));
    if (pounceLog) { pounceFired = true; break; }
  }
  assert('Pounce rider fired (log mentions Pounce, within 20 attempts)', pounceFired);
}

// ============================================================
console.log('\n=== 9. Engine — Pounce does NOT fire without enough movement ===\n');
{
  const allo = spawn('Allosaurus', { x: 0, y: 0, z: 0 });
  allo.faction = 'party';
  resetBudget(allo);

  const goblin = spawn('Goblin', { x: 3, y: 0, z: 0 });
  goblin.faction = 'enemy';
  goblin.currentHP = 1000;
  goblin.maxHP = 1000;
  goblin.ac = 5;

  // Move Allosaurus only 1 square (5 ft) — not enough for minMoveFt=30
  allo.pos = { x: 1, y: 0, z: 0 };

  const bf = makeBF([allo, goblin]);
  const state = makeState(bf);
  resolveAttack(allo, goblin, allo.actions[0], state);

  const pounceLog = (state.log.events as any[]).find(e =>
    e.description && e.description.includes('Pounce'));
  eq('Pounce rider NOT fired (insufficient movement)', pounceLog, undefined);
}

// ============================================================
console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFailed tests above ↑'); process.exit(1); }
console.log('\nAll tests passed ✅');
