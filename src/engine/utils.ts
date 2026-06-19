// ============================================================
// Engine Utilities
// Core combat math: rolling, damage, conditions, initiative, budget
// ============================================================

import { Combatant, Action, DiceExpression, Condition, ActionBudget, Battlefield, CreatureSize, DamageType } from '../types/core';
import { querySelf, queryVulnerability } from './adv_system';
import { getActiveBlessDie, getActiveEnlargeReduce } from './spell_effects';
import { cleanup as cleanupShield } from '../spells/shield';
import { cleanup as cleanupRayOfFrost } from '../spells/ray_of_frost';
import { cleanup as cleanupChillTouch } from '../spells/chill_touch';
import { cleanup as cleanupBladeWard } from '../spells/blade_ward';
import { cleanup as cleanupViciousMockery } from '../spells/vicious_mockery';
import { cleanup as cleanupMindSliver } from '../spells/mind_sliver';
import { cleanup as cleanupBoomingBlade } from '../spells/booming_blade';
import { cleanup as cleanupFrostbite } from '../spells/frostbite';
import { cleanup as cleanupInfestation } from '../spells/infestation';
import { cleanup as cleanupShillelagh } from '../spells/shillelagh';
import { cleanup as cleanupTrueStrike } from '../spells/true_strike';
import { cleanup as cleanupResistance } from '../spells/resistance';
import { cleanup as cleanupGuidance } from '../spells/guidance';
import { cleanup as cleanupFriends } from '../spells/friends';
import { cleanup as cleanupLight } from '../spells/light';
import { cleanup as cleanupMending } from '../spells/mending';
import { cleanup as cleanupBrandingSmite } from '../spells/branding_smite';

// Damage types resisted by Blade Ward (PHB p.218) — bludgeoning/piercing/slashing.
const BLADE_WARD_PHYSICAL_TYPES: DamageType[] = ['bludgeoning', 'piercing', 'slashing'];

// ---- Dice rolling -------------------------------------------

/** Roll a single die with `sides` sides. Returns 1..sides. */
export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/** Roll and sum `count`d`sides` + `bonus`. */
export function rollDice(expr: DiceExpression): number {
  let total = expr.bonus;
  for (let i = 0; i < expr.count; i++) total += rollDie(expr.sides);
  return total;
}

/** Roll with advantage: roll twice, take higher. */
export function rollWithAdvantage(sides = 20): number {
  return Math.max(rollDie(sides), rollDie(sides));
}

/** Roll with disadvantage: roll twice, take lower. */
export function rollWithDisadvantage(sides = 20): number {
  return Math.min(rollDie(sides), rollDie(sides));
}

/**
 * Roll a d20 attack roll, applying advantage/disadvantage.
 * Returns { roll, total, isCrit, isFumble }.
 */
export function rollAttack(
  hitBonus: number,
  hasAdvantage: boolean,
  hasDisadvantage: boolean
): { roll: number; total: number; isCrit: boolean; isFumble: boolean } {
  // Advantage and disadvantage cancel out (PHB p.173)
  let roll: number;
  if (hasAdvantage && !hasDisadvantage) {
    roll = rollWithAdvantage();
  } else if (hasDisadvantage && !hasAdvantage) {
    roll = rollWithDisadvantage();
  } else {
    roll = rollDie(20);
  }
  return {
    roll,
    total: roll + hitBonus,
    isCrit: roll === 20,
    isFumble: roll === 1,
  };
}

/**
 * Roll damage for an attack.
 * On a crit: roll each damage die twice (PHB p.196).
 */
export function rollDamage(expr: DiceExpression, isCrit: boolean): number {
  let total = expr.bonus;
  const rolls = isCrit ? expr.count * 2 : expr.count;
  for (let i = 0; i < rolls; i++) total += rollDie(expr.sides);
  return Math.max(0, total); // damage never negative
}

// ---- Ability modifiers / saves ------------------------------

/** Standard 5e ability modifier: floor((score - 10) / 2) */
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Proficiency bonus by CR (MM p.8). For PCs use level-based table. */
export function profBonusByCR(cr: number | null): number {
  if (cr === null) return 2; // default
  if (cr <= 4)  return 2;
  if (cr <= 8)  return 3;
  if (cr <= 12) return 4;
  if (cr <= 16) return 5;
  return 6;
}

/**
 * Roll a saving throw.
 * Returns { roll, total, success }.
 */
export function rollSave(
  combatant: Combatant,
  ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha',
  dc: number,
  isProficient = false
): { roll: number; total: number; success: boolean } {
  const score = combatant[ability];
  const mod = abilityMod(score);
  const prof = isProficient ? profBonusByCR(combatant.cr) : 0;

  // Conditions and advantage-system entries that affect saving throws
  const selfSave = querySelf(combatant, `save:${ability}` as import('../types/core').D20TestScope);
  const allSave  = querySelf(combatant, 'save');
  // Rage (PHB p.48): "You have advantage on Strength checks and Strength
  // saving throws while raging." This is a flat unconditional advantage on
  // STR saves — not modeled via the advantage-system entries because it's
  // always-on while rage is active (no per-turn bookkeeping needed).
  const rageStrAdvantage =
    ability === 'str' && combatant.resources?.rage?.active === true;
  // Enlarge/Reduce (PHB p.237 — Session 17): "The target has advantage on
  // Strength checks and Strength saving throws" (enlarge) or "disadvantage
  // Strength checks and Strength saving throws" (reduce). Flat unconditional
  // adv/disadv on STR saves — modeled via the enlarge_reduce ActiveEffect
  // (queried by getActiveEnlargeReduce), NOT via the advantage-system entries
  // (same pattern as rageStrAdvantage).
  const enlargeReduceMode = getActiveEnlargeReduce(combatant);
  const enlargeStrAdvantage   = ability === 'str' && enlargeReduceMode === 'enlarge';
  const enlargeStrDisadvantage = ability === 'str' && enlargeReduceMode === 'reduce';
  const hasAdvantage   = selfSave.advantage   || allSave.advantage   || rageStrAdvantage    || enlargeStrAdvantage;
  const hasDisadvantage = combatant.conditions.has('poisoned') // PHB Appendix A: poisoned → disadv on saves
    || selfSave.disadvantage || allSave.disadvantage
    || enlargeStrDisadvantage;

  let roll: number;
  if (hasAdvantage && !hasDisadvantage) roll = rollWithAdvantage();
  else if (hasDisadvantage && !hasAdvantage) roll = rollWithDisadvantage();
  else roll = rollDie(20);

  // Bardic Inspiration die — consumed on save rolls too (PHB p.54)
  const biBonus = consumeBardicInspiration(combatant);

  // Bless die — +1d4 to saving throws when blessed (PHB p.219)
  const blessSides = getActiveBlessDie(combatant);
  const blessBonus = blessSides > 0 ? rollDie(blessSides) : 0;

  // Warding Bond: +1 to all saving throws while bonded (PHB p.287)
  const wbBonus = combatant.wardingBond ? 1 : 0;

  // Mind Sliver (TCE p.108): one-shot save debuff — target subtracts
  // 1d4 (or rollDie(storedSides)) from the next save it makes, then the
  // flag is consumed (cleared) regardless of success/failure. The flag is
  // set by Mind Sliver's applyCantripEffect on save-FAIL; rollSave is the
  // choke point (new in this session — Vicious Mockery integrated into
  // resolveAttack's attack-roll branch; Mind Sliver integrates here).
  let mindSliverPenalty = 0;
  if (combatant._mindSliverDiePenaltyNextSave !== undefined) {
    mindSliverPenalty = rollDie(combatant._mindSliverDiePenaltyNextSave);
    // Consume (one-shot) — clear the flag now so subsequent saves this
    // turn (and beyond) are unaffected. TCE p.108: "the NEXT saving
    // throw it makes" — singular.
    delete combatant._mindSliverDiePenaltyNextSave;
  }

  // Resistance (PHB p.272): one-shot save buff — target adds 1d4 (or
  // rollDie(storedSides)) to the next save it makes, then the flag is
  // consumed (cleared) regardless of success/failure. The flag is set by
  // Resistance's applySelfEffect on cast (CANTRIP_SELF_EFFECTS); rollSave
  // is the choke point (mirror Mind Sliver's subtract-1d4 logic but with
  // the OPPOSITE SIGN — Resistance ADDS, Mind Sliver SUBTRACTS). PHB p.272:
  // "Once before the spell ends, the target can roll a d4 and add the
  // number rolled to one saving throw of its choice." The stored value
  // is the die size (4 = d4) so the system is extensible to other die
  // bonuses.
  let resistanceBonus = 0;
  if (combatant._resistanceDieBonusNextSave !== undefined) {
    resistanceBonus = rollDie(combatant._resistanceDieBonusNextSave);
    // Consume (one-shot) — clear the flag now so subsequent saves this
    // turn (and beyond) are unaffected. PHB p.272: "Once before the spell
    // ends" — singular.
    delete combatant._resistanceDieBonusNextSave;
  }

  const total = roll + mod + prof + biBonus + blessBonus + wbBonus - mindSliverPenalty + resistanceBonus;
  return { roll, total, success: total >= dc };
}

/**
 * Roll an ability check (PHB p.174–175).
 *
 * d20 + ability modifier (+ proficiency bonus if proficient — e.g. skill
 * or tool proficiency). NO auto-fail on nat 1 / NO auto-success on nat 20
 * (those only apply to attack rolls PHB p.194 and death saves PHB p.197;
 * ability checks have no critical-fail/critical-success rule).
 *
 * Mirrors rollSave's architecture. Folds in:
 *   - Bardic Inspiration die (PHB p.54 — adds rollDie(die) once per grant,
 *     consumed; applies to attack rolls, ability checks, AND saving throws).
 *   - Guidance cantrip (PHB p.248 — ADD rollDie(_guidanceDieBonusNextAbilityCheck)
 *     to the next ability check, one-shot consume; applies to ANY ability
 *     check — str/dex/con/int/wis/cha). THIS IS THE CHOKE POINT that
 *     consumes the scratch flag set by guidance.ts's applySelfEffect.
 *   - Friends cantrip (PHB p.244 — advantage on the next CHA check, one-shot
 *     consume; CHA-only). v1 simplification: target-agnostic (the buff
 *     applies to the next CHA check regardless of target — see friends.ts
 *     header). THIS IS THE CHOKE POINT that consumes the scratch flag set
 *     by friends.ts's applySelfEffect.
 *   - Rage (PHB p.48 — advantage on STR checks AND STR saves while raging;
 *     flat unconditional advantage, no per-turn bookkeeping needed).
 *   - Poisoned condition (PHB Appendix A — disadvantage on attack rolls
 *     AND ability checks; RAW does NOT impose disadvantage on saves, but
 *     rollSave models poisoned disadv on saves too — a known v1
 *     simplification that this function does NOT replicate).
 *   - Advantage-system entries via querySelf (scope 'ability' and
 *     'ability:<ab>' — set via adv_system.grantSelf).
 *
 * v1 simplifications (documented here for the next agent):
 *   - Does NOT model exhaustion (PHB p.291 — disadvantage on ability
 *     checks; exhaustion isn't tracked in the conditions Set, it's a
 *     separate subtype). Future work: track exhaustion levels.
 *   - Does NOT model every condition's ability-check interaction (e.g.
 *     blinded imposes DM-fiat disadvantage on sight-based checks;
 *     frightened has no explicit ability-check penalty; restrained has
 *     no explicit ability-check penalty). Only poisoned + rage are
 *     folded in (mirror rollSave's poisoned disadvantage + rage-STR
 *     advantage). Future work: extend as needed when a spell/feature
 *     requires it.
 *   - Does NOT auto-tick advantage-system entries (the caller is
 *     responsible for calling tickAdvantages at the start of each turn —
 *     mirror rollSave).
 *
 * The `details` array is a human-readable breakdown of each component
 * (advantage source, d20 roll, ability mod, prof, BI, Guidance, total,
 * dc, success/fail). Useful for combat-log rendering and debugging.
 *
 * @returns { roll, total, success, details }
 *   - roll:    the raw d20 result (or the higher/lower of two dice if
 *              advantage/disadvantage applied and didn't cancel out).
 *   - total:   roll + ability mod + prof + BI + Guidance bonus.
 *   - success: total >= dc.
 *   - details: human-readable strings describing each component.
 */
export function rollAbilityCheck(
  combatant: Combatant,
  ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha',
  dc: number,
  isProficient = false,
): { roll: number; total: number; success: boolean; details: string[] } {
  const score = combatant[ability];
  const mod = abilityMod(score);
  const prof = isProficient ? profBonusByCR(combatant.cr) : 0;
  const details: string[] = [];

  // ── Advantage / disadvantage sources ──────────────────────────
  // Friends cantrip (PHB p.244) — advantage on the next CHA check,
  // one-shot. Canonically target-agnostic in v1 (the buff applies to the
  // next CHA check regardless of target). The flag is CONSUMED after the
  // roll resolves (one-shot — PHB p.244: "advantage on all Charisma
  // checks directed at one creature" — v1 simplifies to the NEXT CHA
  // check regardless of target).
  const friendsAdv = ability === 'cha' && combatant._friendsAdvNextChaCheck === true;

  // Rage (PHB p.48): "You have advantage on Strength checks and Strength
  // saving throws while raging." Flat unconditional advantage on STR
  // checks — not modeled via the advantage-system entries because it's
  // always-on while rage is active (no per-turn bookkeeping needed).
  // Mirrors rollSave's rageStrAdvantage for STR saves.
  const rageStrAdvantage =
    ability === 'str' && combatant.resources?.rage?.active === true;

  // ── Session 17 — level-2 batch 3 ability-check advantage sources ──────
  // Enlarge/Reduce (PHB p.237): "advantage on Strength checks" (enlarge) /
  // "disadvantage on Strength checks" (reduce). Flat unconditional, modeled
  // via the enlarge_reduce ActiveEffect (queried by getActiveEnlargeReduce).
  const enlargeReduceMode = getActiveEnlargeReduce(combatant);
  const enlargeStrAdvantage    = ability === 'str' && enlargeReduceMode === 'enlarge';
  const enlargeStrDisadvantage = ability === 'str' && enlargeReduceMode === 'reduce';

  // Enhance Ability (PHB p.237): "advantage on one ability check of the
  // chosen type". Flat unconditional advantage on the matching ability's
  // checks, modeled via the `_enhanceAbilityActive` scratch field (set by
  // enhance_ability.ts; cleared by the damage_zone sentinel's _undoEffect
  // on concentration break). v1 simplification: advantage only (no Bear's
  // Endurance 2d6 temp HP, no Cat's Grace fall-damage immunity).
  const enhanceAbilityAdv = ability === combatant._enhanceAbilityActive;

  // Advantage-system entries (spells, feats, class features that grant
  // adv/dis on ability checks via grantSelf — scope 'ability' covers any
  // ability check; 'ability:str' covers STR checks specifically; etc.).
  const selfCheck = querySelf(combatant, `ability:${ability}` as import('../types/core').D20TestScope);
  const allCheck  = querySelf(combatant, 'ability');

  // Poisoned (PHB Appendix A): "While poisoned, the creature has
  // disadvantage on attack rolls and ability checks." RAW does NOT
  // impose disadvantage on saves — rollSave models it for saves too (a
  // known v1 simplification). For ability checks, poisoned disadvantage
  // IS canonically correct.
  const poisonedDisadv = combatant.conditions.has('poisoned');

  const hasAdvantage    = friendsAdv || selfCheck.advantage   || allCheck.advantage   || rageStrAdvantage || enlargeStrAdvantage || enhanceAbilityAdv;
  const hasDisadvantage = poisonedDisadv || selfCheck.disadvantage || allCheck.disadvantage || enlargeStrDisadvantage;

  let roll: number;
  if (hasAdvantage && !hasDisadvantage) {
    roll = rollWithAdvantage();
    details.push('advantage');
  } else if (hasDisadvantage && !hasAdvantage) {
    roll = rollWithDisadvantage();
    details.push('disadvantage');
  } else {
    roll = rollDie(20);
  }
  // If both advantage AND disadvantage, neither applies (PHB p.173) — single roll.

  details.push(`d20=${roll}`);
  details.push(`${ability} mod=${mod >= 0 ? '+' : ''}${mod}`);
  if (prof !== 0) details.push(`prof=+${prof}`);

  // ── Bardic Inspiration (PHB p.54) ─────────────────────────────
  // Adds rollDie(die) once per grant; applies to attack rolls, ability
  // checks, AND saving throws. Consumed after the roll resolves (one-shot
  // per grant). Mirrors rollSave's BI integration.
  const biBonus = consumeBardicInspiration(combatant);
  if (biBonus > 0) details.push(`BI=+${biBonus}`);

  // ── Guidance cantrip (PHB p.248) ──────────────────────────────
  // ADD rollDie(value) to the ability-check total, one-shot consume.
  // Applies to ANY ability check (str/dex/con/int/wis/cha). The flag is
  // set by guidance.ts's applySelfEffect (CANTRIP_SELF_EFFECTS); this is
  // the consuming choke point (mirror Resistance's rollSave integration,
  // but for ability checks instead of saves). PHB p.248: "Once before the
  // spell ends, the target can roll a d4 and add the number rolled to one
  // ability check of its choice." — singular, one-shot.
  let guidanceBonus = 0;
  if (combatant._guidanceDieBonusNextAbilityCheck !== undefined) {
    guidanceBonus = rollDie(combatant._guidanceDieBonusNextAbilityCheck);
    details.push(`Guidance=+${guidanceBonus}`);
    // Consume (one-shot) — clear the flag now so subsequent ability
    // checks this turn (and beyond) are unaffected.
    delete combatant._guidanceDieBonusNextAbilityCheck;
  }

  // ── Consume Friends flag (after the advantage roll is made) ───
  // The advantage was already applied to the d20 roll above; consume the
  // flag now (one-shot — set by friends.ts's applySelfEffect via
  // CANTRIP_SELF_EFFECTS; this is the consuming choke point, mirror True
  // Strike's resolveAttack advantage integration but for CHA checks).
  if (friendsAdv) {
    details.push('Friends advantage consumed');
    delete combatant._friendsAdvNextChaCheck;
  }

  const total = roll + mod + prof + biBonus + guidanceBonus;
  details.push(`total=${total}`);
  details.push(`dc=${dc}`);
  details.push(total >= dc ? 'success' : 'fail');

  return { roll, total, success: total >= dc, details };
}

// ---- HP / damage --------------------------------------------

/**
 * Apply `amount` damage to a combatant (in-place).
 * Returns actual damage dealt (capped at currentHP + tempHP).
 *
 * Handles:
 * - Temporary HP absorbs first (not modelled in core type yet — future)
 * - currentHP cannot go below 0
 * - Sets isDead/isUnconscious flags
 * - Monsters die at 0 HP; PCs go unconscious and make death saves
 */
export function applyDamage(target: Combatant, amount: number): number {
  const actual = Math.min(amount, target.currentHP);
  target.currentHP = Math.max(0, target.currentHP - amount);

  // PHB p.276: any damage immediately awakens a creature put to sleep by the Sleep spell.
  // Do this BEFORE the zero-HP logic so the creature is "awake" (just badly hurt) if
  // the damage brings them to 0 — checkDeath will handle the 0-HP state correctly.
  if (amount > 0 && target.conditions.has('sleeping')) {
    target.isUnconscious = false;
    target.conditions.delete('sleeping');
    target.conditions.delete('unconscious');
    target.conditions.delete('incapacitated');
  }

  if (target.currentHP === 0) {
    if (target.isPlayer) {
      target.isUnconscious = true;
      target.conditions.add('unconscious');
      target.conditions.add('incapacitated');
    } else {
      target.isDead = true;
      target.isUnconscious = true;
      target.conditions.add('unconscious');
      target.conditions.add('incapacitated');
    }
  }

  return actual;
}

/**
 * Heal `amount` HP on a target (capped at maxHP).
 *
 * Chill Touch (PHB p.221): if the target was struck by Chill Touch this round,
 * its _chillTouchNoHealing flag is set and it cannot regain HP until the start
 * of the caster's next turn. We short-circuit and return 0 (no healing). The
 * lock is logged by the cantrip's applyCantripEffect; here we stay silent.
 */
export function applyHeal(target: Combatant, amount: number): number {
  if (target.isDead) return 0; // Dead = no heal (stabilise is separate)
  if (target._chillTouchNoHealing) return 0; // Chill Touch heal-block rider
  const was = target.currentHP;
  target.currentHP = Math.min(target.maxHP, target.currentHP + amount);

  if (was === 0 && target.currentHP > 0) {
    // Regained consciousness
    target.isUnconscious = false;
    target.conditions.delete('unconscious');
    target.conditions.delete('incapacitated');
  }

  return target.currentHP - was;
}

/** Is the combatant "bloodied" (below 50% HP)? Observable heuristic. */
export function isBloodied(c: Combatant): boolean {
  return c.currentHP < c.maxHP * 0.5;
}

// ---- Conditions ---------------------------------------------

export function addCondition(target: Combatant, condition: Condition): void {
  target.conditions.add(condition);
  // Cascade: incapacitated implies can't take actions
  if (condition === 'paralyzed' || condition === 'stunned' || condition === 'petrified') {
    target.conditions.add('incapacitated');
  }
}

export function removeCondition(target: Combatant, condition: Condition): void {
  target.conditions.delete(condition);
  // Clean up cascade if no other incapacitating condition remains
  if (condition === 'incapacitated') {
    const stillIncap = target.conditions.has('paralyzed')
      || target.conditions.has('stunned')
      || target.conditions.has('petrified')
      || target.conditions.has('unconscious');
    if (stillIncap) target.conditions.add('incapacitated');
  }
}

// ---- Action budget ------------------------------------------

/** Reset a combatant's action budget at the start of their turn (PHB Ch.9). */
export function resetBudget(c: Combatant): void {
  // Shield expires at start of caster's next turn (PHB p.275)
  cleanupShield(c);
  // Ray of Frost speed reduction expires at start of caster's next turn (PHB p.271)
  cleanupRayOfFrost(c);
  // Chill Touch riders (no-heal + undead disadv) expire at start of next turn (PHB p.221)
  cleanupChillTouch(c);
  // Blade Ward resistance expires at start of caster's next turn (PHB p.218)
  cleanupBladeWard(c);
  // Vicious Mockery one-shot disadv expires if not consumed by an attack roll
  // before the end of the target's next turn (PHB p.285).
  cleanupViciousMockery(c);
  // Mind Sliver one-shot save penalty expires if not consumed by a save
  // before the start of the target's next turn (TCE p.108). Codebase
  // convention: clears at the start of the AFFECTED creature's next turn
  // (slightly more lenient than PHB's "end of caster's next turn").
  cleanupMindSliver(c);
  // Booming Blade rider expires if the target didn't move willingly before
  // the start of its next turn (TCE p.106). Same codebase convention.
  cleanupBoomingBlade(c);
  // Frostbite one-shot weapon-attack disadv expires if not consumed by a
  // weapon attack before the start of the target's next turn (XGE p.156).
  // Same codebase convention as Vicious Mockery / Mind Sliver / Booming Blade.
  cleanupFrostbite(c);
  // Infestation random-direction move is instant (forced movement applied
  // immediately on save-FAIL). No scratch fields persist across turns — the
  // cleanup is a no-op, exported for symmetry with the other cantrip modules.
  cleanupInfestation(c);
  // Shillelagh self-buff (PHB p.275) — v1 simplification: 1-round duration,
  // clears at the start of the caster's next turn (canonically 1 minute / 10
  // rounds). While `_shillelaghActive === true`, resolveAttack's attack-roll
  // branch substitutes WIS mod for STR mod on melee attacks AND adds +1d8
  // radiant damage on hit.
  cleanupShillelagh(c);
  // True Strike self-buff (PHB p.284) — v1 simplification: 1-round duration,
  // clears at the start of the caster's next turn (canonically concentration,
  // up to 1 minute). While `_trueStrikeAdvNextAttack === true`, resolveAttack's
  // attack-roll branch folds the flag into the `advantage` boolean for ANY
  // attack type (melee, ranged, AND spell). One-shot — consumed by the first
  // attack roll; cleanup is a safety net.
  cleanupTrueStrike(c);
  // Resistance self-buff (PHB p.272) — v1 simplification: 1-round duration,
  // clears at the start of the caster's next turn (canonically concentration,
  // up to 1 minute). While `_resistanceDieBonusNextSave` is set, rollSave()
  // adds rollDie(value) to the save total (mirror Mind Sliver's subtract
  // logic, opposite sign). One-shot — consumed by the first save; cleanup is
  // a safety net.
  cleanupResistance(c);
  // Guidance self-buff (PHB p.248) — v1 simplification: 1-round duration,
  // clears at the start of the caster's next turn (canonically concentration,
  // up to 1 minute). While `_guidanceDieBonusNextAbilityCheck` is set,
  // rollAbilityCheck() (now implemented in this file — Session 14) ADDS
  // rollDie(value) to the ability-check total (mirror Resistance's save-bonus
  // integration, but for ability checks instead of saves). One-shot —
  // consumed by the first ability check; cleanup is a safety net (clears
  // the flag if the caster makes no ability check before their next turn).
  cleanupGuidance(c);
  // Friends self-buff (PHB p.244) — v1 simplification: 1-round duration,
  // clears at the start of the caster's next turn (canonically concentration,
  // up to 1 minute). While `_friendsAdvNextChaCheck === true`,
  // rollAbilityCheck() (now implemented in this file — Session 14) folds
  // this into the advantage boolean for Charisma checks (mirror True
  // Strike's attack-roll advantage integration, but for CHA checks instead
  // of ATTACK rolls). One-shot — consumed by the first CHA check; cleanup
  // is a safety net (clears the flag if the caster makes no CHA check
  // before their next turn).
  cleanupFriends(c);
  // Light touch-effect (PHB p.255) — v1 simplification: 1-round duration,
  // clears at the start of the caster's next turn (canonically 1 hour). The
  // `_lightSourceActive` flag is set on the TARGET (not the caster), but
  // v1's cleanup operates on the combatant whose turn is starting (the
  // caster). This means the flag is only cleared if the caster is also the
  // target (self-cast Light). For v1, this is acceptable — the flag is
  // forward-compat only (the vision subsystem is not yet implemented). The
  // cleanup also defensively clears the flag from ANY combatant that has
  // it set (no-op if the flag isn't set).
  cleanupLight(c);
  // Mending touch-effect (PHB p.259) — v1 simplification: 1-round cleanup
  // window, clears at the start of the caster's next turn (CANON casting
  // time is 1 MINUTE — the FIRST cantrip with a non-action casting time;
  // v1 treats Mending as a standard ACTION for engine simplicity, and the
  // cleanup is defensive since canonically the spell is INSTANT). The
  // `_mended` flag is set on the TARGET (not the caster), but v1's cleanup
  // operates on the combatant whose turn is starting (the caster). This
  // means the flag is only cleared if the caster is also the target (self-
  // cast Mending, which is rare). For v1, this is acceptable — the flag is
  // forward-compat only (the object-state subsystem is not yet implemented).
  // The cleanup also defensively clears the flag from ANY combatant that
  // has it set (no-op if the flag isn't set).
  cleanupMending(c);
  // Branding Smite self-buff (PHB p.219) — v1 simplification: 1-round
  // duration, clears at the start of the caster's next turn (canonically
  // concentration, up to 1 minute). While `_brandingSmiteActive === true`,
  // resolveAttack's damage branch rolls +2d6 radiant on the next weapon
  // hit (melee OR ranged, NOT spell) and CONSUMES the flag (one-shot —
  // PHB p.219: "the next time you hit a creature with a weapon attack",
  // singular). Cleanup is a safety net (clears the flag if the caster
  // makes no weapon attack before their next turn).
  cleanupBrandingSmite(c);

  const speed = effectiveSpeed(c);
  c.budget = {
    movementFt: speed,
    actionUsed: false,
    bonusActionUsed: false,
    reactionUsed: false,        // reaction resets at START of own turn (PHB p.190)
    freeObjectUsed: false,
  };
  // Legendary action pool resets at start of own turn (MM p.11)
  c.legendaryActionPool = c.legendaryActionPoolMax;
}

/** Reset only the reaction (used when "reaction refund" scenarios arise). */
export function resetReaction(c: Combatant): void {
  c.budget.reactionUsed = false;
}

/** Spend movement. Returns false if insufficient movement remains. */
export function spendMovement(c: Combatant, feet: number): boolean {
  if (c.budget.movementFt < feet) return false;
  c.budget.movementFt -= feet;
  return true;
}

/** Effective speed accounting for conditions (PHB Appendix A). */
export function effectiveSpeed(c: Combatant): number {
  if (c.conditions.has('grappled')) return 0;
  if (c.conditions.has('paralyzed')) return 0;
  if (c.conditions.has('stunned')) return 0;
  if (c.conditions.has('unconscious')) return 0;
  if (c.conditions.has('restrained')) return 0;
  return c.speed;
}

// ---- Initiative --------------------------------------------

/**
 * Roll initiative for all combatants and return an ordered array of IDs.
 * Ties between combatants of different factions: monsters go last (SAC/DM convention).
 * Ties within same faction: random.
 */
export function rollInitiative(battlefield: Battlefield): string[] {
  const entries: { id: string; init: number; tieBreaker: number }[] = [];

  for (const [id, c] of battlefield.combatants) {
    const dexMod = abilityMod(c.dex);
    const roll = rollDie(20) + dexMod;
    entries.push({ id, init: roll, tieBreaker: Math.random() });
  }

  // Sort descending by init, then by tieBreaker
  entries.sort((a, b) =>
    b.init !== a.init ? b.init - a.init : b.tieBreaker - a.tieBreaker
  );

  return entries.map(e => e.id);
}

// ---- Attack resolution helpers -----------------------------

/**
 * Does this attack roll hit the target AC?
 * nat 1 always misses, nat 20 always hits (PHB p.194).
 */
export function attackHits(roll: number, total: number, targetAC: number): boolean {
  if (roll === 1) return false;
  if (roll === 20) return true;
  return total >= targetAC;
}

/**
 * Check if the attacker has advantage or disadvantage on an attack.
 * Returns { advantage, disadvantage }.
 * Both being true means they cancel out (roll once, PHB p.173).
 */
export function attackAdvantageState(
  attacker: Combatant,
  target: Combatant
): { advantage: boolean; disadvantage: boolean } {
  let advantage = false;
  let disadvantage = false;

  // ── Attacker conditions (PHB Appendix A) ──────────────────
  if (attacker.conditions.has('blinded'))    disadvantage = true;
  if (attacker.conditions.has('frightened')) disadvantage = true;
  if (attacker.conditions.has('poisoned'))   disadvantage = true;
  if (attacker.conditions.has('restrained')) disadvantage = true;
  if (attacker.conditions.has('prone'))      disadvantage = true;
  // Invisible attacker has advantage on all attacks (PHB Appendix A)
  if (attacker.conditions.has('invisible'))  advantage    = true;
  // Hidden attacker has advantage on attacks (PHB p.194 — unseen attackers)
  // Note: 'hidden' is removed in resolveAttack immediately after advantage is computed.
  if (attacker.conditions.has('hidden'))     advantage    = true;

  // ── Target conditions (PHB Appendix A) ────────────────────
  if (target.conditions.has('blinded'))      advantage = true;
  if (target.conditions.has('paralyzed'))    advantage = true;
  // Prone: melee attacks have advantage, ranged have disadvantage (PHB Appendix A)
  // We encode both flags; resolveAttack passes attackType to decide which applies.
  // Store separately so caller can apply the right one.
  if (target.conditions.has('restrained'))   advantage = true;
  if (target.conditions.has('stunned'))      advantage = true;
  if (target.conditions.has('unconscious'))  advantage = true;
  // Invisible target → attacker has disadvantage (PHB Appendix A)
  if (target.conditions.has('invisible'))    disadvantage = true;
  // Hidden target → attacker has disadvantage (PHB p.194 — attacking an unseen creature)
  if (target.conditions.has('hidden'))       disadvantage = true;

  // ── Advantage/disadvantage system entries (spells, feats, class features) ──
  // Attacker's own advantage on attack rolls
  const selfAdv = querySelf(attacker, 'attack');
  if (selfAdv.advantage)    advantage    = true;
  if (selfAdv.disadvantage) disadvantage = true;

  // Vulnerabilities stored on the target (Dodge → disadv; Reckless Attack exposed → adv)
  const vulnAdv = queryVulnerability(target, 'attack');
  if (vulnAdv.advantage)    advantage    = true;
  if (vulnAdv.disadvantage) disadvantage = true;

  return { advantage, disadvantage };
}

/**
 * Resolve advantage/disadvantage for a specific attack type, including Prone.
 * PHB Appendix A: melee attacks vs prone target have advantage;
 * ranged attacks vs prone target have disadvantage.
 * Combines base state with prone modifier.
 */
export function resolveAttackAdvantage(
  attacker: Combatant,
  target: Combatant,
  attackType: import('../types/core').AttackType | null
): { advantage: boolean; disadvantage: boolean } {
  const base = attackAdvantageState(attacker, target);
  let { advantage, disadvantage } = base;

  if (target.conditions.has('prone')) {
    if (attackType === 'melee' || attackType === 'spell') {
      advantage = true;     // melee/spell: advantage on prone target
    } else if (attackType === 'ranged') {
      disadvantage = true;  // ranged: disadvantage on prone target
    }
  }

  return { advantage, disadvantage };
}

// ---- Concentration ------------------------------------------

/**
 * When a concentrating creature takes damage, they must make a CON save.
 * DC = max(10, half damage taken). PHB p.203.
 */
export function concentrationSaveDC(damageTaken: number): number {
  return Math.max(10, Math.floor(damageTaken / 2));
}

// ---- Expected damage (AI utility) --------------------------

/**
 * Expected damage per attack vs. a target AC.
 * Used by AI for scoring actions without rolling dice.
 *
 * Formula: P(hit) * avgDamage + P(crit) * extraCritDamage
 * where P(crit) = 1/20, P(hit) includes crit.
 */
export function expectedDamage(
  hitBonus: number | null,
  damage: DiceExpression | null,
  targetAC: number
): number {
  if (!damage) return 0;

  const avg = damage.average;

  if (hitBonus === null) {
    // No attack roll (auto-hit or save) — use full average
    return avg;
  }

  // Probability of hitting on d20 (1 always misses, 20 always hits)
  const minToHit = targetAC - hitBonus;
  const hitRange = Math.max(0, Math.min(19, 21 - minToHit)); // faces 2..20 that hit
  const pHit = hitRange / 20;

  // Crit adds one extra die roll per die (average extra = count * (sides+1)/2)
  const pCrit = 1 / 20;
  const critExtra = damage.count * (damage.sides + 1) / 2;

  return pHit * avg + pCrit * critExtra;
}
// ---- Universal actions (PHB Ch.9) ---------------------------

/**
 * Build an unarmed strike Action for any creature.
 * PHB p.195: deals 1 + STR modifier bludgeoning damage. Creature is proficient.
 * Minimum 1 damage regardless of STR penalty.
 */
export function unarmedStrikeAction(creature: Combatant): Action {
  const strMod = abilityMod(creature.str);
  const prof   = profBonusByCR(creature.cr);
  const dmg    = Math.max(1, 1 + strMod);
  return {
    name: 'Unarmed Strike',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: null,
    hitBonus: strMod + prof,   // proficient
    // 1+STR mod flat (no die) — modelled as count:0, bonus:dmg
    damage: { count: 0, sides: 0, bonus: dmg, average: dmg },
    damageType: 'bludgeoning',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    costType: 'action',
    legendaryCost: 0,
    description: `Unarmed Strike: +${strMod + prof} to hit, ${dmg} bludgeoning`,
  };
}

/**
 * Build an improvised melee attack (PHB p.147).
 * Not proficient (no proficiency bonus). STR mod to hit and damage.
 * Minimum 1 damage.
 */
export function improvisedMeleeAction(creature: Combatant): Action {
  const strMod = abilityMod(creature.str);
  const dmg    = Math.max(1, strMod);
  return {
    name: 'Improvised Attack',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: { normal: 20, long: 60 },   // can be thrown
    hitBonus: strMod,                   // no proficiency
    damage: { count: 1, sides: 4, bonus: 0, average: 2 },   // 1d4 PHB p.147
    damageType: 'bludgeoning',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    costType: 'action',
    legendaryCost: 0,
    description: `Improvised Attack (no proficiency): +${strMod} to hit, 1d4`,
  };
}

// Needed by unarmedStrikeAction — import Action type

// ---- Concentration (PHB p.203) ------------------------------

/**
 * Start concentrating on a spell. Drops any existing concentration silently
 * (the AI should not cast two concentration spells — caller is responsible).
 */
export function startConcentration(caster: Combatant, spellName: string): void {
  caster.concentration = { active: true, spellName, dcIfHit: 10 };
}

/**
 * Break concentration on a combatant (spell ends, no save).
 */
export function breakConcentration(caster: Combatant): void {
  caster.concentration = null;
}

/**
 * Roll a concentration save after taking damage.
 * DC = max(10, floor(damageTaken / 2)). PHB p.203.
 * Returns true if concentration is maintained.
 * Automatically breaks concentration on failure.
 */
export function rollConcentrationSave(caster: Combatant, damageTaken: number): boolean {
  if (!caster.concentration?.active) return true; // not concentrating
  const dc = Math.max(10, Math.floor(damageTaken / 2));
  const conMod = abilityMod(caster.con);
  // War Caster / Resilient feats not modelled at level 1
  const roll = rollDie(20);
  const total = roll + conMod;
  if (total < dc) {
    breakConcentration(caster);
    return false;
  }
  return true;
}

// ---- Death saving throws (PHB p.197) — PCs only -------------

/**
 * Roll a death saving throw for an unconscious PC.
 * nat 20 = regain 1 HP; nat 1 = 2 failures; 3 successes = stable; 3 failures = dead.
 * Returns the updated status: 'stable' | 'dead' | 'ongoing'.
 */
export function rollDeathSave(pc: Combatant): 'stable' | 'dead' | 'ongoing' {
  if (!pc.deathSaves) return 'ongoing'; // monsters don't make death saves
  if (!pc.isUnconscious || pc.isDead) return 'ongoing';

  const roll = rollDie(20);

  // Nat 20: regain 1 HP, stand up
  if (roll === 20) {
    pc.currentHP = 1;
    pc.isUnconscious = false;
    pc.conditions.delete('unconscious');
    pc.conditions.delete('incapacitated');
    pc.deathSaves = { successes: 0, failures: 0 };
    return 'stable';
  }

  // Nat 1: two failures
  if (roll === 1) {
    pc.deathSaves.failures = Math.min(3, pc.deathSaves.failures + 2);
  } else if (roll >= 10) {
    pc.deathSaves.successes = Math.min(3, pc.deathSaves.successes + 1);
  } else {
    pc.deathSaves.failures = Math.min(3, pc.deathSaves.failures + 1);
  }

  if (pc.deathSaves.failures >= 3) {
    pc.isDead = true;
    return 'dead';
  }
  if (pc.deathSaves.successes >= 3) {
    // Stable: still unconscious, but no longer dying
    pc.deathSaves = { successes: 0, failures: 0 };
    return 'stable';
  }

  return 'ongoing';
}

// ---- Temporary HP -------------------------------------------

/**
 * Grant temporary HP. Temp HP don't stack — take the higher value (PHB p.198).
 */
export function grantTempHP(target: Combatant, amount: number): void {
  target.tempHP = Math.max(target.tempHP, amount);
}

/**
 * Apply damage accounting for temp HP first (PHB p.198).
 * If damageType is provided and the target has resistance to it, damage is halved
 * before temp HP absorption (PHB p.197 — resistance applied before any other reduction).
 * Overrides the base applyDamage for combatants with tempHP.
 */
export function applyDamageWithTempHP(
  target: Combatant,
  amount: number,
  damageType?: DamageType | null,
): number {
  // PHB p.197: resistance halves damage (rounded down) before temp HP absorption.
  // Warding Bond (PHB p.287) grants resistance to ALL damage types.
  // Blade Ward (PHB p.218) grants resistance to bludgeoning/piercing/slashing.
  // All three are folded into a single boolean so resistance never stacks
  // (PHB p.197: two sources of the same resistance = half, not quarter).
  let effective = amount;
  const hasResistance =
    target.wardingBond !== null ||
    (damageType != null && (target.resistances?.includes(damageType) ?? false)) ||
    (target._bladeWardActive === true &&
      damageType != null &&
      BLADE_WARD_PHYSICAL_TYPES.includes(damageType));
  if (hasResistance) {
    effective = Math.floor(amount / 2);
  }

  let remaining = effective;
  if (target.tempHP > 0) {
    const absorbed = Math.min(target.tempHP, remaining);
    target.tempHP -= absorbed;
    remaining -= absorbed;
  }
  if (remaining <= 0) return effective; // all absorbed by temp HP
  return applyDamage(target, remaining) + (effective - remaining);
}

// ---- Resistance helpers ------------------------------------

/** Grant a damage-type resistance to a combatant (idempotent — no duplicates). */
export function addResistance(c: Combatant, type: DamageType): void {
  if (!c.resistances.includes(type)) c.resistances.push(type);
}

/** Remove a damage-type resistance from a combatant (no-op if not present). */
export function removeResistance(c: Combatant, type: DamageType): void {
  c.resistances = c.resistances.filter(r => r !== type);
}

// ---- Bardic Inspiration helpers ----------------------------

/**
 * Parse a die string like 'd6' → 6, 'd8' → 8.
 * Returns 6 as fallback for unrecognised formats.
 */
export function parseDieSides(die: string): number {
  const m = die.match(/d(\d+)/i);
  return m ? parseInt(m[1], 10) : 6;
}

/**
 * Consume a held Bardic Inspiration die and return the bonus rolled.
 * Returns 0 if the combatant has no die set.
 * Clears bardicInspirationDie after use (one-time per grant, PHB p.54).
 */
export function consumeBardicInspiration(c: Combatant): number {
  if (!c.bardicInspirationDie) return 0;
  const roll = rollDie(c.bardicInspirationDie);
  c.bardicInspirationDie = null;
  return roll;
}

// ---- Sneak Attack (PHB p.96) --------------------------------

/**
 * Check if a Rogue can apply Sneak Attack on this attack.
 * Requirements (SAC v2.7):
 * - Weapon must be finesse or ranged
 * - Must have advantage on the attack OR an ally within 5ft of target
 * - Must not have disadvantage
 * - Only once per turn
 */
export function canSneakAttack(
  rogue: Combatant,
  action: Action,
  hasAdvantage: boolean,
  hasDisadvantage: boolean,
  allyAdjacentToTarget: boolean
): boolean {
  if (rogue.usedSneakAttackThisTurn) return false;

  // Must be finesse or ranged (we check by action type and name heuristic)
  const isFinesseOrRanged =
    action.attackType === 'ranged' ||
    action.name.toLowerCase().includes('sneak') ||
    // Finesse weapons by name (the parser doesn't tag finesse, use known list)
    ['rapier','shortsword','dagger','hand crossbow','shortbow','longbow',
     'whip','scimitar'].some(w => action.name.toLowerCase().includes(w));

  if (!isFinesseOrRanged) return false;
  if (hasDisadvantage && !hasAdvantage) return false; // disadvantage blocks SA even with ally
  if (hasAdvantage) return true;
  if (allyAdjacentToTarget) return true;
  return false;
}

/**
 * Sneak Attack damage dice by Rogue level.
 * Level 1 = 1d6. Levels 2–20 add 1d6 every odd level.
 */
export function sneakAttackDice(rogueLevel: number): DiceExpression {
  const diceCount = Math.ceil(rogueLevel / 2);
  return {
    count: diceCount,
    sides: 6,
    bonus: 0,
    average: Math.floor(diceCount * 7 / 2),
  };
}

// ---- Pack Tactics (MM) --------------------------------------

/**
 * Check if a creature with Pack Tactics has advantage on this attack.
 * Condition: at least one non-incapacitated ally is adjacent to the target.
 */
export function hasPackTacticsAdvantage(
  attacker: Combatant,
  target: Combatant,
  battlefield: { combatants: Map<string, Combatant> }
): boolean {
  if (!attacker.traits.includes('Pack Tactics')) return false;

  for (const [id, c] of battlefield.combatants) {
    if (id === attacker.id) continue;
    if (c.faction !== attacker.faction) continue;
    if (c.isDead || c.isUnconscious || c.conditions.has('incapacitated')) continue;
    const dist = Math.max(
      Math.abs(c.pos.x - target.pos.x),
      Math.abs(c.pos.y - target.pos.y),
      Math.abs(c.pos.z - target.pos.z)
    );
    if (dist <= 1) return true; // ally adjacent to target
  }
  return false;
}

// Import needed for new functions

// ---- Rest recovery (PHB Ch.8) ------------------------------

import { PlayerResources } from '../types/core';

/**
 * Apply a short rest to a combatant's resources.
 * Recovers: Warlock pact slots, Fighter Second Wind.
 * NOTE: Hit dice spending is handled separately via spendHitDiceOnRest(),
 * because the number of dice to spend is an AI/caller decision.
 */
export function shortRest(c: Combatant): void {
  const r = c.resources;
  if (!r) return;
  if (r.pactSlots)  r.pactSlots.remaining  = r.pactSlots.max;
  if (r.secondWind) r.secondWind.remaining = r.secondWind.max;
  // Arcane Recovery: can be used once per day during a short rest
  // (wizard player decision — mark available, actual use is separate)
}

/**
 * Spend hit dice during a short rest to recover HP.
 * Keeps spending until currentHP >= targetFraction * maxHP or no dice remain.
 * Returns the number of hit dice spent.
 * PHB p.186: roll hit die + CON modifier per die, recover that many HP (min 0).
 */
export function spendHitDiceOnRest(c: Combatant, targetFraction = 0.75): number {
  const r = c.resources;
  if (!r?.hitDice) return 0;
  if (c.isDead || c.isUnconscious) return 0;

  const hd = r.hitDice;
  const conMod = abilityMod(c.con);
  let spent = 0;

  while (hd.remaining > 0 && c.currentHP < c.maxHP * targetFraction) {
    const roll = rollDie(hd.dieSides);
    const recovered = Math.max(0, roll + conMod);
    c.currentHP = Math.min(c.maxHP, c.currentHP + recovered);
    hd.remaining--;
    spent++;
  }

  return spent;
}

/**
 * Apply a long rest to a combatant's resources.
 * Recovers: all spell slots, rage, bardic inspiration, second wind, lay on hands,
 * hit dice (up to half max, round up — PHB p.186).
 * Also restores HP to max and clears conditions/effects.
 */
export function longRest(c: Combatant): void {
  c.currentHP    = c.maxHP;
  c.tempHP       = 0;
  c.conditions   = new Set();
  c.concentration = null;
  c.activeEffects = [];      // all spell effects end on a long rest
  c.deathSaves   = c.isPlayer ? { successes: 0, failures: 0 } : null;

  const r = c.resources;
  if (!r) return;

  if (r.spellSlots) {
    for (const slot of Object.values(r.spellSlots)) {
      slot.remaining = slot.max;
    }
  }
  if (r.pactSlots)         r.pactSlots.remaining         = r.pactSlots.max;
  if (r.rage)              { r.rage.remaining = r.rage.max; r.rage.active = false; r.rage.roundsRemaining = 0; }
  if (r.secondWind)        r.secondWind.remaining        = r.secondWind.max;
  if (r.bardicInspiration) r.bardicInspiration.remaining = r.bardicInspiration.max;
  if (r.layOnHands)        r.layOnHands.remaining        = r.layOnHands.pool;
  if (r.arcaneRecovery)    r.arcaneRecovery.usesRemaining = 1;
  // Hit dice: recover up to half max (round up). PHB p.186.
  if (r.hitDice) {
    const toRecover = Math.ceil(r.hitDice.max / 2);
    r.hitDice.remaining = Math.min(r.hitDice.max, r.hitDice.remaining + toRecover);
  }
}

// ---- Ammo tracking (4.11) ----------------------------------

/**
 * Spend one unit of ammo for a ranged weapon.
 * Returns false if out of ammo (caller should fall back to melee).
 */
export function spendAmmo(c: Combatant, weaponName: string): boolean {
  const r = c.resources;
  if (!r?.ammo) return true;  // no ammo tracking = unlimited (DM assumption)
  const key = weaponName.toLowerCase();
  const pool = r.ammo[key];
  if (!pool || pool.remaining <= 0) return false;
  pool.remaining--;
  return true;
}

/**
 * Check if a combatant has ammo remaining for a weapon.
 */
export function hasAmmo(c: Combatant, weaponName: string): boolean {
  const r = c.resources;
  if (!r?.ammo) return true;
  const pool = r.ammo[weaponName.toLowerCase()];
  return !pool || pool.remaining > 0;
}

// ---- Size helpers (PHB p.6 / p.195) -------------------------

const SIZE_RANK: Record<CreatureSize, number> = {
  Tiny: 0, Small: 1, Medium: 2, Large: 3, Huge: 4, Gargantuan: 5,
};

/**
 * Returns the numeric rank of a creature size (Tiny=0 … Gargantuan=5).
 * Undefined defaults to 2 (Medium) — safe for all legacy fixtures.
 */
export function sizeRank(size?: CreatureSize): number {
  return size !== undefined ? SIZE_RANK[size] : 2; // default Medium
}

/**
 * PHB p.195: A creature can only grapple or shove a target that is
 * no more than one size larger than itself.
 * Returns true if the attacker is allowed to attempt the action.
 */
export function canGrappleOrShoveTarget(attacker: Combatant, target: Combatant): boolean {
  return sizeRank(attacker.size) + 1 >= sizeRank(target.size);
}

// ---- Grapple / Shove (PHB p.195) ---------------------------

/**
 * Roll a grapple contest: attacker STR(Athletics) vs defender STR(Athletics) or DEX(Acrobatics).
 * Returns true if attacker wins (target becomes Grappled).
 * Note: grapple is an ability check, not an attack roll — Reckless Attack advantage does NOT apply.
 */
export function rollGrappleContest(attacker: Combatant, defender: Combatant): boolean {
  const prof = profBonusByCR(attacker.cr);
  const attackerRoll = rollDie(20) + abilityMod(attacker.str) + prof; // Athletics proficiency
  // Defender chooses best of STR(Athletics) or DEX(Acrobatics) — AI uses whichever is higher
  const defStr = rollDie(20) + abilityMod(defender.str);
  const defDex = rollDie(20) + abilityMod(defender.dex);
  const defenderRoll = Math.max(defStr, defDex);
  return attackerRoll > defenderRoll; // tie goes to defender
}

/**
 * Roll a shove contest (same as grapple).
 * Returns true if attacker wins.
 * On success: caller chooses to knock Prone OR push 5ft.
 */
export function rollShoveContest(attacker: Combatant, defender: Combatant): boolean {
  return rollGrappleContest(attacker, defender); // identical mechanic
}

/**
 * Evaluate whether grappling the target is worth the action cost.
 * Returns true if the AI should grapple instead of attack.
 * (Used by smart AI only — attackNearest/Weakest always attacks.)
 */
export function shouldGrapple(
  attacker: Combatant,
  target: Combatant,
  alliesAdjacentToTarget: number
): boolean {
  if (attacker.aiProfile !== 'smart') return false;
  // PHB p.195: can't grapple a target more than 1 size larger
  if (!canGrappleOrShoveTarget(attacker, target)) return false;
  // Only worth it if attacker has high STR and target is mobile/spellcaster
  const strMod = abilityMod(attacker.str);
  if (strMod < 2) return false; // low STR = low chance of success
  // Grapple if: target has fly speed (grounding them) or is a high-speed threat
  if (target.flySpeed !== null) return true;
  if (target.speed > 35 && !target.conditions.has('grappled')) return true;
  return false;
}

// ---- Combat capability checks --------------------------------

/**
 * Returns true if a combatant has any means to deal damage this turn.
 * Covers: regular attack/save actions, improvised unarmed (always available
 * unless isDefender or cannotAttack), and improvised weapons (hasHands).
 */
export function canDealDamage(c: Combatant): boolean {
  if (c.isDead || c.isUnconscious) return false;
  if (c.cannotAttack) return false;
  if (c.isDefender) return false;
  // Any action with an attack roll or save DC → can deal damage
  if (c.actions.some(a => a.attackType !== null || a.saveDC !== null)) return true;
  // Fallback: improvised unarmed is always available to non-defender creatures
  return true;
}

/**
 * Returns true if ALL living members of a faction cannot deal damage.
 * Used for auto-defeat: if a team has no way to attack, they lose.
 */
export function teamHasNoAttackCapability(
  faction: string,
  combatants: Map<string, Combatant>
): boolean {
  const living = [...combatants.values()].filter(
    c => c.faction === faction && !c.isDead && !c.isUnconscious
  );
  if (living.length === 0) return true;
  return living.every(c => !canDealDamage(c));
}

/**
 * Build an improvised unarmed strike Action for any creature.
 * PHB p.195: unarmed strikes deal 1 + STR modifier bludgeoning damage.
 * This is the universal fallback — all non-defender, non-cannotAttack creatures.
 */
export function makeImprovisedUnarmed(c: Combatant): Action {
  const strMod = abilityMod(c.str);
  const prof = proficiencyBonus(c.cr);
  return {
    name: 'Unarmed Strike',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: null,
    hitBonus: strMod + prof,
    damage: { count: 0, sides: 0, bonus: 1 + strMod, average: 1 + strMod },
    damageType: 'bludgeoning',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    costType: 'action',
    legendaryCost: 0,
    description: `Unarmed strike (1 + STR mod = ${1 + strMod})`,
  };
}

/**
 * Build an improvised weapon Action for creatures with hands or tentacles.
 * PHB p.148: improvised weapons deal 1d4 damage. No proficiency bonus to hit.
 */
export function makeImprovisedWeapon(c: Combatant): Action {
  const strMod = abilityMod(c.str);
  return {
    name: 'Improvised Weapon',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: null,
    hitBonus: strMod,             // no proficiency (PHB p.148)
    damage: { count: 1, sides: 4, bonus: strMod, average: 2.5 + strMod },
    damageType: 'bludgeoning',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    costType: 'action',
    legendaryCost: 0,
    description: `Improvised weapon (1d4 + STR mod, no prof)`,
  };
}

/**
 * Returns proficiency bonus for a given CR (or PC level).
 * PHB p.15 table.
 */
export function proficiencyBonus(cr: number | null): number {
  if (cr === null) return 2; // default for PCs at low level
  if (cr <= 4)  return 2;
  if (cr <= 8)  return 3;
  if (cr <= 12) return 4;
  if (cr <= 16) return 5;
  return 6;
}
