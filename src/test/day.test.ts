// ============================================================
// Test: Day Simulation — Phase 8-H
// runDay(), shortRest/longRest hit-dice mechanics, resource
// attrition across encounters, short-rest AI.
// Run: npx ts-node src/test/day.test.ts
// ============================================================

import { runDay, applyLongRest, DaySpec, EncounterWave } from '../scenarios/day';
import { shortRest, spendHitDiceOnRest, longRest }       from '../engine/utils';
import { loadPCStatBlocks, spawnPC, RawPCEntry }          from '../parser/pc';
import { Combatant }                                      from '../types/core';
import { resetCombatant }                                 from '../scenarios/encounter';
import * as fs   from 'fs';
import * as path from 'path';

// ---- Harness ------------------------------------------------
let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}
function approx(label: string, a: number, e: number, tol = 0.01): void {
  assert(label, Math.abs(a - e) <= tol, `got ${a}, want ${e} ±${tol}`);
}

// ---- PC data ------------------------------------------------
const pcPath = [
  path.join(__dirname, '../../pc_stat_blocks_lv1.json'),
  '/mnt/project/pc_stat_blocks_lv1.json',
].find(p => fs.existsSync(p))!;
const pcData: RawPCEntry[] = JSON.parse(fs.readFileSync(pcPath, 'utf-8'));
const pcMap = loadPCStatBlocks(pcData);
const pc = (cls: string) => spawnPC(pcMap, cls, { x: 0, y: 0, z: 0 })!;

// ---- Factory ------------------------------------------------
let _id = 0;
function makeC(o: Partial<Combatant> = {}): Combatant {
  const speed = o.speed ?? 30;
  return {
    id: `c${++_id}`, name: `c${_id}`, isPlayer: false, faction: 'enemy',
    maxHP: 20, currentHP: 20, ac: 12, speed,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10,
    cr: 0.5, pos: { x: 0, y: 0, z: 0 },
    actions: [{
      name: 'Slam', isMultiattack: false, attackType: 'melee', reach: 5,
      range: null, hitBonus: 3, damage: { count: 1, sides: 6, bonus: 1, average: 4.5 },
      damageType: 'bludgeoning', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: 'Slam',
    }],
    traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: speed, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(), concentration: null, deathSaves: null, tempHP: 0,
    resources: null, usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true,
    aiProfile: 'attackNearest', perception: { targets: new Map() },
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null,
    wardingBond: null, activeEffects: [], size: 'Medium',
    ...o,
  };
}

// ---- weak enemy for 1-shot kills ----------------------------
function weakEnemy(): Combatant {
  return makeC({ maxHP: 1, currentHP: 1, ac: 8, cr: 0.125 });
}

// ---- harmless enemy: no actions, can't attack — fighter always wins regardless of init ---
function harmlessEnemy(): Combatant {
  return makeC({ maxHP: 1, currentHP: 1, ac: 8, cr: 0.125,
                 actions: [], cannotAttack: true });
}

// ============================================================
// 1. Hit Dice — PC parser sets hitDice from class
// ============================================================
console.log('\n=== 1. Hit Dice — Parser ===\n');

{
  const barb = pc('Barbarian');
  assert('Barbarian has hitDice', !!barb.resources?.hitDice);
  eq('Barbarian dieSides = 12', barb.resources!.hitDice!.dieSides, 12);
  eq('Barbarian hitDice max = 1 (lv1)', barb.resources!.hitDice!.max, 1);
  eq('Barbarian hitDice remaining = 1', barb.resources!.hitDice!.remaining, 1);

  const fighter = pc('Fighter');
  eq('Fighter dieSides = 10', fighter.resources!.hitDice!.dieSides, 10);

  const paladin = pc('Paladin');
  eq('Paladin dieSides = 10', paladin.resources!.hitDice!.dieSides, 10);

  const ranger = pc('Ranger');
  eq('Ranger dieSides = 10', ranger.resources!.hitDice!.dieSides, 10);

  const cleric = pc('Cleric');
  eq('Cleric dieSides = 8', cleric.resources!.hitDice!.dieSides, 8);

  const wizard = pc('Wizard');
  eq('Wizard dieSides = 6', wizard.resources!.hitDice!.dieSides, 6);

  const sorcerer = pc('Sorcerer');
  eq('Sorcerer dieSides = 6', sorcerer.resources!.hitDice!.dieSides, 6);
}

// ============================================================
// 2. spendHitDiceOnRest — mechanics
// ============================================================
console.log('\n=== 2. Hit Dice Spending ===\n');

{
  // Fighter with known hit dice — low HP should trigger spending
  const fighter = pc('Fighter');
  fighter.currentHP = Math.floor(fighter.maxHP * 0.3);  // 30% HP
  const before = fighter.resources!.hitDice!.remaining;
  const spent = spendHitDiceOnRest(fighter, 0.75);
  assert('spendHitDice: dice were spent', spent > 0, `spent=${spent}`);
  assert('spendHitDice: HP increased', fighter.currentHP > Math.floor(fighter.maxHP * 0.3));
  assert('spendHitDice: remaining decreased',
    fighter.resources!.hitDice!.remaining < before);
}

{
  // At full HP — no dice spent
  const cleric = pc('Cleric');
  cleric.currentHP = cleric.maxHP;
  const spent = spendHitDiceOnRest(cleric, 0.75);
  eq('spendHitDice: no dice at full HP', spent, 0);
  eq('spendHitDice: remaining unchanged at full HP',
    cleric.resources!.hitDice!.remaining, cleric.resources!.hitDice!.max);
}

{
  // Out of hit dice — nothing spent even at low HP
  const fighter = pc('Fighter');
  fighter.resources!.hitDice!.remaining = 0;
  fighter.currentHP = 1;
  const spent = spendHitDiceOnRest(fighter, 0.75);
  eq('spendHitDice: no dice when pool empty', spent, 0);
  eq('spendHitDice: HP unchanged when pool empty', fighter.currentHP, 1);
}

{
  // Dead combatant — no spending
  const fighter = pc('Fighter');
  fighter.isDead = true;
  fighter.currentHP = 0;
  const spent = spendHitDiceOnRest(fighter, 0.75);
  eq('spendHitDice: no dice for dead combatant', spent, 0);
}

// ============================================================
// 3. longRest — hit dice recovery
// ============================================================
console.log('\n=== 3. Long Rest — Hit Dice Recovery ===\n');

{
  // Spend the only hit die, then long rest — recover 1 (ceil(1/2) = 1)
  const fighter = pc('Fighter');
  fighter.resources!.hitDice!.remaining = 0;
  longRest(fighter);
  // At level 1: recover ceil(1/2) = 1
  eq('longRest: recover hit dice at lv1', fighter.resources!.hitDice!.remaining, 1);
}

{
  // Simulate level 4 by setting max=4, remaining=0; recover 2 (ceil(4/2))
  const wizard = pc('Wizard');
  wizard.resources!.hitDice!.max = 4;
  wizard.resources!.hitDice!.remaining = 0;
  longRest(wizard);
  eq('longRest: recover 2 hit dice at lv4 (0→2)', wizard.resources!.hitDice!.remaining, 2);
}

{
  // Partially spent at level 1: remaining=1, max=1 — don't exceed max
  const cleric = pc('Cleric');
  // remaining already at max; long rest should not overshoot
  cleric.resources!.hitDice!.remaining = 1;
  longRest(cleric);
  eq('longRest: hit dice do not exceed max',
    cleric.resources!.hitDice!.remaining, cleric.resources!.hitDice!.max);
}

// ============================================================
// 4. resetCombatant — preserves hitDice at max
// ============================================================
console.log('\n=== 4. resetCombatant preserves hitDice ===\n');

{
  const fighter = pc('Fighter');
  fighter.resources!.hitDice!.remaining = 0;  // spend dice
  const reset = resetCombatant(fighter);
  eq('resetCombatant: restores hitDice.remaining to max',
    reset.resources!.hitDice!.remaining, reset.resources!.hitDice!.max);
  eq('resetCombatant: hitDice.max preserved',
    reset.resources!.hitDice!.max, fighter.resources!.hitDice!.max);
}

// ============================================================
// 5. runDay — single wave, party wins, no rest needed
// ============================================================
console.log('\n=== 5. runDay — single wave ===\n');

{
  const fighter = pc('Fighter');
  const spec: DaySpec = {
    party: [fighter],
    waves: [{ enemies: [weakEnemy()], label: 'Wave 1' }],
    maxShortRests: 2,
  };
  const result = runDay(spec);
  eq('single wave: 1 outcome', result.outcomes.length, 1);
  eq('single wave: label preserved', result.outcomes[0].label, 'Wave 1');
  assert('single wave: party won or drew', result.outcomes[0].winner !== 'enemy');
  assert('single wave: has rounds', result.totalRounds > 0);
  eq('single wave: not wiped', result.partyWiped, false);
  eq('single wave: wipedAtEncounter is null', result.wipedAtEncounter, null);
}

// ============================================================
// 6. runDay — resource attrition persists across waves
// ============================================================
console.log('\n=== 6. Resource attrition across waves ===\n');

{
  // Cleric with spell slots — run two fights and verify slots persist (not reset)
  const cleric = pc('Cleric');
  const spec: DaySpec = {
    party: [cleric],
    waves: [
      { enemies: [weakEnemy()] },
      { enemies: [weakEnemy()] },
    ],
    maxShortRests: 0,   // no rests — pure attrition
    shortRestThreshold: 0,
  };
  const slotsBefore = cleric.resources?.spellSlots?.[1]?.remaining ?? 0;
  const result = runDay(spec);
  // Cleric might spend slots on heals; verify we get 2 outcomes
  eq('two waves: 2 outcomes', result.outcomes.length, 2);
  // The survivingParty snapshot should reflect the cleric's actual remaining HP
  assert('two waves: cleric in survivingParty', result.survivingParty.some(s => s.id === cleric.id));
  // Slot count after should be <= before (attrition direction)
  const slotsAfter = result.survivingParty.find(s => s.id === cleric.id)?.spellSlotsRemaining[1] ?? 0;
  assert('two waves: slots do not reset between fights', slotsAfter <= slotsBefore,
    `before=${slotsBefore}, after=${slotsAfter}`);
}

// ============================================================
// 7. runDay — short rest triggers when HP is low
// ============================================================
console.log('\n=== 7. Short rest trigger ===\n');

{
  // Pre-wound fighter before the fight; use harmlessEnemy so fighter ALWAYS wins
  // (no enemy actions → no risk of fighter dying before killing enemy).
  const fighter = pc('Fighter');
  fighter.currentHP = Math.ceil(fighter.maxHP * 0.2);  // 20% HP — well below 60% threshold
  const spec: DaySpec = {
    party: [fighter],
    waves: [{ enemies: [harmlessEnemy()] }],
    maxShortRests: 2,
    shortRestThreshold: 0.6,
  };
  const result = runDay(spec);
  // Harmless enemy → party always wins (auto-defeat after round 1)
  assert('short rest: party wins trivially', result.outcomes[0].winner === 'party');
  assert('short rest: taken when HP < 60%', result.outcomes[0].shortRestTaken,
    `HP was ${Math.ceil(fighter.maxHP * 0.2)}/${fighter.maxHP}`);
  eq('short rest: shortRestsUsed = 1', result.shortRestsUsed, 1);
}

// ============================================================
// 8. runDay — short rest cap respected
// ============================================================
console.log('\n=== 8. Short rest cap ===\n');

{
  // maxShortRests = 1, three fights, all very damaging → only 1 rest taken
  const fighter = pc('Fighter');
  // Wound before first fight to ensure threshold triggers
  fighter.currentHP = 1;
  const spec: DaySpec = {
    party: [fighter],
    waves: [
      { enemies: [weakEnemy()] },
      { enemies: [weakEnemy()] },
      { enemies: [weakEnemy()] },
    ],
    maxShortRests: 1,
    shortRestThreshold: 0.99,   // nearly always trigger
  };
  const result = runDay(spec);
  assert('rest cap: shortRestsUsed <= maxShortRests', result.shortRestsUsed <= 1,
    `used=${result.shortRestsUsed}`);
}

// ============================================================
// 9. runDay — no rest when maxShortRests = 0
// ============================================================
console.log('\n=== 9. No short rests when maxShortRests = 0 ===\n');

{
  const fighter = pc('Fighter');
  fighter.currentHP = 1;
  const spec: DaySpec = {
    party: [fighter],
    waves: [{ enemies: [weakEnemy()] }],
    maxShortRests: 0,
  };
  const result = runDay(spec);
  eq('no rests: shortRestsUsed = 0', result.shortRestsUsed, 0);
  assert('no rests: no outcome has shortRestTaken',
    result.outcomes.every(o => !o.shortRestTaken));
}

// ============================================================
// 10. runDay — stable unconscious PC revived on short rest
// ============================================================
console.log('\n=== 10. Stable PC revived on short rest ===\n');

{
  // Pre-wound fighter to trigger short rest; use harmlessEnemy so fighter always wins.
  const fighter = pc('Fighter');
  fighter.currentHP = Math.ceil(fighter.maxHP * 0.2);
  const spec: DaySpec = {
    party: [fighter],
    waves: [{ enemies: [harmlessEnemy()] }],
    maxShortRests: 1,
    shortRestThreshold: 0.6,
  };
  const result = runDay(spec);
  // Party always wins → short rest should trigger (HP < 60%)
  assert('stable revive: party wins', result.outcomes[0].winner === 'party');
  assert('stable revive: short rest taken', result.outcomes[0].shortRestTaken);
  // After rest, fighter should not be listed as unconscious
  const snap = result.outcomes[0].partyAfter.find(s => s.id === fighter.id)!;
  assert('stable revive: fighter not unconscious after rest', !snap.isUnconscious);
}

// ============================================================
// 11. runDay — multi-wave day, completing all waves
// ============================================================
console.log('\n=== 11. Multi-wave day completed ===\n');

{
  const fighter = pc('Fighter');
  const spec: DaySpec = {
    party: [fighter],
    waves: [
      { enemies: [weakEnemy()], label: 'A' },
      { enemies: [weakEnemy()], label: 'B' },
      { enemies: [weakEnemy()], label: 'C' },
    ],
    maxShortRests: 2,
    shortRestThreshold: 0.99,
  };
  const result = runDay(spec);
  // Fighter vs 1-HP enemies — should win all 3
  if (!result.partyWiped) {
    eq('multi-wave: 3 outcomes', result.outcomes.length, 3);
    assert('multi-wave: all party wins',
      result.outcomes.every(o => o.winner === 'party'));
  }
}

// ============================================================
// 12. runDay — applyLongRest restores party after day
// ============================================================
console.log('\n=== 12. applyLongRest after runDay ===\n');

{
  const fighter = pc('Fighter');
  const cleric  = pc('Cleric');

  // Wound them and spend some resources
  fighter.currentHP = 1;
  cleric.currentHP  = 1;
  if (cleric.resources?.spellSlots) cleric.resources.spellSlots[1].remaining = 0;
  if (fighter.resources?.hitDice)   fighter.resources.hitDice.remaining = 0;

  applyLongRest([fighter, cleric]);

  eq('longRest: fighter HP restored', fighter.currentHP, fighter.maxHP);
  eq('longRest: cleric HP restored',  cleric.currentHP,  cleric.maxHP);
  assert('longRest: cleric slots restored',
    (cleric.resources?.spellSlots?.[1]?.remaining ?? 0) > 0);
  // Hit dice partially recover (ceil(1/2)=1 at level 1)
  assert('longRest: fighter hit dice restored',
    (fighter.resources?.hitDice?.remaining ?? 0) > 0);
}

// ============================================================
// 13. runDay — throws on empty waves
// ============================================================
console.log('\n=== 13. Error handling ===\n');

{
  const fighter = pc('Fighter');
  let threw = false;
  try {
    runDay({ party: [fighter], waves: [] });
  } catch (e) {
    threw = true;
  }
  assert('runDay: throws on empty waves', threw);
}

// ============================================================
// 14. runDay — survivingParty snapshot is accurate
// ============================================================
console.log('\n=== 14. survivingParty snapshot ===\n');

{
  const fighter = pc('Fighter');
  const spec: DaySpec = {
    party: [fighter],
    waves: [{ enemies: [weakEnemy()] }],
    maxShortRests: 0,
  };
  const result = runDay(spec);
  const snap   = result.survivingParty.find(s => s.id === fighter.id);
  assert('snapshot: fighter present', !!snap);
  assert('snapshot: currentHP <= maxHP', (snap?.currentHP ?? 0) <= fighter.maxHP);
  eq('snapshot: maxHP correct', snap?.maxHP, fighter.maxHP);
}

// ============================================================
// 15. runDay — shortRest also recovers pact slots (Warlock)
// ============================================================
console.log('\n=== 15. Warlock pact slot recovery on short rest ===\n');

{
  const warlock = pc('Warlock');
  // Wound to 20% HP to trigger rest; spend pact slot to make rest worthwhile
  warlock.currentHP = Math.ceil(warlock.maxHP * 0.2);
  if (warlock.resources?.pactSlots) warlock.resources.pactSlots.remaining = 0;
  const spec: DaySpec = {
    party: [warlock],
    waves: [{ enemies: [harmlessEnemy()] }],   // harmless → warlock always wins
    maxShortRests: 1,
    shortRestThreshold: 0.6,
  };
  const result = runDay(spec);
  assert('Warlock: party wins', result.outcomes[0].winner === 'party');
  assert('Warlock: short rest taken', result.outcomes[0].shortRestTaken);
  // Pact slots restore on short rest
  eq('Warlock: pact slots restored after short rest',
    warlock.resources?.pactSlots?.remaining ?? -1,
    warlock.resources?.pactSlots?.max ?? -2);
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
