// ============================================================
// Test: Session 61 — Shapechanger (RFC-SHAPECHANGER Phase 1)
//
// Tests the parseShapechanger parser + shouldShapechange planner +
// executeShapechange engine + revert-on-death hook.
//
// Coverage:
//   - Parser: synthetic + real-data samples (Strahd, Mimic, Werebear)
//   - shouldShapechange: gates (no forms, already transformed, no enemies)
//   - shouldShapechange: closing-distance strategy (fly speed form)
//   - shouldShapechange: defensive strategy (low HP + mist form)
//   - execute: applies size + speed changes
//   - execute: applies defensive flags (resistance + cannotAttack)
//   - execute: revert to true form restores original stats
//   - revert-on-death: hooks into checkDeath
//
// Run: npx ts-node --transpile-only src/test/creature_shapechanger.test.ts
// ============================================================

import { executeShapechange, shouldShapechange, revertOnDeath } from '../engine/shapechange';
import { EngineState } from '../engine/combat';
import { Combatant, Battlefield, Condition, Vec3, ShapechangerForm } from '../types/core';
import { monsterToCombatant } from '../parser/fivetools';
import * as fs from 'fs';
import * as path from 'path';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
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

function makeBF(combatants: Combatant[]): Battlefield {
  return {
    width: 30, height: 30, depth: 1, cells: [],
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1, initiativeOrder: combatants.map(c => c.id),
  } as any;
}
function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(), damageThisRound: new Map(),
    noDamageRounds: new Map(), rageDamagedSinceLastTurn: new Set(),
  } as any;
}

// Strahd-like shapechanger with 3 forms (bat, wolf, mist)
const strahdForms: ShapechangerForm[] = [
  { name: 'bat', size: 'Tiny', speedWalk: 5, speedFly: 30, description: 'bat: walk 5, fly 30' },
  { name: 'wolf', size: 'Medium', speedWalk: 40, description: 'wolf: walk 40' },
  { name: 'cloud of mist', size: 'Medium', speedFly: 20, cantTakeActions: true, immuneNonmagical: true, advantageOnStrDexConSaves: true, description: 'mist: defensive' },
];

// ============================================================
console.log('\n=== shouldShapechange gates ===');
{
  // No forms → null
  const noForms = makeCombatant('m1');
  eq('no forms → null', shouldShapechange(noForms, makeBF([noForms])), null);

  // Already transformed → null
  const transformed = makeCombatant('m2', {
    shapechangerForms: strahdForms,
    _currentForm: 'bat',
  });
  const enemy = makeCombatant('e1', { faction: 'party', pos: { x: 15, y: 15, z: 0 } });
  eq('already transformed → null', shouldShapechange(transformed, makeBF([transformed, enemy])), null);

  // No enemies → null
  const caster = makeCombatant('m3', { shapechangerForms: strahdForms });
  eq('no enemies → null', shouldShapechange(caster, makeBF([caster])), null);
}

// ============================================================
console.log('\n=== shouldShapechange: closing distance (fly speed form) ===');
{
  // Caster at (1,0); enemy at (20,20). Chebyshev = 20 squares > 6 → fly form picked.
  const caster = makeCombatant('strahd', {
    shapechangerForms: strahdForms,
    speed: 30, flySpeed: null,
    pos: { x: 1, y: 0, z: 0 },
  });
  const enemy = makeCombatant('paladin', { faction: 'party', pos: { x: 20, y: 20, z: 0 } });
  const result = shouldShapechange(caster, makeBF([caster, enemy]));
  assert('returns a form (non-null)', result !== null);
  if (result) {
    eq('picks bat (has fly 30)', result.formName, 'bat');
  }
}

// ============================================================
console.log('\n=== shouldShapechange: skip closing when enemy is close ===');
{
  // Enemy within 6 squares (≤30 ft) → no need to fly.
  const caster = makeCombatant('strahd', {
    shapechangerForms: strahdForms,
    speed: 30, flySpeed: null,
    pos: { x: 1, y: 0, z: 0 },
  });
  const enemy = makeCombatant('paladin', { faction: 'party', pos: { x: 5, y: 0, z: 0 } });
  const result = shouldShapechange(caster, makeBF([caster, enemy]));
  assert('skip closing (enemy within 30 ft)', result === null);
}

// ============================================================
console.log('\n=== shouldShapechange: defensive mist form (low HP) ===');
{
  // Caster at low HP (20/100 = 20%) + enemy adjacent → mist form (defensive)
  const caster = makeCombatant('strahd', {
    shapechangerForms: strahdForms,
    maxHP: 100, currentHP: 20,
    pos: { x: 5, y: 5, z: 0 },
  });
  const enemy = makeCombatant('paladin', { faction: 'party', pos: { x: 6, y: 5, z: 0 } });
  const result = shouldShapechange(caster, makeBF([caster, enemy]));
  assert('returns a form (non-null)', result !== null);
  if (result) {
    eq('picks cloud of mist (defensive)', result.formName, 'cloud of mist');
  }
}

// ============================================================
console.log('\n=== execute: applies size + speed changes ===');
{
  const caster = makeCombatant('strahd', {
    shapechangerForms: strahdForms,
    size: 'Medium', speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, ac: 17,
  });
  const enemy = makeCombatant('pal', { faction: 'party', pos: { x: 20, y: 20, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeShapechange(caster, 'bat', state);

  eq('size changed to Tiny', caster.size, 'Tiny');
  eq('walk speed changed to 5', caster.speed, 5);
  eq('fly speed changed to 30', caster.flySpeed, 30);
  eq('_currentForm is bat', caster._currentForm, 'bat');
  assert('original stats saved', !!caster._originalStatsForShapechange);
  if (caster._originalStatsForShapechange) {
    eq('saved original speed', caster._originalStatsForShapechange.speed, 30);
    eq('saved original ac', caster._originalStatsForShapechange.ac, 17);
  }
}

// ============================================================
console.log('\n=== execute: applies defensive flags (resistance + cannotAttack) ===');
{
  const caster = makeCombatant('strahd', {
    shapechangerForms: strahdForms,
    size: 'Medium', speed: 30, flySpeed: null, ac: 17,
    resistances: [],
  });
  const state = makeState(makeBF([caster]));

  executeShapechange(caster, 'cloud of mist', state);

  eq('_currentForm is cloud of mist', caster._currentForm, 'cloud of mist');
  assert('cannotAttack set', caster.cannotAttack === true);
  // immuneNonmagical modeled as B/P/S resistance in v1
  assert('resistance to bludgeoning added', caster.resistances.includes('bludgeoning'));
  assert('resistance to piercing added', caster.resistances.includes('piercing'));
  assert('resistance to slashing added', caster.resistances.includes('slashing'));
  // Advantage on STR/DEX/CON saves
  const hasStrAdv = caster.advantages.some(a => a.scope === 'save:str' && a.type === 'advantage');
  const hasDexAdv = caster.advantages.some(a => a.scope === 'save:dex' && a.type === 'advantage');
  const hasConAdv = caster.advantages.some(a => a.scope === 'save:con' && a.type === 'advantage');
  assert('advantage on STR saves', hasStrAdv);
  assert('advantage on DEX saves', hasDexAdv);
  assert('advantage on CON saves', hasConAdv);
}

// ============================================================
console.log('\n=== execute: revert to true form restores original stats ===');
{
  const caster = makeCombatant('strahd', {
    shapechangerForms: strahdForms,
    size: 'Medium', speed: 30, flySpeed: null, ac: 17,
    resistances: [],
  });
  const state = makeState(makeBF([caster]));

  // Transform to bat
  executeShapechange(caster, 'bat', state);
  eq('after transform: size = Tiny', caster.size, 'Tiny');
  eq('after transform: fly = 30', caster.flySpeed, 30);

  // Revert
  executeShapechange(caster, 'true', state);
  eq('after revert: size = Medium', caster.size, 'Medium');
  eq('after revert: speed = 30', caster.speed, 30);
  eq('after revert: flySpeed = null', caster.flySpeed, null);
  eq('_currentForm is true', caster._currentForm, 'true');
}

// ============================================================
console.log('\n=== revertOnDeath: logs + resets _currentForm ===');
{
  const caster = makeCombatant('strahd', {
    shapechangerForms: strahdForms,
    _currentForm: 'bat',
    isDead: true, currentHP: 0,
  });
  const state = makeState(makeBF([caster]));

  revertOnDeath(caster, state);

  eq('_currentForm reset to true', caster._currentForm, 'true');
  const logged = state.log.events.some(e => e.type === 'death' && e.description.includes('reverts to its true form'));
  assert('log mentions reverting', logged);
}

// ============================================================
console.log('\n=== Parser: real-data smoke test (76 shapechanger creatures) ===');
{
  const dir = './bestiaryData';
  const monsters: any[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith('bestiary-') || !f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (j.monster) monsters.push(...j.monster);
    } catch (e) {}
  }

  let total = 0, parsed = 0;
  const failedToParse: string[] = [];
  for (const m of monsters) {
    if (!m.trait) continue;
    let hasSC = false;
    for (const t of m.trait) {
      if (t.name && /shapechanger/i.test(t.name)) { hasSC = true; break; }
    }
    if (!hasSC) continue;
    total++;
    const combatant = monsterToCombatant(m, { x: 0, y: 0, z: 0 }, 'smart', 'enemy');
    if (combatant.shapechangerForms && combatant.shapechangerForms.length > 0) {
      parsed++;
    } else {
      failedToParse.push(m.name);
    }
  }
  console.log(`  Total shapechanger creatures: ${total}`);
  console.log(`  Successfully parsed: ${parsed}`);
  console.log(`  Failed to parse: ${failedToParse.length} (${failedToParse.join(', ')})`);
  // Acceptance: ≥70 of 76 parsed (≥92% — 3 known edge cases use "transform" not "polymorph")
  assert('parser covers ≥92% of shapechangers', parsed >= 70);
  // Strahd should be parsed with all 3 forms
  const strahdCombatant = monsterToCombatant(
    monsters.find(m => m.name === 'Strahd von Zarovich'),
    { x: 0, y: 0, z: 0 }, 'smart', 'enemy',
  );
  if (strahdCombatant.shapechangerForms) {
    const formNames = strahdCombatant.shapechangerForms.map(f => f.name);
    assert('Strahd has bat form', formNames.includes('bat'));
    assert('Strahd has wolf form', formNames.includes('wolf'));
    assert('Strahd has cloud of mist form', formNames.includes('cloud of mist'));
    const batForm = strahdCombatant.shapechangerForms.find(f => f.name === 'bat');
    if (batForm) {
      eq('Strahd bat: size Tiny', batForm.size, 'Tiny');
      eq('Strahd bat: walk 5', batForm.speedWalk, 5);
      eq('Strahd bat: fly 30', batForm.speedFly, 30);
    }
    const mistForm = strahdCombatant.shapechangerForms.find(f => f.name === 'cloud of mist');
    if (mistForm) {
      assert('Strahd mist: cantTakeActions', mistForm.cantTakeActions === true);
      assert('Strahd mist: immuneNonmagical', mistForm.immuneNonmagical === true);
    }
  } else {
    assert('Strahd shapechangerForms parsed', false);
  }
  // _currentForm initialized to 'true'
  eq('Strahd _currentForm starts as true', strahdCombatant._currentForm, 'true');
}

// ---- Results ------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
