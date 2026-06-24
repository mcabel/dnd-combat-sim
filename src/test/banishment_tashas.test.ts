// ============================================================
// Test: Session 60 — Banishment + Tasha's Hideous Laughter
//
// Banishment (PHB p.217): L4, 60 ft, CHA save, concentration.
//   - Fey/elemental/celestial/fiend/undead → removed permanently (isDead)
//   - Other types → incapacitated (reverts on concentration break)
//
// Tasha's Hideous Laughter (PHB p.282): L1, 30 ft, WIS save, concentration.
//   - On fail: prone + incapacitated
//
// Run: npx ts-node --transpile-only src/test/banishment_tashas.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { execute as executeBanishment, shouldCast as shouldCastBanishment, metadata as banMeta } from '../spells/banishment';
import { execute as executeTHL, shouldCast as shouldCastTHL, metadata as thlMeta } from '../spells/tashas_hideous_laughter';
import { EngineState } from '../engine/combat';
import { Combatant, Battlefield, Action, PlayerResources, Condition, Vec3 } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 1, int: 10, wis: 1, cha: 1, // low saves → always fail
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

function makeCaster(id: string, spellName: string, slotLevel: number): Combatant {
  return makeCombatant(id, {
    faction: 'party',
    cha: 20, wis: 20, // high save DC
    actions: [{
      name: spellName, isMultiattack: false, attackType: 'save',
      reach: 0, range: { normal: 60, long: 60 }, hitBonus: null,
      damage: null, damageType: null, saveDC: 25, saveAbility: spellName === 'Banishment' ? 'cha' : 'wis',
      isAoE: false, isControl: true, requiresConcentration: true,
      slotLevel, costType: 'action', legendaryCost: 0, description: spellName,
    }],
    resources: { spellSlots: { [slotLevel]: { max: 2, remaining: 2 } } } as any,
  });
}

function makeBF(combatants: Combatant[]): Battlefield {
  return {
    width: 20, height: 20, depth: 1, cells: [],
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1, initiativeOrder: combatants.map(c => c.id),
  } as any;
}
function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(), damageThisRound: new Map(),
    noDamageRounds: new Map(), rageDamagedSinceLastTurn: new Set(),
  } as any;
}

// ============================================================
console.log('\n=== Banishment Metadata ===');
eq('name', banMeta.name, 'Banishment');
eq('level 4', banMeta.level, 4);
eq('concentration', banMeta.concentration, true);
eq('save cha', banMeta.saveAbility, 'cha');

// ============================================================
console.log('\n=== Banishment: fey removed permanently ===');
{
  const caster = makeCaster('wizard', 'Banishment', 4);
  const fey = makeCombatant('pixie', { creatureType: 'fey', cha: 1 });
  const bf = makeBF([caster, fey]);
  const state = makeState(bf);
  executeBanishment(caster, fey, state);
  assert('fey isDead (permanently removed)', fey.isDead);
  eq('fey HP = 0', fey.currentHP, 0);
  assert('caster concentrating on Banishment', caster.concentration?.spellName === 'Banishment');
}

// ============================================================
console.log('\n=== Banishment: humanoid incapacitated (demiplane) ===');
{
  const caster = makeCaster('wizard', 'Banishment', 4);
  const humanoid = makeCombatant('goblin', { creatureType: 'humanoid', cha: 1 });
  const bf = makeBF([caster, humanoid]);
  const state = makeState(bf);
  executeBanishment(caster, humanoid, state);
  assert('humanoid NOT dead (demiplane)', !humanoid.isDead);
  assert('humanoid incapacitated', humanoid.conditions.has('incapacitated'));
}

// ============================================================
console.log('\n=== Banishment: save success → no effect ===');
{
  const caster = makeCaster('wizard', 'Banishment', 4);
  // Target with CHA 30 (+10) → save = 1d20+10 vs DC 25 → needs 15+ (30% success)
  // Run multiple trials to find a success
  let succeeded = false;
  for (let i = 0; i < 50; i++) {
    const target = makeCombatant('target' + i, { creatureType: 'humanoid', cha: 30 });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);
    // Reset caster each time
    caster.resources = { spellSlots: { 4: { max: 2, remaining: 2 } } } as any;
    caster.concentration = null;
    executeBanishment(caster, target, state);
    if (!target.conditions.has('incapacitated') && !target.isDead) {
      succeeded = true;
      break;
    }
  }
  assert('save success possible (no effect on success)', succeeded);
}

// ============================================================
console.log('\n=== Tasha\'s Hideous Laughter Metadata ===');
eq('name', thlMeta.name, "Tasha's Hideous Laughter");
eq('level 1', thlMeta.level, 1);
eq('concentration', thlMeta.concentration, true);
eq('save wis', thlMeta.saveAbility, 'wis');

// ============================================================
console.log('\n=== Tasha\'s Hideous Laughter: prone + incapacitated ===');
{
  const caster = makeCaster('bard', "Tasha's Hideous Laughter", 1);
  const target = makeCombatant('goblin', { wis: 1 });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);
  executeTHL(caster, target, state);
  assert('target prone', target.conditions.has('prone'));
  assert('target incapacitated', target.conditions.has('incapacitated'));
  assert('caster concentrating', caster.concentration?.spellName === "Tasha's Hideous Laughter");
}

// ============================================================
console.log('\n=== shouldCast gates ===');
{
  // Banishment: no slot → null
  const casterNoSlot = makeCaster('wiz', 'Banishment', 4);
  casterNoSlot.resources!.spellSlots![4].remaining = 0;
  assert('Banishment no slot → null', shouldCastBanishment(casterNoSlot, makeBF([casterNoSlot])) === null);

  // Banishment: already concentrating → null
  const casterConc = makeCaster('wiz', 'Banishment', 4);
  casterConc.concentration = { active: true, spellName: 'Other', dcIfHit: 10 } as any;
  assert('Banishment already concentrating → null', shouldCastBanishment(casterConc, makeBF([casterConc])) === null);

  // Tasha's: no slot → null
  const thlNoSlot = makeCaster('bard', "Tasha's Hideous Laughter", 1);
  thlNoSlot.resources!.spellSlots![1].remaining = 0;
  assert('THL no slot → null', shouldCastTHL(thlNoSlot, makeBF([thlNoSlot])) === null);
}

// ---- Results ------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
