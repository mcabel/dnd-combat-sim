// ============================================================
// Calm Emotions — PHB p.221
//
// 2nd-level enchantment, action, range 60 ft, concentration (1 min).
// Components: V, S.
//
// Effect: You attempt to suppress strong emotions in a group of people.
//         Each humanoid in a 20-foot-radius sphere centered on a point
//         you choose within range must make a Charisma saving throw; a
//         creature can choose to fail this saving throw if it wishes.
//         If a creature fails its saving throw, choose one of the
//         following two effects.
//
//         - You can suppress any effect causing a target to be charmed
//           or frightened. When this spell ends, any suppressed effect
//           resumes, provided that its duration has not expired in the
//           meantime.
//         - Alternatively, you can make a target indifferent about
//           creatures of your choice that it is hostile toward. This
//           indifference ends if the target is attacked or harmed by a
//           spell or if it witnesses any of its friends being harmed.
//           When the spell ends, the creature becomes hostile again,
//           unless the DM rules otherwise.
//
// v1 simplifications:
//   - v1 ONLY implements the "suppress charm/frighten" effect (the
//     combat-relevant use case). The "indifference" effect is NOT
//     modelled — v1 has no hostility-tracking subsystem. Forward-compat
//     TODO via the metadata flag
//     `calmEmotionsIndifferenceModeV1Implemented: false`.
//   - v1 targets ALLIES within 60 ft that are charmed or frightened.
//     Allies voluntarily fail the save (PHB p.221: "a creature can
//     choose to fail this saving throw if it wishes"). The save is
//     NOT rolled for allies — they just lose the charmed/frightened
//     conditions. This is the spell's primary combat use case
//     (removing debuffs from allies).
//   - Enemies in the area are NOT targeted in v1. Canonically, the
//     caster COULD use Calm Emotions to remove charm/frighten from
//     enemies (e.g. dispelling an enemy Bard's charm effect), but this
//     is a rare edge case and v1 skips it for simplicity. Forward-
//     compat TODO via the metadata flag
//     `calmEmotionsEnemyTargetingV1Implemented: false`.
//   - Duration: canon 1 min concentration → v1: concentration is
//     started via startConcentration(), but the engine does NOT yet
//     enforce concentration checks on damage taken (forward-compat
//     TODO; see TG-002). The charmed/frightened conditions are removed
//     immediately on cast and NOT restored on concentration break
//     (canon: "When this spell ends, any suppressed effect resumes,
//     provided that its duration has not expired in the meantime" —
//     v1 does NOT model this restoration). Forward-compat TODO via
//     the metadata flag
//     `calmEmotionsConditionRestorationV1Implemented: false`.
//   - Humanoid creature-type restriction: PHB p.221 says "Each
//     humanoid". v1 does NOT verify creature type (parser tech debt —
//     TG-004). All living allies are valid targets.
//   - AoE shape: canon 20-ft-radius sphere centered on a point within
//     range. v1 simplification: targets all allies within 60 ft of the
//     caster (the caster is the center). This is a v1 simplification
//     — v1 has no positional AoE targeting subsystem. Documented via
//     the metadata flag `calmEmotionsPositionalAoeV1Implemented: false`.
//
// Spell module pattern (Session 31 architecture):
//   shouldCast(caster, bf) → Combatant[] | null
//   execute(caster, targets, state) → void
//   metadata → spell stats
//   cleanup() — no-op (concentration break does NOT restore conditions in v1)
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Calm Emotions',
  level: 2,
  school: 'enchantment',
  rangeFt: 60,
  aoeSizeFt: 20,       // 20-ft-radius sphere (canon)
  concentration: true,
  saveAbility: 'cha' as const,
  castingTime: 'action',
  // v1 simplification flags (mirror cantrip-workstream pattern):
  calmEmotionsIndifferenceModeV1Implemented: false,        // indifference mode skipped
  calmEmotionsEnemyTargetingV1Implemented: false,          // enemy targeting skipped
  calmEmotionsConditionRestorationV1Implemented: false,    // concentration-break restoration skipped
  calmEmotionsPositionalAoeV1Implemented: false,           // 20-ft sphere → 60-ft radius around caster
  calmEmotionsConcentrationEnforcementV1Implemented: true,  // TG-002 DONE (Session 34)
  calmEmotionsHumanoidTypeCheckV1Implemented: false,       // see TG-004
} as const;

// ---- Local log helper ---------------------------------------

function emit(
  state: EngineState,
  type: CombatEvent['type'],
  actorId: string,
  desc: string,
  targetId?: string,
  value?: number,
): void {
  state.log.events.push({
    round: state.battlefield.round,
    actorId,
    type,
    targetId,
    value,
    description: desc,
  });
}

// ---- Planner ------------------------------------------------

/**
 * Returns the list of ally targets for Calm Emotions (allies within 60 ft
 * that are currently charmed or frightened), or null when the spell
 * should not be cast.
 *
 * v1 targeting: ALLIES only (enemies are not targeted — v1 simplification).
 * Allies voluntarily fail the CHA save (PHB p.221), so the save is NOT
 * rolled — the conditions are just removed.
 *
 * Preconditions:
 *   - Caster has 'Calm Emotions' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - At least 1 valid ally target exists (charmed or frightened, within 60 ft)
 *
 * Note: Calm Emotions IS concentration — it cannot be cast while
 * concentrating on another spell. The planner gates on concentration.
 * (v1 does NOT restore conditions on concentration break — see metadata
 * flag `calmEmotionsConditionRestorationV1Implemented: false`.)
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
  if (caster.concentration?.active) return null;
  if (!caster.actions.some(a => a.name === 'Calm Emotions')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const targets: Combatant[] = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;  // v1: allies only

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 60) continue;

    // Target must be charmed or frightened (the conditions Calm Emotions
    // suppresses). Allies without these conditions get no benefit.
    if (!c.conditions.has('charmed') && !c.conditions.has('frightened')) continue;

    targets.push(c);
  }

  return targets.length >= 1 ? targets : null;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Calm Emotions:
 *  1. Consume a 2nd-level spell slot (or higher — consumeSpellSlot handles upcast).
 *  2. Break any existing concentration (safety net — planner prevents this).
 *  3. Start concentration on Calm Emotions.
 *  4. For each target (ally with charmed/frightened):
 *     - Remove 'charmed' and 'frightened' conditions.
 *       (Allies voluntarily fail the CHA save per PHB p.221.)
 *     - Log the condition removal.
 *
 * v1 simplifications: indifference mode NOT modelled; enemy targeting
 * NOT modelled; condition restoration on concentration break NOT
 * modelled; concentration NOT enforced (TG-002). The charmed/frightened
 * conditions are removed immediately and persist removed for the entire
 * combat (even if concentration breaks — v1 does NOT restore them).
 *
 * @param caster   The casting Combatant (Bard/Cleric/Druid/Paladin)
 * @param targets  Candidates from shouldCast (allies with charmed/frightened)
 * @param state    Current EngineState (for logging + battlefield access)
 */
export function execute(
  caster: Combatant,
  targets: Combatant[],
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  // Safety: clean up any stale concentration before starting new
  if (caster.concentration?.active) {
    removeEffectsFromCaster(caster.id, state.battlefield);
  }
  startConcentration(caster, 'Calm Emotions');

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Calm Emotions! (suppressing charm/frighten on ${targets.length} all${targets.length !== 1 ? 'ies' : 'y'})`,
  );

  const conditionsToRemove: Condition[] = ['charmed', 'frightened'];

  for (const target of targets) {
    // Re-check liveness (stale edge case)
    if (target.isDead || target.isUnconscious) continue;

    let removedAny = false;
    for (const cond of conditionsToRemove) {
      if (target.conditions.has(cond)) {
        target.conditions.delete(cond);
        removedAny = true;
        emit(
          state, 'condition_remove', caster.id,
          `${target.name}'s ${cond} condition is suppressed by Calm Emotions!`,
          target.id,
        );
      }
    }

    if (!removedAny) {
      // Defensive: shouldCast filtered for charmed/frightened, but the
      // condition may have been removed between plan and execute.
      emit(
        state, 'action', caster.id,
        `${target.name} has no charm/frighten to suppress (stale plan).`,
        target.id,
      );
    }
  }
}

// ---- Cleanup ------------------------------------------------

/**
 * Cleanup hook for Calm Emotions — called from resetBudget() at the
 * start of the caster's next turn. NO-OP in v1 because:
 *   - Calm Emotions removes charmed/frightened conditions immediately
 *     on cast. v1 does NOT restore them on concentration break (canon
 *     says "When this spell ends, any suppressed effect resumes" —
 *     forward-compat TODO via the metadata flag
 *     `calmEmotionsConditionRestorationV1Implemented: false`).
 *   - v1 does NOT enforce concentration checks (TG-002).
 *
 * Exported for symmetry with the other spell modules' cleanup pattern.
 * Future work: implement condition restoration on concentration break
 * (would require tracking which conditions were suppressed per target —
 * a new scratch field on Combatant or a side-table in EngineState).
 */
export function cleanup(_c: Combatant): void {
  // No-op — v1 does not restore conditions on concentration break.
}
