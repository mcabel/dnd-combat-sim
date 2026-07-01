// ============================================================
// Test: Session 94 — RFC-LAIRACTIONS Phase 3b
//       Remaining effect handlers (cast_spell, summon, buff_ally,
//       debuff_enemy, visibility, movement, save_only, bespoke)
//
// Validates the Phase 3b engine-layer deliverable (RFC-LAIRACTIONS §8
// Phase 3, second batch):
//   1. `cast_spell` handler — looks up spell in GENERIC_SPELLS registry,
//      calls execute(). Spells NOT in the registry (Fireball, Banishment,
//      Antimagic Field, etc. — dedicated modules) are logged + skipped.
//   2. `summon` handler — spawns N copies of `action.summons.creature` via
//      `monsterToCombatant` using `bf.bestiaryMap`. Safety-checks the
//      flattening artifact (summons name matches source creature name).
//      Logs "bestiary not available" if `bf.bestiaryMap` is absent.
//   3. `buff_ally` handler — parses rawText for advantage keyword + scope,
//      applies `grantSelf(advantage, scope)` to matching allies.
//   4. `debuff_enemy` handler — parses rawText for vulnerability/disadvantage,
//      applies `damageVulnerabilities` push or `grantVulnerability(disadvantage)`.
//   5. `visibility` handler — applies `battlefield_obstacle` effect on the
//      lair creature (blocksVision=true) for `durationRounds`.
//   6. `movement` handler — parses rawText for "pushed/pulled N feet",
//      applies `pushAway` to enemies in range. "Reaction-move" pattern logged.
//   7. `save_only` handler — rolls save per target; on failure logs
//      "bespoke effect not yet implemented" with action.id.
//   8. `bespoke` handler — pattern-matches healing-suppression / free-attack /
//      recharge / teleport; default logs "not yet implemented".
//
// Run: npx ts-node --transpile-only src/test/session94_lair_phase3b.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
} from '../parser/fivetools';
import { runCombat } from '../engine/combat';
import { Combatant, Vec3, Battlefield, LairAction } from '../types/core';

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

// ---- Load bestiary (mm-2014 only — covers all test creatures) ------------

const NEEDED_SOURCES = ['mm-2014'];
const dir = path.join(__dirname, '../../bestiaryData');
const allFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const files = allFiles.filter(f =>
  NEEDED_SOURCES.some(src => f === `bestiary-${src}.json`));
const loaded = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
const bestiary = mergeBestiaries(...loaded);

function spawn(name: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnMonster(bestiary, name, pos);
  if (!c) throw new Error(`Monster not found: ${name}`);
  return c;
}

// ---- Combat state factories --------------------------------

interface MutableBF extends Battlefield { [k: string]: any; }

function makeBF(combatants: Combatant[], withBestiary = false): MutableBF {
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
  if (withBestiary) {
    bf.bestiaryMap = bestiary as unknown as Map<string, unknown>;
  }
  return bf;
}

/** Find all lair-action HEADER log entries. */
function lairHeaderLogs(log: any): any[] {
  return log.events.filter((e: any) =>
    e.type === 'action' && e.description.includes('takes a lair action'));
}

/** Force the lair creature to pick `actionId` this round. */
function forceLairAction(creature: Combatant, actionId: string): void {
  if (!creature.lairActions) throw new Error(`${creature.name} has no lairActions`);
  const found = creature.lairActions.actions.find(a => a.id === actionId);
  if (!found) {
    throw new Error(`Action ${actionId} not found on ${creature.name}; available: ${
      creature.lairActions.actions.map(a => a.id).join(', ')}`);
  }
  creature.lairActions.actions = [found];
  creature._lairActionHistory = [];
}

/** Tank up a creature so it survives. */
function tankUp(c: Combatant, hp = 100_000): void {
  c.maxHP = hp;
  c.currentHP = hp;
}

/** Disable legendary actions. */
function noLegendary(c: Combatant): void {
  c.legendaryActionPoolMax = 0;
  c.legendaryActionPool = 0;
}

function asParty(c: Combatant): void { c.faction = 'party'; }
function asEnemy(c: Combatant): void { c.faction = 'enemy'; }

// ============================================================
// 1. cast_spell — Aboleth::0 (phantasmal force, L2, in GENERIC_SPELLS registry)
//    Verify: header + "casts ... via lair action" log fires.
// ============================================================
console.log('\n--- 1. cast_spell: Aboleth phantasmal force (in registry) ---');
{
  const aboleth = spawn('Aboleth', { x: 0, y: 0, z: 0 });
  asParty(aboleth);
  forceLairAction(aboleth, 'Aboleth::0');   // cast_spell: phantasmal force
  tankUp(aboleth);
  noLegendary(aboleth);

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);

  const bf = makeBF([aboleth, t1]);
  const rlog = runCombat(bf, [aboleth.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  // Header fires with [cast_spell].
  const headers = lairHeaderLogs(rlog).filter((e: any) => e.actorId === aboleth.id);
  assert('1a. header fires', headers.length === 1, `got ${headers.length}`);
  if (headers.length === 1) {
    const h = headers[0].description;
    // The header format is `[cast_spell, spell: phantasmal force (lvl 2)]`
    // (spellTag is appended inside the brackets). Match the prefix.
    assert('1b. header mentions [cast_spell', h.includes('[cast_spell'));
    assert('1c. header mentions spell: phantasmal force',
      h.includes('phantasmal force'));
  }

  // Either the spell executed (cast log) or it threw (error log).
  const castLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === aboleth.id &&
    e.description.includes('casts'));
  assert('1d. "casts ... via lair action" log fires',
    castLog !== undefined,
    `no cast log; events: ${rlog.events.filter((e:any)=>e.actorId===aboleth.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // The spell name "phantasmal force" appears in some log.
  const spellNameSeen = rlog.events.some((e: any) =>
    e.actorId === aboleth.id &&
    e.description.toLowerCase().includes('phantasmal force'));
  assert('1e. spell name "phantasmal force" appears in logs',
    spellNameSeen, 'spell name not found');
}

// ============================================================
// 2. cast_spell — Aboleth::0 with spellName overridden to "Fireball"
//    S113 (RFC: docs/RFC-LAIR-ACTION-BESPOKE-DISPATCH.md): Fireball now
//    dispatches via the lair-bespoke path (it has a dedicated module but
//    isn't in GENERIC_SPELLS). The lair action ACTUALLY EXECUTES Fireball
//    instead of logging "not in GENERIC_SPELLS registry".
// ============================================================
console.log('\n--- 2. cast_spell: Aboleth "Fireball" (bespoke dispatch, S113) ---');
{
  // Zariel is not in mm-2014 — use a synthetic action on Aboleth instead.
  // We replace Aboleth::0's spellName with "Fireball" (which has a dedicated
  // module, NOT in GENERIC_SPELLS, but IS in LAIR_BESPOKE_SPELL_META post-S113).
  const aboleth = spawn('Aboleth', { x: 0, y: 0, z: 0 });
  asParty(aboleth);
  forceLairAction(aboleth, 'Aboleth::0');
  // Override the spellName to one not in the generic registry.
  aboleth.lairActions!.actions[0].spellName = 'Fireball';
  aboleth.lairActions!.actions[0].castLevel = 3;
  tankUp(aboleth);
  noLegendary(aboleth);

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);
  const goblinHPBefore = t1.currentHP;

  const bf = makeBF([aboleth, t1]);
  const rlog = runCombat(bf, [aboleth.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  // 2a. "casts Fireball" log fires (bespoke dispatch succeeded).
  const castLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === aboleth.id &&
    e.description.includes('casts Fireball'));
  assert('2a. "casts Fireball" log fires (bespoke dispatch)',
    castLog !== undefined,
    `no cast log; got: ${rlog.events.filter((e:any)=>e.actorId===aboleth.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 2b. Goblin took fire damage (8d6 DC save for half — HP must have dropped).
  assert('2b. goblin took fire damage from Fireball',
    t1.currentHP < goblinHPBefore,
    `HP before=${goblinHPBefore}, after=${t1.currentHP}`);

  // 2c. The OLD "not in GENERIC_SPELLS registry" log does NOT fire.
  const skipLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === aboleth.id &&
    e.description.includes('not in GENERIC_SPELLS registry'));
  assert('2c. old "not in GENERIC_SPELLS registry" log does NOT fire',
    skipLog === undefined,
    `skip log fired: ${skipLog?.description}`);

  // 2d. The OLD "Phase 5" wording does NOT appear in any log.
  const phase5Log = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === aboleth.id &&
    e.description.includes('Phase 5'));
  assert('2d. old "Phase 5" wording is gone from all logs',
    phase5Log === undefined,
    `Phase 5 log fired: ${phase5Log?.description}`);
}

// ============================================================
// 3. cast_spell — missing spellName (defensive)
//    Construct a synthetic action with isSpell=true but no spellName.
// ============================================================
console.log('\n--- 3. cast_spell: missing spellName (defensive) ---');
{
  const aboleth = spawn('Aboleth', { x: 0, y: 0, z: 0 });
  asParty(aboleth);
  forceLairAction(aboleth, 'Aboleth::0');
  // Wipe the spellName to test the defensive branch.
  aboleth.lairActions!.actions[0].spellName = undefined;
  tankUp(aboleth);
  noLegendary(aboleth);

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);

  const bf = makeBF([aboleth, t1]);
  const rlog = runCombat(bf, [aboleth.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  const missingLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === aboleth.id &&
    e.description.includes('missing spellName'));
  assert('3a. "missing spellName" log fires', missingLog !== undefined);
}

// ============================================================
// 4. summon — Lichen Lich::1 (shambling mound, needs bestiary)
//    Verify: with bf.bestiaryMap set, the summon spawns.
//    (Lichen Lich is in MTF not MM — use a synthetic summon action on a
//     mm-2014 creature that has summon lair actions. The Mummy Lord has no
//     summon actions. We use a synthetic action on the Lich.)
// ============================================================
console.log('\n--- 4. summon: synthetic summon action (with bestiary) ---');
{
  // Use the Lich's lair action slot but replace with a synthetic summon
  // action that summons a "Goblin" (which IS in mm-2014).
  const lich = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich);
  tankUp(lich);
  noLegendary(lich);

  // Replace the Lich's lair actions with a single synthetic summon.
  const syntheticSummon: LairAction = {
    id: 'Lich::test_summon',
    sourceCreature: 'Lich',
    rawText: 'The lich summons a goblin to fight for it.',
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    summons: { creature: 'Goblin', count: 2 },
    targetsEnemies: false,   // ally-affecting (the summon joins the lich's faction)
    category: 'summon',
  };
  lich.lairActions!.actions = [syntheticSummon];
  lich._lairActionHistory = [];

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);

  // Run WITH bestiary available.
  const bf = makeBF([lich, t1], /*withBestiary=*/true);
  const rlog = runCombat(bf, [lich.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  // Header fires with [summon].
  const headers = lairHeaderLogs(rlog).filter((e: any) => e.actorId === lich.id);
  assert('4a. header fires with [summon]',
    headers.length === 1 && headers[0].description.includes('[summon]'));

  // Two summon logs fire (one per goblin).
  const summonLogs = rlog.events.filter((e: any) =>
    e.type === 'action' && e.actorId === lich.id &&
    e.description.includes('→ summons'));
  assert('4b. two summon logs fire (count=2)',
    summonLogs.length === 2, `got ${summonLogs.length}`);

  // Two new combatants were added to the battlefield.
  const summons = [...bf.combatants.values()].filter((c: any) =>
    c.isSummon && c.summonerId === lich.id);
  assert('4c. two summons added to battlefield',
    summons.length === 2, `got ${summons.length}`);
  if (summons.length === 2) {
    assert('4d. summon name includes "(Lich lair)"',
      summons[0].name.includes('(Lich lair)'));
    assert('4e. summon has faction "party" (matches lair creature)',
      summons[0].faction === 'party');
    assert('4f. summon has isSummon=true',
      summons[0].isSummon === true);
  }
}

// ============================================================
// 5. summon — no bestiary available (logs "bestiary not available")
// ============================================================
console.log('\n--- 5. summon: no bestiary available ---');
{
  const lich = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich);
  tankUp(lich);
  noLegendary(lich);

  const syntheticSummon: LairAction = {
    id: 'Lich::test_summon',
    sourceCreature: 'Lich',
    rawText: 'The lich summons a goblin.',
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    summons: { creature: 'Goblin', count: 1 },
    targetsEnemies: false,
    category: 'summon',
  };
  lich.lairActions!.actions = [syntheticSummon];
  lich._lairActionHistory = [];

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);

  // Run WITHOUT bestiary available (default).
  const bf = makeBF([lich, t1]);
  const rlog = runCombat(bf, [lich.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  // The "bestiary not available" log fires.
  const noBestLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === lich.id &&
    e.description.includes('bestiary not available'));
  assert('5a. "bestiary not available" log fires',
    noBestLog !== undefined,
    `got: ${rlog.events.filter((e:any)=>e.actorId===lich.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // No new combatants were added.
  const summons = [...bf.combatants.values()].filter((c: any) =>
    c.isSummon && c.summonerId === lich.id);
  assert('5b. zero summons added (no bestiary)',
    summons.length === 0, `got ${summons.length}`);
}

// ============================================================
// 6. summon — flattening artifact (summons name contains source creature)
//    Synthetic: sourceCreature='Red Dragon', summons.creature='Adult Red Dragon'.
//    Verify: skip log fires, no spawn.
// ============================================================
console.log('\n--- 6. summon: flattening artifact (Adult Red Dragon) ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  tankUp(dragon);
  noLegendary(dragon);

  // Synthetic: sourceCreature is "Red Dragon", summons.creature is "Adult Red Dragon".
  // (Matches the real flattening artifact on Red Dragon::3 — Additional Lair Actions.)
  const syntheticArtifact: LairAction = {
    id: 'Red Dragon::test_artifact',
    sourceCreature: 'Red Dragon',
    rawText: 'At your discretion, a legendary (adult or ancient) red dragon...',
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    summons: { creature: 'Adult Red Dragon', count: 1 },
    targetsEnemies: false,
    category: 'summon',
  };
  dragon.lairActions!.actions = [syntheticArtifact];
  dragon._lairActionHistory = [];

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);

  const bf = makeBF([dragon, t1], /*withBestiary=*/true);
  const rlog = runCombat(bf, [dragon.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  // The "flattening artifact" skip log fires.
  const artifactLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === dragon.id &&
    e.description.includes('flattening artifact'));
  assert('6a. "flattening artifact" skip log fires',
    artifactLog !== undefined,
    `got: ${rlog.events.filter((e:any)=>e.actorId===dragon.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // No new Adult Red Dragon was spawned.
  const summons = [...bf.combatants.values()].filter((c: any) =>
    c.isSummon && c.summonerId === dragon.id);
  assert('6b. zero summons added (artifact skipped)',
    summons.length === 0, `got ${summons.length}`);
}

// ============================================================
// 7. summon — no summons info parsed (logs "no summons info")
// ============================================================
console.log('\n--- 7. summon: no summons info parsed ---');
{
  const lich = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich);
  tankUp(lich);
  noLegendary(lich);

  // Synthetic: category= summon but no summons field.
  const noSummonsAction: LairAction = {
    id: 'Lich::test_no_summons',
    sourceCreature: 'Lich',
    rawText: 'The lich calls forth spirits (no @creature tag in raw text).',
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    targetsEnemies: true,
    category: 'summon',
  };
  lich.lairActions!.actions = [noSummonsAction];
  lich._lairActionHistory = [];

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);

  const bf = makeBF([lich, t1], /*withBestiary=*/true);
  const rlog = runCombat(bf, [lich.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  const noInfoLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === lich.id &&
    e.description.includes('no summons info'));
  assert('7a. "no summons info" log fires', noInfoLog !== undefined);
}

// ============================================================
// 8. buff_ally — Yeenoghu::0 ("all gnolls and hyenas... advantage on melee
//    weapon attack rolls"). Yeenoghu is not in mm-2014 — use a synthetic
//    action on a mm-2014 creature that has buff_ally actions (Mummy Lord::1).
// ============================================================
console.log('\n--- 8. buff_ally: Mummy Lord undead advantage on saves ---');
{
  const mummy = spawn('Mummy Lord', { x: 0, y: 0, z: 0 });
  asParty(mummy);
  // Force the buff_ally action (Mummy Lord::1 — undead advantage on turn-undead saves).
  // Find it first.
  const buffAction = mummy.lairActions?.actions.find(a =>
    a.category === 'buff_ally');
  if (!buffAction) {
    console.log('  ⚠️  no buff_ally action found on Mummy Lord — skipping');
  } else {
    mummy.lairActions!.actions = [buffAction];
    mummy._lairActionHistory = [];
    tankUp(mummy);
    noLegendary(mummy);

    // Ally (undead — same faction as mummy).
    const ally = spawn('Zombie', { x: 5, y: 0, z: 0 });
    ally.faction = 'party';   // same faction as mummy
    tankUp(ally);

    // Enemy (so combat runs).
    const enemy = spawn('Goblin', { x: 10, y: 0, z: 0 });
    asEnemy(enemy); tankUp(enemy);

    const bf = makeBF([mummy, ally, enemy]);
    const rlog = runCombat(bf, [mummy.id, ally.id, enemy.id], {
      maxRounds: 1, verbose: false
    } as any);

    // Header fires with [buff_ally].
    const headers = lairHeaderLogs(rlog).filter((e: any) => e.actorId === mummy.id);
    assert('8a. header fires with [buff_ally]',
      headers.length === 1 && headers[0].description.includes('[buff_ally]'));

    // buff_ally log fires (either buffs allies or "no valid ally targets").
    const buffLog = rlog.events.find((e: any) =>
      e.type === 'action' && e.actorId === mummy.id &&
      e.description.includes('buff_ally'));
    assert('8b. buff_ally log fires', buffLog !== undefined,
      `got: ${rlog.events.filter((e:any)=>e.actorId===mummy.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
  }
}

// ============================================================
// 9. buff_ally — synthetic: advantage on attacks for allies
//    Construct a synthetic buff_ally action with clear rawText.
// ============================================================
console.log('\n--- 9. buff_ally: synthetic advantage on attacks ---');
{
  const lich = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich);
  tankUp(lich);
  noLegendary(lich);

  const syntheticBuff: LairAction = {
    id: 'Lich::test_buff',
    sourceCreature: 'Lich',
    rawText: 'Allies of the lich have advantage on attack rolls until the next round.',
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    targetsEnemies: false,   // ally-affecting
    category: 'buff_ally',
  };
  lich.lairActions!.actions = [syntheticBuff];
  lich._lairActionHistory = [];

  const ally = spawn('Zombie', { x: 5, y: 0, z: 0 });
  ally.faction = 'party';
  tankUp(ally);

  const enemy = spawn('Goblin', { x: 10, y: 0, z: 0 });
  asEnemy(enemy); tankUp(enemy);

  const bf = makeBF([lich, ally, enemy]);
  const rlog = runCombat(bf, [lich.id, ally.id, enemy.id], {
    maxRounds: 1, verbose: false
  } as any);

  // buff_ally grants advantage to the ally.
  const buffLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === lich.id &&
    e.description.includes('gains advantage on attack'));
  assert('9a. "gains advantage on attack" log fires',
    buffLog !== undefined,
    `got: ${rlog.events.filter((e:any)=>e.actorId===lich.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // The buff log mentions the ally's name (proves the buff was applied to the
  // correct target). Note: the ally's `advantages` array may be empty AFTER
  // combat because `tickAdvantages` removes 'until_next_turn' entries at the
  // start of the ally's turn (correct PHB behavior — the buff lasts from init
  // 20 until the ally's next turn). We verify via the log instead.
  if (buffLog) {
    assert('9b. buff log mentions the ally name',
      buffLog.description.includes(ally.name),
      `log: ${buffLog.description.substring(0, 100)}`);
  }
}

// ============================================================
// 10. debuff_enemy — Kraken::1 ("vulnerability to lightning damage")
//     Kraken is in mm-2014. Verify the vulnerability is applied.
// ============================================================
console.log('\n--- 10. debuff_enemy: Kraken lightning vulnerability ---');
{
  const kraken = spawn('Kraken', { x: 0, y: 0, z: 0 });
  asParty(kraken);
  // Force the debuff_enemy action (Kraken::1).
  const debuffAction = kraken.lairActions?.actions.find(a =>
    a.category === 'debuff_enemy');
  if (!debuffAction) {
    console.log('  ⚠️  no debuff_enemy action found on Kraken — skipping');
  } else {
    kraken.lairActions!.actions = [debuffAction];
    kraken._lairActionHistory = [];
    tankUp(kraken);
    noLegendary(kraken);

    const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
    asEnemy(t1); tankUp(t1);

    const bf = makeBF([kraken, t1]);
    const rlog = runCombat(bf, [kraken.id, t1.id], {
      maxRounds: 1, verbose: false
    } as any);

    // Header fires with [debuff_enemy].
    const headers = lairHeaderLogs(rlog).filter((e: any) => e.actorId === kraken.id);
    assert('10a. header fires with [debuff_enemy]',
      headers.length === 1 && headers[0].description.includes('[debuff_enemy]'));

    // debuff_enemy log fires.
    const debuffLog = rlog.events.find((e: any) =>
      e.type === 'action' && e.actorId === kraken.id &&
      e.description.includes('debuff_enemy'));
    assert('10b. debuff_enemy log fires',
      debuffLog !== undefined,
      `got: ${rlog.events.filter((e:any)=>e.actorId===kraken.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

    // The target gains lightning vulnerability.
    const hasVuln = t1.damageVulnerabilities?.includes('lightning');
    assert('10c. target gains lightning vulnerability',
      hasVuln === true,
      `damageVulnerabilities: ${JSON.stringify(t1.damageVulnerabilities)}`);
  }
}

// ============================================================
// 11. debuff_enemy — synthetic: disadvantage on saves
// ============================================================
console.log('\n--- 11. debuff_enemy: synthetic disadvantage on saves ---');
{
  const lich = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich);
  tankUp(lich);
  noLegendary(lich);

  const syntheticDebuff: LairAction = {
    id: 'Lich::test_debuff',
    sourceCreature: 'Lich',
    rawText: 'Enemies within 120 feet have disadvantage on saving throws until the next round.',
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    targetsEnemies: true,
    rangeFt: 120,
    category: 'debuff_enemy',
  };
  lich.lairActions!.actions = [syntheticDebuff];
  lich._lairActionHistory = [];

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);

  const bf = makeBF([lich, t1]);
  const rlog = runCombat(bf, [lich.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  // The debuff_enemy log fires mentioning the target + disadvantage on saves.
  // (The target's `vulnerabilities` array may be empty AFTER combat because
  // `tickAdvantages` removes 'until_next_turn' entries at the start of the
  // target's turn — correct PHB behavior. We verify via the log instead.)
  const debuffLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === lich.id &&
    e.description.includes('disadvantage on saving throws') &&
    e.description.includes(t1.name));
  assert('11a. debuff log mentions target + disadvantage on saves',
    debuffLog !== undefined,
    `got: ${rlog.events.filter((e:any)=>e.actorId===lich.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
}

// ============================================================
// 12. visibility — synthetic obscurement action
//     Apply a battlefield_obstacle for 1 round.
// ============================================================
console.log('\n--- 12. visibility: synthetic obscurement ---');
{
  const lich = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich);
  tankUp(lich);
  noLegendary(lich);

  const syntheticVis: LairAction = {
    id: 'Lich::test_vis',
    sourceCreature: 'Lich',
    rawText: 'A cloud of thick fog fills a 20-foot-radius sphere centered on the lich. The area is heavily obscured.',
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    radiusFt: 20,
    durationRounds: 1,
    targetsEnemies: false,
    category: 'visibility',
  };
  lich.lairActions!.actions = [syntheticVis];
  lich._lairActionHistory = [];

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);

  const bf = makeBF([lich, t1]);
  const rlog = runCombat(bf, [lich.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  // Header fires with [visibility].
  const headers = lairHeaderLogs(rlog).filter((e: any) => e.actorId === lich.id);
  assert('12a. header fires with [visibility]',
    headers.length === 1 && headers[0].description.includes('[visibility]'));

  // The visibility log fires.
  const visLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === lich.id &&
    e.description.includes('visibility:'));
  assert('12b. "visibility:" log fires',
    visLog !== undefined,
    `got: ${rlog.events.filter((e:any)=>e.actorId===lich.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // An obstacle was added to bf.obstacles.
  assert('12c. obstacle added to bf.obstacles',
    (bf.obstacles?.length ?? 0) >= 1,
    `obstacles: ${bf.obstacles?.length ?? 0}`);
  if (bf.obstacles && bf.obstacles.length > 0) {
    const obs = bf.obstacles[bf.obstacles.length - 1];
    assert('12d. obstacle blocks vision',
      obs.blocksVision === true);
    assert('12e. obstacle does NOT block movement',
      obs.blocksMovement === false);
  }
}

// ============================================================
// 13. movement — synthetic push action
//     Push enemies 20 ft away from the lair creature.
// ============================================================
console.log('\n--- 13. movement: synthetic push 20 ft ---');
{
  const lich = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich);
  tankUp(lich);
  noLegendary(lich);

  const syntheticMove: LairAction = {
    id: 'Lich::test_move',
    sourceCreature: 'Lich',
    rawText: 'A wave of force pushes each creature within 30 feet of the lich. Each creature is pushed up to 20 feet away from the lich.',
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    rangeFt: 30,
    targetsEnemies: true,
    category: 'movement',
  };
  lich.lairActions!.actions = [syntheticMove];
  lich._lairActionHistory = [];

  const t1 = spawn('Goblin', { x: 1, y: 0, z: 0 });   // 5 ft away
  asEnemy(t1); tankUp(t1);

  const bf = makeBF([lich, t1]);
  const startPos = { ...t1.pos };
  const rlog = runCombat(bf, [lich.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  // Header fires with [movement].
  const headers = lairHeaderLogs(rlog).filter((e: any) => e.actorId === lich.id);
  assert('13a. header fires with [movement]',
    headers.length === 1 && headers[0].description.includes('[movement]'));

  // The movement log fires.
  const moveLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === lich.id &&
    e.description.includes('movement:'));
  assert('13b. "movement:" log fires',
    moveLog !== undefined,
    `got: ${rlog.events.filter((e:any)=>e.actorId===lich.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // The target was pushed (position changed).
  const moved = t1.pos.x !== startPos.x || t1.pos.y !== startPos.y;
  assert('13c. target was pushed (position changed)',
    moved, `start=(${startPos.x},${startPos.y}) end=(${t1.pos.x},${t1.pos.y})`);
  if (moved) {
    // Pushed AWAY from the lich (x increased since lich is at 0,0 and target at 1,0).
    assert('13d. target pushed away from lair creature',
      t1.pos.x > startPos.x,
      `start.x=${startPos.x} end.x=${t1.pos.x}`);
  }
}

// ============================================================
// 14. movement — "grant reaction-move to allies" pattern (log only)
// ============================================================
console.log('\n--- 14. movement: grant reaction-move (log only) ---');
{
  const lich = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich);
  tankUp(lich);
  noLegendary(lich);

  const syntheticReact: LairAction = {
    id: 'Lich::test_react_move',
    sourceCreature: 'Lich',
    rawText: 'Each ally of the lich can use its reaction to move up to its speed.',
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    targetsEnemies: false,
    category: 'movement',
  };
  lich.lairActions!.actions = [syntheticReact];
  lich._lairActionHistory = [];

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);

  const bf = makeBF([lich, t1]);
  const rlog = runCombat(bf, [lich.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  // The "grant reaction-move" log fires.
  const reactLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === lich.id &&
    e.description.includes('grant reaction-move'));
  assert('14a. "grant reaction-move" log fires',
    reactLog !== undefined,
    `got: ${rlog.events.filter((e:any)=>e.actorId===lich.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
}

// ============================================================
// 15. save_only — Kraken::0 (DC 23 STR or pushed 60 ft)
//     Verify: save events fire; on failure, "not yet implemented" log fires.
// ============================================================
console.log('\n--- 15. save_only: Kraken DC 23 STR ---');
{
  const kraken = spawn('Kraken', { x: 0, y: 0, z: 0 });
  asParty(kraken);
  // Force the save_only action (Kraken::0 — DC 23 STR or pushed).
  const saveOnlyAction = kraken.lairActions?.actions.find(a =>
    a.category === 'save_only');
  if (!saveOnlyAction) {
    console.log('  ⚠️  no save_only action found on Kraken — skipping');
  } else {
    kraken.lairActions!.actions = [saveOnlyAction];
    kraken._lairActionHistory = [];
    tankUp(kraken);
    noLegendary(kraken);

    const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
    asEnemy(t1);
    t1.str = 1;
    t1.saveProficiencies = { str: -100 };   // guarantees fail
    tankUp(t1);

    const bf = makeBF([kraken, t1]);
    const rlog = runCombat(bf, [kraken.id, t1.id], {
      maxRounds: 1, verbose: false
    } as any);

    // Header fires with [save_only].
    const headers = lairHeaderLogs(rlog).filter((e: any) => e.actorId === kraken.id);
    assert('15a. header fires with [save_only]',
      headers.length === 1 && headers[0].description.includes('[save_only]'));

    // Save fail event fires (low-STR target).
    const saveEvt = rlog.events.find((e: any) =>
      e.type === 'save_fail' && e.actorId === kraken.id);
    assert('15b. save_fail event fires', saveEvt !== undefined);
    if (saveEvt) {
      assert('15c. save event mentions STR', saveEvt.description.includes('STR'));
      assert('15d. save event mentions DC 23', saveEvt.description.includes('DC 23'));
    }

    // Phase 6 (Session 97): the Kraken's push save_only action is now
    // IMPLEMENTED (pushFt=60, successPushFt=10). The "not yet implemented"
    // log no longer fires — instead, a "pushed" move log fires on fail.
    // (Previously §15e asserted the "not yet implemented" log; now we assert
    // the push move log fires, confirming the Phase 6 handler is wired.)
    const pushLog = rlog.events.find((e: any) =>
      (e.type === 'move' || e.type === 'action') && e.actorId === kraken.id &&
      e.description.includes('pushed'));
    assert('15e. push move log fires (Phase 6: Kraken push now implemented)',
      pushLog !== undefined,
      `no push log; events: ${rlog.events.filter((e:any)=>e.actorId===kraken.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
  }
}

// ============================================================
// 16. save_only — successful save (no "not yet implemented" log)
// ============================================================
console.log('\n--- 16. save_only: successful save → no bespoke log ---');
{
  const kraken = spawn('Kraken', { x: 0, y: 0, z: 0 });
  asParty(kraken);
  const saveOnlyAction = kraken.lairActions?.actions.find(a =>
    a.category === 'save_only');
  if (!saveOnlyAction) {
    console.log('  ⚠️  no save_only action found on Kraken — skipping');
  } else {
    kraken.lairActions!.actions = [saveOnlyAction];
    kraken._lairActionHistory = [];
    tankUp(kraken);
    noLegendary(kraken);

    const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
    asEnemy(t1);
    t1.str = 30;
    t1.saveProficiencies = { str: 30 };   // always succeeds DC 23
    tankUp(t1);

    const bf = makeBF([kraken, t1]);
    const rlog = runCombat(bf, [kraken.id, t1.id], {
      maxRounds: 1, verbose: false
    } as any);

    // Save success event fires.
    const saveEvt = rlog.events.find((e: any) =>
      e.type === 'save_success' && e.actorId === kraken.id);
    assert('16a. save_success event fires', saveEvt !== undefined);

    // NO "not yet implemented" log fires (save succeeded).
    const notImplLog = rlog.events.find((e: any) =>
      e.type === 'action' && e.actorId === kraken.id &&
      e.description.includes('not yet implemented') &&
      e.description.includes('save_only'));
    assert('16b. NO "not yet implemented" log on successful save',
      notImplLog === undefined,
      `unexpected: ${notImplLog?.description.substring(0, 80)}`);
  }
}

// ============================================================
// 17. bespoke — Fazrian-style healing-suppression pattern
//     Fazrian is in VRGR not mm-2014 — use a synthetic action on a mm-2014
//     creature. The pattern is "no creature... can regain hit points".
// ============================================================
console.log('\n--- 17. bespoke: healing-suppression pattern ---');
{
  const lich = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich);
  tankUp(lich);
  noLegendary(lich);

  const syntheticHealSuppress: LairAction = {
    id: 'Lich::test_heal_suppress',
    sourceCreature: 'Lich',
    rawText: 'Blood flows from the lich\'s eyes. No creature within 120 feet of the lich can regain hit points until initiative count 20 on the next round.',
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    rangeFt: 120,
    targetsEnemies: true,
    category: 'bespoke',
  };
  lich.lairActions!.actions = [syntheticHealSuppress];
  lich._lairActionHistory = [];

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);

  const bf = makeBF([lich, t1]);
  const rlog = runCombat(bf, [lich.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  // Header fires with [bespoke].
  const headers = lairHeaderLogs(rlog).filter((e: any) => e.actorId === lich.id);
  assert('17a. header fires with [bespoke]',
    headers.length === 1 && headers[0].description.includes('[bespoke]'));

  // The "healing-suppression field" log fires.
  const healSuppressLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === lich.id &&
    e.description.includes('healing-suppression field'));
  assert('17b. "healing-suppression field" log fires',
    healSuppressLog !== undefined,
    `got: ${rlog.events.filter((e:any)=>e.actorId===lich.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
}

// ============================================================
// 18. bespoke — Archdevil-style "free attack" pattern (log only)
// ============================================================
console.log('\n--- 18. bespoke: free attack pattern (log only) ---');
{
  const lich = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich);
  tankUp(lich);
  noLegendary(lich);

  const syntheticFreeAttack: LairAction = {
    id: 'Lich::test_free_attack',
    sourceCreature: 'Lich',
    rawText: 'The lich uses one of their available melee attacks against a single foe.',
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    targetsEnemies: true,
    category: 'bespoke',
  };
  lich.lairActions!.actions = [syntheticFreeAttack];
  lich._lairActionHistory = [];

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);

  const bf = makeBF([lich, t1]);
  const rlog = runCombat(bf, [lich.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  // The "free attack" pattern log fires.
  const freeAttackLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === lich.id &&
    e.description.includes('"free attack" pattern'));
  assert('18a. "free attack" pattern log fires',
    freeAttackLog !== undefined,
    `got: ${rlog.events.filter((e:any)=>e.actorId===lich.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
}

// ============================================================
// 19. bespoke — default fallback (logs "not yet implemented")
// ============================================================
console.log('\n--- 19. bespoke: default fallback ---');
{
  const lich = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich);
  tankUp(lich);
  noLegendary(lich);

  const syntheticDefault: LairAction = {
    id: 'Lich::test_default_bespoke',
    sourceCreature: 'Lich',
    rawText: 'The lich does something totally unique that no pattern matches.',
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    targetsEnemies: true,
    category: 'bespoke',
  };
  lich.lairActions!.actions = [syntheticDefault];
  lich._lairActionHistory = [];

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);

  const bf = makeBF([lich, t1]);
  const rlog = runCombat(bf, [lich.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  // The default "not yet implemented" log fires with the action ID.
  const defaultLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === lich.id &&
    e.description.includes('Lich::test_default_bespoke') &&
    e.description.includes('not yet implemented'));
  assert('19a. default "not yet implemented" log fires with action ID',
    defaultLog !== undefined,
    `got: ${rlog.events.filter((e:any)=>e.actorId===lich.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);
}

// ============================================================
// 20. Regression: header log format includes [category] tag
//     For all Phase 3b categories, the header should include the category
//     in square brackets.
// ============================================================
console.log('\n--- 20. Regression: header log format includes [category] ---');
{
  const lich = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich);
  tankUp(lich);
  noLegendary(lich);

  const synthetic: LairAction = {
    id: 'Lich::test_header',
    sourceCreature: 'Lich',
    rawText: 'The lich takes a unique lair action.',
    outOfScope: false,
    isMagical: true,
    isSpell: false,
    targetsEnemies: true,
    category: 'bespoke',
  };
  lich.lairActions!.actions = [synthetic];
  lich._lairActionHistory = [];

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);

  const bf = makeBF([lich, t1]);
  const rlog = runCombat(bf, [lich.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  const headers = lairHeaderLogs(rlog).filter((e: any) => e.actorId === lich.id);
  assert('20a. header fires', headers.length === 1);
  if (headers.length === 1) {
    const h = headers[0].description;
    assert('20b. header includes [bespoke]', h.includes('[bespoke]'));
    assert('20c. header includes "initiative count 20"',
      h.includes('initiative count 20'));
    assert('20d. header does NOT mention "Phase 2 stub"',
      !h.includes('Phase 2 stub'));
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
