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
// 3. Determine the concentrationMode per the Q1 lair-action rules:
//    - Read the lair action's raw text in bestiaryData/legendarygroups.json
//    - Category A normal ("casts the spell", spell is concentration,
//      no exception) → 'normal'
//    - Category A exception ("doesn't need to concentrate") → 'suppress'
//    - Category A duration-replacement ("lasts until X" → concentration
//      removed per user clarification) → 'suppress' + lairDurationRounds
//    - Category B hazard-like ("as though it had cast", "identical to
//      the spell", "fills the space") → 'suppress' + lairDurationRounds
// 4. Add an entry to LAIR_BESPOKE_SPELL_META keyed by lowercase spell name
// 5. Add a case to `callExecuteByPlanType` in combat.ts for the new planType
// 6. Add tests to src/test/session113_lair_bespoke_dispatch.test.ts
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
 * Full coverage (S114+): the remaining 12 spells (cloud of daggers, command,
 * darkness, lightning bolt, moonbeam, phantasmal force, power word kill,
 * simulacrum, sleet storm, spike growth, wall of force, lesser restoration
 * — note: lesser restoration is a parser mis-tag, see RFC §2.3).
 */
export const lairActionMetadata = {
  // Session 113: lair-action cast_spell now dispatches to bespoke spell
  // modules (not just GENERIC_SPELLS). Pilot: Fireball, Banishment, Fog Cloud.
  // See docs/RFC-LAIR-ACTION-BESPOKE-DISPATCH.md for the full design.
  lairActionBespokeDispatchV1Implemented: true,
  // Future: lairActionBespokeDispatchV2FullCoverage (when all 15 spells routed)
};

// ---- Types --------------------------------------------------

/**
 * The execute() signature shape for a bespoke spell module.
 * - 'aoe':    execute(caster, targets: Combatant[], state)
 * - 'single': execute(caster, target: Combatant, state)
 * - 'self':   execute(caster, _self: Combatant, state)  (target ignored)
 */
export type BespokeSignature = 'aoe' | 'single' | 'self';

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
}

// ---- Per-spell metadata table (pilot: 3 spells) -------------

/**
 * Per-spell metadata for the lair-action bespoke dispatcher.
 *
 * Keyed by LOWERCASE spell name (the bestiary stores spell names in
 * lowercase; the dispatcher normalizes via toLowerCase() before lookup).
 *
 * S113 pilot: 3 spells covering all 3 signature shapes + both concentration
 * categories. S114+ will add the remaining 12 spells (see RFC §6 for the
 * full list).
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
  // ── Future expansion (S114+) ────────────────────────────────────
  // cloud of daggers (Kyrilla) — Category A normal, single-target, concentration
  // command (Graz'zt) — not concentration, single-target (multi-target per lair text but v1 single)
  // darkness (Demogorgon) — Category A explicit exception, self, suppress, 1 round
  // darkness (Morkoth) — Category A normal, self, concentration
  // giant insect (Arasta) — Category A duration-replacement, special (summon), suppress
  // lightning bolt (Githzerai Anarch) — not concentration, AoE line (v1: treat as aoe)
  // moonbeam (Kyrilla) — Category A normal, single-target, concentration
  // phantasmal force (Aboleth) — Category A normal, single-target, concentration
  // power word kill (Orcus) — not concentration, single-target
  // simulacrum (Fraz-Urb'luu) — Category B hazard, special (summon), suppress, 1 round
  // sleet storm (Yan-C-Bin) — Category B hazard, AoE, suppress, 1 round
  // spike growth (Copper Dragon) — Category B hazard, AoE, suppress, until dragon uses lair again/dies
  // wall of force (Elder Brain) — Category A normal, special (wall), concentration
  // lesser restoration (Fazrian) — PARSER MIS-TAG, do NOT add (see RFC §2.3)
  // antimagic field (Demilich) — Q2: skip (no module). Future: implement antimagic_field.ts first.
]);
