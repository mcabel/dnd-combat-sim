// ============================================================
// Test: Sneak Attack — AI targeting and positioning
// Verifies that a Rogue's AI biases toward SA-eligible targets
// (ally already adjacent to the enemy) and that the SA damage
// bonus is applied and gated correctly.
//
// Run: ts-node src/test/sneak_attack.test.ts
// ============================================================

import { selectTarget, selectRogueTarget, allyAdjacentToEnemy } from '../ai/targeting';
import { planTurn } from '../ai/planner';
import { Combatant, Battlefield, Action, PlayerResources } from '../types/core';
import { chebyshev3D } from '../engine/movement';

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
    bardicInspirationDie: null, wardingBond: null, activeEffects: [],
    ...o,
  };
}

/** Shortsword action — finesse, SA eligible */
function shortsword(hitBonus = 5): Action {
  return {
    name: 'Shortsword', isMultiattack: false,
    attackType: 'melee', reach: 5, range: null,
    hitBonus, damage: { count: 1, sides: 6, bonus: 3, average: 6 },
    damageType: 'piercing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: '',
  };
}

/** Resources for a Level 1 Rogue */
function rogueResources(): PlayerResources {
  return {
    sneakAttackDice: '1d6',
    spellSlots: null,
  } as unknown as PlayerResources;
}

/** Build a minimal Battlefield from a combatant array */
function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    width: 20, height: 20, depth: 1, cells: [],
    combatants: map,
    round: 1,
    initiativeOrder: combatants.map(c => c.id),
  };
}

// ============================================================
// Section 1: allyAdjacentToEnemy helper
// ============================================================

console.log('\n=== 1. allyAdjacentToEnemy helper ===\n');

{
  // Ally at (3,0), enemy at (4,0) → Chebyshev = 1 → adjacent
  const attacker = makeC({ faction: 'party', pos: { x: 0, y: 0, z: 0 } });
  const ally     = makeC({ faction: 'party', pos: { x: 3, y: 0, z: 0 } });
  const enemy    = makeC({ faction: 'enemy', pos: { x: 4, y: 0, z: 0 } });
  const bf = makeBF([attacker, ally, enemy]);

  assert('Ally adj to enemy → true',
    allyAdjacentToEnemy(attacker, enemy, bf));

  // Ally at (1,0), enemy at (4,0) → Chebyshev = 3 → not adjacent
  const allyFar = makeC({ faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const bf2 = makeBF([attacker, allyFar, enemy]);
  assert('Ally NOT adj to enemy → false',
    !allyAdjacentToEnemy(attacker, enemy, bf2));

  // Attacker is NOT counted as "an ally" (excludes self)
  const soloRogue = makeC({ faction: 'party', pos: { x: 3, y: 0, z: 0 } });
  const enemyB    = makeC({ faction: 'enemy', pos: { x: 4, y: 0, z: 0 } });
  const bf3 = makeBF([soloRogue, enemyB]);
  assert('Self not counted as ally → false',
    !allyAdjacentToEnemy(soloRogue, enemyB, bf3));

  // Dead ally does not count
  const deadAlly = makeC({ faction: 'party', pos: { x: 3, y: 0, z: 0 }, isDead: true });
  const bf4 = makeBF([attacker, deadAlly, enemy]);
  assert('Dead ally → false',
    !allyAdjacentToEnemy(attacker, enemy, bf4));
}

// ============================================================
// Section 2: selectRogueTarget — SA-eligible bias
// ============================================================

console.log('\n=== 2. selectRogueTarget — prefer SA-eligible target ===\n');

{
  /*
   * Layout (all at z=0):
   *   Rogue at (0,0)
   *   Fighter (ally) at (3,0)
   *   Enemy A at (4,0) — adjacent to Fighter → SA guaranteed
   *   Enemy B at (1,0) — closer to Rogue, NO ally adjacent → no SA
   *
   * Pure smart scoring: Enemy B wins (distance penalty -2.5 vs -10.0).
   * SA-aware scoring: Enemy A gets +50 SA bonus → wins.
   */
  const rogue   = makeC({ id: 'rogue',   faction: 'party', pos: { x: 0, y: 0, z: 0 },
                          resources: rogueResources(), actions: [shortsword()] });
  const fighter = makeC({ id: 'fighter', faction: 'party', pos: { x: 3, y: 0, z: 0 } });
  const enemyA  = makeC({ id: 'enemyA',  faction: 'enemy', pos: { x: 4, y: 0, z: 0 } }); // adj to fighter
  const enemyB  = makeC({ id: 'enemyB',  faction: 'enemy', pos: { x: 1, y: 0, z: 0 } }); // closer, no ally adj

  const bf = makeBF([rogue, fighter, enemyA, enemyB]);

  // Sanity: Fighter IS adjacent to enemyA
  assert('Setup: fighter adj to enemyA',
    chebyshev3D(fighter.pos, enemyA.pos) <= 1);
  // Sanity: Fighter NOT adjacent to enemyB
  assert('Setup: fighter NOT adj to enemyB',
    chebyshev3D(fighter.pos, enemyB.pos) > 1);

  const selected = selectRogueTarget(rogue, bf);
  eq('Rogue prefers SA-eligible enemy (A) over nearer enemy (B)',
    selected?.id, 'enemyA');
}

{
  /*
   * When SA has already been used this turn, selectTarget bypasses Rogue
   * logic and falls through to smart scoring → picks closer enemy.
   */
  const rogue   = makeC({ id: 'rogue',   faction: 'party', pos: { x: 0, y: 0, z: 0 },
                          resources: rogueResources(), usedSneakAttackThisTurn: true });
  const fighter = makeC({ id: 'fighter', faction: 'party', pos: { x: 3, y: 0, z: 0 } });
  const enemyA  = makeC({ id: 'enemyA',  faction: 'enemy', pos: { x: 4, y: 0, z: 0 } }); // adj to fighter
  const enemyB  = makeC({ id: 'enemyB',  faction: 'enemy', pos: { x: 1, y: 0, z: 0 } }); // closer
  const bf = makeBF([rogue, fighter, enemyA, enemyB]);

  const selected = selectTarget(rogue, bf);
  // SA already used → falls to smart score → closer enemy B wins
  eq('SA already used → no SA bias → picks closer enemy B', selected?.id, 'enemyB');
}

{
  /*
   * No allies present → no SA adjacency possible.
   * selectRogueTarget still works, returning best smart-scored target.
   */
  const rogue  = makeC({ id: 'rogue',  faction: 'party', pos: { x: 0, y: 0, z: 0 },
                         resources: rogueResources() });
  const enemyA = makeC({ id: 'enemyA', faction: 'enemy', pos: { x: 4, y: 0, z: 0 },
                          currentHP: 5, maxHP: 20 }); // bloodied
  const enemyB = makeC({ id: 'enemyB', faction: 'enemy', pos: { x: 1, y: 0, z: 0 } }); // closer

  const bf = makeBF([rogue, enemyA, enemyB]);

  // No ally adj to either → SA bonus = 0 both. Bloodied (+60) on A wins.
  const selected = selectRogueTarget(rogue, bf);
  eq('No allies → falls back to smart score (bloodied enemy A wins)',
    selected?.id, 'enemyA');
}

{
  /*
   * Both enemies are SA-eligible (allies adjacent to each).
   * Bloodied enemy still wins since bloodied bonus (+60) > any distance delta.
   */
  const rogue   = makeC({ id: 'rogue',   faction: 'party', pos: { x: 0, y: 0, z: 0 },
                          resources: rogueResources() });
  const fighter = makeC({ id: 'fighter', faction: 'party', pos: { x: 3, y: 0, z: 0 } });
  const cleric  = makeC({ id: 'cleric',  faction: 'party', pos: { x: 6, y: 0, z: 0 } });
  const enemyA  = makeC({ id: 'enemyA',  faction: 'enemy', pos: { x: 4, y: 0, z: 0 },
                           currentHP: 3, maxHP: 20 }); // adj to fighter + bloodied
  const enemyB  = makeC({ id: 'enemyB',  faction: 'enemy', pos: { x: 7, y: 0, z: 0 } }); // adj to cleric

  const bf = makeBF([rogue, fighter, cleric, enemyA, enemyB]);

  assert('Setup: fighter adj to enemyA', chebyshev3D(fighter.pos, enemyA.pos) <= 1);
  assert('Setup: cleric  adj to enemyB', chebyshev3D(cleric.pos,  enemyB.pos) <= 1);

  // Both get +50 SA bonus; enemyA also gets +60 bloodied → enemyA total higher
  const selected = selectRogueTarget(rogue, bf);
  eq('Both SA-eligible: bloodied enemy A still wins', selected?.id, 'enemyA');
}

// ============================================================
// Section 3: selectTarget dispatch
// ============================================================

console.log('\n=== 3. selectTarget dispatch ===\n');

{
  // Rogue with SA: selectTarget dispatches to selectRogueTarget
  const rogue   = makeC({ id: 'rogue',   faction: 'party', pos: { x: 0, y: 0, z: 0 },
                          resources: rogueResources() });
  const fighter = makeC({ id: 'fighter', faction: 'party', pos: { x: 3, y: 0, z: 0 } });
  const enemyA  = makeC({ id: 'enemyA',  faction: 'enemy', pos: { x: 4, y: 0, z: 0 } }); // adj fighter
  const enemyB  = makeC({ id: 'enemyB',  faction: 'enemy', pos: { x: 1, y: 0, z: 0 } }); // closer

  const bf = makeBF([rogue, fighter, enemyA, enemyB]);
  eq('selectTarget: Rogue dispatches to SA-aware selection, picks enemyA',
    selectTarget(rogue, bf)?.id, 'enemyA');
}

{
  // Non-Rogue smart combatant: no SA branch → smart score → closer enemy wins
  const fighter = makeC({ id: 'fighter', faction: 'party', pos: { x: 0, y: 0, z: 0 },
                          aiProfile: 'smart', resources: null });
  const ally    = makeC({ id: 'ally',    faction: 'party', pos: { x: 3, y: 0, z: 0 } });
  const enemyA  = makeC({ id: 'enemyA',  faction: 'enemy', pos: { x: 4, y: 0, z: 0 } }); // adj ally
  const enemyB  = makeC({ id: 'enemyB',  faction: 'enemy', pos: { x: 1, y: 0, z: 0 } }); // closer

  const bf = makeBF([fighter, ally, enemyA, enemyB]);
  eq('Non-Rogue: no SA bias → smart score picks closer enemy B',
    selectTarget(fighter, bf)?.id, 'enemyB');
}

// ============================================================
// Section 4: planTurn — Rogue targets SA-eligible enemy
// ============================================================

console.log('\n=== 4. planTurn — Rogue plan targets SA-eligible enemy ===\n');

{
  const rogue   = makeC({ id: 'rogue',   faction: 'party', pos: { x: 0, y: 0, z: 0 },
                          resources: rogueResources(), actions: [shortsword()], hasHands: true });
  const fighter = makeC({ id: 'fighter', faction: 'party', pos: { x: 3, y: 0, z: 0 } });
  const enemyA  = makeC({ id: 'enemyA',  faction: 'enemy', pos: { x: 4, y: 0, z: 0 } }); // adj fighter
  const enemyB  = makeC({ id: 'enemyB',  faction: 'enemy', pos: { x: 1, y: 0, z: 0 } }); // closer

  const bf = makeBF([rogue, fighter, enemyA, enemyB]);
  const plan = planTurn(rogue, bf);
  eq('planTurn: Rogue targets SA-eligible enemy A', plan.targetId, 'enemyA');
}

{
  // Solo Rogue (no allies): still produces a valid attack plan
  const rogue = makeC({ id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
                        resources: rogueResources(), actions: [shortsword()], hasHands: true });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 1, y: 0, z: 0 } }); // within melee reach

  const bf = makeBF([rogue, enemy]);
  const plan = planTurn(rogue, bf);

  assert('Solo Rogue: plan produced', plan !== null);
  eq('Solo Rogue: targets the only enemy', plan.targetId, 'enemy');
  assert('Solo Rogue: has attack action', plan.action?.type === 'attack');
}

// ============================================================
// Section 5: Edge cases
// ============================================================

console.log('\n=== 5. Edge cases ===\n');

{
  // Single enemy: SA bias irrelevant — still selects that enemy
  const rogue = makeC({ id: 'rogue', faction: 'party', pos: { x: 0, y: 0, z: 0 },
                        resources: rogueResources() });
  const enemy = makeC({ id: 'enemy', faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf = makeBF([rogue, enemy]);

  eq('Single enemy: Rogue still selects it', selectRogueTarget(rogue, bf)?.id, 'enemy');
}

{
  // All enemies dead → null
  const rogue     = makeC({ id: 'rogue', faction: 'party', resources: rogueResources() });
  const deadEnemy = makeC({ id: 'dead',  faction: 'enemy', isDead: true });
  const bf = makeBF([rogue, deadEnemy]);

  assert('All dead: selectRogueTarget returns null',
    selectRogueTarget(rogue, bf) === null);
}

{
  // Unconscious ally does NOT grant SA bonus
  const rogue      = makeC({ id: 'rogue',     faction: 'party', pos: { x: 0, y: 0, z: 0 },
                             resources: rogueResources() });
  const incapAlly  = makeC({ id: 'incapAlly', faction: 'party', pos: { x: 3, y: 0, z: 0 },
                             isUnconscious: true });
  const enemyA     = makeC({ id: 'enemyA',    faction: 'enemy', pos: { x: 4, y: 0, z: 0 } }); // adj incapacitated ally
  const enemyB     = makeC({ id: 'enemyB',    faction: 'enemy', pos: { x: 1, y: 0, z: 0 } }); // closer, no adj ally

  const bf = makeBF([rogue, incapAlly, enemyA, enemyB]);
  // Incapacitated ally → allyAdjacentToEnemy returns false for enemyA
  // No SA bonus for either → smart score picks closer enemy B
  eq('Incapacitated ally does not grant SA bonus → picks closer enemy B',
    selectRogueTarget(rogue, bf)?.id, 'enemyB');
}

{
  // Diagonal adjacency (Chebyshev 1) counts
  const attacker = makeC({ faction: 'party', pos: { x: 0, y: 0, z: 0 } });
  const ally     = makeC({ faction: 'party', pos: { x: 2, y: 0, z: 0 } });
  const enemy    = makeC({ faction: 'enemy', pos: { x: 3, y: 1, z: 0 } }); // diagonal from ally
  const bf = makeBF([attacker, ally, enemy]);

  // chebyshev3D((2,0),(3,1)) = max(1,1,0) = 1 → within 5ft
  assert('Diagonal adjacency (Chebyshev 1) counts',
    allyAdjacentToEnemy(attacker, enemy, bf));
}

{
  // allyAdjacentToEnemy: 2 squares away (Chebyshev 2) does NOT count
  const attacker = makeC({ faction: 'party', pos: { x: 0, y: 0, z: 0 } });
  const ally     = makeC({ faction: 'party', pos: { x: 2, y: 0, z: 0 } });
  const enemy    = makeC({ faction: 'enemy', pos: { x: 4, y: 0, z: 0 } }); // 2 squares from ally
  const bf = makeBF([attacker, ally, enemy]);

  assert('Two squares away (Chebyshev 2) → NOT adjacent',
    !allyAdjacentToEnemy(attacker, enemy, bf));
}

// ============================================================

console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('\nAll tests passed ✅');
else              process.exit(1);
