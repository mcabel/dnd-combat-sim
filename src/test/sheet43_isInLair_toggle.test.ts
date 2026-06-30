// ============================================================
// Test: SHEET-43 — per-enemy isInLair toggle in /simulate/custom
//
// Validates the SHEET-43 deliverable: the /api/simulate/custom endpoint
// accepts an optional `isInLair` boolean on each enemy config, and the
// router applies it as an override on the spawned Combatant AFTER the
// parser default (isInLair=true for lair creatures, undefined otherwise).
//
// This closes the z-stream S104 loose end ("Character-builder isInLair
// toggle UI — SHEET stream"). Monsters are not persisted as CharacterSheets
// (they're spawned live in the simulate panel), so the toggle lives on the
// per-enemy sim config row, not in the character builder. See SHEET-HANDOVER-43.
//
// Coverage:
//   §1-§4: HTTP-level — POST /api/simulate/custom accepts isInLair
//          (false / true / omitted / on a lair creature) → 200 + valid shape.
//   §5:    Engine-level — router override `isInLair = false` on a lair
//          creature → 0 lair-action logs (behavioral verification).
//   §6:    Engine-level — router override `isInLair = true` (explicit) on a
//          lair creature → ≥1 lair-action log (same as parser default).
//   §7:    Engine-level — no override (undefined) → parser default stands
//          (true for lair creatures) → ≥1 lair-action log.
//
// Run: npx ts-node --transpile-only src/test/sheet43_isInLair_toggle.test.ts
// ============================================================

import * as http from 'http';
import * as net  from 'net';
import * as fs   from 'fs';
import * as path from 'path';

process.env['TS_TEST_MODE'] = '1';
import { app } from '../server';

import { spawnMonster } from '../parser/fivetools';
import { mergeBestiaries, Raw5etoolsMonster } from '../parser/fivetools';
import { runCombat } from '../engine/combat';
import { Combatant, Battlefield, Vec3 } from '../types/core';

// ---- Test runner --------------------------------------------

let passed = 0, failed = 0;
function test(name: string, fn: () => Promise<void>): Promise<void> {
  return fn().then(() => { console.log(`  ✓ ${name}`); passed++; })
             .catch(err => { console.error(`  ✗ ${name}: ${err.message || err}`); failed++; });
}
function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }

// ---- HTTP helpers -------------------------------------------

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.listen(0, () => { const p = (srv.address() as net.AddressInfo).port; srv.close(() => res(p)); });
    srv.on('error', rej);
  });
}
function request(base: string, p: string, method: 'GET'|'POST' = 'GET', body?: object): Promise<{status:number; json:any}> {
  return new Promise((resolve, reject) => {
    const url = new URL(p, base);
    const data = body ? JSON.stringify(body) : undefined;
    const opts: http.RequestOptions = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    };
    const req = http.request(opts, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => { try { resolve({ status: res.statusCode!, json: JSON.parse(raw) }); }
                              catch { resolve({ status: res.statusCode!, json: raw }); } });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

// ---- Bestiary + engine helpers (mirror session92) -----------

const NEEDED_SOURCES = ['mm-2014'];
const dir = path.join(__dirname, '../../bestiaryData');
const allFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const files = allFiles.filter(f => NEEDED_SOURCES.some(src => f === `bestiary-${src}.json`));
const loaded = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
const bestiary = mergeBestiaries(...loaded);

function spawn(name: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnMonster(bestiary, name, pos);
  if (!c) throw new Error(`Monster not found: ${name}`);
  return c;
}

interface MutableBF extends Battlefield { [k: string]: any; }
function makeBF(combatants: Combatant[]): MutableBF {
  const width = 30, height = 30, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) { cells[x] = []; for (let y = 0; y < height; y++) cells[x][y] = [{ terrain: 'flat', elevation: 0 }]; }
  return { width, height, depth, cells,
           combatants: new Map(combatants.map(c => [c.id, c])),
           round: 1, initiativeOrder: combatants.map(c => c.id) } as MutableBF;
}
function lairLogs(log: any): any[] {
  return log.events.filter((e: any) => e.type === 'action' && e.description.includes('lair action'));
}
function tankUp(c: Combatant): void { c.maxHP = 100_000; c.currentHP = 100_000; }

// ---- Paladin character ID (pre-existing file) ---------------

const PALADIN_ID = '00000000-0000-0000-0000-000000000003';

// ============================================================
// Suite
// ============================================================

async function run() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const srv  = app.listen(port);

  console.log(`\nsheet43_isInLair_toggle.test.ts — port ${port}`);
  console.log('─'.repeat(50));

  // Verify the Paladin character file exists (required for /simulate/custom)
  const paladinFile = path.join(process.cwd(), 'characters', PALADIN_ID + '.json');
  assert(fs.existsSync(paladinFile), `Paladin character file missing: ${paladinFile}`);

  // ── §1. HTTP: isInLair: false accepted (Goblin) ──────────

  await test('§1 POST /simulate/custom with isInLair:false (Goblin) → 200 + valid shape', async () => {
    const { status, json } = await request(BASE, '/api/simulate/custom', 'POST', {
      partyCharacterIds: [PALADIN_ID],
      enemies: [{ name: 'Goblin', count: 1, isInLair: false }],
      trials: 5,
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(json)}`);
    assert(typeof json.partyWinRate === 'number', 'partyWinRate is number');
    assert(typeof json.enemyWinRate === 'number', 'enemyWinRate is number');
    assert(json.runs === 5, `Expected 5 runs, got ${json.runs}`);
    assert(Array.isArray(json.combatantStats), 'combatantStats is array');
  });

  // ── §2. HTTP: isInLair: true accepted (Goblin) ───────────

  await test('§2 POST /simulate/custom with isInLair:true (Goblin) → 200 + valid shape', async () => {
    const { status, json } = await request(BASE, '/api/simulate/custom', 'POST', {
      partyCharacterIds: [PALADIN_ID],
      enemies: [{ name: 'Goblin', count: 1, isInLair: true }],
      trials: 5,
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(json)}`);
    assert(typeof json.partyWinRate === 'number', 'partyWinRate is number');
  });

  // ── §3. HTTP: isInLair omitted → backward compat ─────────

  await test('§3 POST /simulate/custom with isInLair omitted → 200 (backward compat)', async () => {
    const { status, json } = await request(BASE, '/api/simulate/custom', 'POST', {
      partyCharacterIds: [PALADIN_ID],
      enemies: [{ name: 'Goblin', count: 1 }],
      trials: 5,
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(json)}`);
    assert(typeof json.partyWinRate === 'number', 'partyWinRate is number');
  });

  // ── §4. HTTP: isInLair: false on a lair creature (Adult Red Dragon) ──

  await test('§4 POST /simulate/custom with isInLair:false (Adult Red Dragon) → 200', async () => {
    const { status, json } = await request(BASE, '/api/simulate/custom', 'POST', {
      partyCharacterIds: [PALADIN_ID],
      enemies: [{ name: 'Adult Red Dragon', count: 1, isInLair: false }],
      trials: 3,
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(json)}`);
    assert(typeof json.partyWinRate === 'number', 'partyWinRate is number');
    assert(json.runs === 3, `Expected 3 runs, got ${json.runs}`);
  });

  // ── §5. Engine: router override isInLair=false → 0 lair logs ──

  await test('§5 Engine: override isInLair=false on lair creature → 0 lair-action logs', async () => {
    const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
    dragon.faction = 'party';
    tankUp(dragon);
    // Mimic the SHEET-43 router override: cfg.isInLair === false → m.isInLair = false
    dragon.isInLair = false;

    const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
    goblin.faction = 'enemy';
    tankUp(goblin);

    const bf = makeBF([dragon, goblin]);
    const log = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 2, verbose: false } as any);
    const ll = lairLogs(log);
    assert(ll.length === 0, `Expected 0 lair-action logs with isInLair=false, got ${ll.length}`);
  });

  // ── §6. Engine: router override isInLair=true (explicit) → ≥1 lair log ──

  await test('§6 Engine: override isInLair=true (explicit) on lair creature → ≥1 lair-action log', async () => {
    const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
    dragon.faction = 'party';
    tankUp(dragon);
    // Mimic the SHEET-43 router override: cfg.isInLair === true → m.isInLair = true (explicit)
    dragon.isInLair = true;

    const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
    goblin.faction = 'enemy';
    tankUp(goblin);

    const bf = makeBF([dragon, goblin]);
    const log = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 2, verbose: false } as any);
    const ll = lairLogs(log);
    assert(ll.length >= 1, `Expected ≥1 lair-action log with isInLair=true, got ${ll.length}`);
  });

  // ── §7. Engine: no override (undefined) → parser default (true) → ≥1 lair log ──

  await test('§7 Engine: no override (undefined) → parser default isInLair=true → ≥1 lair-action log', async () => {
    const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
    dragon.faction = 'party';
    tankUp(dragon);
    // No override — parser default isInLair=true stands (the router's
    // `if (cfg.isInLair !== undefined)` guard means undefined is a no-op).
    assert(dragon.isInLair === true, `Parser default should be true, got ${dragon.isInLair}`);

    const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
    goblin.faction = 'enemy';
    tankUp(goblin);

    const bf = makeBF([dragon, goblin]);
    const log = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 2, verbose: false } as any);
    const ll = lairLogs(log);
    assert(ll.length >= 1, `Expected ≥1 lair-action log with parser default, got ${ll.length}`);
  });

  // ── Done ──────────────────────────────────────────────────

  srv.close();
  console.log('─'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
