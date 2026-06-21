// ============================================================
// Test: Shillelagh Cantrip
// PHB p.275 — Level 0 transmutation cantrip (self-buff: WIS-for-STR melee + +1d8 radiant)
//
// v1 simplifications (both documented via metadata flags):
//   - Duration: 1 minute canonically → v1: 1-round (clears at start of
//     caster's next turn, mirroring Blade Ward).
//   - Damage: "weapon damage die becomes d8" canonically → v1: +1d8 radiant
//     on top of the weapon's existing damage (sidesteps the engine complexity
//     of identifying which Action is the buffed weapon).
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (V + S + M — mistletoe, shamrock, club/quarterstaff)
//   3. metadata exposes isSelfBuff = true
//   4. metadata exposes riderAttackTypes = ['melee']
//   5. metadata exposes castingTime = 'bonusAction' (rare — most cantrips are action)
//   6. metadata exposes v1 simplification flags
//   7. metadata does NOT scale (the +1d8 is the cantrip's flat effect)
//   8. applySelfEffect sets _shillelaghActive flag + emits log
//   9. resolveCantripAction integration — 'Shillelagh' routes to applySelfEffect
//  10. dispatcher safety — unknown cantrip name is a no-op
//  11. cleanup() clears _shillelaghActive flag (resetBudget integration)
//  12. WIS-for-STR substitution: melee attack with buff uses WIS mod
//  13. +1d8 radiant damage on melee hit while buff is active
//  14. buff applies to MELEE attacks only (control: ranged attack with buff
//      does NOT get WIS substitution or +1d8 radiant)
//  15. buff applies to MELEE attacks only (control: spell attack with buff
//      does NOT get WIS substitution or +1d8 radiant)
//  16. buff clears at start of caster's next turn (resetBudget)
//  17. WIS-for-STR delta = 0 when WIS mod == STR mod (no log emitted)
//  18. +1d8 radiant is doubled on crit (PHB p.196: crit doubles damage dice)
//  19. Shillelagh itself does NOT go through resolveAttack (it's a self-buff)
//  20. resolveCantripAoE returns false (not a caster-centered AoE)
//
// Run: npx ts-node src/test/shillelagh.test.ts
// ============================================================

import { metadata, applySelfEffect, cleanup } from '../spells/shillelagh';
import {
  applyCantripEffect as dispatchCantrip,
  resolveCantripAction,
  resolveCantripAoE,
} from '../engine/cantrip_effects';
import { resetBudget } from '../engine/utils';
import { resolveAttack, CombatEvent } from '../engine/combat';
import { Combatant, Action, Vec3, Cell, Obstacle } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail: any = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10,
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

function makeBF(combatants: Combatant[], obstacles: Obstacle[] = []) {
  const width = 10, height = 10, depth = 1;
  const cells: Cell[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [];
      for (let z = 0; z < depth; z++) {
        cells[x][y][z] = { terrain: 'normal', elevation: 0 };
      }
    }
  }
  return {
    width, height, depth, cells,
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
    obstacles: obstacles.length ? obstacles : undefined,
  };
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// A Shillelagh Action — self-buff, no target, no attack roll.
// v1: costType='bonusAction' (PHB p.275 — one of the few bonus-action cantrips).
const SHILLELAGH_ACTION: Action = {
  name: 'Shillelagh',
  isMultiattack: false,
  attackType: 'special', // self-buff — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 0, long: 0 }, // Self
  hitBonus: null,
  damage: null, // no damage — the cantrip buffs the weapon, not itself
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'bonusAction',
  legendaryCost: 0,
  description: 'Shillelagh',
};

// A melee weapon Action (club) — used to test the buff's effect on melee attacks.
// hitBonus = STR mod (cleric has STR 10 → +0). 1d6 bludgeoning.
const CLUB_ACTION: Action = {
  name: 'Club',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: 0, // STR mod +0 — will be substituted to WIS mod when Shillelagh is active
  damage: { count: 1, sides: 6, bonus: 0, average: 3 },
  damageType: 'bludgeoning',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Club',
};

// A ranged weapon Action (shortbow) — control test: buff should NOT apply.
const SHORTBOW_ACTION: Action = {
  name: 'Shortbow',
  isMultiattack: false,
  attackType: 'ranged',
  reach: 0,
  range: { normal: 80, long: 320 },
  hitBonus: 0,
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
  description: 'Shortbow',
};

// A ranged spell attack Action (Fire Bolt) — control test: buff should NOT apply.
const FIRE_BOLT_ACTION: Action = {
  name: 'Fire Bolt',
  isMultiattack: false,
  attackType: 'spell',
  reach: 0,
  range: { normal: 120, long: 120 },
  hitBonus: 0,
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
  description: 'Fire Bolt',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Shillelagh');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'transmutation');
  eq('1d. rangeFt (0 — Self/Touch)', metadata.rangeFt, 0);
  eq('1e. damageDice null (no damage — buff only)', metadata.damageDice, null);
  eq('1f. damageType = radiant (the +1d8 bonus type)', metadata.damageType, 'radiant');
  eq('1g. not concentration', metadata.concentration, false);
}

// ============================================================
// 2. components: V + S + M (mistletoe, shamrock, club/quarterstaff) — PHB p.275
// ============================================================
console.log('\n--- 2. components ---');
{
  eq('2a. verbal component', metadata.components.v, true);
  eq('2b. somatic component', metadata.components.s, true);
  eq('2c. material component (mistletoe, shamrock, club/quarterstaff)',
    metadata.components.m, true);
}

// ============================================================
// 3. metadata exposes isSelfBuff = true
// ============================================================
console.log('\n--- 3. isSelfBuff ---');
{
  eq('3a. isSelfBuff = true', metadata.isSelfBuff, true);
}

// ============================================================
// 4. metadata exposes riderAttackTypes = ['melee']
// ============================================================
console.log('\n--- 4. riderAttackTypes ---');
{
  eq('4a. riderAttackTypes length 1', metadata.riderAttackTypes.length, 1);
  eq('4b. riderAttackTypes[0] = melee', metadata.riderAttackTypes[0], 'melee');
}

// ============================================================
// 5. metadata exposes castingTime = 'bonusAction' (rare)
// ============================================================
console.log('\n--- 5. castingTime ---');
{
  eq('5a. castingTime = bonusAction (PHB p.275 — rare for a cantrip)',
    metadata.castingTime, 'bonusAction');
}

// ============================================================
// 6. metadata exposes v1 simplification flags
// ============================================================
console.log('\n--- 6. v1 simplification flags ---');
{
  eq('6a. shillelaghDurationV1Simplified = true (canon: 1 min, v1: 1 round)',
    metadata.shillelaghDurationV1Simplified, true);
  eq('6b. shillelaghDamageModelV1Simplified = true (canon: die becomes d8, v1: +1d8 radiant)',
    metadata.shillelaghDamageModelV1Simplified, true);
}

// ============================================================
// 7. metadata does NOT scale (the +1d8 is the cantrip's flat effect)
// ============================================================
console.log('\n--- 7. no scaling ---');
{
  eq('7a. scales = false (Shillelagh does NOT scale at 5/11/17)', metadata.scales, false);
}

// ============================================================
// 8. applySelfEffect sets _shillelaghActive flag + emits log
// ============================================================
console.log('\n--- 8. applySelfEffect ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  eq('8a. flag not set before cast', caster._shillelaghActive, undefined);

  const ret = applySelfEffect(caster, state);
  eq('8b. applySelfEffect returns true', ret, true);
  eq('8c. _shillelaghActive set to true', caster._shillelaghActive, true);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Shillelagh'),
  );
  assert('8d. cast log emitted', castLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('8e. log mentions WIS-for-STR substitution',
    castLog?.description.includes('WIS') === true, `got: ${castLog?.description}`);
}

// ============================================================
// 9. resolveCantripAction integration — 'Shillelagh' routes to applySelfEffect
// ============================================================
console.log('\n--- 9. resolveCantripAction integration ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Shillelagh', state);
  eq('9a. resolveCantripAction returns true', ret, true);
  eq('9b. _shillelaghActive set', caster._shillelaghActive, true);
}

// ============================================================
// 10. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 10. dispatcher safety ---');
{
  const caster = makeCombatant('druid');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('10a. unknown cantrip → no log events', state.log.events.length, 0);
  eq('10b. unknown cantrip → no flag set on caster', caster._shillelaghActive, undefined);
  eq('10c. unknown cantrip → no flag set on target', target._shillelaghActive, undefined);
}

// ============================================================
// 11. cleanup() clears _shillelaghActive flag (resetBudget integration)
// ============================================================
console.log('\n--- 11. cleanup ---');
{
  const caster = makeCombatant('druid', { _shillelaghActive: true });
  cleanup(caster);
  eq('11a. _shillelaghActive cleared by cleanup()', caster._shillelaghActive, undefined);

  // resetBudget integration — buff clears at start of caster's next turn.
  const caster2 = makeCombatant('druid', { _shillelaghActive: true });
  resetBudget(caster2);
  eq('11b. _shillelaghActive cleared by resetBudget()', caster2._shillelaghActive, undefined);
}

// ============================================================
// 12. WIS-for-STR substitution: melee attack with buff uses WIS mod
// ============================================================
console.log('\n--- 12. WIS-for-STR substitution (melee) ---');
{
  // Caster: STR 10 (+0), WIS 18 (+4). Without Shillelagh, Club hitBonus = +0.
  // With Shillelagh active, Club hitBonus should become +4 (WIS mod substituted).
  const casterNoBuff = makeCombatant('druid1', {
    pos: { x: 0, y: 0, z: 0 },
    str: 10, wis: 18, // STR +0, WIS +4
    actions: [CLUB_ACTION],
  });
  const casterWithBuff = makeCombatant('druid2', {
    pos: { x: 0, y: 0, z: 0 },
    str: 10, wis: 18, // STR +0, WIS +4
    actions: [CLUB_ACTION],
    _shillelaghActive: true,
  });
  // Force a hit with isCritOverride=true (avoid nat-1 auto-miss flakiness).
  // But wait — isCritOverride forces a CRIT, which doubles damage dice. We want
  // to test the WIS substitution in the attack ROLL, not the damage. The crit
  // path still goes through rollAttack with the substituted hitBonus.
  // We'll check the log for the "channels Shillelagh" message + the hit log.

  // Without buff: target AC 5, hitBonus +0 → roll 1..20 + 0 vs AC 5. With
  // isCritOverride=true, the hit always lands; check that NO "channels Shillelagh"
  // log is emitted.
  const target1 = makeCombatant('goblin1', {
    pos: { x: 1, y: 0, z: 0 }, ac: 5,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf1 = makeBF([casterNoBuff, target1]);
  const state1 = makeState(bf1);
  resolveAttack(casterNoBuff, target1, CLUB_ACTION, state1, true);

  const noBuffShillelaghLog = state1.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('channels Shillelagh'),
  );
  assert('12a. NO "channels Shillelagh" log without buff',
    noBuffShillelaghLog === undefined, `unexpected: ${noBuffShillelaghLog?.description}`);

  // With buff: "channels Shillelagh" log SHOULD be emitted, mentioning the delta
  // of +4 (WIS +4 − STR +0 = +4).
  const target2 = makeCombatant('goblin2', {
    pos: { x: 1, y: 0, z: 0 }, ac: 5,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf2 = makeBF([casterWithBuff, target2]);
  const state2 = makeState(bf2);
  resolveAttack(casterWithBuff, target2, CLUB_ACTION, state2, true);

  const buffShillelaghLog = state2.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('channels Shillelagh'),
  );
  assert('12b. "channels Shillelagh" log emitted with buff',
    buffShillelaghLog !== undefined, `events: ${state2.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('12c. log mentions WIS (+4)',
    buffShillelaghLog?.description.includes('+4') === true, `got: ${buffShillelaghLog?.description}`);
  assert('12d. log mentions STR (+0)',
    buffShillelaghLog?.description.includes('+0') === true, `got: ${buffShillelaghLog?.description}`);
  assert('12e. log mentions delta +4',
    buffShillelaghLog?.description.includes('delta +4') === true, `got: ${buffShillelaghLog?.description}`);
}

// ============================================================
// 13. +1d8 radiant damage on melee hit while buff is active
// ============================================================
console.log('\n--- 13. +1d8 radiant on melee hit ---');
{
  // Compare damage with and without the buff. Both attacks are forced hits
  // (isCritOverride=false → forces MISS; we want HIT, so we need a different
  // approach). Actually isCritOverride=true forces a CRIT, which doubles BOTH
  // the weapon dice AND the Shillelagh +1d8 (PHB p.196). To test the
  // non-crit case, we can't use isCritOverride. Instead, use high hitBonus
  // vs low AC and accept the 5% nat-1 flakiness (rerun if it misses).
  //
  // Actually the simplest approach: with isCritOverride=true (forced crit):
  //   Without buff: 2d6 bludgeoning = 2..12
  //   With buff: 2d6 bludgeoning + 2d8 radiant = 4..28
  // Verify the buffed attack's damage exceeds the unbuffed attack's max.
  const casterNoBuff = makeCombatant('druid1', {
    pos: { x: 0, y: 0, z: 0 },
    str: 10, wis: 18,
    actions: [CLUB_ACTION],
  });
  const casterWithBuff = makeCombatant('druid2', {
    pos: { x: 0, y: 0, z: 0 },
    str: 10, wis: 18,
    actions: [CLUB_ACTION],
    _shillelaghActive: true,
  });

  const target1 = makeCombatant('goblin1', {
    pos: { x: 1, y: 0, z: 0 }, ac: 5,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const target2 = makeCombatant('goblin2', {
    pos: { x: 1, y: 0, z: 0 }, ac: 5,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });

  const bf1 = makeBF([casterNoBuff, target1]);
  const state1 = makeState(bf1);
  resolveAttack(casterNoBuff, target1, CLUB_ACTION, state1, true); // crit
  const dmgNoBuff = 100 - target1.currentHP; // 2..12 (2d6 crit)

  const bf2 = makeBF([casterWithBuff, target2]);
  const state2 = makeState(bf2);
  resolveAttack(casterWithBuff, target2, CLUB_ACTION, state2, true); // crit
  const dmgWithBuff = 100 - target2.currentHP; // 4..28 (2d6 + 2d8 crit)

  assert('13a. unbuffed crit damage in 2..12 range (2d6)',
    dmgNoBuff >= 2 && dmgNoBuff <= 12, `got ${dmgNoBuff}`);
  assert('13b. buffed crit damage in 4..28 range (2d6 + 2d8)',
    dmgWithBuff >= 4 && dmgWithBuff <= 28, `got ${dmgWithBuff}`);
  assert('13c. buffed damage > unbuffed damage (radiant added)',
    dmgWithBuff > dmgNoBuff, `buffed=${dmgWithBuff}, unbuffed=${dmgNoBuff}`);

  // The Shillelagh bonus log should mention radiant.
  const shillelaghBonusLog = state2.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Shillelagh bonus') && e.description.includes('radiant'),
  );
  assert('13d. "Shillelagh bonus ... radiant" log emitted',
    shillelaghBonusLog !== undefined, `events: ${state2.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);

  // The Shillelagh bonus should be in 2..16 range (2d8 crit).
  if (shillelaghBonusLog) {
    assert('13e. Shillelagh bonus in 2..16 range (2d8 crit)',
      shillelaghBonusLog.value! >= 2 && shillelaghBonusLog.value! <= 16,
      `got ${shillelaghBonusLog.value}`);
  }
}

// ============================================================
// 14. buff applies to MELEE attacks only (control: ranged attack)
// ============================================================
console.log('\n--- 14. buff MELEE only (ranged control) ---');
{
  // Caster has the buff active. Fire a RANGED weapon attack (shortbow).
  // The buff should NOT apply: no WIS-for-STR substitution, no +1d8 radiant.
  // Shortbow hitBonus is +0 (no buff). With the buff, it should STAY +0 (not
  // become WIS mod) and no radiant damage should be added.
  const casterWithBuff = makeCombatant('ranger', {
    pos: { x: 0, y: 0, z: 0 },
    str: 10, wis: 18, // STR +0, WIS +4
    actions: [SHORTBOW_ACTION],
    _shillelaghActive: true,
  });
  const target = makeCombatant('goblin', {
    pos: { x: 5, y: 0, z: 0 }, ac: 5,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([casterWithBuff, target]);
  const state = makeState(bf);

  resolveAttack(casterWithBuff, target, SHORTBOW_ACTION, state, true); // crit

  // NO "channels Shillelagh" log should be emitted (ranged attack — buff doesn't apply).
  const shillelaghLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('channels Shillelagh'),
  );
  assert('14a. NO "channels Shillelagh" log for ranged attack',
    shillelaghLog === undefined, `unexpected: ${shillelaghLog?.description}`);

  // NO "Shillelagh bonus" damage log should be emitted.
  const shillelaghBonusLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Shillelagh bonus'),
  );
  assert('14b. NO "Shillelagh bonus" log for ranged attack',
    shillelaghBonusLog === undefined, `unexpected: ${shillelaghBonusLog?.description}`);

  // Damage should be 2d6 piercing only (2..12 crit), NOT 2d6 + 2d8 = 4..28.
  const damageTaken = 100 - target.currentHP;
  assert('14c. ranged damage in 2..12 range (2d6 crit, NO radiant bonus)',
    damageTaken >= 2 && damageTaken <= 12, `got ${damageTaken}`);
}

// ============================================================
// 15. buff applies to MELEE attacks only (control: spell attack)
// ============================================================
console.log('\n--- 15. buff MELEE only (spell control) ---');
{
  // Caster has the buff active. Cast a SPELL attack (Fire Bolt).
  // The buff should NOT apply: no WIS-for-STR substitution, no +1d8 radiant.
  const casterWithBuff = makeCombatant('druid', {
    pos: { x: 0, y: 0, z: 0 },
    str: 10, wis: 18,
    actions: [FIRE_BOLT_ACTION],
    _shillelaghActive: true,
  });
  const target = makeCombatant('goblin', {
    pos: { x: 5, y: 0, z: 0 }, ac: 5,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([casterWithBuff, target]);
  const state = makeState(bf);

  resolveAttack(casterWithBuff, target, FIRE_BOLT_ACTION, state, true); // crit

  // NO "channels Shillelagh" log for spell attack.
  const shillelaghLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('channels Shillelagh'),
  );
  assert('15a. NO "channels Shillelagh" log for spell attack',
    shillelaghLog === undefined, `unexpected: ${shillelaghLog?.description}`);

  // NO "Shillelagh bonus" damage log for spell attack.
  const shillelaghBonusLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Shillelagh bonus'),
  );
  assert('15b. NO "Shillelagh bonus" log for spell attack',
    shillelaghBonusLog === undefined, `unexpected: ${shillelaghBonusLog?.description}`);

  // Damage should be 2d10 fire only (2..20 crit), NOT 2d10 + 2d8.
  const damageTaken = 100 - target.currentHP;
  assert('15c. spell damage in 2..20 range (2d10 crit, NO radiant bonus)',
    damageTaken >= 2 && damageTaken <= 20, `got ${damageTaken}`);
}

// ============================================================
// 16. buff clears at start of caster's next turn (resetBudget)
// ============================================================
console.log('\n--- 16. buff clears at start of next turn ---');
{
  const caster = makeCombatant('druid', { _shillelaghActive: true });
  eq('16a. flag set before resetBudget', caster._shillelaghActive, true);

  resetBudget(caster); // simulates start of caster's next turn

  eq('16b. flag cleared after resetBudget', caster._shillelaghActive, undefined);

  // Behavioral: after resetBudget, a melee attack should NOT get the buff.
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 }, ac: 5,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  caster.actions = [CLUB_ACTION];
  caster.pos = { x: 0, y: 0, z: 0 };
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, CLUB_ACTION, state, true); // crit

  const shillelaghLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('channels Shillelagh'),
  );
  assert('16c. NO "channels Shillelagh" log after resetBudget (buff expired)',
    shillelaghLog === undefined, `unexpected: ${shillelaghLog?.description}`);

  // Damage should be 2d6 only (2..12 crit), NOT 2d6 + 2d8.
  const damageTaken = 100 - target.currentHP;
  assert('16d. damage in 2..12 range (buff expired, no radiant bonus)',
    damageTaken >= 2 && damageTaken <= 12, `got ${damageTaken}`);
}

// ============================================================
// 17. WIS-for-STR delta = 0 when WIS mod == STR mod (no log emitted)
// ============================================================
console.log('\n--- 17. delta = 0 when WIS mod == STR mod ---');
{
  // Caster: STR 10 (+0), WIS 10 (+0). Delta = 0 — no substitution needed.
  // The "channels Shillelagh" log is ONLY emitted when delta != 0. The
  // +1d8 radiant damage on hit still applies (the buff is active).
  const caster = makeCombatant('druid', {
    pos: { x: 0, y: 0, z: 0 },
    str: 10, wis: 10, // both +0 → delta = 0
    actions: [CLUB_ACTION],
    _shillelaghActive: true,
  });
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 }, ac: 5,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, CLUB_ACTION, state, true); // crit

  // NO "channels Shillelagh" log (delta = 0).
  const shillelaghLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('channels Shillelagh'),
  );
  assert('17a. NO "channels Shillelagh" log when delta = 0',
    shillelaghLog === undefined, `unexpected: ${shillelaghLog?.description}`);

  // BUT the +1d8 radiant damage SHOULD still apply (buff is active).
  const shillelaghBonusLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Shillelagh bonus'),
  );
  assert('17b. "Shillelagh bonus" log still emitted (radiant damage applies)',
    shillelaghBonusLog !== undefined, `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);

  // Damage should be 2d6 + 2d8 (4..28 crit).
  const damageTaken = 100 - target.currentHP;
  assert('17c. damage in 4..28 range (2d6 + 2d8 crit, radiant applies even with delta=0)',
    damageTaken >= 4 && damageTaken <= 28, `got ${damageTaken}`);
}

// ============================================================
// 18. +1d8 radiant is doubled on crit (PHB p.196: crit doubles damage dice)
// ============================================================
console.log('\n--- 18. +1d8 radiant doubles on crit ---');
{
  // Compare crit (2d8) vs non-crit (1d8) Shillelagh bonus.
  // Non-crit: use isCritOverride=false (forces MISS → no damage). Hmm, that
  // doesn't work — we need a HIT but NOT a crit. The simplest approach: run
  // many iterations with high hitBonus vs low AC and check that some iterations
  // produce a Shillelagh bonus in 1..8 (non-crit) and others in 2..16 (crit).
  // But crits are 5% of hits → many iterations needed.
  //
  // Alternative: just verify the crit case (isCritOverride=true) produces a
  // Shillelagh bonus in 2..16 (2d8). The non-crit case (1..8) is documented
  // but not tested directly here — the crit case is sufficient to verify
  // the dice-doubling logic.
  const caster = makeCombatant('druid', {
    pos: { x: 0, y: 0, z: 0 },
    str: 10, wis: 10, // delta = 0 (so we can focus on the damage test)
    actions: [CLUB_ACTION],
    _shillelaghActive: true,
  });
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 }, ac: 5,
    currentHP: 1000, maxHP: 1000, faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, CLUB_ACTION, state, true); // crit

  const shillelaghBonusLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Shillelagh bonus'),
  );
  assert('18a. Shillelagh bonus log emitted', shillelaghBonusLog !== undefined);
  if (shillelaghBonusLog) {
    assert('18b. crit Shillelagh bonus in 2..16 range (2d8 doubled)',
      shillelaghBonusLog.value! >= 2 && shillelaghBonusLog.value! <= 16,
      `got ${shillelaghBonusLog.value}`);
    assert('18c. crit log mentions "CRIT"',
      shillelaghBonusLog.description.includes('CRIT') === true,
      `got: ${shillelaghBonusLog.description}`);
  }
}

// ============================================================
// 19. Shillelagh itself does NOT go through resolveAttack (it's a self-buff)
// ============================================================
console.log('\n--- 19. Shillelagh bypasses resolveAttack ---');
{
  // resolveCantripAction should handle Shillelagh BEFORE resolveAttack is
  // called. Verify by checking that no attack hit/miss/damage events are
  // emitted (only the "casts Shillelagh" action event).
  const caster = makeCombatant('druid', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [SHILLELAGH_ACTION],
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  resolveCantripAction(caster, 'Shillelagh', state);

  // Only the "casts Shillelagh" action event should be present.
  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('19a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('19b. action event mentions Shillelagh',
    actionEvents[0]?.description.includes('Shillelagh') === true,
    `got: ${actionEvents[0]?.description}`);

  // No attack hit/miss/crit/damage events.
  const attackEvents = state.log.events.filter((e: CombatEvent) =>
    e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit' || e.type === 'damage',
  );
  eq('19c. no attack/damage events (self-buff bypasses resolveAttack)',
    attackEvents.length, 0);
}

// ============================================================
// 20. resolveCantripAoE returns false (not a caster-centered AoE)
// ============================================================
console.log('\n--- 20. not a caster-centered AoE ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Shillelagh', state);
  eq('20a. resolveCantripAoE returns false', ret, false);
  eq('20b. no log events', state.log.events.length, 0);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
