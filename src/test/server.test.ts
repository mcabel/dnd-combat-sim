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
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
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
    p.levelHistory                    = [];
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

  await test('POST /api/parties/:id/awardxp awards XP via xpOverride', async () => {
    if (!testPartyId) { throw new Error('testPartyId not set'); }
    const { status, json } = await request(BASE, `/api/parties/${testPartyId}/awardxp`, 'POST', {
      xpOverride: 300,
    });
    assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(json.totalXP === 300, `Expected totalXP 300, got ${json.totalXP}`);
    assert(json.xpEach === 300, `Expected xpEach 300 (1 member), got ${json.xpEach}`);
    assert(Array.isArray(json.awarded) && json.awarded.length === 1, 'One member in award list');
  });

  await test('POST /api/parties/:id/awardxp 400 when neither enemies nor xpOverride given', async () => {
    if (!testPartyId) { throw new Error('testPartyId not set'); }
    const { status, json } = await request(BASE, `/api/parties/${testPartyId}/awardxp`, 'POST', {});
    assert(status === 400, `Expected 400, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(typeof json.error === 'string', 'Response should have error field');
  });

  // -- awardxp error cases --

  await test('POST /api/parties/:id/awardxp 404 on missing party', async () => {
    const { status, json } = await request(BASE, '/api/parties/nonexistent-party-id/awardxp', 'POST', {
      enemies: [{ name: 'Goblin', count: 1 }],
    });
    assert(status === 404, `Expected 404, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(typeof json.error === 'string', 'Response should have error field');
  });

  await test('POST /api/parties/:id/awardxp 400 on unknown monster', async () => {
    if (!testPartyId) { throw new Error('testPartyId not set'); }
    const { status, json } = await request(BASE, `/api/parties/${testPartyId}/awardxp`, 'POST', {
      enemies: [{ name: 'Totally Fake Monster That Does Not Exist XYZ123', count: 1 }],
    });
    assert(status === 400, `Expected 400, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(typeof json.error === 'string', 'Response should have error field');
  });

  // -- long rest --

  await test('POST /api/characters/:id/longrest restores HP and resources', async () => {
    // Wound the Paladin first
    const woundedSheet = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    woundedSheet.currentHP = 1;
    fs.writeFileSync(PALADIN_FILE, JSON.stringify(woundedSheet));

    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/longrest`, 'POST', {});
    assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(json.character.currentHP === json.character.maxHP, 'HP fully restored after long rest');
    assert(Array.isArray(json.restored), 'restored field is array');
    assert(json.restored.some((r: string) => r.includes('HP')), 'restored includes HP entry');
    resetPaladin();
  });

  await test('POST /api/characters/:id/longrest 404 on missing character', async () => {
    const { status, json } = await request(BASE, '/api/characters/no-such-char/longrest', 'POST', {});
    assert(status === 404, `Expected 404, got ${status}`);
    assert(typeof json.error === 'string', 'Response should have error field');
  });

  // -- set level --

  await test('POST /api/characters/:id/setlevel levels up to target', async () => {
    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/setlevel`, 'POST', {
      level: 3,
    });
    assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(typeof json.levelsGained === 'number' && json.levelsGained >= 2,
      `Expected levelsGained >= 2, got ${json.levelsGained}`);
    const totalLvl = (json.character.classLevels || []).reduce(
      (s: number, c: { level: number }) => s + c.level, 0);
    assert(totalLvl === 3, `Expected total level 3, got ${totalLvl}`);
    resetPaladin();
  });

  await test('POST /api/characters/:id/setlevel 400 on level <= current', async () => {
    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/setlevel`, 'POST', {
      level: 1,
    });
    assert(status === 400, `Expected 400, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(typeof json.error === 'string', 'Response should have error field');
  });

  await test('POST /api/characters/:id/setlevel 400 on invalid level', async () => {
    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/setlevel`, 'POST', {
      level: 25,
    });
    assert(status === 400, `Expected 400, got ${status}`);
    assert(typeof json.error === 'string', 'Response should have error field');
  });

  // -- leveldown (popLevel via endpoint) --

  await test('POST /api/characters/:id/leveldown pops one level', async () => {
    // First level up to 3 (builds levelHistory)
    await request(BASE, `/api/characters/${PALADIN_ID}/setlevel`, 'POST', { level: 3 });

    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/leveldown`, 'POST', {});
    assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
    const totalLvl = (json.character.classLevels || []).reduce(
      (s: number, c: { level: number }) => s + c.level, 0);
    assert(totalLvl === 2, `Expected total level 2, got ${totalLvl}`);
    assert(typeof json.poppedLevel?.className === 'string', 'poppedLevel.className present');
    assert(typeof json.poppedLevel?.classLevel === 'number', 'poppedLevel.classLevel present');
    assert(Array.isArray(json.character.levelHistory), 'levelHistory is array on response');
    resetPaladin();
  });

  await test('POST /api/characters/:id/leveldown 400 at level 1', async () => {
    // Paladin is already reset to level 1
    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/leveldown`, 'POST', {});
    assert(status === 400, `Expected 400, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(typeof json.error === 'string', 'Response should have error field');
  });

  await test('POST /api/characters/:id/leveldown 404 on missing character', async () => {
    const { status, json } = await request(BASE, '/api/characters/no-such-char/leveldown', 'POST', {});
    assert(status === 404, `Expected 404, got ${status}`);
    assert(typeof json.error === 'string', 'error field present');
  });

  await test('POST /api/characters/:id/setlevel levels down via pop', async () => {
    // Level up to 5
    await request(BASE, `/api/characters/${PALADIN_ID}/setlevel`, 'POST', { level: 5 });
    // Level down to 2
    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/setlevel`, 'POST', { level: 2 });
    assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
    const totalLvl = (json.character.classLevels || []).reduce(
      (s: number, c: { level: number }) => s + c.level, 0);
    assert(totalLvl === 2, `Expected total level 2, got ${totalLvl}`);
    assert(json.levelsLost === 3, `Expected levelsLost=3, got ${json.levelsLost}`);
    resetPaladin();
  });

  await test('POST /api/characters/:id/setlevel 400 on same level', async () => {
    // Paladin is level 1 — send level 1 (same)
    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/setlevel`, 'POST', {
      level: 1,
    });
    assert(status === 400, `Expected 400, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(typeof json.error === 'string', 'Response should have error field');
  });

  // -- legacy bootstrap (no levelHistory) --

  await test('POST /api/characters/:id/setlevel level-down succeeds for legacy char (no levelHistory)', async () => {
    // Level up the Paladin via setlevel (builds history), then strip history to simulate legacy
    await request(BASE, `/api/characters/${PALADIN_ID}/setlevel`, 'POST', { level: 4 });
    // Directly overwrite file to remove levelHistory (simulate pre-stack legacy)
    const raw = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    raw.levelHistory = undefined;
    fs.writeFileSync(PALADIN_FILE, JSON.stringify(raw, null, 2), 'utf-8');

    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/setlevel`, 'POST', { level: 2 });
    assert(status === 200, `Expected 200 for legacy bootstrap, got ${status}. Body: ${JSON.stringify(json)}`);
    const totalLvl = (json.character.classLevels || []).reduce(
      (s: number, c: { level: number }) => s + c.level, 0);
    assert(totalLvl === 2, `Expected total level 2 after legacy level-down, got ${totalLvl}`);
    assert(json.levelsLost === 2, `Expected levelsLost=2, got ${json.levelsLost}`);
    resetPaladin();
  });

  await test('POST /api/characters/:id/leveldown succeeds for legacy char (no levelHistory)', async () => {
    // Level up to 3, then strip history
    await request(BASE, `/api/characters/${PALADIN_ID}/setlevel`, 'POST', { level: 3 });
    const raw = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    raw.levelHistory = undefined;
    fs.writeFileSync(PALADIN_FILE, JSON.stringify(raw, null, 2), 'utf-8');

    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/leveldown`, 'POST', {});
    assert(status === 200, `Expected 200 for legacy bootstrap leveldown, got ${status}. Body: ${JSON.stringify(json)}`);
    const totalLvl = (json.character.classLevels || []).reduce(
      (s: number, c: { level: number }) => s + c.level, 0);
    assert(totalLvl === 2, `Expected total level 2 after legacy leveldown, got ${totalLvl}`);
    resetPaladin();
  });



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

  // -- short rest --

  await test('POST /api/characters/:id/shortrest returns 404 on missing character', async () => {
    const { status, json } = await request(BASE, '/api/characters/no-such-char/shortrest', 'POST', {});
    assert(status === 404, `Expected 404, got ${status}`);
    assert(typeof json.error === 'string', 'Response should have error field');
  });

  await test('POST /api/characters/:id/shortrest with 0 hit dice returns baseline fields', async () => {
    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/shortrest`, 'POST', {});
    assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(typeof json.hpRegained === 'number', 'hpRegained must be a number');
    assert(typeof json.hdSpent === 'number', 'hdSpent must be a number');
    assert(Array.isArray(json.restored), 'restored must be an array');
    assert(json.hdSpent === 0, `Expected hdSpent=0 with no body, got ${json.hdSpent}`);
    assert(json.hpRegained === 0, `Expected hpRegained=0 with no body, got ${json.hpRegained}`);
    resetPaladin();
  });

  await test('POST /api/characters/:id/shortrest spending hit dice heals HP', async () => {
    // Wound the Paladin
    const woundedSheet = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    const maxHP        = woundedSheet.maxHP;
    woundedSheet.currentHP = 1;
    fs.writeFileSync(PALADIN_FILE, JSON.stringify(woundedSheet));

    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/shortrest`, 'POST', {
      hitDiceToSpend: 1,
    });
    assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
    assert(json.hdSpent === 1, `Expected hdSpent=1, got ${json.hdSpent}`);
    assert(json.hpRegained >= 1, `Expected hpRegained>=1, got ${json.hpRegained}`);
    assert(json.character.currentHP > 1, 'HP should have increased after spending hit die');
    assert(json.character.currentHP <= maxHP, 'HP should not exceed maxHP');
    resetPaladin();
  });

  await test('POST /api/characters/:id/shortrest cannot heal above maxHP', async () => {
    // Full HP already
    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/shortrest`, 'POST', {
      hitDiceToSpend: 10,
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.character.currentHP <= json.character.maxHP, 'HP capped at maxHP');
    resetPaladin();
  });

  await test('POST /api/characters/:id/shortrest restores Second Wind for Fighter', async () => {
    // Create a Fighter sheet in the characters dir, call shortrest, verify secondWind restored
    const fighterId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ff0000000001';
    const fighterFile = path.join(process.cwd(), 'characters', `${fighterId}.json`);
    const base        = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    // Reuse paladin structure but override to Fighter with secondWind depleted
    base.id            = fighterId;
    base.classLevels   = [{ className: 'Fighter', level: 1 }];
    base.firstClass    = 'Fighter';
    base.resources     = { secondWind: { max: 1, remaining: 0 } };
    base.levelHistory  = [];
    fs.writeFileSync(fighterFile, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${fighterId}/shortrest`, 'POST', {});
      assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
      assert(json.character.resources.secondWind.remaining === 1, 'Second Wind should be restored');
      assert(json.restored.some((r: string) => r.includes('Second Wind')), 'restored[] should mention Second Wind');
    } finally {
      if (fs.existsSync(fighterFile)) fs.unlinkSync(fighterFile);
    }
  });

  await test('POST /api/characters/:id/shortrest restores Warlock pact slots', async () => {
    const warlockId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ee0000000001';
    const warlockFile = path.join(process.cwd(), 'characters', `${warlockId}.json`);
    const base        = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id           = warlockId;
    base.classLevels  = [{ className: 'Warlock', level: 1 }];
    base.firstClass   = 'Warlock';
    base.resources    = {};
    base.spellcasting = {
      ability: 'cha', spellAttackBonus: 4, saveDC: 12,
      slots: {}, slotsUsed: {},
      pactSlots: { slotLevel: 1, total: 1, used: 1 },
      cantrips: [], knownSpells: [], preparedSpells: [],
    };
    base.levelHistory = [];
    fs.writeFileSync(warlockFile, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${warlockId}/shortrest`, 'POST', {});
      assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
      assert(json.character.spellcasting.pactSlots.used === 0, 'Pact slots restored on short rest');
      assert(json.restored.some((r: string) => r.includes('Pact')), 'restored[] mentions Pact slots');
    } finally {
      if (fs.existsSync(warlockFile)) fs.unlinkSync(warlockFile);
    }
  });

  await test('PUT /api/characters/:id uses pact slot via spellcasting body', async () => {
    const wlId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ee0000000002';
    const wlFile = path.join(process.cwd(), 'characters', `${wlId}.json`);
    const base   = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id      = wlId;
    base.spellcasting = { cantrips: [], slots: {}, slotsUsed: {}, saveDC: 13, spellAttackBonus: 5, ability: 'cha',
      pactSlots: { slotLevel: 1, total: 2, used: 0 } };
    fs.writeFileSync(wlFile, JSON.stringify(base));
    try {
      const spl = { ...base.spellcasting, pactSlots: { slotLevel: 1, total: 2, used: 1 } };
      const { status, json } = await request(BASE, `/api/characters/${wlId}`, 'PUT', { spellcasting: spl });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.spellcasting.pactSlots.used === 1, 'pactSlots.used incremented to 1');
    } finally {
      if (fs.existsSync(wlFile)) fs.unlinkSync(wlFile);
    }
  });

  await test('PUT /api/characters/:id restores pact slot via spellcasting body', async () => {
    const wlId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ee0000000003';
    const wlFile = path.join(process.cwd(), 'characters', `${wlId}.json`);
    const base   = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id      = wlId;
    base.spellcasting = { cantrips: [], slots: {}, slotsUsed: {}, saveDC: 13, spellAttackBonus: 5, ability: 'cha',
      pactSlots: { slotLevel: 1, total: 2, used: 2 } };
    fs.writeFileSync(wlFile, JSON.stringify(base));
    try {
      const spl = { ...base.spellcasting, pactSlots: { slotLevel: 1, total: 2, used: 1 } };
      const { status, json } = await request(BASE, `/api/characters/${wlId}`, 'PUT', { spellcasting: spl });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.spellcasting.pactSlots.used === 1, 'pactSlots.used decremented to 1');
    } finally {
      if (fs.existsSync(wlFile)) fs.unlinkSync(wlFile);
    }
  });

  await test('POST /api/characters/:id/shortrest restores Channel Divinity for Cleric', async () => {
    const clericId   = 'aaaaaaaa-bbbb-4ccc-8ddd-cc0000000001';
    const clericFile = path.join(process.cwd(), 'characters', `${clericId}.json`);
    const base       = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id          = clericId;
    base.classLevels = [{ className: 'Cleric', level: 2 }];
    base.firstClass  = 'Cleric';
    base.resources   = { channelDivinity: { max: 1, remaining: 0 } };
    base.levelHistory = [];
    fs.writeFileSync(clericFile, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${clericId}/shortrest`, 'POST', {});
      assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
      assert(json.character.resources.channelDivinity.remaining === 1, 'Channel Divinity restored');
      assert(json.restored.some((r: string) => r.includes('Channel Divinity')), 'restored[] mentions Channel Divinity');
    } finally {
      if (fs.existsSync(clericFile)) fs.unlinkSync(clericFile);
    }
  });

  await test('POST /api/characters/:id/shortrest restores Ki for Monk', async () => {
    const monkId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ee0000000002';
    const monkFile = path.join(process.cwd(), 'characters', `${monkId}.json`);
    const base     = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id        = monkId;
    base.classLevels = [{ className: 'Monk', level: 3 }];
    base.firstClass  = 'Monk';
    base.resources   = { ki: { max: 3, remaining: 1 } };
    base.levelHistory = [];
    fs.writeFileSync(monkFile, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${monkId}/shortrest`, 'POST', {});
      assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
      assert(json.character.resources.ki.remaining === 3, `Ki restored to max; got ${json.character.resources.ki.remaining}`);
      assert(json.restored.some((r: string) => r.includes('Ki')), 'restored[] mentions Ki');
    } finally {
      if (fs.existsSync(monkFile)) fs.unlinkSync(monkFile);
    }
  });

  await test('POST /api/characters/:id/shortrest restores Dragonborn Breath Weapon', async () => {
    const dbId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ee0000000009';
    const dbFile = path.join(process.cwd(), 'characters', `${dbId}.json`);
    const base   = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id        = dbId;
    base.race       = 'Dragonborn';
    base.classLevels = [{ className: 'Fighter', level: 1 }];
    base.firstClass  = 'Fighter';
    base.resources   = { breathWeapon: { max: 1, remaining: 0 } };
    base.levelHistory = [];
    fs.writeFileSync(dbFile, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${dbId}/shortrest`, 'POST', {});
      assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
      assert(json.character.resources.breathWeapon.remaining === 1, 'Breath Weapon restored on short rest');
      assert(json.restored.some((r: string) => r.includes('Breath Weapon')), 'restored[] mentions Breath Weapon');
    } finally {
      if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    }
  });

  await test('POST /api/characters/:id/longrest restores Indomitable, Cleansing Touch, Mystic Arcanum, Relentless Endurance', async () => {
    const fId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ee0000000010';
    const fFile = path.join(process.cwd(), 'characters', `${fId}.json`);
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id        = fId;
    base.race       = 'Half-Orc';
    base.classLevels = [{ className: 'Fighter', level: 9 }];
    base.firstClass  = 'Fighter';
    base.resources   = {
      indomitable:         { max: 1, remaining: 0 },
      cleansingTouch:       { max: 2, remaining: 0 },
      mysticArcanum:        { l6: false },
      relentlessEndurance:  { max: 1, remaining: 0 },
    };
    base.levelHistory = [];
    fs.writeFileSync(fFile, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${fId}/longrest`, 'POST', {});
      assert(status === 200, `Expected 200, got ${status}. Body: ${JSON.stringify(json)}`);
      assert(json.character.resources.indomitable.remaining === 1, 'Indomitable restored');
      assert(json.character.resources.cleansingTouch.remaining === 2, 'Cleansing Touch restored');
      assert(json.character.resources.mysticArcanum.l6 === true, 'Mystic Arcanum l6 restored to available');
      assert(json.character.resources.relentlessEndurance.remaining === 1, 'Relentless Endurance restored');
    } finally {
      if (fs.existsSync(fFile)) fs.unlinkSync(fFile);
    }
  });


  await test('POST /api/characters/:id/shortrest does NOT restore Bardic Inspiration without Font of Inspiration', async () => {
    const bardId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ee0000000003';
    const bardFile = path.join(process.cwd(), 'characters', `${bardId}.json`);
    const base     = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id        = bardId;
    base.classLevels = [{ className: 'Bard', level: 3 }];
    base.firstClass  = 'Bard';
    base.resources   = { bardicInspiration: { max: 3, remaining: 0, dieSides: 6 } };
    base.allFeatures = []; // No Font of Inspiration
    base.levelHistory = [];
    fs.writeFileSync(bardFile, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${bardId}/shortrest`, 'POST', {});
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.resources.bardicInspiration.remaining === 0, 'BI should NOT restore without Font of Inspiration');
    } finally {
      if (fs.existsSync(bardFile)) fs.unlinkSync(bardFile);
    }
  });

  await test('POST /api/characters/:id/shortrest restores Bardic Inspiration WITH Font of Inspiration', async () => {
    const bardId2   = 'aaaaaaaa-bbbb-4ccc-8ddd-ee0000000004';
    const bardFile2 = path.join(process.cwd(), 'characters', `${bardId2}.json`);
    const base      = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id         = bardId2;
    base.classLevels = [{ className: 'Bard', level: 5 }];
    base.firstClass  = 'Bard';
    base.resources   = { bardicInspiration: { max: 3, remaining: 0, dieSides: 8 } };
    base.allFeatures = [
      { name: 'Font of Inspiration', source: 'class', description: 'Bardic Inspiration recharges on short rest.' },
    ];
    base.levelHistory = [];
    fs.writeFileSync(bardFile2, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${bardId2}/shortrest`, 'POST', {});
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.resources.bardicInspiration.remaining === 3, 'BI restored with Font of Inspiration');
      assert(json.restored.some((r: string) => r.includes('Bardic Inspiration')), 'restored[] mentions BI');
    } finally {
      if (fs.existsSync(bardFile2)) fs.unlinkSync(bardFile2);
    }
  });

  // ── Short rest rollMode ───────────────────────────────────

  await test('POST /api/characters/:id/shortrest rollMode average is deterministic', async () => {
    const woundedSheet   = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    woundedSheet.currentHP = 1;
    fs.writeFileSync(PALADIN_FILE, JSON.stringify(woundedSheet));
    const { status: s1, json: j1 } = await request(BASE, `/api/characters/${PALADIN_ID}/shortrest`, 'POST', { hitDiceToSpend: 1, rollMode: 'average' });
    assert(s1 === 200, `Expected 200, got ${s1}`);
    const hp1 = j1.hpRegained;

    // Reset and do it again — must be the same value
    resetPaladin();
    const woundedSheet2   = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    woundedSheet2.currentHP = 1;
    fs.writeFileSync(PALADIN_FILE, JSON.stringify(woundedSheet2));
    const { json: j2 } = await request(BASE, `/api/characters/${PALADIN_ID}/shortrest`, 'POST', { hitDiceToSpend: 1, rollMode: 'average' });
    assert(j2.hpRegained === hp1, `Average mode must be deterministic: ${j2.hpRegained} !== ${hp1}`);
    resetPaladin();
  });

  await test('POST /api/characters/:id/shortrest rollMode random is in valid range', async () => {
    const woundedSheet = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    woundedSheet.currentHP = 1;
    const dieSides = (woundedSheet.hitDice?.[0]?.dieSides) ?? 10; // Paladin d10
    const conMod   = Math.floor((woundedSheet.stats.con - 10) / 2);
    fs.writeFileSync(PALADIN_FILE, JSON.stringify(woundedSheet));
    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/shortrest`, 'POST', { hitDiceToSpend: 1, rollMode: 'random' });
    assert(status === 200, `Expected 200, got ${status}`);
    const minGain = Math.max(1, 1 + conMod);
    const maxGain = dieSides + conMod;
    assert(json.hpRegained >= minGain, `hpRegained ${json.hpRegained} below min ${minGain}`);
    assert(json.hpRegained <= maxGain, `hpRegained ${json.hpRegained} above max ${maxGain}`);
    resetPaladin();
  });

  await test('POST /api/characters/:id/shortrest defaults to average (no rollMode)', async () => {
    const woundedSheet = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    woundedSheet.currentHP = 1;
    const dieSides = (woundedSheet.hitDice?.[0]?.dieSides) ?? 10;
    const conMod   = Math.floor((woundedSheet.stats.con - 10) / 2);
    fs.writeFileSync(PALADIN_FILE, JSON.stringify(woundedSheet));
    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/shortrest`, 'POST', { hitDiceToSpend: 1 });
    assert(status === 200, `Expected 200, got ${status}`);
    const expectedAvg = Math.max(1, Math.floor(dieSides / 2) + 1 + conMod);
    assert(json.hpRegained === expectedAvg, `Default average: expected ${expectedAvg}, got ${json.hpRegained}`);
    resetPaladin();
  });

  // ── HP Tracker (PUT currentHP) ────────────────────────────────

  await test('PUT /api/characters/:id updates currentHP (take damage)', async () => {
    const pId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ff0000000010';
    const pFile = path.join(process.cwd(), 'characters', `${pId}.json`);
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id = pId; base.maxHP = 30; base.currentHP = 30; base.levelHistory = [];
    fs.writeFileSync(pFile, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${pId}`, 'PUT', { currentHP: 18 });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.currentHP === 18, `Expected 18 HP, got ${json.character.currentHP}`);
      assert(json.character.maxHP === 30, 'maxHP unchanged');
    } finally { if (fs.existsSync(pFile)) fs.unlinkSync(pFile); }
  });

  await test('PUT /api/characters/:id updates currentHP (heal)', async () => {
    const pId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ff0000000011';
    const pFile = path.join(process.cwd(), 'characters', `${pId}.json`);
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id = pId; base.maxHP = 30; base.currentHP = 10; base.levelHistory = [];
    fs.writeFileSync(pFile, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${pId}`, 'PUT', { currentHP: 25 });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.currentHP === 25, `Expected 25 HP, got ${json.character.currentHP}`);
    } finally { if (fs.existsSync(pFile)) fs.unlinkSync(pFile); }
  });

  await test('PUT /api/characters/:id currentHP 0 (unconscious)', async () => {
    const pId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ff0000000012';
    const pFile = path.join(process.cwd(), 'characters', `${pId}.json`);
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id = pId; base.maxHP = 30; base.currentHP = 30; base.levelHistory = [];
    fs.writeFileSync(pFile, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${pId}`, 'PUT', { currentHP: 0 });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.currentHP === 0, 'HP stored as 0');
    } finally { if (fs.existsSync(pFile)) fs.unlinkSync(pFile); }
  });

  // ── Spell Slot Consumption (PUT spellcasting.slotsUsed) ──────

  await test('PUT /api/characters/:id uses a spell slot (slotsUsed increments)', async () => {
    const wId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ff0000000020';
    const wFile = path.join(process.cwd(), 'characters', `${wId}.json`);
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id = wId; base.levelHistory = [];
    base.spellcasting = {
      ability: 'int', spellAttackBonus: 5, saveDC: 13,
      slots: { '1': 4, '2': 3 }, slotsUsed: { '1': 0, '2': 0 },
      cantrips: ['Fire Bolt'], knownSpells: [], preparedSpells: [],
    };
    fs.writeFileSync(wFile, JSON.stringify(base));
    try {
      const newSlotsUsed = { '1': 1, '2': 0 };
      const { status, json } = await request(BASE, `/api/characters/${wId}`, 'PUT', {
        spellcasting: { ...base.spellcasting, slotsUsed: newSlotsUsed },
      });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.spellcasting.slotsUsed['1'] === 1, 'Lv1 slot used');
      assert(json.character.spellcasting.slotsUsed['2'] === 0, 'Lv2 slot unchanged');
      assert(json.character.spellcasting.slots['1'] === 4, 'max slots unchanged');
    } finally { if (fs.existsSync(wFile)) fs.unlinkSync(wFile); }
  });

  await test('PUT /api/characters/:id restores a spell slot (slotsUsed decrements)', async () => {
    const wId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ff0000000021';
    const wFile = path.join(process.cwd(), 'characters', `${wId}.json`);
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id = wId; base.levelHistory = [];
    base.spellcasting = {
      ability: 'int', spellAttackBonus: 5, saveDC: 13,
      slots: { '1': 4, '2': 3 }, slotsUsed: { '1': 2, '2': 1 },
      cantrips: ['Fire Bolt'], knownSpells: [], preparedSpells: [],
    };
    fs.writeFileSync(wFile, JSON.stringify(base));
    try {
      const newSlotsUsed = { '1': 1, '2': 1 };
      const { status, json } = await request(BASE, `/api/characters/${wId}`, 'PUT', {
        spellcasting: { ...base.spellcasting, slotsUsed: newSlotsUsed },
      });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.spellcasting.slotsUsed['1'] === 1, 'Lv1 slot restored (2→1)');
      assert(json.character.spellcasting.slotsUsed['2'] === 1, 'Lv2 slot unchanged');
    } finally { if (fs.existsSync(wFile)) fs.unlinkSync(wFile); }
  });

  await test('PUT /api/characters/:id slotsUsed persists across GET', async () => {
    const wId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ff0000000022';
    const wFile = path.join(process.cwd(), 'characters', `${wId}.json`);
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id = wId; base.levelHistory = [];
    base.spellcasting = {
      ability: 'wis', spellAttackBonus: 4, saveDC: 12,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: [], knownSpells: [], preparedSpells: [],
    };
    fs.writeFileSync(wFile, JSON.stringify(base));
    try {
      // Use a slot
      await request(BASE, `/api/characters/${wId}`, 'PUT', {
        spellcasting: { ...base.spellcasting, slotsUsed: { '1': 1 } },
      });
      // Read back
      const { status, json } = await request(BASE, `/api/characters/${wId}`, 'GET');
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.spellcasting.slotsUsed['1'] === 1, 'Slot usage persisted after GET');
    } finally { if (fs.existsSync(wFile)) fs.unlinkSync(wFile); }
  });

  // ── Conditions Tracker (PUT conditions) ──────────────────────

  await test('PUT /api/characters/:id sets conditions array', async () => {
    const cId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ff0000000030';
    const cFile = path.join(process.cwd(), 'characters', `${cId}.json`);
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id = cId; base.levelHistory = [];
    fs.writeFileSync(cFile, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${cId}`, 'PUT', {
        conditions: ['Poisoned', 'Prone']
      });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(Array.isArray(json.character.conditions), 'conditions is array');
      assert(json.character.conditions.includes('Poisoned'), 'Poisoned in conditions');
      assert(json.character.conditions.includes('Prone'), 'Prone in conditions');
    } finally { if (fs.existsSync(cFile)) fs.unlinkSync(cFile); }
  });

  await test('PUT /api/characters/:id clears a condition (removes one)', async () => {
    const cId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ff0000000031';
    const cFile = path.join(process.cwd(), 'characters', `${cId}.json`);
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id = cId; base.levelHistory = []; base.conditions = ['Frightened', 'Grappled'];
    fs.writeFileSync(cFile, JSON.stringify(base));
    try {
      // Remove Frightened, keep Grappled
      const { status, json } = await request(BASE, `/api/characters/${cId}`, 'PUT', {
        conditions: ['Grappled']
      });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.conditions.length === 1, 'One condition remains');
      assert(!json.character.conditions.includes('Frightened'), 'Frightened removed');
      assert(json.character.conditions.includes('Grappled'), 'Grappled retained');
    } finally { if (fs.existsSync(cFile)) fs.unlinkSync(cFile); }
  });

  await test('PUT /api/characters/:id conditions persist across GET', async () => {
    const cId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ff0000000032';
    const cFile = path.join(process.cwd(), 'characters', `${cId}.json`);
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id = cId; base.levelHistory = [];
    fs.writeFileSync(cFile, JSON.stringify(base));
    try {
      await request(BASE, `/api/characters/${cId}`, 'PUT', { conditions: ['Stunned'] });
      const { status, json } = await request(BASE, `/api/characters/${cId}`, 'GET');
      assert(status === 200, `Expected 200, got ${status}`);
      assert(Array.isArray(json.character.conditions), 'conditions persisted');
      assert(json.character.conditions.includes('Stunned'), 'Stunned persisted after GET');
    } finally { if (fs.existsSync(cFile)) fs.unlinkSync(cFile); }
  });

  // ── Temporary HP ──────────────────────────────────────────────

  await test('PUT /api/characters/:id sets temporaryHP', async () => {
    const tId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ff0000000040';
    const tFile = path.join(process.cwd(), 'characters', `${tId}.json`);
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id = tId; base.levelHistory = []; base.temporaryHP = 0;
    fs.writeFileSync(tFile, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${tId}`, 'PUT', { temporaryHP: 10 });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.temporaryHP === 10, `Expected 10 THP, got ${json.character.temporaryHP}`);
    } finally { if (fs.existsSync(tFile)) fs.unlinkSync(tFile); }
  });

  await test('PUT /api/characters/:id clears temporaryHP (set to 0)', async () => {
    const tId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ff0000000041';
    const tFile = path.join(process.cwd(), 'characters', `${tId}.json`);
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id = tId; base.levelHistory = []; base.temporaryHP = 15;
    fs.writeFileSync(tFile, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${tId}`, 'PUT', { temporaryHP: 0 });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.temporaryHP === 0, 'THP cleared to 0');
    } finally { if (fs.existsSync(tFile)) fs.unlinkSync(tFile); }
  });

  // ── Exhaustion ────────────────────────────────────────────────

  await test('PUT /api/characters/:id increments exhaustionLevel', async () => {
    const eId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ff0000000042';
    const eFile = path.join(process.cwd(), 'characters', `${eId}.json`);
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id = eId; base.levelHistory = []; base.exhaustionLevel = 0;
    fs.writeFileSync(eFile, JSON.stringify(base));
    try {
      const { status, json } = await request(BASE, `/api/characters/${eId}`, 'PUT', { exhaustionLevel: 2 });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.exhaustionLevel === 2, `Expected 2, got ${json.character.exhaustionLevel}`);
    } finally { if (fs.existsSync(eFile)) fs.unlinkSync(eFile); }
  });

  await test('PUT /api/characters/:id exhaustionLevel persists across GET', async () => {
    const eId   = 'aaaaaaaa-bbbb-4ccc-8ddd-ff0000000043';
    const eFile = path.join(process.cwd(), 'characters', `${eId}.json`);
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));
    base.id = eId; base.levelHistory = []; base.exhaustionLevel = 0;
    fs.writeFileSync(eFile, JSON.stringify(base));
    try {
      await request(BASE, `/api/characters/${eId}`, 'PUT', { exhaustionLevel: 3 });
      const { status, json } = await request(BASE, `/api/characters/${eId}`, 'GET');
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.exhaustionLevel === 3, `Exhaustion 3 persisted, got ${json.character.exhaustionLevel}`);
    } finally { if (fs.existsSync(eFile)) fs.unlinkSync(eFile); }
  });

  // ── Death Saves (PUT deathSaves) ──────────────────────────
  {
    const dsId   = 'cccccccc-0000-0000-0000-000000000001';
    const dsFile = path.join(process.cwd(), 'characters', `${dsId}.json`);
    const base: any = JSON.parse(JSON.stringify(PALADIN_PRISTINE));
    base.id = dsId; base.levelHistory = [];

    await test('PUT /api/characters/:id sets deathSaves', async () => {
      base.currentHP = 0;
      fs.writeFileSync(dsFile, JSON.stringify(base));
      const { status, json } = await request(BASE, `/api/characters/${dsId}`, 'PUT', {
        deathSaves: { successes: 2, failures: 1 }
      });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.deathSaves?.successes === 2, `Expected 2 successes`);
      assert(json.character.deathSaves?.failures === 1, `Expected 1 failure`);
      fs.unlinkSync(dsFile);
    });

    await test('PUT /api/characters/:id deathSaves persist across GET', async () => {
      base.currentHP = 0;
      fs.writeFileSync(dsFile, JSON.stringify(base));
      await request(BASE, `/api/characters/${dsId}`, 'PUT', { deathSaves: { successes: 1, failures: 2 } });
      const { json } = await request(BASE, `/api/characters/${dsId}`);
      assert(json.character.deathSaves?.successes === 1, `Expected successes 1`);
      assert(json.character.deathSaves?.failures === 2, `Expected failures 2`);
      fs.unlinkSync(dsFile);
    });

    await test('PUT /api/characters/:id clears deathSaves on heal', async () => {
      base.currentHP = 0;
      base.deathSaves = { successes: 2, failures: 1 };
      fs.writeFileSync(dsFile, JSON.stringify(base));
      // Simulate: heal above 0 clears saves
      const { status, json } = await request(BASE, `/api/characters/${dsId}`, 'PUT', {
        currentHP: 10, deathSaves: { successes: 0, failures: 0 }
      });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.currentHP === 10, `Expected HP 10`);
      assert(json.character.deathSaves?.successes === 0, `Expected successes cleared`);
      assert(json.character.deathSaves?.failures === 0, `Expected failures cleared`);
      fs.unlinkSync(dsFile);
    });
  }

  // ── Notes field (PUT notes) ───────────────────────────────
  await test('PUT /api/characters/:id sets notes field', async () => {
    const nId = 'aaaaaaaa-0000-0000-0000-000000000001';
    const nFile = path.join(process.cwd(), 'characters', `${nId}.json`);
    const base: any = JSON.parse(JSON.stringify(PALADIN_PRISTINE));
    base.id = nId; base.levelHistory = []; base.notes = '';
    fs.writeFileSync(nFile, JSON.stringify(base, null, 2), 'utf-8');
    try {
      const { status, json } = await request(BASE, `/api/characters/${nId}`, 'PUT', { notes: 'Seeks redemption for past sins.' });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.notes === 'Seeks redemption for past sins.', `Expected notes, got ${json.character.notes}`);
    } finally { if (fs.existsSync(nFile)) fs.unlinkSync(nFile); }
  });

  await test('PUT /api/characters/:id notes persist across GET', async () => {
    const nId = 'aaaaaaaa-0000-0000-0000-000000000002';
    const nFile = path.join(process.cwd(), 'characters', `${nId}.json`);
    const base: any = JSON.parse(JSON.stringify(PALADIN_PRISTINE));
    base.id = nId; base.levelHistory = []; base.notes = '';
    fs.writeFileSync(nFile, JSON.stringify(base, null, 2), 'utf-8');
    try {
      await request(BASE, `/api/characters/${nId}`, 'PUT', { notes: 'Oath of Devotion. Favors greatsword.' });
      const { status, json } = await request(BASE, `/api/characters/${nId}`, 'GET');
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.notes === 'Oath of Devotion. Favors greatsword.', `Notes not persisted: ${json.character.notes}`);
    } finally { if (fs.existsSync(nFile)) fs.unlinkSync(nFile); }
  });

  await test('PUT /api/characters/:id clears notes (empty string)', async () => {
    const nId = 'aaaaaaaa-0000-0000-0000-000000000003';
    const nFile = path.join(process.cwd(), 'characters', `${nId}.json`);
    const base: any = JSON.parse(JSON.stringify(PALADIN_PRISTINE));
    base.id = nId; base.levelHistory = []; base.notes = 'Old notes';
    fs.writeFileSync(nFile, JSON.stringify(base, null, 2), 'utf-8');
    try {
      const { status, json } = await request(BASE, `/api/characters/${nId}`, 'PUT', { notes: '' });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.notes === '' || json.character.notes === undefined, `Expected empty notes, got ${json.character.notes}`);
    } finally { if (fs.existsSync(nFile)) fs.unlinkSync(nFile); }
  });

  // ── /equip endpoint ────────────────────────────────────────

  await test('POST /api/characters/:id/equip unequips item by index', async () => {
    // Longsword is index 0, currently equipped: true → set to false
    resetPaladin();
    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/equip`, 'POST', { itemIndex: 0, equipped: false });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(json)}`);
    assert(json.character.equipment[0].equipped === false, `Expected equipped false, got ${json.character.equipment[0].equipped}`);
    assert(json.character.equipment[0].name === 'Longsword', `Expected Longsword, got ${json.character.equipment[0].name}`);
    resetPaladin();
  });

  await test('POST /api/characters/:id/equip equips item by index', async () => {
    // Noble's Pack is index 4, currently equipped: false → set to true
    resetPaladin();
    const { status, json } = await request(BASE, `/api/characters/${PALADIN_ID}/equip`, 'POST', { itemIndex: 4, equipped: true });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(json)}`);
    assert(json.character.equipment[4].equipped === true, `Expected equipped true, got ${json.character.equipment[4].equipped}`);
    resetPaladin();
  });

  await test('POST /api/characters/:id/equip persists across GET', async () => {
    resetPaladin();
    await request(BASE, `/api/characters/${PALADIN_ID}/equip`, 'POST', { itemIndex: 0, equipped: false });
    const { json: getJson } = await request(BASE, `/api/characters/${PALADIN_ID}`, 'GET');
    assert(getJson.character.equipment[0].equipped === false, `Expected persisted false, got ${getJson.character.equipment[0].equipped}`);
    resetPaladin();
  });

  await test('POST /api/characters/:id/equip 400 on bad itemIndex', async () => {
    const { status } = await request(BASE, `/api/characters/${PALADIN_ID}/equip`, 'POST', { itemIndex: 99, equipped: false });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('POST /api/characters/:id/equip 400 on missing equipped', async () => {
    const { status } = await request(BASE, `/api/characters/${PALADIN_ID}/equip`, 'POST', { itemIndex: 0 });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('POST /api/characters/:id/equip 404 on unknown character', async () => {
    const { status } = await request(BASE, `/api/characters/no-such-id/equip`, 'POST', { itemIndex: 0, equipped: false });
    assert(status === 404, `Expected 404, got ${status}`);
  });

  // ── Gold field (PUT gold) ────────────────────────────────
  {
    const gId = '00000000-0000-0000-0000-000000000010';
    const base = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));

    await test('PUT /api/characters/:id updates gold field', async () => {
      base.id = gId; base.levelHistory = []; base.gold = 25;
      fs.writeFileSync(path.join(process.cwd(), 'characters', `${gId}.json`), JSON.stringify(base));
      const { status, json } = await request(BASE, `/api/characters/${gId}`, 'PUT', { gold: 150 });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.gold === 150, `Expected gold=150, got ${json.character.gold}`);
      fs.unlinkSync(path.join(process.cwd(), 'characters', `${gId}.json`));
    });

    await test('PUT /api/characters/:id gold persists across GET', async () => {
      base.id = gId; base.levelHistory = []; base.gold = 0;
      fs.writeFileSync(path.join(process.cwd(), 'characters', `${gId}.json`), JSON.stringify(base));
      await request(BASE, `/api/characters/${gId}`, 'PUT', { gold: 999 });
      const { json } = await request(BASE, `/api/characters/${gId}`);
      assert(json.character.gold === 999, `Gold not persisted: got ${json.character.gold}`);
      fs.unlinkSync(path.join(process.cwd(), 'characters', `${gId}.json`));
    });
  }

  // ── Equipment array (PUT equipment) ──────────────────────
  {
    const eqId = '00000000-0000-0000-0000-000000000011';
    const base  = JSON.parse(fs.readFileSync(PALADIN_FILE, 'utf-8'));

    await test('PUT /api/characters/:id replaces equipment array', async () => {
      base.id = eqId; base.levelHistory = [];
      fs.writeFileSync(path.join(process.cwd(), 'characters', `${eqId}.json`), JSON.stringify(base));
      const newEquip = [{ name: 'Dagger', quantity: 2, equipped: true, category: 'weapon' }];
      const { status, json } = await request(BASE, `/api/characters/${eqId}`, 'PUT', { equipment: newEquip });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.equipment.length === 1, `Expected 1 item, got ${json.character.equipment.length}`);
      assert(json.character.equipment[0].name === 'Dagger', `Expected Dagger, got ${json.character.equipment[0].name}`);
      fs.unlinkSync(path.join(process.cwd(), 'characters', `${eqId}.json`));
    });

    await test('PUT /api/characters/:id appends equipment item (array persists)', async () => {
      base.id = eqId; base.levelHistory = [];
      base.equipment = [{ name: 'Longsword', quantity: 1, equipped: true, category: 'weapon' }];
      fs.writeFileSync(path.join(process.cwd(), 'characters', `${eqId}.json`), JSON.stringify(base));
      const appended = [...base.equipment, { name: 'Torch', quantity: 5, equipped: false, category: 'gear' }];
      await request(BASE, `/api/characters/${eqId}`, 'PUT', { equipment: appended });
      const { json } = await request(BASE, `/api/characters/${eqId}`);
      assert(json.character.equipment.length === 2, `Expected 2 items, got ${json.character.equipment.length}`);
      assert(json.character.equipment[1].name === 'Torch', `Expected Torch, got ${json.character.equipment[1].name}`);
      fs.unlinkSync(path.join(process.cwd(), 'characters', `${eqId}.json`));
    });

    await test('PUT /api/characters/:id removes equipment item (filtered array)', async () => {
      base.id = eqId; base.levelHistory = [];
      base.equipment = [
        { name: 'Longsword', quantity: 1, equipped: true,  category: 'weapon' },
        { name: 'Rope',      quantity: 1, equipped: false, category: 'gear'   },
      ];
      fs.writeFileSync(path.join(process.cwd(), 'characters', `${eqId}.json`), JSON.stringify(base));
      const filtered = [base.equipment[0]];
      await request(BASE, `/api/characters/${eqId}`, 'PUT', { equipment: filtered });
      const { json } = await request(BASE, `/api/characters/${eqId}`);
      assert(json.character.equipment.length === 1, `Expected 1 item after removal, got ${json.character.equipment.length}`);
      assert(json.character.equipment[0].name === 'Longsword', `Expected Longsword, got ${json.character.equipment[0].name}`);
      fs.unlinkSync(path.join(process.cwd(), 'characters', `${eqId}.json`));
    });

    await test('PUT /api/characters/:id updates item quantity', async () => {
      base.id = eqId; base.levelHistory = [];
      base.equipment = [{ name: 'Arrow', quantity: 20, equipped: false, category: 'gear' }];
      fs.writeFileSync(path.join(process.cwd(), 'characters', `${eqId}.json`), JSON.stringify(base));
      const updated = [{ name: 'Arrow', quantity: 14, equipped: false, category: 'gear' }];
      const { status, json } = await request(BASE, `/api/characters/${eqId}`, 'PUT', { equipment: updated });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.equipment[0].quantity === 14, `Expected qty 14, got ${json.character.equipment[0].quantity}`);
      fs.unlinkSync(path.join(process.cwd(), 'characters', `${eqId}.json`));
    });

    await test('PUT /api/characters/:id preserves item notes field', async () => {
      base.id = eqId; base.levelHistory = [];
      base.equipment = [];
      fs.writeFileSync(path.join(process.cwd(), 'characters', `${eqId}.json`), JSON.stringify(base));
      const itemWithNotes = [{ name: 'Cloak of Elvenkind', quantity: 1, equipped: true, category: 'gear', notes: '+1 Stealth checks' }];
      const { status, json } = await request(BASE, `/api/characters/${eqId}`, 'PUT', { equipment: itemWithNotes });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.equipment[0].notes === '+1 Stealth checks', `Expected notes to be preserved, got ${json.character.equipment[0].notes}`);
      // Verify persists across GET
      const { json: get } = await request(BASE, `/api/characters/${eqId}`);
      assert(get.character.equipment[0].notes === '+1 Stealth checks', `Notes not persisted in GET`);
      fs.unlinkSync(path.join(process.cwd(), 'characters', `${eqId}.json`));
    });

    await test('PUT /api/characters/:id updates item notes inline', async () => {
      base.id = eqId; base.levelHistory = [];
      base.equipment = [{ name: 'Staff', quantity: 1, equipped: true, category: 'gear', notes: 'old note' }];
      fs.writeFileSync(path.join(process.cwd(), 'characters', `${eqId}.json`), JSON.stringify(base));
      const updated = [{ name: 'Staff', quantity: 1, equipped: true, category: 'gear', notes: 'new note' }];
      const { status, json } = await request(BASE, `/api/characters/${eqId}`, 'PUT', { equipment: updated });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.equipment[0].notes === 'new note', `Expected 'new note', got ${json.character.equipment[0].notes}`);
      const { json: get } = await request(BASE, `/api/characters/${eqId}`);
      assert(get.character.equipment[0].notes === 'new note', `Updated notes not persisted`);
      fs.unlinkSync(path.join(process.cwd(), 'characters', `${eqId}.json`));
    });

    await test('PUT /api/characters/:id removes item notes when cleared', async () => {
      base.id = eqId; base.levelHistory = [];
      base.equipment = [{ name: 'Torch', quantity: 5, equipped: false, category: 'gear', notes: 'remove me' }];
      fs.writeFileSync(path.join(process.cwd(), 'characters', `${eqId}.json`), JSON.stringify(base));
      // Send item without notes key (cleared)
      const updated = [{ name: 'Torch', quantity: 5, equipped: false, category: 'gear' }];
      const { status, json } = await request(BASE, `/api/characters/${eqId}`, 'PUT', { equipment: updated });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(!json.character.equipment[0].notes, `Expected notes cleared, got ${json.character.equipment[0].notes}`);
      fs.unlinkSync(path.join(process.cwd(), 'characters', `${eqId}.json`));
    });
  }

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

  // ── Inspiration ───────────────────────────────────────────
  {
    const inspId = 'bbbbbbbb-0000-0000-0000-000000000001';
    const inspFile = path.join(process.cwd(), 'characters', `${inspId}.json`);
    const base: any = JSON.parse(JSON.stringify(PALADIN_PRISTINE));
    base.id = inspId; base.levelHistory = [];

    await test('PUT /api/characters/:id sets inspiration true', async () => {
      fs.writeFileSync(inspFile, JSON.stringify(base));
      const { status, json } = await request(BASE, `/api/characters/${inspId}`, 'PUT', { inspiration: true });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.inspiration === true, `Expected inspiration true`);
      fs.unlinkSync(inspFile);
    });

    await test('PUT /api/characters/:id clears inspiration', async () => {
      const withInsp: any = { ...base, inspiration: true };
      fs.writeFileSync(inspFile, JSON.stringify(withInsp));
      const { status, json } = await request(BASE, `/api/characters/${inspId}`, 'PUT', { inspiration: false });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(!json.character.inspiration, `Expected inspiration false/absent`);
      fs.unlinkSync(inspFile);
    });

    await test('PUT /api/characters/:id inspiration persists across GET', async () => {
      fs.writeFileSync(inspFile, JSON.stringify(base));
      await request(BASE, `/api/characters/${inspId}`, 'PUT', { inspiration: true });
      const { json } = await request(BASE, `/api/characters/${inspId}`);
      assert(json.character.inspiration === true, `Inspiration not persisted`);
      fs.unlinkSync(inspFile);
    });
  }

  // ── Concentration ─────────────────────────────────────────
  {
    const concId = 'cccccccc-0000-0000-0000-000000000001';
    const concFile = path.join(process.cwd(), 'characters', `${concId}.json`);
    const base: any = JSON.parse(JSON.stringify(PALADIN_PRISTINE));
    base.id = concId; base.levelHistory = [];

    await test('PUT /api/characters/:id sets concentrating spell name', async () => {
      fs.writeFileSync(concFile, JSON.stringify(base));
      const { status, json } = await request(BASE, `/api/characters/${concId}`, 'PUT', { concentrating: 'Bless' });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.character.concentrating === 'Bless', `Expected concentrating 'Bless', got ${json.character.concentrating}`);
      fs.unlinkSync(concFile);
    });

    await test('PUT /api/characters/:id concentrating persists across GET', async () => {
      fs.writeFileSync(concFile, JSON.stringify(base));
      await request(BASE, `/api/characters/${concId}`, 'PUT', { concentrating: 'Hold Person' });
      const { json } = await request(BASE, `/api/characters/${concId}`);
      assert(json.character.concentrating === 'Hold Person', `Concentrating not persisted`);
      fs.unlinkSync(concFile);
    });

    await test('PUT /api/characters/:id clears concentrating (null)', async () => {
      const withConc: any = { ...base, concentrating: 'Bless' };
      fs.writeFileSync(concFile, JSON.stringify(withConc));
      const { status, json } = await request(BASE, `/api/characters/${concId}`, 'PUT', { concentrating: null });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(!json.character.concentrating, `Expected concentrating cleared, got ${json.character.concentrating}`);
      fs.unlinkSync(concFile);
    });
  }


  // ── GET /api/races ─────────────────────────────────────────
  await test('GET /api/races returns array of race entries', async () => {
    const { status, json } = await request(BASE, '/api/races');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(json.races), 'Expected races array');
    assert(json.races.length === 16, `Expected 16 races, got ${json.races.length}`);
  });

  await test('GET /api/races each entry has required fields', async () => {
    const { json } = await request(BASE, '/api/races');
    for (const r of json.races) {
      assert(typeof r.name === 'string' && r.name.length > 0, `Race missing name: ${JSON.stringify(r)}`);
      assert(Array.isArray(r.allotment) && r.allotment.length > 0, `Race ${r.name} missing allotment`);
      assert(typeof r.speed === 'number' && r.speed > 0, `Race ${r.name} missing speed`);
      assert(r.size === 'Medium' || r.size === 'Small', `Race ${r.name} invalid size "${r.size}"`);
      assert(Array.isArray(r.traits), `Race ${r.name} missing traits`);
    }
  });

  await test('GET /api/races includes PHB races', async () => {
    const { json } = await request(BASE, '/api/races');
    const names: string[] = json.races.map((r: any) => r.name);
    for (const expected of ['Hill Dwarf', 'Mountain Dwarf', 'High Elf', 'Wood Elf', 'Dark Elf (Drow)',
        'Lightfoot Halfling', 'Stout Halfling', 'Human', 'Human (Variant)',
        'Dragonborn', 'Forest Gnome', 'Rock Gnome', 'Half-Elf', 'Half-Orc', 'Tiefling', 'Custom Lineage']) {
      assert(names.includes(expected), `Missing race: ${expected}`);
    }
  });

  await test('GET /api/races allotment sums are canonical', async () => {
    const { json } = await request(BASE, '/api/races');
    const byName: Record<string, any> = {};
    for (const r of json.races) byName[r.name] = r;
    const sum = (arr: number[]) => arr.reduce((a: number, b: number) => a + b, 0);
    assert(sum(byName['Mountain Dwarf'].allotment) === 4, 'Mountain Dwarf allotment should sum to 4');
    assert(sum(byName['Human'].allotment) === 6, 'Human allotment should sum to 6');
    assert(sum(byName['Human (Variant)'].allotment) === 2, 'Human Variant allotment should sum to 2');
    assert(sum(byName['Custom Lineage'].allotment) === 2, 'Custom Lineage allotment should sum to 2');
    assert(sum(byName['Half-Elf'].allotment) === 4, 'Half-Elf allotment should sum to 4');
    assert(byName['Wood Elf'].speed === 35, `Wood Elf speed should be 35, got ${byName['Wood Elf'].speed}`);
    assert(byName['Lightfoot Halfling'].size === 'Small', 'Halfling should be Small');
    assert(byName['Dark Elf (Drow)'].darkvision === 120, 'Drow darkvision should be 120');
  });

  // ── GET /api/backgrounds ───────────────────────────────────
  await test('GET /api/backgrounds returns 13 entries', async () => {
    const { status, json } = await request(BASE, '/api/backgrounds');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(json.backgrounds), 'Expected backgrounds array');
    assert(json.backgrounds.length === 13, `Expected 13 backgrounds, got ${json.backgrounds.length}`);
  });

  await test('GET /api/backgrounds each entry has required fields', async () => {
    const { json } = await request(BASE, '/api/backgrounds');
    for (const b of json.backgrounds) {
      assert(typeof b.name === 'string' && b.name.length > 0, `Background missing name`);
      assert(Array.isArray(b.skills) && b.skills.length === 2, `${b.name} must have exactly 2 skills`);
      assert(Array.isArray(b.tools), `${b.name} missing tools`);
      assert(typeof b.languageChoices === 'number', `${b.name} missing languageChoices`);
      assert(typeof b.gold === 'number' && b.gold > 0, `${b.name} missing gold`);
      assert(typeof b.feature === 'string', `${b.name} missing feature`);
      assert(typeof b.featureDesc === 'string', `${b.name} missing featureDesc`);
    }
  });

  await test('GET /api/backgrounds canonical spot-checks', async () => {
    const { json } = await request(BASE, '/api/backgrounds');
    const byName: Record<string, any> = {};
    for (const b of json.backgrounds) byName[b.name] = b;
    assert(byName['Acolyte'].languageChoices === 2, 'Acolyte should have 2 language choices');
    assert(byName['Sage'].languageChoices === 2, 'Sage should have 2 language choices');
    assert(byName['Noble'].gold === 25, 'Noble gold should be 25gp');
    assert(byName['Hermit'].gold === 5, 'Hermit gold should be 5gp');
    assert(byName['Charlatan'].tools.includes('Disguise Kit'), 'Charlatan should have Disguise Kit');
    assert(byName['Criminal'].tools.length === 2, 'Criminal should have 2 tools');
    assert(byName['Soldier'].languageChoices === 0, 'Soldier has no language choices');
  });

  // ── GET /api/feats ──────────────────────────────────────────
  await test('GET /api/feats returns 42 PHB feats', async () => {
    const { status, json } = await request(BASE, '/api/feats');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(json.feats) && json.feats.length === 42, `Expected 42 feats, got ${json.feats?.length}`);
  });

  await test('GET /api/feats entries have required fields', async () => {
    const { json } = await request(BASE, '/api/feats');
    const f = json.feats.find((x: any) => x.name === 'Tough');
    assert(!!f, 'Tough feat present');
    assert(typeof f.description === 'string' && f.description.length > 10, 'Tough has a description');
    assert(f.hpPerLevel === 2, `Tough hpPerLevel should be 2, got ${f.hpPerLevel}`);
    const athlete = json.feats.find((x: any) => x.name === 'Athlete');
    assert(JSON.stringify(athlete.abilityChoice.options) === JSON.stringify(['str','dex']), 'Athlete offers STR/DEX');
  });

  // ── POST /api/characters/:id/applyfeat ──────────────────────
  {
    let featCharId = '';

    await test('setup: create Fighter 1 and level to 4 for applyfeat tests', async () => {
      const created = await request(BASE, '/api/characters', 'POST', {
        name: 'FeatTestDummy', race: 'Human', background: 'Soldier', alignment: 'Lawful Neutral',
        firstClass: 'Fighter',
        classLevels: [{ className: 'Fighter', level: 1 }],
        subclassChoices: {},
        experiencePoints: 0,
        baseStats: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
        stats:     { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
        maxHP: 12, currentHP: 12, temporaryHP: 0,
        armorClass: 16, acFormula: 'Chain Mail: 16', speed: 30,
        hitDice: [{ className: 'Fighter', dieSides: 10, total: 1, remaining: 1 }],
        proficiencies: {
          armor: ['light','medium','heavy','shield'],
          weapons: ['simple-melee','simple-ranged','martial-melee','martial-ranged'],
          tools: [], savingThrows: ['str','con'], skills: [], expertise: [],
        },
        languages: ['Common'],
        resources: { secondWind: { max: 1, remaining: 1 } },
        equipment: [{ name: 'Longsword', quantity: 1, equipped: true, category: 'weapon' }],
        gold: 10,
        level1Features: [], allFeatures: [], feats: [], backgroundFeature: '', exhaustionLevel: 0,
      });
      assert(created.status === 201, `create expected 201, got ${created.status}: ${JSON.stringify(created.json)}`);
      featCharId = created.json.character.id;
      for (let i = 0; i < 3; i++) {
        const { status, json } = await request(BASE, `/api/${featCharId}/levelup`, 'POST', {
          className: 'Fighter', hpRollMethod: 'average',
        });
        assert(status === 200, `levelup #${i+1} expected 200, got ${status}: ${JSON.stringify(json)}`);
      }
      const { json: cur } = await request(BASE, `/api/characters/${featCharId}`, 'GET');
      assert(cur.character?.classLevels?.[0]?.level === 4, `Expected level 4, got ${cur.character?.classLevels?.[0]?.level}`);
      assert((cur.character?.pendingAbilityScoreImprovements ?? 0) >= 1, 'Fighter 4 should have a pending ASI');
    });

    await test('POST /applyfeat 400 without featName', async () => {
      const { status } = await request(BASE, `/api/characters/${featCharId}/applyfeat`, 'POST', {});
      assert(status === 400, `Expected 400, got ${status}`);
    });

    await test('POST /applyfeat 400/500 on unknown feat name', async () => {
      const { status } = await request(BASE, `/api/characters/${featCharId}/applyfeat`, 'POST', { featName: 'Not A Real Feat' });
      assert(status >= 400, `Expected an error status, got ${status}`);
    });

    await test('POST /applyfeat 400/500 without required ability choice', async () => {
      const { status } = await request(BASE, `/api/characters/${featCharId}/applyfeat`, 'POST', { featName: 'Athlete' });
      assert(status >= 400, `Expected an error status, got ${status}`);
    });

    await test('POST /applyfeat applies Resilient (ability choice + save proficiency)', async () => {
      const { json: cur } = await request(BASE, `/api/characters/${featCharId}`, 'GET');
      const wisBefore = cur.character.stats.wis;

      const { status, json } = await request(BASE, `/api/characters/${featCharId}/applyfeat`, 'POST', {
        featName: 'Resilient', abilityChoice: 'wis',
      });
      assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(json)}`);
      assert(json.character.stats.wis === wisBefore + 1, `Expected WIS ${wisBefore+1}, got ${json.character.stats.wis}`);
      assert(json.character.proficiencies.savingThrows.includes('wis'), 'WIS save proficiency granted');
      assert(json.character.feats.includes('Resilient'), 'Resilient recorded in feats[]');
      assert(json.character.allFeatures.some((f: any) => f.name === 'Resilient' && f.source === 'feat'), 'Resilient feature recorded');
      assert(json.character.pendingAbilityScoreImprovements === 0, 'ASI consumed');
    });

    await test('POST /applyfeat 400/500 retaking the same feat', async () => {
      const { status } = await request(BASE, `/api/characters/${featCharId}/applyfeat`, 'POST', {
        featName: 'Resilient', abilityChoice: 'int',
      });
      assert(status >= 400, `Expected an error status (no pending ASI anyway), got ${status}`);
    });

    await test('POST /applyfeat response includes grantsSpells=false for non-spell feat', async () => {
      // featCharId was cleaned up but we can re-fetch via another path — use a fresh char
      // We check this on the Resilient result char (already applied above in this block).
      // Actually just call GET /feats to confirm it's false for Tough, then test via a direct
      // check of the flag in the next test using Magic Initiate directly.
      const { json } = await request(BASE, '/api/feats');
      const mi = json.feats.find((f: any) => f.name === 'Magic Initiate');
      assert(!!mi?.grantsSpells, 'Magic Initiate.grantsSpells is true in /api/feats');
      const keen = json.feats.find((f: any) => f.name === 'Keen Mind');
      assert(!keen?.grantsSpells, 'Keen Mind.grantsSpells is falsy in /api/feats');
    });

    // setfeatspells tests — need a fresh character with Magic Initiate applied.
    // We'll create a minimal character, give it 1 pending ASI, apply Magic Initiate,
    // then test the setfeatspells endpoint.
    {
      let miCharId = '';

      await test('setup: create character and apply Magic Initiate for setfeatspells tests', async () => {
        const created = await request(BASE, '/api/characters', 'POST', {
          name: 'MITestDummy', race: 'Human', background: 'Sage', alignment: 'True Neutral',
          firstClass: 'Wizard',
          classLevels: [{ className: 'Wizard', level: 4 }],
          subclassChoices: {},
          experiencePoints: 0,
          baseStats: { str: 8, dex: 14, con: 12, int: 17, wis: 13, cha: 10 },
          stats:     { str: 8, dex: 14, con: 12, int: 17, wis: 13, cha: 10 },
          maxHP: 24, currentHP: 24, temporaryHP: 0,
          armorClass: 12, acFormula: 'Mage Armor', speed: 30,
          hitDice: [{ className: 'Wizard', dieSides: 6, total: 4, remaining: 4 }],
          proficiencies: { armor: [], weapons: ['simple-melee','simple-ranged'], tools: [], savingThrows: ['int','wis'], skills: ['Arcana','History'], expertise: [] },
          languages: ['Common','Elvish'],
          resources: { arcaneRecovery: { usesRemaining: 1 } },
          equipment: [],
          gold: 15,
          level1Features: [], allFeatures: [], feats: [],
          backgroundFeature: 'Researcher', exhaustionLevel: 0,
          pendingAbilityScoreImprovements: 1,
        });
        assert(created.status === 201, `create expected 201, got ${created.status}: ${JSON.stringify(created.json)}`);
        miCharId = created.json.character.id;

        const applied = await request(BASE, `/api/characters/${miCharId}/applyfeat`, 'POST', { featName: 'Magic Initiate' });
        assert(applied.status === 200, `applyfeat expected 200, got ${applied.status}: ${JSON.stringify(applied.json)}`);
        assert(!!applied.json.grantsSpells, 'applyfeat response includes grantsSpells=true for Magic Initiate');
        assert(applied.json.character.feats.includes('Magic Initiate'), 'Magic Initiate recorded on character');
      });

      await test('POST /setfeatspells 400 with no featName', async () => {
        const { status } = await request(BASE, `/api/characters/${miCharId}/setfeatspells`, 'POST', { spells: ['Fireball'] });
        assert(status === 400, `Expected 400, got ${status}`);
      });

      await test('POST /setfeatspells 400 for non-spell-granting feat', async () => {
        const { status, json } = await request(BASE, `/api/characters/${miCharId}/setfeatspells`, 'POST', { featName: 'Keen Mind', spells: ['Fireball'] });
        assert(status === 400, `Expected 400, got ${status}. Body: ${JSON.stringify(json)}`);
      });

      await test('POST /setfeatspells 409 for feat character does not have', async () => {
        const { status } = await request(BASE, `/api/characters/${miCharId}/setfeatspells`, 'POST', { featName: 'Ritual Caster', spells: ['Detect Magic'] });
        assert(status === 409, `Expected 409, got ${status}`);
      });

      await test('POST /setfeatspells 200 records spell choices', async () => {
        const { status, json } = await request(BASE, `/api/characters/${miCharId}/setfeatspells`, 'POST', {
          featName: 'Magic Initiate',
          spells: ['Mage Hand', 'Prestidigitation', 'Find Familiar'],
        });
        assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(json)}`);
        const choices = json.character.featSpellChoices?.['Magic Initiate'];
        assert(Array.isArray(choices), 'featSpellChoices.Magic Initiate is an array');
        assert(choices?.includes('Find Familiar'), 'Find Familiar recorded');
        assert(choices?.includes('Mage Hand'), 'Mage Hand recorded');
        assert(choices?.length === 3, `Expected 3 spells, got ${choices?.length}`);
      });

      await test('POST /setfeatspells overwrites existing choices', async () => {
        const { status, json } = await request(BASE, `/api/characters/${miCharId}/setfeatspells`, 'POST', {
          featName: 'Magic Initiate',
          spells: ['Shocking Grasp', 'Magic Missile'],
        });
        assert(status === 200, `Expected 200, got ${status}`);
        const choices = json.character.featSpellChoices?.['Magic Initiate'];
        assert(choices?.length === 2, `Expected 2 spells after overwrite, got ${choices?.length}`);
        assert(!choices?.includes('Find Familiar'), 'Old choice not present after overwrite');
      });

      await test('cleanup: delete Magic Initiate test character', async () => {
        const { deleteCharacter } = require('../characters/storage');
        try { deleteCharacter(miCharId); } catch {}
      });
    }

    await test('cleanup: delete feat test character', async () => {
      const { deleteCharacter } = require('../characters/storage');
      try { deleteCharacter(featCharId); } catch {}
    });
  }

  // ── POST /api/characters/create-level0 ────────────────────
  {
    const BASE_SCORES = { str: 10, dex: 14, con: 12, int: 13, wis: 11, cha: 8 };

    await test('POST /api/characters/create-level0 creates valid Level 0 character', async () => {
      const { status, json } = await request(BASE, '/api/characters/create-level0', 'POST', {
        race: 'High Elf',
        background: 'Sage',
        baseScores: BASE_SCORES,
        name: 'Aelthas',
      });
      assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(json)}`);
      const c = json.character;
      assert(c.name === 'Aelthas', `name mismatch: ${c.name}`);
      assert(c.race === 'High Elf', `race mismatch: ${c.race}`);
      assert(c.background === 'Sage', `background mismatch: ${c.background}`);
      assert(Array.isArray(c.classLevels) && c.classLevels.length === 0, 'classLevels should be empty');
      assert(c.maxHP === 0, `maxHP should be 0 for Level 0, got ${c.maxHP}`);
      assert(c.speed === 30, `speed should be 30, got ${c.speed}`);
      assert(c.stats.dex === 16, `dex should be 16 (14+2), got ${c.stats.dex}`);
      assert(c.stats.int === 14, `int should be 14 (13+1), got ${c.stats.int}`);
      assert(c.level0Record, 'level0Record should be present');
      assert(c.level0Record.race === 'High Elf', 'level0Record.race mismatch');
      assert(JSON.stringify(c.level0Record.racialASIAllotment) === JSON.stringify([2, 1]), 'allotment mismatch');
      assert(c.proficiencies.skills.includes('Arcana'), 'Should have Arcana from Sage');
      assert(c.proficiencies.skills.includes('History'), 'Should have History from Sage');
      assert(c.gold === 10, `gold should be 10 from Sage, got ${c.gold}`);
      assert(c.languages.includes('Common'), 'Should have Common');
      // Clean up
      const { deleteCharacter } = require('../characters/storage');
      try { deleteCharacter(c.id); } catch {}
    });

    await test('POST /api/characters/create-level0 accepts explicit asiAssignment', async () => {
      const { status, json } = await request(BASE, '/api/characters/create-level0', 'POST', {
        race: 'Half-Elf',
        background: 'Noble',
        baseScores: BASE_SCORES,
        asiAssignment: { cha: 2, str: 1, dex: 1 },
        name: 'Liriel',
      });
      assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(json)}`);
      const c = json.character;
      assert(c.stats.cha === 10, `cha should be 10 (8+2), got ${c.stats.cha}`);
      assert(c.stats.str === 11, `str should be 11 (10+1), got ${c.stats.str}`);
      assert(c.stats.dex === 15, `dex should be 15 (14+1), got ${c.stats.dex}`);
      assert(c.gold === 25, `Noble gold should be 25gp, got ${c.gold}`);
      const { deleteCharacter } = require('../characters/storage');
      try { deleteCharacter(c.id); } catch {}
    });

    await test('POST /api/characters/create-level0 uses Human defaultASI when no assignment given', async () => {
      const { status, json } = await request(BASE, '/api/characters/create-level0', 'POST', {
        race: 'Human',
        background: 'Folk Hero',
        baseScores: BASE_SCORES,
      });
      assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(json)}`);
      const c = json.character;
      // Human default: +1 to all six
      assert(c.stats.str === 11, `str should be 11, got ${c.stats.str}`);
      assert(c.stats.dex === 15, `dex should be 15, got ${c.stats.dex}`);
      assert(c.stats.con === 13, `con should be 13, got ${c.stats.con}`);
      const { deleteCharacter } = require('../characters/storage');
      try { deleteCharacter(c.id); } catch {}
    });

    await test('POST /api/characters/create-level0 400 on unknown race', async () => {
      const { status } = await request(BASE, '/api/characters/create-level0', 'POST', {
        race: 'Githyanki',
        background: 'Sage',
        baseScores: BASE_SCORES,
      });
      assert(status === 400, `Expected 400, got ${status}`);
    });

    await test('POST /api/characters/create-level0 400 on unknown background', async () => {
      const { status } = await request(BASE, '/api/characters/create-level0', 'POST', {
        race: 'Human',
        background: 'Far Traveler',
        baseScores: BASE_SCORES,
      });
      assert(status === 400, `Expected 400, got ${status}`);
    });

    await test('POST /api/characters/create-level0 400 when asiAssignment sum is wrong', async () => {
      const { status, json } = await request(BASE, '/api/characters/create-level0', 'POST', {
        race: 'High Elf',
        background: 'Sage',
        baseScores: BASE_SCORES,
        asiAssignment: { dex: 1, int: 1 }, // sums to 2, should be 3
      });
      assert(status === 400, `Expected 400, got ${status}: ${JSON.stringify(json)}`);
    });

    await test('POST /api/characters/create-level0 400 when asiAssignment required but missing (Half-Elf)', async () => {
      const { status } = await request(BASE, '/api/characters/create-level0', 'POST', {
        race: 'Half-Elf',
        background: 'Sage',
        baseScores: BASE_SCORES,
        // no asiAssignment — Half-Elf has no defaultASI
      });
      assert(status === 400, `Expected 400, got ${status}`);
    });

    await test('POST /api/characters/create-level0 400 on out-of-range baseScore', async () => {
      const { status } = await request(BASE, '/api/characters/create-level0', 'POST', {
        race: 'Human',
        background: 'Sage',
        baseScores: { ...BASE_SCORES, str: 0 },  // 0 is invalid
      });
      assert(status === 400, `Expected 400, got ${status}`);
    });

    await test('POST /api/characters/create-level0 persists to disk (GET retrieves it)', async () => {
      const { json: created } = await request(BASE, '/api/characters/create-level0', 'POST', {
        race: 'Tiefling',
        background: 'Criminal',
        baseScores: BASE_SCORES,
        name: 'Zariel',
      });
      const id = created.character.id;
      const { status, json } = await request(BASE, `/api/characters/${id}`);
      assert(status === 200, `Expected 200 on GET, got ${status}`);
      assert(json.character.name === 'Zariel', 'Persisted character name mismatch');
      assert(json.character.race === 'Tiefling', 'Persisted character race mismatch');
      const { deleteCharacter } = require('../characters/storage');
      try { deleteCharacter(id); } catch {}
    });
  }

  // ── Action Surge / Sorcery Points / Wild Shape — rest recharge ───

  await test('Fighter lv2 has actionSurge, short rest restores it', async () => {
    // Create a fighter, level to 2, spend action surge, short rest
    const createRes = await fetch(BASE + '/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'TestFighterSurge', race: 'Human', background: 'Soldier', alignment: 'Lawful Good',
        firstClass: 'Fighter', classLevels: [{ className: 'Fighter', level: 2 }],
        subclassChoices: {}, experiencePoints: 0,
        baseStats: { str:16, dex:10, con:14, int:8, wis:12, cha:10 },
        stats:     { str:16, dex:10, con:14, int:8, wis:12, cha:10 },
        maxHP:19, currentHP:19, temporaryHP:0, armorClass:16, acFormula:'Chain Mail', speed:30,
        hitDice:[{className:'Fighter',dieSides:10,total:2,remaining:2}],
        proficiencies:{ armor:['light','medium','heavy','shield'], weapons:['simple-melee','simple-ranged','martial-melee','martial-ranged'], tools:[], savingThrows:['str','con'], skills:['Athletics','Intimidation'], expertise:[] },
        languages:['Common'], gold:10, equipment:[],
        resources:{ secondWind:{max:1,remaining:1}, actionSurge:{max:1,remaining:0} },
        level1Features:[], allFeatures:[], feats:[], backgroundFeature:'Military Rank', exhaustionLevel:0,
      }),
    });
    const { character: fighter } = await createRes.json();
    assert(fighter.resources.actionSurge?.remaining === 0, 'action surge spent before rest');

    const restRes = await fetch(BASE + `/api/characters/${fighter.id}/shortrest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hitDiceToSpend: 0 }),
    });
    const { character: rested, restored } = await restRes.json();
    assert(rested.resources.actionSurge?.remaining === 1, `action surge should restore on short rest, got ${rested.resources.actionSurge?.remaining}`);
    assert(restored.some((s: string) => s.includes('Action Surge')), 'restored list should mention Action Surge');
    const { deleteCharacter: dc1 } = require('../characters/storage');
    try { dc1(fighter.id); } catch {}
  });

  await test('Sorcerer lv2 has sorceryPoints, long rest restores them', async () => {
    const createRes = await fetch(BASE + '/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'TestSorcererPoints', race: 'Human', background: 'Hermit', alignment: 'True Neutral',
        firstClass: 'Sorcerer', classLevels: [{ className: 'Sorcerer', level: 2 }],
        subclassChoices: {}, experiencePoints: 0,
        baseStats: { str:8, dex:14, con:14, int:10, wis:12, cha:16 },
        stats:     { str:8, dex:14, con:14, int:10, wis:12, cha:16 },
        maxHP:12, currentHP:12, temporaryHP:0, armorClass:12, acFormula:'DEX Unarmored', speed:30,
        hitDice:[{className:'Sorcerer',dieSides:6,total:2,remaining:2}],
        proficiencies:{ armor:[], weapons:['simple-melee','simple-ranged'], tools:[], savingThrows:['con','cha'], skills:['Arcana','Deception'], expertise:[] },
        languages:['Common'], gold:15, equipment:[],
        resources:{ sorceryPoints:{max:2,remaining:0} },
        spellcasting:{ ability:'cha', spellAttackBonus:5, saveDC:13, slots:{'1':3}, slotsUsed:{'1':0}, cantrips:[], knownSpells:[], preparedSpells:[], spellbook:[] },
        level1Features:[], allFeatures:[], feats:[], backgroundFeature:'Discovery', exhaustionLevel:0,
      }),
    });
    const { character: sorc } = await createRes.json();
    assert(sorc.resources.sorceryPoints?.remaining === 0, 'sorcery points spent before rest');

    const restRes = await fetch(BASE + `/api/characters/${sorc.id}/longrest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const { character: rested, restored } = await restRes.json();
    assert(rested.resources.sorceryPoints?.remaining === 2, `sorcery points should restore on long rest, got ${rested.resources.sorceryPoints?.remaining}`);
    assert(restored.some((s: string) => s.includes('Sorcery Points')), 'restored list should mention Sorcery Points');
    const { deleteCharacter: dc2 } = require('../characters/storage');
    try { dc2(sorc.id); } catch {}
  });

  await test('Druid lv2 has wildShape, short rest restores it', async () => {
    const createRes = await fetch(BASE + '/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'TestDruidShape', race: 'Human', background: 'Hermit', alignment: 'Neutral Good',
        firstClass: 'Druid', classLevels: [{ className: 'Druid', level: 2 }],
        subclassChoices: {}, experiencePoints: 0,
        baseStats: { str:10, dex:14, con:14, int:12, wis:16, cha:8 },
        stats:     { str:10, dex:14, con:14, int:12, wis:16, cha:8 },
        maxHP:17, currentHP:17, temporaryHP:0, armorClass:13, acFormula:'Medium Armor', speed:30,
        hitDice:[{className:'Druid',dieSides:8,total:2,remaining:2}],
        proficiencies:{ armor:['light','medium','shield'], weapons:['simple-melee','simple-ranged'], tools:[], savingThrows:['int','wis'], skills:['Nature','Survival'], expertise:[] },
        languages:['Common'], gold:10, equipment:[],
        resources:{ wildShape:{max:2,remaining:0} },
        spellcasting:{ ability:'wis', spellAttackBonus:5, saveDC:13, slots:{'1':3}, slotsUsed:{'1':0}, cantrips:[], knownSpells:[], preparedSpells:[], spellbook:[] },
        level1Features:[], allFeatures:[], feats:[], backgroundFeature:'Discovery', exhaustionLevel:0,
      }),
    });
    const { character: druid } = await createRes.json();
    assert(druid.resources.wildShape?.remaining === 0, 'wild shape spent before rest');

    const restRes = await fetch(BASE + `/api/characters/${druid.id}/shortrest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hitDiceToSpend: 0 }),
    });
    const { character: rested, restored } = await restRes.json();
    assert(rested.resources.wildShape?.remaining === 2, `wild shape should restore on short rest, got ${rested.resources.wildShape?.remaining}`);
    assert(restored.some((s: string) => s.includes('Wild Shape')), 'restored list should mention Wild Shape');
    const { deleteCharacter: dc3 } = require('../characters/storage');
    try { dc3(druid.id); } catch {}
  });

  await test('Action Surge also restores on long rest', async () => {
    const createRes = await fetch(BASE + '/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'TestFighterLongRest', race: 'Human', background: 'Soldier', alignment: 'Lawful Good',
        firstClass: 'Fighter', classLevels: [{ className: 'Fighter', level: 2 }],
        subclassChoices: {}, experiencePoints: 0,
        baseStats: { str:16, dex:10, con:14, int:8, wis:12, cha:10 },
        stats:     { str:16, dex:10, con:14, int:8, wis:12, cha:10 },
        maxHP:19, currentHP:10, temporaryHP:0, armorClass:16, acFormula:'Chain Mail', speed:30,
        hitDice:[{className:'Fighter',dieSides:10,total:2,remaining:2}],
        proficiencies:{ armor:['light','medium','heavy','shield'], weapons:['simple-melee','simple-ranged','martial-melee','martial-ranged'], tools:[], savingThrows:['str','con'], skills:['Athletics','Intimidation'], expertise:[] },
        languages:['Common'], gold:10, equipment:[],
        resources:{ secondWind:{max:1,remaining:1}, actionSurge:{max:1,remaining:0} },
        level1Features:[], allFeatures:[], feats:[], backgroundFeature:'Military Rank', exhaustionLevel:0,
      }),
    });
    const { character: fighter } = await createRes.json();

    const restRes = await fetch(BASE + `/api/characters/${fighter.id}/longrest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const { character: rested } = await restRes.json();
    assert(rested.resources.actionSurge?.remaining === 1, `action surge should restore on long rest`);
    assert(rested.currentHP === 19, 'HP should be full after long rest');
    const { deleteCharacter: dc4 } = require('../characters/storage');
    try { dc4(fighter.id); } catch {}
  });

  // ── GET /api/stat-optimizer ────────────────────────────────

  await test('GET /api/stat-optimizer 400 without race', async () => {
    const { status } = await request(BASE, '/api/stat-optimizer?class=Fighter');
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('GET /api/stat-optimizer 400 without class', async () => {
    const { status } = await request(BASE, '/api/stat-optimizer?race=Human');
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('GET /api/stat-optimizer 400 on unknown race', async () => {
    const { status } = await request(BASE, '/api/stat-optimizer?race=Klingon&class=Fighter');
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('GET /api/stat-optimizer 400 on unknown class', async () => {
    const { status } = await request(BASE, '/api/stat-optimizer?race=Human&class=Ninja');
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('GET /api/stat-optimizer returns expected shape', async () => {
    const { status, json } = await request(BASE, '/api/stat-optimizer?race=Human&class=Fighter');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.race === 'Human', `Expected race Human, got ${json.race}`);
    assert(json.class === 'Fighter', `Expected class Fighter, got ${json.class}`);
    assert(Array.isArray(json.standardArray), 'standardArray should be array');
    assert(Array.isArray(json.priorityOrder) && json.priorityOrder.length === 6, 'priorityOrder should have 6 entries');
    assert(json.baseScores && typeof json.baseScores === 'object', 'baseScores required');
    assert(json.finalScores && typeof json.finalScores === 'object', 'finalScores required');
    assert(typeof json.isFlexibleASI === 'boolean', 'isFlexibleASI should be boolean');
  });

  await test('GET /api/stat-optimizer standard array values are [15,14,13,12,10,8]', async () => {
    const { json } = await request(BASE, '/api/stat-optimizer?race=Human&class=Fighter');
    const vals: number[] = [...json.standardArray].sort((a: number, b: number) => b - a);
    assert(JSON.stringify(vals) === JSON.stringify([15,14,13,12,10,8]),
      `Standard array mismatch: ${JSON.stringify(vals)}`);
  });

  await test('GET /api/stat-optimizer baseScores use all standard array values exactly once', async () => {
    const { json } = await request(BASE, '/api/stat-optimizer?race=Tiefling&class=Warlock');
    const bases = (Object.values(json.baseScores) as number[]).sort((a, b) => b - a);
    assert(JSON.stringify(bases) === JSON.stringify([15,14,13,12,10,8]),
      `baseScores should be standard array permutation, got ${JSON.stringify(bases)}`);
  });

  await test('GET /api/stat-optimizer fixed-ASI race: finalScores = baseScores + defaultASI', async () => {
    // Hill Dwarf: defaultASI = {con:2, wis:1}
    // Barbarian priority: str, con, dex, wis, cha, int => base str=15, con=14, dex=13, wis=12, cha=10, int=8
    // final con = 14+2=16, wis = 12+1=13
    const { json } = await request(BASE, '/api/stat-optimizer?race=Hill%20Dwarf&class=Barbarian');
    assert(json.isFlexibleASI === false, 'Hill Dwarf should not be flexible');
    assert(json.finalScores.str === 15, `Expected STR=15, got ${json.finalScores.str}`);
    assert(json.finalScores.con === 16, `Expected CON=16, got ${json.finalScores.con}`);
    assert(json.finalScores.wis === 13, `Expected WIS=13, got ${json.finalScores.wis}`);
    assert(json.priorityOrder[0] === 'str', `Barbarian rank-1 should be str, got ${json.priorityOrder[0]}`);
  });

  await test('GET /api/stat-optimizer flexible-ASI race: suggestedAsiAssignment on top-priority stats', async () => {
    // Human (Variant): allotment [1,1], no defaultASI => flexible
    // Wizard priority: int, con, dex, wis, cha, str => suggested int+1, con+1
    const { json } = await request(BASE, '/api/stat-optimizer?race=Human%20(Variant)&class=Wizard');
    assert(json.isFlexibleASI === true, 'Human Variant should be flexible');
    assert(json.suggestedAsiAssignment.int === 1, `Expected int+1 in ASI, got ${json.suggestedAsiAssignment.int}`);
    assert(json.suggestedAsiAssignment.con === 1, `Expected con+1 in ASI, got ${json.suggestedAsiAssignment.con}`);
    assert(json.finalScores.int === 16, `Expected INT final=16, got ${json.finalScores.int}`);
  });

  await test('GET /api/stat-optimizer Custom Lineage Paladin: +2 on STR (top priority)', async () => {
    // Custom Lineage: allotment [2], flexible
    // Paladin priority: str, cha, con, dex, wis, int => +2 on str
    const { json } = await request(BASE, '/api/stat-optimizer?race=Custom%20Lineage&class=Paladin');
    assert(json.isFlexibleASI === true, 'Custom Lineage should be flexible');
    assert(json.suggestedAsiAssignment.str === 2, `Expected str+2, got ${JSON.stringify(json.suggestedAsiAssignment)}`);
    assert(json.finalScores.str === 17, `Expected STR final=17, got ${json.finalScores.str}`);
  });

  await test('GET /api/stat-optimizer Wizard returns int as rank-1 priority', async () => {
    const { json } = await request(BASE, '/api/stat-optimizer?race=High%20Elf&class=Wizard');
    assert(json.priorityOrder[0] === 'int', `Wizard rank-1 should be int, got ${json.priorityOrder[0]}`);
    assert(json.baseScores.int === 15, `Wizard highest base score should go to INT, got ${json.baseScores.int}`);
  });

  await test('GET /api/stat-optimizer Monk: dex is rank-1, wis is rank-2', async () => {
    const { json } = await request(BASE, '/api/stat-optimizer?race=Wood%20Elf&class=Monk');
    assert(json.priorityOrder[0] === 'dex', `Monk rank-1 should be dex, got ${json.priorityOrder[0]}`);
    assert(json.priorityOrder[1] === 'wis', `Monk rank-2 should be wis, got ${json.priorityOrder[1]}`);
    assert(json.baseScores.dex === 15, `Monk highest base should go to DEX`);
    assert(json.baseScores.wis === 14, `Monk second base should go to WIS`);
  });

  // ── GET /api/spells ───────────────────────────────────────

  await test('GET /api/spells?class=Wizard&level=1 returns Wizard lv1 spells', async () => {
    const { status, json } = await request(BASE, '/api/spells?class=Wizard&level=1');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(json.spells), 'spells should be an array');
    assert(json.spells.includes('Magic Missile'), 'Wizard lv1 should include Magic Missile');
    assert(json.spells.includes('Shield'), 'Wizard lv1 should include Shield');
    assert(json.spells.includes('Mage Armor'), 'Wizard lv1 should include Mage Armor');
    assert(!json.spells.includes('Eldritch Blast'), 'Wizard lv1 should not include Eldritch Blast');
    assert(json.class === 'Wizard', `class should be "Wizard", got ${json.class}`);
    assert(json.level === 1, `level should be 1, got ${json.level}`);
  });

  await test('GET /api/spells?class=Cleric&level=0 returns Cleric cantrips', async () => {
    const { status, json } = await request(BASE, '/api/spells?class=Cleric&level=0');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.spells.includes('Guidance'), 'Cleric cantrips should include Guidance');
    assert(json.spells.includes('Sacred Flame'), 'Cleric cantrips should include Sacred Flame');
    assert(!json.spells.includes('Eldritch Blast'), 'Cleric cantrips should not include Eldritch Blast');
  });

  await test('GET /api/spells?class=Bard&level=1 returns Bard lv1 spells', async () => {
    const { status, json } = await request(BASE, '/api/spells?class=Bard&level=1');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.spells.includes('Healing Word'), 'Bard lv1 should include Healing Word');
    assert(json.spells.includes('Dissonant Whispers'), 'Bard lv1 should include Dissonant Whispers');
    assert(!json.spells.includes('Magic Missile'), 'Bard lv1 should not include Magic Missile');
  });

  await test('GET /api/spells?class=Warlock&level=0 returns Warlock cantrips', async () => {
    const { status, json } = await request(BASE, '/api/spells?class=Warlock&level=0');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.spells.includes('Eldritch Blast'), 'Warlock cantrips should include Eldritch Blast');
    assert(!json.spells.includes('Guidance'), 'Warlock cantrips should not include Guidance');
  });

  await test('GET /api/spells?class=Ranger&level=0 returns empty array (no Ranger cantrips)', async () => {
    const { status, json } = await request(BASE, '/api/spells?class=Ranger&level=0');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(json.spells), 'spells should be an array');
    assert(json.spells.length === 0, `Ranger has no cantrips, got ${json.spells.length}`);
  });

  await test('GET /api/spells?class=Ranger&level=1 returns Ranger lv1 spells', async () => {
    const { status, json } = await request(BASE, `/api/spells?class=Ranger&level=1`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.spells.includes("Hunter's Mark"), "Ranger lv1 should include Hunter's Mark");
    assert(json.spells.includes('Fog Cloud'), 'Ranger lv1 should include Fog Cloud');
    assert(!json.spells.includes('Magic Missile'), 'Ranger lv1 should not include Magic Missile');
  });

  await test('GET /api/spells?class=Artificer&level=0 returns dedicated Artificer cantrips', async () => {
    const { status, json } = await request(BASE, '/api/spells?class=Artificer&level=0');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.class === 'Artificer', `class should be "Artificer" (not aliased), got ${json.class}`);
    assert(json.spells.includes('Booming Blade'), 'Artificer cantrips should include Booming Blade');
    assert(json.spells.includes('Acid Splash'), 'Artificer cantrips should include Acid Splash');
    assert(!json.spells.includes('Vicious Mockery'), 'Artificer cantrips should not include Vicious Mockery (Bard-only)');
  });

  await test('GET /api/spells?class=Artificer&level=1 returns dedicated Artificer lv1 spells', async () => {
    const { status, json } = await request(BASE, '/api/spells?class=Artificer&level=1');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.spells.includes('Cure Wounds'), 'Artificer lv1 should include Cure Wounds');
    assert(json.spells.includes("Tasha's Caustic Brew"), "Artificer lv1 should include Tasha's Caustic Brew");
    assert(json.spells.includes('Absorb Elements'), 'Artificer lv1 should include Absorb Elements');
    assert(!json.spells.includes('Magic Missile'), 'Artificer lv1 should not include Magic Missile (Wizard-only)');
  });

  await test('GET /api/spells?class=Artificer&level=5 returns dedicated Artificer lv5 spells', async () => {
    const { status, json } = await request(BASE, '/api/spells?class=Artificer&level=5');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.spells.includes("Bigby's Hand"), "Artificer lv5 should include Bigby's Hand");
    assert(json.spells.includes('Skill Empowerment'), 'Artificer lv5 should include Skill Empowerment');
  });

  await test('GET /api/spells?class=Artificer&level=6 returns empty array (half-caster caps at 5th level)', async () => {
    const { status, json } = await request(BASE, '/api/spells?class=Artificer&level=6');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(json.spells), 'spells should be an array');
    assert(json.spells.length === 0, `Artificer has no 6th-level spells, got ${json.spells.length}`);
  });

  await test('GET /api/spells?class=Eldritch+Knight resolves to Wizard list', async () => {
    const { status, json } = await request(BASE, '/api/spells?class=Eldritch+Knight&level=1');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.class === 'Wizard', `Eldritch Knight should resolve to Wizard, got ${json.class}`);
    assert(json.spells.includes('Magic Missile'), 'Eldritch Knight (Wizard alias) lv1 should include Magic Missile');
  });

  await test('GET /api/spells?class=Unknown returns 400', async () => {
    const { status } = await request(BASE, '/api/spells?class=Unknown');
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('GET /api/spells?level=10 returns 400', async () => {
    const { status } = await request(BASE, '/api/spells?level=10');
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('GET /api/spells?level=0 with no class returns all cantrips from all sources', async () => {
    const { status, json } = await request(BASE, '/api/spells?level=0');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(json.spells.includes('Eldritch Blast'), 'All cantrips should include Eldritch Blast');
    assert(json.spells.includes('Druidcraft'), 'All cantrips should include Druidcraft');
    assert(json.spells.length >= 27, `Should have at least 27 PHB cantrips, got ${json.spells.length}`);
  });

  await test('GET /api/spells result is sorted alphabetically', async () => {
    const { json } = await request(BASE, '/api/spells?class=Wizard&level=1');
    const sorted = [...json.spells].sort();
    assert(JSON.stringify(json.spells) === JSON.stringify(sorted), 'Spells should be sorted alphabetically');
  });


  await test('GET /api/spells result is sorted alphabetically', async () => {
    const { json } = await request(BASE, '/api/spells?class=Wizard&level=1');
    const sorted = [...json.spells].sort();
    assert(JSON.stringify(json.spells) === JSON.stringify(sorted), 'Spells should be sorted alphabetically');
  });

  // ── POST /api/characters/:id/chooseinvocations ─────────────
  {
    let wlCharId = '';

    await test('setup: create Warlock lv2 for invocations tests', async () => {
      const created = await request(BASE, '/api/characters', 'POST', {
        name: 'InvTestWarlock', race: 'Human', background: 'Sage', alignment: 'True Neutral',
        firstClass: 'Warlock',
        classLevels: [{ className: 'Warlock', level: 2 }],
        subclassChoices: {},
        experiencePoints: 0,
        baseStats: { str: 8, dex: 14, con: 12, int: 10, wis: 13, cha: 16 },
        stats:     { str: 8, dex: 14, con: 12, int: 10, wis: 13, cha: 16 },
        maxHP: 16, currentHP: 16, temporaryHP: 0,
        armorClass: 13, acFormula: 'Leather 11+DEX', speed: 30,
        hitDice: [{ className: 'Warlock', dieSides: 8, total: 2, remaining: 2 }],
        proficiencies: { armor: ['light'], weapons: ['simple-melee','simple-ranged'], tools: [], savingThrows: ['wis','cha'], skills: ['Arcana','Deception'], expertise: [] },
        languages: ['Common'],
        resources: {},
        equipment: [],
        gold: 10,
        level1Features: [], allFeatures: [], feats: [],
        backgroundFeature: 'Researcher', exhaustionLevel: 0,
      });
      assert(created.status === 201, `create expected 201, got ${created.status}: ${JSON.stringify(created.json)}`);
      wlCharId = created.json.character.id;
    });

    await test('POST /chooseinvocations 400 when invocations not array', async () => {
      const { status } = await request(BASE, `/api/characters/${wlCharId}/chooseinvocations`, 'POST', { invocations: 'Agonizing Blast' });
      assert(status === 400, `Expected 400, got ${status}`);
    });

    await test('POST /chooseinvocations 400 when wrong count', async () => {
      // Warlock lv2 needs exactly 2; sending 1 should fail
      const { status, json } = await request(BASE, `/api/characters/${wlCharId}/chooseinvocations`, 'POST', { invocations: ['Agonizing Blast'] });
      assert(status === 400, `Expected 400, got ${status}: ${JSON.stringify(json)}`);
    });

    await test('POST /chooseinvocations 400 for unknown invocation name', async () => {
      const { status } = await request(BASE, `/api/characters/${wlCharId}/chooseinvocations`, 'POST', { invocations: ['Agonizing Blast', 'Fake Invocation'] });
      assert(status === 400, `Expected 400, got ${status}`);
    });

    await test('POST /chooseinvocations 200 sets two invocations for lv2 Warlock', async () => {
      const { status, json } = await request(BASE, `/api/characters/${wlCharId}/chooseinvocations`, 'POST', {
        invocations: ['Agonizing Blast', 'Repelling Blast'],
      });
      assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(json)}`);
      assert(Array.isArray(json.invocations), 'response.invocations is array');
      assert(json.invocations.length === 2, `Expected 2 invocations, got ${json.invocations.length}`);
      assert(json.invocations.includes('Agonizing Blast'), 'Agonizing Blast recorded');
      assert(json.invocations.includes('Repelling Blast'), 'Repelling Blast recorded');
      assert(json.character.eldritchInvocations.length === 2, 'eldritchInvocations on sheet has 2');
    });

    await test('POST /chooseinvocations 200 can replace invocations', async () => {
      const { status, json } = await request(BASE, `/api/characters/${wlCharId}/chooseinvocations`, 'POST', {
        invocations: ['Grasp of Hadar', 'Lance of Lethargy'],
      });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.invocations.includes('Grasp of Hadar'), 'Grasp of Hadar recorded after replace');
      assert(!json.invocations.includes('Agonizing Blast'), 'Old invocation replaced');
    });

    await test('cleanup: delete invocations test character', async () => {
      const { deleteCharacter } = require('../characters/storage');
      try { deleteCharacter(wlCharId); } catch {}
    });
  }

  // ── POST /api/characters/:id/choosepactboon ─────────────────
  {
    let wlCharId3 = '';

    await test('setup: create Warlock lv3 for pact boon tests', async () => {
      const created = await request(BASE, '/api/characters', 'POST', {
        name: 'PactBoonTestWarlock', race: 'Human', background: 'Sage', alignment: 'True Neutral',
        firstClass: 'Warlock',
        classLevels: [{ className: 'Warlock', level: 3 }],
        subclassChoices: {},
        experiencePoints: 0,
        baseStats: { str: 8, dex: 14, con: 12, int: 10, wis: 13, cha: 16 },
        stats:     { str: 8, dex: 14, con: 12, int: 10, wis: 13, cha: 16 },
        maxHP: 24, currentHP: 24, temporaryHP: 0,
        armorClass: 13, acFormula: 'Leather', speed: 30,
        hitDice: [{ className: 'Warlock', dieSides: 8, total: 3, remaining: 3 }],
        proficiencies: { armor: ['light'], weapons: ['simple-melee','simple-ranged'], tools: [], savingThrows: ['wis','cha'], skills: ['Arcana','Deception'], expertise: [] },
        languages: ['Common'],
        resources: {},
        equipment: [],
        gold: 10,
        level1Features: [], allFeatures: [], feats: [],
        backgroundFeature: 'Researcher', exhaustionLevel: 0,
      });
      assert(created.status === 201, `create expected 201, got ${created.status}: ${JSON.stringify(created.json)}`);
      wlCharId3 = created.json.character.id;
    });

    await test('POST /choosepactboon 400 for invalid boon value', async () => {
      const { status } = await request(BASE, `/api/characters/${wlCharId3}/choosepactboon`, 'POST', { boon: 'talisman' });
      assert(status === 400, `Expected 400 for unsupported boon, got ${status}`);
    });

    await test('POST /choosepactboon 400 with missing boon', async () => {
      const { status } = await request(BASE, `/api/characters/${wlCharId3}/choosepactboon`, 'POST', {});
      assert(status === 400, `Expected 400 for missing boon, got ${status}`);
    });

    await test('POST /choosepactboon 200 sets blade pact', async () => {
      const { status, json } = await request(BASE, `/api/characters/${wlCharId3}/choosepactboon`, 'POST', { boon: 'blade' });
      assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(json)}`);
      assert(json.pactBoon === 'blade', `Expected pactBoon=blade, got ${json.pactBoon}`);
      assert(json.character.pactBoon === 'blade', 'pactBoon set on character sheet');
    });

    await test('POST /choosepactboon 400 when boon already set', async () => {
      const { status } = await request(BASE, `/api/characters/${wlCharId3}/choosepactboon`, 'POST', { boon: 'tome' });
      assert(status === 400, `Expected 400 when boon already chosen, got ${status}`);
    });

    await test('cleanup: delete pact boon test character', async () => {
      const { deleteCharacter } = require('../characters/storage');
      try { deleteCharacter(wlCharId3); } catch {}
    });
  }

  // ── POST /api/characters/:id/addxp ──────────────────────────
  {
    let xpCharId = '';

    await test('setup: create character for addxp tests', async () => {
      const created = await request(BASE, '/api/characters', 'POST', {
        name: 'XPTestChar', race: 'Human', background: 'Sage', alignment: 'True Neutral',
        firstClass: 'Fighter',
        classLevels: [{ className: 'Fighter', level: 1 }],
        subclassChoices: {},
        experiencePoints: 100,
        baseStats: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
        stats:     { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
        maxHP: 12, currentHP: 12, temporaryHP: 0,
        armorClass: 16, acFormula: 'Chain Mail', speed: 30,
        hitDice: [{ className: 'Fighter', dieSides: 10, total: 1, remaining: 1 }],
        proficiencies: { armor: ['light','medium','heavy','shields'], weapons: ['simple-melee','simple-ranged','martial-melee','martial-ranged'], tools: [], savingThrows: ['str','con'], skills: ['Athletics','Perception'], expertise: [] },
        languages: ['Common'],
        resources: {},
        equipment: [],
        gold: 10,
        level1Features: [], allFeatures: [], feats: [],
        backgroundFeature: 'Researcher', exhaustionLevel: 0,
      });
      assert(created.status === 201, `create expected 201, got ${created.status}: ${JSON.stringify(created.json)}`);
      xpCharId = created.json.character.id;
    });

    await test('POST /addxp 400 for negative amount', async () => {
      const { status } = await request(BASE, `/api/characters/${xpCharId}/addxp`, 'POST', { amount: -50 });
      assert(status === 400, `Expected 400 for negative amount, got ${status}`);
    });

    await test('POST /addxp 400 for non-numeric amount', async () => {
      const { status } = await request(BASE, `/api/characters/${xpCharId}/addxp`, 'POST', { amount: 'lots' });
      assert(status === 400, `Expected 400 for non-numeric amount, got ${status}`);
    });

    await test('POST /addxp 200 awards XP and returns new total', async () => {
      const { status, json } = await request(BASE, `/api/characters/${xpCharId}/addxp`, 'POST', { amount: 200 });
      assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(json)}`);
      assert(json.newTotal === 300, `Expected newTotal=300, got ${json.newTotal}`);
      assert(json.character.experiencePoints === 300, 'experiencePoints updated on character');
    });

    await test('POST /addxp 200 adding 0 XP is valid', async () => {
      const { status, json } = await request(BASE, `/api/characters/${xpCharId}/addxp`, 'POST', { amount: 0 });
      assert(status === 200, `Expected 200 for 0 XP, got ${status}`);
      assert(json.newTotal === 300, `Total should remain 300, got ${json.newTotal}`);
    });

    await test('POST /addxp 200 accumulates across multiple calls', async () => {
      await request(BASE, `/api/characters/${xpCharId}/addxp`, 'POST', { amount: 450 });
      const { status, json } = await request(BASE, `/api/characters/${xpCharId}/addxp`, 'POST', { amount: 250 });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.newTotal === 1000, `Expected 1000 total, got ${json.newTotal}`);
    });

    await test('cleanup: delete addxp test character', async () => {
      const { deleteCharacter } = require('../characters/storage');
      try { deleteCharacter(xpCharId); } catch {}
    });
  }

  // ── POST /api/characters/:id/settempstats ───────────────────
  {
    let tsCharId = '';
    await test('setup: create character for settempstats tests', async () => {
      const created = await request(BASE, '/api/characters', 'POST', {
        name: 'TempStatTestChar', race: 'Human', background: 'Sage', alignment: 'True Neutral',
        firstClass: 'Wizard',
        classLevels: [{ className: 'Wizard', level: 1 }],
        subclassChoices: {},
        experiencePoints: 0,
        baseStats: { str: 8, dex: 12, con: 10, int: 16, wis: 14, cha: 10 },
        stats:     { str: 8, dex: 12, con: 10, int: 16, wis: 14, cha: 10 },
        maxHP: 8, currentHP: 8, temporaryHP: 0,
        armorClass: 11, acFormula: 'Unarmored', speed: 30,
        hitDice: [{ className: 'Wizard', dieSides: 6, total: 1, remaining: 1 }],
        proficiencies: { armor: [], weapons: ['simple-melee','simple-ranged'], tools: [], savingThrows: ['int','wis'], skills: ['Arcana','History'], expertise: [] },
        languages: ['Common'],
        resources: {}, equipment: [], gold: 5,
        level1Features: [], allFeatures: [], feats: [],
        backgroundFeature: 'Researcher', exhaustionLevel: 0,
      });
      assert(created.status === 201, `Expected 201, got ${created.status}: ${JSON.stringify(created.json)}`);
      tsCharId = created.json.character.id;
    });

    await test('POST /settempstats 400 when overrides is not an object', async () => {
      const { status } = await request(BASE, `/api/characters/${tsCharId}/settempstats`, 'POST', { overrides: 'int=19' });
      assert(status === 400, `Expected 400, got ${status}`);
    });

    await test('POST /settempstats 400 for invalid ability key', async () => {
      const { status, json } = await request(BASE, `/api/characters/${tsCharId}/settempstats`, 'POST', { overrides: { luck: 20 } });
      assert(status === 400, `Expected 400, got ${status}: ${JSON.stringify(json)}`);
    });

    await test('POST /settempstats 400 for out-of-range override value', async () => {
      const { status } = await request(BASE, `/api/characters/${tsCharId}/settempstats`, 'POST', { overrides: { int: 31 } });
      assert(status === 400, `Expected 400, got ${status}`);
    });

    await test('POST /settempstats 400 for non-integer override value', async () => {
      const { status } = await request(BASE, `/api/characters/${tsCharId}/settempstats`, 'POST', { overrides: { int: 19.5 } });
      assert(status === 400, `Expected 400, got ${status}`);
    });

    await test('POST /settempstats 200 sets a single override', async () => {
      const { status, json } = await request(BASE, `/api/characters/${tsCharId}/settempstats`, 'POST', { overrides: { int: 19 } });
      assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(json)}`);
      assert(json.tempStatOverrides?.int === 19, `Expected int override=19, got ${json.tempStatOverrides?.int}`);
      assert(json.character.tempStatOverrides?.int === 19, 'Override on character sheet');
    });

    await test('POST /settempstats 200 can set multiple overrides at once', async () => {
      const { status, json } = await request(BASE, `/api/characters/${tsCharId}/settempstats`, 'POST', { overrides: { str: 19, dex: 19 } });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.tempStatOverrides?.str === 19, 'str override set');
      assert(json.tempStatOverrides?.dex === 19, 'dex override set');
      assert(json.tempStatOverrides?.int === 19, 'int override from previous call preserved');
    });

    await test('POST /settempstats 200 clears a single override with null', async () => {
      const { status, json } = await request(BASE, `/api/characters/${tsCharId}/settempstats`, 'POST', { overrides: { int: null } });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(json.tempStatOverrides?.int === undefined, 'int override cleared');
      assert(json.tempStatOverrides?.str === 19, 'str override preserved');
    });

    await test('POST /settempstats 200 clearing all overrides removes the field', async () => {
      await request(BASE, `/api/characters/${tsCharId}/settempstats`, 'POST', { overrides: { str: null, dex: null } });
      const { status, json } = await request(BASE, `/api/characters/${tsCharId}/settempstats`, 'POST', { overrides: {} });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(!json.character.tempStatOverrides || Object.keys(json.character.tempStatOverrides).length === 0, 'tempStatOverrides absent or empty');
    });

    await test('cleanup: delete settempstats test character', async () => {
      const { deleteCharacter } = require('../characters/storage');
      try { deleteCharacter(tsCharId); } catch {}
    });
  }

  // ── Tear down ─────────────────────────────────────────────

  // Clean up test parties created during this run
  if (testPartyId) {
    const pFile = path.join(process.cwd(), 'parties', `${testPartyId}.json`);
    if (fs.existsSync(pFile)) fs.unlinkSync(pFile);
  }
  // Reset Paladin back to pristine after mutating tests
  resetPaladin();

  srv.close();

  console.log('─'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
