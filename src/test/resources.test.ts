// ============================================================
// Test: Class Resource AI (Phase 4 tasks 4.3–4.7)
// Run: ts-node src/test/resources.test.ts
// ============================================================

import {
  shouldRage, activateRagePlan, shouldSecondWind, secondWindPlan,
  shouldSmite, applyDivineSmite,
  shouldLayOnHands, layOnHandsPlan,
  bardicInspirationTarget, bardicInspirationPlan,
  hasSpellSlot, consumeSpellSlot,
} from '../ai/resources';
import { loadPCStatBlocks, spawnPC, RawPCEntry } from '../parser/pc';
import { Combatant, Battlefield } from '../types/core';
import * as fs from 'fs';
import * as path from 'path';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Load real PC data --------------------------------------

const pcPath = [
  path.join(__dirname, '../../pc_stat_blocks_lv1.json'),
  '/mnt/project/pc_stat_blocks_lv1.json',
].find(p => fs.existsSync(p))!;

const pcData: RawPCEntry[] = JSON.parse(fs.readFileSync(pcPath, 'utf-8'));
const pcMap = loadPCStatBlocks(pcData);

function pc(cls: string, x = 0): Combatant {
  const c = spawnPC(pcMap, cls, { x, y: 0, z: 0 })!;
  if (!c) throw new Error(`Class not found: ${cls}`);
  return c;
}

function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return { width: 20, height: 20, depth: 1, cells: [], combatants: map, round: 1, initiativeOrder: [] };
}

function fakeEnemy(x = 5): Combatant {
  const e = pc('Fighter', x);
  e.faction = 'enemy';
  return e;
}

// ============================================================
// 1. Spell slot tracking
// ============================================================
console.log('\n=== 1. Spell Slot Tracking ===\n');

{
  const wizard = pc('Wizard');
  assert('Wizard has spell slots', wizard.resources?.spellSlots !== undefined);
  const slots = wizard.resources!.spellSlots!;
  eq('Wizard: 2 first-level slots', slots[1]?.max, 2);
  eq('Wizard: 2 remaining', slots[1]?.remaining, 2);

  assert('hasSpellSlot: true initially', hasSpellSlot(wizard));

  const lvl = consumeSpellSlot(wizard, 1);
  eq('Consumed level 1 slot', lvl, 1);
  eq('1 slot remaining', slots[1]?.remaining, 1);

  consumeSpellSlot(wizard, 1);
  eq('0 slots remaining', slots[1]?.remaining, 0);
  assert('hasSpellSlot: false when empty', !hasSpellSlot(wizard));

  const none = consumeSpellSlot(wizard, 1);
  eq('consumeSpellSlot returns null when empty', none, null);
}

{
  // Warlock pact slots
  const warlock = pc('Warlock');
  assert('Warlock has pact slots', warlock.resources?.pactSlots !== undefined);
  const pact = warlock.resources!.pactSlots!;
  eq('Warlock: 1 pact slot', pact.max, 1);
  eq('Warlock slot recovers on short', pact.recoversOn, 'short');

  const lvl = consumeSpellSlot(warlock, 1);
  eq('Pact slot consumed', lvl, 1);
  eq('Pact remaining = 0', pact.remaining, 0);
}

// ============================================================
// 2. Rage (Barbarian)
// ============================================================
console.log('\n=== 2. Rage ===\n');

{
  const barb = pc('Barbarian');
  assert('Barbarian has rage', barb.resources?.rage !== undefined);
  const r = barb.resources!.rage!;
  eq('2 rage uses at level 1', r.max, 2);
  assert('Not raging initially', !r.active);

  const enemy = fakeEnemy();
  const bf = makeBF([barb, enemy]);

  assert('Should rage: enemies present, not yet raging', shouldRage(barb, bf));

  const plan = activateRagePlan(barb);
  eq('Plan type = rage', plan.type, 'rage');
  assert('Rage now active', r.active);
  eq('Remaining = 1', r.remaining, 1);
  assert('Should not rage again (already active)', !shouldRage(barb, bf));

  // No enemies → don't rage
  const soloBarb = pc('Barbarian');
  const bfEmpty = makeBF([soloBarb]);
  assert('Should not rage: no enemies', !shouldRage(soloBarb, bfEmpty));

  // No remaining rages
  const noRage = pc('Barbarian');
  noRage.resources!.rage!.remaining = 0;
  assert('Should not rage: no uses left', !shouldRage(noRage, bf));
}

// ============================================================
// 3. Second Wind (Fighter)
// ============================================================
console.log('\n=== 3. Second Wind ===\n');

{
  const fighter = pc('Fighter');
  assert('Fighter has second wind', fighter.resources?.secondWind !== undefined);

  // Not wounded → don't use
  assert('No SW when healthy', !shouldSecondWind(fighter));

  // Below 50% HP → use it
  fighter.currentHP = Math.floor(fighter.maxHP * 0.4);
  assert('Use SW when below 50%', shouldSecondWind(fighter));

  const hpBefore = fighter.currentHP;
  const plan = secondWindPlan(fighter);
  eq('Plan type = secondWind', plan.type, 'secondWind');
  assert('HP increased', fighter.currentHP > hpBefore);
  assert('HP capped at max', fighter.currentHP <= fighter.maxHP);
  eq('SW uses spent', fighter.resources!.secondWind!.remaining, 0);
  assert('Should not use SW again', !shouldSecondWind(fighter));
}

// ============================================================
// 4. Divine Smite (Paladin)
// ============================================================
console.log('\n=== 4. Divine Smite ===\n');

{
  const paladin = pc('Paladin');
  assert('Paladin has divineSmite flag', paladin.resources?.divineSmite === true);
  assert('Paladin has spell slots for smite', hasSpellSlot(paladin));

  const fullTarget = pc('Fighter'); fullTarget.faction = 'enemy';
  const bloodied   = pc('Fighter'); bloodied.faction = 'enemy';
  bloodied.currentHP = Math.floor(bloodied.maxHP * 0.3);

  // Don't smite on normal hit vs healthy target
  assert('No smite on normal hit vs healthy', !shouldSmite(paladin, fullTarget, false));

  // Smite on crit
  assert('Smite on crit', shouldSmite(paladin, fullTarget, true));

  // Smite on bloodied target
  assert('Smite on bloodied target', shouldSmite(paladin, bloodied, false));

  // Actually apply smite
  const smiteDmg = applyDivineSmite(paladin, false);
  assert('Smite deals positive damage', smiteDmg > 0);
  assert('Smite deals ≥ 2 (2d8 min=2)', smiteDmg >= 2);
  assert('Smite deals ≤ 16 (2d8 max=16)', smiteDmg <= 16);
  eq('Slot consumed after smite', paladin.resources!.spellSlots![1]?.remaining, 1);

  // Crit smite rolls double dice
  let critTotal = 0, normalTotal = 0, trials = 50;
  for (let i = 0; i < trials; i++) {
    const p1 = pc('Paladin'), p2 = pc('Paladin');
    critTotal  += applyDivineSmite(p1, true);
    normalTotal += applyDivineSmite(p2, false);
  }
  assert('Crit smite averages higher than normal', critTotal / trials > normalTotal / trials * 0.9,
    `crit avg=${(critTotal/trials).toFixed(1)} normal avg=${(normalTotal/trials).toFixed(1)}`);

  // No smite without slots
  const noSlotPaladin = pc('Paladin');
  noSlotPaladin.resources!.spellSlots![1]!.remaining = 0;
  assert('No smite without slots', !shouldSmite(noSlotPaladin, bloodied, true));
}

// ============================================================
// 5. Lay on Hands (Paladin)
// ============================================================
console.log('\n=== 5. Lay on Hands ===\n');

{
  const paladin = pc('Paladin');
  assert('Paladin has lay on hands', paladin.resources?.layOnHands !== undefined);
  eq('LoH pool = 5 at level 1', paladin.resources!.layOnHands!.pool, 5);

  const ally = pc('Fighter');
  ally.isUnconscious = true; ally.currentHP = 0;
  ally.conditions.add('unconscious');

  const bf = makeBF([paladin, ally]);

  // Adjacent downed ally
  ally.pos = { x: 0, y: 1, z: 0 };
  const { use, targetId } = shouldLayOnHands(paladin, bf);
  assert('Use LoH on downed adjacent ally', use);
  eq('Target is the downed ally', targetId, ally.id);

  const plan = layOnHandsPlan(paladin, ally.id);
  eq('Plan type = layOnHands', plan.type, 'layOnHands');
  assert('Pool reduced', paladin.resources!.layOnHands!.remaining < 5);

  // No LoH when pool empty
  const emptyPaladin = pc('Paladin');
  emptyPaladin.resources!.layOnHands!.remaining = 0;
  const bf2 = makeBF([emptyPaladin, ally]);
  const { use: use2 } = shouldLayOnHands(emptyPaladin, bf2);
  assert('No LoH when pool empty', !use2);
}

// ============================================================
// 6. Bardic Inspiration (Bard)
// ============================================================
console.log('\n=== 6. Bardic Inspiration ===\n');

{
  const bard = pc('Bard');
  assert('Bard has bardic inspiration', bard.resources?.bardicInspiration !== undefined);
  eq('BI uses = CHA mod (3)', bard.resources!.bardicInspiration!.max, 3);
  eq('BI die = d6 at level 1', bard.resources!.bardicInspiration!.die, 'd6');

  const fighter = pc('Fighter', 2);
  const wizard  = pc('Wizard',  4);
  wizard.maxHP = 7; // lower HP
  const bf = makeBF([bard, fighter, wizard]);

  // Should target highest-HP ally (fighter)
  const target = bardicInspirationTarget(bard, bf);
  assert('BI target found', target !== null);
  eq('BI goes to highest-HP ally (Fighter)', target?.id, fighter.id);

  const plan = bardicInspirationPlan(bard, fighter);
  eq('Plan type = bardicInspiration', plan.type, 'bardicInspiration');
  eq('BI remaining reduced', bard.resources!.bardicInspiration!.remaining, 2);

  // No BI when empty
  bard.resources!.bardicInspiration!.remaining = 0;
  const noTarget = bardicInspirationTarget(bard, bf);
  assert('No BI target when empty', noTarget === null);
}

// ============================================================
// 7. Resources load correctly from pc_stat_blocks_lv1.json
// ============================================================
console.log('\n=== 7. All PC resources load from JSON ===\n');

const checks: [string, (c: Combatant) => boolean, string][] = [
  ['Barbarian', c => (c.resources?.rage?.max ?? 0) === 2,         'rage.max=2'],
  ['Fighter',   c => (c.resources?.secondWind?.max ?? 0) === 1,   'secondWind.max=1'],
  ['Bard',      c => (c.resources?.bardicInspiration?.max ?? 0) > 0, 'bardicInspiration present'],
  ['Paladin',   c => (c.resources?.layOnHands?.pool ?? 0) === 5,  'layOnHands.pool=5'],
  ['Paladin',   c => c.resources?.divineSmite === true,            'divineSmite=true'],
  ['Rogue',     c => c.resources?.sneakAttackDice === '1d6',       'sneakAttackDice=1d6'],
  ['Warlock',   c => (c.resources?.pactSlots?.max ?? 0) === 1,    'pactSlots.max=1'],
  ['Warlock',   c => c.resources?.pactSlots?.recoversOn === 'short', 'pactSlots recovers on short'],
  ['Wizard',    c => (c.resources?.spellSlots?.[1]?.max ?? 0) === 2, 'spellSlots[1].max=2'],
  ['Cleric',    c => (c.resources?.spellSlots?.[1]?.max ?? 0) === 2, 'cleric spellSlots[1].max=2'],
  ['Druid',     c => (c.resources?.spellSlots?.[1]?.max ?? 0) === 2, 'druid spellSlots[1].max=2'],
  ['Sorcerer',  c => (c.resources?.spellSlots?.[1]?.max ?? 0) === 2, 'sorcerer spellSlots[1].max=2'],
  // These classes have no CLASS-SPECIFIC resources at level 1, but all PCs now have hitDice
  ['Monk',   c => !!c.resources?.hitDice && !c.resources?.rage && !c.resources?.spellSlots && !c.resources?.pactSlots, 'monk has hitDice only, no class resources'],
  ['Ranger', c => c.resources === null || !c.resources.spellSlots, 'ranger no spell slots at lv1 (has ammo only)'],
];

for (const [cls, check, label] of checks) {
  const c = pc(cls);
  assert(`${cls}: ${label}`, check(c));
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
