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
//   - onEldritchBlastDamage: OPTIONAL pre-damage hook fired when an
//     Eldritch Blast beam hits (returns bonus damage to add to the
//     base roll). Used by Agonizing Blast (+CHA mod).
//   - onEldritchBlastHit: OPTIONAL post-hit hook fired after damage
//     is dealt, before checkDeath. Used by Repelling Blast (push 10 ft),
//     Grasp of Hadar (pull 10 ft), Lance of Lethargy (slow 10 ft).
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
import { pushAway, pullToward } from '../engine/movement';
import { Vec3 } from '../types/core';

// ---- EldritchInvocation descriptor --------------------------

export interface EldritchInvocation {
  /** Canonical invocation name (must match Combatant.eldritchInvocations entries). */
  name: string;
  /** PHB rules text for documentation/logging. */
  description: string;
  /**
   * OPTIONAL pre-damage hook fired when an Eldritch Blast beam hits a
   * target, AFTER the base damage roll but BEFORE applyDamageWithTempHP.
   * Returns bonus damage to add to the base roll. Used by Agonizing Blast
   * (+CHA mod to EB damage).
   *
   * The hook is only called if:
   *   - The action is 'Eldritch Blast'
   *   - The attacker has this invocation in their eldritchInvocations list
   *   - The attack hit (not a miss)
   *
   * The returned damage is the SAME type as the EB damage (force) and is
   * NOT doubled on crit (PHB p.196: crit doubles "damage dice", not flat
   * modifiers — Agonizing Blast adds a flat CHA mod, not dice).
   */
  onEldritchBlastDamage?: (attacker: Combatant, target: Combatant) => number;
  /**
   * OPTIONAL post-hit hook fired after an Eldritch Blast beam hits a
   * target (after damage is dealt, before checkDeath). Used by:
   *   - Repelling Blast: push 10 ft away from caster
   *   - Grasp of Hadar: pull 10 ft toward caster
   *   - Lance of Lethargy: reduce speed by 10 ft
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
  // ── Repelling Blast (PHB p.111) ── [Session 38]
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

  // ── Agonizing Blast (PHB p.110) ── [Session 39]
  // "When you cast Eldritch Blast, add your Charisma modifier to the
  //  damage it deals on a hit."
  //
  // Pre-damage hook: returns CHA mod as flat bonus damage (NOT dice, so
  // NOT doubled on crit per PHB p.196). The bonus is force damage (same
  // type as EB). Computed inline (Math.floor((cha-10)/2)) to avoid a
  // circular dependency on utils.ts's abilityMod.
  'Agonizing Blast': {
    name: 'Agonizing Blast',
    description: 'When you cast Eldritch Blast, add your Charisma modifier to the damage it deals on a hit.',
    onEldritchBlastDamage: (attacker, _target) => {
      // CHA mod = floor((score - 10) / 2). Inline to avoid circular dep.
      return Math.floor((attacker.cha - 10) / 2);
    },
  },

  // ── Grasp of Hadar (PHB p.111) ── [Session 39]
  // "Once on each of your turns when you hit a creature with your
  //  Eldritch Blast, you can move that creature in a straight line
  //  toward you, pulling it up to 10 feet."
  //
  // Post-hit hook: pulls 10 ft toward caster via pullToward (mirror of
  // Repelling Blast but reversed direction). v1 simplification: always
  // pulls the full 10 ft; no "once per turn" limit (the engine fires
  // on every EB hit, which for v1 is 1 beam per cast — the once-per-turn
  // limit would only matter with multi-beam EB, which is a future task).
  // PHB p.111: "Large or smaller" — v1 ignores the size restriction
  // (same as Repelling Blast).
  'Grasp of Hadar': {
    name: 'Grasp of Hadar',
    description: 'Once on each of your turns when you hit a creature with your Eldritch Blast, you can move that creature in a straight line toward you, pulling it up to 10 feet.',
    onEldritchBlastHit: (attacker, target, state) => {
      const oldPos: Vec3 = { ...target.pos };
      pullToward(target, attacker.pos, 10);
      if (target.pos.x !== oldPos.x || target.pos.y !== oldPos.y) {
        state.log.events.push({
          round: state.battlefield.round ?? 0,
          actorId: attacker.id,
          type: 'move',
          targetId: target.id,
          description: `${target.name} is pulled 10 ft toward ${attacker.name} by Grasp of Hadar (${oldPos.x},${oldPos.y}) → (${target.pos.x},${target.pos.y})`,
        });
      }
    },
  },

  // ── Lance of Lethargy (XGE p.157) ── [Session 39]
  // "When you hit a creature with Eldritch Blast, you can reduce the
  //  creature's speed by 10 feet until the beginning of your next turn."
  //
  // Post-hit hook: reduces target.speed by 10 ft using the Ray of Frost
  // scratch-field pattern (stores original speed, restores on cleanup).
  // Cleanup is inlined in resetBudget (utils.ts) to avoid a circular
  // dependency (utils.ts ↔ _invocations.ts).
  //
  // v1 simplification: speed restored at the start of EACH combatant's
  // turn (not just the caster's) — same simplification as Ray of Frost.
  // Does NOT stack with Ray of Frost (separate scratch fields, but both
  // reduce speed — they'd compose as two -10 reductions, which is
  // acceptable for v1).
  'Lance of Lethargy': {
    name: 'Lance of Lethargy',
    description: 'When you hit a creature with Eldritch Blast, you can reduce the creature\'s speed by 10 feet until the beginning of your next turn.',
    onEldritchBlastHit: (attacker, target, state) => {
      const SPEED_REDUCTION = 10;
      // Store original speed if not already stored (prevents double-store
      // on multi-hit or multi-caster scenarios — mirror Ray of Frost).
      if (target._lanceOfLethargyOriginalSpeed === undefined) {
        target._lanceOfLethargyOriginalSpeed = target.speed;
      }
      const speedBefore = target.speed;
      target.speed = Math.max(0, target.speed - SPEED_REDUCTION);
      target._hasLanceOfLethargy = true;
      state.log.events.push({
        round: state.battlefield.round ?? 0,
        actorId: attacker.id,
        type: 'action',
        targetId: target.id,
        description: `${target.name} is slowed by Lance of Lethargy! Speed: ${speedBefore}ft → ${target.speed}ft`,
      });
    },
  },

  // Future invocations can be added here:
  //   'Thirsting Blade' — two attacks with Pact Weapon (not an EB hook)
  //   'Eldritch Spear' — EB range 300 ft (metadata-only, no hook)
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
 * Fire the onEldritchBlastDamage hook for any invocations the attacker
 * has that respond to Eldritch Blast hits. Called from resolveAttack
 * AFTER the base damage roll, BEFORE applyDamageWithTempHP.
 *
 * Returns the total bonus damage to add (sum of all matching invocations'
 * onEldritchBlastDamage return values). Currently only Agonizing Blast
 * uses this hook.
 *
 * The caller is responsible for adding the returned value to `dmg` and
 * logging the bonus. The bonus is NOT doubled on crit (PHB p.196: crit
 * doubles damage dice, not flat modifiers).
 */
export function fireEldritchBlastDamageInvocations(
  attacker: Combatant,
  target: Combatant,
): number {
  if (!attacker.eldritchInvocations) return 0;
  let total = 0;
  for (const invName of attacker.eldritchInvocations) {
    const inv = ELDRITCH_INVOCATIONS[invName];
    if (inv?.onEldritchBlastDamage) {
      total += inv.onEldritchBlastDamage(attacker, target);
    }
  }
  return total;
}

/**
 * Fire the onEldritchBlastHit hook for any invocations the attacker
 * has that respond to Eldritch Blast hits. Called from resolveAttack
 * after damage is dealt, before checkDeath.
 *
 * Repelling Blast (push), Grasp of Hadar (pull), and Lance of Lethargy
 * (slow) all use this hook. They fire in registry order (the order the
 * invocations appear in the attacker's eldritchInvocations list).
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
