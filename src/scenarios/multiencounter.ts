// ============================================================
// Multi-Encounter Simulation (Phase 5.5)
// Runs a sequence of encounters with optional short/long rests
// between them, tracking resource depletion across the day.
// ============================================================

import { Combatant }            from '../types/core';
import { EncounterSpec }        from './encounter';
import { simulate, SimulationResult, SimulateOptions } from './simulate';
import { shortRest, longRest }  from '../engine/utils';

// ---- Types --------------------------------------------------

export type RestType = 'none' | 'short' | 'long';

export interface EncounterInSequence {
  label:    string;
  spec:     EncounterSpec;
  restAfter: RestType;   // rest applied after this encounter (before the next)
}

export interface DayResult {
  encounters:     SimulationResult[];
  labels:         string[];
  /** Resource state of the party after each encounter (before rest) */
  resourceSnapshots: ResourceSnapshot[][];
}

export interface ResourceSnapshot {
  combatantId:   string;
  name:          string;
  hpPercent:     number;            // avg currentHP / maxHP across runs
  slotsUsed:     number;            // avg spell slots consumed
  rageUsed:      number;            // avg rage uses spent
}

// ---- Main function ------------------------------------------

/**
 * Simulate a sequence of encounters ("adventuring day").
 * Party resources deplete across encounters; rests restore them.
 *
 * @param party    - party members (reset to full before the first encounter)
 * @param sequence - ordered list of encounters with rest instructions
 * @param opts     - simulation options (runs, maxRounds)
 */
export function simulateDay(
  party: Combatant[],
  sequence: EncounterInSequence[],
  opts: SimulateOptions = {}
): DayResult {
  const { runs = 50 } = opts;

  const results:   SimulationResult[]    = [];
  const labels:    string[]              = [];
  const snapshots: ResourceSnapshot[][]  = [];

  for (const enc of sequence) {
    labels.push(enc.label);

    // Run this encounter
    const result = simulate(enc.spec, { ...opts, runs });
    results.push(result);

    // Snapshot resource state (averaged over last run — approximate)
    // In a true multi-encounter sim, resources carry between encounters.
    // For now: snapshot the party spec's state after the final reset.
    const snap: ResourceSnapshot[] = party.map(c => ({
      combatantId: c.id,
      name:        c.name,
      hpPercent:   result.combatantStats.find(s => s.id === c.id)?.avgHpRemaining ?? 0,
      slotsUsed:   0, // TODO: track slot consumption per run
      rageUsed:    0,
    }));
    snapshots.push(snap);

    // Apply rest to party members
    if (enc.restAfter === 'short') {
      for (const c of party) shortRest(c);
    } else if (enc.restAfter === 'long') {
      for (const c of party) longRest(c);
    }
    // 'none': resources carry over as-is (depleted)
  }

  return { encounters: results, labels, resourceSnapshots: snapshots };
}

// ---- Report -------------------------------------------------

export function printDayReport(day: DayResult): void {
  const line = '─'.repeat(55);
  console.log(`\n${'═'.repeat(55)}`);
  console.log(' Adventuring Day Report');
  console.log(`${'═'.repeat(55)}`);

  for (let i = 0; i < day.labels.length; i++) {
    const r = day.encounters[i];
    const pct = (n: number) => (n * 100).toFixed(1) + '%';
    console.log(`\n  ${i + 1}. ${day.labels[i]}`);
    console.log(`  ${line}`);
    console.log(`  Party wins:  ${pct(r.partyWinRate)}  |  Avg rounds: ${r.avgRounds.toFixed(1)}`);
    console.log(`  Enemy wins:  ${pct(r.enemyWinRate)}  |  Draw: ${pct(r.drawRate)}`);
  }

  console.log(`\n${'═'.repeat(55)}\n`);
}
