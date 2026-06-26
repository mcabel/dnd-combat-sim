// ============================================================
// Test: Session 79 — GoI AoE exclusion COMPLETION (36 more spells)
//
// This session closes the `globeOfInvulnerabilityAoEV1Simplified: true`
// gap by extending GoI AoE exclusion to ALL remaining ~36 damage AoE
// spells. After this session, the flag is flipped to `false` and the
// partial-implementation flag is removed.
//
// Patterns covered:
//   Phase 1: Pattern A (instantaneous) — circle_of_death, cone_of_cold,
//            chain_lightning (indexed loop), earthquake (auto-hit),
//            flame_strike (dual damage)
//   Phase 2: Pattern B (persistent damage_zone) — cloudkill, insect_plague
//   Phase 3: Pattern B terrain_zone — evards_black_tentacles,
//            sickening_radiance
//   Phase 4: Pattern B single-target persistent — moonbeam, wall_of_fire
//   Phase 5: Metadata flags — globeOfInvulnerabilityAoEV1Simplified=false,
//            globeOfInvulnerabilityAoEPartialV1Implemented=undefined
//   Phase 6: All 36 Session 79 spell files import GoI helpers
//   Phase 7: Caster self-exclusion — circle_of_death + moonbeam
//
// Run: npx ts-node --transpile-only src/test/session79_goi_aoe_completion.test.ts
// ============================================================

import { Combatant, Action, PlayerResources, Condition, ActiveEffect } from '../types/core';
import { isProtectedByGoI, filterGoIProtectedTargets } from '../engine/spell_effects';
import { EngineState } from '../engine/combat';

// Pattern A imports
import { execute as codExecute } from '../spells/circle_of_death';
import { execute as cocExecute } from '../spells/cone_of_cold';
import { execute as clExecute } from '../spells/chain_lightning';
import { execute as eqExecute } from '../spells/earthquake';
import { execute as fsExecute } from '../spells/flame_strike';

// Pattern B persistent damage_zone imports
import { execute as ckExecute } from '../spells/cloudkill';
import { execute as ipExecute } from '../spells/insect_plague';

// Pattern B terrain_zone imports
import { execute as ebtExecute } from '../spells/evards_black_tentacles';
import { execute as srExecute } from '../spells/sickening_radiance';

// Pattern B single-target persistent imports
import { execute as mbExecute } from '../spells/moonbeam';
import { execute as wofExecute } from '../spells/wall_of_fire';

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
    pos: { x: 1, y: 0, z: 0 },
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
    width: 60, height: 60, depth: 1,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
    obstacles: [],
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

/** Construct a GoI ActiveEffect with the given blockThreshold (L6→5, L7→6, etc.). */
function makeGoIEffect(blockThreshold: number, sourceSlotLevel: number = 6): ActiveEffect {
  return {
    id: `eff_goi_${blockThreshold}`,
    casterId: 'self',
    spellName: 'Globe of Invulnerability',
    effectType: 'spell_shield',
    sourceSlotLevel,
    sourceIsConcentration: true,
    payload: { blockThreshold },
  } as ActiveEffect;
}

function makeAction(name: string, saveDC: number, saveAbility: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha' | null, slotLevel: number, range: number = 60): Action {
  return {
    name, isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: range, long: range },
    hitBonus: null, damage: null, damageType: null,
    saveDC, saveAbility, isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel, costType: 'action',
    legendaryCost: 0, description: name,
  } as Action;
}

// Standard actions for each spell (saveDC 25 = auto-fail save → full damage)
const COD_ACTION = makeAction('Circle of Death', 25, 'con', 6, 60);
const COC_ACTION = makeAction('Cone of Cold', 25, 'con', 5, 60);
const CL_ACTION = makeAction('Chain Lightning', 25, null, 6, 150);
const EQ_ACTION = makeAction('Earthquake', 25, null, 8, 50);
const FS_ACTION = makeAction('Flame Strike', 25, 'dex', 5, 60);
const CK_ACTION = makeAction('Cloudkill', 25, 'con', 5, 120);
const IP_ACTION = makeAction('Insect Plague', 25, 'con', 5, 90);
const EBT_ACTION = makeAction("Evard's Black Tentacles", 25, 'dex', 4, 90);
const SR_ACTION = makeAction('Sickening Radiance', 25, 'con', 4, 120);
const MB_ACTION = makeAction('Moonbeam', 25, 'con', 2, 120);
const WOF_ACTION = makeAction('Wall of Fire', 25, 'dex', 4, 120);

// ============================================================
// Phase 1 — Pattern A: Instantaneous AoE (on-cast filter)
// ============================================================

console.log('\n=== Phase 1 — Pattern A: Instantaneous AoE on-cast exclusion ===\n');

{
  // 1a. Circle of Death (L6): GoI upcast to L7 (threshold=6) blocks L6 → protected takes 0
  // (GoI at base L6 only blocks ≤5, so L6 Circle of Death bypasses base GoI)
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [COD_ACTION], resources: withSlots({ 6: { max: 1, remaining: 1 } }),
    cha: 20,
  });
  const eProt = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(6, 7)],  // L7 GoI blocks ≤6
  });
  // exposed at (4,0,0): Chebyshev 3 from GoI holder at (1,0,0) → outside GoI radius
  // Circle of Death has 60ft radius → well within AoE
  const eExp = makeCombatant('e_exp', {
    faction: 'enemy', pos: { x: 4, y: 0, z: 0 },
  });
  const bf = makeBF([caster, eProt, eExp]);
  const state = makeState(bf);
  const hpProtBefore = eProt.currentHP;
  const hpExpBefore = eExp.currentHP;

  codExecute(caster, [eProt, eExp], state);

  eq('1a. Circle of Death: GoI-protected takes 0 damage', hpProtBefore - eProt.currentHP, 0);
  assert('1a. Circle of Death: exposed takes damage', (hpExpBefore - eExp.currentHP) > 0);
  const castLog = state.log.events.find(e => e.description.includes('excluded by Globe of Invulnerability'));
  assert('1a. Circle of Death: log mentions GoI exclusion', castLog !== undefined);
}

{
  // 1b. Cone of Cold (L5): GoI(L6, threshold=5) blocks L5 → protected takes 0
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [COC_ACTION], resources: withSlots({ 5: { max: 1, remaining: 1 } }),
    cha: 20,
  });
  const eProt = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(5)],
  });
  // exposed at (5,0,0): Chebyshev 4 from GoI holder at (1,0,0) → outside GoI radius
  // Within 60ft cone aimed at eProt (1,0,0) from caster (0,0,0) — directly on axis
  const eExp = makeCombatant('e_exp', {
    faction: 'enemy', pos: { x: 5, y: 0, z: 0 },
  });
  const bf = makeBF([caster, eProt, eExp]);
  const state = makeState(bf);
  const hpProtBefore = eProt.currentHP;
  const hpExpBefore = eExp.currentHP;

  // cone_of_cold execute signature: (caster, targets, state, aimTarget)
  cocExecute(caster, [eProt, eExp], state, eProt);

  eq('1b. Cone of Cold: GoI-protected takes 0 damage', hpProtBefore - eProt.currentHP, 0);
  assert('1b. Cone of Cold: exposed takes damage', (hpExpBefore - eExp.currentHP) > 0);
}

{
  // 1c. Chain Lightning (L6, auto-hit, indexed loop): GoI(L7, threshold=6) blocks L6
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [CL_ACTION], resources: withSlots({ 6: { max: 1, remaining: 1 } }),
    cha: 20,
  });
  const eProt = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(6, 7)],  // L7 GoI blocks ≤6
  });
  // exposed at (4,0,0): Chebyshev 3 from GoI holder at (1,0,0) → outside GoI radius
  const eExp = makeCombatant('e_exp', {
    faction: 'enemy', pos: { x: 4, y: 0, z: 0 },
  });
  const bf = makeBF([caster, eProt, eExp]);
  const state = makeState(bf);
  const hpProtBefore = eProt.currentHP;
  const hpExpBefore = eExp.currentHP;

  clExecute(caster, [eProt, eExp], state);

  eq('1c. Chain Lightning: GoI-protected takes 0 damage', hpProtBefore - eProt.currentHP, 0);
  assert('1c. Chain Lightning: exposed takes damage', (hpExpBefore - eExp.currentHP) > 0);
  const castLog = state.log.events.find(e => e.description.includes('excluded by Globe of Invulnerability'));
  assert('1c. Chain Lightning: log mentions GoI exclusion', castLog !== undefined);
}

{
  // 1d. Earthquake (L8, auto-hit): GoI upcast to L9 (threshold=8) blocks L8
  // (GoI at base L6 only blocks ≤5; L8 GoI blocks ≤7; L9 GoI blocks ≤8)
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [EQ_ACTION], resources: withSlots({ 8: { max: 1, remaining: 1 } }),
    cha: 20,
  });
  const eProt = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(8, 9)],  // L9 GoI blocks ≤8
  });
  // exposed at (4,0,0): Chebyshev 3 from GoI holder at (1,0,0) → outside GoI radius
  const eExp = makeCombatant('e_exp', {
    faction: 'enemy', pos: { x: 4, y: 0, z: 0 },
  });
  const bf = makeBF([caster, eProt, eExp]);
  const state = makeState(bf);
  const hpProtBefore = eProt.currentHP;
  const hpExpBefore = eExp.currentHP;

  eqExecute(caster, [eProt, eExp], state);

  eq('1d. Earthquake: GoI-protected (threshold=8) takes 0 damage', hpProtBefore - eProt.currentHP, 0);
  assert('1d. Earthquake: exposed takes damage', (hpExpBefore - eExp.currentHP) > 0);
}

{
  // 1e. Flame Strike (L5, dual damage fire+radiant): GoI blocks BOTH damage types
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [FS_ACTION], resources: withSlots({ 5: { max: 1, remaining: 1 } }),
    cha: 20,
  });
  const eProt = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(5)],
  });
  // exposed at (4,0,0): Chebyshev 3 from GoI holder at (1,0,0) → outside GoI radius
  const eExp = makeCombatant('e_exp', {
    faction: 'enemy', pos: { x: 4, y: 0, z: 0 },
  });
  const bf = makeBF([caster, eProt, eExp]);
  const state = makeState(bf);
  const hpProtBefore = eProt.currentHP;
  const hpExpBefore = eExp.currentHP;

  fsExecute(caster, [eProt, eExp], state);

  eq('1e. Flame Strike: GoI-protected takes 0 damage (both fire+radiant blocked)', hpProtBefore - eProt.currentHP, 0);
  assert('1e. Flame Strike: exposed takes damage', (hpExpBefore - eExp.currentHP) > 0);
}

// ============================================================
// Phase 2 — Pattern B: Persistent damage_zone (per-target check + sourceSlotLevel)
// ============================================================

console.log('\n=== Phase 2 — Pattern B: Persistent damage_zone ===\n');

{
  // 2a. Cloudkill (L5): on-cast damage blocked, damage_zone applied with sourceSlotLevel
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [CK_ACTION], resources: withSlots({ 5: { max: 1, remaining: 1 } }),
    cha: 20,
  });
  const eProt = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(5)],
  });
  // exposed at (4,0,0): Chebyshev 3 from GoI holder at (1,0,0) → outside GoI radius
  // Cloudkill 20ft radius → well within AoE from center at (1,0,0)
  const eExp = makeCombatant('e_exp', {
    faction: 'enemy', pos: { x: 4, y: 0, z: 0 },
  });
  const bf = makeBF([caster, eProt, eExp]);
  const state = makeState(bf);
  const hpProtBefore = eProt.currentHP;
  const hpExpBefore = eExp.currentHP;

  ckExecute(caster, [eProt, eExp], state);

  eq('2a. Cloudkill: GoI-protected on-cast damage = 0', hpProtBefore - eProt.currentHP, 0);
  assert('2a. Cloudkill: exposed takes on-cast damage', (hpExpBefore - eExp.currentHP) > 0);

  // damage_zone effect IS applied to the GoI-protected target (with sourceSlotLevel)
  const protZone = eProt.activeEffects.find(e => e.effectType === 'damage_zone' && e.spellName === 'Cloudkill');
  assert('2a. Cloudkill: damage_zone applied to GoI-protected target', protZone !== undefined);
  eq('2a. Cloudkill: damage_zone sourceSlotLevel = 5', protZone?.sourceSlotLevel, 5);

  // Also applied to the exposed target
  const expZone = eExp.activeEffects.find(e => e.effectType === 'damage_zone' && e.spellName === 'Cloudkill');
  assert('2a. Cloudkill: damage_zone applied to exposed target', expZone !== undefined);
  eq('2a. Cloudkill: exposed damage_zone sourceSlotLevel = 5', expZone?.sourceSlotLevel, 5);

  // Verify GoI negation log
  const goiLog = state.log.events.find(e =>
    e.description.includes('protected by Globe of Invulnerability') && e.description.includes('on-cast damage negated')
  );
  assert('2a. Cloudkill: GoI negation log emitted', goiLog !== undefined);
}

{
  // 2b. Insect Plague (L5): same pattern
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [IP_ACTION], resources: withSlots({ 5: { max: 1, remaining: 1 } }),
    cha: 20,
  });
  const eProt = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(5)],
  });
  const bf = makeBF([caster, eProt]);
  const state = makeState(bf);
  const hpProtBefore = eProt.currentHP;

  ipExecute(caster, [eProt], state);

  eq('2b. Insect Plague: GoI-protected on-cast damage = 0', hpProtBefore - eProt.currentHP, 0);
  const protZone = eProt.activeEffects.find(e => e.effectType === 'damage_zone' && e.spellName === 'Insect Plague');
  assert('2b. Insect Plague: damage_zone applied to GoI-protected target', protZone !== undefined);
  eq('2b. Insect Plague: damage_zone sourceSlotLevel = 5', protZone?.sourceSlotLevel, 5);
}

// ============================================================
// Phase 3 — Pattern B: terrain_zone spells
// ============================================================

console.log('\n=== Phase 3 — Pattern B: terrain_zone spells ===\n');

{
  // 3a. Evard's Black Tentacles (L4): terrain_zone + on-cast damage_zone
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [EBT_ACTION], resources: withSlots({ 4: { max: 1, remaining: 1 } }),
    cha: 20,
  });
  const eProt = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(5)],
  });
  // exposed at (4,0,0): Chebyshev 3 from GoI holder at (1,0,0) → outside GoI radius
  // Evard's 20ft square → within AoE
  const eExp = makeCombatant('e_exp', {
    faction: 'enemy', pos: { x: 4, y: 0, z: 0 },
  });
  const bf = makeBF([caster, eProt, eExp]);
  const state = makeState(bf);
  const hpProtBefore = eProt.currentHP;
  const hpExpBefore = eExp.currentHP;

  ebtExecute(caster, [eProt, eExp], state);

  eq('3a. Evards: GoI-protected on-cast damage = 0', hpProtBefore - eProt.currentHP, 0);
  assert('3a. Evards: exposed takes on-cast damage', (hpExpBefore - eExp.currentHP) > 0);

  // terrain_zone applied to CASTER with sourceSlotLevel
  const terrainZone = caster.activeEffects.find(e => e.effectType === 'terrain_zone' && e.spellName === "Evard's Black Tentacles");
  assert('3a. Evards: terrain_zone applied to caster', terrainZone !== undefined);
  eq('3a. Evards: terrain_zone sourceSlotLevel = 4', terrainZone?.sourceSlotLevel, 4);

  // damage_zone applied to BOTH targets (persistent — will tick when GoI expires)
  const protZone = eProt.activeEffects.find(e => e.effectType === 'damage_zone' && e.spellName === "Evard's Black Tentacles");
  assert('3a. Evards: damage_zone applied to GoI-protected target', protZone !== undefined);
  eq('3a. Evards: prot damage_zone sourceSlotLevel = 4', protZone?.sourceSlotLevel, 4);

  // GoI-protected target should NOT have the restrained condition (on-cast effect blocked)
  assert('3a. Evards: GoI-protected NOT restrained', !eProt.conditions.has('restrained'));
}

{
  // 3b. Sickening Radiance (L4): terrain_zone + on-cast damage + exhaustion
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [SR_ACTION], resources: withSlots({ 4: { max: 1, remaining: 1 } }),
    cha: 20,
  });
  const eProt = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(5)],
  });
  // exposed at (4,0,0): Chebyshev 3 from GoI holder at (1,0,0) → outside GoI radius
  // Sickening Radiance 30ft radius → well within AoE
  const eExp = makeCombatant('e_exp', {
    faction: 'enemy', pos: { x: 4, y: 0, z: 0 },
  });
  const bf = makeBF([caster, eProt, eExp]);
  const state = makeState(bf);
  const hpProtBefore = eProt.currentHP;
  const hpExpBefore = eExp.currentHP;

  srExecute(caster, [eProt, eExp], state);

  eq('3b. Sickening Radiance: GoI-protected on-cast damage = 0', hpProtBefore - eProt.currentHP, 0);
  assert('3b. Sickening Radiance: exposed takes on-cast damage', (hpExpBefore - eExp.currentHP) > 0);

  const terrainZone = caster.activeEffects.find(e => e.effectType === 'terrain_zone' && e.spellName === 'Sickening Radiance');
  assert('3b. Sickening Radiance: terrain_zone applied to caster', terrainZone !== undefined);
  eq('3b. Sickening Radiance: terrain_zone sourceSlotLevel = 4', terrainZone?.sourceSlotLevel, 4);
}

// ============================================================
// Phase 4 — Pattern B: Single-target persistent
// ============================================================

console.log('\n=== Phase 4 — Pattern B: Single-target persistent ===\n');

{
  // 4a. Moonbeam (L2): on-cast damage blocked, damage_zone applied with sourceSlotLevel
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [MB_ACTION], resources: withSlots({ 2: { max: 1, remaining: 1 } }),
    cha: 20,
  });
  const eProt = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(5)],
  });
  const bf = makeBF([caster, eProt]);
  const state = makeState(bf);
  const hpProtBefore = eProt.currentHP;

  mbExecute(caster, eProt, state);

  eq('4a. Moonbeam: GoI-protected on-cast damage = 0', hpProtBefore - eProt.currentHP, 0);
  const protZone = eProt.activeEffects.find(e => e.effectType === 'damage_zone' && e.spellName === 'Moonbeam');
  assert('4a. Moonbeam: damage_zone applied to GoI-protected target', protZone !== undefined);
  eq('4a. Moonbeam: damage_zone sourceSlotLevel = 2', protZone?.sourceSlotLevel, 2);

  const goiLog = state.log.events.find(e =>
    e.description.includes('protected by Globe of Invulnerability') && e.description.includes('on-cast damage negated')
  );
  assert('4a. Moonbeam: GoI negation log emitted', goiLog !== undefined);
}

{
  // 4b. Wall of Fire (L4): on-appear damage blocked, damage_zone applied
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [WOF_ACTION], resources: withSlots({ 4: { max: 1, remaining: 1 } }),
    cha: 20,
  });
  const eProt = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    activeEffects: [makeGoIEffect(5)],
  });
  const bf = makeBF([caster, eProt]);
  const state = makeState(bf);
  const hpProtBefore = eProt.currentHP;

  wofExecute(caster, eProt, state);

  eq('4b. Wall of Fire: GoI-protected on-cast damage = 0', hpProtBefore - eProt.currentHP, 0);
  const protZone = eProt.activeEffects.find(e => e.effectType === 'damage_zone' && e.spellName === 'Wall of Fire');
  assert('4b. Wall of Fire: damage_zone applied to GoI-protected target', protZone !== undefined);
  eq('4b. Wall of Fire: damage_zone sourceSlotLevel = 4', protZone?.sourceSlotLevel, 4);
}

// ============================================================
// Phase 5 — Metadata flags
// ============================================================

console.log('\n=== Phase 5 — Metadata flags ===\n');

{
  const goiMeta = require('../spells/globe_of_invulnerability').metadata;

  // Session 79 completion: flag flipped to false
  eq('5a. globeOfInvulnerabilityAoEV1Simplified now false (complete)', goiMeta.globeOfInvulnerabilityAoEV1Simplified, false);
  // Partial flag removed
  eq('5b. globeOfInvulnerabilityAoEPartialV1Implemented removed (undefined)', goiMeta.globeOfInvulnerabilityAoEPartialV1Implemented, undefined);
  // Core flags still true
  assert('5c. globeOfInvulnerabilityImplemented still true', goiMeta.globeOfInvulnerabilityImplemented === true);
  assert('5d. globeOfInvulnerabilityUpcastV1Implemented still true', goiMeta.globeOfInvulnerabilityUpcastV1Implemented === true);
}

// ============================================================
// Phase 6 — All 36 Session 79 spell files import GoI helpers
// ============================================================

console.log('\n=== Phase 6 — All 36 Session 79 spell files import GoI helpers ===\n');

{
  const fs = require('fs');
  const path = require('path');

  const session79Spells = [
    // Pattern A (instantaneous, 23)
    'chain_lightning', 'circle_of_death', 'cone_of_cold', 'dark_star',
    'destructive_wave', 'earth_tremor', 'earthquake', 'erupting_earth',
    'fire_storm', 'flame_strike', 'frost_fingers', 'gravity_fissure',
    'gravity_sinkhole', 'incendiary_cloud', 'maddening_darkness',
    'magnify_gravity', 'pulse_wave', 'ravenous_void', 'spray_of_cards',
    'storm_sphere', 'sunbeam', 'synaptic_static', 'weird', 'whirlwind',
    // Pattern B persistent damage_zone (6)
    'cloudkill', 'death_armor', 'dust_devil', 'insect_plague', 'storm_of_vengeance',
    // Pattern B terrain_zone (3)
    'evards_black_tentacles', 'maelstrom', 'sickening_radiance',
    // Pattern B single-target persistent (4)
    'moonbeam', 'spike_growth', 'wall_of_fire', 'wall_of_ice',
  ];

  let allHaveGoI = true;
  let countChecked = 0;
  for (const spell of session79Spells) {
    const file = path.join(__dirname, '..', 'spells', `${spell}.ts`);
    if (!fs.existsSync(file)) {
      console.log(`  ⚠️  ${spell}.ts does not exist (skipped)`);
      continue;
    }
    countChecked++;
    const content = fs.readFileSync(file, 'utf8');
    const hasGoI = content.includes('filterGoIProtectedTargets') || content.includes('isProtectedByGoI');
    if (!hasGoI) {
      allHaveGoI = false;
      console.log(`  ❌ ${spell}.ts does NOT import GoI helpers`);
    }
  }
  assert(`6a. All ${countChecked} Session 79 spell files import GoI helpers`, allHaveGoI);
  eq('6b. Spell count checked', countChecked, session79Spells.length);
}

// ============================================================
// Phase 7 — Caster self-exclusion
// ============================================================

console.log('\n=== Phase 7 — Caster self-exclusion ===\n');

{
  // 7a. Circle of Death: caster's own GoI does NOT block their own spell
  // Caster has GoI at L7 (threshold=6) which WOULD block L6 Circle of Death
  // for other casters, but NOT for the GoI caster themselves.
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [COD_ACTION], resources: withSlots({ 6: { max: 1, remaining: 1 } }),
    cha: 20,
    activeEffects: [makeGoIEffect(6, 7)],  // caster has own GoI at L7
  });
  // enemy at (3,0,0): Chebyshev 3 from caster at (0,0,0) → outside GoI radius
  // Circle of Death 60ft radius → well within AoE
  const enemy = makeCombatant('enemy', {
    faction: 'enemy', pos: { x: 3, y: 0, z: 0 },
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const hpCasterBefore = caster.currentHP;
  const hpEnemyBefore = enemy.currentHP;

  codExecute(caster, [enemy], state);  // only enemy in targets — caster not in list

  // Caster's own GoI doesn't matter (caster not in target list anyway).
  // Enemy is NOT GoI-protected → takes damage.
  assert('7a. Circle of Death: enemy takes damage (caster self-GoI irrelevant)', (hpEnemyBefore - enemy.currentHP) > 0);
  eq('7a. Circle of Death: caster HP unchanged', hpCasterBefore - caster.currentHP, 0);
}

{
  // 7b. Moonbeam: caster targets THEMSELF while having GoI — self-GoI does NOT block
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [MB_ACTION], resources: withSlots({ 2: { max: 1, remaining: 1 } }),
    cha: 20,
    activeEffects: [makeGoIEffect(5)],  // caster has own GoI
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);
  const hpBefore = caster.currentHP;

  mbExecute(caster, caster, state);  // caster targets self

  // Caster's own GoI does NOT block their own spell — caster takes on-cast damage
  assert('7b. Moonbeam: caster self-GoI does NOT block self-cast (takes damage)', (hpBefore - caster.currentHP) > 0);

  // damage_zone applied with sourceSlotLevel
  const zone = caster.activeEffects.find(e => e.effectType === 'damage_zone' && e.spellName === 'Moonbeam');
  assert('7b. Moonbeam: damage_zone applied to caster', zone !== undefined);
  eq('7b. Moonbeam: damage_zone sourceSlotLevel = 2', zone?.sourceSlotLevel, 2);
}

// ============================================================

console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('\nAll tests passed ✅');
else              process.exit(1);
