// ============================================================
// wither_and_bloom.test.ts — Wither and Bloom spell module
// SCC p.38 (Strixhaven): 2nd-level necromancy, action, range 60 ft,
//   NO concentration. Canon: 10-ft AoE 2d6 necrotic damage (CON save)
//   + 2d6 heal to one ally in the area.
// v1 SIMPLIFICATION: 2 discrete targets (1 enemy + 1 ally).
//   shouldCast returns Combatant[] [damageTarget, healTarget].
//   No save (guaranteed damage); separate 2d6 heal roll.
//
// Tests cover shouldCast() preconditions, dual-target selection,
// execute() damage application, heal application, slot consumption,
// logging, and cleanup no-op.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/wither_and_bloom';
import { Combatant, Action, PlayerResources, Vec3 } from '../types/core';

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
  return { spellSlots: { 2: { max: 2, remaining } } };
}

const WB_ACTION: Action = {
  name: 'Wither and Bloom',
  costType: 'action',
  attackType: null,
  isMultiattack: false,
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 2,
  legendaryCost: 0,
  description: 'Wither and Bloom (2d6 necrotic to enemy + 2d6 heal to ally, 60 ft)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 12, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10,
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

function makeBF(combatants: Combatant[]): any {
  return {
    width: 20, height: 20, depth: 1,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  };
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

function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, wis = 16): Combatant {
  return makeCombatant('caster1', {
    name: 'Caster',
    pos,
    wis,
    actions: [WB_ACTION],
    resources: withSlots(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Wither and Bloom', metadata.name, 'Wither and Bloom');
eq('level is 2', metadata.level, 2);
eq('school is necromancy', metadata.school, 'necromancy');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('damage die is d6', metadata.damageDie, 6);
eq('damage die count is 2', metadata.damageDieCount, 2);
eq('damage type is necrotic', metadata.damageType, 'necrotic');
eq('heal die is d6', metadata.healDie, 6);
eq('heal die count is 2', metadata.healDieCount, 2);
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
assert('v1 canon flag set',
  (metadata as any).witherAndBloomCanonV1Implemented === true);
assert('v1 death-save simplification flag set (spec-required)',
  (metadata as any).witherAndBloomDeathSaveV1Simplified === true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Wither and Bloom' action
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 10 });
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, enemy, ally]);
  assert('Returns null when caster has no Wither and Bloom action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeCaster();
  caster.resources = withSlots(0);
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 10 });
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, enemy, ally]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No enemy — only wounded ally
  const caster = makeCaster();
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no enemy in range', shouldCast(caster, bf) === null);
}

{
  // 2d. No wounded ally — only enemy
  const caster = makeCaster();
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 10 });
  const ally  = makeCombatant('ally1', { currentHP: 40, maxHP: 40 }); // full HP
  const bf = makeBF([caster, enemy, ally]);
  assert('Returns null when no wounded ally in range', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — dual-target selection
// ============================================================

console.log('\n=== 3. shouldCast — dual-target selection ===\n');

{
  // 3a. Returns array of length 2: [damageTarget, healTarget]
  const caster = makeCaster();
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 10, maxHP: 20 });
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, enemy, ally]);
  const result = shouldCast(caster, bf);
  assert('Returns array', Array.isArray(result));
  assert('Returns array of length 2', result !== null && result.length === 2);
  if (result && result.length === 2) {
    eq('Index 0 is enemy (damage target)', result[0].id, 'goblin1');
    eq('Index 1 is ally (heal target)', result[1].id, 'ally1');
  }
}

{
  // 3b. Picks highest-threat enemy (lowest HP)
  const caster = makeCaster();
  const woundedEnemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 5, maxHP: 20 });
  const healthyEnemy = makeCombatant('goblin2', { faction: 'enemy', currentHP: 18, maxHP: 20 });
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, woundedEnemy, healthyEnemy, ally]);
  const result = shouldCast(caster, bf);
  eq('Picks lowest-HP enemy (highest threat)', result?.[0].id, 'goblin1');
}

{
  // 3c. Picks most-wounded ally (largest HP deficit)
  const caster = makeCaster();
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 10, maxHP: 20 });
  const hurtAlly    = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });  // deficit 35
  const lessHurtAlly = makeCombatant('ally2', { currentHP: 25, maxHP: 40 }); // deficit 15
  const bf = makeBF([caster, enemy, hurtAlly, lessHurtAlly]);
  const result = shouldCast(caster, bf);
  eq('Picks most-wounded ally (largest deficit)', result?.[1].id, 'ally1');
}

{
  // 3d. Enemy out of range (> 60 ft)
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 10, pos: { x: 13, y: 0, z: 0 } }); // 65 ft
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, enemy, ally]);
  assert('Returns null when enemy out of 60-ft range', shouldCast(caster, bf) === null);
}

{
  // 3e. Self qualifies as heal target if wounded
  const caster = makeCaster();
  caster.currentHP = 5; caster.maxHP = 40;
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 10, maxHP: 20 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  eq('Caster (self) selected as heal target when wounded', result?.[1].id, 'caster1');
}

// ============================================================
// 4. execute — damage and healing
// ============================================================

console.log('\n=== 4. execute — damage and healing ===\n');

{
  // 4a. Enemy takes 2d6 necrotic damage (range 2..12)
  const caster = makeCaster();
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 30, maxHP: 30 });
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, enemy, ally]);
  const state = makeState(bf);

  execute(caster, [enemy, ally], state);

  const dmgDealt = 30 - enemy.currentHP;
  assert('Enemy took 2..12 necrotic damage', dmgDealt >= 2 && dmgDealt <= 12,
    `dmgDealt: ${dmgDealt}`);
}

{
  // 4b. Ally heals 2d6 HP (range 2..12)
  const caster = makeCaster();
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 30, maxHP: 30 });
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, enemy, ally]);
  const state = makeState(bf);

  execute(caster, [enemy, ally], state);

  const healed = ally.currentHP - 5;
  assert('Ally healed by 2..12 HP', healed >= 2 && healed <= 12,
    `healed: ${healed}`);
  assert('Ally HP does not exceed maxHP', ally.currentHP <= ally.maxHP);
}

{
  // 4c. Slot is consumed
  const caster = makeCaster();
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 30, maxHP: 30 });
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, enemy, ally]);
  const state = makeState(bf);

  execute(caster, [enemy, ally], state);

  eq('2nd-level slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4d. 'action' cast event logged
  const caster = makeCaster();
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 30, maxHP: 30 });
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, enemy, ally]);
  const state = makeState(bf);

  execute(caster, [enemy, ally], state);

  const actionEv = state.log.events.find((e: any) => e.type === 'action' && e.actorId === 'caster1');
  assert('Action event logged', !!actionEv);
  assert('Action event mentions both targets',
    actionEv?.description?.includes('goblin1') && actionEv?.description?.includes('ally1'));
}

{
  // 4e. 'damage' event logged for enemy
  const caster = makeCaster();
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 30, maxHP: 30 });
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, enemy, ally]);
  const state = makeState(bf);

  execute(caster, [enemy, ally], state);

  const dmgEv = state.log.events.find((e: any) => e.type === 'damage' && e.targetId === 'goblin1');
  assert('Damage event logged for enemy', !!dmgEv);
  assert('Damage event value > 0', (dmgEv?.value ?? 0) > 0);
}

{
  // 4f. 'heal' event logged for ally
  const caster = makeCaster();
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 30, maxHP: 30 });
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, enemy, ally]);
  const state = makeState(bf);

  execute(caster, [enemy, ally], state);

  const healEv = state.log.events.find((e: any) => e.type === 'heal' && e.targetId === 'ally1');
  assert('Heal event logged for ally', !!healEv);
  assert('Heal event value > 0', (healEv?.value ?? 0) > 0);
}

{
  // 4g. Heal capped at maxHP (ally at 39/40 heals max 1)
  const caster = makeCaster();
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 30, maxHP: 30 });
  const ally  = makeCombatant('ally1', { currentHP: 39, maxHP: 40 });
  const bf = makeBF([caster, enemy, ally]);
  const state = makeState(bf);

  execute(caster, [enemy, ally], state);

  eq('Ally HP capped at maxHP', ally.currentHP, 40);
}

{
  // 4h. Enemy with temp HP: damage absorbed first (PHB p.198)
  const caster = makeCaster();
  const enemy = makeCombatant('goblin1', {
    faction: 'enemy', currentHP: 30, maxHP: 30, tempHP: 5,
  });
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, enemy, ally]);
  const state = makeState(bf);

  execute(caster, [enemy, ally], state);

  // Damage range 2..12. Temp HP 5 absorbs min(5, dmg). Real HP takes max(0, dmg-5).
  // Total HP (current + temp) reduction = min(dmg, current+temp) = min(dmg, 35)
  const totalBefore = 30 + 5;
  const totalAfter = enemy.currentHP + enemy.tempHP;
  const totalLost = totalBefore - totalAfter;
  assert('Enemy total HP (current+temp) reduced by 2..12',
    totalLost >= 2 && totalLost <= 12, `totalLost: ${totalLost}`);
}

// ============================================================
// 5. Integration pipeline + cleanup
// ============================================================

console.log('\n=== 5. Integration pipeline + cleanup ===\n');

{
  // 5a. Full pipeline: shouldCast → execute damages enemy + heals ally
  const caster = makeCaster();
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 30, maxHP: 30 });
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, enemy, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 2 targets', targets !== null && targets.length === 2);
  if (targets) execute(caster, targets, state);

  assert('Enemy took damage', enemy.currentHP < 30);
  assert('Ally was healed', ally.currentHP > 5);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 5b. After slots exhausted, shouldCast returns null
  const caster = makeCaster();
  caster.resources = withSlots(1);
  const enemy = makeCombatant('goblin1', { faction: 'enemy', currentHP: 30, maxHP: 30 });
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, enemy, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy, ally]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

{
  // 5c. cleanup is a no-op (does not throw)
  const caster = makeCaster();
  let threw = false;
  try { cleanup(caster); } catch { threw = true; }
  assert('cleanup is a no-op (does not throw)', !threw);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
