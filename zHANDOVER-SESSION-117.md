# HANDOVER-SESSION-117

## REPOSITORY

- Branch: main
- Commits this session:
  - `95941e7` — Session 117: dispatch-order flip audit (S116 next-action #6, LOW)
  - `a62dad3` — Session 117: darkness Demogorgon tactical placement v2 (S116 next-action #3, LOW-MEDIUM)
  - `bc5c752` — Session 117: giant insect Arasta despawn-on-reuse v2 (S116 next-action #2, MEDIUM)
- Previous: `15001a2` (S116 handover, 9/9 ALL GREEN verified at S117 session start via GitHub API)
- State: clean (3 impl commits pushed; S115 handover archived to HandoverOld/; S117 handover commit pending — this file). CI will run on the handover commit after push.
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

Three implementation commits. Session started by verifying the S116 HEAD (`15001a2`) CI was **9/9 ALL GREEN** (confirmed at session start via GitHub API — both the Test Suite + Pages build workflows reported `success`; no red X carried over from S116). The user directed "Work autonomously to finish all possible tasks" — so the session executed the S116 handover's next-actions list autonomously, picking the tasks rated LOW to MEDIUM (the HIGH-risk #1 simulacrum + #4 antimagic_field are explicitly "out of scope for an autonomous session without a dedicated RFC" per the S116 handover, and #5 lairActionSpellMode parser flag is deferred until the per-spell table grows beyond ~20 entries — currently 15):

1. **#6 dispatch-order flip audit (LOW)** — DONE. The S116 flip (bespoke meta checked before generic registry in `handleLairCastSpell`) is safe for the current 15 bespoke spells, but a future agent adding a bespoke entry that's ALSO in GENERIC_SPELLS should verify the bespoke execute is the preferred one for that spell's lair action. S117 adds the audit guidance in two places: `lair_action_metadata.ts` §"HOW TO ADD A NEW SPELL" step 1b (full guidance + the Giant Insect precedent), and a cross-reference comment in `handleLairCastSpell` (combat.ts ~L8412). Comment-only, zero behavior change.

2. **#3 darkness v2 — Demogorgon tactical placement (LOW-MEDIUM)** — DONE. S116 placed the 4 obstacles at FIXED offset points (N/E/S/W at 30 ft). Canon allows Demogorgon to choose any points within the 60-ft range ("targeting different areas"). S117 v2 places obstacles TACTICALLY on enemy clusters first (nearest enemies first — blinds them), then fills remaining slots with the fixed offset fallback points. Falls back to pure offset placement (S116 v1 behavior) when no enemies are in range.

3. **#2 giant insect v2 — despawn-on-reuse (MEDIUM, the feasible sub-part)** — DONE. S116 summoned 3 giant spiders but used the `_genericSpellActiveSpells` flag to gate re-cast (`shouldCastGiantInsect` returns false while flag set), so the lair action only fired ONCE. Canon: "lasts until she uses this lair action again or until she dies" — when Arasta re-uses the lair action, the old spiders should vanish + new ones appear. S117 v2 adds a lair-specific `shouldCastLairGiantInsect` (no flag check — re-fires each round) + despawn logic in `executeLair` (despawns existing giant-insect spiders before summoning new ones).

The remaining sub-parts of #2 (Bite poison save DC 11 Con vs 2d8 + paralyzed-at-0-HP rider; Web recharge-5 restraint attack) were NOT attempted — they require extending the `Action` type for save-or-secondary-damage attacks + a restraint-condition subsystem (MEDIUM risk, sub-system work). The Morkoth "choice of darkness/dispel magic/misty step" sub-part of #3 was NOT attempted — it needs a parser change (MEDIUM risk, deferred per the S116 handover). The HIGH-risk #1 simulacrum full creature-duplication + #4 antimagic_field module remain out of scope.

### Task A — dispatch-order flip audit (commit `95941e7`)

**S116 next-action #6:** "a future agent adding a bespoke entry should verify the generic registry's execute isn't the preferred one for that spell's lair action. LOW risk (documentation/audit only)."

**Implementation:** Comment-only. Added step 1b to `lair_action_metadata.ts` §"HOW TO ADD A NEW SPELL": full guidance on the S116 dispatch-order flip (bespoke meta checked before generic registry in `handleLairCastSpell`), the Giant Insect precedent (the only spell currently in both registries — bespoke wins, which is the S116 improvement), and the future-agent checklist. Added a cross-reference comment in `handleLairCastSpell` (combat.ts ~L8412) pointing to the metadata step 1b + noting the S117 audit. No behavior change.

### Task B — darkness Demogorgon tactical placement v2 (commit `a62dad3`)

**S116 next-action #3 (Demogorgon tactical placement sub-part):** "v1 places the 4 obstacles at FIXED offset points (N/E/S/W at 30 ft). A future session could place them tactically on enemy clusters (canon allows choosing any points within range)."

**Implementation:** Rewrote `executeLairDarkness(caster, state, count=4)` in `src/spells/darkness.ts`:
- Added `enemiesWithinRangeFt(caster, bf, rangeFt)` helper: living enemies within range, sorted nearest-first (chebyshev distance in grid squares).
- New placement algorithm: (a) **tactical** — center one obstacle per enemy (nearest-first), up to `count`; each obstacle blinds the enemy at its center. Dedup by center coordinate (two enemies on the same square share one obstacle). (b) **fallback** — fill remaining slots with `LAIR_OFFSETS` (the S116 fixed offsets), deduplicated against tactical centers + earlier fallbacks so all `count` obstacles end up at DISTINCT positions.
- Edge case: an obstacle centered on an enemy within 15 ft (3 squares) of the caster also covers the caster (at the edge, since obstacles are 15-ft radius). Canon-accurate — Demogorgon has supernatural senses; the caster is never an obstacle's CENTER (tactical centers are enemy positions), so the caster is at most at an obstacle's edge.
- Multi-cast log appends `(N placed on enem[y|ies] — tactical, S117 v2)` when ≥1 obstacle was tactically placed. The §8h log assertion (`includes('casts Darkness 4 time')`) still passes — the tactical note is appended after the unchanged prefix.
- Added `darknessLairTacticalPlacementV2Implemented: true` metadata flag.
- Player-cast `execute` (1 self-centered obstacle, concentration, consumes a slot) is untouched. Morkoth's lair-action darkness (Category A normal, 1 cast, concentration applies) uses the regular `execute` path — untouched.

### Task C — giant insect Arasta despawn-on-reuse v2 (commit `bc5c752`)

**S116 next-action #2 (despawn-on-reuse sub-part):** "the 'lasts until lair action used again' despawn is NOT modelled (deferred). Currently the `_genericSpellActiveSpells` flag prevents re-cast (the lair action only summons once). A future session could implement the despawn-old-then-summon-new flow."

**Implementation:**
- `src/spells/giant_insect.ts`:
  - Added `shouldCastLairGiantInsect(caster, bf)`: lair-specific shouldCast that does NOT check the `_genericSpellActiveSpells` flag (re-fires each round when living enemies are present). Returns the caster if there's ≥1 living enemy; null otherwise (canon-accurate skip). The regular `shouldCast` (shared with the GENERIC_SPELLS registry for the player/monster spell path) is untouched — still gates on the flag + slot for regular casts.
  - `executeLair` now DESPAWNS existing giant-insect spiders (filtered by `summonerId === caster.id && summonSpellName === 'Giant Insect'`) BEFORE summoning new ones. Mirrors the `removeEffectsFromCaster` despawn pattern (spell_effects.ts:294–308) but targeted to Giant Insect summons only (not all the caster's summons — Arasta might have other summons in a future engine). Removes from `bf.combatants`, `bf.initiativeOrder`, `bf.pendingCommands`, `bf.pendingInitiativeInserts`. Emits a `"<N> giant spider(s) vanish as she re-uses the lair action"` despawn log.
  - Added `giantInsectLairDespawnOnReuseV2Implemented: true` metadata flag.
- `src/engine/combat.ts`:
  - Replaced the `shouldCast as shouldCastGiantInsect` import with `shouldCastLairGiantInsect` (`shouldCastGiantInsect` is no longer used in combat.ts — it's still used by `_generic_registry.ts` for the player/monster path, imported separately from `giant_insect.ts`, so that path is unaffected).
  - `dispatchBespokeLairSpell` `giantInsect` case: calls `shouldCastLairGiantInsect(creature, bf)` (returns `Combatant | null`) instead of `shouldCastGiantInsect(creature, bf) ? creature : null` (boolean→Combatant conversion). Matches the pattern of the other lair shouldCast cases (which return `Combatant | null` directly).
- `src/engine/lair_action_metadata.ts`:
  - Added `lairActionBespokeDispatchV4TacticalPlacementAndDespawnReuse: true` central feature flag (covers S117's two improvements: darkness tactical placement + giant insect despawn-on-reuse).

**Safety analysis (Task C):** The only behavioral change is the `giantInsect` case in `dispatchBespokeLairSpell`'s shouldCast switch. This case is reached ONLY for Arasta's `giant insect` lair action (the only creature with a giant-insect lair action in `LAIR_BESPOKE_SPELL_META`). Regular (non-lair) monster casts of Giant Insect use the `genericSpell` case (line ~6284), NOT `handleLairCastSpell` — they hit the generic registry's `shouldCastGiantInsect` (unchanged). The `executeLair` despawn logic only affects giant-insect spiders (filtered by `summonSpellName === 'Giant Insect'`); other summons are untouched. Verified: `monster_spellcasting` 121/0, `bulk_spell_dispatch` 214/0, `summons` 52/0 — all unaffected.

## TEST STATUS

- **New/updated tests (1 file — session113_lair_bespoke_dispatch):**
  - 106 passed, 0 failed (was 96 in S116; +10 new assertions: §1ad V4 flag, §8j/8k darkness tactical, §10m0/0b/1/2/3/4/5 giant insect despawn-on-reuse).
  - §1ad: `lairActionBespokeDispatchV4TacticalPlacementAndDespawnReuse` flag assertion.
  - §8 rewritten for S117 v2: +8j (at least one obstacle centered on/near the goblin — tactical placement), +8k (multi-cast log mentions tactical placement note). §8a–8i2 unchanged (4 obstacles, 4 distinct positions, 4 effects, suppress mode, multi-cast log, obstacleId cross-ref).
  - §10m (NEW section, direct-call deterministic test): 10m0 (shouldCastLairGiantInsect returns caster before flag set), 10m1 (1st executeLair → 3 spiders), 10m0b (shouldCastLairGiantInsect STILL returns caster after flag set — re-fire gate, unlike the regular shouldCast which would return false), 10m2 (2nd executeLair → 3 spiders, not 6 — despawn works), 10m3 (2nd-batch IDs differ from 1st), 10m4 (despawn log fires), 10m5 (2nd-batch pending initiative inserts). §10a–10l unchanged.
  - §9 (Morkoth darkness) unchanged — normal mode, 1 obstacle, concentration applies.
  - §11 (Fraz-Urb'luu simulacrum) unchanged.
- **Regression (all 0 failed):**
  - `session91_lair_action_parser` — 155 passed (unchanged).
  - `session92_lair_action_dispatch` — 59 passed (unchanged).
  - `session93_lair_save_damage` — 52 passed (unchanged).
  - `session94_lair_phase3b` — 54 passed (unchanged).
  - `session95_lair_phase4` — 39 passed (unchanged).
  - `session96_lair_phase5` — 53 passed (unchanged; GoI pre-filter unaffected).
  - `session97_lair_phase6` — 35 passed (unchanged).
  - `session98_lair_phase7` — 36 passed (unchanged).
  - `session99_lair_phase7b2` — 60 passed (unchanged).
  - `session100_lair_phase8b1` — 71 passed (uses Demogorgon; unaffected — checks deferred tags, not obstacle positions).
  - `session101_lair_phase8b2` — 51 passed (uses Demogorgon/Morkoth; unaffected).
  - `session102_lair_phase8b3` — 52 passed (uses Demogorgon; unaffected).
  - `session103_deferred_promotion` — 88 passed (uses Demogorgon; unaffected).
  - `session103_choose_lair_point` — 128 passed (unchanged).
  - `session105_phase8_retrospective` — 25 passed (unchanged).
  - `session106_hallow_ev_dispatch` — 92 passed (unchanged).
  - `session76_monster_bespoke` — 95 passed (unchanged; regular monster bespoke dispatch — not the lair path).
  - `bulk_spell_dispatch` — 214 passed (unchanged).
  - `creature_lair_actions` — 12 passed (unchanged).
  - `regenerate` — 41 passed (unchanged).
  - `bestiary_integration` — 77 passed (unchanged).
  - `darkness` (player-cast) — 59 passed (executeLairDarkness change is lair-only; player `execute` path untouched).
  - `summons` — 52 passed (despawn subsystem unaffected — the new despawn is in giant_insect.ts executeLair, not removeEffectsFromCaster).
  - `combining_effects` — 114 passed (unchanged).
  - `monster_spellcasting` — 121 passed (unchanged; regular monster casts use the genericSpell case + the unchanged generic-registry shouldCastGiantInsect).
  - `out_of_combat_spells` — 66 passed (unchanged).
  - `spell_effects` — 23 passed (unchanged).
  - `spell_actions` — 54 passed (unchanged).
- **Flake check:** session113 run 3× standalone → 3/3 pass (tactical placement in §8 stable; despawn-on-reuse direct-call in §10m deterministic by design).
- **No other test uses Arasta/giant insect lair actions** (grep-confirmed: `grep -rln "Arasta\|giant insect\|Giant Insect\|giantInsect" src/test/` → only session113).
- **No other test forces Demogorgon::0 (darkness lair action)** (grep-confirmed: `grep -rln "Demogorgon::0" src/test/` → only session113).
- **Full 6-chunk CI suite:** local full run was too slow to complete in-session (438 files). All directly-affected + all lair-action + all spell-dispatch tests pass locally (30 test files, ~2200+ assertions). CI on GitHub is the definitive check.

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Sessions 91–116: `combat.ts(2627,23)`, `combat.ts(2647,13)`, `utils.ts(601,6)`, `monster_spellcasting.test.ts(602,48)`, `monster_spellcasting.test.ts(609,51)`. The S117 changes are additive: new `shouldCastLairGiantInsect` export + despawn loop in `executeLair` + tactical placement in `executeLairDarkness` + `enemiesWithinRangeFt` helper + `lairActionBespokeDispatchV4…` flag + audit comments + test additions. None touch the 5 pre-existing error sites.)

## CI STATUS

- **`15001a2` (S116 handover, re-verified this session via GitHub API):** **9/9 ALL GREEN** — Test Suite `success` + Pages build `success` (both workflows). No red X carried over from S116.
- **`95941e7` (S117 Task A: dispatch-order flip audit):** expected ALL GREEN (comment-only; zero behavior change).
- **`a62dad3` (S117 Task B: darkness tactical placement):** expected ALL GREEN (additive: new `enemiesWithinRangeFt` + tactical placement in `executeLairDarkness` + test additions; local verification passes across 30 test files).
- **`bc5c752` (S117 Task C: giant insect despawn-on-reuse):** expected ALL GREEN (additive + lair-specific shouldCast; only Arasta::1 lair-action behavior changes, and no other test uses it; regular monster casts unaffected).
- **S117 handover commit (this file):** CI will run after push. Expected ALL GREEN — all local verification passes.

(If a flaky CRASH appears on any chunk — the known remaining flake is `summons.test.ts` under parallel load (S106, not reproduced locally; verified 52/0 standalone this session). The `regenerate.test.ts` §4b RNG flake was FIXED in S114 (verified 41/0 this session). The `session113` §7b concentration flake was ROOT-CAUSED + FIXED in S115. Re-trigger with an empty commit if any NEW flake CRASHes.)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

The S113 RFC goal (15/15 bespoke dispatch) was achieved in S115. S116 resolved 2 of the S115 next-actions (#3 darkness 4× + #2 giant insect summon). S117 resolved 3 more (#6 audit + #3 darkness tactical + #2 giant insect despawn-on-reuse). The carry-overs + NEW follow-ups from S117:

### 1. simulacrum full implementation — creature-duplication subsystem (S115 #1, unchanged, HIGH)

The S115 forward-compat (log + flag) is a placeholder. The real implementation needs a creature-duplication subsystem:
1. Clone the target's stats (HP, AC, abilities, actions, etc.)
2. Set the clone's HP to half the target's maxHP (per simulacrum spell)
3. Add the clone as a new combatant on the caster's faction
4. Roll initiative for the clone (or have it act on the caster's turn)
5. Remove the clone at the next initiative count 20 (1-round lair duration)

HIGH risk (complex subsystem — mid-combat combatant add/remove + stat cloning). Out of scope for an autonomous session without a dedicated RFC. The forward-compat log clearly states the limitation.

### 2. giant insect v3 — spider attack completeness (S116 #2 residual + S117, MEDIUM)

The S116 summoning + S117 despawn-on-reuse are live, but the spider Bite is still v1 (piercing only). Two remaining simplifications:
- **Bite poison save:** model the DC 11 Con-save vs 2d8 poison + the paralyzed-at-0-HP rider. Requires extending the `Action` type for save-or-secondary-damage attacks (currently single-damage only).
- **Web (recharge 5) restraint attack:** model the ranged web attack that restrains the target (DC 12 Str to escape). Requires a restraint-condition subsystem.

MEDIUM risk (Action-type extension + restraint subsystem). The despawn-on-reuse sub-part is now RESOLVED (S117).

### 3. darkness v3 — Morkoth "choice" (S116 #3 residual, LOW-MEDIUM)

The S117 v2 resolved Demogorgon tactical placement. The remaining simplification:
- **Morkoth "choice of darkness/dispel magic/misty step":** the parser tags spellName='darkness' (first option). v1 always dispatches darkness. A future session could implement the tactical choice (pick the most tactical of the 3). May need a parser change to represent the choice.

LOW-MEDIUM risk (parser change for Morkoth choice). The Demogorgon tactical-placement sub-part is now RESOLVED (S117).

### 4. antimagic_field — module implementation (S113 #4, unchanged, HIGH)

Q2 directive: skip with updated log (done). A future session should implement `src/spells/antimagic_field.ts` properly. HIGH risk (complex spell — suppresses magic in a 10-ft radius). Out of scope for an autonomous session without a dedicated RFC.

### 5. lairActionSpellMode parser flag (S113 #5, unchanged, MEDIUM)

The S113–S117 implementation uses a hardcoded `LAIR_BESPOKE_SPELL_META` table + per-creature overrides + `lairMultiCast`. A cleaner future approach: add `lairActionSpellMode?: 'cast' | 'hazard'` to `LairAction`, populated by the parser. MEDIUM risk (parser change). Defer until the per-spell table grows beyond ~20 entries (currently 15 — the full RFC set).

### 6. dispatch-order flip audit (S116 #6, RESOLVED in S117 ✅)

The S117 audit (Task A) added the future-agent guidance to `lair_action_metadata.ts` step 1b + a cross-reference comment in `handleLairCastSpell`. No further action needed — future agents adding a bespoke entry that's ALSO in GENERIC_SPELLS will see the guidance. CLOSED.

### 7-10. (Carry-overs from S104/S113, unchanged)

- #7: Character-builder `isInLair` toggle UI (S104, unchanged, SHEET stream).
- #8: Score-weight tuning (S104, unchanged, MEDIUM).
- The S113–S117 lair-action bespoke dispatch workstream: 15/15 dispatch (S115) + 2 enhancements (S116) + 3 enhancements (S117). The remaining lair-action work is the HIGH-risk simulacrum/antimagic_field implementations (out of scope for autonomous) + the MEDIUM giant-insect-spider-attack-completeness + Morkoth-choice follow-ups.

## CI FAILURE RECOVERY

If any S117 commit shows a red X on CI:

1. **`95941e7` (Task A: dispatch-order flip audit):** comment-only — zero behavior change. If ANY test fails, it's a flake (re-trigger). No code path changed.
2. **`a62dad3` (Task B: darkness tactical placement):** additive — new `enemiesWithinRangeFt` + tactical placement in `executeLairDarkness` + test additions. Only `executeLairDarkness` changed (called only for Demogorgon::0 with `lairMultiCast > 1`, only in session113 §8). If `session113` fails on §8, check whether 4 obstacles are created at distinct positions (§8b2) + at least one is centered on/near an enemy (§8j) + the multi-cast log mentions tactical placement (§8k). If `session113` fails on §9 (Morkoth), verify the regular `executeDarkness` path still works (1 obstacle, normal concentration — Morkoth has no `lairMultiCast`, so `executeLairDarkness` is never called for Morkoth). If other tests fail, it's likely a flake.
3. **`bc5c752` (Task C: giant insect despawn-on-reuse):** the `giantInsect` shouldCast change is the main risk. If ANY lair-action test fails, check whether it relied on `shouldCastGiantInsect` (the boolean version with the flag gate). The only spell affected is giant insect (Arasta::1) — no other test uses it. If `session113` fails on §10/§10m, check whether `shouldCastLairGiantInsect` returns the caster (enemies present) + `executeLair` despawns old spiders before summoning new (3, not 6). If a non-lair test fails (e.g., `monster_spellcasting`, `bulk_spell_dispatch`), verify the `genericSpell` case (line ~6284) is unaffected — it should be (the change only touches `dispatchBespokeLairSpell`'s `giantInsect` case + the combat.ts import; the generic-registry `shouldCastGiantInsect` is imported separately in `_generic_registry.ts` and is unchanged).
4. **Reproduce locally** with `npx ts-node --transpile-only src/test/session113_lair_bespoke_dispatch.test.ts` (the definitive local check; 3/3 flake-free this session).
5. **Known flakes (all FIXED):** `regenerate.test.ts` §4b (S114), `session113` §7b (S115). The only REMAINING known flake is `summons.test.ts` under parallel load (S106, not reproduced locally; verified 52/0 standalone this session). The S117 despawn-on-reuse in §10m is a direct-call test (deterministic by design — no lair-action scheduling dependency).
6. **If the giant-insect shouldCast change causes a broad failure:** revert commit `bc5c752` (the change is isolated to the `giantInsect` case in `dispatchBespokeLairSpell`'s shouldCast switch + the combat.ts import + the despawn loop in `executeLair` + `shouldCastLairGiantInsect`). Commits `95941e7` (audit) + `a62dad3` (darkness) are independent and safe.

## KEY FILES THIS SESSION

### New
- `zHANDOVER-SESSION-117.md` — this file.

### Modified
- `src/spells/darkness.ts`:
  - Added `enemiesWithinRangeFt(caster, bf, rangeFt)` helper (S117 Task B): living enemies within range, sorted nearest-first.
  - Rewrote `executeLairDarkness(caster, state, count=4)` (S117 Task B): tactical placement (enemy clusters first, then fallback offsets, deduplicated). Multi-cast log appends tactical note.
  - Added `darknessLairTacticalPlacementV2Implemented: true` metadata flag.
  - Player-cast `execute` / `shouldCast` / `cleanup` untouched.
- `src/spells/giant_insect.ts`:
  - Added `shouldCastLairGiantInsect(caster, bf)` (S117 Task C): lair-specific shouldCast, no flag check, re-fires each round when enemies present.
  - `executeLair(caster, state)` (S117 Task C): now despawns existing giant-insect spiders (by summonerId + summonSpellName) before summoning new ones. Emits despawn log.
  - Added `giantInsectLairDespawnOnReuseV2Implemented: true` metadata flag.
  - Regular `shouldCast` / `execute` / `cleanup` untouched (player spell system stays forward-compat flag; generic-registry path unaffected).
- `src/engine/lair_action_metadata.ts`:
  - Added step 1b to §"HOW TO ADD A NEW SPELL" (S117 Task A): dispatch-order flip audit guidance.
  - Added `lairActionBespokeDispatchV4TacticalPlacementAndDespawnReuse: true` flag (S117 Task C, central).
  - Header comments updated (S117 enhancements summary).
- `src/engine/combat.ts`:
  - Replaced `shouldCast as shouldCastGiantInsect` import with `shouldCastLairGiantInsect` (S117 Task C).
  - `dispatchBespokeLairSpell` `giantInsect` case: calls `shouldCastLairGiantInsect(creature, bf)` (S117 Task C; was `shouldCastGiantInsect(creature, bf) ? creature : null`).
  - `handleLairCastSpell` comment (S117 Task A): added S117 audit cross-reference to the metadata step 1b.
- `src/test/session113_lair_bespoke_dispatch.test.ts`:
  - Added `executeLair as executeLairGiantInsect, shouldCastLairGiantInsect` import.
  - §1ad: `lairActionBespokeDispatchV4TacticalPlacementAndDespawnReuse` flag assertion.
  - §8: +8j (at least one obstacle centered on/near the goblin — tactical placement), +8k (multi-cast log mentions tactical placement).
  - §10m (NEW section, direct-call deterministic): 10m0/0b/1/2/3/4/5 — despawn-on-reuse verification.

### Archived
- `zHANDOVER-SESSION-115.md` → `HandoverOld/zHANDOVER-SESSION-115.md` (per AGENTS.md "latest 2 in root" rule; S116 + S117 now in root).

## VERIFICATION SNAPSHOT

- `git log --oneline -5` (local, pre-push): `bc5c752` (S117 Task C), `a62dad3` (S117 Task B), `95941e7` (S117 Task A), `15001a2` (S116 handover), `d34a8db` (S116 Task 2)
- `git status` → clean (3 impl commits; S115 handover archived; S117 handover commit pending)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session113_lair_bespoke_dispatch.test.ts` → **106 passed, 0 failed** (was 96 in S116; +10 new assertions; 3/3 flake-free)
- `npx ts-node --transpile-only src/test/session92_lair_action_dispatch.test.ts` → **59 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session93_lair_save_damage.test.ts` → **52 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session95_lair_phase4.test.ts` → **39 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session96_lair_phase5.test.ts` → **53 passed, 0 failed** (unchanged; GoI pre-filter unaffected)
- `npx ts-node --transpile-only src/test/session97_lair_phase6.test.ts` → **35 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session98_lair_phase7.test.ts` → **36 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session99_lair_phase7b2.test.ts` → **60 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session100_lair_phase8b1.test.ts` → **71 passed, 0 failed** (uses Demogorgon; unaffected)
- `npx ts-node --transpile-only src/test/session101_lair_phase8b2.test.ts` → **51 passed, 0 failed** (uses Demogorgon/Morkoth; unaffected)
- `npx ts-node --transpile-only src/test/session102_lair_phase8b3.test.ts` → **52 passed, 0 failed** (uses Demogorgon; unaffected)
- `npx ts-node --transpile-only src/test/session103_deferred_promotion.test.ts` → **88 passed, 0 failed** (uses Demogorgon; unaffected)
- `npx ts-node --transpile-only src/test/session103_choose_lair_point.test.ts` → **128 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session105_phase8_retrospective.test.ts` → **25 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session106_hallow_ev_dispatch.test.ts` → **92 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session76_monster_bespoke.test.ts` → **95 passed, 0 failed** (unchanged; regular monster bespoke)
- `npx ts-node --transpile-only src/test/bulk_spell_dispatch.test.ts` → **214 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/creature_lair_actions.test.ts` → **12 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session91_lair_action_parser.test.ts` → **155 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session94_lair_phase3b.test.ts` → **54 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/regenerate.test.ts` → **41 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/bestiary_integration.test.ts` → **77 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/darkness.test.ts` → **59 passed, 0 failed** (player-cast; executeLairDarkness change is lair-only)
- `npx ts-node --transpile-only src/test/summons.test.ts` → **52 passed, 0 failed** (despawn subsystem unaffected)
- `npx ts-node --transpile-only src/test/combining_effects.test.ts` → **114 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/monster_spellcasting.test.ts` → **121 passed, 0 failed** (unchanged; regular casts use genericSpell case + unchanged generic-registry shouldCastGiantInsect)
- `npx ts-node --transpile-only src/test/out_of_combat_spells.test.ts` → **66 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/spell_effects.test.ts` → **23 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/spell_actions.test.ts` → **54 passed, 0 failed** (unchanged)
- **CI on GitHub (verified at S117 session start via GitHub API):**
  - `15001a2` (S116 handover) → **Test Suite success + Pages build success** — no red X carried over.
  - `95941e7` → `a62dad3` → `bc5c752` (S117 commits) → CI will run after push. Expected ALL GREEN — all local verification passes (30 test files, ~2200+ assertions, 0 failures).
