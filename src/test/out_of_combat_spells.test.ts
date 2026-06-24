// ============================================================
// out_of_combat_spells.test.ts
//
// Verifies that:
//   1. SpellTemplate has the outOfCombat field (duck-typed by lookupSpell)
//   2. All 10 delegated out-of-combat spells are in SPELL_DB with
//      outOfCombat=true.
//   3. No damage / no attackType — they are inert in combat.
//   4. Existing combat spells are NOT tagged outOfCombat.
//
// Rationale: safety net for Batch 5b step 2 (monster spellcasting engine
// integration). The monster spell-selection loop must skip these spells.
// ============================================================

import { lookupSpell, SPELL_DB } from '../data/spells';

// ---- tiny assertion helpers ---------------------------------
let pass = 0;
let fail = 0;

function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.error(`  ❌ ${label}`);
    fail++;
  }
}

function eq<T>(label: string, a: T, b: T): void {
  assert(`${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`, a === b);
}

// ---- out-of-combat spell list (matches delegation spec) -----
const OUT_OF_COMBAT_SPELLS: Array<{ name: string; slotLevel: number; requiresConcentration: boolean }> = [
  { name: 'detect magic',         slotLevel: 1, requiresConcentration: true  },
  { name: 'comprehend languages', slotLevel: 1, requiresConcentration: false },
  { name: 'identify',             slotLevel: 1, requiresConcentration: false },
  { name: 'locate object',        slotLevel: 2, requiresConcentration: true  },
  { name: 'clairvoyance',         slotLevel: 3, requiresConcentration: true  },
  { name: 'sending',              slotLevel: 3, requiresConcentration: false },
  { name: 'tongues',              slotLevel: 3, requiresConcentration: false },
  { name: 'water breathing',      slotLevel: 3, requiresConcentration: false },
  { name: 'divination',           slotLevel: 4, requiresConcentration: false },
  { name: 'locate creature',      slotLevel: 4, requiresConcentration: true  },
];

console.log('\n── Out-of-Combat Spells: SPELL_DB entries ──');

for (const { name, slotLevel, requiresConcentration } of OUT_OF_COMBAT_SPELLS) {
  const entry = lookupSpell(name);
  assert(`'${name}' exists in SPELL_DB`, entry !== null);
  if (!entry) continue;

  assert(`'${name}' outOfCombat=true`,    entry.outOfCombat === true);
  assert(`'${name}' attackType=null`,      entry.attackType === null);
  assert(`'${name}' damage=null`,          entry.damage === null);
  assert(`'${name}' slotLevel=${slotLevel}`,  entry.slotLevel === slotLevel);
  assert(`'${name}' requiresConcentration=${requiresConcentration}`,
    entry.requiresConcentration === requiresConcentration);
}

console.log('\n── Case-insensitive lookup ──');
{
  const e1 = lookupSpell('Detect Magic');
  assert('lookupSpell("Detect Magic") resolves', e1 !== null && e1.outOfCombat === true);
  const e2 = lookupSpell('LOCATE CREATURE');
  assert('lookupSpell("LOCATE CREATURE") resolves', e2 !== null && e2.outOfCombat === true);
}

console.log('\n── Existing combat spells do NOT have outOfCombat ──');
{
  const firebolt = lookupSpell('fire bolt');
  assert('fire bolt: outOfCombat is falsy', !firebolt?.outOfCombat);
  const fireball = lookupSpell('fireball');
  assert('fireball: outOfCombat is falsy', !fireball?.outOfCombat);
  const bless = lookupSpell('bless');
  assert('bless: outOfCombat is falsy', !bless?.outOfCombat);
}

console.log('\n── SPELL_DB count sanity check ──');
{
  const allOutOfCombat = Object.values(SPELL_DB).filter(s => s.outOfCombat === true);
  eq('Exactly 10 spells tagged outOfCombat', allOutOfCombat.length, 10);
}

// ---- results ------------------------------------------------
console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
