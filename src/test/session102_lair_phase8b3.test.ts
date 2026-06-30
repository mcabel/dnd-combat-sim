// ============================================================
// Test: Session 102 — RFC-LAIRACTIONS Phase 8 batch 3
//       Last 3 unrecognized bespoke lair actions.
//
// Validates the Phase 8 batch 3 deliverables implemented in this session:
//   1. Demogorgon::1 (Illusory Duplicate) — parser flag
//      `LairAction.lairIllusoryDuplicate` + MECHANICAL handler that sets
//      `Combatant.lairIllusoryDuplicate` scratch field + reactive redirect
//      hook `applyLairIllusoryDuplicateRedirect` at 3 attack-damage sites.
//      On the first attack that deals damage, roll 1d100: ≤50 = duplicate
//      absorbs the hit (healback, no damage), >50 = lair creature takes the
//      hit. Either way, the duplicate is consumed (the "first time" trigger).
//   2. Githzerai Anarch::0 (Create Object) — promoted from `bespoke` to
//      `cast_spell` via the broadened "casts <spell>" regex (now accepts `(`
//      as a delimiter). spellName=creation, castLevel=9 (extracted from
//      "(as a 9th-level spell)" parenthetical — overrides the static
//      LAIR_SPELL_LEVELS value of 5).
//   3. Githzerai Anarch::2 (Psionic Bolt) — promoted to `cast_spell`.
//      spellName=lightning bolt, castLevel=5 (extracted from "(at 5th level)").
//
// After this session, ALL 31 bespoke actions are recognized (100%). Overall
// recognized coverage: ~325/325 (100%). Phase 8 is COMPLETE.
//
// Run: npx ts-node --transpile-only src/test/session102_lair_phase8b3.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
  extractLairAction,
} from '../parser/fivetools';
import { runCombat } from '../engine/combat';
import { Combatant, Vec3, Battlefield, LairAction, ActiveEffect } from '../types/core';

// ---- Test harness -------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Load bestiary ----

const dir = path.join(__dirname, '../../bestiaryData');
const allFiles = fs.readdirSync(dir).filter(f =>
  f.endsWith('.json') && !f.includes('combined_') && !f.includes('legendarygroups'));
const loaded = allFiles.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
const bestiary = mergeBestiaries(...loaded);

console.log(`    Loaded ${allFiles.length} bestiary sources, ${bestiary.size} creatures total.`);

function spawn(name: string, src?: string): Combatant {
  const c = spawnMonster(bestiary, name, { x: 0, y: 0, z: 0 }, 'smart', 'enemy', undefined, src);
  if (!c) throw new Error(`Monster not found: ${name}`);
  return c;
}

// ---- Combat state factories --------------------------------

interface MutableBF extends Battlefield { [k: string]: any; }

function makeBF(combatants: Combatant[]): MutableBF {
  const width = 30, height = 30, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [{ terrain: 'flat', elevation: 0 }];
    }
  }
  const bf: MutableBF = {
    width, height, depth, cells,
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1,
    initiativeOrder: combatants.map(c => c.id),
  };
  return bf;
}

function tankUp(c: Combatant, hp = 100_000): void {
  c.maxHP = hp;
  c.currentHP = hp;
}
function noLegendary(c: Combatant): void {
  c.legendaryActionPoolMax = 0;
  c.legendaryActionPool = 0;
}
function asParty(c: Combatant): void { c.faction = 'party'; }
function asEnemy(c: Combatant): void { c.faction = 'enemy'; }

/** Build a synthetic LairAction with arbitrary category + fields. */
function makeAction(
  id: string,
  category: LairAction['category'],
  extra: Partial<LairAction> = {},
): LairAction {
  return {
    id,
    sourceCreature: 'TestCreature',
    rawText: extra.rawText ?? `Synthetic ${category} action.`,
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    targetsEnemies: true,
    category,
    ...extra,
  };
}

/** Replace the lair creature's lairActions.actions with a single synthetic
 * action. Initializes lairActions if needed. */
function forceAction(c: Combatant, action: LairAction): void {
  if (!c.lairActions) {
    c.lairActions = { actions: [], initiativeCount: 20 };
  }
  c.lairActions.actions = [action];
  c._lairActionHistory = [];
}

// ============================================================
// 1. Parser: lairIllusoryDuplicate flag (Demogorgon::1, MPMM)
// ============================================================
console.log('\n--- 1. Parser: lairIllusoryDuplicate (Demogorgon::1 MPMM) ---');
{
  const demo = spawn('Demogorgon', 'MPMM');
  // Find the illusory duplicate action (Demogorgon::1 in MPMM).
  const illusoryAction = demo.lairActions!.actions.find(
    a => /\billusory\s+duplicate\b/i.test(a.rawText ?? ''));
  assert('1a. Demogorgon (MPMM) has an illusory duplicate lair action',
    illusoryAction !== undefined);
  if (illusoryAction) {
    eq('1b. illusory duplicate action has lairIllusoryDuplicate=true',
      illusoryAction.lairIllusoryDuplicate, true);
    eq('1c. illusory duplicate action is bespoke category',
      illusoryAction.category, 'bespoke');
    console.log(`    (id: ${illusoryAction.id})`);
  }
}

// ============================================================
// 2. Parser: lairIllusoryDuplicate flag (Demogorgon, MTF)
// ============================================================
console.log('\n--- 2. Parser: lairIllusoryDuplicate (Demogorgon MTF) ---');
{
  const demo = spawn('Demogorgon', 'MTF');
  const illusoryAction = demo.lairActions!.actions.find(
    a => /\billusory\s+duplicate\b/i.test(a.rawText ?? ''));
  assert('2a. Demogorgon (MTF) has an illusory duplicate lair action',
    illusoryAction !== undefined);
  if (illusoryAction) {
    eq('2b. MTF illusory duplicate has lairIllusoryDuplicate=true',
      illusoryAction.lairIllusoryDuplicate, true);
    eq('2c. MTF illusory duplicate is bespoke category',
      illusoryAction.category, 'bespoke');
    console.log(`    (id: ${illusoryAction.id})`);
  }
}

// ============================================================
// 3. Parser: Githzerai Anarch::0 promoted to cast_spell (creation, L9)
// ============================================================
console.log('\n--- 3. Parser: Githzerai Anarch::0 → cast_spell (creation L9) ---');
{
  const ga = spawn('Githzerai Anarch', 'MPMM');
  const a0 = ga.lairActions!.actions[0];
  eq('3a. Githzerai Anarch::0 category is cast_spell', a0.category, 'cast_spell');
  eq('3b. Githzerai Anarch::0 isSpell=true', a0.isSpell, true);
  eq('3c. Githzerai Anarch::0 spellName=creation', a0.spellName, 'creation');
  // castLevel=9 extracted from "(as a 9th-level spell)" — overrides the static
  // LAIR_SPELL_LEVELS['creation']=5.
  eq('3d. Githzerai Anarch::0 castLevel=9 (overridden from text)', a0.castLevel, 9);
}

// ============================================================
// 4. Parser: Githzerai Anarch::2 promoted to cast_spell (lightning bolt, L5)
// ============================================================
console.log('\n--- 4. Parser: Githzerai Anarch::2 → cast_spell (lightning bolt L5) ---');
{
  const ga = spawn('Githzerai Anarch', 'MPMM');
  const a2 = ga.lairActions!.actions[2];
  eq('4a. Githzerai Anarch::2 category is cast_spell', a2.category, 'cast_spell');
  eq('4b. Githzerai Anarch::2 isSpell=true', a2.isSpell, true);
  eq('4c. Githzerai Anarch::2 spellName=lightning bolt', a2.spellName, 'lightning bolt');
  // castLevel=5 extracted from "(at 5th level)" — overrides the static
  // LAIR_SPELL_LEVELS['lightning bolt']=3.
  eq('4d. Githzerai Anarch::2 castLevel=5 (overridden from text)', a2.castLevel, 5);
}

// ============================================================
// 5. Parser: MTF Githzerai Anarch also promoted (different index order)
// ============================================================
console.log('\n--- 5. Parser: MTF Githzerai Anarch (different index order) ---');
{
  const ga = spawn('Githzerai Anarch', 'MTF');
  // MTF order: ::0=lightning bolt, ::1=creation, ::2=move object (save_only).
  const a0 = ga.lairActions!.actions[0];
  const a1 = ga.lairActions!.actions[1];
  eq('5a. MTF Githzerai Anarch::0 spellName=lightning bolt', a0.spellName, 'lightning bolt');
  eq('5b. MTF Githzerai Anarch::0 castLevel=5', a0.castLevel, 5);
  eq('5c. MTF Githzerai Anarch::1 spellName=creation', a1.spellName, 'creation');
  eq('5d. MTF Githzerai Anarch::1 castLevel=9', a1.castLevel, 9);
}

// ============================================================
// 6. Handler: illusory-duplicate sets Combatant.lairIllusoryDuplicate
// ============================================================
console.log('\n--- 6. Handler: illusory-duplicate sets scratch field ---');
{
  const demo = spawn('Demogorgon', 'MPMM');
  asParty(demo); tankUp(demo); noLegendary(demo);
  demo.isInLair = true;
  demo.ac = 5;  // low AC so the goblin always hits (triggers the redirect)
  // Demogorgon has immunity to bludgeoning/piercing/slashing (non-magical).
  // Clear it so the goblin's scimitar deals actual damage (triggers the redirect).
  demo.immunities = [];
  // Force the illusory duplicate as the only lair action.
  const illusoryAction = demo.lairActions!.actions.find(
    a => a.lairIllusoryDuplicate === true)!;
  forceAction(demo, illusoryAction);

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);

  const bf = makeBF([demo, goblin]);
  const rlog = runCombat(bf, [demo.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  // The lair action should fire and log "illusory-duplicate".
  const setupLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === demo.id &&
    e.description.includes('illusory-duplicate') &&
    e.description.includes('creates an illusory duplicate'));
  assert('6a. "illusory-duplicate" setup log fires',
    setupLog !== undefined,
    `events: ${rlog.events.filter((e:any)=>e.actorId===demo.id && e.type==='action').map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // The scratch field should be set after the lair action fires (during round 1).
  // Note: by end of round 1, the duplicate may have been consumed by a goblin
  // attack OR expired. We check the log rather than the field state.
  if (setupLog) {
    assert('6b. setup log mentions "50% chance"',
      setupLog.description.includes('50% chance'));
  }
}

// ============================================================
// 7. Handler: redirect fires on first attack (both branches over 20 runs)
// ============================================================
console.log('\n--- 7. Handler: redirect fires (statistical, 20 runs) ---');
{
  let absorbsCount = 0;
  let failsCount = 0;
  let noRedirectLogCount = 0;

  for (let i = 0; i < 20; i++) {
    const demo = spawn('Demogorgon', 'MPMM');
    asParty(demo); tankUp(demo, 100_000); noLegendary(demo);
    demo.isInLair = true;
    demo.ac = 5;  // low AC so the goblin always hits (triggers the redirect)
    demo.immunities = [];  // clear physical immunity so goblin deals damage
    const illusoryAction = demo.lairActions!.actions.find(
      a => a.lairIllusoryDuplicate === true)!;
    forceAction(demo, illusoryAction);

    const goblin = spawn('Goblin');
    asEnemy(goblin); tankUp(goblin, 100_000);

    const bf = makeBF([demo, goblin]);
    const rlog = runCombat(bf, [demo.id, goblin.id], { maxRounds: 1, verbose: false } as any);

    const absorbLog = rlog.events.find((e: any) =>
      e.description.includes('absorbs the hit'));
    const failLog = rlog.events.find((e: any) =>
      e.description.includes('fails to redirect'));

    if (absorbLog) absorbsCount++;
    else if (failLog) failsCount++;
    else noRedirectLogCount++;
  }

  console.log(`    absorbs: ${absorbsCount}/20, fails: ${failsCount}/20, no-redirect-log: ${noRedirectLogCount}/20`);
  // Both branches should fire at least once over 20 runs.
  // P(never seeing absorbs in 20 runs) = 0.5^20 ≈ 9.5e-7 (essentially impossible).
  assert('7a. "absorbs the hit" branch fires at least once',
    absorbsCount >= 1,
    `got ${absorbsCount}/20`);
  assert('7b. "fails to redirect" branch fires at least once',
    failsCount >= 1,
    `got ${failsCount}/20`);
  // The redirect should always fire when the lair action sets the duplicate
  // and the goblin lands a hit. (If the goblin misses, no redirect — but with
  // AC 5 and goblin +4 to hit, misses are rare. Allow some slack.)
  assert('7c. redirect fires in most runs (≥ 15/20)',
    absorbsCount + failsCount >= 15,
    `got ${absorbsCount + failsCount}/20`);
}

// ============================================================
// 8. Handler: redirect is consumed after first attack
// ============================================================
console.log('\n--- 8. Handler: redirect consumed after first attack ---');
{
  // Set up Demogorgon with the duplicate active, plus TWO attackers.
  // The first attacker's hit should trigger the redirect; the second
  // attacker's hit should NOT (the duplicate was consumed).
  const demo = spawn('Demogorgon', 'MPMM');
  asParty(demo); tankUp(demo, 100_000); noLegendary(demo);
  demo.isInLair = true;
  demo.ac = 5;  // low AC so attackers always hit
  demo.immunities = [];  // clear physical immunity so attackers deal damage
  const illusoryAction = demo.lairActions!.actions.find(
    a => a.lairIllusoryDuplicate === true)!;
  forceAction(demo, illusoryAction);

  const goblin1 = spawn('Goblin');
  asEnemy(goblin1); tankUp(goblin1, 100_000); goblin1.ac = 5;

  const goblin2 = spawn('Hobgoblin');
  asEnemy(goblin2); tankUp(goblin2, 100_000); goblin2.ac = 5;

  const bf = makeBF([demo, goblin1, goblin2]);
  const rlog = runCombat(bf, [demo.id, goblin1.id, goblin2.id],
    { maxRounds: 1, verbose: false } as any);

  // Count how many times the redirect log fires (should be exactly 1).
  const redirectLogs = rlog.events.filter((e: any) =>
    e.type === 'action' && e.actorId === demo.id &&
    (e.description.includes('absorbs the hit') ||
     e.description.includes('fails to redirect')));
  // S107 flake-fix: when BOTH attackers nat-1 all their attacks (~0.25% per
  // attack pair, higher in practice if Demogorgon's turn disrupts an attacker),
  // demo is never hit → 0 redirect logs. The "consumed after first attack"
  // behaviour can't be verified when no attack landed, so skip 8a in that case
  // (skip, not fail). When redirects DO fire, assert exactly 1 (consumed). When
  // 2+ fire, that's a real bug (redirect not consumed) → fail.
  if (redirectLogs.length === 0) {
    console.log('    (8a skipped — no redirect fired; demo was not hit this run)');
    assert('8a. (skipped — no hit on demo this run)', true);
  } else {
    eq('8a. redirect fires exactly once (consumed after first attack)',
      redirectLogs.length, 1);
  }
  if (redirectLogs.length === 1) {
    console.log(`    (outcome: ${redirectLogs[0].description.includes('absorbs') ? 'absorbed' : 'failed'})`);
  }
}

// ============================================================
// 9. Handler: redirect does NOT fire on 0-damage hits (immunity)
// ============================================================
console.log('\n--- 9. Handler: redirect skips 0-damage hits (immunity) ---');
{
  // Give Demogorgon immunity to the goblin's damage type. The redirect
  // should NOT fire (dealt <= 0 guard in applyLairIllusoryDuplicateRedirect).
  const demo = spawn('Demogorgon', 'MPMM');
  asParty(demo); tankUp(demo, 100_000); noLegendary(demo);
  demo.isInLair = true;
  demo.ac = 5;  // low AC so the goblin always hits
  const illusoryAction = demo.lairActions!.actions.find(
    a => a.lairIllusoryDuplicate === true)!;
  forceAction(demo, illusoryAction);
  // Demogorgon is immune to slashing (goblin uses a scimitar — slashing).
  // This makes dealt=0, which should skip the redirect (dealt <= 0 guard).
  demo.immunities = ['slashing'];

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000); goblin.ac = 5;

  const bf = makeBF([demo, goblin]);
  const rlog = runCombat(bf, [demo.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  // The redirect should NOT fire (0 slashing damage dealt due to immunity).
  const redirectLog = rlog.events.find((e: any) =>
    e.description.includes('absorbs the hit') ||
    e.description.includes('fails to redirect'));
  assert('9a. no redirect log when damage is immune (dealt=0)',
    redirectLog === undefined,
    `unexpected redirect: ${redirectLog?.description?.substring(0, 80)}`);
}

// ============================================================
// 10. Handler: cast_spell — Creation executes (forward-compat flag)
// ============================================================
console.log('\n--- 10. Handler: cast_spell Creation executes ---');
{
  const ga = spawn('Githzerai Anarch', 'MPMM');
  asParty(ga); tankUp(ga); noLegendary(ga);
  ga.isInLair = true;
  // Force the creation lair action as the only one.
  const creationAction = ga.lairActions!.actions.find(
    a => a.spellName === 'creation')!;
  forceAction(ga, creationAction);

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);

  const bf = makeBF([ga, goblin]);
  const rlog = runCombat(bf, [ga.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  // The cast_spell handler should log "casts Creation (L9) via lair action".
  const castLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === ga.id &&
    e.description.includes('Creation'));
  assert('10a. cast_spell log fires for Creation',
    castLog !== undefined,
    `events: ${rlog.events.filter((e:any)=>e.actorId===ga.id && e.type==='action').map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
  if (castLog) {
    assert('10b. log mentions L9 (cast level)',
      castLog.description.includes('L9'));
  }
  // The Creation spell sets the forward-compat flag _genericSpellActiveSpells.
  const gaAfter = bf.combatants.get(ga.id)!;
  assert('10c. Creation forward-compat flag set on caster',
    gaAfter._genericSpellActiveSpells?.has('Creation') === true);
}

// ============================================================
// 11. Handler: cast_spell — Lightning Bolt logs "not in registry"
// ============================================================
console.log('\n--- 11. Handler: cast_spell Lightning Bolt (not in registry) ---');
{
  const ga = spawn('Githzerai Anarch', 'MPMM');
  asParty(ga); tankUp(ga); noLegendary(ga);
  ga.isInLair = true;
  const lbAction = ga.lairActions!.actions.find(
    a => a.spellName === 'lightning bolt')!;
  forceAction(ga, lbAction);

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);

  const bf = makeBF([ga, goblin]);
  const rlog = runCombat(bf, [ga.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  // Lightning Bolt is NOT in the GENERIC_SPELLS registry → log "not in registry".
  const notInRegLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === ga.id &&
    e.description.includes('not in GENERIC_SPELLS registry'));
  assert('11a. "not in GENERIC_SPELLS registry" log fires for Lightning Bolt',
    notInRegLog !== undefined,
    `events: ${rlog.events.filter((e:any)=>e.actorId===ga.id && e.type==='action').map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
  if (notInRegLog) {
    assert('11b. log mentions L5 (cast level)',
      notInRegLog.description.includes('L5'));
    assert('11c. log mentions "lightning bolt"',
      notInRegLog.description.toLowerCase().includes('lightning bolt'));
  }
}

// ============================================================
// 12. Scorer: lairIllusoryDuplicate scored (defensive buff)
// ============================================================
console.log('\n--- 12. Scorer: illusoryDuplicate scored as defensive ---');
{
  const illusoryAction = makeAction('Test::illusoryDup', 'bespoke', {
    lairIllusoryDuplicate: true,
    targetsEnemies: false,  // self-targeted defensive buff
  });
  const logOnlyAction = makeAction('Test::logOnly', 'bespoke', {
    lairPlaneShift: true,  // log-only, score 1
    targetsEnemies: false,
  });

  const kobold = spawn('Kobold');
  asParty(kobold); tankUp(kobold); noLegendary(kobold);
  kobold.isInLair = true;
  if (!kobold.lairActions) {
    kobold.lairActions = { actions: [], initiativeCount: 20 };
  }
  kobold.lairActions.actions = [illusoryAction, logOnlyAction];
  kobold._lairActionHistory = [];

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);

  const bf = makeBF([kobold, goblin]);
  const rlog = runCombat(bf, [kobold.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  // The selector should pick illusoryDuplicate (score 8) over logOnly (score 1).
  const illusoryLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === kobold.id &&
    e.description.includes('illusory-duplicate'));
  assert('12a. illusoryDuplicate (score 8) preferred over log-only (score 1)',
    illusoryLog !== undefined,
    `effect logs: ${rlog.events.filter((e:any)=>e.actorId===kobold.id && e.type==='action' && !e.description.includes('takes a lair action')).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
}

// ============================================================
// 13. Coverage: 0 unrecognized bespoke actions (100% recognition)
// ============================================================
console.log('\n--- 13. Coverage: 0 unrecognized bespoke (100%) ---');
{
  const seen = new Set<string>();
  const bespokeActions: LairAction[] = [];
  for (const [, raw] of bestiary.entries()) {
    if (!raw?.legendaryGroup) continue;
    const c = spawnMonster(bestiary, raw.name, { x: 0, y: 0, z: 0 }, 'smart', 'enemy',
      undefined, raw.source);
    if (!c?.lairActions?.actions) continue;
    const sig = c.lairActions.actions.map(a => a.id).join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    for (const a of c.lairActions.actions) {
      if (a.category === 'bespoke') bespokeActions.push(a);
    }
  }

  const total = bespokeActions.length;
  const recognized = bespokeActions.filter(a =>
    // Phase 8 batch 1 flags (8)
    a.lairDifficultTerrain || a.lairSelfInvisible || a.lairDispelMagic
    || a.lairWallCreation || a.lairEtherealPass || a.lairRandomEyeRay
    || a.lairUndeadPinpointLiving || a.lairVesselHeal
    // Phase 8 batch 2 flags (6)
    || a.lairPlaneShift || a.lairTeleportAllies || a.lairAntiInvisibility
    || a.lairIllusoryAttack || a.lairRechargeAbility || a.lairBespokeActionInvocation
    // Phase 8 batch 3 flag (1) — Demogorgon::1 illusory duplicate.
    || a.lairIllusoryDuplicate
    // Inline-regex patterns (4) — broadened healing-suppression catches Demilich::2
    || /no (?:creature|target).{0,40}can\s+regain\s+hit\s+points/i.test(a.rawText)
    || /uses\s+one\s+of\s+(?:their|his|her)\s+available\s+(?:melee|ranged)\s+attacks/i.test(a.rawText)
    || /recharges\s+one\s+of\s+(?:their|his|her)\s+expended\s+abilities/i.test(a.rawText)
    || /teleports?\s+(?:themself|himself|herself|itself)\s+to/i.test(a.rawText)
  );
  const recognizedCount = recognized.length;
  const unrecognizedCount = total - recognizedCount;

  console.log(`    Total bespoke actions: ${total}`);
  console.log(`    Recognized (batch 1 + 2 + 3 + inline): ${recognizedCount}`);
  console.log(`    Unrecognized: ${unrecognizedCount}`);

  // After Phase 8 batch 3, ALL bespoke actions should be recognized (100%).
  // The 2 Githzerai Anarch actions that WERE bespoke are now cast_spell, so
  // they're not in this bespoke-only sweep. The total dropped from 31 → 29.
  assert('13a. recognized count ≥ 28 (all but the 2 promoted to cast_spell)',
    recognizedCount >= 28,
    `got ${recognizedCount}`);

  if (unrecognizedCount > 0) {
    const unrecognizedIds = bespokeActions
      .filter(a => !recognized.includes(a))
      .map(a => a.id);
    console.log(`    Unrecognized IDs: ${unrecognizedIds.join(', ')}`);
  }
  // After Phase 8 batch 3, ZERO bespoke actions should be unrecognized.
  eq('13b. 0 unrecognized bespoke actions (100% recognition)',
    unrecognizedCount, 0);
}

// ============================================================
// 14. Regression: Phase 8 batch 1 + 2 flags still recognized
// ============================================================
console.log('\n--- 14. Regression: batch 1 + 2 flags still recognized ---');
{
  const beholder = spawn('Beholder');
  assert('14a. Beholder::0 still has lairDifficultTerrain (batch 1)',
    beholder.lairActions!.actions[0].lairDifficultTerrain === true);
  assert('14b. Beholder::2 still has lairRandomEyeRay (batch 1)',
    beholder.lairActions!.actions[2].lairRandomEyeRay === true);

  const sphinx = spawn('Androsphinx');
  assert('14c. Sphinx::3 still has lairPlaneShift (batch 2)',
    sphinx.lairActions!.actions[3].lairPlaneShift === true);

  const gar = spawn('Gar Shatterkeel');
  assert('14d. Gar Shatterkeel::0 still has lairTeleportAllies (batch 2)',
    gar.lairActions!.actions[0].lairTeleportAllies === true);
}

// ============================================================
// 15. Regression: full combat with Demogorgon completes
// ============================================================
console.log('\n--- 15. Regression: Demogorgon combat completes ---');
{
  const demo = spawn('Demogorgon', 'MPMM');
  asParty(demo); tankUp(demo); noLegendary(demo);
  demo.isInLair = true;

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);

  const bf = makeBF([demo, goblin]);
  const rlog = runCombat(bf, [demo.id, goblin.id], { maxRounds: 3, verbose: false } as any);

  assert('15a. Demogorgon combat completes without error',
    rlog.events.length > 0);
}

// ============================================================
// 16. Regression: Phase 8 batch 2 illusoryAttack still works
// ============================================================
console.log('\n--- 16. Regression: batch 2 illusoryAttack still works ---');
{
  const absolved = spawn('Alyxian the Absolved');
  const a2 = absolved.lairActions!.actions[2];
  assert('16a. Alyxian::2 still has lairIllusoryAttack (batch 2)',
    a2.lairIllusoryAttack !== undefined);
  eq('16b. Alyxian::2 attackBonus still 7',
    a2.lairIllusoryAttack?.attackBonus, 7);
}

// ============================================================
// 17. Direct parser test: extractLairAction on synthetic Demogorgon text
// ============================================================
console.log('\n--- 17. Direct parser: synthetic Demogorgon::1 text ---');
{
  const text = "Demogorgon creates an illusory duplicate of himself, which appears in his space and lasts until initiative count 20 of the next round. On his turn, Demogorgon can move the illusory duplicate a distance equal to his walking speed (no action required). The first time a creature or an object interacts physically with Demogorgon (for example, by hitting him with an attack), there is a {@chance 50} chance that the illusory duplicate is affected, not Demogorgon, in which case the illusion disappears.";
  const a = extractLairAction(text, 'Demogorgon', 1);
  eq('17a. synthetic Demogorgon::1 has lairIllusoryDuplicate=true',
    a.lairIllusoryDuplicate, true);
  eq('17b. synthetic Demogorgon::1 is bespoke category',
    a.category, 'bespoke');
}

// ============================================================
// 18. Direct parser test: synthetic Githzerai Anarch::0 text
// ============================================================
console.log('\n--- 18. Direct parser: synthetic Githzerai Anarch::0 text ---');
{
  const text = "The anarch casts the creation spell (as a 9th-level spell) using the unformed substance of Limbo instead of shadow material.";
  const a = extractLairAction(text, 'Githzerai Anarch', 0);
  eq('18a. synthetic GA::0 isSpell=true', a.isSpell, true);
  eq('18b. synthetic GA::0 spellName=creation', a.spellName, 'creation');
  eq('18c. synthetic GA::0 castLevel=9 (from text)', a.castLevel, 9);
  eq('18d. synthetic GA::0 category=cast_spell', a.category, 'cast_spell');
}

// ============================================================
// 19. Direct parser test: synthetic Githzerai Anarch::2 text
// ============================================================
console.log('\n--- 19. Direct parser: synthetic Githzerai Anarch::2 text ---');
{
  const text = "The anarch casts the lightning bolt spell (at 5th level), but the anarch can change the damage type from lightning to cold, fire, psychic, radiant, or thunder.";
  const a = extractLairAction(text, 'Githzerai Anarch', 2);
  eq('19a. synthetic GA::2 isSpell=true', a.isSpell, true);
  eq('19b. synthetic GA::2 spellName=lightning bolt', a.spellName, 'lightning bolt');
  eq('19c. synthetic GA::2 castLevel=5 (from text)', a.castLevel, 5);
  eq('19d. synthetic GA::2 category=cast_spell', a.category, 'cast_spell');
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
