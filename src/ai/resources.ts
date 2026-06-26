// ============================================================
// Class Resource AI
// Decides WHEN to use class resources (rage, smite, etc.).
// Called from the PC-specific branch of the planner.
//
// Design principle: resources are spent conservatively at level 1
// because there are only 2 slots. Each function returns a
// PlannedAction or null (don't spend).
// ============================================================

import { Combatant, PlannedAction, Battlefield, DiceExpression } from '../types/core';
import { isBloodied, rollDie } from '../engine/utils';
import { livingAlliesOf, livingEnemiesOf, chebyshev3D } from '../engine/movement';

// ---- Spell slot helper --------------------------------------

/**
 * Consume a spell slot of the given level (or higher if unavailable).
 * Returns the slot level actually consumed, or null if no slots remain.
 * Handles both standard slots and pact slots (Warlock).
 */
export function consumeSpellSlot(caster: Combatant, desiredLevel = 1): number | null {
  const r = caster.resources;
  if (!r) return null;

  // Pact slots (Warlock)
  if (r.pactSlots && r.pactSlots.remaining > 0) {
    r.pactSlots.remaining--;
    return r.pactSlots.slotLevel;
  }

  // Standard slots: try desired level first, then higher
  if (r.spellSlots) {
    for (let lvl = desiredLevel; lvl <= 9; lvl++) {
      const slot = r.spellSlots[lvl];
      if (slot && slot.remaining > 0) {
        slot.remaining--;
        return lvl;
      }
    }
  }

  return null; // no slots available
}

/** Check if any spell slot remains. */
export function hasSpellSlot(caster: Combatant, minLevel = 1): boolean {
  const r = caster.resources;
  if (!r) return false;
  if (r.pactSlots?.remaining ?? 0 > 0) return true;
  if (r.spellSlots) {
    for (let lvl = minLevel; lvl <= 9; lvl++) {
      if ((r.spellSlots[lvl]?.remaining ?? 0) > 0) return true;
    }
  }
  return false;
}

/**
 * Return the lowest available slot level at or above `minLevel`, or null.
 * Does NOT consume the slot — for planning purposes only.
 *
 * RFC-UPCASTING Phase 1 (Session 72): used by planner branches and
 * selectCastSlot() to determine which slot level will be used before
 * committing to a plan.
 */
export function getLowestAvailableSlot(caster: Combatant, minLevel = 1): number | null {
  const r = caster.resources;
  if (!r) return null;
  // Pact slots (Warlock) — if the pact slot level meets the minimum, it's
  // the only pact slot available, so it's the "lowest" pact option.
  if (r.pactSlots && r.pactSlots.remaining > 0 && r.pactSlots.slotLevel >= minLevel) {
    return r.pactSlots.slotLevel;
  }
  // Standard slots: iterate from minLevel upward.
  if (r.spellSlots) {
    for (let lvl = minLevel; lvl <= 9; lvl++) {
      if ((r.spellSlots[lvl]?.remaining ?? 0) > 0) return lvl;
    }
  }
  return null;
}

// ---- Innate Spellcasting (monster N/day spells) ---------------

/**
 * Check if the caster has an innate spellcasting use remaining for the
 * given spell name. Innate spells (MM p.10–11) are tracked separately
 * from spell slots — they're per-spell-per-day counters, used by
 * monsters like the Couatl (3/day bless, cure wounds, etc.) or Drow
 * (1/day each of Levitate, etc.).
 *
 * Returns true if `caster.resources.innateSpellcasting[spellName].remaining > 0`.
 * Returns false if resources are absent or the spell isn't tracked.
 */
export function hasInnateSpellUse(caster: Combatant, spellName: string): boolean {
  const r = caster.resources;
  if (!r) return false;
  const entry = r.innateSpellcasting?.[spellName];
  if (!entry) return false;
  return entry.remaining > 0;
}

/**
 * Consume one innate spellcasting use of the given spell name.
 * Decrements `resources.innateSpellcasting[spellName].remaining`.
 * Returns true if a use was consumed, false if none remained (or the
 * spell isn't tracked on this caster).
 *
 * Caller is responsible for checking hasInnateSpellUse() first.
 */
export function consumeInnateSpellUse(caster: Combatant, spellName: string): boolean {
  const r = caster.resources;
  if (!r) return false;
  const entry = r.innateSpellcasting?.[spellName];
  if (!entry || entry.remaining <= 0) return false;
  entry.remaining--;
  return true;
}

/**
 * Check if the caster can cast the given spell — either via a spell
 * slot of at least `minLevel`, OR via an innate spellcasting use.
 *
 * Used by shouldCastBless / shouldCastCureWounds / etc. to support
 * monsters with innate spellcasting (Couatl, Drow, etc.) that don't
 * have standard spell slots.
 */
export function canCastSpell(caster: Combatant, spellName: string, minLevel = 1): boolean {
  return hasSpellSlot(caster, minLevel) || hasInnateSpellUse(caster, spellName);
}

// ---- Rage (Barbarian) ---------------------------------------

/**
 * Decide whether to activate Rage this turn.
 * Rage is a bonus action; always worth using at level 1 if enemies are present.
 * Don't use the last charge if below 25% HP (save for next fight).
 */
export function shouldRage(barb: Combatant, battlefield: Battlefield): boolean {
  const r = barb.resources?.rage;
  if (!r || r.active) return false;  // already raging or no rage
  if (r.remaining === 0) return false;
  if (livingEnemiesOf(barb, battlefield).length === 0) return false;
  // Conserve last charge if critically wounded
  if (r.remaining === 1 && barb.currentHP < barb.maxHP * 0.25) return false;
  return true;
}

export function activateRagePlan(barb: Combatant): PlannedAction {
  const r = barb.resources!.rage!;
  r.remaining--;
  r.active = true;
  r.roundsRemaining = 10; // 1 minute = 10 rounds
  return {
    type: 'rage',
    action: null,
    targetId: null,
    description: `${barb.name} enters a Rage! (+2 damage, resistance to B/P/S)`,
  };
}

/**
 * Check if rage should end (no attack AND no damage taken this turn).
 * Call at end of turn; tracked externally by engine via damageTakenThisTurn flag.
 */
export function tickRage(barb: Combatant, attackedThisTurn: boolean, damageTakenThisTurn: boolean): void {
  const r = barb.resources?.rage;
  if (!r?.active) return;
  r.roundsRemaining--;
  if (r.roundsRemaining <= 0 || (!attackedThisTurn && !damageTakenThisTurn)) {
    r.active = false;
    r.roundsRemaining = 0;
  }
}

// ---- Second Wind (Fighter) ----------------------------------

/**
 * Use Second Wind (bonus action) when below 50% HP and slot available.
 */
export function shouldSecondWind(fighter: Combatant): boolean {
  const r = fighter.resources?.secondWind;
  if (!r || r.remaining === 0) return false;
  return fighter.currentHP < fighter.maxHP * 0.5;
}

export function secondWindPlan(fighter: Combatant): PlannedAction {
  fighter.resources!.secondWind!.remaining--;
  // Roll 1d10 + fighter level (1); HP applied here so engine only needs to log the heal.
  const roll = rollDie(10) + 1;
  fighter.currentHP = Math.min(fighter.maxHP, fighter.currentHP + roll);
  return {
    type: 'secondWind',
    action: null,
    targetId: fighter.id,
    healAmount: roll,
    description: `${fighter.name} uses Second Wind, regaining ${roll} HP (now ${fighter.currentHP}/${fighter.maxHP})`,
  };
}

// ---- Divine Smite (Paladin) ---------------------------------

/**
 * Decide whether to smite on a hit.
 * Smart rule (design doc §7.7): smite on crit, on bloodied target, or vs fiend/undead.
 * Only smite if a slot is available.
 */
export function shouldSmite(
  paladin: Combatant,
  target: Combatant,
  isCrit: boolean
): boolean {
  if (!paladin.resources?.divineSmite) return false;
  if (!hasSpellSlot(paladin)) return false;
  if (isCrit) return true;
  if (isBloodied(target)) return true;
  return false;
}

/**
 * Apply Divine Smite damage and consume a slot.
 * Returns the extra radiant damage dealt.
 * PHB: 2d8 per 1st-level slot + 1d8 per additional level (max 5d8).
 */
export function applyDivineSmite(paladin: Combatant, isCrit: boolean): number {
  const slotUsed = consumeSpellSlot(paladin, 1);
  if (slotUsed === null) return 0;

  const diceCount = Math.min(5, 1 + slotUsed); // 2d8 at 1st, +1d8 per level
  const rolls = isCrit ? diceCount * 2 : diceCount; // crit doubles smite dice too
  let total = 0;
  for (let i = 0; i < rolls; i++) total += rollDie(8);
  return total;
}

// ---- Lay on Hands (Paladin) ---------------------------------

/**
 * Should the Paladin use Lay on Hands on an ally?
 * Priority: downed ally → self if critically wounded.
 */
export function shouldLayOnHands(
  paladin: Combatant,
  battlefield: Battlefield
): { use: boolean; targetId: string | null } {
  const r = paladin.resources?.layOnHands;
  if (!r || r.remaining === 0) return { use: false, targetId: null };

  // Check for downed ally adjacent
  const allies = livingAlliesOf(paladin, battlefield);
  const downed = [...battlefield.combatants.values()].find(
    c => c.faction === paladin.faction && c.isUnconscious && !c.isDead &&
         chebyshev3D(paladin.pos, c.pos) <= 1
  );
  if (downed) return { use: true, targetId: downed.id };

  // Self-heal if critically wounded
  if (paladin.currentHP < paladin.maxHP * 0.25) return { use: true, targetId: paladin.id };

  return { use: false, targetId: null };
}

export function layOnHandsPlan(paladin: Combatant, targetId: string): PlannedAction {
  const r = paladin.resources!.layOnHands!;
  const amount = Math.min(r.remaining, 5); // sensible chunk; full pool if target is downed
  r.remaining -= amount;
  return {
    type: 'layOnHands',
    action: null,
    targetId,
    healAmount: amount,
    description: `${paladin.name} uses Lay on Hands for ${amount} HP`,
  };
}

// ---- Bardic Inspiration (Bard) ------------------------------

/**
 * Find the best ally to grant Bardic Inspiration to.
 * Priority: ally that hasn't acted yet this round with highest expected damage.
 * Simple heuristic: highest-HP ally (proxy for striker/frontliner role).
 */
export function bardicInspirationTarget(
  bard: Combatant,
  battlefield: Battlefield
): Combatant | null {
  const r = bard.resources?.bardicInspiration;
  if (!r || r.remaining === 0) return null;

  const allies = livingAlliesOf(bard, battlefield).filter(
    a => a.id !== bard.id && !a.budget.actionUsed
  );
  if (allies.length === 0) return null;

  // Give to highest-HP ally (heuristic: they're the frontliner)
  return allies.reduce((best, a) => a.maxHP > best.maxHP ? a : best);
}

export function bardicInspirationPlan(bard: Combatant, target: Combatant): PlannedAction {
  bard.resources!.bardicInspiration!.remaining--;
  const die = bard.resources!.bardicInspiration!.die;
  return {
    type: 'bardicInspiration',
    action: null,
    targetId: target.id,
    description: `${bard.name} grants Bardic Inspiration (${die}) to ${target.name}`,
  };
}

// ---- Hex (Warlock bonus action) -----------------------------

/**
 * Hex should be cast on the primary target before attacking if no slot was spent yet.
 * Returns true if Hex should be cast.
 */
export function shouldCastHex(warlock: Combatant, targetId: string): boolean {
  const r = warlock.resources?.pactSlots;
  if (!r || r.remaining < 1) return false;
  if (warlock.concentration?.active) return false;
  return true;
}

export function hexPlan(warlock: Combatant, targetId: string): PlannedAction {
  // Consume the pact slot during planning (slot validation already done in shouldCastHex).
  // Concentration is set in hex.ts execute() to keep the two concerns separate.
  consumeSpellSlot(warlock, 1);
  return {
    type: 'hex',
    action: null,
    targetId,
    description: `${warlock.name} casts Hex on target`,
  };
}

/** Thin proxy to avoid importing from utils (would be circular) */
function startConcentration_proxy(c: Combatant, spellName: string): void {
  c.concentration = { active: true, spellName, dcIfHit: 10 };
}

// ---- Healing Spells (Cleric / Druid / Bard / Paladin) -------

/**
 * Ability modifier from a stat (thin helper — avoids importing utils).
 */
function abMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Find the best ally (or self) to heal with a spell.
 *
 * Priority:
 *   1. Any downed (unconscious, !isDead) party member within range
 *   2. Self below 25% HP
 *   3. Any ally below 25% HP within range
 *
 * Returns null if no healing is warranted.
 */
function healSpellTarget(
  caster: Combatant,
  rangeFt: number,
  battlefield: Battlefield
): Combatant | null {
  const inRange = (c: Combatant) => chebyshev3D(caster.pos, c.pos) * 5 <= rangeFt;

  // 1. Revive a downed ally
  for (const [, c] of battlefield.combatants) {
    if (c.faction === caster.faction && c.isUnconscious && !c.isDead && inRange(c)) {
      return c;
    }
  }

  // 2. Self-heal if critical
  if (caster.currentHP < caster.maxHP * 0.25) return caster;

  // 3. Any party member below 25% HP
  for (const [, c] of battlefield.combatants) {
    if (c.faction === caster.faction && c.id !== caster.id &&
        !c.isDead && !c.isUnconscious &&
        c.currentHP < c.maxHP * 0.25 && inRange(c)) {
      return c;
    }
  }

  return null;
}

/**
 * True if the caster should spend an action on Cure Wounds this turn.
 * Only fires when a slot OR innate use is available AND a valid heal target exists.
 */
export function shouldCastCureWounds(
  caster: Combatant,
  battlefield: Battlefield
): Combatant | null {
  if (!hasSpellSlot(caster) && !hasInnateSpellUse(caster, 'Cure Wounds')) return null;
  // Cure Wounds is Touch range (5ft)
  return healSpellTarget(caster, 5, battlefield);
}

/**
 * True if the caster should spend a BONUS action on Healing Word this turn.
 * Only fires when a slot OR innate use is available AND a valid heal target exists.
 */
export function shouldCastHealingWord(
  caster: Combatant,
  battlefield: Battlefield
): Combatant | null {
  if (!hasSpellSlot(caster) && !hasInnateSpellUse(caster, 'Healing Word')) return null;
  // Healing Word is 60ft range
  return healSpellTarget(caster, 60, battlefield);
}

/**
 * Build a spellHeal PlannedAction.
 * Rolls and applies the heal eagerly (same pattern as secondWind).
 * isHealingWord=true → 1d4 + WIS mod (Healing Word), false → 1d8 + WIS mod (Cure Wounds).
 * Upcast: +1 die per slot level above 1st (PHB p.230 / p.250).
 */
export function spellHealPlan(
  caster: Combatant,
  targetId: string,
  isHealingWord: boolean
): PlannedAction {
  // Consume a spell slot if available; otherwise fall back to innate spellcasting.
  // Used for both Healing Word and Cure Wounds (innate spellcasting support — Session 41 Task #2).
  const spellName = isHealingWord ? 'Healing Word' : 'Cure Wounds';
  const slotUsed = consumeSpellSlot(caster, 1);
  if (slotUsed === null) {
    consumeInnateSpellUse(caster, spellName);
  }
  const effectiveSlotLevel = slotUsed ?? 1;

  // Upcast scaling: +1 die per slot level above 1st (PHB p.230 / p.250)
  const diceCount = 1 + Math.max(0, effectiveSlotLevel - 1);
  const sides = isHealingWord ? 4 : 8;
  let roll = 0;
  for (let i = 0; i < diceCount; i++) roll += rollDie(sides);
  const mod    = abMod(caster.wis);
  const amount = Math.max(1, roll + mod);
  const spell  = isHealingWord ? 'Healing Word' : 'Cure Wounds';
  return {
    type: 'spellHeal',
    action: null,
    targetId,
    healAmount: amount,
    castSlotLevel: effectiveSlotLevel,
    description: `${caster.name} casts ${spell} (slot ${effectiveSlotLevel}) for ${amount} HP (${diceCount}d${sides}+${mod})`,
  };
}
