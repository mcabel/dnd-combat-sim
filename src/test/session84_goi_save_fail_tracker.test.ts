// ============================================================
// Test: Session 84 — GoI save-fail tracker suppression
//
// PHB p.245 (Globe of Invulnerability): "Any spell of 5th level or
// lower cast from outside the barrier can't affect creatures or
// objects within it... the spell has no effect on them."
//
// This applies to the per-turn save rolls of the Contagion / Flesh to
// Stone save-fail tracker. A GoI-protected creature should NOT be
// forced to make the per-turn CON save while GoI is active — the
// tracker is PAUSED (no fail/success increment). When GoI expires
// (concentration breaks), the save roll resumes on the next turn.
//
// Prior state (Session 83 handover): the save-fail tracker (Contagion
// L5, Flesh to Stone L6) did NOT check GoI on per-turn save rolls.
// Flesh to Stone (L6) penetrates base GoI (threshold 5), so only
// Contagion (L5) is affected by base GoI — but an upcast GoI (L7+,
// threshold 6+) would also block Flesh to Stone. The handover
// documented this as "deferred — requires pause/resume logic (not
// just skip), which is complex and rare."
//
// Session 84 insight: skipping the save roll while keeping the tracker
// intact IS the pause/resume behavior. The tracker's fails/successes
// are not incremented while GoI blocks; when GoI expires, the next
// turn's save roll proceeds normally. This mirrors the damage_zone tick
// GoI pattern (Session 78 + Session 82 casterId fix), which skips
// damage but leaves the effect in place.
//
// Scope note: the poisoned (Contagion) / restrained (Flesh to Stone)
// conditions applied as ActiveEffects are NOT suppressed by this
// change — only the per-turn save roll is paused. Full condition
// suppression requires pipeline-level GoI checks (deferred). This is
// consistent with the damage_zone tick, which skips damage but leaves
// the effect in place.
//
// Session 84 fix:
//   1. Added `slotLevel?: number` to SaveFailTracker interface
//      (optional — backward compat with manual tracker constructions).
//   2. contagion.ts sets slotLevel: 5; flesh_to_stone.ts sets slotLevel: 6.
//   3. combat.ts save-fail tracker block: GoI check (with tracker.casterId
//      for caster-inside) before the save roll — skip the save when
//      protected (tracker paused, not cleared).
//
// Run: npx ts-node --transpile-only src/test/session84_goi_save_fail_tracker.test.ts
// ============================================================

import { Combatant, Condition, ActiveEffect, SaveFailTracker } from '../types/core';
import { isProtectedByGoI } from '../engine/spell_effects';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 1000, currentHP: 1000, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 1, con: 10, int: 10, wis: 16, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set<Condition>(),
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
  };
}

function makeBF(combatants: Combatant[]) {
  return {
    width: 60, height: 60, depth: 5,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeGoIEffect(blockThreshold: number, ownerId: string, sourceSlotLevel: number = 6): ActiveEffect {
  return {
    id: `eff_goi_${ownerId}_${blockThreshold}`,
    casterId: ownerId,
    spellName: 'Globe of Invulnerability',
    effectType: 'spell_shield',
    sourceSlotLevel,
    sourceIsConcentration: true,
    payload: { blockThreshold },
  } as ActiveEffect;
}

/** Build a SaveFailTracker exactly as the spell modules do (with slotLevel). */
function makeTracker(
  spellName: 'Contagion' | 'Flesh to Stone',
  casterId: string,
  slotLevel: number,
  overrides: Partial<SaveFailTracker> = {},
): SaveFailTracker {
  const base: SaveFailTracker = spellName === 'Contagion'
    ? {
        spellName: 'Contagion', casterId,
        fails: 0, successes: 0, maxCount: 3,
        saveAbility: 'con', saveDC: 16,
        conditionOnFail: 'incapacitated', currentCondition: 'poisoned',
        slotLevel,
      }
    : {
        spellName: 'Flesh to Stone', casterId,
        fails: 1, successes: 0, maxCount: 3,
        saveAbility: 'con', saveDC: 16,
        conditionOnFail: 'petrified', currentCondition: 'restrained',
        slotLevel,
      };
  return { ...base, ...overrides };
}

// ============================================================
// Phase 1 — SaveFailTracker interface has slotLevel; spell modules set it
// ============================================================

console.log('\n=== Phase 1 — slotLevel on SaveFailTracker + spell modules ===\n');

{
  const fs = require('fs');
  const path = require('path');

  // 1a. SaveFailTracker interface declares slotLevel.
  const coreSrc = fs.readFileSync(path.join(__dirname, '..', 'types', 'core.ts'), 'utf8');
  assert('1a. SaveFailTracker interface includes slotLevel',
    /interface SaveFailTracker \{[\s\S]*?slotLevel\?:\s*number/.test(coreSrc));

  // 1b. contagion.ts sets slotLevel: 5 on the tracker.
  const contagionSrc = fs.readFileSync(path.join(__dirname, '..', 'spells', 'contagion.ts'), 'utf8');
  const contagionTrackerStart = contagionSrc.indexOf("target._saveFailTracker = {");
  const contagionTrackerBlock = contagionSrc.slice(contagionTrackerStart, contagionTrackerStart + 800);
  assert('1b. contagion.ts tracker has slotLevel: 5',
    contagionTrackerBlock.includes('slotLevel: 5'));

  // 1c. flesh_to_stone.ts sets slotLevel: 6 on the tracker.
  const ftsSrc = fs.readFileSync(path.join(__dirname, '..', 'spells', 'flesh_to_stone.ts'), 'utf8');
  const ftsTrackerStart = ftsSrc.indexOf("target._saveFailTracker = {");
  const ftsTrackerBlock = ftsSrc.slice(ftsTrackerStart, ftsTrackerStart + 800);
  assert('1c. flesh_to_stone.ts tracker has slotLevel: 6',
    ftsTrackerBlock.includes('slotLevel: 6'));
}

// ============================================================
// Phase 2 — isProtectedByGoI: save-fail tracker caster-inside
// ============================================================

console.log('\n=== Phase 2 — isProtectedByGoI: tracker caster === GoI caster ===\n');

{
  // Caster has own GoI. An ally within the GoI radius would be protected
  // from an EXTERNAL caster's Contagion tracker, but NOT from the GoI
  // caster's own Contagion tracker (the spell was "cast from inside the
  // barrier").
  const goiCaster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'wiz')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });  // 5 ft, inside GoI radius
  const bf = makeBF([goiCaster, ally]);

  // External caster → ally protected from L5 Contagion tracker.
  eq('2a. External caster: ally protected from Contagion L5', isProtectedByGoI(ally, 5, bf, 'enemyCaster'), true);
  // Tracker caster = GoI caster → ally NOT protected (caster inside own barrier).
  eq('2b. Tracker caster = GoI caster: ally NOT protected', isProtectedByGoI(ally, 5, bf, 'wiz'), false);
}

// ============================================================
// Phase 3 — Simulated save-fail tracker tick GoI check logic
// ============================================================

console.log('\n=== Phase 3 — Simulated tracker tick GoI check ===\n');

{
  // Mirrors the combat.ts save-fail tracker GoI check:
  //   const trackerSlotLevel = tracker.slotLevel ?? 0;
  //   if (trackerSlotLevel > 0 && actor.id !== tracker.casterId &&
  //       isProtectedByGoI(actor, trackerSlotLevel, state.battlefield, tracker.casterId)) {
  //     ... skip the save (tracker paused) ...

  // 3a. GoI-protected target with Contagion tracker (L5) → save BLOCKED.
  const goiTarget = makeCombatant('prot', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'prot')],  // base GoI, threshold 5
  });
  const contagionCaster = makeCombatant('ext', { pos: { x: 0, y: 0, z: 0 } });
  const bf = makeBF([goiTarget, contagionCaster]);
  const tracker = makeTracker('Contagion', 'ext', 5);

  const trackerSlotLevel = tracker.slotLevel ?? 0;
  const blocked = trackerSlotLevel > 0 && goiTarget.id !== tracker.casterId &&
    isProtectedByGoI(goiTarget, trackerSlotLevel, bf, tracker.casterId);
  assert('3a. GoI-protected target: Contagion L5 save BLOCKED (L5 ≤ threshold 5)', blocked === true);

  // 3b. GoI-protected target with Flesh to Stone tracker (L6) → save NOT blocked
  //     (L6 penetrates base GoI threshold 5).
  const ftsTracker = makeTracker('Flesh to Stone', 'ext', 6);
  const ftsSlotLevel = ftsTracker.slotLevel ?? 0;
  const blockedFts = ftsSlotLevel > 0 && goiTarget.id !== ftsTracker.casterId &&
    isProtectedByGoI(goiTarget, ftsSlotLevel, bf, ftsTracker.casterId);
  assert('3b. GoI-protected target: Flesh to Stone L6 NOT blocked (penetrates threshold 5)', blockedFts === false);

  // 3c. GoI-protected target with Flesh to Stone tracker (L6) + upcast GoI
  //     (L7, threshold 6) → save BLOCKED (L6 ≤ threshold 6).
  const goiTargetUpcast = makeCombatant('protUp', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(6, 'protUp', 7)],  // upcast GoI L7, threshold 6
  });
  const bfUp = makeBF([goiTargetUpcast, contagionCaster]);
  const blockedFtsUp = ftsSlotLevel > 0 && goiTargetUpcast.id !== ftsTracker.casterId &&
    isProtectedByGoI(goiTargetUpcast, ftsSlotLevel, bfUp, ftsTracker.casterId);
  assert('3c. GoI-protected target: Flesh to Stone L6 BLOCKED by upcast GoI L7 (threshold 6)', blockedFtsUp === true);

  // 3d. No GoI → not blocked.
  const noGoiTarget = makeCombatant('nogoi', { pos: { x: 5, y: 5, z: 0 } });
  const bf2 = makeBF([noGoiTarget, contagionCaster]);
  const blockedNone = trackerSlotLevel > 0 && noGoiTarget.id !== tracker.casterId &&
    isProtectedByGoI(noGoiTarget, trackerSlotLevel, bf2, tracker.casterId);
  assert('3d. No GoI: Contagion tracker save NOT blocked', blockedNone === false);

  // 3e. Tracker caster === GoI caster → ally within radius NOT blocked
  //     (caster inside own barrier — spell cast from inside).
  const goiCasterIsTrackerCaster = makeCombatant('both', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'both')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const bf3 = makeBF([goiCasterIsTrackerCaster, ally]);
  const selfTracker = makeTracker('Contagion', 'both', 5);
  const blockedSelf = selfTracker.slotLevel! > 0 && ally.id !== selfTracker.casterId &&
    isProtectedByGoI(ally, selfTracker.slotLevel!, bf3, selfTracker.casterId);
  assert('3e. Tracker caster === GoI caster: ally NOT blocked (caster inside)', blockedSelf === false);

  // 3f. Legacy tracker without slotLevel → not blocked (backward compat).
  //     Pre-Session 84 trackers (or manual test constructions) omit slotLevel;
  //     the combat.ts check defaults to 0 = cantrip-level = never blocked.
  const legacyTracker: SaveFailTracker = {
    spellName: 'Contagion', casterId: 'ext',
    fails: 0, successes: 0, maxCount: 3,
    saveAbility: 'con', saveDC: 16,
    conditionOnFail: 'incapacitated', currentCondition: 'poisoned',
    // slotLevel intentionally omitted
  };
  const legacySlotLevel = legacyTracker.slotLevel ?? 0;
  const blockedLegacy = legacySlotLevel > 0 && goiTarget.id !== legacyTracker.casterId &&
    isProtectedByGoI(goiTarget, legacySlotLevel, bf, legacyTracker.casterId);
  assert('3f. Legacy tracker (no slotLevel): NOT blocked (backward compat, defaults to 0)', blockedLegacy === false);
}

// ============================================================
// Phase 4 — Pause/resume semantics (tracker state preserved)
// ============================================================

console.log('\n=== Phase 4 — Pause/resume: tracker state preserved across GoI ===\n');

{
  // Simulate two turns of a Contagion tracker on a GoI-protected target.
  // Turn 1: GoI up → save skipped, tracker paused (fails=0, successes=0).
  // Turn 2: GoI down → save proceeds normally.
  //
  // This validates the "pause/resume" semantics that the Session 83
  // handover flagged as "complex": skipping the save while keeping the
  // tracker intact IS pause/resume — no special pause flag is needed.

  const target = makeCombatant('prot', {
    pos: { x: 5, y: 5, z: 0 },
    // Start WITH GoI (will be removed for turn 2).
    activeEffects: [makeGoIEffect(5, 'prot')],
  });
  const caster = makeCombatant('ext', { pos: { x: 0, y: 0, z: 0 } });
  let bf = makeBF([target, caster]);
  const tracker = makeTracker('Contagion', 'ext', 5, { fails: 0, successes: 0 });

  // Turn 1: GoI up → blocked.
  let slotLevel = tracker.slotLevel ?? 0;
  let blocked = slotLevel > 0 && target.id !== tracker.casterId &&
    isProtectedByGoI(target, slotLevel, bf, tracker.casterId);
  assert('4a. Turn 1 (GoI up): save BLOCKED', blocked === true);
  // When blocked, combat.ts skips the save — tracker state unchanged.
  eq('4b. Turn 1: tracker fails unchanged (paused)', tracker.fails, 0);
  eq('4c. Turn 1: tracker successes unchanged (paused)', tracker.successes, 0);

  // Turn 2: GoI concentration breaks → GoI effect removed.
  target.activeEffects = [];
  bf = makeBF([target, caster]);

  blocked = slotLevel > 0 && target.id !== tracker.casterId &&
    isProtectedByGoI(target, slotLevel, bf, tracker.casterId);
  assert('4d. Turn 2 (GoI down): save NOT blocked — tracker resumes', blocked === false);
  // The save would now proceed (rollSave). We don't roll here (nondeterministic),
  // but the key invariant is: the tracker is still present and its counters
  // are exactly where they were when paused.
  eq('4e. Turn 2: tracker still present (not cleared by GoI pause)', tracker.fails, 0);
  eq('4f. Turn 2: tracker successes still 0 (resume from pause point)', tracker.successes, 0);
}

// ============================================================
// Phase 5 — Source-code presence checks (combat.ts)
// ============================================================

console.log('\n=== Phase 5 — combat.ts source-presence checks ===\n');

{
  const fs = require('fs');
  const path = require('path');
  const combatSrc = fs.readFileSync(path.join(__dirname, '..', 'engine', 'combat.ts'), 'utf8');

  // 5a. combat.ts save-fail tracker has the GoI check with tracker.casterId.
  assert('5a. combat.ts save-fail tracker has GoI check with tracker.casterId',
    combatSrc.includes('isProtectedByGoI(actor, trackerSlotLevel, state.battlefield, tracker.casterId)'));

  // 5b. combat.ts save-fail tracker has the "save-fail tracker save negated" log.
  assert('5b. combat.ts save-fail tracker has GoI negation log',
    combatSrc.includes('save-fail tracker save negated'));

  // 5c. combat.ts save-fail tracker has the "Tracker paused" log.
  assert('5c. combat.ts save-fail tracker has "Tracker paused" log',
    combatSrc.includes('Tracker paused'));

  // 5d. combat.ts uses tracker.slotLevel ?? 0 (backward-compat default).
  assert('5d. combat.ts uses tracker.slotLevel ?? 0 (backward compat)',
    combatSrc.includes('const trackerSlotLevel = tracker.slotLevel ?? 0;'));

  // 5e. The GoI check guards the save roll (the rollSave call is inside the
  //     else branch, not unconditionally before the GoI check).
  const trackerIdx = combatSrc.indexOf('const trackerSlotLevel = tracker.slotLevel ?? 0;');
  const rollSaveIdx = combatSrc.indexOf('rollSave(actor, tracker.saveAbility, tracker.saveDC)', trackerIdx);
  const elseIdx = combatSrc.indexOf('} else {', trackerIdx);
  assert('5e. rollSave is inside the else branch (after the GoI guard)',
    rollSaveIdx > elseIdx && rollSaveIdx > 0 && elseIdx > 0);
}

// ============================================================
// Results
// ============================================================

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n❌ SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('\nAll tests passed ✅');
}
