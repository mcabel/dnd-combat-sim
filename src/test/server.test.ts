// ============================================================
// server.test.ts — Phase 8 API contract tests
//
// Tests: health, classes, monsters, presets, simulate, simulate/preset
// Starts the server on a random free port; shuts it down after.
// ============================================================

import * as http from 'http';
import * as net  from 'net';
import * as fs   from 'fs';
import * as path from 'path';

// We re-use the Express `app` without calling listen()
// by starting our own http.Server on a free port.
process.env['TS_TEST_MODE'] = '1';

import { app } from '../server';

// ── Helpers ──────────────────────────────────────────────────

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => res(addr.port));
    });
    srv.on('error', rej);
  });
}

function request(
  base: string,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: object
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const url    = new URL(path, base);
    const data   = body ? JSON.stringify(body) : undefined;
    const opts: http.RequestOptions = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      method,
      headers:  {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try   { resolve({ status: res.statusCode!, json: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode!, json: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Test runner ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>) {
  return fn().then(() => {
    console.log(`  ✓ ${name}`);
    passed++;
  }).catch(err => {
    console.error(`  ✗ ${name}: ${err.message || err}`);
    failed++;
  });
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ── Suite ────────────────────────────────────────────────────

async function run() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const srv  = app.listen(port);

  console.log(`\nserver.test.ts — port ${port}`);
  console.log('─'.repeat(50));

  // ── Health ────────────────────────────────────────────────

  await test('GET /api/health returns status ok', async () => {
    const { status, json } = await request(BASE, '/api/health');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.status === 'ok', `Expected status='ok', got '${json.status}'`);
    assert(typeof json.timestamp === 'string', 'Expected timestamp string');
  });

  // ── Classes ───────────────────────────────────────────────

  await test('GET /api/classes returns all 12 classes', async () => {
    const { status, json } = await request(BASE, '/api/classes');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(json.classes), 'Expected classes array');
    assert(json.classes.length === 12, `Expected 12 classes, got ${json.classes.length}`);
  });

  await test('GET /api/classes includes fighter and wizard', async () => {
    const { json } = await request(BASE, '/api/classes');
    assert(json.classes.includes('fighter'), 'Missing fighter');
    assert(json.classes.includes('wizard'),  'Missing wizard');
  });

  await test('GET /api/classes are sorted alphabetically', async () => {
    const { json } = await request(BASE, '/api/classes');
    const sorted = [...json.classes].sort();
    assert(JSON.stringify(json.classes) === JSON.stringify(sorted), 'Classes not sorted');
  });

  // ── Monsters ─────────────────────────────────────────────

  await test('GET /api/monsters returns array', async () => {
    const { status, json } = await request(BASE, '/api/monsters');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(json.monsters), 'Expected monsters array');
    assert(json.monsters.length > 100, `Expected >100 monsters, got ${json.monsters.length}`);
  });

  await test('GET /api/monsters each entry has name, cr, type', async () => {
    const { json } = await request(BASE, '/api/monsters');
    const m = json.monsters[0];
    assert(typeof m.name === 'string', 'Missing name');
    assert(typeof m.cr   === 'string', 'Missing cr');
    assert(typeof m.type === 'string', 'Missing type');
  });

  await test('GET /api/monsters?maxCr=0 returns only CR 0 monsters', async () => {
    const { json } = await request(BASE, '/api/monsters?maxCr=0');
    assert(json.monsters.length > 0, 'Expected some CR 0 monsters');
    assert(json.monsters.every((m: any) => m.cr === '0'), 'Non-CR-0 monster in filtered list');
  });

  await test('GET /api/monsters?maxCr=0.25 excludes CR 1 monsters', async () => {
    const { json } = await request(BASE, '/api/monsters?maxCr=0.25');
    const badCr = json.monsters.find((m: any) => parseFloat(m.cr) > 0.25 && m.cr !== '1/8' && m.cr !== '1/4');
    assert(!badCr, `Found out-of-range monster: ${badCr?.name} CR ${badCr?.cr}`);
  });

  await test('GET /api/monsters sorted by CR ascending', async () => {
    const { json } = await request(BASE, '/api/monsters?maxCr=1');
    const crVals = json.monsters.map((m: any) => {
      if (m.cr === '1/8') return 0.125;
      if (m.cr === '1/4') return 0.25;
      if (m.cr === '1/2') return 0.5;
      return parseFloat(m.cr) || 0;
    });
    for (let i = 1; i < crVals.length; i++) {
      assert(crVals[i] >= crVals[i-1], `Not sorted at index ${i}: ${crVals[i-1]} > ${crVals[i]}`);
    }
  });

  // ── Presets ───────────────────────────────────────────────

  await test('GET /api/presets returns array', async () => {
    const { status, json } = await request(BASE, '/api/presets');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(json.presets), 'Expected presets array');
    assert(json.presets.length > 0, 'Expected at least one preset');
  });

  await test('GET /api/presets each entry has id, name, description', async () => {
    const { json } = await request(BASE, '/api/presets');
    const p = json.presets[0];
    assert(typeof p.id          === 'string', 'Missing id');
    assert(typeof p.name        === 'string', 'Missing name');
    assert(typeof p.description === 'string', 'Missing description');
  });

  // ── POST /api/simulate ────────────────────────────────────

  await test('POST /api/simulate returns valid result shape', async () => {
    const { status, json } = await request(BASE, '/api/simulate', 'POST', {
      party:   [{ cls: 'fighter', aiProfile: 'smart' }],
      enemies: [{ name: 'Goblin', count: 1 }],
      trials:  10,
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(typeof json.partyWinRate   === 'number', 'Missing partyWinRate');
    assert(typeof json.enemyWinRate   === 'number', 'Missing enemyWinRate');
    assert(typeof json.drawRate       === 'number', 'Missing drawRate');
    assert(typeof json.avgRounds      === 'number', 'Missing avgRounds');
    assert(typeof json.minRounds      === 'number', 'Missing minRounds');
    assert(typeof json.maxRounds      === 'number', 'Missing maxRounds');
    assert(typeof json.runs           === 'number', 'Missing runs');
    assert(typeof json.summary        === 'string', 'Missing summary');
    assert(Array.isArray(json.combatantStats), 'Missing combatantStats');
  });

  await test('POST /api/simulate win rates sum to 1', async () => {
    const { json } = await request(BASE, '/api/simulate', 'POST', {
      party:   [{ cls: 'fighter', aiProfile: 'smart' }],
      enemies: [{ name: 'Goblin', count: 1 }],
      trials:  20,
    });
    const sum = json.partyWinRate + json.enemyWinRate + json.drawRate;
    assert(Math.abs(sum - 1.0) < 0.001, `Win rates don't sum to 1: ${sum}`);
  });

  await test('POST /api/simulate combatantStats have side field', async () => {
    const { json } = await request(BASE, '/api/simulate', 'POST', {
      party:   [{ cls: 'fighter', aiProfile: 'smart' }],
      enemies: [{ name: 'Goblin', count: 1 }],
      trials:  5,
    });
    const stats = json.combatantStats as any[];
    assert(stats.length === 2, `Expected 2 combatants, got ${stats.length}`);
    const sides = stats.map((c: any) => c.side);
    assert(sides.includes('party'), 'No party side found');
    assert(sides.includes('enemy'), 'No enemy side found');
  });

  await test('POST /api/simulate runs capped at 500', async () => {
    const { json } = await request(BASE, '/api/simulate', 'POST', {
      party:   [{ cls: 'fighter', aiProfile: 'smart' }],
      enemies: [{ name: 'Goblin', count: 1 }],
      trials:  9999,
    });
    assert(json.runs === 500, `Expected 500, got ${json.runs}`);
  });

  await test('POST /api/simulate 400 on empty party', async () => {
    const { status } = await request(BASE, '/api/simulate', 'POST', {
      party:   [],
      enemies: [{ name: 'Goblin', count: 1 }],
      trials:  5,
    });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('POST /api/simulate 400 on unknown class', async () => {
    const { status, json } = await request(BASE, '/api/simulate', 'POST', {
      party:   [{ cls: 'DefinitelyNotAClass', aiProfile: 'smart' }],
      enemies: [{ name: 'Goblin', count: 1 }],
      trials:  5,
    });
    assert(status === 400, `Expected 400, got ${status}`);
    assert(typeof json.error === 'string', 'Expected error message');
  });

  await test('POST /api/simulate 400 on unknown monster', async () => {
    const { status, json } = await request(BASE, '/api/simulate', 'POST', {
      party:   [{ cls: 'fighter', aiProfile: 'smart' }],
      enemies: [{ name: 'DefinitelyNotAMonster', count: 1 }],
      trials:  5,
    });
    assert(status === 400, `Expected 400, got ${status}`);
    assert(typeof json.error === 'string', 'Expected error message');
  });

  // ── POST /api/simulate/preset ─────────────────────────────

  await test('POST /api/simulate/preset with valid id returns result', async () => {
    const { status, json } = await request(BASE, '/api/simulate/preset', 'POST', {
      id:     'fighter-vs-larva',
      trials: 10,
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(json)}`);
    assert(typeof json.partyWinRate === 'number', 'Missing partyWinRate');
    assert(typeof json.summary      === 'string', 'Missing summary');
  });

  await test('POST /api/simulate/preset 400 on missing id', async () => {
    const { status } = await request(BASE, '/api/simulate/preset', 'POST', { trials: 5 });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('POST /api/simulate/preset 404 on unknown id', async () => {
    const { status } = await request(BASE, '/api/simulate/preset', 'POST', { id: 'no-such-preset' });
    assert(status === 404, `Expected 404, got ${status}`);
  });

  // -- roundDistribution (8-D) --

  await test('POST /api/simulate returns roundDistribution object', async () => {
    const { json } = await request(BASE, '/api/simulate', 'POST', {
      party:   [{ cls: 'fighter', aiProfile: 'smart' }],
      enemies: [{ name: 'Goblin', count: 1 }],
      trials:  20,
    });
    assert(typeof json.roundDistribution === 'object' && json.roundDistribution !== null,
      'Missing roundDistribution');
    const keys = Object.keys(json.roundDistribution);
    assert(keys.length > 0, 'roundDistribution is empty');
    for (const k of keys) {
      assert(!isNaN(Number(k)), `Non-numeric key: ${k}`);
      assert(json.roundDistribution[k] > 0, `Zero count for round ${k}`);
    }
  });

  await test('POST /api/simulate roundDistribution counts sum to runs', async () => {
    const RUNS = 30;
    const { json } = await request(BASE, '/api/simulate', 'POST', {
      party:   [{ cls: 'fighter', aiProfile: 'smart' }],
      enemies: [{ name: 'Goblin', count: 1 }],
      trials:  RUNS,
    });
    const total = Object.values(json.roundDistribution as Record<string, number>)
      .reduce((a: number, b: number) => a + b, 0);
    assert(total === RUNS, `Distribution counts ${total} !== runs ${RUNS}`);
  });

  await test('POST /api/simulate/preset returns roundDistribution', async () => {
    const { json } = await request(BASE, '/api/simulate/preset', 'POST', {
      id: 'fighter-vs-larva', trials: 10,
    });
    assert(typeof json.roundDistribution === 'object', 'Missing roundDistribution from preset');
  });

  // -- POST /api/simulate/report (8-F) --

  await test('POST /api/simulate/report returns html string', async () => {
    const { status, json } = await request(BASE, '/api/simulate/report', 'POST', {
      party:   [{ cls: 'fighter', aiProfile: 'smart' }],
      enemies: [{ name: 'Goblin', count: 1 }],
      trials:  10,
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(typeof json.html === 'string', 'Expected html string');
    assert(json.html.startsWith('<!DOCTYPE html>'), 'html should start with DOCTYPE');
    assert(json.html.includes('fighter'), 'html should include party class name');
  });

  await test('POST /api/simulate/report 400 on empty party', async () => {
    const { status } = await request(BASE, '/api/simulate/report', 'POST', {
      party:   [],
      enemies: [{ name: 'Goblin', count: 1 }],
      trials:  5,
    });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('POST /api/simulate/report 400 on unknown monster', async () => {
    const { status } = await request(BASE, '/api/simulate/report', 'POST', {
      party:   [{ cls: 'fighter', aiProfile: 'smart' }],
      enemies: [{ name: 'NotARealMonster', count: 1 }],
      trials:  5,
    });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  // -- Character routes: Paladin High Elf (UUID 000...003, UUID-named file so loadCharacter works) --
  // Reset Paladin to level 1 before tests — the file mutates across runs.

  const PALADIN_ID   = '00000000-0000-0000-0000-000000000003';
  const PALADIN_FILE = path.join(process.cwd(), 'characters', PALADIN_ID + '.json');
  const PALADIN_PRISTINE = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));

  function resetPaladin(): void {
    const p = JSON.parse(JSON.stringify(PALADIN_PRISTINE));
    p.classLevels                     = [{ className: 'Paladin', level: 1 }];
    p.experiencePoints                = 0;
    p.currentHP                       = p.maxHP;
    p.subclassChoices                 = {};
    p.pendingAbilityScoreImprovements = 0;
    p.pendingASIHalfPoints            = 0;
    p.stats                           = { ...PALADIN_PRISTINE.stats };
    p.hitDice                         = [{ className: 'Paladin', dieSides: 10, total: 1, remaining: 1 }];
    p.updatedAt                       = new Date().toISOString();
    fs.writeFileSync(PALADIN_FILE, JSON.stringify(p, null, 2), 'utf-8');
  }

  resetPaladin();

  const testCharId  = PALADIN_ID;
  let   testPartyId = '';

  await test('GET /api/characters includes Paladin (Selariel Dawnblade)', async () => {
    const { status, json } = await request(BASE, '/api/characters', 'GET');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(json.characters), 'Characters array present');
    const paladin = (json.characters as any[]).find((c: any) => c.name === 'Selariel Dawnblade');
    assert(!!paladin, `Paladin not found. Names: ${(json.characters as any[]).map((c:any)=>c.name).join(', ')}`);
    assert(paladin.id === PALADIN_ID, 'Paladin has correct ID');
  });

  await test('POST /api/:id/levelup levels Paladin to 2', async () => {
    if (!testCharId) { throw new Error('testCharId not set'); }
    const { status, json } = await request(BASE, `/api/${testCharId}/levelup`, 'POST', {
      className: 'Paladin', hpMethod: 'average',
    });
    assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(json.character?.classLevels?.[0]?.level === 2, `Expected level 2, got ${json.character?.classLevels?.[0]?.level}`);
  });

  await test('POST /api/characters/:id/choosesubclass sets Oath of Devotion', async () => {
    if (!testCharId) { throw new Error('testCharId not set'); }
    const { status, json } = await request(BASE, `/api/characters/${testCharId}/choosesubclass`, 'POST', {
      className: 'Paladin', subclassName: 'Oath of Devotion',
    });
    assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(json.character?.subclassChoices?.Paladin === 'Oath of Devotion', 'Subclass set');
  });

  await test('POST /api/:id/levelup triggers ASI at Paladin level 4', async () => {
    if (!testCharId) { throw new Error('testCharId not set'); }
    await request(BASE, `/api/${testCharId}/levelup`, 'POST', { className: 'Paladin', hpMethod: 'average' }); // → 3
    const { status, json } = await request(BASE, `/api/${testCharId}/levelup`, 'POST', { className: 'Paladin', hpMethod: 'average' }); // → 4 (ASI)
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.character?.pendingAbilityScoreImprovements >= 1, 'ASI pending at Paladin level 4');
  });

  await test('POST /api/characters/:id/applyasi applies +2 CHA', async () => {
    if (!testCharId) { throw new Error('testCharId not set'); }
    const { json: cur } = await request(BASE, `/api/characters/${testCharId}`, 'GET');
    const chaBefore = cur.character?.stats?.cha ?? 0;
    const { status, json } = await request(BASE, `/api/characters/${testCharId}/applyasi`, 'POST', {
      ability: 'cha', amount: 2,
    });
    assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(json.character?.stats?.cha === chaBefore + 2, `Expected cha ${chaBefore+2}, got ${json.character?.stats?.cha}`);
  });

  await test('POST /api/parties creates party with Paladin', async () => {
    if (!testCharId) { throw new Error('testCharId not set'); }
    const { status, json } = await request(BASE, '/api/parties', 'POST', {
      name: 'TestPartyPaladin', characterIds: [testCharId],
    });
    assert(status === 200 || status === 201, `Expected 200/201, got ${status}`);
    assert(json.party?.id, 'Party has id');
    testPartyId = json.party.id;
  });

  await test('POST /api/parties/:id/awardxp awards XP (4 Goblins = 200 XP)', async () => {
    if (!testPartyId) { throw new Error('testPartyId not set'); }
    const { status, json } = await request(BASE, `/api/parties/${testPartyId}/awardxp`, 'POST', {
      enemies: [{ name: 'Goblin', count: 4 }],
    });
    assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(json.xpEach === 200, `Expected 200 xpEach (4×50÷1), got ${json.xpEach}`);
    assert(Array.isArray(json.awarded) && json.awarded.length === 1, 'One member in award list');
  });


  // -- difficulty label (8-G) --

  await test('POST /api/simulate returns difficulty string', async () => {
    const { status, json } = await request(BASE, '/api/simulate', 'POST', {
      party:   [{ cls: 'fighter', aiProfile: 'smart' }],
      enemies: [{ name: 'Goblin', count: 1 }],
      trials:  20,
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(typeof json.difficulty === 'string' && json.difficulty.length > 0,
      `Expected non-empty difficulty string, got: ${JSON.stringify(json.difficulty)}`);
  });

  await test('POST /api/simulate difficulty is a valid label', async () => {
    const VALID = new Set(['Trivial', 'Easy', 'Medium', 'Hard', 'Deadly', 'TPK']);
    const { json } = await request(BASE, '/api/simulate', 'POST', {
      party:   [{ cls: 'fighter', aiProfile: 'smart' }],
      enemies: [{ name: 'Goblin', count: 1 }],
      trials:  20,
    });
    assert(VALID.has(json.difficulty),
      `difficulty "${json.difficulty}" not in valid set [${[...VALID].join(', ')}]`);
  });

  await test('POST /api/simulate/preset returns difficulty', async () => {
    const { json } = await request(BASE, '/api/simulate/preset', 'POST', {
      id: 'fighter-vs-larva', trials: 10,
    });
    const VALID = new Set(['Trivial', 'Easy', 'Medium', 'Hard', 'Deadly', 'TPK']);
    assert(typeof json.difficulty === 'string' && VALID.has(json.difficulty),
      `preset difficulty invalid: ${JSON.stringify(json.difficulty)}`);
  });

  await test('difficultyLabel() thresholds are correct', async () => {
    const { difficultyLabel } = await import('../server');
    const cases: Array<[number, string]> = [
      [1.00, 'Trivial'],
      [0.90, 'Trivial'],
      [0.89, 'Easy'],
      [0.70, 'Easy'],
      [0.69, 'Medium'],
      [0.45, 'Medium'],
      [0.44, 'Hard'],
      [0.25, 'Hard'],
      [0.24, 'Deadly'],
      [0.10, 'Deadly'],
      [0.09, 'TPK'],
      [0.00, 'TPK'],
    ];
    for (const [rate, expected] of cases) {
      const got = difficultyLabel(rate);
      assert(got === expected, `difficultyLabel(${rate}) → "${got}", expected "${expected}"`);
    }
  });

  // ── CORS ──────────────────────────────────────────────────

  await test('All responses include CORS header', async () => {
    // Test via Node http — check raw response header
    await new Promise<void>((resolve, reject) => {
      const req = http.request({ hostname: 'localhost', port, path: '/api/health' }, res => {
        const cors = res.headers['access-control-allow-origin'];
        try {
          assert(cors === '*', `Expected CORS *, got ${cors}`);
          resolve();
        } catch (e) { reject(e); }
      });
      req.on('error', reject);
      req.end();
    });
  });

  // ── Tear down ─────────────────────────────────────────────

  srv.close();

  console.log('─'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
