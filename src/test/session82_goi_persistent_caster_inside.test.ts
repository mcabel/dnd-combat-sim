// ============================================================
// Test: Session 82 — GoI persistent damage-zone tick caster-inside
//
// Session 81 introduced the `casterId` param on isProtectedByGoI() so
// that when the spell's caster IS the GoI caster, the barrier provides
// no protection (spell cast from inside the barrier). That fix was
// applied to filterGoIProtectedTargets (instantaneous AoE on-cast) and
// the combat.ts single-target pre-dispatch check.
//
// Session 82 extends the same fix to the PERSISTENT damage-zone paths:
//   1. combat.ts damage_zone tick loop — now passes zone.casterId
//   2. 18 per-spell on-cast goiBlocked sites — now pass caster.id
//
// This makes persistent-zone behavior consistent with instantaneous-AoE
// behavior: if the zone's caster has their own GoI, allies within the
// GoI radius are NOT protected from the zone's damage (on-cast or tick).
//
// Scope (same as Session 81): only the identity case (zone caster ===
// GoI caster) is handled. The broader spatial case (any combatant within
// the 10-ft radius) is a documented follow-up.
//
// Run: npx ts-node --transpile-only src/test/session82_goi_persistent_caster_inside.test.ts
// ============================================================

import { Combatant, Action, PlayerResources, Condition, ActiveEffect } from '../types/core';
import { isProtectedByGoI } from '../engine/spell_effects';
import { execute as codExecute } from '../spells/cloud_of_daggers';
import { execute as mbExecute } from '../spells/moonbeam';
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

/** GoI effect owned by `ownerId` (the combatant who cast GoI). */
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

const CLOUD_ACTION: Action = {
  name: 'Cloud of Daggers', isMultiattack: false, attackType: null,
  reach: 5, range: { normal: 60, long: 60 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: null, saveAbility: null, isAoE: true, isControl: true,
  requiresConcentration: true, slotLevel: 2, costType: 'action',
  legendaryCost: 0, description: 'Cloud of Daggers',
};

const MOONBEAM_ACTION: Action = {
  name: 'Moonbeam', isMultiattack: false, attackType: 'save',
  reach: 5, range: { normal: 60, long: 60 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'con', isAoE: true, isControl: true,
  requiresConcentration: true, slotLevel: 2, costType: 'action',
  legendaryCost: 0, description: 'Moonbeam',
};

// ============================================================
// Phase 1 — isProtectedByGoI: persistent zone caster === GoI caster
// ============================================================

console.log('\n=== Phase 1 — isProtectedByGoI: zone caster === GoI caster ===\n');

{
  // Caster has own GoI. An ally within the GoI radius would be protected
  // from an EXTERNAL caster's spell, but NOT from the GoI caster's own
  // persistent zone (the zone is "cast from inside the barrier").
  const goiCaster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'wiz')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });  // 5 ft, inside GoI radius
  const bf = makeBF([goiCaster, ally]);

  // External caster → ally protected.
  eq('1a. External caster: ally protected', isProtectedByGoI(ally, 3, bf, 'enemyCaster'), true);
  // Zone caster = GoI caster → ally NOT protected (caster inside own barrier).
  eq('1b. Zone caster = GoI caster: ally NOT protected', isProtectedByGoI(ally, 3, bf, 'wiz'), false);
}

// ============================================================
// Phase 2 — Cloud of Daggers on-cast: caster has own GoI
// ============================================================

console.log('\n=== Phase 2 — Cloud of Daggers on-cast: zone caster has own GoI ===\n');

{
  // Caster has own GoI (L6, threshold 5). Cloud of Daggers is L2 (≤5, would be
  // blocked by GoI for an external caster). Ally is within the GoI radius AND
  // is the Cloud of Daggers target. Session 82 fix: the on-cast damage is NOT
  // blocked (zone caster === GoI caster → barrier skipped).
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 5, y: 5, z: 0 },
    actions: [CLOUD_ACTION], resources: withSlots({ 2: { max: 2, remaining: 2 } }),
    cha: 20,
    activeEffects: [makeGoIEffect(5, 'wiz')],
  });
  const ally = makeCombatant('ally', {
    faction: 'party', pos: { x: 5, y: 6, z: 0 },  // 5 ft from caster, inside GoI radius
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);
  const hpBefore = ally.currentHP;

  codExecute(caster, ally, state);

  const hpDelta = hpBefore - ally.currentHP;
  // Session 82 fix: on-cast damage NOT blocked (caster inside own GoI).
  assert('2a. Ally takes on-cast damage (Session 82: zone caster === GoI caster)', hpDelta > 0);
}

{
  // Control: external caster (no GoI) targets an ally who IS inside a GoI
  // caster's radius. The ally IS protected (external caster → GoI blocks).
  const goiCaster = makeCombatant('goiCaster', {
    faction: 'party', pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'goiCaster')],
  });
  const externalCaster = makeCombatant('extWiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [CLOUD_ACTION], resources: withSlots({ 2: { max: 2, remaining: 2 } }),
    cha: 20,
  });
  const ally = makeCombatant('ally', {
    faction: 'party', pos: { x: 5, y: 6, z: 0 },  // inside goiCaster's GoI radius
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([goiCaster, externalCaster, ally]);
  const state = makeState(bf);
  const hpBefore = ally.currentHP;

  codExecute(externalCaster, ally, state);

  const hpDelta = hpBefore - ally.currentHP;
  // External caster → GoI blocks on-cast damage (ally protected).
  eq('2b. External caster: ally takes 0 on-cast damage (GoI-protected)', hpDelta, 0);
}

// ============================================================
// Phase 3 — Moonbeam on-cast: caster has own GoI
// ============================================================

console.log('\n=== Phase 3 — Moonbeam on-cast: zone caster has own GoI ===\n');

{
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 5, y: 5, z: 0 },
    actions: [MOONBEAM_ACTION], resources: withSlots({ 2: { max: 2, remaining: 2 } }),
    cha: 20,
    activeEffects: [makeGoIEffect(5, 'wiz')],
  });
  const ally = makeCombatant('ally', {
    faction: 'party', pos: { x: 5, y: 6, z: 0 },
    maxHP: 1000, currentHP: 1000, con: 1,  // fails CON save
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);
  const hpBefore = ally.currentHP;

  mbExecute(caster, ally, state);

  const hpDelta = hpBefore - ally.currentHP;
  assert('3a. Ally takes Moonbeam on-cast damage (Session 82: zone caster === GoI caster)', hpDelta > 0);
}

// ============================================================
// Phase 4 — Source-presence: combat.ts tick loop passes zone.casterId
// ============================================================

console.log('\n=== Phase 4 — Source-presence: combat.ts tick loop ===\n');

{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine', 'combat.ts'), 'utf8');

  // The damage_zone tick loop must pass zone.casterId as the 4th arg.
  assert('4a. combat.ts tick loop passes zone.casterId to isProtectedByGoI',
    src.includes('isProtectedByGoI(actor, zoneSlotLevel, state.battlefield, zone.casterId)'));
}

// ============================================================
// Phase 5 — Source-presence: all 18 per-spell sites pass caster.id
// ============================================================

console.log('\n=== Phase 5 — Source-presence: 18 per-spell goiBlocked sites ===\n');

{
  const fs = require('fs');
  const path = require('path');

  // The 18 persistent-zone spells that have the per-spell goiBlocked check.
  const spells = [
    'call_lightning', 'cloud_of_daggers', 'cloudkill', 'dawn', 'death_armor',
    'dust_devil', 'evards_black_tentacles', 'flaming_sphere', 'hunger_of_hadar',
    'incendiary_cloud', 'insect_plague', 'maelstrom', 'moonbeam', 'spike_growth',
    'spirit_guardians', 'storm_of_vengeance', 'wall_of_fire', 'wall_of_ice',
  ];

  let allPass = true;
  const missing: string[] = [];
  for (const s of spells) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'spells', `${s}.ts`), 'utf8');
    const has = src.includes('isProtectedByGoI(target, slotLevel, state.battlefield, caster.id)');
    if (!has) { missing.push(s); allPass = false; }
  }
  eq('5a. All 18 per-spell sites pass caster.id (count)', spells.length, 18);
  assert('5b. All 18 per-spell sites pass caster.id (none missing)', allPass,
    missing.length ? `missing: ${missing.join(', ')}` : '');

  // No per-spell site should still use the old 3-arg form.
  let oldFormCount = 0;
  for (const s of spells) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'spells', `${s}.ts`), 'utf8');
    // Match the old form: isProtectedByGoI(target, slotLevel, state.battlefield) NOT followed by a comma
    if (/isProtectedByGoI\(target, slotLevel, state\.battlefield\)/.test(src) &&
        !/isProtectedByGoI\(target, slotLevel, state\.battlefield, caster\.id\)/.test(src)) {
      oldFormCount++;
    }
  }
  eq('5c. No per-spell site uses old 3-arg form', oldFormCount, 0);
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
