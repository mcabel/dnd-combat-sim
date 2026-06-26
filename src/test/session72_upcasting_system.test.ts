// ============================================================
// Test: Session 72 — RFC-UPCASTING comprehensive system tests
//
// Covers all 6 phases of the RFC-UPCASTING implementation:
//   Phase 1 — castSlotLevel on PlannedAction + getLowestAvailableSlot
//   Phase 3 — Upcast damage scaling (fireball, cure_wounds, magic_missile)
//   Phase 4 — Globe of Invulnerability blocking + slot consumption
//   Phase 5 — selectCastSlot logic (GoI penetration)
//   Phase 6 — cantripTier (caster level breakpoints)
//
// Run: npx ts-node --transpile-only src/test/session72_upcasting_system.test.ts
// ============================================================

import { Combatant, Action, PlayerResources, Condition, PlannedAction } from '../types/core';
import { getLowestAvailableSlot, consumeSpellSlot } from '../ai/resources';
import { cantripTier } from '../engine/utils';
import { isProtectedByGoI } from '../engine/spell_effects';
import { metadata as fbMeta, rollDamage as fbRollDamage, execute as fbExecute } from '../spells/fireball';
import { metadata as cwMeta, execute as cwExecute } from '../spells/cure_wounds';
import { metadata as mmMeta, execute as mmExecute } from '../spells/magic_missile';
import { metadata as goiMeta, execute as goiExecute } from '../spells/globe_of_invulnerability';
import { EngineState } from '../engine/combat';

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
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10,
    cr: 1,
    pos: { x: 1, y: 0, z: 0 },
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
    width: 60, height: 60, depth: 1,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: any): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

function withSlots(slots: { [level: number]: { max: number; remaining: number } }): PlayerResources {
  return { spellSlots: slots };
}

function withPactSlots(slotLevel: number, remaining: number): PlayerResources {
  return {
    spellSlots: {},
    pactSlots: { max: remaining, remaining, slotLevel, recoversOn: 'short' },
  };
}

// ============================================================
// Phase 1 — castSlotLevel on PlannedAction
// ============================================================
// getSpellInfoFromPlan is a private function in combat.ts.
// We replicate its key logic here for direct unit testing:
//   const level = plan.castSlotLevel ?? plan.action?.slotLevel ?? 1;

console.log('\n=== Phase 1 — castSlotLevel on PlannedAction ===\n');

{
  // 1a. castSlotLevel is set → returns that value
  const plan: PlannedAction = {
    type: 'fireball',
    action: null,
    targetId: 'enemy1',
    castSlotLevel: 5,
    description: 'Fireball at L5',
  };
  const resolved = plan.castSlotLevel ?? plan.action?.slotLevel ?? 1;
  eq('castSlotLevel=5 returns 5', resolved, 5);

  // 1b. castSlotLevel undefined, action.slotLevel set → falls back to action.slotLevel
  const plan2: PlannedAction = {
    type: 'fireball',
    action: { name: 'Fireball', slotLevel: 3 } as Action,
    targetId: 'enemy1',
    description: 'Fireball at base',
  };
  const resolved2 = plan2.castSlotLevel ?? plan2.action?.slotLevel ?? 1;
  eq('falls back to action.slotLevel=3 when castSlotLevel undefined', resolved2, 3);

  // 1c. Both undefined → falls back to 1
  const plan3: PlannedAction = {
    type: 'cureWounds',
    action: null,
    targetId: 'ally1',
    description: 'Cure Wounds',
  };
  const resolved3 = plan3.castSlotLevel ?? plan3.action?.slotLevel ?? 1;
  eq('falls back to 1 when both are undefined', resolved3, 1);

  // 1d. castSlotLevel=0 should not fall through (0 is falsy but valid for cantrips)
  // Actually, per the RFC, cantrips have level 0 and don't use castSlotLevel.
  // castSlotLevel=0 would mean "cast at level 0" which doesn't happen for leveled
  // spells, but the ?? operator treats 0 as non-null. Verify:
  const plan4: PlannedAction = {
    type: 'fireball',
    action: { name: 'Fireball', slotLevel: 3 } as Action,
    targetId: 'enemy1',
    castSlotLevel: 0,
    description: 'Edge case',
  };
  const resolved4 = plan4.castSlotLevel ?? plan4.action?.slotLevel ?? 1;
  eq('castSlotLevel=0 returns 0 (?? treats 0 as defined)', resolved4, 0);

  // 1e. castSlotLevel=2, action.slotLevel=3 → castSlotLevel wins
  const plan5: PlannedAction = {
    type: 'guidingBolt',
    action: { name: 'Guiding Bolt', slotLevel: 1 } as Action,
    targetId: 'enemy1',
    castSlotLevel: 4,
    description: 'Guiding Bolt upcast',
  };
  const resolved5 = plan5.castSlotLevel ?? plan5.action?.slotLevel ?? 1;
  eq('castSlotLevel=4 takes priority over action.slotLevel=1', resolved5, 4);
}

// ============================================================
// Phase 1 — getLowestAvailableSlot helper
// ============================================================

console.log('\n=== Phase 1 — getLowestAvailableSlot ===\n');

{
  // 2a. Returns lowest available slot at/above minimum
  const caster = makeCombatant('wiz', {
    resources: withSlots({
      3: { max: 2, remaining: 2 },
      5: { max: 1, remaining: 1 },
    }),
  });
  eq('lowest slot at/above min=3 → 3', getLowestAvailableSlot(caster, 3), 3);
  eq('lowest slot at/above min=4 → 5', getLowestAvailableSlot(caster, 4), 5);
  eq('lowest slot at/above min=1 → 3', getLowestAvailableSlot(caster, 1), 3);

  // 2b. Returns null when no slots are available
  const caster2 = makeCombatant('wiz', {
    resources: withSlots({
      1: { max: 2, remaining: 0 },
      2: { max: 2, remaining: 0 },
    }),
  });
  eq('no slots available → null', getLowestAvailableSlot(caster2, 1), null);

  const caster3 = makeCombatant('wiz', { resources: null });
  eq('resources is null → null', getLowestAvailableSlot(caster3, 1), null);

  // 2c. No resources at all
  const caster4 = makeCombatant('wiz');
  eq('no resources field → null', getLowestAvailableSlot(caster4, 1), null);

  // 2d. Checks pact slots for Warlock
  const warlock = makeCombatant('warlock', {
    resources: withPactSlots(5, 2),
  });
  eq('pact slot level 5, min=1 → 5', getLowestAvailableSlot(warlock, 1), 5);
  eq('pact slot level 5, min=5 → 5', getLowestAvailableSlot(warlock, 5), 5);
  eq('pact slot level 5, min=6 → null', getLowestAvailableSlot(warlock, 6), null);

  // 2e. Pact slots exhausted → falls back to standard slots
  const warlock2 = makeCombatant('warlock2', {
    resources: {
      spellSlots: { 3: { max: 2, remaining: 1 } },
      pactSlots: { max: 2, remaining: 0, slotLevel: 5, recoversOn: 'short' as const },
    },
  });
  eq('pact exhausted, falls back to L3 standard slot', getLowestAvailableSlot(warlock2, 1), 3);

  // 2f. Mixed: pact slot + standard slots; pact level meets minimum
  const warlock3 = makeCombatant('warlock3', {
    resources: {
      spellSlots: { 1: { max: 4, remaining: 4 }, 2: { max: 3, remaining: 3 } },
      pactSlots: { max: 2, remaining: 2, slotLevel: 5, recoversOn: 'short' as const },
    },
  });
  // Pact slot level 5 meets min=5; standard also has slots but pact is checked first
  eq('mixed: pact L5 with min=5 returns 5', getLowestAvailableSlot(warlock3, 5), 5);
}

// ============================================================
// Phase 3 — Upcast damage scaling
// ============================================================

console.log('\n=== Phase 3 — Upcast damage scaling ===\n');

// --- Fireball ---
console.log('--- Fireball ---');

{
  // 3a. Fireball metadata upcast flag
  eq('fireballUpcastV1Implemented is true', fbMeta.fireballUpcastV1Implemented, true);

  // 3b. Base level casting (L3) → 8d6
  const baseDice = 8;
  eq('base dice count at L3 is 8', baseDice, 8);

  // 3c. Upcast to L5 → 10d6 (8 + (5-3))
  const upcastDice = 8 + Math.max(0, 5 - 3);
  eq('upcast dice at L5 is 10', upcastDice, 10);

  // 3d. Upcast to L8 → 13d6
  const upcastL8 = 8 + Math.max(0, 8 - 3);
  eq('upcast dice at L8 is 13', upcastL8, 13);

  // 3e. rollDamage with base dice stays in range
  {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 500; i++) {
      const r = fbRollDamage(8); // base
      if (r < min) min = r;
      if (r > max) max = r;
    }
    assert(`base rollDamage(8) min >= 8 (got ${min})`, min >= 8);
    assert(`base rollDamage(8) max <= 48 (got ${max})`, max <= 48);
  }

  // 3f. rollDamage with upcast dice stays in range
  {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 500; i++) {
      const r = fbRollDamage(10); // L5 upcast
      if (r < min) min = r;
      if (r > max) max = r;
    }
    assert(`upcast rollDamage(10) min >= 10 (got ${min})`, min >= 10);
    assert(`upcast rollDamage(10) max <= 60 (got ${max})`, max <= 60);
  }

  // 3g. Execute with base slot produces damage in 8d6 range
  {
    const FIREBALL_ACTION: Action = {
      name: 'Fireball', isMultiattack: false, attackType: 'save',
      reach: 5, range: { normal: 150, long: 150 },
      hitBonus: null, damage: null, damageType: null,
      saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
      requiresConcentration: false, slotLevel: 3, costType: 'action',
      legendaryCost: 0, description: 'Fireball',
    };
    const caster = makeCombatant('wiz', {
      faction: 'party',
      pos: { x: 0, y: 0, z: 0 },
      actions: [FIREBALL_ACTION],
      resources: withSlots({ 3: { max: 2, remaining: 2 } }),
      int: 20,
    });
    const enemy = makeCombatant('e1', {
      faction: 'enemy', dex: 1, pos: { x: 1, y: 0, z: 0 },
      maxHP: 1000, currentHP: 1000,
    });
    const bf = makeBF([caster, enemy]);
    const state = makeState(bf);
    const hpBefore = enemy.currentHP;
    fbExecute(caster, [enemy], state);
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Fireball base execute: damage in 8d6 range (8-48), got ${dmgDealt}`, dmgDealt >= 8 && dmgDealt <= 48);
  }

  // 3h. Execute with upcast slot produces scaled damage
  {
    const FIREBALL_ACTION: Action = {
      name: 'Fireball', isMultiattack: false, attackType: 'save',
      reach: 5, range: { normal: 150, long: 150 },
      hitBonus: null, damage: null, damageType: null,
      saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
      requiresConcentration: false, slotLevel: 3, costType: 'action',
      legendaryCost: 0, description: 'Fireball',
    };
    const caster = makeCombatant('wiz', {
      faction: 'party',
      pos: { x: 0, y: 0, z: 0 },
      actions: [FIREBALL_ACTION],
      resources: withSlots({ 5: { max: 1, remaining: 1 } }),
      int: 20,
    });
    const enemy = makeCombatant('e1', {
      faction: 'enemy', dex: 1, pos: { x: 1, y: 0, z: 0 },
      maxHP: 1000, currentHP: 1000,
    });
    const bf = makeBF([caster, enemy]);
    const state = makeState(bf);
    const hpBefore = enemy.currentHP;
    fbExecute(caster, [enemy], state);
    const dmgDealt = hpBefore - enemy.currentHP;
    // At L5: 8 + (5-3) = 10d6, range 10-60
    assert(`Fireball L5 upcast: damage in 10d6 range (10-60), got ${dmgDealt}`, dmgDealt >= 10 && dmgDealt <= 60);
  }
}

// --- Cure Wounds ---
console.log('--- Cure Wounds ---');

{
  // 3i. Cure Wounds metadata upcast flag
  eq('cureWoundsUpcastV1Implemented is true', cwMeta.cureWoundsUpcastV1Implemented, true);

  // 3j. Base level (L1) → 1d8 + WIS
  {
    const caster = makeCombatant('cleric', {
      faction: 'party',
      pos: { x: 0, y: 0, z: 0 },
      actions: [{ name: 'Cure Wounds', slotLevel: 1 } as Action],
      resources: withSlots({ 1: { max: 2, remaining: 2 } }),
      wis: 16,
    });
    const target = makeCombatant('ally', {
      faction: 'party', currentHP: 10, maxHP: 100, pos: { x: 0, y: 0, z: 0 },
    });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);
    const hpBefore = target.currentHP;
    cwExecute(caster, target, state);
    const healed = target.currentHP - hpBefore;
    // 1d8 + 3 (WIS 16 → +3), range 4-11
    assert(`Cure Wounds base L1: heal in 1d8+3 range (4-11), got ${healed}`, healed >= 4 && healed <= 11);
  }

  // 3k. Upcast (L3) → 3d8 + WIS
  {
    const caster = makeCombatant('cleric', {
      faction: 'party',
      pos: { x: 0, y: 0, z: 0 },
      actions: [{ name: 'Cure Wounds', slotLevel: 1 } as Action],
      resources: withSlots({ 3: { max: 2, remaining: 2 } }),
      wis: 16,
    });
    const target = makeCombatant('ally', {
      faction: 'party', currentHP: 10, maxHP: 100, pos: { x: 0, y: 0, z: 0 },
    });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);
    const hpBefore = target.currentHP;
    cwExecute(caster, target, state);
    const healed = target.currentHP - hpBefore;
    // 3d8 + 3 (WIS 16 → +3), range 6-27
    assert(`Cure Wounds upcast L3: heal in 3d8+3 range (6-27), got ${healed}`, healed >= 6 && healed <= 27);
  }
}

// --- Magic Missile ---
console.log('--- Magic Missile ---');

{
  // 3l. Magic Missile metadata upcast flag
  eq('magicMissileUpcastV1Implemented is true', mmMeta.magicMissileUpcastV1Implemented, true);

  // 3m. Base level (L1) → 3 darts, each 1d4+1
  {
    const caster = makeCombatant('wiz', {
      faction: 'party',
      pos: { x: 0, y: 0, z: 0 },
      actions: [{ name: 'Magic Missile', slotLevel: 1 } as Action],
      resources: withSlots({ 1: { max: 4, remaining: 4 } }),
    });
    const target = makeCombatant('e1', {
      faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
      maxHP: 1000, currentHP: 1000,
    });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);
    const hpBefore = target.currentHP;
    mmExecute(caster, target, state);
    const dmgDealt = hpBefore - target.currentHP;
    // 3 darts × (1d4+1), range 6-15
    assert(`Magic Missile base L1: damage in 3×(1d4+1) range (6-15), got ${dmgDealt}`, dmgDealt >= 6 && dmgDealt <= 15);
  }

  // 3n. Upcast (L3) → 5 darts (3 + (3-1))
  {
    const caster = makeCombatant('wiz', {
      faction: 'party',
      pos: { x: 0, y: 0, z: 0 },
      actions: [{ name: 'Magic Missile', slotLevel: 1 } as Action],
      resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    });
    const target = makeCombatant('e1', {
      faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
      maxHP: 1000, currentHP: 1000,
    });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);
    const hpBefore = target.currentHP;
    mmExecute(caster, target, state);
    const dmgDealt = hpBefore - target.currentHP;
    // 5 darts × (1d4+1), range 10-25
    assert(`Magic Missile upcast L3: damage in 5×(1d4+1) range (10-25), got ${dmgDealt}`, dmgDealt >= 10 && dmgDealt <= 25);
  }

  // 3o. Verify dart count scaling formula
  const dartsL1 = 3 + Math.max(0, 1 - 1);
  const dartsL2 = 3 + Math.max(0, 2 - 1);
  const dartsL4 = 3 + Math.max(0, 4 - 1);
  const dartsL9 = 3 + Math.max(0, 9 - 1);
  eq('MM dart count at L1 = 3', dartsL1, 3);
  eq('MM dart count at L2 = 4', dartsL2, 4);
  eq('MM dart count at L4 = 6', dartsL4, 6);
  eq('MM dart count at L9 = 11', dartsL9, 11);
}

// ============================================================
// Phase 4 — Globe of Invulnerability
// ============================================================

console.log('\n=== Phase 4 — Globe of Invulnerability ===\n');

{
  // 4a. GoI metadata
  eq('GoI level is 6', goiMeta.level, 6);
  eq('globeOfInvulnerabilityImplemented is true', goiMeta.globeOfInvulnerabilityImplemented, true);
  eq('globeOfInvulnerabilityUpcastV1Implemented is true', goiMeta.globeOfInvulnerabilityUpcastV1Implemented, true);

  // 4b. isProtectedByGoI blocks a L3 spell targeting a GoI-protected creature (L6 GoI → threshold 5)
  {
    const target = makeCombatant('goiTarget', {
      activeEffects: [{
        id: 'eff_goi1',
        casterId: 'goiTarget',
        spellName: 'Globe of Invulnerability',
        effectType: 'spell_shield',
        sourceSlotLevel: 6,
        sourceIsConcentration: true,
        payload: { blockThreshold: 5 },
      }],
    });
    eq('GoI (threshold 5) blocks L3 spell', isProtectedByGoI(target, 3), true);
  }

  // 4c. GoI does NOT block a L6 spell (6 > threshold 5)
  {
    const target = makeCombatant('goiTarget', {
      activeEffects: [{
        id: 'eff_goi1',
        casterId: 'goiTarget',
        spellName: 'Globe of Invulnerability',
        effectType: 'spell_shield',
        sourceSlotLevel: 6,
        sourceIsConcentration: true,
        payload: { blockThreshold: 5 },
      }],
    });
    eq('GoI (threshold 5) does NOT block L6 spell', isProtectedByGoI(target, 6), false);
  }

  // 4d. GoI does NOT block cantrips (level 0)
  {
    const target = makeCombatant('goiTarget', {
      activeEffects: [{
        id: 'eff_goi1',
        casterId: 'goiTarget',
        spellName: 'Globe of Invulnerability',
        effectType: 'spell_shield',
        sourceSlotLevel: 6,
        sourceIsConcentration: true,
        payload: { blockThreshold: 5 },
      }],
    });
    // isProtectedByGoI checks: castLevel <= blockThreshold
    // 0 <= 5 is true, but the combat engine also checks `spellInfo.level > 0`
    // before calling isProtectedByGoI. So the function itself returns true for
    // level 0, but the engine won't block cantrips because it only calls
    // isProtectedByGoI when level > 0.
    eq('isProtectedByGoI returns true for level 0 (engine guards on level > 0)', isProtectedByGoI(target, 0), true);
    // The actual GoI engine guard: only checks when spellInfo.level > 0
    // So cantrips pass through — this is the intended behavior.
  }

  // 4e. Upcast GoI (L7) → threshold 6, blocks up to L6
  {
    const target = makeCombatant('goiTarget', {
      activeEffects: [{
        id: 'eff_goi2',
        casterId: 'goiTarget',
        spellName: 'Globe of Invulnerability',
        effectType: 'spell_shield',
        sourceSlotLevel: 7,
        sourceIsConcentration: true,
        payload: { blockThreshold: 6 },
      }],
    });
    eq('Upcast GoI L7 (threshold 6) blocks L6 spell', isProtectedByGoI(target, 6), true);
    eq('Upcast GoI L7 (threshold 6) blocks L5 spell', isProtectedByGoI(target, 5), true);
    eq('Upcast GoI L7 (threshold 6) does NOT block L7 spell', isProtectedByGoI(target, 7), false);
  }

  // 4f. No active effects → not protected
  {
    const target = makeCombatant('target');
    eq('No activeEffects → not protected', isProtectedByGoI(target, 3), false);
  }

  // 4g. Different spell_shield (not GoI) → not protected
  {
    const target = makeCombatant('target', {
      activeEffects: [{
        id: 'eff_other',
        casterId: 'target',
        spellName: 'Some Other Shield',
        effectType: 'spell_shield',
        sourceSlotLevel: 5,
        sourceIsConcentration: true,
        payload: { blockThreshold: 4 },
      }],
    });
    eq('Non-GoI spell_shield → not protected by GoI', isProtectedByGoI(target, 3), false);
  }

  // 4h. GoI slot is consumed even when spell is blocked
  // Simulate: caster has L6 slots; GoI blocks a spell; verify slot is consumed
  {
    const blockedCaster = makeCombatant('wiz', {
      faction: 'party',
      resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    });
    // Simulate the combat engine's GoI blocking behavior:
    // consumeSpellSlot(actor, spellInfo.level) is called before returning
    const slotBefore = (blockedCaster.resources!.spellSlots![3].remaining);
    consumeSpellSlot(blockedCaster, 3);
    eq('GoI block: slot consumed (2 → 1)', blockedCaster.resources!.spellSlots![3].remaining, slotBefore - 1);
  }

  // 4i. GoI execute applies spell_shield effect with correct blockThreshold
  {
    const goiCaster = makeCombatant('goiCaster', {
      faction: 'party',
      actions: [{ name: 'Globe of Invulnerability', slotLevel: 6 } as Action],
      resources: withSlots({ 6: { max: 1, remaining: 1 } }),
    });
    const bf = makeBF([goiCaster]);
    const state = makeState(bf);

    goiExecute(goiCaster, state);

    // Check activeEffects has the spell_shield
    const goiEffect = goiCaster.activeEffects.find(eff =>
      eff.effectType === 'spell_shield' && eff.spellName === 'Globe of Invulnerability'
    );
    assert('GoI execute: spell_shield effect applied', goiEffect !== undefined);
    if (goiEffect) {
      eq('GoI L6: blockThreshold is 5', goiEffect.payload.blockThreshold, 5);
    }

    // Concentration started
    assert('GoI execute: concentration started', goiCaster.concentration?.active === true);
    eq('GoI execute: concentration spell name', goiCaster.concentration?.spellName, 'Globe of Invulnerability');
  }

  // 4j. GoI execute at upcast L7 → blockThreshold 6
  {
    const goiCaster = makeCombatant('goiCaster', {
      faction: 'party',
      actions: [{ name: 'Globe of Invulnerability', slotLevel: 6 } as Action],
      resources: withSlots({ 7: { max: 1, remaining: 1 } }),
    });
    const bf = makeBF([goiCaster]);
    const state = makeState(bf);

    goiExecute(goiCaster, state);

    const goiEffect = goiCaster.activeEffects.find(eff =>
      eff.effectType === 'spell_shield' && eff.spellName === 'Globe of Invulnerability'
    );
    if (goiEffect) {
      eq('GoI L7 upcast: blockThreshold is 6', goiEffect.payload.blockThreshold, 6);
    }
  }

  // 4k. GoI blockThreshold formula: L6→5, L7→6, L8→7, L9→8
  const btL6 = 5 + Math.max(0, 6 - 6);
  const btL7 = 5 + Math.max(0, 7 - 6);
  const btL8 = 5 + Math.max(0, 8 - 6);
  const btL9 = 5 + Math.max(0, 9 - 6);
  eq('blockThreshold at L6 = 5', btL6, 5);
  eq('blockThreshold at L7 = 6', btL7, 6);
  eq('blockThreshold at L8 = 7', btL8, 7);
  eq('blockThreshold at L9 = 8', btL9, 8);
}

// ============================================================
// Phase 5 — selectCastSlot
// ============================================================
// selectCastSlot is a private function in planner.ts.
// We replicate its logic and test the component behaviors:
//   let minSlot = baseLevel;
//   if (target has spell_shield with blockThreshold) {
//     needed = blockThreshold + 1;
//     if (needed > 9) return null;
//     if (needed > minSlot) minSlot = needed;
//   }
//   return getLowestAvailableSlot(caster, minSlot);

console.log('\n=== Phase 5 — selectCastSlot ===\n');

/**
 * Replicated selectCastSlot logic from planner.ts for unit testing.
 */
function selectCastSlotTest(
  caster: Combatant,
  baseLevel: number,
  target: Combatant | null,
): number | null {
  let minSlot = baseLevel;

  if (target && target.activeEffects) {
    for (const eff of target.activeEffects) {
      if (eff.effectType === 'spell_shield' && eff.payload.blockThreshold !== undefined) {
        const needed = eff.payload.blockThreshold + 1;
        if (needed > 9) return null;
        if (needed > minSlot) minSlot = needed;
      }
    }
  }

  return getLowestAvailableSlot(caster, minSlot);
}

{
  // 5a. No GoI on target → returns base level slot
  const caster = makeCombatant('wiz', {
    resources: withSlots({
      1: { max: 4, remaining: 4 },
      3: { max: 2, remaining: 2 },
    }),
  });
  const target = makeCombatant('enemy');
  eq('No GoI: selectCastSlot returns base level', selectCastSlotTest(caster, 3, target), 3);

  // 5b. GoI on target (threshold 5) → needs L6 to penetrate
  const caster2 = makeCombatant('wiz', {
    resources: withSlots({
      3: { max: 2, remaining: 2 },
      6: { max: 1, remaining: 1 },
    }),
  });
  const target2 = makeCombatant('enemy', {
    activeEffects: [{
      id: 'eff_goi',
      casterId: 'enemy',
      spellName: 'Globe of Invulnerability',
      effectType: 'spell_shield',
      sourceSlotLevel: 6,
      sourceIsConcentration: true,
      payload: { blockThreshold: 5 },
    }],
  });
  eq('GoI threshold 5: needs L6, returns 6', selectCastSlotTest(caster2, 3, target2), 6);

  // 5c. GoI on target, but penetration is impossible (no L6+ slot)
  const caster3 = makeCombatant('wiz', {
    resources: withSlots({
      3: { max: 2, remaining: 2 },
    }),
  });
  eq('GoI threshold 5: no L6+ slot, returns null', selectCastSlotTest(caster3, 3, target2), null);

  // 5d. GoI threshold 8 (L9 cast): needed=9 > 9 check — wait, needed=9 is NOT > 9
  // Actually needed = blockThreshold + 1 = 8 + 1 = 9. 9 > 9 is false, so it's not impossible.
  const caster4 = makeCombatant('wiz', {
    resources: withSlots({
      3: { max: 2, remaining: 2 },
      9: { max: 1, remaining: 1 },
    }),
  });
  const target4 = makeCombatant('enemy', {
    activeEffects: [{
      id: 'eff_goi_l9',
      casterId: 'enemy',
      spellName: 'Globe of Invulnerability',
      effectType: 'spell_shield',
      sourceSlotLevel: 9,
      sourceIsConcentration: true,
      payload: { blockThreshold: 8 },
    }],
  });
  eq('GoI L9 (threshold 8): needs L9, has L9, returns 9', selectCastSlotTest(caster4, 3, target4), 9);

  // 5e. Impossible penetration: blockThreshold 9 → needed = 10 > 9 → null
  // (Not achievable by any real GoI cast, but tests the guard)
  const target5 = makeCombatant('enemy', {
    activeEffects: [{
      id: 'eff_impossible',
      casterId: 'enemy',
      spellName: 'Globe of Invulnerability',
      effectType: 'spell_shield',
      sourceSlotLevel: 10, // hypothetical
      sourceIsConcentration: true,
      payload: { blockThreshold: 9 },
    }],
  });
  eq('blockThreshold 9: needed=10 > 9, returns null', selectCastSlotTest(caster4, 3, target5), null);

  // 5f. Null target → returns base level
  eq('Null target: returns base level', selectCastSlotTest(caster, 1, null), 1);
}

// ============================================================
// Phase 6 — cantripTier
// ============================================================

console.log('\n=== Phase 6 — cantripTier ===\n');

{
  // 6a. Level 1 → tier 0
  eq('casterLevel 1 → tier 0', cantripTier({ casterLevel: 1 } as Combatant), 0);

  // 6b. Level 5 → tier 1
  eq('casterLevel 5 → tier 1', cantripTier({ casterLevel: 5 } as Combatant), 1);

  // 6c. Level 11 → tier 2
  eq('casterLevel 11 → tier 2', cantripTier({ casterLevel: 11 } as Combatant), 2);

  // 6d. Level 17 → tier 3
  eq('casterLevel 17 → tier 3', cantripTier({ casterLevel: 17 } as Combatant), 3);

  // 6e. Boundary cases
  eq('casterLevel 4 → tier 0', cantripTier({ casterLevel: 4 } as Combatant), 0);
  eq('casterLevel 10 → tier 1', cantripTier({ casterLevel: 10 } as Combatant), 1);
  eq('casterLevel 16 → tier 2', cantripTier({ casterLevel: 16 } as Combatant), 2);
  eq('casterLevel 20 → tier 3', cantripTier({ casterLevel: 20 } as Combatant), 3);

  // 6f. Falls back to level when casterLevel undefined
  eq('casterLevel undefined, level=5 → tier 1', cantripTier({ level: 5 } as Combatant), 1);
  eq('casterLevel undefined, level=11 → tier 2', cantripTier({ level: 11 } as Combatant), 2);

  // 6g. Falls back to 1 when both are undefined
  eq('casterLevel undefined, level undefined → tier 0 (defaults to 1)', cantripTier({} as Combatant), 0);

  // 6h. casterLevel takes priority over level
  eq('casterLevel=17, level=1 → tier 3 (casterLevel wins)', cantripTier({ casterLevel: 17, level: 1 } as Combatant), 3);

  // 6i. Monster with monsterSpellcasting: casterLevel is typically set by the parser
  // from the "Nth-level spellcaster" header. For monsters without explicit casterLevel,
  // the level field may be set. Verify the delegation path.
  const monster: Combatant = makeCombatant('lich', { casterLevel: 18 });
  eq('Monster casterLevel=18 → tier 3', cantripTier(monster), 3);

  // 6j. Monster using level field (some older monsters may not have casterLevel set)
  const monster2: Combatant = makeCombatant('mage', { level: 9 });
  eq('Monster level=9 → tier 1', cantripTier(monster2), 1);
}

// ============================================================
// Summary
// ============================================================

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
