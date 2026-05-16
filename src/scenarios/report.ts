// ============================================================
// Results Reporter
// Formats SimulationResult as readable terminal output.
// ============================================================

import { SimulationResult, CombatantStats } from './simulate';

const BAR_WIDTH = 30;

function pct(n: number): string {
  return (n * 100).toFixed(1).padStart(5) + '%';
}

function bar(rate: number, width = BAR_WIDTH): string {
  const filled = Math.round(rate * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function pad(s: string | number, w: number, right = false): string {
  const str = String(s);
  return right
    ? str.padStart(w)
    : str.padEnd(w);
}

// ---- Main report --------------------------------------------

export function printReport(result: SimulationResult, title = 'Combat Simulation'): void {
  const line = '─'.repeat(60);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(` ${title}`);
  console.log(`${'═'.repeat(60)}`);

  // Outcome summary
  console.log(`\n  Runs: ${result.runs}`);
  console.log(`\n  Outcome`);
  console.log(`  ${line.slice(0,50)}`);
  console.log(`  Party wins  ${bar(result.partyWinRate)} ${pct(result.partyWinRate)}`);
  console.log(`  Enemy wins  ${bar(result.enemyWinRate)} ${pct(result.enemyWinRate)}`);
  if (result.drawRate > 0) {
    console.log(`  Draws       ${bar(result.drawRate)} ${pct(result.drawRate)}`);
  }

  // Round statistics
  console.log(`\n  Rounds`);
  console.log(`  ${line.slice(0,50)}`);
  console.log(`  Average  ${result.avgRounds.toFixed(2)}`);
  console.log(`  Min      ${result.minRounds}`);
  console.log(`  Max      ${result.maxRounds}`);

  // Per-combatant table
  console.log(`\n  Per-Combatant Statistics`);
  console.log(`  ${line.slice(0,50)}`);

  const hdr = `  ${ pad('Name', 24) } ${ pad('Survival', 9, true) } ${ pad('Avg Dmg', 9, true) } ${ pad('Avg HP', 7, true) }`;
  console.log(hdr);
  console.log('  ' + '─'.repeat(52));

  for (const s of result.combatantStats) {
    const name    = pad(s.name.substring(0, 23), 24);
    const surv    = pct(s.survivalRate);
    const dmg     = s.avgDamageDealt.toFixed(1).padStart(9);
    const hp      = s.avgHpRemaining.toFixed(1).padStart(7);
    console.log(`  ${name} ${surv} ${dmg} ${hp}`);
  }

  console.log(`\n${'═'.repeat(60)}\n`);
}

/**
 * Return a compact one-line summary string (useful for logging / CI).
 */
export function summaryLine(result: SimulationResult, label = ''): string {
  const tag = label ? `[${label}] ` : '';
  return (
    `${tag}n=${result.runs} ` +
    `party=${pct(result.partyWinRate)} ` +
    `enemy=${pct(result.enemyWinRate)} ` +
    `draw=${pct(result.drawRate)} ` +
    `avgRounds=${result.avgRounds.toFixed(2)}`
  );
}
