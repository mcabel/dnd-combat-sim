// ============================================================
// Test: PC Spell Actions — parsing, AI selection, slot gating
// Covers:
//   1. Spell database lookup (spells.ts)
//   2. Parser: preparedSpells / spells_1st → Action objects
//   3. Single-range fix: "60ft" weapons parsed correctly
//   4. Reaction cost fix: Hellish Rebuke excluded from action selection
//   5. selectAction: save-based cantrips selected when out of range
//   6. selectAction: leveled spells selected over weak weapons
//   7. selectAction: slot gate — falls back to weapon when empty
//   8. executePlannedAction: slot consumed on cast
//
// Run: ts-node src/test/spell_actions.test.ts
// ============================================================

import { spawnPC } from '../parser/pc';
import { planTurn } from '../ai/planner';
import { selectAction } from '../ai/actions';
import { hasSpellSlot, consumeSpellSlot } from '../ai/resources';
import { runCombat, makeFlatBattlefield } from '../engine/combat';
import { lookupSpell } from '../data/spells';
import { Combatant } from '../types/core';
import * as fs from 'fs';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Shared setup -------------------------------------------

const rawPCs = JSON.parse(fs.readFileSync('pc_stat_blocks_lv1.json', 'utf8'));
const pcMap  = new Map(rawPCs.map((c: any) => [c.class.toLowerCase(), c]));

function spawnClass(cls: string, pos = { x: 5, y: 5, z: 0 }) {
  return spawnPC(pcMap as any, cls, pos)!;
}

function makeEnemy(id: string, pos: { x: number; y: number; z: number }, hp = 15): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: hp, currentHP: hp, ac: 13, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1, pos,
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart',
    perception: { targets: new Map() },
    concentration: null, deathSaves: null,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    resources: null, tempHP: 0,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null, activeEffects: [],
  };
}

function makeBF(pcs: Combatant[], enemies: Combatant[]) {
  const all = [...pcs, ...enemies];
  const map = new Map(all.map(c => [c.id, c]));
  return {
    width: 20, height: 20, depth: 1, cells: [],
    combatants: map, round: 1,
    initiativeOrder: all.map(c => c.id),
  } as any;
}

// ============================================================
// Section 1: Spell database
// ============================================================

console.log('\n=== 1. Spell database ===\n');

{
  const dw = lookupSpell('Dissonant Whispers');
  assert('Dissonant Whispers found', dw !== null);
  eq('DW attackType: save',  dw?.attackType, 'save');
  eq('DW slotLevel: 1',      dw?.slotLevel, 1);
  eq('DW saveAbility: wis',  dw?.saveAbility, 'wis');
  assert('DW has damage',    (dw?.damage?.count ?? 0) > 0);
}
{
  const tw = lookupSpell('thunderwave');   // case-insensitive
  assert('Thunderwave found (lowercase)', tw !== null);
  eq('Thunderwave isAoE: true', tw?.isAoE, true);
  eq('Thunderwave saveAbility: con', tw?.saveAbility, 'con');
}
{
  const mm = lookupSpell('Magic Missile');
  assert('Magic Missile found', mm !== null);
  eq('Magic Missile attackType: null (auto-hit)', mm?.attackType, null);
  eq('Magic Missile slotLevel: 1', mm?.slotLevel, 1);
}
{
  // Bless is now implemented — it IS in the DB (Session 34)
  const bless = lookupSpell('Bless');
  assert('Bless in DB (implemented Session 34)',         bless !== null);
  assert('Bless: requiresConcentration = true',         bless?.requiresConcentration === true);
  assert('Bless: no damage (buff spell)',                bless?.damage === null);
  assert('Detect Magic → null (utility)',                lookupSpell('Detect Magic') === null);
  {
    const cw = lookupSpell('Cure Wounds');
    assert('Cure Wounds in DB (heal-only, no damage)',   cw !== null && cw?.damage === null);
    eq('Cure Wounds slotLevel = 1',                      cw?.slotLevel, 1);
  }
}

// ============================================================
// Section 2: Parser — spell actions from preparedSpells
// ============================================================

console.log('\n=== 2. Parser — spell actions parsed ===\n');

{
  const druid = spawnClass('Druid');
  const spellActions = druid.actions.filter(a => a.slotLevel && a.slotLevel >= 1);
  const names = spellActions.map(a => a.name);
  assert('Druid has Thunderwave action',   names.includes('Thunderwave'));
  assert('Druid has Entangle action',      names.includes('Entangle'));
  assert('Druid has Faerie Fire action',   names.includes('Faerie Fire'));
  assert('Druid has Healing Word action',  names.includes('Healing Word'));
  assert('Druid has Goodberry action (in DB)', names.includes('Goodberry'));
}
{
  const bard = spawnClass('Bard');
  const names = bard.actions.filter(a => a.slotLevel && a.slotLevel >= 1).map(a => a.name);
  assert('Bard has Dissonant Whispers',   names.includes('Dissonant Whispers'));
  assert('Bard has Cure Wounds action',   names.includes('Cure Wounds'));
  assert('Bard has Charm Person action (in DB)', names.includes('Charm Person'));
}
{
  const wizard = spawnClass('Wizard');
  const names = wizard.actions.filter(a => a.slotLevel && a.slotLevel >= 1).map(a => a.name);
  assert('Wizard has Magic Missile',  names.includes('Magic Missile'));
  assert('Wizard has Thunderwave',    names.includes('Thunderwave'));
  assert('Wizard has Mage Armor',     names.includes('Mage Armor'));   // dispatched via case mageArmor
}
{
  const wl = spawnClass('Warlock');
  const names = wl.actions.filter(a => a.slotLevel && a.slotLevel >= 1).map(a => a.name);
  assert('Warlock has Arms of Hadar', names.includes('Arms of Hadar'));
}

// ============================================================
// Section 3: Single-range parsing fix ("60ft")
// ============================================================

console.log('\n=== 3. Single-range parsing ("60ft") ===\n');

{
  // Sacred Flame: "range": "60ft" → should get range.normal = 60
  const cleric = spawnClass('Cleric');
  const sf = cleric.actions.find(a => a.name === 'Sacred Flame');
  assert('Sacred Flame found',             sf !== undefined);
  eq('Sacred Flame range.normal = 60',     sf?.range?.normal, 60);
  eq('Sacred Flame attackType = save',     sf?.attackType, 'save');
  assert('Sacred Flame has no slotLevel',  !sf?.slotLevel); // cantrip
}
{
  // Eldritch Blast: "range": "120ft" → range.normal = 120
  const wl = spawnClass('Warlock');
  const eb = wl.actions.find(a => a.name === 'Eldritch Blast');
  assert('Eldritch Blast found',              eb !== undefined);
  eq('Eldritch Blast range.normal = 120',     eb?.range?.normal, 120);
}

// ============================================================
// Section 4: Reaction cost — Hellish Rebuke excluded
// ============================================================

console.log('\n=== 4. Reaction spell excluded from action selection ===\n');

{
  const wl = spawnClass('Warlock');
  const hr = wl.actions.find(a => a.name === 'Hellish Rebuke');
  assert('Hellish Rebuke found in actions array',          hr !== undefined);
  eq('Hellish Rebuke costType = reaction',                 hr?.costType, 'reaction');

  // Enemy at range (30ft) — Warlock should use Eldritch Blast (cantrip), NOT Hellish Rebuke
  const enemy = makeEnemy('e1', { x: 11, y: 5, z: 0 }); // 30ft away from Warlock at (5,5)
  const plan = planTurn(wl, makeBF([wl], [enemy]));
  assert('Warlock does NOT plan Hellish Rebuke as action',
    plan.action?.action?.name !== 'Hellish Rebuke',
    `got: ${plan.action?.action?.name}`);
  assert('Warlock uses Eldritch Blast (ranged cantrip)',
    plan.action?.action?.name === 'Eldritch Blast',
    `got: ${plan.action?.action?.name}`);
}

// ============================================================
// Section 5: Save-based cantrip selected (Sacred Flame)
// ============================================================

console.log('\n=== 5. Save-based cantrip selection ===\n');

{
  // Enemy at range (30ft) — Cleric already cast Bless round 1 (concentration active).
  // Round 2: can't reach in melee, Bless already up → should pick Sacred Flame.
  const cleric = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  cleric.concentration = { active: true, spellName: 'Bless', dcIfHit: 13 }; // already blessed
  const enemy  = makeEnemy('e1', { x: 6, y: 0, z: 0 }); // 30ft away
  const plan   = planTurn(cleric, makeBF([cleric], [enemy]));

  assert('Cleric picks Sacred Flame at range (Bless already active)', plan.action?.action?.name === 'Sacred Flame',
    `got: ${plan.action?.action?.name}`);
  assert('Cleric: Sacred Flame is cast type', plan.action?.type === 'cast');
  assert('Cleric: no slot consumed (cantrip)',
    (cleric.resources?.spellSlots?.['1']?.remaining ?? 0) === 2);
}

// ============================================================
// Section 6: Leveled spell beats weak weapon
// ============================================================

console.log('\n=== 6. Leveled spell selected over weaker weapon ===\n');

{
  // Bard adjacent to enemy — Dissonant Whispers (3d6=avg10.5) > Rapier (1d8+3=avg7.5)
  // Now dispatched via dedicated 'dissonantWhispers' planner type (not generic 'cast').
  const bard   = spawnClass('Bard', { x: 5, y: 5, z: 0 });
  const enemy  = makeEnemy('e1', { x: 6, y: 5, z: 0 }); // adjacent
  const plan   = planTurn(bard, makeBF([bard], [enemy]));

  eq('Bard adjacent: plans dissonantWhispers (dedicated type)',
    plan.action?.type, 'dissonantWhispers');
  assert('Bard DW target set', !!plan.targetId);
}
{
  // Sorcerer at range — Chromatic Orb (3d8=avg13.5) > any weapon.
  // Sleep has higher priority for Sorcerer when enemies are in range; remove it here
  // to test that Chromatic Orb is correctly selected as the best damage action.
  // NOTE: Chromatic Orb was migrated to a bespoke planner branch in Session 21,
  // so plan.action.type === 'chromaticOrb' (not plan.action.action.name — bespoke
  // branches set action: null). Mirrors the Dissonant Whispers assertion above.
  const sorc  = spawnClass('Sorcerer', { x: 0, y: 0, z: 0 });
  sorc.actions = sorc.actions.filter(a => a.name !== 'Sleep'); // isolate Chromatic Orb behaviour
  const enemy = makeEnemy('e1', { x: 10, y: 0, z: 0 }); // 50ft, in Chromatic Orb range (90ft)
  const plan  = planTurn(sorc, makeBF([sorc], [enemy]));

  eq('Sorcerer: picks Chromatic Orb at range',
    plan.action?.type, 'chromaticOrb');
}

// ============================================================
// Section 7: Slot gate — falls back to weapon when empty
// ============================================================

console.log('\n=== 7. Slot gate — fallback when slots empty ===\n');

{
  const bard = spawnClass('Bard', { x: 5, y: 5, z: 0 });
  const enemy = makeEnemy('e1', { x: 6, y: 5, z: 0 });
  const bf = makeBF([bard], [enemy]);

  // Drain all slots
  consumeSpellSlot(bard, 1);
  consumeSpellSlot(bard, 1);
  eq('Slots drained to 0', bard.resources?.spellSlots?.['1']?.remaining, 0);
  assert('hasSpellSlot false after drain', !hasSpellSlot(bard));

  const plan = planTurn(bard, bf);
  assert('Bard with 0 slots: no Dissonant Whispers',
    plan.action?.action?.name !== 'Dissonant Whispers',
    `got: ${plan.action?.action?.name}`);
  assert('Bard falls back to weapon (Rapier or Dagger)',
    plan.action?.action?.name === 'Rapier' || plan.action?.action?.name === 'Dagger',
    `got: ${plan.action?.action?.name}`);
}
{
  // Wizard out of slots: Fire Bolt (cantrip, no slotLevel) takes over
  const wiz  = spawnClass('Wizard', { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 6, y: 0, z: 0 });

  consumeSpellSlot(wiz, 1);
  consumeSpellSlot(wiz, 1);

  const plan = planTurn(wiz, makeBF([wiz], [enemy]));
  assert('Wizard 0 slots: uses Fire Bolt (cantrip)',
    plan.action?.action?.name === 'Fire Bolt',
    `got: ${plan.action?.action?.name}`);
}

// ============================================================
// Section 8: Combat integration — slot consumed on execution
// ============================================================

console.log('\n=== 8. Slot consumed during combat execution ===\n');

{
  // Bard casts Dissonant Whispers (slotLevel 1) — verify slot is consumed.
  // Use a single tough enemy (high HP, low attack) so Bard survives at least 2 rounds.
  const bard = spawnClass('Bard', { x: 5, y: 5, z: 0 });
  const slotsBefore = bard.resources?.spellSlots?.['1']?.remaining ?? 0;

  // Tanky enemy — high HP so it survives; low attack so Bard survives
  const tankEnemy = makeEnemy('tank', { x: 8, y: 5, z: 0 }, 100);
  // Override AC to 6 so Bard can hit easily
  (tankEnemy as any).ac = 6;

  const bf = makeFlatBattlefield(20, 20, [bard, tankEnemy]);
  runCombat(bf, [bard.id, 'tank'], { maxRounds: 2 });

  const slotsAfter = bard.resources?.spellSlots?.['1']?.remaining ?? slotsBefore;
  assert('Bard consumed at least 1 spell slot in 2 rounds',
    slotsAfter < slotsBefore,
    `before=${slotsBefore}, after=${slotsAfter}`);
}
{
  // Druid: Thunderwave is self-centered 15ft — place 2 enemies within 10ft.
  // After 1 round, at least 1 slot should be consumed.
  const druid = spawnClass('Druid', { x: 10, y: 10, z: 0 });
  const slotsBefore = druid.resources?.spellSlots?.['1']?.remaining ?? 0;

  const e1 = makeEnemy('e1', { x: 11, y: 10, z: 0 }, 30); // 5ft — inside 15ft radius
  const e2 = makeEnemy('e2', { x: 10, y: 11, z: 0 }, 30); // 5ft — inside 15ft radius

  const bf = makeFlatBattlefield(20, 20, [druid, e1, e2]);
  runCombat(bf, [druid.id, 'e1', 'e2'], { maxRounds: 2 });

  const slotsAfter = druid.resources?.spellSlots?.['1']?.remaining ?? slotsBefore;
  assert('Druid consumed at least 1 spell slot in 2 rounds',
    slotsAfter < slotsBefore,
    `before=${slotsBefore}, after=${slotsAfter}`);
}

// ============================================================

console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('\nAll tests passed ✅');
else              process.exit(1);
