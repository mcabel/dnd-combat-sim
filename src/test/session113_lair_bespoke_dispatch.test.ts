// ============================================================
// Test: Session 113 — Lair-Action Bespoke Dispatch (Pilot)
//
// RFC: docs/RFC-LAIR-ACTION-BESPOKE-DISPATCH.md
//
// Validates the S113 pilot: lair-action `cast_spell` now dispatches to
// bespoke spell modules (Fireball, Banishment, Fog Cloud) when the spell
// isn't in GENERIC_SPELLS but IS in LAIR_BESPOKE_SPELL_META.
//
// Test sections:
//   1. Metadata flag (lairActionBespokeDispatchV1Implemented === true)
//   2. Fireball dispatch (Zariel::1, Category A normal, AoE signature)
//   3. Banishment dispatch (Geryon::2, Category A normal + concentration, single-target)
//   4. Fog Cloud dispatch (Bronze Dragon::0, Category B hazard, self-cast, suppress conc)
//   5. Skip path — Lightning Bolt (not in pilot batch, updated log wording)
//   6. Antimagic field skip (Q2: no module, updated log wording)
//   7. Regression — Aboleth phantasmal force still uses generic-registry path
//
// Run: npx ts-node --transpile-only src/test/session113_lair_bespoke_dispatch.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
} from '../parser/fivetools';
import { runCombat } from '../engine/combat';
import { Combatant, Vec3, Battlefield, LairAction } from '../types/core';
import { lairActionMetadata, LAIR_BESPOKE_SPELL_META } from '../engine/lair_action_metadata';

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

// ---- Load bestiary ------------------------------------------

const NEEDED_SOURCES = ['mm-2014', 'mtf', 'mpmm', 'aitfr-dn', 'pota', 'wdmm', 'cos', 'coa'];
const dir = path.join(__dirname, '../../bestiaryData');
const allFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const files = allFiles.filter(f =>
  NEEDED_SOURCES.some(src => f === `bestiary-${src}.json`));
const loaded = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
const bestiary = mergeBestiaries(...loaded);

function spawn(name: string, pos: Vec3 = { x: 0, y: 0, z: 0 }, source?: string): Combatant {
  const c = spawnMonster(bestiary, name, pos, 'smart', 'enemy', undefined, source);
  if (!c) throw new Error(`Monster not found: ${name} (source=${source ?? 'any'})`);
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

// ============================================================
// 1. Metadata flag
// ============================================================
console.log('\n--- 1. Metadata flag ---');
assert('1a. lairActionBespokeDispatchV1Implemented === true',
  lairActionMetadata.lairActionBespokeDispatchV1Implemented === true);
assert('1b. LAIR_BESPOKE_SPELL_META has 10 entries (S113 pilot 3 + S114 batch 1 4 + batch 2 3)',
  LAIR_BESPOKE_SPELL_META.size === 10,
  `got ${LAIR_BESPOKE_SPELL_META.size}`);
assert('1c. fireball in meta',
  LAIR_BESPOKE_SPELL_META.has('fireball'));
assert('1d. banishment in meta',
  LAIR_BESPOKE_SPELL_META.has('banishment'));
assert('1e. fog cloud in meta',
  LAIR_BESPOKE_SPELL_META.has('fog cloud'));
eq('1f. fireball signature = aoe',
  LAIR_BESPOKE_SPELL_META.get('fireball')!.signature, 'aoe');
eq('1g. banishment signature = single',
  LAIR_BESPOKE_SPELL_META.get('banishment')!.signature, 'single');
eq('1h. fog cloud signature = self',
  LAIR_BESPOKE_SPELL_META.get('fog cloud')!.signature, 'self');
eq('1i. fireball concentrationMode = normal',
  LAIR_BESPOKE_SPELL_META.get('fireball')!.concentrationMode, 'normal');
eq('1j. banishment concentrationMode = normal',
  LAIR_BESPOKE_SPELL_META.get('banishment')!.concentrationMode, 'normal');
eq('1k. fog cloud concentrationMode = suppress',
  LAIR_BESPOKE_SPELL_META.get('fog cloud')!.concentrationMode, 'suppress');
eq('1l. fog cloud lairDurationRounds = 1',
  LAIR_BESPOKE_SPELL_META.get('fog cloud')!.lairDurationRounds, 1);

// ============================================================
// 2. Fireball dispatch (Zariel MPMM Zariel::0, Category A normal, AoE)
// ============================================================
console.log('\n--- 2. Fireball dispatch (Zariel MPMM Zariel::0) ---');
{
  // Zariel's lair actions differ by source: MPMM has Zariel::0=fireball,
  // MTF has Zariel::1=fireball. We use MPMM here.
  const zariel = spawn('Zariel', { x: 0, y: 0, z: 0 }, 'MPMM');
  asParty(zariel);
  forceLairAction(zariel, 'Zariel::0');  // fireball L3 (MPMM)
  tankUp(zariel);
  noLegendary(zariel);

  const goblin = spawn('Goblin', { x: 3, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);
  const goblinHPBefore = goblin.currentHP;

  const bf = makeBF([zariel, goblin]);
  const rlog = runCombat(bf, [zariel.id, goblin.id], {
    maxRounds: 1, verbose: false
  } as any);

  // 2a. "casts Fireball" log fires (bespoke dispatch succeeded)
  const castLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === zariel.id &&
    e.description.includes('casts Fireball'));
  assert('2a. "casts Fireball" log fires',
    castLog !== undefined,
    `events: ${rlog.events.filter((e:any)=>e.actorId===zariel.id && e.type==='action').map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 2b. Fireball damage log fires (8d6 fire, DEX save)
  const dmgLog = rlog.events.find((e: any) =>
    e.actorId === zariel.id &&
    e.description.toLowerCase().includes('fire damage'));
  assert('2b. fire damage log fires',
    dmgLog !== undefined,
    `no damage log; events: ${rlog.events.filter((e:any)=>e.actorId===zariel.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 2c. Goblin took fire damage (HP dropped)
  assert('2c. goblin took fire damage',
    goblin.currentHP < goblinHPBefore,
    `HP before=${goblinHPBefore}, after=${goblin.currentHP}`);

  // 2d. The OLD "not in GENERIC_SPELLS registry" skip log does NOT fire
  const skipLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === zariel.id &&
    e.description.includes('not in GENERIC_SPELLS registry'));
  assert('2d. old "not in GENERIC_SPELLS registry" skip log does NOT fire',
    skipLog === undefined,
    `skip log fired: ${skipLog?.description}`);

  // 2e. Zariel did NOT start concentration (Fireball is not concentration)
  assert('2e. Zariel has no concentration active (Fireball is not conc)',
    zariel.concentration === null || zariel.concentration?.active === false,
    `concentration: ${JSON.stringify(zariel.concentration)}`);
}

// ============================================================
// 3. Banishment dispatch (Geryon::2, Category A normal + concentration)
// ============================================================
console.log('\n--- 3. Banishment dispatch (Geryon::2) ---');
{
  const geryon = spawn('Geryon', { x: 0, y: 0, z: 0 });
  asParty(geryon);
  forceLairAction(geryon, 'Geryon::2');  // banishment L4
  tankUp(geryon);
  noLegendary(geryon);

  const goblin = spawn('Goblin', { x: 3, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const bf = makeBF([geryon, goblin]);
  const rlog = runCombat(bf, [geryon.id, goblin.id], {
    maxRounds: 1, verbose: false
  } as any);

  // 3a. "casts Banishment" log fires
  const castLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === geryon.id &&
    e.description.includes('casts Banishment'));
  assert('3a. "casts Banishment" log fires',
    castLog !== undefined,
    `events: ${rlog.events.filter((e:any)=>e.actorId===geryon.id && e.type==='action').map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 3b. CHA save log fires (Banishment is CHA save)
  const saveLog = rlog.events.find((e: any) =>
    e.actorId === geryon.id &&
    e.description.toLowerCase().includes('cha save'));
  assert('3b. CHA save log fires for Banishment',
    saveLog !== undefined,
    `no save log; events: ${rlog.events.filter((e:any)=>e.actorId===geryon.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 3c. Geryon started concentration (Banishment is concentration, Category A normal)
  assert('3c. Geryon started concentration on Banishment',
    geryon.concentration?.active === true && geryon.concentration?.spellName === 'Banishment',
    `concentration: ${JSON.stringify(geryon.concentration)}`);

  // 3d. The OLD skip log does NOT fire
  const skipLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === geryon.id &&
    e.description.includes('not in GENERIC_SPELLS registry'));
  assert('3d. old skip log does NOT fire',
    skipLog === undefined);
}

// ============================================================
// 4. Fog Cloud dispatch (Bronze Dragon::0, Category B hazard, suppress conc)
// ============================================================
console.log('\n--- 4. Fog Cloud dispatch (Bronze Dragon::0, hazard) ---');
{
  const dragon = spawn('Adult Bronze Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  forceLairAction(dragon, 'Bronze Dragon::0');  // fog cloud L1
  tankUp(dragon);
  noLegendary(dragon);
  // Fog Cloud shouldCast requires: low HP + near enemy, OR outnumbered +
  // allies, OR round 1 + ally + no better conc spell. We use low HP + near enemy.
  dragon.currentHP = Math.floor(dragon.maxHP * 0.3);  // 30% HP → low HP trigger

  const goblin = spawn('Goblin', { x: 2, y: 0, z: 0 });  // within 60 ft
  asEnemy(goblin); tankUp(goblin);

  const bf = makeBF([dragon, goblin]);
  const rlog = runCombat(bf, [dragon.id, goblin.id], {
    maxRounds: 1, verbose: false
  } as any);

  // 4a. "casts Fog Cloud" log fires (bespoke dispatch succeeded)
  const castLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === dragon.id &&
    e.description.includes('casts Fog Cloud'));
  assert('4a. "casts Fog Cloud" log fires',
    castLog !== undefined,
    `events: ${rlog.events.filter((e:any)=>e.actorId===dragon.id && e.type==='action').map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 4b. Fog Cloud obstacle created (blocksVision)
  const obstacle = (bf as any).obstacles?.find((o: any) =>
    o.blocksVision === true);
  assert('4b. fog cloud obstacle created (blocksVision=true)',
    obstacle !== undefined,
    `obstacles: ${JSON.stringify((bf as any).obstacles?.map((o:any)=>({id:o.id,blocksVision:o.blocksVision})))}`);

  // 4c. Dragon did NOT start concentration (Category B hazard → suppress)
  assert('4c. Dragon did NOT start concentration (hazard, suppress mode)',
    dragon.concentration === null || dragon.concentration?.active === false,
    `concentration: ${JSON.stringify(dragon.concentration)}`);

  // 4d. The Fog Cloud effect has sourceIsConcentration = false (post-processed)
  const fogEffect = dragon.activeEffects.find(e => e.spellName === 'Fog Cloud');
  assert('4d. Fog Cloud effect has sourceIsConcentration = false',
    fogEffect?.sourceIsConcentration === false,
    `effect: ${JSON.stringify(fogEffect ? {spellName: fogEffect.spellName, sourceIsConcentration: fogEffect.sourceIsConcentration} : null)}`);

  // 4e. The Fog Cloud effect has sourceTurnExpires set (1-round lair duration)
  assert('4e. Fog Cloud effect has sourceTurnExpires = 1 (1-round lair duration)',
    fogEffect?.sourceTurnExpires === 1,
    `sourceTurnExpires: ${fogEffect?.sourceTurnExpires}`);

  // 4f. suppressConcentration flag was cleaned up after execute
  assert('4f. suppressConcentration flag cleared after execute',
    dragon.suppressConcentration !== true,
    `suppressConcentration: ${dragon.suppressConcentration}`);

  // 4g. The OLD skip log does NOT fire
  const skipLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === dragon.id &&
    e.description.includes('not in GENERIC_SPELLS registry'));
  assert('4g. old skip log does NOT fire',
    skipLog === undefined);
}

// ============================================================
// 5. Skip path — Lightning Bolt (not in pilot batch)
// ============================================================
console.log('\n--- 5. Skip path: Lightning Bolt (not in pilot batch) ---');
{
  const ga = spawn('Githzerai Anarch', { x: 0, y: 0, z: 0 }, 'MPMM');
  asParty(ga); tankUp(ga); noLegendary(ga);
  ga.isInLair = true;
  const lbAction = ga.lairActions!.actions.find(
    a => a.spellName === 'lightning bolt')!;
  forceAction(ga, lbAction);

  const goblin = spawn('Goblin');
  asEnemy(goblin); tankUp(goblin, 100_000);

  const bf = makeBF([ga, goblin]);
  const rlog = runCombat(bf, [ga.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  // 5a. Skip log fires with S113-updated wording
  const skipLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === ga.id &&
    e.description.includes('no bespoke lair-dispatch module'));
  assert('5a. S113 skip log fires ("no bespoke lair-dispatch module")',
    skipLog !== undefined,
    `events: ${rlog.events.filter((e:any)=>e.actorId===ga.id && e.type==='action').map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 5b. Log mentions "lightning bolt"
  if (skipLog) {
    assert('5b. log mentions "lightning bolt"',
      skipLog.description.toLowerCase().includes('lightning bolt'));
    // 5c. OLD "Phase 5" wording is GONE
    assert('5c. old "Phase 5" wording is gone',
      !skipLog.description.includes('Phase 5'),
      `got: ${skipLog.description}`);
  }
}

// Helper for §5 (force a specific action object, not just by ID)
function forceAction(creature: Combatant, action: LairAction): void {
  if (!creature.lairActions) throw new Error(`${creature.name} has no lairActions`);
  creature.lairActions.actions = [action];
  creature._lairActionHistory = [];
}

// ============================================================
// 6. Antimagic field skip (Q2: no module, updated log)
// ============================================================
console.log('\n--- 6. Antimagic field skip (Q2: no module) ---');
{
  const demilich = spawn('Demilich', { x: 0, y: 0, z: 0 });
  asParty(demilich);
  forceLairAction(demilich, 'Demilich::1');  // antimagic field L8
  tankUp(demilich);
  noLegendary(demilich);

  const goblin = spawn('Goblin', { x: 3, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const bf = makeBF([demilich, goblin]);
  const rlog = runCombat(bf, [demilich.id, goblin.id], {
    maxRounds: 1, verbose: false
  } as any);

  // 6a. Skip log fires (antimagic field has no module)
  const skipLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === demilich.id &&
    e.description.includes('no bespoke lair-dispatch module'));
  assert('6a. skip log fires for antimagic field',
    skipLog !== undefined,
    `events: ${rlog.events.filter((e:any)=>e.actorId===demilich.id && e.type==='action').map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 6b. Log mentions "antimagic field"
  if (skipLog) {
    assert('6b. log mentions "antimagic field"',
      skipLog.description.toLowerCase().includes('antimagic field'));
    // 6c. OLD "Phase 5" wording is GONE
    assert('6c. old "Phase 5" wording is gone',
      !skipLog.description.includes('Phase 5'),
      `got: ${skipLog.description}`);
  }
}

// ============================================================
// 7. Regression — Aboleth phantasmal force (S114 batch 1: now DISPATCHED)
//    S113: phantasmal force was NOT in the pilot → skipped.
//    S114 batch 1: phantasmal force IS now in LAIR_BESPOKE_SPELL_META → executes.
// ============================================================
console.log('\n--- 7. Aboleth phantasmal force (S114 batch 1: now dispatched) ---');
{
  const aboleth = spawn('Aboleth', { x: 0, y: 0, z: 0 });
  asParty(aboleth);
  forceLairAction(aboleth, 'Aboleth::0');  // phantasmal force L2
  tankUp(aboleth);
  noLegendary(aboleth);

  const goblin = spawn('Goblin', { x: 3, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const bf = makeBF([aboleth, goblin]);
  const rlog = runCombat(bf, [aboleth.id, goblin.id], {
    maxRounds: 1, verbose: false
  } as any);

  // 7a. "casts Phantasmal Force" log fires (bespoke dispatch succeeded)
  const castLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === aboleth.id &&
    e.description.includes('casts Phantasmal Force'));
  assert('7a. "casts Phantasmal Force" log fires (S114 batch 1 dispatch)',
    castLog !== undefined,
    `events: ${rlog.events.filter((e:any)=>e.actorId===aboleth.id && e.type==='action').map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 7b. Aboleth started concentration (Phantasmal Force is concentration, Category A normal)
  assert('7b. Aboleth started concentration on Phantasmal Force',
    aboleth.concentration?.active === true && aboleth.concentration?.spellName === 'Phantasmal Force',
    `concentration: ${JSON.stringify(aboleth.concentration)}`);

  // 7c. The OLD skip log does NOT fire
  const skipLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === aboleth.id &&
    e.description.includes('no bespoke lair-dispatch module'));
  assert('7c. old skip log does NOT fire (phantasmal force now dispatched)',
    skipLog === undefined);
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
