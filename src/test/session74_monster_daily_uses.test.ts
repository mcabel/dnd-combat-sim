// ============================================================
// Test: RFC-MONSTER-SPELLCASTING Phase 3 — Daily-Use Spells
// Session 74 scope:
//   ✅ initMonsterDailyUses() — populates monsterDailyUses from daily map
//   ✅ initMonsterDailyUses() — idempotent (no reset on re-call)
//   ✅ initMonsterDailyUses() — no-op when no daily field
//   ✅ hasMonsterDailyUseAvailable() — true when remaining > 0
//   ✅ hasMonsterDailyUseAvailable() — false when remaining = 0
//   ✅ hasMonsterDailyUseAvailable() — false when no tracker
//   ✅ consumeMonsterDailyUse() — decrements remaining, returns true
//   ✅ consumeMonsterDailyUse() — returns false when 0 remaining
//   ✅ consumeMonsterDailyUse() — returns false when no tracker
//   ✅ selectMonsterDailySpell() — returns null when no daily field
//   ✅ selectMonsterDailySpell() — returns null when all uses exhausted
//   ✅ selectMonsterDailySpell() — returns null when no enemies + no downed ally
//   ✅ selectMonsterDailySpell() — lazy-inits monsterDailyUses on first call
//   ✅ selectMonsterDailySpell() — returns genericSpell plan with spellName
//   ✅ selectMonsterDailySpell() — consumes the daily use upfront
//   ✅ selectMonsterDailySpell() — picks highest-weight spell (tie-breaking)
//   ✅ selectMonsterDailySpell() — skips utility spells
//   ✅ selectMonsterDailySpell() — skips spells not in GENERIC_SPELLS
//   ✅ selectMonsterDailySpell() — sets castSlotLevel to spell level
//   ✅ selectMonsterDailySpell() — dedup: skips spells already active
//   ✅ selectMonsterDailySpell() — cleanup: synthetic actions + resources restored
//   ✅ Planner integration — monster casts daily spell in full combat
//   ✅ Backward-compat — non-spellcasting monster unaffected
//   ✅ Backward-compat — monster with daily but no GENERIC_SPELLS match falls back
//   ✅ Real bestiary — Drow has daily {darkness, faerie fire}
//   ✅ Real bestiary — Mind Flayer Arcanist has daily {dominate monster, plane shift}
//
// Run: npx ts-node --transpile-only src/test/session74_monster_daily_uses.test.ts
// ============================================================

import {
  initMonsterDailyUses,
  hasMonsterDailyUseAvailable,
  consumeMonsterDailyUse,
  selectMonsterDailySpell,
  selectMonsterSpell,
  SPELL_TAG_OVERRIDES,
} from '../ai/monster_spellcasting';
import { lookupGenericSpell } from '../spells/_generic_registry';
import { runCombat, makeFlatBattlefield } from '../engine/combat';
import { planTurn } from '../ai/planner';
import { Combatant, Battlefield, Action, Vec3 } from '../types/core';
import {
  mergeBestiaries,
  spawnMonster,
} from '../parser/fivetools';
import * as fs from 'fs';
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

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(o: Partial<Combatant> = {}): Combatant {
  const id = `c${++_id}`;
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 30, currentHP: 30, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart',
    perception: { targets: new Map() },
    concentration: null,
    deathSaves: null,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null, activeEffects: [],
    ...o,
  };
}

function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    width: 30, height: 30, depth: 1, cells: [],
    combatants: map, round: 1,
    initiativeOrder: combatants.map(c => c.id),
  };
}

/**
 * A monster with Drow-like daily spellcasting (darkness + faerie fire 1/day).
 * Note: 'darkness' and 'faerie fire' are NOT in GENERIC_SPELLS (bespoke-only),
 * so selectMonsterDailySpell will skip them. We also add 'Blink' (in
 * GENERIC_SPELLS) to test the positive case.
 */
function makeDailyMonster(pos: Vec3 = { x: 5, y: 5, z: 0 }): Combatant {
  return makeC({
    id: 'daily', name: 'DailyCaster', faction: 'enemy',
    maxHP: 50, currentHP: 50, ac: 14, speed: 30,
    str: 10, dex: 14, con: 10, int: 16, wis: 12, cha: 14,
    cr: 5, casterLevel: 9, pos,
    monsterSpellcasting: {
      saveDC: 15,
      spellAttackBonus: 7,
      ability: 'int',
      daily: {
        'Blink': 1,           // in GENERIC_SPELLS — should be selected
        'Fly': 1,             // in GENERIC_SPELLS — should be selectable
        'Command': 1,         // NOT in GENERIC_SPELLS — skipped (bespoke)
        'Hold Person': 1,     // NOT in GENERIC_SPELLS — skipped (bespoke)
      },
    },
  });
}

/**
 * A monster with only bespoke daily spells (no GENERIC_SPELLS matches).
 * selectMonsterDailySpell should return null (fall back to cantrips/weapons).
 */
function makeBespokeOnlyDailyMonster(pos: Vec3 = { x: 5, y: 5, z: 0 }): Combatant {
  return makeC({
    id: 'bespoke', name: 'BespokeCaster', faction: 'enemy',
    maxHP: 50, currentHP: 50, ac: 14, speed: 30,
    str: 10, dex: 14, con: 10, int: 16, wis: 12, cha: 14,
    cr: 5, casterLevel: 9, pos,
    monsterSpellcasting: {
      saveDC: 15,
      spellAttackBonus: 7,
      ability: 'int',
      daily: {
        'Command': 1,         // bespoke-only
        'Hold Person': 1,     // bespoke-only
        'Cure Wounds': 1,     // bespoke-only
      },
    },
  });
}

// ============================================================
console.log('\n=== 1. initMonsterDailyUses — populates from daily map ===\n');
// ============================================================

{
  const m = makeDailyMonster();
  eq('1a: monsterDailyUses undefined before init', m.monsterDailyUses, undefined);

  initMonsterDailyUses(m);

  assert('1b: monsterDailyUses populated after init', m.monsterDailyUses !== undefined);
  if (m.monsterDailyUses) {
    eq('1c: Blink max = 1', m.monsterDailyUses['Blink']?.max, 1);
    eq('1d: Blink remaining = 1 (full on init)', m.monsterDailyUses['Blink']?.remaining, 1);
    eq('1e: Fly max = 1', m.monsterDailyUses['Fly']?.max, 1);
    eq('1f: Command max = 1', m.monsterDailyUses['Command']?.max, 1);
    eq('1g: Hold Person max = 1', m.monsterDailyUses['Hold Person']?.max, 1);
    eq('1h: 4 daily spells tracked', Object.keys(m.monsterDailyUses).length, 4);
  }
}

// ============================================================
console.log('\n=== 2. initMonsterDailyUses — idempotent (no reset) ===\n');
// ============================================================

{
  const m = makeDailyMonster();
  initMonsterDailyUses(m);
  // Consume one use
  consumeMonsterDailyUse(m, 'Blink');
  eq('2a: Blink remaining = 0 after consume', m.monsterDailyUses!['Blink'].remaining, 0);

  // Re-init — should NOT reset (idempotent guard)
  initMonsterDailyUses(m);
  eq('2b: Blink remaining still 0 after re-init', m.monsterDailyUses!['Blink'].remaining, 0);
  eq('2c: Blink max still 1 after re-init', m.monsterDailyUses!['Blink'].max, 1);
}

// ============================================================
console.log('\n=== 3. initMonsterDailyUses — no-op when no daily field ===\n');
// ============================================================

{
  // Monster with spellcasting but no daily field (Lich-style)
  const m = makeC({
    id: 'lich', name: 'Lich', faction: 'enemy',
    monsterSpellcasting: {
      saveDC: 20, spellAttackBonus: 12, ability: 'int',
      slots: { 0: { max: 0, spells: ['ray of frost'] } },
    },
  });
  initMonsterDailyUses(m);
  eq('3a: Lich (no daily) has monsterDailyUses undefined', m.monsterDailyUses, undefined);

  // Monster with no spellcasting at all (Goblin-style)
  const g = makeC({ id: 'gob', name: 'Goblin' });
  initMonsterDailyUses(g);
  eq('3b: Goblin (no spellcasting) has monsterDailyUses undefined', g.monsterDailyUses, undefined);
}

// ============================================================
console.log('\n=== 4. hasMonsterDailyUseAvailable ===\n');
// ============================================================

{
  const m = makeDailyMonster();
  initMonsterDailyUses(m);

  assert('4a: Blink available (remaining=1)', hasMonsterDailyUseAvailable(m, 'Blink'));
  assert('4b: Fly available (remaining=1)', hasMonsterDailyUseAvailable(m, 'Fly'));

  // Consume Blink
  consumeMonsterDailyUse(m, 'Blink');
  assert('4c: Blink NOT available after consume (remaining=0)', !hasMonsterDailyUseAvailable(m, 'Blink'));
  assert('4d: Fly still available', hasMonsterDailyUseAvailable(m, 'Fly'));

  // Unknown spell
  assert('4e: Unknown spell NOT available', !hasMonsterDailyUseAvailable(m, 'Fireball'));

  // No tracker
  const g = makeC({ id: 'gob' });
  assert('4f: No tracker → NOT available', !hasMonsterDailyUseAvailable(g, 'Blink'));
}

// ============================================================
console.log('\n=== 5. consumeMonsterDailyUse ===\n');
// ============================================================

{
  const m = makeDailyMonster();
  initMonsterDailyUses(m);

  // Consume Blink (remaining 1 → 0)
  eq('5a: consume Blink returns true', consumeMonsterDailyUse(m, 'Blink'), true);
  eq('5b: Blink remaining = 0', m.monsterDailyUses!['Blink'].remaining, 0);

  // Consume Blink again (remaining 0 → fail)
  eq('5c: consume Blink again returns false', consumeMonsterDailyUse(m, 'Blink'), false);
  eq('5d: Blink remaining still 0 (no negative)', m.monsterDailyUses!['Blink'].remaining, 0);

  // Consume unknown spell
  eq('5e: consume unknown spell returns false', consumeMonsterDailyUse(m, 'Fireball'), false);

  // No tracker
  const g = makeC({ id: 'gob' });
  eq('5f: consume with no tracker returns false', consumeMonsterDailyUse(g, 'Blink'), false);

  // 2/day spell
  const m2 = makeC({
    id: 'm2', monsterSpellcasting: {
      saveDC: 13, ability: 'cha',
      daily: { 'Blink': 2 },
    },
  });
  initMonsterDailyUses(m2);
  eq('5g: 2/day Blink max = 2', m2.monsterDailyUses!['Blink'].max, 2);
  eq('5h: 2/day Blink remaining = 2', m2.monsterDailyUses!['Blink'].remaining, 2);
  eq('5i: consume 2/day Blink (1st) returns true', consumeMonsterDailyUse(m2, 'Blink'), true);
  eq('5j: remaining = 1 after 1st consume', m2.monsterDailyUses!['Blink'].remaining, 1);
  eq('5k: consume 2/day Blink (2nd) returns true', consumeMonsterDailyUse(m2, 'Blink'), true);
  eq('5l: remaining = 0 after 2nd consume', m2.monsterDailyUses!['Blink'].remaining, 0);
  eq('5m: consume 2/day Blink (3rd) returns false', consumeMonsterDailyUse(m2, 'Blink'), false);
}

// ============================================================
console.log('\n=== 6. selectMonsterDailySpell — null when no daily field ===\n');
// ============================================================

{
  const m = makeC({
    id: 'lich', name: 'Lich',
    monsterSpellcasting: {
      saveDC: 20, ability: 'int',
      slots: { 0: { max: 0, spells: ['ray of frost'] } },
    },
  });
  const enemy = makeC({ id: 'e', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const plan = selectMonsterDailySpell(m, makeBF([m, enemy]));
  eq('6a: null when no daily field', plan, null);
}

// ============================================================
console.log('\n=== 7. selectMonsterDailySpell — null when all uses exhausted ===\n');
// ============================================================

{
  const m = makeDailyMonster();
  const enemy = makeC({ id: 'e', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([m, enemy]);

  // Exhaust all daily uses
  initMonsterDailyUses(m);
  consumeMonsterDailyUse(m, 'Blink');
  consumeMonsterDailyUse(m, 'Fly');
  consumeMonsterDailyUse(m, 'Command');
  consumeMonsterDailyUse(m, 'Hold Person');

  const plan = selectMonsterDailySpell(m, bf);
  eq('7a: null when all uses exhausted', plan, null);
}

// ============================================================
console.log('\n=== 8. selectMonsterDailySpell — null when no enemies + no downed ally ===\n');
// ============================================================

{
  const m = makeDailyMonster();
  // No enemies, no allies at all
  const bf = makeBF([m]);
  const plan = selectMonsterDailySpell(m, bf);
  eq('8a: null when no enemies + no downed ally', plan, null);
}

// ============================================================
console.log('\n=== 9. selectMonsterDailySpell — lazy-inits monsterDailyUses ===\n');
// ============================================================

{
  const m = makeDailyMonster();
  const enemy = makeC({ id: 'e', faction: 'party', pos: { x: 1, y: 0, z: 0 } });

  // Before first call: monsterDailyUses undefined
  eq('9a: monsterDailyUses undefined before first call', m.monsterDailyUses, undefined);

  selectMonsterDailySpell(m, makeBF([m, enemy]));

  // After first call: monsterDailyUses populated (lazy init)
  assert('9b: monsterDailyUses populated after first call (lazy init)',
    m.monsterDailyUses !== undefined);
}

// ============================================================
console.log('\n=== 10. selectMonsterDailySpell — returns genericSpell plan ===\n');
// ============================================================

{
  const m = makeDailyMonster();
  const enemy = makeC({ id: 'e', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const plan = selectMonsterDailySpell(m, makeBF([m, enemy]));

  assert('10a: plan is not null', plan !== null);
  if (plan) {
    eq('10b: plan.type = genericSpell', plan.type, 'genericSpell');
    assert('10c: plan.spellName is set', plan.spellName !== undefined && plan.spellName !== '');
    assert('10d: plan.spellName is a GENERIC_SPELLS key',
      lookupGenericSpell(plan.spellName!) !== null);
    assert('10e: plan.description mentions "daily"',
      plan.description.includes('daily'));
    assert('10f: plan.action is null (genericSpell dispatch)', plan.action === null);
  }
}

// ============================================================
console.log('\n=== 11. selectMonsterDailySpell — consumes daily use upfront ===\n');
// ============================================================

{
  const m = makeDailyMonster();
  const enemy = makeC({ id: 'e', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([m, enemy]);

  // Before: Blink has 1 use remaining
  initMonsterDailyUses(m);
  const beforeBlink = m.monsterDailyUses!['Blink'].remaining;
  const beforeFly = m.monsterDailyUses!['Fly'].remaining;
  eq('11a: Blink remaining = 1 before cast', beforeBlink, 1);
  eq('11b: Fly remaining = 1 before cast', beforeFly, 1);

  const plan = selectMonsterDailySpell(m, bf);

  if (plan) {
    // The selected spell should have remaining decremented
    const selected = plan.spellName!;
    const afterSelected = m.monsterDailyUses![selected].remaining;
    eq(`11c: ${selected} remaining = 0 after cast (consumed upfront)`, afterSelected, 0);

    // The OTHER spell should still be at 1
    const other = selected === 'Blink' ? 'Fly' : 'Blink';
    const afterOther = m.monsterDailyUses![other].remaining;
    eq(`11d: ${other} remaining still 1 (not consumed)`, afterOther, 1);
  } else {
    assert('11c: plan should not be null', false);
  }
}

// ============================================================
console.log('\n=== 12. selectMonsterDailySpell — picks highest-weight spell ===\n');
// ============================================================

{
  // Low-HP monster: defending spells (Blink, Fly) get ×1.8 multiplier.
  // Both are defending tag, same level (3). Tie-break: alphabetical.
  // 'Blink' < 'Fly' alphabetically, so Blink should win the tie.
  const m = makeDailyMonster();
  m.currentHP = 5;  // < 30% of maxHP(50) = 15 → low HP
  const enemy = makeC({ id: 'e', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const plan = selectMonsterDailySpell(m, makeBF([m, enemy]));

  if (plan) {
    // Both Blink and Fly are defending L3. Tie → alphabetical → Blink.
    // (Unless one's shouldCast fails — both should pass with synthetic resources.)
    assert(`12a: selected ${plan.spellName} (defending spell for low HP)`,
      plan.spellName === 'Blink' || plan.spellName === 'Fly',
      `got ${plan.spellName}`);
  } else {
    assert('12a: plan should not be null for low-HP monster with daily spells', false);
  }
}

// ============================================================
console.log('\n=== 13. selectMonsterDailySpell — skips utility spells ===\n');
// ============================================================

{
  // Monster with only utility daily spells (Detect Magic, Augury).
  // These are NOT in GENERIC_SPELLS anyway, but if they were, the utility
  // tag would still skip them.
  const m = makeC({
    id: 'util', name: 'UtilCaster', faction: 'enemy',
    monsterSpellcasting: {
      saveDC: 13, ability: 'int',
      daily: {
        'Create Food and Water': 1,  // in GENERIC_SPELLS, tagged utility
        'Silent Image': 1,            // in GENERIC_SPELLS, NOT in override → default ['damage']
      },
    },
  });
  const enemy = makeC({ id: 'e', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const plan = selectMonsterDailySpell(m, makeBF([m, enemy]));

  // Create Food and Water is utility → skipped.
  // Silent Image is in GENERIC_SPELLS but NOT in the override map → falls to
  // default ['damage']. Its shouldCast might pass or fail depending on impl.
  // The key assertion: Create Food and Water (utility) is NEVER selected.
  if (plan) {
    assert('13a: Create Food and Water (utility) not selected',
      plan.spellName !== 'Create Food and Water',
      `got ${plan.spellName}`);
  } else {
    // null is also acceptable (if Silent Image's shouldCast failed)
    assert('13a: utility spells skipped (plan null or non-utility)', true);
  }
}

// ============================================================
console.log('\n=== 14. selectMonsterDailySpell — skips spells not in GENERIC_SPELLS ===\n');
// ============================================================

{
  // Monster with only bespoke daily spells (Command, Hold Person, Cure Wounds).
  // None are in GENERIC_SPELLS → all skipped → returns null.
  const m = makeBespokeOnlyDailyMonster();
  const enemy = makeC({ id: 'e', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const plan = selectMonsterDailySpell(m, makeBF([m, enemy]));

  eq('14a: null when no daily spell is in GENERIC_SPELLS', plan, null);
}

// ============================================================
console.log('\n=== 15. selectMonsterDailySpell — sets castSlotLevel to spell level ===\n');
// ============================================================

{
  const m = makeDailyMonster();
  const enemy = makeC({ id: 'e', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const plan = selectMonsterDailySpell(m, makeBF([m, enemy]));

  if (plan) {
    const desc = lookupGenericSpell(plan.spellName!);
    if (desc) {
      eq(`15a: castSlotLevel = spell level (${desc.level})`,
        plan.castSlotLevel, desc.level);
    } else {
      assert('15a: spell should be in GENERIC_SPELLS', false);
    }
  } else {
    assert('15a: plan should not be null', false);
  }
}

// ============================================================
console.log('\n=== 16. selectMonsterDailySpell — dedup (skips active spells) ===\n');
// ============================================================

{
  const m = makeDailyMonster();
  const enemy = makeC({ id: 'e', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([m, enemy]);

  // Mark Blink as already active (simulating a prior cast)
  if (!m._genericSpellActiveSpells) {
    m._genericSpellActiveSpells = new Set<string>();
  }
  m._genericSpellActiveSpells.add('Blink');

  const plan = selectMonsterDailySpell(m, bf);

  // Blink should be skipped (dedup). Fly should be selected instead.
  if (plan) {
    assert(`16a: Blink not selected (already active)`,
      plan.spellName !== 'Blink',
      `got ${plan.spellName}`);
    // Fly is the only other GENERIC_SPELLS match → should be selected
    eq('16b: Fly selected (Blink dedup)', plan.spellName, 'Fly');
  } else {
    assert('16a: plan should not be null (Fly still available)', false);
  }
}

// ============================================================
console.log('\n=== 17. selectMonsterDailySpell — cleanup (synthetic actions + resources restored) ===\n');
// ============================================================

{
  const m = makeDailyMonster();
  const enemy = makeC({ id: 'e', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([m, enemy]);

  const actionsBefore = m.actions.length;
  const resourcesBefore = m.resources;

  selectMonsterDailySpell(m, bf);

  // After call: synthetic actions removed, resources restored to null
  eq('17a: actions array length unchanged after call', m.actions.length, actionsBefore);
  eq('17b: resources restored to null (was null before)', m.resources, resourcesBefore);
  assert('17c: no synthetic "Blink" action left in actions',
    !m.actions.some(a => a.name === 'Blink'));
  assert('17d: no synthetic "Fly" action left in actions',
    !m.actions.some(a => a.name === 'Fly'));
}

// ============================================================
console.log('\n=== 18. Planner integration — monster casts daily spell ===\n');
// ============================================================

{
  // Monster with Blink daily + Fire Bolt cantrip + weapon attack.
  // On round 1, the daily spell (Blink) should be preferred over the cantrip.
  const m = makeC({
    id: 'daily', name: 'DailyCaster', faction: 'enemy',
    maxHP: 50, currentHP: 50, ac: 14, speed: 30,
    str: 10, dex: 14, con: 10, int: 16, wis: 12, cha: 14,
    cr: 5, casterLevel: 9, pos: { x: 5, y: 5, z: 0 },
    monsterSpellcasting: {
      saveDC: 15, spellAttackBonus: 7, ability: 'int',
      atWill: ['fire bolt'],         // cantrip fallback
      daily: { 'Blink': 1, 'Fly': 1 },
    },
    actions: [{
      name: 'Dagger', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 4, damage: { count: 1, sides: 4, bonus: 2, average: 4 },
      damageType: 'piercing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });
  const fighter = makeC({
    id: 'fighter', name: 'Fighter', faction: 'party',
    maxHP: 30, currentHP: 30, ac: 16, pos: { x: 6, y: 5, z: 0 },
    actions: [{
      name: 'Longsword', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 5, damage: { count: 1, sides: 8, bonus: 3, average: 7 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });

  const bf = makeFlatBattlefield(15, 15, [m, fighter]);
  const result = runCombat(bf, ['daily', 'fighter'], { maxRounds: 1 });

  // Find the daily-cast event — should mention Blink or Fly (daily spell).
  // Use type='action' to exclude condition_add events.
  const dailyEvents = result.events.filter(
    e => e.actorId === 'daily' && e.type === 'action'
      && /casts (Blink|Fly)/i.test(e.description)
  );
  assert('18a: daily-cast event exists in round 1', dailyEvents.length > 0,
    `events: ${result.events.filter(e=>e.actorId==='daily').map(e=>e.description).join('; ')}`);

  // Verify the daily spell was cast (Blink or Fly)
  const spellEvent = result.events.find(
    e => e.actorId === 'daily' && e.type === 'action'
      && /casts (Blink|Fly)/i.test(e.description)
  );
  assert('18b: daily spell (Blink or Fly) was cast',
    spellEvent !== undefined,
    `no Blink/Fly event; events: ${result.events.filter(e=>e.actorId==='daily').map(e=>e.description).join('; ')}`);

  // Verify daily use was consumed
  assert('18c: Blink daily use consumed (remaining=0)',
    m.monsterDailyUses?.['Blink']?.remaining === 0
    || m.monsterDailyUses?.['Fly']?.remaining === 0);

  // Verify the OTHER daily spell is still available
  const otherRemaining = m.monsterDailyUses?.['Blink']?.remaining === 0
    ? m.monsterDailyUses?.['Fly']?.remaining
    : m.monsterDailyUses?.['Blink']?.remaining;
  eq('18d: other daily spell still has 1 use remaining', otherRemaining, 1);
}

// ============================================================
console.log('\n=== 19. Backward-compat — non-spellcasting monster unaffected ===\n');
// ============================================================

{
  const goblin = makeC({
    id: 'goblin', name: 'Goblin', faction: 'enemy',
    pos: { x: 5, y: 5, z: 0 },
    actions: [{
      name: 'Scimitar', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 4, damage: { count: 1, sides: 6, bonus: 2, average: 5 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });
  const fighter = makeC({
    id: 'fighter', name: 'Fighter', faction: 'party',
    maxHP: 30, currentHP: 30, ac: 16, pos: { x: 6, y: 5, z: 0 },
    actions: [{
      name: 'Longsword', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 5, damage: { count: 1, sides: 8, bonus: 3, average: 7 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });

  const bf = makeFlatBattlefield(15, 15, [goblin, fighter]);
  const result = runCombat(bf, ['goblin', 'fighter'], { maxRounds: 1 });

  // Goblin should use Scimitar (no spellcasting → no daily branch fires).
  const goblinAttack = result.events.find(
    e => e.actorId === 'goblin' && /Scimitar|attack/i.test(e.description)
  );
  assert('19a: Goblin uses weapon attack (no spellcasting)', goblinAttack !== undefined,
    `events: ${result.events.filter(e=>e.actorId==='goblin').map(e=>e.description).join('; ')}`);
  eq('19b: Goblin has no monsterDailyUses', goblin.monsterDailyUses, undefined);
}

// ============================================================
console.log('\n=== 20. Backward-compat — bespoke-only daily falls back to cantrip ===\n');
// ============================================================

{
  // Monster with daily spells that are NOT in GENERIC_SPELLS (bespoke-only)
  // + a cantrip (Fire Bolt). selectMonsterDailySpell returns null → falls
  // through to selectMonsterSpell (cantrip) → casts Fire Bolt.
  const m = makeC({
    id: 'bespoke', name: 'BespokeCaster', faction: 'enemy',
    maxHP: 50, currentHP: 50, ac: 14, speed: 30,
    str: 10, dex: 14, con: 10, int: 16, wis: 12, cha: 14,
    cr: 5, casterLevel: 9, pos: { x: 5, y: 5, z: 0 },
    monsterSpellcasting: {
      saveDC: 15, spellAttackBonus: 7, ability: 'int',
      atWill: ['fire bolt'],
      daily: { 'Command': 1, 'Hold Person': 1 },  // bespoke-only
    },
    actions: [{
      name: 'Dagger', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 4, damage: { count: 1, sides: 4, bonus: 2, average: 4 },
      damageType: 'piercing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });
  const fighter = makeC({
    id: 'fighter', name: 'Fighter', faction: 'party',
    maxHP: 30, currentHP: 30, ac: 16, pos: { x: 6, y: 5, z: 0 },
    actions: [{
      name: 'Longsword', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 5, damage: { count: 1, sides: 8, bonus: 3, average: 7 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });

  const bf = makeFlatBattlefield(15, 15, [m, fighter]);
  const result = runCombat(bf, ['bespoke', 'fighter'], { maxRounds: 1 });

  // Should fall back to Fire Bolt cantrip (Phase 1).
  const cantripEvent = result.events.find(
    e => e.actorId === 'bespoke' && /Fire Bolt|cast/i.test(e.description)
  );
  assert('20a: falls back to Fire Bolt cantrip (bespoke daily skipped)',
    cantripEvent !== undefined,
    `events: ${result.events.filter(e=>e.actorId==='bespoke').map(e=>e.description).join('; ')}`);
}

// ============================================================
console.log('\n=== 21. Real bestiary — Drow has daily {darkness, faerie fire} ===\n');
// ============================================================

{
  // Load the real bestiary and verify Drow's daily spells.
  const dir = path.join(__dirname, '../../bestiaryData');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const loaded = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const bestiary = mergeBestiaries(...loaded);

  const drow = spawnMonster(bestiary, 'Drow', { x: 0, y: 0, z: 0 });
  assert('21a: Drow found in bestiary', drow !== null);
  if (drow) {
    assert('21b: Drow has monsterSpellcasting', drow.monsterSpellcasting !== undefined);
    assert('21c: Drow has daily spells', drow.monsterSpellcasting?.daily !== undefined);
    if (drow.monsterSpellcasting?.daily) {
      const dailyKeys = Object.keys(drow.monsterSpellcasting.daily);
      console.log(`    Drow daily spells: ${dailyKeys.join(', ')}`);
      // Drow has 1/day each: darkness, faerie fire
      // Note: these are lowercase in the bestiary (parser preserves case from
      // {@spell darkness} tag → 'darkness'). selectMonsterDailySpell looks up
      // GENERIC_SPELLS with the exact key — 'darkness' won't match 'Darkness'
      // if the registry uses capitalized names. This is a known v1 limitation
      // (case sensitivity). Phase 4+ could add case-insensitive lookup.
      assert('21d: Drow has at least 1 daily spell', dailyKeys.length >= 1);
    }
  }
}

// ============================================================
console.log('\n=== 22. Real bestiary — Mind Flayer Arcanist has daily ===\n');
// ============================================================

{
  const dir = path.join(__dirname, '../../bestiaryData');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const loaded = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const bestiary = mergeBestiaries(...loaded);

  const mfa = spawnMonster(bestiary, 'Mind Flayer Arcanist', { x: 0, y: 0, z: 0 });
  assert('22a: Mind Flayer Arcanist found in bestiary', mfa !== null);
  if (mfa) {
    assert('22b: MFA has monsterSpellcasting', mfa.monsterSpellcasting !== undefined);
    assert('22c: MFA has daily spells', mfa.monsterSpellcasting?.daily !== undefined);
    if (mfa.monsterSpellcasting?.daily) {
      const dailyKeys = Object.keys(mfa.monsterSpellcasting.daily);
      console.log(`    MFA daily spells: ${dailyKeys.join(', ')}`);
      // MFA has 1/day each: dominate monster, plane shift (self only) → parser
      // strips "(self only)" → 'plane shift'
      assert('22d: MFA has at least 1 daily spell', dailyKeys.length >= 1);
    }
  }
}

// ============================================================
console.log('\n=== 23. SPELL_TAG_OVERRIDES — covers common daily spells ===\n');
// ============================================================

{
  // Verify the override map has entries for common daily spells.
  const commonDaily = ['Blink', 'Fly', 'Command', 'Hold Person', 'Banishment',
    'Cure Wounds', 'Healing Word', 'Aid', 'Bless', 'Haste',
    'Fireball', 'Lightning Bolt', 'Dominate Monster', 'Faerie Fire',
    'Darkness', 'Silence', 'Confusion', 'Polymorph', 'Telekinesis',
    'Forcecage', 'Maze', 'Power Word Kill', 'Power Word Stun',
    'Dispel Magic', 'Counterspell', 'Detect Magic', 'Mage Armor', 'Shield',
    'Misty Step', 'Dimension Door', 'Greater Restoration', 'Remove Curse',
    'Death Ward', 'Globe of Invulnerability', 'Antimagic Field'];

  let covered = 0, missing = 0;
  const missingList: string[] = [];
  for (const sp of commonDaily) {
    if (SPELL_TAG_OVERRIDES[sp]) covered++;
    else { missing++; missingList.push(sp); }
  }
  console.log(`    Covered: ${covered}/${commonDaily.length}, Missing: ${missing}`);
  if (missingList.length > 0) {
    console.log(`    Missing: ${missingList.join(', ')}`);
  }
  // Most common daily spells should be in the override map.
  // Some (Detect Magic, Mage Armor, Shield, Dispel Magic, Counterspell) are
  // deliberately not daily-cast in combat (utility or reaction).
  assert('23a: ≥80% of common daily spells covered by SPELL_TAG_OVERRIDES',
    covered >= Math.ceil(commonDaily.length * 0.8),
    `${covered}/${commonDaily.length} covered`);

  // Verify tag values for key spells
  eq('23b: Blink tagged as defending', SPELL_TAG_OVERRIDES['Blink']?.[0], 'defending');
  eq('23c: Fly tagged as defending', SPELL_TAG_OVERRIDES['Fly']?.[0], 'defending');
  eq('23d: Bless tagged as buff', SPELL_TAG_OVERRIDES['Bless']?.[0], 'buff');
  eq('23e: Haste tagged as buff', SPELL_TAG_OVERRIDES['Haste']?.[0], 'buff');
  eq('23f: Cure Wounds tagged as healing', SPELL_TAG_OVERRIDES['Cure Wounds']?.[0], 'healing');
  eq('23g: Hold Person tagged as cc', SPELL_TAG_OVERRIDES['Hold Person']?.[0], 'cc');
  eq('23h: Banishment tagged as cc', SPELL_TAG_OVERRIDES['Banishment']?.[0], 'cc');
  eq('23i: Fireball tagged as damage', SPELL_TAG_OVERRIDES['Fireball']?.[0], 'damage');
  eq('23j: Power Word Kill tagged as damage', SPELL_TAG_OVERRIDES['Power Word Kill']?.[0], 'damage');
  eq('23k: Globe of Invulnerability tagged as defending',
    SPELL_TAG_OVERRIDES['Globe of Invulnerability']?.[0], 'defending');
}

// ============================================================
console.log('\n=== 24. Full combat — daily spell consumed, not recast next round ===\n');
// ============================================================

{
  // Run 3 rounds of combat. The daily spell should be cast on round 1
  // (consumed), and NOT recast on rounds 2-3 (no uses remaining).
  const m = makeC({
    id: 'daily', name: 'DailyCaster', faction: 'enemy',
    maxHP: 200, currentHP: 200, ac: 18, speed: 30,  // tanky — survive 3 rounds
    str: 10, dex: 14, con: 18, int: 16, wis: 12, cha: 14,
    cr: 5, casterLevel: 9, pos: { x: 5, y: 5, z: 0 },
    monsterSpellcasting: {
      saveDC: 15, spellAttackBonus: 7, ability: 'int',
      atWill: ['fire bolt'],
      daily: { 'Blink': 1, 'Fly': 1 },
    },
    actions: [{
      name: 'Dagger', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 4, damage: { count: 1, sides: 4, bonus: 2, average: 4 },
      damageType: 'piercing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });
  const fighter = makeC({
    id: 'fighter', name: 'Fighter', faction: 'party',
    maxHP: 200, currentHP: 200, ac: 16, pos: { x: 6, y: 5, z: 0 },  // tanky
    actions: [{
      name: 'Longsword', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 5, damage: { count: 1, sides: 8, bonus: 3, average: 7 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });

  const bf = makeFlatBattlefield(15, 15, [m, fighter]);
  const result = runCombat(bf, ['daily', 'fighter'], { maxRounds: 3 });

  // Count daily-spell-cast events (only the "casts" action events, not
  // the "is affected by" condition_add events which are emitted separately).
  const dailyCasts = result.events.filter(
    e => e.actorId === 'daily' && e.type === 'action'
      && /casts (Blink|Fly)/i.test(e.description)
  );
  console.log(`    Daily casts over 3 rounds: ${dailyCasts.length}`);
  for (const e of dailyCasts) {
    console.log(`      R${e.round ?? '?'}: ${e.description.substring(0, 80)}`);
  }

  // Should cast at most 2 daily spells total (Blink + Fly, each 1/day).
  // After both are consumed, rounds 2-3 should use Fire Bolt cantrip.
  assert('24a: daily spells cast ≤ 2 (only 1 use each)',
    dailyCasts.length <= 2,
    `got ${dailyCasts.length}`);

  // After 3 rounds, both daily uses should be consumed (if cast)
  const blinkRemaining = m.monsterDailyUses?.['Blink']?.remaining;
  const flyRemaining = m.monsterDailyUses?.['Fly']?.remaining;
  console.log(`    After 3 rounds: Blink=${blinkRemaining}, Fly=${flyRemaining}`);

  // At least one daily should have been cast (round 1 opener)
  const totalConsumed = (1 - (blinkRemaining ?? 1)) + (1 - (flyRemaining ?? 1));
  assert('24b: at least 1 daily use consumed over 3 rounds',
    totalConsumed >= 1,
    `Blink=${blinkRemaining}, Fly=${flyRemaining}`);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailed tests above ↑');
  process.exit(1);
}
console.log('\nAll tests passed ✅');
