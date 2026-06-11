// ============================================================
// Day Simulation — Phase 8-H
// Runs a full adventuring day: multiple combat encounters with
// short rests in between and a long rest at the end.
//
// Ruleset: PHB 2014 p.186 (Short Rest), p.186 (Long Rest),
//          p.186 (Hit Dice), DMG p.82-84 (Adventuring Day XP).
//
// Design:
//   - Party members are mutated in-place across encounters.
//     HP attrition, spent spell slots, and used class resources
//     persist from fight to fight.
//   - Enemy groups are always fresh (full HP/resources).
//   - Short rest decision AI: take a rest when avg party HP < 60%
//     or a key short-rest resource (pact slots, second wind) has
//     been depleted, up to maxShortRests times per day.
//   - Between encounters: clear conditions, concentration, active
//     spell effects, and rage. HP and spell slots carry over.
//   - Long rest at end of day: fully restores HP + resources.
// ============================================================

import { Combatant, Vec3 }              from '../types/core';
import { EncounterSpec, buildEncounter, resetCombatant } from './encounter';
import { runCombat, CombatLog }          from '../engine/combat';
import { rollInitiative, shortRest, spendHitDiceOnRest, longRest } from '../engine/utils';

// ---- Types --------------------------------------------------

/** One group of enemies the party faces during the day. */
export interface EncounterWave {
  enemies:    Combatant[];
  /** Human-readable label, e.g. "The Goblin Ambush" */
  label?:     string;
  mapWidth?:  number;
  mapHeight?: number;
  /** Override starting positions for this encounter */
  positions?: { id: string; pos: Vec3 }[];
}

/** Specification for a full adventuring day. */
export interface DaySpec {
  party:          Combatant[];
  waves:          EncounterWave[];
  /** Max short rests the party can take during the day. Default 2. */
  maxShortRests?: number;
  /**
   * Avg party HP fraction below which the AI triggers a short rest.
   * Default 0.6 (60%). Must be > 0 and <= 1.
   */
  shortRestThreshold?: number;
  /**
   * Target HP fraction for hit dice spending during a short rest.
   * Keep spending hit dice until HP >= targetFraction * maxHP.
   * Default 0.75 (75%).
   */
  hitDiceTargetFraction?: number;
}

/** Snapshot of one party member's state at a point in the day. */
export interface PartyMemberSnapshot {
  id:            string;
  name:          string;
  currentHP:     number;
  maxHP:         number;
  isDead:        boolean;
  isUnconscious: boolean;
  hitDiceRemaining:   number | null;  // null if not tracked
  spellSlotsRemaining: Record<number, number>;  // level → remaining (empty for non-casters)
}

/** Outcome of one encounter during the day. */
export interface EncounterOutcome {
  index:              number;
  label:              string;
  winner:             'party' | 'enemy' | 'draw';
  rounds:             number;
  shortRestTaken:     boolean;
  hitDiceSpent:       number;
  /** Party state immediately after this encounter (and any rest taken). */
  partyAfter:         PartyMemberSnapshot[];
  log:                CombatLog;
}

/** Result of a full day simulation. */
export interface DayResult {
  outcomes:         EncounterOutcome[];
  shortRestsUsed:   number;
  /** True if all party members are dead or unconscious. */
  partyWiped:       boolean;
  /** Index of the encounter where the party was wiped, or null if they survived. */
  wipedAtEncounter: number | null;
  totalRounds:      number;
  /** State of the surviving party at end of day (after any long rest). */
  survivingParty:   PartyMemberSnapshot[];
}

// ---- Helpers ------------------------------------------------

/**
 * Snapshot the current state of a list of party members.
 */
function snapshotParty(party: Combatant[]): PartyMemberSnapshot[] {
  return party.map(c => {
    const spellSlotsRemaining: Record<number, number> = {};
    if (c.resources?.spellSlots) {
      for (const [lvl, slot] of Object.entries(c.resources.spellSlots)) {
        spellSlotsRemaining[parseInt(lvl)] = slot.remaining;
      }
    }
    return {
      id:               c.id,
      name:             c.name,
      currentHP:        c.currentHP,
      maxHP:            c.maxHP,
      isDead:           c.isDead,
      isUnconscious:    c.isUnconscious,
      hitDiceRemaining: c.resources?.hitDice?.remaining ?? null,
      spellSlotsRemaining,
    };
  });
}

/**
 * Decide whether the party should take a short rest.
 *
 * Returns true when:
 *   1. Short rests remain (shortRestsUsed < maxShortRests), AND
 *   2. At least one living party member exists, AND
 *   3. Average living-party HP is below threshold, OR
 *      a key short-rest resource (pact slots, second wind) is depleted.
 */
function shouldTakeShortRest(
  party:           Combatant[],
  shortRestsUsed:  number,
  maxShortRests:   number,
  threshold:       number,
): boolean {
  if (shortRestsUsed >= maxShortRests) return false;

  const living = party.filter(c => !c.isDead && !c.isUnconscious);
  if (living.length === 0) return false;

  // Check average HP fraction
  const avgHpFrac = living.reduce((sum, c) => sum + c.currentHP / c.maxHP, 0) / living.length;
  if (avgHpFrac < threshold) return true;

  // Check short-rest-recovering resources
  return living.some(c => {
    const r = c.resources;
    if (!r) return false;
    if (r.pactSlots && r.pactSlots.remaining < r.pactSlots.max) return true;
    if (r.secondWind && r.secondWind.remaining < r.secondWind.max) return true;
    if (r.hitDice && r.hitDice.remaining > 0 && c.currentHP < c.maxHP * 0.9) return true;
    return false;
  });
}

/**
 * Reset per-encounter transient state on a party member without touching
 * HP, spell slots, or class resources (which persist through the day).
 *
 * Clears: conditions, concentration, active effects, rage resistances,
 *         temp HP, advantage/disadvantage entries, and action budget.
 * Preserves: currentHP, resources (slots/rage charges/etc.), isDead,
 *             isUnconscious, deathSaves.
 */
function resetBetweenEncounters(c: Combatant): void {
  c.conditions    = new Set();
  c.concentration = null;
  c.activeEffects = [];
  c.wardingBond   = null;
  c.tempHP        = 0;
  c.advantages    = [];
  c.vulnerabilities = [];
  c.usedSneakAttackThisTurn = false;
  c.helpedThisTurn = false;
  c.legendaryActionPool = c.legendaryActionPoolMax;
  c.perception    = { targets: new Map() };

  // If rage was still active at end of combat, deactivate it and strip its
  // resistances. The engine removes them on rage-end tick, but combat may have
  // ended before the Barbarian's next turn.
  const r = c.resources;
  if (r?.rage?.active) {
    r.rage.active = false;
    r.rage.roundsRemaining = 0;
    c.resistances = c.resistances.filter(
      dt => dt !== 'bludgeoning' && dt !== 'piercing' && dt !== 'slashing'
    );
  }

  // Reset action budget for the upcoming fight
  c.budget = {
    movementFt:      c.speed,
    actionUsed:      false,
    bonusActionUsed: false,
    reactionUsed:    false,
    freeObjectUsed:  false,
  };
}

/**
 * After a short rest, a stable (unconscious-but-not-dead) party member
 * regains 1 HP and wakes up. PHB p.197 + p.186 (rest = 1 hour).
 */
function reviveStableOnRest(party: Combatant[]): void {
  for (const c of party) {
    if (c.isUnconscious && !c.isDead && c.deathSaves) {
      c.currentHP    = 1;
      c.isUnconscious = false;
      c.deathSaves   = { successes: 0, failures: 0 };
    }
  }
}

// ---- Main ---------------------------------------------------

/**
 * Simulate a full adventuring day.
 *
 * The party faces each wave in order. Their HP and class resources persist
 * between encounters (attrition). After each party victory the AI decides
 * whether to take a short rest. A long rest is NOT automatically applied at
 * the end — call longRest() on each party member if needed.
 *
 * @param spec - DaySpec with party, waves, and rest configuration
 * @returns DayResult with per-encounter outcomes and final party state
 */
export function runDay(spec: DaySpec): DayResult {
  const {
    party,
    waves,
    maxShortRests        = 2,
    shortRestThreshold   = 0.60,
    hitDiceTargetFraction = 0.75,
  } = spec;

  if (waves.length === 0) {
    throw new Error('runDay: must have at least one encounter wave');
  }

  // Work with the original party objects (mutations persist across encounters)
  const activeParty = party;

  const outcomes:      EncounterOutcome[] = [];
  let   shortRestsUsed = 0;
  let   totalRounds    = 0;

  for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
    const wave = waves[waveIdx];
    const label = wave.label ?? `Encounter ${waveIdx + 1}`;

    // Fresh enemies for each encounter
    const freshEnemies = wave.enemies.map(e => resetCombatant(e));

    // Participating party: exclude already-dead members
    const participatingParty = activeParty.filter(c => !c.isDead);

    // Clear transient per-encounter state on all participants
    for (const c of participatingParty) {
      resetBetweenEncounters(c);
    }

    if (participatingParty.length === 0) {
      // Everyone is dead — day ends
      return {
        outcomes,
        shortRestsUsed,
        partyWiped:       true,
        wipedAtEncounter: waveIdx,
        totalRounds,
        survivingParty:   snapshotParty(activeParty),
      };
    }

    // Build and run the encounter (party members are mutated in place)
    const encounterSpec: EncounterSpec = {
      party:     participatingParty,
      enemies:   freshEnemies,
      mapWidth:  wave.mapWidth,
      mapHeight: wave.mapHeight,
      positions: wave.positions,
    };

    const encounter = buildEncounter(encounterSpec);
    const initiative = rollInitiative(encounter.battlefield);
    const log = runCombat(encounter.battlefield, initiative);

    totalRounds += log.rounds ?? 0;

    // Determine if the party was wiped
    const stillAlive   = participatingParty.filter(c => !c.isDead && !c.isUnconscious);
    const partyWiped   = stillAlive.length === 0;
    const partyWon     = log.winner === 'party';

    // Short rest decision — only if party won and rests remain
    let shortRestTaken = false;
    let hitDiceSpent   = 0;

    if (partyWon && !partyWiped) {
      if (shouldTakeShortRest(activeParty, shortRestsUsed, maxShortRests, shortRestThreshold)) {
        shortRestsUsed++;
        shortRestTaken = true;

        // Apply short rest to all living (not dead) party members
        for (const c of activeParty.filter(c => !c.isDead)) {
          shortRest(c);
          hitDiceSpent += spendHitDiceOnRest(c, hitDiceTargetFraction);
        }

        // Stable (unconscious) party members recover 1 HP and wake up
        reviveStableOnRest(activeParty);
      }
    }

    const snapshot = snapshotParty(activeParty);

    outcomes.push({
      index:          waveIdx,
      label,
      winner:         log.winner ?? 'draw',
      rounds:         log.rounds,
      shortRestTaken,
      hitDiceSpent,
      partyAfter:     snapshot,
      log,
    });

    // If party was wiped or lost, stop processing further waves
    if (partyWiped || !partyWon) {
      return {
        outcomes,
        shortRestsUsed,
        partyWiped:       partyWiped || activeParty.every(c => c.isDead || c.isUnconscious),
        wipedAtEncounter: partyWiped ? waveIdx : null,
        totalRounds,
        survivingParty:   snapshot,
      };
    }
  }

  // Completed all waves successfully
  return {
    outcomes,
    shortRestsUsed,
    partyWiped:       false,
    wipedAtEncounter: null,
    totalRounds,
    survivingParty:   snapshotParty(activeParty),
  };
}

/**
 * Apply a long rest to every party member.
 * Exported for convenience — call after runDay() to restore the party
 * for the next day's simulation.
 */
export function applyLongRest(party: Combatant[]): void {
  for (const c of party) {
    longRest(c);
    // Reset death saves (long rest fully restores)
    if (c.isPlayer) {
      c.isDead        = false;
      c.isUnconscious = false;
      c.deathSaves    = { successes: 0, failures: 0 };
    }
  }
}
