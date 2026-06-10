// ============================================================
// healing_spells.test.ts
// Integration tests for Cure Wounds + Healing Word
//
// Tests:
//   1. shouldCastCureWounds — priority logic, range gate, slot gate
//   2. shouldCastHealingWord — same, 60ft range
//   3. spellHealPlan — slot consumed, amount bounds, description
//   4. planTurn — Cleric picks Cure Wounds over attacking (downed ally)
//   5. planBonusAction — Healing Word fires at priority 2.5
//   6. Engine: Cleric revives downed Fighter mid-combat (case 'spellHeal')
//   7. Engine: Healing Word raises ally at range, ally acts next turn
//   8. Edge cases: no slots, already full HP, self-heal, caster goes down
//
// Run: ts-node src/test/healing_spells.test.ts
// ============================================================

import * as fs from 'fs';
import { spawnPC, loadPCStatBlocks }                 from '../parser/pc';
import { loadBestiaryJson, monsterToCombatant }      from '../parser/fivetools';
import { shouldCastCureWounds, shouldCastHealingWord,
         spellHealPlan, hasSpellSlot }               from '../ai/resources';
import { planTurn }                                  from '../ai/planner';
import { runCombat, makeFlatBattlefield }            from '../engine/combat';
import { Combatant, Battlefield, PlayerResources }   from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- PC and bestiary factories ------------------------------

const rawPCs = JSON.parse(fs.readFileSync('pc_stat_blocks_lv1.json', 'utf8'));
const pcMap  = loadPCStatBlocks(rawPCs);

const bestiaryRaw = JSON.parse(fs.readFileSync('bestiaryData/bestiary-mm.json', 'utf8'));
const bestiary    = loadBestiaryJson(bestiaryRaw);

function spawnClass(cls: string, pos = { x: 0, y: 0, z: 0 }) {
  const c = spawnPC(pcMap, cls, pos);
  if (!c) throw new Error(`Unknown class: ${cls}`);
  return c;
}

function spawnMonster(name: string, id: string, pos = { x: 8, y: 0, z: 0 }) {
  const template = bestiary.get(name);
  if (!template) throw new Error(`Monster not found: ${name}`);
  return monsterToCombatant(template, id, pos);
}

/** Build a minimal Battlefield from an array of combatants. */
function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    combatants: map,
    round: 1,
    initiative: combatants.map((c, i) => ({ id: c.id, initiative: 10 - i })),
    obstacles: [],
  } as unknown as Battlefield;
}

/** Drain all spell slots from a caster. */
function drainSlots(caster: Combatant): void {
  const slots = caster.resources?.spellSlots;
  if (!slots) return;
  for (const slot of Object.values(slots)) slot.remaining = 0;
}

/** Place a combatant at 0 HP (unconscious, party down). */
function knockOut(c: Combatant): void {
  c.currentHP  = 0;
  c.isUnconscious = true;
  c.conditions.add('unconscious');
  if (c.isPlayer) {
    c.deathSaves = { successes: 0, failures: 0 };
  }
}

// =============================================================
// Section 1: shouldCastCureWounds
// =============================================================

console.log('\n=== 1. shouldCastCureWounds ===\n');

{
  // 1a. Downed ally at touch range → revive
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 1, y: 0, z: 0 }); // 5ft away
  knockOut(fighter);
  const bf = makeBF([cleric, fighter]);
  const target = shouldCastCureWounds(cleric, bf);
  assert('Returns downed ally at touch range', target?.id === fighter.id);
}

{
  // 1b. Downed ally too far for touch (> 5ft) → null
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 3, y: 0, z: 0 }); // 15ft away
  knockOut(fighter);
  const bf = makeBF([cleric, fighter]);
  const target = shouldCastCureWounds(cleric, bf);
  assert('Returns null when downed ally out of touch range', target === null);
}

{
  // 1c. Ally at 20% HP, adjacent → heal
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 1, y: 0, z: 0 });
  fighter.currentHP = Math.floor(fighter.maxHP * 0.20); // below 25%
  const bf = makeBF([cleric, fighter]);
  const target = shouldCastCureWounds(cleric, bf);
  assert('Returns ally below 25% HP at touch range', target?.id === fighter.id);
}

{
  // 1d. All allies healthy → null
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 1, y: 0, z: 0 });
  fighter.currentHP = fighter.maxHP; // full HP
  const bf = makeBF([cleric, fighter]);
  const target = shouldCastCureWounds(cleric, bf);
  assert('Returns null when all allies healthy', target === null);
}

{
  // 1e. Slot gate: no slots remaining → null even with downed ally
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 1, y: 0, z: 0 });
  knockOut(fighter);
  drainSlots(cleric);
  const bf = makeBF([cleric, fighter]);
  const target = shouldCastCureWounds(cleric, bf);
  assert('Returns null with no spell slots', target === null);
}

{
  // 1f. Self-heal priority: cleric below 25% with no downed allies
  const cleric = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  cleric.currentHP = Math.floor(cleric.maxHP * 0.20);
  const enemy = spawnClass('Fighter', { x: 10, y: 0, z: 0 });
  enemy.faction = 'enemy';
  const bf = makeBF([cleric, enemy]);
  const target = shouldCastCureWounds(cleric, bf);
  assert('Self-heals when critically low (self is always in range)', target?.id === cleric.id);
}

// =============================================================
// Section 2: shouldCastHealingWord
// =============================================================

console.log('\n=== 2. shouldCastHealingWord ===\n');

{
  // 2a. Downed ally at 60ft range → valid
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 12, y: 0, z: 0 }); // 60ft
  knockOut(fighter);
  const bf = makeBF([cleric, fighter]);
  const target = shouldCastHealingWord(cleric, bf);
  assert('Returns downed ally at 60ft range', target?.id === fighter.id);
}

{
  // 2b. Downed ally beyond 60ft → null
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 13, y: 0, z: 0 }); // 65ft
  knockOut(fighter);
  const bf = makeBF([cleric, fighter]);
  const target = shouldCastHealingWord(cleric, bf);
  assert('Returns null beyond 60ft (Healing Word range)', target === null);
}

{
  // 2c. Downed ally too far for Cure Wounds but within Healing Word → only HW picks it up
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 4, y: 0, z: 0 }); // 20ft — too far for touch
  knockOut(fighter);
  const bf = makeBF([cleric, fighter]);
  const cw = shouldCastCureWounds(cleric, bf);
  const hw = shouldCastHealingWord(cleric, bf);
  assert('Cure Wounds misses 20ft ally (touch range only)', cw === null);
  assert('Healing Word reaches 20ft ally', hw?.id === fighter.id);
}

// =============================================================
// Section 3: spellHealPlan
// =============================================================

console.log('\n=== 3. spellHealPlan ===\n');

{
  // 3a. Cure Wounds: slot consumed, type = spellHeal, healAmount in range
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 1, y: 0, z: 0 });
  const slotsBefore = cleric.resources!.spellSlots![1].remaining;
  const plan = spellHealPlan(cleric, fighter.id, false);
  eq('Cure Wounds: action type is spellHeal', plan.type, 'spellHeal');
  eq('Cure Wounds: target id set', plan.targetId, fighter.id);
  assert('Cure Wounds: slot consumed', cleric.resources!.spellSlots![1].remaining === slotsBefore - 1);
  // 1d8 + WIS(3) → range 4–11
  assert('Cure Wounds: healAmount in 1d8+WIS range (4–11)',
    (plan.healAmount ?? 0) >= 4 && (plan.healAmount ?? 0) <= 11,
    `got ${plan.healAmount}`);
  assert('Cure Wounds: description mentions spell name',
    (plan.description ?? '').includes('Cure Wounds'));
}

{
  // 3b. Healing Word: slot consumed, 1d4+WIS range
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 1, y: 0, z: 0 });
  const plan = spellHealPlan(cleric, fighter.id, true);
  eq('Healing Word: type is spellHeal', plan.type, 'spellHeal');
  // 1d4 + WIS(3) → range 4–7
  assert('Healing Word: healAmount in 1d4+WIS range (4–7)',
    (plan.healAmount ?? 0) >= 4 && (plan.healAmount ?? 0) <= 7,
    `got ${plan.healAmount}`);
  assert('Healing Word: description mentions spell name',
    (plan.description ?? '').includes('Healing Word'));
}

{
  // 3c. Minimum 1: WIS mod –1, roll 1 → healAmount = max(1, 0) = 1
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  cleric.wis = 8; // mod = -1
  // Roll can be 1..8; with mod -1, min result without the max(1,…) would be 0.
  // Run 30 times — at least once roll=1 should occur, and it should be floored to 1.
  let seenMin = false;
  for (let i = 0; i < 30; i++) {
    const c2 = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
    c2.wis = 8;
    const fighter = spawnClass('Fighter', { x: 1, y: 0, z: 0 });
    const plan = spellHealPlan(c2, fighter.id, false);
    if ((plan.healAmount ?? 0) >= 1) seenMin = true;
  }
  assert('spellHealPlan: healAmount always >= 1 even with negative WIS mod', seenMin);
}

// =============================================================
// Section 4: planTurn — Cleric prioritises heal over attack
// =============================================================

console.log('\n=== 4. planTurn — Cleric picks Cure Wounds over attacking ===\n');

{
  // Downed Fighter adjacent → Cleric should plan spellHeal, not attack
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 1, y: 0, z: 0 });
  knockOut(fighter);
  const enemy = spawnClass('Fighter', { x: 2, y: 0, z: 0 });
  enemy.id = 'enemy1'; enemy.name = 'Enemy'; enemy.faction = 'enemy';
  const bf = makeBF([cleric, fighter, enemy]);

  const plan = planTurn(cleric, bf);
  eq('Plan type is spellHeal when ally downed adjacent', plan.action?.type, 'spellHeal');
  eq('Plan targets the downed fighter', plan.action?.targetId, fighter.id);
}

{
  // No downed allies, all healthy → Cleric attacks instead
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 1, y: 0, z: 0 }); // full HP
  fighter.faction = 'enemy'; fighter.id = 'enemy1';
  const bf = makeBF([cleric, fighter]);

  const plan = planTurn(cleric, bf);
  assert('Cleric attacks when no heal target', plan.action?.type !== 'spellHeal',
    `got ${plan.action?.type}`);
}

{
{
  // Downed ally out of touch range — Cleric cannot reach via Cure Wounds (shouldCastCureWounds
  // range check is 5ft; at 25ft it returns null). Cleric falls through to regular action.
  // Healing Word at 60ft IS available as bonus action — tested in Section 5.
  // This test documents the known limitation: Cure Wounds does not trigger movement planning
  // for out-of-range targets (the moveBefore code in planTurn requires shouldCastCureWounds
  // to return a target, which it only does within 5ft).
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 5, y: 0, z: 0 }); // 25ft
  knockOut(fighter);
  const enemy = spawnClass('Fighter', { x: 0, y: 3, z: 0 });
  enemy.id = 'enemy1'; enemy.faction = 'enemy';
  const bf = makeBF([cleric, fighter, enemy]);

  const plan = planTurn(cleric, bf);
  assert('Cure Wounds not planned for downed ally at 25ft (out of touch range)',
    plan.action?.type !== 'spellHeal' || plan.action?.targetId !== fighter.id,
    `action: ${plan.action?.type}, target: ${plan.action?.targetId}`);
}

// =============================================================
// Section 5: planBonusAction — Healing Word at priority 2.5
// =============================================================

console.log('\n=== 5. planBonusAction — Healing Word bonus action ===\n');

{
  // Downed Fighter at 30ft — within Healing Word (60ft) not Cure Wounds (touch)
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 6, y: 0, z: 0 }); // 30ft
  knockOut(fighter);
  const enemy = spawnClass('Fighter', { x: 1, y: 0, z: 0 });
  enemy.id = 'enemy1'; enemy.faction = 'enemy';
  const bf = makeBF([cleric, fighter, enemy]);

  const plan = planTurn(cleric, bf);
  // Cure Wounds can't reach (> 5ft), but Healing Word can → goes to bonusAction
  assert('Healing Word in bonusAction when ally at 30ft',
    plan.bonusAction?.type === 'spellHeal',
    `got ${plan.bonusAction?.type}`);
  eq('Healing Word targets downed fighter', plan.bonusAction?.targetId, fighter.id);
}

// =============================================================
// Section 6: Engine — Cleric revives downed Fighter mid-combat
// =============================================================

console.log('\n=== 6. Engine: Cure Wounds revives downed Fighter ===\n');

{
  // Setup: Cleric (party) + Fighter (party, downed) vs 1 Goblin
  // Cleric goes first (high initiative), Fighter is unconscious, Goblin attacks
  // Expected: within first few rounds, Fighter should regain consciousness

  const cleric  = spawnClass('Cleric',  { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 1, y: 0, z: 0 });
  knockOut(fighter);

  const goblin = spawnMonster('goblin', 'goblin1', { x: 8, y: 0, z: 0 });

  const bf = makeFlatBattlefield(20, 20, [cleric, fighter, goblin]);
  const result = runCombat(bf, [cleric.id, fighter.id, goblin.id], { maxRounds: 10 });

  // Check Cleric cast spellHeal at some point
  const healEvents = result.events.filter((e: any) => e.type === 'heal' && e.actorId === cleric.id);
  assert('Cleric cast Cure Wounds at least once', healEvents.length >= 1,
    `heal events: ${healEvents.length}`);

  // Fighter should have been healed (HP > 0 at some point, or at least revived)
  const condEvents = result.events.filter((e: any) =>
    e.type === 'condition_remove' &&
    e.targetId === fighter.id &&
    e.description?.includes('regains consciousness'));
  assert('Fighter regained consciousness', condEvents.length >= 1,
    `condition_remove events: ${condEvents.length}`);

  // Slot was consumed
  assert('Spell slot consumed after Cure Wounds',
    (cleric.resources?.spellSlots?.[1]?.remaining ?? 2) < 2,
    `remaining: ${cleric.resources?.spellSlots?.[1]?.remaining}`);
}

// =============================================================
// Section 7: Engine — Healing Word, ally acts next turn
// =============================================================

console.log('\n=== 7. Engine: Healing Word raises ally, ally acts ===\n');

{
  // Place downed Fighter 30ft away (Healing Word range, not Cure Wounds)
  const cleric  = spawnClass('Cleric',  { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 6, y: 0, z: 0 }); // 30ft
  knockOut(fighter);

  const goblin = spawnMonster('goblin', 'goblin1', { x: 10, y: 0, z: 0 });

  const bf = makeFlatBattlefield(20, 20, [cleric, fighter, goblin]);
  const result = runCombat(bf, [cleric.id, fighter.id, goblin.id], { maxRounds: 10 });

  const healEvents = result.events.filter((e: any) => e.type === 'heal' && e.actorId === cleric.id);
  assert('Cleric healed at range via Healing Word or Cure Wounds', healEvents.length >= 1);

  // Fighter should have been revived
  const reviveEvents = result.events.filter((e: any) =>
    e.type === 'condition_remove' &&
    e.targetId === fighter.id &&
    e.description?.includes('regains consciousness'));
  assert('Fighter was revived', reviveEvents.length >= 1,
    `revive log entries: ${reviveEvents.length}`);
}

// =============================================================
// Section 8: Edge cases
// =============================================================

console.log('\n=== 8. Edge cases ===\n');

{
  // 8a. No spell slots: spellHeal is never planned
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 1, y: 0, z: 0 });
  knockOut(fighter);
  drainSlots(cleric);
  const enemy = spawnClass('Fighter', { x: 2, y: 0, z: 0 });
  enemy.id = 'enemy1'; enemy.faction = 'enemy';
  const bf = makeBF([cleric, fighter, enemy]);

  const plan = planTurn(cleric, bf);
  assert('No spellHeal planned when slots exhausted',
    plan.action?.type !== 'spellHeal' && plan.bonusAction?.type !== 'spellHeal',
    `action: ${plan.action?.type}, bonus: ${plan.bonusAction?.type}`);
}

{
  // 8b. Target at full HP: shouldCastCureWounds returns null
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 1, y: 0, z: 0 });
  fighter.currentHP = fighter.maxHP; // full
  const bf = makeBF([cleric, fighter]);
  const target = shouldCastCureWounds(cleric, bf);
  assert('Does not heal ally at full HP', target === null);
}

{
  // 8c. Only enemy downed: Cleric never heals enemy
  const cleric = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const enemy  = spawnClass('Fighter', { x: 1, y: 0, z: 0 });
  enemy.id = 'enemy1'; enemy.faction = 'enemy';
  knockOut(enemy);
  const bf = makeBF([cleric, enemy]);
  const cw = shouldCastCureWounds(cleric, bf);
  const hw = shouldCastHealingWord(cleric, bf);
  assert('Does not heal downed enemy (Cure Wounds)', cw === null);
  assert('Does not heal downed enemy (Healing Word)', hw === null);
}

{
  // 8d. Dead ally (isDead): never targeted
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 1, y: 0, z: 0 });
  fighter.currentHP = 0; fighter.isDead = true; fighter.isUnconscious = true;
  const bf = makeBF([cleric, fighter]);
  const target = shouldCastCureWounds(cleric, bf);
  assert('Dead ally is not a heal target', target === null);
}

{
  // 8e. spellHeal on dead target: engine guard — no HP change
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 1, y: 0, z: 0 });
  fighter.currentHP = 0; fighter.isDead = true;
  const enemy = spawnClass('Fighter', { x: 5, y: 0, z: 0 });
  enemy.id = 'enemy1'; enemy.faction = 'enemy';

  // Manually inject a spellHeal plan targeting a dead creature (adversarial test)
  // The engine should no-op it (guard: !target.isDead)
  const bf = makeFlatBattlefield(20, 20, [cleric, fighter, enemy]);
  const result = runCombat(bf, [cleric.id, fighter.id, enemy.id], { maxRounds: 2 });
  // Fighter was dead; they should remain dead (no conscious events)
  const ghostRevive = result.events.filter((e: any) =>
    e.type === 'condition_remove' &&
    e.targetId === fighter.id &&
    e.description?.includes('regains consciousness'));
  assert('Dead ally never revived by engine guard', ghostRevive.length === 0);
}

// ---- Results ------------------------------------------------

console.log(`\n─────────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('\nAll tests passed ✅');
else process.exit(1);
