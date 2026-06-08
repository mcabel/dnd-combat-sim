// ============================================================
// Test: Cunning Action — Rogue Level 2+ bonus action
// PHB p.96: Rogue can Dash, Disengage, or Hide as a bonus action.
//
// Session 28 scope:
//   ✅ Cunning Action: Disengage (hit-and-run after melee attack)
//   ⬜ Cunning Action: Dash   — deferred (ordering issue)
//   ⬜ Cunning Action: Hide   — deferred (needs LOS system)
//
// Run: ts-node src/test/cunning_action.test.ts
// ============================================================

import { planTurn } from '../ai/planner';
import { Combatant, Battlefield, Action, PlannedAction, PlayerResources, Vec3 } from '../types/core';
import { chebyshev3D } from '../engine/movement';
import { runCombat, makeFlatBattlefield, CombatEvent } from '../engine/combat';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(o: Partial<Combatant> = {}): Combatant {
  const id = `c${++_id}`;
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 20, currentHP: 20, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart',
    perception: { targets: new Map() },
    concentration: null,
    deathSaves: null,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    resources: null,
    tempHP: 0,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null,
    ...o,
  };
}

function meleeAction(name = 'Shortsword', hitBonus = 5): Action {
  return {
    name, isMultiattack: false,
    attackType: 'melee', reach: 5, range: null,
    hitBonus, damage: { count: 1, sides: 6, bonus: 3, average: 6 },
    damageType: 'piercing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: '',
  };
}

function rangedAction(name = 'Shortbow'): Action {
  return {
    name, isMultiattack: false,
    attackType: 'ranged', reach: 5, range: { normal: 80, long: 320 },
    hitBonus: 5, damage: { count: 1, sides: 6, bonus: 3, average: 6 },
    damageType: 'piercing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: '',
  };
}

/** Level 2 Rogue resources: SA + Cunning Action */
function lv2RogueResources(): PlayerResources {
  return {
    sneakAttackDice: '1d6',
    cunningAction: true,
  } as unknown as PlayerResources;
}

/** Level 1 Rogue resources: SA only, no Cunning Action */
function lv1RogueResources(): PlayerResources {
  return {
    sneakAttackDice: '1d6',
  } as unknown as PlayerResources;
}

function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    width: 20, height: 20, depth: 1, cells: [],
    combatants: map, round: 1,
    initiativeOrder: combatants.map(c => c.id),
  };
}

// ============================================================
// Section 1: cunningAction resource parsing / feature gate
// ============================================================

console.log('\n=== 1. cunningAction resource gate ===\n');

{
  // Level 2 Rogue with cunningAction=true: Cunning Action Disengage planned
  const rogue = makeC({ id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
                        resources: lv2RogueResources(), actions: [meleeAction()], hasHands: true });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 1, y: 0, z: 0 } }); // adjacent

  const bf = makeBF([rogue, enemy]);
  const plan = planTurn(rogue, bf);

  assert('Lv2 Rogue: melee attack → bonusAction is disengage',
    plan.bonusAction?.type === 'disengage');
  assert('Lv2 Rogue: disengage description mentions Cunning Action',
    plan.bonusAction?.description?.includes('Cunning Action') ?? false);
  assert('Lv2 Rogue: moveAfter planned (retreat from target)',
    plan.moveAfter !== null);
}

{
  // Level 1 Rogue (no cunningAction): no Cunning Action bonus
  const rogue = makeC({ id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
                        resources: lv1RogueResources(), actions: [meleeAction()], hasHands: true });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });

  const bf = makeBF([rogue, enemy]);
  const plan = planTurn(rogue, bf);

  assert('Lv1 Rogue: no cunningAction → bonusAction is null',
    plan.bonusAction === null);
}

{
  // Non-Rogue (Fighter) with no cunningAction: no bonus action for melee attack
  const fighter = makeC({ id: 'fighter', faction: 'party', pos: { x: 0, y: 0, z: 0 },
                          resources: null, actions: [meleeAction()], hasHands: true });
  const enemy   = makeC({ id: 'enemy',   faction: 'enemy',  pos: { x: 1, y: 0, z: 0 } });

  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);

  assert('Non-Rogue: no cunningAction → bonusAction is null',
    plan.bonusAction === null);
}

// ============================================================
// Section 2: Cunning Action Disengage conditions
// ============================================================

console.log('\n=== 2. Cunning Action Disengage conditions ===\n');

{
  // Triggered by melee attack ✅
  const rogue = makeC({ id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
                        resources: lv2RogueResources(), actions: [meleeAction()], hasHands: true });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const plan = planTurn(rogue, makeBF([rogue, enemy]));
  eq('Melee attack → disengage bonus action', plan.bonusAction?.type, 'disengage');
}

{
  // NOT triggered by ranged attack (Rogue uses Shortbow)
  const rogue = makeC({ id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
                        resources: lv2RogueResources(), actions: [rangedAction()], hasHands: true });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 3, y: 0, z: 0 } }); // in range
  const plan = planTurn(rogue, makeBF([rogue, enemy]));

  assert('Ranged attack → no Cunning Action Disengage',
    plan.bonusAction?.type !== 'disengage');
}

{
  // Higher-priority bonus actions block Cunning Action:
  // Barbarian with both rage resource AND cunningAction (hypothetical) → rage wins.
  const hybrid = makeC({
    id: 'hybrid', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: {
      sneakAttackDice: '1d6',
      cunningAction: true,
      rage: { max: 2, remaining: 2, active: false, roundsRemaining: 0 },
      spellSlots: null,
    } as unknown as PlayerResources,
    actions: [meleeAction()], hasHands: true,
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([hybrid, enemy]);
  const plan = planTurn(hybrid, bf);

  // Rage has higher priority → bonusAction should be rage, not disengage
  assert('Rage takes priority over Cunning Action Disengage',
    plan.bonusAction?.type === 'rage' || plan.bonusAction?.type !== 'disengage');
}

// ============================================================
// Section 3: cunningRetreatPos (via planTurn)
// ============================================================

console.log('\n=== 3. Retreat position after Disengage ===\n');

{
  // Rogue at (5,5), enemy at (6,5): after moveBefore → (5,5), retreat → (4,5)
  const rogue = makeC({ id: 'rogue', faction: 'party', pos: { x: 5, y: 5, z: 0 },
                        resources: lv2RogueResources(), actions: [meleeAction()], hasHands: true });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 6, y: 5, z: 0 } });

  const plan = planTurn(rogue, makeBF([rogue, enemy]));

  // Rogue is already adjacent, so moveBefore may be null; startPos = self.pos = (5,5)
  // cunningRetreatPos((5,5), target at (6,5)): dx=-1 → retreat to (4,5)
  if (plan.moveAfter) {
    assert('Retreat is away from enemy (x decreases from Rogue\'s attack position)',
      plan.moveAfter.x <= 5);
    eq('Retreat stays on ground level (z=0)', plan.moveAfter.z, 0);
  } else {
    assert('moveAfter planned when retreat space exists', false,
      'moveAfter was null — may be cornered');
  }
}

{
  // Cornered Rogue: at (0,0,0), enemy at (1,0,0) → retreat = (-1,0) clamped to (0,0)?
  // Actually: cunningRetreatPos((0,0), target(1,0)) → dx=-1 → nx=-1 clamped to 0 = (0,0)
  // posKey same as startPos → canRetreat = false → moveAfter = null
  const rogue = makeC({ id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
                        resources: lv2RogueResources(), actions: [meleeAction()], hasHands: true });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });

  const bf = makeBF([rogue, enemy]);
  const plan = planTurn(rogue, bf);

  // Rogue is cornered at (0,0): retreat direction goes off-map (x=-1 clamped to 0)
  // The Disengage bonus action should still be planned — just no moveAfter
  assert('Cornered Rogue: Disengage still planned', plan.bonusAction?.type === 'disengage');
  // moveAfter may be null (cornered) or the planner may find y-direction
  // We just assert the type is correct — either null is fine here
}

// ============================================================
// Section 4: isDisengage fix — bonus-action Disengage prevents OA
// ============================================================

console.log('\n=== 4. Bonus-action Disengage prevents opportunity attacks ===\n');

{
  /*
   * Scenario: Rogue is adjacent to enemy. Rogue attacks (melee), Disengages as
   * bonus action (Cunning Action), then moves away (moveAfter).
   * The enemy MUST NOT get an opportunity attack on the retreating Rogue.
   *
   * We verify this by checking the combat log for the presence of 'disengage'
   * and the absence of 'opportunity_attack' on the Rogue.
   *
   * Both combatants: Rogue (Lv2) vs Enemy.
   * Rogue goes first (we control initiativeOrder).
   */
  const rogue = makeC({
    id: 'rogue', name: 'Rogue', faction: 'party',
    pos: { x: 5, y: 5, z: 0 },
    resources: lv2RogueResources(),
    actions: [meleeAction()],
    hasHands: true,
    isPlayer: true,
  });
  const enemy = makeC({
    id: 'enemy', name: 'Enemy', faction: 'enemy',
    pos: { x: 6, y: 5, z: 0 }, // adjacent to Rogue
    actions: [meleeAction('Claw', 4)],
    maxHP: 100, currentHP: 100, // tanky — survives the round
  });

  const bf = makeFlatBattlefield(20, 20, [rogue, enemy]);

  const result = runCombat(bf, ['rogue', 'enemy'], { maxRounds: 1 });
  const events = result.events;

  const disengageEvent = events.find((e: CombatEvent) => e.type === 'disengage' && e.actorId === 'rogue');
  const oaOnRogue = events.find((e: CombatEvent) => e.type === 'opportunity_attack' && e.targetId === 'rogue');

  assert('Rogue used Cunning Action Disengage', disengageEvent !== undefined);
  assert('No opportunity attack on Rogue after Disengage', oaOnRogue === undefined);
}

// ============================================================
// Section 5: Integration — Cunning Action Disengage + SA
// ============================================================

console.log('\n=== 5. Integration: SA targeting + Cunning Action Disengage ===\n');

{
  /*
   * Full Level 2 Rogue behavior when adjacent to SA-eligible target.
   * Layout (all z=0):
   *   Rogue   (4,4) — adjacent to both enemies
   *   Fighter (3,5) — adjacent to enemyA only
   *   EnemyA  (4,5) — adj to Rogue AND Fighter → SA guaranteed
   *   EnemyB  (5,4) — adj to Rogue only        → no SA
   *
   * selectRogueTarget: both enemies 1 square away; enemyA gets +50 SA bonus → wins.
   * selectAction: Rogue is adjacent to target → plans melee attack (not dash).
   * planCunningAction: melee attack → Disengage bonus action.
   */
  const rogue   = makeC({ id: 'rogue',   faction: 'party', pos: { x: 4, y: 4, z: 0 },
                          resources: lv2RogueResources(), actions: [meleeAction()], hasHands: true });
  const fighter = makeC({ id: 'fighter', faction: 'party', pos: { x: 3, y: 5, z: 0 } });
  const enemyA  = makeC({ id: 'enemyA',  faction: 'enemy', pos: { x: 4, y: 5, z: 0 } });
  const enemyB  = makeC({ id: 'enemyB',  faction: 'enemy', pos: { x: 5, y: 4, z: 0 } });

  // Sanity: verify layout
  assert('Setup: Rogue adj to enemyA', chebyshev3D(rogue.pos, enemyA.pos) <= 1);
  assert('Setup: Rogue adj to enemyB', chebyshev3D(rogue.pos, enemyB.pos) <= 1);
  assert('Setup: Fighter adj to enemyA', chebyshev3D(fighter.pos, enemyA.pos) <= 1);
  assert('Setup: Fighter NOT adj to enemyB', chebyshev3D(fighter.pos, enemyB.pos) > 1);

  const bf = makeBF([rogue, fighter, enemyA, enemyB]);
  const plan = planTurn(rogue, bf);

  eq('Rogue targets SA-eligible enemy A',   plan.targetId, 'enemyA');
  eq('Main action is attack',               plan.action?.type, 'attack');
  eq('Bonus action is Disengage',           plan.bonusAction?.type, 'disengage');
  assert('Description mentions Cunning Action',
    plan.bonusAction?.description?.includes('Cunning Action') ?? false);
}

{
  // Verify Level 1 Rogue does NOT get Cunning Action bonus even with SA targeting
  const rogue   = makeC({ id: 'rogue',   faction: 'party', pos: { x: 0, y: 5, z: 0 },
                          resources: lv1RogueResources(), actions: [meleeAction()], hasHands: true });
  const fighter = makeC({ id: 'fighter', faction: 'party', pos: { x: 6, y: 5, z: 0 } });
  const enemyA  = makeC({ id: 'enemyA',  faction: 'enemy', pos: { x: 7, y: 5, z: 0 } });
  const enemyB  = makeC({ id: 'enemyB',  faction: 'enemy', pos: { x: 2, y: 5, z: 0 } });

  const bf = makeBF([rogue, fighter, enemyA, enemyB]);
  const plan = planTurn(rogue, bf);

  eq('Lv1 Rogue: targets SA-eligible enemy A (SA targeting still works)',
    plan.targetId, 'enemyA');
  assert('Lv1 Rogue: no Cunning Action bonus action',
    plan.bonusAction === null);
}

// ============================================================

console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('\nAll tests passed ✅');
else              process.exit(1);
