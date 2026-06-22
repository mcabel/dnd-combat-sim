// ============================================================
// Test: Couatl Innate Spellcasting (Session 41, Task #2)
//
// Validates that the Couatl summon (from conjure_celestial.ts)
// has its 3/day innate spellcasting properly wired:
//   - Bless, Cure Wounds, Sanctuary actions are present
//   - resources.innateSpellcasting has 3/day each
//   - hasInnateSpellUse + consumeInnateSpellUse work correctly
//   - canCastSpell returns true for innate spells (no slots needed)
//   - shouldCastBless returns targets for the Couatl (no slots needed)
//   - shouldCastCureWounds returns targets for the Couatl (no slots needed)
//   - End-to-end: Couatl casts Bless via innate use (decrements counter)
//   - End-to-end: Couatl casts Cure Wounds via innate use (decrements counter)
//   - 3/day cap enforced (4th cast attempt fails)
//
// Run: npx ts-node src/test/couatl_innate_spellcasting.test.ts
// ============================================================

import { createCouatl } from '../spells/conjure_celestial';
import { shouldCast as shouldCastBless, execute as executeBless } from '../spells/bless';
import { shouldCast as shouldCastCureWounds, execute as executeCureWounds } from '../spells/cure_wounds';
import {
  hasInnateSpellUse,
  consumeInnateSpellUse,
  canCastSpell,
  hasSpellSlot,
} from '../ai/resources';
import { Combatant, Action, AIProfile, Vec3 } from '../types/core';

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

function makeCaster(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: true, faction: 'party',
    maxHP: 50, currentHP: 50, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 18,
    cr: null,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart',
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: { successes: 0, failures: 0 },
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

function makeAlly(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return makeCaster(id, {
    isPlayer: true,
    faction: 'party',
    pos: { x: 1, y: 0, z: 0 },
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

// ============================================================
// 1. Couatl has innate spellcasting resources
// ============================================================
console.log('\n--- 1. Couatl innate spellcasting resources ---');
{
  const caster = makeCaster('caster');
  const couatl = createCouatl(caster, 7);

  assert('1a. Couatl has resources', couatl.resources !== null);
  assert('1b. Couatl has innateSpellcasting', !!couatl.resources?.innateSpellcasting);
  eq('1c. Bless max = 3', couatl.resources!.innateSpellcasting!['Bless'].max, 3);
  eq('1d. Bless remaining = 3', couatl.resources!.innateSpellcasting!['Bless'].remaining, 3);
  eq('1e. Cure Wounds max = 3', couatl.resources!.innateSpellcasting!['Cure Wounds'].max, 3);
  eq('1f. Cure Wounds remaining = 3', couatl.resources!.innateSpellcasting!['Cure Wounds'].remaining, 3);
  eq('1g. Sanctuary max = 3', couatl.resources!.innateSpellcasting!['Sanctuary'].max, 3);
  eq('1h. Sanctuary remaining = 3', couatl.resources!.innateSpellcasting!['Sanctuary'].remaining, 3);
}

// ============================================================
// 2. Couatl has innate spell Actions
// ============================================================
console.log('\n--- 2. Couatl innate spell Actions ---');
{
  const caster = makeCaster('caster');
  const couatl = createCouatl(caster, 7);

  const blessAction = couatl.actions.find(a => a.name === 'Bless');
  assert('2a. Bless Action present', blessAction !== undefined);
  eq('2b. Bless slotLevel = 0 (innate)', blessAction?.slotLevel, 0);
  eq('2c. Bless requiresConcentration = true', blessAction?.requiresConcentration, true);
  eq('2d. Bless costType = action', blessAction?.costType, 'action');

  const cwAction = couatl.actions.find(a => a.name === 'Cure Wounds');
  assert('2e. Cure Wounds Action present', cwAction !== undefined);
  eq('2f. Cure Wounds slotLevel = 0 (innate)', cwAction?.slotLevel, 0);

  const sanctuaryAction = couatl.actions.find(a => a.name === 'Sanctuary');
  assert('2g. Sanctuary Action present', sanctuaryAction !== undefined);
  eq('2h. Sanctuary slotLevel = 0 (innate)', sanctuaryAction?.slotLevel, 0);
  eq('2i. Sanctuary costType = bonusAction', sanctuaryAction?.costType, 'bonusAction');
}

// ============================================================
// 3. hasInnateSpellUse + consumeInnateSpellUse
// ============================================================
console.log('\n--- 3. hasInnateSpellUse + consumeInnateSpellUse ---');
{
  const caster = makeCaster('caster');
  const couatl = createCouatl(caster, 7);

  // Initially has 3 uses of Bless
  assert('3a. hasInnateSpellUse(Bless) = true', hasInnateSpellUse(couatl, 'Bless'));
  assert('3b. hasInnateSpellUse(Cure Wounds) = true', hasInnateSpellUse(couatl, 'Cure Wounds'));
  assert('3c. hasInnateSpellUse(Sanctuary) = true', hasInnateSpellUse(couatl, 'Sanctuary'));
  // Unknown spell returns false
  assert('3d. hasInnateSpellUse(Fireball) = false (not tracked)', !hasInnateSpellUse(couatl, 'Fireball'));

  // Consume one Bless
  const consumed = consumeInnateSpellUse(couatl, 'Bless');
  assert('3e. consumeInnateSpellUse(Bless) returns true', consumed);
  eq('3f. Bless remaining = 2 after consume', couatl.resources!.innateSpellcasting!['Bless'].remaining, 2);

  // Consume 2 more (down to 0)
  consumeInnateSpellUse(couatl, 'Bless');
  consumeInnateSpellUse(couatl, 'Bless');
  eq('3g. Bless remaining = 0 after 3 consumes', couatl.resources!.innateSpellcasting!['Bless'].remaining, 0);
  assert('3h. hasInnateSpellUse(Bless) = false when 0', !hasInnateSpellUse(couatl, 'Bless'));

  // 4th consume fails (returns false, no decrement below 0)
  const overConsume = consumeInnateSpellUse(couatl, 'Bless');
  assert('3i. 4th consume returns false (cap reached)', !overConsume);
  eq('3j. Bless remaining still 0 (not negative)', couatl.resources!.innateSpellcasting!['Bless'].remaining, 0);
}

// ============================================================
// 4. canCastSpell returns true for Couatl's innate spells
// ============================================================
console.log('\n--- 4. canCastSpell helper ---');
{
  const caster = makeCaster('caster');
  const couatl = createCouatl(caster, 7);

  // Couatl has no standard spell slots
  assert('4a. Couatl has NO spell slots', !hasSpellSlot(couatl, 1));
  // But can cast Bless via innate spellcasting
  assert('4b. canCastSpell(Bless) = true (innate)', canCastSpell(couatl, 'Bless'));
  assert('4c. canCastSpell(Cure Wounds) = true (innate)', canCastSpell(couatl, 'Cure Wounds'));
  // Can't cast Fireball (not innate, no slots)
  assert('4d. canCastSpell(Fireball) = false (no innate, no slots)', !canCastSpell(couatl, 'Fireball'));
}

// ============================================================
// 5. shouldCastBless works for Couatl (no slots required)
// ============================================================
console.log('\n--- 5. shouldCastBless works for Couatl ---');
{
  const caster = makeCaster('caster', { pos: { x: 0, y: 0, z: 0 } });
  const couatl = createCouatl(caster, 7);
  couatl.pos = { x: 1, y: 0, z: 0 }; // Couatl near allies
  const ally1 = makeAlly('ally1', { pos: { x: 2, y: 0, z: 0 } });
  const ally2 = makeAlly('ally2', { pos: { x: 3, y: 0, z: 0 } });

  const bf = makeBF([caster, couatl, ally1, ally2]);

  // Couatl can cast Bless — should return up to 3 targets
  const targets = shouldCastBless(couatl, bf);
  assert('5a. shouldCastBless returns targets array for Couatl', targets !== null);
  if (targets) {
    assert('5b. at least 1 bless target', targets.length >= 1);
    // Targets should be in the caster's faction (Couatl inherits faction from caster)
    assert('5c. all targets in Couatl faction',
      targets.every(t => t.faction === couatl.faction));
  }
}

// ============================================================
// 6. shouldCastCureWounds works for Couatl (no slots required)
// ============================================================
console.log('\n--- 6. shouldCastCureWounds works for Couatl ---');
{
  const caster = makeCaster('caster', { pos: { x: 0, y: 0, z: 0 } });
  const couatl = createCouatl(caster, 7);
  couatl.pos = { x: 1, y: 0, z: 0 };

  // Downed ally within touch range (5 ft = 1 square)
  const downedAlly = makeAlly('downed', {
    pos: { x: 2, y: 0, z: 0 },
    isUnconscious: true,
    isDead: false,
    currentHP: 0,
    maxHP: 20,
  });

  const bf = makeBF([caster, couatl, downedAlly]);

  // Couatl should want to cast Cure Wounds on the downed ally
  const target = shouldCastCureWounds(couatl, bf);
  assert('6a. shouldCastCureWounds returns target for Couatl', target !== null);
  if (target) {
    eq('6b. target is the downed ally', target.id, 'downed');
  }
}

// ============================================================
// 7. End-to-end: Couatl casts Bless (decrements innate counter)
// ============================================================
console.log('\n--- 7. End-to-end Couatl casts Bless ---');
{
  const caster = makeCaster('caster', { pos: { x: 0, y: 0, z: 0 } });
  const couatl = createCouatl(caster, 7);
  couatl.pos = { x: 1, y: 0, z: 0 };
  const ally1 = makeAlly('ally1', { pos: { x: 2, y: 0, z: 0 } });
  const ally2 = makeAlly('ally2', { pos: { x: 3, y: 0, z: 0 } });

  const bf = makeBF([caster, couatl, ally1, ally2]);
  const state = makeState(bf);

  const targets = shouldCastBless(couatl, bf)!;
  const blessBefore = couatl.resources!.innateSpellcasting!['Bless'].remaining;
  executeBless(couatl, targets, state);

  // Verify innate counter decremented
  const blessAfter = couatl.resources!.innateSpellcasting!['Bless'].remaining;
  eq('7a. Bless remaining decremented (3 → 2)', blessAfter, blessBefore - 1);

  // Verify log entry
  const blessLog = state.log.events.find((e: any) =>
    e.type === 'action' && e.description.includes('Bless'));
  assert('7b. Bless log entry present', blessLog !== undefined);

  // Verify concentration started
  assert('7c. Couatl now concentrating on Bless', couatl.concentration?.active === true);
  eq('7d. concentration.spellName = Bless', couatl.concentration?.spellName, 'Bless');
}

// ============================================================
// 8. End-to-end: Couatl casts Cure Wounds (decrements innate counter)
// ============================================================
console.log('\n--- 8. End-to-end Couatl casts Cure Wounds ---');
{
  const caster = makeCaster('caster', { pos: { x: 0, y: 0, z: 0 } });
  const couatl = createCouatl(caster, 7);
  couatl.pos = { x: 1, y: 0, z: 0 };

  // Downed ally within touch range
  const downedAlly = makeAlly('downed', {
    pos: { x: 2, y: 0, z: 0 },
    isUnconscious: true,
    isDead: false,
    currentHP: 0,
    maxHP: 20,
  });

  const bf = makeBF([caster, couatl, downedAlly]);
  const state = makeState(bf);

  const target = shouldCastCureWounds(couatl, bf)!;
  const cwBefore = couatl.resources!.innateSpellcasting!['Cure Wounds'].remaining;
  executeCureWounds(couatl, target, state);

  // Verify innate counter decremented
  const cwAfter = couatl.resources!.innateSpellcasting!['Cure Wounds'].remaining;
  eq('8a. Cure Wounds remaining decremented (3 → 2)', cwAfter, cwBefore - 1);

  // Verify heal applied (target HP went from 0 to 1..8+WIS)
  assert('8b. downed ally healed (HP > 0)', downedAlly.currentHP > 0);

  // Verify log entry
  const cwLog = state.log.events.find((e: any) =>
    e.type === 'action' && e.description.includes('Cure Wounds'));
  assert('8c. Cure Wounds log entry present', cwLog !== undefined);
}

// ============================================================
// 9. 3/day cap enforced (Bless)
// ============================================================
console.log('\n--- 9. 3/day cap enforced ---');
{
  const caster = makeCaster('caster', { pos: { x: 0, y: 0, z: 0 } });
  const couatl = createCouatl(caster, 7);
  couatl.pos = { x: 1, y: 0, z: 0 };
  const ally1 = makeAlly('ally1', { pos: { x: 2, y: 0, z: 0 } });
  const ally2 = makeAlly('ally2', { pos: { x: 3, y: 0, z: 0 } });
  const ally3 = makeAlly('ally3', { pos: { x: 4, y: 0, z: 0 } });

  // Cast 3 times (using up all Bless uses)
  for (let i = 0; i < 3; i++) {
    // Clear concentration between casts so shouldCastBless doesn't reject
    couatl.concentration = null;
    // Clear any existing Bless effects on allies so they're valid targets again
    for (const a of [ally1, ally2, ally3]) {
      a.activeEffects = a.activeEffects.filter((e: any) => e.spellName !== 'Bless');
    }
    const bf = makeBF([caster, couatl, ally1, ally2, ally3]);
    const state = makeState(bf);
    const targets = shouldCastBless(couatl, bf);
    if (targets && targets.length > 0) {
      executeBless(couatl, targets, state);
    }
  }

  eq('9a. Bless remaining = 0 after 3 casts', couatl.resources!.innateSpellcasting!['Bless'].remaining, 0);

  // 4th cast: shouldCastBless should return null (no uses left)
  couatl.concentration = null;
  for (const a of [ally1, ally2, ally3]) {
    a.activeEffects = a.activeEffects.filter((e: any) => e.spellName !== 'Bless');
  }
  const bf4 = makeBF([caster, couatl, ally1, ally2, ally3]);
  const targets4 = shouldCastBless(couatl, bf4);
  assert('9b. shouldCastBless returns null after 3/day exhausted', targets4 === null);
}

// ============================================================
// 10. Couatl still attacks when not casting (smart profile)
// ============================================================
console.log('\n--- 10. Couatl retains attack Actions ---');
{
  const caster = makeCaster('caster');
  const couatl = createCouatl(caster, 7);

  // Bite + Constrict still present
  const bite = couatl.actions.find(a => a.name === 'Bite');
  const constrict = couatl.actions.find(a => a.name === 'Constrict');
  assert('10a. Bite Action still present', bite !== undefined);
  assert('10b. Constrict Action still present', constrict !== undefined);
  eq('10c. Bite attackType = melee', bite?.attackType, 'melee');
  eq('10d. Bite damage count = 1', bite?.damage?.count, 1);
  eq('10e. Bite damage sides = 6', bite?.damage?.sides, 6);
  eq('10f. Bite damage bonus = 5', bite?.damage?.bonus, 5);
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('couatl_innate_spellcasting.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('couatl_innate_spellcasting.test.ts: all tests passed ✅');
}
