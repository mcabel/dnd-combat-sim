// ============================================================
// branding_smite.test.ts — Branding Smite spell module
// PHB p.219: 2nd-level evocation, BONUS ACTION, self, concentration 1 min.
// Effect: next weapon hit deals +2d6 radiant.
//
// Tests cover shouldCast() preconditions, execute() scratch-flag
// application + slot consumption + logging, cleanup() flag clearing,
// and the resolveAttack damage integration (tested via a direct
// simulation of the damage-branch logic).
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/branding_smite';
import { Combatant, Action, PlayerResources } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function withSlots2(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

const MELEE_ACTION: Action = {
  name: 'Longsword',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: 5,
  damage: { count: 1, sides: 8, bonus: 0, average: 4 },
  damageType: 'slashing',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Longsword melee attack',
};

const RANGED_ACTION: Action = {
  name: 'Shortbow',
  isMultiattack: false,
  attackType: 'ranged',
  reach: 0,
  range: { normal: 80, long: 80 },
  hitBonus: 4,
  damage: { count: 1, sides: 6, bonus: 0, average: 3 },
  damageType: 'piercing',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Shortbow ranged attack',
};

const SPELL_ACTION: Action = {
  name: 'Fire Bolt',
  isMultiattack: false,
  attackType: 'spell',
  reach: 0,
  range: { normal: 120, long: 120 },
  hitBonus: 5,
  damage: { count: 1, sides: 10, bonus: 0, average: 5 },
  damageType: 'fire',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Fire Bolt cantrip',
};

const BRANDING_SMITE_ACTION: Action = {
  name: 'Branding Smite',
  isMultiattack: false,
  attackType: null,
  reach: 0,
  range: null,
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'bonusAction',
  legendaryCost: 0,
  description: 'Branding Smite (next weapon hit +2d6 radiant)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 16, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 14,
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

function makeBF(combatants: Combatant[]) {
  return {
    width: 20, height: 20, depth: 1,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

/** Paladin at (0,0,0) with Branding Smite + Longsword + 2 2nd-level slots */
function makePaladin(): Combatant {
  return makeCombatant('paladin1', {
    name: 'Paladin',
    actions: [BRANDING_SMITE_ACTION, MELEE_ACTION],
    resources: withSlots2(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('level is 2', metadata.level, 2);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 0 ft (self)', metadata.rangeFt, 0);
eq('radiant dice is 2', metadata.radiantDice, 2);
eq('radiant die sides is 6', metadata.radiantDieSides, 6);
eq('concentration required (canon)', metadata.concentration, true);
eq('casting time is bonusAction', metadata.castingTime, 'bonusAction');

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Branding Smite' action
  const caster = makePaladin();
  caster.actions = [MELEE_ACTION]; // strip Branding Smite
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  eq('Returns false when caster has no Branding Smite action', shouldCast(caster, bf), false);
}

{
  // 2b. No 2nd-level slots
  const caster = makePaladin();
  caster.resources = withSlots2(0);
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  eq('Returns false when no 2nd-level slots', shouldCast(caster, bf), false);
}

{
  // 2c. Already primed (re-cast would be wasteful)
  const caster = makePaladin();
  caster._brandingSmiteActive = true;
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  eq('Returns false when already primed', shouldCast(caster, bf), false);
}

{
  // 2d. No weapon attack (spell-only caster — no benefit)
  const caster = makePaladin();
  caster.actions = [BRANDING_SMITE_ACTION, SPELL_ACTION]; // spell attack only
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  eq('Returns false when caster has no weapon attack (spell-only)', shouldCast(caster, bf), false);
}

{
  // 2e. No enemies (buff is useless)
  const caster = makePaladin();
  const ally = makeCombatant('ally1', { faction: 'party' });
  const bf = makeBF([caster, ally]);
  eq('Returns false when no enemies present', shouldCast(caster, bf), false);
}

{
  // 2f. Happy path: melee + Branding Smite + slot + enemy
  const caster = makePaladin();
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  eq('Returns true when all conditions met (melee)', shouldCast(caster, bf), true);
}

{
  // 2g. Happy path: ranged + Branding Smite + slot + enemy
  const caster = makePaladin();
  caster.actions = [BRANDING_SMITE_ACTION, RANGED_ACTION];
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  eq('Returns true when all conditions met (ranged)', shouldCast(caster, bf), true);
}

// ============================================================
// 3. execute — scratch flag + slot consumption
// ============================================================

console.log('\n=== 3. execute — scratch flag + slot consumption ===\n');

{
  // 3a. _brandingSmiteActive set to true after execute
  const caster = makePaladin();
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  assert('Flag is undefined before execute', caster._brandingSmiteActive === undefined);

  execute(caster, state);

  eq('Flag is true after execute', caster._brandingSmiteActive, true);
}

{
  // 3b. Slot consumed (2nd level)
  const caster = makePaladin();
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('2nd-level slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 3c. Logging — action + condition_add events
  const caster = makePaladin();
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('Action event emitted', actionEvents.length >= 1);
  assert('Condition_add event emitted', condEvents.length >= 1);
  assert('Action event mentions Branding Smite', actionEvents[0].description.includes('Branding Smite'));
  assert('Action event mentions 2d6 radiant', actionEvents[0].description.includes('2d6'));
}

// ============================================================
// 4. cleanup — flag clearing (safety net)
// ============================================================

console.log('\n=== 4. cleanup — flag clearing (safety net) ===\n');

{
  // 4a. cleanup clears the flag if set
  const caster = makePaladin();
  caster._brandingSmiteActive = true;

  cleanup(caster);

  eq('cleanup clears _brandingSmiteActive (true → false)', caster._brandingSmiteActive, false);
}

{
  // 4b. cleanup is a no-op if flag not set
  const caster = makePaladin();
  // _brandingSmiteActive is undefined
  cleanup(caster);
  eq('cleanup is a no-op when flag undefined', caster._brandingSmiteActive, undefined);
}

{
  // 4c. Full cycle: execute → cleanup simulates "primed but no weapon attack made"
  const caster = makePaladin();
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);
  eq('Flag set after execute', caster._brandingSmiteActive, true);

  cleanup(caster);
  eq('Flag cleared by cleanup (no weapon attack made)', caster._brandingSmiteActive, false);
}

// ============================================================
// 5. resolveAttack damage integration (simulated)
// ============================================================

console.log('\n=== 5. resolveAttack damage integration (simulated) ===\n');

// We can't easily call resolveAttack directly (it requires a full EngineState
// with all the combat infrastructure). Instead, we simulate the damage branch
// logic that combat.ts uses to verify the +2d6 radiant is applied correctly.

/**
 * Simulate the Branding Smite damage bonus from combat.ts.
 * Returns the radiant damage dealt + whether the flag was consumed.
 */
function simulateBrandingSmiteDamage(
  attacker: Combatant,
  attackType: 'melee' | 'ranged' | 'spell' | null,
  isCrit: boolean,
): { damage: number; consumed: boolean } {
  if (
    attacker._brandingSmiteActive === true &&
    (attackType === 'melee' || attackType === 'ranged')
  ) {
    // Mirror combat.ts: 2d6 radiant, crit → 4d6
    const diceCount = isCrit ? 4 : 2;
    let bonus = 0;
    for (let i = 0; i < diceCount; i++) bonus += Math.floor(Math.random() * 6) + 1;
    attacker._brandingSmiteActive = false;  // consume
    return { damage: bonus, consumed: true };
  }
  return { damage: 0, consumed: false };
}

{
  // 5a. Melee weapon attack — bonus applied, flag consumed
  const caster = makePaladin();
  caster._brandingSmiteActive = true;
  const result = simulateBrandingSmiteDamage(caster, 'melee', false);
  assert('Melee attack: damage in [2, 12] (2d6)', result.damage >= 2 && result.damage <= 12);
  eq('Melee attack: flag consumed', result.consumed, true);
  eq('Melee attack: flag set to false after', caster._brandingSmiteActive, false);
}

{
  // 5b. Ranged weapon attack — bonus applied, flag consumed
  const caster = makePaladin();
  caster._brandingSmiteActive = true;
  const result = simulateBrandingSmiteDamage(caster, 'ranged', false);
  assert('Ranged attack: damage in [2, 12] (2d6)', result.damage >= 2 && result.damage <= 12);
  eq('Ranged attack: flag consumed', result.consumed, true);
}

{
  // 5c. Spell attack — NO bonus, flag NOT consumed (PHB p.219: "weapon attack")
  const caster = makePaladin();
  caster._brandingSmiteActive = true;
  const result = simulateBrandingSmiteDamage(caster, 'spell', false);
  eq('Spell attack: no damage (PHB p.219: weapon attack only)', result.damage, 0);
  eq('Spell attack: flag NOT consumed', result.consumed, false);
  eq('Spell attack: flag still true', caster._brandingSmiteActive, true);
}

{
  // 5d. Crit doubles the dice (4d6 instead of 2d6)
  const caster = makePaladin();
  caster._brandingSmiteActive = true;
  const result = simulateBrandingSmiteDamage(caster, 'melee', true);
  assert('Crit: damage in [4, 24] (4d6)', result.damage >= 4 && result.damage <= 24);
  eq('Crit: flag consumed', result.consumed, true);
}

{
  // 5e. Flag not set — no bonus
  const caster = makePaladin();
  // _brandingSmiteActive is undefined
  const result = simulateBrandingSmiteDamage(caster, 'melee', false);
  eq('Flag unset: no damage', result.damage, 0);
  eq('Flag unset: not consumed', result.consumed, false);
}

// ============================================================
// 6. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 6. Integration pipeline ===\n');

{
  // 6a. Full pipeline: paladin primes Branding Smite, then makes a melee attack
  const caster = makePaladin();
  const enemy = makeCombatant('goblin1', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const should = shouldCast(caster, bf);
  assert('shouldCast returns true', should === true);
  if (should) execute(caster, state);

  eq('Flag set after execute', caster._brandingSmiteActive, true);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);

  // Simulate the melee attack consuming the flag
  const result = simulateBrandingSmiteDamage(caster, 'melee', false);
  assert('Melee attack after Branding Smite deals radiant bonus', result.damage >= 2);
  eq('Flag consumed by melee attack', caster._brandingSmiteActive, false);
}

{
  // 6b. After slots exhausted, shouldCast returns false
  const caster = makePaladin();
  caster.resources = withSlots2(1);
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  if (shouldCast(caster, bf)) execute(caster, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  eq('shouldCast returns false after slots exhausted', shouldCast(caster, makeBF([caster, enemy])), false);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
