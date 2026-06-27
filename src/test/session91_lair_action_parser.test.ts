// ============================================================
// Test: Session 91 — RFC-LAIRACTIONS Phase 1
//       Structured LairAction schema + parser extraction +
//       per-action isMagical/isSpell tagging ([DD-4])
//
// Validates the Phase 1 data-layer deliverable (RFC-LAIRACTIONS §8 Phase 1):
//   1. The `LairAction` structured type replaces `string[]` on Combatant.
//   2. `parseLairActions()` extracts structured fields from 5eTools inline
//      tags (`@dc`, `@damage`, `@condition`, `@spell`, `@creature`, …).
//   3. Per-action `isMagical` / `isSpell` / `spellName` / `castLevel` tagging
//      per [DD-4] (no blanket rule — each action read individually):
//        - `isSpell: true` ONLY when the action casts a named spell.
//          Remedy-references (e.g., Sphinx "A greater restoration spell can
//          restore…") are correctly EXCLUDED (isSpell=false).
//        - `isMagical: true` by default for all actions (MM: "magical effects").
//   4. Out-of-scope / deferred registry tagging with stable IDs
//      (`lair_oos_NNN` / `lair_def_NNN`) — Black Dragon magical-darkness,
//      Sphinx meta-initiative + meta-time.
//   5. Category assignment (`save_damage`, `cast_spell`, `deferred`, …).
//   6. Stable `id` = `${sourceCreature}::${index}`.
//   7. The `extractLairAction` pure function (exported) on synthetic strings
//      for summon fallback + Baphomet cast_spell / gravity-deferred.
//   8. Full-corpus sanity (324 actions; isSpell / out-of-scope / deferred
//      counts within expected ranges).
//
// The engine stub (combat.ts round-start hook) is NOT changed mechanically —
// it still fires and logs `rawText`. The existing creature_lair_actions.test.ts
// covers the stub; this test covers the parser/data layer only.
//
// Run: npx ts-node --transpile-only src/test/session91_lair_action_parser.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
  extractLairAction,
} from '../parser/fivetools';
import { Combatant, Vec3, LairAction } from '../types/core';

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

// ---- Load bestiary (mm-2014 only — fast, covers all 10 test creatures) ----

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

function lair(name: string): LairAction[] {
  const c = spawn(name);
  if (!c.lairActions) throw new Error(`${name} has no lairActions`);
  return c.lairActions.actions;
}

// ============================================================
// 1. Adult Red Dragon — save_damage + save_condition extraction
// ============================================================
console.log('\n--- 1. Adult Red Dragon (save_damage + save_condition) ---');
{
  const actions = lair('Adult Red Dragon');
  eq('1a. Red Dragon has 4 actions', actions.length, 4);
  eq('1b. id format', actions[0].id, 'Red Dragon::0');
  eq('1c. sourceCreature', actions[0].sourceCreature, 'Red Dragon');

  // [0] Magma: DC 15 DEX, 6d6 fire, range 120, radius 5
  const magma = actions[0];
  eq('1d. magma category', magma.category, 'save_damage');
  eq('1e. magma saveDC', magma.saveDC, 15);
  eq('1f. magma saveAbility', magma.saveAbility, 'dex');
  assert('1g. magma damage 6d6 fire', magma.damage?.count === 6 && magma.damage?.sides === 6 && magma.damage?.type === 'fire',
    `got ${JSON.stringify(magma.damage)}`);
  eq('1h. magma rangeFt', magma.rangeFt, 120);
  eq('1i. magma radiusFt', magma.radiusFt, 5);
  eq('1j. magma isMagical', magma.isMagical, true);
  eq('1k. magma isSpell', magma.isSpell, false);
  eq('1l. magma targetsEnemies', magma.targetsEnemies, true);

  // [1] Tremor: DC 15 DEX, prone, radius 60
  const tremor = actions[1];
  eq('1m. tremor category', tremor.category, 'save_condition');
  eq('1n. tremor saveDC', tremor.saveDC, 15);
  eq('1o. tremor saveAbility', tremor.saveAbility, 'dex');
  assert('1p. tremor conditions [prone]', tremor.conditions?.length === 1 && tremor.conditions[0] === 'prone',
    `got ${JSON.stringify(tremor.conditions)}`);
  eq('1q. tremor radiusFt', tremor.radiusFt, 60);

  // [2] Volcanic gases: DC 13 CON, poisoned + incapacitated, radius 20, dur 1
  const gas = actions[2];
  eq('1r. gas category', gas.category, 'save_condition');
  eq('1s. gas saveDC', gas.saveDC, 13);
  eq('1t. gas saveAbility', gas.saveAbility, 'con');
  assert('1u. gas conditions [poisoned, incapacitated]',
    gas.conditions?.length === 2 && gas.conditions[0] === 'poisoned' && gas.conditions[1] === 'incapacitated',
    `got ${JSON.stringify(gas.conditions)}`);
  eq('1v. gas radiusFt', gas.radiusFt, 20);
  eq('1w. gas durationRounds', gas.durationRounds, 1);

  // [3] is the "Additional Lair Actions" intro-text artifact (pre-existing
  // parser behavior preserved for backward compat). It carries an @creature
  // self-reference → category 'summon'. Not a real summon; documented as a
  // known data artifact (RFC Phase 2 may refine the flattening).
  eq('1x. [3] not out-of-scope/deferred', actions[3].outOfScope, false);
  eq('1y. [3] not deferred', actions[3].deferred, undefined);
}

// ============================================================
// 2. Aboleth — cast_spell (isSpell=true) + save_condition + save_damage
// ============================================================
console.log('\n--- 2. Aboleth (cast_spell: phantasmal force) ---');
{
  const actions = lair('Aboleth');
  eq('2a. Aboleth has 3 actions', actions.length, 3);

  // [0] casts phantasmal force — isSpell=true, level 2
  const pf = actions[0];
  eq('2b. pf category', pf.category, 'cast_spell');
  eq('2c. pf isSpell', pf.isSpell, true);
  eq('2d. pf isMagical', pf.isMagical, true);
  eq('2e. pf spellName', pf.spellName, 'phantasmal force');
  eq('2f. pf castLevel', pf.castLevel, 2);
  eq('2g. pf rangeFt', pf.rangeFt, 60);

  // [1] Pools: DC 14 STR, prone
  const pools = actions[1];
  eq('2h. pools category', pools.category, 'save_condition');
  eq('2i. pools saveDC', pools.saveDC, 14);
  eq('2j. pools saveAbility', pools.saveAbility, 'str');
  assert('2k. pools conditions [prone]', pools.conditions?.[0] === 'prone');

  // [2] Conduit rage: DC 14 WIS, 2d6 psychic
  const rage = actions[2];
  eq('2l. rage category', rage.category, 'save_damage');
  eq('2m. rage saveDC', rage.saveDC, 14);
  eq('2n. rage saveAbility', rage.saveAbility, 'wis');
  assert('2o. rage damage 2d6 psychic', rage.damage?.count === 2 && rage.damage?.sides === 6 && rage.damage?.type === 'psychic',
    `got ${JSON.stringify(rage.damage)}`);
}

// ============================================================
// 3. Lich — spell_slot_regen + save_only + save_damage
// ============================================================
console.log('\n--- 3. Lich (spell_slot_regen + saves) ---');
{
  const actions = lair('Lich');
  eq('3a. Lich has 3 actions', actions.length, 3);

  // [0] spell slot regen
  eq('3b. [0] category spell_slot_regen', actions[0].category, 'spell_slot_regen');
  eq('3c. [0] not a spell', actions[0].isSpell, false);
  eq('3d. [0] isMagical', actions[0].isMagical, true);

  // [1] negative energy tether: DC 18 CON, dur 1
  eq('3e. [1] category save_only', actions[1].category, 'save_only');
  eq('3f. [1] saveDC', actions[1].saveDC, 18);
  eq('3g. [1] saveAbility', actions[1].saveAbility, 'con');
  eq('3h. [1] durationRounds', actions[1].durationRounds, 1);

  // [2] spirits: DC 18 CON, necrotic damage
  eq('3i. [2] category save_damage', actions[2].category, 'save_damage');
  eq('3j. [2] saveDC', actions[2].saveDC, 18);
  eq('3k. [2] saveAbility', actions[2].saveAbility, 'con');
  assert('3l. [2] damage necrotic', actions[2].damage?.type === 'necrotic',
    `got ${JSON.stringify(actions[2].damage)}`);
  assert('3m. [2] damage dice present', (actions[2].damage?.count ?? 0) > 0 && (actions[2].damage?.sides ?? 0) > 0);
}

// ============================================================
// 4. Kraken — save_only + debuff_enemy (vulnerability) + save_damage
// ============================================================
console.log('\n--- 4. Kraken (save_only + debuff + save_damage) ---');
{
  const actions = lair('Kraken');
  eq('4a. Kraken has 3 actions', actions.length, 3);

  // [0] current: DC 23 STR or pushed (save_only — movement folded in)
  eq('4b. [0] category save_only', actions[0].category, 'save_only');
  eq('4c. [0] saveDC', actions[0].saveDC, 23);
  eq('4d. [0] saveAbility', actions[0].saveAbility, 'str');

  // [1] vulnerability to lightning (debuff_enemy)
  eq('4e. [1] category debuff_enemy', actions[1].category, 'debuff_enemy');
  eq('4f. [1] not a spell', actions[1].isSpell, false);
  eq('4g. [1] durationRounds', actions[1].durationRounds, 1);

  // [2] electrically charged: DC 23 CON, 3d6 lightning
  eq('4h. [2] category save_damage', actions[2].category, 'save_damage');
  eq('4i. [2] saveDC', actions[2].saveDC, 23);
  eq('4j. [2] saveAbility', actions[2].saveAbility, 'con');
  assert('4k. [2] damage 3d6 lightning', actions[2].damage?.count === 3 && actions[2].damage?.sides === 6 && actions[2].damage?.type === 'lightning',
    `got ${JSON.stringify(actions[2].damage)}`);
}

// ============================================================
// 5. Adult Black Dragon — save_condition + save_damage + DEFERRED (magical darkness)
// ============================================================
console.log('\n--- 5. Adult Black Dragon (deferred: magical-darkness) ---');
{
  const actions = lair('Adult Black Dragon');
  eq('5a. Black Dragon has 4 actions', actions.length, 4);

  // [0] pools: DC 15 STR, prone
  eq('5b. [0] category save_condition', actions[0].category, 'save_condition');
  eq('5c. [0] saveDC', actions[0].saveDC, 15);
  eq('5d. [0] saveAbility', actions[0].saveAbility, 'str');
  assert('5e. [0] conditions [prone]', actions[0].conditions?.[0] === 'prone');

  // [1] swarming insects: DC 15 CON, 3d6 piercing, radius 20
  eq('5f. [1] category save_damage', actions[1].category, 'save_damage');
  eq('5g. [1] saveDC', actions[1].saveDC, 15);
  eq('5h. [1] saveAbility', actions[1].saveAbility, 'con');
  assert('5i. [1] damage piercing', actions[1].damage?.type === 'piercing');
  eq('5j. [1] radiusFt', actions[1].radiusFt, 20);

  // [2] magical darkness — DEFERRED: 'magical-darkness', lair_def_001
  const dark = actions[2];
  eq('5k. [2] category deferred', dark.category, 'deferred');
  eq('5l. [2] deferred tag', dark.deferred, 'magical-darkness');
  eq('5m. [2] deferredId', dark.deferredId, 'lair_def_001');
  eq('5n. [2] not outOfScope', dark.outOfScope, false);
  eq('5o. [2] isMagical', dark.isMagical, true);
  eq('5p. [2] radiusFt', dark.radiusFt, 15);
}

// ============================================================
// 6. Androsphinx (Sphinx group) — DEFERRED meta-initiative + meta-time
//    + remedy-reference exclusion (greater restoration, wish → isSpell=false)
// ============================================================
console.log('\n--- 6. Androsphinx (deferred meta-initiative + meta-time; remedy-ref exclusion) ---');
{
  const actions = lair('Androsphinx');
  eq('6a. Sphinx has 4 actions', actions.length, 4);
  eq('6b. sourceCreature is Sphinx', actions[0].sourceCreature, 'Sphinx');

  // [0] reroll initiative — DEFERRED: 'meta-initiative', lair_def_006
  eq('6c. [0] category deferred', actions[0].category, 'deferred');
  eq('6d. [0] deferred tag', actions[0].deferred, 'meta-initiative');
  eq('6e. [0] deferredId', actions[0].deferredId, 'lair_def_006');

  // [1] aging effect — greater restoration is a REMEDY-REFERENCE (not cast).
  //     isSpell MUST be false; category is save_only (DC 15 CON, no dmg/cond).
  eq('6f. [1] isSpell false (greater restoration is remedy-ref)', actions[1].isSpell, false);
  eq('6g. [1] no spellName', actions[1].spellName, undefined);
  eq('6h. [1] category save_only', actions[1].category, 'save_only');
  eq('6i. [1] saveDC', actions[1].saveDC, 15);
  eq('6j. [1] saveAbility', actions[1].saveAbility, 'con');

  // [2] flow of time 10 years — DEFERRED: 'meta-time', lair_def_008.
  //     wish is a REMEDY-REFERENCE → isSpell false (deferred takes category priority).
  eq('6k. [2] category deferred', actions[2].category, 'deferred');
  eq('6l. [2] deferred tag', actions[2].deferred, 'meta-time');
  eq('6m. [2] deferredId', actions[2].deferredId, 'lair_def_008');
  eq('6n. [2] isSpell false (wish is remedy-ref)', actions[2].isSpell, false);

  // [3] plane shift — bespoke
  eq('6o. [3] category bespoke', actions[3].category, 'bespoke');
  eq('6p. [3] not deferred', actions[3].deferred, undefined);
}

// ============================================================
// 7. Demilich — save_condition + cast_spell (antimagic field, isSpell=true)
// ============================================================
console.log('\n--- 7. Demilich (cast_spell: antimagic field) ---');
{
  const actions = lair('Demilich');
  eq('7a. Demilich has 3 actions', actions.length, 3);

  // [0] tomb trembles: DC 19 DEX, prone
  eq('7b. [0] category save_condition', actions[0].category, 'save_condition');
  eq('7c. [0] saveDC', actions[0].saveDC, 19);
  eq('7d. [0] saveAbility', actions[0].saveAbility, 'dex');
  assert('7e. [0] conditions [prone]', actions[0].conditions?.[0] === 'prone');

  // [1] antimagic field fills the target — isSpell=true, level 8
  const amf = actions[1];
  eq('7f. [1] category cast_spell', amf.category, 'cast_spell');
  eq('7g. [1] isSpell', amf.isSpell, true);
  eq('7h. [1] spellName', amf.spellName, 'antimagic field');
  eq('7i. [1] castLevel', amf.castLevel, 8);
  eq('7j. [1] rangeFt', amf.rangeFt, 60);
  eq('7k. [1] durationRounds', amf.durationRounds, 1);

  // [2] no healing — bespoke (no save/damage/condition tags)
  eq('7l. [2] category bespoke', actions[2].category, 'bespoke');
  eq('7m. [2] durationRounds', actions[2].durationRounds, 1);
}

// ============================================================
// 8. Mummy Lord — bespoke + buff_ally + save_damage
// ============================================================
console.log('\n--- 8. Mummy Lord (buff_ally + save_damage) ---');
{
  const actions = lair('Mummy Lord');
  eq('8a. Mummy Lord has 3 actions', actions.length, 3);

  // [0] undead pinpoint living — bespoke (no save/damage tags)
  eq('8b. [0] category bespoke', actions[0].category, 'bespoke');
  eq('8c. [0] not a spell', actions[0].isSpell, false);

  // [1] undead advantage on saves — buff_ally
  eq('8d. [1] category buff_ally', actions[1].category, 'buff_ally');
  eq('8e. [1] durationRounds', actions[1].durationRounds, 1);

  // [2] spellcasting pain — DC 16 CON, necrotic
  eq('8f. [2] category save_damage', actions[2].category, 'save_damage');
  eq('8g. [2] saveDC', actions[2].saveDC, 16);
  eq('8h. [2] saveAbility', actions[2].saveAbility, 'con');
  assert('8i. [2] damage necrotic', actions[2].damage?.type === 'necrotic',
    `got ${JSON.stringify(actions[2].damage)}`);
}

// ============================================================
// 9. Beholder — bespoke (difficult terrain) + save_condition (grappled)
// ============================================================
console.log('\n--- 9. Beholder (bespoke + save_condition grappled) ---');
{
  const actions = lair('Beholder');
  eq('9a. Beholder has 3 actions', actions.length, 3);

  // [0] slimy ground (difficult terrain) — bespoke (no @dc/@damage)
  eq('9b. [0] category bespoke', actions[0].category, 'bespoke');

  // [1] grasping appendages — DC 15 DEX, grappled, dur 2 (round after next)
  eq('9c. [1] category save_condition', actions[1].category, 'save_condition');
  eq('9d. [1] saveDC', actions[1].saveDC, 15);
  eq('9e. [1] saveAbility', actions[1].saveAbility, 'dex');
  assert('9f. [1] conditions [grappled]', actions[1].conditions?.[0] === 'grappled');
  eq('9g. [1] durationRounds', actions[1].durationRounds, 2);

  // [2] eye ray — bespoke
  eq('9h. [2] category bespoke', actions[2].category, 'bespoke');
}

// ============================================================
// 10. Death Tyrant — bespoke + save_condition (grappled, dur 2)
// ============================================================
console.log('\n--- 10. Death Tyrant (bespoke + save_condition) ---');
{
  const actions = lair('Death Tyrant');
  eq('10a. Death Tyrant has 3 actions', actions.length, 3);

  // [0] spectral eyes/tentacles — bespoke
  eq('10b. [0] category bespoke', actions[0].category, 'bespoke');

  // [1] spectral appendages — DC 17 DEX, grappled, dur 2
  eq('10c. [1] category save_condition', actions[1].category, 'save_condition');
  eq('10d. [1] saveDC', actions[1].saveDC, 17);
  eq('10e. [1] saveAbility', actions[1].saveAbility, 'dex');
  assert('10f. [1] conditions [grappled]', actions[1].conditions?.[0] === 'grappled');
  eq('10g. [1] durationRounds', actions[1].durationRounds, 2);
}

// ============================================================
// 11. extractLairAction direct unit tests (synthetic strings)
//     — covers summon fallback + Baphomet cast_spell / gravity-deferred
// ============================================================
console.log('\n--- 11. extractLairAction synthetic (summon fallback + Baphomet) ---');
{
  // 11a. Lichen Lich shambling mound — no @creature tag, but "creating a X …
  //      obeys … appears in an unoccupied space" → summon fallback ([VERIFY-1]).
  const lichen = extractLairAction(
    "The lich commands the might of its diseased grove, creating a shambling mound. The shambling mound appears in an unoccupied space within 30 feet of the lich, obeys its commands. The shambling mound dies after 1 hour.",
    'Lichen Lich', 1,
  );
  eq('11a. lichen category summon', lichen.category, 'summon');
  eq('11b. lichen summon creature', lichen.summons?.creature, 'shambling mound');
  eq('11c. lichen summon count', lichen.summons?.count, 1);
  eq('11d. lichen durationRounds Infinity (1 hour >> combat)', lichen.durationRounds, Infinity);
  eq('11e. lichen not out-of-scope/deferred', lichen.outOfScope || lichen.deferred !== undefined, false);
  eq('11f. lichen id', lichen.id, 'Lichen Lich::1');

  // 11b. Baphomet casts mirage arcane — isSpell=true, level 7 (non-MM source;
  //      tests the @spell path + LAIR_SPELL_LEVELS lookup).
  const mirage = extractLairAction(
    'Baphomet casts {@spell mirage arcane}, affecting a room within the lair that is no larger in any dimension than 100 feet.',
    'Baphomet', 0,
  );
  eq('11g. mirage category cast_spell', mirage.category, 'cast_spell');
  eq('11h. mirage isSpell', mirage.isSpell, true);
  eq('11i. mirage spellName', mirage.spellName, 'mirage arcane');
  eq('11j. mirage castLevel', mirage.castLevel, 7);

  // 11c. Baphomet gravity reversed — deferred: 'gravity', lair_def_007.
  const grav = extractLairAction(
    'Baphomet chooses a room within the lair that is no larger in any dimension than 100 feet. Until the next initiative count 20, gravity is reversed within that room.',
    'Baphomet', 1,
  );
  eq('11k. grav category deferred', grav.category, 'deferred');
  eq('11l. grav deferred tag', grav.deferred, 'gravity');
  eq('11m. grav deferredId', grav.deferredId, 'lair_def_007');

  // 11d. rawText cleaning — {@dc 15} → "15", {@damage 6d6} → "6d6"
  const cleaned = extractLairAction(
    'Magma erupts. Each creature must make a {@dc 15} Dexterity saving throw, taking 21 ({@damage 6d6}) fire damage.',
    'Test', 0,
  );
  assert('11n. rawText has no {@ tags', !/\{@/.test(cleaned.rawText), `got "${cleaned.rawText}"`);
  assert('11o. rawText contains "15"', cleaned.rawText.includes('15'));
  assert('11p. rawText contains "6d6"', cleaned.rawText.includes('6d6'));
}

// ============================================================
// 12. Full-corpus sanity — 324 actions; tagging counts in expected ranges
// ============================================================
console.log('\n--- 12. Full-corpus sanity ---');
{
  // Re-load the raw legendarygroups data and run extractLairAction over every
  // flattened action (mirrors parseLairActions' flattening exactly).
  const lgPath = path.join(__dirname, '../../bestiaryData/legendarygroups.json');
  const lgData = JSON.parse(fs.readFileSync(lgPath, 'utf8'));
  const groups = lgData.legendaryGroup || [];
  const flat = (e: any): string => {
    if (typeof e === 'string') return e;
    if (Array.isArray(e)) return e.map(flat).join(' ');
    if (e.items) return e.items.map(flat).join(' ');
    if (e.entries) return e.entries.map(flat).join(' ');
    if (e.entry) return e.entry;
    return '';
  };
  let total = 0, isSpellCount = 0, outOfScopeCount = 0, deferredCount = 0;
  let isMagicalTrue = 0;
  const catCount: Record<string, number> = {};
  for (const g of groups) {
    if (!g.lairActions) continue;
    let idx = 0;
    for (const entry of g.lairActions) {
      if (typeof entry === 'string') continue;
      const push = (t: string) => {
        const text = t.trim();
        if (!text) return;
        const a = extractLairAction(text, g.name, idx++);
        total++;
        if (a.isSpell) isSpellCount++;
        if (a.isMagical) isMagicalTrue++;
        if (a.outOfScope) outOfScopeCount++;
        if (a.deferred) deferredCount++;
        catCount[a.category] = (catCount[a.category] || 0) + 1;
      };
      if (entry.items && Array.isArray(entry.items)) {
        for (const item of entry.items) push(flat(item));
      } else if (entry.entries) {
        push(flat(entry));
      }
    }
  }

  console.log(`    total=${total} isSpell=${isSpellCount} isMagical=${isMagicalTrue} oos=${outOfScopeCount} deferred=${deferredCount}`);
  console.log(`    categories=${JSON.stringify(catCount)}`);

  // 324 total actions (115 groups). The RFC estimated 309; the actual parser
  // flattening yields 324 (includes ~15 intro-text artifacts from "Additional
  // Lair Actions" sections — a pre-existing parser behavior preserved for
  // backward compat; Phase 2 may refine).
  eq('12a. total actions == 324', total, 324);
  // isSpell: ~40 (56 @spell tags minus remedy-references minus deferred-only).
  assert('12b. isSpell count in [30, 50]', isSpellCount >= 30 && isSpellCount <= 50, `got ${isSpellCount}`);
  // isMagical: ALL actions (MM: lair actions are magical effects).
  eq('12c. all actions isMagical=true', isMagicalTrue, total);
  // Out-of-scope: 3 (Balhannoth, Ki-rin, Merrenoloth — MM-only scan; the full
  // corpus has more but they're in non-MM sources not loaded here).
  assert('12d. out-of-scope >= 3', outOfScopeCount >= 3, `got ${outOfScopeCount}`);
  // Deferred: >= 8 (Black Dragon, Sphinx×2, Baphomet, Juiblex + heuristic catches).
  assert('12e. deferred >= 8', deferredCount >= 8, `got ${deferredCount}`);
  // cast_spell category present and non-zero.
  assert('12f. cast_spell category present', (catCount['cast_spell'] ?? 0) > 0);
  // deferred category present.
  assert('12g. deferred category present', (catCount['deferred'] ?? 0) > 0);
  // flavor (out-of-scope) category present.
  assert('12h. flavor category present', (catCount['flavor'] ?? 0) > 0);
  // Every action has a stable id matching `${sourceCreature}::${index}`.
  // (Spot-checked above in §1b/§11f; the corpus loop guarantees uniqueness by
  // construction since idx resets per group.)
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
