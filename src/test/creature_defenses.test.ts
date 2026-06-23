// ============================================================
// Test: Creature Megabatch Batch 1 — defenses parser
//   immune / resist / vulnerable / conditionImmune
// Run: npx ts-node --transpile-only src/test/creature_defenses.test.ts
//
// Session 52 Creature Megabatch Batch 1.
// Verifies:
//   1. Skeleton (vulnerable to bludgeoning): bludgeoning damage DOUBLED;
//      fire damage taken normally (Skeleton has poison immunity too — covered).
//   2. Tarrasque (immune to fire + poison + nonmagical B/P/S): fire & poison
//      damage = 0; slashing damage = 0 in v1 (nonmagical-only immunity
//      applied unconditionally — Batch 4c Magic Weapons will refine).
//   3. Lemure (resist cold): cold damage HALVED; fire damage = 0 (immune).
//   4. Barbed Devil (resist nonmagical B/P/S — v1 unconditional): slashing
//      damage HALVED.
//   5. Flying Sword (conditionImmune charmed/exhaustion/frightened/paralyzed/
//      petrified/poisoned): addCondition('frightened') skips; a non-immune
//      condition (prone) applies normally.
//   6. Goblin (no defenses): all defense arrays empty; addCondition works.
//   7. Round-trip smoke: spawn 15 random creatures from real bestiary;
//      no crashes; DEFENSE_IMMUNE creatures get non-empty immunities arrays;
//      DEFENSE_CONDITION_IMMUNE creatures get non-empty conditionImmunities.
//   8. Parser shape coverage: parseDamageDefenseList handles string-array,
//      object-with-inner-array, and {special:...} shapes; parseConditionImmune
//      handles string-array.
//
// Damage-application tests use applyDamageWithTempHP with fixed damage
// amounts (no RNG) — no de-flake needed.
// ============================================================

import {
  loadBestiaryJson,
  mergeBestiaries,
  spawnMonster,
  monsterToCombatant,
  type Raw5etoolsMonster,
} from '../parser/fivetools';
import { applyDamageWithTempHP, addCondition } from '../engine/utils';
import type { Combatant } from '../types/core';

let passed = 0;
let failed = 0;
// cond accepts boolean | undefined | null so optional-chaining expressions
// (e.g. `c.immunities?.includes('fire')`) can be passed directly without
// a `?? false` coalesce on every call site.
function assert(label: string, cond: boolean | undefined | null, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, actual: T, expected: T): void {
  const ok = actual === expected;
  assert(label, ok, ok ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ---- Load real bestiary once --------------------------------
const fs = require('fs');
const path = require('path');
const dataDir = path.join(__dirname, '../../bestiaryData');
const dataFiles = fs.readdirSync(dataDir).filter((f: string) => f.endsWith('.json'));
const loadedFiles = dataFiles.map((f: string) =>
  JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8'))
);
const bestiary = mergeBestiaries(...loadedFiles);

// Also load the analysis JSON (so we can identify creatures by pattern).
const analysis = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../CREATURE-MEGABATCH-ANALYSIS.json'), 'utf-8')
);

// Helper: spawn a real creature by name and assert it spawned.
function spawn(name: string): Combatant {
  const c = spawnMonster(bestiary, name, { x: 0, y: 0, z: 0 });
  if (!c) throw new Error(`Creature not found in bestiary: ${name}`);
  return c;
}

// ============================================================
console.log('\n=== 1. Skeleton — vulnerable to bludgeoning ===\n');
{
  const skel = spawn('Skeleton');
  // Parser assertions
  assert('Skeleton has damageVulnerabilities = ["bludgeoning"]',
    skel.damageVulnerabilities?.length === 1 && skel.damageVulnerabilities[0] === 'bludgeoning',
    `actual=${JSON.stringify(skel.damageVulnerabilities)}`);
  assert('Skeleton has immunities = ["poison"]',
    skel.immunities?.length === 1 && skel.immunities[0] === 'poison',
    `actual=${JSON.stringify(skel.immunities)}`);
  assert('Skeleton conditionImmunities includes "exhaustion"',
    skel.conditionImmunities?.includes('exhaustion'));
  assert('Skeleton conditionImmunities includes "poisoned"',
    skel.conditionImmunities?.includes('poisoned'));

  // Damage application — bludgeoning is DOUBLED (vulnerability).
  // Skeleton HP is only 13 — boost HP so a 20-damage hit doesn't get capped.
  const skel2 = spawn('Skeleton');
  skel2.maxHP = 100; skel2.currentHP = 100;
  const dealtBlud = applyDamageWithTempHP(skel2, 10, 'bludgeoning');
  eq('10 bludgeoning → 20 dealt (vulnerable)', dealtBlud, 20);
  eq('Skeleton HP reduced by 20', skel2.currentHP, 100 - 20);

  // Fire damage — full (Skeleton not immune/vuln/resist to fire)
  const skel3 = spawn('Skeleton');
  skel3.maxHP = 100; skel3.currentHP = 100;
  const dealtFire = applyDamageWithTempHP(skel3, 10, 'fire');
  eq('10 fire → 10 dealt (no defense)', dealtFire, 10);
  eq('Skeleton HP reduced by 10', skel3.currentHP, 100 - 10);

  // Poison damage — 0 (immune)
  const skel4 = spawn('Skeleton');
  skel4.maxHP = 100; skel4.currentHP = 100;
  const dealtPsn = applyDamageWithTempHP(skel4, 30, 'poison');
  eq('30 poison → 0 dealt (immune)', dealtPsn, 0);
  eq('Skeleton HP unchanged by poison', skel4.currentHP, 100);
}

// ============================================================
console.log('\n=== 2. Tarrasque — immune fire/poison/nonmagical B/P/S ===\n');
{
  const t = spawn('Tarrasque');
  // Parser: Tarrasque immune=[fire, poison, bludgeoning, piercing, slashing]
  // (the {cond:true, note:"from nonmagical attacks"} form is collapsed into
  // the plain immunities array in v1)
  assert('Tarrasque immune to fire',     t.immunities?.includes('fire'));
  assert('Tarrasque immune to poison',   t.immunities?.includes('poison'));
  assert('Tarrasque immune to bludgeoning (v1 unconditional nonmagical)', t.immunities?.includes('bludgeoning'));
  assert('Tarrasque immune to slashing (v1 unconditional nonmagical)',    t.immunities?.includes('slashing'));
  assert('Tarrasque immune to piercing (v1 unconditional nonmagical)',    t.immunities?.includes('piercing'));
  assert('Tarrasque conditionImmune charmed',  t.conditionImmunities?.includes('charmed'));
  assert('Tarrasque conditionImmune frightened', t.conditionImmunities?.includes('frightened'));
  assert('Tarrasque conditionImmune paralyzed',  t.conditionImmunities?.includes('paralyzed'));
  assert('Tarrasque conditionImmune poisoned',   t.conditionImmunities?.includes('poisoned'));

  // Fire → 0
  const t2 = spawn('Tarrasque');
  const start2 = t2.currentHP;
  eq('Tarrasque fire damage = 0',  applyDamageWithTempHP(t2, 50, 'fire'), 0);
  eq('Tarrasque HP unchanged by fire', t2.currentHP, start2);

  // Poison → 0
  const t3 = spawn('Tarrasque');
  eq('Tarrasque poison damage = 0', applyDamageWithTempHP(t3, 50, 'poison'), 0);

  // Slashing → 0 (v1: nonmagical-only immunity applied unconditionally)
  const t4 = spawn('Tarrasque');
  const start4 = t4.currentHP;
  eq('Tarrasque slashing damage = 0 (v1 unconditional)', applyDamageWithTempHP(t4, 40, 'slashing'), 0);
  eq('Tarrasque HP unchanged by slashing', t4.currentHP, start4);

  // Force damage — full (Tarrasque has no force immunity/resist/vuln)
  const t5 = spawn('Tarrasque');
  const start5 = t5.currentHP;
  const dealtForce = applyDamageWithTempHP(t5, 30, 'force');
  assert('Tarrasque force damage > 0 (no defense)', dealtForce > 0);
  eq('Tarrasque HP reduced by force', t5.currentHP, start5 - dealtForce);
}

// ============================================================
console.log('\n=== 3. Lemure — resist cold (immune fire/poison) ===\n');
{
  const lem = spawn('Lemure');
  assert('Lemure resistances = ["cold"]', lem.resistances.length === 1 && lem.resistances[0] === 'cold',
    `actual=${JSON.stringify(lem.resistances)}`);
  assert('Lemure immunities = [fire, poison]', lem.immunities?.length === 2 &&
    lem.immunities?.includes('fire') && lem.immunities?.includes('poison'));
  assert('Lemure conditionImmune charmed',  lem.conditionImmunities?.includes('charmed'));
  assert('Lemure conditionImmune frightened', lem.conditionImmunities?.includes('frightened'));
  assert('Lemure conditionImmune poisoned',   lem.conditionImmunities?.includes('poisoned'));

  // Cold → halved
  const lem2 = spawn('Lemure');
  const start2 = lem2.currentHP;
  eq('Lemure cold damage = 5 (halved from 10)', applyDamageWithTempHP(lem2, 10, 'cold'), 5);
  eq('Lemure HP reduced by 5', lem2.currentHP, start2 - 5);

  // Fire → 0 (immune)
  const lem3 = spawn('Lemure');
  eq('Lemure fire damage = 0 (immune)', applyDamageWithTempHP(lem3, 20, 'fire'), 0);

  // Slashing → full (Lemure has no B/P/S defense in 5etools data)
  const lem4 = spawn('Lemure');
  const start4 = lem4.currentHP;
  const dealtSlas = applyDamageWithTempHP(lem4, 6, 'slashing');
  eq('Lemure slashing damage = 6 (no defense)', dealtSlas, 6);
  eq('Lemure HP reduced by 6', lem4.currentHP, start4 - 6);
}

// ============================================================
console.log('\n=== 4. Barbed Devil — resist nonmagical B/P/S (v1 unconditional) ===\n');
{
  const bd = spawn('Barbed Devil');
  // Parser: Barbed Devil resistances include bludgeoning, piercing, slashing
  // (collapsed from {cond:true, note:"from nonmagical attacks that aren't silvered"})
  assert('Barbed Devil resistances include bludgeoning', bd.resistances.includes('bludgeoning'));
  assert('Barbed Devil resistances include piercing',    bd.resistances.includes('piercing'));
  assert('Barbed Devil resistances include slashing',    bd.resistances.includes('slashing'));
  assert('Barbed Devil resistances include cold',        bd.resistances.includes('cold'));
  assert('Barbed Devil immune to fire',   bd.immunities?.includes('fire'));
  assert('Barbed Devil immune to poison', bd.immunities?.includes('poison'));

  // Slashing → halved (v1 unconditional — Batch 4c will refine)
  const bd2 = spawn('Barbed Devil');
  const start2 = bd2.currentHP;
  eq('Barbed Devil slashing = 15 (halved from 30)', applyDamageWithTempHP(bd2, 30, 'slashing'), 15);
  eq('Barbed Devil HP reduced by 15', bd2.currentHP, start2 - 15);

  // Piercing → halved
  const bd3 = spawn('Barbed Devil');
  eq('Barbed Devil piercing = 8 (halved from 16)', applyDamageWithTempHP(bd3, 16, 'piercing'), 8);

  // Cold → halved
  const bd4 = spawn('Barbed Devil');
  eq('Barbed Devil cold = 10 (halved from 20)', applyDamageWithTempHP(bd4, 20, 'cold'), 10);

  // Fire → 0 (immune)
  const bd5 = spawn('Barbed Devil');
  eq('Barbed Devil fire = 0 (immune)', applyDamageWithTempHP(bd5, 25, 'fire'), 0);

  // Lightning → full (no defense)
  const bd6 = spawn('Barbed Devil');
  const start6 = bd6.currentHP;
  const dealtL = applyDamageWithTempHP(bd6, 18, 'lightning');
  eq('Barbed Devil lightning = 18 (no defense)', dealtL, 18);
  eq('Barbed Devil HP reduced by 18', bd6.currentHP, start6 - 18);
}

// ============================================================
console.log('\n=== 5. Flying Sword — conditionImmune (charmed/frightened/paralyzed/etc.) ===\n');
{
  const fs1 = spawn('Flying Sword');
  assert('Flying Sword conditionImmune charmed',    fs1.conditionImmunities?.includes('charmed'));
  assert('Flying Sword conditionImmune frightened',  fs1.conditionImmunities?.includes('frightened'));
  assert('Flying Sword conditionImmune paralyzed',   fs1.conditionImmunities?.includes('paralyzed'));
  assert('Flying Sword conditionImmune petrified',   fs1.conditionImmunities?.includes('petrified'));
  assert('Flying Sword conditionImmune poisoned',    fs1.conditionImmunities?.includes('poisoned'));
  assert('Flying Sword conditionImmune blinded',     fs1.conditionImmunities?.includes('blinded'));
  assert('Flying Sword conditionImmune deafened',    fs1.conditionImmunities?.includes('deafened'));

  // addCondition('frightened') → SKIPPED (immune)
  addCondition(fs1, 'frightened');
  assert('Flying Sword NOT frightened (conditionImmune)', !fs1.conditions.has('frightened'));

  // addCondition('paralyzed') → SKIPPED (immune) + cascade does NOT fire
  addCondition(fs1, 'paralyzed');
  assert('Flying Sword NOT paralyzed (conditionImmune)', !fs1.conditions.has('paralyzed'));
  assert('Flying Sword NOT incapacitated (paralyzed cascade did not fire)', !fs1.conditions.has('incapacitated'));

  // addCondition('poisoned') → SKIPPED (immune)
  addCondition(fs1, 'poisoned');
  assert('Flying Sword NOT poisoned (conditionImmune)', !fs1.conditions.has('poisoned'));

  // addCondition('prone') → APPLIES (Flying Sword NOT immune to prone)
  addCondition(fs1, 'prone');
  assert('Flying Sword IS prone (not immune)', fs1.conditions.has('prone'));

  // Damage-immunity interaction: Flying Sword is immune to poison+psychic damage
  const fs2 = spawn('Flying Sword');
  eq('Flying Sword poison damage = 0 (immune)', applyDamageWithTempHP(fs2, 25, 'poison'), 0);
  const fs3 = spawn('Flying Sword');
  eq('Flying Sword psychic damage = 0 (immune)', applyDamageWithTempHP(fs3, 25, 'psychic'), 0);
  // Non-matching damage: piercing applies
  const fs4 = spawn('Flying Sword');
  const start4 = fs4.currentHP;
  const dealtP = applyDamageWithTempHP(fs4, 5, 'piercing');
  assert('Flying Sword piercing damage > 0 (not immune)', dealtP > 0);
  eq('Flying Sword HP reduced by piercing', fs4.currentHP, start4 - dealtP);
}

// ============================================================
console.log('\n=== 6. Goblin — no defenses ===\n');
{
  const gob = spawn('Goblin');
  // All defense arrays empty / undefined-equivalent
  eq('Goblin resistances empty', gob.resistances.length, 0);
  eq('Goblin immunities empty',  gob.immunities?.length ?? 0, 0);
  eq('Goblin damageVulnerabilities empty', gob.damageVulnerabilities?.length ?? 0, 0);
  eq('Goblin conditionImmunities empty',   gob.conditionImmunities?.length ?? 0, 0);

  // Damage applies fully
  const gob2 = spawn('Goblin');
  const start2 = gob2.currentHP;
  eq('Goblin slashing = 5 (full)', applyDamageWithTempHP(gob2, 5, 'slashing'), 5);
  eq('Goblin HP reduced by 5', gob2.currentHP, start2 - 5);

  // Condition applies normally
  const gob3 = spawn('Goblin');
  addCondition(gob3, 'frightened');
  assert('Goblin IS frightened (no conditionImmunities)', gob3.conditions.has('frightened'));
  addCondition(gob3, 'restrained');
  assert('Goblin IS restrained (no conditionImmunities)', gob3.conditions.has('restrained'));
}

// ============================================================
console.log('\n=== 7. Round-trip smoke — 15 random creatures ===\n');
{
  // Pick 15 creatures: 5 DEFENSE_IMMUNE, 5 DEFENSE_RESIST, 5 DEFENSE_VULNERABLE,
  // 5 DEFENSE_CONDITION_IMMUNE (so we exercise every parser branch).
  const pick = (pattern: string, n: number) =>
    analysis.creatures
      .filter((c: any) => c.patterns.includes(pattern))
      .slice(0, n)
      .map((c: any) => c.name);

  const picks = [
    ...pick('DEFENSE_IMMUNE', 5),
    ...pick('DEFENSE_RESIST', 5),
    ...pick('DEFENSE_VULNERABLE', 3),
    ...pick('DEFENSE_CONDITION_IMMUNE', 2),
  ];

  let spawned = 0;
  // Track per-pattern: how many picked creatures HAD the pattern (checked),
  // and how many of those had a non-empty parsed array (ok). A creature can
  // have multiple patterns (e.g. DEFENSE_IMMUNE + DEFENSE_CONDITION_IMMUNE),
  // so we verify per-creature, not by fixed count.
  let immuneChecked = 0, immuneOk = 0;
  let condImmuneChecked = 0, condImmuneOk = 0;
  for (const name of picks) {
    try {
      const c = spawn(name);
      spawned++;
      const analysisEntry = analysis.creatures.find((x: any) => x.name === name);
      if (analysisEntry?.patterns.includes('DEFENSE_IMMUNE')) {
        immuneChecked++;
        if (c.immunities && c.immunities.length > 0) immuneOk++;
        else assert(`DEFENSE_IMMUNE creature ${name} has non-empty immunities`, false, `got ${JSON.stringify(c.immunities)}`);
      }
      if (analysisEntry?.patterns.includes('DEFENSE_CONDITION_IMMUNE')) {
        condImmuneChecked++;
        if (c.conditionImmunities && c.conditionImmunities.length > 0) condImmuneOk++;
        else assert(`DEFENSE_CONDITION_IMMUNE creature ${name} has non-empty conditionImmunities`, false, `got ${JSON.stringify(c.conditionImmunities)}`);
      }
      // Smoke: take a few damage types without crashing
      applyDamageWithTempHP(c, 5, 'fire');
      applyDamageWithTempHP(c, 5, 'bludgeoning');
      applyDamageWithTempHP(c, 5, 'poison');
    } catch (e) {
      assert(`spawn ${name} did NOT throw`, false, String(e));
    }
  }
  eq(`All ${picks.length} picked creatures spawned`, spawned, picks.length);
  assert('At least 5 DEFENSE_IMMUNE creatures were checked', immuneChecked >= 5);
  eq('Every checked DEFENSE_IMMUNE creature has non-empty immunities', immuneOk, immuneChecked);
  assert('At least 2 DEFENSE_CONDITION_IMMUNE creatures were checked', condImmuneChecked >= 2);
  eq('Every checked DEFENSE_CONDITION_IMMUNE creature has non-empty conditionImmunities', condImmuneOk, condImmuneChecked);
}

// ============================================================
console.log('\n=== 8. Parser shape coverage (parseDamageDefenseList / parseConditionImmune) ===\n');
{
  // Direct monsterToCombatant calls with synthetic raw monsters exercise
  // every shape the parser claims to handle.
  const mk = (overrides: Partial<Raw5etoolsMonster>): Raw5etoolsMonster => ({
    name: 'Test', source: 'TEST', cr: '1',
    ac: [10], hp: { average: 10, formula: '1d8+2' },
    speed: { walk: 30 },
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    type: 'humanoid', size: ['M'],
    action: [],
    ...overrides,
  });

  // (a) Plain string array
  const a = monsterToCombatant(mk({ immune: ['fire', 'poison'] }));
  eq('string-array immune → [fire, poison]', JSON.stringify(a.immunities), JSON.stringify(['fire', 'poison']));

  // (b) Object with inner array + cond:true (nonmagical-only — v1 unconditional)
  const b = monsterToCombatant(mk({
    resist: [{ resist: ['bludgeoning', 'piercing', 'slashing'], note: 'from nonmagical attacks', cond: true }],
  }));
  eq('object-with-inner-array resist → [B,P,S]',
    JSON.stringify(b.resistances.sort()),
    JSON.stringify(['bludgeoning', 'piercing', 'slashing'].sort()));

  // (c) Object with special — SKIPPED in v1 (no damage types enumerated)
  const c = monsterToCombatant(mk({ immune: [{ special: 'damage from spells' }] }));
  eq('{special:...} immune → [] (skipped)', JSON.stringify(c.immunities), '[]');

  // (d) Mixed: plain string + object form + special — only the parseable ones survive
  const d = monsterToCombatant(mk({
    immune: [
      'fire',
      { immune: ['cold', 'lightning'], note: 'from spells' },
      { special: 'bludgeoning from nonmagical attacks' },
    ],
  }));
  eq('mixed immune → [fire, cold, lightning] (special skipped)',
    JSON.stringify((d.immunities ?? []).sort()),
    JSON.stringify(['cold', 'fire', 'lightning'].sort()));

  // (e) vulnerable plain string-array
  const e = monsterToCombatant(mk({ vulnerable: ['bludgeoning'] }));
  eq('vulnerable → [bludgeoning]', JSON.stringify(e.damageVulnerabilities), JSON.stringify(['bludgeoning']));

  // (f) conditionImmune string-array (canonical MM shape)
  const f = monsterToCombatant(mk({ conditionImmune: ['Charmed', 'Frightened', 'POISONED'] }));
  eq('conditionImmune lowercased → [charmed, frightened, poisoned]',
    JSON.stringify(f.conditionImmunities?.sort()),
    JSON.stringify(['charmed', 'frightened', 'poisoned'].sort()));

  // (g) conditionImmune forward-compat: object-with-inner-array form
  const g = monsterToCombatant(mk({
    conditionImmune: [{ conditionImmune: ['charmed', 'paralyzed'] }],
  }));
  eq('conditionImmune object form → [charmed, paralyzed]',
    JSON.stringify(g.conditionImmunities?.sort()),
    JSON.stringify(['charmed', 'paralyzed'].sort()));

  // (h) Empty / undefined — returns []
  const h = monsterToCombatant(mk({}));
  eq('No defense fields → resistances empty', h.resistances.length, 0);
  eq('No defense fields → immunities undefined-equivalent', h.immunities?.length ?? 0, 0);
  eq('No defense fields → damageVulnerabilities undefined-equivalent', h.damageVulnerabilities?.length ?? 0, 0);
  eq('No defense fields → conditionImmunities undefined-equivalent', h.conditionImmunities?.length ?? 0, 0);

  // (i) Unknown damage-type strings silently dropped (e.g. 5etools tags we don't model)
  const i = monsterToCombatant(mk({ immune: ['fire', 'unknownType', 'psychic'] }));
  eq('Unknown damage-type strings dropped from immune',
    JSON.stringify(i.immunities?.sort()),
    JSON.stringify(['fire', 'psychic'].sort()));
}

// ============================================================
// 9. Condition-immunity case-insensitivity
// ============================================================
console.log('\n=== 9. Condition immunity is case-insensitive ===\n');
{
  // Synthetic combatant with conditionImmunities set with mixed case.
  // Parser lowercases on ingest; but we also test direct mutation for safety.
  const mk = (overrides: Partial<Raw5etoolsMonster>): Raw5etoolsMonster => ({
    name: 'Test', source: 'TEST', cr: '1',
    ac: [10], hp: { average: 50, formula: '1d8+2' },
    speed: { walk: 30 },
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    type: 'construct', size: ['M'],
    action: [],
    ...overrides,
  });
  // conditionImmune entries are lowercased by the parser
  const c = monsterToCombatant(mk({ conditionImmune: ['Frightened', 'CHARMED'] }));
  addCondition(c, 'frightened'); // engine passes lowercased Condition
  assert('lowercased addCondition(frightened) skipped on uppercased-immune creature',
    !c.conditions.has('frightened'));
  addCondition(c, 'charmed');
  assert('lowercased addCondition(charmed) skipped on uppercased-immune creature',
    !c.conditions.has('charmed'));
}

// ============================================================
console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFailed tests above ↑'); process.exit(1); }
console.log('\nAll tests passed ✅');
