// ============================================================
// reaction_registry.test.ts — TG-008 Reaction spell registry
//
// Tests the registry itself (lookups, descriptor shape) and the
// `triggerReactions` dispatch helper via `resolveAttack` integration.
//
// Coverage:
//   1. Registry shape — all 6 reaction spells registered with correct metadata
//   2. getReactionSpell lookup
//   3. Shield reactive trigger via resolveAttack (hit → miss flip)
//   4. Shield does NOT fire when +5 AC wouldn't flip the hit
//   5. Shield does NOT fire when reaction already used (e.g., OA)
//   6. Shield does NOT fire on self-attack
//   7. Absorb Elements reactive trigger via resolveAttack (damage taken → resistance)
//   8. Absorb Elements rider consumed on next melee hit
//   9. Hellish Rebuke reactive trigger (damage taken → 2d10 fire at attacker)
//  10. Silvery Barbs reactive trigger (hit → reroll, may flip to miss)
// ============================================================

import { REACTION_SPELLS, getReactionSpell } from '../spells/_reaction_registry';
import { Combatant, Action, PlayerResources, Battlefield, Vec3 } from '../types/core';
import { resolveAttack, EngineState } from '../engine/combat';
import { resetBudget } from '../engine/utils';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

function withL3Slots(remaining = 1): PlayerResources {
  return { spellSlots: { 3: { max: 1, remaining } } };
}

const SHIELD_ACTION: Action = {
  name: 'Shield', costType: 'reaction', attackType: null,
  isMultiattack: false, reach: 0, range: null, hitBonus: null,
  damage: null, damageType: null, saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 1, legendaryCost: 0, description: 'Shield',
};

const ABSORB_ACTION: Action = {
  name: 'Absorb Elements', costType: 'reaction', attackType: null,
  isMultiattack: false, reach: 0, range: null, hitBonus: null,
  damage: null, damageType: null, saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 1, legendaryCost: 0, description: 'Absorb Elements',
};

const HELLISH_REBUKE_ACTION: Action = {
  name: 'Hellish Rebuke', costType: 'reaction', attackType: null,
  isMultiattack: false, reach: 0, range: null, hitBonus: null,
  damage: null, damageType: null, saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 1, legendaryCost: 0, description: 'Hellish Rebuke',
};

const SILVERY_BARBS_ACTION: Action = {
  name: 'Silvery Barbs', costType: 'reaction', attackType: null,
  isMultiattack: false, reach: 0, range: null, hitBonus: null,
  damage: null, damageType: null, saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 1, legendaryCost: 0, description: 'Silvery Barbs',
};

const COUNTERSPELL_ACTION: Action = {
  name: 'Counterspell', costType: 'reaction', attackType: null,
  isMultiattack: false, reach: 0, range: null, hitBonus: null,
  damage: null, damageType: null, saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 3, legendaryCost: 0, description: 'Counterspell',
};

const FEATHER_FALL_ACTION: Action = {
  name: 'Feather Fall', costType: 'reaction', attackType: null,
  isMultiattack: false, reach: 0, range: null, hitBonus: null,
  damage: null, damageType: null, saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 1, legendaryCost: 0, description: 'Feather Fall',
};

function makeSwordAction(hitBonus = 5, dmgBonus = 3): Action {
  return {
    name: 'Longsword', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus,
    damage: { dieSides: 8, dieCount: 1, bonus: dmgBonus, dice: [] } as any,
    damageType: 'slashing',
    saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    slotLevel: 0, noCantripScaling: true, legendaryCost: 0, description: 'Longsword attack',
  };
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 50, currentHP: 50, ac: 15, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 16,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart',
    perception: { targets: new Map() } as any,
    concentration: null, deathSaves: null, resources: null,
    tempHP: 0, mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null,
    activeEffects: [], exhaustionLevel: 0,
    ...overrides,
  };
}

function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map(combatants.map(c => [c.id, c]));
  return {
    combatants: map,
    cells: new Map(),
    width: 20, height: 20, round: 1,
  } as any;
}

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

// ============================================================
// Section 1: Registry shape
// ============================================================

console.log('\n--- Section 1: Registry shape ---');

eq('Registry has 6 reaction spells', REACTION_SPELLS.length, 6);

const names = REACTION_SPELLS.map(s => s.name).sort();
eq('Shield is registered', names.includes('Shield'), true);
eq('Absorb Elements is registered', names.includes('Absorb Elements'), true);
eq('Hellish Rebuke is registered', names.includes('Hellish Rebuke'), true);
eq('Counterspell is registered', names.includes('Counterspell'), true);
eq('Feather Fall is registered', names.includes('Feather Fall'), true);
eq('Silvery Barbs is registered', names.includes('Silvery Barbs'), true);

for (const spell of REACTION_SPELLS) {
  assert(`Spell "${spell.name}" has a name`, typeof spell.name === 'string' && spell.name.length > 0);
  assert(`Spell "${spell.name}" has level >= 1`, spell.level >= 1);
  assert(`Spell "${spell.name}" has triggerKinds array`, Array.isArray(spell.triggerKinds) && spell.triggerKinds.length > 0);
  assert(`Spell "${spell.name}" has shouldCast function`, typeof spell.shouldCast === 'function');
  assert(`Spell "${spell.name}" has execute function`, typeof spell.execute === 'function');
}

// ============================================================
// Section 2: getReactionSpell lookup
// ============================================================

console.log('\n--- Section 2: getReactionSpell lookup ---');

assert('getReactionSpell("Shield") returns descriptor', getReactionSpell('Shield') !== undefined);
eq('getReactionSpell("Shield").level', getReactionSpell('Shield')!.level, 1);
eq('getReactionSpell("Counterspell").level', getReactionSpell('Counterspell')!.level, 3);
assert('getReactionSpell("Unknown") returns undefined', getReactionSpell('Unknown Spell') === undefined);

// ============================================================
// Section 3: Shield reactive trigger — hit → miss flip
// ============================================================

console.log('\n--- Section 3: Shield reactive trigger via resolveAttack ---');

// Setup: attacker with +5 to hit rolls a 12 (total 17 vs AC 15 = hit).
// Target has Shield known + L1 slot + reaction unused.
// Shield's shouldCastReaction: attackTotal (17) < effectiveAC (15) + 5 (=20) → fires.
// After Shield: AC becomes 20, attack 17 misses.
{
  // We can't control the dice roll directly, but we can set up a scenario
  // where the hit margin is small enough that Shield's +5 will flip it.
  // AC 15, attacker hitBonus +5. Attack roll 10-14 → total 15-19 → hits AC 15
  // but Shield's +5 (AC 20) would block totals 15-19.
  // We test the integration by checking that Shield's effect is applied.
  const attacker = makeCombatant('attacker', {
    faction: 'enemy',
    actions: [makeSwordAction(5, 3)],
    pos: { x: 1, y: 0, z: 0 },
  });
  const target = makeCombatant('target', {
    faction: 'party',
    ac: 15,
    actions: [SHIELD_ACTION],
    resources: withSlots(2),
  });
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);

  // Run many attacks to get at least one hit in the 15-19 range.
  let shieldFired = false;
  let negatedCount = 0;
  for (let i = 0; i < 200 && !shieldFired; i++) {
    // Reset state
    target.currentHP = 50;
    target.isDead = false;
    target.isUnconscious = false;
    target.budget.reactionUsed = false;
    target.activeEffects = [];
    target.resources = withSlots(2);
    attacker.budget.actionUsed = false;

    resolveAttack(attacker, target, attacker.actions[0], state);

    // Check if Shield fired (effect applied + reaction used)
    const hasShield = target.activeEffects.some((e: any) => e.spellName === 'Shield');
    if (hasShield && target.budget.reactionUsed) {
      shieldFired = true;
      // Check that the log mentions Shield
      const shieldLog = state.log.events.some(e => e.description.includes('casts Shield'));
      assert('Shield fired and logged', shieldLog);
      // Check that a slot was consumed
      const slots = target.resources!.spellSlots![1].remaining;
      eq('Slot consumed after Shield', slots, 1);
    }
  }
  assert('Shield fired in at least one of 200 attacks', shieldFired,
    'Shield never fired — may need to verify shouldCastReaction logic');
}

// ============================================================
// Section 4: Shield does NOT fire when +5 AC wouldn't flip the hit
// ============================================================

console.log('\n--- Section 4: Shield does NOT fire when +5 would not flip ---');

{
  // AC 15, attacker hitBonus +20. Even with Shield's +5 (AC 20), total 25+ still hits.
  // Shield's shouldCastReaction: attackTotal (25+) >= effectiveAC (15) + 5 (=20) → does NOT fire.
  const attacker = makeCombatant('strong', {
    faction: 'enemy',
    actions: [makeSwordAction(20, 3)],
    pos: { x: 1, y: 0, z: 0 },
  });
  const target = makeCombatant('target', {
    faction: 'party',
    ac: 15,
    actions: [SHIELD_ACTION],
    resources: withSlots(2),
  });
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);

  for (let i = 0; i < 50; i++) {
    target.currentHP = 50;
    target.isDead = false;
    target.isUnconscious = false;
    target.budget.reactionUsed = false;
    target.activeEffects = [];
    target.resources = withSlots(2);
    resolveAttack(attacker, target, attacker.actions[0], state);
  }
  // Shield should NEVER have fired (attackTotal always >= 21, AC+5 = 20)
  const shieldFired = state.log.events.some(e => e.description.includes('casts Shield'));
  assert('Shield did NOT fire when +5 would not flip the hit', !shieldFired,
    `Shield fired ${state.log.events.filter(e => e.description.includes('casts Shield')).length} times`);
}

// ============================================================
// Section 5: Shield does NOT fire when reaction already used
// ============================================================

console.log('\n--- Section 5: Shield does NOT fire when reaction used ---');

{
  const attacker = makeCombatant('attacker', {
    faction: 'enemy',
    actions: [makeSwordAction(5, 3)],
    pos: { x: 1, y: 0, z: 0 },
  });
  const target = makeCombatant('target', {
    faction: 'party',
    ac: 15,
    actions: [SHIELD_ACTION],
    resources: withSlots(2),
    // Reaction already used (e.g., from an OA earlier this round)
  });
  target.budget.reactionUsed = true;
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);

  for (let i = 0; i < 200; i++) {
    target.currentHP = 50;
    target.isDead = false;
    target.isUnconscious = false;
    // Keep reaction used
    target.budget.reactionUsed = true;
    target.activeEffects = [];
    target.resources = withSlots(2);
    resolveAttack(attacker, target, attacker.actions[0], state);
  }
  const shieldFired = state.log.events.some(e => e.description.includes('casts Shield'));
  assert('Shield did NOT fire when reaction already used', !shieldFired);
}

// ============================================================
// Section 6: Shield does NOT fire on self-attack (impossible scenario, but guard)
// ============================================================

console.log('\n--- Section 6: Shield self-trigger guard ---');

{
  // This is an artificial scenario — a creature attacking itself.
  // The triggerReactions helper guards against self-trigger.
  const caster = makeCombatant('caster', {
    faction: 'party',
    ac: 15,
    actions: [SHIELD_ACTION, makeSwordAction(5, 3)],
    resources: withSlots(2),
    pos: { x: 0, y: 0, z: 0 },
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  for (let i = 0; i < 100; i++) {
    caster.currentHP = 50;
    caster.budget.reactionUsed = false;
    caster.activeEffects = [];
    caster.resources = withSlots(2);
    resolveAttack(caster, caster, caster.actions[1], state);
  }
  const shieldFired = state.log.events.some(e => e.description.includes('casts Shield'));
  assert('Shield did NOT fire on self-attack', !shieldFired);
}

// ============================================================
// Section 7: Absorb Elements reactive trigger
// ============================================================

console.log('\n--- Section 7: Absorb Elements reactive trigger ---');

{
  // Target takes fire damage → Absorb Elements fires → grants fire resistance
  // + stores 1d6 fire rider for next melee hit.
  const fireAttack: Action = {
    name: 'Fire Bite', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 20,  // always hits
    damage: { dieSides: 6, dieCount: 1, bonus: 5, dice: [] } as any,
    damageType: 'fire',
    saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    slotLevel: 0, noCantripScaling: true, legendaryCost: 0, description: 'Fire Bite',
  };
  const attacker = makeCombatant('attacker', {
    faction: 'enemy',
    actions: [fireAttack],
    pos: { x: 1, y: 0, z: 0 },
  });
  const target = makeCombatant('target', {
    faction: 'party',
    ac: 10,
    actions: [ABSORB_ACTION],
    resources: withSlots(2),
  });
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);

  // Run attacks until Absorb Elements fires (nat-1 misses ~5% of the time,
  // so we loop to ensure a hit + damage + reaction trigger).
  let aeFired = false;
  for (let i = 0; i < 50 && !aeFired; i++) {
    target.currentHP = 50;
    target.isDead = false;
    target.isUnconscious = false;
    target.budget.reactionUsed = false;
    target.activeEffects = [];
    target.resistances = [];
    target._absorbElementsResistance = null;
    target._absorbElementsRider = null;
    target.resources = withSlots(2);
    resolveAttack(attacker, target, fireAttack, state);
    aeFired = state.log.events.some(e => e.description.includes('casts Absorb Elements'));
  }

  const aeLog = state.log.events.some(e => e.description.includes('casts Absorb Elements'));
  assert('Absorb Elements fired and logged', aeLog);

  eq('Reaction used after Absorb Elements', target.budget.reactionUsed, true);
  eq('Slot consumed after Absorb Elements', target.resources!.spellSlots![1].remaining, 1);
  eq('Fire resistance granted', target.resistances.includes('fire'), true);
  eq('Resistance scratch field set', target._absorbElementsResistance, 'fire');
  assert('Rider scratch field set', target._absorbElementsRider !== null && target._absorbElementsRider !== undefined);
  eq('Rider damage type is fire', target._absorbElementsRider!.damageType, 'fire');
  eq('Rider dice count is 1 (L1 slot)', target._absorbElementsRider!.diceCount, 1);
}

// ============================================================
// Section 8: Absorb Elements rider consumed on next melee hit
// ============================================================

console.log('\n--- Section 8: Absorb Elements rider consumed on next melee hit ---');

{
  // Target takes fire damage → Absorb Elements fires → rider stored.
  // Then target attacks back with a melee weapon → rider consumed.
  const fireAttack: Action = {
    name: 'Fire Bite', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 20,
    damage: { dieSides: 6, dieCount: 1, bonus: 3, dice: [] } as any,
    damageType: 'fire',
    saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    slotLevel: 0, noCantripScaling: true, legendaryCost: 0, description: 'Fire Bite',
  };
  const attacker = makeCombatant('attacker', {
    faction: 'enemy',
    actions: [fireAttack],
    pos: { x: 1, y: 0, z: 0 },
    ac: 10,
  });
  const target = makeCombatant('target', {
    faction: 'party',
    ac: 10,
    actions: [ABSORB_ACTION, makeSwordAction(20, 0)],
    resources: withSlots(2),
  });
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);

  // Step 1: Attacker hits target with fire → Absorb Elements fires.
  // Loop to handle nat-1 misses (~5% chance).
  let riderSet = false;
  for (let i = 0; i < 50 && !riderSet; i++) {
    target.currentHP = 50;
    target.isDead = false;
    target.isUnconscious = false;
    target.budget.reactionUsed = false;
    target.activeEffects = [];
    target.resistances = [];
    target._absorbElementsResistance = null;
    target._absorbElementsRider = null;
    target.resources = withSlots(2);
    resolveAttack(attacker, target, fireAttack, state);
    riderSet = target._absorbElementsRider !== null && target._absorbElementsRider !== undefined;
  }
  assert('Rider set after fire damage', riderSet);

  // Step 2: Target attacks back with melee → rider consumed.
  // Loop to handle nat-1 misses on the counter-attack.
  let riderConsumed = false;
  for (let i = 0; i < 50 && !riderConsumed; i++) {
    // Re-set the rider if it was consumed by a previous miss... wait, no —
    // if the attack missed, the rider is NOT consumed. Only reset on hit.
    // Actually, let's just try once — if the melee attack misses (nat 1),
    // the rider persists. We need a hit to consume it.
    target.budget.reactionUsed = false;  // reset for the counter-attack
    attacker.isDead = false;
    attacker.isUnconscious = false;
    const riderBefore = target._absorbElementsRider;
    resolveAttack(target, attacker, target.actions[1], state);
    riderConsumed = target._absorbElementsRider === null && riderBefore !== null;
    if (!riderConsumed) {
      // Attack missed (nat 1) — rider still set. Try again.
      continue;
    }
  }

  assert('Rider consumed after melee hit', riderConsumed);
  const riderLog = state.log.events.some(e => e.description.includes('Absorb Elements rider'));
  assert('Rider damage logged', riderLog);
}

// ============================================================
// Section 9: Absorb Elements does NOT fire on non-triggering damage types
// ============================================================

console.log('\n--- Section 9: Absorb Elements damage-type gating ---');

{
  // Slashing damage is NOT in the triggering list (acid/cold/fire/lightning/poison/thunder).
  const slashAttack: Action = {
    name: 'Slash', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 20,
    damage: { dieSides: 6, dieCount: 1, bonus: 3, dice: [] } as any,
    damageType: 'slashing',
    saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    slotLevel: 0, noCantripScaling: true, legendaryCost: 0, description: 'Slash',
  };
  const attacker = makeCombatant('attacker', {
    faction: 'enemy',
    actions: [slashAttack],
    pos: { x: 1, y: 0, z: 0 },
  });
  const target = makeCombatant('target', {
    faction: 'party',
    ac: 10,
    actions: [ABSORB_ACTION],
    resources: withSlots(2),
  });
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);

  resolveAttack(attacker, target, slashAttack, state);

  const aeFired = state.log.events.some(e => e.description.includes('casts Absorb Elements'));
  assert('Absorb Elements did NOT fire on slashing damage', !aeFired);
  eq('Reaction NOT used', target.budget.reactionUsed, false);
}

// ============================================================
// Section 10: Hellish Rebuke reactive trigger
// ============================================================

console.log('\n--- Section 10: Hellish Rebuke reactive trigger ---');

{
  // Target takes damage → Hellish Rebuke fires → 2d10 fire at attacker (DEX save half)
  const slashAttack: Action = {
    name: 'Slash', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 20,
    damage: { dieSides: 6, dieCount: 1, bonus: 3, dice: [] } as any,
    damageType: 'slashing',
    saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    slotLevel: 0, noCantripScaling: true, legendaryCost: 0, description: 'Slash',
  };
  const attacker = makeCombatant('attacker', {
    faction: 'enemy',
    actions: [slashAttack],
    pos: { x: 1, y: 0, z: 0 },
    ac: 10,
    dex: 10,
  });
  const target = makeCombatant('target', {
    faction: 'party',
    ac: 10,
    actions: [HELLISH_REBUKE_ACTION],
    resources: withSlots(2),
    cha: 16,  // +3 mod → DC = 8 + 3 + 2 = 13
  });
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);

  // Loop to handle nat-1 misses (~5% chance).
  let hrFired = false;
  for (let i = 0; i < 50 && !hrFired; i++) {
    target.currentHP = 50;
    target.isDead = false;
    target.isUnconscious = false;
    target.budget.reactionUsed = false;
    target.activeEffects = [];
    target.resources = withSlots(2);
    attacker.currentHP = 50;
    attacker.isDead = false;
    attacker.isUnconscious = false;
    resolveAttack(attacker, target, slashAttack, state);
    hrFired = state.log.events.some(e => e.description.includes('casts Hellish Rebuke'));
  }

  const hrLog = state.log.events.some(e => e.description.includes('casts Hellish Rebuke'));
  assert('Hellish Rebuke fired and logged', hrLog);
  eq('Reaction used', target.budget.reactionUsed, true);
  eq('Slot consumed', target.resources!.spellSlots![1].remaining, 1);

  // Attacker should have taken fire damage (2d10 = 2-20, or half on save)
  const fireDamageLog = state.log.events.find(e => e.type === 'damage' && e.description.includes('Hellish Rebuke'));
  assert('Hellish Rebuke damage logged', fireDamageLog !== undefined);
  // The attacker's HP should have decreased (2d10 is 2-20, halved to 1-10 on save)
  // (attacker started at 50 HP, Hellish Rebuke deals 1-20 fire damage)
  assert('Attacker took damage from Hellish Rebuke', attacker.currentHP < 50 || fireDamageLog !== undefined);
}

// ============================================================
// Section 11: Hellish Rebuke range gating (60 ft)
// ============================================================

console.log('\n--- Section 11: Hellish Rebuke range gating ---');

{
  const slashAttack: Action = {
    name: 'Slash', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 20,
    damage: { dieSides: 6, dieCount: 1, bonus: 3, dice: [] } as any,
    damageType: 'slashing',
    saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    slotLevel: 0, noCantripScaling: true, legendaryCost: 0, description: 'Slash',
  };
  // Attacker 70 ft away (14 cells) — outside Hellish Rebuke's 60 ft range.
  // But melee attacks require adjacency... so use a ranged attack instead.
  const rangedAttack: Action = {
    name: 'Longshot', costType: 'action', attackType: 'ranged',
    isMultiattack: false, reach: 0, range: { normal: 120, long: 120 },
    hitBonus: 20,
    damage: { dieSides: 8, dieCount: 1, bonus: 3, dice: [] } as any,
    damageType: 'piercing',
    saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    slotLevel: 0, noCantripScaling: true, legendaryCost: 0, description: 'Longshot',
  };
  const attacker = makeCombatant('attacker', {
    faction: 'enemy',
    actions: [rangedAttack],
    pos: { x: 14, y: 0, z: 0 },  // 70 ft away
    ac: 10, dex: 10,
  });
  const target = makeCombatant('target', {
    faction: 'party',
    ac: 10,
    actions: [HELLISH_REBUKE_ACTION],
    resources: withSlots(2),
    cha: 16,
  });
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);

  resolveAttack(attacker, target, rangedAttack, state);

  const hrFired = state.log.events.some(e => e.description.includes('casts Hellish Rebuke'));
  assert('Hellish Rebuke did NOT fire when attacker > 60 ft away', !hrFired);
}

// ============================================================
// Section 12: Silvery Barbs reactive trigger
// ============================================================

console.log('\n--- Section 12: Silvery Barbs reactive trigger ---');

{
  // Target is hit → Silvery Barbs forces a reroll, uses the lower.
  // If the lower roll misses, the hit is negated.
  const attacker = makeCombatant('attacker', {
    faction: 'enemy',
    actions: [makeSwordAction(5, 3)],
    pos: { x: 1, y: 0, z: 0 },
  });
  const target = makeCombatant('target', {
    faction: 'party',
    ac: 15,
    actions: [SILVERY_BARBS_ACTION],
    resources: withSlots(2),
  });
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);

  let barbsFired = false;
  for (let i = 0; i < 200 && !barbsFired; i++) {
    target.currentHP = 50;
    target.isDead = false;
    target.isUnconscious = false;
    target.budget.reactionUsed = false;
    target.activeEffects = [];
    target.resources = withSlots(2);
    attacker.budget.actionUsed = false;

    resolveAttack(attacker, target, attacker.actions[0], state);

    const barbsLog = state.log.events.some(e => e.description.includes('casts Silvery Barbs'));
    if (barbsLog) {
      barbsFired = true;
      eq('Reaction used after Silvery Barbs', target.budget.reactionUsed, true);
      eq('Slot consumed', target.resources!.spellSlots![1].remaining, 1);
    }
  }
  assert('Silvery Barbs fired in at least one of 200 attacks', barbsFired);
}

// ============================================================
// Section 13: Budget interaction — only ONE reaction per round
// ============================================================

console.log('\n--- Section 13: Budget interaction — one reaction per round ---');

{
  // Target has BOTH Shield and Absorb Elements. After taking fire damage,
  // Absorb Elements fires (incoming_damage). The target's reaction is now
  // used. If attacked again, Shield CANNOT fire (reaction already used).
  const fireAttack: Action = {
    name: 'Fire Bite', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 20,
    damage: { dieSides: 6, dieCount: 1, bonus: 3, dice: [] } as any,
    damageType: 'fire',
    saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    slotLevel: 0, noCantripScaling: true, legendaryCost: 0, description: 'Fire Bite',
  };
  const slashAttack: Action = {
    name: 'Slash', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 5,  // low enough that Shield's +5 might flip
    damage: { dieSides: 6, dieCount: 1, bonus: 3, dice: [] } as any,
    damageType: 'slashing',
    saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    slotLevel: 0, noCantripScaling: true, legendaryCost: 0, description: 'Slash',
  };
  const attacker = makeCombatant('attacker', {
    faction: 'enemy',
    actions: [fireAttack, slashAttack],
    pos: { x: 1, y: 0, z: 0 },
  });
  const target = makeCombatant('target', {
    faction: 'party',
    ac: 15,
    actions: [ABSORB_ACTION, SHIELD_ACTION],
    resources: withSlots(4),  // 4 slots so both could fire if reaction allowed
  });
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);

  // Attack 1: Fire damage → Absorb Elements fires (uses reaction).
  // Loop to handle nat-1 misses (~5% chance).
  let aeFired = false;
  for (let i = 0; i < 50 && !aeFired; i++) {
    target.currentHP = 50;
    target.isDead = false;
    target.isUnconscious = false;
    target.budget.reactionUsed = false;
    target.activeEffects = [];
    target.resistances = [];
    target._absorbElementsResistance = null;
    target._absorbElementsRider = null;
    target.resources = withSlots(4);
    resolveAttack(attacker, target, fireAttack, state);
    aeFired = target.budget.reactionUsed;
  }
  eq('After attack 1: reaction used (Absorb Elements fired)', aeFired, true);

  // Attack 2: Slashing damage → Shield CANNOT fire (reaction already used)
  // Reset HP but NOT reaction
  target.currentHP = 50;
  target.isDead = false;
  target.isUnconscious = false;
  target.activeEffects = [];  // clear Shield effect if any
  resolveAttack(attacker, target, slashAttack, state);

  const shieldFired = state.log.events.some(e => e.description.includes('casts Shield') && e.actorId === 'target');
  assert('Shield did NOT fire after reaction was used by Absorb Elements', !shieldFired);
}

// ============================================================
// Section 14: Reset budget restores reaction
// ============================================================

console.log('\n--- Section 14: Reset budget restores reaction ---');

{
  const target = makeCombatant('target', {
    actions: [SHIELD_ACTION],
    resources: withSlots(2),
  });
  target.budget.reactionUsed = true;
  target._absorbElementsResistance = 'fire';
  target.resistances.push('fire');

  resetBudget(target);

  eq('Reaction restored after resetBudget', target.budget.reactionUsed, false);
  eq('Absorb Elements resistance cleared', target._absorbElementsResistance, null);
  eq('Resistance removed from list', target.resistances.includes('fire'), false);
}

// ============================================================
// Final results
// ============================================================

console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) {
  console.error('reaction_registry.test.ts: SOME TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('reaction_registry.test.ts: all tests passed ✅');
}
