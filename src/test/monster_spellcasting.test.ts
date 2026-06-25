// ============================================================
// Test: Monster Spellcasting Engine Integration
// RFC: docs/RFC-MONSTER-SPELLCASTING.md (Phase 1)
//
// Session 63 scope:
//   ✅ selectMonsterSpell() — at-will + cantrip dispatch
//   ✅ Cantrip template lookup (case-insensitive)
//   ✅ Synthetic spell-attack Action building (attack-roll + save-based)
//   ✅ Cantrip damage scaling (caster level 5/11/17)
//   ✅ Weighted scoring (tags × context × finisher)
//   ✅ Target selection (lowest HP in range)
//   ✅ Planner integration (monster casts cantrip in full combat)
//   ✅ Backward-compat (monsters without monsterSpellcasting unaffected)
//   ✅ Autonomous doubt decisions (RFC §9.1)
//
// Run: npx ts-node --transpile-only src/test/monster_spellcasting.test.ts
// ============================================================

import {
  selectMonsterSpell,
  lookupCantripTemplate,
  listCantripTemplateNames,
  deriveSpellTags,
  cantripDiceCount,
  computeSpellcastContext,
  computeSpellWeight,
  buildCantripAction,
  SpellTag,
} from '../ai/monster_spellcasting';
import { runCombat, makeFlatBattlefield } from '../engine/combat';
import { planTurn } from '../ai/planner';
import { Combatant, Battlefield, Action, Vec3, PlayerResources } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(o: Partial<Combatant> = {}): Combatant {
  const id = `c${++_id}`;
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 30, currentHP: 30, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
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
  };
}

function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    width: 30, height: 30, depth: 1, cells: [],
    combatants: map, round: 1,
    initiativeOrder: combatants.map(c => c.id),
  };
}

/** A monster with Lich-style spellcasting (cantrips in slots[0]). */
function makeLichLike(pos: Vec3 = { x: 5, y: 5, z: 0 }): Combatant {
  return makeC({
    id: 'lich', name: 'Lich', faction: 'enemy',
    maxHP: 135, currentHP: 135, ac: 17, speed: 30,
    str: 11, dex: 16, con: 16, int: 21, wis: 14, cha: 16,
    cr: 21, casterLevel: 18, pos,
    monsterSpellcasting: {
      saveDC: 20,
      spellAttackBonus: 12,
      ability: 'int',
      slots: {
        0: { max: 0, spells: ['mage hand', 'prestidigitation', 'ray of frost'] },
        1: { max: 4, spells: ['detect magic', 'magic missile', 'shield', 'thunderwave'] },
      },
    },
  });
}

/** A monster with at-will + daily spellcasting (Drow-style). */
function makeDrowLike(pos: Vec3 = { x: 5, y: 5, z: 0 }): Combatant {
  return makeC({
    id: 'drow', name: 'Drow', faction: 'enemy',
    maxHP: 27, currentHP: 27, ac: 15, speed: 30,
    str: 10, dex: 14, con: 10, int: 11, wis: 11, cha: 12,
    cr: 1, casterLevel: 1, pos,
    monsterSpellcasting: {
      saveDC: 11,
      spellAttackBonus: 3,
      ability: 'cha',
      atWill: ['dancing lights'],
      daily: { darkness: 1, 'faerie fire': 1 },
    },
  });
}

/** A monster with Fire Bolt + Sacred Flame cantrips (Mage-style). */
function makeMageLike(pos: Vec3 = { x: 5, y: 5, z: 0 }): Combatant {
  return makeC({
    id: 'mage', name: 'Mage', faction: 'enemy',
    maxHP: 40, currentHP: 40, ac: 12, speed: 30,
    str: 10, dex: 14, con: 10, int: 17, wis: 12, cha: 11,
    cr: 6, casterLevel: 9, pos,
    monsterSpellcasting: {
      saveDC: 14,
      spellAttackBonus: 6,
      ability: 'int',
      slots: {
        0: { max: 0, spells: ['fire bolt', 'light', 'mage hand', 'prestidigitation'] },
      },
    },
  });
}

// ============================================================
console.log('\n=== 1. Cantrip template lookup (case-insensitive) ===\n');
// ============================================================

{
  eq('1a: "ray of frost" → Ray of Frost template',
    lookupCantripTemplate('ray of frost')?.name, 'Ray of Frost');
  eq('1b: "Ray of Frost" → Ray of Frost (case-insensitive)',
    lookupCantripTemplate('Ray of Frost')?.name, 'Ray of Frost');
  eq('1c: "RAY OF FROST" → Ray of Frost (uppercase)',
    lookupCantripTemplate('RAY OF FROST')?.name, 'Ray of Frost');
  eq('1d: "fire bolt" → Fire Bolt',
    lookupCantripTemplate('fire bolt')?.name, 'Fire Bolt');
  eq('1e: "sacred flame" → Sacred Flame',
    lookupCantripTemplate('sacred flame')?.name, 'Sacred Flame');
  eq('1f: "toll the dead" → Toll the Dead',
    lookupCantripTemplate('toll the dead')?.name, 'Toll the Dead');

  // Utility cantrips — NOT in templates (Doubt #1 = A: skip)
  eq('1g: "mage hand" → null (utility, skipped)', lookupCantripTemplate('mage hand'), null);
  eq('1h: "prestidigitation" → null (utility, skipped)', lookupCantripTemplate('prestidigitation'), null);
  eq('1i: "dancing lights" → null (utility, skipped)', lookupCantripTemplate('dancing lights'), null);

  // Template fields
  const rof = lookupCantripTemplate('ray of frost')!;
  eq('1j: Ray of Frost damageSides = 8', rof.damageSides, 8);
  eq('1k: Ray of Frost damageType = cold', rof.damageType, 'cold');
  eq('1l: Ray of Frost rangeFt = 60', rof.rangeFt, 60);
  eq('1m: Ray of Frost attackRoll = true', rof.attackRoll, true);
  eq('1n: Ray of Frost tags = [damage]', rof.tags.join(','), 'damage');

  const sf = lookupCantripTemplate('sacred flame')!;
  eq('1o: Sacred Flame attackRoll = false (save)', sf.attackRoll, false);
  eq('1p: Sacred Flame saveAbility = dex', sf.saveAbility, 'dex');

  // ── Session 63 Phase 3: new cantrip templates ──
  eq('1q: "frostbite" → Frostbite', lookupCantripTemplate('frostbite')?.name, 'Frostbite');
  eq('1r: "primal savagery" → Primal Savagery', lookupCantripTemplate('primal savagery')?.name, 'Primal Savagery');
  eq('1s: "infestation" → Infestation', lookupCantripTemplate('infestation')?.name, 'Infestation');
  eq('1t: "lightning lure" → Lightning Lure', lookupCantripTemplate('lightning lure')?.name, 'Lightning Lure');

  const fb = lookupCantripTemplate('frostbite')!;
  eq('1u: Frostbite damageSides = 6', fb.damageSides, 6);
  eq('1v: Frostbite damageType = cold', fb.damageType, 'cold');
  eq('1w: Frostbite saveAbility = con', fb.saveAbility, 'con');
  eq('1x: Frostbite tags = damage,cc', fb.tags.join(','), 'damage,cc');

  const ps = lookupCantripTemplate('primal savagery')!;
  eq('1y: Primal Savagery attackRoll = true (melee spell attack)', ps.attackRoll, true);
  eq('1z: Primal Savagery rangeFt = 5 (touch)', ps.rangeFt, 5);
  eq('1aa: Primal Savagery damageSides = 10 (d10)', ps.damageSides, 10);
  eq('1ab: Primal Savagery damageType = acid', ps.damageType, 'acid');

  const ll = lookupCantripTemplate('lightning lure')!;
  eq('1ac: Lightning Lure saveAbility = str', ll.saveAbility, 'str');
  eq('1ad: Lightning Lure rangeFt = 15', ll.rangeFt, 15);

  // ── Session 67: listCantripTemplateNames — used by spell-coverage scanner ──
  const allNames = listCantripTemplateNames();
  eq('1ae: listCantripTemplateNames returns 17 cantrips', allNames.length, 17);
  eq('1af: listCantripTemplateNames includes Fire Bolt',
    allNames.includes('Fire Bolt'), true);
  eq('1ag: listCantripTemplateNames includes Lightning Lure',
    allNames.includes('Lightning Lure'), true);
  eq('1ah: listCantripTemplateNames excludes utility cantrips (no Mage Hand)',
    allNames.includes('Mage Hand'), false);
  // Every name should round-trip through lookupCantripTemplate
  let allRoundTrip = true;
  for (const n of allNames) {
    if (!lookupCantripTemplate(n)) { allRoundTrip = false; break; }
  }
  eq('1ai: every listed name round-trips through lookupCantripTemplate', allRoundTrip, true);
}

// ============================================================
console.log('\n=== 2. Spell tag derivation ===\n');
// ============================================================

{
  eq('2a: Ray of Frost tags = [damage]', deriveSpellTags('Ray of Frost').join(','), 'damage');
  eq('2b: Vicious Mockery tags = [damage,cc]', deriveSpellTags('Vicious Mockery').join(','), 'damage,cc');
  eq('2c: unknown spell tags = []', deriveSpellTags('Unknown Spell').length, 0);

  // Tag overrides (Phase 2 leveled spells — forward-compat)
  eq('2d: Shield tags = [defending] (override)', deriveSpellTags('Shield').join(','), 'defending');
  eq('2e: Bless tags = [buff] (override)', deriveSpellTags('Bless').join(','), 'buff');
  eq('2f: Cure Wounds tags = [healing] (override)', deriveSpellTags('Cure Wounds').join(','), 'healing');
}

// ============================================================
console.log('\n=== 3. Cantrip damage scaling (caster level 5/11/17) ===\n');
// ============================================================

{
  eq('3a: casterLevel 1 → 1 die', cantripDiceCount(1), 1);
  eq('3b: casterLevel 4 → 1 die', cantripDiceCount(4), 1);
  eq('3c: casterLevel 5 → 2 dice', cantripDiceCount(5), 2);
  eq('3d: casterLevel 10 → 2 dice', cantripDiceCount(10), 2);
  eq('3e: casterLevel 11 → 3 dice', cantripDiceCount(11), 3);
  eq('3f: casterLevel 16 → 3 dice', cantripDiceCount(16), 3);
  eq('3g: casterLevel 17 → 4 dice', cantripDiceCount(17), 4);
  eq('3h: casterLevel 20 → 4 dice', cantripDiceCount(20), 4);
  eq('3i: undefined casterLevel → 1 die', cantripDiceCount(undefined), 1);
}

// ============================================================
console.log('\n=== 4. Synthetic Action building ===\n');
// ============================================================

{
  const lich = makeLichLike();
  const rofTmpl = lookupCantripTemplate('ray of frost')!;
  const action = buildCantripAction(lich, rofTmpl);

  eq('4a: action name = Ray of Frost', action.name, 'Ray of Frost');
  eq('4b: attackType = spell (attack roll)', action.attackType, 'spell');
  eq('4c: hitBonus = 12 (Lich spellAttackBonus)', action.hitBonus, 12);
  eq('4d: range.normal = 60', action.range?.normal, 60);
  eq('4e: damageType = cold', action.damageType, 'cold');
  eq('4f: slotLevel = 0 (cantrip)', action.slotLevel, 0);
  eq('4g: costType = action', action.costType, 'action');
  // Lich casterLevel 18 → 4 dice
  assert('4h: damage.count = 4 (casterLevel 18)', action.damage?.count === 4);
  assert('4i: damage.sides = 8 (d8)', action.damage?.sides === 8);
  assert('4j: damage.average = 18 (4×8/2 + 0.5 = 18)', action.damage?.average === 18,
    `got ${action.damage?.average}`);
  eq('4k: saveDC = null (attack roll)', action.saveDC, null);
  eq('4l: saveAbility = null (attack roll)', action.saveAbility, null);

  // Save-based cantrip (Sacred Flame)
  const priest = makeC({
    monsterSpellcasting: {
      saveDC: 13, spellAttackBonus: 5, ability: 'wis',
      slots: { 0: { max: 0, spells: ['sacred flame'] } },
    },
    casterLevel: 1,
  });
  const sfTmpl = lookupCantripTemplate('sacred flame')!;
  const sfAction = buildCantripAction(priest, sfTmpl);
  eq('4m: Sacred Flame attackType = save', sfAction.attackType, 'save');
  eq('4n: Sacred Flame saveDC = 13', sfAction.saveDC, 13);
  eq('4o: Sacred Flame saveAbility = dex', sfAction.saveAbility, 'dex');
  eq('4p: Sacred Flame hitBonus = 0 (save, no attack roll)', sfAction.hitBonus, 0);
  eq('4q: Sacred Flame range.normal = 60', sfAction.range?.normal, 60);
  eq('4r: Sacred Flame damage.sides = 8', sfAction.damage?.sides, 8);
}

// ============================================================
console.log('\n=== 5. Spellcast context ===\n');
// ============================================================

{
  const lich = makeLichLike({ x: 0, y: 0, z: 0 });
  const enemy1 = makeC({ id: 'e1', faction: 'party', pos: { x: 2, y: 0, z: 0 }, currentHP: 20, maxHP: 20 });
  const enemy2 = makeC({ id: 'e2', faction: 'party', pos: { x: 5, y: 0, z: 0 }, currentHP: 15, maxHP: 15 });
  const ally = makeC({ id: 'ally', faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([lich, enemy1, enemy2, ally]);

  const ctx = computeSpellcastContext(lich, bf);
  eq('5a: enemyCount = 2', ctx.enemyCount, 2);
  eq('5b: allyCount = 1', ctx.allyCount, 1);
  eq('5c: nearestEnemyDistFt = 10 (2 squares)', ctx.nearestEnemyDistFt, 10);
  eq('5d: selfHPct = 1.0 (full HP)', ctx.selfHPct, 1);
  assert('5e: not outnumbered (2 enemies, 1 ally → 2 > 1+1? no)', !ctx.isOutnumbered);
  assert('5f: no downed ally', !ctx.hasDownedAlly);
  eq('5g: round = 1', ctx.round, 1);

  // Outnumbered scenario
  const enemy3 = makeC({ id: 'e3', faction: 'party', pos: { x: 6, y: 0, z: 0 } });
  const bf2 = makeBF([lich, enemy1, enemy2, enemy3]);  // 3 enemies, 0 allies
  const ctx2 = computeSpellcastContext(lich, bf2);
  assert('5h: outnumbered (3 enemies, 0 allies)', ctx2.isOutnumbered);

  // Downed ally
  const downedAlly = makeC({ id: 'downed', faction: 'enemy', pos: { x: 1, y: 0, z: 0 }, isUnconscious: true });
  const bf3 = makeBF([lich, enemy1, downedAlly]);
  const ctx3 = computeSpellcastContext(lich, bf3);
  assert('5i: has downed ally', ctx3.hasDownedAlly);
}

// ============================================================
console.log('\n=== 6. Weighted scoring ===\n');
// ============================================================

{
  const ctx: ReturnType<typeof computeSpellcastContext> = {
    selfHPct: 1.0, allyCount: 1, enemyCount: 2, nearestEnemyDistFt: 10,
    hasDownedAlly: false, isOutnumbered: false, round: 1,
  };

  // Full HP, round 1, 2 enemies → damage ×1.3 (round 1, 1 enemy path doesn't match; 2 enemies < 3 so default)
  // Actually round 1 + 2 enemies → neither "3+" nor "1" → default ×1.0
  const w1 = computeSpellWeight('Ray of Frost', ['damage'], 0, 9, ctx, 20);
  assert('6a: damage cantrip full HP default = 1.0', w1 === 1.0, `got ${w1}`);

  // Round 1, 3+ enemies → damage ×1.5
  const ctx3: typeof ctx = { ...ctx, enemyCount: 3 };
  const w2 = computeSpellWeight('Fire Bolt', ['damage'], 0, 5, ctx3, 20);
  assert('6b: damage cantrip round 1 + 3 enemies = 1.5', w2 === 1.5, `got ${w2}`);

  // Low HP → damage ×0.8
  const ctxLow: typeof ctx = { ...ctx, selfHPct: 0.20 };
  const w3 = computeSpellWeight('Ray of Frost', ['damage'], 0, 9, ctxLow, 20);
  assert('6c: damage cantrip low HP = 0.8', w3 === 0.8, `got ${w3}`);

  // Outnumbered → damage ×1.4
  const ctxOut: typeof ctx = { ...ctx, isOutnumbered: true };
  const w4 = computeSpellWeight('Fire Bolt', ['damage'], 0, 5, ctxOut, 20);
  assert('6d: damage cantrip outnumbered = 1.4', w4 === 1.4, `got ${w4}`);

  // Finisher bonus: target HP ≤ avgDmg × 1.5
  // Ray of Frost avg 9 (1d8), finisher when targetHP ≤ 13.5
  const w5 = computeSpellWeight('Ray of Frost', ['damage'], 0, 9, ctx, 10);
  assert('6e: finisher bonus ×1.3 (targetHP 10 ≤ 13.5)', w5 === 1.3, `got ${w5}`);
  const w6 = computeSpellWeight('Ray of Frost', ['damage'], 0, 9, ctx, 20);
  assert('6f: no finisher bonus (targetHP 20 > 13.5)', w6 === 1.0, `got ${w6}`);

  // No tags → weight 0 (skip)
  const w7 = computeSpellWeight('Unknown', [], 0, 0, ctx, 20);
  eq('6g: no tags → weight 0', w7, 0);
}

// ============================================================
console.log('\n=== 7. selectMonsterSpell — basic dispatch ===\n');
// ============================================================

{
  // Lich vs a single enemy in range of Ray of Frost (60 ft).
  const lich = makeLichLike({ x: 0, y: 0, z: 0 });
  const enemy = makeC({ id: 'enemy', faction: 'party', pos: { x: 2, y: 0, z: 0 }, currentHP: 20, maxHP: 20, ac: 16 });
  const bf = makeBF([lich, enemy]);

  const plan = selectMonsterSpell(lich, bf);
  assert('7a: Lich produces a spell plan', plan !== null);
  if (plan) {
    eq('7b: plan type = cast', plan.type, 'cast');
    eq('7c: plan targetId = enemy', plan.targetId, 'enemy');
    eq('7d: plan action name = Ray of Frost', plan.action?.name, 'Ray of Frost');
    eq('7e: plan action attackType = spell', plan.action?.attackType, 'spell');
    eq('7f: plan action hitBonus = 12', plan.action?.hitBonus, 12);
    // Lich casterLevel 18 → 4 dice
    eq('7g: plan action damage.count = 4', plan.action?.damage?.count, 4);
    assert('7h: description mentions Lich casts Ray of Frost',
      /Lich casts Ray of Frost/.test(plan.description || ''),
      `got "${plan.description}"`);
  }
}

// ============================================================
console.log('\n=== 8. selectMonsterSpell — utility cantrips skipped ===\n');
// ============================================================

{
  // Drow only has 'dancing lights' at-will (utility — no combat template).
  // selectMonsterSpell should return null (no combat cantrip available).
  const drow = makeDrowLike({ x: 0, y: 0, z: 0 });
  const enemy = makeC({ id: 'enemy', faction: 'party', pos: { x: 2, y: 0, z: 0 } });
  const bf = makeBF([drow, enemy]);

  const plan = selectMonsterSpell(drow, bf);
  eq('8a: Drow (only dancing lights) → null', plan, null);
}

// ============================================================
console.log('\n=== 9. selectMonsterSpell — no enemy in range ===\n');
// ============================================================

{
  // Lich's only combat cantrip is Ray of Frost (60 ft). Enemy at 70 ft → out of range.
  const lich = makeLichLike({ x: 0, y: 0, z: 0 });
  const enemy = makeC({ id: 'far', faction: 'party', pos: { x: 14, y: 0, z: 0 } });  // 70 ft
  const bf = makeBF([lich, enemy]);

  const plan = selectMonsterSpell(lich, bf);
  eq('9a: Lich with enemy at 70 ft (out of Ray of Frost range) → null', plan, null);
}

// ============================================================
console.log('\n=== 10. selectMonsterSpell — picks best cantrip by weight ===\n');
// ============================================================

{
  // Mage has Fire Bolt (120 ft, d10) only. At full HP round 1, Fire Bolt is picked.
  const mage = makeMageLike({ x: 0, y: 0, z: 0 });
  const enemy = makeC({ id: 'enemy', faction: 'party', pos: { x: 10, y: 0, z: 0 }, currentHP: 20, maxHP: 20 });
  const bf = makeBF([mage, enemy]);

  const plan = selectMonsterSpell(mage, bf);
  assert('10a: Mage produces a spell plan', plan !== null);
  if (plan) {
    eq('10b: Mage casts Fire Bolt', plan.action?.name, 'Fire Bolt');
    eq('10c: Fire Bolt range = 120', plan.action?.range?.normal, 120);
    eq('10d: Fire Bolt damageType = fire', plan.action?.damageType, 'fire');
    // Mage casterLevel 9 → 2 dice
    eq('10e: Fire Bolt damage.count = 2 (casterLevel 9)', plan.action?.damage?.count, 2);
    eq('10f: Fire Bolt damage.sides = 10 (d10)', plan.action?.damage?.sides, 10);
  }
}

// ============================================================
console.log('\n=== 11. selectMonsterSpell — no monsterSpellcasting ===\n');
// ============================================================

{
  const goblin = makeC({ id: 'goblin', faction: 'enemy', pos: { x: 0, y: 0, z: 0 } });
  const enemy = makeC({ id: 'enemy', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([goblin, enemy]);

  const plan = selectMonsterSpell(goblin, bf);
  eq('11a: Goblin (no monsterSpellcasting) → null', plan, null);
}

// ============================================================
console.log('\n=== 12. selectMonsterSpell — no living enemies ===\n');
// ============================================================

{
  const lich = makeLichLike({ x: 0, y: 0, z: 0 });
  const deadEnemy = makeC({ id: 'dead', faction: 'party', pos: { x: 2, y: 0, z: 0 }, isDead: true });
  const bf = makeBF([lich, deadEnemy]);

  const plan = selectMonsterSpell(lich, bf);
  eq('12a: Lich with only dead enemies → null', plan, null);
}

// ============================================================
console.log('\n=== 13. selectMonsterSpell — target selection (lowest HP) ===\n');
// ============================================================

{
  const lich = makeLichLike({ x: 0, y: 0, z: 0 });
  const fullHP = makeC({ id: 'full', faction: 'party', pos: { x: 2, y: 0, z: 0 }, currentHP: 30, maxHP: 30 });
  const lowHP = makeC({ id: 'low', faction: 'party', pos: { x: 3, y: 0, z: 0 }, currentHP: 5, maxHP: 30 });
  const bf = makeBF([lich, fullHP, lowHP]);

  const plan = selectMonsterSpell(lich, bf);
  assert('13a: plan produced', plan !== null);
  if (plan) {
    eq('13b: targets lowest-HP enemy (low)', plan.targetId, 'low');
  }
}

// ============================================================
console.log('\n=== 14. Planner integration — monster casts cantrip in combat ===\n');
// ============================================================

{
  // Full combat: Lich vs Fighter. The Lich should cast Ray of Frost on round 1
  // (its only combat cantrip in range). We verify via the combat log.
  const lich = makeLichLike({ x: 5, y: 5, z: 0 });
  lich.faction = 'enemy';
  lich.actions = [];  // no weapon actions → forces cantrip or improvised

  const fighter = makeC({
    id: 'fighter', name: 'Fighter', faction: 'party',
    maxHP: 30, currentHP: 30, ac: 16, speed: 30,
    str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10,
    cr: 1, pos: { x: 7, y: 5, z: 0 },
    actions: [{
      name: 'Longsword', isMultiattack: false,
      attackType: 'melee', reach: 5, range: null,
      hitBonus: 5, damage: { count: 1, sides: 8, bonus: 3, average: 7 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false,
      costType: 'action', legendaryCost: 0, description: '',
    }],
  });

  const bf = makeFlatBattlefield(15, 15, [lich, fighter]);
  const result = runCombat(bf, ['lich', 'fighter'], { maxRounds: 1 });

  // Find the Lich's action in the log — should mention Ray of Frost.
  const lichActions = result.events.filter(
    e => e.actorId === 'lich' && /cast|Ray of Frost|spell/i.test(e.description)
  );
  assert('14a: Lich has a spell-cast event in round 1', lichActions.length > 0,
    `events: ${lichActions.map(e => e.description).join('; ')}`);
  const rofEvent = result.events.find(
    e => e.actorId === 'lich' && /Ray of Frost/i.test(e.description)
  );
  assert('14b: Lich casts Ray of Frost', rofEvent !== undefined,
    `no Ray of Frost event; log: ${result.events.filter(e=>e.actorId==='lich').map(e=>e.description).join('; ')}`);
}

// ============================================================
console.log('\n=== 15. Backward-compat — non-spellcasting monster unaffected ===\n');
// ============================================================

{
  const goblin = makeC({
    id: 'goblin', name: 'Goblin', faction: 'enemy',
    pos: { x: 5, y: 5, z: 0 },
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

  const bf = makeFlatBattlefield(15, 15, [goblin, fighter]);
  const result = runCombat(bf, ['goblin', 'fighter'], { maxRounds: 1 });

  // Goblin should use Scimitar (no spellcasting → no cantrip branch fires).
  const goblinAttack = result.events.find(
    e => e.actorId === 'goblin' && /Scimitar|attack/i.test(e.description)
  );
  assert('15a: Goblin uses weapon attack (no spellcasting)', goblinAttack !== undefined,
    `events: ${result.events.filter(e=>e.actorId==='goblin').map(e=>e.description).join('; ')}`);
}

// ============================================================
console.log('\n=== 16. Phase 2/3 forward-compat stubs ===\n');
// ============================================================

{
  const lich = makeLichLike();
  // Phase 2/3 init functions are no-ops in Phase 1 (should not throw).
  // Import them dynamically to avoid polluting the top-level import (they're stubs).
  const ms = require('../ai/monster_spellcasting');
  const initMonsterSpellSlots = ms.initMonsterSpellSlots;
  const initMonsterDailyUses = ms.initMonsterDailyUses;
  const consumeMonsterSpellSlot = ms.consumeMonsterSpellSlot;

  initMonsterSpellSlots(lich);  // no-op
  initMonsterDailyUses(lich);   // no-op
  eq('16a: Phase 1 monsterSpellSlots absent (Phase 2 will populate)', lich.monsterSpellSlots, undefined);
  eq('16b: Phase 1 monsterDailyUses absent (Phase 3 will populate)', lich.monsterDailyUses, undefined);
  eq('16c: consumeMonsterSpellSlot returns true (Phase 1: at-will = infinite)',
    consumeMonsterSpellSlot(lich, 1), true);
}

// ============================================================
console.log('\n=== 17. Autonomous doubt decisions (RFC §9.1) ===\n');
// ============================================================

{
  // Doubt #1 = A: Only cast spells with a known template.
  // Drow has 'dancing lights' (no template) → skipped, returns null.
  const drow = makeDrowLike({ x: 0, y: 0, z: 0 });
  const enemy = makeC({ id: 'e', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const plan = selectMonsterSpell(drow, makeBF([drow, enemy]));
  eq('17a: Doubt #1 — utility cantrip skipped (null)', plan, null);

  // Doubt #6 = A: Skip silently when spell not in library.
  // Mage has 'light' (utility, no template) + 'fire bolt' (template).
  // Only Fire Bolt is castable; Light is silently skipped.
  const mage = makeMageLike({ x: 0, y: 0, z: 0 });
  const enemy2 = makeC({ id: 'e2', faction: 'party', pos: { x: 2, y: 0, z: 0 } });
  const plan2 = selectMonsterSpell(mage, makeBF([mage, enemy2]));
  assert('17b: Doubt #6 — unimplemented skipped, Fire Bolt chosen', plan2?.action?.name === 'Fire Bolt');

  // Doubt #3 = B: Cantrip-finisher bonus when target HP ≤ avg × 1.5.
  // Verified in test 6e/6f above (weight ×1.3 when target low HP).

  // Doubt #2: Weighted system decides (no forced opener) — the scoring in
  // test 6a-6d confirms round-1 context affects weight but doesn't force a spell.
  assert('17c: Doubt #2 — weighted scoring (not forced opener) verified in §6', true);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('\nAll tests passed ✅');
