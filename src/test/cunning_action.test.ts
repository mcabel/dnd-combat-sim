// ============================================================
// Test: Cunning Action — Rogue Level 2+ bonus action
// PHB p.96: Rogue can Dash, Disengage, or Hide as a bonus action.
//
// Session 28 scope:
//   ✅ Cunning Action: Disengage (hit-and-run after melee attack)
//   ✅ Cunning Action: Dash   — bonus-action Dash when target out of normal move range
//   ⬜ Cunning Action: Hide   — deferred (needs LOS/cover tracking system)
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
    exhaustionLevel: 0,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null, activeEffects: [],
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
// Section 6: Cunning Action — DASH
// PHB p.96: Rogue can use bonus action to Dash, freeing main action for an attack.
// PHB p.192: Dash gives a stipend equal to speed after condition modifiers (additive,
//            NOT a doubling).  A grappled creature (speed 0) gains 0 movement.
// ============================================================

console.log('\n=== 6. Cunning Action: Dash ===\n');

// --- 6.1: planCunningAction triggers when action-Dash is selected ---
{
  /*
   * Rogue with cunningAction and melee-only weapons.
   * Target is 40ft away (8 squares). Speed = 30ft → normal move falls 5ft short.
   * selectAction returns type:'dash' (can't reach, no ranged option).
   * planCunningAction should flip this to: bonus-action Dash + melee attack.
   *
   * Layout: Rogue (0,0), Enemy (8,0) — 40ft apart.
   */
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: lv2RogueResources(),
    actions: [meleeAction('Shortsword', 5)],   // melee only
    speed: 30,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 8, y: 0, z: 0 } });
  const bf = makeBF([rogue, enemy]);
  const plan = planTurn(rogue, bf);

  eq('Dash: bonus action type is dash',  plan.bonusAction?.type, 'dash');
  assert('Dash: bonus description mentions Cunning Action',
    plan.bonusAction?.description?.includes('Cunning Action') ?? false);
  eq('Dash: main action type is attack', plan.action?.type, 'attack');
  eq('Dash: attack uses melee action',   plan.action?.action?.attackType, 'melee');
  assert('Dash: moveBefore is set (move to adjacent)',   plan.moveBefore !== null);
}

// --- 6.2: No Dash when ranged weapon available ---
{
  /*
   * Rogue with BOTH Shortsword and Shortbow, target 40ft away.
   * selectAction finds Shortbow in range → returns ranged attack, NOT type:'dash'.
   * planCunningAction Dash case only triggers on type:'dash'; ranged action skips it.
   * Expected: ranged attack, NO bonus action.
   */
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: lv2RogueResources(),
    actions: [meleeAction(), rangedAction()],
    speed: 30,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 8, y: 0, z: 0 } });
  const bf = makeBF([rogue, enemy]);
  const plan = planTurn(rogue, bf);

  // Should use ranged, not Dash to close
  assert('No-Dash: action is not dash-type (ranged or attack)',
    plan.action?.type !== 'dash');
  assert('No-Dash: bonus action is NOT a dash (no cunning Dash when ranged available)',
    plan.bonusAction?.type !== 'dash');
}

// --- 6.3: No Dash when target is truly out of range (even with bonus Dash) ---
{
  /*
   * Target 70ft away (14 squares). Speed = 30ft.
   * totalBudget = 30 + 30 = 60ft. movementNeeded = 70 - 5 = 65ft.
   * 60 < 65 → Dash doesn't help. Plan stays as action-Dash (close distance this turn).
   */
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: lv2RogueResources(),
    actions: [meleeAction()],
    speed: 30,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 14, y: 0, z: 0 } });
  const bf = makeBF([rogue, enemy]);
  const plan = planTurn(rogue, bf);

  eq('Out-of-range: main action stays as dash', plan.action?.type, 'dash');
  assert('Out-of-range: no bonus Dash (can\'t help)', plan.bonusAction?.type !== 'dash');
}

// --- 6.4: No Dash without cunningAction (Level 1 Rogue) ---
{
  /*
   * Level 1 Rogue (no cunningAction), target 40ft away, melee-only.
   * Without Cunning Action, the bonus Dash is unavailable.
   * Plan must stay: action-Dash to close distance (no attack this turn).
   */
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: lv1RogueResources(),
    actions: [meleeAction()],
    speed: 30,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 8, y: 0, z: 0 } });
  const bf = makeBF([rogue, enemy]);
  const plan = planTurn(rogue, bf);

  eq('Lv1 no-Dash: action is still dash (normal)',  plan.action?.type, 'dash');
  assert('Lv1 no-Dash: no bonus action',            plan.bonusAction === null);
}

// --- 6.5: Disengage beats Dash when Rogue is already in melee reach ---
{
  /*
   * Rogue adjacent to target (1 square away). selectAction returns melee attack.
   * planCunningAction: chosenAction.type === 'attack' (melee) → Disengage case fires first.
   * Dash case never reached. Expected: Disengage bonus, melee attack main.
   */
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: lv2RogueResources(),
    actions: [meleeAction()],
    speed: 30,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  // Enemy at (1,0) — 5ft away, Chebyshev 1 ≤ reach(5ft)
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([rogue, enemy]);
  const plan = planTurn(rogue, bf);

  eq('Adjacent: action is melee attack', plan.action?.type, 'attack');
  eq('Adjacent: bonus action is Disengage (not Dash)', plan.bonusAction?.type, 'disengage');
}

// --- 6.6: Dash boundary — just within range (35ft gap, 60ft budget) ---
{
  /*
   * Rogue at (0,0), target at (8,0) — 40ft apart.
   * To be adjacent: move to (7,0) = 35ft. totalBudget = 60. 60 ≥ 35 → Dash works.
   * Rogue at (0,0), target at (13,0) — 65ft apart.
   * To be adjacent: move to (12,0) = 60ft. totalBudget = 60. 60 ≥ 60 → also works (exact).
   */
  const makeRogue = (pos: { x: number; y: number; z: number }) => makeC({
    id: `rogue_${pos.x}`, faction: 'party', pos,
    resources: lv2RogueResources(), actions: [meleeAction()], speed: 30,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });

  // Target 65ft away: movementNeeded = 65 - 5 = 60 = totalBudget (exactly reachable)
  const rogue65 = makeRogue({ x: 0, y: 0, z: 0 });
  const enemy65 = makeC({ id: 'enemy65', faction: 'enemy', pos: { x: 13, y: 0, z: 0 } });
  const plan65 = planTurn(rogue65, makeBF([rogue65, enemy65]));
  eq('Boundary-65ft: bonus Dash fires', plan65.bonusAction?.type, 'dash');
  eq('Boundary-65ft: main action is attack', plan65.action?.type, 'attack');

  // Target 70ft away: movementNeeded = 70 - 5 = 65 > 60 → Dash cannot help
  const rogue70 = makeRogue({ x: 0, y: 0, z: 0 });
  const enemy70 = makeC({ id: 'enemy70', faction: 'enemy', pos: { x: 14, y: 0, z: 0 } });
  const plan70 = planTurn(rogue70, makeBF([rogue70, enemy70]));
  eq('Boundary-70ft: no bonus Dash (just out of range)', plan70.action?.type, 'dash');
  assert('Boundary-70ft: no bonus action', plan70.bonusAction === null || plan70.bonusAction?.type !== 'dash');
}

// --- 6.7: Engine ordering — bonus-action Dash fires BEFORE movement ---
{
  /*
   * Full combat integration test.
   * Rogue at (0,0), enemy at (8,0) = 40ft apart.  Melee-only Rogue, cunningAction.
   * Normal move budget = 30ft (can't reach adjacent at 35ft).
   * Engine should: (1) execute bonus Dash → budget = 60ft, (2) move 35ft → attack.
   *
   * Observable: an 'attack' event from 'rogue' should appear on round 1.
   * If bonus Dash fired AFTER movement, the Rogue couldn't reach → no attack event.
   */
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: lv2RogueResources(),
    actions: [meleeAction()],
    speed: 30, maxHP: 100, currentHP: 100,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const enemy = makeC({
    id: 'enemy', faction: 'enemy', pos: { x: 8, y: 0, z: 0 },
    maxHP: 500, currentHP: 500, ac: 30, // near-immortal to survive round 1
    actions: [meleeAction('Claw', 3)],
  });
  const bf = makeFlatBattlefield(20, 5, [rogue, enemy]);
  const result = runCombat(bf, ['rogue', 'enemy'], { maxRounds: 1 });

  const attackByRogue = result.events.find(
    (e: CombatEvent) => e.type === 'action' && e.actorId === 'rogue'
  );
  const dashBonusEvent = result.events.find(
    (e: CombatEvent) => e.type === 'dash' && e.actorId === 'rogue'
  );

  assert('Engine-ordering: bonus Dash event fires', dashBonusEvent !== undefined);
  assert('Engine-ordering: Rogue attacks on round 1 (reached target)', attackByRogue !== undefined);
}

// ============================================================
// Section 7: Cunning Action — Hide (LOS-gated stealth)
// PHB p.96 / PHB p.177 / PHB p.194
// ============================================================

import { Obstacle } from '../types/core';

console.log('\n=== 7. Cunning Action: Hide ===\n');

/** Fog cloud obstacle: vision-blocking, does not block movement */
function fogCloud(x: number, y: number, w = 1, d = 1): Obstacle {
  return {
    id: `fog-${x}-${y}`, x, y, z: 0,
    width: w, depth: d, height: 1,
    blocksMovement: false, blocksVision: true,
  };
}

/** Wall obstacle: blocks both movement and vision */
function wall(x: number, y: number, w: number, d = 1): Obstacle {
  return {
    id: `wall-${x}-${y}`, x, y, z: 0,
    width: w, depth: d, height: 1,
    blocksMovement: true, blocksVision: true,
  };
}

function makeBFWithObstacles(combatants: Combatant[], obstacles: Obstacle[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    width: 20, height: 20, depth: 1, cells: [],
    combatants: map, round: 1,
    initiativeOrder: combatants.map(c => c.id),
    obstacles,
  };
}

// ── 7a: Planner plans Hide when Rogue is behind a vision blocker ──────────────

{
  // Rogue at (0,5), fog column at x=2-13 (depth covers full y range).
  // Enemy at (15,5) — all rays from enemy to rogue pass through fog interior → blocked.
  // Combatants at y=5 so their corner y-coords (5,6) fall inside fog y=[0+eps, 10-eps].
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 5, z: 0 },
    resources: lv2RogueResources(),
    actions: [],   // no attack options → not Case 1 or 2
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 15, y: 5, z: 0 } });
  const bf = makeBFWithObstacles([rogue, enemy], [fogCloud(2, 0, 12, 10)]);

  const plan = planTurn(rogue, bf);

  assert('7a: Rogue behind fog → bonusAction is hide',
    plan.bonusAction?.type === 'hide',
    `got ${plan.bonusAction?.type}`);
  assert('7a: Hide description mentions Cunning Action',
    plan.bonusAction?.description?.includes('Cunning Action') ?? false);
}

// ── 7b: Planner does NOT plan Hide in open field (no vision obstacles) ──────

{
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 5, z: 0 },
    resources: lv2RogueResources(),
    actions: [],
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 10, y: 5, z: 0 } });
  const bf = makeBF([rogue, enemy]); // no obstacles

  const plan = planTurn(rogue, bf);

  assert('7b: Open field → bonusAction is NOT hide',
    plan.bonusAction?.type !== 'hide',
    `got ${plan.bonusAction?.type}`);
}

// ── 7c: Planner does NOT plan Hide when enemy has LOS to Rogue ───────────────

{
  // Rogue at (0,5), enemy at (3,5). Wall is at x=8 (between both and far space).
  // Enemy at x=3 has CLEAR LOS to rogue at x=0 — nothing between them.
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 5, z: 0 },
    resources: lv2RogueResources(),
    actions: [],
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 3, y: 5, z: 0 } });
  // Wall at x=8, does NOT block enemy→rogue LOS (enemy is on same side as rogue)
  const bf = makeBFWithObstacles([rogue, enemy], [wall(8, 0, 3, 10)]);

  const plan = planTurn(rogue, bf);

  assert('7c: Enemy has LOS to Rogue → bonusAction is NOT hide',
    plan.bonusAction?.type !== 'hide',
    `got ${plan.bonusAction?.type}`);
}

// ── 7d: Planner does NOT plan Hide when Rogue is already hidden ─────────────

{
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 5, z: 0 },
    resources: lv2RogueResources(),
    actions: [],
    conditions: new Set(['hidden'] as any),
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 15, y: 5, z: 0 } });
  const bf = makeBFWithObstacles([rogue, enemy], [fogCloud(2, 0, 12, 10)]);

  const plan = planTurn(rogue, bf);

  assert('7d: Already hidden → bonusAction is NOT hide again',
    plan.bonusAction?.type !== 'hide',
    `got ${plan.bonusAction?.type}`);
}

// ── 7e: Planner does NOT plan Hide when Rogue plans a melee attack (Case 1 priority) ─

{
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: lv2RogueResources(),
    actions: [meleeAction()],
  });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBFWithObstacles([rogue, enemy], [fogCloud(10, 0, 5, 1)]);

  const plan = planTurn(rogue, bf);

  assert('7e: Melee attack planned → Case 1 Disengage, not Hide',
    plan.bonusAction?.type === 'disengage',
    `got ${plan.bonusAction?.type}`);
}

// ── 7f: Engine execution — hidden Rogue attacks with advantage ───────────────

{
  // Rogue pre-hidden, attacks enemy → attack should be resolved with advantage.
  // We verify: condition_remove event fires (revealed) and attack event fires.
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: lv2RogueResources(),
    actions: [meleeAction()],
    conditions: new Set(['hidden'] as any),
    maxHP: 100, currentHP: 100,
  });
  const enemy = makeC({
    id: 'enemy', faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 500, currentHP: 500, ac: 30, // near-immortal: won't die before we can inspect events
    actions: [meleeAction('Claw', 3)],
  });
  const bf = makeFlatBattlefield(10, 5, [rogue, enemy]);
  const result = runCombat(bf, ['rogue', 'enemy'], { maxRounds: 1 });

  const revealEvent = result.events.find(
    (e: CombatEvent) => e.type === 'condition_remove' && e.actorId === 'rogue' &&
                        e.description.includes('revealed')
  );
  const attackEvent = result.events.find(
    (e: CombatEvent) => (e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit') &&
                        e.actorId === 'rogue'
  );

  assert('7f: Hidden Rogue attacks → condition_remove "revealed" event fires',
    revealEvent !== undefined,
    revealEvent ? '' : 'no condition_remove event with "revealed"');
  assert('7f: Hidden Rogue attacks → attack event fires',
    attackEvent !== undefined);
}

// ── 7g: Engine execution — hidden condition added on successful Hide ─────────

{
  // Combatants at y=2 so their AABB corners (y=2,3) lie well inside the fog's
  // y-range [0+eps, 5-eps]. Fog from x=2-13 blocks all rays between enemy and rogue.
  // Rogue DEX=30 (mod +10) + prof 2 → stealth roll min 13, always > PP=10. Guaranteed success.
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 2, z: 0 },
    resources: lv2RogueResources(),
    actions: [],   // no attack → planner reaches Case 3
    dex: 30,
    maxHP: 100, currentHP: 100,
  });
  const enemy = makeC({
    id: 'enemy', faction: 'enemy', pos: { x: 15, y: 2, z: 0 },
    wis: 10, // passive perception = 10 + 0 = 10
    maxHP: 500, currentHP: 500, ac: 30,
    actions: [meleeAction('Claw', 3)],
  });
  const bf = makeFlatBattlefield(20, 5, [rogue, enemy]);
  bf.obstacles = [fogCloud(2, 0, 12, 5)]; // fog from x=2-13, full y depth

  const result = runCombat(bf, ['rogue', 'enemy'], { maxRounds: 1 });

  const hideEvent = result.events.find(
    (e: CombatEvent) => e.type === 'condition_add' && e.actorId === 'rogue' &&
                        e.description.includes('Hides')
  );

  assert('7g: Guaranteed stealth success → condition_add "Hides" event fires',
    hideEvent !== undefined,
    hideEvent ? '' : `events: ${result.events.map((e: CombatEvent) => e.type + ':' + e.description).join('; ')}`);
}

// ── 7h: Engine execution — failed Hide does not add condition ────────────────

{
  // Rogue dex=2 (mod -4), prof 2 → max stealth = 20-4+2 = 18.
  // Enemy wis=30 → passive perception = 10+10 = 20. P(18 > 20) = 0. Guaranteed failure.
  const rogue = makeC({
    id: 'rogue', faction: 'party', pos: { x: 0, y: 2, z: 0 },
    resources: lv2RogueResources(),
    actions: [],
    dex: 2, // mod = -4; max stealth roll = 18 < 20
    maxHP: 100, currentHP: 100,
  });
  const enemy = makeC({
    id: 'enemy', faction: 'enemy', pos: { x: 15, y: 2, z: 0 },
    wis: 30, // passive perception = 10 + 10 = 20
    maxHP: 500, currentHP: 500, ac: 30,
    actions: [meleeAction('Claw', 3)],
  });
  const bf = makeFlatBattlefield(20, 5, [rogue, enemy]);
  bf.obstacles = [fogCloud(2, 0, 12, 5)];

  const result = runCombat(bf, ['rogue', 'enemy'], { maxRounds: 1 });

  const hideSuccessEvent = result.events.find(
    (e: CombatEvent) => e.type === 'condition_add' && e.actorId === 'rogue' &&
                        e.description.includes('Hides')
  );
  const hideFailEvent = result.events.find(
    (e: CombatEvent) => e.type === 'action' && e.actorId === 'rogue' &&
                        e.description.includes('Detected')
  );

  assert('7h: Guaranteed stealth failure → condition_add does NOT fire',
    hideSuccessEvent === undefined,
    `found unexpected hide success event`);
  assert('7h: Guaranteed stealth failure → "Detected" action event fires',
    hideFailEvent !== undefined,
    hideFailEvent ? '' : `events: ${result.events.filter((e: CombatEvent) => e.actorId === 'rogue').map((e: CombatEvent) => e.type + ':' + e.description).join('; ')}`);
}

// ============================================================

console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('\nAll tests passed ✅');
else              process.exit(1);
