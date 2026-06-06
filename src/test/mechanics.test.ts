// ============================================================
// Test: Phase 4 Mechanics
// Concentration, Death Saves, Sneak Attack, Pack Tactics, Temp HP
// Run: ts-node src/test/mechanics.test.ts
// ============================================================

import {
  startConcentration, breakConcentration, rollConcentrationSave,
  rollDeathSave, grantTempHP, applyDamageWithTempHP,
  canSneakAttack, sneakAttackDice, hasPackTacticsAdvantage,
  applyDamage, applyHeal, abilityMod
} from '../engine/utils';
import { Combatant, Action, Battlefield } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Factory ------------------------------------------------

let _id = 0;
function makeC(o: Partial<Combatant> = {}): Combatant {
  return {
    id: `c${++_id}`, name: `c${_id}`, isPlayer: false, faction: 'enemy',
    maxHP: 20, currentHP: 20, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 14, con: 14, int: 10, wis: 10, cha: 10,
    cr: 1, pos: {x:0,y:0,z:0},
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    concentration: null,
    deathSaves: null,
    mountedOn: null,
    carriedBy: null,
    independentMount: false,
    role: 'regular',
    bonded: null,
    resources: null,
    tempHP: 0,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false,
    cannotAttack: false,
    hasHands: false,
    aiProfile: 'smart',
    perception: { targets: new Map() },
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [],
    ...o,
  };
}

function makeBF(combatants: Combatant[]): Pick<Battlefield, 'combatants'> {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return { combatants: map };
}

function makeAction(o: Partial<Action> = {}): Action {
  return {
    name: 'Shortsword', isMultiattack: false, attackType: 'melee', reach: 5,
    range: null, hitBonus: 4, damage: { count: 1, sides: 6, bonus: 3, average: 6 },
    damageType: 'piercing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false, costType: 'action', legendaryCost: 0, description: '',
    ...o,
  };
}

// ============================================================
// 1. Concentration
// ============================================================
console.log('\n=== 1. Concentration ===\n');

{
  const caster = makeC({ con: 14 }); // CON mod +2

  // Start concentration
  startConcentration(caster, 'Bless');
  assert('Concentration active', caster.concentration?.active === true);
  eq('Spell name recorded', caster.concentration?.spellName, 'Bless');

  // Replacing concentration with new spell — caster responsibility
  startConcentration(caster, 'Hold Person');
  eq('New spell replaces old', caster.concentration?.spellName, 'Hold Person');

  // Break concentration
  breakConcentration(caster);
  assert('Concentration cleared', caster.concentration === null);

  // Roll save — guaranteed success on DC 10 with +2 CON and enough runs
  startConcentration(caster, 'Entangle');
  let saves = 0, breaks = 0;
  for (let i = 0; i < 100; i++) {
    const c2 = makeC({ con: 20 }); // +5 CON → will almost always succeed DC 10
    startConcentration(c2, 'Test');
    const maintained = rollConcentrationSave(c2, 10); // DC 10
    if (maintained) saves++;
    else breaks++;
  }
  // CON +5 vs DC 10: need 5+ on d20 → hits on 16/20 = 80%; allow wide range
  assert('High CON concentration save: mostly succeeds', saves >= 65,
    `saves=${saves}/100`);

  // High damage → high DC → harder to maintain
  let highDCSaves = 0;
  for (let i = 0; i < 100; i++) {
    const c3 = makeC({ con: 10 }); // +0 CON
    startConcentration(c3, 'Test');
    const maintained = rollConcentrationSave(c3, 40); // DC 20 (half of 40)
    if (maintained) highDCSaves++;
  }
  assert('CON+0 vs DC 20: some fails', highDCSaves < 60,
    `saves=${highDCSaves}/100 (need <60)`);

  // Not concentrating: save always returns true
  const nonConcentrating = makeC();
  const result = rollConcentrationSave(nonConcentrating, 50);
  assert('Non-concentrating: save trivially true', result === true);
}

// ============================================================
// 2. Death Saving Throws
// ============================================================
console.log('\n=== 2. Death Saving Throws ===\n');

{
  // Monsters don't make death saves
  const monster = makeC({ isPlayer: false, deathSaves: null });
  monster.currentHP = 0;
  monster.isUnconscious = true;
  const result = rollDeathSave(monster);
  eq('Monster: rollDeathSave returns ongoing', result, 'ongoing');
  assert('Monster deathSaves stays null', monster.deathSaves === null);

  // PC setup
  function makeDownedPC(): Combatant {
    const pc = makeC({
      isPlayer: true,
      currentHP: 0,
      isUnconscious: true,
      deathSaves: { successes: 0, failures: 0 },
    });
    pc.conditions.add('unconscious');
    return pc;
  }

  // 3 successes = stable
  const stablePC = makeDownedPC();
  stablePC.deathSaves!.successes = 2; // need one more
  // Force a roll ≥ 10 by mocking — run many times until we get 'stable'
  let gotStable = false;
  for (let i = 0; i < 50; i++) {
    const pc2 = makeDownedPC();
    pc2.deathSaves!.successes = 2;
    if (rollDeathSave(pc2) === 'stable') {
      gotStable = true;
      // nat 20 also returns 'stable' but wakes the PC; 3-success stable keeps unconscious
      // Either case is valid — just verify deathSaves were reset
      assert('Stable: deathSaves reset to 0/0', pc2.deathSaves?.successes === 0 && pc2.deathSaves?.failures === 0);
      break;
    }
  }
  assert('3 successes → stable (seen in 50 rolls)', gotStable);

  // 3 failures = dead
  let gotDead = false;
  for (let i = 0; i < 50; i++) {
    const pc3 = makeDownedPC();
    pc3.deathSaves!.failures = 2;
    if (rollDeathSave(pc3) === 'dead') {
      gotDead = true;
      assert('Dead: isDead set', pc3.isDead);
      break;
    }
  }
  assert('3 failures → dead (seen in 50 rolls)', gotDead);

  // nat 20: regain 1 HP
  let gotNat20 = false;
  for (let i = 0; i < 100; i++) {
    const pc4 = makeDownedPC();
    if (rollDeathSave(pc4) === 'stable' && pc4.currentHP > 0) {
      gotNat20 = true;
      eq('nat 20: regain exactly 1 HP', pc4.currentHP, 1);
      assert('nat 20: no longer unconscious', !pc4.isUnconscious);
      break;
    }
  }
  assert('nat 20 revives with 1 HP (seen in 100 rolls)', gotNat20);

  // Ongoing: normal roll (mixed)
  const ongoing = makeDownedPC();
  const r = rollDeathSave(ongoing);
  assert('Result is valid enum', ['stable','dead','ongoing'].includes(r));
}

// ============================================================
// 3. Temporary HP
// ============================================================
console.log('\n=== 3. Temporary HP ===\n');

{
  const target = makeC({ maxHP: 20, currentHP: 20 });

  // Grant temp HP
  grantTempHP(target, 5);
  eq('TempHP set to 5', target.tempHP, 5);

  // Temp HP doesn't stack — take higher
  grantTempHP(target, 3);
  eq('TempHP stays 5 (higher wins)', target.tempHP, 5);
  grantTempHP(target, 8);
  eq('TempHP updates to 8 (new is higher)', target.tempHP, 8);

  // Damage absorbs temp HP first
  const dealt = applyDamageWithTempHP(target, 5);
  eq('5 dmg: 0 real HP lost', target.currentHP, 20);
  eq('TempHP reduced to 3', target.tempHP, 3);
  eq('Dealt 5 total', dealt, 5);

  // Overflow into real HP
  const dealt2 = applyDamageWithTempHP(target, 7);
  eq('7 dmg overflows: tempHP=0', target.tempHP, 0);
  eq('Real HP reduced by 4', target.currentHP, 16);
  eq('Dealt 7 total', dealt2, 7);

  // No temp HP: behaves like normal applyDamage
  const noTemp = makeC({ maxHP: 10, currentHP: 10 });
  applyDamageWithTempHP(noTemp, 4);
  eq('No tempHP: normal damage applied', noTemp.currentHP, 6);
}

// ============================================================
// 4. Sneak Attack
// ============================================================
console.log('\n=== 4. Sneak Attack ===\n');

{
  const rogue = makeC({ usedSneakAttackThisTurn: false });
  const shortsword = makeAction({ name: 'Shortsword', attackType: 'melee' });
  const greataxe   = makeAction({ name: 'Greataxe',   attackType: 'melee' });
  const shortbow   = makeAction({ name: 'Shortbow',   attackType: 'ranged' });

  // Finesse weapon + advantage → SA
  assert('Shortsword + adv → SA', canSneakAttack(rogue, shortsword, true, false, false));

  // Finesse weapon + ally adjacent → SA (no advantage needed)
  assert('Shortsword + ally adj → SA', canSneakAttack(rogue, shortsword, false, false, true));

  // Ranged + advantage → SA
  assert('Shortbow + adv → SA', canSneakAttack(rogue, shortbow, true, false, false));

  // Non-finesse melee (Greataxe) → no SA even with advantage
  assert('Greataxe + adv → no SA', !canSneakAttack(rogue, greataxe, true, false, false));

  // Disadvantage blocks SA even with ally adjacent
  assert('Disadv + ally adj → no SA', !canSneakAttack(rogue, shortsword, false, true, true));

  // Once per turn
  const rogueUsed = makeC({ usedSneakAttackThisTurn: true });
  assert('Already used SA this turn → no SA', !canSneakAttack(rogueUsed, shortsword, true, false, false));

  // Neither advantage nor ally → no SA
  assert('No adv, no ally → no SA', !canSneakAttack(rogue, shortsword, false, false, false));

  // Sneak Attack dice by level
  const d1 = sneakAttackDice(1);
  eq('Level 1 SA: 1d6', d1.count, 1);
  eq('Level 1 SA: d6', d1.sides, 6);
  eq('Level 1 SA: average 3', d1.average, 3);

  const d3 = sneakAttackDice(3);
  eq('Level 3 SA: 2d6', d3.count, 2);

  const d5 = sneakAttackDice(5);
  eq('Level 5 SA: 3d6', d5.count, 3);
}

// ============================================================
// 5. Pack Tactics
// ============================================================
console.log('\n=== 5. Pack Tactics ===\n');

{
  const wolf   = makeC({ id: 'wolf1', faction: 'enemy', traits: ['Pack Tactics'], pos: {x:0,y:0,z:0} });
  const target = makeC({ id: 'target', faction: 'party', pos: {x:1,y:0,z:0} });

  // Ally adjacent to target
  const allyAdj = makeC({ id: 'wolf2', faction: 'enemy', pos: {x:1,y:1,z:0} }); // adjacent to target
  const bf1 = makeBF([wolf, target, allyAdj]);
  assert('Pack Tactics: ally adjacent to target → advantage', hasPackTacticsAdvantage(wolf, target, bf1 as Battlefield));

  // No ally adjacent to target
  const allyFar = makeC({ id: 'wolf3', faction: 'enemy', pos: {x:8,y:8,z:0} });
  const bf2 = makeBF([wolf, target, allyFar]);
  assert('Pack Tactics: no ally adjacent → no advantage', !hasPackTacticsAdvantage(wolf, target, bf2 as Battlefield));

  // Ally incapacitated — doesn't count
  const allyInc = makeC({ id: 'wolf4', faction: 'enemy', pos: {x:1,y:1,z:0} });
  allyInc.conditions.add('incapacitated');
  const bf3 = makeBF([wolf, target, allyInc]);
  assert('Pack Tactics: incapacitated ally → no advantage', !hasPackTacticsAdvantage(wolf, target, bf3 as Battlefield));

  // No Pack Tactics trait — never grants advantage
  const plainWolf = makeC({ id: 'plain', faction: 'enemy', traits: [], pos: {x:0,y:0,z:0} });
  const bf4 = makeBF([plainWolf, target, allyAdj]);
  assert('No Pack Tactics trait → no advantage', !hasPackTacticsAdvantage(plainWolf, target, bf4 as Battlefield));

  // Wolf itself doesn't count as "ally adjacent"
  const soloWolf = makeC({ id: 'solo', faction: 'enemy', traits: ['Pack Tactics'], pos: {x:1,y:1,z:0} });
  const bf5 = makeBF([soloWolf, target]);
  assert('Pack Tactics: no other ally → no advantage', !hasPackTacticsAdvantage(soloWolf, target, bf5 as Battlefield));
}

// ============================================================
// SH-1: Grapple / Shove / Size / Escape tests
// ============================================================
import { sizeRank, canGrappleOrShoveTarget, rollGrappleContest } from '../engine/utils';
import { CreatureSize } from '../types/core';
import { planTurn } from '../ai/planner';

{
  console.log('\n── SH-1: Size rank ──');
  const sizes: CreatureSize[] = ['Tiny','Small','Medium','Large','Huge','Gargantuan'];
  const ranks = sizes.map(sizeRank);
  assert('Size rank ascending', JSON.stringify(ranks) === '[0,1,2,3,4,5]');
  assert('undefined → 2 (Medium)', sizeRank(undefined) === 2);
}

{
  console.log('\n── SH-1: canGrappleOrShoveTarget ──');
  const medium = makeC({ size: 'Medium' });
  const large  = makeC({ size: 'Large'  });
  const huge   = makeC({ size: 'Huge'   });
  const small  = makeC({ size: 'Small'  });

  assert('Medium can grapple Medium',  canGrappleOrShoveTarget(medium, medium));
  assert('Medium can grapple Large',   canGrappleOrShoveTarget(medium, large));
  assert('Medium cannot grapple Huge', !canGrappleOrShoveTarget(medium, huge));
  assert('Small can grapple Medium',   canGrappleOrShoveTarget(small, medium));
  assert('Small cannot grapple Large', !canGrappleOrShoveTarget(small, large));
  assert('Huge can grapple Medium',    canGrappleOrShoveTarget(huge, medium));
}

{
  console.log('\n── SH-1: Grapple condition applied ──');
  // Deterministic: override rollGrappleContest by giving attacker overwhelming STR
  const attacker = makeC({ str: 30, dex: 10, id: 'att', faction: 'party', aiProfile: 'smart' });
  const defender = makeC({ str: 8,  dex: 8,  id: 'def', faction: 'enemy'  });
  // rollGrappleContest is probabilistic — run 20 times, expect at least 15 successes
  let wins = 0;
  for (let i = 0; i < 20; i++) {
    defender.conditions = new Set(); // reset each time
    if (rollGrappleContest(attacker, defender)) wins++;
  }
  assert('STR 30 vs STR 8: grapple wins >14/20 runs', wins > 14, `won ${wins}/20`);
}

{
  console.log('\n── SH-1: Grapple escape planning (smart AI) ──');
  const grapplerC = makeC({ id: 'grp', faction: 'enemy',  pos: {x:0,y:0,z:0}, aiProfile: 'smart' });
  const victim    = makeC({ id: 'vic', faction: 'party', pos: {x:1,y:0,z:0}, aiProfile: 'smart',
    str: 10, dex: 10 });
  victim.conditions.add('grappled');
  victim.grappledBy = grapplerC.id;

  // makeBF helper already exists in this file
  const bf = makeBF([victim, grapplerC]);
  victim.budget = { movementFt: 0, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  const plan = planTurn(victim, bf as Battlefield);
  assert('Grappled smart AI plans escapeGrapple', plan.action?.type === 'escapeGrapple',
    `got ${plan.action?.type}`);
  assert('escapeGrapple targetId = grappler id', plan.action?.targetId === grapplerC.id);
}

{
  console.log('\n── SH-1: Grapple escape planning (nearest AI) ──');
  const grapplerN = makeC({ id: 'grp2', faction: 'enemy',  pos: {x:5,y:5,z:0}, aiProfile: 'attackNearest' });
  const victimN   = makeC({ id: 'vic2', faction: 'party', pos: {x:0,y:0,z:0}, aiProfile: 'attackNearest',
    str: 10, dex: 10, speed: 30 });
  victimN.conditions.add('grappled');
  victimN.grappledBy = grapplerN.id;

  // Enemy is far away, speed=0 due to grapple → nearest AI should escape
  const bf2 = makeBF([victimN, grapplerN]);
  victimN.budget = { movementFt: 0, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  const plan2 = planTurn(victimN, bf2 as Battlefield);
  assert('Grappled nearest AI escapes when enemy out of reach', plan2.action?.type === 'escapeGrapple',
    `got ${plan2.action?.type}`);
}

{
  console.log('\n── SH-1: Auto-release when grappler already gone ──');
  // grappledBy ID doesn't exist in the battlefield (grappler already dead/removed)
  const victimG = makeC({ id: 'vic3', faction: 'party', pos: {x:0,y:0,z:0}, aiProfile: 'smart',
    str: 10, dex: 10 });
  victimG.conditions.add('grappled');
  victimG.grappledBy = 'gone-id'; // ID not present in battlefield

  const bf3 = makeBF([victimG]);
  victimG.budget = { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  const plan3 = planTurn(victimG, bf3 as Battlefield);
  // Should still plan escapeGrapple (combat.ts will auto-clear it)
  assert('Grappled with gone grappler → escapeGrapple planned', plan3.action?.type === 'escapeGrapple');
}


console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
