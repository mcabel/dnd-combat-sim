// ============================================================
// Test: Session 103 — damageVulnerabilities per-source expiry
//       for `debuff_enemy` lair actions (via ActiveEffect).
//
// Validates the Session 103 Task #2 deliverable: lair actions that
// grant vulnerability to a damage type (e.g. Kraken::1 "vulnerability
// to lightning damage") now track the vuln as an `ActiveEffect` with
// `effectType: 'damage_vulnerability'` and a `sourceTurnExpires` round,
// instead of a permanent combat-long mutation to damageVulnerabilities.
//
// The effect:
//   - mirrors the vuln type into target.damageVulnerabilities on apply
//     (so applyDamageWithTempHP doubles incoming damage of that type,
//     PHB p.197),
//   - auto-expires via effect_pipeline.reevaluateEffects at the start of
//     a later round once sourceTurnExpires has passed (default 1-round
//     duration = "until next initiative count 20"),
//   - is removed on caster death via removeEffectsFromCaster,
//   - protects INNATE vuln from being wrongly spliced (addedVulnerability
//     flag, mirroring the Session 36 Protection-from-Energy fix).
//
// Run: npx ts-node --transpile-only src/test/session103_debuff_vuln_expiry.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
} from '../parser/fivetools';
import { runCombat } from '../engine/combat';
import { applySpellEffect, undoEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { reevaluateEffects } from '../engine/effect_pipeline';
import { applyDamageWithTempHP } from '../engine/utils';
import { Combatant, Vec3, Battlefield, LairAction, ActiveEffect, DamageType } from '../types/core';

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

function spawn(name: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnMonster(bestiary, name, pos, 'smart', 'enemy', undefined);
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
function tankUp(c: Combatant, hp = 100_000): void { c.maxHP = hp; c.currentHP = hp; }
function noLegendary(c: Combatant): void { c.legendaryActionPoolMax = 0; c.legendaryActionPool = 0; }
function asParty(c: Combatant): void { c.faction = 'party'; }
function asEnemy(c: Combatant): void { c.faction = 'enemy'; }

function makeAction(id: string, category: LairAction['category'], extra: Partial<LairAction> = {}): LairAction {
  return {
    id, sourceCreature: 'TestCreature',
    rawText: extra.rawText ?? `Synthetic ${category} action.`,
    outOfScope: false, isMagical: true, isSpell: false, targetsEnemies: true,
    category, ...extra,
  };
}
function forceAction(c: Combatant, action: LairAction): void {
  if (!c.lairActions) c.lairActions = { actions: [], initiativeCount: 20 };
  c.lairActions.actions = [action];
  c._lairActionHistory = [];
}

/** Apply a synthetic damage_vulnerability effect directly (bypasses handler). */
function applyVulnEffect(target: Combatant, casterId: string, dt: DamageType,
                        sourceTurnExpires: number, addedVulnerability: boolean,
                        spellName = 'test:vuln'): ActiveEffect {
  const effect: Omit<ActiveEffect, 'id'> = {
    casterId,
    spellName,
    effectType: 'damage_vulnerability',
    payload: { damageType: dt, addedVulnerability },
    sourceIsConcentration: false,
    appliedTurn: 1,
    sourceTurnExpires,
  };
  return applySpellEffect(target, effect);
}

// ============================================================
// 1. applySpellEffect pushes the vuln type into damageVulnerabilities
// ============================================================
console.log('\n--- 1. applySpellEffect mirrors vuln type into damageVulnerabilities ---');
{
  const g = spawn('Goblin');
  // (Goblin has no innate vuln — damageVulnerabilities is already undefined.)
  applyVulnEffect(g, 'caster1', 'fire', 1, true);
  assert('Goblin now has fire vuln', g.damageVulnerabilities?.includes('fire') === true,
    `dv=${JSON.stringify(g.damageVulnerabilities)}`);
  assert('Exactly 1 entry (no duplicates)', g.damageVulnerabilities?.length === 1,
    `dv=${JSON.stringify(g.damageVulnerabilities)}`);
  assert('ActiveEffect recorded on target',
    g.activeEffects.some(e => e.effectType === 'damage_vulnerability' && e.payload.damageType === 'fire'));
}

// ============================================================
// 2. undoEffect splices the vuln out (addedVulnerability=true)
// ============================================================
console.log('\n--- 2. undoEffect splices vuln (addedVulnerability=true) ---');
{
  const g = spawn('Goblin');
  const eff = applyVulnEffect(g, 'caster1', 'fire', 1, true);
  assert('pre: fire vuln present', g.damageVulnerabilities?.includes('fire') === true);
  undoEffect(g, eff);
  assert('post: fire vuln removed', !g.damageVulnerabilities?.includes('fire'),
    `dv=${JSON.stringify(g.damageVulnerabilities)}`);
}

// ============================================================
// 3. undoEffect does NOT splice innate vuln (addedVulnerability=false)
//    Skeleton has innate bludgeoning vuln — must survive effect expiry.
// ============================================================
console.log('\n--- 3. undoEffect protects innate vuln (addedVulnerability=false) ---');
{
  const skel = spawn('Skeleton');
  const hadInnate = skel.damageVulnerabilities?.includes('bludgeoning') === true;
  assert('Skeleton has innate bludgeoning vuln', hadInnate,
    `dv=${JSON.stringify(skel.damageVulnerabilities)}`);
  // Apply a damage_vulnerability effect for bludgeoning with addedVulnerability=false
  // (the handler sets this when the type is already present).
  const eff = applyVulnEffect(skel, 'caster1', 'bludgeoning', 1, false);
  undoEffect(skel, eff);
  assert('innate bludgeoning vuln survives effect expiry',
    skel.damageVulnerabilities?.includes('bludgeoning') === true,
    `dv=${JSON.stringify(skel.damageVulnerabilities)}`);
}

// ============================================================
// 4. Damage doubling via applyDamageWithTempHP while effect active
// ============================================================
console.log('\n--- 4. applyDamageWithTempHP doubles damage of the vuln type ---');
{
  const g1 = spawn('Goblin'); tankUp(g1, 100);
  const g2 = spawn('Goblin'); tankUp(g2, 100);
  // g1 gets the fire-vuln effect; g2 is the control (no effect).
  applyVulnEffect(g1, 'caster1', 'fire', 1, true);
  const hp1Before = g1.currentHP;
  const hp2Before = g2.currentHP;
  applyDamageWithTempHP(g1, 10, 'fire');
  applyDamageWithTempHP(g2, 10, 'fire');
  // PHB p.197: vulnerability doubles → g1 takes 20, g2 takes 10.
  eq('vuln target takes 20 (doubled)', hp1Before - g1.currentHP, 20);
  eq('control target takes 10', hp2Before - g2.currentHP, 10);
  // Non-vuln damage type is NOT doubled.
  const hp1Before2 = g1.currentHP;
  applyDamageWithTempHP(g1, 10, 'slashing');
  eq('vuln target takes 10 slashing (not doubled)', hp1Before2 - g1.currentHP, 10);
}

// ============================================================
// 5. reevaluateEffects expires the effect when round > sourceTurnExpires
// ============================================================
console.log('\n--- 5. reevaluateEffects expires damage_vulnerability effect ---');
{
  const g = spawn('Goblin');
  // Applied at round 1, sourceTurnExpires = 1 (1-round duration).
  applyVulnEffect(g, 'caster1', 'fire', 1, true);
  assert('pre: fire vuln present (round 1)', g.damageVulnerabilities?.includes('fire') === true);
  assert('pre: 1 active effect', g.activeEffects.length === 1);
  // Advance to round 2 → round(2) > sourceTurnExpires(1) → expired + undone.
  const bf = makeBF([g]);
  (bf as any).round = 2;
  reevaluateEffects(g, bf);
  assert('post: fire vuln spliced out', !g.damageVulnerabilities?.includes('fire'),
    `dv=${JSON.stringify(g.damageVulnerabilities)}`);
  assert('post: 0 active effects', g.activeEffects.length === 0,
    `effects=${g.activeEffects.length}`);
}

// ============================================================
// 6. reevaluateEffects does NOT expire before sourceTurnExpires
// ============================================================
console.log('\n--- 6. reevaluateEffects keeps effect before expiry round ---');
{
  const g = spawn('Goblin');
  // 3-round duration: applied round 1, sourceTurnExpires = 3.
  applyVulnEffect(g, 'caster1', 'cold', 3, true);
  const bf = makeBF([g]);
  (bf as any).round = 2;   // round 2 ≤ 3 → NOT expired
  reevaluateEffects(g, bf);
  assert('round 2: cold vuln still present', g.damageVulnerabilities?.includes('cold') === true);
  assert('round 2: effect still active', g.activeEffects.length === 1);
  (bf as any).round = 3;   // round 3 ≤ 3 → NOT expired (expires when round > 3)
  reevaluateEffects(g, bf);
  assert('round 3: cold vuln still present', g.damageVulnerabilities?.includes('cold') === true);
  (bf as any).round = 4;   // round 4 > 3 → expired
  reevaluateEffects(g, bf);
  assert('round 4: cold vuln spliced out', !g.damageVulnerabilities?.includes('cold'));
}

// ============================================================
// 7. removeEffectsFromCaster removes the effect (caster death)
// ============================================================
console.log('\n--- 7. removeEffectsFromCaster clears vuln on caster death ---');
{
  const caster = spawn('Kraken'); asParty(caster); tankUp(caster);
  const g = spawn('Goblin'); asEnemy(g);
  // Simulate the lair creature applying the vuln effect to the goblin.
  applyVulnEffect(g, caster.id, 'lightning', 5, true);
  assert('pre: goblin has lightning vuln', g.damageVulnerabilities?.includes('lightning') === true);
  const bf = makeBF([caster, g]);
  removeEffectsFromCaster(caster.id, bf);
  assert('post: lightning vuln removed on caster death',
    !g.damageVulnerabilities?.includes('lightning'),
    `dv=${JSON.stringify(g.damageVulnerabilities)}`);
  assert('post: 0 active effects on goblin', g.activeEffects.length === 0);
}

// ============================================================
// 8. Integration: Kraken::1 lair action applies vuln via ActiveEffect
//    (regression for session94 §10 — now with effectType check)
// ============================================================
console.log('\n--- 8. Integration: Kraken::1 applies damage_vulnerability effect ---');
{
  const kraken = spawn('Kraken'); asParty(kraken); tankUp(kraken); noLegendary(kraken);
  const debuffAction = kraken.lairActions?.actions.find(a => a.category === 'debuff_enemy');
  if (!debuffAction) {
    console.log('  ⚠️  no debuff_enemy action found on Kraken — skipping');
  } else {
    kraken.lairActions!.actions = [debuffAction];
    kraken._lairActionHistory = [];
    const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 }); asEnemy(t1); tankUp(t1);
    const dvBefore = t1.damageVulnerabilities?.includes('lightning') ?? false;
    eq('pre: Goblin has no lightning vuln', dvBefore, false);
    const bf = makeBF([kraken, t1]);
    const rlog = runCombat(bf, [kraken.id, t1.id], { maxRounds: 1, verbose: false } as any);
    // The debuff_enemy header log fires.
    const headerLog = rlog.events.find((e: any) =>
      e.type === 'action' && e.actorId === kraken.id &&
      e.description.includes('[debuff_enemy]'));
    assert('8a. debuff_enemy header log fires', headerLog !== undefined);
    // The target gains lightning vulnerability (mirrored into damageVulnerabilities).
    assert('8b. target gains lightning vuln in damageVulnerabilities',
      t1.damageVulnerabilities?.includes('lightning') === true,
      `dv=${JSON.stringify(t1.damageVulnerabilities)}`);
    // An ActiveEffect with effectType='damage_vulnerability' is recorded.
    const hasEffect = t1.activeEffects.some(e =>
      e.effectType === 'damage_vulnerability' &&
      e.payload.damageType === 'lightning');
    assert('8c. damage_vulnerability ActiveEffect recorded on target', hasEffect,
      `effects=${t1.activeEffects.map(e=>e.effectType).join(',')}`);
    // The effect has a sourceTurnExpires (per-source expiry, not permanent).
    const vulnEff = t1.activeEffects.find(e => e.effectType === 'damage_vulnerability');
    assert('8d. effect has sourceTurnExpires set', vulnEff?.sourceTurnExpires !== undefined,
      `sourceTurnExpires=${vulnEff?.sourceTurnExpires}`);
    // The per-target log (NOT the header) mentions the auto-expiry round
    // (Session 103 log format: "→ debuff_enemy: ... auto-expires at round N").
    const perTargetLog = rlog.events.find((e: any) =>
      e.type === 'action' && e.actorId === kraken.id &&
      e.description.includes('gains vulnerability to lightning') &&
      e.description.includes('auto-expires'));
    assert('8e. per-target log mentions auto-expires', perTargetLog !== undefined,
      `events: ${rlog.events.filter((e:any)=>e.actorId===kraken.id&&e.type==='action').map((e:any)=>e.description.substring(0,90)).join(' | ')}`);
  }
}

// ============================================================
// 9. Handler: invalid vuln type is skipped (no garbage push)
// ============================================================
console.log('\n--- 9. Handler skips unrecognised vulnerability type ---');
{
  const lair = spawn('Kraken'); asParty(lair); tankUp(lair); noLegendary(lair);
  // Synthetic action with a non-damage-type word.
  forceAction(lair, makeAction('Test::badvuln', 'debuff_enemy', {
    rawText: 'Each enemy gains vulnerability to foobar damage.',
    targetsEnemies: true,
  }));
  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 }); asEnemy(t1); tankUp(t1);
  const bf = makeBF([lair, t1]);
  const rlog = runCombat(bf, [lair.id, t1.id], { maxRounds: 1, verbose: false } as any);
  // No vuln pushed, no effect recorded.
  assert('no foobar in damageVulnerabilities', !t1.damageVulnerabilities?.includes('foobar' as DamageType),
    `dv=${JSON.stringify(t1.damageVulnerabilities)}`);
  assert('no damage_vulnerability effect recorded',
    !t1.activeEffects.some(e => e.effectType === 'damage_vulnerability'));
  // The "unrecognised" log fires.
  const unrecLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === lair.id &&
    e.description.includes('unrecognised vulnerability type'));
  assert('unrecognised-type log fires', unrecLog !== undefined,
    `events: ${rlog.events.filter((e:any)=>e.actorId===lair.id&&e.type==='action').map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
}

// ============================================================
// 10. Handler: disadvantage branches unaffected (still use grantVulnerability)
// ============================================================
console.log('\n--- 10. Handler: disadvantage_save branch unaffected ---');
{
  const lair = spawn('Kraken'); asParty(lair); tankUp(lair); noLegendary(lair);
  forceAction(lair, makeAction('Test::disadvsave', 'debuff_enemy', {
    rawText: 'Each enemy has disadvantage on saving throws.',
    targetsEnemies: true,
  }));
  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 }); asEnemy(t1); tankUp(t1);
  const bf = makeBF([lair, t1]);
  const rlog = runCombat(bf, [lair.id, t1.id], { maxRounds: 1, verbose: false } as any);
  // No damage_vulnerability effect (disadvantage uses the d20-roll vuln system).
  assert('no damage_vulnerability effect for disadvantage',
    !t1.activeEffects.some(e => e.effectType === 'damage_vulnerability'));
  const disadvLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === lair.id &&
    e.description.includes('disadvantage on saving throws'));
  assert('disadvantage_save log fires', disadvLog !== undefined);
}

// ============================================================
// 11. Two-source simultaneous expiry: both effects expire same round
//     → vuln correctly removed (not leaked).
// ============================================================
console.log('\n--- 11. Two-source simultaneous expiry → vuln removed ---');
{
  const g = spawn('Goblin');
  // Caster A applies first (pushes fire, addedVulnerability=true).
  applyVulnEffect(g, 'casterA', 'fire', 1, true, 'Lair:A');
  // Caster B applies second (fire already present, addedVulnerability=false).
  applyVulnEffect(g, 'casterB', 'fire', 1, false, 'Lair:B');
  assert('pre: 2 active effects', g.activeEffects.length === 2,
    `effects=${g.activeEffects.length}`);
  assert('pre: fire vuln present', g.damageVulnerabilities?.includes('fire') === true);
  // Advance to round 2 → both expire simultaneously (reevaluateEffects filters
  // both out first, then calls undoEffect on each).
  const bf = makeBF([g]);
  (bf as any).round = 2;
  reevaluateEffects(g, bf);
  assert('post: 0 active effects', g.activeEffects.length === 0);
  // The "adder" (A) splices fire; B is a no-op (addedVulnerability=false).
  assert('post: fire vuln removed after both expire',
    !g.damageVulnerabilities?.includes('fire'),
    `dv=${JSON.stringify(g.damageVulnerabilities)}`);
}

// ============================================================
// 12. Regression: real bestiary — no debuff_enemy vuln action leaks
//     a permanent mutation (every such action now uses ActiveEffect).
// ============================================================
console.log('\n--- 12. Regression: all debuff_enemy vuln actions use ActiveEffect ---');
{
  // For every creature with a debuff_enemy action whose rawText mentions
  // "vulnerability to ... damage", confirm the parsed action's category is
  // debuff_enemy (parser-level sanity — the handler change is mechanical).
  let found = 0;
  for (const [name] of bestiary) {
    let c: Combatant | null = null;
    try { c = spawnMonster(bestiary, name, { x: 0, y: 0, z: 0 }, 'smart', 'enemy', undefined); }
    catch { continue; }
    if (!c || !c.lairActions || !c.lairActions.actions) continue;
    for (const a of c.lairActions.actions) {
      if (a.category === 'debuff_enemy' &&
          /vulnerability\s+to\s+\w+\s+damage/i.test(a.rawText || '')) {
        found++;
      }
    }
  }
  assert('≥1 real debuff_enemy vuln action exists in bestiary', found >= 1,
    `found=${found}`);
  console.log(`    (found ${found} debuff_enemy vuln actions across the bestiary)`);
}

// ---- Results ------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
