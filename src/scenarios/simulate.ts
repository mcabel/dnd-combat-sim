// ============================================================
// Simulation Runner
// Runs an encounter N times and aggregates combat statistics.
// Resets all combatants to starting state between runs.
// ============================================================

import { Combatant }              from '../types/core';
import { EncounterSpec, buildEncounter, resetCombatant } from './encounter';
import { runCombat, CombatLog }   from '../engine/combat';
import { rollInitiative }         from '../engine/utils';

// ---- Per-run result -----------------------------------------

export interface RunResult {
  winner:      'party' | 'enemy' | 'draw';
  rounds:      number;
  /** Total damage dealt by each combatant ID over this run */
  damageDealt: Map<string, number>;
  /** Whether each combatant survived (not dead/unconscious at end) */
  survived:    Map<string, boolean>;
  /** HP remaining at end of combat, keyed by combatant ID */
  hpRemaining: Map<string, number>;
  log:         CombatLog;
}

// ---- Aggregate statistics -----------------------------------

export interface CombatantStats {
  id:   string;
  name: string;
  /** 'party' or 'enemy' */
  side: 'party' | 'enemy';
  /** Fraction of runs this combatant survived */
  survivalRate:  number;
  /** Average damage dealt per run */
  avgDamageDealt: number;
  /** Average HP remaining at end of run (including 0 for dead) */
  avgHpRemaining: number;
  /** Average rounds this combatant was alive */
  avgRoundsAlive: number;
}

export interface SimulationResult {
  runs:         number;
  partyWinRate: number;          // 0–1
  enemyWinRate: number;
  drawRate:     number;
  avgRounds:    number;
  minRounds:    number;
  maxRounds:    number;
  combatantStats: CombatantStats[];
  /** How many runs ended on each round number, e.g. { 3: 12, 4: 25 } */
  roundDistribution: Record<number, number>;
  /** Full per-run data (for detailed analysis) */
  runResults:   RunResult[];
}

// ---- Extract per-combatant data from a log -----------------

function extractRunResult(
  log: CombatLog,
  allCombatants: Combatant[]
): RunResult {
  const damageDealt = new Map<string, number>();
  const survived    = new Map<string, boolean>();
  const hpRemaining = new Map<string, number>();

  // Sum damage dealt per actor from log events
  for (const event of log.events) {
    if (event.type === 'damage' && event.value !== undefined) {
      damageDealt.set(
        event.actorId,
        (damageDealt.get(event.actorId) ?? 0) + event.value
      );
    }
  }

  // Read final state from combatants
  for (const c of allCombatants) {
    survived.set(c.id,    !c.isDead && !c.isUnconscious);
    hpRemaining.set(c.id, Math.max(0, c.currentHP));
    if (!damageDealt.has(c.id)) damageDealt.set(c.id, 0);
  }

  return {
    winner:      log.winner ?? 'draw',
    rounds:      log.rounds,
    damageDealt,
    survived,
    hpRemaining,
    log,
  };
}

// ---- Main simulation function ------------------------------

export interface SimulateOptions {
  /** Number of simulation runs (default: 100) */
  runs?:      number;
  /** Max rounds per run before declaring draw (default: 50) */
  maxRounds?: number;
  /** Print brief progress every N runs (0 = silent, default: 0) */
  logEvery?:  number;
}

/**
 * Run an encounter N times from the same starting configuration.
 * Combatants are fully reset (HP, conditions, perception) between runs.
 * Initiative is re-rolled each run for realistic variance.
 *
 * @param spec       - encounter specification (party + enemies + optional map)
 * @param options    - simulation options
 */
export function simulate(
  spec: EncounterSpec,
  options: SimulateOptions = {}
): SimulationResult {
  const { runs = 100, maxRounds = 50, logEvery = 0 } = options;

  // Capture original positions and stats before any run mutates them
  const origParty   = spec.party.map(c => ({ ...c, actions: c.actions.map(a => ({...a})), pos: {...c.pos}, conditions: new Set(c.conditions) }));
  const origEnemies = spec.enemies.map(c => ({ ...c, actions: c.actions.map(a => ({...a})), pos: {...c.pos}, conditions: new Set(c.conditions) }));

  const runResults: RunResult[] = [];
  const roundDist: Record<number, number> = {};
  let partyWins = 0, enemyWins = 0, draws = 0;
  let totalRounds = 0, minRounds = Infinity, maxRoundsActual = 0;

  for (let i = 0; i < runs; i++) {
    // Reset all combatants to original state
    const freshParty   = origParty.map(c => resetCombatant(c as Combatant));
    const freshEnemies = origEnemies.map(c => resetCombatant(c as Combatant));

    const encounter = buildEncounter({
      ...spec,
      party:   freshParty,
      enemies: freshEnemies,
    });

    const init = rollInitiative(encounter.battlefield);
    const log  = runCombat(encounter.battlefield, init, { maxRounds });

    const allFresh = [...freshParty, ...freshEnemies];
    const result   = extractRunResult(log, allFresh);
    runResults.push(result);

    if (result.winner === 'party')  partyWins++;
    else if (result.winner === 'enemy') enemyWins++;
    else draws++;

    totalRounds += result.rounds;
    roundDist[result.rounds] = (roundDist[result.rounds] ?? 0) + 1;
    if (result.rounds < minRounds)      minRounds      = result.rounds;
    if (result.rounds > maxRoundsActual) maxRoundsActual = result.rounds;

    if (logEvery > 0 && (i + 1) % logEvery === 0) {
      process.stdout.write(`  Run ${i + 1}/${runs}: party ${partyWins} | enemy ${enemyWins} | draw ${draws}\n`);
    }
  }

  // Aggregate per-combatant stats
  const allOriginal = [...origParty, ...origEnemies] as Combatant[];
  const partyIds    = new Set(origParty.map(c => c.id));
  const combatantStats: CombatantStats[] = allOriginal.map(orig => {
    let totalDmg = 0, totalHp = 0, survived = 0;

    for (const r of runResults) {
      totalDmg  += r.damageDealt.get(orig.id) ?? 0;
      totalHp   += r.hpRemaining.get(orig.id) ?? 0;
      if (r.survived.get(orig.id)) survived++;
    }

    return {
      id:             orig.id,
      name:           orig.name,
      side:           partyIds.has(orig.id) ? 'party' : 'enemy',
      survivalRate:   survived / runs,
      avgDamageDealt: totalDmg / runs,
      avgHpRemaining: totalHp / runs,
      avgRoundsAlive: 0,  // future: track per-run
    };
  });

  return {
    runs,
    partyWinRate: partyWins  / runs,
    enemyWinRate: enemyWins  / runs,
    drawRate:     draws      / runs,
    avgRounds:    totalRounds / runs,
    minRounds:    minRounds === Infinity ? 0 : minRounds,
    maxRounds:    maxRoundsActual,
    combatantStats,
    roundDistribution: roundDist,
    runResults,
  };
}
