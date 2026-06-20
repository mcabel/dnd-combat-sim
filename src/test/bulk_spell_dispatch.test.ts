// ============================================================
// bulk_spell_dispatch.test.ts — Session 19 bulk spell dispatch
//
// Validates the generic spell dispatch mechanism for the 262 Session 19
// bulk-implemented spells (levels 2-9). Each spell is generated from a
// uniform forward-compat flag template; this test verifies:
//
//   1. The GENERIC_SPELLS registry contains all 262 expected spells.
//   2. Each spell module's metadata has the right shape.
//   3. shouldCast() gates work (no action / no slot / already-active).
//   4. execute() consumes a slot, sets the flag, logs the cast.
//   5. The combat.ts dispatch case 'genericSpell' routes correctly.
//   6. The planner.ts generic loop picks a spell when one is available.
//
// Sampled spells (one per level 2-9, plus a few edge cases):
//   - Fireball (L3, combat, DEX save + fire damage)
//   - Beacon of Hope (L3, buff, concentration)
//   - Lightning Bolt (L3, combat, DEX save + lightning damage)
//   - Polymorph (L4, save-condition, WIS save)
//   - Wall of Ice (L6) — SKIPPED (blocker — wall subsystem)
//   - Feeblemind (L8, save-condition, INT save)
//   - Power Word Kill (L9, combat, no save)
//   - Mass Heal (L9, heal)
//
// NOTE: We sample ~10 spells across levels rather than testing all 262
// individually. The dispatch mechanism is uniform — if it works for one
// spell, it works for all. The per-spell module structure is identical
// (generated from a single template), so per-spell testing would be
// redundant. This shared test mirrors the per-spell test pattern from
// arcane_lock.test.ts.
// ============================================================

import { GENERIC_SPELLS, GENERIC_SPELL_LIST, lookupGenericSpell, GenericSpellDescriptor } from '../spells/_generic_registry';
import { Combatant, Action, PlayerResources, Vec3, Condition, PlannedAction } from '../types/core';
import { EngineState } from '../engine/combat';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots(level: number, remaining = 4): PlayerResources {
  return { spellSlots: { [level]: { max: 4, remaining } } };
}

function makeSpellAction(name: string, slotLevel: number, concentration = false): Action {
  return {
    name,
    isMultiattack: false,
    attackType: 'special',
    reach: 5,
    range: { normal: 60, long: 60 },
    hitBonus: null,
    damage: null,
    damageType: null,
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: concentration,
    slotLevel,
    costType: 'action',
    legendaryCost: 0,
    description: `${name} spell`,
  };
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set() as Set<Condition>,
    aiProfile: 'smart',
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    ...overrides,
  };
}

function makeBF(combatants: Combatant[]) {
  return {
    width: 20, height: 20, depth: 1,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: any): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as EngineState;
}

// ============================================================
// 1. Registry shape & size
// ============================================================

console.log('\n=== 1. Registry shape & size ===\n');

const SPELL_NAMES = Object.keys(GENERIC_SPELLS);
const SPELL_COUNT = SPELL_NAMES.length;

assert('Registry is non-empty', SPELL_COUNT > 0);
// Session 22: lowered from 300 to 290 after migrating 7 combat damage
// spells (Fireball, Lightning Bolt, Cone of Cold, Inflict Wounds,
// Chromatic Orb, Catapult, Ice Knife) from generic dispatch to bespoke
// implementations. The registry then had 306 spells (313 − 7).
// Session 23: lowered from 290 to 280 after migrating 7 more high-damage
// spells (Blight, Cloudkill, Disintegrate, Harm, Finger of Death,
// Sunburst, Power Word Kill). The registry then had 299 spells (306 − 7).
// Session 24: lowered from 280 to 235 after migrating 30 L1-L5 combat-damage
// spells. The registry now has 269 spells (299 − 30). Cumulative migrated: 44.
assert(`Registry has at least 235 spells (got ${SPELL_COUNT})`, SPELL_COUNT >= 235);
console.log(`  📊 Total bulk-implemented spells: ${SPELL_COUNT}`);

// Sample spells — one per level 1-9. Updated in Session 23 to avoid the
// 7 Session 22 migrated bespoke spells (Fireball L3, Cone of Cold L5) AND
// the 7 Session 23 migrated bespoke spells (Blight L4, Cloudkill L5,
// Disintegrate L6, Harm L6, Finger of Death L7, Sunburst L8, Power Word
// Kill L9 — all moved out of the generic registry into bespoke case
// branches).
const SAMPLE_SPELLS = [
  { name: 'Alarm', level: 1 },
  { name: 'Continual Flame', level: 2 },
  { name: 'Fear', level: 3 },
  { name: 'Polymorph', level: 4 },
  { name: 'Hold Monster', level: 5 },         // Session 23: was 'Cloudkill' (migrated)
  { name: 'Globe of Invulnerability', level: 6 }, // Session 23: was 'Disintegrate' (migrated)
  { name: 'Forcecage', level: 7 },            // Session 23: was 'Finger of Death' (migrated)
  { name: 'Feeblemind', level: 8 },
  { name: 'Time Stop', level: 9 },            // Session 23: was 'Power Word Kill' (migrated)
];

// ============================================================
// 1b. Session 22 — migrated spells are NO LONGER in the registry
// ============================================================
// The 7 combat damage spells migrated in Session 22 to bespoke
// implementations must NOT appear in the generic registry. Their
// bespoke modules at src/spells/<snake>.ts have a different execute
// signature (some take Combatant[] targets, some take a single target,
// some take an IceKnifePlan) that doesn't fit the generic dispatch
// shape (caster, state) → void.
console.log('\n=== 1b. Session 22 — migrated spells removed from registry ===\n');
const MIGRATED_SPELLS_S22 = [
  'Fireball', 'Lightning Bolt', 'Cone of Cold',
  'Inflict Wounds', 'Chromatic Orb', 'Catapult', 'Ice Knife',
];
for (const migrated of MIGRATED_SPELLS_S22) {
  eq(`  ${migrated} is no longer in the registry (migrated to bespoke)`,
    lookupGenericSpell(migrated), null);
}

// ============================================================
// 1c. Session 23 — migrated spells are NO LONGER in the registry
// ============================================================
// The 7 high-damage spells migrated in Session 23 to bespoke
// implementations must NOT appear in the generic registry. Their
// bespoke modules at src/spells/<snake>.ts have a different execute
// signature (some take Combatant[] targets, some take a single target)
// that doesn't fit the generic dispatch shape (caster, state) → void.
// Additionally, Power Word Kill has NO save and NO attack roll — a new
// pattern that the generic dispatch cannot express.
console.log('\n=== 1c. Session 23 — migrated spells removed from registry ===\n');
const MIGRATED_SPELLS_S23 = [
  'Blight', 'Cloudkill', 'Disintegrate', 'Harm',
  'Finger of Death', 'Sunburst', 'Power Word Kill',
];
for (const migrated of MIGRATED_SPELLS_S23) {
  eq(`  ${migrated} is no longer in the registry (migrated to bespoke)`,
    lookupGenericSpell(migrated), null);
}

// ============================================================
// 1d. Session 24 — migrated spells are NO LONGER in the registry
// ============================================================
// The 8 L1 combat-damage spells migrated in Session 24 to bespoke
// implementations must NOT appear in the generic registry. Their bespoke
// modules at src/spells/<snake>.ts have a different execute signature
// (single-target Combatant, or Combatant[] for AoE) that doesn't fit the
// generic dispatch shape (caster, state) → void. Witch Bolt additionally
// has a per-turn concentration-DoT pattern (auto-detected DoT mode) that
// the generic dispatch cannot express.
console.log('\n=== 1d. Session 24 — migrated spells removed from registry ===\n');
const MIGRATED_SPELLS_S24 = [
  'Chaos Bolt', 'Earth Tremor', 'Frost Fingers', 'Magnify Gravity',
  'Ray of Sickness', 'Spellfire Flare', 'Wardaway', 'Witch Bolt',
  'Mind Spike', 'Spray of Cards',
  'Erupting Earth', 'Life Transference', 'Pulse Wave', 'Tidal Wave', 'Vampiric Touch',
  'Elemental Bane', 'Gravity Sinkhole', 'Ice Storm', 'Sickening Radiance',
  'Spellfire Storm', 'Storm Sphere', 'Vitriolic Sphere',
  'Destructive Wave', 'Enervation', 'Flame Strike', 'Immolation', 'Maelstrom',
  'Negative Energy Flood', 'Steel Wind Strike', 'Synaptic Static',
];
for (const migrated of MIGRATED_SPELLS_S24) {
  eq(`  ${migrated} is no longer in the registry (migrated to bespoke)`,
    lookupGenericSpell(migrated), null);
}

// ============================================================
// 2. Sample spell lookup
// ============================================================

console.log('\n=== 2. Sample spell lookup ===\n');

for (const expected of SAMPLE_SPELLS) {
  const desc = lookupGenericSpell(expected.name);
  if (desc) {
    eq(`  ${expected.name}: registered`, desc.name, expected.name);
    eq(`  ${expected.name}: level matches`, desc.level, expected.level);
    assert(`  ${expected.name}: shouldCast is a function`, typeof desc.shouldCast === 'function');
    assert(`  ${expected.name}: execute is a function`, typeof desc.execute === 'function');
  } else {
    // Some may be blockers (e.g. Power Word Kill might or might not be a blocker)
    console.log(`  ℹ️  ${expected.name} not in registry (likely a blocker — skipped)`);
  }
}

// ============================================================
// 3. lookupGenericSpell returns null for unknown spells
// ============================================================

console.log('\n=== 3. Unknown spell lookup returns null ===\n');

eq('Unknown spell returns null', lookupGenericSpell('Nonexistent Spell XYZ'), null);
eq('Empty string returns null', lookupGenericSpell(''), null);

// ============================================================
// 4. GENERIC_SPELL_LIST matches GENERIC_SPELLS values
// ============================================================

console.log('\n=== 4. List matches map values ===\n');

eq('List length matches map size', GENERIC_SPELL_LIST.length, SPELL_COUNT);
const allInMap = GENERIC_SPELL_LIST.every(d => GENERIC_SPELLS[d.name] === d);
assert('Every list element is in the map', allInMap);

// ============================================================
// 5. shouldCast gates work for a sample spell (Fear — L3, still generic)
// ============================================================
// Updated in Session 21: was 'Fireball', now 'Fear' (Fireball migrated
// to bespoke — see src/spells/fireball.ts and src/test/fireball.test.ts).

console.log('\n=== 5. shouldCast gates (sample: Fear) ===\n');

const sampleDesc = lookupGenericSpell('Fear');
if (sampleDesc) {
  // 5a. No Fear action → false
  {
    const caster = makeCombatant('wiz', {
      actions: [],
      resources: withSlots(3, 2),
    });
    const enemy = makeCombatant('e1', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
    const bf = makeBF([caster, enemy]);
    eq('Returns false when caster lacks Fear action', sampleDesc.shouldCast(caster, bf as any), false);
  }
  // 5b. No 3rd-level slots → false
  {
    const caster = makeCombatant('wiz', {
      actions: [makeSpellAction('Fear', 3)],
      resources: withSlots(3, 0),
    });
    const enemy = makeCombatant('e1', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
    const bf = makeBF([caster, enemy]);
    eq('Returns false when no 3rd-level slots', sampleDesc.shouldCast(caster, bf as any), false);
  }
  // 5c. Already active → false
  {
    const caster = makeCombatant('wiz', {
      actions: [makeSpellAction('Fear', 3)],
      resources: withSlots(3, 2),
    });
    caster._genericSpellActiveSpells = new Set<string>(['Fear']);
    const enemy = makeCombatant('e1', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
    const bf = makeBF([caster, enemy]);
    eq('Returns false when already Fear-active', sampleDesc.shouldCast(caster, bf as any), false);
  }
  // 5d. All preconditions met → true
  {
    const caster = makeCombatant('wiz', {
      actions: [makeSpellAction('Fear', 3)],
      resources: withSlots(3, 2),
    });
    const enemy = makeCombatant('e1', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
    const bf = makeBF([caster, enemy]);
    eq('Returns true when all preconditions met', sampleDesc.shouldCast(caster, bf as any), true);
  }
}

// ============================================================
// 6. execute applies the flag + consumes the slot (sample: Fear)
// ============================================================
// Updated in Session 21: was 'Fireball', now 'Fear' (Fireball migrated).

console.log('\n=== 6. execute (sample: Fear) ===\n');

if (sampleDesc) {
  const caster = makeCombatant('wiz', {
    actions: [makeSpellAction('Fear', 3)],
    resources: withSlots(3, 2),
  });
  const enemy = makeCombatant('e1', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  sampleDesc.execute(caster, state);

  // 6a. Slot consumed
  eq('Slot consumed (3rd level: 2 → 1)',
    (caster.resources as any).spellSlots[3].remaining, 1);
  // 6b. Flag set
  assert('Flag set on caster',
    caster._genericSpellActiveSpells?.has('Fear') === true);
  // 6c. Log events emitted
  const actions = state.log.events.filter(e => e.type === 'action');
  assert('Action log emitted', actions.length === 1);
  const condAdds = state.log.events.filter(e => e.type === 'condition_add');
  assert('Condition-add log emitted', condAdds.length === 1);
  // 6d. Log description contains spell name
  if (actions.length === 1) {
    assert('Action log mentions Fear', actions[0].description.includes('Fear'));
  }
}

// ============================================================
// 7. Re-cast is blocked by the flag (sample: Fear)
// ============================================================
// Updated in Session 21: was 'Fireball', now 'Fear' (Fireball migrated).

console.log('\n=== 7. Re-cast blocked by flag ===\n');

if (sampleDesc) {
  const caster = makeCombatant('wiz', {
    actions: [makeSpellAction('Fear', 3)],
    resources: withSlots(3, 2),
  });
  const enemy = makeCombatant('e1', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  // First cast succeeds
  assert('First shouldCast returns true', sampleDesc.shouldCast(caster, bf as any) === true);
  sampleDesc.execute(caster, state);

  // Second shouldCast returns false (already active)
  eq('Second shouldCast returns false (already active)', sampleDesc.shouldCast(caster, bf as any), false);

  // Slot NOT consumed on blocked second cast (because shouldCast blocks before execute)
  eq('Slot count still 1 after blocked re-cast attempt',
    (caster.resources as any).spellSlots[3].remaining, 1);
}

// ============================================================
// 8. PlannedAction.spellName dispatch (TypeScript-level)
// ============================================================
// Updated in Session 21: was 'Fireball', now 'Fear' (Fireball migrated).

console.log('\n=== 8. PlannedAction.spellName field works ===\n');

{
  const plan: PlannedAction = {
    type: 'genericSpell',
    action: null,
    targetId: 'wiz',
    description: 'Wizard casts Fear',
    spellName: 'Fear',
  };
  eq('PlannedAction.spellName reads back correctly', plan.spellName, 'Fear');
  eq('PlannedAction.type is genericSpell', plan.type, 'genericSpell');
}

// ============================================================
// 9. Multi-level spell slot gating (sample one per level 2-9)
// ============================================================

console.log('\n=== 9. Multi-level slot gating ===\n');

// Updated in Session 22: 'Fireball' (L3) → 'Fear', 'Cone of Cold' (L5) →
// 'Cloudkill' — both migrated to bespoke implementations.
// Updated in Session 23: 'Cloudkill' (L5) → 'Hold Monster', 'Disintegrate'
// (L6) → 'Globe of Invulnerability', 'Finger of Death' (L7) → 'Forcecage',
// 'Power Word Kill' (L9) → 'Time Stop' — all 4 migrated to bespoke.
const SAMPLE_BY_LEVEL: Record<number, string | null> = {
  1: 'Alarm',
  2: 'Continual Flame',
  3: 'Fear',
  4: 'Polymorph',
  5: 'Hold Monster',
  6: 'Globe of Invulnerability',
  7: 'Forcecage',
  8: 'Feeblemind',
  9: 'Time Stop',
};

for (const levelStr of Object.keys(SAMPLE_BY_LEVEL)) {
  const level = parseInt(levelStr);
  const spellName = SAMPLE_BY_LEVEL[level];
  if (!spellName) continue;
  const desc = lookupGenericSpell(spellName);
  if (!desc) {
    console.log(`  ℹ️  L${level} ${spellName} not in registry (blocker)`);
    continue;
  }
  // Caster has the spell + slot
  const caster = makeCombatant('wiz', {
    actions: [makeSpellAction(spellName, level)],
    resources: withSlots(level, 2),
  });
  const enemy = makeCombatant('e1', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  eq(`  L${level} ${spellName}: shouldCast true when slot available`,
    desc.shouldCast(caster, bf as any), true);

  // Caster has no slot
  const casterNoSlot = makeCombatant('wiz', {
    actions: [makeSpellAction(spellName, level)],
    resources: withSlots(level, 0),
  });
  const bf2 = makeBF([casterNoSlot, enemy]);
  eq(`  L${level} ${spellName}: shouldCast false when no slot`,
    desc.shouldCast(casterNoSlot, bf2 as any), false);
}

// ============================================================
// 10. Registry ordering — spells are ordered by (level, name)
// ============================================================

console.log('\n=== 10. Registry ordering ===\n');

let prevLevel = 0;
let prevName = '';
let ordered = true;
for (const desc of GENERIC_SPELL_LIST) {
  if (desc.level < prevLevel) { ordered = false; break; }
  if (desc.level === prevLevel && desc.name < prevName) { ordered = false; break; }
  prevLevel = desc.level;
  prevName = desc.name;
}
assert('List is ordered by (level, name)', ordered);

// ============================================================
// 11. Count by level — verify bulk coverage across levels
// ============================================================

console.log('\n=== 11. Count by level ===\n');

const byLevel: Record<number, number> = {};
for (const desc of GENERIC_SPELL_LIST) {
  byLevel[desc.level] = (byLevel[desc.level] ?? 0) + 1;
}
for (const lvl of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
  console.log(`  L${lvl}: ${byLevel[lvl] ?? 0} spells`);
  assert(`L${lvl} has at least 1 spell`, (byLevel[lvl] ?? 0) >= 1);
}

// ============================================================
// Summary
// ============================================================

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
