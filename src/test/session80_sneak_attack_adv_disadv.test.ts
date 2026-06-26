// ============================================================
// Test: Session 80 — Sneak Attack advantage/disadvantage
//       cancellation fix (PHB p.96 + PHB p.173)
//
// PHB p.96: "Once per turn, you can deal an extra 1d6 damage
// to one creature you hit with an attack if you have advantage
// on the attack roll... You don't need advantage on the attack
// roll if another enemy of the target is within 5 feet of it...
// and you don't have disadvantage on the attack roll."
//
// PHB p.173: "If circumstances cause a roll to have both
// advantage and disadvantage, you are considered to have
// neither of them."
//
// Session 80 fix: canSneakAttack() now uses NET advantage/
// disadvantage (after PHB p.173 cancellation). When both
// advantage and disadvantage are present, the attacker has
// "neither" — so:
//   - Advantage route is UNAVAILABLE (no net advantage)
//   - Ally-adjacent route IS available (no net disadvantage)
//
// Prior bug: when both advantage and disadvantage were present,
// the raw hasAdvantage flag allowed Sneak Attack via the
// advantage route, even though the net result was a straight roll.
//
// Run: npx ts-node --transpile-only src/test/session80_sneak_attack_adv_disadv.test.ts
// ============================================================

import { Combatant, Action, Condition, PlayerResources } from '../types/core';
import { canSneakAttack, sneakAttackDice } from '../engine/utils';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}

// ---- Shared helpers -----------------------------------------

function makeRogue(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'rogue', name: 'Rogue', isPlayer: true, faction: 'party',
    maxHP: 20, currentHP: 20, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10,
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

const SHORTSWORD: Action = {
  name: 'Shortsword', isMultiattack: false, attackType: 'melee',
  reach: 5, range: { normal: 5, long: 5 },
  hitBonus: 5, damage: { count: 1, sides: 6, bonus: 3, average: 6 },
  damageType: 'piercing', isAoE: false, isControl: false,
  requiresConcentration: false, slotLevel: 0, costType: 'action',
  legendaryCost: 0, description: 'Shortsword',
  saveDC: null, saveAbility: null,
};

const LONGSWORD: Action = {
  name: 'Longsword', isMultiattack: false, attackType: 'melee',
  reach: 5, range: { normal: 5, long: 5 },
  hitBonus: 4, damage: { count: 1, sides: 8, bonus: 2, average: 6 },
  damageType: 'slashing', isAoE: false, isControl: false,
  requiresConcentration: false, slotLevel: 0, costType: 'action',
  legendaryCost: 0, description: 'Longsword',
  saveDC: null, saveAbility: null,
};

// ============================================================
// Phase 1 — Basic Sneak Attack eligibility
// ============================================================

console.log('\n=== Phase 1 — Basic Sneak Attack eligibility ===\n');

{
  const rogue = makeRogue();
  // 1a. Advantage, no disadvantage, no ally → SA via advantage
  assert('1a. Advantage only → SA allowed', canSneakAttack(rogue, SHORTSWORD, true, false, false));
  // 1b. No advantage, no disadvantage, ally adjacent → SA via ally
  assert('1b. No advantage, ally adjacent → SA allowed', canSneakAttack(rogue, SHORTSWORD, false, false, true));
  // 1c. No advantage, no disadvantage, no ally → no SA
  assert('1c. No advantage, no ally → SA denied', !canSneakAttack(rogue, SHORTSWORD, false, false, false));
  // 1d. Disadvantage only → no SA (even with ally)
  assert('1d. Disadvantage only → SA denied (even with ally)', !canSneakAttack(rogue, SHORTSWORD, false, true, true));
  // 1e. Non-finesse weapon → no SA
  assert('1e. Longsword (non-finesse) → SA denied', !canSneakAttack(rogue, LONGSWORD, true, false, false));
  // 1f. Already used SA this turn → no SA
  const rogue2 = makeRogue({ usedSneakAttackThisTurn: true });
  assert('1f. SA already used this turn → SA denied', !canSneakAttack(rogue2, SHORTSWORD, true, false, false));
}

// ============================================================
// Phase 2 — PHB p.173: Advantage + Disadvantage cancellation
// ============================================================

console.log('\n=== Phase 2 — Advantage + Disadvantage cancellation (PHB p.173) ===\n');

{
  const rogue = makeRogue();
  // 2a. Both advantage and disadvantage: cancel to "neither"
  //     No net advantage → advantage route unavailable
  //     No net disadvantage → ally-adjacent route available
  assert('2a. Both adv+disadv, no ally → SA denied (no net advantage)', !canSneakAttack(rogue, SHORTSWORD, true, true, false));
  assert('2b. Both adv+disadv, ally adjacent → SA allowed (no net disadvantage, ally route available)', canSneakAttack(rogue, SHORTSWORD, true, true, true));
}

// ============================================================
// Phase 3 — Edge cases
// ============================================================

console.log('\n=== Phase 3 — Edge cases ===\n');

{
  const rogue = makeRogue();
  // 3a. Ranged weapon with advantage → SA
  const SHORTBOW: Action = {
    name: 'Shortbow', isMultiattack: false, attackType: 'ranged',
    reach: 5, range: { normal: 80, long: 320 },
    hitBonus: 5, damage: { count: 1, sides: 6, bonus: 0, average: 3 },
    damageType: 'piercing', isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 0, costType: 'action',
    legendaryCost: 0, description: 'Shortbow',
    saveDC: null, saveAbility: null,
  };
  assert('3a. Ranged weapon with advantage → SA allowed', canSneakAttack(rogue, SHORTBOW, true, false, false));
  // 3b. Ranged weapon with disadvantage → no SA (e.g., attacking into Fog Cloud)
  assert('3b. Ranged weapon with disadvantage → SA denied', !canSneakAttack(rogue, SHORTBOW, false, true, true));
}

// ============================================================
// Phase 4 — sneakAttackDice
// ============================================================

console.log('\n=== Phase 4 — sneakAttackDice ===\n');

{
  const d1 = sneakAttackDice(1);
  assert('4a. Level 1 → 1d6', d1.count === 1 && d1.sides === 6);
  const d3 = sneakAttackDice(5);
  assert('4b. Level 5 → 3d6', d3.count === 3 && d3.sides === 6);
  const d5 = sneakAttackDice(9);
  assert('4c. Level 9 → 5d6', d5.count === 5 && d5.sides === 6);
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
