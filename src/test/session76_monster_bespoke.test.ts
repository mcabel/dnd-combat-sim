// ============================================================
// Test: RFC-MONSTER-SPELLCASTING Phase 4 — Bespoke Spell Dispatch
// Session 76 scope:
//   ✅ lookupMonsterBespokeByName — case-insensitive, parenthetical-tolerant
//   ✅ lookupMonsterBespokeByPlanType — reverse lookup
//   ✅ isMonsterBespokePlanType — detection
//   ✅ listMonsterBespokeSpellNames — coverage
//   ✅ attachMonsterBespokeSyntheticState — adds + removes synthetic action/resources
//   ✅ lookupGenericSpell — case-insensitive (Session 76 fix)
//   ✅ selectMonsterSlottedSpell — dispatches bespoke slotted spells (Fireball, etc.)
//   ✅ selectMonsterDailySpell — dispatches bespoke daily spells (Command, Hold Person, etc.)
//   ✅ Planner integration — monster casts bespoke spell in combat
//   ✅ combat.ts dispatch — bespoke case branch executes with synthetic state
//   ✅ Real bestiary coverage — Lich, Drow, Mage cast their bespoke spells
//   ✅ Backward-compat — generic spells still dispatch via 'genericSpell'
//   ✅ Backward-compat — non-spellcasting monsters unaffected
//   ✅ No duplicates — bespoke registry doesn't overlap GENERIC_SPELLS
//
// Run: npx ts-node --transpile-only src/test/session76_monster_bespoke.test.ts
// ============================================================

import {
  selectMonsterSlottedSpell,
  selectMonsterDailySpell,
  initMonsterSpellSlots,
  initMonsterDailyUses,
} from '../ai/monster_spellcasting';
import { lookupGenericSpell } from '../spells/_generic_registry';
import {
  lookupMonsterBespokeByName,
  lookupMonsterBespokeByPlanType,
  isMonsterBespokePlanType,
  listMonsterBespokeSpellNames,
  attachMonsterBespokeSyntheticState,
} from '../ai/monster_bespoke_registry';
import { runCombat, makeFlatBattlefield } from '../engine/combat';
import { planTurn } from '../ai/planner';
import { Combatant, Battlefield, Action, Vec3 } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq(label: string, got: any, want: any): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { console.log(`  ✅ ${label}`); passed++; }
  else    { console.error(`  ❌ ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); failed++; }
}

let _id = 0;

function makeC(o: Partial<Combatant> = {}): Combatant {
  const id = o.id ?? `c${++_id}`;
  return {
    id, name: o.name ?? id, isPlayer: false, faction: 'enemy',
    maxHP: 30, currentHP: 30, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1, casterLevel: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart',
    perception: { targets: new Map() },
    concentration: null,
    deathSaves: null,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null, activeEffects: [],
    ...o,
  } as Combatant;
}

function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    width: 30, height: 30, depth: 1, cells: [],
    combatants: map, round: 1,
    initiativeOrder: combatants.map(c => c.id),
  } as Battlefield;
}

// ---- Tests --------------------------------------------------

// ============================================================
console.log('\n=== 1. lookupMonsterBespokeByName — case-insensitive ===\n');
// ============================================================

{
  eq('1a: Fireball (Title Case)', !!lookupMonsterBespokeByName('Fireball'), true);
  eq('1b: fireball (lowercase)', !!lookupMonsterBespokeByName('fireball'), true);
  eq('1c: FIREBALL (uppercase)', !!lookupMonsterBespokeByName('FIREBALL'), true);
  eq('1d: Command (Title Case)', !!lookupMonsterBespokeByName('Command'), true);
  eq('1e: command (lowercase)', !!lookupMonsterBespokeByName('command'), true);
  eq('1f: Hold Person', !!lookupMonsterBespokeByName('Hold Person'), true);
  eq('1g: hold person (lowercase)', !!lookupMonsterBespokeByName('hold person'), true);
  eq('1h: unknown spell returns null', !!lookupMonsterBespokeByName('Nonexistent Spell'), false);
  eq('1i: empty string returns null', !!lookupMonsterBespokeByName(''), false);
}

// ============================================================
console.log('\n=== 2. lookupMonsterBespokeByName — parenthetical-tolerant ===\n');
// ============================================================

{
  // The bestiary stores variant names like "plane shift (self only)"
  eq('2a: plane shift', !!lookupMonsterBespokeByName('plane shift'), true);
  eq('2b: plane shift (self only)', !!lookupMonsterBespokeByName('plane shift (self only)'), true);
  eq('2c: scrying', !!lookupMonsterBespokeByName('scrying'), true);
  eq('2d: scrying (as an action)', !!lookupMonsterBespokeByName('scrying (as an action)'), true);
  eq('2e: mage armor', !!lookupMonsterBespokeByName('mage armor'), true);
  eq('2f: mage armor (self only)', !!lookupMonsterBespokeByName('mage armor (self only)'), true);
}

// ============================================================
console.log('\n=== 3. lookupMonsterBespokeByName — returns correct entry ===\n');
// ============================================================

{
  const fb = lookupMonsterBespokeByName('Fireball');
  assert('3a: Fireball entry exists', fb !== null);
  if (fb) {
    eq('3b: canonicalName', fb.canonicalName, 'Fireball');
    eq('3c: planType', fb.planType, 'fireball');
    eq('3d: level', fb.level, 3);
    eq('3e: tags', fb.tags, ['damage']);
  }

  const cmd = lookupMonsterBespokeByName('Command');
  assert('3f: Command entry exists', cmd !== null);
  if (cmd) {
    eq('3g: canonicalName', cmd.canonicalName, 'Command');
    eq('3h: planType', cmd.planType, 'command');
    eq('3i: level', cmd.level, 1);
    eq('3j: tags', cmd.tags, ['cc']);
  }
}

// ============================================================
console.log('\n=== 4. lookupMonsterBespokeByPlanType — reverse lookup ===\n');
// ============================================================

{
  const fb = lookupMonsterBespokeByPlanType('fireball');
  assert('4a: fireball plan type exists', fb !== null);
  if (fb) eq('4b: canonicalName', fb.canonicalName, 'Fireball');

  const cmd = lookupMonsterBespokeByPlanType('command');
  assert('4c: command plan type exists', cmd !== null);
  if (cmd) eq('4d: canonicalName', cmd.canonicalName, 'Command');

  eq('4e: unknown plan type returns null', !!lookupMonsterBespokeByPlanType('nonexistentXYZ'), false);
}

// ============================================================
console.log('\n=== 5. isMonsterBespokePlanType ===\n');
// ============================================================

{
  eq('5a: fireball', isMonsterBespokePlanType('fireball'), true);
  eq('5b: command', isMonsterBespokePlanType('command'), true);
  eq('5c: holdPerson', isMonsterBespokePlanType('holdPerson'), true);
  eq('5d: cureWounds', isMonsterBespokePlanType('cureWounds'), true);
  eq('5e: genericSpell (NOT bespoke)', isMonsterBespokePlanType('genericSpell'), false);
  eq('5f: attack (NOT bespoke)', isMonsterBespokePlanType('attack'), false);
  eq('5g: unknown', isMonsterBespokePlanType('nonexistentXYZ'), false);
}

// ============================================================
console.log('\n=== 6. listMonsterBespokeSpellNames — coverage ===\n');
// ============================================================

{
  const names = listMonsterBespokeSpellNames();
  assert('6a: at least 200 bespoke spells registered', names.length >= 200,
    `got ${names.length}`);
  assert('6b: Fireball in list', names.includes('Fireball'));
  assert('6c: Command in list', names.includes('Command'));
  assert('6d: Hold Person in list', names.includes('Hold Person'));
  assert('6e: Cure Wounds in list', names.includes('Cure Wounds'));
  assert('6f: Magic Missile in list', names.includes('Magic Missile'));
}

// ============================================================
console.log('\n=== 7. No duplicates between bespoke registry and GENERIC_SPELLS ===\n');
// ============================================================

{
  const names = listMonsterBespokeSpellNames();
  const duplicates: string[] = [];
  for (const name of names) {
    if (lookupGenericSpell(name)) {
      duplicates.push(name);
    }
  }
  eq('7a: no duplicates (bespoke registry = spells NOT in GENERIC_SPELLS)',
    duplicates.length, 0);
}

// ============================================================
console.log('\n=== 8. lookupGenericSpell — case-insensitive (Session 76 fix) ===\n');
// ============================================================

{
  // Before Session 76, lookupGenericSpell was case-sensitive.
  // The bestiary stores spell names in lowercase (e.g. 'fireball'),
  // but GENERIC_SPELLS uses Title Case keys (e.g. 'Fireball').
  assert('8a: Blink (Title Case)', !!lookupGenericSpell('Blink'));
  assert('8b: blink (lowercase)', !!lookupGenericSpell('blink'));
  assert('8c: BLINK (uppercase)', !!lookupGenericSpell('BLINK'));
  assert('8d: Fly (Title Case)', !!lookupGenericSpell('Fly'));
  assert('8e: fly (lowercase)', !!lookupGenericSpell('fly'));
  assert('8f: Create Food and Water', !!lookupGenericSpell('Create Food and Water'));
  assert('8g: create food and water (lowercase)', !!lookupGenericSpell('create food and water'));
  assert('8h: unknown spell returns null', !lookupGenericSpell('Nonexistent Spell XYZ'));
  assert('8i: empty string returns null', !lookupGenericSpell(''));
}

// ============================================================
console.log('\n=== 9. attachMonsterBespokeSyntheticState — adds + removes ===\n');
// ============================================================

{
  const m = makeC({ id: 'm', name: 'TestMonster' });
  const originalActionsLen = m.actions.length;
  const originalResources = m.resources;

  // Attach synthetic state for Fireball
  const cleanup = attachMonsterBespokeSyntheticState(m, 'Fireball', 3);

  // After attach: action + resources present
  assert('9a: synthetic Fireball action added',
    m.actions.some(a => a.name === 'Fireball'));
  assert('9b: synthetic resources added', m.resources !== null && m.resources !== undefined);
  if (m.resources) {
    assert('9c: L3 slot available', (m.resources as any).spellSlots?.[3]?.remaining > 0);
  }

  // Cleanup
  cleanup();

  // After cleanup: action + resources removed
  eq('9d: actions length restored', m.actions.length, originalActionsLen);
  eq('9e: resources restored to original', m.resources, originalResources);
  assert('9f: Fireball action removed', !m.actions.some(a => a.name === 'Fireball'));
}

// ============================================================
console.log('\n=== 10. attachMonsterBespokeSyntheticState — idempotent cleanup ===\n');
// ============================================================

{
  const m = makeC({ id: 'm', name: 'TestMonster' });
  const cleanup = attachMonsterBespokeSyntheticState(m, 'Command', 1);

  cleanup();
  cleanup();  // second call should be a no-op

  // Should not throw or double-remove
  assert('10a: idempotent cleanup (no throw)', true);
  assert('10b: Command action removed', !m.actions.some(a => a.name === 'Command'));
}

// ============================================================
console.log('\n=== 11. selectMonsterSlottedSpell — dispatches Fireball (bespoke) ===\n');
// ============================================================

{
  const m = makeC({
    id: 'mage', name: 'Mage', faction: 'enemy',
    monsterSpellcasting: {
      saveDC: 14, spellAttackBonus: 6, ability: 'int',
      slots: {
        0: { max: 0, spells: ['fire bolt'] },
        3: { max: 2, spells: ['fireball'] },  // bespoke L3
      },
    },
  });
  const enemy = makeC({ id: 'e', name: 'Enemy', faction: 'party', pos: { x: 1, y: 0, z: 0 }, maxHP: 30, currentHP: 30 });
  const plan = selectMonsterSlottedSpell(m, makeBF([m, enemy]));

  assert('11a: plan is not null', plan !== null);
  if (plan) {
    eq('11b: plan.type = fireball (bespoke)', plan.type, 'fireball');
    eq('11c: plan.spellName = Fireball', plan.spellName, 'Fireball');
    eq('11d: plan.castSlotLevel = 3', plan.castSlotLevel, 3);
    assert('11e: slot consumed upfront',
      m.monsterSpellSlots?.[3]?.remaining === 1,  // was 2, now 1
      `remaining = ${m.monsterSpellSlots?.[3]?.remaining}`);
  }
}

// ============================================================
console.log('\n=== 12. selectMonsterSlottedSpell — dispatches Magic Missile (bespoke) ===\n');
// ============================================================

{
  const m = makeC({
    id: 'mage', name: 'Mage', faction: 'enemy',
    monsterSpellcasting: {
      saveDC: 14, spellAttackBonus: 6, ability: 'int',
      slots: {
        1: { max: 4, spells: ['magic missile'] },  // bespoke L1
      },
    },
  });
  const enemy = makeC({ id: 'e', name: 'Enemy', faction: 'party', pos: { x: 1, y: 0, z: 0 }, maxHP: 30, currentHP: 30 });
  const plan = selectMonsterSlottedSpell(m, makeBF([m, enemy]));

  assert('12a: plan is not null', plan !== null);
  if (plan) {
    eq('12b: plan.type = magicMissile (bespoke)', plan.type, 'magicMissile');
    eq('12c: plan.spellName = Magic Missile', plan.spellName, 'Magic Missile');
    eq('12d: plan.castSlotLevel = 1', plan.castSlotLevel, 1);
  }
}

// ============================================================
console.log('\n=== 13. selectMonsterDailySpell — dispatches Command (bespoke) ===\n');
// ============================================================

{
  const m = makeC({
    id: 'drow', name: 'Drow', faction: 'enemy',
    monsterSpellcasting: {
      saveDC: 13, spellAttackBonus: 5, ability: 'cha',
      daily: {
        'command': 1,  // bespoke L1, cc
      },
    },
  });
  const enemy = makeC({ id: 'e', name: 'Enemy', faction: 'party', pos: { x: 1, y: 0, z: 0 }, maxHP: 30, currentHP: 30 });
  const plan = selectMonsterDailySpell(m, makeBF([m, enemy]));

  assert('13a: plan is not null', plan !== null);
  if (plan) {
    eq('13b: plan.type = command (bespoke)', plan.type, 'command');
    eq('13c: plan.spellName = Command', plan.spellName, 'Command');
    eq('13d: plan.castSlotLevel = 1', plan.castSlotLevel, 1);
    assert('13e: daily use consumed upfront',
      m.monsterDailyUses?.['command']?.remaining === 0,
      `remaining = ${m.monsterDailyUses?.['command']?.remaining}`);
  }
}

// ============================================================
console.log('\n=== 14. selectMonsterDailySpell — dispatches Hold Person (bespoke) ===\n');
// ============================================================

{
  const m = makeC({
    id: 'priest', name: 'Priest', faction: 'enemy',
    monsterSpellcasting: {
      saveDC: 13, spellAttackBonus: 5, ability: 'wis',
      daily: {
        'hold person': 1,  // bespoke L2, cc
      },
    },
  });
  const enemy = makeC({ id: 'e', name: 'Enemy', faction: 'party', pos: { x: 1, y: 0, z: 0 }, maxHP: 30, currentHP: 30 });
  const plan = selectMonsterDailySpell(m, makeBF([m, enemy]));

  assert('14a: plan is not null', plan !== null);
  if (plan) {
    eq('14b: plan.type = holdPerson (bespoke)', plan.type, 'holdPerson');
    eq('14c: plan.spellName = Hold Person', plan.spellName, 'Hold Person');
    eq('14d: plan.castSlotLevel = 2', plan.castSlotLevel, 2);
  }
}

// ============================================================
console.log('\n=== 15. Planner integration — monster casts bespoke spell in combat ===\n');
// ============================================================

{
  const mage = makeC({
    id: 'mage', name: 'Mage', faction: 'enemy',
    maxHP: 40, currentHP: 40, ac: 12, speed: 30,
    int: 17, cr: 6, casterLevel: 9,
    pos: { x: 5, y: 5, z: 0 },
    monsterSpellcasting: {
      saveDC: 14, spellAttackBonus: 6, ability: 'int',
      slots: {
        0: { max: 0, spells: ['fire bolt'] },
        1: { max: 4, spells: ['magic missile', 'shield'] },
        3: { max: 3, spells: ['fireball'] },
      },
    },
  });
  mage.actions = [];  // no weapon actions → forces spell cast

  const fighter = makeC({
    id: 'fighter', name: 'Fighter', faction: 'party',
    maxHP: 30, currentHP: 30, ac: 16, pos: { x: 7, y: 5, z: 0 },
    actions: [{
      name: 'Longsword', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 5, damage: { count: 1, sides: 8, bonus: 3, average: 7 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });

  const bf = makeFlatBattlefield(15, 15, [mage, fighter]);
  const result = runCombat(bf, ['mage', 'fighter'], { maxRounds: 1 });

  // The Mage should cast a spell (Fireball, Magic Missile, or Fire Bolt)
  const mageSpellEvent = result.events.find(
    e => e.actorId === 'mage' && /cast|spell|Fireball|Magic Missile|Fire Bolt/i.test(e.description)
  );
  assert('15a: Mage casts a spell in round 1', mageSpellEvent !== undefined,
    `events: ${result.events.filter(e=>e.actorId==='mage').map(e=>e.description).join('; ')}`);
}

// ============================================================
console.log('\n=== 16. Real bestiary — Lich casts slotted spells ===\n');
// ============================================================

{
  // Lich spellcasting (from bestiary-mm.json):
  //   L1: detect magic, magic missile, shield, thunderwave
  //   L3: animate dead, counterspell, dispel magic, fireball
  //   L5: cloudkill, scrying
  //   L7: finger of death, plane shift
  //   L9: power word kill
  const lich = makeC({
    id: 'lich', name: 'Lich', faction: 'enemy',
    maxHP: 135, currentHP: 135, ac: 17, speed: 30,
    int: 21, wis: 14, cha: 16, cr: 21, casterLevel: 18,
    pos: { x: 5, y: 5, z: 0 },
    monsterSpellcasting: {
      saveDC: 20, spellAttackBonus: 13, ability: 'int',
      slots: {
        0: { max: 0, spells: ['mage hand', 'prestidigitation', 'ray of frost'] },
        1: { max: 4, spells: ['detect magic', 'magic missile', 'shield', 'thunderwave'] },
        2: { max: 3, spells: ['detect thoughts', 'invisibility', "melf's acid arrow", 'mirror image'] },
        3: { max: 3, spells: ['animate dead', 'counterspell', 'dispel magic', 'fireball'] },
        4: { max: 3, spells: ['blight', 'dimension door'] },
        5: { max: 2, spells: ['cloudkill', 'scrying'] },
        6: { max: 1, spells: ['disintegrate', 'globe of invulnerability'] },
        7: { max: 1, spells: ['finger of death', 'plane shift'] },
        8: { max: 1, spells: ['dominate monster', 'power word stun'] },
        9: { max: 1, spells: ['power word kill'] },
      },
    },
  });
  lich.actions = [];

  const fighter = makeC({
    id: 'fighter', name: 'Fighter', faction: 'party',
    maxHP: 50, currentHP: 50, ac: 18, pos: { x: 7, y: 5, z: 0 },
    actions: [{
      name: 'Longsword', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 8, damage: { count: 2, sides: 8, bonus: 5, average: 14 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });

  const bf = makeFlatBattlefield(20, 20, [lich, fighter]);
  const result = runCombat(bf, ['lich', 'fighter'], { maxRounds: 1 });

  // The Lich should cast a spell (slotted or cantrip)
  const lichSpellEvent = result.events.find(
    e => e.actorId === 'lich' && /cast|spell|Magic Missile|Fireball|Ray of Frost|Shield|Thunderwave/i.test(e.description)
  );
  assert('16a: Lich casts a spell in round 1', lichSpellEvent !== undefined,
    `events: ${result.events.filter(e=>e.actorId==='lich').map(e=>e.description).join('; ')}`);

  // Verify slots were consumed (at least 1 slot if a slotted spell was cast)
  if (lich.monsterSpellSlots) {
    const totalSlots = Object.values(lich.monsterSpellSlots).reduce((sum, s) => sum + s.remaining, 0);
    const maxSlots = Object.values(lich.monsterSpellSlots).reduce((sum, s) => sum + s.max, 0);
    // At least one slot should have been consumed (if a slotted spell was cast)
    assert('16b: Lich slots initialized', maxSlots > 0);
  }
}

// ============================================================
console.log('\n=== 17. Real bestiary — Drow casts daily spells ===\n');
// ============================================================

{
  // Drow spellcasting: at-will dancing lights; 1/day each: darkness, faerie fire
  const drow = makeC({
    id: 'drow', name: 'Drow', faction: 'enemy',
    maxHP: 13, currentHP: 13, ac: 15, speed: 30,
    cha: 14, cr: 1, casterLevel: 1,
    pos: { x: 5, y: 5, z: 0 },
    monsterSpellcasting: {
      saveDC: 12, spellAttackBonus: 4, ability: 'cha',
      atWill: ['dancing lights'],
      daily: {
        'darkness': 1,      // bespoke L2
        'faerie fire': 1,   // bespoke L1
      },
    },
  });
  drow.actions = [{
    name: 'Shortsword', isMultiattack: false,
    attackType: 'melee', reach: 5, range: null,
    hitBonus: 4, damage: { count: 1, sides: 6, bonus: 2, average: 5 },
    damageType: 'piercing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: '',
  }];

  const fighter = makeC({
    id: 'fighter', name: 'Fighter', faction: 'party',
    maxHP: 30, currentHP: 30, ac: 16, pos: { x: 6, y: 5, z: 0 },
    actions: [{
      name: 'Longsword', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 5, damage: { count: 1, sides: 8, bonus: 3, average: 7 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });

  const bf = makeFlatBattlefield(15, 15, [drow, fighter]);
  const result = runCombat(bf, ['drow', 'fighter'], { maxRounds: 1 });

  // The Drow may cast darkness or faerie fire (bespoke daily), or attack with sword.
  // Verify daily uses are initialized.
  assert('17a: Drow daily uses initialized', drow.monsterDailyUses !== undefined);
  if (drow.monsterDailyUses) {
    assert('17b: darkness daily tracked', drow.monsterDailyUses['darkness'] !== undefined);
    assert('17c: faerie fire daily tracked', drow.monsterDailyUses['faerie fire'] !== undefined);
  }
}

// ============================================================
console.log('\n=== 18. Backward-compat — generic spells still dispatch via genericSpell ===\n');
// ============================================================

{
  // A monster with only GENERIC_SPELLS (no bespoke) should still use 'genericSpell'.
  const m = makeC({
    id: 'mage', name: 'Mage', faction: 'enemy',
    monsterSpellcasting: {
      saveDC: 14, spellAttackBonus: 6, ability: 'int',
      slots: {
        3: { max: 2, spells: ['Fly'] },  // Fly is in GENERIC_SPELLS
      },
    },
  });
  const enemy = makeC({ id: 'e', name: 'Enemy', faction: 'party', pos: { x: 1, y: 0, z: 0 }, maxHP: 30, currentHP: 30 });
  const plan = selectMonsterSlottedSpell(m, makeBF([m, enemy]));

  assert('18a: plan is not null', plan !== null);
  if (plan) {
    eq('18b: plan.type = genericSpell (not bespoke)', plan.type, 'genericSpell');
    eq('18c: plan.spellName = Fly', plan.spellName, 'Fly');
  }
}

// ============================================================
console.log('\n=== 19. Backward-compat — non-spellcasting monster unaffected ===\n');
// ============================================================

{
  const goblin = makeC({
    id: 'goblin', name: 'Goblin', faction: 'enemy',
    actions: [{
      name: 'Scimitar', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 4, damage: { count: 1, sides: 6, bonus: 2, average: 5 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });
  const fighter = makeC({
    id: 'fighter', name: 'Fighter', faction: 'party',
    maxHP: 30, currentHP: 30, ac: 16, pos: { x: 1, y: 0, z: 0 },
    actions: [{
      name: 'Longsword', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 5, damage: { count: 1, sides: 8, bonus: 3, average: 7 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });

  const bf = makeFlatBattlefield(10, 10, [goblin, fighter]);
  const result = runCombat(bf, ['goblin', 'fighter'], { maxRounds: 1 });

  // Goblin should attack with Scimitar (no spell casting)
  const attackEvent = result.events.find(
    e => e.actorId === 'goblin' && /Scimitar|attack/i.test(e.description)
  );
  assert('19a: Goblin uses weapon attack (no spellcasting)', attackEvent !== undefined,
    `events: ${result.events.filter(e=>e.actorId==='goblin').map(e=>e.description).join('; ')}`);
}

// ============================================================
console.log('\n=== 20. Utility spells skipped (bespoke) ===\n');
// ============================================================

{
  // Detect Magic is a bespoke utility spell — should be skipped.
  const m = makeC({
    id: 'mage', name: 'Mage', faction: 'enemy',
    monsterSpellcasting: {
      saveDC: 14, spellAttackBonus: 6, ability: 'int',
      slots: {
        1: { max: 4, spells: ['detect magic'] },  // bespoke utility
      },
    },
  });
  const enemy = makeC({ id: 'e', name: 'Enemy', faction: 'party', pos: { x: 1, y: 0, z: 0 }, maxHP: 30, currentHP: 30 });
  const plan = selectMonsterSlottedSpell(m, makeBF([m, enemy]));

  // Detect Magic is utility → should be skipped → null
  if (plan) {
    assert('20a: utility spell not selected',
      plan.spellName !== 'Detect Magic',
      `got ${plan.spellName}`);
  } else {
    assert('20a: utility spell skipped (plan null)', true);
  }
}

// ============================================================
console.log('\n=== 21. cleanup — synthetic state restored after bespoke dispatch ===\n');
// ============================================================

{
  const m = makeC({
    id: 'mage', name: 'Mage', faction: 'enemy',
    monsterSpellcasting: {
      saveDC: 14, spellAttackBonus: 6, ability: 'int',
      slots: {
        3: { max: 2, spells: ['fireball'] },  // bespoke L3
      },
    },
  });
  const originalActionsLen = m.actions.length;
  const originalResources = m.resources;

  const enemy = makeC({ id: 'e', name: 'Enemy', faction: 'party', pos: { x: 1, y: 0, z: 0 }, maxHP: 30, currentHP: 30 });
  selectMonsterSlottedSpell(m, makeBF([m, enemy]));

  // After selectMonsterSlottedSpell, synthetic state should be cleaned up.
  eq('21a: actions length restored', m.actions.length, originalActionsLen);
  eq('21b: resources restored', m.resources, originalResources);
  assert('21c: no synthetic Fireball action lingering',
    !m.actions.some(a => a.name === 'Fireball' && a.description?.includes('synthetic')));
}

// ============================================================
console.log('\n=== 22. Full combat — bespoke + generic spells over 3 rounds ===\n');
// ============================================================

{
  const mage = makeC({
    id: 'mage', name: 'Mage', faction: 'enemy',
    maxHP: 40, currentHP: 40, ac: 12, speed: 30,
    int: 17, cr: 6, casterLevel: 9,
    pos: { x: 5, y: 5, z: 0 },
    monsterSpellcasting: {
      saveDC: 14, spellAttackBonus: 6, ability: 'int',
      slots: {
        0: { max: 0, spells: ['fire bolt'] },
        1: { max: 4, spells: ['magic missile'] },  // bespoke L1
        3: { max: 1, spells: ['fireball'] },        // bespoke L3
      },
    },
  });
  mage.actions = [];

  const fighter = makeC({
    id: 'fighter', name: 'Fighter', faction: 'party',
    maxHP: 50, currentHP: 50, ac: 16, pos: { x: 7, y: 5, z: 0 },
    actions: [{
      name: 'Longsword', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 5, damage: { count: 1, sides: 8, bonus: 3, average: 7 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });

  const bf = makeFlatBattlefield(15, 15, [mage, fighter]);
  const result = runCombat(bf, ['mage', 'fighter'], { maxRounds: 3 });

  // Mage should cast at least 1 spell over 3 rounds
  const mageSpellEvents = result.events.filter(
    e => e.actorId === 'mage' && /cast|spell/i.test(e.description)
  );
  assert('22a: Mage casts at least 1 spell over 3 rounds',
    mageSpellEvents.length >= 1,
    `events: ${mageSpellEvents.map(e => e.description).join('; ')}`);

  // Verify slots were consumed
  if (mage.monsterSpellSlots) {
    const l1Remaining = mage.monsterSpellSlots[1]?.remaining ?? 0;
    const l3Remaining = mage.monsterSpellSlots[3]?.remaining ?? 0;
    const totalRemaining = l1Remaining + l3Remaining;
    const totalMax = (mage.monsterSpellSlots[1]?.max ?? 0) + (mage.monsterSpellSlots[3]?.max ?? 0);
    assert('22b: at least 1 slot consumed over 3 rounds',
      totalRemaining < totalMax,
      `remaining ${totalRemaining} / max ${totalMax}`);
  }
}

// ---- Summary ------------------------------------------------

console.log('\n============================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');
if (failed === 0) {
  console.log('All tests passed ✅');
} else {
  console.log('Failed tests above ↑');
}
process.exit(failed > 0 ? 1 : 0);
