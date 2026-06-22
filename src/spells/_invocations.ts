// ============================================================
// _invocations.ts — Warlock Eldritch Invocations registry
//
// PHB p.110: "Eldritch Invocations are fragments of forbidden
// knowledge that shape your pact magic. Each invocation grants you
// a new magical ability based on your pact."
//
// At 2nd level, a Warlock learns 2 invocations; more at higher levels.
// Each invocation is a passive ability or an augmentation to an
// existing spell/cantrip.
//
// This registry establishes the invocation subsystem for the engine.
// Each invocation descriptor describes:
//   - name: canonical invocation name (must match the entry in
//     Combatant.eldritchInvocations)
//   - description: PHB rules text
//   - onEldritchBlastHit: OPTIONAL hook fired after an Eldritch Blast
//     beam hits a target (after damage, before death check). Used by
//     Repelling Blast (push 10 ft). Other invocations may add different
//     hooks in the future.
//
// To add a new invocation:
//   1. Add a descriptor to the ELDRITCH_INVOCATIONS map below.
//   2. If it needs a new hook (e.g. on Pact Magic cast, on short rest),
//      add the hook to the EldritchInvocation interface + wire a new
//      trigger point in combat.ts.
//   3. Populate `combatant.eldritchInvocations` via the parser/leveler.
//   4. Write tests in src/test/<invocation_name>.test.ts.
// ============================================================

import { Combatant } from '../types/core';
import { EngineState } from '../engine/combat';
import { pushAway } from '../engine/movement';
import { Vec3 } from '../types/core';

// ---- EldritchInvocation descriptor --------------------------

export interface EldritchInvocation {
  /** Canonical invocation name (must match Combatant.eldritchInvocations entries). */
  name: string;
  /** PHB rules text for documentation/logging. */
  description: string;
  /**
   * OPTIONAL hook fired after an Eldritch Blast beam hits a target
   * (after damage is dealt, before checkDeath). Used by Repelling Blast
   * to push the target 10 ft away from the caster.
   *
   * The hook is only called if:
   *   - The action is 'Eldritch Blast'
   *   - The attacker has this invocation in their eldritchInvocations list
   *   - The attack hit (not a miss)
   */
  onEldritchBlastHit?: (attacker: Combatant, target: Combatant, state: EngineState) => void;
}

// ---- Registry ------------------------------------------------

export const ELDRITCH_INVOCATIONS: Record<string, EldritchInvocation> = {
  // ── Repelling Blast (PHB p.111) ──
  // "When you hit a creature with Eldritch Blast, you can push the
  //  creature up to 10 feet away from you in a straight line."
  //
  // v1 simplification: always pushes the full 10 ft (the "up to" is
  // the warlock's choice, but the AI always pushes max). No size
  // restriction (PHB has none for Repelling Blast). The push happens
  // AFTER damage is dealt, BEFORE checkDeath — so even a target about
  // to drop to 0 HP gets pushed (PHB: "when you hit" — the push is on
  // hit, not on kill).
  'Repelling Blast': {
    name: 'Repelling Blast',
    description: 'When you hit a creature with Eldritch Blast, you can push the creature up to 10 feet away from you in a straight line.',
    onEldritchBlastHit: (attacker, target, state) => {
      const oldPos: Vec3 = { ...target.pos };
      pushAway(target, attacker.pos, 10);
      // Only log if the target actually moved (pushAway returns early for
      // dead/unconscious targets, same-position targets, or 0-square pushes).
      if (target.pos.x !== oldPos.x || target.pos.y !== oldPos.y) {
        state.log.events.push({
          round: state.battlefield.round ?? 0,
          actorId: attacker.id,
          type: 'move',
          targetId: target.id,
          description: `${target.name} is pushed 10 ft away by Repelling Blast (${oldPos.x},${oldPos.y}) → (${target.pos.x},${target.pos.y})`,
        });
      }
    },
  },

  // Future invocations can be added here:
  //   'Agonizing Blast' — +CHA mod to Eldritch Blast damage
  //   'Grasp of Hadar' — pull 10 ft toward you on Eldritch Blast hit
  //   'Lance of Lethargy' — reduce speed by 10 ft on Eldritch Blast hit
  //   'Thirsting Blade' — two attacks with Pact Weapon (not an EB hook)
  //   etc.
};

/**
 * Check if a combatant has a specific Eldritch Invocation.
 * Returns true if the invocation name is in the combatant's
 * `eldritchInvocations` list.
 */
export function hasInvocation(combatant: Combatant, invocationName: string): boolean {
  return combatant.eldritchInvocations?.includes(invocationName) ?? false;
}

/**
 * Fire the onEldritchBlastHit hook for any invocations the attacker
 * has that respond to Eldritch Blast hits. Called from resolveAttack
 * after damage is dealt, before checkDeath.
 *
 * Currently only Repelling Blast uses this hook. If multiple push/pull
// invocations are added in the future, they fire in registry order.
 */
export function fireEldritchBlastHitInvocations(
  attacker: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  if (!attacker.eldritchInvocations) return;
  for (const invName of attacker.eldritchInvocations) {
    const inv = ELDRITCH_INVOCATIONS[invName];
    if (inv?.onEldritchBlastHit) {
      inv.onEldritchBlastHit(attacker, target, state);
    }
  }
}
