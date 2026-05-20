#!/usr/bin/env ts-node
// ============================================================
// D&D 5e Combat Sim — CLI
// Usage: npx ts-node src/index.ts [preset-id] [options]
//
// Options:
//   --runs N              Number of simulations (default 100)
//   --verbose             Show one example fight in detail
//   --output file.html    Save HTML report
//   --mount <cls> <name>  Mount a PC class on a named creature (from summon registry)
//                         e.g. --mount Paladin Warhorse
//
// Examples:
//   npx ts-node src/index.ts                                    # list presets
//   npx ts-node src/index.ts fighter-vs-larva --runs 200
//   npx ts-node src/index.ts party4-vs-goblin-band --runs 500 --output goblins.html
//   npx ts-node src/index.ts fighter-vs-larva --mount Fighter Warhorse
// ============================================================

import { PRESETS, getPreset } from './scenarios/presets';
import { simulate }            from './scenarios/simulate';
import { printReport, summaryLine } from './scenarios/report';
import { saveHTMLReport }      from './scenarios/html_report';
import { getSummonEntry }      from './summons/registry';
import { spawnSummon }         from './summons/spawner';
import { setupMount }          from './summons/mount';
import { loadBestiaryDir }     from './data/loader';
import { loadPCStatBlocks, spawnPC, RawPCEntry } from './parser/pc';
import { buildEncounter }      from './scenarios/encounter';
import { makeFlatBattlefield } from './engine/combat';
import * as path from 'path';
import * as fs   from 'fs';

// ---- Parse args ---------------------------------------------

const args       = process.argv.slice(2);
const presetId   = args.find(a => !a.startsWith('--'));
const runsArg    = args.indexOf('--runs');
const runs       = runsArg !== -1 ? parseInt(args[runsArg + 1], 10) : 100;
const verbose    = args.includes('--verbose');
const outputIdx  = args.indexOf('--output');
const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : null;
const mountIdx   = args.indexOf('--mount');
const mountClass = mountIdx !== -1 ? args[mountIdx + 1] : null;   // e.g. 'Paladin'
const mountName  = mountIdx !== -1 ? args[mountIdx + 2] : null;   // e.g. 'Warhorse'

// ---- No preset → list all -----------------------------------

if (!presetId) {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║          D&D 5e Combat Sim — Available Presets          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  for (const p of PRESETS) {
    console.log(`  ${p.id}`);
    console.log(`    ${p.name}`);
    console.log(`    ${p.description.substring(0, 80)}${p.description.length > 80 ? '…' : ''}`);
    console.log();
  }

  // Also list available mounts
  const { SUMMON_REGISTRY } = require('./summons/registry');
  const mounts = SUMMON_REGISTRY.filter((e: any) => e.canBeMounted);
  if (mounts.length > 0) {
    console.log('Available mounts (use with --mount <PCClass> <MountName>):');
    for (const m of mounts) {
      console.log(`  ${m.name.padEnd(18)} [${m.role}] trueCR ${m.trueCR}  ${m.notes.substring(0,55)}…`);
    }
    console.log();
  }
  console.log('Usage: npx ts-node src/index.ts <preset-id> [--runs N] [--verbose] [--output file.html] [--mount PCClass MountName]\n');
  process.exit(0);
}

// ---- Run preset ---------------------------------------------

let preset;
try {
  preset = getPreset(presetId);
} catch (e) {
  console.error(`\nError: ${(e as Error).message}\n`);
  process.exit(1);
}

console.log(`\nRunning: ${preset.name} (${runs} simulations)`);
if (verbose) console.log('Verbose mode: showing one example fight\n');

// Optionally run one verbose fight first
if (verbose) {
  const { runCombat, makeFlatBattlefield } = require('./engine/combat');
  const { rollInitiative } = require('./engine/utils');
  const { buildEncounter } = require('./scenarios/encounter');

  const spec   = preset.build();
  const enc    = buildEncounter(spec);
  const init   = rollInitiative(enc.battlefield);
  const exLog  = runCombat(enc.battlefield, init, { verbose: true, maxRounds: 30 });
  console.log(`\nExample fight: winner=${exLog.winner} rounds=${exLog.rounds}\n`);
}

// ---- Optional --mount setup --------------------------------
if (mountClass && mountName) {
  const entry = getSummonEntry(mountName);
  if (!entry) {
    console.error(`\nError: "${mountName}" not found in summon registry.\n`);
    console.error('Run without a preset to list available mounts.\n');
    process.exit(1);
  }
  if (!entry.canBeMounted) {
    console.error(`\nError: "${mountName}" cannot be mounted (canBeMounted: false).\n`);
    process.exit(1);
  }
  console.log(`Mount: ${mountClass} will ride ${mountName} (${entry.role}, trueCR ${entry.trueCR})\n`);
}

// Run simulation
const spec   = preset.build();

// Apply mount if requested — mutate the spec's party for each run
if (mountClass && mountName) {
  const bestiaryResult = loadBestiaryDir(path.join(__dirname, '../bestiaryData'));
  const rider = spec.party.find(c => c.name.toLowerCase().includes(mountClass.toLowerCase()));
  if (!rider) {
    console.error(`\nError: No "${mountClass}" found in preset party. Available: ${spec.party.map(c => c.name).join(', ')}\n`);
    process.exit(1);
  }
  const mount = spawnSummon(bestiaryResult.bestiary, mountName!, { faction: 'party' });
  if (!mount) {
    console.error(`\nError: "${mountName}" not found in bestiaryData/. Download its bestiary JSON and add it.\n`);
    process.exit(1);
  }
  // Add mount to party — encounter builder + simulate() will reset and re-setup each run
  spec.party.push(mount);
  // Record the rider-mount pair for post-build setup
  (spec as any).__mountPair = { riderId: rider.id, mountId: mount.id };
  console.log(`  ${rider.name} [${rider.id}] will mount ${mount.name} [${mount.id}]`);
}

const result = simulate(spec, { runs, maxRounds: 50, logEvery: verbose ? runs : 0 });

printReport(result, preset.name);
console.log(summaryLine(result, presetId));
console.log();

// ---- Optional HTML report -----------------------------------
if (outputFile) {
  const spec2 = preset.build();
  const partyIds = spec2.party.map(c => c.id);
  const saved = saveHTMLReport(result, outputFile, { title: preset.name, partyIds });
  console.log(`HTML report saved → ${saved}\n`);
}
