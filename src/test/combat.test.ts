// ============================================================
// Test: Combat Engine — integration tests
// Run: ts-node src/test/combat.test.ts
// ============================================================

import { runCombat, makeFlatBattlefield, CombatLog } from '../engine/combat';
import { monsterToCombatant, loadBestiaryJson } from '../parser/fivetools';
import { rollInitiative, applyDamage, resetBudget } from '../engine/utils';
import { Combatant, Action, Battlefield } from '../types/core';
import * as fs from 'fs';
import * as path from 'path';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, actual: T, expected: T): void {
  assert(label, actual === expected,
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(overrides: Partial<Combatant> = {}): Combatant {
  const id = `fighter_${++_id}`;
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 20, currentHP: 20, ac: 14,
    speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 12, dex: 10, con: 12, int: 8, wis: 10, cha: 8,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'attackNearest',
    perception: { targets: new Map() },
    concentration: null,
    deathSaves: null,
    mountedOn: null,
    carriedBy: null,
    independentMount: false,
    role: 'regular',
    bonded: null,
    resources: null,
    tempHP: 0,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false,
    cannotAttack: false,
    hasHands: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    ...overrides,
  };
}

/** A reliable melee attack action (avg 7 damage, +4 to hit). */
function clawAction(): Action {
  return {
    name: 'Claw', isMultiattack: false, attackType: 'melee',
    reach: 5, range: null, hitBonus: 4,
    damage: { count: 1, sides: 8, bonus: 3, average: 7 },
    damageType: 'slashing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: '',
  };
}

/** Fixed initiative order — deterministic turn sequence. */
function fixedInit(...combatants: Combatant[]): string[] {
  return combatants.map(c => c.id);
}

// ============================================================
// 1. Minimal fight: attacker vs defender, attacker goes first
// ============================================================
console.log('\n=== 1. Minimal fight — attacker wins ===\n');

{
  // Near-deterministic: +10 to hit vs AC 8 → hits on d20 ≥ 1 (only nat-1 misses, 5%)
  // avg 10 damage vs 7 HP → kills in one hit with >95% probability
  function bigClawAction(): Action {
    return { ...clawAction(), hitBonus: 10, damage: { count: 1, sides: 6, bonus: 7, average: 10 } };
  }
  const att = makeC({ id: 'att', faction: 'enemy',   pos: {x:0,y:0,z:0}, actions: [bigClawAction()] });
  const def = makeC({ id: 'def', faction: 'party',   pos: {x:1,y:0,z:0}, ac: 8, maxHP: 7, currentHP: 7, actions: [clawAction()] });
  const bf = makeFlatBattlefield(10, 10, [att, def]);

  // att goes first — with avg 7 dmg vs 7 HP, defender should die round 1
  const log = runCombat(bf, fixedInit(att, def), { maxRounds: 10 });

  assert('Combat completes (has winner)', log.winner !== null);
  // attacker goes first with avg-killing damage → enemy wins
  eq('Attacker (enemy faction) wins', log.winner, 'enemy');
  assert('Finishes quickly (≤ 2 rounds with near-certain hit)', log.rounds <= 2);

  assert('Has combat_start event',   log.events.some(e => e.type === 'combat_start'));
  assert('Has attack event',         log.events.some(e => e.type === 'attack_hit' || e.type === 'attack_crit' || e.type === 'attack_miss'));
  assert('Has damage event',         log.events.some(e => e.type === 'damage'));
  assert('Has death event',          log.events.some(e => e.type === 'death'));
  assert('Has combat_end event',     log.events.some(e => e.type === 'combat_end'));
  assert('All events have round >= 1', log.events.every(e => e.round >= 1));
  assert('All events have actorId',  log.events.every(e => e.actorId.length > 0));
}

// ============================================================
// 2. Defender goes first — party wins
// ============================================================
console.log('\n=== 2. Reversed initiative — party wins ===\n');

{
  // att2 has 7 HP / AC 10. def2 gets a guaranteed-hit, guaranteed-kill weapon (hitBonus +20,
  // min damage 11). This isolates the "initiative order matters" logic without RNG variance.
  const guaranteedOneShot: Action = {
    ...clawAction(),
    hitBonus: 20,
    damage: { count: 1, sides: 4, bonus: 10, average: 12.5 }, // min 11 > 7 HP
  };
  const att2 = makeC({ id: 'att2', faction: 'enemy', pos: {x:0,y:0,z:0}, maxHP: 7, currentHP: 7, ac: 10, actions: [clawAction()] });
  const def2 = makeC({ id: 'def2', faction: 'party', pos: {x:1,y:0,z:0}, actions: [guaranteedOneShot] });
  const bf2 = makeFlatBattlefield(10, 10, [att2, def2]);

  const log2 = runCombat(bf2, fixedInit(def2, att2), { maxRounds: 10 });

  assert('Defender faction wins going first', log2.winner === 'party', `winner=${log2.winner}`);
  assert('Quick kill (1 round guaranteed)', log2.rounds === 1, `took ${log2.rounds} rounds`);
}

// ============================================================
// 3. Multi-round fight — equal HP combatants
// ============================================================
console.log('\n=== 3. Multi-round fight ===\n');

{
  // Both have 30 HP, avg 7 dmg/turn → takes ~5 rounds
  // Attacker goes first so should win in same number of rounds
  const a = makeC({ id: 'mra', faction: 'enemy', pos: {x:0,y:0,z:0}, maxHP: 30, currentHP: 30, ac: 10, actions: [clawAction()] });
  const b = makeC({ id: 'mrb', faction: 'party', pos: {x:1,y:0,z:0}, maxHP: 30, currentHP: 30, ac: 10, actions: [clawAction()] });
  const bf3 = makeFlatBattlefield(10, 10, [a, b]);

  const log3 = runCombat(bf3, fixedInit(a, b), { maxRounds: 30 });

  assert('Multi-round: has winner', log3.winner !== null);
  assert('Multi-round: takes >1 round', log3.rounds > 1);
  assert('Multi-round: finishes in <20 rounds', log3.rounds < 20);

  const damageEvents = log3.events.filter(e => e.type === 'damage');
  assert('Multiple damage events', damageEvents.length > 2);

  // Validate event structure throughout
  for (const e of log3.events) {
    if (!['combat_start', 'combat_end', 'move', 'action', 'dash', 'dodge', 'disengage'].includes(e.type)) {
      assert(`Event "${e.type}" has round >= 1`, e.round >= 1, `round=${e.round}`);
    }
  }
}

// ============================================================
// 4. Three-way fight — 2v1
// ============================================================
console.log('\n=== 4. Two enemies vs one party member ===\n');

{
  const e1 = makeC({ id: 'e1', faction: 'enemy', pos: {x:0,y:0,z:0}, actions: [clawAction()] });
  const e2 = makeC({ id: 'e2', faction: 'enemy', pos: {x:2,y:0,z:0}, actions: [clawAction()] });
  const h  = makeC({ id: 'h1', faction: 'party', pos: {x:1,y:0,z:0}, maxHP: 10, currentHP: 10, ac: 10, actions: [clawAction()] });
  const bf4 = makeFlatBattlefield(10, 10, [e1, e2, h]);

  const log4 = runCombat(bf4, fixedInit(e1, e2, h), { maxRounds: 20 });
  eq('Two enemies overcome lone hero', log4.winner, 'enemy');
  assert('Hero dies', h.isDead || h.isUnconscious);
}

// ============================================================
// 5. Initiative order respects turn sequence
// ============================================================
console.log('\n=== 5. Initiative order — turn sequence ===\n');

{
  const first  = makeC({ id: 'first',  faction: 'enemy', pos: {x:0,y:0,z:0}, actions: [clawAction()] });
  const second = makeC({ id: 'second', faction: 'party', pos: {x:1,y:0,z:0}, maxHP: 5, currentHP: 5, ac: 10 });
  const bf5 = makeFlatBattlefield(10, 10, [first, second]);

  const log5 = runCombat(bf5, fixedInit(first, second), { maxRounds: 5 });

  // 'first' acts before 'second' — in the event log, first action should be from 'first'
  const actionEvents = log5.events.filter(e =>
    e.type !== 'combat_start' && e.type !== 'move'
  );
  assert('First actor acts first in log', actionEvents[0]?.actorId === 'first');
}

// ============================================================
// 6. No enemies → draw / instant end
// ============================================================
console.log('\n=== 6. No enemies — instant end ===\n');

{
  const solo = makeC({ id: 'solo', faction: 'party', pos: {x:0,y:0,z:0}, actions: [clawAction()] });
  const bf6 = makeFlatBattlefield(10, 10, [solo]);
  const log6 = runCombat(bf6, [solo.id], { maxRounds: 5 });

  // No enemies → party wins immediately (nobody to fight)
  assert('Solo party: party wins', log6.winner === 'party' || log6.rounds <= 1);
}

// ============================================================
// 7. Out-of-reach combatants — they move before fighting
// ============================================================
console.log('\n=== 7. Gap closing — distant combatants ===\n');

{
  // 6 squares apart (30ft) — needs 1 move to close to 5ft melee
  const far_a = makeC({ id: 'fa', faction: 'enemy', pos: {x:0,y:0,z:0}, actions: [clawAction()] });
  const far_b = makeC({ id: 'fb', faction: 'party', pos: {x:6,y:0,z:0}, maxHP: 30, currentHP: 30, ac: 10, actions: [clawAction()] });
  const bf7 = makeFlatBattlefield(20, 10, [far_a, far_b]);

  const log7 = runCombat(bf7, fixedInit(far_a, far_b), { maxRounds: 20 });

  assert('Distant fight: has winner', log7.winner !== null);
  const hasMove = log7.events.some(e => e.type === 'move');
  assert('At least one move event logged', hasMove);
}

// ============================================================
// 8. Bestiary integration — Larva (real data)
// ============================================================
console.log('\n=== 8. Bestiary integration — Larva vs custom fighter ===\n');

{
  const candidates = [
    path.join(__dirname, '../../bestiaryData/bestiary-dmg.json'),
    path.join(__dirname, '../../bestiary-dmg.json'),
    '/mnt/project/bestiary-dmg.json',
  ];
  const dataPath = candidates.find(p => fs.existsSync(p));

  if (!dataPath) {
    console.log('  ⚠️  bestiary-dmg.json not found — skipping bestiary test');
  } else {
    const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const bestiary = loadBestiaryJson(raw);
    const larvaRaw = bestiary.get('larva')!;

    const larva = monsterToCombatant(larvaRaw, {x:0,y:0,z:0}, 'attackNearest', 'enemy');
    // Custom party fighter with decent HP so fight lasts a few rounds
    const fighter = makeC({
      id: 'fighter', name: 'Fighter', faction: 'party',
      pos: {x:2,y:0,z:0}, maxHP: 15, currentHP: 15, ac: 14,
      actions: [clawAction()],
    });
    const bf8 = makeFlatBattlefield(10, 10, [larva, fighter]);
    const log8 = runCombat(bf8, fixedInit(larva, fighter), { maxRounds: 30 });

    assert('Larva fight completes', log8.winner !== null);
    assert('Larva fight: rounds > 0', log8.rounds > 0);

    // Larva Bite: +1 to hit, 1d4-1 avg 1 dmg — very weak, fighter should win
    eq('Fighter wins vs Larva', log8.winner, 'party');

    // Verify Bite was actually used
    const biteEvents = log8.events.filter(e =>
      e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit'
    );
    assert('Bite attack events exist', biteEvents.length > 0);
  }
}

// ============================================================
// 9. Perception updates — bloodied flag propagates
// ============================================================
console.log('\n=== 9. Perception — bloodied observed after damage ===\n');

{
  const observer = makeC({ id: 'obs', faction: 'enemy', pos: {x:0,y:0,z:0}, actions: [clawAction()] });
  const victim   = makeC({ id: 'vic', faction: 'party', pos: {x:1,y:0,z:0}, maxHP: 20, currentHP: 20, actions: [] });
  const bf9 = makeFlatBattlefield(10, 10, [observer, victim]);

  // Run one round — observer attacks victim
  runCombat(bf9, fixedInit(observer, victim), { maxRounds: 1 });

  // After combat, observer should have perception data on victim
  const knowledge = observer.perception.targets.get(victim.id);
  assert('Observer has perception entry for victim', knowledge !== undefined);
  if (knowledge) {
    // isBloodied reflects actual HP state after damage
    const actualBloodied = victim.currentHP < victim.maxHP * 0.5;
    eq('Bloodied flag matches actual HP', knowledge.isBloodied, actualBloodied);
    // Position updated to victim's current position
    assert('Last seen position recorded', knowledge.lastSeenPos !== undefined);
  }
}

// ============================================================
// 10. Max rounds cap — no infinite loop
// ============================================================
console.log('\n=== 10. Max rounds safety cap ===\n');

{
  // Both sides with very high AC — likely many misses but eventually ends
  // Use maxRounds:3 to test the cap
  const unkillable_a = makeC({ id: 'uk_a', faction: 'enemy', pos: {x:0,y:0,z:0}, ac: 30, maxHP: 1000, currentHP: 1000, actions: [clawAction()] });
  const unkillable_b = makeC({ id: 'uk_b', faction: 'party', pos: {x:1,y:0,z:0}, ac: 30, maxHP: 1000, currentHP: 1000, actions: [clawAction()] });
  const bf10 = makeFlatBattlefield(10, 10, [unkillable_a, unkillable_b]);

  const log10 = runCombat(bf10, fixedInit(unkillable_a, unkillable_b), { maxRounds: 3 });

  eq('Hits round cap', log10.rounds, 3);
  eq('Draw on cap', log10.winner, 'draw');
  assert('combat_end event exists', log10.events.some(e => e.type === 'combat_end'));
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
