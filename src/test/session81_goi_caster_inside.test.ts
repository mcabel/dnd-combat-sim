// ============================================================
// Test: Session 81 — Globe of Invulnerability caster-inside-barrier
//       edge case (PHB p.245)
//
// PHB p.245: "An immobile, faintly shimmering barrier springs into
// existence in a 10-foot radius around you and remains for the
// duration. Any spell of 5th level or lower cast from outside the
// barrier can't affect creatures or objects within it."
//
// Prior state (Sessions 77-80): GoI protected the GoI caster and any
// creature within 10 ft of a GoI caster, regardless of who cast the
// incoming spell. The ONLY exception was the `t.id === casterId`
// short-circuit in filterGoIProtectedTargets, which let the GoI
// caster's own spells affect the GoI caster themselves — but allies
// within the radius were still filtered out.
//
// Session 81 fix: isProtectedByGoI() now accepts an optional `casterId`.
// When the spell's caster IS the GoI caster who owns a barrier
// (casterId === barrier center's id), that barrier provides NO
// protection — the spell is "cast from inside the barrier". This means
// the GoI caster's own AoE spells now correctly affect allies (and
// enemies) standing within the GoI radius.
//
// Scope (per handover): only the identity case (caster === GoI caster)
// is handled. The broader RAW reading — any combatant within the 10-ft
// radius counts as "inside" — is a documented follow-up; the existing
// sessions 77-79 AoE test suite positions external attackers within
// 10 ft of GoI-protected targets and asserts protection still applies.
//
// Run: npx ts-node --transpile-only src/test/session81_goi_caster_inside.test.ts
// ============================================================

import { Combatant, Action, PlayerResources, Condition, ActiveEffect } from '../types/core';
import { isProtectedByGoI, filterGoIProtectedTargets } from '../engine/spell_effects';
import { execute as fbExecute } from '../spells/fireball';
import { EngineState } from '../engine/combat';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Shared helpers -----------------------------------------

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 1000, currentHP: 1000, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 1, con: 10, int: 10, wis: 16, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set<Condition>(),
    aiProfile: 'smart',
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
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
    width: 60, height: 60, depth: 5,
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
  } as any;
}

function withSlots(slots: { [level: number]: { max: number; remaining: number } }): PlayerResources {
  return { spellSlots: slots };
}

/** Construct a GoI ActiveEffect owned by `ownerId` with the given blockThreshold. */
function makeGoIEffect(blockThreshold: number, ownerId: string, sourceSlotLevel: number = 6): ActiveEffect {
  return {
    id: `eff_goi_${ownerId}_${blockThreshold}`,
    casterId: ownerId,
    spellName: 'Globe of Invulnerability',
    effectType: 'spell_shield',
    sourceSlotLevel,
    sourceIsConcentration: true,
    payload: { blockThreshold },
  } as ActiveEffect;
}

const FIREBALL_ACTION: Action = {
  name: 'Fireball', isMultiattack: false, attackType: 'save',
  reach: 5, range: { normal: 150, long: 150 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
  requiresConcentration: false, slotLevel: 3, costType: 'action',
  legendaryCost: 0, description: 'Fireball',
};

// ============================================================
// Phase 1 — isProtectedByGoI: caster IS the GoI caster (self-GoI)
// ============================================================

console.log('\n=== Phase 1 — isProtectedByGoI: caster === GoI caster (self-GoI) ===\n');

{
  // 1a. GoI caster's own barrier provides NO protection against their own spell.
  //     (Target = the GoI caster themselves; casterId = GoI caster.)
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const bf = makeBF([goiCaster]);

  // Without casterId (backward compat): protected (old behavior).
  eq('1a. No casterId: GoI caster protected from L3', isProtectedByGoI(goiCaster, 3, bf), true);
  // With casterId === GoI caster: NOT protected (caster inside own barrier).
  eq('1a. casterId=GoI caster: NOT protected from L3', isProtectedByGoI(goiCaster, 3, bf, 'goiCaster'), false);
  // L6 penetrates threshold 5 regardless.
  eq('1a. casterId=GoI caster: L6 penetrates (not protected)', isProtectedByGoI(goiCaster, 6, bf, 'goiCaster'), false);
}

{
  // 1b. An ALLY within the GoI caster's 10-ft radius is NOT protected when the
  //     GoI caster is the attacker (caster is inside the barrier).
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });  // 5 ft away
  const bf = makeBF([goiCaster, ally]);

  // External attacker: ally protected.
  eq('1b. External attacker: ally protected from L3', isProtectedByGoI(ally, 3, bf, 'enemyCaster'), true);
  // GoI caster attacker: ally NOT protected.
  eq('1b. GoI caster attacker: ally NOT protected from L3', isProtectedByGoI(ally, 3, bf, 'goiCaster'), false);
  // No casterId (backward compat): ally protected.
  eq('1b. No casterId (backward compat): ally protected from L3', isProtectedByGoI(ally, 3, bf), true);
}

{
  // 1c. An ENEMY within the GoI caster's 10-ft radius is also NOT protected
  //     when the GoI caster is the attacker. PHB p.245 protects ALL creatures
  //     within the barrier from OUTSIDE spells — but the GoI caster's own
  //     spell is from inside, so it affects everyone in the radius.
  const goiCaster = makeCombatant('goiCaster', {
    faction: 'party',
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const enemy = makeCombatant('enemy', {
    faction: 'enemy',
    pos: { x: 6, y: 5, z: 0 },  // 5 ft away, inside radius
  });
  const bf = makeBF([goiCaster, enemy]);

  eq('1c. GoI caster attacker: enemy in radius NOT protected from L3', isProtectedByGoI(enemy, 3, bf, 'goiCaster'), false);
  eq('1c. External attacker: enemy in radius protected from L3', isProtectedByGoI(enemy, 3, bf, 'external'), true);
}

// ============================================================
// Phase 2 — isProtectedByGoI: casterId !== GoI caster (backward compat)
// ============================================================

console.log('\n=== Phase 2 — isProtectedByGoI: external attacker still blocked ===\n');

{
  // 2a. An external attacker (not the GoI caster) is still blocked, whether or
  //     not casterId is supplied — as long as casterId !== GoI caster.
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([goiCaster, ally]);

  eq('2a. External casterId: ally protected from L3', isProtectedByGoI(ally, 3, bf, 'someoneElse'), true);
  eq('2a. External casterId: ally NOT protected from L6 (penetrates)', isProtectedByGoI(ally, 6, bf, 'someoneElse'), false);
  eq('2a. External casterId: cantrip (L0) never blocked', isProtectedByGoI(ally, 0, bf, 'someoneElse'), false);
}

{
  // 2b. casterId refers to a combatant NOT in the battlefield → treated as
  //     outside (no spatial match possible). Protection applies normally.
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([goiCaster, ally]);

  eq('2b. casterId not in bf: ally protected from L3', isProtectedByGoI(ally, 3, bf, 'absentCaster'), true);
}

// ============================================================
// Phase 3 — filterGoIProtectedTargets: GoI caster's own AoE
// ============================================================

console.log('\n=== Phase 3 — filterGoIProtectedTargets: GoI caster is attacker ===\n');

{
  // 3a. GoI caster casts AoE; allies within the GoI radius are NOT filtered.
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const allyNear = makeCombatant('allyNear', { pos: { x: 5, y: 6, z: 0 } });   // 5 ft (inside radius)
  const allyFar = makeCombatant('allyFar', { pos: { x: 20, y: 20, z: 0 } });   // far (outside radius)
  const bf = makeBF([goiCaster, allyNear, allyFar]);

  const targets = [goiCaster, allyNear, allyFar];
  const filtered = filterGoIProtectedTargets(targets, 3, 'goiCaster', bf);
  const ids = filtered.map(t => t.id);

  // All three retained: caster (self), allyNear (caster inside barrier), allyFar (outside radius).
  assert('3a. GoI caster retained (own spell)', ids.includes('goiCaster'));
  assert('3a. Ally near retained (Session 81: caster inside barrier)', ids.includes('allyNear'));
  assert('3a. Ally far retained (outside radius anyway)', ids.includes('allyFar'));
  eq('3a. No targets filtered out', filtered.length, 3);
}

{
  // 3b. External attacker casts AoE; allies within the GoI radius ARE filtered
  //     (backward compat / unchanged behavior).
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const allyNear = makeCombatant('allyNear', { pos: { x: 5, y: 6, z: 0 } });
  const allyFar = makeCombatant('allyFar', { pos: { x: 20, y: 20, z: 0 } });
  const bf = makeBF([goiCaster, allyNear, allyFar]);

  const targets = [goiCaster, allyNear, allyFar];
  const filtered = filterGoIProtectedTargets(targets, 3, 'enemyCaster', bf);
  const ids = filtered.map(t => t.id);

  // enemyCaster is not the GoI caster → GoI caster & allyNear filtered out.
  assert('3b. GoI caster filtered (external attacker)', !ids.includes('goiCaster'));
  assert('3b. Ally near filtered (external attacker)', !ids.includes('allyNear'));
  assert('3b. Ally far retained (outside radius)', ids.includes('allyFar'));
  eq('3b. Only ally far remains', filtered.length, 1);
}

{
  // 3c. Cantrip (level 0): never filtered, regardless of who casts.
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const allyNear = makeCombatant('allyNear', { pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([goiCaster, allyNear]);

  const filtered = filterGoIProtectedTargets([goiCaster, allyNear], 0, 'enemyCaster', bf);
  eq('3c. Cantrip: both retained (never blocked)', filtered.length, 2);
}

{
  // 3d. Penetrating level (L6 vs threshold 5): not filtered regardless of caster.
  const goiCaster = makeCombatant('goiCaster', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const allyNear = makeCombatant('allyNear', { pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([goiCaster, allyNear]);

  const filtered = filterGoIProtectedTargets([allyNear], 6, 'enemyCaster', bf);
  eq('3d. L6 penetrates threshold 5: ally retained (external attacker)', filtered.length, 1);
}

// ============================================================
// Phase 4 — Multiple GoI casters (mixed inside/outside)
// ============================================================

console.log('\n=== Phase 4 — Multiple GoI casters ===\n');

{
  // 4a. Two GoI casters (A and B). The attacker is A. An ally stands within
  //     BOTH radii. Barrier A provides no protection (caster inside A), but
  //     barrier B DOES (caster A is outside B — A !== B). So the ally is
  //     still protected (by B).
  const goiA = makeCombatant('goiA', {
    pos: { x: 3, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiA')],
  });
  const goiB = makeCombatant('goiB', {
    pos: { x: 7, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiB')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 5, z: 0 } });  // 2 squares from each
  const bf = makeBF([goiA, goiB, ally]);

  // Attacker = goiA. Ally within A's radius (caster inside A → A no protection)
  // AND within B's radius (caster outside B → B protects).
  eq('4a. Attacker goiA: ally protected (by goiB, not goiA)', isProtectedByGoI(ally, 3, bf, 'goiA'), true);

  // Attacker = goiB: symmetric — protected by goiA.
  eq('4a. Attacker goiB: ally protected (by goiA, not goiB)', isProtectedByGoI(ally, 3, bf, 'goiB'), true);

  // Attacker = external: protected by both.
  eq('4a. External attacker: ally protected (by both)', isProtectedByGoI(ally, 3, bf, 'external'), true);
}

{
  // 4b. Two GoI casters (A and B). Attacker is A. Ally within ONLY A's radius
  //     (not B's). Barrier A provides no protection (caster inside), ally is
  //     not within B → NOT protected at all.
  const goiA = makeCombatant('goiA', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiA')],
  });
  const goiB = makeCombatant('goiB', {
    pos: { x: 30, y: 30, z: 0 },  // far away
    activeEffects: [makeGoIEffect(5, 'goiB')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });  // only within A's radius
  const bf = makeBF([goiA, goiB, ally]);

  eq('4b. Attacker goiA: ally NOT protected (only A covers, caster inside A)', isProtectedByGoI(ally, 3, bf, 'goiA'), false);
}

// ============================================================
// Phase 5 — Fireball integration (end-to-end via execute())
// ============================================================

console.log('\n=== Phase 5 — Fireball integration: GoI caster is attacker ===\n');

{
  // 5a. GoI caster casts Fireball (L3). Ally within GoI radius takes damage
  //     (Session 81 fix); a far-away enemy also takes damage. Slot is consumed.
  const goiCaster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [FIREBALL_ACTION],
    resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    int: 20,
    activeEffects: [makeGoIEffect(5, 'wiz')],
  });
  const allyNear = makeCombatant('allyNear', {
    faction: 'party', dex: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const enemyFar = makeCombatant('enemyFar', {
    faction: 'enemy', dex: 1, pos: { x: 10, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([goiCaster, allyNear, enemyFar]);
  const state = makeState(bf);

  const hpAllyBefore = allyNear.currentHP;
  const hpEnemyBefore = enemyFar.currentHP;
  const slotsBefore = goiCaster.resources!.spellSlots![3].remaining;

  fbExecute(goiCaster, [goiCaster, allyNear, enemyFar], state);

  const hpAllyDelta = hpAllyBefore - allyNear.currentHP;
  const hpEnemyDelta = hpEnemyBefore - enemyFar.currentHP;
  const slotsDelta = slotsBefore - goiCaster.resources!.spellSlots![3].remaining;

  // Session 81: ally within GoI radius takes damage (caster is the GoI caster).
  assert('5a. Ally near GoI takes damage (Session 81 fix)', hpAllyDelta > 0);
  // Far enemy takes damage (outside GoI radius, no protection anyway).
  assert('5a. Enemy far takes damage', hpEnemyDelta > 0);
  // Slot consumed.
  eq('5a. Fireball slot consumed (1 slot)', slotsDelta, 1);
}

{
  // 5b. External attacker casts Fireball (L3) at a cluster including a GoI
  //     caster and an ally within the GoI radius. Both GoI caster and ally
  //     are filtered out (take 0 damage) — backward compat / unchanged.
  // Session 87: caster re-positioned to (4,0,0) — outside GoI 10-ft radius
  // (broader RAW reading: caster within 10 ft of GoI center would be "inside").
  const goiCaster = makeCombatant('goiTarget', {
    faction: 'enemy', dex: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
    activeEffects: [makeGoIEffect(5, 'goiTarget')],
  });
  const allyNear = makeCombatant('allyNear', {
    faction: 'enemy', dex: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const enemyFar = makeCombatant('enemyFar', {
    faction: 'enemy', dex: 1, pos: { x: 10, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 4, y: 0, z: 0 },
    actions: [FIREBALL_ACTION],
    resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    int: 20,
  });
  const bf = makeBF([caster, goiCaster, allyNear, enemyFar]);
  const state = makeState(bf);

  const hpGoiBefore = goiCaster.currentHP;
  const hpAllyBefore = allyNear.currentHP;
  const hpEnemyBefore = enemyFar.currentHP;

  fbExecute(caster, [goiCaster, allyNear, enemyFar], state);

  // External attacker → GoI caster & ally within radius filtered (0 damage).
  eq('5b. GoI caster takes 0 damage (external attacker)', hpGoiBefore - goiCaster.currentHP, 0);
  eq('5b. Ally near GoI takes 0 damage (external attacker)', hpAllyBefore - allyNear.currentHP, 0);
  // Far enemy takes damage.
  assert('5b. Enemy far takes damage', (hpEnemyBefore - enemyFar.currentHP) > 0);
}

// ============================================================
// Phase 6 — Metadata flag
// ============================================================

console.log('\n=== Phase 6 — Metadata flag ===\n');

{
  const meta = require('../spells/globe_of_invulnerability').metadata;
  eq('6a. globeOfInvulnerabilityCasterInsideV1Implemented = true', meta.globeOfInvulnerabilityCasterInsideV1Implemented, true);
  // Prior flags unchanged.
  eq('6b. globeOfInvulnerabilityImplemented still true', meta.globeOfInvulnerabilityImplemented, true);
  eq('6c. globeOfInvulnerabilityRadiusV1Implemented still true', meta.globeOfInvulnerabilityRadiusV1Implemented, true);
  eq('6d. globeOfInvulnerabilityAoEV1Simplified still false', meta.globeOfInvulnerabilityAoEV1Simplified, false);
}

// ============================================================
// Phase 7 — Source-code presence checks
// ============================================================

console.log('\n=== Phase 7 — Source-code presence checks ===\n');

{
  // 7a. isProtectedByGoI accepts the casterId parameter (4th arg).
  const spellEffectsSrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'engine', 'spell_effects.ts'), 'utf8',
  );
  assert('7a. isProtectedByGoI signature includes casterId',
    /export function isProtectedByGoI\(\s*target: Combatant,\s*castLevel: number,\s*bf\?: Battlefield,\s*casterId\?: string,/.test(spellEffectsSrc));

  // 7b. filterGoIProtectedTargets forwards casterId to isProtectedByGoI.
  assert('7b. filterGoIProtectedTargets forwards casterId',
    spellEffectsSrc.includes('isProtectedByGoI(t, castLevel, bf, casterId)'));

  // 7c. combat.ts single-target pre-dispatch passes actor.id as casterId.
  const combatSrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'engine', 'combat.ts'), 'utf8',
  );
  assert('7c. combat.ts single-target GoI check passes actor.id as casterId',
    combatSrc.includes('isProtectedByGoI(goiTarget, spellInfo.level, bf, actor.id)'));
}

// ============================================================
// Results
// ============================================================

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n❌ SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('\nAll tests passed ✅');
}
