#!/usr/bin/env ts-node
// ============================================================
// D&D 5e Combat Sim — CLI
// Usage: npx ts-node src/index.ts [preset-id] [--runs N] [--verbose] [--output file.html]
//
// Examples:
//   npx ts-node src/index.ts                              # list presets
//   npx ts-node src/index.ts fighter-vs-larva             # run with defaults (100 runs)
//   npx ts-node src/index.ts party4-vs-3larva --runs 500
//   npx ts-node src/index.ts all12-vs-larva --runs 50 --verbose
//   npx ts-node src/index.ts fighter-vs-larva --output report.html
// ============================================================

import { PRESETS, getPreset } from './scenarios/presets';
import { simulate }            from './scenarios/simulate';
import { printReport, summaryLine } from './scenarios/report';
import { saveHTMLReport }      from './scenarios/html_report';

// ---- Parse args ---------------------------------------------

const args       = process.argv.slice(2);
const presetId   = args.find(a => !a.startsWith('--'));
const runsArg    = args.indexOf('--runs');
const runs       = runsArg !== -1 ? parseInt(args[runsArg + 1], 10) : 100;
const verbose    = args.includes('--verbose');
const outputIdx  = args.indexOf('--output');
const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : null;

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

  console.log('Usage: npx ts-node src/index.ts <preset-id> [--runs N] [--verbose] [--output file.html]\n');
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

// Run simulation
const spec   = preset.build();
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
