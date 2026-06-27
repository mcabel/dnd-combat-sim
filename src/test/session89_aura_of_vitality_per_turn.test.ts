// ============================================================
// Test: Session 89 — Aura of Vitality per-turn re-heal (PHB p.216)
//
// PHB p.216: "Healing energy radiates from you in an aura with a 30-foot
// radius. Until the spell ends, the aura moves with you, centered on you.
// You can use a bonus action to cause one creature in the aura (including
// you) to regain 2d6 hit points."
//
// Prior state: v1 simplified the spell to an initial 3-ally burst on cast
// (2d6 each). Per-turn re-heal was NOT modelled — concentration persisted
// but had no further mechanical effect after the initial burst.
//
// Session 89 fix: per-turn re-heal is NOW modelled. At the start of each
// of the caster's subsequent turns, the engine auto-heals the most-wounded
// ally (including self) in the 30-ft aura for 2d6. This mirrors the Eyebite
// pattern (start-of-turn auto-processing, no bonus action cost — v1
// simplification). The initial 3-ally burst on cast is preserved.
//
// This test file validates:
//   - Metadata flags (simplified=false, implemented=true)
//   - shouldCastPulse helper (target selection: most-wounded, in range,
//     full-HP excluded, dead excluded, no allies → null)
//   - executePulse helper (2d6 heal, capped at maxHP, revival on heal,
//     logging)
//   - execute() sets _auraOfVitalityActive flag
//   - Engine integration: full combat with per-turn pulse firing
//   - Concentration break stops the pulse
//   - Source-presence checks
//
// Run: npx ts-node --transpile-only src/test/session89_aura_of_vitality_per_turn.test.ts
// ============================================================

import { Combatant, Action, PlayerResources, Condition, Battlefield } from '../types/core';
import {
  shouldCast,
  execute,
  shouldCastPulse,
  executePulse,
  cleanup,
  metadata,
} from '../spells/aura_of_vitality';
import { runCombat, EngineState } from '../engine/combat';
import { rollDie, applyHeal, startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot } from '../ai/resources';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 3: { max: 2, remaining } } };
}

const AOV_ACTION: Action = {
  name: 'Aura of Vitality',
  costType: 'bonusAction',
  attackType: null,
  isMultiattack: false,
  reach: 5,
  range: { normal: 30, long: 30 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 3,
  legendaryCost: 0,
  description: 'Aura of Vitality (30-ft aura, 2d6 heal/turn, concentration)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 12, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10,
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

function makeBF(combatants: Combatant[]): any {
  return {
    width: 60, height: 60, depth: 1,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  };
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

function makeCleric(pos = { x: 0, y: 0, z: 0 } as any, wis = 16): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    pos,
    wis,
    actions: [AOV_ACTION],
    resources: withSlots(2),
  });
}

// ============================================================
// Phase 1 — Metadata flags
// ============================================================

console.log('\n=== Phase 1 — Metadata flags ===\n');

{
  eq('1a. auraOfVitalityPerTurnRehealV1Simplified is false',
    (metadata as any).auraOfVitalityPerTurnRehealV1Simplified, false);
  eq('1b. auraOfVitalityPerTurnRehealV1Implemented is true',
    (metadata as any).auraOfVitalityPerTurnRehealV1Implemented, true);
  eq('1c. healDie is 6', metadata.healDie, 6);
  eq('1d. healDieCount is 2', metadata.healDieCount, 2);
  eq('1e. rangeFt is 30', metadata.rangeFt, 30);
}

// ============================================================
// Phase 2 — shouldCastPulse helper
// ============================================================

console.log('\n=== Phase 2 — shouldCastPulse helper ===\n');

{
  // 2a. Most-wounded ally selected (lowest HP%)
  const caster = makeCleric();
  const ally1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 20 });  // 50%
  const ally2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, maxHP: 40, currentHP: 10 });  // 25%
  const bf = makeBF([caster, ally1, ally2]);

  const target = shouldCastPulse(caster, bf);
  eq('2a. Most-wounded ally selected (a2 at 25%)', target?.id, 'a2');
}

{
  // 2b. Self included when wounded
  const caster = makeCleric();
  caster.currentHP = 5; caster.maxHP = 40;  // 12.5% — most wounded
  const ally = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 20 });  // 50%
  const bf = makeBF([caster, ally]);

  const target = shouldCastPulse(caster, bf);
  eq('2b. Self selected when most wounded', target?.id, 'cleric1');
}

{
  // 2c. Full-HP allies excluded
  const caster = makeCleric();
  const fullAlly = makeCombatant('full', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 40 });
  const wounded = makeCombatant('wounded', { pos: { x: 2, y: 0, z: 0 }, maxHP: 40, currentHP: 15 });
  const bf = makeBF([caster, fullAlly, wounded]);

  const target = shouldCastPulse(caster, bf);
  eq('2c. Full-HP excluded; wounded selected', target?.id, 'wounded');
}

{
  // 2d. Out-of-range ally excluded (> 30 ft)
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const farAlly = makeCombatant('far', { pos: { x: 7, y: 0, z: 0 }, maxHP: 40, currentHP: 5 });  // 35 ft
  const bf = makeBF([caster, farAlly]);

  const target = shouldCastPulse(caster, bf);
  eq('2d. Out-of-range ally → null', target, null);
}

{
  // 2e. Dead allies excluded
  const caster = makeCleric();
  const deadAlly = makeCombatant('dead', {
    pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 0, isDead: true,
  });
  const wounded = makeCombatant('wounded', { pos: { x: 2, y: 0, z: 0 }, maxHP: 40, currentHP: 15 });
  const bf = makeBF([caster, deadAlly, wounded]);

  const target = shouldCastPulse(caster, bf);
  eq('2e. Dead ally excluded; wounded selected', target?.id, 'wounded');
}

{
  // 2f. No wounded allies → null
  const caster = makeCleric();
  const fullAlly = makeCombatant('full', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, fullAlly]);

  const target = shouldCastPulse(caster, bf);
  eq('2f. No wounded allies → null', target, null);
}

{
  // 2g. Tie-break by closest (same HP%)
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const near = makeCombatant('near', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 20 });  // 50%, 5 ft
  const far = makeCombatant('far', { pos: { x: 4, y: 0, z: 0 }, maxHP: 40, currentHP: 20 });   // 50%, 20 ft
  const bf = makeBF([caster, near, far]);

  const target = shouldCastPulse(caster, bf);
  eq('2g. Tie-break by closest (near at 5 ft)', target?.id, 'near');
}

// ============================================================
// Phase 3 — executePulse helper
// ============================================================

console.log('\n=== Phase 3 — executePulse helper ===\n');

{
  // 3a. Heals 2d6 (range 2-12)
  const caster = makeCleric();
  const ally = makeCombatant('ally', { pos: { x: 1, y: 0, z: 0 }, maxHP: 100, currentHP: 5 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  executePulse(caster, ally, state);

  const healed = ally.currentHP - 5;
  assert('3a. Ally healed by 2-12 HP (2d6)', healed >= 2 && healed <= 12, `healed: ${healed}`);
}

{
  // 3b. Capped at maxHP
  const caster = makeCleric();
  const ally = makeCombatant('ally', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 38 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  executePulse(caster, ally, state);

  eq('3b. Heal capped at maxHP', ally.currentHP, 40);
}

{
  // 3c. Heal event logged
  const caster = makeCleric();
  const ally = makeCombatant('ally', { pos: { x: 1, y: 0, z: 0 }, maxHP: 100, currentHP: 5 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  executePulse(caster, ally, state);

  const healEvent = state.log.events.find((e: any) =>
    e.type === 'heal' && e.actorId === 'cleric1' && e.targetId === 'ally'
  );
  assert('3c. Heal event logged', healEvent !== undefined);
  assert('3c. Heal event mentions "Aura of Vitality pulse"',
    healEvent?.description?.includes('Aura of Vitality pulse'));
}

{
  // 3d. No slot consumed (pulse is free — slot was consumed on cast)
  const caster = makeCleric();
  caster.resources = withSlots(1);
  const ally = makeCombatant('ally', { pos: { x: 1, y: 0, z: 0 }, maxHP: 100, currentHP: 5 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const slotsBefore = caster.resources!.spellSlots![3].remaining;
  executePulse(caster, ally, state);
  const slotsAfter = caster.resources!.spellSlots![3].remaining;

  eq('3d. No slot consumed by pulse', slotsAfter, slotsBefore);
}

{
  // 3e. Dead ally not healed (guard)
  const caster = makeCleric();
  const deadAlly = makeCombatant('dead', {
    pos: { x: 1, y: 0, z: 0 }, maxHP: 100, currentHP: 0, isDead: true,
  });
  const bf = makeBF([caster, deadAlly]);
  const state = makeState(bf);

  executePulse(caster, deadAlly, state);

  eq('3e. Dead ally HP unchanged', deadAlly.currentHP, 0);
  const healEvent = state.log.events.find((e: any) => e.type === 'heal' && e.targetId === 'dead');
  assert('3e. No heal event for dead ally', healEvent === undefined);
}

// ============================================================
// Phase 4 — execute() sets _auraOfVitalityActive flag
// ============================================================

console.log('\n=== Phase 4 — execute() sets _auraOfVitalityActive ===\n');

{
  // 4a. Flag set after execute()
  const caster = makeCleric();
  const ally = makeCombatant('ally', { pos: { x: 1, y: 0, z: 0 }, maxHP: 100, currentHP: 5 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  assert('4a. Flag NOT set before execute()', !caster._auraOfVitalityActive);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  assert('4a. Flag IS set after execute()', caster._auraOfVitalityActive !== undefined);
  if (caster._auraOfVitalityActive) {
    eq('4a. Flag healDie = 6', caster._auraOfVitalityActive.healDie, 6);
    eq('4a. Flag healDieCount = 2', caster._auraOfVitalityActive.healDieCount, 2);
    eq('4a. Flag rangeFt = 30', caster._auraOfVitalityActive.rangeFt, 30);
  }
}

// ============================================================
// Phase 5 — Engine integration: per-turn pulse fires in runCombat
// ============================================================

console.log('\n=== Phase 5 — Engine integration (runCombat) ===\n');

{
  // 5a. Full combat: cleric casts Aura of Vitality on turn 1, then on
  //     subsequent turns the per-turn pulse fires (healing the most-wounded
  //     ally). We verify by checking that more than the initial-burst heal
  //     events appear in the log.
  //
  // Setup: cleric (party) vs 1 enemy (enemy faction). The cleric has Aura
  // of Vitality. 2 wounded allies (party faction) stand within 30 ft.
  // The cleric will cast Aura of Vitality on turn 1 (initial burst heals
  // up to 3 allies), then on turn 2+ the pulse heals 1 ally/turn.
  //
  // To force the cleric to cast Aura of Vitality (not attack), we give
  // them no attack action — only Aura of Vitality. The enemy is weak so
  // combat lasts multiple rounds.
  const cleric = makeCombatant('cleric', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [AOV_ACTION],
    resources: withSlots(2),
    wis: 16,
    maxHP: 100, currentHP: 100,
    ac: 18,  // high AC so enemy misses
  });
  // Wounded allies within 30 ft
  const ally1 = makeCombatant('ally1', {
    faction: 'party',
    pos: { x: 1, y: 0, z: 0 },
    maxHP: 100, currentHP: 10,  // wounded
    ac: 18,
  });
  const ally2 = makeCombatant('ally2', {
    faction: 'party',
    pos: { x: 2, y: 0, z: 0 },
    maxHP: 100, currentHP: 20,  // wounded
    ac: 18,
  });
  // Weak enemy — won't hit the high-AC party
  const enemy = makeCombatant('enemy', {
    faction: 'enemy',
    pos: { x: 10, y: 0, z: 0 },
    maxHP: 200, currentHP: 200,  // tanky so combat lasts
    ac: 10,
    str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1,
    actions: [{
      name: 'Attack', isMultiattack: false, attackType: 'melee',
      reach: 5, range: { normal: 5, long: 5 },
      hitBonus: 0, damage: { count: 1, sides: 4, bonus: 0, average: 2 },
      damageType: 'slashing', isAoE: false, isControl: false,
      requiresConcentration: false, slotLevel: 0, costType: 'action',
      legendaryCost: 0, description: 'Attack',
      saveDC: null, saveAbility: null, noCantripScaling: false,
    }],
    speed: 30,
  });

  const bf = makeBF([cleric, ally1, ally2, enemy]);

  // Run 3 rounds (enough for initial burst + 2 pulses)
  const log = runCombat(bf, [cleric.id, ally1.id, ally2.id, enemy.id], { verbose: false, maxRounds: 3 });

  // Count pulse heal events (distinct from initial burst)
  const pulseEvents = log.events.filter((e: any) =>
    e.type === 'heal' && typeof e.description === 'string' &&
    e.description.includes('Aura of Vitality pulse')
  );
  const initialBurstEvents = log.events.filter((e: any) =>
    e.type === 'heal' && typeof e.description === 'string' &&
    e.description.includes('Aura of Vitality:') && !e.description.includes('pulse')
  );

  // Initial burst should have fired on turn 1 (up to 3 allies)
  assert('5a. Initial burst heal events exist', initialBurstEvents.length > 0);
  // Per-turn pulse should have fired on turn 2 and/or 3
  assert('5a. Per-turn pulse heal events exist (turn 2+)', pulseEvents.length > 0,
    `got ${pulseEvents.length} pulse events`);
}

{
  // 5b. Concentration break stops the pulse. If the cleric takes damage and
  //     fails the concentration save, the pulse stops firing on subsequent
  //     turns. We verify by checking that no pulse events appear after
  //     concentration breaks.
  //
  // Setup: cleric (wounded, low CON) vs 1 enemy (high hitBonus, high damage).
  // No allies — the enemy has no choice but to attack the cleric. The cleric
  // casts Aura of Vitality on turn 1 (initial burst heals self). The enemy
  // then hits the cleric, forcing a concentration save. With CON 1 (mod -4)
  // and DC 10+, concentration breaks ~65% of the time per hit. We use a
  // retry loop to handle the probabilistic save.
  let pulseStopsVerified = false;
  for (let attempt = 0; attempt < 20 && !pulseStopsVerified; attempt++) {
    const cleric = makeCombatant('cleric', {
      faction: 'party',
      pos: { x: 0, y: 0, z: 0 },
      actions: [AOV_ACTION],
      resources: withSlots(1),
      wis: 16,
      con: 1,  // minimum CON → concentration save fails easily (mod -4)
      maxHP: 100, currentHP: 50,  // wounded (so Aura of Vitality heals self)
      ac: 5,  // very low AC → enemy hits easily
    });
    // Enemy with high hitBonus (guarantees hit) and moderate damage (forces conc save)
    const enemy = makeCombatant('enemy', {
      faction: 'enemy',
      pos: { x: 0, y: 1, z: 0 },  // adjacent to cleric
      maxHP: 200, currentHP: 200,
      ac: 18,
      str: 20, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      actions: [{
        name: 'Attack', isMultiattack: false, attackType: 'melee',
        reach: 5, range: { normal: 5, long: 5 },
        hitBonus: 20,  // guaranteed hit
        damage: { count: 3, sides: 6, bonus: 10, average: 20 },  // DC 10+
        damageType: 'slashing', isAoE: false, isControl: false,
        requiresConcentration: false, slotLevel: 0, costType: 'action',
        legendaryCost: 0, description: 'Attack',
        saveDC: null, saveAbility: null, noCantripScaling: false,
      }],
      speed: 30,
    });

    const bf = makeBF([cleric, enemy]);

    const log = runCombat(bf, [cleric.id, enemy.id], { verbose: false, maxRounds: 5 });

    // Check if concentration broke (damage-induced: "loses concentration",
    // incapacitation-induced: "concentration ... breaks")
    const concBreak = log.events.find((e: any) =>
      e.type === 'condition_remove' && typeof e.description === 'string' &&
      e.description.includes('concentration') &&
      (e.description.includes('loses') || e.description.includes('breaks'))
    );

    if (concBreak) {
      // Find the round concentration broke
      const breakRound = concBreak.round;

      // Check pulse events AFTER the break round
      const pulsesAfterBreak = log.events.filter((e: any) =>
        e.type === 'heal' && typeof e.description === 'string' &&
        e.description.includes('Aura of Vitality pulse') && e.round > breakRound
      );

      assert('5b. No pulse events after concentration break', pulsesAfterBreak.length === 0,
        `got ${pulsesAfterBreak.length} pulses after round ${breakRound}`);
      pulseStopsVerified = true;
    }
  }
  if (!pulseStopsVerified) {
    // If concentration never broke in 20 attempts (very unlikely with con=1
    // and guaranteed hits), at least verify the test ran
    assert('5b. Concentration break scenario (retry loop)', false,
      '20 attempts failed to break concentration');
  }
}

// ============================================================
// Phase 6 — Source-presence checks
// ============================================================

console.log('\n=== Phase 6 — Source-presence checks ===\n');

{
  const fs = require('fs');
  const typesSrc = fs.readFileSync('src/types/core.ts', 'utf8');
  const aovSrc = fs.readFileSync('src/spells/aura_of_vitality.ts', 'utf8');
  const combatSrc = fs.readFileSync('src/engine/combat.ts', 'utf8');

  // Type definition
  assert('6a. core.ts has _auraOfVitalityActive field',
    typesSrc.includes('_auraOfVitalityActive?'));

  // Spell module
  assert('6b. aura_of_vitality.ts exports shouldCastPulse',
    aovSrc.includes('export function shouldCastPulse'));
  assert('6c. aura_of_vitality.ts exports executePulse',
    aovSrc.includes('export function executePulse'));
  assert('6d. aura_of_vitality.ts sets _auraOfVitalityActive in execute()',
    aovSrc.includes('caster._auraOfVitalityActive ='));
  assert('6e. aura_of_vitality.ts has implemented flag',
    aovSrc.includes('auraOfVitalityPerTurnRehealV1Implemented: true'));
  assert('6f. aura_of_vitality.ts has simplified flag set to false',
    aovSrc.includes('auraOfVitalityPerTurnRehealV1Simplified: false'));

  // Engine
  assert('6g. combat.ts imports shouldCastPulseAuraOfVitality',
    combatSrc.includes('shouldCastPulseAuraOfVitality'));
  assert('6h. combat.ts imports executePulseAuraOfVitality',
    combatSrc.includes('executePulseAuraOfVitality'));
  assert('6i. combat.ts has Session 89 per-turn processing',
    combatSrc.includes('Session 89: Aura of Vitality per-turn re-heal'));
  assert('6j. combat.ts checks _auraOfVitalityActive flag',
    combatSrc.includes('actor._auraOfVitalityActive'));
}

// ============================================================
// Summary
// ============================================================

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
