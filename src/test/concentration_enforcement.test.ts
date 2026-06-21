// ============================================================
// Test: Concentration Enforcement (TG-002)
// PHB p.203: "When you take damage while you are concentrating on a spell,
//   you must make a Constitution saving throw to maintain your concentration.
//   The DC equals 10 or half the damage you take, whichever number is higher."
//
// This test exercises the FULL pipeline that production code uses:
//   1. `resolveAttack` (sites A/B/C in combat.ts) — save-spell, auto-hit,
//      and standard-attack damage all call `rollConcentrationSave` after
//      applying damage, then `removeEffectsFromCaster` on a failed save.
//   2. Manual simulation of the zone-tick damage step (site D) and the
//      moving-zone damage step (site E) — both call the same helpers.
//   3. `rollConcentrationSave` is verified directly for DC computation,
//      edge cases (not concentrating, dead, unconscious), and the
//      cleanup pipeline (effect removal, summon despawn).
//
// Determinism strategy:
//   - "Concentration breaks" tests use damage high enough that DC exceeds
//     the maximum possible d20 + CON mod (DC ≥ 21 with CON ≤ 0). The save
//     roll is still random, but the outcome is deterministic (always fails).
//   - "Concentration maintained" tests use statistical assertions over 100
//     iterations with a wide acceptable range (e.g., ≥ 70% success).
//   - "DC computation" tests call `rollConcentrationSave` directly with
//     damage values that fix the DC, and verify the success-rate threshold
//     matches the expected DC.
//
// Run: npx ts-node src/test/concentration_enforcement.test.ts
// ============================================================

import {
  resolveAttack,
  makeFlatBattlefield,
  CombatEvent,
} from '../engine/combat';
import { EngineState } from '../engine/combat';
import {
  startConcentration,
  breakConcentration,
  rollConcentrationSave,
  applyDamageWithTempHP,
} from '../engine/utils';
import {
  applySpellEffect,
  removeEffectsFromCaster,
  _resetEffectIdCounter,
} from '../engine/spell_effects';
import { Combatant, Action, PlayerResources, Battlefield, ActiveEffect } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(o: Partial<Combatant> = {}): Combatant {
  _id++;
  const id = o.id ?? `c${_id}`;
  return {
    id,
    name: o.name ?? id,
    isPlayer: false,
    faction: 'party',
    maxHP: 100,
    currentHP: 100,
    ac: 10,
    speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false,
              reactionUsed: false, freeObjectUsed: false },
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
    bardicInspirationDie: null, wardingBond: null,
    activeEffects: [],
    ...o,
  };
}

function makeBF(combatants: Combatant[]): Battlefield {
  return makeFlatBattlefield(20, 20, combatants);
}

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

// A high-damage standard-attack action (1d100+50 slashing; average 100, max 150).
// DC = max(10, half damage) = 50-75, which exceeds any possible d20 + CON mod
// for CON ≤ 5 (+2). Deterministic concentration break.
const BIG_HIT: Action = {
  name: 'Greataxe',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: null,
  hitBonus: 20,           // guaranteed hit (1d20+20 vs AC 10)
  damage: { count: 4, sides: 12, bonus: 50, average: 76 },
  damageType: 'slashing',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  costType: 'action',
  legendaryCost: 0,
  description: 'Greataxe',
};

// A small-damage standard-attack action (1d4+1 slashing; average 3.5).
// DC = max(10, half damage) = 10 (since 1d4/2 = 0..2). DC is always 10.
// Use this for "concentration maintained" statistical tests.
const LIGHT_HIT: Action = {
  name: 'Dagger',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: null,
  hitBonus: 20,
  damage: { count: 1, sides: 4, bonus: 1, average: 3 },
  damageType: 'piercing',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  costType: 'action',
  legendaryCost: 0,
  description: 'Dagger',
};

// Auto-hit action (Magic Missile style) — hitBonus: null triggers the
// auto-hit branch in resolveAttack. 1d4+50 force → deterministic break.
const AUTO_HIT: Action = {
  name: 'Magic Missile',
  isMultiattack: false,
  attackType: 'spell',
  reach: 0,
  range: { normal: 120, long: 120 },
  hitBonus: null,         // auto-hit branch
  damage: { count: 1, sides: 4, bonus: 50, average: 52 },
  damageType: 'force',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  costType: 'action',
  legendaryCost: 0,
  description: 'Magic Missile',
};

// Save-spell action (DC 30 CON save → guaranteed fail; 4d12+50 fire = 52-98
// damage → DC = 26-49, deterministic break).
const SAVE_SPELL: Action = {
  name: 'Fireball',
  isMultiattack: false,
  attackType: 'spell',
  reach: 0,
  range: { normal: 120, long: 120 },
  hitBonus: null,
  damage: { count: 4, sides: 12, bonus: 50, average: 76 },
  damageType: 'fire',
  saveDC: 30,             // guaranteed save fail (max d20+mod < 30)
  saveAbility: 'dex',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  costType: 'action',
  legendaryCost: 0,
  description: 'Fireball',
};

/** Apply a concentration-sourced effect to `target` from `casterId`. */
function attachEffect(
  target: Combatant,
  casterId: string,
  spellName: string,
  effectType: any,
  payload: any = {},
): ActiveEffect {
  return applySpellEffect(target, {
    casterId,
    spellName,
    effectType,
    payload,
    sourceIsConcentration: true,
  });
}

/** Reset module state between test sections. */
function reset(): void {
  _resetEffectIdCounter();
}

// ============================================================
// Section 1: Standard attack damage → concentration break (deterministic)
// ============================================================
console.log('\n=== 1. Standard attack damage → concentration break (deterministic) ===\n');
reset();
{
  // Caster is concentrating on Hold Person, with an active condition_apply
  // effect on themselves (self-buff concentration like Barkskin).
  const caster = makeC({
    id: 'wiz',
    name: 'Wizard',
    con: 10,           // +0 CON mod
    pos: { x: 5, y: 5, z: 0 },
  });
  startConcentration(caster, 'Hold Person');
  // Attach a self-sourced condition effect so we can verify cleanup.
  attachEffect(caster, caster.id, 'Hold Person', 'condition_apply', { condition: 'restrained' as any });
  eq('Effect attached before attack', caster.activeEffects.length, 1);
  eq('Concentration active before attack', caster.concentration?.active, true);

  const attacker = makeC({
    id: 'barb',
    name: 'Barbarian',
    pos: { x: 6, y: 5, z: 0 },
  });

  const bf = makeBF([caster, attacker]);
  const state = makeState(bf);

  resolveAttack(attacker, caster, BIG_HIT, state, true /* force hit */);

  // Force-hit + damage 54-98 → DC = 27-49 (>> 20 + 0 CON = 20) → always fails.
  assert('1a. Concentration broken after big hit', caster.concentration === null,
    `concentration = ${JSON.stringify(caster.concentration)}`);
  assert('1b. ActiveEffects cleaned up on break', caster.activeEffects.length === 0,
    `effects = ${caster.activeEffects.length}`);

  // 1c. A "condition_remove" event should be logged for the concentration break.
  const removeEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'condition_remove' && e.description.includes('concentration'),
  );
  assert('1c. condition_remove event logged', removeEvent !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);

  // 1d. Restrained condition removed (since the effect that applied it was
  // concentration-sourced and got cleaned up).
  assert('1d. Restrained condition removed', !caster.conditions.has('restrained' as any));
}

// ============================================================
// Section 2: Standard attack damage → concentration maintained (statistical)
// ============================================================
console.log('\n=== 2. Standard attack damage → concentration maintained (statistical) ===\n');
reset();
{
  // CON 20 (+5) vs DC 10 (light hit damage 2-5, half = 1-2, max(10, ...) = 10).
  // Need 5+ on d20 → 16/20 = 80% success.
  let maintainedCount = 0;
  const N = 100;
  for (let i = 0; i < N; i++) {
    const caster = makeC({
      id: `wiz${i}`,
      name: `wiz${i}`,
      con: 20,
      pos: { x: 5, y: 5, z: 0 },
    });
    startConcentration(caster, 'Bless');
    const attacker = makeC({
      id: `barb${i}`,
      name: `barb${i}`,
      pos: { x: 6, y: 5, z: 0 },
    });
    const bf = makeBF([caster, attacker]);
    const state = makeState(bf);

    resolveAttack(attacker, caster, LIGHT_HIT, state, true);

    if (caster.concentration?.active === true) maintainedCount++;
  }
  // 80% expected, allow wide range (≥ 65%) to avoid flakiness.
  assert(`2a. CON+5 vs DC 10 mostly maintained (${maintainedCount}/${N})`,
    maintainedCount >= 65, `maintained=${maintainedCount}/${N}`);
}

// ============================================================
// Section 3: Save-spell damage → concentration break
// ============================================================
console.log('\n=== 3. Save-spell damage → concentration break ===\n');
reset();
{
  const caster = makeC({
    id: 'wiz',
    name: 'Wizard',
    dex: 20,           // +5 DEX (still fails DC 30)
    con: 10,
    pos: { x: 5, y: 5, z: 0 },
  });
  startConcentration(caster, 'Hex');
  attachEffect(caster, caster.id, 'Hex', 'hex_damage', { hexDie: 6 });
  eq('Effect attached before fireball', caster.activeEffects.length, 1);

  const attacker = makeC({
    id: 'sorcerer',
    name: 'Sorcerer',
    pos: { x: 6, y: 5, z: 0 },
  });

  const bf = makeBF([caster, attacker]);
  const state = makeState(bf);

  resolveAttack(attacker, caster, SAVE_SPELL, state, true);

  // DC 30 save fails; damage 54-98 → DC = 27-49 → concentration breaks.
  assert('3a. Concentration broken after fireball save-fail', caster.concentration === null);
  assert('3b. ActiveEffects cleaned up on break', caster.activeEffects.length === 0);
}

// ============================================================
// Section 4: Auto-hit damage → concentration break (Magic Missile style)
// ============================================================
console.log('\n=== 4. Auto-hit damage → concentration break ===\n');
reset();
{
  const caster = makeC({
    id: 'wiz',
    name: 'Wizard',
    con: 10,
    pos: { x: 5, y: 5, z: 0 },
  });
  startConcentration(caster, 'Mage Armor');
  attachEffect(caster, caster.id, 'Mage Armor', 'ac_bonus', { acBonus: 3 });

  const attacker = makeC({
    id: 'warlock',
    name: 'Warlock',
    pos: { x: 6, y: 5, z: 0 },
  });

  const bf = makeBF([caster, attacker]);
  const state = makeState(bf);

  resolveAttack(attacker, caster, AUTO_HIT, state);

  // Auto-hit branch: hitBonus=null → no d20 attack roll, damage applies directly.
  // Damage 51-54 → DC = 25-27 → concentration breaks.
  assert('4a. Concentration broken after auto-hit', caster.concentration === null,
    `concentration = ${JSON.stringify(caster.concentration)}`);
  assert('4b. ActiveEffects cleaned up on break', caster.activeEffects.length === 0);
}

// ============================================================
// Section 5: Zone-tick damage → concentration break (manual simulation of site D)
// ============================================================
console.log('\n=== 5. Zone-tick damage → concentration break (site D simulation) ===\n');
reset();
{
  // Simulate the start-of-turn zone tick damage step (combat.ts line ~4600-4615).
  // The engine calls applyDamageWithTempHP + rollConcentrationSave +
  // removeEffectsFromCaster for each damage_zone effect on the actor.
  const caster = makeC({
    id: 'wiz',
    name: 'Wizard',
    con: 10,
    pos: { x: 5, y: 5, z: 0 },
  });
  startConcentration(caster, 'Bless');
  attachEffect(caster, caster.id, 'Bless', 'bless_die', { dieSides: 4 });

  // Simulate taking 60 fire damage from a Cloud of Daggers start-of-turn tick.
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const dealt = applyDamageWithTempHP(caster, 60, 'fire');
  assert('5a. Damage applied (60 fire)', dealt === 60);

  // Mirror combat.ts: if concentration.active && dealt > 0, roll save.
  if (caster.concentration?.active && dealt > 0) {
    const maintained = rollConcentrationSave(caster, dealt);
    if (!maintained) {
      removeEffectsFromCaster(caster.id, bf);
    }
  }

  // DC = max(10, 60/2) = 30 > 20 + 0 CON → always fails.
  assert('5b. Concentration broken by zone-tick damage', caster.concentration === null);
  assert('5c. ActiveEffects cleaned up', caster.activeEffects.length === 0);
}

// ============================================================
// Section 6: Moving-zone damage → concentration break (site E simulation)
// ============================================================
console.log('\n=== 6. Moving-zone damage → concentration break (site E simulation) ===\n');
reset();
{
  // Mirror combat.ts line ~4985: moving zone damage applies to an enemy in
  // the new zone position, then triggers a concentration check.
  const caster = makeC({
    id: 'wiz',
    name: 'Wizard',
    con: 10,
    pos: { x: 5, y: 5, z: 0 },
  });
  startConcentration(caster, 'Hold Person');
  attachEffect(caster, caster.id, 'Hold Person', 'condition_apply', { condition: 'restrained' as any });

  const bf = makeBF([caster]);
  const state = makeState(bf);

  // Simulate Flaming Sphere moving-zone damage (2d6 fire = 2-12 → too low
  // to deterministically break DC 10 concentration). Use 60 instead.
  const dealt = applyDamageWithTempHP(caster, 60, 'fire');
  if (caster.concentration?.active && dealt > 0) {
    const maintained = rollConcentrationSave(caster, dealt);
    if (!maintained) {
      removeEffectsFromCaster(caster.id, bf);
    }
  }

  assert('6a. Concentration broken by moving-zone damage', caster.concentration === null);
  assert('6b. ActiveEffects cleaned up', caster.activeEffects.length === 0);
}

// ============================================================
// Section 7: Not concentrating → no-op (no crash, no log event)
// ============================================================
console.log('\n=== 7. Not concentrating → no-op ===\n');
reset();
{
  const target = makeC({
    id: 'fighter',
    name: 'Fighter',
    con: 10,
    pos: { x: 5, y: 5, z: 0 },
  });
  // Note: no startConcentration called. concentration === null.
  const attacker = makeC({
    id: 'goblin',
    name: 'Goblin',
    pos: { x: 6, y: 5, z: 0 },
  });

  const bf = makeBF([target, attacker]);
  const state = makeState(bf);

  resolveAttack(attacker, target, BIG_HIT, state, true);

  assert('7a. Target still not concentrating', target.concentration === null);

  // No condition_remove event for "loses concentration" should be logged.
  const concRemoveEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'condition_remove' && e.description.includes('concentration'),
  );
  assert('7b. No concentration-break event logged', concRemoveEvent === undefined);
}

// ============================================================
// Section 8: DC computation — direct rollConcentrationSave tests
// ============================================================
console.log('\n=== 8. DC computation (direct rollConcentrationSave) ===\n');
reset();
{
  // 8a. damage 5 → DC = max(10, floor(5/2)=2) = 10.
  //     CON 0 (con=10): need 10+ on d20 → 55% success.
  {
    let maintained = 0;
    for (let i = 0; i < 100; i++) {
      const c = makeC({ con: 10 });
      startConcentration(c, 'Test');
      if (rollConcentrationSave(c, 5)) maintained++;
    }
    // Expected ~55%; allow 35-75 to avoid flakiness.
    assert(`8a. damage 5 → DC 10 (CON+0): ~55% success (got ${maintained}/100)`,
      maintained >= 35 && maintained <= 75);
  }

  // 8b. damage 21 → DC = max(10, floor(21/2)=10) = 10.
  //     Same DC as 8a. CON 0: 55% success.
  {
    let maintained = 0;
    for (let i = 0; i < 100; i++) {
      const c = makeC({ con: 10 });
      startConcentration(c, 'Test');
      if (rollConcentrationSave(c, 21)) maintained++;
    }
    assert(`8b. damage 21 → DC 10 (CON+0): ~55% success (got ${maintained}/100)`,
      maintained >= 35 && maintained <= 75);
  }

  // 8c. damage 22 → DC = max(10, floor(22/2)=11) = 11.
  //     CON 0: need 11+ on d20 → 50% success.
  {
    let maintained = 0;
    for (let i = 0; i < 100; i++) {
      const c = makeC({ con: 10 });
      startConcentration(c, 'Test');
      if (rollConcentrationSave(c, 22)) maintained++;
    }
    assert(`8c. damage 22 → DC 11 (CON+0): ~50% success (got ${maintained}/100)`,
      maintained >= 30 && maintained <= 70);
  }

  // 8d. damage 40 → DC = max(10, floor(40/2)=20) = 20.
  //     CON 0: need 20 (nat 20 only) → 5% success.
  {
    let maintained = 0;
    for (let i = 0; i < 100; i++) {
      const c = makeC({ con: 10 });
      startConcentration(c, 'Test');
      if (rollConcentrationSave(c, 40)) maintained++;
    }
    assert(`8d. damage 40 → DC 20 (CON+0): ~5% success (got ${maintained}/100)`,
      maintained <= 15);
  }

  // 8e. damage 100 → DC = max(10, 50) = 50 → impossible for CON+0.
  {
    let maintained = 0;
    for (let i = 0; i < 50; i++) {
      const c = makeC({ con: 10 });
      startConcentration(c, 'Test');
      if (rollConcentrationSave(c, 100)) maintained++;
    }
    assert(`8e. damage 100 → DC 50 (CON+0): never succeeds (got ${maintained}/50)`,
      maintained === 0);
  }

  // 8f. Not concentrating → save returns true (no-op).
  {
    const c = makeC({ con: 10 });
    const result = rollConcentrationSave(c, 100);
    assert('8f. Non-concentrating: returns true', result === true);
  }
}

// ============================================================
// Section 9: Effect cleanup — multiple effects cleaned up on break
// ============================================================
console.log('\n=== 9. Effect cleanup — multiple effects removed on break ===\n');
reset();
{
  const caster = makeC({
    id: 'wiz',
    name: 'Wizard',
    con: 10,
    pos: { x: 5, y: 5, z: 0 },
  });
  const ally = makeC({
    id: 'ally',
    name: 'Ally',
    pos: { x: 6, y: 5, z: 0 },
  });
  startConcentration(caster, 'Bless');
  // Caster has a self-sourced bless_die effect.
  attachEffect(caster, caster.id, 'Bless', 'bless_die', { dieSides: 4 });
  // Ally has a caster-sourced bless_die effect (the caster's Bless applies to ally too).
  attachEffect(ally, caster.id, 'Bless', 'bless_die', { dieSides: 4 });
  eq('Caster has 1 self-effect', caster.activeEffects.length, 1);
  eq('Ally has 1 effect from caster', ally.activeEffects.length, 1);

  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  // Apply damage big enough to break concentration.
  resolveAttack(
    makeC({ id: 'enemy', name: 'Enemy', pos: { x: 7, y: 5, z: 0 } }),
    caster,
    BIG_HIT,
    state,
    true,
  );

  // 9a. Caster's concentration broken.
  assert('9a. Caster concentration broken', caster.concentration === null);
  // 9b. Caster's self-effect removed.
  assert('9b. Caster self-effect removed', caster.activeEffects.length === 0);
  // 9c. Ally's effect (sourced from caster) also removed by removeEffectsFromCaster.
  assert('9c. Ally effect (caster-sourced) removed', ally.activeEffects.length === 0,
    `effects = ${ally.activeEffects.length}`);
}

// ============================================================
// Section 10: Summon despawn on concentration break (TG-006)
// ============================================================
console.log('\n=== 10. Summon despawn on concentration break (TG-006) ===\n');
reset();
{
  const caster = makeC({
    id: 'wiz',
    name: 'Wizard',
    con: 10,
    pos: { x: 5, y: 5, z: 0 },
  });
  // A summoned creature (TG-006) — set isSummon + summonerId.
  const summon = makeC({
    id: 'beast',
    name: 'Summoned Beast',
    pos: { x: 6, y: 5, z: 0 },
    isSummon: true,
    summonerId: 'wiz',
    summonSpellName: 'Summon Beast',
  });
  startConcentration(caster, 'Summon Beast');

  const bf = makeBF([caster, summon]);
  const state = makeState(bf);

  // Apply big damage → concentration breaks → summon despawns.
  resolveAttack(
    makeC({ id: 'enemy', name: 'Enemy', pos: { x: 7, y: 5, z: 0 } }),
    caster,
    BIG_HIT,
    state,
    true,
  );

  assert('10a. Caster concentration broken', caster.concentration === null);
  assert('10b. Summon despawned on concentration break',
    !bf.combatants.has('beast'),
    `combatants: ${[...bf.combatants.keys()].join(',')}`);
}

// ============================================================
// Section 11: Low-damage hit + high-CON caster → maintained (statistical)
// ============================================================
console.log('\n=== 11. Low-damage hit + high-CON caster → maintained (statistical) ===\n');
reset();
{
  // CON 24 (+7) vs DC 10 (light hit). Need 3+ on d20 → 90% success.
  let maintainedCount = 0;
  const N = 100;
  for (let i = 0; i < N; i++) {
    const caster = makeC({
      id: `wiz${i}`,
      name: `wiz${i}`,
      con: 24,
      pos: { x: 5, y: 5, z: 0 },
    });
    startConcentration(caster, 'Barkskin');
    const attacker = makeC({
      id: `barb${i}`,
      name: `barb${i}`,
      pos: { x: 6, y: 5, z: 0 },
    });
    const bf = makeBF([caster, attacker]);
    const state = makeState(bf);

    resolveAttack(attacker, caster, LIGHT_HIT, state, true);

    if (caster.concentration?.active === true) maintainedCount++;
  }
  assert(`11a. CON+7 vs DC 10 mostly maintained (${maintainedCount}/${N})`,
    maintainedCount >= 80, `maintained=${maintainedCount}/${N}`);
}

// ============================================================
// Section 12: Dead/unconscious caster doesn't trigger concentration check
// ============================================================
console.log('\n=== 12. Dead caster — no concentration check needed ===\n');
reset();
{
  // Caster is already dead (isDead=true). resolveAttack should not crash.
  // The concentration check site guards on `!target.isDead && !target.isUnconscious`.
  const caster = makeC({
    id: 'wiz',
    name: 'Wizard',
    con: 10,
    pos: { x: 5, y: 5, z: 0 },
    isDead: true,
    currentHP: 0,
  });
  startConcentration(caster, 'Hex');

  const attacker = makeC({
    id: 'enemy',
    name: 'Enemy',
    pos: { x: 6, y: 5, z: 0 },
  });

  const bf = makeBF([caster, attacker]);
  const state = makeState(bf);

  // Should not throw. The auto-hit branch will still try to apply damage
  // (which is fine for a dead target — HP just goes more negative), but
  // the concentration check site should NOT fire (target.isDead guard).
  // Standard-attack branch may short-circuit on dead target.
  try {
    resolveAttack(attacker, caster, AUTO_HIT, state);
    assert('12a. resolveAttack did not throw on dead target', true);
  } catch (e: any) {
    assert('12a. resolveAttack did not throw on dead target', false, e.message);
  }
}

// ============================================================
// Final results
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) {
  console.error('concentration_enforcement.test.ts: SOME TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('concentration_enforcement.test.ts: all tests passed ✅');
}
