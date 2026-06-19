// ============================================================
// Create Bonfire — XGE p.152 (reprinted from EEPC p.16)
// Level 0 conjuration cantrip
//
// Casting time: action
// Range: 60 ft (the bonfire is created at a target point within
//   range — NOT caster-centered)
// Components: V + S (no material)
// Duration: Concentration, up to 1 minute
// Effect: You create a bonfire on ground that you can see within
//   range. Until the spell ends, the magic bonfire fills a
//   5-foot cube. Any creature in the bonfire's space when you
//   cast the spell must succeed on a Dexterity saving throw or
//   take 1d8 fire damage. A creature must also make the saving
//   throw when it moves into the bonfire's space for the first
//   time on a turn or ends its turn there.
//   The bonfire ignites flammable objects in its area that
//   aren't being worn or carried.
//
// Scaling: +1d8 at 5th level (2d8), 11th (3d8), 17th (4d8).
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — on-cast damage only,
// persistent triggers documented as TODO):
// ────────────────────────────────────────────────────────────
// Create Bonfire is the FIRST persistent ground hazard cantrip
// in the codebase. Canonically it has THREE damage triggers:
//
//   (1) ON-CAST: any creature in the bonfire's space when the
//       spell is cast makes a DEX save (1d8 fire on fail / half
//       on success).
//   (2) MOVE-INTO: a creature that moves into the space for the
//       first time on a turn makes the save.
//   (3) END-TURN: a creature that ends its turn in the space
//       makes the save.
//
// v1 implements ONLY trigger (1) — the on-cast damage. This is
// the simplest case and the only one that fits the existing
// resolveAttack save-branch flow without engine changes.
//
// Triggers (2) and (3) require a NEW subsystem: persistent
// ground hazards (similar to the activeEffects system on
// Combatant, but for ground tiles). The subsystem would need:
//   - A registry of active hazards on the battlefield (position,
//     size, damage dice, damage type, save ability, save DC,
//     caster ID, expiration round).
//   - A hook in executeMove (for trigger 2): check if the mover
//     enters a hazard's space for the first time on the turn.
//   - A hook in end-of-turn processing (for trigger 3): check
//     if the combatant ends its turn in a hazard's space.
//   - Concentration tracking: hazards maintained by concentration
//     end when the caster's concentration breaks.
//   - A cleanup pass at end of combat / when the spell expires.
//
// This is a substantial engine change — out of scope for this
// batch. v1 documents the simplification via the metadata flag
// `bonfirePersistentV1Implemented: false`. A future batch can
// implement the persistent-hazard subsystem and update this
// module to register the bonfire as a hazard.
//
// Routing (per zHANDOVER-SESSION-9):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Create Bonfire's Action and a primary target (the target
//     point — represented as a combatant in the target's space
//     for v1; future batches can add a "target point" plan type).
//   - executePlannedAction's `case 'cast':` falls through to
//     resolveAttack (Create Bonfire is NOT in any cantrip
//     registry — it's a single-target save cantrip for v1).
//   - resolveAttack's save branch rolls the save, applies 1d8
//     fire damage on save-FAIL / half on success, and calls
//     applyCantripEffect (post-save-FAIL dispatcher) — which is
//     a NO-OP for Create Bonfire (no rider registered). The
//     damage IS the effect; there's no separate rider.
//
//   - NO CANTRIP_EFFECTS entry (no post-save-FAIL rider — the
//     damage is handled by resolveAttack's save branch).
//   - NO CANTRIP_SELF_EFFECTS entry (not a self-buff).
//   - NO CANTRIP_AOE_EFFECTS entry (not a caster-centered AoE —
//     the bonfire is created at a target point within 60 ft,
//     not centered on the caster; v1 only damages creatures in
//     the target's space at cast time, mirroring a single-target
//     save cantrip).
//   - This module provides `metadata` only — the AI/parser uses
//     metadata to build an Action with attackType='save',
//     saveDC = caster's spell save DC, saveAbility='dex',
//     damage = { count: 1, sides: 8, bonus: 0, average: 4 }
//     (scales with level).
//
// Concentration: Create Bonfire requires concentration (XGE p.152
// "Duration: Concentration, up to 1 minute"). v1 sets the
// `requiresConcentration: true` flag on the Action so the
// concentration system tracks it. The persistent hazard (if
// implemented in a future batch) would end when concentration
// breaks via removeEffectsFromCaster. v1 does NOT track a
// persistent effect — the on-cast damage is instant and doesn't
// need concentration tracking for the v1 trigger (1). The
// concentration flag is set for forward-compatibility with the
// future persistent-hazard subsystem.
//
// The "ignites flammable objects" clause is a narrative/flavor
// rider that has no mechanical effect on creatures and is
// therefore not modeled.
// ============================================================

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Create Bonfire',
  level: 0,
  school: 'conjuration',
  /** Range: 60 ft (XGE p.152: "on ground that you can see within range"). */
  rangeFt: 60,
  /**
   * Concentration required (XGE p.152: "Duration: Concentration,
   * up to 1 minute"). v1 sets this flag for forward-compatibility
   * with the future persistent-hazard subsystem. The on-cast
   * damage (v1's only implemented trigger) doesn't need
   * concentration tracking, but the persistent triggers (2)/(3)
   * would — and those would end when concentration breaks.
   */
  concentration: true as const,
  castingTime: 'action',
  damageDice: '1d8',
  damageType: 'fire',
  saveAbility: 'dex' as const,
  /** Scales at levels 5/11/17 (XGE p.152). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d8', '3d8', '4d8'] as const,
  /** Components: V + S (no M). */
  components: { v: true, s: true, m: false } as const,
  /**
   * v1 simplification flag: Create Bonfire canonically has THREE
   * damage triggers — (1) on-cast, (2) move-into, (3) end-turn.
   * v1 implements ONLY trigger (1) (on-cast damage via
   * resolveAttack's save branch). Triggers (2) and (3) require a
   * persistent ground-hazard subsystem that doesn't exist yet.
   * See header for the full design.
   */
  bonfirePersistentV1Implemented: false as const,
  /**
   * Size of the bonfire's space in feet (XGE p.152: "fills a
   * 5-foot cube"). v1 treats the bonfire as a single-target save
   * (the creature in the target's space when the spell is cast).
   * The 5-ft-cube size is documented for forward-compatibility
   * with the future persistent-hazard subsystem.
   */
  bonfireSizeFt: 5 as const,
} as const;
