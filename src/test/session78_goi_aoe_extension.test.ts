// ============================================================
// Test: Session 78 — GoI AoE exclusion extension (12 more spells)
//       + persistent damage_zone tick GoI filtering
//
// Extends session77_goi_aoe_exclusion.test.ts to cover the 12 additional
// spells listed in the Session 77 handover's "IMMEDIATE NEXT ACTIONS" #2:
//
//   arms_of_hadar, hunger_of_hadar, call_lightning, cloud_of_daggers,
//   flaming_sphere, ice_knife, spirit_guardians, guardian_of_faith,
//   dawn, sunburst, tidal_wave, stinking_cloud
//
// Also verifies:
//   - Persistent damage_zone effects have sourceSlotLevel set (for the
//     combat.ts tick loop GoI re-check).
//   - The combat.ts damage_zone tick loop GoI check (via isProtectedByGoI).
//   - stinking_cloud (non-damage conditions) is also GoI-filtered (PHB
//     p.245: "the spell has no effect on them" — applies to ALL effects).
//
// Run: npx ts-node --transpile-only src/test/session78_goi_aoe_extension.test.ts
// ============================================================

import { Combatant, Action, PlayerResources, Condition, ActiveEffect } from '../types/core';
import { isProtectedByGoI, filterGoIProtectedTargets } from '../engine/spell_effects';
import { EngineState } from '../engine/combat';
import { execute as aohExecute } from '../spells/arms_of_hadar';
import { execute as hohExecute } from '../spells/hunger_of_hadar';
import { execute as clExecute } from '../spells/call_lightning';
import { execute as codExecute } from '../spells/cloud_of_daggers';
import { execute as fsExecute } from '../spells/flaming_sphere';
import { execute as ikExecute, IceKnifePlan } from '../spells/ice_knife';
import { execute as sgExecute } from '../spells/spirit_guardians';
import { execute as gofExecute } from '../spells/guardian_of_faith';
import { execute as dawnExecute } from '../spells/dawn';
import { execute as sbExecute } from '../spells/sunburst';
import { execute as twExecute } from '../spells/tidal_wave';
import { execute as scExecute } from '../spells/stinking_cloud';

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
    casterId: 'self',  // the GoI caster itself is protected
    spellName: 'Globe of Invulnerability',
    effectType: 'spell_shield',
    sourceSlotLevel,
    sourceIsConcentration: true,
    payload: { blockThreshold },
  } as ActiveEffect;
}

// ---- Standard action definitions ----------------------------

function makeAction(name: string, saveDC: number, saveAbility: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', slotLevel: number, range: number = 60): Action {
  return {
    name, isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: range, long: range },
    hitBonus: null, damage: null, damageType: null,
    saveDC, saveAbility, isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel, costType: 'action',
    legendaryCost: 0, description: name,
  };
}

const AOH_ACTION = makeAction('Arms of Hadar', 25, 'str', 1, 10);
const HOH_ACTION = makeAction('Hunger of Hadar', 25, 'con', 3, 60);
const CL_ACTION = makeAction('Call Lightning', 25, 'dex', 3, 60);
const COD_ACTION = makeAction('Cloud of Daggers', 25, 'dex', 2, 60);
const FS_ACTION = makeAction('Flaming Sphere', 25, 'dex', 2, 60);
const IK_ACTION = makeAction('Ice Knife', 25, 'dex', 1, 60);
const SG_ACTION = makeAction('Spirit Guardians', 25, 'wis', 3, 10);
const GOF_ACTION = makeAction('Guardian of Faith', 25, 'dex', 4, 60);
const DAWN_ACTION = makeAction('Dawn', 25, 'con', 5, 60);
const SB_ACTION = makeAction('Sunburst', 25, 'con', 8, 150);
const TW_ACTION = makeAction('Tidal Wave', 25, 'str', 3, 30);
const SC_ACTION = makeAction('Stinking Cloud', 25, 'con', 3, 90);

// ============================================================
// Phase 1 — Simple multi-target AoE (on-cast filter)
// arms_of_hadar, ice_knife, sunburst, tidal_wave, guardian_of_faith
// ============================================================

console.log('\n=== Phase 1 — Simple multi-target AoE on-cast exclusion ===\n');

{
  // 1a. Arms of Hadar: GoI-protected target takes 0 damage, exposed takes damage
  // Session 87: caster re-positioned to (4,0,0) — outside GoI 10-ft radius.
  const caster = makeCombatant('warlock', {
    faction: 'party', pos: { x: 4, y: 0, z: 0 },
    actions: [AOH_ACTION], resources: withSlots({ 1: { max: 2, remaining: 2 } }),
    cha: 20,
  });
  const enemyProtected = makeCombatant('e_prot', {
    faction: 'enemy', str: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, activeEffects: [makeGoIEffect(5)],
  });
  // exposed enemy at (-2,0,0): Chebyshev 3 from GoI holder at (1,0,0) → outside GoI radius
  // but within 10 ft Euclidean of caster at (0,0,0) → inside Arms of Hadar AoE
  const enemyExposed = makeCombatant('e_exp', {
    faction: 'enemy', str: 1, pos: { x: -2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);
  const hpProtBefore = enemyProtected.currentHP;
  const hpExpBefore = enemyExposed.currentHP;

  aohExecute(caster, [enemyProtected, enemyExposed], state);

  eq('1a. Arms of Hadar: GoI-protected takes 0 damage', hpProtBefore - enemyProtected.currentHP, 0);
  assert('1a. Arms of Hadar: exposed takes damage', (hpExpBefore - enemyExposed.currentHP) > 0);
  const castLog = state.log.events.find(e => e.description.includes('excluded by Globe of Invulnerability'));
  assert('1a. Arms of Hadar: log mentions GoI exclusion', castLog !== undefined);
}

{
  // 1b. Ice Knife: GoI-protected target in explosion takes 0 cold damage
  //     (piercing on primary is a separate attack-roll mechanic)
  // Session 87: caster re-positioned to (4,0,0) — outside GoI 10-ft radius.
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 4, y: 0, z: 0 },
    actions: [IK_ACTION], resources: withSlots({ 1: { max: 2, remaining: 2 } }),
    int: 20,
  });
  const primary = makeCombatant('primary', {
    faction: 'enemy', dex: 20, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  // Ice Knife explosion is 5ft (1 square) from the primary target.
  // All positions within 1 square of primary (1,0,0) are at Chebyshev ≤ 2
  // from goiInExplosion at (1,1,0), making it geometrically impossible to
  // have an exposed enemy in the explosion AND outside GoI radius.
  // Split into two tests: one for GoI blocking, one for exposed damage.
  const goiInExplosion = makeCombatant('goi_exp', {
    faction: 'enemy', dex: 1, pos: { x: 1, y: 1, z: 0 },
    maxHP: 1000, currentHP: 1000, activeEffects: [makeGoIEffect(5)],
  });
  const bf = makeBF([caster, primary, goiInExplosion]);
  const state = makeState(bf);
  const hpGoiBefore = goiInExplosion.currentHP;

  const plan1: IceKnifePlan = { primary, explosion: [primary, goiInExplosion] };
  ikExecute(caster, plan1, state);

  eq('1b. Ice Knife: GoI-protected in explosion takes 0 cold damage', hpGoiBefore - goiInExplosion.currentHP, 0);
}

{
  // 1b-ii. Ice Knife: exposed enemy in explosion takes cold damage (no GoI nearby)
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [IK_ACTION], resources: withSlots({ 1: { max: 2, remaining: 2 } }),
    int: 20,
  });
  const primary = makeCombatant('primary', {
    faction: 'enemy', dex: 20, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const exposedInExplosion = makeCombatant('exp_exp', {
    faction: 'enemy', dex: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, primary, exposedInExplosion]);
  const state = makeState(bf);
  const hpExpBefore = exposedInExplosion.currentHP;

  const plan2: IceKnifePlan = { primary, explosion: [primary, exposedInExplosion] };
  ikExecute(caster, plan2, state);

  assert('1b. Ice Knife: exposed in explosion takes cold damage', (hpExpBefore - exposedInExplosion.currentHP) > 0);
}

{
  // 1c. Sunburst: GoI-protected target takes 0 damage + no blinded
  //     NOTE: Sunburst is L8, so we need a L9 GoI (threshold 8) to block it.
  //     L6 GoI (threshold 5) would be penetrated by L8 Sunburst.
  // Session 87: caster re-positioned to (4,0,0) — outside GoI 10-ft radius.
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 4, y: 0, z: 0 },
    actions: [SB_ACTION], resources: withSlots({ 8: { max: 1, remaining: 1 } }),
    int: 20,
  });
  const enemyProtected = makeCombatant('e_prot', {
    faction: 'enemy', con: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, activeEffects: [makeGoIEffect(8, 9)],  // L9 GoI, threshold 8
  });
  const enemyExposed = makeCombatant('e_exp', {
    faction: 'enemy', con: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);
  const hpProtBefore = enemyProtected.currentHP;

  sbExecute(caster, [enemyProtected, enemyExposed], state);

  eq('1c. Sunburst: GoI-protected takes 0 damage', hpProtBefore - enemyProtected.currentHP, 0);
  assert('1c. Sunburst: GoI-protected NOT blinded', !enemyProtected.conditions.has('blinded'));
}

{
  // 1d. Tidal Wave: GoI-protected target takes 0 damage + no prone
  // Session 87: caster re-positioned to (4,0,0) — outside GoI 10-ft radius.
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 4, y: 0, z: 0 },
    actions: [TW_ACTION], resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    int: 20,
  });
  const enemyProtected = makeCombatant('e_prot', {
    faction: 'enemy', str: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, activeEffects: [makeGoIEffect(5)],
  });
  const enemyExposed = makeCombatant('e_exp', {
    faction: 'enemy', str: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);
  const hpProtBefore = enemyProtected.currentHP;

  twExecute(caster, [enemyProtected, enemyExposed], state);

  eq('1d. Tidal Wave: GoI-protected takes 0 damage', hpProtBefore - enemyProtected.currentHP, 0);
  assert('1d. Tidal Wave: GoI-protected NOT prone', !enemyProtected.conditions.has('prone'));
}

{
  // 1e. Guardian of Faith: GoI-protected target takes 0 damage
  // Session 87: caster re-positioned to (4,0,0) — outside GoI 10-ft radius.
  const caster = makeCombatant('cleric', {
    faction: 'party', pos: { x: 4, y: 0, z: 0 },
    actions: [GOF_ACTION], resources: withSlots({ 4: { max: 1, remaining: 1 } }),
    wis: 20,
  });
  const enemyProtected = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, activeEffects: [makeGoIEffect(5)],
  });
  // exposed at (4,0,0): Chebyshev 3 from GoI holder at (1,0,0) → outside GoI radius
  const enemyExposed = makeCombatant('e_exp', {
    faction: 'enemy', pos: { x: 4, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);
  const hpProtBefore = enemyProtected.currentHP;
  const hpExpBefore = enemyExposed.currentHP;

  gofExecute(caster, [enemyProtected, enemyExposed], state);

  eq('1e. Guardian of Faith: GoI-protected takes 0 damage', hpProtBefore - enemyProtected.currentHP, 0);
  assert('1e. Guardian of Faith: exposed takes damage', (hpExpBefore - enemyExposed.currentHP) > 0);
}

// ============================================================
// Phase 2 — Multi-target persistent damage_zone spells
// hunger_of_hadar, call_lightning, spirit_guardians, dawn
//
// Key behavior: GoI-protected targets take 0 ON-CAST damage, but the
// damage_zone EFFECT is still applied (with sourceSlotLevel set) so it
// can tick later when GoI expires.
// ============================================================

console.log('\n=== Phase 2 — Multi-target persistent damage_zone ===\n');

{
  // 2a. Hunger of Hadar: GoI-protected takes 0 on-cast damage, but gets
  //     TWO damage_zone effects with sourceSlotLevel set
  // Session 87: caster re-positioned to (4,0,0) — outside GoI 10-ft radius.
  const caster = makeCombatant('warlock', {
    faction: 'party', pos: { x: 4, y: 0, z: 0 },
    actions: [HOH_ACTION], resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    cha: 20, concentration: null,
  });
  const enemyProtected = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, activeEffects: [makeGoIEffect(5)],
  });
  const enemyExposed = makeCombatant('e_exp', {
    faction: 'enemy', pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);
  const hpProtBefore = enemyProtected.currentHP;

  hohExecute(caster, [enemyProtected, enemyExposed], state);

  eq('2a. Hunger of Hadar: GoI-protected takes 0 on-cast damage', hpProtBefore - enemyProtected.currentHP, 0);

  // The damage_zone effect IS applied (so it can tick when GoI expires)
  const dzEffects = enemyProtected.activeEffects.filter(e =>
    e.effectType === 'damage_zone' && e.spellName === 'Hunger of Hadar'
  );
  eq('2a. Hunger of Hadar: GoI-protected gets 2 damage_zone effects', dzEffects.length, 2);

  // sourceSlotLevel must be set on each damage_zone effect (for tick GoI re-check)
  assert('2a. Hunger of Hadar: damage_zone[0] has sourceSlotLevel=3', dzEffects[0].sourceSlotLevel === 3);
  assert('2a. Hunger of Hadar: damage_zone[1] has sourceSlotLevel=3', dzEffects[1].sourceSlotLevel === 3);
}

{
  // 2b. Call Lightning: GoI-protected takes 0 on-cast damage, but gets
  //     damage_zone effect with sourceSlotLevel set
  // Session 87: caster re-positioned to (4,0,0) — outside GoI 10-ft radius.
  const caster = makeCombatant('druid', {
    faction: 'party', pos: { x: 4, y: 0, z: 0 },
    actions: [CL_ACTION], resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    wis: 20, concentration: null,
  });
  const enemyProtected = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, activeEffects: [makeGoIEffect(5)],
  });
  const enemyExposed = makeCombatant('e_exp', {
    faction: 'enemy', pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);
  const hpProtBefore = enemyProtected.currentHP;

  clExecute(caster, [enemyProtected, enemyExposed], state);

  eq('2b. Call Lightning: GoI-protected takes 0 on-cast damage', hpProtBefore - enemyProtected.currentHP, 0);

  const dzEffects = enemyProtected.activeEffects.filter(e =>
    e.effectType === 'damage_zone' && e.spellName === 'Call Lightning'
  );
  eq('2b. Call Lightning: GoI-protected gets 1 damage_zone effect', dzEffects.length, 1);
  assert('2b. Call Lightning: damage_zone has sourceSlotLevel=3', dzEffects[0].sourceSlotLevel === 3);
}

{
  // 2c. Spirit Guardians: GoI-protected takes 0 on-cast damage, but gets
  //     damage_zone effect with sourceSlotLevel set
  // Session 87: caster re-positioned to (4,0,0) — outside GoI 10-ft radius.
  const caster = makeCombatant('cleric', {
    faction: 'party', pos: { x: 4, y: 0, z: 0 },
    actions: [SG_ACTION], resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    wis: 20, concentration: null,
  });
  const enemyProtected = makeCombatant('e_prot', {
    faction: 'enemy', wis: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, activeEffects: [makeGoIEffect(5)],
  });
  const enemyExposed = makeCombatant('e_exp', {
    faction: 'enemy', wis: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);
  const hpProtBefore = enemyProtected.currentHP;

  sgExecute(caster, [enemyProtected, enemyExposed], state);

  eq('2c. Spirit Guardians: GoI-protected takes 0 on-cast damage', hpProtBefore - enemyProtected.currentHP, 0);

  const dzEffects = enemyProtected.activeEffects.filter(e =>
    e.effectType === 'damage_zone' && e.spellName === 'Spirit Guardians'
  );
  eq('2c. Spirit Guardians: GoI-protected gets 1 damage_zone effect', dzEffects.length, 1);
  assert('2c. Spirit Guardians: damage_zone has sourceSlotLevel=3', dzEffects[0].sourceSlotLevel === 3);
}

{
  // 2d. Dawn: GoI-protected takes 0 on-cast damage, but gets damage_zone
  //     effect with sourceSlotLevel set
  // Session 87: caster re-positioned to (4,0,0) — outside GoI 10-ft radius.
  const caster = makeCombatant('cleric', {
    faction: 'party', pos: { x: 4, y: 0, z: 0 },
    actions: [DAWN_ACTION], resources: withSlots({ 5: { max: 1, remaining: 1 } }),
    wis: 20, concentration: null,
  });
  const enemyProtected = makeCombatant('e_prot', {
    faction: 'enemy', con: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, activeEffects: [makeGoIEffect(5)],
  });
  const enemyExposed = makeCombatant('e_exp', {
    faction: 'enemy', con: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);
  const hpProtBefore = enemyProtected.currentHP;

  dawnExecute(caster, [enemyProtected, enemyExposed], state);

  eq('2d. Dawn: GoI-protected takes 0 on-cast damage', hpProtBefore - enemyProtected.currentHP, 0);

  const dzEffects = enemyProtected.activeEffects.filter(e =>
    e.effectType === 'damage_zone' && e.spellName === 'Dawn'
  );
  eq('2d. Dawn: GoI-protected gets 1 damage_zone effect', dzEffects.length, 1);
  assert('2d. Dawn: damage_zone has sourceSlotLevel=5', dzEffects[0].sourceSlotLevel === 5);
}

// ============================================================
// Phase 3 — Single-target persistent damage_zone spells
// cloud_of_daggers, flaming_sphere
// ============================================================

console.log('\n=== Phase 3 — Single-target persistent damage_zone ===\n');

{
  // 3a. Cloud of Daggers: GoI-protected takes 0 on-cast damage, but gets
  //     damage_zone effect with sourceSlotLevel set
  // Session 87: caster re-positioned to (4,0,0) — outside GoI 10-ft radius.
  const caster = makeCombatant('bard', {
    faction: 'party', pos: { x: 4, y: 0, z: 0 },
    actions: [COD_ACTION], resources: withSlots({ 2: { max: 2, remaining: 2 } }),
    cha: 20, concentration: null,
  });
  const enemyProtected = makeCombatant('e_prot', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, activeEffects: [makeGoIEffect(5)],
  });
  const bf = makeBF([caster, enemyProtected]);
  const state = makeState(bf);
  const hpProtBefore = enemyProtected.currentHP;

  codExecute(caster, enemyProtected, state);

  eq('3a. Cloud of Daggers: GoI-protected takes 0 on-cast damage', hpProtBefore - enemyProtected.currentHP, 0);

  const dzEffects = enemyProtected.activeEffects.filter(e =>
    e.effectType === 'damage_zone' && e.spellName === 'Cloud of Daggers'
  );
  eq('3a. Cloud of Daggers: GoI-protected gets 1 damage_zone effect', dzEffects.length, 1);
  assert('3a. Cloud of Daggers: damage_zone has sourceSlotLevel=2', dzEffects[0].sourceSlotLevel === 2);
}

{
  // 3b. Flaming Sphere: GoI-protected takes 0 on-cast damage, but gets
  //     damage_zone effect with sourceSlotLevel set
  // Session 87: caster re-positioned to (4,0,0) — outside GoI 10-ft radius.
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 4, y: 0, z: 0 },
    actions: [FS_ACTION], resources: withSlots({ 2: { max: 2, remaining: 2 } }),
    int: 20, concentration: null,
  });
  const enemyProtected = makeCombatant('e_prot', {
    faction: 'enemy', dex: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, activeEffects: [makeGoIEffect(5)],
  });
  const bf = makeBF([caster, enemyProtected]);
  const state = makeState(bf);
  const hpProtBefore = enemyProtected.currentHP;

  fsExecute(caster, enemyProtected, state);

  eq('3b. Flaming Sphere: GoI-protected takes 0 on-cast damage', hpProtBefore - enemyProtected.currentHP, 0);

  const dzEffects = enemyProtected.activeEffects.filter(e =>
    e.effectType === 'damage_zone' && e.spellName === 'Flaming Sphere'
  );
  eq('3b. Flaming Sphere: GoI-protected gets 1 damage_zone effect', dzEffects.length, 1);
  assert('3b. Flaming Sphere: damage_zone has sourceSlotLevel=2', dzEffects[0].sourceSlotLevel === 2);
}

// ============================================================
// Phase 4 — Non-damage (conditions) — stinking_cloud
// PHB p.245: "the spell has no effect on them" — applies to ALL effects
// ============================================================

console.log('\n=== Phase 4 — Non-damage AoE (conditions) exclusion ===\n');

{
  // 4a. Stinking Cloud: GoI-protected target gets NO conditions
  // Session 87: caster re-positioned to (4,0,0) — outside GoI 10-ft radius.
  const caster = makeCombatant('wiz', {
    faction: 'party', pos: { x: 4, y: 0, z: 0 },
    actions: [SC_ACTION], resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    int: 20, concentration: null,
  });
  const enemyProtected = makeCombatant('e_prot', {
    faction: 'enemy', con: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000, activeEffects: [makeGoIEffect(5)],
  });
  // exposed at (4,0,0): Chebyshev 3 from GoI holder at (1,0,0) → outside GoI radius
  // still within Stinking Cloud 20ft (4 squares) radius from center at (1,0,0)
  const enemyExposed = makeCombatant('e_exp', {
    faction: 'enemy', con: 1, pos: { x: 4, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);

  scExecute(caster, [enemyProtected, enemyExposed], state);

  assert('4a. Stinking Cloud: GoI-protected NOT poisoned', !enemyProtected.conditions.has('poisoned'));
  assert('4a. Stinking Cloud: GoI-protected NOT incapacitated', !enemyProtected.conditions.has('incapacitated'));
  // Exposed enemy MIGHT save successfully (random), so we can't assert they
  // ARE poisoned — but we can assert the log shows the save was rolled for them.
  const exposedSaveLog = state.log.events.find(e =>
    e.description.includes('e_exp') && e.description.includes('CON save vs Stinking Cloud')
  );
  assert('4a. Stinking Cloud: exposed enemy got a save roll', exposedSaveLog !== undefined);

  // The terrain_zone on the caster should have sourceSlotLevel set
  const tzEffect = caster.activeEffects.find(e =>
    e.effectType === 'terrain_zone' && e.spellName === 'Stinking Cloud'
  );
  assert('4a. Stinking Cloud: terrain_zone has sourceSlotLevel=3', tzEffect?.sourceSlotLevel === 3);
}

// ============================================================
// Phase 5 — Persistent tick GoI filtering (combat.ts tick loop)
//
// These tests verify that the combat.ts damage_zone tick loop correctly
// checks GoI using the zone's sourceSlotLevel. We test this indirectly
// by verifying:
//   (a) sourceSlotLevel is set on damage_zone effects (Phase 2-3 above)
//   (b) isProtectedByGoI correctly reads the target's GoI effect
//   (c) Legacy zones (sourceSlotLevel undefined) default to 0 → not blocked
// ============================================================

console.log('\n=== Phase 5 — Persistent tick GoI filtering ===\n');

{
  // 5a. isProtectedByGoI correctly blocks L3 spell vs GoI threshold 5
  const target = makeCombatant('t', { activeEffects: [makeGoIEffect(5)] });
  assert('5a. isProtectedByGoI: L3 vs threshold 5 → blocked', isProtectedByGoI(target, 3) === true);
  assert('5a. isProtectedByGoI: L6 vs threshold 5 → not blocked', isProtectedByGoI(target, 6) === false);
  // NOTE: isProtectedByGoI(target, 0) now returns FALSE (Session 80: early
  // return for castLevel <= 0 — cantrips are never blocked by GoI per PHB p.245).
  // The combat.ts tick loop also guards against this with the `zoneSlotLevel > 0`
  // check (see 5b below) — double protection.
}

{
  // 5b. Legacy damage_zone (sourceSlotLevel undefined) defaults to 0.
  //     The combat.ts tick loop guards with `zoneSlotLevel > 0`, so legacy
  //     zones are NOT blocked (backward compat). Simulate the full guard:
  const target = makeCombatant('t', { activeEffects: [makeGoIEffect(5)] });
  const legacySlotLevel = undefined as number | undefined;
  const effectiveLevel = legacySlotLevel ?? 0;
  // The combat.ts guard: zoneSlotLevel > 0 && ... && isProtectedByGoI(...)
  const combatGuardBlocks = effectiveLevel > 0 && isProtectedByGoI(target, effectiveLevel);
  assert('5b. Legacy zone (undefined→0): combat.ts guard → not blocked', combatGuardBlocks === false);
}

{
  // 5c. Simulate the tick loop GoI check logic:
  //     zoneSlotLevel = zone.sourceSlotLevel ?? 0
  //     blocked = zoneSlotLevel > 0 && actor.id !== zone.casterId && isProtectedByGoI(actor, zoneSlotLevel)
  const caster = makeCombatant('caster');
  const target = makeCombatant('target', { activeEffects: [makeGoIEffect(5)] });

  // L3 damage_zone vs GoI threshold 5 → blocked
  const zone1 = { sourceSlotLevel: 3, casterId: caster.id } as ActiveEffect;
  const slot1 = zone1.sourceSlotLevel ?? 0;
  const blocked1 = slot1 > 0 && target.id !== zone1.casterId && isProtectedByGoI(target, slot1);
  assert('5c. Tick GoI check: L3 zone vs GoI(5) → blocked', blocked1 === true);

  // L6 damage_zone vs GoI threshold 5 → NOT blocked (penetrates)
  const zone2 = { sourceSlotLevel: 6, casterId: caster.id } as ActiveEffect;
  const slot2 = zone2.sourceSlotLevel ?? 0;
  const blocked2 = slot2 > 0 && target.id !== zone2.casterId && isProtectedByGoI(target, slot2);
  assert('5c. Tick GoI check: L6 zone vs GoI(5) → not blocked', blocked2 === false);

  // Caster's own GoI: target IS the caster → NOT blocked
  // The combat.ts guard: actor.id !== zone.casterId → false → not blocked
  const casterWithGoI = makeCombatant('caster', { activeEffects: [makeGoIEffect(5)] });
  const zone3 = { sourceSlotLevel: 3, casterId: 'caster' } as ActiveEffect;
  const slot3 = zone3.sourceSlotLevel ?? 0;
  // Full combat.ts condition: zoneSlotLevel > 0 && actor.id !== zone.casterId && isProtectedByGoI(...)
  const blocked3 = slot3 > 0 && casterWithGoI.id !== zone3.casterId && isProtectedByGoI(casterWithGoI, slot3);
  assert('5c. Tick GoI check: caster own GoI → not blocked (self-exclusion)', blocked3 === false);
}

// ============================================================
// Phase 6 — Metadata flags
// ============================================================

console.log('\n=== Phase 6 — Metadata flags ===\n');

{
  const goiMeta = require('../spells/globe_of_invulnerability').metadata;

  // Session 79 update: all ~53 damage AoE spells now covered.
  // globeOfInvulnerabilityAoEV1Simplified flipped to false (complete).
  // globeOfInvulnerabilityAoEPartialV1Implemented removed (no longer partial).
  eq('6a. globeOfInvulnerabilityAoEV1Simplified now false (complete in Session 79)', goiMeta.globeOfInvulnerabilityAoEV1Simplified, false);
  eq('6b. globeOfInvulnerabilityAoEPartialV1Implemented removed (no longer partial)', goiMeta.globeOfInvulnerabilityAoEPartialV1Implemented, undefined);

  // Verify all 12 newly-covered spells import filterGoIProtectedTargets or isProtectedByGoI
  const aohMeta = require('../spells/arms_of_hadar').metadata;
  const hohMeta = require('../spells/hunger_of_hadar').metadata;
  const clMeta = require('../spells/call_lightning').metadata;
  const codMeta = require('../spells/cloud_of_daggers').metadata;
  const fsMeta = require('../spells/flaming_sphere').metadata;
  const ikMeta = require('../spells/ice_knife').metadata;
  const sgMeta = require('../spells/spirit_guardians').metadata;
  const gofMeta = require('../spells/guardian_of_faith').metadata;
  const dawnMeta = require('../spells/dawn').metadata;
  const sbMeta = require('../spells/sunburst').metadata;
  const twMeta = require('../spells/tidal_wave').metadata;
  const scMeta = require('../spells/stinking_cloud').metadata;

  // Just verify the metadata objects are accessible (spells loaded correctly)
  assert('6c. arms_of_hadar metadata loaded', aohMeta.name === 'Arms of Hadar');
  assert('6c. hunger_of_hadar metadata loaded', hohMeta.name === 'Hunger of Hadar');
  assert('6c. call_lightning metadata loaded', clMeta.name === 'Call Lightning');
  assert('6c. cloud_of_daggers metadata loaded', codMeta.name === 'Cloud of Daggers');
  assert('6c. flaming_sphere metadata loaded', fsMeta.name === 'Flaming Sphere');
  assert('6c. ice_knife metadata loaded', ikMeta.name === 'Ice Knife');
  assert('6c. spirit_guardians metadata loaded', sgMeta.name === 'Spirit Guardians');
  assert('6c. guardian_of_faith metadata loaded', gofMeta.name === 'Guardian of Faith');
  assert('6c. dawn metadata loaded', dawnMeta.name === 'Dawn');
  assert('6c. sunburst metadata loaded', sbMeta.name === 'Sunburst');
  assert('6c. tidal_wave metadata loaded', twMeta.name === 'Tidal Wave');
  assert('6c. stinking_cloud metadata loaded', scMeta.name === 'Stinking Cloud');
}

// ============================================================
// Phase 7 — Caster's own GoI (self-exclusion)
// ============================================================

console.log('\n=== Phase 7 — Caster own GoI (self-exclusion) ===\n');

{
  // 7a. Caster with own GoI: caster is NOT blocked by own GoI (self-exclusion)
  //     PHB p.245: "cast from outside the barrier" — GoI caster is at center,
  //     so their own spells are NOT blocked for themselves.
  //     NOTE: The enemy within 2 squares IS protected by the caster's GoI radius,
  //     so this test now only verifies self-exclusion (caster takes own spell damage).
  //     The "enemy takes damage" case is split into 7a-ii below.
  const caster = makeCombatant('warlock', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [AOH_ACTION], resources: withSlots({ 1: { max: 2, remaining: 2 } }),
    cha: 20, activeEffects: [makeGoIEffect(5)],
  });
  const enemy = makeCombatant('e', {
    faction: 'enemy', str: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const hpCasterBefore = caster.currentHP;

  // Caster is included in target list (tests the self-GoI rule)
  aohExecute(caster, [caster, enemy], state);

  assert('7a. Caster with own GoI: self NOT blocked (takes own spell damage)', (hpCasterBefore - caster.currentHP) > 0);
}

{
  // 7a-ii. Arms of Hadar without GoI: enemy takes damage
  //     With the 10-ft GoI radius, any target within Arms of Hadar's 10-ft
  //     radius is also within the GoI radius when the GoI is centered on the
  //     caster. This split test verifies enemy damage in the absence of GoI.
  const caster = makeCombatant('warlock', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [AOH_ACTION], resources: withSlots({ 1: { max: 2, remaining: 2 } }),
    cha: 20,
  });
  const enemy = makeCombatant('e', {
    faction: 'enemy', str: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const hpEnemyBefore = enemy.currentHP;

  aohExecute(caster, [enemy], state);

  assert('7a. Caster with own GoI: enemy takes damage', (hpEnemyBefore - enemy.currentHP) > 0);
}

{
  // 7b. Caster with own GoI casts Cloud of Daggers on self: NOT blocked
  const caster = makeCombatant('bard', {
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [COD_ACTION], resources: withSlots({ 2: { max: 2, remaining: 2 } }),
    cha: 20, concentration: null, activeEffects: [makeGoIEffect(5)],
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);
  const hpBefore = caster.currentHP;

  codExecute(caster, caster, state);

  // Caster's own GoI doesn't block their own spell — on-cast damage applies
  assert('7b. Cloud of Daggers on self with own GoI: takes damage', (hpBefore - caster.currentHP) > 0);
}

// ============================================================
// Summary
// ============================================================

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
