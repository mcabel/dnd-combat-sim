// ============================================================
// src/engine/lair_action_metadata.ts — Lair-action bespoke-spell dispatch
//
// Session 113 (RFC: docs/RFC-LAIR-ACTION-BESPOKE-DISPATCH.md)
//
// PURPOSE
// =======
// This file is the SINGLE SOURCE OF TRUTH for:
//   1. The `lairActionMetadata` object — feature flags for lair-action
//      bespoke dispatch (asserted by tests so future agents can verify
//      the feature is present).
//   2. The `LAIR_BESPOKE_SPELL_META` map — per-spell metadata for the
//      lair-action bespoke dispatcher (`dispatchBespokeLairSpell` in
//      `src/engine/combat.ts`). Each entry captures:
//        - canonicalName: Title Case spell name (matches the bespoke
//          module's `actions.find(a => a.name === X)` lookup)
//        - planType: the combat.ts case-branch name (matches
//          `monster_bespoke_registry.ts` planType)
//        - signature: the bespoke execute() signature shape
//          ('aoe' = execute(caster, targets[], state)
//           'single' = execute(caster, target, state)
//           'self' = execute(caster, _self, state))
//        - concentrationMode: Q1 lair-action concentration categorization
//          ('normal' = creature casts, concentration applies normally
//           'suppress' = hazard-like / duration-replacement / explicit
//                        exception → do NOT start concentration; apply
//                        lair-duration override instead)
//        - lairDurationRounds?: for 'suppress' mode, the lair-specific
//          duration in rounds (undefined = use spell's normal duration)
//
// WHY A SEPARATE FILE (not inline in combat.ts)
// =============================================
// Per user Q-ack-5 directive (S113): "new file but make sure it will be
// referenced or remembered by future agents if needed." A separate file:
//   - Makes the metadata easy to find (future agents search for
//     "lair_action" or "lairAction" and find this file immediately)
//   - Keeps combat.ts focused on dispatch logic, not data tables
//   - Allows the metadata to grow (12 more spells in S114+) without
//     bloating combat.ts
//   - The cross-ref is bidirectional: this file documents where it's
//     used (combat.ts), and combat.ts imports from here with a comment
//
// HOW TO ADD A NEW SPELL (S114+ expansion)
// ========================================
// 1. Verify the spell has a bespoke module in src/spells/<name>.ts
//    (if not, implement the module first — out of scope for this dispatch)
// 2. Determine the signature shape by reading the module's execute():
//    - execute(caster, targets: Combatant[], state) → 'aoe'
//    - execute(caster, target: Combatant, state)   → 'single'
//    - execute(caster, _self: Combatant, state)    → 'self'
//    - execute(caster, state)  [no target; shouldCast returns boolean] → 'cast'
// 3. Determine the concentrationMode per the Q1 lair-action rules:
//    - Read the lair action's raw text in bestiaryData/legendarygroups.json
//    - Category A normal ("casts the spell", spell is concentration,
//      no exception) → 'normal'
//    - Category A exception ("doesn't need to concentrate") → 'suppress'
//    - Category A duration-replacement ("lasts until X" → concentration
//      removed per user clarification) → 'suppress' + lairDurationRounds
//    - Category B hazard-like ("as though it had cast", "identical to
//      the spell", "fills the space") → 'suppress' + lairDurationRounds
// 4. If the SAME spell appears in multiple creatures' lair actions with
//    DIFFERENT concentration semantics (e.g., darkness: Demogorgon suppress
//    vs Morkoth normal), add a `creatureOverride` keyed by the legendary
//    group name (the lair action's `sourceCreature` field). The override's
//    `concentrationMode` / `lairDurationRounds` take precedence over the
//    entry defaults for that creature only. (S115+ feature.)
// 5. Add an entry to LAIR_BESPOKE_SPELL_META keyed by lowercase spell name
// 6. Add a case to `callExecuteByPlanType` in combat.ts for the new planType
// 7. Add a case to `dispatchBespokeLairSpell`'s shouldCast switch in combat.ts
// 8. Add tests to src/test/session113_lair_bespoke_dispatch.test.ts
//    (or a new sessionNNN test file for a later batch)
//
// CROSS-REFERENCES
// ================
// - Used by: src/engine/combat.ts::dispatchBespokeLairSpell
// - Tested by: src/test/session113_lair_bespoke_dispatch.test.ts
// - RFC: docs/RFC-LAIR-ACTION-BESPOKE-DISPATCH.md
// - Handover: zHANDOVER-SESSION-113.md
// - TEAMGOALS.md: "RFC-LAIR-ACTION-BESPOKE-DISPATCH (Session 113 proposal)"
// ============================================================

import { Combatant, Action, LairAction } from '../types/core';

// ---- Metadata flag (asserted by tests) ----------------------

/**
 * Feature-flag object for lair-action bespoke dispatch.
 *
 * `lairActionBespokeDispatchV1Implemented: true` — the S113 pilot is live.
 * `handleLairCastSpell` in combat.ts now tries GENERIC_SPELLS first, then
 * `LAIR_BESPOKE_SPELL_META` (this file), then logs the updated skip message.
 *
 * Pilot coverage (S113): Fireball, Banishment, Fog Cloud (3 of 15 spells).
 * Expansion coverage (S114): cloud of daggers, command, lightning bolt,
 * moonbeam, phantasmal force, power word kill, sleet storm, spike growth,
 * wall of force (9 more → 12 of 15).
 * Expansion coverage (S115): darkness with per-creature concentration
 * override (Demogorgon: suppress; Morkoth: normal) + giant insect with 4th
 * signature type 'cast' (Arasta: suppress, no fixed duration) + simulacrum
 * forward-compat (Fraz-Urb'luu: suppress, 1-round lair duration; log + flag
 * only — real duplicate-combatant subsystem deferred) → 15 of 15.
 * All 15 bespoke-only spells now dispatch (RFC goal achieved). Note: lesser
 * restoration is a parser mis-tag (see RFC §2.3); antimagic field is Q2 skip.
 */
export const lairActionMetadata = {
  // Session 113: lair-action cast_spell now dispatches to bespoke spell
  // modules (not just GENERIC_SPELLS). Pilot: Fireball, Banishment, Fog Cloud.
  // See docs/RFC-LAIR-ACTION-BESPOKE-DISPATCH.md for the full design.
  lairActionBespokeDispatchV1Implemented: true,
  // Session 115: per-creature concentration override (darkness) + 4th
  // signature type 'cast' (giant insect) + simulacrum forward-compat.
  // 15 of 15 bespoke-only spells now dispatch (RFC goal achieved).
  lairActionBespokeDispatchV2FullCoverage: true,
};

// ---- Types --------------------------------------------------

/**
 * The execute() signature shape for a bespoke spell module.
 * - 'aoe':    execute(caster, targets: Combatant[], state)
 * - 'single': execute(caster, target: Combatant, state)
 * - 'self':   execute(caster, _self: Combatant, state)  (target ignored)
 * - 'cast':   execute(caster, state)  (NO target param; shouldCast returns
 *             boolean instead of Combatant | null — S115+ for spells like
 *             Giant Insect that don't target anyone)
 */
export type BespokeSignature = 'aoe' | 'single' | 'self' | 'cast';

/**
 * Q1 lair-action concentration categorization.
 * - 'normal':   creature casts the spell, concentration applies normally.
 *               The bespoke execute() will call startConcentration() which
 *               proceeds as usual.
 * - 'suppress': hazard-like / duration-replacement / explicit exception.
 *               The dispatcher sets `caster.suppressConcentration = true`
 *               before calling execute() so startConcentration() becomes
 *               a no-op. The dispatcher then post-processes the created
 *               effect(s) to set sourceIsConcentration = false and
 *               sourceTurnExpires = bf.round + lairDurationRounds - 1.
 */
export type ConcentrationMode = 'normal' | 'suppress';

/**
 * Per-spell metadata for the lair-action bespoke dispatcher.
 */
export interface LairBespokeSpellMeta {
  /** Title Case spell name (matches bespoke module's action.name lookup) */
  canonicalName: string;
  /** combat.ts case-branch plan type (matches monster_bespoke_registry.ts) */
  planType: string;
  /** execute() signature shape — determines how the dispatcher calls execute */
  signature: BespokeSignature;
  /** Q1 concentration categorization — determines concentration handling */
  concentrationMode: ConcentrationMode;
  /**
   * For 'suppress' mode: the lair-specific duration in rounds.
   * undefined = use the spell's normal duration (only valid for 'normal' mode).
   * The dispatcher sets sourceTurnExpires = bf.round + lairDurationRounds - 1
   * on the created effect(s) so they auto-expire via reevaluateEffects.
   */
  lairDurationRounds?: number;
  /**
   * Per-creature overrides (S115+). Keyed by the lair action's `sourceCreature`
   * (the legendary group name, e.g., 'Demogorgon'). When the lair-action
   * dispatcher looks up the meta, it checks for a creature-specific override
   * first; if present, the override's fields take precedence over the defaults.
   *
   * Use case: spells like 'darkness' where Demogorgon's lair action is a
   * Category A explicit exception ("doesn't need to concentrate") while
   * Morkoth's is Category A normal (concentration applies). Both lair actions
   * cast 'darkness' but with different concentration handling.
   *
   * Only `concentrationMode` and `lairDurationRounds` can be overridden — the
   * spell's `canonicalName`/`planType`/`signature` are module-intrinsic and
   * don't vary by creature.
   *
   * S116+: `lairMultiCast` (optional) — for lair actions that cast the same
   * spell multiple times (e.g., Demogorgon "casts the darkness spell four
   * times, targeting different areas"). When > 1, the dispatcher calls the
   * spell's lair-specific multi-cast execute (e.g., `executeLairDarkness`)
   * instead of the single-cast `callExecuteByPlanType` path. Currently only
   * meaningful for obstacle-creating spells (darkness); other spell types
   * would need a dedicated multi-cast execute to use this field.
   */
  creatureOverride?: Record<string, {
    concentrationMode?: ConcentrationMode;
    lairDurationRounds?: number;
    lairMultiCast?: number;
  }>;
}

// ---- Per-spell metadata table (pilot + S114 expansion) -------

/**
 * Per-spell metadata for the lair-action bespoke dispatcher.
 *
 * Keyed by LOWERCASE spell name (the bestiary stores spell names in
 * lowercase; the dispatcher normalizes via toLowerCase() before lookup).
 *
 * S113 pilot: 3 spells (fireball, banishment, fog cloud) — all 3 signature
 * shapes + both concentration categories.
 * S114 batch 1: 4 single-target Category A spells (cloud of daggers, moonbeam,
 * phantasmal force, power word kill).
 * S114 batch 2+: remaining 8 spells (see RFC §6 for the full list).
 */
export const LAIR_BESPOKE_SPELL_META: Map<string, LairBespokeSpellMeta> = new Map([
  // ── Pilot batch (S113) ──────────────────────────────────────────
  ['fireball', {
    canonicalName: 'Fireball',
    planType: 'fireball',
    signature: 'aoe',
    concentrationMode: 'normal',  // Fireball is not concentration; 'normal' is fine
  }],
  ['banishment', {
    canonicalName: 'Banishment',
    planType: 'banishment',
    signature: 'single',
    concentrationMode: 'normal',  // Category A normal: Geryon casts, concentration applies
  }],
  ['fog cloud', {
    canonicalName: 'Fog Cloud',
    planType: 'fogCloud',
    signature: 'self',
    concentrationMode: 'suppress',  // Category B hazard: Bronze Dragon lair creates fog
    lairDurationRounds: 1,          // "until initiative count 20 on the next round" = 1 round
  }],
  // ── S114 batch 1: 4 single-target Category A spells ────────────
  ['cloud of daggers', {
    canonicalName: 'Cloud of Daggers',
    planType: 'cloudOfDaggers',
    signature: 'single',
    concentrationMode: 'normal',  // Category A normal: Kyrilla casts, concentration confirmed by lair text
  }],
  ['moonbeam', {
    canonicalName: 'Moonbeam',
    planType: 'moonbeam',
    signature: 'single',
    concentrationMode: 'normal',  // Category A normal: Kyrilla casts, concentration confirmed by lair text
  }],
  ['phantasmal force', {
    canonicalName: 'Phantasmal Force',
    planType: 'phantasmalForce',
    signature: 'single',
    concentrationMode: 'normal',  // Category A normal: Aboleth casts, concentration confirmed by lair text
  }],
  ['power word kill', {
    canonicalName: 'Power Word Kill',
    planType: 'powerWordKill',
    signature: 'single',
    concentrationMode: 'normal',  // Not concentration (instantaneous); 'normal' is fine
  }],
  // ── S114 batch 2: 3 more spells (darkness deferred — per-creature override needed) ──
  ['command', {
    canonicalName: 'Command',
    planType: 'command',
    signature: 'single',
    concentrationMode: 'normal',  // Not concentration (1 round, no conc); Category A normal
  }],
  ['sleet storm', {
    canonicalName: 'Sleet Storm',
    planType: 'sleetStorm',
    signature: 'aoe',
    concentrationMode: 'suppress',  // Category B hazard: "This effect is identical to the spell"
    lairDurationRounds: 1,          // Implicit 1-round lair duration (initiative count 20 next round)
  }],
  ['spike growth', {
    canonicalName: 'Spike Growth',
    planType: 'spikeGrowth',
    signature: 'single',            // shouldCast returns the center-point target
    concentrationMode: 'suppress',  // Category B hazard: "The effect is otherwise identical to the spell"
    // lairDurationRounds undefined: "lasts until the dragon uses this lair action again or until
    // the dragon dies" — no fixed round count. Effect persists until caster death (removeEffectsFromCaster).
    // The "uses this lair action again" cleanup would need a separate mechanism (out of scope for S114).
  }],
  // ── S114 batch 3: 2 more spells (giant insect + simulacrum deferred — non-standard signatures) ──
  ['lightning bolt', {
    canonicalName: 'Lightning Bolt',
    planType: 'lightningBolt',
    signature: 'aoe',
    concentrationMode: 'normal',  // Not concentration (instantaneous); Category A normal
  }],
  ['wall of force', {
    canonicalName: 'Wall of Force',
    planType: 'wallOfForce',
    signature: 'single',
    concentrationMode: 'normal',  // Category A normal: Elder Brain casts, concentration applies
  }],
  // ── S115: darkness — per-creature concentration override ───────
  // Darkness is a special case: the same spell appears in two lair actions
  // with DIFFERENT concentration semantics.
  //   - Morkoth (MPMM::0): "casts darkness... without expending a spell slot"
  //     → Category A normal (concentration applies; Morkoth concentrates).
  //   - Demogorgon (MPMM::0 / MTF::1): "casts the darkness spell four times...
  //     Demogorgon doesn't need to concentrate on the spells, which end on
  //     initiative count 20 of the next round."
  //     → Category A explicit exception (suppress concentration) + 1-round
  //       lair duration override.
  // The default mode is 'normal' (Morkoth). The `creatureOverride` flips
  // Demogorgon's entry to 'suppress' with a 1-round lair duration.
  //
  // S116: Demogorgon's "casts four times, targeting different areas" is now
  //   modelled via `lairMultiCast: 4` → the dispatcher calls
  //   `executeLairDarkness(caster, state, 4)` which creates 4 darkness
  //   obstacles at distinct offset points (N/E/S/W at 30 ft). The v1
  //   simplification note about "casts once" is now resolved. The Morkoth
  //   "choice of darkness/dispel magic/misty step" simplification remains
  //   (parser tags spellName='darkness' as the first option; a future session
  //   could implement the tactical choice — may need a parser change).
  ['darkness', {
    canonicalName: 'Darkness',
    planType: 'darkness',
    signature: 'self',             // shouldCast returns the caster; execute ignores target
    concentrationMode: 'normal',   // Default: Morkoth casts normally (concentration applies)
    creatureOverride: {
      'Demogorgon': {
        concentrationMode: 'suppress',  // "doesn't need to concentrate"
        lairDurationRounds: 1,          // "end on initiative count 20 of the next round"
        lairMultiCast: 4,               // S116: "casts the darkness spell four times"
      },
    },
  }],
  // ── S115: giant insect — 4th signature type 'cast' ────────────
  // Arasta (MOT::1): "Arasta casts the giant insect spell (spiders only).
  // It lasts until she uses this lair action again or until she dies."
  // → Category A duration-replacement → concentrationMode = 'suppress'.
  //   No fixed lair duration (lasts until lair action used again or death —
  //   similar to spike growth). The "spiders only" variant is a v1
  //   simplification: the spell's execute() just sets a forward-compat flag
  //   (_genericSpellActiveSpells); the actual summoning is NOT modelled.
  //   signature = 'cast' (4th type): execute(caster, state) with NO target
  //   param, shouldCast returns boolean (not Combatant | null).
  ['giant insect', {
    canonicalName: 'Giant Insect',
    planType: 'giantInsect',
    signature: 'cast',             // 4th signature type: execute(caster, state), shouldCast → boolean
    concentrationMode: 'suppress', // Category A duration-replacement: "lasts until she uses this lair action again or until she dies"
    // lairDurationRounds undefined: no fixed round count. The forward-compat
    // flag persists until caster death (removeEffectsFromCaster) or a future
    // "uses this lair action again" cleanup mechanism (out of scope for S115).
  }],
  // ── S115: simulacrum — forward-compat (Fraz-Urb'luu::2) ────────
  // Fraz-Urb'luu (MPMM::2): "Fraz-Urb'luu chooses one Humanoid within the
  // lair and instantly creates a simulacrum of that creature (as if created
  // with the simulacrum spell). This simulacrum obeys Fraz-Urb'luu's commands
  // and is destroyed on the next initiative count 20."
  // → Category B hazard-like ("as if created with the simulacrum spell") →
  //   concentrationMode = 'suppress', lairDurationRounds = 1 (destroyed on
  //   next initiative count 20).
  // signature = 'single' (targets one humanoid; shouldCastLair returns the
  //   target Combatant). The dispatcher calls shouldCastLairSimulacrum +
  //   executeLairSimulacrum (NOT the regular shouldCast/execute stubs which
  //   stay null/no-op for the player spell system — simulacrum has a 12-hour
  //   cast time and is out-of-combat for players).
  // v1 forward-compat: executeLair logs the simulacrum creation + sets a
  //   flag on _genericSpellActiveSpells. The actual duplicate combatant
  //   (half-HP clone with the target's stats, joining the caster's faction,
  //   removed at next initiative count 20) is NOT spawned — that requires a
  //   creature-duplication subsystem. A future session should implement the
  //   real duplicate creation + the 1-round lair-duration cleanup.
  ['simulacrum', {
    canonicalName: 'Simulacrum',
    planType: 'simulacrum',
    signature: 'single',           // shouldCastLair returns the humanoid target; executeLair takes (caster, target, state)
    concentrationMode: 'suppress', // Category B hazard: "as if created with the simulacrum spell"
    lairDurationRounds: 1,         // "destroyed on the next initiative count 20"
  }],
  // ── Future expansion (S116+) ────────────────────────────────────
  // antimagic field (Demilich) — Q2: skip (no module). Future: implement antimagic_field.ts first.
  // lesser restoration (Fazrian) — PARSER MIS-TAG, do NOT add (see RFC §2.3)
  // simulacrum full implementation: spawn a real half-HP duplicate combatant
  //   (currently forward-compat log + flag only — see simulacrum.ts executeLair).
]);
