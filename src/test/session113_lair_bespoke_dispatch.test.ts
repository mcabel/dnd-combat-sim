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
//   8. S115: Demogorgon darkness dispatch (Category A explicit exception, suppress conc)
//   9. S115: Morkoth darkness dispatch (Category A normal, concentration applies)
//   10. S115: Arasta giant insect dispatch (4th signature type 'cast', suppress, no fixed duration)
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

const NEEDED_SOURCES = ['mm-2014', 'mtf', 'mpmm', 'aitfr-dn', 'pota', 'wdmm', 'cos', 'coa', 'mot'];
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

/**
 * Pin a creature's speed to 0 so it can't move on its turn.
 *
 * Used to prevent movement-based flakes in lair-action tests. Two failure
 * modes are prevented:
 *   (a) The goblin (Nimble Escape → Dash as bonus action) moves >60 ft away
 *       from the caster before the lair action fires, causing shouldCast to
 *       return null (no valid target in range).
 *   (b) The caster Dashes toward the goblin (becoming adjacent), then the
 *       goblin attacks with an IMPROVISED WEAPON (hardcoded AI fallback at
 *       src/ai/actions.ts:316 — fires even when goblin.actions = [] because
 *       improvised/unarmed is a universal PHB p.148 fallback). The goblin's
 *       attack deals damage, the caster fails the concentration save, and
 *       concentration breaks before the assertion checks it.
 *
 * Pinning BOTH the caster and the goblin prevents movement entirely — no
 * adjacency, no improvised attack, no concentration break. (S15 root-cause
 * of the S114 §7b flake: the S114 fix cleared goblin.actions but missed the
 * improvised-weapon fallback + the caster's Dash-closer movement.)
 */
function pin(c: Combatant): void { c.speed = 0; c.flySpeed = null; c.swimSpeed = null; c.burrowSpeed = null; }

// ============================================================
// 1. Metadata flag
// ============================================================
console.log('\n--- 1. Metadata flag ---');
assert('1a. lairActionBespokeDispatchV1Implemented === true',
  lairActionMetadata.lairActionBespokeDispatchV1Implemented === true);
assert('1b. LAIR_BESPOKE_SPELL_META has 14 entries (S113 pilot 3 + S114 batch 1 4 + batch 2 3 + batch 3 2 + S115 darkness 1 + giant insect 1)',
  LAIR_BESPOKE_SPELL_META.size === 14,
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

// ── S115: darkness metadata + per-creature override ──
assert('1m. darkness in meta (S115)',
  LAIR_BESPOKE_SPELL_META.has('darkness'));
eq('1n. darkness signature = self (shouldCast returns caster)',
  LAIR_BESPOKE_SPELL_META.get('darkness')!.signature, 'self');
eq('1o. darkness default concentrationMode = normal (Morkoth default)',
  LAIR_BESPOKE_SPELL_META.get('darkness')!.concentrationMode, 'normal');
assert('1p. darkness has creatureOverride with Demogorgon entry',
  LAIR_BESPOKE_SPELL_META.get('darkness')!.creatureOverride?.['Demogorgon'] !== undefined);
eq('1q. Demogorgon override concentrationMode = suppress',
  LAIR_BESPOKE_SPELL_META.get('darkness')!.creatureOverride?.['Demogorgon']?.concentrationMode, 'suppress');
eq('1r. Demogorgon override lairDurationRounds = 1',
  LAIR_BESPOKE_SPELL_META.get('darkness')!.creatureOverride?.['Demogorgon']?.lairDurationRounds, 1);
assert('1s. Morkoth has NO override (uses default normal)',
  LAIR_BESPOKE_SPELL_META.get('darkness')!.creatureOverride?.['Morkoth'] === undefined);

// ── S115: giant insect metadata + 4th signature type 'cast' ──
assert('1t. giant insect in meta (S115)',
  LAIR_BESPOKE_SPELL_META.has('giant insect'));
eq('1u. giant insect signature = cast (4th type: execute(caster, state), shouldCast → boolean)',
  LAIR_BESPOKE_SPELL_META.get('giant insect')!.signature, 'cast');
eq('1v. giant insect concentrationMode = suppress (Category A duration-replacement)',
  LAIR_BESPOKE_SPELL_META.get('giant insect')!.concentrationMode, 'suppress');
assert('1w. giant insect has NO lairDurationRounds (lasts until lair action used again or death)',
  LAIR_BESPOKE_SPELL_META.get('giant insect')!.lairDurationRounds === undefined);

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
// 5. Lightning Bolt dispatch (S114 batch 3: now dispatched)
//    S113: Lightning Bolt was NOT in the pilot → skipped with "no bespoke".
//    S114 batch 3: Lightning Bolt IS now in LAIR_BESPOKE_SPELL_META → dispatches.
// ============================================================
console.log('\n--- 5. Lightning Bolt dispatch (S114 batch 3) ---');
{
  const ga = spawn('Githzerai Anarch', { x: 0, y: 0, z: 0 }, 'MPMM');
  asParty(ga); tankUp(ga); noLegendary(ga);
  ga.isInLair = true;
  const lbAction = ga.lairActions!.actions.find(
    a => a.spellName === 'lightning bolt')!;
  forceAction(ga, lbAction);

  // Place goblin in a valid Lightning Bolt line position (straight line from caster)
  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin, 100_000);
  const goblinHPBefore = goblin.currentHP;

  const bf = makeBF([ga, goblin]);
  const rlog = runCombat(bf, [ga.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  // 5a. "casts Lightning Bolt" log fires (bespoke dispatch succeeded)
  const castLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === ga.id &&
    e.description.includes('casts Lightning Bolt'));
  assert('5a. "casts Lightning Bolt" log fires (S114 batch 3 dispatch)',
    castLog !== undefined,
    `events: ${rlog.events.filter((e:any)=>e.actorId===ga.id && e.type==='action').map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 5b. Lightning Bolt damage log fires (8d6 lightning, DEX save)
  const dmgLog = rlog.events.find((e: any) =>
    e.actorId === ga.id &&
    e.description.toLowerCase().includes('lightning damage'));
  assert('5b. lightning damage log fires',
    dmgLog !== undefined,
    `no damage log; events: ${rlog.events.filter((e:any)=>e.actorId===ga.id).map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 5c. Goblin took lightning damage (HP dropped)
  assert('5c. goblin took lightning damage',
    goblin.currentHP < goblinHPBefore,
    `HP before=${goblinHPBefore}, after=${goblin.currentHP}`);

  // 5d. The OLD "no bespoke lair-dispatch module" skip log does NOT fire
  const skipLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === ga.id &&
    e.description.includes('no bespoke lair-dispatch module'));
  assert('5d. old "no bespoke" skip log does NOT fire',
    skipLog === undefined,
    `skip log fired: ${skipLog?.description}`);

  // 5e. Githzerai Anarch did NOT start concentration (Lightning Bolt is not conc)
  assert('5e. GA has no concentration active (Lightning Bolt is not conc)',
    ga.concentration === null || ga.concentration?.active === false,
    `concentration: ${JSON.stringify(ga.concentration)}`);
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
  // Clear regular-turn actions so the Aboleth doesn't cast a concentration
  // spell on its regular turn (which would block the lair-action Phantasmal
  // Force from starting concentration). The lair action fires at initiative
  // count 20, AFTER the Aboleth's regular turn.
  aboleth.actions = [];
  // Pin Aboleth so it can't Dash toward the goblin (which would make them
  // adjacent → goblin improvised-weapon attack → concentration break flake).
  pin(aboleth);

  const goblin = spawn('Goblin', { x: 3, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);
  // Clear goblin actions so it can't attack the Aboleth and potentially break
  // concentration on a natural-1 save (which would flake the §7b assertion).
  goblin.actions = [];
  // Pin goblin speed so it can't Nimble-Escape-Dash out of Phantasmal Force's
  // 60-ft range before the lair action fires (movement-based flake prevention).
  pin(goblin);

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
// 8. S115: Demogorgon darkness dispatch (Category A explicit exception, suppress)
//    Raw text: "Demogorgon casts the darkness spell four times, targeting
//    different areas with the spell. Demogorgon doesn't need to concentrate
//    on the spells, which end on initiative count 20 of the next round."
//    → concentrationMode = 'suppress', lairDurationRounds = 1 (per-creature
//      override for sourceCreature='Demogorgon').
//    v1 simplification: casts once (self-centered obstacle), not four times.
// ============================================================
console.log('\n--- 8. Demogorgon darkness (S115: suppress per-creature override) ---');
{
  const demo = spawn('Demogorgon', { x: 0, y: 0, z: 0 }, 'MPMM');
  asParty(demo);
  forceLairAction(demo, 'Demogorgon::0');  // darkness L2
  tankUp(demo);
  noLegendary(demo);
  // shouldCastDarkness strategy (a): low HP + near enemy → cast. Set HP to 30%
  // so the defensive-retreat trigger fires. (Strategies (b)/(c) require allies,
  // which would complicate the test setup; (a) is the simplest reliable trigger.)
  demo.currentHP = Math.floor(demo.maxHP * 0.3);
  // Clear regular-turn actions so Demogorgon doesn't cast anything on his turn
  // (which could start concentration and block the lair-action darkness from
  // firing — shouldCastDarkness checks caster.concentration?.active).
  demo.actions = [];
  // Pin Demogorgon so it can't Dash toward the goblin (which would make them
  // adjacent → goblin improvised-weapon attack → could deal damage; while
  // Demogorgon's darkness is suppress-mode (no concentration to break), pinning
  // keeps the test deterministic and consistent with §7/§9).
  pin(demo);

  const goblin = spawn('Goblin', { x: 3, y: 0, z: 0 });  // 15 ft away, within 45 ft trigger
  asEnemy(goblin); tankUp(goblin);
  // Clear goblin actions so it can't attack Demogorgon (no concentration-break risk).
  goblin.actions = [];
  // Pin goblin speed so it can't Nimble-Escape-Dash out of Darkness's 45-ft
  // trigger range before the lair action fires (movement-based flake prevention).
  pin(goblin);

  const bf = makeBF([demo, goblin]);
  const rlog = runCombat(bf, [demo.id, goblin.id], {
    maxRounds: 1, verbose: false
  } as any);

  // 8a. "casts Darkness" log fires (bespoke dispatch succeeded)
  const castLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === demo.id &&
    e.description.includes('casts Darkness'));
  assert('8a. "casts Darkness" log fires (S115 Demogorgon dispatch)',
    castLog !== undefined,
    `events: ${rlog.events.filter((e:any)=>e.actorId===demo.id && e.type==='action').map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 8b. Darkness obstacle created (blocksVision, isMagicalDarkness)
  const obstacle = (bf as any).obstacles?.find((o: any) =>
    o.blocksVision === true && o.isMagicalDarkness === true);
  assert('8b. darkness obstacle created (blocksVision + isMagicalDarkness)',
    obstacle !== undefined,
    `obstacles: ${JSON.stringify((bf as any).obstacles?.map((o:any)=>({id:o.id,blocksVision:o.blocksVision,isMagicalDarkness:o.isMagicalDarkness})))}`);

  // 8c. Demogorgon did NOT start concentration (Category A explicit exception → suppress)
  assert('8c. Demogorgon did NOT start concentration (suppress mode)',
    demo.concentration === null || demo.concentration?.active === false,
    `concentration: ${JSON.stringify(demo.concentration)}`);

  // 8d. The Darkness effect has sourceIsConcentration = false (post-processed)
  const darkEffect = demo.activeEffects.find(e => e.spellName === 'Darkness');
  assert('8d. Darkness effect has sourceIsConcentration = false',
    darkEffect?.sourceIsConcentration === false,
    `effect: ${JSON.stringify(darkEffect ? {spellName: darkEffect.spellName, sourceIsConcentration: darkEffect.sourceIsConcentration} : null)}`);

  // 8e. The Darkness effect has sourceTurnExpires = 1 (1-round lair duration override)
  assert('8e. Darkness effect has sourceTurnExpires = 1 (1-round lair duration)',
    darkEffect?.sourceTurnExpires === 1,
    `sourceTurnExpires: ${darkEffect?.sourceTurnExpires}`);

  // 8f. suppressConcentration flag was cleaned up after execute
  assert('8f. suppressConcentration flag cleared after execute',
    demo.suppressConcentration !== true,
    `suppressConcentration: ${demo.suppressConcentration}`);

  // 8g. The OLD skip log does NOT fire
  const skipLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === demo.id &&
    e.description.includes('no bespoke lair-dispatch module'));
  assert('8g. old skip log does NOT fire',
    skipLog === undefined);
}

// ============================================================
// 9. S115: Morkoth darkness dispatch (Category A normal, concentration applies)
//    Raw text: "The morkoth casts darkness, dispel magic, or misty step,
//    using Intelligence as its spellcasting ability and without expending
//    a spell slot."
//    → concentrationMode = 'normal' (default; Morkoth has NO creatureOverride).
//    v1 simplification: parser tags spellName='darkness' (first of 3 options);
//    always dispatches darkness.
// ============================================================
console.log('\n--- 9. Morkoth darkness (S115: normal default, no override) ---');
{
  const mork = spawn('Morkoth', { x: 0, y: 0, z: 0 }, 'MPMM');
  asParty(mork);
  forceLairAction(mork, 'Morkoth::0');  // darkness L2 (parser-tagged first option)
  tankUp(mork);
  noLegendary(mork);
  // shouldCastDarkness strategy (a): low HP + near enemy. Morkoth has 165 HP;
  // set to 30% so the defensive-retreat trigger fires.
  mork.currentHP = Math.floor(mork.maxHP * 0.3);
  // Clear regular-turn actions so Morkoth doesn't cast anything on its turn.
  mork.actions = [];
  // Pin Morkoth so it can't Dash toward the goblin (which would make them
  // adjacent → goblin improvised-weapon attack → concentration break flake on
  // §9c which asserts Morkoth's concentration is active).
  pin(mork);

  const goblin = spawn('Goblin', { x: 3, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);
  goblin.actions = [];
  // Pin goblin speed so it can't Nimble-Escape-Dash out of Darkness's 45-ft
  // trigger range before the lair action fires (movement-based flake prevention).
  pin(goblin);

  const bf = makeBF([mork, goblin]);
  const rlog = runCombat(bf, [mork.id, goblin.id], {
    maxRounds: 1, verbose: false
  } as any);

  // 9a. "casts Darkness" log fires (bespoke dispatch succeeded)
  const castLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === mork.id &&
    e.description.includes('casts Darkness'));
  assert('9a. "casts Darkness" log fires (S115 Morkoth dispatch)',
    castLog !== undefined,
    `events: ${rlog.events.filter((e:any)=>e.actorId===mork.id && e.type==='action').map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 9b. Darkness obstacle created
  const obstacle = (bf as any).obstacles?.find((o: any) =>
    o.blocksVision === true && o.isMagicalDarkness === true);
  assert('9b. darkness obstacle created (blocksVision + isMagicalDarkness)',
    obstacle !== undefined,
    `obstacles: ${JSON.stringify((bf as any).obstacles?.map((o:any)=>({id:o.id,blocksVision:o.blocksVision})))}`);

  // 9c. Morkoth DID start concentration (Category A normal — Morkoth concentrates)
  assert('9c. Morkoth started concentration on Darkness (normal mode, no override)',
    mork.concentration?.active === true && mork.concentration?.spellName === 'Darkness',
    `concentration: ${JSON.stringify(mork.concentration)}`);

  // 9d. The Darkness effect has sourceIsConcentration = true (normal concentration)
  const darkEffect = mork.activeEffects.find(e => e.spellName === 'Darkness');
  assert('9d. Darkness effect has sourceIsConcentration = true (normal conc)',
    darkEffect?.sourceIsConcentration === true,
    `effect: ${JSON.stringify(darkEffect ? {spellName: darkEffect.spellName, sourceIsConcentration: darkEffect.sourceIsConcentration} : null)}`);

  // 9e. The Darkness effect has NO sourceTurnExpires (normal concentration — no lair-duration override)
  assert('9e. Darkness effect has NO sourceTurnExpires (normal conc, no lair duration)',
    darkEffect?.sourceTurnExpires === undefined,
    `sourceTurnExpires: ${darkEffect?.sourceTurnExpires}`);

  // 9f. suppressConcentration flag was NOT set (normal mode)
  assert('9f. suppressConcentration flag NOT set (normal mode)',
    mork.suppressConcentration !== true,
    `suppressConcentration: ${mork.suppressConcentration}`);

  // 9g. The OLD skip log does NOT fire
  const skipLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === mork.id &&
    e.description.includes('no bespoke lair-dispatch module'));
  assert('9g. old skip log does NOT fire',
    skipLog === undefined);
}

// ============================================================
// 10. S115: Arasta giant insect dispatch (4th signature type 'cast', suppress)
//     Raw text: "Arasta casts the giant insect spell (spiders only). It lasts
//     until she uses this lair action again or until she dies."
//     → concentrationMode = 'suppress' (Category A duration-replacement),
//       lairDurationRounds = undefined (no fixed duration — lasts until
//       lair action used again or death, like spike growth).
//     signature = 'cast' (4th type): execute(caster, state) with NO target
//     param, shouldCast returns boolean. The dispatcher converts the boolean
//     to `creature | null` so the existing skip-if-null logic works.
//     v1 simplification: the spell's execute() just sets a forward-compat
//     flag (_genericSpellActiveSpells); the actual summoning is NOT modelled.
// ============================================================
console.log('\n--- 10. Arasta giant insect (S115: 4th signature type cast, suppress) ---');
{
  const arasta = spawn('Arasta', { x: 0, y: 0, z: 0 }, 'MOT');
  asParty(arasta);
  forceLairAction(arasta, 'Arasta::1');  // giant insect L4 (spiders only)
  tankUp(arasta);
  noLegendary(arasta);
  // Clear regular-turn actions so Arasta doesn't cast anything on her turn.
  arasta.actions = [];
  // Pin Arasta so she can't Dash toward the goblin (movement-based flake prevention).
  pin(arasta);

  const goblin = spawn('Goblin', { x: 3, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);
  goblin.actions = [];
  pin(goblin);

  const bf = makeBF([arasta, goblin]);
  const rlog = runCombat(bf, [arasta.id, goblin.id], {
    maxRounds: 1, verbose: false
  } as any);

  // 10a. "casts Giant Insect" log fires (bespoke dispatch succeeded)
  const castLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === arasta.id &&
    e.description.includes('casts Giant Insect'));
  assert('10a. "casts Giant Insect" log fires (S115 Arasta dispatch)',
    castLog !== undefined,
    `events: ${rlog.events.filter((e:any)=>e.actorId===arasta.id && e.type==='action').map((e:any)=>e.description.substring(0,80)).join(' | ')}`);

  // 10b. Arasta's _genericSpellActiveSpells has 'Giant Insect' (forward-compat flag set)
  assert('10b. Arasta._genericSpellActiveSpells has "Giant Insect" (flag set)',
    arasta._genericSpellActiveSpells?.has('Giant Insect') === true,
    `_genericSpellActiveSpells: ${JSON.stringify([...(arasta._genericSpellActiveSpells ?? [])])}`);

  // 10c. Arasta did NOT start concentration (suppress mode + execute doesn't call startConcentration)
  assert('10c. Arasta did NOT start concentration (suppress mode)',
    arasta.concentration === null || arasta.concentration?.active === false,
    `concentration: ${JSON.stringify(arasta.concentration)}`);

  // 10d. suppressConcentration flag was cleaned up after execute
  assert('10d. suppressConcentration flag cleared after execute',
    arasta.suppressConcentration !== true,
    `suppressConcentration: ${arasta.suppressConcentration}`);

  // 10e. The OLD skip log does NOT fire
  const skipLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === arasta.id &&
    e.description.includes('no bespoke lair-dispatch module'));
  assert('10e. old skip log does NOT fire',
    skipLog === undefined);

  // 10f. No new ActiveEffects were created (giant insect v1 only sets a flag, no effects)
  // The dispatcher's post-processing loop runs but finds 0 new effects.
  const giantInsectEffects = arasta.activeEffects.filter(e => e.spellName === 'Giant Insect');
  assert('10f. no "Giant Insect" ActiveEffect created (v1 forward-compat flag only)',
    giantInsectEffects.length === 0,
    `effects: ${JSON.stringify(giantInsectEffects.map(e => ({spellName: e.spellName, effectType: e.effectType})))}`);
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
