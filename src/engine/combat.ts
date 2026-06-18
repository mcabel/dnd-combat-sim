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
  teamHasNoAttackCapability, canDealDamage, makeImprovisedUnarmed, makeImprovisedWeapon,
  effectiveSpeed, rollDie, abilityMod, proficiencyBonus
} from './utils';
import {
  chebyshev3D, distanceFt, euclideanDistFt, canReach, estimateMoveCostFt,
  opportunityAttackTriggered, selectOAAction,
  livingEnemiesOf, livingAlliesOf, posKey
} from './movement';
import { planTurn, planLegendaryAction, shouldTakeOpportunityAttack } from '../ai/planner';
import { shouldSmite, applyDivineSmite, tickRage, consumeSpellSlot } from '../ai/resources';
import { isControlledMount, mountDeathRiderCheck, isIndependentMount } from '../summons/mount';
import { checkMountedCombatant, checkProtectionStyle, checkInterceptionReduction } from './mount_redirect';
import { tickAdvantages, grantSelf, grantVulnerability } from './adv_system';
import { getSummonEntry }                           from '../summons/registry';
import { rollGrappleContest, rollShoveContest, canGrappleOrShoveTarget } from './utils';
import { computeLOS } from './los';
import { removeEffectsFromCaster, getActiveAcBonus, getActiveBlessDie, getActiveHexDie } from './spell_effects';
import { applyCantripEffect, getCantripAttackAdvantage } from './cantrip_effects';
import { execute as executeHex } from '../spells/hex';
import { execute as executeMagicMissile } from '../spells/magic_missile';
import { execute as executeBurningHands, shouldCast as shouldCastBurningHands } from '../spells/burning_hands';
import { execute as executeDissonantWhispers, shouldCast as shouldCastDissonantWhispers } from '../spells/dissonant_whispers';
import { shouldCast as shouldCastFaerieFire, execute as executeFaerieFire } from '../spells/faerie_fire';
import { shouldCast as shouldCastBless, execute as executeBless } from '../spells/bless';
import { shouldCast as shouldCastEntangle, execute as executeEntangle } from '../spells/entangle';
import { shouldCast as shouldCastThunderwave, execute as executeThunderwave } from '../spells/thunderwave';
import { execute as executeArmsOfHadar } from '../spells/arms_of_hadar';
import { shouldCast as shouldCastSleep, execute as executeSleep } from '../spells/sleep';
import { execute as executeWardingBond } from '../spells/warding_bond';
import { execute as executeShieldOfFaith } from '../spells/shield_of_faith';
import { shouldCast as shouldCastMageArmor, execute as executeMageArmor } from '../spells/mage_armor';
import { shouldCast as shouldCastShield, execute as executeShield } from '../spells/shield';
import {
  shouldCast as shouldCastGuidingBolt, execute as executeGuidingBolt,
  cleanupMarks as cleanupGuidingBoltMarks, consumeMark as consumeGuidingBoltMark,
} from '../spells/guiding_bolt';

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

  // ── LOS / Cover check (PHB Ch.10, DMG Ch.8) ─────────────────────────────
  // Skip for save-based AoE (area is targeted, not an individual creature).
  // For melee/ranged/spell attacks: block on total cover; AC bonus otherwise.
  const los = action.attackType !== 'save'
    ? computeLOS(attacker, target, bf)
    : null;

  if (los && !los.hasLineOfEffect) {
    log(state, 'action', attacker.id,
      `${attacker.name}'s attack on ${target.name} is blocked — Total Cover!`, target.id);
    return;
  }

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
        if (!maintained) {
          removeEffectsFromCaster(target.id, state.battlefield);
          log(state, 'condition_remove', target.id,
            `${target.name} loses concentration on ${target.concentration?.spellName ?? 'spell'}!`, undefined);
        }
      }
      log(state, 'damage', attacker.id,
        `${attacker.name} deals ${dealt} ${action.damageType ?? ''} damage to ${target.name} (save ${save.success ? 'halved' : 'full'})`,
        target.id, dealt);
      if (dealt > 0) state.rageDamagedSinceLastTurn.add(target.id);
      applyWardingBondRedirect(target, dealt, state);
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
        if (!maintained) {
          removeEffectsFromCaster(target.id, state.battlefield);
          log(state, 'condition_remove', target.id,
            `${target.name} loses concentration!`, undefined);
        }
      }
      log(state, 'damage', attacker.id,
        `${attacker.name} auto-hits ${target.name} for ${dealt} ${action.damageType ?? ''} damage`,
        target.id, dealt);
      if (dealt > 0) state.rageDamagedSinceLastTurn.add(target.id);
      applyWardingBondRedirect(target, dealt, state);
      checkDeath(target, state, attacker);
    }
    return;
  }

  // Standard attack roll — include Pack Tactics advantage, Prone modifier, and Help action
  const advState = resolveAttackAdvantage(attacker, target, action.attackType);
  const { advantage: baseAdv, disadvantage: baseDisadv } = advState;
  // Cantrip intrinsic advantage (pre-roll): e.g. Shocking Grasp vs metal armor (PHB p.275)
  const cantripAdv = getCantripAttackAdvantage(attacker, target, action.name);
  const advantage = baseAdv || packTacticsAdvantage || attacker.helpedThisTurn || cantripAdv;

  // Guiding Bolt mark: consume on the first attack roll against the illuminated target (PHB p.248).
  // Advantage from the mark is already captured in advState above; consuming it now ensures
  // only one attack benefits regardless of multiattack or multiple attackers.
  const gbConsumed = consumeGuidingBoltMark(target);
  if (gbConsumed) {
    log(state, 'condition_remove', attacker.id,
      `Guiding Bolt's illumination fades from ${target.name} (consumed by this attack).`, target.id);
  }

  // Cunning Action: Hide — hidden attacker is revealed on attack, hit or miss (PHB p.177/194).
  // Advantage was already captured above by resolveAttackAdvantage reading the 'hidden' condition.
  if (attacker.conditions.has('hidden')) {
    removeCondition(attacker, 'hidden');
    log(state, 'condition_remove', attacker.id,
      `${attacker.name} is revealed after attacking!`, target.id);
  }

  // ST-5B: Fighting Style: Protection — rider imposes disadvantage on attack vs mount (reaction)
  const protectionRider = checkProtectionStyle(target, bf);
  if (protectionRider) {
    log(state, 'action', protectionRider.id,
      `${protectionRider.name} uses Protection — disadvantage on attack against ${target.name}!`,
      target.id);
  }
  // Vision blocked by obstacle (fog cloud, magical darkness) → Disadvantage (PHB Ch.10)
  const losDisadvantage = los !== null && !los.hasLineOfSight;
  if (losDisadvantage) {
    log(state, 'action', attacker.id,
      `${attacker.name} attacks ${target.name} with Disadvantage (vision blocked).`, target.id);
  }
  const disadvantage = baseDisadv || !!protectionRider || losDisadvantage;

  const result = rollAttack(action.hitBonus ?? 0, advantage, disadvantage);

  // Bardic Inspiration die — consumed on this attack roll (PHB p.54)
  const biBonus = consumeBardicInspiration(attacker);
  if (biBonus > 0) {
    result.total += biBonus;
    log(state, 'action', attacker.id,
      `${attacker.name} uses Bardic Inspiration die (+${biBonus})!`, target.id, biBonus);
  }

  // Bless die — +1d4 to attack rolls when blessed (PHB p.219)
  const blessSides = getActiveBlessDie(attacker);
  if (blessSides > 0) {
    const blessBonus = rollDie(blessSides);
    result.total += blessBonus;
    log(state, 'action', attacker.id,
      `${attacker.name} rolls Bless die (+${blessBonus})!`, target.id, blessBonus);
  }

  // Warding Bond: +1 AC while bonded (PHB p.287)
  // Cover: +2 (half) or +5 (three-quarters) to AC from obstacles (DMG Ch.8 p.196)
  const effectiveAC = target.ac + (target.wardingBond ? 1 : 0) + (los?.coverACBonus ?? 0) + getActiveAcBonus(target);
  const hits = isCritOverride ?? attackHits(result.roll, result.total, effectiveAC);

  if (!hits) {
    log(state, 'attack_miss', attacker.id,
      `${attacker.name} misses ${target.name} with ${action.name} (rolled ${result.roll}+${action.hitBonus}=${result.total} vs AC ${effectiveAC})`,
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
    `${attacker.name} ${isCrit ? 'CRITS' : 'hits'} ${target.name} with ${action.name} (${result.total} vs AC ${effectiveAC})`,
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

    // Hex damage: +1d6 necrotic when the warlock who hexed the target hits it (PHB p.251)
    const hexDie = getActiveHexDie(target, attacker.id);
    if (hexDie > 0) {
      const hexRoll = rollDie(hexDie);
      dmg += hexRoll;
      log(state, 'action', attacker.id,
        `${attacker.name} deals Hex bonus (+${hexRoll} necrotic) to ${target.name}`, target.id, hexRoll);
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
      if (!maintained) {
        removeEffectsFromCaster(target.id, state.battlefield);
        log(state, 'condition_remove', target.id,
          `${target.name} loses concentration on ${target.concentration?.spellName ?? 'spell'}!`, undefined);
      }
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
    // Apply cantrip special effects (e.g., Thorn Whip pull, Ray of Frost slow)
    applyCantripEffect(attacker, target, action.name, state);
    applyWardingBondRedirect(target, dealt, state);
    checkDeath(target, state);
  }
}

/**
 * Warding Bond (PHB p.287): after the bonded creature takes damage, the caster
 * takes the same amount.  Breaks the bond if the caster drops to 0 HP.
 * Called after every applyDamageWithTempHP on a bonded target.
 */
function applyWardingBondRedirect(
  bonded:  Combatant,
  dealt:   number,
  state:   EngineState,
): void {
  if (!bonded.wardingBond || dealt <= 0) return;
  const caster = state.battlefield.combatants.get(bonded.wardingBond.casterId);
  if (!caster || caster.isDead || caster.isUnconscious) {
    // Caster already incapacitated — bond ends silently
    bonded.wardingBond = null;
    return;
  }
  // Caster takes the same damage (null type — already post-resistance from bonded's side)
  const casterDealt = applyDamageWithTempHP(caster, dealt, null);
  log(state, 'damage', caster.id,
    `${caster.name} takes ${casterDealt} damage from Warding Bond (protecting ${bonded.name})`,
    bonded.id, casterDealt);
  checkDeath(caster, state);
  // Break bond if caster dropped to 0 HP
  if (caster.isDead || caster.isUnconscious) {
    bonded.wardingBond = null;
    log(state, 'condition_remove', caster.id,
      `Warding Bond ends — ${caster.name} dropped to 0 HP`, bonded.id);
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
    removeEffectsFromCaster(target.id, state.battlefield);
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
    // Warding Bond (PHB p.287): spell ends when caster drops to 0 HP.
    // Clear bond on any creature bonded to this (now-downed) caster.
    if (c.wardingBond?.casterId === target.id) {
      c.wardingBond = null;
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
      // Consume spell slot for leveled spells (slotLevel >= 1)
      if (plan.action.slotLevel && plan.action.slotLevel >= 1) {
        consumeSpellSlot(actor, plan.action.slotLevel);
      }
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
      // PHB p.192: Dash gives a stipend equal to speed *after* condition modifiers.
      // A grappled/paralysed/restrained creature has effectiveSpeed = 0, so gains nothing.
      actor.budget.movementFt += effectiveSpeed(actor);
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
    case 'faerieFire': {
      // Faerie Fire — PHB p.239: DEX save or outlined (advantage on all attacks vs target).
      // AoE 20-ft cube, concentration, range 60 ft.
      // Re-run shouldCast to get the live target list (planning may have been stale).
      const ffTargets = shouldCastFaerieFire(actor, bf);
      if (!ffTargets || ffTargets.length === 0) break;
      executeFaerieFire(actor, ffTargets, state);
      break;
    }
    case 'bless': {
      // Bless — PHB p.219: +1d4 to attack rolls and saving throws for up to 3 allies.
      // Concentration, range 30 ft.
      // Re-run shouldCast to get the live target list (planning may have been stale).
      const blessTargets = shouldCastBless(actor, bf);
      if (!blessTargets || blessTargets.length === 0) break;
      executeBless(actor, blessTargets, state);
      break;
    }

    case 'entangle': {
      // Entangle — PHB p.238: STR save or restrained for duration.
      // AoE 20-ft square, concentration, range 90 ft.
      // Re-run shouldCast to get the live target list (planning may have been stale).
      const entangleTargets = shouldCastEntangle(actor, bf);
      if (!entangleTargets || entangleTargets.length === 0) break;
      executeEntangle(actor, entangleTargets, state);
      break;
    }

    case 'thunderwave': {
      // Thunderwave — PHB p.282: CON save, 2d8 thunder + push 10ft on fail.
      // 15-ft cube from caster, NOT concentration.
      // Re-run shouldCast to get the live target list (planning may have been stale).
      const twTargets = shouldCastThunderwave(actor, bf);
      if (!twTargets || twTargets.length === 0) break;
      executeThunderwave(actor, twTargets, state);
      break;
    }

    case 'armsOfHadar': {
      // Arms of Hadar — PHB p.215: STR save, 2d6 necrotic + lose reaction on fail.
      // 10-ft radius circle centred on caster (Euclidean AoE), NOT concentration.
      //
      // We do NOT re-run shouldCast here because shouldCast re-checks the spell slot,
      // which may already have been consumed by hexPlan() during bonus-action planning
      // (both Hex and Arms of Hadar share the single Warlock pact slot).
      // The slot check was validated in the planner; we only need fresh live targets.
      const aohTargets = [...bf.combatants.values()].filter(c =>
        c.faction !== actor.faction &&
        !c.isDead && !c.isUnconscious &&
        euclideanDistFt(actor.pos, c.pos) <= 10
      );
      if (aohTargets.length === 0) break;
      executeArmsOfHadar(actor, aohTargets, state);
      break;
    }

    case 'sleep': {
      // Sleep — PHB p.276: 5d8 HP budget, no save, renders lowest-HP enemies unconscious.
      // NOT concentration. Range 90 ft, 20-ft sphere.
      // Re-run shouldCast to get the live target list (enemies may have died since planning).
      // Sleep does NOT share a slot with any bonus-action spell for Sorcerer/Wizard,
      // so the re-run pattern is safe here (unlike armsOfHadar + Hex pact-slot conflict).
      const sleepTargets = shouldCastSleep(actor, bf);
      if (!sleepTargets || sleepTargets.length === 0) break;
      executeSleep(actor, sleepTargets, state);
      break;
    }

    case 'hex': {
      // Hex — PHB p.251: +1d6 necrotic on each hit vs hexed target (bonus action, concentration).
      // Slot was consumed in hexPlan (resources.ts). Here we apply the effect on the target.
      const hexTargetId = plan.targetId;
      if (!hexTargetId) break;
      const hexTarget = bf.combatants.get(hexTargetId);
      if (!hexTarget || hexTarget.isDead || hexTarget.isUnconscious) break;
      executeHex(actor, hexTarget, state);
      break;
    }

    case 'magicMissile': {
      // Magic Missile — PHB p.257: 3 auto-hit darts, each 1d4+1 force. 120 ft, no concentration.
      // Slot consumed inside executeMagicMissile.
      const mmTarget = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!mmTarget || mmTarget.isDead || mmTarget.isUnconscious) break;
      executeMagicMissile(actor, mmTarget, state);
      break;
    }

    case 'burningHands': {
      // Burning Hands — PHB p.220: 15-ft cone, DEX save, 3d6 fire, half on success. No conc.
      // shouldCastBurningHands re-evaluated here to get the full target list;
      // plan.targetId holds only the aimed-at target for animation/log purposes.
      const bhTargets = shouldCastBurningHands(actor, bf) ?? [];
      if (bhTargets.length === 0) break;
      const aimTarget = plan.targetId ? bf.combatants.get(plan.targetId) : bhTargets[0];
      executeBurningHands(actor, bhTargets, state, aimTarget ?? bhTargets[0]);
      break;
    }

    case 'dissonantWhispers': {
      // Dissonant Whispers — PHB p.234: WIS save, 3d6 psychic. Fail: forced flee at full speed.
      // Single target; deafened creatures auto-succeed (handled inside execute).
      const dwTarget = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!dwTarget || dwTarget.isDead || dwTarget.isUnconscious) break;
      executeDissonantWhispers(actor, dwTarget, state);
      break;
    }

    case 'mageArmor': {
      // Mage Armor — PHB p.256: base AC = 13 + DEX mod while unarmored (no concentration).
      if (shouldCastMageArmor(actor, bf)) executeMageArmor(actor, state);
      break;
    }

    case 'wardingBond': {
      // Warding Bond — PHB p.287: protect an adjacent ally (touch range, no concentration).
      const wbTargetId = plan.targetId;
      if (!wbTargetId) break;
      const wbTarget = bf.combatants.get(wbTargetId);
      if (!wbTarget || wbTarget.isDead || wbTarget.isUnconscious) break;
      executeWardingBond(actor, wbTarget, state);
      break;
    }

    case 'shieldOfFaith': {
      // Shield of Faith — PHB p.275: +2 AC to one ally (bonus action, concentration, 60 ft).
      // Re-fetch target live in case battlefield changed since planning.
      const sofTargetId = plan.targetId;
      if (!sofTargetId) break;
      const sofTarget = bf.combatants.get(sofTargetId);
      if (!sofTarget || sofTarget.isDead || sofTarget.isUnconscious) break;
      executeShieldOfFaith(actor, sofTarget, state);
      break;
    }
    case 'layOnHands': {
      // PHB p.84: Paladin action; restore HP from the Lay on Hands pool.
      // applyHeal handles the unconscious → conscious transition for downed allies.
      const lohTarget = plan.targetId
        ? state.battlefield.combatants.get(plan.targetId) ?? null
        : null;
      if (lohTarget && !lohTarget.isDead && plan.healAmount && plan.healAmount > 0) {
        const wasUnconscious = lohTarget.isUnconscious;
        const healed = applyHeal(lohTarget, plan.healAmount);
        if (wasUnconscious && healed > 0) {
          // applyHeal already cleared isUnconscious — log the event
          log(state, 'condition_remove', lohTarget.id,
            `${lohTarget.name} regains consciousness!`, lohTarget.id);
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
    case 'spellHeal': {
      // Cure Wounds (action) or Healing Word (bonus action).
      // PHB p.230 / p.250: 1d8+WIS or 1d4+WIS; restores HP to a touched/nearby creature.
      // healAmount was rolled eagerly in spellHealPlan (slot already consumed).
      const shTarget = plan.targetId
        ? state.battlefield.combatants.get(plan.targetId) ?? null
        : null;
      if (shTarget && !shTarget.isDead && plan.healAmount && plan.healAmount > 0) {
        const wasUnconscious = shTarget.isUnconscious;
        const healed = applyHeal(shTarget, plan.healAmount);
        if (wasUnconscious && healed > 0) {
          // applyHeal already cleared isUnconscious — log the event
          log(state, 'condition_remove', shTarget.id,
            `${shTarget.name} regains consciousness!`, shTarget.id);
        }
        log(state, 'action', actor.id, plan.description);
        log(state, 'heal', actor.id,
          `${actor.name} restores ${healed} HP to ${shTarget.name}`,
          shTarget.id, healed);
      } else {
        log(state, 'action', actor.id, plan.description);
      }
      break;
    }
    case 'hide': {
      // Cunning Action: Hide (PHB p.96)
      // Rogue makes a DEX (Stealth) check. Proficiency always applies (Rogues have Stealth prof).
      // Compare to each enemy's Passive Perception (10 + WIS mod).
      // If the roll exceeds the highest passive perception among living enemies, Rogue is Hidden.
      // 'hidden' condition grants advantage on the Rogue's next attack and disadvantage on attacks
      // against them. Condition is removed immediately when the Rogue attacks (PHB p.177/194).
      const stealthRoll = rollDie(20) + abilityMod(actor.dex) + proficiencyBonus(actor.cr);
      const enemies = [...bf.combatants.values()].filter(
        c => c.faction !== actor.faction && !c.isDead && !c.isUnconscious
      );
      const maxPassivePerception = enemies.length > 0
        ? Math.max(...enemies.map(e => 10 + abilityMod(e.wis)))
        : 0;
      if (enemies.length === 0 || stealthRoll > maxPassivePerception) {
        addCondition(actor, 'hidden');
        log(state, 'condition_add', actor.id,
          `${actor.name} Hides! (Stealth ${stealthRoll} > Passive Perception ${maxPassivePerception})`,
          actor.id);
      } else {
        log(state, 'action', actor.id,
          `${actor.name} tries to Hide but is Detected! (Stealth ${stealthRoll} ≤ Passive Perception ${maxPassivePerception})`,
          actor.id);
      }
      break;
    }
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
    case 'shield': {
      // Shield — PHB p.275: reaction, +5 AC until start of next turn, blocks Magic Missile
      // Plan.targetId stores the triggering attack name for logging purposes
      const triggeringAttack = plan.targetId ?? undefined;
      executeShield(actor, state, triggeringAttack);
      break;
    }

    case 'guidingBolt': {
      // Guiding Bolt — PHB p.248: ranged spell attack, 4d6 radiant, marks target.
      // Next attack roll against marked target before end of caster's next turn has advantage.
      const gbTarget = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!gbTarget || gbTarget.isDead || gbTarget.isUnconscious) break;
      if (shouldCastGuidingBolt(actor, gbTarget, bf)) executeGuidingBolt(actor, gbTarget, state);
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
  const isDisengage = plan.action?.type === 'disengage'
                   || plan.bonusAction?.type === 'disengage';

  const isDash = plan.action?.type === 'dash';
  // Cunning Action: Dash (and any future bonus-action Dash) must fire BEFORE movement
  // so its speed stipend is available to spend. All other bonus actions fire after.
  const isBonusDash = plan.bonusAction?.type === 'dash';

  // For action-Dash: execute the Dash action first to add speed stipend,
  // THEN move — otherwise the extra movement isn't available yet.
  if (isDash) {
    if (plan.action && !actor.isDead && !actor.isUnconscious) {
      actor.budget.actionUsed = true;
      executePlannedAction(actor, plan.action, state);  // adds effectiveSpeed to movementFt
    }
    if (plan.moveBefore && !actor.isDead && !actor.isUnconscious) {
      executeMove(actor, plan.moveBefore, state, isDisengage);
    }
  } else {
    // Bonus-action Dash (e.g. Cunning Action): fire first so stipend is available for moveBefore
    if (isBonusDash && plan.bonusAction && !actor.isDead && !actor.isUnconscious) {
      actor.budget.bonusActionUsed = true;
      executePlannedAction(actor, plan.bonusAction, state);  // adds effectiveSpeed to movementFt
    }
    // Normal order: move → action
    if (plan.moveBefore && !actor.isDead && !actor.isUnconscious) {
      executeMove(actor, plan.moveBefore, state, isDisengage);
    }
    if (plan.action && !actor.isDead && !actor.isUnconscious) {
      actor.budget.actionUsed = true;
      executePlannedAction(actor, plan.action, state);
    }
  }

  // Bonus action (non-Dash: Disengage, Bardic Inspiration, rage, etc. fire after the action)
  if (!isBonusDash && plan.bonusAction && !actor.isDead && !actor.isUnconscious) {
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
            // Dash: rider gets another speed stipend equal to mount's base speed
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

      // Guiding Bolt fallback expiry: remove any marks this caster placed last turn (PHB p.248).
      // Primary expiry happens in resolveAttack (consumeGuidingBoltMark); this is the safety net.
      cleanupGuidingBoltMarks(actor, battlefield);

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
