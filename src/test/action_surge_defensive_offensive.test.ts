// ============================================================
// Test: Action Surge Mirror Image + Fireball (Session 46, Task #27-follow-up-2)
//
// Validates that the planExtraAction() helper now evaluates 2 new surge
// options in addition to the existing heal-self, Dash, Disengage, and
// default-Attack options:
//   - Mirror Image defensive surge: when HP < 50% AND knows Mirror Image
//     AND has an L2 slot AND not already active → surge to cast Mirror Image
//     on self (3 illusory duplicates, PHB p.260).
//   - Fireball offensive surge: when main action WAS an Attack AND knows
//     Fireball AND has an L3 slot AND shouldCastFireball returns ≥2 targets
//     → surge to cast Fireball (8d6 fire AoE, PHB p.241).
//
// Coverage:
//   1. Mirror Image surge: low-HP Fighter/Wizard with MI + L2 slot → surge = mirrorImage
//   2. Mirror Image surge: does NOT fire when HP ≥ 50%
//   3. Mirror Image surge: does NOT fire when no L2 slot
//   4. Mirror Image surge: does NOT fire when already active (duplicates > 0)
//   5. Mirror Image surge: does NOT fire when combatant doesn't know MI
//   6. Mirror Image surge yields to heal-self (Cure Wounds + L1 slot)
//   7. Mirror Image surge: targetId = self.id (self-buff)
//   8. Mirror Image surge: description mentions "Action Surge" and "Mirror Image"
//   9. Fireball surge: main was Attack + knows FB + L3 slot + 2 enemies clustered → surge = fireball
//  10. Fireball surge: does NOT fire when only 1 enemy (no cluster)
//  11. Fireball surge: does NOT fire when no L3 slot
//  12. Fireball surge: does NOT fire when main was NOT an Attack
//  13. Fireball surge: does NOT fire when combatant doesn't know FB
//  14. Mirror Image takes priority over Fireball when HP < 50% + both available
//  15. Fireball takes priority over default extra Attack when 2+ clustered
//  16. Default extra Attack fires when no spell surge applies
//  17. No surge when Action Surge uses = 0
//  18. End-to-end: Mirror Image surge sets _mirrorImageDuplicates = 3
//  19. End-to-end: Fireball surge deals damage to 2+ enemies
//  20. End-to-end: Fireball surge consumes the L3 slot
//
// Run: npx ts-node src/test/action_surge_defensive_offensive.test.ts
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
 * Fighter level-1 sheet. WIS 13 enables Cleric multiclass (for heal-self
 * priority test); INT 13 enables Wizard multiclass (for Mirror Image /
 * Fireball tests).
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
    baseStats: { str: 17, dex: 14, con: 16, int: 13, wis: 13, cha: 10 },
    stats:     { str: 17, dex: 14, con: 16, int: 13, wis: 13, cha: 10 },
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

function levelFighter(sheet: CharacterSheet, target: number): CharacterSheet {
  let s = sheet;
  for (let i = 2; i <= target; i++) {
    s = applyLevelUp(s, 'Fighter').sheet;
  }
  return s;
}

function makeEnemy(id: string, pos: { x: number; y: number; z: number }, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 200, currentHP: 200, ac: 10, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos,
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
  const width = 30, height = 30, depth = 1;
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

/** Build a Fighter 2 combatant (has Action Surge) with overridden HP. */
function buildFighter2(currentHP: number, maxHP?: number): Combatant {
  const sheet = levelFighter(makeFighter1(), 2);
  const c = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  c.currentHP = currentHP;
  if (maxHP !== undefined) c.maxHP = maxHP;
  // Drain Second Wind to prevent the planner from healing during planning
  // (which would change currentHP and make the surge decision flaky).
  if (c.resources?.secondWind) {
    c.resources.secondWind.remaining = 0;
  }
  return c;
}

/** Add a spell Action + spell slots to a combatant (simulates multiclass). */
function addSpell(c: Combatant, action: Action, slotLevel: number, slotCount: number = 2): Combatant {
  c.actions.push(action);
  if (!c.resources) c.resources = {} as any;
  if (!c.resources!.spellSlots) c.resources!.spellSlots = {};
  c.resources!.spellSlots[slotLevel] = { max: slotCount, remaining: slotCount };
  return c;
}

/** Add a Cure Wounds action + L1 slot (for heal-self priority test). */
function addCureWounds(c: Combatant): Combatant {
  const cureAction: Action = {
    name: 'Cure Wounds',
    isMultiattack: false,
    attackType: null,
    reach: 5,
    range: { normal: 0, long: 0 },
    hitBonus: null,
    damage: null,
    damageType: null,
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
    costType: 'action',
    legendaryCost: 0,
    description: 'Cure Wounds (1d8+mod heal, touch)',
  };
  c.actions.push(cureAction);
  if (!c.resources) c.resources = {} as any;
  if (!c.resources!.spellSlots) c.resources!.spellSlots = {};
  if (!c.resources!.spellSlots[1]) c.resources!.spellSlots[1] = { max: 2, remaining: 2 };
  return c;
}

const MIRROR_ACTION: Action = {
  name: 'Mirror Image',
  isMultiattack: false,
  attackType: null,
  reach: 5,
  range: { normal: 0, long: 0 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Mirror Image (3 illusory duplicates, 1 min, no concentration)',
};

const FIREBALL_ACTION: Action = {
  name: 'Fireball',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 150, long: 150 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC for the end-to-end test
  saveAbility: 'dex',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Fireball (DEX save, 8d6 fire, 20-ft radius AoE)',
};

// ============================================================
// 1. Mirror Image surge: low-HP Fighter/Wizard with MI + L2 slot → surge = mirrorImage
// ============================================================
console.log('\n--- 1. Mirror Image surge fires (low HP, MI known, L2 slot) ---');
{
  // Fighter 2 with maxHP 20, currentHP 8 (40% — below 50% threshold).
  const fighter = buildFighter2(8, 20);
  addSpell(fighter, MIRROR_ACTION, 2, 2);
  // Enemy at 5 ft so the planner plans an Attack as the main action.
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([fighter, enemy]);

  const plan = planTurn(fighter, bf);

  assert('1a. surge planned', plan.extraAction !== null && plan.extraAction !== undefined);
  if (plan.extraAction) {
    eq('1b. surge type = mirrorImage', plan.extraAction.type, 'mirrorImage');
    assert('1c. surge description mentions Mirror Image',
      plan.extraAction.description.toLowerCase().includes('mirror image'));
  }
}

// ============================================================
// 2. Mirror Image surge: does NOT fire when HP ≥ 50%
// ============================================================
console.log('\n--- 2. No Mirror Image surge when HP ≥ 50% ---');
{
  // Fighter 2 with maxHP 20, currentHP 12 (60% — above 50% threshold).
  const fighter = buildFighter2(12, 20);
  addSpell(fighter, MIRROR_ACTION, 2, 2);
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([fighter, enemy]);

  const plan = planTurn(fighter, bf);

  if (plan.extraAction) {
    assert('2a. surge is NOT mirrorImage (HP ≥ 50%)',
      plan.extraAction.type !== 'mirrorImage');
  }
}

// ============================================================
// 3. Mirror Image surge: does NOT fire when no L2 slot
// ============================================================
console.log('\n--- 3. No Mirror Image surge when no L2 slot ---');
{
  const fighter = buildFighter2(8, 20);
  addSpell(fighter, MIRROR_ACTION, 2, 2);
  // Drain the L2 slot.
  if (fighter.resources?.spellSlots?.[2]) {
    fighter.resources.spellSlots[2].remaining = 0;
  }
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([fighter, enemy]);

  const plan = planTurn(fighter, bf);

  if (plan.extraAction) {
    assert('3a. surge is NOT mirrorImage (no L2 slot)',
      plan.extraAction.type !== 'mirrorImage');
  }
}

// ============================================================
// 4. Mirror Image surge: does NOT fire when already active
// ============================================================
console.log('\n--- 4. No Mirror Image surge when duplicates already active ---');
{
  const fighter = buildFighter2(8, 20);
  addSpell(fighter, MIRROR_ACTION, 2, 2);
  // Simulate Mirror Image already being active (3 duplicates).
  (fighter as any)._mirrorImageDuplicates = 3;
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([fighter, enemy]);

  const plan = planTurn(fighter, bf);

  if (plan.extraAction) {
    assert('4a. surge is NOT mirrorImage (already active)',
      plan.extraAction.type !== 'mirrorImage');
  }
}

// ============================================================
// 5. Mirror Image surge: does NOT fire when combatant doesn't know MI
// ============================================================
console.log('\n--- 5. No Mirror Image surge when MI not known ---');
{
  // Fighter 2 with low HP but NO Mirror Image action.
  const fighter = buildFighter2(8, 20);
  // Don't add MIRROR_ACTION — fighter doesn't know it.
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([fighter, enemy]);

  const plan = planTurn(fighter, bf);

  if (plan.extraAction) {
    assert('5a. surge is NOT mirrorImage (MI not known)',
      plan.extraAction.type !== 'mirrorImage');
  }
}

// ============================================================
// 6. Mirror Image surge yields to heal-self (Cure Wounds + L1 slot)
// ============================================================
console.log('\n--- 6. Heal-self takes priority over Mirror Image ---');
{
  const fighter = buildFighter2(8, 20);
  addCureWounds(fighter);           // L1 slot for Cure Wounds
  addSpell(fighter, MIRROR_ACTION, 2, 2);  // L2 slot for Mirror Image
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([fighter, enemy]);

  const plan = planTurn(fighter, bf);

  assert('6a. surge planned', plan.extraAction !== null && plan.extraAction !== undefined);
  if (plan.extraAction) {
    // Heal-self (Cure Wounds) should win over Mirror Image.
    eq('6b. surge type = cureWounds (heal-self priority)', plan.extraAction.type, 'cureWounds');
    assert('6c. surge is NOT mirrorImage',
      plan.extraAction.type !== 'mirrorImage');
  }
}

// ============================================================
// 7. Mirror Image surge: targetId = self.id (self-buff)
// ============================================================
console.log('\n--- 7. Mirror Image surge targets self ---');
{
  const fighter = buildFighter2(8, 20);
  addSpell(fighter, MIRROR_ACTION, 2, 2);
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([fighter, enemy]);

  const plan = planTurn(fighter, bf);

  if (plan.extraAction && plan.extraAction.type === 'mirrorImage') {
    eq('7a. surge targetId = self.id', plan.extraAction.targetId, fighter.id);
  } else {
    assert('7a. surge is mirrorImage (precondition)', false,
      `got type=${plan.extraAction?.type}`);
  }
}

// ============================================================
// 8. Mirror Image surge: description mentions "Action Surge" and "Mirror Image"
// ============================================================
console.log('\n--- 8. Mirror Image surge description ---');
{
  const fighter = buildFighter2(8, 20);
  addSpell(fighter, MIRROR_ACTION, 2, 2);
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([fighter, enemy]);

  const plan = planTurn(fighter, bf);

  if (plan.extraAction) {
    const desc = plan.extraAction.description.toLowerCase();
    assert('8a. description mentions "action surge"', desc.includes('action surge'));
    assert('8b. description mentions "mirror image"', desc.includes('mirror image'));
  }
}

// ============================================================
// 9. Fireball surge: main was Attack + knows FB + L3 slot + 2 enemies clustered
// ============================================================
console.log('\n--- 9. Fireball surge fires (main Attack, 2 clustered enemies) ---');
{
  // Fighter 2 at full HP (so Mirror Image doesn't fire).
  const fighter = buildFighter2(20, 20);
  addSpell(fighter, FIREBALL_ACTION, 3, 2);
  // Two enemies clustered within 20 ft of each other (both within Fireball radius).
  // Enemy A at (1,0) = 5 ft from fighter. Enemy B at (3,0) = 15 ft from fighter.
  // Distance between A and B = 10 ft → both in 20-ft radius around A.
  const enemyA = makeEnemy('a', { x: 1, y: 0, z: 0 });
  const enemyB = makeEnemy('b', { x: 3, y: 0, z: 0 });
  const bf = makeBF([fighter, enemyA, enemyB]);

  const plan = planTurn(fighter, bf);

  // Main action should be an Attack (enemy is adjacent).
  assert('9a. main action is Attack', plan.action?.type === 'attack');
  // Surge should be Fireball (2 enemies clustered).
  assert('9b. surge planned', plan.extraAction !== null && plan.extraAction !== undefined);
  if (plan.extraAction) {
    eq('9c. surge type = fireball', plan.extraAction.type, 'fireball');
    assert('9d. surge description mentions Fireball',
      plan.extraAction.description.toLowerCase().includes('fireball'));
  }
}

// ============================================================
// 10. Fireball surge: does NOT fire when only 1 enemy (no cluster)
// ============================================================
console.log('\n--- 10. No Fireball surge when only 1 enemy ---');
{
  const fighter = buildFighter2(20, 20);
  addSpell(fighter, FIREBALL_ACTION, 3, 2);
  // Only 1 enemy — shouldCastFireball returns 1 target, but surge requires ≥2.
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([fighter, enemy]);

  const plan = planTurn(fighter, bf);

  if (plan.extraAction) {
    assert('10a. surge is NOT fireball (only 1 enemy)',
      plan.extraAction.type !== 'fireball');
  }
}

// ============================================================
// 11. Fireball surge: does NOT fire when no L3 slot
// ============================================================
console.log('\n--- 11. No Fireball surge when no L3 slot ---');
{
  const fighter = buildFighter2(20, 20);
  addSpell(fighter, FIREBALL_ACTION, 3, 2);
  // Drain the L3 slot.
  if (fighter.resources?.spellSlots?.[3]) {
    fighter.resources.spellSlots[3].remaining = 0;
  }
  const enemyA = makeEnemy('a', { x: 1, y: 0, z: 0 });
  const enemyB = makeEnemy('b', { x: 3, y: 0, z: 0 });
  const bf = makeBF([fighter, enemyA, enemyB]);

  const plan = planTurn(fighter, bf);

  if (plan.extraAction) {
    assert('11a. surge is NOT fireball (no L3 slot)',
      plan.extraAction.type !== 'fireball');
  }
}

// ============================================================
// 12. Fireball surge: does NOT fire when main was NOT an Attack
// ============================================================
console.log('\n--- 12. No Fireball surge when main was not Attack ---');
{
  const fighter = buildFighter2(20, 20);
  addSpell(fighter, FIREBALL_ACTION, 3, 2);
  // Place enemy far away so the planner can't plan an Attack (out of reach).
  // The planner will plan a non-attack action (or move-only).
  const enemy = makeEnemy('e', { x: 15, y: 0, z: 0 });
  const bf = makeBF([fighter, enemy]);

  const plan = planTurn(fighter, bf);

  // Main action was NOT an attack (enemy out of reach).
  if (plan.extraAction) {
    assert('12a. surge is NOT fireball (main was not Attack)',
      plan.extraAction.type !== 'fireball');
  }
}

// ============================================================
// 13. Fireball surge: does NOT fire when combatant doesn't know FB
// ============================================================
console.log('\n--- 13. No Fireball surge when FB not known ---');
{
  // Fighter 2 at full HP, no Fireball action.
  const fighter = buildFighter2(20, 20);
  // Don't add FIREBALL_ACTION.
  const enemyA = makeEnemy('a', { x: 1, y: 0, z: 0 });
  const enemyB = makeEnemy('b', { x: 3, y: 0, z: 0 });
  const bf = makeBF([fighter, enemyA, enemyB]);

  const plan = planTurn(fighter, bf);

  if (plan.extraAction) {
    assert('13a. surge is NOT fireball (FB not known)',
      plan.extraAction.type !== 'fireball');
  }
}

// ============================================================
// 14. Mirror Image takes priority over Fireball when HP < 50% + both available
// ============================================================
console.log('\n--- 14. Mirror Image priority over Fireball (low HP, both known) ---');
{
  // Fighter 2 at low HP (40%), knows both Mirror Image (L2) and Fireball (L3).
  // 2 enemies clustered (so Fireball COULD fire).
  // But HP < 50% → Mirror Image (defensive) should win.
  const fighter = buildFighter2(8, 20);
  addSpell(fighter, MIRROR_ACTION, 2, 2);
  addSpell(fighter, FIREBALL_ACTION, 3, 2);
  const enemyA = makeEnemy('a', { x: 1, y: 0, z: 0 });
  const enemyB = makeEnemy('b', { x: 3, y: 0, z: 0 });
  const bf = makeBF([fighter, enemyA, enemyB]);

  const plan = planTurn(fighter, bf);

  assert('14a. surge planned', plan.extraAction !== null && plan.extraAction !== undefined);
  if (plan.extraAction) {
    eq('14b. surge type = mirrorImage (defensive priority)', plan.extraAction.type, 'mirrorImage');
    assert('14c. surge is NOT fireball',
      plan.extraAction.type !== 'fireball');
  }
}

// ============================================================
// 15. Fireball takes priority over default extra Attack when 2+ clustered
// ============================================================
console.log('\n--- 15. Fireball priority over default Attack (2 clustered) ---');
{
  // Fighter 2 at FULL HP (so Mirror Image doesn't fire), knows Fireball.
  // 2 enemies clustered → Fireball surge should beat default extra Attack.
  const fighter = buildFighter2(20, 20);
  addSpell(fighter, FIREBALL_ACTION, 3, 2);
  const enemyA = makeEnemy('a', { x: 1, y: 0, z: 0 });
  const enemyB = makeEnemy('b', { x: 3, y: 0, z: 0 });
  const bf = makeBF([fighter, enemyA, enemyB]);

  const plan = planTurn(fighter, bf);

  if (plan.extraAction) {
    eq('15a. surge type = fireball (priority over extra Attack)', plan.extraAction.type, 'fireball');
    assert('15b. surge is NOT attack',
      plan.extraAction.type !== 'attack');
  }
}

// ============================================================
// 16. Default extra Attack fires when no spell surge applies
// ============================================================
console.log('\n--- 16. Default extra Attack fires (no spell surge) ---');
{
  // Fighter 2 at full HP, no spells. Enemy adjacent → main Attack + surge Attack.
  const fighter = buildFighter2(20, 20);
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([fighter, enemy]);

  const plan = planTurn(fighter, bf);

  assert('16a. surge planned', plan.extraAction !== null && plan.extraAction !== undefined);
  if (plan.extraAction) {
    eq('16b. surge type = attack (default)', plan.extraAction.type, 'attack');
  }
}

// ============================================================
// 17. No surge when Action Surge uses = 0
// ============================================================
console.log('\n--- 17. No surge when 0 uses remaining ---');
{
  const fighter = buildFighter2(20, 20);
  addSpell(fighter, FIREBALL_ACTION, 3, 2);
  // Drain Action Surge.
  if (fighter.resources?.actionSurge) {
    fighter.resources.actionSurge.remaining = 0;
  }
  const enemyA = makeEnemy('a', { x: 1, y: 0, z: 0 });
  const enemyB = makeEnemy('b', { x: 3, y: 0, z: 0 });
  const bf = makeBF([fighter, enemyA, enemyB]);

  const plan = planTurn(fighter, bf);

  assert('17a. no surge planned (0 uses)',
    plan.extraAction === null || plan.extraAction === undefined);
}

// ============================================================
// 18. End-to-end: Mirror Image surge sets _mirrorImageDuplicates = 3
// ============================================================
console.log('\n--- 18. End-to-end: Mirror Image surge sets duplicates = 3 ---');
{
  const fighter = buildFighter2(8, 20);
  addSpell(fighter, MIRROR_ACTION, 2, 2);
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([fighter, enemy]);
  const state = makeState(bf);

  const plan = planTurn(fighter, bf);

  // Verify the surge is Mirror Image.
  assert('18a. surge is mirrorImage', plan.extraAction?.type === 'mirrorImage');

  if (plan.extraAction?.type === 'mirrorImage') {
    // Execute the turn plan — the extraAction (Mirror Image surge) should fire.
    executeTurnPlan(fighter, plan, state);

    // After execution, the fighter should have 3 mirror-image duplicates.
    eq('18b. _mirrorImageDuplicates = 3 after surge',
      (fighter as any)._mirrorImageDuplicates, 3);

    // The L2 slot should be consumed.
    eq('18c. L2 slot consumed',
      fighter.resources?.spellSlots?.[2]?.remaining, 1);
  }
}

// ============================================================
// 19. End-to-end: Fireball surge deals damage to 2+ enemies
// ============================================================
console.log('\n--- 19. End-to-end: Fireball surge damages 2 enemies ---');
{
  const fighter = buildFighter2(20, 20);
  addSpell(fighter, FIREBALL_ACTION, 3, 2);
  // Two enemies with low DEX (guaranteed-fail vs DC 25).
  const enemyA = makeEnemy('a', { x: 1, y: 0, z: 0 }, { dex: 1, maxHP: 100, currentHP: 100 });
  const enemyB = makeEnemy('b', { x: 3, y: 0, z: 0 }, { dex: 1, maxHP: 100, currentHP: 100 });
  const bf = makeBF([fighter, enemyA, enemyB]);
  const state = makeState(bf);

  const plan = planTurn(fighter, bf);

  assert('19a. surge is fireball', plan.extraAction?.type === 'fireball');

  if (plan.extraAction?.type === 'fireball') {
    const hpABefore = enemyA.currentHP;
    const hpBBefore = enemyB.currentHP;

    // Execute the turn plan — the extraAction (Fireball surge) should fire.
    executeTurnPlan(fighter, plan, state);

    // Both enemies should have taken damage (8d6 fire, guaranteed fail).
    assert('19b. enemy A took damage',
      enemyA.currentHP < hpABefore,
      `HP ${hpABefore} → ${enemyA.currentHP}`);
    assert('19c. enemy B took damage',
      enemyB.currentHP < hpBBefore,
      `HP ${hpBBefore} → ${enemyB.currentHP}`);
  }
}

// ============================================================
// 20. End-to-end: Fireball surge consumes the L3 slot
// ============================================================
console.log('\n--- 20. End-to-end: Fireball surge consumes L3 slot ---');
{
  const fighter = buildFighter2(20, 20);
  addSpell(fighter, FIREBALL_ACTION, 3, 2);
  const enemyA = makeEnemy('a', { x: 1, y: 0, z: 0 }, { dex: 1 });
  const enemyB = makeEnemy('b', { x: 3, y: 0, z: 0 }, { dex: 1 });
  const bf = makeBF([fighter, enemyA, enemyB]);
  const state = makeState(bf);

  const plan = planTurn(fighter, bf);

  if (plan.extraAction?.type === 'fireball') {
    executeTurnPlan(fighter, plan, state);

    // The L3 slot should be consumed (was 2, now 1).
    eq('20a. L3 slot consumed (2 → 1)',
      fighter.resources?.spellSlots?.[3]?.remaining, 1);

    // Action Surge use should be consumed.
    assert('20b. actionSurge use consumed',
      (fighter.resources?.actionSurge?.remaining ?? 1) === 0);
  }
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('action_surge_defensive_offensive.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('action_surge_defensive_offensive.test.ts: all tests passed ✅');
}
