// ============================================================
// Phase 8 — HTTP API Server
// Wraps the simulation engine for the Web UI frontend.
//
// Usage: npx ts-node src/server.ts [--port 3000]
//
// Routes:
//   GET  /api/health           — liveness check
//   GET  /api/classes          — available PC classes
//   GET  /api/monsters         — available monsters with CR
//   GET  /api/presets          — named encounter presets
//   POST /api/simulate         — run custom encounter
//   POST /api/simulate/preset  — run a named preset
// ============================================================

import express, { Request, Response, NextFunction } from 'express';
import * as fs   from 'fs';
import * as path from 'path';

import characterRouter from './character_router';

import { loadBestiaryDir }                        from './data/loader';
import { loadPCStatBlocks, spawnPC, RawPCEntry }  from './parser/pc';
import { spawnMonster, Raw5etoolsMonster, rawCreatureType }         from './parser/fivetools';
import { PRESETS }                                 from './scenarios/presets';
import { simulate, CombatantStats }               from './scenarios/simulate';
import { generateHTMLReport }                         from './scenarios/html_report';
import { Combatant }                              from './types/core';
import { EncounterSpec }                          from './scenarios/encounter';

// ---- Lazy-loaded data singletons ----------------------------

let _bestiary: Map<string, Raw5etoolsMonster> | null = null;
let _pcMap: Map<string, RawPCEntry> | null = null;

function getBestiary(): Map<string, Raw5etoolsMonster> {
  if (!_bestiary) {
    const dir = path.join(__dirname, '../bestiaryData');
    _bestiary = loadBestiaryDir(dir).bestiary;
  }
  return _bestiary;
}

function getPCMap(): Map<string, RawPCEntry> {
  if (!_pcMap) {
    const candidates = [
      path.join(__dirname, '../pc_stat_blocks_lv1.json'),
      '/mnt/project/pc_stat_blocks_lv1.json',
    ];
    const p = candidates.find(c => fs.existsSync(c));
    if (!p) throw new Error('pc_stat_blocks_lv1.json not found');
    _pcMap = loadPCStatBlocks(JSON.parse(fs.readFileSync(p, 'utf-8')));
  }
  return _pcMap;
}

// ---- JSON-serialisable response types -----------------------

export interface ApiMonster {
  name: string;
  cr:   string;
  type: string;
}

export interface ApiPreset {
  id:          string;
  name:        string;
  description: string;
}

export interface ApiSimResult {
  runs:           number;
  partyWinRate:   number;
  enemyWinRate:   number;
  drawRate:       number;
  avgRounds:      number;
  minRounds:      number;
  maxRounds:      number;
  combatantStats: CombatantStats[];
  /** Round-count histogram: { 3: 12, 4: 25, … } */
  roundDistribution: Record<number, number>;
  /** Quick summary sentence for the UI */
  summary:        string;
  /** Difficulty label derived from partyWinRate */
  difficulty:     string;
}

// ---- Request body for POST /api/simulate --------------------

interface ClassConfig {
  cls:       string;          // e.g. "Fighter"
  aiProfile: Combatant['aiProfile'];
}

interface EnemyConfig {
  name:      string;          // e.g. "Goblin"
  count:     number;
  aiProfile: Combatant['aiProfile'];
}

export interface SimulateRequest {
  party:   ClassConfig[];
  enemies: EnemyConfig[];
  trials?: number;            // default 100
}

// ---- Helpers ------------------------------------------------

function crToNum(cr: string | { cr: string } | undefined): number {
  if (!cr) return 0;
  const s = typeof cr === 'string' ? cr : cr.cr;
  if (s === '1/8') return 0.125;
  if (s === '1/4') return 0.25;
  if (s === '1/2') return 0.5;
  return parseFloat(s) || 0;
}

function buildSummary(r: ApiSimResult): string {
  const pct = Math.round(r.partyWinRate * 100);
  const rounds = r.avgRounds.toFixed(1);
  if (r.partyWinRate >= 0.7)  return `Party wins ${pct}% of fights in ~${rounds} rounds.`;
  if (r.partyWinRate >= 0.4)  return `Contested — party wins ${pct}%, enemies ${Math.round(r.enemyWinRate*100)}%.`;
  if (r.enemyWinRate >= 0.7)  return `Enemies dominate — party wins only ${pct}% of fights.`;
  return `Roughly even — party ${pct}% / enemies ${Math.round(r.enemyWinRate*100)}%.`;
}

// Exported for unit-testing
export function difficultyLabel(partyWinRate: number): string {
  if (partyWinRate >= 0.90) return 'Trivial';
  if (partyWinRate >= 0.70) return 'Easy';
  if (partyWinRate >= 0.45) return 'Medium';
  if (partyWinRate >= 0.25) return 'Hard';
  if (partyWinRate >= 0.10) return 'Deadly';
  return 'TPK';
}

// ---- Express app --------------------------------------------

const app = express();

// CORS — allow local file:// and dev servers; handle preflight inline
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

app.use(express.json({ limit: '1mb' }));

// ---- Serve docs/ as static ----------------------------------
app.use(express.static(path.join(__dirname, '../docs')));

// ---- Character Sheet & Party routes (/api/characters, /api/parties)
app.use('/api', characterRouter);

// ---- GET /api/health ----------------------------------------
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---- GET /api/classes ---------------------------------------
app.get('/api/classes', (_req: Request, res: Response) => {
  try {
    const pcMap = getPCMap();
    const classes = Array.from(pcMap.keys()).sort();
    res.json({ classes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- GET /api/monsters --------------------------------------
// Returns monsters sorted by CR, filterable by ?maxCr=N
app.get('/api/monsters', (req: Request, res: Response) => {
  try {
    const bestiary = getBestiary();
    const maxCr    = req.query.maxCr !== undefined
      ? parseFloat(req.query.maxCr as string)
      : Infinity;

    const monsters: ApiMonster[] = [];
    bestiary.forEach((raw, name) => {
      const num = crToNum(raw.cr);
      if (num <= maxCr) {
        const crStr = typeof raw.cr === 'string'
          ? raw.cr
          : (raw.cr as any)?.cr ?? '?';
        // Session 53: rawCreatureType handles all 5etools type shapes
        // (string, {type:string}, {type:string[]}, {type:{choose:[...]}}, {choose:[...]}).
        // Falls back to 'unknown' for missing/empty.
        const typeStr = rawCreatureType(raw.type) || 'unknown';
        monsters.push({ name, cr: crStr, type: typeStr });
      }
    });

    // Sort by CR numeric, then alpha
    monsters.sort((a, b) => crToNum(a.cr) - crToNum(b.cr) || a.name.localeCompare(b.name));
    res.json({ monsters });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- GET /api/presets ----------------------------------------
app.get('/api/presets', (_req: Request, res: Response) => {
  const presets: ApiPreset[] = PRESETS.map(p => ({
    id:          p.id,
    name:        p.name,
    description: p.description,
  }));
  res.json({ presets });
});

// ---- POST /api/simulate -------------------------------------
app.post('/api/simulate', (req: Request, res: Response) => {
  try {
    const body = req.body as SimulateRequest;

    // Validate
    if (!Array.isArray(body.party) || body.party.length === 0) {
      return res.status(400).json({ error: 'party must be a non-empty array' });
    }
    if (!Array.isArray(body.enemies) || body.enemies.length === 0) {
      return res.status(400).json({ error: 'enemies must be a non-empty array' });
    }
    const trials = Math.min(Math.max(body.trials ?? 100, 1), 500);

    const pcMap    = getPCMap();
    const bestiary = getBestiary();

    // Build party
    const party: Combatant[] = [];
    for (const cfg of body.party) {
      const pc = spawnPC(pcMap, cfg.cls, { x: 0, y: 0, z: 0 }, cfg.aiProfile ?? 'smart');
      if (!pc) return res.status(400).json({ error: `Unknown class: ${cfg.cls}` });
      party.push(pc);
    }

    // Build enemies
    const enemies: Combatant[] = [];
    let ex = 0;
    for (const cfg of body.enemies) {
      const n = Math.min(Math.max(cfg.count ?? 1, 1), 20);
      for (let i = 0; i < n; i++) {
        const m = spawnMonster(bestiary, cfg.name, { x: ex++ * 2, y: 6, z: 0 }, cfg.aiProfile ?? 'attackNearest');
        if (!m) return res.status(400).json({ error: `Unknown monster: ${cfg.name}` });
        enemies.push(m);
      }
    }

    const spec: EncounterSpec = { party, enemies };
    const result = simulate(spec, { runs: trials });

    const out: ApiSimResult = {
      runs:           result.runs,
      partyWinRate:   result.partyWinRate,
      enemyWinRate:   result.enemyWinRate,
      drawRate:       result.drawRate,
      avgRounds:      result.avgRounds,
      minRounds:      result.minRounds,
      maxRounds:      result.maxRounds,
      combatantStats:    result.combatantStats,
      roundDistribution: result.roundDistribution,
      summary:           '',
      difficulty:        '',
    };
    out.summary    = buildSummary(out);
    out.difficulty = difficultyLabel(out.partyWinRate);

    return res.json(out);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ---- POST /api/simulate/preset --------------------------------
app.post('/api/simulate/preset', (req: Request, res: Response) => {
  try {
    const { id, trials } = req.body as { id: string; trials?: number };
    if (!id) return res.status(400).json({ error: 'id is required' });

    const preset = PRESETS.find(p => p.id === id);
    if (!preset) return res.status(404).json({ error: `Preset not found: ${id}` });

    const runs   = Math.min(Math.max(trials ?? 100, 1), 500);
    const spec   = preset.build();
    const result = simulate(spec, { runs });

    const out: ApiSimResult = {
      runs:           result.runs,
      partyWinRate:   result.partyWinRate,
      enemyWinRate:   result.enemyWinRate,
      drawRate:       result.drawRate,
      avgRounds:      result.avgRounds,
      minRounds:      result.minRounds,
      maxRounds:      result.maxRounds,
      combatantStats:    result.combatantStats,
      roundDistribution: result.roundDistribution,
      summary:           '',
      difficulty:        '',
    };
    out.summary    = buildSummary(out);
    out.difficulty = difficultyLabel(out.partyWinRate);

    return res.json(out);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ---- POST /api/simulate/report -----------------------------
// Runs a custom encounter and returns a standalone HTML report string.
// The UI opens this in a new browser tab via window.open().
app.post('/api/simulate/report', (req: Request, res: Response) => {
  try {
    const body = req.body as SimulateRequest;

    if (!Array.isArray(body.party) || body.party.length === 0) {
      return res.status(400).json({ error: 'party must be a non-empty array' });
    }
    if (!Array.isArray(body.enemies) || body.enemies.length === 0) {
      return res.status(400).json({ error: 'enemies must be a non-empty array' });
    }
    const trials = Math.min(Math.max(body.trials ?? 100, 1), 500);

    const pcMap    = getPCMap();
    const bestiary = getBestiary();

    const party: Combatant[] = [];
    for (const cfg of body.party) {
      const pc = spawnPC(pcMap, cfg.cls, { x: 0, y: 0, z: 0 }, cfg.aiProfile ?? 'smart');
      if (!pc) return res.status(400).json({ error: `Unknown class: ${cfg.cls}` });
      party.push(pc);
    }

    const enemies: Combatant[] = [];
    let ex = 0;
    for (const cfg of body.enemies) {
      const n = Math.min(Math.max(cfg.count ?? 1, 1), 20);
      for (let i = 0; i < n; i++) {
        const m = spawnMonster(bestiary, cfg.name, { x: ex++ * 2, y: 6, z: 0 }, cfg.aiProfile ?? 'attackNearest');
        if (!m) return res.status(400).json({ error: `Unknown monster: ${cfg.name}` });
        enemies.push(m);
      }
    }

    const spec: EncounterSpec = { party, enemies };
    const result = simulate(spec, { runs: trials });

    const partyIds = party.map(c => c.id);
    const title    = [
      ...body.party.map(p => p.cls),
      'vs',
      ...body.enemies.map(e => `${e.count > 1 ? e.count + 'x ' : ''}${e.name}`),
    ].join(' ');

    const html = generateHTMLReport(result, { title, partyIds });
    return res.json({ html });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ---- Start --------------------------------------------------

const PORT = (() => {
  const idx = process.argv.indexOf('--port');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : 3000;
})();

app.listen(PORT, () => {
  console.log(`[dnd-sim] Server running on http://localhost:${PORT}`);
  console.log(`[dnd-sim] Simulator UI: http://localhost:${PORT}/simulator.html`);
});

export { app };
