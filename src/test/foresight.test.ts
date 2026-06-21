// ============================================================
// foresight.test.ts — Foresight spell module
// PHB p.244: 9th-level divination, 1 action (canon 1 min), range Touch (5 ft),
// canon 8-hr duration (v1: concentration). Effect: target gains advantage on
// ALL d20 rolls + enemies have disadvantage vs them (enemies-disadv NOT modelled).
//
// Tests cover metadata shape, shouldCast() precondition gates, execute()
// advantage application via querySelf() helper (scope 'all'), slot
// consumption, concentration start, sourceIsConcentration flag,
// concentration-break cleanup, the TOUCH-range (5ft) restriction, the
// maxTargets=1 cap, the narrow-scope sentinel (NO harmful attacker-adv
// side-effect via queryVulnerability), and the cleanup() no-op.
// ============================================================

import { shouldCast, execute, metadata, cleanup } from '../spells/foresight';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { querySelf, queryVulnerability } from '../engine/adv_system';
import { Combatant, Battlefield, Action, PlayerResources } from '../types/core';
import { EngineState, CombatLog } from '../engine/combat';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Factories ----------------------------------------------

const FORESIGHT_ACTION: Action = {
  name: 'Foresight',
  isMultiattack: false,
  attackType: 'special',
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false, // canon: no concentration (8 hr); v1 simplifies to conc
  slotLevel: 9,
  costType: 'action',
  legendaryCost: 0,
  description: 'Foresight',
};

function withSlots9(remaining = 1): PlayerResources {
  return { spellSlots: { 9: { max: 1, remaining } } };
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 30, currentHP: 30, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'aggressive' as any,
    perception: { knownEnemyPositions: new Map(), lastSeenPositions: new Map() } as any,
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

function makeCaster(id: string, pos = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    faction: 'party',
    pos,
    actions: [{ ...FORESIGHT_ACTION }],
    resources: withSlots9(1),
  });
}

function makeAlly(id: string, pos = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { faction: 'party', pos });
}

function makeEnemy(id: string, pos = { x: 10, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { faction: 'enemy', pos });
}

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

function makeState(bf: Battlefield): EngineState {
  const log: CombatLog = { events: [], winner: null, rounds: 0 };
  return {
    battlefield: bf,
    log,
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// =============================================================
// Section 1 — Metadata
// =============================================================

console.log('\n--- Section 1: Metadata ---');

eq('1: name is Foresight', metadata.name, 'Foresight');
eq('1: level is 9', metadata.level, 9);
eq('1: school is divination', metadata.school, 'divination');
eq('1: rangeFt is 5 (Touch)', metadata.rangeFt, 5);
eq('1: concentration true (v1 simplification)', metadata.concentration, true);
eq('1: castingTime action (v1 simplification)', metadata.castingTime, 'action');
eq('1: maxTargets 1', metadata.maxTargets, 1);
eq('1: canon flag set', (metadata as any).foresightCanonV1Implemented, true);
eq('1: enemies-disadv not-modelled flag set', (metadata as any).foresightEnemiesDisadvV1NotModelled, true);
eq('1: 8hr-duration simplified flag set', (metadata as any).foresight8hrDurationV1SimplifiedToConc, true);

// =============================================================
// Section 2 — shouldCast gates
// =============================================================

console.log('\n--- Section 2: shouldCast gates ---');

{
  // 2a: returns targets when caster + ally in Touch range
  const caster = makeCaster('wizard');
  const ally   = makeAlly('fighter', { x: 1, y: 0, z: 0 }); // 5 ft
  const bf     = makeBF([caster, ally]);
  const targets = shouldCast(caster, bf);
  assert('2a: returns targets when in Touch range', targets !== null && targets.length >= 1);
}

{
  // 2b: caster can target self when alone (Touch range includes self at 0 ft)
  const caster = makeCaster('wizard');
  const bf     = makeBF([caster]);
  const targets = shouldCast(caster, bf);
  assert('2b: caster can target self alone', targets !== null);
  assert('2b: self is first target', targets![0].id === 'wizard');
}

{
  // 2c: returns null when already concentrating
  const caster = makeCaster('wizard');
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const ally = makeAlly('fighter');
  const bf   = makeBF([caster, ally]);
  assert('2c: null when concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d: returns null when no Foresight action
  const caster = makeCaster('wizard');
  caster.actions = [];
  const ally = makeAlly('fighter');
  const bf   = makeBF([caster, ally]);
  assert('2d: null when no Foresight action', shouldCast(caster, bf) === null);
}

{
  // 2e: returns null when no 9th-level slots remaining
  const caster = makeCaster('wizard');
  caster.resources = withSlots9(0);
  const ally = makeAlly('fighter');
  const bf   = makeBF([caster, ally]);
  assert('2e: null when slots exhausted', shouldCast(caster, bf) === null);
}

{
  // 2f: ally beyond Touch range (5ft) is excluded (x=2 → 10ft)
  const caster  = makeCaster('wizard', { x: 0, y: 0, z: 0 });
  const farAlly = makeAlly('paladin', { x: 2, y: 0, z: 0 }); // 10 ft > 5 ft
  const bf      = makeBF([caster, farAlly]);
  const targets = shouldCast(caster, bf);
  // Caster self is still a valid target (dist 0)
  assert('2f: far ally excluded from targets',
    targets === null || !targets.some(t => t.id === 'paladin'));
}

{
  // 2g: max 1 target — even with caster + 2 allies in Touch range, only 1 returned
  // (Self at 0ft, ally1 at 0ft, ally2 at 1ft — but allies at exactly caster.pos
  //  would have dist 0; here we put ally1 at {x:1} = 5ft and ally2 at {x:0,y:1} = 5ft.
  //  All within Touch range. The slice(0, 1) returns just the first = caster self.)
  const caster = makeCaster('wizard', { x: 0, y: 0, z: 0 });
  const ally1  = makeAlly('a1', { x: 1, y: 0, z: 0 }); // 5ft
  const ally2  = makeAlly('a2', { x: 0, y: 1, z: 0 }); // 5ft
  const bf     = makeBF([caster, ally1, ally2]);
  const targets = shouldCast(caster, bf);
  assert('2g: max 1 target returned', targets !== null && targets.length === 1);
  // Self is prioritized first
  eq('2g: self is the chosen target', targets![0].id, 'wizard');
}

{
  // 2h: enemy in Touch range is NOT a target (faction check)
  const caster = makeCaster('wizard');
  const enemy  = makeEnemy('goblin', { x: 1, y: 0, z: 0 }); // 5ft
  const bf     = makeBF([caster, enemy]);
  const targets = shouldCast(caster, bf);
  // Caster self is a valid target, but enemy is NOT
  assert('2h: enemy not in target list',
    targets === null || !targets.some(t => t.id === 'goblin'));
}

// =============================================================
// Section 3 — execute pipeline
// =============================================================

console.log('\n--- Section 3: execute pipeline ---');

{
  // 3a: consumes a 9th-level spell slot
  const caster = makeCaster('wizard');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  const slotsBefore = caster.resources!.spellSlots![9].remaining;
  execute(caster, [ally], state);
  const slotsAfter = caster.resources!.spellSlots![9].remaining;
  eq('3a: slot consumed', slotsAfter, slotsBefore - 1);
}

{
  // 3b: concentration started on Foresight (v1 simplification)
  const caster = makeCaster('wizard');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [ally], state);

  assert('3b: concentration.active true (v1 simplification)',
    caster.concentration?.active === true);
  eq('3b: concentration.spellName', caster.concentration?.spellName, 'Foresight');
}

{
  // 3c: advantage on ALL d20 rolls applied to target via grantSelf(scope='all')
  const caster = makeCaster('wizard');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [ally], state);

  // querySelf returns advantage=true for ALL scopes (general 'all' covers everything)
  assert('3c: ally has attack advantage',       querySelf(ally, 'attack').advantage      === true);
  assert('3c: ally has attack:melee advantage', querySelf(ally, 'attack:melee').advantage === true);
  assert('3c: ally has save advantage',         querySelf(ally, 'save').advantage         === true);
  assert('3c: ally has save:wis advantage',     querySelf(ally, 'save:wis').advantage     === true);
  assert('3c: ally has ability advantage',      querySelf(ally, 'ability').advantage      === true);
  assert('3c: ally has ability:str advantage',  querySelf(ally, 'ability:str').advantage  === true);
}

{
  // 3d: NO harmful attacker-advantage side-effect — the sentinel uses narrow
  //     scope 'save' (NOT 'all') so queryVulnerability(target, 'attack')
  //     returns false. (If we had used 'all' as sentinel scope, attackers
  //     would get advantage vs the Foresight-buffed ally — opposite of canon.)
  const caster = makeCaster('wizard');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [ally], state);

  const vulnAtk = queryVulnerability(ally, 'attack');
  assert('3d: NO attacker advantage vs Foresight-buffed ally',
    vulnAtk.advantage === false,
    `got vulnAtk=${JSON.stringify(vulnAtk)}`);
}

{
  // 3e: advantage_vs sentinel effect applied with sourceIsConcentration true.
  //     The sentinel's advScope is 'save' (NOT 'all') — see 3d.
  const caster = makeCaster('wizard');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [ally], state);

  const effect = ally.activeEffects.find(e => e.spellName === 'Foresight');
  assert('3e: ally has Foresight activeEffect', effect !== undefined);
  eq('3e: effectType is advantage_vs', effect?.effectType, 'advantage_vs');
  eq('3e: advType is advantage', effect?.payload.advType, 'advantage');
  eq('3e: sentinel advScope is save (NOT all — see 3d)', effect?.payload.advScope, 'save');
  assert('3e: sourceIsConcentration true', effect?.sourceIsConcentration === true);
  eq('3e: casterId matches caster', effect?.casterId, 'wizard');
}

{
  // 3f: action + condition_add events logged
  const caster = makeCaster('wizard');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [ally], state);

  const actionEvt = state.log.events.find(
    e => e.type === 'action' && e.description.includes('Foresight'));
  assert('3f: action event logged for cast', actionEvt !== undefined);

  const condEvts = state.log.events.filter(e => e.type === 'condition_add');
  assert('3f: condition_add event for target', condEvts.length >= 1);
}

{
  // 3g: concentration break removes both advantage and the sentinel effect
  const caster = makeCaster('wizard');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [ally], state);

  assert('3g: ally attack advantage present before break',
    querySelf(ally, 'attack').advantage === true);
  assert('3g: ally save advantage present before break',
    querySelf(ally, 'save').advantage === true);
  assert('3g: ally has activeEffect before break',
    ally.activeEffects.some(e => e.spellName === 'Foresight'));

  removeEffectsFromCaster(caster.id, bf);
  caster.concentration = null;

  assert('3g: ally attack advantage gone after break',
    querySelf(ally, 'attack').advantage === false);
  assert('3g: ally save advantage gone after break',
    querySelf(ally, 'save').advantage === false);
  assert('3g: ally activeEffect gone after break',
    !ally.activeEffects.some(e => e.spellName === 'Foresight'));
}

// =============================================================
// Section 4 — cleanup no-op
// =============================================================

console.log('\n--- Section 4: cleanup no-op ---');

{
  const caster = makeCaster('wizard');
  caster.concentration = { active: true, spellName: 'Foresight', dcIfHit: 10 };
  cleanup(caster);
  eq('4: cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('4: cleanup does NOT change spellName', caster.concentration?.spellName, 'Foresight');
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
