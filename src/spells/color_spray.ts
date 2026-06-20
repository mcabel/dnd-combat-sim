// ============================================================
// Color Spray — PHB p.222
//
// 1st-level illusion, action, range Self (15-ft cone), NO concentration.
// Components: V, S, M (red sand, yellow dust, and blue powder).
//
// Effect (canon — PHB p.222):
//   A 15-foot cone of clashing colors streams from your hand. Roll 6d10;
//   the total is how many hit points of creatures this spell can affect.
//   Creatures in the area are affected in order of their current hit
//   points (starting with the lowest current hit points). Each affected
//   creature is BLINDED until the spell ends. Subtract each creature's
//   hit points from the total before moving on to the creature with the
//   next lowest hit points. A creature's hit points must be equal to or
//   less than the remaining total for that creature to be affected.
//
//   No attack roll, no saving throw (HP-pool selection).
//
// Canon target-selection rules (confirmed with the user — see zHANDOVER
// note on Color Spray):
//   1. Roll 6d10 = HP budget (range 6–60; the pool targets HP, not
//      creatures, so the spell can affect anywhere from 1 creature
//      whose HP ≤ budget up to 60 1-HP creatures if they all fit in
//      the cone).
//   2. Sort creatures in the cone by CURRENT HP ascending (weakest
//      first). Ties are broken arbitrarily (v1: stable sort preserves
//      iteration order — same as Sleep).
//   3. For each creature, in order:
//        - If the creature is IMMUNE (already unconscious, already
//          blinded, or otherwise "can't see"), SKIP it — it is NOT
//          targeted and does NOT reduce the pool.
//        - If the creature has 0 HP (already down/dying), SKIP it.
//        - If the creature's CURRENT HP > remaining budget, STOP — the
//          spell ends (leftover HP budget is wasted). v1 NOTE: PHB
//          canon is unambiguous on the "lowest-to-highest, stop when
//          the next can't fit" rule, so we STOP rather than skipping
//          ahead to smaller creatures that might also be in the area.
//          (Sleep uses the same stop-on-too-big rule.)
//        - Otherwise (current HP ≤ budget): apply BLINDED, deduct the
//          creature's CURRENT HP from the budget, continue.
//   4. HP for pool math = current HP only. TEMP HP does NOT count —
//      a creature with 5 currentHP + 50 tempHP only consumes 5 from
//      the budget. However, "temporary max HP" buffs (e.g. Aid) raise
//      current HP directly, so they DO count (they're real current HP).
//   5. Allies in the area are valid targets (canon — Color Spray does
//      not exclude same-faction creatures). A caster pointing the cone
//      at a cluster of enemies risks catching low-HP allies too; an
//      unwounded ally (current HP > budget) is naturally unaffected.
//      v1's AI does not optimize cone aim to avoid allies — it accepts
//      friendly-fire risk as a v1 simplification.
//
// Upcast: +2d10 per slot level above 1st (NOT modelled in v1).
//
// v1 simplifications (documented in metadata):
//   - Cone aim: canon 15-ft cone "from your hand" — v1 aims the cone
//     at the nearest living, non-immune enemy within 15 ft (so the AI
//     picks a useful direction). Allies caught in that cone are still
//     valid HP-pool targets per canon.
//   - NOT concentration (PHB p.222: instantaneous — 1 min rider).
//   - 1-min duration not tracked: the blinded condition persists for
//     the entire v1 combat (no end-of-combat hook). Same v1 gap as
//     Blindness/Deafness.
//   - Wake-on-damage / end-on-save: PHB p.222 has no such rider for
//     Color Spray (unlike Sleep). The condition just lasts the
//     duration (1 min canon, full combat in v1).
//   - Undead immunity / "can't see" attribute: not separately tracked.
//     v1 models immunity via the existing `blinded`/`unconscious`
//     conditions on the target (a creature already blinded or
//     unconscious is skipped). Undead are not specially excluded.
//   - Upcast: +2d10/slot-level NOT modelled — v1 always rolls 6d10.
//
// Migration history:
//   - Session 25 / Batch 2: migrated from the generic forward-compat
//     flag to a bespoke HP-pool cone. Originally applied `unconscious`
//     per the plan's Batch 2 spec (color_spray listed under
//     "unconscious"); documented via
//     `colorSprayBlindedV1SimplifiedToUnconscious`.
//   - Session 26 (CANON FIX): per user review, reverted to canon
//     `blinded` condition (NOT unconscious). Allies are now valid
//     HP-pool targets per canon. Already-blinded/unconscious/0-HP
//     creatures are skipped (immune). Temp HP does not count toward
//     pool math. Removed `colorSprayBlindedV1SimplifiedToUnconscious`
//     flag — the spell now follows canon. Added
//     `colorSprayCanonBlindedV1: true` to document the canon behavior.
//
// Spell module pattern (HP-pool cone selection, no save, no concentration):
//   shouldCast(caster, bf) → Combatant[] | null  (all valid creatures in cone, unsorted)
//   execute(caster, targets, state) → void  (rolls 6d10, sorts, budget-filters)
//   cleanup() — no-op (no concentration; blinded persists for combat)
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { rollDie } from '../engine/utils';
import { inConeFt, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Color Spray',
  level: 1,
  school: 'illusion',
  rangeFt: 15,                   // PHB p.222: 15-ft cone
  dieCount: 6,
  dieSides: 10,                  // PHB p.222: 6d10 HP budget
  concentration: false,
  saveAbility: null,             // PHB p.222: NO save (HP-pool selection)
  castingTime: 'action',
  colorSprayHpPoolSelectionV1: true,                       // HP-pool pattern (mirrors Sleep)
  colorSprayCanonBlindedV1: true,                          // canon: applies blinded (was unconscious in Batch 2)
  colorSprayAlliesValidTargetsV1: true,                    // canon: allies in cone are valid HP-pool targets
  colorSprayTempHpNotCountedV1: true,                      // canon: temp HP does not reduce the pool
  colorSprayWakeOnDamageV1Simplified: true,                // wake-on-damage NOT modelled (PHB has no such rider — kept for backward-compat flag name)
  colorSprayUpcastV1Implemented: false,                    // +2d10/slot-level NOT modelled
} as const;

const CONE_RANGE_FT = 15;
const CONE_HALF_ANGLE_DEG = 26.57;

// ---- Local log helper ---------------------------------------

function emit(
  state: EngineState,
  type: CombatEvent['type'],
  actorId: string,
  desc: string,
  targetId?: string,
  value?: number,
): void {
  state.log.events.push({ round: state.battlefield.round, actorId, type, targetId, value, description: desc });
}

// ---- Dice helper --------------------------------------------

/** Roll `metadata.dieCount`d`metadata.dieSides` and return the total (HP budget). */
export function rollHpPool(): number {
  let total = 0;
  for (let i = 0; i < metadata.dieCount; i++) total += rollDie(metadata.dieSides);
  return total;
}

// ---- Validity helper ----------------------------------------

/**
 * Returns true if the creature is a VALID Color Spray target (can be
 * affected by the pool — not immune, not already down).
 *
 * Canon immunities (per user-confirmed canon):
 *   - Already unconscious (condition OR isUnconscious flag) — "can't see"
 *   - Already blinded — immune to a re-application
 *   - 0 current HP — PHB p.222: "A creature is unaffected if it has 0
 *     hit points" (already down/dying)
 *   - Dead (isDead) — trivially unaffected
 *
 * Note: TEMP HP is NOT considered here — pool math uses currentHP only
 * (handled in execute). A creature with 5 currentHP + 50 tempHP is
 * valid; it just consumes only 5 from the pool.
 */
function isValidColorSprayTarget(c: Combatant): boolean {
  if (c.isDead) return false;
  if (c.isUnconscious || c.conditions.has('unconscious')) return false;
  if (c.conditions.has('blinded')) return false;        // already blind → immune
  if (c.currentHP <= 0) return false;                   // PHB p.222: 0 HP unaffected
  return true;
}

// ---- Planner ------------------------------------------------

/**
 * Returns the list of ALL valid creatures (enemies AND allies per
 * canon) caught in a Color Spray 15-ft cone aimed at the nearest
 * living, non-immune enemy within 15 ft, or null when the spell
 * should not be cast.
 *
 * Targets are returned UNSORTED — execute sorts by currentHP for the
 * HP-pool filter. Allies are included per canon (Color Spray does not
 * exclude same-faction creatures); a high-HP ally is naturally safe
 * because their HP will exceed the budget.
 *
 * Preconditions:
 *   - Caster has 'Color Spray' in their actions
 *   - Caster has at least one 1st-level-or-higher slot available
 *   - At least 1 living, non-immune enemy is within 15 ft (cone aim
 *     needs a target — v1 aims at the nearest enemy)
 *
 * Note: Color Spray is NOT concentration — it can be cast while
 * concentrating on another spell.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (!caster.actions.some(a => a.name === 'Color Spray')) return null;
  if (!hasSpellSlot(caster, 1)) return null;

  const enemies = livingEnemiesOf(caster, bf);

  // Find nearest VALID enemy within cone range (sets the cone's aim direction).
  let nearest: Combatant | null = null;
  let nearestDistFt = Infinity;
  for (const e of enemies) {
    if (!isValidColorSprayTarget(e)) continue;     // skip immune / 0 HP / already-down
    const dx = e.pos.x - caster.pos.x;
    const dy = e.pos.y - caster.pos.y;
    const distFt = Math.sqrt(dx * dx + dy * dy) * 5;
    if (distFt <= CONE_RANGE_FT && distFt < nearestDistFt) {
      nearest = e; nearestDistFt = distFt;
    }
  }
  if (!nearest) return null;

  // Collect ALL valid creatures (enemies + allies — canon) in the cone.
  // The caster themselves is NEVER caught (they're the cone's origin).
  const targets: Combatant[] = [];
  for (const c of bf.combatants.values()) {
    if (c.id === caster.id) continue;
    if (!isValidColorSprayTarget(c)) continue;
    if (inConeFt(caster.pos, nearest.pos, c.pos, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT)) targets.push(c);
  }
  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Color Spray:
 *  1. Consume a 1st-level spell slot.
 *  2. Roll 6d10 = HP budget.
 *  3. Sort targets by ascending currentHP (weakest first) — canon.
 *  4. For each: if currentHP ≤ remaining budget → apply BLINDED,
 *     deduct currentHP from budget. Else unaffected (budget can't
 *     cover them — STOP per PHB "lowest-to-highest" rule, same as
 *     Sleep).
 *
 * Canon behavior (per user review):
 *   - Applies BLINDED (not unconscious).
 *   - Allies in the cone are valid targets.
 *   - Already-blinded, unconscious, 0-HP, and dead creatures are
 *     skipped (immune — do NOT reduce the pool).
 *   - TEMP HP is NOT subtracted from the pool — only currentHP. A
 *     creature with 5 currentHP + 50 tempHP consumes only 5.
 *   - "Temporary max HP" buffs (e.g. Aid) raise currentHP directly,
 *     so they DO count toward the pool (they're real current HP).
 *
 * @param caster  The casting Combatant (Sorcerer / Wizard)
 * @param targets Candidates from shouldCast (all valid creatures in the 15-ft cone, unsorted)
 * @param state   Current EngineState
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 1);

  // Roll 6d10 for the HP budget.
  let budget = rollHpPool();

  emit(state, 'action', caster.id,
    `${caster.name} casts Color Spray! (6d10 = ${budget} HP budget, 15-ft cone — ${targets.length} creature${targets.length !== 1 ? 's' : ''} in range)`);

  // Sort ascending by current HP — affect the weakest first (PHB p.222).
  // Re-validate each target (state may have changed since shouldCast).
  const sorted = [...targets]
    .filter(t => isValidColorSprayTarget(t))
    .sort((a, b) => a.currentHP - b.currentHP);

  let affected = 0;
  for (const target of sorted) {
    if (budget <= 0) {
      emit(state, 'action', caster.id,
        `${target.name} (${target.currentHP} HP) — HP budget exhausted, unaffected by Color Spray`, target.id);
      continue;
    }
    if (target.currentHP <= budget) {
      // Budget covers this creature — render BLINDED (canon).
      // NOTE: deduct CURRENT HP only — temp HP does NOT reduce the pool
      // (canon). A target with 5 currentHP + 50 tempHP consumes only 5.
      budget -= target.currentHP;

      // applySpellEffect for condition tracking (consistent with the
      // Batch 2 pattern). sourceIsConcentration: false — Color Spray
      // is NOT concentration (PHB p.222: instantaneous; 1-min rider
      // not tracked in v1, condition persists for the combat).
      applySpellEffect(target, {
        casterId: caster.id, spellName: 'Color Spray',
        effectType: 'condition_apply', payload: { condition: 'blinded' },
        sourceIsConcentration: false,
      });

      emit(state, 'condition_add', caster.id,
        `${target.name} (${target.currentHP} HP) is BLINDED by Color Spray! (${budget} HP budget remaining)`, target.id);
      affected++;
    } else {
      // Creature's HP exceeds remaining budget — unaffected.
      // (We continue rather than break because PHB canon processes
      // "lowest to highest" — a higher-HP creature can't be covered
      // by definition once a lower-HP one couldn't be, but Sleep's
      // reference impl uses continue for safety; mirror that.)
      emit(state, 'action', caster.id,
        `${target.name} (${target.currentHP} HP) — too many HP for remaining budget (${budget}), unaffected`, target.id);
    }
  }

  emit(state, 'action', caster.id,
    `Color Spray: ${affected} creature${affected !== 1 ? 's' : ''} rendered blind`);
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void { /* no-op — NOT concentration; blinded persists */ }
