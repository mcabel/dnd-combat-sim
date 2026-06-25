// ============================================================
// Test: Silvery Barbs Save-Success Trigger (Session 41, Task #8)
//
// Validates that Silvery Barbs can now be cast in response to a
// successful save (SCC p.38: "succeeds on a saving throw"). The
// reroll uses the lower of the two d20 rolls; if the lower roll
// fails the save, the spell's "save failed" branch runs.
//
// Coverage:
//   1. ReactionTrigger 'incoming_save_success' kind exists
//   2. Reaction registry includes the new trigger kind for Silvery Barbs
//   3. shouldCastReaction accepts 'incoming_save_success' trigger
//   4. shouldCastReaction rejects self-trigger (caster = saver)
//   5. shouldCastReaction rejects out-of-range (>60 ft)
//   6. executeReaction rerolls and uses lower result
//   7. executeReaction returns 'negated' when reroll flips save to fail
//   8. executeReaction returns 'failed' when reroll doesn't flip
//   9. rollSaveReactable fires trigger on save success
//  10. rollSaveReactable does NOT fire trigger on save fail
//  11. rollSaveReactable returns success=false when reaction negates
//  12. rollSaveReactable doesn't fire for self-saves (caster = saver)
//  13. rollSaveReactable doesn't fire when reaction already used
//  14. End-to-end: Fireball + Silvery Barbs (save success → reroll → fail)
//  15. End-to-end: Burning Hands + Silvery Barbs
//  16. End-to-end: Sacred Flame (resolveAttack save branch) + Silvery Barbs
//  17. Metadata flag silveryBarbsSaveSuccessV1Implemented = true
//
// Run: npx ts-node src/test/silvery_barbs_save_success.test.ts
// ============================================================

import {
  shouldCastReaction,
  executeReaction,
  metadata,
} from '../spells/silvery_barbs';
import { getReactionSpell } from '../spells/_reaction_registry';
import { rollSaveReactable, resolveAttack, CombatEvent, EngineState } from '../engine/combat';
import { execute as executeFireball } from '../spells/fireball';
import { execute as executeBurningHands } from '../spells/burning_hands';
import { Combatant, Action, ReactionTrigger, AIProfile, Vec3 } from '../types/core';
import { rollDie } from '../engine/utils';

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

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 18,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart',
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

function makeCasterWithSilveryBarbs(id: string, overrides: Partial<Combatant> = {}): Combatant {
  const sbAction: Action = {
    name: 'Silvery Barbs',
    isMultiattack: false,
    attackType: null,
    reach: 60,
    range: { normal: 60, long: 60 },
    hitBonus: null,
    damage: null,
    damageType: null,
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 1,
    costType: 'reaction',
    legendaryCost: 0,
    description: 'Silvery Barbs reaction',
  };
  return makeCombatant(id, {
    actions: [sbAction],
    resources: {
      spellSlots: { 1: { max: 4, remaining: 4 } },
    },
    ...overrides,
  });
}

function makeBF(combatants: Combatant[]) {
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

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// ---- Sample 'incoming_save_success' trigger factory ---------

function makeSaveSuccessTrigger(
  caster: Combatant,
  saver: Combatant,
  overrides: Partial<Extract<ReactionTrigger, { kind: 'incoming_save_success' }>> = {},
): Extract<ReactionTrigger, { kind: 'incoming_save_success' }> {
  return {
    kind: 'incoming_save_success',
    caster,
    saver,
    ability: 'dex',
    dc: 13,
    roll: 15,        // succeeds vs DC 13
    total: 16,       // 15 + 1 DEX mod
    ...overrides,
  };
}

// ============================================================
// 1. ReactionTrigger 'incoming_save_success' kind exists
// ============================================================
console.log('\n--- 1. incoming_save_success trigger kind ---');
{
  const trigger = makeSaveSuccessTrigger(makeCombatant('c'), makeCombatant('t'));
  eq('1a. trigger.kind = incoming_save_success', trigger.kind, 'incoming_save_success');
  assert('1b. trigger has caster', !!trigger.caster);
  assert('1c. trigger has saver', !!trigger.saver);
  eq('1d. trigger has ability', typeof trigger.ability, 'string');
  eq('1e. trigger has dc', typeof trigger.dc, 'number');
  eq('1f. trigger has roll', typeof trigger.roll, 'number');
  eq('1g. trigger has total', typeof trigger.total, 'number');
}

// ============================================================
// 2. Reaction registry includes the new trigger kind
// ============================================================
console.log('\n--- 2. Registry includes new trigger ---');
{
  const sb = getReactionSpell('Silvery Barbs');
  assert('2a. Silvery Barbs registered', sb !== undefined);
  assert('2b. triggerKinds includes incoming_save_success',
    sb?.triggerKinds.includes('incoming_save_success') === true);
  assert('2c. triggerKinds still includes incoming_attack_hit',
    sb?.triggerKinds.includes('incoming_attack_hit') === true);
}

// ============================================================
// 3. shouldCastReaction accepts 'incoming_save_success'
// ============================================================
console.log('\n--- 3. shouldCastReaction accepts save-success trigger ---');
{
  const caster = makeCasterWithSilveryBarbs('caster', { pos: { x: 0, y: 0, z: 0 } });
  const saver = makeCombatant('saver', { pos: { x: 2, y: 0, z: 0 }, faction: 'enemy' });
  const trigger = makeSaveSuccessTrigger(caster, saver);
  assert('3a. shouldCastReaction returns true for save-success',
    shouldCastReaction(caster, makeBF([caster, saver]), trigger) === true);
}

// ============================================================
// 4. shouldCastReaction rejects self-trigger (caster = saver)
// ============================================================
console.log('\n--- 4. shouldCastReaction rejects self-trigger ---');
{
  const caster = makeCasterWithSilveryBarbs('caster');
  // Self-save: caster is also the saver
  const trigger = makeSaveSuccessTrigger(caster, caster);
  assert('4a. shouldCastReaction returns false for self-save',
    shouldCastReaction(caster, makeBF([caster]), trigger) === false);
}

// ============================================================
// 5. shouldCastReaction rejects out-of-range
// ============================================================
console.log('\n--- 5. shouldCastReaction rejects out-of-range ---');
{
  const caster = makeCasterWithSilveryBarbs('caster', { pos: { x: 0, y: 0, z: 0 } });
  const saver = makeCombatant('saver', { pos: { x: 15, y: 0, z: 0 }, faction: 'enemy' }); // 75 ft away
  const trigger = makeSaveSuccessTrigger(caster, saver);
  assert('5a. shouldCastReaction returns false for >60 ft',
    shouldCastReaction(caster, makeBF([caster, saver]), trigger) === false);
}

// ============================================================
// 6. executeReaction rerolls and uses lower result
// ============================================================
console.log('\n--- 6. executeReaction rerolls ---');
{
  const caster = makeCasterWithSilveryBarbs('caster', { pos: { x: 0, y: 0, z: 0 } });
  const saver = makeCombatant('saver', { pos: { x: 2, y: 0, z: 0 }, faction: 'enemy' });
  const trigger = makeSaveSuccessTrigger(caster, saver, { roll: 18, total: 19, dc: 13 });
  const state = makeState(makeBF([caster, saver]));

  const slotsBefore = caster.resources!.spellSlots![1].remaining;
  const outcome = executeReaction(caster, state, trigger);

  // Slot consumed + reaction used
  eq('6a. spell slot consumed', caster.resources!.spellSlots![1].remaining, slotsBefore - 1);
  assert('6b. reactionUsed = true', caster.budget.reactionUsed === true);

  // Log entry mentions Silvery Barbs + reroll
  const log = state.log.events.find((e: CombatEvent) =>
    e.type === 'action' && e.description.includes('Silvery Barbs'));
  assert('6c. log mentions Silvery Barbs', log !== undefined);
  assert('6d. log mentions reroll', log?.description.includes('rerolls') === true);

  // Outcome is either 'negated' (reroll flipped) or 'failed' (didn't flip)
  assert('6e. outcome is negated or failed',
    outcome.kind === 'negated' || outcome.kind === 'failed');
}

// ============================================================
// 7. executeReaction returns 'negated' when reroll flips save to fail
// ============================================================
console.log('\n--- 7. negated when reroll flips save to fail ---');
{
  // Run many trials to verify 'negated' happens at least sometimes.
  // Original roll 14, DC 13 → success. Reroll could be 1-20; lower of (14, reroll)
  // fails when lower < 13 (i.e. reroll < 13 → 60% chance of negation).
  //
  // Session 70 fix: bumped N from 100 to 1000 to eliminate a rare statistical
  // flake (P(< 40 out of 100) ≈ 0.0015% = 1 in 69,000 — happened once in CI).
  // With N=1000 and threshold 400, P(failure) ≈ 10^-38 (essentially impossible).
  // Same approach as the Session 69 subclass_features flake fix (N 1000→5000).
  const N = 1000;
  let negatedCount = 0;
  let failedCount = 0;
  for (let i = 0; i < N; i++) {
    const caster = makeCasterWithSilveryBarbs(`caster_${i}`, { pos: { x: 0, y: 0, z: 0 } });
    const saver = makeCombatant(`saver_${i}`, { pos: { x: 2, y: 0, z: 0 }, faction: 'enemy' });
    const trigger = makeSaveSuccessTrigger(caster, saver, { roll: 14, total: 15, dc: 13 });
    const state = makeState(makeBF([caster, saver]));
    const outcome = executeReaction(caster, state, trigger);
    if (outcome.kind === 'negated') negatedCount++;
    if (outcome.kind === 'failed') failedCount++;
  }
  // With N=1000 trials and 60% negation probability, expected ~600 negations.
  // Threshold 400 is very conservative (P(failure) ≈ 10^-38).
  assert(`7a. negated at least 400 times out of ${N} (got ${negatedCount})`, negatedCount >= 400);
  assert(`7b. failed at least 100 times out of ${N} (got ${failedCount})`, failedCount >= 100);
}

// ============================================================
// 8. executeReaction returns 'failed' when reroll doesn't flip
// ============================================================
console.log('\n--- 8. failed when reroll does not flip ---');
{
  // Original roll 20, DC 13 → success. Reroll of 1-20; lower of (20, reroll) < 13
  // only when reroll < 13 (60% chance). But even on reroll 1, lower=1 fails.
  // However we want to test the 'failed' path: need lower of (20, reroll) >= 13,
  // which means reroll >= 13 (40% chance).
  //
  // Session 70 fix: bumped N from 100 to 1000 to eliminate a rare statistical
  // flake (P(< 20 out of 100) ≈ 0.0015% = 1 in 69,000). With N=1000 and
  // threshold 200, P(failure) ≈ 10^-38.
  const N = 1000;
  let failedCount = 0;
  for (let i = 0; i < N; i++) {
    const caster = makeCasterWithSilveryBarbs(`c_${i}`, { pos: { x: 0, y: 0, z: 0 } });
    const saver = makeCombatant(`s_${i}`, { pos: { x: 2, y: 0, z: 0 }, faction: 'enemy' });
    const trigger = makeSaveSuccessTrigger(caster, saver, { roll: 20, total: 21, dc: 13 });
    const state = makeState(makeBF([caster, saver]));
    const outcome = executeReaction(caster, state, trigger);
    if (outcome.kind === 'failed') failedCount++;
  }
  // Expected ~400 failures (reroll >= 13). Verify at least 200 (P(failure) ≈ 10^-38).
  assert(`8a. failed at least 200 times out of ${N} (got ${failedCount})`, failedCount >= 200);
}

// ============================================================
// 9. rollSaveReactable fires trigger on save success
// ============================================================
console.log('\n--- 9. rollSaveReactable fires trigger on save success ---');
{
  // Set up: caster has Silvery Barbs. Target has high DEX so save succeeds.
  const caster = makeCasterWithSilveryBarbs('caster', { pos: { x: 0, y: 0, z: 0 } });
  const saver = makeCombatant('saver', {
    pos: { x: 2, y: 0, z: 0 },
    faction: 'enemy',
    dex: 20, // +5 DEX mod
  });
  const state = makeState(makeBF([caster, saver]));

  // DC 10, DEX save. Saver has +5 DEX → succeeds on roll 5+.
  // Run trials until we get a successful save.
  let triggerFired = false;
  for (let i = 0; i < 50; i++) {
    // Reset reaction + slot each trial
    caster.budget.reactionUsed = false;
    caster.resources!.spellSlots![1].remaining = 4;
    const result = rollSaveReactable(state, caster, saver, 'dex', 10);
    if (result.success) {
      // Check log for Silvery Barbs entry (reaction fired)
      const sbLog = state.log.events.find((e: CombatEvent) =>
        e.type === 'action' && e.description.includes('Silvery Barbs'));
      if (sbLog) {
        triggerFired = true;
        break;
      }
    }
  }
  assert('9a. rollSaveReactable fired Silvery Barbs trigger on save success', triggerFired);
}

// ============================================================
// 10. rollSaveReactable does NOT fire trigger on save fail
// ============================================================
console.log('\n--- 10. rollSaveReactable does NOT fire on save fail ---');
{
  const caster = makeCasterWithSilveryBarbs('caster', { pos: { x: 0, y: 0, z: 0 } });
  // Saver with very low DEX, DC very high → save almost always fails
  const saver = makeCombatant('saver', {
    pos: { x: 2, y: 0, z: 0 },
    faction: 'enemy',
    dex: 1, // -5 DEX mod
  });
  const state = makeState(makeBF([caster, saver]));

  // DC 30 — impossible to save
  const result = rollSaveReactable(state, caster, saver, 'dex', 30);
  assert('10a. save fails (DC 30)', result.success === false);
  // No Silvery Barbs log entry (trigger didn't fire)
  const sbLog = state.log.events.find((e: CombatEvent) =>
    e.type === 'action' && e.description.includes('Silvery Barbs'));
  assert('10b. no Silvery Barbs log on save fail', sbLog === undefined);
  // Reaction not used
  assert('10c. reactionUsed still false', caster.budget.reactionUsed === false);
}

// ============================================================
// 11. rollSaveReactable returns success=false when reaction negates
// ============================================================
console.log('\n--- 11. rollSaveReactable returns success=false when negated ---');
{
  const caster = makeCasterWithSilveryBarbs('caster', { pos: { x: 0, y: 0, z: 0 } });
  const saver = makeCombatant('saver', {
    pos: { x: 2, y: 0, z: 0 },
    faction: 'enemy',
    dex: 20, // +5 DEX
  });
  const state = makeState(makeBF([caster, saver]));

  // Run trials until Silvery Barbs negates (reroll flips success → fail)
  let negatedFound = false;
  for (let i = 0; i < 100; i++) {
    caster.budget.reactionUsed = false;
    caster.resources!.spellSlots![1].remaining = 4;
    // DC 12, DEX +5 → success on roll 7+ (70% chance)
    const result = rollSaveReactable(state, caster, saver, 'dex', 12);
    // Check log: if Silvery Barbs fired AND negated, save success should be false
    // even though the original roll succeeded (>= 7)
    const sbLog = state.log.events.find((e: CombatEvent) =>
      e.type === 'action' && e.description.includes('now FAILS'));
    if (sbLog && result.success === false) {
      negatedFound = true;
      break;
    }
  }
  assert('11a. rollSaveReactable returned success=false after negation', negatedFound);
}

// ============================================================
// 12. rollSaveReactable doesn't fire for self-saves
// ============================================================
console.log('\n--- 12. rollSaveReactable doesn\'t fire for self-saves ---');
{
  const caster = makeCasterWithSilveryBarbs('caster', { pos: { x: 0, y: 0, z: 0 } });
  const state = makeState(makeBF([caster]));

  // Caster saves against their own spell (e.g. own Fireball caught in AoE)
  const result = rollSaveReactable(state, caster, caster, 'dex', 10);
  // No Silvery Barbs log entry
  const sbLog = state.log.events.find((e: CombatEvent) =>
    e.type === 'action' && e.description.includes('Silvery Barbs'));
  assert('12a. no Silvery Barbs log on self-save', sbLog === undefined);
  assert('12b. reactionUsed still false', caster.budget.reactionUsed === false);
}

// ============================================================
// 13. rollSaveReactable doesn't fire when reaction already used
// ============================================================
console.log('\n--- 13. rollSaveReactable doesn\'t fire when reaction used ---');
{
  const caster = makeCasterWithSilveryBarbs('caster', { pos: { x: 0, y: 0, z: 0 } });
  const saver = makeCombatant('saver', {
    pos: { x: 2, y: 0, z: 0 },
    faction: 'enemy',
    dex: 20,
  });
  // Mark reaction as already used
  caster.budget.reactionUsed = true;
  const state = makeState(makeBF([caster, saver]));

  const result = rollSaveReactable(state, caster, saver, 'dex', 10);
  // No Silvery Barbs log entry
  const sbLog = state.log.events.find((e: CombatEvent) =>
    e.type === 'action' && e.description.includes('Silvery Barbs'));
  assert('13a. no Silvery Barbs log when reaction already used', sbLog === undefined);
}

// ============================================================
// 14. End-to-end: Fireball + Silvery Barbs
// ============================================================
console.log('\n--- 14. End-to-end Fireball + Silvery Barbs ---');
{
  const caster = makeCasterWithSilveryBarbs('caster', {
    pos: { x: 0, y: 0, z: 0 },
    resources: {
      spellSlots: {
        1: { max: 4, remaining: 4 }, // for Silvery Barbs
        3: { max: 2, remaining: 2 }, // for Fireball
      },
    },
  });
  const target = makeCombatant('target', {
    pos: { x: 2, y: 0, z: 0 },
    faction: 'enemy',
    dex: 18, // high DEX → often saves
    maxHP: 100, currentHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  // Run trials until Silvery Barbs fires on a successful save
  let sbFiredOnFireball = false;
  for (let i = 0; i < 50; i++) {
    // Reset state for each trial
    caster.budget.reactionUsed = false;
    caster.resources!.spellSlots![1].remaining = 4;
    caster.resources!.spellSlots![3].remaining = 2;
    target.currentHP = 100;
    state.log.events = [];

    executeFireball(caster, [target], state);

    const sbLog = state.log.events.find((e: CombatEvent) =>
      e.type === 'action' && e.description.includes('Silvery Barbs') && e.description.includes('save'));
    if (sbLog) {
      sbFiredOnFireball = true;
      break;
    }
  }
  assert('14a. Silvery Barbs fired on Fireball save success', sbFiredOnFireball);
}

// ============================================================
// 15. End-to-end: Burning Hands + Silvery Barbs
// ============================================================
console.log('\n--- 15. End-to-end Burning Hands + Silvery Barbs ---');
{
  const caster = makeCasterWithSilveryBarbs('caster', {
    pos: { x: 0, y: 0, z: 0 },
    resources: {
      spellSlots: {
        1: { max: 4, remaining: 4 },
      },
    },
  });
  const target = makeCombatant('target', {
    pos: { x: 1, y: 0, z: 0 }, // adjacent (within 15-ft cone)
    faction: 'enemy',
    dex: 18,
    maxHP: 100, currentHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  let sbFiredOnBH = false;
  for (let i = 0; i < 50; i++) {
    caster.budget.reactionUsed = false;
    caster.resources!.spellSlots![1].remaining = 4;
    target.currentHP = 100;
    state.log.events = [];

    executeBurningHands(caster, [target], state);

    const sbLog = state.log.events.find((e: CombatEvent) =>
      e.type === 'action' && e.description.includes('Silvery Barbs') && e.description.includes('save'));
    if (sbLog) {
      sbFiredOnBH = true;
      break;
    }
  }
  assert('15a. Silvery Barbs fired on Burning Hands save success', sbFiredOnBH);
}

// ============================================================
// 16. End-to-end: Sacred Flame (resolveAttack save branch) + Silvery Barbs
// ============================================================
console.log('\n--- 16. End-to-end Sacred Flame + Silvery Barbs ---');
{
  const caster = makeCasterWithSilveryBarbs('caster', {
    pos: { x: 0, y: 0, z: 0 },
    resources: {
      spellSlots: {
        1: { max: 4, remaining: 4 },
      },
    },
  });
  const target = makeCombatant('target', {
    pos: { x: 2, y: 0, z: 0 },
    faction: 'enemy',
    dex: 18, // high DEX → often saves
    maxHP: 100, currentHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const sacredFlameAction: Action = {
    name: 'Sacred Flame',
    isMultiattack: false,
    attackType: 'save',
    reach: 60,
    range: { normal: 60, long: 60 },
    hitBonus: null,
    damage: { count: 1, sides: 8, bonus: 0, average: 4 },
    damageType: 'radiant',
    saveDC: 13,
    saveAbility: 'dex',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Sacred Flame',
  };

  let sbFiredOnSF = false;
  for (let i = 0; i < 50; i++) {
    caster.budget.reactionUsed = false;
    caster.resources!.spellSlots![1].remaining = 4;
    target.currentHP = 100;
    state.log.events = [];

    resolveAttack(caster, target, sacredFlameAction, state);

    const sbLog = state.log.events.find((e: CombatEvent) =>
      e.type === 'action' && e.description.includes('Silvery Barbs') && e.description.includes('save'));
    if (sbLog) {
      sbFiredOnSF = true;
      break;
    }
  }
  assert('16a. Silvery Barbs fired on Sacred Flame save success (via resolveAttack)', sbFiredOnSF);
}

// ============================================================
// 17. Metadata flag
// ============================================================
console.log('\n--- 17. Metadata flag ---');
{
  eq('17a. silveryBarbsSaveSuccessV1Implemented = true',
    (metadata as any).silveryBarbsSaveSuccessV1Implemented, true);
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('silvery_barbs_save_success.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('silvery_barbs_save_success.test.ts: all tests passed ✅');
}
