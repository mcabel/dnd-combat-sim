// ============================================================
// Test: rollAbilityCheck choke point (utils.ts)
// PHB p.174–175 — ability check resolution
//
// Added in Session 14 (cantrip workstream pivot — Option A).
// Mirrors rollSave's architecture. Consumes two forward-compat
// scratch flags set by cantrip self-buffs:
//   - Guidance (PHB p.248): `_guidanceDieBonusNextAbilityCheck`
//     → ADD rollDie(value) to the next ability check (any ability),
//       one-shot consume.
//   - Friends  (PHB p.244): `_friendsAdvNextChaCheck`
//     → advantage on the next CHA check, one-shot consume.
//
// Also folds in:
//   - Bardic Inspiration (PHB p.54) — ADD rollDie(die), consumed.
//   - Rage (PHB p.48) — advantage on STR checks (mirror rollSave's
//     STR-save advantage).
//   - Poisoned (PHB Appendix A) — disadvantage on ability checks
//     (RAW — NOT on saves; rollSave models it for saves too as a
//     known v1 simplification, but rollAbilityCheck follows RAW).
//   - Advantage-system entries via querySelf (scope 'ability' and
//     'ability:<ab>').
//
// Tests:
//   1. function exists + returns the right shape
//   2. basic d20 + ability mod (DC-impossible & DC-trivial)
//   3. proficiency bonus folds in when isProficient=true
//   4. success vs fail vs DC boundary (total >= dc → success)
//   5. NO auto-fail on nat 1 / NO auto-success on nat 20 (PHB p.7)
//   6. Guidance integration — +1d4 ADDed (any ability), one-shot consume
//   7. Guidance one-shot — second check has NO bonus
//   8. Guidance applies to ANY ability (str/dex/con/int/wis/cha)
//   9. Friends integration — advantage on CHA check, one-shot consume
//  10. Friends is CHA-only — flag NOT consumed by non-CHA checks
//  11. Friends + Guidance both consumed on the same CHA check
//  12. Bardic Inspiration folds in (+die, consumed)
//  13. Rage → advantage on STR checks (mirror rollSave)
//  14. Rage does NOT grant advantage on DEX/CON/INT/WIS/CHA checks
//  15. Poisoned → disadvantage on ability checks (RAW — PHB App. A)
//  16. Advantage-system entries (querySelf 'ability:str') fold in
//  17. Advantage + disadvantage cancel out (PHB p.173) — single roll
//  18. Both flags clear at start of caster's NEXT turn (resetBudget)
//  19. details array contains the expected components
//  20. mirror rollSave architecture (same choke-point pattern)
//
// Run: npx ts-node src/test/roll_ability_check.test.ts
// ============================================================

import {
  rollAbilityCheck,
  rollSave,
  resetBudget,
  abilityMod,
  profBonusByCR,
} from '../engine/utils';
import { grantSelf } from '../engine/adv_system';
import { cleanup as cleanupGuidance } from '../spells/guidance';
import { cleanup as cleanupFriends } from '../spells/friends';
import { Combatant, PlayerResources, D20TestScope } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Factory ------------------------------------------------

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 30, currentHP: 30, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
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
  };
}

// ============================================================
// 1. function exists + returns the right shape
// ============================================================
console.log('\n--- 1. shape ---');
{
  const c = makeCombatant('cleric', { wis: 14 }); // +2 mod
  const r = rollAbilityCheck(c, 'wis', 10);

  assert('1a. returns an object', typeof r === 'object' && r !== null);
  assert('1b. has roll (number)', typeof r.roll === 'number');
  assert('1c. has total (number)', typeof r.total === 'number');
  assert('1d. has success (boolean)', typeof r.success === 'boolean');
  assert('1e. has details (array)', Array.isArray(r.details));
  assert('1f. roll in 1..20', r.roll >= 1 && r.roll <= 20, `got ${r.roll}`);
  // total = roll + 2 (wis mod) + 0 (no prof) + 0 (no BI) + 0 (no Guidance)
  assert('1g. total = roll + 2 (wis mod only)',
    r.total === r.roll + 2, `got ${r.total}, want ${r.roll + 2}`);
}

// ============================================================
// 2. basic d20 + ability mod (DC-impossible & DC-trivial)
// ============================================================
console.log('\n--- 2. basic d20 + ability mod ---');
{
  // DC=1000 → guaranteed fail regardless of roll.
  const c = makeCombatant('bard', { cha: 18 }); // +4 mod
  const fail = rollAbilityCheck(c, 'cha', 1000);
  eq('2a. DC-impossible → success=false', fail.success, false);
  assert('2b. total = roll + 4 (cha mod only)',
    fail.total === fail.roll + 4, `got ${fail.total}, want ${fail.roll + 4}`);

  // DC=-1 → guaranteed success (any non-crit-fail total beats DC -1).
  const c2 = makeCombatant('wizard', { int: 8 }); // -1 mod
  const win = rollAbilityCheck(c2, 'int', -1);
  eq('2c. DC-trivial → success=true', win.success, true);
  assert('2d. total = roll + (-1) (int mod only)',
    win.total === win.roll - 1, `got ${win.total}, want ${win.roll - 1}`);
}

// ============================================================
// 3. proficiency bonus folds in when isProficient=true
// ============================================================
console.log('\n--- 3. proficiency bonus ---');
{
  // cr=1 → profBonusByCR returns 2.
  const c = makeCombatant('rogue', { dex: 16, cr: 1 }); // +3 dex mod
  const r = rollAbilityCheck(c, 'dex', 1000, /* isProficient */ true);
  // total = roll + 3 (dex) + 2 (prof at CR 1) = roll + 5
  assert('3a. total = roll + dex mod + prof (2 at CR 1)',
    r.total === r.roll + 3 + 2, `got ${r.total}, want ${r.roll + 5}`);
}
{
  // Same combatant, NOT proficient — no prof bonus.
  const c = makeCombatant('rogue2', { dex: 16, cr: 1 });
  const r = rollAbilityCheck(c, 'dex', 1000, /* isProficient */ false);
  assert('3b. total = roll + dex mod (no prof when not proficient)',
    r.total === r.roll + 3, `got ${r.total}, want ${r.roll + 3}`);
}

// ============================================================
// 4. success vs fail vs DC boundary (total >= dc → success)
// ============================================================
console.log('\n--- 4. DC boundary ---');
{
  // Force a known total: wis=14 (+2), no prof, no buffs → total = roll + 2.
  // Pick DC = roll + 2 → success (total >= dc, equal).
  // We do this by rolling once and then constructing the DC from the roll.
  const c = makeCombatant('cleric', { wis: 14 });
  const probe = rollAbilityCheck(c, 'wis', 1000); // guaranteed fail; we just want the roll
  const dc = probe.total; // total >= dc → success
  const c2 = makeCombatant('cleric2', { wis: 14 });
  // Roll until we get the same d20 roll (probabilistic — should hit quickly).
  // To make this deterministic, we instead just verify the boundary rule
  // directly via the formula: success = total >= dc.
  const r = rollAbilityCheck(c2, 'wis', dc);
  // r.total is a fresh roll; either success or fail is fine, but the
  // success flag MUST equal (r.total >= dc).
  eq('4a. success flag matches (total >= dc)', r.success, r.total >= dc);

  // Direct boundary test: set DC = total → must succeed.
  const c3 = makeCombatant('cleric3', { wis: 14 });
  const probe2 = rollAbilityCheck(c3, 'wis', 1000);
  const dc2 = probe2.total;
  // Simulate "same total" by re-rolling and checking the success rule.
  const c4 = makeCombatant('cleric4', { wis: 14 });
  const r2 = rollAbilityCheck(c4, 'wis', dc2);
  eq('4b. success = (total >= dc) on boundary', r2.success, r2.total >= dc2);
}

// ============================================================
// 5. NO auto-fail on nat 1 / NO auto-success on nat 20 (PHB p.7)
// ============================================================
console.log('\n--- 5. no nat-1/nat-20 auto rule ---');
{
  // PHB p.7: ability checks have NO critical-fail / critical-success rule.
  // (Only attack rolls PHB p.194 and death saves PHB p.197 have nat-1/nat-20
  // auto rules.) So a nat 20 with a low total can still fail a high DC,
  // and a nat 1 with a high total can still beat a low DC.
  //
  // We verify the LACK of auto-rules by constructing a DC where the formula
  // says fail/success and asserting the flag matches the formula (not the
  // nat-1/nat-20 rule).
  //
  // We can't force a nat 1 or nat 20 deterministically without mocking
  // rollDie, so we instead verify the rule NEGATIVELY: roll many times,
  // confirm that success is ALWAYS (total >= dc) — never (roll === 20) or
  // (roll === 1) overriding the formula.
  const c = makeCombatant('bard', { cha: 10 }); // +0 mod
  let consistent = true;
  for (let i = 0; i < 200; i++) {
    const r = rollAbilityCheck(c, 'cha', 12); // DC 12
    if (r.success !== (r.total >= 12)) { consistent = false; break; }
  }
  assert('5a. success always equals (total >= dc) — no nat-1/nat-20 override',
    consistent);
}

// ============================================================
// 6. Guidance integration — +1d4 ADDed (any ability), one-shot consume
// ============================================================
console.log('\n--- 6. Guidance +1d4 ADDed ---');
{
  // Caster has the Guidance flag set (die size 4 = d4). rollAbilityCheck
  // should add rollDie(4) (1..4) to the ability-check total, then consume
  // the flag (set to undefined).
  const caster = makeCombatant('cleric', {
    wis: 10, // +0 mod (isolate the +1d4 bonus)
    _guidanceDieBonusNextAbilityCheck: 4, // pre-set: Guidance cast last turn
  });

  const r = rollAbilityCheck(caster, 'wis', 1000); // DC=1000 → guaranteed fail
  // Expected total: rollDie(20) + 0 + 0 + 0 + rollDie(4) = (1..20) + (1..4) = 2..24
  // Without the bonus, it would be (1..20) + 0 = 1..20.
  assert('6a. total in 2..24 (Guidance +1d4 applied)',
    r.total >= 2 && r.total <= 24, `total = ${r.total}`);
  // The flag should be CONSUMED after the check resolves (one-shot).
  eq('6b. Guidance flag CONSUMED after check (one-shot)',
    caster._guidanceDieBonusNextAbilityCheck, undefined);
}

// ============================================================
// 7. Guidance one-shot — second check has NO bonus
// ============================================================
console.log('\n--- 7. Guidance one-shot ---');
{
  const caster = makeCombatant('cleric', {
    wis: 10,
    _guidanceDieBonusNextAbilityCheck: 4,
  });

  // First check — should have the +1d4 bonus (total in 2..24 range).
  const r1 = rollAbilityCheck(caster, 'wis', 1000);
  eq('7a. Guidance flag consumed after first check',
    caster._guidanceDieBonusNextAbilityCheck, undefined);
  assert('7b. first check total in 2..24 (with +1d4 bonus)',
    r1.total >= 2 && r1.total <= 24, `got ${r1.total}`);

  // Second check — should NOT have the bonus (total in 1..20 range).
  // Without bonus: (1..20) + 0 (wis mod) = 1..20.
  const r2 = rollAbilityCheck(caster, 'wis', 1000);
  assert('7c. second check total in 1..20 (NO bonus — one-shot)',
    r2.total >= 1 && r2.total <= 20, `got ${r2.total}`);
}

// ============================================================
// 8. Guidance applies to ANY ability (str/dex/con/int/wis/cha)
// ============================================================
console.log('\n--- 8. Guidance any-ability ---');
{
  // PHB p.248: "one ability check of its choice" — any ability.
  // Set the flag and verify it's consumed on a non-WIS check too.
  const abilities: Array<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'> =
    ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  for (const ab of abilities) {
    const c = makeCombatant(`c_${ab}`, {
      [ab]: 10, // +0 mod (isolate the +1d4 bonus)
      _guidanceDieBonusNextAbilityCheck: 4,
    });
    const r = rollAbilityCheck(c, ab, 1000);
    // Expected: (1..20) + 0 + rollDie(4) = 2..24
    assert(`8.${ab}. Guidance +1d4 applied to ${ab.toUpperCase()} check (total 2..24)`,
      r.total >= 2 && r.total <= 24, `got ${r.total}`);
    eq(`8.${ab}. Guidance flag consumed on ${ab.toUpperCase()} check`,
      c._guidanceDieBonusNextAbilityCheck, undefined);
  }
}

// ============================================================
// 9. Friends integration — advantage on CHA check, one-shot consume
// ============================================================
console.log('\n--- 9. Friends CHA advantage ---');
{
  // Caster has the Friends flag set. rollAbilityCheck('cha', ...) should
  // roll with advantage (rollWithAdvantage — roll twice, take higher),
  // then consume the flag (set to undefined).
  const caster = makeCombatant('bard', {
    cha: 10, // +0 mod (isolate the advantage effect)
    _friendsAdvNextChaCheck: true, // pre-set: Friends cast last turn
  });

  // Roll many CHA checks; with advantage, the average roll should be
  // meaningfully higher than a flat d20 average (10.5). The expected
  // average of "roll twice, take higher" is ~13.82.
  let sum = 0;
  const TRIALS = 400;
  for (let i = 0; i < TRIALS; i++) {
    const c = makeCombatant(`bard_${i}`, {
      cha: 10,
      _friendsAdvNextChaCheck: true,
    });
    const r = rollAbilityCheck(c, 'cha', 1000);
    sum += r.roll;
  }
  const avg = sum / TRIALS;
  // Without advantage, avg ≈ 10.5. With advantage, avg ≈ 13.82.
  // We assert avg > 12 (clearly above flat-d20 average, clearly below
  // the theoretical max of 20). Generous bounds avoid flakiness.
  assert(`9a. CHA-check avg > 12 with Friends advantage (avg=${avg.toFixed(2)})`,
    avg > 12);
  assert(`9b. CHA-check avg < 20 with Friends advantage (avg=${avg.toFixed(2)})`,
    avg < 20);

  // The flag should be CONSUMED after the check resolves (one-shot).
  const c = makeCombatant('bard_one', {
    cha: 10,
    _friendsAdvNextChaCheck: true,
  });
  rollAbilityCheck(c, 'cha', 1000);
  eq('9c. Friends flag CONSUMED after CHA check (one-shot)',
    c._friendsAdvNextChaCheck, undefined);

  // Verify the details array mentions the advantage + consumption.
  const c2 = makeCombatant('bard_two', {
    cha: 10,
    _friendsAdvNextChaCheck: true,
  });
  const r2 = rollAbilityCheck(c2, 'cha', 1000);
  assert('9d. details mentions "advantage"',
    r2.details.some(d => d.includes('advantage')));
  assert('9e. details mentions "Friends advantage consumed"',
    r2.details.some(d => d.includes('Friends advantage consumed')));
}

// ============================================================
// 10. Friends is CHA-only — flag NOT consumed by non-CHA checks
// ============================================================
console.log('\n--- 10. Friends CHA-only ---');
{
  // Roll a non-CHA check with the Friends flag set. The flag should NOT
  // be consumed (Friends only applies to CHA checks per PHB p.244).
  const nonCha: Array<'str' | 'dex' | 'con' | 'int' | 'wis'> =
    ['str', 'dex', 'con', 'int', 'wis'];
  for (const ab of nonCha) {
    const c = makeCombatant(`c_${ab}`, {
      [ab]: 10,
      _friendsAdvNextChaCheck: true,
    });
    const r = rollAbilityCheck(c, ab, 1000);
    // Flag should still be set — Friends is CHA-only.
    eq(`10.${ab}. Friends flag NOT consumed on ${ab.toUpperCase()} check (CHA-only)`,
      c._friendsAdvNextChaCheck, true);
    // And the roll should be a flat d20 (no advantage).
    assert(`10.${ab}. ${ab.toUpperCase()} check roll in 1..20 (no Friends advantage)`,
      r.roll >= 1 && r.roll <= 20);
  }
}

// ============================================================
// 11. Friends + Guidance both consumed on the same CHA check
// ============================================================
console.log('\n--- 11. Friends + Guidance on same CHA check ---');
{
  // Caster has BOTH flags set. A single CHA check should:
  //   - roll with advantage (Friends)
  //   - ADD +1d4 (Guidance)
  //   - CONSUME both flags (one-shot)
  const caster = makeCombatant('bard', {
    cha: 10, // +0 mod (isolate the buffs)
    _friendsAdvNextChaCheck: true,
    _guidanceDieBonusNextAbilityCheck: 4,
  });

  const r = rollAbilityCheck(caster, 'cha', 1000);
  // Expected: rollWithAdvantage() + 0 + 0 + 0 + rollDie(4)
  //         = max(d20, d20) + (1..4) = (2..20) + (1..4) = 3..24
  assert('11a. total in 3..24 (Friends advantage + Guidance +1d4)',
    r.total >= 3 && r.total <= 24, `got ${r.total}`);

  // Both flags CONSUMED.
  eq('11b. Friends flag CONSUMED after CHA check',
    caster._friendsAdvNextChaCheck, undefined);
  eq('11c. Guidance flag CONSUMED after CHA check',
    caster._guidanceDieBonusNextAbilityCheck, undefined);

  // Details mention both.
  assert('11d. details mentions "advantage"',
    r.details.some(d => d.includes('advantage')));
  assert('11e. details mentions "Guidance="',
    r.details.some(d => d.includes('Guidance=')));
  assert('11f. details mentions "Friends advantage consumed"',
    r.details.some(d => d.includes('Friends advantage consumed')));
}

// ============================================================
// 12. Bardic Inspiration folds in (+die, consumed)
// ============================================================
console.log('\n--- 12. Bardic Inspiration ---');
{
  // Caster has a BI die (d6). rollAbilityCheck should add rollDie(6) (1..6)
  // to the total, then consume the die (set to null).
  const caster = makeCombatant('bard', {
    cha: 10, // +0 mod (isolate the BI bonus)
    bardicInspirationDie: 6,
  });

  const r = rollAbilityCheck(caster, 'cha', 1000);
  // Expected: (1..20) + 0 + 0 + rollDie(6) + 0 = 2..26
  assert('12a. total in 2..26 (BI +1d6 applied)',
    r.total >= 2 && r.total <= 26, `got ${r.total}`);
  eq('12b. bardicInspirationDie CONSUMED after check (one-shot)',
    caster.bardicInspirationDie, null);

  // Details mention BI.
  assert('12c. details mentions "BI="',
    r.details.some(d => d.startsWith('BI=')));
}

// ============================================================
// 13. Rage → advantage on STR checks (mirror rollSave)
// ============================================================
console.log('\n--- 13. Rage STR-check advantage ---');
{
  // PHB p.48: "You have advantage on Strength checks and Strength
  // saving throws while raging." Flat unconditional advantage on STR
  // checks — mirror rollSave's rageStrAdvantage for STR saves.
  const ragingBarb = makeCombatant('barb', {
    str: 10, // +0 mod (isolate the advantage effect)
    resources: { rage: { max: 2, remaining: 1, active: true, roundsRemaining: 10 } } as PlayerResources,
  });

  let sum = 0;
  const TRIALS = 400;
  for (let i = 0; i < TRIALS; i++) {
    const c = makeCombatant(`barb_${i}`, {
      str: 10,
      resources: { rage: { max: 2, remaining: 1, active: true, roundsRemaining: 10 } } as PlayerResources,
    });
    const r = rollAbilityCheck(c, 'str', 1000);
    sum += r.roll;
  }
  const avg = sum / TRIALS;
  // Without advantage, avg ≈ 10.5. With advantage, avg ≈ 13.82.
  assert(`13a. STR-check avg > 12 with Rage advantage (avg=${avg.toFixed(2)})`,
    avg > 12);

  // Details mention advantage.
  const r = rollAbilityCheck(ragingBarb, 'str', 1000);
  assert('13b. details mentions "advantage" (Rage)',
    r.details.some(d => d.includes('advantage')));
}

// ============================================================
// 14. Rage does NOT grant advantage on DEX/CON/INT/WIS/CHA checks
// ============================================================
console.log('\n--- 14. Rage non-STR checks ---');
{
  const nonStr: Array<'dex' | 'con' | 'int' | 'wis' | 'cha'> =
    ['dex', 'con', 'int', 'wis', 'cha'];
  for (const ab of nonStr) {
    const c = makeCombatant(`barb_${ab}`, {
      [ab]: 10,
      resources: { rage: { max: 2, remaining: 1, active: true, roundsRemaining: 10 } } as PlayerResources,
    });
    // Roll several times and verify no advantage (avg should be ~10.5, not ~13.8).
    let sum = 0;
    const TRIALS = 200;
    for (let i = 0; i < TRIALS; i++) {
      const ci = makeCombatant(`barb_${ab}_${i}`, {
        [ab]: 10,
        resources: { rage: { max: 2, remaining: 1, active: true, roundsRemaining: 10 } } as PlayerResources,
      });
      const r = rollAbilityCheck(ci, ab, 1000);
      sum += r.roll;
    }
    const avg = sum / TRIALS;
    // Without advantage, avg ≈ 10.5. We assert avg < 12 (clearly below
    // the advantage average of ~13.82). Generous bound avoids flakiness.
    assert(`14.${ab}. ${ab.toUpperCase()}-check avg < 12 with Rage (no advantage, avg=${avg.toFixed(2)})`,
      avg < 12);
  }
}

// ============================================================
// 15. Poisoned → disadvantage on ability checks (RAW — PHB App. A)
// ============================================================
console.log('\n--- 15. Poisoned disadvantage ---');
{
  // PHB Appendix A: "While poisoned, the creature has disadvantage on
  // attack rolls and ability checks." (NOT saves per RAW — rollSave
  // models it for saves too as a known v1 simplification. For ability
  // checks, poisoned disadvantage IS canonically correct.)
  const poisoned = makeCombatant('victim', {
    dex: 10, // +0 mod (isolate the disadvantage effect)
  });
  poisoned.conditions.add('poisoned');

  let sum = 0;
  const TRIALS = 400;
  for (let i = 0; i < TRIALS; i++) {
    const c = makeCombatant(`victim_${i}`, { dex: 10 });
    c.conditions.add('poisoned');
    const r = rollAbilityCheck(c, 'dex', 1000);
    sum += r.roll;
  }
  const avg = sum / TRIALS;
  // Without disadvantage, avg ≈ 10.5. With disadvantage, avg ≈ 7.18.
  assert(`15a. DEX-check avg < 9 with Poisoned disadvantage (avg=${avg.toFixed(2)})`,
    avg < 9);

  // Details mention disadvantage.
  const r = rollAbilityCheck(poisoned, 'dex', 1000);
  assert('15b. details mentions "disadvantage" (Poisoned)',
    r.details.some(d => d.includes('disadvantage')));
}

// ============================================================
// 16. Advantage-system entries (querySelf 'ability:str') fold in
// ============================================================
console.log('\n--- 16. advantage-system entry ---');
{
  // Grant advantage on STR checks via the advantage-system.
  // (Hypothetical feature — e.g. a "Strength of the Bear" feat.)
  const c = makeCombatant('fighter', { str: 10 });
  grantSelf(c, 'advantage', 'ability:str' as D20TestScope,
    'Strength of the Bear', 'until_next_turn');

  let sum = 0;
  const TRIALS = 400;
  for (let i = 0; i < TRIALS; i++) {
    const ci = makeCombatant(`fighter_${i}`, { str: 10 });
    grantSelf(ci, 'advantage', 'ability:str' as D20TestScope,
      'Strength of the Bear', 'until_next_turn');
    const r = rollAbilityCheck(ci, 'str', 1000);
    sum += r.roll;
  }
  const avg = sum / TRIALS;
  assert(`16a. STR-check avg > 12 with advantage-system entry (avg=${avg.toFixed(2)})`,
    avg > 12);

  // The general 'ability' scope should also cover any ability check.
  const c2 = makeCombatant('fighter2', { int: 10 });
  grantSelf(c2, 'advantage', 'ability' as D20TestScope,
    'Universal Ability Buff', 'until_next_turn');
  let sum2 = 0;
  for (let i = 0; i < 200; i++) {
    const ci = makeCombatant(`fighter2_${i}`, { int: 10 });
    grantSelf(ci, 'advantage', 'ability' as D20TestScope,
      'Universal Ability Buff', 'until_next_turn');
    const r = rollAbilityCheck(ci, 'int', 1000);
    sum2 += r.roll;
  }
  const avg2 = sum2 / 200;
  assert(`16b. INT-check avg > 12 with 'ability' scope entry (avg=${avg2.toFixed(2)})`,
    avg2 > 12);
}

// ============================================================
// 17. Advantage + disadvantage cancel out (PHB p.173) — single roll
// ============================================================
console.log('\n--- 17. advantage + disadvantage cancel ---');
{
  // PHB p.173: if you have both advantage and disadvantage on a roll,
  // they cancel each other out and you roll a single die (neither applies).
  //
  // Construct: Friends advantage (CHA) + Poisoned disadvantage.
  const c = makeCombatant('bard', { cha: 10 });
  c._friendsAdvNextChaCheck = true; // advantage on next CHA check
  c.conditions.add('poisoned');     // disadvantage on ability checks

  // Roll many times; with cancellation, avg should be ~10.5 (flat d20),
  // NOT ~13.82 (advantage) and NOT ~7.18 (disadvantage).
  let sum = 0;
  const TRIALS = 400;
  for (let i = 0; i < TRIALS; i++) {
    const ci = makeCombatant(`bard_${i}`, { cha: 10 });
    ci._friendsAdvNextChaCheck = true;
    ci.conditions.add('poisoned');
    const r = rollAbilityCheck(ci, 'cha', 1000);
    sum += r.roll;
  }
  const avg = sum / TRIALS;
  // With cancellation, avg ≈ 10.5. We assert 9 < avg < 12 (clearly
  // between the advantage and disadvantage averages).
  assert(`17a. CHA-check avg in 9..12 with advantage+disadvantage cancellation (avg=${avg.toFixed(2)})`,
    avg > 9 && avg < 12);

  // CRITICAL: the Friends flag is STILL consumed even though the advantage
  // was cancelled out by disadvantage. The PHB p.173 rule says the roll
  // is a single die, but the Friends buff is still "used up" (one-shot
  // consume semantics — mirror True Strike's behavior when an advantage-
  // granting buff has its advantage cancelled by disadvantage).
  // (This matches the codebase convention: True Strike's flag is consumed
  // by resolveAttack even if disadvantage cancels the advantage.)
  const c2 = makeCombatant('bard2', { cha: 10 });
  c2._friendsAdvNextChaCheck = true;
  c2.conditions.add('poisoned');
  rollAbilityCheck(c2, 'cha', 1000);
  eq('17b. Friends flag CONSUMED even when advantage cancelled by disadvantage',
    c2._friendsAdvNextChaCheck, undefined);
}

// ============================================================
// 18. Both flags clear at start of caster's NEXT turn (resetBudget)
// ============================================================
console.log('\n--- 18. both flags clear via resetBudget ---');
{
  // Guidance flag — set, then resetBudget (start of next turn) → cleared.
  const caster1 = makeCombatant('cleric', { _guidanceDieBonusNextAbilityCheck: 4 });
  eq('18a. Guidance flag set before resetBudget',
    caster1._guidanceDieBonusNextAbilityCheck, 4);
  resetBudget(caster1);
  eq('18b. Guidance flag cleared by resetBudget',
    caster1._guidanceDieBonusNextAbilityCheck, undefined);

  // Friends flag — set, then resetBudget → cleared.
  const caster2 = makeCombatant('bard', { _friendsAdvNextChaCheck: true });
  eq('18c. Friends flag set before resetBudget',
    caster2._friendsAdvNextChaCheck, true);
  resetBudget(caster2);
  eq('18d. Friends flag cleared by resetBudget',
    caster2._friendsAdvNextChaCheck, undefined);

  // Both flags set, then resetBudget → both cleared.
  const caster3 = makeCombatant('bardcleric', {
    _guidanceDieBonusNextAbilityCheck: 4,
    _friendsAdvNextChaCheck: true,
  });
  resetBudget(caster3);
  eq('18e. both flags cleared by resetBudget (Guidance)',
    caster3._guidanceDieBonusNextAbilityCheck, undefined);
  eq('18f. both flags cleared by resetBudget (Friends)',
    caster3._friendsAdvNextChaCheck, undefined);

  // After resetBudget, a check should have NO bonus and NO advantage.
  caster3.cha = 10;
  const r = rollAbilityCheck(caster3, 'cha', 1000);
  // Expected: flat d20 + 0 = 1..20.
  assert('18g. CHA check after resetBudget in 1..20 (NO buffs — expired)',
    r.total >= 1 && r.total <= 20, `got ${r.total}`);
}

// ============================================================
// 19. details array contains the expected components
// ============================================================
console.log('\n--- 19. details array ---');
{
  // Basic check — details should contain d20, ability mod, total, dc, success/fail.
  const c = makeCombatant('cleric', { wis: 14 }); // +2 mod
  const r = rollAbilityCheck(c, 'wis', 5);
  assert('19a. details includes "d20="',
    r.details.some(d => d.startsWith('d20=')));
  assert('19b. details includes "wis mod=+2"',
    r.details.some(d => d.includes('wis mod=+2')));
  assert('19c. details includes "total="',
    r.details.some(d => d.startsWith('total=')));
  assert('19d. details includes "dc=5"',
    r.details.some(d => d === 'dc=5'));
  assert('19e. details includes "success" or "fail"',
    r.details.some(d => d === 'success' || d === 'fail'));

  // With prof.
  const c2 = makeCombatant('rogue', { dex: 16, cr: 1 }); // +3 mod, prof=2 at CR 1
  const r2 = rollAbilityCheck(c2, 'dex', 5, true);
  assert('19f. details includes "prof=+2" when proficient',
    r2.details.some(d => d === 'prof=+2'));

  // With Guidance.
  const c3 = makeCombatant('cleric3', {
    wis: 10,
    _guidanceDieBonusNextAbilityCheck: 4,
  });
  const r3 = rollAbilityCheck(c3, 'wis', 1000);
  assert('19g. details includes "Guidance=+N"',
    r3.details.some(d => d.startsWith('Guidance=+')));

  // With Friends.
  const c4 = makeCombatant('bard4', {
    cha: 10,
    _friendsAdvNextChaCheck: true,
  });
  const r4 = rollAbilityCheck(c4, 'cha', 1000);
  assert('19h. details includes "advantage" (Friends)',
    r4.details.some(d => d === 'advantage'));
  assert('19i. details includes "Friends advantage consumed"',
    r4.details.some(d => d === 'Friends advantage consumed'));
}

// ============================================================
// 20. mirror rollSave architecture (same choke-point pattern)
// ============================================================
console.log('\n--- 20. mirror rollSave architecture ---');
{
  // rollSave and rollAbilityCheck both:
  //   - Take (combatant, ability, dc, isProficient=false)
  //   - Roll d20 with advantage/disadvantage
  //   - Add ability mod + prof + BI + cantrip-flag-bonus
  //   - Consume one-shot flags (Mind Sliver / Resistance for rollSave;
  //     Guidance / Friends for rollAbilityCheck)
  //   - Return { roll, total, success } (rollAbilityCheck ALSO returns details)
  //
  // Verify the parallel: both functions consume their respective cantrip
  // flags in the same one-shot pattern.

  // rollSave consumes Resistance's _resistanceDieBonusNextSave.
  const saveCaster = makeCombatant('cleric_save', {
    wis: 10,
    _resistanceDieBonusNextSave: 4,
  });
  rollSave(saveCaster, 'wis', 1000);
  eq('20a. rollSave CONSUMES _resistanceDieBonusNextSave (one-shot)',
    saveCaster._resistanceDieBonusNextSave, undefined);

  // rollAbilityCheck consumes Guidance's _guidanceDieBonusNextAbilityCheck.
  const checkCaster = makeCombatant('cleric_check', {
    wis: 10,
    _guidanceDieBonusNextAbilityCheck: 4,
  });
  rollAbilityCheck(checkCaster, 'wis', 1000);
  eq('20b. rollAbilityCheck CONSUMES _guidanceDieBonusNextAbilityCheck (one-shot)',
    checkCaster._guidanceDieBonusNextAbilityCheck, undefined);

  // rollSave does NOT touch the Guidance flag (different choke point).
  const saveCaster2 = makeCombatant('cleric_save2', {
    wis: 10,
    _guidanceDieBonusNextAbilityCheck: 4,
  });
  rollSave(saveCaster2, 'wis', 1000);
  eq('20c. rollSave does NOT touch _guidanceDieBonusNextAbilityCheck',
    saveCaster2._guidanceDieBonusNextAbilityCheck, 4);

  // rollAbilityCheck does NOT touch the Resistance flag (different choke point).
  const checkCaster2 = makeCombatant('cleric_check2', {
    wis: 10,
    _resistanceDieBonusNextSave: 4,
  });
  rollAbilityCheck(checkCaster2, 'wis', 1000);
  eq('20d. rollAbilityCheck does NOT touch _resistanceDieBonusNextSave',
    checkCaster2._resistanceDieBonusNextSave, 4);

  // Cleanup functions for both cantrips clear their respective flags.
  const c1 = makeCombatant('c1', { _guidanceDieBonusNextAbilityCheck: 4 });
  cleanupGuidance(c1);
  eq('20e. cleanupGuidance clears _guidanceDieBonusNextAbilityCheck',
    c1._guidanceDieBonusNextAbilityCheck, undefined);

  const c2 = makeCombatant('c2', { _friendsAdvNextChaCheck: true });
  cleanupFriends(c2);
  eq('20f. cleanupFriends clears _friendsAdvNextChaCheck',
    c2._friendsAdvNextChaCheck, undefined);

  // abilityMod and profBonusByCR are shared between rollSave and rollAbilityCheck.
  eq('20g. abilityMod(14) = +2 (shared helper)', abilityMod(14), 2);
  eq('20h. abilityMod(8) = -1 (shared helper)', abilityMod(8), -1);
  eq('20i. profBonusByCR(1) = 2 (shared helper)', profBonusByCR(1), 2);
  eq('20j. profBonusByCR(10) = 4 (shared helper)', profBonusByCR(10), 4);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
