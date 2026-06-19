// ============================================================
// detect_thoughts.test.ts — Detect Thoughts spell module
// PHB p.231: 2nd-level divination, action, range Self (5-ft aura),
//            concentration 1 min.
// Effect: read surface thoughts of creatures in range (v1: forward-compat flag
//         on the CASTER; no mind-reading subsystem in v1).
//
// v1 simplifications (documented via metadata flags):
//   - Mind-reading subsystem NOT implemented — `_detectThoughtsActive` flag is
//     forward-compat only.
//   - Probe action subsystem NOT implemented.
//   - WIS-save-resist ending NOT modelled.
//   - Concentration started but NOT enforced (TG-002).
//
// Tests cover shouldCast() preconditions + execute() scratch-field application
// + sentinel effect attachment + concentration start + slot consumption +
// logging + integration pipeline.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/detect_thoughts';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots2(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

const DETECT_THOUGHTS_ACTION: Action = {
  name: 'Detect Thoughts',
  isMultiattack: false,
  attackType: 'special',   // self-buff — NOT 'melee'/'ranged'
  reach: 0,
  range: { normal: 0, long: 0 },   // Self (5-ft aura)
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Detect Thoughts (self, reads surface thoughts in 5-ft aura, concentration 1 min)',
};

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

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

/** Wizard at (0,0,0) with Detect Thoughts + 2 2nd-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [DETECT_THOUGHTS_ACTION],
    resources: withSlots2(2),
  });
}

function makeEnemy(
  id: string,
  pos: Vec3 = { x: 1, y: 0, z: 0 },
  overrides: Partial<Combatant> = {},
): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', pos, ...overrides });
}

// ============================================================
// 1. Metadata (including v1 forward-compat flags)
// ============================================================

console.log('\n=== 1. Metadata (including v1 flags) ===\n');

eq('name is Detect Thoughts', metadata.name, 'Detect Thoughts');
eq('level is 2', metadata.level, 2);
eq('school is divination', metadata.school, 'divination');
eq('range is 5 ft (self aura)', metadata.rangeFt, 5);
eq('IS concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('v1: mind-reading subsystem NOT implemented',
  (metadata as any).detectThoughtsMindReadingV1Implemented, false);
eq('v1: probe action NOT implemented',
  (metadata as any).detectThoughtsProbeActionV1Implemented, false);
eq('v1: upcast NOT implemented',
  (metadata as any).detectThoughtsUpcastV1Implemented, false);
eq('v1: concentration enforcement NOT implemented',
  (metadata as any).detectThoughtsConcentrationEnforcementV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster is already concentrating — cannot cast
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when caster is already concentrating', shouldCast(caster, bf), false);
}

{
  // 2b. Caster lacks 'Detect Thoughts' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when caster has no Detect Thoughts action', shouldCast(caster, bf), false);
}

{
  // 2c. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when no 2nd-level slots', shouldCast(caster, bf), false);
}

{
  // 2d. Already Detect-Thoughts-active — skip
  const caster = makeWizard();
  caster._detectThoughtsActive = true;
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when already Detect-Thoughts-active', shouldCast(caster, bf), false);
}

{
  // 2e. No living enemies → buff useless → false
  const caster = makeWizard();
  const deadEnemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, deadEnemy]);
  eq('Returns false when no living enemies', shouldCast(caster, bf), false);
}

{
  // 2f. All preconditions met → returns true
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns true when all preconditions met', shouldCast(caster, bf), true);
}

// ============================================================
// 3. execute — scratch field + sentinel + concentration
// ============================================================

console.log('\n=== 3. execute — scratch field + sentinel + concentration ===\n');

{
  // 3a. _detectThoughtsActive set to true on caster
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  eq('Scratch field undefined before cast', caster._detectThoughtsActive, undefined);

  execute(caster, state);

  eq('Scratch field set', caster._detectThoughtsActive, true);
}

{
  // 3b. Sentinel damage_zone effect attached (dieCount=0)
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const sentinels = caster.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Detect Thoughts',
  );
  eq('1 sentinel damage_zone effect attached', sentinels.length, 1);
  if (sentinels.length === 1) {
    eq('Sentinel dieCount is 0 (no damage tick)', sentinels[0].payload.dieCount, 0);
    eq('Sentinel dieSides is 0', sentinels[0].payload.dieSides, 0);
    eq('Sentinel damageType is force', sentinels[0].payload.damageType, 'force');
    eq('Sentinel sourceIsConcentration is true', sentinels[0].sourceIsConcentration, true);
    eq('Sentinel casterId is the wizard', sentinels[0].casterId, 'wizard1');
  }
}

{
  // 3c. Slot consumed + concentration started
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Detect Thoughts', caster.concentration?.spellName, 'Detect Thoughts');
}

{
  // 3d. Existing concentration broken (safety net)
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  // Pre-existing Blur effect on caster (simulated)
  caster.activeEffects.push({
    id: 'eff_blur', casterId: caster.id, spellName: 'Blur',
    effectType: 'condition_apply', payload: { condition: 'hidden' as any },
    sourceIsConcentration: true,
  });
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Concentration switched to Detect Thoughts', caster.concentration?.spellName, 'Detect Thoughts');
  assert('Prior Blur effect removed from caster',
    !caster.activeEffects.some(e => e.spellName === 'Blur'));
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Detect Thoughts"',
    actionEvents[0].description.includes('Detect Thoughts'));
  eq('1 condition_add event (aura active)', condEvents.length, 1);
  assert('condition_add mentions surface thoughts / forward-compat',
    condEvents[0].description.includes('thoughts') ||
    condEvents[0].description.includes('forward-compat'));
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/detect_thoughts');
  const caster = makeWizard();
  caster._detectThoughtsActive = true;
  caster.concentration = { active: true, spellName: 'Detect Thoughts', dcIfHit: 10 };
  // cleanup should NOT clear the scratch field or break concentration.
  // (Concentration-break cleanup is handled by removeEffectsFromCaster's
  // _undoEffect branch for the sentinel.)
  cleanup(caster);
  eq('Cleanup does NOT clear scratch field', caster._detectThoughtsActive, true);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
}

// ============================================================
// 6. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 6. Integration pipeline ===\n');

{
  // 6a. Full pipeline: wizard casts Detect Thoughts in combat
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const decision = shouldCast(caster, bf);
  eq('shouldCast returns true', decision, true);
  if (decision) execute(caster, state);

  eq('Scratch field set', caster._detectThoughtsActive, true);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Detect Thoughts', caster.concentration?.spellName, 'Detect Thoughts');

  const sentinels = caster.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Detect Thoughts',
  );
  eq('Sentinel effect attached', sentinels.length, 1);
}

{
  // 6b. After slots exhausted, shouldCast returns false
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const d1 = shouldCast(caster, bf);
  if (d1) execute(caster, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  // Caster is now concentrating → second shouldCast also returns false
  const d2 = shouldCast(caster, bf);
  eq('shouldCast returns false after slots exhausted / concentration active', d2, false);
}

{
  // 6c. Concentration-break cleanup: sentinel removal clears the scratch field
  const { removeEffectsFromCaster } = require('../engine/spell_effects');
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);
  eq('Scratch field set before concentration break', caster._detectThoughtsActive, true);

  // Simulate concentration break: removeEffectsFromCaster clears the sentinel
  // and (via the _undoEffect case) deletes the scratch field.
  removeEffectsFromCaster(caster.id, bf);
  eq('Scratch field cleared after concentration break', caster._detectThoughtsActive, undefined);
  assert('Sentinel effect removed',
    !caster.activeEffects.some(e => e.spellName === 'Detect Thoughts'));
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
