// ============================================================
// Test: Session 83 — GoI moving-zone on-enter protection +
//       sourceSlotLevel on moving-zone damage_zone effects
//
// PHB p.245: "Any spell of 5th level or lower cast from outside the
// barrier can't affect creatures or objects within it." This applies
// when a moving zone (Flaming Sphere, Moonbeam, Call Lightning,
// Cloudkill) moves into a GoI-protected creature's position — the
// creature should NOT take damage and should NOT receive a
// damage_zone effect.
//
// Prior state: the moving zone re-application code in combat.ts had
// NO GoI check — a GoI-protected creature caught by a moving zone
// took full damage and got a damage_zone effect. Additionally, the
// damage_zone effect created by the moving zone did NOT set
// sourceSlotLevel, so the per-tick GoI check (which uses
// zone.sourceSlotLevel ?? 0) defaulted to 0 = never blocked — meaning
// even the existing tick GoI check didn't protect moving-zone victims.
//
// Session 83 fix:
//   1. GoI check on moving-zone on-enter damage (mirrors on-cast
//      filterGoIProtectedTargets pattern; uses spellAction.slotLevel
//      for the level check + actor.id for caster-inside fix).
//   2. sourceSlotLevel set on the damage_zone effect created by the
//      moving zone (so per-tick GoI check works).
//
// Run: npx ts-node --transpile-only src/test/session83_goi_moving_zone.test.ts
// ============================================================

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

function makeCombatant(id: string, overrides: any = {}): any {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 1000, currentHP: 1000, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 1, con: 10, int: 10, wis: 16, cha: 10,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart', perception: { targets: new Map() },
    concentration: null, deathSaves: null, resources: null,
    tempHP: 0, exhaustionLevel: 0,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null,
    activeEffects: [],
    ...overrides,
  };
}

function makeBF(combatants: any[]) {
  return {
    width: 60, height: 60, depth: 5,
    cells: new Map(), round: 1,
    combatants: new Map(combatants.map((c: any) => [c.id, c])),
    initiativeOrder: combatants.map((c: any) => c.id),
  } as any;
}

function makeGoIEffect(blockThreshold: number, ownerId: string, sourceSlotLevel = 6): any {
  return {
    id: `eff_goi_${ownerId}_${blockThreshold}`,
    casterId: ownerId,
    spellName: 'Globe of Invulnerability',
    effectType: 'spell_shield',
    sourceSlotLevel, sourceIsConcentration: true,
    payload: { blockThreshold },
  };
}

// ============================================================
// Phase 1 — isProtectedByGoI: moving zone caster-inside
// ============================================================

console.log('\n=== Phase 1 — isProtectedByGoI: moving zone caster === GoI caster ===\n');

{
  // Caster has own GoI. An ally within the GoI radius would be protected
  // from an EXTERNAL caster's moving zone, but NOT from the GoI caster's
  // own moving zone (cast from inside the barrier).
  const goiCaster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'wiz')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([goiCaster, ally]);

  // Moonbeam is L2 → blocked by GoI threshold 5 for external caster.
  eq('1a. External caster: ally protected from L2 Moonbeam', isProtectedByGoI(ally, 2, bf, 'enemyCaster'), true);
  // Zone caster = GoI caster → ally NOT protected.
  eq('1b. Zone caster = GoI caster: ally NOT protected', isProtectedByGoI(ally, 2, bf, 'wiz'), false);
  // Cloudkill is L5 → blocked by GoI threshold 5 (5 ≤ 5).
  eq('1c. External caster: ally protected from L5 Cloudkill', isProtectedByGoI(ally, 5, bf, 'enemyCaster'), true);
  // Call Lightning is L3 → blocked.
  eq('1d. External caster: ally protected from L3 Call Lightning', isProtectedByGoI(ally, 3, bf, 'enemyCaster'), true);
  // L6 spell → penetrates threshold 5.
  eq('1e. L6 penetrates GoI threshold 5', isProtectedByGoI(ally, 6, bf, 'enemyCaster'), false);
}

// ============================================================
// Phase 2 — Simulated moving-zone on-enter GoI check logic
// ============================================================

console.log('\n=== Phase 2 — Simulated moving-zone on-enter GoI check ===\n');

{
  // Mirrors the combat.ts moving-zone GoI check:
  //   const mzSlotLevel = spellAction?.slotLevel ?? 0;
  //   if (mzSlotLevel > 0 && e.id !== actor.id &&
  //       isProtectedByGoI(e, mzSlotLevel, state.battlefield, actor.id)) {
  //     ... skip (GoI-protected) ...

  // 2a. GoI-protected target in moving zone path → blocked.
  const goiTarget = makeCombatant('prot', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'prot')],
  });
  const zoneCaster = makeCombatant('ext', { pos: { x: 0, y: 0, z: 0 } });
  const bf = makeBF([goiTarget, zoneCaster]);

  const mzSlotLevel = 3;  // Call Lightning L3
  const blocked = mzSlotLevel > 0 && goiTarget.id !== zoneCaster.id &&
    isProtectedByGoI(goiTarget, mzSlotLevel, bf, zoneCaster.id);
  assert('2a. GoI-protected: moving zone BLOCKED (L3 ≤ threshold 5)', blocked === true);

  // 2b. No GoI → not blocked.
  const noGoi = makeCombatant('nogoi', { pos: { x: 5, y: 5, z: 0 } });
  const bf2 = makeBF([noGoi, zoneCaster]);
  const blockedNone = 3 > 0 && noGoi.id !== zoneCaster.id &&
    isProtectedByGoI(noGoi, 3, bf2, zoneCaster.id);
  assert('2b. No GoI: moving zone NOT blocked', blockedNone === false);

  // 2c. Zone caster === GoI caster → not blocked (caster inside own barrier).
  const goiCasterIsZoneCaster = makeCombatant('both', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'both')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const bf3 = makeBF([goiCasterIsZoneCaster, ally]);
  const blockedSelf = 3 > 0 && ally.id !== goiCasterIsZoneCaster.id &&
    isProtectedByGoI(ally, 3, bf3, goiCasterIsZoneCaster.id);
  assert('2c. Zone caster === GoI caster: ally NOT blocked', blockedSelf === false);
}

// ============================================================
// Phase 3 — Source-code presence checks
// ============================================================

console.log('\n=== Phase 3 — Source-code presence checks ===\n');

{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine', 'combat.ts'), 'utf8');

  // 3a. Moving zone on-enter has GoI check.
  assert('3a. combat.ts moving-zone has GoI check with actor.id',
    src.includes('isProtectedByGoI(e, mzSlotLevel, state.battlefield, actor.id)'));

  // 3b. Moving zone on-enter has GoI negation log.
  assert('3b. combat.ts moving-zone has GoI negation log',
    src.includes('moving-zone damage negated'));

  // 3c. Moving zone damage_zone effect has sourceSlotLevel.
  // Find the moving-zone damage_zone applySpellEffect block (anchored on
  // 'sourceSlotLevel: mzSlotLevel' directly — it's unique in the file).
  assert('3c. Moving-zone damage_zone effect has sourceSlotLevel',
    src.includes('sourceSlotLevel: mzSlotLevel'));

  // 3d. mzSlotLevel is derived from spellAction.slotLevel.
  assert('3d. mzSlotLevel derived from spellAction?.slotLevel',
    src.includes('const mzSlotLevel = spellAction?.slotLevel ?? 0'));
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
