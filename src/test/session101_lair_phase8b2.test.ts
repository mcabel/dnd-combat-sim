// ============================================================
// Test: Session 101 — RFC-LAIRACTIONS Phase 8 batch 2
//       six more bespoke-category recognition flags + handlers.
//
// Validates the Phase 8 batch 2 deliverables implemented in this session:
//   1. LairAction.lairPlaneShift — parsed from "shifts itself and up to N
//      other creatures ... to another plane of existence" (Sphinx::3).
//      Log-only handler (out-of-combat effect).
//   2. LairAction.lairTeleportAllies — parsed from "teleports ... bringing
//      up to N willing creatures" (Gar Shatterkeel::0). Log-only handler.
//   3. LairAction.lairAntiInvisibility — parsed from "can't become hidden ...
//      invisible condition" (Drow Matron Mother::0). Log-only handler.
//   4. LairAction.lairIllusoryAttack = { attackBonus, damage } — parsed from
//      "makes one melee weapon attack (N to hit) ... deals M (XdY + Z) [type]
//      damage" (Alyxian the Absolved::2, Callous::2, Dispossessed::2,
//      Tormented::2). MECHANICAL handler: rolls melee attack vs AC, applies
//      damage on hit.
//   5. LairAction.lairRechargeAbility — parsed from "recharges its [X]
//      ability" (Greater Tyrant Shadow::1). Log-only handler.
//   6. LairAction.lairBespokeActionInvocation — parsed from "uses its [X]
//      action" / "uses either her [X] or [Y]" (Dyrrn::0, Morkoth::1,
//      Zuggtmoy::2). Log-only handler.
//   7. Broadened healing-suppression regex from "no creature" to
//      "no (creature|target)" — now catches Demilich::2 ("No target can
//      regain hit points").
//
// After this session, 28 of 31 bespoke actions are recognized (90%).
// The remaining 3 (Demogorgon::1, Githzerai Anarch::0/::2) are deferred to
// Phase 8 batch 3.
//
// Run: npx ts-node --transpile-only src/test/session101_lair_phase8b2.test.ts
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
// 1. Parser: plane-shift flag (Sphinx::3)
// ============================================================
console.log('\n--- 1. Parser: lairPlaneShift (Sphinx::3) ---');
{
  // The "Sphinx" legendary group is accessed via Androsphinx/Gynosphinx.
  const sphinx = spawn('Androsphinx');
  const s3 = sphinx.lairActions!.actions[3];
  eq('1a. Sphinx::3 has lairPlaneShift=true', s3.lairPlaneShift, true);
  eq('1b. Sphinx::3 is bespoke category', s3.category, 'bespoke');
}

// ============================================================
// 2. Parser: teleport-with-allies flag (Gar Shatterkeel::0)
// ============================================================
console.log('\n--- 2. Parser: lairTeleportAllies (Gar Shatterkeel::0) ---');
{
  const gar = spawn('Gar Shatterkeel');
  const g0 = gar.lairActions!.actions[0];
  eq('2a. Gar Shatterkeel::0 has lairTeleportAllies=true', g0.lairTeleportAllies, true);
  eq('2b. Gar Shatterkeel::0 is bespoke category', g0.category, 'bespoke');
}

// ============================================================
// 3. Parser: anti-invisibility flag (Drow Matron Mother::0)
// ============================================================
console.log('\n--- 3. Parser: lairAntiInvisibility (Drow Matron Mother::0) ---');
{
  const drow = spawn('Drow Matron Mother');
  const d0 = drow.lairActions!.actions[0];
  eq('3a. Drow Matron Mother::0 has lairAntiInvisibility=true', d0.lairAntiInvisibility, true);
  eq('3b. Drow Matron Mother::0 is bespoke category', d0.category, 'bespoke');
}

// ============================================================
// 4. Parser: illusory-attack flag (Alyxian x4 variants)
// ============================================================
console.log('\n--- 4. Parser: lairIllusoryAttack (Alyxian x4 variants) ---');
{
  const absolved = spawn('Alyxian the Absolved');
  const a2 = absolved.lairActions!.actions[2];
  assert('4a. Alyxian the Absolved::2 has lairIllusoryAttack set',
    a2.lairIllusoryAttack !== undefined);
  eq('4b. Absolved::2 attackBonus=7', a2.lairIllusoryAttack?.attackBonus, 7);
  // The Absolved variant has "10d8 + 4" (likely a 5eTools typo). The parser
  // extracts whatever the text says.
  if (a2.lairIllusoryAttack) {
    console.log(`    (Absolved dmg: ${a2.lairIllusoryAttack.damage.count}d${a2.lairIllusoryAttack.damage.sides}+${a2.lairIllusoryAttack.damage.bonus} ${a2.lairIllusoryAttack.damage.type})`);
  }

  const callous = spawn('Alyxian the Callous');
  const c2 = callous.lairActions!.actions[2];
  assert('4c. Alyxian the Callous::2 has lairIllusoryAttack set',
    c2.lairIllusoryAttack !== undefined);
  eq('4d. Callous::2 attackBonus=7', c2.lairIllusoryAttack?.attackBonus, 7);
  eq('4e. Callous::2 damage=1d8+4', c2.lairIllusoryAttack?.damage.count, 1);
  eq('4f. Callous::2 damage sides=8', c2.lairIllusoryAttack?.damage.sides, 8);
  eq('4g. Callous::2 damage bonus=4', c2.lairIllusoryAttack?.damage.bonus, 4);
  eq('4h. Callous::2 damage type=bludgeoning', c2.lairIllusoryAttack?.damage.type, 'bludgeoning');

  // Dispossessed and Tormented should match the same pattern.
  const dispossessed = spawn('Alyxian the Dispossessed');
  const d2 = dispossessed.lairActions!.actions[2];
  assert('4i. Alyxian the Dispossessed::2 has lairIllusoryAttack set',
    d2.lairIllusoryAttack !== undefined);

  const tormented = spawn('Alyxian the Tormented');
  const t2 = tormented.lairActions!.actions[2];
  assert('4j. Alyxian the Tormented::2 has lairIllusoryAttack set',
    t2.lairIllusoryAttack !== undefined);
}

// ============================================================
// 5. Parser: recharge-ability flag (Greater Tyrant Shadow::1)
// ============================================================
console.log('\n--- 5. Parser: lairRechargeAbility (Greater Tyrant Shadow::1) ---');
{
  const shadow = spawn('Greater Tyrant Shadow');
  const s1 = shadow.lairActions!.actions[1];
  eq('5a. Greater Tyrant Shadow::1 has lairRechargeAbility=true', s1.lairRechargeAbility, true);
  eq('5b. Greater Tyrant Shadow::1 is bespoke category', s1.category, 'bespoke');
}

// ============================================================
// 6. Parser: bespoke-action-invocation flag (Dyrrn::0, Morkoth::1, Zuggtmoy::2)
// ============================================================
console.log('\n--- 6. Parser: lairBespokeActionInvocation ---');
{
  const dyrrn = spawn('Dyrrn');
  const d0 = dyrrn.lairActions!.actions[0];
  eq('6a. Dyrrn::0 has lairBespokeActionInvocation=true', d0.lairBespokeActionInvocation, true);
  eq('6b. Dyrrn::0 is bespoke category', d0.category, 'bespoke');

  const morkoth = spawn('Morkoth');
  const m1 = morkoth.lairActions!.actions[1];
  eq('6c. Morkoth::1 has lairBespokeActionInvocation=true', m1.lairBespokeActionInvocation, true);

  const zuggtmoy = spawn('Zuggtmoy');
  const z2 = zuggtmoy.lairActions!.actions[2];
  eq('6d. Zuggtmoy::2 has lairBespokeActionInvocation=true', z2.lairBespokeActionInvocation, true);
}

// ============================================================
// 7. Parser: broadened healing-suppression regex (Demilich::2)
// ============================================================
console.log('\n--- 7. Parser: healing-suppression regex broadened for Demilich::2 ---');
{
  const demilich = spawn('Demilich');
  const d2 = demilich.lairActions!.actions[2];
  // Demilich::2 says "No target can regain hit points" — the old regex
  // required "no creature" and missed this. The broadened regex catches it.
  const matchesHealSuppress = /no (?:creature|target).{0,40}can\s+regain\s+hit\s+points/i.test(d2.rawText);
  assert('7a. Demilich::2 rawText matches broadened healing-suppression regex',
    matchesHealSuppress,
    `rawText: ${d2.rawText.substring(0, 120)}`);
  eq('7b. Demilich::2 is bespoke category', d2.category, 'bespoke');

  // Also verify the old Fazrian::0 still matches.
  const fazrian = spawn('Fazrian');
  const f0 = fazrian.lairActions!.actions[0];
  const fazrianMatches = /no (?:creature|target).{0,40}can\s+regain\s+hit\s+points/i.test(f0.rawText);
  assert('7c. Fazrian::0 still matches broadened regex', fazrianMatches);
}

// ============================================================
// 8. Handler: plane-shift log fires for Sphinx::3
// ============================================================
console.log('\n--- 8. Handler: plane-shift log fires ---');
{
  const sphinx = spawn('Androsphinx');
  asParty(sphinx); tankUp(sphinx); noLegendary(sphinx);
  sphinx.isInLair = true;
  const psAction = sphinx.lairActions!.actions[3];
  forceAction(sphinx, psAction);

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);

  const bf = makeBF([sphinx, goblin]);
  const rlog = runCombat(bf, [sphinx.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  const psLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === sphinx.id &&
    e.description.includes('plane-shift'));
  assert('8a. "plane-shift" log fires for Sphinx::3',
    psLog !== undefined,
    `no log; events: ${rlog.events.filter((e:any)=>e.actorId===sphinx.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
  if (psLog) {
    assert('8b. log mentions "log-only"',
      psLog.description.includes('log-only'));
    assert('8c. log mentions "out-of-combat"',
      psLog.description.includes('out-of-combat'));
  }
}

// ============================================================
// 9. Handler: teleport-with-allies log fires for Gar Shatterkeel::0
// ============================================================
console.log('\n--- 9. Handler: teleport-with-allies log fires ---');
{
  const gar = spawn('Gar Shatterkeel');
  asParty(gar); tankUp(gar); noLegendary(gar);
  gar.isInLair = true;
  const taAction = gar.lairActions!.actions[0];
  forceAction(gar, taAction);

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);

  const bf = makeBF([gar, goblin]);
  const rlog = runCombat(bf, [gar.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  const taLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === gar.id &&
    e.description.includes('teleport-with-allies'));
  assert('9a. "teleport-with-allies" log fires for Gar Shatterkeel::0',
    taLog !== undefined,
    `no log; events: ${rlog.events.filter((e:any)=>e.actorId===gar.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
  if (taLog) {
    assert('9b. log mentions "log-only"',
      taLog.description.includes('log-only'));
  }
}

// ============================================================
// 10. Handler: anti-invisibility log fires for Drow Matron Mother::0
// ============================================================
console.log('\n--- 10. Handler: anti-invisibility log fires ---');
{
  const drow = spawn('Drow Matron Mother');
  asParty(drow); tankUp(drow); noLegendary(drow);
  drow.isInLair = true;
  const aiAction = drow.lairActions!.actions[0];
  forceAction(drow, aiAction);

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);

  const bf = makeBF([drow, goblin]);
  const rlog = runCombat(bf, [drow.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  const aiLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === drow.id &&
    e.description.includes('anti-invisibility'));
  assert('10a. "anti-invisibility" log fires for Drow Matron Mother::0',
    aiLog !== undefined,
    `no log; events: ${rlog.events.filter((e:any)=>e.actorId===drow.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
  if (aiLog) {
    assert('10b. log mentions "perception meta-flag"',
      aiLog.description.includes('perception meta-flag'));
  }
}

// ============================================================
// 11. Handler: illusory-attack MECHANICAL — rolls attack + damage
// ============================================================
console.log('\n--- 11. Handler: illusory-attack is mechanical ---');
{
  // Use a Kobold lair creature with a synthetic illusory-attack action.
  // Set the Goblin's AC to 30 so the attack always misses (deterministic).
  const kobold = spawn('Kobold');
  asParty(kobold); tankUp(kobold); noLegendary(kobold);
  kobold.isInLair = true;
  // S108 flake-fix: clear the Kobold's regular actions so ONLY the lair
  // action fires. Without this, the Kobold's regular dagger attack can
  // nat-20 (auto-hit per PHB p.194) vs the AC-30 Goblin, producing a
  // damage log that breaks §11d's "no damage on miss" assertion (~5%
  // per run). The lair action fires from lairActions, not actions, so
  // clearing actions doesn't affect the illusory-attack test.
  kobold.actions = [];
  forceAction(kobold, makeAction('TestIllusoryAttack::0', 'bespoke', {
    rawText: 'makes one melee weapon attack (7 to hit) against it. On a hit, the attack deals 8 (1d8 + 4) bludgeoning damage.',
    lairIllusoryAttack: {
      attackBonus: 7,
      damage: { count: 1, sides: 8, bonus: 4, type: 'bludgeoning' },
    },
    targetsEnemies: true,
  }));

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);
  goblin.ac = 30;  // always miss

  const bf = makeBF([kobold, goblin]);
  const rlog = runCombat(bf, [kobold.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  // 11a. The "illusory-attack" log fires.
  const atkLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === kobold.id &&
    e.description.includes('illusory-attack'));
  assert('11a. "illusory-attack" log fires',
    atkLog !== undefined,
    `no log; events: ${rlog.events.filter((e:any)=>e.actorId===kobold.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 11b. The attack roll log shows the d20+7 vs AC 30.
  if (atkLog) {
    assert('11b. log shows attack roll vs AC 30',
      atkLog.description.includes('vs AC 30'));
  }

  // 11c. Since AC=30 and attackBonus=7, the attack always misses (max d20+7=27 < 30).
  // The miss log should fire.
  const missLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === kobold.id &&
    e.description.includes('miss'));
  assert('11c. miss log fires (AC 30 always beats d20+7)',
    missLog !== undefined);

  // 11d. No damage log should fire (attack missed).
  // S108 flake-fix: the illusory-attack itself can nat-20 (auto-hit per PHB
  // p.194, ~5% chance) even vs AC 30, producing a CRIT damage log. This is
  // correct PHB behavior (nat 20 always hits), not a bug — skip the assertion
  // in that case. Only fail if damage appears WITHOUT a crit (a real bug:
  // damage on a non-crit miss).
  const dmgLog = rlog.events.find((e: any) =>
    e.type === 'damage' && e.actorId === kobold.id);
  if (dmgLog && dmgLog.description.includes('CRIT')) {
    console.log('    (11d skipped — illusory-attack nat-20 auto-hit (CRIT); PHB p.194: nat 20 always hits)');
    assert('11d. (skipped — nat-20 crit auto-hit)', true);
  } else {
    assert('11d. no damage log on miss',
      dmgLog === undefined,
      `unexpected damage: ${dmgLog?.description}`);
  }
}

// ============================================================
// 12. Handler: illusory-attack MECHANICAL — hits and deals damage
// ============================================================
console.log('\n--- 12. Handler: illusory-attack hits and deals damage ---');
{
  const kobold = spawn('Kobold');
  asParty(kobold); tankUp(kobold); noLegendary(kobold);
  kobold.isInLair = true;
  forceAction(kobold, makeAction('TestIllusoryAttack::0', 'bespoke', {
    rawText: 'makes one melee weapon attack (7 to hit) against it. On a hit, the attack deals 8 (1d8 + 4) bludgeoning damage.',
    lairIllusoryAttack: {
      attackBonus: 7,
      damage: { count: 1, sides: 8, bonus: 4, type: 'bludgeoning' },
    },
    targetsEnemies: true,
  }));

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);
  goblin.ac = 5;  // always hit (min d20+7=8 ≥ 5)

  const bf = makeBF([kobold, goblin]);
  const rlog = runCombat(bf, [kobold.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  // 12a. The attack hits (d20+7 ≥ 5 always).
  const hitLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === kobold.id &&
    e.description.includes('vs AC 5'));
  assert('12a. attack roll log shows vs AC 5',
    hitLog !== undefined);

  // 12b. Damage log fires.
  const dmgLog = rlog.events.find((e: any) =>
    e.type === 'damage' && e.actorId === kobold.id &&
    e.description.includes('bludgeoning damage'));
  assert('12b. damage log fires on hit',
    dmgLog !== undefined,
    `no damage log; events: ${rlog.events.filter((e:any)=>e.actorId===kobold.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 12c. The goblin took damage (currentHP < maxHP).
  const goblinAfter = bf.combatants.get(goblin.id)!;
  assert('12c. goblin HP decreased after illusory attack',
    goblinAfter.currentHP < goblinAfter.maxHP,
    `HP: ${goblinAfter.currentHP}/${goblinAfter.maxHP}`);
}

// ============================================================
// 13. Handler: recharge-ability log fires for Greater Tyrant Shadow::1
// ============================================================
console.log('\n--- 13. Handler: recharge-ability log fires ---');
{
  const shadow = spawn('Greater Tyrant Shadow');
  asParty(shadow); tankUp(shadow); noLegendary(shadow);
  shadow.isInLair = true;
  const rAction = shadow.lairActions!.actions[1];
  forceAction(shadow, rAction);

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);

  const bf = makeBF([shadow, goblin]);
  const rlog = runCombat(bf, [shadow.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  const rLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === shadow.id &&
    e.description.includes('recharge-ability'));
  assert('13a. "recharge-ability" log fires for Greater Tyrant Shadow::1',
    rLog !== undefined,
    `no log; events: ${rlog.events.filter((e:any)=>e.actorId===shadow.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
  if (rLog) {
    assert('13b. log mentions "log-only"',
      rLog.description.includes('log-only'));
  }
}

// ============================================================
// 14. Handler: bespoke-action-invocation log fires for Dyrrn::0
// ============================================================
console.log('\n--- 14. Handler: bespoke-action-invocation log fires ---');
{
  const dyrrn = spawn('Dyrrn');
  asParty(dyrrn); tankUp(dyrrn); noLegendary(dyrrn);
  dyrrn.isInLair = true;
  const biAction = dyrrn.lairActions!.actions[0];
  forceAction(dyrrn, biAction);

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);

  const bf = makeBF([dyrrn, goblin]);
  const rlog = runCombat(bf, [dyrrn.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  const biLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === dyrrn.id &&
    e.description.includes('bespoke-action-invocation'));
  assert('14a. "bespoke-action-invocation" log fires for Dyrrn::0',
    biLog !== undefined,
    `no log; events: ${rlog.events.filter((e:any)=>e.actorId===dyrrn.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
  if (biLog) {
    assert('14b. log mentions "named action not modeled"',
      biLog.description.includes('named action not modeled'));
  }
}

// ============================================================
// 15. Handler: healing-suppression log fires for Demilich::2
// ============================================================
console.log('\n--- 15. Handler: healing-suppression log fires for Demilich::2 ---');
{
  const demilich = spawn('Demilich');
  asParty(demilich); tankUp(demilich); noLegendary(demilich);
  demilich.isInLair = true;
  const hsAction = demilich.lairActions!.actions[2];
  forceAction(demilich, hsAction);

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);

  const bf = makeBF([demilich, goblin]);
  const rlog = runCombat(bf, [demilich.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  const hsLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === demilich.id &&
    e.description.includes('healing-suppression'));
  assert('15a. "healing-suppression" log fires for Demilich::2',
    hsLog !== undefined,
    `no log; events: ${rlog.events.filter((e:any)=>e.actorId===demilich.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
}

// ============================================================
// 16. Scorer: illusoryAttack scores as expected damage
// ============================================================
console.log('\n--- 16. Scorer: illusoryAttack weighted by expected damage ---');
{
  // The illusoryAttack score = targets.length × avgDmg × pHit × damagePerEnemy.
  // For 1d8+4 (avg 8.5), pHit=0.65, damagePerEnemy=1.0 → 8.5 × 0.65 = 5.525
  // per target. This is higher than log-only (1) but lower than selfInvisible (20).
  // We verify indirectly: build a lair creature with both an illusoryAttack
  // action and a log-only action; the selector should prefer illusoryAttack.
  const illusoryAction = makeAction('TestIllusory::0', 'bespoke', {
    rawText: 'makes one melee weapon attack (7 to hit)',
    lairIllusoryAttack: {
      attackBonus: 7,
      damage: { count: 1, sides: 8, bonus: 4, type: 'bludgeoning' },
    },
    targetsEnemies: true,
  });
  const logOnlyAction = makeAction('TestLogOnly::0', 'bespoke', {
    rawText: 'A log-only pattern.',
    lairPlaneShift: true,  // log-only
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

  // The selector should pick illusoryAttack (score ~5.5) over logOnly (score 1).
  const illusoryLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === kobold.id &&
    e.description.includes('illusory-attack'));
  assert('16a. illusoryAttack (score ~5.5) preferred over log-only (score 1)',
    illusoryLog !== undefined,
    `effect logs: ${rlog.events.filter((e:any)=>e.actorId===kobold.id && e.type==='action' && !e.description.includes('takes a lair action')).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
}

// ============================================================
// 17. Coverage: Phase 8 batch 2 recognizes 28+ bespoke actions
// ============================================================
console.log('\n--- 17. Coverage: Phase 8 batch 2 recognition sweep ---');
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
    // Inline-regex patterns (4) — broadened healing-suppression now catches Demilich::2
    || /no (?:creature|target).{0,40}can\s+regain\s+hit\s+points/i.test(a.rawText)
    || /uses\s+one\s+of\s+(?:their|his|her)\s+available\s+(?:melee|ranged)\s+attacks/i.test(a.rawText)
    || /recharges\s+one\s+of\s+(?:their|his|her)\s+expended\s+abilities/i.test(a.rawText)
    || /teleports?\s+(?:themself|himself|herself|itself)\s+to/i.test(a.rawText)
  );
  const recognizedCount = recognized.length;
  const unrecognizedCount = total - recognizedCount;

  console.log(`    Total bespoke actions: ${total}`);
  console.log(`    Recognized (batch 1 + batch 2 + inline): ${recognizedCount}`);
  console.log(`    Unrecognized: ${unrecognizedCount}`);

  // After Phase 8 batch 2, at least 28 bespoke actions should be recognized
  // (was 16 after batch 1; +12 from batch 2's 6 new flags covering 12 actions).
  assert('17a. recognized count ≥ 28',
    recognizedCount >= 28,
    `got ${recognizedCount}`);

  // List the unrecognized IDs (should be 3: Demogorgon::1, Githzerai Anarch::0/::2).
  if (unrecognizedCount > 0) {
    const unrecognizedIds = bespokeActions
      .filter(a => !recognized.includes(a))
      .map(a => a.id);
    console.log(`    Unrecognized IDs (for Phase 8 batch 3): ${unrecognizedIds.join(', ')}`);
    // Verify only the expected 3 remain.
    assert('17b. only 3 unrecognized actions remain (Demogorgon::1 + Githzerai Anarch::0/::2)',
      unrecognizedCount <= 3,
      `got ${unrecognizedCount}: ${unrecognizedIds.join(', ')}`);
  }
}

// ============================================================
// 18. Regression: Phase 8 batch 1 flags still recognized
// ============================================================
console.log('\n--- 18. Regression: Phase 8 batch 1 flags still recognized ---');
{
  const beholder = spawn('Beholder');
  assert('18a. Beholder::0 still has lairDifficultTerrain (batch 1)',
    beholder.lairActions!.actions[0].lairDifficultTerrain === true);
  assert('18b. Beholder::2 still has lairRandomEyeRay (batch 1)',
    beholder.lairActions!.actions[2].lairRandomEyeRay === true);

  const mummy = spawn('Mummy Lord');
  assert('18c. Mummy Lord::0 still has lairUndeadPinpointLiving (batch 1)',
    mummy.lairActions!.actions[0].lairUndeadPinpointLiving === true);
}

// ============================================================
// 19. Regression: full combat with batch 2 actions completes
// ============================================================
console.log('\n--- 19. Regression: full combat completes ---');
{
  const sphinx = spawn('Androsphinx');
  asParty(sphinx); tankUp(sphinx); noLegendary(sphinx);
  sphinx.isInLair = true;

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);

  const bf = makeBF([sphinx, goblin]);
  const rlog = runCombat(bf, [sphinx.id, goblin.id], { maxRounds: 3, verbose: false } as any);

  assert('19a. Sphinx combat completes without error',
    rlog.events.length > 0);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
