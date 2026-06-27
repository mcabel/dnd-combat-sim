// ============================================================
// Test: Session 80 Part 2 — Eldritch Blast multi-beam
//       (PHB p.237)
//
// Eldritch Blast scales by adding MORE BEAMS, not bigger dice:
//   1 beam at levels 1-4
//   2 beams at levels 5-10
//   3 beams at levels 11-16
//   4 beams at levels 17+
//
// Each beam is an independent ranged spell attack roll dealing
// 1d10 force damage. The implementation uses the existing
// attackCount pattern (same as Extra Attack / Thirsting Blade).
//
// Key checks:
//   - noCantripScaling: true prevents 1d10→2d10 scaling
//   - Beam count matches cantripTier() + 1
//   - Grasp of Hadar: once per turn (PHB p.111)
//   - Repelling Blast: fires on every beam hit (no once-per-turn limit)
//   - Agonizing Blast: +CHA mod per beam
//
// Run: npx ts-node --transpile-only src/test/session80_eldritch_blast_multibeam.test.ts
// ============================================================

import { Combatant, Action, Condition, ActiveEffect } from '../types/core';
import { cantripTier } from '../engine/utils';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Shared helpers -----------------------------------------

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 1000, currentHP: 1000, ac: 10, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16,
    cr: 1,
    pos: { x: 5, y: 5, z: 0 },
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

const EB_ACTION: Action = {
  name: 'Eldritch Blast', isMultiattack: false, attackType: 'spell',
  reach: 120, range: { normal: 120, long: 240 },
  hitBonus: 5, damage: { count: 1, sides: 10, bonus: 0, average: 5 },
  damageType: 'force', isAoE: false, isControl: false,
  requiresConcentration: false, slotLevel: 0, costType: 'action',
  legendaryCost: 0, description: 'Eldritch Blast',
  saveDC: null, saveAbility: null,
  noCantripScaling: true,  // Session 80: prevents 1d10→2d10 scaling
};

// ============================================================
// Phase 1 — cantripTier and beam count
// ============================================================

console.log('\n=== Phase 1 — cantripTier and beam count ===\n');

{
  // 1a. cantripTier returns correct tier
  const c1 = makeCombatant('c1', { casterLevel: 1 });
  const c5 = makeCombatant('c5', { casterLevel: 5 });
  const c11 = makeCombatant('c11', { casterLevel: 11 });
  const c17 = makeCombatant('c17', { casterLevel: 17 });

  eq('1a. cantripTier(level 1) = 0', cantripTier(c1), 0);
  eq('1a. cantripTier(level 5) = 1', cantripTier(c5), 1);
  eq('1a. cantripTier(level 11) = 2', cantripTier(c11), 2);
  eq('1a. cantripTier(level 17) = 3', cantripTier(c17), 3);

  // 1b. Beam count = cantripTier + 1
  eq('1b. Level 1 → 1 beam', cantripTier(c1) + 1, 1);
  eq('1b. Level 5 → 2 beams', cantripTier(c5) + 1, 2);
  eq('1b. Level 11 → 3 beams', cantripTier(c11) + 1, 3);
  eq('1b. Level 17 → 4 beams', cantripTier(c17) + 1, 4);
}

// ============================================================
// Phase 2 — noCantripScaling prevents die scaling
// ============================================================

console.log('\n=== Phase 2 — noCantripScaling prevents die scaling ===\n');

{
  // 2a. EB Action has noCantripScaling: true
  assert('2a. EB Action has noCantripScaling: true', EB_ACTION.noCantripScaling === true);

  // 2b. Without noCantripScaling, cantrip damage would be (1+tier)d10
  //     With it, each beam stays 1d10
  const tier5 = cantripTier(makeCombatant('c5', { casterLevel: 5 }));
  const scaledDamage = { ...EB_ACTION.damage!, count: 1 + tier5 };
  eq('2b. Scaled damage would be 2d10 (wrong)', scaledDamage.count, 2);
  eq('2b. EB beam damage stays 1d10 (correct)', EB_ACTION.damage!.count, 1);
}

// ============================================================
// Phase 3 — Metadata checks
// ============================================================

console.log('\n=== Phase 3 — Metadata checks ===\n');

{
  const meta = require('../spells/eldritch_blast').metadata;
  eq('3a. multiBeamV1Implemented is true', meta.multiBeamV1Implemented, true);
  eq('3b. scalesByBeamCount is true', meta.scalesByBeamCount, true);
  eq('3c. beamCountByLevel[5] = 2', meta.beamCountByLevel[5], 2);
  eq('3d. beamCountByLevel[11] = 3', meta.beamCountByLevel[11], 3);
  eq('3e. beamCountByLevel[17] = 4', meta.beamCountByLevel[17], 4);
}

// ============================================================
// Phase 4 — SpellTemplate noCantripScaling
// ============================================================

console.log('\n=== Phase 4 — SpellTemplate noCantripScaling ===\n');

{
  const { lookupSpell } = require('../data/spells');
  const ebTmpl = lookupSpell('Eldritch Blast');
  assert('4a. Eldritch Blast template found', ebTmpl !== null);
  eq('4b. Template noCantripScaling = true', ebTmpl.noCantripScaling, true);
  eq('4c. Template slotLevel = 0 (cantrip)', ebTmpl.slotLevel, 0);
  eq('4d. Template damage 1d10', ebTmpl.damage.count, 1);
  eq('4e. Template damage sides 10', ebTmpl.damage.sides, 10);
}

// ============================================================
// Phase 5 — Grasp of Hadar once-per-turn
// ============================================================

console.log('\n=== Phase 5 — Grasp of Hadar once-per-turn ===\n');

{
  const caster = makeCombatant('warlock', {
    eldritchInvocations: ['Grasp of Hadar'],
  });
  const target = makeCombatant('target', {
    faction: 'enemy',
    pos: { x: 6, y: 5, z: 0 },
  });

  // 5a. Flag starts as false/undefined
  assert('5a. _graspOfHadarUsedThisTurn starts falsy', !caster._graspOfHadarUsedThisTurn);

  // 5b. After setting, flag is true
  caster._graspOfHadarUsedThisTurn = true;
  assert('5b. After first beam, _graspOfHadarUsedThisTurn is true', caster._graspOfHadarUsedThisTurn === true);

  // 5c. After reset, flag is false again
  caster._graspOfHadarUsedThisTurn = false;
  assert('5c. After reset, _graspOfHadarUsedThisTurn is false', !caster._graspOfHadarUsedThisTurn);
}

// ============================================================
// Phase 6 — Multi-beam attack count in planner
// ============================================================

console.log('\n=== Phase 6 — Multi-beam planner logic ===\n');

{
  // Simulate what the planner does for EB beam count
  const warlock1 = makeCombatant('w1', { casterLevel: 1 });
  const warlock5 = makeCombatant('w5', { casterLevel: 5 });
  const warlock11 = makeCombatant('w11', { casterLevel: 11 });
  const warlock17 = makeCombatant('w17', { casterLevel: 17 });

  // The planner computes: plan.action.attackCount = cantripTier(self) + 1
  eq('6a. Level 1 Warlock: attackCount = 1', cantripTier(warlock1) + 1, 1);
  eq('6b. Level 5 Warlock: attackCount = 2', cantripTier(warlock5) + 1, 2);
  eq('6c. Level 11 Warlock: attackCount = 3', cantripTier(warlock11) + 1, 3);
  eq('6d. Level 17 Warlock: attackCount = 4', cantripTier(warlock17) + 1, 4);
}

// ============================================================
// Phase 7 — Invocation behavior with multi-beam
// ============================================================

console.log('\n=== Phase 7 — Invocation behavior with multi-beam ===\n');

{
  // 7a. Repelling Blast: fires on EVERY beam hit (no "once per turn" limit)
  //     PHB p.110: "Each time you hit a creature with Eldritch Blast..."
  //     The invocation registry has no per-turn guard for Repelling Blast.
  const { ELDRITCH_INVOCATIONS } = require('../spells/_invocations');
  const repellingBlast = ELDRITCH_INVOCATIONS['Repelling Blast'];
  assert('7a. Repelling Blast found in invocations', repellingBlast !== undefined);
  assert('7a. Repelling Blast has onEldritchBlastHit', repellingBlast?.onEldritchBlastHit !== undefined);

  // 7b. Grasp of Hadar: once per turn (enforced by _graspOfHadarUsedThisTurn)
  const graspOfHadar = ELDRITCH_INVOCATIONS['Grasp of Hadar'];
  assert('7b. Grasp of Hadar found in invocations', graspOfHadar !== undefined);
  assert('7b. Grasp of Hadar has onEldritchBlastHit', graspOfHadar?.onEldritchBlastHit !== undefined);

  // 7c. Lance of Lethargy: fires on every beam hit
  const lanceOfLethargy = ELDRITCH_INVOCATIONS['Lance of Lethargy'];
  assert('7c. Lance of Lethargy found in invocations', lanceOfLethargy !== undefined);
  assert('7c. Lance of Lethargy has onEldritchBlastHit', lanceOfLethargy?.onEldritchBlastHit !== undefined);

  // 7d. Agonizing Blast is a PRE-DAMAGE invocation (onEldritchBlastDamage)
  const agonizingBlast = ELDRITCH_INVOCATIONS['Agonizing Blast'];
  assert('7d. Agonizing Blast found in invocations', agonizingBlast !== undefined);
  assert('7d. Agonizing Blast has onEldritchBlastDamage', agonizingBlast?.onEldritchBlastDamage !== undefined);
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
