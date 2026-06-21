// ============================================================
// healing_spirit.test.ts — Healing Spirit spell module
// XGE p.157: 2nd-level conjuration, bonus action, range 60 ft, concentration (1 min).
// v1 simplified: one-shot heal of most-wounded ally within 30 ft (1d6). Canon is a
//   per-turn bonus-action reheal aura; the damage_zone tick can't heal, so v1
//   simplifies to one-shot (flag healingSpiritPerTurnRehealV1SimplifiedToOneShot).
// ============================================================

import { shouldCast, execute, metadata, rollHealAmount, cleanup } from '../spells/healing_spirit';
import { getActiveDamageZones } from '../engine/spell_effects';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Factories ----------------------------------------------

function withSlots2(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

const HEALING_SPIRIT_ACTION: Action = {
  name: 'Healing Spirit',
  isMultiattack: false,
  attackType: 'special',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: true,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'bonusAction',
  legendaryCost: 0,
  description: 'Healing Spirit (1d6 heal/turn, bonus action, concentration 1 min)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 30, currentHP: 30, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set() as Set<Condition>,
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

function makeCaster(id = 'wiz', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Druid',
    pos,
    actions: [HEALING_SPIRIT_ACTION],
    resources: withSlots2(2),
  });
}

function makeWoundedAlly(id: string, pos: Vec3, currentHP: number, maxHP = 30): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'party',
    pos,
    maxHP,
    currentHP,
  });
}

function makeFullHpAlly(id: string, pos: Vec3): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'party',
    pos,
    maxHP: 30,
    currentHP: 30,
  });
}

function makeBF(combatants: Combatant[]) {
  return {
    width: 30, height: 30, depth: 1,
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

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Healing Spirit', metadata.name, 'Healing Spirit');
eq('level is 2', metadata.level, 2);
eq('school is conjuration', metadata.school, 'conjuration');
eq('rangeFt is 30 (v1 simplified)', metadata.rangeFt, 30);
eq('aoeSizeFt is 30', metadata.aoeSizeFt, 30);
eq('dieCount is 1', metadata.dieCount, 1);
eq('dieSides is 6', metadata.dieSides, 6);
eq('is concentration', metadata.concentration, true);
eq('castingTime is bonusAction', metadata.castingTime, 'bonusAction');
eq('canon flag set (per-turn reheal simplified to one-shot)',
  (metadata as any).healingSpiritPerTurnRehealV1SimplifiedToOneShot, true);
eq('canon flag set (cube placement simplified)',
  (metadata as any).healingSpiritCubePlacementV1Simplified, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const ally = makeWoundedAlly('ally1', { x: 1, y: 0, z: 0 }, 15);
  const bf = makeBF([caster, ally]);
  eq('Returns null when caster is already concentrating', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.actions = [];
  const ally = makeWoundedAlly('ally1', { x: 1, y: 0, z: 0 }, 15);
  const bf = makeBF([caster, ally]);
  eq('Returns null when caster has no Healing Spirit action', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.resources = withSlots2(0);
  const ally = makeWoundedAlly('ally1', { x: 1, y: 0, z: 0 }, 15);
  const bf = makeBF([caster, ally]);
  eq('Returns null when no 2nd-level slots', shouldCast(caster, bf), null);
}

{
  // No wounded ally (only full-HP allies)
  const caster = makeCaster();
  const fullAlly = makeFullHpAlly('full', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, fullAlly]);
  eq('Returns null when no wounded allies', shouldCast(caster, bf), null);
}

{
  // Wounded ally too far (> 30 ft)
  const caster = makeCaster();
  const farWounded = makeWoundedAlly('far', { x: 7, y: 0, z: 0 }, 10);   // 35 ft
  const bf = makeBF([caster, farWounded]);
  eq('Returns null when wounded ally too far (> 30 ft)', shouldCast(caster, bf), null);
}

{
  // Happy path: one wounded ally within 30 ft
  const caster = makeCaster();
  const ally = makeWoundedAlly('ally1', { x: 1, y: 0, z: 0 }, 15);
  const bf = makeBF([caster, ally]);
  const targets = shouldCast(caster, bf);
  assert('Happy path returns non-null targets array', targets !== null);
  eq('Returns 1 wounded ally', targets!.length, 1);
  eq('Target is ally1', targets![0].id, 'ally1');
}

{
  // Most-wounded ally is first in list (sorting by wound ratio desc)
  const caster = makeCaster();
  const lightlyWounded = makeWoundedAlly('light', { x: 1, y: 0, z: 0 }, 25);   // 5/30 = 17% wounded
  const heavilyWounded = makeWoundedAlly('heavy', { x: 2, y: 0, z: 0 }, 5);    // 25/30 = 83% wounded
  const bf = makeBF([caster, lightlyWounded, heavilyWounded]);
  const targets = shouldCast(caster, bf);
  eq('Most-wounded ally is first', targets![0].id, 'heavy');
}

{
  // Enemy is NOT a target (faction check)
  const caster = makeCaster();
  const enemy = makeCombatant('enemy1', {
    faction: 'enemy',
    pos: { x: 1, y: 0, z: 0 },
    maxHP: 30, currentHP: 5,
  });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when only enemy is wounded (faction check)', shouldCast(caster, bf), null);
}

// ============================================================
// 3. execute — heal pipeline
// ============================================================

console.log('\n=== 3. execute — heal pipeline ===\n');

{
  // 3a. Slot consumed, concentration started
  const caster = makeCaster();
  const ally = makeWoundedAlly('ally1', { x: 1, y: 0, z: 0 }, 15);
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Healing Spirit', caster.concentration?.spellName, 'Healing Spirit');
}

{
  // 3b. Most-wounded ally is healed (HP increased by [1, 6])
  const caster = makeCaster();
  const ally = makeWoundedAlly('ally1', { x: 1, y: 0, z: 0 }, 10);
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const hpGained = ally.currentHP - 10;
  assert('Ally healed in [1, 6] (1d6)', hpGained >= 1 && hpGained <= 6, `got ${hpGained}`);
}

{
  // 3c. Heal capped at maxHP
  // Ally starts 1 HP short of max so ANY heal roll (1d6, min 1) exceeds the
  // gap and caps at maxHP. (Previously started 2 HP short, which meant a
  // heal roll of 1 would land at 29 instead of 30 — flaky ~17% of the time.)
  const caster = makeCaster();
  const ally = makeWoundedAlly('ally1', { x: 1, y: 0, z: 0 }, 29, 30);   // 1 HP short of max
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  assert('Ally healed but capped at maxHP (30)', ally.currentHP === 30, `got ${ally.currentHP}`);
}

{
  // 3d. NO damage_zone effect applied (heal is one-shot, no per-turn tick)
  const caster = makeCaster();
  const ally = makeWoundedAlly('ally1', { x: 1, y: 0, z: 0 }, 15);
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('NO damage_zone effect on healed ally', getActiveDamageZones(ally).length, 0);
  eq('NO activeEffects on healed ally (heal is one-shot)', ally.activeEffects.length, 0);
}

{
  // 3e. Most-wounded ally chosen for heal
  const caster = makeCaster();
  const lightlyWounded = makeWoundedAlly('light', { x: 1, y: 0, z: 0 }, 25);
  const heavilyWounded = makeWoundedAlly('heavy', { x: 2, y: 0, z: 0 }, 5);
  const bf = makeBF([caster, lightlyWounded, heavilyWounded]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  const heavyHpBefore = heavilyWounded.currentHP;
  const lightHpBefore = lightlyWounded.currentHP;
  execute(caster, targets, state);

  // heavilyWounded should be healed (it was first in the sorted list)
  assert('Heavily-wounded ally was healed', heavilyWounded.currentHP > heavyHpBefore,
    `before=${heavyHpBefore}, after=${heavilyWounded.currentHP}`);
  eq('Lightly-wounded ally was NOT healed (v1 one-shot, only first target)', lightlyWounded.currentHP, lightHpBefore);
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeCaster();
  const ally = makeWoundedAlly('ally1', { x: 1, y: 0, z: 0 }, 15);
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const healEvents = events.filter(e => e.type === 'heal');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('Action event emitted', actionEvents.length >= 1);
  assert('Heal event emitted', healEvents.length === 1);
  assert('Condition_add event emitted', condEvents.length === 1);
  assert('Action event mentions "Healing Spirit"', actionEvents[0].description.includes('Healing Spirit'));
  assert('Heal event mentions the ally name', healEvents[0].description.includes('ally1'));
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Healing Spirit', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change spellName', caster.concentration?.spellName, 'Healing Spirit');
}

// ============================================================
// 6. rollHealAmount range check
// ============================================================

console.log('\n=== 6. rollHealAmount range check ===\n');

{
  for (let i = 0; i < 30; i++) {
    const amt = rollHealAmount();
    assert(`rollHealAmount() in [1, 6] (iteration ${i})`, amt >= 1 && amt <= 6, `got ${amt}`);
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
