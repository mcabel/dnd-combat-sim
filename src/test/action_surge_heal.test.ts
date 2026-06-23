// ============================================================
// Test: Smarter Action Surge — Heal-Self Tactic (Session 44, Task #27)
//
// Validates that planExtraAction() evaluates multiple surge options in
// priority order:
//   1. Heal-self surge — when HP < 50% and Cure Wounds is known + slot available
//   2. Default extra Attack — clone the main Attack action (v1 behaviour)
//
// Coverage:
//   1. Healthy Fighter (full HP) surges for extra Attack (default behaviour)
//   2. Low-HP Fighter without Cure Wounds still surges for extra Attack
//   3. Low-HP Fighter/Cleric with Cure Wounds + slot surges to cast Cure Wounds on self
//   4. Low-HP Fighter/Cleric without spell slots falls back to extra Attack
//   5. Healthy Fighter/Cleric (has Cure Wounds) still surges for extra Attack
//   6. Surge-to-heal sets plan.extraAction.type = 'cureWounds'
//   7. Surge-to-heal sets plan.extraAction.targetId = self.id (self-heal)
//   8. Surge-to-heal description mentions "Action Surge" and "Cure Wounds"
//   9. Engine executes surge Cure Wounds (heal event in log)
//  10. Engine consumes actionSurge use after surge heal
//  11. Engine consumes spell slot after surge heal
//  12. Surge-to-heal triggers at exactly 49% HP (boundary)
//  13. Surge-to-heal does NOT trigger at 50% HP (boundary)
//  14. No surge when actionSurge.remaining = 0
//  15. End-to-end: low-HP Fighter/Cleric heals ~1d8+ Wisdom with surge
//
// Run: npx ts-node src/test/action_surge_heal.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyLevelUp } from '../characters/leveler';
import { buildCombatant } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
import { planTurn } from '../ai/planner';
import { executeTurnPlan, EngineState } from '../engine/combat';
import { Combatant, Action, Vec3, Battlefield, TurnPlan } from '../types/core';

// ---- Test harness -------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Factories ----------------------------------------------

/**
 * Fighter level-1 sheet (pure Fighter — no spellcasting).
 * Used for tests 1, 2, 14 (no Cure Wounds available).
 *
 * WIS is 14 (rather than the default 12) to enable Cleric multiclassing
 * in makeFighterCleric (Cleric requires WIS 13 per PHB p.56).
 */
function makeFighter1(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Gareth', race: 'Mountain Dwarf', background: 'Soldier',
    alignment: 'Lawful Good',
    firstClass: 'Fighter',
    classLevels: [{ className: 'Fighter', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 17, dex: 10, con: 16, int: 8, wis: 14, cha: 13 },
    stats:     { str: 17, dex: 10, con: 16, int: 8, wis: 14, cha: 13 },
    maxHP: 13, currentHP: 13, temporaryHP: 0,
    armorClass: 16, acFormula: 'Chain Mail', speed: 25,
    hitDice: [{ className: 'Fighter', dieSides: 10, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium','heavy','shield'],
      weapons: ['simple-melee','simple-ranged','martial-melee','martial-ranged'],
      tools: [], savingThrows: ['str','con'],
      skills: ['Athletics','Intimidation'], expertise: [],
    },
    languages: ['Common', 'Dwarvish'],
    resources: { secondWind: { max: 1, remaining: 1 } },
    spellcasting: undefined,
    equipment: [{ name: 'Greatsword', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 10,
    level1Features: [{ name: 'Second Wind', description: 'Regain HP.', source: 'class' }],
    allFeatures:    [{ name: 'Second Wind', description: 'Regain HP.', source: 'class' }],
    feats: [], backgroundFeature: 'Military Rank', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/**
 * Fighter/Cleric multiclass sheet (Fighter 2 / Cleric 1).
 * Has Action Surge AND Cure Wounds (L1 Cleric spell) AND spell slots.
 * Used for the heal-self surge tests.
 *
 * Built by leveling Fighter 1→2 (gains Action Surge), then multiclassing
 * into Cleric 1 (gains spellcasting with Cure Wounds prepared).
 *
 * WIS 14 → +2 mod; total level 3 → proficiency +2.
 * Spell attack = +2 prof + +2 WIS = +4. Save DC = 8 + 2 + 2 = 12.
 */
function makeFighterCleric(): CharacterSheet {
  let sheet = makeFighter1();
  // Level Fighter 1→2 (gains Action Surge)
  sheet = applyLevelUp(sheet, 'Fighter', 'average').sheet;
  // Multiclass into Cleric 1
  sheet = applyLevelUp(sheet, 'Cleric', 'average').sheet;

  // Manually add Cure Wounds to the prepared spells (the leveler doesn't
  // auto-add specific spells — the player picks them at character creation).
  if (sheet.spellcasting) {
    sheet.spellcasting.preparedSpells = ['Cure Wounds'];
    // WIS 14 → +2 mod, proficiency at total level 3 = +2
    sheet.spellcasting.spellAttackBonus = 4;
    sheet.spellcasting.saveDC = 12;
  } else {
    // Force spellcasting on (Cleric 1 has it)
    sheet.spellcasting = {
      ability: 'wis', spellAttackBonus: 4, saveDC: 12,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: ['Guidance'],
      knownSpells: [],
      preparedSpells: ['Cure Wounds'],
      spellbook: [],
    };
  }

  return sheet;
}

function levelTo(sheet: CharacterSheet, target: number, className?: string): CharacterSheet {
  let s = sheet;
  const cn = className ?? s.firstClass;
  const startLevel = s.classLevels.find(cl => cl.className === cn)?.level ?? 0;
  for (let i = startLevel; i < target; i++) {
    s = applyLevelUp(s, cn).sheet;
  }
  return s;
}

function makeEnemy(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 1000, currentHP: 1000, ac: 10, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos: { x: 1, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'attackNearest',
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    ...overrides,
  } as Combatant;
}

function makeBF(combatants: Combatant[]): Battlefield {
  const width = 20, height = 20, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [];
      for (let z = 0; z < depth; z++) {
        cells[x][y][z] = { terrain: 'flat', elevation: 0 };
      }
    }
  }
  return {
    width, height, depth, cells,
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1,
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

/** Build a Combatant from a sheet and override currentHP / maxHP.
 *
 *  Also drains Second Wind uses so the planner's planBonusAction doesn't
 *  trigger Second Wind (which mutates currentHP during planning). Without
 *  this, the heal-self surge check in planExtraAction would see the
 *  post-Second-Wind HP instead of the HP we set here, making tests flaky.
 */
function buildWithHP(sheet: CharacterSheet, currentHP: number, maxHP?: number): Combatant {
  const c = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  c.currentHP = currentHP;
  if (maxHP !== undefined) c.maxHP = maxHP;
  // Drain Second Wind to prevent the planner from healing during planning.
  if (c.resources?.secondWind) {
    c.resources.secondWind.remaining = 0;
  }
  return c;
}

/** Drain all but the first spell slot to test the "no slot available" path. */
function keepOnlyFirstSlot(c: Combatant): Combatant {
  if (!c.resources?.spellSlots) return c;
  const slots: Record<number, { max: number; remaining: number }> = {};
  if (c.resources.spellSlots[1]) {
    slots[1] = c.resources.spellSlots[1];
  }
  return {
    ...c,
    resources: { ...c.resources, spellSlots: slots },
  };
}

// ============================================================
// Tests
// ============================================================

console.log('\n=== 1. Healthy Fighter (full HP) surges for extra Attack ===');
{
  const sheet = levelTo(makeFighter1(), 2);
  const fighter = buildWithHP(sheet, sheet.maxHP); // full HP
  const enemy = makeEnemy('enemy');
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);

  assert('plan.extraAction is set', plan.extraAction !== null && plan.extraAction !== undefined);
  if (plan.extraAction) {
    eq('extraAction.type = attack (default)', plan.extraAction.type, 'attack');
  }
}

console.log('\n=== 2. Low-HP Fighter without Cure Wounds still surges for extra Attack ===');
{
  const sheet = levelTo(makeFighter1(), 2);
  const fighter = buildWithHP(sheet, Math.floor(sheet.maxHP * 0.3)); // 30% HP
  const enemy = makeEnemy('enemy');
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);

  assert('plan.extraAction is set', plan.extraAction !== null && plan.extraAction !== undefined);
  if (plan.extraAction) {
    eq('extraAction.type = attack (no Cure Wounds → default)', plan.extraAction.type, 'attack');
  }
}

console.log('\n=== 3. Low-HP Fighter/Cleric with Cure Wounds + slot surges to heal self ===');
{
  const sheet = makeFighterCleric();
  // Drop HP to 30% (below 50% threshold)
  const fighter = buildWithHP(sheet, Math.floor(sheet.maxHP * 0.3));
  const enemy = makeEnemy('enemy');
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);

  assert('plan.extraAction is set', plan.extraAction !== null && plan.extraAction !== undefined);
  if (plan.extraAction) {
    eq('extraAction.type = cureWounds (heal-self surge)', plan.extraAction.type, 'cureWounds');
  }
}

console.log('\n=== 4. Low-HP Fighter/Cleric without spell slots falls back to extra Attack ===');
{
  const sheet = makeFighterCleric();
  const fighter = buildWithHP(sheet, Math.floor(sheet.maxHP * 0.3));
  // Drain all spell slots
  if (fighter.resources?.spellSlots) {
    for (const lvl of Object.keys(fighter.resources.spellSlots)) {
      const n = Number(lvl);
      fighter.resources.spellSlots[n].remaining = 0;
    }
  }
  const enemy = makeEnemy('enemy');
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);

  assert('plan.extraAction is set', plan.extraAction !== null && plan.extraAction !== undefined);
  if (plan.extraAction) {
    eq('extraAction.type = attack (no slot → fallback)', plan.extraAction.type, 'attack');
  }
}

console.log('\n=== 5. Healthy Fighter/Cleric (has Cure Wounds) still surges for extra Attack ===');
{
  const sheet = makeFighterCleric();
  // Full HP — heal-self surge should NOT trigger
  const fighter = buildWithHP(sheet, sheet.maxHP);
  const enemy = makeEnemy('enemy');
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);

  assert('plan.extraAction is set', plan.extraAction !== null && plan.extraAction !== undefined);
  if (plan.extraAction) {
    eq('extraAction.type = attack (full HP → default)', plan.extraAction.type, 'attack');
  }
}

console.log('\n=== 6. Surge-to-heal sets plan.extraAction.type = "cureWounds" ===');
{
  const sheet = makeFighterCleric();
  const fighter = buildWithHP(sheet, Math.floor(sheet.maxHP * 0.4));
  const enemy = makeEnemy('enemy');
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);

  if (plan.extraAction) {
    eq('extraAction.type = cureWounds', plan.extraAction.type, 'cureWounds');
  } else {
    assert('extraAction is set', false);
  }
}

console.log('\n=== 7. Surge-to-heal sets plan.extraAction.targetId = self.id (self-heal) ===');
{
  const sheet = makeFighterCleric();
  const fighter = buildWithHP(sheet, Math.floor(sheet.maxHP * 0.4));
  const enemy = makeEnemy('enemy');
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);

  if (plan.extraAction) {
    eq('extraAction.targetId = fighter.id (self-heal)', plan.extraAction.targetId, fighter.id);
  } else {
    assert('extraAction is set', false);
  }
}

console.log('\n=== 8. Surge-to-heal description mentions "Action Surge" and "Cure Wounds" ===');
{
  const sheet = makeFighterCleric();
  const fighter = buildWithHP(sheet, Math.floor(sheet.maxHP * 0.4));
  const enemy = makeEnemy('enemy');
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);

  if (plan.extraAction) {
    const desc = plan.extraAction.description ?? '';
    assert('description mentions "Action Surge"', desc.includes('Action Surge'));
    assert('description mentions "Cure Wounds"', desc.includes('Cure Wounds'));
  } else {
    assert('extraAction is set', false);
  }
}

console.log('\n=== 9. Engine executes surge Cure Wounds (heal event in log) ===');
{
  const sheet = makeFighterCleric();
  const fighter = buildWithHP(sheet, Math.floor(sheet.maxHP * 0.3));
  const enemy = makeEnemy('enemy');
  const bf = makeBF([fighter, enemy]);
  const state = makeState(bf);
  const plan = planTurn(fighter, bf);

  const hpBefore = fighter.currentHP;
  executeTurnPlan(fighter, plan, state);

  // Should be a heal event from Cure Wounds
  const healEvents = state.log.events.filter(
    (e: any) => e.type === 'heal' && e.actorId === fighter.id,
  );
  assert('heal event present in log', healEvents.length > 0);
  if (healEvents.length > 0) {
    // The heal value should be at least 1 (1d8 + WIS mod, min 1)
    const healValue = healEvents[0].value ?? 0;
    assert(`heal value ≥ 1 (got ${healValue})`, healValue >= 1);
  }
  // HP should have increased (or at least not decreased)
  const hpAfter = fighter.currentHP;
  assert(`HP increased (before=${hpBefore}, after=${hpAfter})`, hpAfter > hpBefore);
}

console.log('\n=== 10. Engine consumes actionSurge use after surge heal ===');
{
  const sheet = makeFighterCleric();
  const fighter = buildWithHP(sheet, Math.floor(sheet.maxHP * 0.3));
  const enemy = makeEnemy('enemy');
  const bf = makeBF([fighter, enemy]);
  const state = makeState(bf);
  const plan = planTurn(fighter, bf);

  const surgeBefore = fighter.resources?.actionSurge?.remaining ?? 0;
  assert('actionSurge has uses before execution', surgeBefore > 0);

  executeTurnPlan(fighter, plan, state);

  const surgeAfter = fighter.resources?.actionSurge?.remaining ?? 0;
  eq('actionSurge use consumed (before - 1 = after)', surgeAfter, surgeBefore - 1);
}

console.log('\n=== 11. Engine consumes spell slot after surge heal ===');
{
  const sheet = makeFighterCleric();
  const fighter = buildWithHP(sheet, Math.floor(sheet.maxHP * 0.3));
  const enemy = makeEnemy('enemy');
  const bf = makeBF([fighter, enemy]);
  const state = makeState(bf);
  const plan = planTurn(fighter, bf);

  const slotsBefore = fighter.resources?.spellSlots?.[1]?.remaining ?? 0;
  assert('L1 slot available before execution', slotsBefore > 0);

  executeTurnPlan(fighter, plan, state);

  const slotsAfter = fighter.resources?.spellSlots?.[1]?.remaining ?? 0;
  // The surge-to-heal consumes one L1 slot (Cure Wounds is L1).
  // The main action may also consume a slot if the planner picked a spell
  // (e.g. Cure Wounds as the main action too). So AT LEAST 1 slot should
  // be consumed.
  assert(
    `L1 slot(s) consumed by surge heal (before=${slotsBefore}, after=${slotsAfter})`,
    slotsAfter < slotsBefore,
  );
}

console.log('\n=== 12. Surge-to-heal triggers at exactly 49% HP (boundary) ===');
{
  const sheet = makeFighterCleric();
  // 49% HP — just below the 50% threshold
  const fighter = buildWithHP(sheet, Math.floor(sheet.maxHP * 0.49));
  const enemy = makeEnemy('enemy');
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);

  if (plan.extraAction) {
    eq('extraAction.type = cureWounds at 49% HP', plan.extraAction.type, 'cureWounds');
  } else {
    assert('extraAction is set at 49% HP', false);
  }
}

console.log('\n=== 13. Surge-to-heal does NOT trigger at 50% HP (boundary) ===');
{
  const sheet = makeFighterCleric();
  // 50% HP — at the threshold (not below)
  const fighter = buildWithHP(sheet, Math.floor(sheet.maxHP * 0.5));
  const enemy = makeEnemy('enemy');
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);

  if (plan.extraAction) {
    // At 50%, hpRatio = 0.5 which is NOT < 0.5, so heal-self shouldn't fire
    eq('extraAction.type = attack at 50% HP (boundary)', plan.extraAction.type, 'attack');
  } else {
    assert('extraAction is set at 50% HP', false);
  }
}

console.log('\n=== 14. No surge when actionSurge.remaining = 0 ===');
{
  const sheet = makeFighterCleric();
  const fighter = buildWithHP(sheet, Math.floor(sheet.maxHP * 0.3));
  // Drain actionSurge
  if (fighter.resources?.actionSurge) {
    fighter.resources.actionSurge.remaining = 0;
  }
  const enemy = makeEnemy('enemy');
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);

  // extraAction is undefined when no surge is planned (null/undefined both
  // indicate "no surge"). Use == null to match both.
  assert('extraAction is null/undefined (no actionSurge use)', plan.extraAction == null);
}

console.log('\n=== 15. End-to-end: low-HP Fighter/Cleric heals with surge ===');
{
  // Run N trials to verify the heal triggers consistently and restores HP
  const N = 30;
  let surgeHealCount = 0;
  let totalHeal = 0;

  for (let i = 0; i < N; i++) {
    const sheet = makeFighterCleric();
    const fighter = buildWithHP(sheet, Math.floor(sheet.maxHP * 0.3));
    const enemy = makeEnemy('enemy');
    const bf = makeBF([fighter, enemy]);
    const state = makeState(bf);
    const plan = planTurn(fighter, bf);

    if (plan.extraAction?.type === 'cureWounds') {
      surgeHealCount++;
      const hpBefore = fighter.currentHP;
      executeTurnPlan(fighter, plan, state);
      const hpAfter = fighter.currentHP;
      totalHeal += (hpAfter - hpBefore);
    }
  }

  console.log(`    Surge-heal triggered in ${surgeHealCount}/${N} trials`);
  console.log(`    Average heal per trigger: ${(totalHeal / Math.max(1, surgeHealCount)).toFixed(1)} HP`);

  // All trials should trigger the heal-self surge (HP is 30% < 50%)
  eq('all N trials triggered heal-self surge', surgeHealCount, N);
  // Average heal should be at least 1 (1d8 + WIS mod, min 1)
  assert(`average heal ≥ 1`, totalHeal / Math.max(1, surgeHealCount) >= 1);
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('action_surge_heal.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('action_surge_heal.test.ts: all tests passed ✅');
}
