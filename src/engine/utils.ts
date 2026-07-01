// ============================================================
// Engine Utilities
// Core combat math: rolling, damage, conditions, initiative, budget
// ============================================================

import { Combatant, Action, DiceExpression, Condition, ActionBudget, Battlefield, CreatureSize, DamageType } from '../types/core';
import { querySelf, queryVulnerability } from './adv_system';
import { getActiveBlessDie, getActiveBaneDie, getActiveEnlargeReduce, hasAbilityDisadvantage } from './spell_effects';
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
// TG-008: Reaction spell cleanups
import { cleanup as cleanupAbsorbElements } from '../spells/absorb_elements';

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
 *
 * ── Session 45 Task #29-follow-up: critRange parameter ──
 * PHB default: crit on a natural 20. Some features expand this:
 *   - Fighter Champion "Improved Critical" (PHB p.72) → crit on 19-20
 *   - Fighter Champion "Superior Critical" (PHB p.72) → crit on 18-20
 * The caller passes the LOWEST natural roll that still crits (default 20).
 * Spell attacks don't benefit from these features (Improved Critical
 * specifies "weapon attacks"), so spell attack callers should leave
 * critRange at its default (20).
 */
export function rollAttack(
  hitBonus: number,
  hasAdvantage: boolean,
  hasDisadvantage: boolean,
  critRange: number = 20,
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
    isCrit: roll >= critRange,
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

// ---- Cantrip damage scaling (PHB p.201) ----------------------

/**
 * PHB p.201: Cantrip damage increases at character levels 5, 11, and 17.
 * For monsters, `casterLevel` from the Combatant maps to the same tier
 * breakpoints (parsed from "Nth-level spellcaster" header in the stat block).
 *
 * Returns 0 (base), 1 (+1 die), 2 (+2 dice), or 3 (+3 dice).
 *
 * RFC-UPCASTING Phase 6 (Session 72)
 */
export function cantripTier(caster: Combatant): number {
  const effectiveLevel =
    caster.casterLevel ??
    caster.level ??
    1;

  if (effectiveLevel >= 17) return 3;
  if (effectiveLevel >= 11) return 2;
  if (effectiveLevel >= 5)  return 1;
  return 0;
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

  // ── Session 48 Task #29-follow-up-4b: Diamond Soul (Open Hand Monk 13) ──
  // PHB p.79: "the purity of your ki suffuses your entire being, granting
  // you proficiency in all saving throws."
  // When the combatant has Diamond Soul, treat ALL saves as proficient.
  // Use combatantProfBonus() for the correct proficiency (level-based for
  // PCs, CR-based for monsters) — profBonusByCR returns 2 for all PCs
  // (cr=null) which is wrong for level 5+ monks.
  const diamondSoulActive = combatant.classFeatures?.includes('Diamond Soul') === true;
  const effectiveProficient = isProficient || diamondSoulActive;
  const prof = effectiveProficient ? combatantProfBonus(combatant) : 0;

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
  // Bestow Curse — opt.2 (PHB p.214): disadvantage on ability checks and
  // saving throws made with one chosen ability score. Flat unconditional
  // disadvantage — modeled via the ability_disadvantage ActiveEffect
  // (queried by hasAbilityDisadvantage).
  const abilityDisadvantage = hasAbilityDisadvantage(combatant, ability);

  // ── Session 52 Creature Megabatch Batch 4a: Magic Resistance ──
  // MM p.11 / various: "The [creature] has advantage on saving throws against
  // spells and other magical effects." v1 simplification: the engine does not
  // tag saves by source (spell vs non-spell), so we grant advantage on ALL
  // saves for creatures with the 'Magic Resistance' trait. This is slightly
  // more generous than canon (a non-magical poison save would canonically
  // NOT get advantage) but covers the common case (most monster saves in
  // combat ARE vs spells/magical effects). Documented in the migration plan.
  const magicResistanceAdvantage = combatant.traits.includes('Magic Resistance');

  const hasAdvantage   = selfSave.advantage   || allSave.advantage   || rageStrAdvantage    || enlargeStrAdvantage || magicResistanceAdvantage;
  const hasDisadvantage = combatant.conditions.has('poisoned') // PHB Appendix A: poisoned → disadv on saves
    || selfSave.disadvantage || allSave.disadvantage
    || enlargeStrDisadvantage || abilityDisadvantage
    || combatant.exhaustionLevel >= 3;  // Exhaustion level 3: disadvantage on saving throws (PHB p.291)

  let roll: number;
  if (hasAdvantage && !hasDisadvantage) roll = rollWithAdvantage();
  else if (hasDisadvantage && !hasAdvantage) roll = rollWithDisadvantage();
  else roll = rollDie(20);

  // Bardic Inspiration die — consumed on save rolls too (PHB p.54)
  const biBonus = consumeBardicInspiration(combatant);

  // Bless die — +1d4 to saving throws when blessed (PHB p.219)
  const blessSides = getActiveBlessDie(combatant);
  const blessBonus = blessSides > 0 ? rollDie(blessSides) : 0;

  // Bane die — -1d4 to saving throws when baned (PHB p.219) — Session 27 Batch 3
  const baneSides = getActiveBaneDie(combatant);
  const banePenalty = baneSides > 0 ? rollDie(baneSides) : 0;

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

  const total = roll + mod + prof + biBonus + blessBonus - banePenalty + wbBonus - mindSliverPenalty + resistanceBonus;
  // ── Session 52 Creature Megabatch Batch 2: monster save proficiencies ──
  // 5etools `save` field lists the FULL save bonus (ability mod + proficiency
  // already folded in, e.g. Adult Red Dragon CON save "+13"). When present
  // for this ability, use that bonus INSTEAD of the derived (mod + prof) —
  // otherwise we'd double-count proficiency. The listed bonus already
  // accounts for the creature's actual CR-based proficiency, so it's more
  // accurate than the derived value for creatures with non-standard prof.
  // (e.g. a CR 17 dragon's CON prof is +7, but its listed +13 = CON +6 mod
  //  + +7 prof — matches. For creatures whose listed bonus differs from the
  //  derived one, trust the stat block.)
  const listedSaveBonus = combatant.saveProficiencies?.[ability];
  const effectiveTotal = listedSaveBonus !== undefined
    ? roll + listedSaveBonus + biBonus + blessBonus - banePenalty + wbBonus - mindSliverPenalty + resistanceBonus
    : total;

  // ── Session 52 Creature Megabatch Batch 3b: Legendary Resistance ──
  // MM p.11: "If the [creature] fails a saving throw, it can choose to
  // succeed instead." Used only by legendary creatures (28 in MM). v1
  // simplification: the creature ALWAYS spends a use on a failed save
  // (no AI judgment of save-significance). Remaining uses reset only on a
  // long rest (per-combat for monsters in v1).
  const failed = effectiveTotal < dc;
  if (failed && combatant.legendaryResistance && combatant.legendaryResistance.remaining > 0) {
    combatant.legendaryResistance.remaining -= 1;
    return { roll, total: dc, success: true };  // forced success — total set to dc exactly
  }

  return { roll, total: effectiveTotal, success: effectiveTotal >= dc };
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

  // Bestow Curse — opt.2 (PHB p.214): disadvantage on ability checks and
  // saving throws made with one chosen ability score. Flat unconditional
  // disadvantage — modeled via the ability_disadvantage ActiveEffect
  // (queried by hasAbilityDisadvantage). Mirror rollSave's integration.
  const abilityDisadvCheck = hasAbilityDisadvantage(combatant, ability);

  const hasAdvantage    = friendsAdv || selfCheck.advantage   || allCheck.advantage   || rageStrAdvantage || enlargeStrAdvantage || enhanceAbilityAdv;
  const hasDisadvantage = poisonedDisadv || selfCheck.disadvantage || allCheck.disadvantage || enlargeStrDisadvantage || abilityDisadvCheck
    || combatant.exhaustionLevel >= 1;  // Exhaustion level 1: disadvantage on ability checks (PHB p.291)

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
      addCondition(target, 'unconscious');
      addCondition(target, 'incapacitated');
    } else {
      target.isDead = true;
      target.isUnconscious = true;
      addCondition(target, 'unconscious');
      addCondition(target, 'incapacitated');
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
  const cap = effectiveMaxHP(target);
  target.currentHP = Math.min(cap, target.currentHP + amount);

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

/** Returns the effective max HP considering exhaustion level 4 (PHB p.291). */
export function effectiveMaxHP(c: Combatant): number {
  if (c.exhaustionLevel >= 4) return Math.floor(c.maxHP / 2);
  return c.maxHP;
}

// ---- Conditions ---------------------------------------------

export function addCondition(target: Combatant, condition: Condition): void {
  // ── Session 52 Creature Megabatch Batch 1: condition immunity ──
  // 5etools `conditionImmune` field → Combatant.conditionImmunities (parsed
  // by fivetools.ts:parseConditionImmune). PHB p.197: condition immunity =
  // the condition is never applied. Names are lowercased on both sides so
  // the lookup is case-insensitive. Mirrors the Nature's Ward 'poisoned'
  // immunity pattern above (just generalized to any condition name).
  if (target.conditionImmunities && target.conditionImmunities.includes(condition.toLowerCase())) {
    return; // immune — condition not applied
  }
  // ── Session 47 Task #29-follow-up-3: Nature's Ward (Land Druid 10) ──
  // PHB p.68: "Starting at 10th level, you can't be charmed or frightened by
  // fey or elementals. You are also immune to poison and disease."
  //
  // v1 wiring: blanket immunity to the 'poisoned' condition. The fey/elemental
  // charm/frighten immunity requires source-creature-type tracking (not
  // available in addCondition's signature) — documented as a v1 simplification.
  // Disease immunity is a no-op (diseases are not tracked in v1 — see Lesser
  // Restoration v1 simplification).
  if (condition === 'poisoned' && target.classFeatures?.includes("Nature's Ward")) {
    return; // immune — do not apply the condition
  }
  target.conditions.add(condition);
  // ── RFC-COMBINING-EFFECTS Phase 4: source-tracked condition map ──
  // addCondition is called from non-spell sources (monster traits, class
  // features, combat mechanics like waking up, etc.). These conditions
  // must survive the pipeline's _rederiveConditions() rebuild.
  if (!target._conditionSources) target._conditionSources = new Map();
  let sources = target._conditionSources.get(condition);
  if (!sources) { sources = new Set(); target._conditionSources.set(condition, sources); }
  sources.add('non-spell');
  // Cascade: paralyzed/stunned/petrified → incapacitated
  if (condition === 'paralyzed' || condition === 'stunned' || condition === 'petrified') {
    target.conditions.add('incapacitated');
    let incSources = target._conditionSources.get('incapacitated');
    if (!incSources) { incSources = new Set(); target._conditionSources.set('incapacitated', incSources); }
    incSources.add('non-spell');
  }
  // Auto-break concentration on incapacitated (PHB p.203: "You lose concentration
  // on a spell if you are incapacitated"). We null the concentration object
  // directly. Callers that need to also call removeEffectsFromCaster should
  // check concentration BEFORE calling addCondition('incapacitated'), or check
  // for the _concentrationAutoBroken flag after calling addCondition.
  if (condition === 'incapacitated' && target.concentration?.active) {
    const spellName = target.concentration.spellName;
    target.concentration = null;
    // Set a flag so the combat system can detect that concentration was
    // auto-broken by incapacitation and call removeEffectsFromCaster.
    // This is necessary because removeEffectsFromCaster needs the Battlefield
    // which addCondition doesn't have access to.
    (target as Record<string, unknown>)._concentrationAutoBroken = spellName ?? true;
  }
}

export function removeCondition(target: Combatant, condition: Condition): void {
  target.conditions.delete(condition);
  // ── RFC-COMBINING-EFFECTS Phase 4: source-tracked condition map ──
  // Remove the 'non-spell' source entry. If other sources (spell effects)
  // still impose this condition, they remain in _conditionSources and will
  // be re-derived by the pipeline. This handles the case where a combat
  // mechanic removes a condition (e.g. standing up removes 'prone') but
  // a spell might also independently impose it.
  const sources = target._conditionSources?.get(condition);
  if (sources) {
    sources.delete('non-spell');
    // Do NOT delete the entry even if empty — tombstone for _rederiveConditions
  }
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
  // TG-008: Absorb Elements resistance expires at start of caster's next
  // turn (XGE p.150: "you have resistance to that damage type until the
  // start of your next turn"). The melee rider is NOT cleared here — it
  // persists until consumed by the next melee hit (PHB: "the first time
  // you hit with a melee attack on your next turn").
  cleanupAbsorbElements(c);

  // ── Session 39: Lance of Lethargy Eldritch Invocation (XGE p.157) ──
  // Speed reduction expires at start of each combatant's turn (v1
  // simplification — canon: "beginning of your next turn" = caster's
  // next turn). Inlined here (not in _invocations.ts) to avoid a
  // circular dependency (utils.ts ↔ _invocations.ts). Mirrors Ray of
  // Frost's cleanup pattern exactly.
  if (c._hasLanceOfLethargy) {
    if (c._lanceOfLethargyOriginalSpeed !== undefined) {
      c.speed = c._lanceOfLethargyOriginalSpeed;
      delete c._lanceOfLethargyOriginalSpeed;
    }
    delete c._hasLanceOfLethargy;
  }

  const speed = effectiveSpeed(c);
  c.budget = {
    movementFt: speed,
    actionUsed: false,
    bonusActionUsed: false,
    reactionUsed: false,        // reaction resets at START of own turn (PHB p.190)
    freeObjectUsed: false,
  };
  // Session 53 Batch 4g: capture turn-start position for Charge/Pounce
  // movement-tracking. Compares _turnStartPos → current pos vs target pos
  // to determine if the creature "moved ≥N ft straight toward the target".
  c._turnStartPos = { ...c.pos };
  // Legendary action pool resets at start of own turn (MM p.11)
  c.legendaryActionPool = c.legendaryActionPoolMax;

  // ── Session 52 Creature Megabatch Batch 3a: Recharge ──
  // MM p.8 / MM p.11: at the start of each of its turns, a creature rolls 1d6
  // for each Recharge action; if the roll meets the threshold (min), the
  // action recharges (becomes available again this turn). rollRecharge()
  // mutates each Action.recharge.recharged in place.
  rollRecharge(c);

  // ── Session 52 Creature Megabatch Batch 4b: Regeneration ──
  // MM p.11: "The [creature] regains N hit points at the start of its turn if
  // it has at least 1 hit point." If suppressedNextTurn is true (creature took
  // a stop-clause damage type last turn), skip regen this turn and clear the
  // flag. Heal min(amount, maxHP - currentHP) — no overheal.
  // Session 52 Batch 4e: Swarm trait (cannotRegainHP) blocks ALL healing.
  if (c.regeneration && !c.cannotRegainHP && c.currentHP > 0 && c.currentHP < c.maxHP) {
    if (!c.regeneration.suppressedNextTurn) {
      const heal = Math.min(c.regeneration.amount, c.maxHP - c.currentHP);
      c.currentHP += heal;
    } else {
      // Suppressed this turn; clear the flag so regen resumes next turn
      // (unless re-suppressed by another stop-type hit).
      c.regeneration.suppressedNextTurn = false;
    }
  } else if (c.regeneration && c.regeneration.suppressedNextTurn) {
    // Creature is at full HP or dead, but still clear the suppression flag
    // so it doesn't linger indefinitely.
    c.regeneration.suppressedNextTurn = false;
  }
}

/**
 * Session 52 Creature Megabatch Batch 3a: roll 1d6 per Recharge action at the
 * start of the creature's turn. Actions whose roll meets the threshold (min)
 * become available (`recharged = true`). Actions below the threshold stay
 * unavailable until next turn. Actions without a `recharge` field are skipped.
 *
 * Mutates `c.actions` in place. Called by resetBudget() so it fires at the
 * start of every one of this creature's turns (resetBudget is invoked from
 * combat.ts at the start-of-turn hook).
 */
export function rollRecharge(c: Combatant): void {
  for (const a of c.actions) {
    if (!a.recharge) continue;
    const d6 = rollDie(6);   // 1d6
    a.recharge.recharged = d6 >= a.recharge.min;
  }
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
  // Exhaustion level 5 (PHB p.291): speed reduced to 0
  if (c.exhaustionLevel >= 5) return 0;
  let speed = c.speed;
  // Exhaustion level 2 (PHB p.291): speed halved
  if (c.exhaustionLevel >= 2) speed = Math.floor(speed / 2);
  return speed;
}

// ---- Elemental Affinity (Draconic Sorcerer 6) ----------------

/**
 * Returns the CHA modifier bonus for Elemental Affinity (Draconic Sorcerer 6,
 * PHB p.102): "when you cast a spell that deals damage of the type associated
 * with your draconic ancestry, you can add your Charisma modifier to that
 * damage."
 *
 * Returns 0 if:
 *   - The caster doesn't have the 'Elemental Affinity' classFeature
 *   - The damage type doesn't match the caster's draconicAncestry
 *   - The caster's CHA mod is ≤ 0 (no bonus to add)
 *
 * @param caster      The spellcasting combatant
 * @param damageType  The spell's damage type (e.g. 'fire', 'cold')
 * @returns           CHA modifier (≥ 0) to add to the spell's damage roll
 *
 * Session 47 Task #29-follow-up-2: wired in the generic 'cast' case and
 * Fireball's execute function. Future: wire in all bespoke spell execute
 * functions (Lightning Bolt, Cone of Cold, etc.).
 */
export function elementalAffinityBonus(caster: Combatant, damageType: string | null | undefined): number {
  if (!damageType) return 0;
  if (!caster.classFeatures?.includes('Elemental Affinity')) return 0;
  if (!caster.draconicAncestry) return 0;
  if (caster.draconicAncestry.toLowerCase() !== damageType.toLowerCase()) return 0;
  const chaMod = abilityMod(caster.cha);
  return chaMod > 0 ? chaMod : 0;
}

// ---- Initiative --------------------------------------------

/**
 * Compute the proficiency bonus for a Combatant.
 *
 * For PCs (cr=null with the `level` field set by buildCombatant), uses the
 * character-level table (PHB p.15): level 1-4 → +2, 5-8 → +3, 9-12 → +4,
 * 13-16 → +5, 17-20 → +6.
 *
 * For monsters (cr set) or legacy PCs without the `level` field, falls back
 * to the CR-based `proficiencyBonus(cr)` table.
 *
 * Session 46 Task #29-follow-up-2: needed for Remarkable Athlete (Champion 7)
 * which adds half proficiency (rounded up) to STR/DEX/CON ability checks
 * including initiative.
 */
export function combatantProfBonus(c: Combatant): number {
  // PC: use character level if available (set by buildCombatant)
  if (c.cr === null && c.level !== undefined && c.level > 0) {
    const lvl = c.level;
    if (lvl <= 4) return 2;
    if (lvl <= 8) return 3;
    if (lvl <= 12) return 4;
    if (lvl <= 16) return 5;
    return 6;
  }
  // Monster or legacy: use CR-based table
  return proficiencyBonus(c.cr);
}

/**
 * Roll initiative for all combatants and return an ordered array of IDs.
 * Ties between combatants of different factions: monsters go last (SAC/DM convention).
 * Ties within same faction: random.
 *
 * Session 46 Task #29-follow-up-2: Remarkable Athlete (Champion 7) adds
 * half proficiency bonus (rounded up) to initiative (a DEX ability check
 * that doesn't normally add proficiency). PHB p.72: "you can add half your
 * proficiency bonus (rounded up) to any Strength, Dexterity, or Constitution
 * check you make that doesn't already use your proficiency bonus."
 */
export function rollInitiative(battlefield: Battlefield): string[] {
  const entries: { id: string; init: number; tieBreaker: number }[] = [];

  for (const [id, c] of battlefield.combatants) {
    const dexMod = abilityMod(c.dex);
    // Remarkable Athlete (Champion 7): +ceil(prof/2) to DEX checks w/o prof.
    // Initiative is a DEX check that doesn't use proficiency by default.
    // Inlined hasFeature check to avoid circular dependency with builder.ts.
    let initBonus = dexMod;
    if (c.classFeatures?.includes('Remarkable Athlete')) {
      const prof = combatantProfBonus(c);
      initBonus += Math.ceil(prof / 2);
    }
    // ── Session 60: False Appearance initiative advantage ──
    // 27 creatures with the init-advantage variant: "If the [creature] is
    // motionless at the start of combat, it has advantage on its initiative
    // roll." v1 grants advantage unconditionally (motionless state not tracked).
    const initRoll = c.falseAppearanceInitAdv === true
      ? rollWithAdvantage(20)
      : rollDie(20);
    const roll = initRoll + initBonus;
    // ── Session 92 RFC-LAIRACTIONS Phase 2 [DD-2]: store numeric score ──
    // The round loop in `runCombat` uses `initiativeScore` to find the
    // boundary between creatures with initiative ≥ 20 and those with < 20;
    // lair actions fire AFTER the ≥-20 creatures and BEFORE the <-20 ones.
    // (Previously `rollInitiative` computed scores but discarded them,
    // returning only the ordered ID array — see RFC §2.5.)
    c.initiativeScore = roll;
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
  target: Combatant,
  bf?: Battlefield
): { advantage: boolean; disadvantage: boolean } {
  let advantage = false;
  let disadvantage = false;

  // ── RFC-VISION-AUDIO Phase 3 Q4: detection-map advantage/disadvantage ──
  // When the Battlefield is available, consult the detection map for
  // unseen-attacker and can't-see-target advantage/disadvantage.
  // This replaces the condition-based checks for 'hidden' and 'invisible'
  // with the more accurate detection model (visible / hidden /
  // position-known / unknown).
  if (bf) {
    // Import perception module lazily to avoid circular deps at module level.
    // (perception.ts imports from utils.ts — but only at function call time,
    //  not at module initialization, so this is safe.)
    const { getDetectionState } = require('./perception');

    // Attacker's detection state from target's perspective:
    // If the target can't see the attacker (hidden/position-known/unknown),
    // the attacker is an "unseen attacker" → advantage (PHB p.194).
    const attackerFromTarget = getDetectionState(target, attacker, bf);
    if (attackerFromTarget !== 'visible') {
      // Attacker is not visible to target → advantage (unseen attacker)
      advantage = true;
    }

    // Target's detection state from attacker's perspective:
    // If the attacker can't see the target, attacks have disadvantage.
    const targetFromAttacker = getDetectionState(attacker, target, bf);
    if (targetFromAttacker !== 'visible') {
      // Can't see the target → disadvantage on attacks
      disadvantage = true;
    }
  } else {
    // ── Legacy: condition-based advantage/disadvantage (backward-compat) ──
    // Used when bf is not available (tests, legacy callers).
    // Invisible attacker has advantage on all attacks (PHB Appendix A)
    if (attacker.conditions.has('invisible'))  advantage    = true;
    // Hidden attacker has advantage on attacks (PHB p.194 — unseen attackers)
    if (attacker.conditions.has('hidden'))     advantage    = true;
    // Invisible target → attacker has disadvantage (PHB Appendix A)
    if (target.conditions.has('invisible'))    disadvantage = true;
    // Hidden target → attacker has disadvantage (PHB p.194 — attacking unseen)
    if (target.conditions.has('hidden'))       disadvantage = true;
  }

  // ── Attacker conditions (PHB Appendix A) ──────────────────
  if (attacker.conditions.has('blinded'))    disadvantage = true;
  if (attacker.conditions.has('frightened')) disadvantage = true;
  if (attacker.conditions.has('poisoned'))   disadvantage = true;
  if (attacker.conditions.has('restrained')) disadvantage = true;
  if (attacker.conditions.has('prone'))      disadvantage = true;

  // ── Target conditions (PHB Appendix A) ────────────────────
  if (target.conditions.has('blinded'))      advantage = true;
  if (target.conditions.has('paralyzed'))    advantage = true;
  // Prone: melee attacks have advantage, ranged have disadvantage (PHB Appendix A)
  // We encode both flags; resolveAttack passes attackType to decide which applies.
  // Store separately so caller can apply the right one.
  if (target.conditions.has('restrained'))   advantage = true;
  if (target.conditions.has('stunned'))      advantage = true;
  if (target.conditions.has('unconscious'))  advantage = true;

  // ── Advantage/disadvantage system entries (spells, feats, class features) ──
  // Attacker's own advantage on attack rolls
  const selfAdv = querySelf(attacker, 'attack');
  if (selfAdv.advantage)    advantage    = true;
  if (selfAdv.disadvantage) disadvantage = true;

  // Vulnerabilities stored on the target (Dodge → disadv; Reckless Attack exposed → adv)
  const vulnAdv = queryVulnerability(target, 'attack');
  if (vulnAdv.advantage)    advantage    = true;
  if (vulnAdv.disadvantage) disadvantage = true;

  // ── Session 52 Creature Megabatch Batch 4e: Blood Frenzy ──
  // MM p.11 / various: "The [creature] has advantage on melee attack rolls
  // against any creature that doesn't have all its hit points." 7 MM
  // creatures (sharks, quippers, etc.). The melee-only restriction is
  // enforced downstream in resolveAttackAdvantage (which knows attackType);
  // here we just set advantage — it'll be filtered to melee only.
  if (attacker.traits.includes('Blood Frenzy') && target.currentHP < target.maxHP) {
    advantage = true;
  }

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
  attackType: import('../types/core').AttackType | null,
  bf?: Battlefield
): { advantage: boolean; disadvantage: boolean } {
  const base = attackAdvantageState(attacker, target, bf);
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
  // ── Session 113 — Lair-action bespoke dispatch: concentration suppression ──
  // When `suppressConcentration` is true (set by dispatchBespokeLairSpell
  // for Category B hazard-like / duration-replacement / explicit-exception
  // lair-action spells), startConcentration() becomes a no-op. The lair
  // action's effect is still created (by the spell's execute()), but it's
  // NOT tied to the caster's concentration — the dispatcher post-processes
  // the effect to set sourceIsConcentration = false + sourceTurnExpires.
  // See docs/RFC-LAIR-ACTION-BESPOKE-DISPATCH.md §4.5 for the design.
  if (caster.suppressConcentration) return;
  caster.concentration = { active: true, spellName, dcIfHit: 10 };
}

/**
 * Break concentration on a combatant (spell ends, no save).
 */
export function breakConcentration(caster: Combatant): void {
  caster.concentration = null;
}

/**
 * Voluntarily end concentration (PHB p.203: "You can end concentration at any
 * time"). This sets the concentration flag to null. The CALLER is responsible
 * for calling removeEffectsFromCaster(caster.id, bf) afterwards to clean up
 * any conc-sourced effects (conditions, terrain zones, etc.).
 *
 * Why not call removeEffectsFromCaster here? Because it lives in
 * spell_effects.ts and importing it from utils.ts would create a circular
 * dependency (spell_effects already imports from utils). The separation is
 * intentional: combat.ts orchestrates both this function and the cleanup.
 */
export function voluntaryEndConcentration(caster: Combatant): void {
  if (!caster.concentration?.active) return;
  caster.concentration = null;
}

/**
 * Roll a concentration save after taking damage.
 * DC = max(10, floor(damageTaken / 2)). PHB p.203.
 * Returns true if concentration is maintained.
 * Automatically breaks concentration on failure.
 *
 * Session 41 Task #16: Eldritch Mind (TCE p.71) — advantage on
 * concentration saves. The check is inlined here (rather than importing
 * hasInvocation from _invocations.ts) to avoid a circular dependency
 * (utils.ts ↔ _invocations.ts ↔ combat.ts ↔ utils.ts).
 */
export function rollConcentrationSave(caster: Combatant, damageTaken: number): boolean {
  if (!caster.concentration?.active) return true; // not concentrating
  const dc = Math.max(10, Math.floor(damageTaken / 2));
  const conMod = abilityMod(caster.con);
  // War Caster / Resilient feats not modelled at level 1
  // Eldritch Mind (TCE p.71): advantage on concentration saves. Inlined
  // check to avoid circular dependency on _invocations.ts.
  const hasEldritchMind = caster.eldritchInvocations?.includes('Eldritch Mind') ?? false;
  const roll = hasEldritchMind ? rollWithAdvantage() : rollDie(20);
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
  // Session 52 Batch 4e: Swarm trait — "can't regain hit points or gain
  // temporary hit points". 10 MM swarm creatures. No-op if cannotRegainHP.
  if (target.cannotRegainHP) return;
  target.tempHP = Math.max(target.tempHP, amount);
}

/**
 * Apply damage accounting for temp HP first (PHB p.198).
 * If damageType is provided and the target has immunity to it, damage is
 * reduced to 0 (PHB p.197). If the target has vulnerability to it, damage
 * is DOUBLED. If the target has resistance to it, damage is HALVED (rounded
 * down). Per PHB p.197, the order is: immunity (0) > vulnerability (×2) >
 * resistance (÷2); an immune creature takes 0 regardless of vuln/resist.
 * Overrides the base applyDamage for combatants with tempHP.
 */
export function applyDamageWithTempHP(
  target: Combatant,
  amount: number,
  damageType?: DamageType | null,
): number {
  // PHB p.197: immunity reduces damage to 0. Checked FIRST — before resistance,
  // vulnerability, temp HP, or any other mitigation. An immune creature takes
  // 0 damage regardless of any resistance/vulnerability entries (immunity
  // overrides everything).
  if (damageType != null && (target.immunities?.includes(damageType) ?? false)) {
    return 0;
  }

  let effective = amount;

  // PHB p.197: vulnerability doubles damage. Applied BEFORE resistance
  // (if a creature has BOTH vuln and resist to the same type, vuln applies
  // first then resist halves — net = original). Immunity already short-
  // circuited above. NOTE this uses Combatant.damageVulnerabilities (NOT
  // Combatant.vulnerabilities, which is for d20-roll vulns like Dodge).
  // Added in Session 52 Creature Megabatch Batch 1.
  if (damageType != null && (target.damageVulnerabilities?.includes(damageType) ?? false)) {
    effective = effective * 2;
  }

  // PHB p.197: resistance halves damage (rounded down) before temp HP absorption.
  // Warding Bond (PHB p.287) grants resistance to ALL damage types.
  // Blade Ward (PHB p.218) grants resistance to bludgeoning/piercing/slashing.
  // All three are folded into a single boolean so resistance never stacks
  // (PHB p.197: two sources of the same resistance = half, not quarter).
  const hasResistance =
    target.wardingBond !== null ||
    (damageType != null && (target.resistances?.includes(damageType) ?? false)) ||
    (target._bladeWardActive === true &&
      damageType != null &&
      BLADE_WARD_PHYSICAL_TYPES.includes(damageType));
  if (hasResistance) {
    effective = Math.floor(effective / 2);
  }

  // ── Session 52 Creature Megabatch Batch 4b: Regeneration suppression ──
  // If this damage type is in the creature's regen stopTypes (e.g. acid/fire
  // for trolls, radiant for vampires), set suppressedNextTurn so the start-
  // of-turn regen in resetBudget() skips one turn. Per MM: "this trait
  // doesn't function at the start of the [creature]'s next turn."
  if (damageType != null && target.regeneration && target.regeneration.stopTypes.includes(damageType)) {
    target.regeneration.suppressedNextTurn = true;
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

// ---- Immunity helpers ---------------------------------------

/**
 * Grant a damage-type immunity to a combatant (idempotent — no duplicates).
 * Immunity overrides resistance (PHB p.197): an immune creature takes 0 damage
 * of that type regardless of any resistance/vulnerability entries.
 */
export function addImmunity(c: Combatant, type: DamageType): void {
  if (!c.immunities) c.immunities = [];
  if (!c.immunities.includes(type)) c.immunities.push(type);
}

/** Remove a damage-type immunity from a combatant (no-op if not present). */
export function removeImmunity(c: Combatant, type: DamageType): void {
  if (!c.immunities) return;
  c.immunities = c.immunities.filter(r => r !== type);
}

// ---- Dice string parsing ------------------------------------

/**
 * Roll a dice expression like '1d8' or '2d8' and return the sum.
 * Used by executeMove in combat.ts when the Booming Blade rider detonates,
 * and by any other caller that needs to roll an arbitrary NdM expression.
 *
 * Returns 0 for unparseable inputs (e.g. 'invalid', '').
 *
 * Originally lived in `src/spells/booming_blade.ts` and was imported
 * from there by combat.ts. Moved to utils.ts (TG-013 housekeeping) so
 * the engine doesn't depend on a specific cantrip module for a generic
 * helper. The original location re-exports this function for backwards
 * compatibility.
 */
export function rollDiceString(expr: string): number {
  const m = expr.match(/^(\d+)d(\d+)$/);
  if (!m) return 0;
  const count = parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }
  return total;
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
 * Requirements (PHB p.96, SAC v2.7):
 * - Weapon must be finesse or ranged
 * - Must have advantage on the attack OR an ally within 5ft of target
 * - Must not have disadvantage
 * - Only once per turn
 *
 * PHB p.173: "If circumstances cause a roll to have both advantage and
 * disadvantage, you are considered to have neither of them." When both
 * cancel, you don't have advantage (so the advantage route is unavailable)
 * but you also don't have disadvantage (so the ally-adjacent route IS
 * available per PHB p.96: "You don't need advantage on the attack roll
 * if another enemy of the target is within 5 feet of it... and you don't
 * have disadvantage on the attack roll").
 *
 * Session 80: Fixed the interaction of advantage+disadvantage cancellation
 * with Sneak Attack. Previously, when both advantage and disadvantage were
 * present, the raw `hasAdvantage` flag allowed Sneak Attack via the
 * advantage route even though the net result was a straight roll (neither
 * advantage nor disadvantage per PHB p.173). Now correctly uses net
 * advantage/disadvantage: net advantage → SA via advantage route; net
 * disadvantage → no SA; net neither → SA via ally-adjacent route only.
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

  // PHB p.173: advantage and disadvantage cancel — you have "neither".
  // Compute NET advantage/disadvantage for Sneak Attack eligibility.
  const netAdvantage = hasAdvantage && !hasDisadvantage;
  const netDisadvantage = hasDisadvantage && !hasAdvantage;

  // PHB p.96: "You don't need advantage... if another enemy of the target
  // is within 5 feet of it, that enemy isn't incapacitated, and you don't
  // have disadvantage on the attack roll."
  if (netDisadvantage) return false;  // disadvantage blocks SA even with ally
  if (netAdvantage) return true;      // advantage enables SA
  if (allyAdjacentToTarget) return true;  // no disadvantage + ally adjacent → SA
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

  // ── Session 49 Task #29-follow-up-3c: Natural Recovery (Land Druid 2) ──
  // PHB p.68: recover spell slots equal to half druid level (rounded up),
  // max 5th level, once per long rest. v1 simplification: auto-recover the
  // lowest-level expended slots first (maximizes number of slots regained).
  // The druid's classLevels['Druid'] gives the druid level; falls back to
  // total level for monoclass. Slots above 5th level are NOT recoverable.
  if (r.naturalRecovery && r.naturalRecovery.usesRemaining > 0
      && c.classFeatures?.includes('Natural Recovery')
      && r.spellSlots) {
    const druidLevel = c.classLevels?.['Druid'] ?? c.level ?? 1;
    let budget = Math.ceil(druidLevel / 2);  // PHB p.68: rounded up
    // Iterate slots from 1st to 5th level; recover expended slots until budget
    // is exhausted. Each slot costs its level in budget (e.g. recovering a 3rd-
    // level slot costs 3 from the budget).
    for (let lvl = 1; lvl <= 5 && budget > 0; lvl++) {
      const slot = r.spellSlots[lvl];
      if (!slot) continue;
      while (slot.remaining < slot.max && budget >= lvl) {
        slot.remaining++;
        budget -= lvl;
      }
    }
    r.naturalRecovery.usesRemaining = 0;  // consume the use
  }
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
    c.currentHP = Math.min(effectiveMaxHP(c), c.currentHP + recovered);
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
  c.currentHP      = c.maxHP;  // long rest restores to full maxHP (exhaustion may reduce effective cap)
  c.tempHP         = 0;
  c.conditions     = new Set();
  c.concentration  = null;
  c.activeEffects  = [];      // all spell effects end on a long rest
  // PHB p.291: "Finishing a long rest reduces a creature's exhaustion level by 1,
  // provided that the creature has also ingested some food and drink."
  if (c.exhaustionLevel > 0) c.exhaustionLevel--;
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
  // Session 49 Task #29-follow-up-3c: Land Druid Natural Recovery resets on long rest.
  if (r.naturalRecovery)   r.naturalRecovery.usesRemaining = 1;
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
 * Detailed result of a grapple/shove contest.
 * Exposes the raw d20 rolls so reaction spells (Silvery Barbs) can
 * implement stricter RAW compliance: "reroll the d20 and use the lower
 * roll" requires knowing the original d20, not just win/lose.
 */
export interface GrappleContestResult {
  /** True if the attacker wins the contest (defender becomes grappled/shoved). */
  attackerWon: boolean;
  /** The attacker's raw d20 roll (1-20). */
  attackerRoll: number;
  /** The attacker's total (d20 + STR mod + proficiency). */
  attackerTotal: number;
  /** The defender's raw d20 roll (1-20) — whichever of STR/DEX was higher. */
  defenderRoll: number;
  /** The defender's total (d20 + ability mod). */
  defenderTotal: number;
  /** Which defense skill the defender used ('str' = Athletics, 'dex' = Acrobatics). */
  defenderSkill: 'str' | 'dex';
}

/**
 * Roll a grapple contest: attacker STR(Athletics) vs defender STR(Athletics) or DEX(Acrobatics).
 * Returns true if attacker wins (target becomes Grappled).
 * Note: grapple is an ability check, not an attack roll — Reckless Attack advantage does NOT apply.
 */
export function rollGrappleContest(attacker: Combatant, defender: Combatant): boolean {
  return rollGrappleContestDetailed(attacker, defender).attackerWon;
}

/**
 * Detailed version of rollGrappleContest that returns the raw d20 rolls and
 * totals for both sides. Used by rollGrappleContestReactable (combat.ts) to
 * fire the `incoming_ability_check_success` reaction trigger with real roll
 * values, and by Silvery Barbs' executeAbilityCheckSuccessReroll to
 * implement the "reroll the d20 and use the lower roll" RAW rule.
 *
 * PHB p.195: "The target of your grapple must be no more than one size
 * larger than you and must be within your reach." (Size check is the
 * caller's responsibility — canGrappleOrShoveTarget.)
 *
 * PHB p.195: "Using at least one free hand, you try to seize the target,
 * making a grapple check instead of an attack roll: a Strength (Athletics)
 * check contested by the target's Strength (Athletics) or Dexterity
 * (Acrobatics) check (the target chooses the ability to use)."
 *
 * Tie goes to the defender (consistent with attack vs AC tie = miss).
 */
export function rollGrappleContestDetailed(
  attacker: Combatant,
  defender: Combatant,
): GrappleContestResult {
  const prof = profBonusByCR(attacker.cr);
  const attackerDie = rollDie(20);
  const attackerTotal = attackerDie + abilityMod(attacker.str) + prof; // Athletics proficiency
  // Defender chooses best of STR(Athletics) or DEX(Acrobatics) — AI uses whichever is higher
  const defStrDie = rollDie(20);
  const defDexDie = rollDie(20);
  const defStr = defStrDie + abilityMod(defender.str);
  const defDex = defDexDie + abilityMod(defender.dex);
  // The defender "chooses the ability to use" — modelled as picking the
  // higher of the two rolls (since the defender sees both before deciding).
  const useStr = defStr >= defDex;
  const defenderTotal = useStr ? defStr : defDex;
  const defenderDie = useStr ? defStrDie : defDexDie;
  const defenderSkill: 'str' | 'dex' = useStr ? 'str' : 'dex';
  const attackerWon = attackerTotal > defenderTotal; // tie goes to defender
  return {
    attackerWon,
    attackerRoll: attackerDie,
    attackerTotal,
    defenderRoll: defenderDie,
    defenderTotal,
    defenderSkill,
  };
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
