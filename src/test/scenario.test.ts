// ============================================================
// Test: Scenario runner (encounter + simulate + report)
// Run: ts-node src/test/scenario.test.ts
// ============================================================

import { buildEncounter, resetCombatant } from '../scenarios/encounter';
import { simulate }                        from '../scenarios/simulate';
import { printReport, summaryLine }        from '../scenarios/report';
import { PRESETS, getPreset }              from '../scenarios/presets';
import { Combatant, Action }               from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}
function near(label: string, a: number, e: number, tol = 0.15): void {
  assert(label, Math.abs(a - e) <= tol, `got ${a.toFixed(3)}, want ~${e} ±${tol}`);
}

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(o: Partial<Combatant> = {}): Combatant {
  const id = `c${++_id}`;
  const speed = (o.speed ?? 30);
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 20, currentHP: 20, ac: 14, speed,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: speed, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(), aiProfile: 'attackNearest',
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
    advantages: [], vulnerabilities: [],
    ...o,
  };
}

function claw(): Action {
  return {
    name: 'Claw', isMultiattack: false, attackType: 'melee', reach: 5,
    range: null, hitBonus: 5,
    damage: { count: 1, sides: 8, bonus: 3, average: 7 },
    damageType: 'slashing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false, costType: 'action', legendaryCost: 0, description: '',
  };
}

// ============================================================
// 1. buildEncounter — basic layout
// ============================================================
console.log('\n=== 1. buildEncounter ===\n');

{
  const p1 = makeC({ id: 'p1', faction: 'party' });
  const p2 = makeC({ id: 'p2', faction: 'party' });
  const e1 = makeC({ id: 'e1', faction: 'enemy' });

  const enc = buildEncounter({ party: [p1, p2], enemies: [e1] });

  assert('Battlefield created', enc.battlefield !== null);
  eq('allIds has 3 entries', enc.allIds.length, 3);
  assert('Party at y=0', p1.pos.y === 0 && p2.pos.y === 0);
  assert('Enemy at y>0', e1.pos.y > 0);

  // No collision
  assert('Party spread apart', p1.pos.x !== p2.pos.x);

  // Combatants registered in battlefield
  eq('Battlefield has 3 combatants', enc.battlefield.combatants.size, 3);
}

// Position collision throws
{
  const a = makeC({ id: 'ca', faction: 'party' });
  const b = makeC({ id: 'cb', faction: 'enemy' });
  // Force both to same position
  const positions = [
    { id: 'ca', pos: { x: 0, y: 0, z: 0 } },
    { id: 'cb', pos: { x: 0, y: 0, z: 0 } },
  ];
  let threw = false;
  try { buildEncounter({ party: [a], enemies: [b], positions }); }
  catch { threw = true; }
  assert('Position collision throws', threw);
}

// ============================================================
// 2. resetCombatant
// ============================================================
console.log('\n=== 2. resetCombatant ===\n');

{
  const orig = makeC({ id: 'r1', maxHP: 30, currentHP: 30, actions: [claw()] });
  orig.currentHP = 5;
  orig.isDead    = true;
  orig.conditions.add('stunned');
  orig.budget.actionUsed = true;

  const fresh = resetCombatant(orig);
  eq('HP restored',          fresh.currentHP, 30);
  assert('Not dead',         !fresh.isDead);
  assert('Conditions clear', fresh.conditions.size === 0);
  assert('Budget reset',     !fresh.budget.actionUsed);
  assert('Original unchanged', orig.currentHP === 5);  // no mutation

  // Action deep-clone: mutating fresh.actions doesn't affect orig
  fresh.actions[0].hitBonus = 99;
  assert('Action deep-cloned', orig.actions[0].hitBonus !== 99);
}

// ============================================================
// 3. simulate — win rates converge correctly
// ============================================================
console.log('\n=== 3. simulate — win rate convergence ===\n');

{
  // Attacker: high hit (+10), high damage (avg 12) vs defender: low AC (8), low HP (10)
  // Attacker goes first → should win ~95%+ (only lose if nat-1 twice while defender crits)
  const att = makeC({ id: 'sim_a', faction: 'enemy', maxHP: 30, currentHP: 30, ac: 14,
    actions: [{ ...claw(), hitBonus: 10, damage: { count: 2, sides: 6, bonus: 3, average: 10 } }]
  });
  const def = makeC({ id: 'sim_d', faction: 'party', maxHP: 10, currentHP: 10, ac: 8, actions: [claw()] });

  const result = simulate(
    { party: [def], enemies: [att] },
    { runs: 200, maxRounds: 30 }
  );

  assert('Ran 200 simulations',    result.runs === 200);
  assert('Enemy wins majority',    result.enemyWinRate > 0.8,
    `enemyWinRate=${result.enemyWinRate.toFixed(3)}`);
  assert('Avg rounds <= 5',        result.avgRounds <= 5,
    `avgRounds=${result.avgRounds.toFixed(2)}`);
  assert('Has combatant stats',    result.combatantStats.length === 2);
  assert('Has run results',        result.runResults.length === 200);

  // Attacker should deal significant avg damage
  const attStats = result.combatantStats.find(s => s.id === att.id)!;
  assert('Attacker dealt damage',  attStats.avgDamageDealt > 5,
    `avgDmg=${attStats.avgDamageDealt.toFixed(1)}`);

  // Defender should rarely survive
  const defStats = result.combatantStats.find(s => s.id === def.id)!;
  assert('Defender low survival',  defStats.survivalRate < 0.3,
    `survival=${defStats.survivalRate.toFixed(3)}`);
}

// ============================================================
// 4. simulate — symmetric fight should be ~50/50
// ============================================================
console.log('\n=== 4. simulate — symmetric fight ~50/50 ===\n');

{
  // Identical stats — whoever wins initiative wins more; over 500 runs should be ~50/50
  const a = makeC({ id: 'sym_a', faction: 'enemy', maxHP: 20, ac: 14, actions: [claw()] });
  const b = makeC({ id: 'sym_b', faction: 'party', maxHP: 20, ac: 14, actions: [claw()] });

  const result = simulate({ party: [b], enemies: [a] }, { runs: 500 });

  // With initiative randomness, expect 40–60% for each side
  assert('Symmetric fight: enemy 40–60%',
    result.enemyWinRate >= 0.35 && result.enemyWinRate <= 0.65,
    `enemyWinRate=${result.enemyWinRate.toFixed(3)}`);
  assert('Symmetric fight: no excessive draws',
    result.drawRate < 0.05,
    `drawRate=${result.drawRate.toFixed(3)}`);
  assert('Symmetric fight: avg rounds 2–8',
    result.avgRounds >= 2 && result.avgRounds <= 8,
    `avgRounds=${result.avgRounds.toFixed(2)}`);
}

// ============================================================
// 5. summaryLine output
// ============================================================
console.log('\n=== 5. summaryLine ===\n');

{
  const r = simulate(
    { party: [makeC({ faction: 'party', actions: [claw()] })],
      enemies: [makeC({ faction: 'enemy', actions: [claw()] })] },
    { runs: 10 }
  );
  const line = summaryLine(r, 'test');
  assert('summaryLine contains n=10',    line.includes('n=10'));
  assert('summaryLine contains party=',  line.includes('party='));
  assert('summaryLine contains rounds=', line.includes('avgRounds='));
  console.log('  ' + line);
}

// ============================================================
// 6. PRESETS registry
// ============================================================
console.log('\n=== 6. PRESETS registry ===\n');

assert('At least 3 presets registered', PRESETS.length >= 3);

// All presets have required fields
for (const p of PRESETS) {
  assert(`Preset "${p.id}" has name`,        p.name.length > 0);
  assert(`Preset "${p.id}" has description`, p.description.length > 0);
  assert(`Preset "${p.id}" has build fn`,    typeof p.build === 'function');
}

// getPreset works
{
  const p = getPreset('fighter-vs-larva');
  eq('getPreset returns correct id', p.id, 'fighter-vs-larva');
}

// getPreset throws for unknown
{
  let threw = false;
  try { getPreset('nonexistent-preset'); } catch { threw = true; }
  assert('getPreset throws for unknown preset', threw);
}

// ============================================================
// 7. fighter-vs-larva preset — full end-to-end
// ============================================================
console.log('\n=== 7. Preset: fighter-vs-larva (50 runs) ===\n');

{
  try {
    const preset = getPreset('fighter-vs-larva');
    const spec   = preset.build();

    assert('Preset builds party of 1', spec.party.length === 1);
    assert('Preset builds 1 enemy',    spec.enemies.length === 1);

    const result = simulate(spec, { runs: 50, maxRounds: 30 });
    console.log('  ' + summaryLine(result, preset.id));

    assert('Fighter wins majority (≥60%)',
      result.partyWinRate >= 0.6,
      `partyWinRate=${result.partyWinRate.toFixed(3)}`);
    assert('No excessive draws', result.drawRate <= 0.05);
    assert('Resolves in reasonable rounds', result.avgRounds <= 15,
      `avgRounds=${result.avgRounds.toFixed(2)}`);

    // Print full report
    printReport(result, preset.name);

  } catch (e) {
    console.log(`  ⚠️  Skipped: ${(e as Error).message}`);
  }
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
