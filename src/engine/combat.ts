// ============================================================
// Combat Engine
// Executes TurnPlans produced by the AI planner.
// Handles: attack resolution, movement, OA triggers,
//          legendary action windows, perception updates.
// ============================================================

import {
  Combatant, Battlefield, TurnPlan, PlannedAction, Action, Vec3
} from '../types/core';
import {
  rollAttack, rollDamage, rollSave, applyDamage, applyHeal,
  resetBudget, spendMovement, attackHits, attackAdvantageState, resolveAttackAdvantage,
  isBloodied, addCondition, removeCondition,
  rollConcentrationSave, rollDeathSave,
  applyDamageWithTempHP, hasPackTacticsAdvantage,
  canSneakAttack, sneakAttackDice,
  addResistance, removeResistance,
  parseDieSides, consumeBardicInspiration,
  teamHasNoAttackCapability, canDealDamage, makeImprovisedUnarmed, makeImprovisedWeapon
} from './utils';
import {
  chebyshev3D, distanceFt, canReach, estimateMoveCostFt,
  opportunityAttackTriggered, selectOAAction,
  livingEnemiesOf, livingAlliesOf, posKey
} from './movement';
import { planTurn, planLegendaryAction, shouldTakeOpportunityAttack } from '../ai/planner';
import { shouldSmite, applyDivineSmite, tickRage } from '../ai/resources';
import { isControlledMount, mountDeathRiderCheck, isIndependentMount } from '../summons/mount';
import { checkMountedCombatant, checkProtectionStyle, checkInterceptionReduction } from './mount_redirect';
import { tickAdvantages, grantSelf, grantVulnerability } from './adv_system';
import { getSummonEntry }                           from '../summons/registry';
import { rollGrappleContest, rollShoveContest, canGrappleOrShoveTarget } from './utils';

// ---- Combat log ---------------------------------------------

export interface CombatEvent {
  round: number;
  actorId: string;
  type:
    | 'attack_hit' | 'attack_miss' | 'attack_crit'
    | 'damage' | 'heal'
    | 'death' | 'unconscious'
    | 'move'
    | 'action' | 'dash' | 'disengage' | 'dodge'
    | 'opportunity_attack'
    | 'legendary_action'
    | 'condition_add' | 'condition_remove'
    | 'save_success' | 'save_fail'
    | 'combat_start' | 'combat_end';
  targetId?: string;
  value?: number;        // damage amount, heal amount, roll result
  description: string;
}

export interface CombatLog {
  events: CombatEvent[];
  winner: 'party' | 'enemy' | 'draw' | null;
  rounds: number;
}

function log(
  state: EngineState,
  type: CombatEvent['type'],
  actorId: string,
  description: string,
  targetId?: string,
  value?: number
): void {
  state.log.events.push({
    round: state.battlefield.round,
    actorId,
    type,
    targetId,
    value,
    description,
  });
}

// ---- Engine state -------------------------------------------

export interface EngineState {
  battlefield: Battlefield;
  log: CombatLog;
  // Per-turn flags (reset each turn)
  disengagedThisTurn: Set<string>;   // combatant IDs that used Disengage
  // Per-round damage tracking (for 10-round no-damage auto-defeat rule)
  damageThisRound: Map<string, number>;   // faction → total damage dealt this round
  noDamageRounds: Map<string, number>;    // faction → consecutive rounds with 0 damage
  // Rage tracking: IDs of combatants that took damage since their last rage tick.
  // Populated whenever dealt > 0; cleared per-actor at start of their turn.
  rageDamagedSinceLastTurn: Set<string>;
}

function makeState(battlefield: Battlefield): EngineState {
  return {
    battlefield,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// ---- Attack resolution --------------------------------------

/**
 * Resolve a single attack action against a target.
 * Handles: attack roll, hit check, damage roll, crit, death.
 */
function resolveAttack(
  attacker: Combatant,
  target: Combatant,
  action: Action,
  state: EngineState,
  isCritOverride?: boolean   // force crit (used for tests)
): void {
  const bf = state.battlefield;

  // Pack Tactics: advantage if ally adjacent to target (MM)
  const packTacticsAdvantage = hasPackTacticsAdvantage(attacker, target, bf);

  // Save-based attacks (no attack roll)
  if (action.attackType === 'save' && action.saveDC !== null && action.saveAbility !== null) {
    const save = rollSave(target, action.saveAbility, action.saveDC);
    log(state, save.success ? 'save_success' : 'save_fail', attacker.id,
      `${target.name} ${save.success ? 'succeeds' : 'fails'} DC ${action.saveDC} ${action.saveAbility} save (rolled ${save.total})`,
      target.id, save.roll);

    if (action.damage) {
      const dmg = rollDamage(action.damage, false);
      const actual = save.success ? Math.floor(dmg / 2) : dmg; // half on save success
      const dealt = applyDamageWithTempHP(target, actual, action.damageType);
      // Concentration check if target was concentrating
      if (target.concentration?.active && dealt > 0) {
        const maintained = rollConcentrationSave(target, dealt);
        if (!maintained) log(state, 'condition_remove', target.id,
          `${target.name} loses concentration on ${target.concentration?.spellName ?? 'spell'}!`, undefined);
      }
      log(state, 'damage', attacker.id,
        `${attacker.name} deals ${dealt} ${action.damageType ?? ''} damage to ${target.name} (save ${save.success ? 'halved' : 'full'})`,
        target.id, dealt);
      if (dealt > 0) state.rageDamagedSinceLastTurn.add(target.id);
      checkDeath(target, state);
    }
    return;
  }

  // Auto-hit (no hitBonus — e.g. Reaping Scythe, Magic Missile)
  if (action.hitBonus === null) {
    if (action.damage) {
      const dmg = rollDamage(action.damage, false);
      const dealt = applyDamageWithTempHP(target, dmg, action.damageType);
      if (target.concentration?.active && dealt > 0) {
        const maintained = rollConcentrationSave(target, dealt);
        if (!maintained) log(state, 'condition_remove', target.id,
          `${target.name} loses concentration!`, undefined);
      }
      log(state, 'damage', attacker.id,
        `${attacker.name} auto-hits ${target.name} for ${dealt} ${action.damageType ?? ''} damage`,
        target.id, dealt);
      if (dealt > 0) state.rageDamagedSinceLastTurn.add(target.id);
      checkDeath(target, state, attacker);
    }
    return;
  }

  // Standard attack roll — include Pack Tactics advantage, Prone modifier, and Help action
  const advState = resolveAttackAdvantage(attacker, target, action.attackType);
  const { advantage: baseAdv, disadvantage: baseDisadv } = advState;
  const advantage = baseAdv || packTacticsAdvantage || attacker.helpedThisTurn;

  // ST-5B: Fighting Style: Protection — rider imposes disadvantage on attack vs mount (reaction)
  const protectionRider = checkProtectionStyle(target, bf);
  if (protectionRider) {
    log(state, 'action', protectionRider.id,
      `${protectionRider.name} uses Protection — disadvantage on attack against ${target.name}!`,
      target.id);
  }
  const disadvantage = baseDisadv || !!protectionRider;

  const result = rollAttack(action.hitBonus ?? 0, advantage, disadvantage);

  // Bardic Inspiration die — consumed on this attack roll (PHB p.54)
  const biBonus = consumeBardicInspiration(attacker);
  if (biBonus > 0) {
    result.total += biBonus;
    log(state, 'action', attacker.id,
      `${attacker.name} uses Bardic Inspiration die (+${biBonus})!`, target.id, biBonus);
  }

  const hits = isCritOverride ?? attackHits(result.roll, result.total, target.ac);

  if (!hits) {
    log(state, 'attack_miss', attacker.id,
      `${attacker.name} misses ${target.name} with ${action.name} (rolled ${result.roll}+${action.hitBonus}=${result.total} vs AC ${target.ac})`,
      target.id, result.roll);
    return;
  }

  // PHB p.197: hitting an unconscious PC at 0 HP = automatic death save failure.
  // Melee attack within 5 ft = critical hit = 2 failures (PHB p.197).
  if (target.isUnconscious && target.isPlayer && target.currentHP === 0 && target.deathSaves) {
    const dist = Math.max(Math.abs(attacker.pos.x - target.pos.x), Math.abs(attacker.pos.y - target.pos.y));
    const meleeRange = dist <= 1;
    const extraFails = meleeRange ? 2 : 1;
    target.deathSaves.failures = Math.min(3, target.deathSaves.failures + extraFails);
    log(state, 'action', attacker.id,
      `${attacker.name} hits the downed ${target.name}! ${extraFails} death save failure${extraFails > 1 ? 's' : ''} (${target.deathSaves.failures}/3)`,
      target.id, 0);
    if (target.deathSaves.failures >= 3) {
      target.isDead = true;
      target.isUnconscious = false;
      log(state, 'death', target.id,
        `${target.name} has taken too many hits while downed — they die!`, undefined, 0);
    }
    return; // no damage dealt to a dying PC — hits just add failures
  }

  const isCrit = isCritOverride === true || result.isCrit;
  log(state, isCrit ? 'attack_crit' : 'attack_hit', attacker.id,
    `${attacker.name} ${isCrit ? 'CRITS' : 'hits'} ${target.name} with ${action.name} (${result.total} vs AC ${target.ac})`,
    target.id, result.roll);

  if (action.damage) {
    let dmg = rollDamage(action.damage, isCrit);

    // Divine Smite: Paladin expends a spell slot on a hit (PHB p.85)
    if (attacker.resources?.divineSmite && shouldSmite(attacker, target, isCrit)) {
      const smiteDmg = applyDivineSmite(attacker, isCrit);
      if (smiteDmg > 0) {
        dmg += smiteDmg;
        log(state, 'action', attacker.id,
          `${attacker.name} uses Divine Smite for +${smiteDmg} radiant damage!`, target.id, smiteDmg);
      }
    }

    // Sneak Attack: check and apply if eligible (Rogue with finesse/ranged weapon)
    const allyAdjToTarget = [...bf.combatants.values()].some(c =>
      c.faction === attacker.faction && c.id !== attacker.id && !c.isDead &&
      Math.max(Math.abs(c.pos.x - target.pos.x), Math.abs(c.pos.y - target.pos.y)) <= 1
    );
    if (canSneakAttack(attacker, action, advantage, disadvantage, allyAdjToTarget)) {
      const saDice = sneakAttackDice(1); // level 1 = 1d6; TODO: track rogue level
      const saRoll = rollDamage(saDice, isCrit);
      dmg += saRoll;
      attacker.usedSneakAttackThisTurn = true;
      log(state, 'action', attacker.id,
        `${attacker.name} applies Sneak Attack (+${saRoll} damage)!`, target.id, saRoll);
    }

    // Rage damage bonus: +2 to melee damage while raging (PHB p.48).
    // Applies to melee weapon attacks only (not ranged, not saves, not auto-hit).
    if (
      attacker.resources?.rage?.active &&
      action.attackType === 'melee'
    ) {
      const rageBonus = 2; // Level 1–8: +2 (level 9+ and 16+ are future work)
      dmg += rageBonus;
      log(state, 'action', attacker.id,
        `${attacker.name} adds Rage bonus (+${rageBonus} damage)!`, target.id, rageBonus);
    }

    // ST-5C: Fighting Style: Interception — rider reduces damage to mount (reaction)
    const { reduction: interceptReduction, rider: interceptRider } =
      checkInterceptionReduction(target, dmg, bf);
    if (interceptReduction > 0 && interceptRider) {
      dmg = Math.max(0, dmg - interceptReduction);
      log(state, 'action', interceptRider.id,
        `${interceptRider.name} uses Interception — reduces damage to ${target.name} by ${interceptReduction}!`,
        target.id, interceptReduction);
    }

    const dealt = applyDamageWithTempHP(target, dmg, action.damageType);
    if (target.concentration?.active && dealt > 0) {
      const maintained = rollConcentrationSave(target, dealt);
      if (!maintained) log(state, 'condition_remove', target.id,
        `${target.name} loses concentration on ${target.concentration?.spellName ?? 'spell'}!`, undefined);
    }
    log(state, 'damage', attacker.id,
      `${attacker.name} deals ${dealt} ${action.damageType ?? ''} damage to ${target.name}${isCrit ? ' (CRIT)' : ''}`,
      target.id, dealt);
    // Track faction damage for 10-round no-damage auto-defeat rule
    if (dealt > 0) {
      const prev = state.damageThisRound.get(attacker.faction) ?? 0;
      state.damageThisRound.set(attacker.faction, prev + dealt);
      // Track for rage-end check: target took damage since their last turn
      state.rageDamagedSinceLastTurn.add(target.id);
    }
    checkDeath(target, state);
  }
}

/**
 * Log death/unconscious events when a combatant reaches 0 HP.
 */
function checkDeath(target: Combatant, state: EngineState, attacker?: Combatant): void {
  if (target.currentHP > 0) return;

  // Dark One's Blessing (Warlock Fiend): gain temp HP when reducing to 0
  if (attacker?.resources?.darkOnesBlessing && target.faction !== attacker.faction) {
    const amount = attacker.resources.darkOnesBlessing.amount;
    attacker.tempHP = Math.max(attacker.tempHP, amount);
    log(state, 'action', attacker.id,
      `${attacker.name} gains ${amount} temp HP from Dark One's Blessing`, undefined, amount);
  }

  // If mount dies while carrying a rider, rider must save (PHB p.198)
  if (target.carriedBy) {
    const rider = state.battlefield.combatants.get(target.carriedBy);
    if (rider && !rider.isDead) {
      const result = mountDeathRiderCheck(rider);
      target.carriedBy = null;
      rider.mountedOn  = null;
      log(state, 'action', target.id,
        `${target.name} (mount) goes down! ${rider.name} ${result === 'prone' ? 'falls prone!' : 'lands safely.'}`,
        rider.id);
    }
  }

  // Break concentration on going down (PHB p.203)
  if (target.concentration?.active) {
    const spellName = target.concentration.spellName ?? 'spell';
    target.concentration = null;
    log(state, 'condition_remove', target.id,
      `${target.name}'s concentration on ${spellName} breaks!`, undefined);
  }

  if (target.isPlayer) {
    // PCs go unconscious and start making death saves (PHB p.197)
    if (!target.deathSaves) target.deathSaves = { successes: 0, failures: 0 };
    log(state, 'unconscious', target.id,
      `${target.name} falls unconscious and begins making death saving throws!`, undefined, 0);
  } else {
    log(state, 'death', target.id, `${target.name} is slain!`, undefined, 0);
  }

  // PHB p.195: grapple ends when either party falls unconscious or dies.
  // Release any creature this target was grappling.
  for (const c of state.battlefield.combatants.values()) {
    if (c.grappledBy === target.id) {
      removeCondition(c, 'grappled');
      c.grappledBy = undefined;
      log(state, 'condition_remove', target.id,
        `${c.name} is released from ${target.name}'s grapple!`, c.id);
    }
  }
  // Also release any grapple this target was in (in case it gets swept up later)
  if (target.conditions.has('grappled')) {
    removeCondition(target, 'grappled');
    target.grappledBy = undefined;
  }
}

// ---- Movement resolution ------------------------------------

/**
 * Move a combatant toward `dest`, spending movement from budget.
 * Checks for OA triggers at each step (simplified: checks once at dest).
 * Full step-by-step OA checking is a future enhancement.
 */
function executeMove(
  mover: Combatant,
  dest: Vec3,  // mutable — will be clamped
  state: EngineState,
  isDisengage: boolean
): void {
  const bf = state.battlefield;
  // Clamp destination to battlefield bounds — prevents infinite flight off the map
  dest = {
    x: Math.max(0, Math.min(bf.width  - 1, dest.x)),
    y: Math.max(0, Math.min(bf.height - 1, dest.y)),
    z: Math.max(0, Math.min(bf.depth  - 1, dest.z)),
  };

  if (posKey(mover.pos) === posKey(dest)) return; // already there

  const cost = estimateMoveCostFt(
    mover.pos, dest,
    mover.burrowSpeed !== null,
    mover.swimSpeed !== null
  );

  if (!spendMovement(mover, cost)) {
    // Insufficient movement — move as far as budget allows
    // (simplified: skip move if can't reach; future: partial move)
    return;
  }

  const fromPos = { ...mover.pos };
  log(state, 'move', mover.id,
    `${mover.name} moves from (${fromPos.x},${fromPos.y}) to (${dest.x},${dest.y})`,
    undefined);
  mover.pos = { ...dest };

  // OA check: did any watcher's melee reach get left?
  if (!isDisengage) {
    for (const [, watcher] of bf.combatants) {
      if (watcher.id === mover.id || watcher.isDead || watcher.isUnconscious) continue;
      if (watcher.faction === mover.faction) continue;
      if (!opportunityAttackTriggered(watcher, mover, fromPos, dest)) continue;
      if (!shouldTakeOpportunityAttack(watcher, mover, bf)) continue;

      // Execute OA
      const oaAction = selectOAAction(watcher);
      if (oaAction && canReach(watcher, mover, oaAction)) {
        // ST-5A: Mounted Combatant — redirect OA to rider if feat active (no reaction cost)
        const oaTarget = checkMountedCombatant(mover, oaAction, bf) ?? mover;
        if (oaTarget !== mover) {
          log(state, 'action', oaTarget.id,
            `${oaTarget.name} uses Mounted Combatant — intercepts OA on ${mover.name}!`, oaTarget.id);
        }
        log(state, 'opportunity_attack', watcher.id,
          `${watcher.name} takes opportunity attack on ${oaTarget.name}!`, oaTarget.id);
        watcher.budget.reactionUsed = true;
        resolveAttack(watcher, oaTarget, oaAction, state);
        if (oaTarget.isDead || oaTarget.isUnconscious) return; // target died on OA
      }
    }
  }
}

// ---- Execute a PlannedAction --------------------------------

function executePlannedAction(
  actor: Combatant,
  plan: PlannedAction,
  state: EngineState
): void {
  const bf = state.battlefield;

  switch (plan.type) {
    case 'attack':
    case 'cast': {
      const target = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!target || target.isDead || target.isUnconscious) break;
      if (!plan.action) break;
      // ST-5A: Mounted Combatant — redirect attack to rider if feat active (no reaction cost)
      const effectiveTarget = checkMountedCombatant(target, plan.action, bf) ?? target;
      if (effectiveTarget !== target) {
        log(state, 'action', effectiveTarget.id,
          `${effectiveTarget.name} uses Mounted Combatant — intercepts attack on ${target.name}!`,
          effectiveTarget.id);
      }
      log(state, 'action', actor.id, plan.description, effectiveTarget.id ?? undefined);
      resolveAttack(actor, effectiveTarget, plan.action, state);
      break;
    }

    case 'dash':
      log(state, 'dash', actor.id, plan.description);
      // Dash doubles movement — engine adds another speed's worth
      actor.budget.movementFt += actor.speed;
      break;

    case 'disengage':
      log(state, 'disengage', actor.id, plan.description);
      state.disengagedThisTurn.add(actor.id);
      // Mark on the actor so OA checks can skip it
      (actor as any).usedDisengage = true;
      break;

    case 'dodge':
      log(state, 'dodge', actor.id, plan.description);
      // PHB p.192: Until your next turn, attacks against you have disadvantage (if you can
      // see the attacker) and you make DEX saving throws with advantage.
      // Both expire at the START of this creature's next turn (tickAdvantages handles this).
      grantVulnerability(actor, 'disadvantage', 'attack', 'Dodge', 'until_next_turn');
      grantSelf(actor, 'advantage', 'save:dex', 'Dodge', 'until_next_turn');
      break;

    case 'legendary': {
      const target = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!target || target.isDead || target.isUnconscious) break;
      if (!plan.action) break;
      // ST-5A: Mounted Combatant — redirect legendary attack to rider if feat active
      const legEffectiveTarget = checkMountedCombatant(target, plan.action, bf) ?? target;
      if (legEffectiveTarget !== target) {
        log(state, 'action', legEffectiveTarget.id,
          `${legEffectiveTarget.name} uses Mounted Combatant — intercepts legendary attack on ${target.name}!`,
          legEffectiveTarget.id);
      }
      log(state, 'legendary_action', actor.id, plan.description, legEffectiveTarget.id ?? undefined);
      actor.legendaryActionPool -= plan.action.legendaryCost;
      resolveAttack(actor, legEffectiveTarget, plan.action, state);
      break;
    }

    case 'grapple': {
      const target = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!target || target.isDead || target.isUnconscious) break;
      // PHB p.195: can't grapple a target more than 1 size larger
      if (!canGrappleOrShoveTarget(actor, target)) {
        log(state, 'action', actor.id,
          `${actor.name} can't grapple ${target.name} — target is too large!`, target.id);
        break;
      }
      log(state, 'action', actor.id, plan.description, plan.targetId ?? undefined);
      const success = rollGrappleContest(actor, target);
      if (success) {
        addCondition(target, 'grappled');
        target.grappledBy = actor.id;
        log(state, 'condition_add', actor.id,
          `${actor.name} grapples ${target.name}! (speed 0)`, target.id);
      } else {
        log(state, 'action', actor.id,
          `${actor.name}'s grapple attempt on ${target.name} fails.`, target.id);
      }
      break;
    }

    case 'shove': {
      const target = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!target || target.isDead || target.isUnconscious) break;
      // PHB p.195: can't shove a target more than 1 size larger
      if (!canGrappleOrShoveTarget(actor, target)) {
        log(state, 'action', actor.id,
          `${actor.name} can't shove ${target.name} — target is too large!`, target.id);
        break;
      }
      log(state, 'action', actor.id, plan.description, plan.targetId ?? undefined);
      const success = rollShoveContest(actor, target);
      if (success) {
        // Knock prone (AI always chooses prone for the melee advantage)
        addCondition(target, 'prone');
        log(state, 'condition_add', actor.id,
          `${actor.name} shoves ${target.name} prone!`, target.id);
      } else {
        log(state, 'action', actor.id,
          `${actor.name}'s shove attempt on ${target.name} fails.`, target.id);
      }
      break;
    }

    case 'escapeGrapple': {
      // PHB p.195: grappled creature uses its action to make a contested STR(Athletics)
      // or DEX(Acrobatics) check vs the grappler's STR(Athletics).
      // We store the grappler ID in plan.targetId.
      if (!actor.conditions.has('grappled')) break; // condition already removed
      const grappler = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      log(state, 'action', actor.id, plan.description);
      // If grappler is gone/dead, escape automatically
      if (!grappler || grappler.isDead || grappler.isUnconscious) {
        removeCondition(actor, 'grappled');
        actor.grappledBy = undefined;
        log(state, 'condition_remove', actor.id,
          `${actor.name} escapes the grapple — grappler is down!`);
        break;
      }
      // Contested roll: escaper (attacker role) vs grappler (defender role)
      const escaped = rollGrappleContest(actor, grappler);
      if (escaped) {
        removeCondition(actor, 'grappled');
        actor.grappledBy = undefined;
        log(state, 'condition_remove', actor.id,
          `${actor.name} breaks free from ${grappler.name}'s grapple!`);
      } else {
        log(state, 'action', actor.id,
          `${actor.name} fails to escape ${grappler.name}'s grapple.`);
      }
      break;
    }

    case 'help': {
      // PHB p.192: Help action grants advantage to one allied attack roll before your next turn
      if (plan.targetId) {
        const target = bf.combatants.get(plan.targetId);
        if (target) {
          target.helpedThisTurn = true;
        }
      }
      log(state, 'action', actor.id, plan.description);
      break;
    }
    case 'rage': {
      // PHB p.48: Rage — bonus action.
      // +2 to melee damage rolls while raging (applied in resolveAttack, not here).
      // Resistance to bludgeoning, piercing, and slashing damage.
      // activateRagePlan() already set r.active = true and decremented r.remaining.
      const rageDmgTypes: Array<'bludgeoning' | 'piercing' | 'slashing'> =
        ['bludgeoning', 'piercing', 'slashing'];
      for (const dt of rageDmgTypes) addResistance(actor, dt);
      log(state, 'action', actor.id, plan.description);
      break;
    }
    case 'secondWind': {
      // HP was already applied in secondWindPlan. Emit action + heal log events.
      // PHB p.72: Fighter bonus action; heals 1d10 + fighter level HP.
      log(state, 'action', actor.id, plan.description);
      if (plan.healAmount && plan.healAmount > 0) {
        log(state, 'heal', actor.id,
          `${actor.name} recovers ${plan.healAmount} HP from Second Wind`,
          actor.id, plan.healAmount);
      }
      break;
    }
    case 'layOnHands': {
      // PHB p.84: Paladin action; restore HP from the Lay on Hands pool.
      // applyHeal handles the unconscious → conscious transition for downed allies.
      const lohTarget = plan.targetId
        ? state.battlefield.combatants.get(plan.targetId) ?? null
        : null;
      if (lohTarget && !lohTarget.isDead && plan.healAmount && plan.healAmount > 0) {
        const healed = applyHeal(lohTarget, plan.healAmount);
        if (lohTarget.isUnconscious && healed > 0) {
          // applyHeal already cleared conditions — log regained consciousness
          log(state, 'condition_remove', lohTarget.id,
            `${lohTarget.name} regains consciousness!`, undefined);
        }
        log(state, 'action', actor.id, plan.description);
        log(state, 'heal', actor.id,
          `${actor.name} restores ${healed} HP to ${lohTarget.name}`,
          lohTarget.id, healed);
      } else {
        log(state, 'action', actor.id, plan.description);
      }
      break;
    }
    case 'hide':
    case 'ready':
    case 'bardicInspiration': {
      // PHB p.54: Bard grants an Inspiration die (bonus action) to one ally.
      // The recipient adds the die to their next attack roll or saving throw.
      const biTarget = plan.targetId
        ? state.battlefield.combatants.get(plan.targetId) ?? null
        : null;
      if (biTarget && !biTarget.isDead) {
        const die = actor.resources?.bardicInspiration?.die ?? 'd6';
        biTarget.bardicInspirationDie = parseDieSides(die);
        log(state, 'action', actor.id, plan.description);
      } else {
        log(state, 'action', actor.id, plan.description);
      }
      break;
    }
  }
}

// ---- Execute a full TurnPlan --------------------------------

/**
 * Execute all components of a TurnPlan for one combatant.
 * Order: moveBefore → action → bonus action → moveAfter
 * (Movement can split around the action per PHB p.190.)
 */
function executeTurnPlan(actor: Combatant, plan: TurnPlan, state: EngineState): void {
  const isDisengage = plan.action?.type === 'disengage';

  const isDash = plan.action?.type === 'dash';

  // For Dash: execute the Dash action first to double movement budget,
  // THEN move — otherwise the doubled movement isn't available yet.
  if (isDash) {
    if (plan.action && !actor.isDead && !actor.isUnconscious) {
      actor.budget.actionUsed = true;
      executePlannedAction(actor, plan.action, state);  // adds actor.speed to movementFt
    }
    if (plan.moveBefore && !actor.isDead && !actor.isUnconscious) {
      executeMove(actor, plan.moveBefore, state, isDisengage);
    }
  } else {
    // Normal order: move → action
    if (plan.moveBefore && !actor.isDead && !actor.isUnconscious) {
      executeMove(actor, plan.moveBefore, state, isDisengage);
    }
    if (plan.action && !actor.isDead && !actor.isUnconscious) {
      actor.budget.actionUsed = true;
      executePlannedAction(actor, plan.action, state);
    }
  }

  // Bonus action
  if (plan.bonusAction && !actor.isDead && !actor.isUnconscious) {
    actor.budget.bonusActionUsed = true;
    executePlannedAction(actor, plan.bonusAction, state);
  }

  // Move after action
  if (plan.moveAfter && !actor.isDead && !actor.isUnconscious) {
    executeMove(actor, plan.moveAfter, state, isDisengage);
  }

  // Clean up turn flags
  (actor as any).usedDisengage = false;
}

// ---- Perception update --------------------------------------

/**
 * After each action, update all surviving combatants' perception memories.
 * Records: heals, AoE casts, bloodied status, position.
 * Respects non-psychic constraint (no exact HP, no concentration, no slots).
 */
function updatePerception(
  actor: Combatant,
  target: Combatant | null,
  plan: TurnPlan,
  bf: Battlefield
): void {
  const wasAoE = plan.action?.action?.isAoE ?? false;
  const wasHeal = plan.action?.type === 'layOnHands'
    || plan.bonusAction?.description?.toLowerCase().includes('heal')
    || plan.action?.description?.toLowerCase().includes('cure');

  for (const [, observer] of bf.combatants) {
    if (observer.isDead || observer.isUnconscious) continue;

    // Update observed position for all living combatants
    for (const [, observed] of bf.combatants) {
      if (!observed.isDead) {
        let knowledge = observer.perception.targets.get(observed.id);
        if (!knowledge) {
          knowledge = {
            lastSeenPos: { ...observed.pos },
            visibleArmorType: 'none',
            hasShield: false,
            isBloodied: false,
            castAoEThisCombat: false,
            receivedHealingThisCombat: false,
            isFlying: false,
            isRanged: false,
            hasMeleeWeapon: false,
          };
          observer.perception.targets.set(observed.id, knowledge);
        }
        knowledge.lastSeenPos = { ...observed.pos };
        knowledge.isBloodied = isBloodied(observed);
        knowledge.isFlying = (observed.flySpeed !== null) && observed.pos.z > 0;
      }
    }

    // Record AoE cast
    if (wasAoE && target) {
      const k = observer.perception.targets.get(actor.id);
      if (k) k.castAoEThisCombat = true;
    }

    // Record healing received
    if (wasHeal && target) {
      const k = observer.perception.targets.get(target.id);
      if (k) k.receivedHealingThisCombat = true;
    }
  }
}

// ---- Victory check ------------------------------------------

function checkVictory(state: EngineState): 'party' | 'enemy' | null {
  const bf = state.battlefield;
  const partyAlive = [...bf.combatants.values()].some(
    c => c.faction === 'party' && !c.isDead && !c.isUnconscious
  );
  const enemyAlive = [...bf.combatants.values()].some(
    c => c.faction === 'enemy' && !c.isDead && !c.isUnconscious
  );

  if (!partyAlive) return 'enemy';
  if (!enemyAlive) return 'party';
  return null;
}

// ---- Main combat loop ---------------------------------------

export interface CombatOptions {
  maxRounds?: number;      // safety cap (default: 50)
  verbose?: boolean;       // print events as they happen
}

/**
 * Run a full combat encounter.
 *
 * @param battlefield  - set up with all combatants and their positions
 * @param initiative   - ordered array of combatant IDs (roll externally or use rollInitiative())
 * @param options
 */
export function runCombat(
  battlefield: Battlefield,
  initiative: string[],
  options: CombatOptions = {}
): CombatLog {
  const { maxRounds = 50, verbose = false } = options;
  const state = makeState(battlefield);
  battlefield.initiativeOrder = initiative;
  battlefield.round = 1;

  log(state, 'combat_start', 'engine', 'Combat begins!');
  if (verbose) console.log('\n⚔️  Combat begins!\n');

  for (let round = 1; round <= maxRounds; round++) {
    battlefield.round = round;
    if (verbose) console.log(`\n── Round ${round} ──`);

    // Reset disengage flags at start of round
    state.disengagedThisTurn.clear();

    for (const actorId of initiative) {
      const actor = battlefield.combatants.get(actorId);
      if (!actor || actor.isDead) continue;

      // Death saving throw: unconscious PCs roll at the start of their turn
      if (actor.isUnconscious && actor.isPlayer && actor.deathSaves) {
        const result = rollDeathSave(actor);
        if (result === 'dead') {
          log(state, 'death', actor.id,
            `${actor.name} has failed 3 death saving throws and dies!`, undefined, 0);
        } else if (result === 'stable') {
          const woke = actor.currentHP > 0;
          log(state, woke ? 'action' : 'action', actor.id,
            woke
              ? `${actor.name} rolls a natural 20 on their death save and regains 1 HP!`
              : `${actor.name} is now stable (3 death save successes).`
          );
        }
        // Regardless — skip rest of turn if still unconscious
        if (actor.isUnconscious) continue;
      } else if (actor.isUnconscious) {
        continue; // monster or already-handled
      }

      // ── Mount turn handling (PHB p.198) ─────────────────────
      if (isControlledMount(actor)) {
        // Refresh movement pool — rider draws from this
        actor.budget.movementFt = actor.flySpeed ?? actor.speed;

        if (isIndependentMount(actor)) {
          // ── INDEPENDENT MOUNT: full turn (attacks, any action) ──
          // Rider has explicitly granted independence (grantIndependence(mount)).
          // Mount uses its own initiative slot, can attack, etc.
          // Falls through to normal turn planning below.
        } else {
          // ── CONTROLLED MOUNT (DEFAULT): Dash, Disengage, or Dodge only ──
          // PHB p.198: "A controlled mount can take only the Dash, Disengage,
          // or Dodge action." Mount CANNOT attack in this mode.
          //
          // AI choice: if rider is in melee range of enemies → Disengage (safe escape)
          //            otherwise → Dash (close gap / extra movement for rider)
          resetBudget(actor);
          tickAdvantages(actor);  // expire until_next_turn / decrement rounds entries
          actor.usedSneakAttackThisTurn = false;
          actor.helpedThisTurn = false;
          actor.budget.movementFt = actor.flySpeed ?? actor.speed;

          const rider = battlefield.combatants.get(actor.carriedBy!);
          const adjEnemies = rider
            ? [...battlefield.combatants.values()].filter(c =>
                c.faction !== rider.faction && !c.isDead && !c.isUnconscious &&
                Math.max(Math.abs(c.pos.x - actor.pos.x), Math.abs(c.pos.y - actor.pos.y)) <= 1
              ).length
            : 0;

          if (adjEnemies > 0) {
            // Disengage: rider can move away safely
            log(state, 'disengage', actor.id,
              `${actor.name} (controlled mount) Disengages — rider can move freely`, undefined);
            state.disengagedThisTurn.add(actor.id);
            (actor as any).usedDisengage = true;
          } else {
            // Dash: doubles effective movement for the rider this turn
            log(state, 'dash', actor.id,
              `${actor.name} (controlled mount) Dashes — +${actor.speed}ft movement pool`, undefined);
            actor.budget.movementFt += actor.flySpeed ?? actor.speed;
          }
          continue; // controlled mount turn ends here
        }
      }

      // Reset per-turn flags
      actor.usedSneakAttackThisTurn = false;
      actor.helpedThisTurn = false;

      // Capture rage damage flag (set by attacks on OTHER creatures' turns) then clear it
      // so damage DURING this turn isn't double-counted in the next tick.
      const damageTakenSinceLastTurn = state.rageDamagedSinceLastTurn.has(actor.id);
      state.rageDamagedSinceLastTurn.delete(actor.id);

      // Tick advantage/disadvantage durations (expire until_next_turn; decrement rounds)
      tickAdvantages(actor);

      // ── Reckless Attack (Barbarian, PHB p.48) ─────────────────────────────────
      // "When you make your first attack on your turn, you can decide to attack
      //  recklessly. Doing so gives you advantage on melee weapon attack rolls using
      //  Strength during this turn, but attack rolls against you have advantage until
      //  your next turn."
      // AI: always use when enemies are present (benefit outweighs exposure at level 1).
      if (actor.traits.includes('Reckless Attack') &&
          livingEnemiesOf(actor, battlefield).length > 0) {
        grantSelf(actor, 'advantage', 'attack:melee', 'Reckless Attack', 'until_next_turn');
        grantVulnerability(actor, 'advantage', 'attack', 'Reckless Attack', 'until_next_turn');
        log(state, 'action', actor.id,
          `${actor.name} attacks Recklessly! (adv on melee attacks; enemies have adv vs ${actor.name} until next turn)`,
          undefined);
      }

      // 4.12 Commanded creatures: allow external profile override each turn.
      // A controller (commander) can call bf.pendingCommands.get(actorId) to
      // switch a minion's aiProfile before its turn is planned.
      // This models verbal commands that cost no action (e.g. Ebony Fly magic item).
      if (battlefield.pendingCommands?.has(actor.id)) {
        const cmd = battlefield.pendingCommands.get(actor.id)!;
        actor.aiProfile = cmd;
        battlefield.pendingCommands.delete(actor.id);
      }

      // Reset budget (movement, action, bonus, reaction)
      resetBudget(actor);

      // Plan the turn
      const plan = planTurn(actor, battlefield);

      if (verbose && plan.action) {
        console.log(`  ${actor.name}: ${plan.action.description}`);
      }

      // Execute the plan
      executeTurnPlan(actor, plan, state);

      // Tick Rage at end of actor's turn (PHB p.48: rage ends if the barbarian didn't
      // attack or take damage since their last turn). Also removes B/P/S resistance
      // when rage ends.
      if (actor.resources?.rage?.active) {
        const attackedThisTurn =
          plan.action?.type === 'attack' ||
          plan.bonusAction?.type === 'attack';
        const rageActiveBeforeTick = actor.resources.rage.active;
        tickRage(actor, attackedThisTurn, damageTakenSinceLastTurn);
        if (rageActiveBeforeTick && !actor.resources.rage.active) {
          // Rage ended — strip B/P/S resistances granted by Rage
          removeResistance(actor, 'bludgeoning');
          removeResistance(actor, 'piercing');
          removeResistance(actor, 'slashing');
          log(state, 'action', actor.id,
            `${actor.name}'s Rage ends.`, undefined);
        }
      }

      // Update perception for all observers
      const target = plan.targetId ? battlefield.combatants.get(plan.targetId) ?? null : null;
      updatePerception(actor, target, plan, battlefield);

      // Legendary action window: after each creature's turn,
      // legendary creatures get to act (design doc §6, §5.3.5)
      for (const [, legendary] of battlefield.combatants) {
        if (legendary.legendaryActionPoolMax === 0) continue;
        if (legendary.isDead || legendary.isUnconscious) continue;
        if (legendary.id === actorId) continue; // not on own turn

        const la = planLegendaryAction(legendary, battlefield);
        if (la) {
          const laTarget = la.targetId ? battlefield.combatants.get(la.targetId) ?? null : null;
          if (laTarget && !laTarget.isDead) {
            if (verbose) console.log(`  ★ ${legendary.name} legendary: ${la.description}`);
            executePlannedAction(legendary, la, state);
            legendary.legendaryActionPool -= la.action?.legendaryCost ?? 1;
          }
        }
      }

      // Check victory after each creature's turn
      const victor = checkVictory(state);
      if (victor) {
        state.log.winner = victor;
        state.log.rounds = round;
        log(state, 'combat_end', 'engine',
          `Combat ends in round ${round}! ${victor === 'party' ? 'Heroes' : 'Enemies'} win!`);
        if (verbose) console.log(`\n🏆 ${victor === 'party' ? 'Heroes' : 'Enemies'} win in round ${round}!\n`);
        return state.log;
      }
    }

    // ── End-of-round checks ─────────────────────────────────────

    // 1. Auto-defeat: any living team with no attack capability loses immediately.
    //    Checked after all combatants have taken their turn.
    const factions = [...new Set(
      [...battlefield.combatants.values()]
        .filter(c => !c.isDead && !c.isUnconscious)
        .map(c => c.faction)
    )];
    for (const faction of factions) {
      if (teamHasNoAttackCapability(faction, battlefield.combatants)) {
        const winner = faction === 'party' ? 'enemy' : 'party';
        state.log.winner = winner;
        state.log.rounds = round;
        log(state, 'combat_end', 'engine',
          `${faction} team has no means to attack — auto-defeated in round ${round}!`);
        if (verbose) console.log(`\n⚔️  ${faction} has no attack capability — defeated!\n`);
        return state.log;
      }
    }

    // 2. No-damage tracking: update consecutive-round counters.
    //    If any team hits 10 consecutive rounds of 0 damage dealt, they are defeated.
    for (const faction of factions) {
      const dmgThisRound = state.damageThisRound.get(faction) ?? 0;
      if (dmgThisRound === 0) {
        const prev = state.noDamageRounds.get(faction) ?? 0;
        state.noDamageRounds.set(faction, prev + 1);
        if (prev + 1 >= 10) {
          const winner = faction === 'party' ? 'enemy' : 'party';
          state.log.winner = winner;
          state.log.rounds = round;
          log(state, 'combat_end', 'engine',
            `${faction} team dealt 0 damage for 10 consecutive rounds — auto-defeated!`);
          if (verbose) console.log(`\n⚔️  ${faction} has dealt no damage for 10 rounds — defeated!\n`);
          return state.log;
        }
      } else {
        state.noDamageRounds.set(faction, 0);
      }
    }
    // Reset per-round damage counters
    state.damageThisRound.clear();
  }

  // Hit round cap
  state.log.winner = 'draw';
  state.log.rounds = maxRounds;
  log(state, 'combat_end', 'engine', `Combat ended after ${maxRounds} rounds (draw)`);
  return state.log;
}

// ---- Helpers for setting up encounters ----------------------

/**
 * Create a minimal flat battlefield with no terrain modifiers.
 */
export function makeFlatBattlefield(
  widthSq: number,
  heightSq: number,
  combatants: Combatant[]
): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    width: widthSq,
    height: heightSq,
    depth: 1,
    cells: [],       // flat = no terrain modifiers
    combatants: map,
    round: 0,
    initiativeOrder: [],
  };
}
