// ============================================================
// Mount System (Phase 5.4 — PHB p.198)
//
// PHB rules for controlled mounts:
// - Rider mounts → mount becomes "controlled"
// - Controlled mount's initiative moves to match rider's
// - On rider's turn: rider uses mount's movement pool (up to mount speed)
//   PLUS their own speed (but only one speed type at a time — takes the mount's)
// - Controlled mount CAN: Dash, Disengage, Dodge (on its own turn, which
//   it takes immediately before or after rider per DM ruling)
// - Controlled mount CANNOT: attack on a turn where it was ridden
//   (rider takes all attack actions)
// - If mount drops to 0 HP: rider must make DC 10 DEX save or fall prone
// ============================================================

import { Combatant, Battlefield, AIProfile } from '../types/core';
import { rollDie, abilityMod, applyDamage, addCondition } from '../engine/utils';

// ---- Mount / Dismount ---------------------------------------

/**
 * Mount a creature. Sets up the rider ↔ mount link.
 * Both combatants must be on the same or adjacent square.
 * Does not move them — caller ensures positioning.
 */
export function mountCreature(rider: Combatant, mount: Combatant): void {
  if (mount.carriedBy !== null) {
    throw new Error(`${mount.name} is already carrying ${mount.carriedBy}`);
  }
  if (rider.mountedOn !== null) {
    throw new Error(`${rider.name} is already mounted on ${rider.mountedOn}`);
  }
  rider.mountedOn  = mount.id;
  mount.carriedBy  = rider.id;

  // Rider moves to mount's position (same square)
  rider.pos = { ...mount.pos };
}

/**
 * Dismount a rider. Rider is placed in an adjacent unoccupied square
 * (caller should validate/reposition if needed).
 */
export function dismountCreature(rider: Combatant, mount: Combatant): void {
  rider.mountedOn = null;
  mount.carriedBy = null;
}

// ---- Movement pool ------------------------------------------

/**
 * Get the effective movement available to a rider this turn.
 * PHB: rider uses mount's speed (replaces their own speed).
 * The mount's budget.movementFt is what the rider draws from.
 */
export function riderMovementFt(rider: Combatant, mount: Combatant): number {
  // Rider can use mount's remaining movement, but not their own ground speed
  return mount.budget.movementFt;
}

/**
 * Spend movement from the mount's pool on behalf of the rider.
 * Returns feet actually spent (capped at available).
 */
export function spendMountMovement(mount: Combatant, feet: number): number {
  const actual = Math.min(mount.budget.movementFt, feet);
  mount.budget.movementFt -= actual;
  // Rider moves with the mount — caller updates rider.pos to match mount.pos
  return actual;
}

// ---- Mount death check (PHB p.198) -------------------------

/**
 * When a controlled mount drops to 0 HP, the rider must make DC 10 DEX save
 * or fall Prone in the space the mount occupied.
 * Returns: 'safe' | 'prone'
 */
export function mountDeathRiderCheck(rider: Combatant): 'safe' | 'prone' {
  const dexMod = abilityMod(rider.dex);
  const roll   = rollDie(20) + dexMod;
  if (roll >= 10) return 'safe';
  addCondition(rider, 'prone');
  return 'prone';
}

// ---- Engine hook: isControlledMount -------------------------

/**
 * Returns true if this combatant is currently acting as a controlled mount.
 * Controlled mounts skip their own Action and Bonus Action on their turn;
 * their movement is consumed by the rider.
 */
export function isControlledMount(c: Combatant): boolean {
  return c.carriedBy !== null;
}

// ---- Initiative sync ----------------------------------------

/**
 * When a rider mounts, the mount's initiative is moved to directly follow
 * the rider in the order (PHB p.198: "it moves when you do").
 * Mutates the initiativeOrder array on the battlefield.
 */
export function syncMountInitiative(
  battlefield: Battlefield,
  riderId: string,
  mountId: string
): void {
  const order = battlefield.initiativeOrder;
  const mountIdx = order.indexOf(mountId);
  if (mountIdx !== -1) order.splice(mountIdx, 1); // remove mount from current slot
  const riderIdx = order.indexOf(riderId);
  if (riderIdx !== -1) order.splice(riderIdx + 1, 0, mountId); // insert after rider
}

// ---- Scenario helper: mount a summon on a PC ---------------

/**
 * Full setup: mount a summon (e.g. Giant Fly) for a specific PC,
 * sync initiative, and transfer movement pool.
 * Call this before combat starts.
 */
export function setupMount(
  rider: Combatant,
  mount: Combatant,
  battlefield: Battlefield
): void {
  mountCreature(rider, mount);
  syncMountInitiative(battlefield, rider.id, mount.id);
  // Give rider access to mount's fly speed
  // The engine will use mount.budget.movementFt for the rider's movement
}

// ---- Mount control mode (PHB p.198) -------------------------

/**
 * Set whether a mount acts independently or is controlled by the rider.
 *
 * CONTROLLED (default, independentMount=false):
 *   - Mount can ONLY: Dash, Disengage, or Dodge on its turn
 *   - Rider effectively gets free movement (mount Dashes) or free Disengage
 *   - Mount movement pool is shared with rider
 *   - Mount cannot attack
 *
 * INDEPENDENT (independentMount=true):
 *   - Mount acts on its own initiative slot
 *   - Mount can attack, cast spells, use any of its actions
 *   - Mount movement is its own (rider still moves with it physically)
 *   - Requires rider to explicitly grant independence (trained war animal)
 *
 * PHB p.198: "A controlled mount can take only the Dash, Disengage,
 * or Dodge action."
 */
export function setMountMode(mount: Combatant, independent: boolean): void {
  mount.independentMount = independent;
}

/** True if this mount acts on its own turn (attacks, full actions). */
export function isIndependentMount(mount: Combatant): boolean {
  return mount.carriedBy !== null && mount.independentMount === true;
}

/**
 * Grant a mount independence — it will act on its own initiative.
 * Use for trained war mounts (Warhorse, Giant Eagle, Hippogriff).
 */
export function grantIndependence(mount: Combatant): void {
  setMountMode(mount, true);
}

/**
 * Return a mount to controlled mode (Dash/Disengage/Dodge only).
 * This is the DEFAULT for all mounts.
 */
export function controlMount(mount: Combatant): void {
  setMountMode(mount, false);
}

