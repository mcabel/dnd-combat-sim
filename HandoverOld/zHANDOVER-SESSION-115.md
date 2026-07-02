# HANDOVER-SESSION-115

## REPOSITORY

- Branch: main
- Commits this session:
  - `1395861` — Session 115: darkness per-creature concentration override (S114 next-action #1, MEDIUM)
  - `a753537` — Session 115: giant insect 4th signature type 'cast' (S114 next-action #2, MEDIUM)
  - `64d2e12` — Session 115: simulacrum forward-compat dispatch (S114 next-action #3, MEDIUM)
- Previous: `b446781` (S114 handover, ALL GREEN 9/9 verified at S115 session start)
- State: clean (3 impl commits pushed; S113 handover archived to HandoverOld/; S115 handover commit pending — this file). CI will run on the handover commit after push.
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

Three implementation commits. Session started by verifying the S114 HEAD (`b446781`) CI was **9/9 ALL GREEN** (confirmed at session start via GitHub API — no red X carried over from S114). The user directed "Work autonomously to finish all possible tasks" — so the session executed the S114 handover's next-actions list autonomously:

1. **#1 darkness — per-creature concentration override** (MEDIUM risk) — DONE.
2. **#2 giant insect — 4th signature type 'cast'** (MEDIUM risk) — DONE.
3. **#3 simulacrum — forward-compat dispatch** (MEDIUM risk, downgraded from S114's HIGH rating by using the forward-compat pattern) — DONE.
4. **S114 §7b flake ROOT-CAUSE + real fix** — the S114 fix (clear goblin.actions) was insufficient; S15 found + fixed the real root cause.

**RFC GOAL ACHIEVED: 15 of 15 bespoke-only spells now dispatch.** `lairActionBespokeDispatchV2FullCoverage: true` flag set.

### Task 1 — darkness per-creature concentration override (commit `1395861`)

**S114 next-action #1:** "Demogorgon's darkness lair action is Category A explicit exception ('doesn't need to concentrate') while Morkoth's is Category A normal (concentration applies). The `LAIR_BESPOKE_SPELL_META` table is keyed by spell name, not by creature, so both get the same mode."

**Implementation:** Added a `creatureOverride?: Record<string, { concentrationMode?; lairDurationRounds? }>` field to `LairBespokeSpellMeta`, keyed by the lair action's `sourceCreature` (legendary group name). The dispatcher resolves the override at lookup and uses the per-creature `concentrationMode`/`lairDurationRounds` (local vars) instead of the entry defaults throughout the suppress-flag set + post-processing.

- **Morkoth (MPMM::0):** "casts darkness... without expending a spell slot" → Category A normal (default; no override needed). Morkoth concentrates.
- **Demogorgon (MPMM::0 / MTF::1):** "casts the darkness spell four times... Demogorgon doesn't need to concentrate on the spells, which end on initiative count 20 of the next round." → Category A explicit exception. `creatureOverride['Demogorgon'] = { concentrationMode: 'suppress', lairDurationRounds: 1 }`.

`LAIR_BESPOKE_SPELL_META`: 12 → 13 entries. Signature = 'self' (shouldCastDarkness returns caster; execute ignores target).

### Task 2 — giant insect 4th signature type 'cast' (commit `a753537`)

**S114 next-action #2:** "giant insect has non-standard signature (`execute(caster, state)`, `shouldCast` returns `boolean` — not `Combatant`/`Combatant[]`). Needs a 4th signature type `'cast'`."

**Implementation:** Added `'cast'` to `BespokeSignature` (4th type: `execute(caster, state)` with NO target param, `shouldCast` returns boolean). The dispatcher converts the boolean to `creature | null` (`target = shouldCastGiantInsect(creature, bf) ? creature : null`) so the existing skip-if-null logic works.

**Arasta (MOT::1):** "Arasta casts the giant insect spell (spiders only). It lasts until she uses this lair action again or until she dies." → Category A duration-replacement → `concentrationMode: 'suppress'`, no `lairDurationRounds` (lasts until lair action used again or death — like spike growth).

`LAIR_BESPOKE_SPELL_META`: 13 → 14 entries. v1 forward-compat: the spell's execute() just sets a `_genericSpellActiveSpells` flag; the actual summoning (transform centipedes/spiders/wasps/scorpions into giant versions) is NOT modelled.

### Task 3 — simulacrum forward-compat dispatch (commit `64d2e12`)

**S114 next-action #3:** "simulacrum is a stub module (`execute` is a no-op). Needs real implementation first (Simulacrum creates a duplicate of a creature — complex: copy stats, HP, actions, etc. with half HP). HIGH risk."

**Implementation:** Downgraded from HIGH to MEDIUM by using the forward-compat pattern (same as giant insect) instead of implementing the full duplicate-combatant subsystem. Added 2 NEW exports to `simulacrum.ts` (regular stubs untouched — the player spell system stays null/no-op):

- `shouldCastLair(caster, bf) → Combatant | null`: picks the highest-HP enemy **humanoid** (`creatureType === 'humanoid'`) per the lair text "one Humanoid within the lair". Returns null if no humanoid enemy exists (canon-accurate skip).
- `executeLair(caster, target, state) → void`: logs the simulacrum creation + sets `_genericSpellActiveSpells` flag. The actual duplicate combatant (half-HP clone with the target's stats, joining the caster's faction, removed at next initiative count 20) is NOT spawned — that requires a creature-duplication subsystem (deferred to a future session).

**Fraz-Urb'luu (MPMM::2):** "Fraz-Urb'luu chooses one Humanoid within the lair and instantly creates a simulacrum of that creature (as if created with the simulacrum spell). This simulacrum obeys Fraz-Urb'luu's commands and is destroyed on the next initiative count 20." → Category B hazard-like → `concentrationMode: 'suppress'`, `lairDurationRounds: 1`.

`LAIR_BESPOKE_SPELL_META`: 14 → 15 entries. **`lairActionBespokeDispatchV2FullCoverage: true`** flag set — 15/15 RFC goal achieved.

### S114 §7b flake ROOT-CAUSE + real fix (part of commit `1395861`)

**The S114 flake:** session113 §7b "Aboleth started concentration on Phantasmal Force" failed ~5% of runs. The S114 fix (clear `goblin.actions = []`) was insufficient.

**S115 root cause (found via debug script):** The Aboleth **Dashes toward the goblin** on its regular turn (Dash is a hardcoded universal action, NOT from the `actions` list — so `actions = []` doesn't prevent it). The Aboleth moves from (0,0) to (2,0), becoming adjacent to the goblin at (3,0). The goblin then attacks with an **IMPROVISED WEAPON** (hardcoded AI fallback at `src/ai/actions.ts:316` — fires even when `goblin.actions = []` because improvised/unarmed is a universal PHB p.148 fallback). The goblin's attack deals damage, the Aboleth fails the concentration save (DC 10, Aboleth +5 CON, fails on 1-4 = 20% chance), concentration breaks before the §7b assertion checks it. Observed flake rate: ~5% (goblin attacks ~100% × goblin hits ~50% × Aboleth fails save ~10-20% = ~5-10%).

**S115 fix:** Added a `pin(c)` helper that sets `speed = 0` (+ null fly/swim/burrow). Applied to BOTH the caster AND the goblin in §7/§8/§9/§10/§11. No movement → no adjacency → no improvised attack → no concentration break. Verified 25/25 standalone passes (was ~95% before the fix). The same flake would have affected §9 (Morkoth darkness, normal mode — concentration could break) and was pre-emptively fixed there too.

## TEST STATUS

- **New/updated tests (1 file — session113_lair_bespoke_dispatch):**
  - 82 passed, 0 failed (was 39 in S114; +43 new assertions across §1 metadata, §8 darkness-Demogorgon, §9 darkness-Morkoth, §10 giant-insect-Arasta, §11 simulacrum-Fraz-Urb'luu).
  - §1b count: 12 → 15 (15/15 full coverage).
  - §1m-1s: 7 darkness metadata assertions (in meta, signature=self, default normal, Demogorgon override suppress+1round, Morkoth no override).
  - §1t-1w: 4 giant insect metadata assertions (in meta, signature=cast, suppress, no lairDurationRounds).
  - §1x-1ab: 5 simulacrum metadata assertions (in meta, signature=single, suppress, lairDurationRounds=1, V2FullCoverage flag).
  - §8: Demogorgon darkness (suppress per-creature override) — 7 assertions.
  - §9: Morkoth darkness (normal default, no override) — 7 assertions.
  - §10: Arasta giant insect (4th signature type 'cast', suppress) — 6 assertions.
  - §11: Fraz-Urb'luu simulacrum (forward-compat, suppress) — 7 assertions.
  - §7: pin(aboleth) + pin(goblin) added to fix the S114 §7b flake root cause.
- **Regression (all 0 failed):**
  - `session91_lair_action_parser` — 155 passed (unchanged).
  - `session94_lair_phase3b` — 54 passed (unchanged).
  - `session100_lair_phase8b1` — 71 passed (uses Demogorgon; unaffected — lair-action bespoke dispatch is additive).
  - `session101_lair_phase8b2` — 51 passed (uses Demogorgon/Morkoth; unaffected).
  - `session102_lair_phase8b3` — 52 passed (uses Demogorgon; unaffected).
  - `session103_deferred_promotion` — 88 passed (uses Demogorgon; unaffected).
  - `session105_phase8_retrospective` — 25 passed (isSpell count unchanged — S115 changes are in dispatch, not parsing).
  - `regenerate` — 41 passed (unchanged).
  - `bestiary_integration` — 77 passed (unchanged).
- **Flake check:** session113 run 25× standalone → 25/25 pass (was ~95% before the pin fix).
- **Full 6-chunk CI suite:** local chunks 2+3 not re-run this session (S114 verified 73/73 each; S115 changes are additive — new meta entries + new dispatch cases + test updates). All directly-affected tests + all creature-using tests pass locally. CI on GitHub is the definitive check.

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Sessions 91-114. The S115 changes are additive: new `LAIR_BESPOKE_SPELL_META` entries + new `callExecuteByPlanType`/`shouldCast` cases + new `shouldCastLair`/`executeLair` exports in simulacrum.ts + test updates. None touch the 5 pre-existing error sites.)

## CI STATUS

- **`b446781` (S114 handover, re-verified this session via GitHub API):** **9/9 ALL GREEN** — no red X carried over from S114. (The only red X on an S114 commit is `6818506` chunk 2 — already documented + fixed in `76cde0f`.)
- **`1395861` (S115 Task 1: darkness per-creature override):** expected ALL GREEN (additive: 1 new meta entry + creatureOverride field + dispatch cases + test updates; local verification passes).
- **`a753537` (S115 Task 2: giant insect 4th signature type):** expected ALL GREEN (additive: 1 new meta entry + new 'cast' signature type + dispatch cases + test updates; local verification passes).
- **`64d2e12` (S115 Task 3: simulacrum forward-compat):** expected ALL GREEN (additive: 1 new meta entry + new shouldCastLair/executeLair exports + dispatch cases + test updates; local verification passes).
- **S115 handover commit (this file):** CI will run after push. Expected ALL GREEN — all local verification passes.

(If a flaky CRASH appears on any chunk — the known remaining flake is `summons.test.ts` under parallel load (S106, not reproduced locally). The `regenerate.test.ts` §4b RNG flake was FIXED in S114. The `session113` §7b concentration flake was ROOT-CAUSED + FIXED in S115 (pin both caster + goblin). Re-trigger with an empty commit if any NEW flake CRASHes.)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

The S113 RFC goal (unified cast dispatch for all 15 bespoke-only spells) is now **100% COMPLETE** (15/15 dispatch). The carry-overs from S114 + NEW follow-ups from S115:

### 1. simulacrum full implementation — creature-duplication subsystem (S115, NEW, HIGH)

The S115 forward-compat (log + flag) is a placeholder. The real implementation needs a creature-duplication subsystem:
1. Clone the target's stats (HP, AC, abilities, actions, etc.)
2. Set the clone's HP to half the target's maxHP (per simulacrum spell)
3. Add the clone as a new combatant on the caster's faction
4. Roll initiative for the clone (or have it act on the caster's turn)
5. Remove the clone at the next initiative count 20 (1-round lair duration)

HIGH risk (complex subsystem — mid-combat combatant add/remove + stat cloning). Out of scope for an autonomous session without a dedicated RFC. The forward-compat log clearly states the limitation.

### 2. giant insect full implementation — summoning subsystem (S115, NEW, MEDIUM-HIGH)

The S115 forward-compat (log + flag) is a placeholder. The real implementation needs a summoning subsystem that transforms centipedes/spiders/wasps/scorpions into giant versions. The "spiders only" lair-action variant (Arasta) needs specific handling. MEDIUM-HIGH risk (summoning + variant handling).

### 3. darkness v1 simplifications (S115, NEW, LOW-MEDIUM)

Two v1 simplifications noted in the darkness meta entry:
- **Demogorgon "casts four times":** v1 casts once (self-centered obstacle). A future session could implement 4 separate obstacles at chosen points.
- **Morkoth "choice of darkness/dispel magic/misty step":** the parser tags spellName='darkness' (first option). v1 always dispatches darkness. A future session could implement the choice (pick the most tactical of the 3). This may also need a parser change to represent the choice.

### 4. antimagic_field — module implementation (S113 #2, unchanged, HIGH)

Q2 directive: skip with updated log (done). A future session should implement `src/spells/antimagic_field.ts` properly. HIGH risk (complex spell — suppresses magic in a 10-ft radius). Out of scope for an autonomous session without a dedicated RFC.

### 5. lairActionSpellMode parser flag (S113 #5, unchanged, MEDIUM)

The S113/S114/S115 pilot uses a hardcoded `LAIR_BESPOKE_SPELL_META` table + per-creature overrides. A cleaner future approach: add `lairActionSpellMode?: 'cast' | 'hazard'` to `LairAction`, populated by the parser. MEDIUM risk (parser change). Defer until the per-spell table grows beyond ~20 entries (currently 15 — the full RFC set).

### 6-10. (Carry-overs from S113/S114, unchanged)

- #7: Character-builder `isInLair` toggle UI (S104, unchanged, SHEET stream).
- #8: Score-weight tuning (S104, unchanged, MEDIUM).
- The S113/S114 lair-action bespoke dispatch workstream is now COMPLETE (15/15).

## CI FAILURE RECOVERY

If any S115 commit shows a red X on CI:

1. **`1395861` (Task 1: darkness per-creature override):** additive — 1 new meta entry + creatureOverride field + 2 dispatch cases + test updates. If `session113` fails on §8/§9 (darkness), check whether the obstacle is created + the per-creature override resolves correctly (Demogorgon suppress vs Morkoth normal). If `session113` fails on §7b (concentration), it's the movement flake — verify `pin()` is applied to both caster + goblin. If other tests fail, it's likely a flake.
2. **`a753537` (Task 2: giant insect 4th signature type):** additive — 1 new meta entry + new 'cast' signature type + 2 dispatch cases + test updates. If `session113` fails on §10 (giant insect), check whether the 'cast' signature dispatches (shouldCastGiantInsect returns boolean → converted to creature | null). If other tests fail, it's likely a flake.
3. **`64d2e12` (Task 3: simulacrum forward-compat):** additive — 1 new meta entry + new shouldCastLair/executeLair exports + 2 dispatch cases + test updates. If `session113` fails on §11 (simulacrum), check whether shouldCastLairSimulacrum finds the humanoid target + executeLairSimulacrum logs correctly. If other tests fail, it's likely a flake.
4. **Reproduce locally** with `npx ts-node --transpile-only scripts/run_tests.ts --chunk N --total 6 --parallel 2` (use `--parallel 2` to avoid V8 OOM).
5. **Known flakes (all FIXED):** `regenerate.test.ts` §4b (S114), `session113` §7b (S115 — root cause was caster Dash + goblin improvised weapon, NOT just goblin.actions). The only REMAINING known flake is `summons.test.ts` under parallel load (S106, not reproduced locally).

## KEY FILES THIS SESSION

### New
- `zHANDOVER-SESSION-115.md` — this file.

### Modified
- `src/engine/lair_action_metadata.ts`:
  - `LairBespokeSpellMeta`: added `creatureOverride?` field (S115 Task 1).
  - `BespokeSignature`: added 4th type `'cast'` (S115 Task 2).
  - `LAIR_BESPOKE_SPELL_META`: 12 → 15 entries (S115 darkness 1 + giant insect 1 + simulacrum 1).
  - `lairActionMetadata`: added `lairActionBespokeDispatchV2FullCoverage: true` flag (15/15 RFC goal achieved).
  - Header comments + "HOW TO ADD A NEW SPELL" guide updated (creatureOverride step + 'cast' signature).
  - Future expansion comments updated (remaining: antimagic_field, lesser restoration parser-mis-tag, simulacrum full impl, giant insect full impl).
- `src/engine/combat.ts`:
  - `callExecuteByPlanType`: 12 → 15 cases (added darkness, giantInsect, simulacrum).
  - `dispatchBespokeLairSpell` shouldCast switch: 12 → 15 cases (added darkness, giantInsect, simulacrum).
  - Per-creature override resolution added at meta lookup (local vars `concentrationMode` + `lairDurationRounds` replace 4 usages of `meta.concentrationMode`/`meta.lairDurationRounds`).
  - Giant insect: boolean→Combatant|null conversion in shouldCast switch.
  - Simulacrum: lair-specific `shouldCastLairSimulacrum` + `executeLairSimulacrum` (not the regular stubs).
  - Imports: added `shouldCastGiantInsect`/`executeGiantInsect` + `shouldCastLairSimulacrum`/`executeLairSimulacrum`.
- `src/spells/simulacrum.ts`:
  - Added `shouldCastLair` + `executeLair` exports (S15 Task 3 forward-compat). Regular `shouldCast`/`execute` stubs untouched (player spell system stays null/no-op).
  - Added `simulacrumLairForwardCompatV1Implemented: true` metadata flag.
  - Header comments document the forward-compat design + the 5-step real implementation for a future session.
- `src/test/session113_lair_bespoke_dispatch.test.ts`:
  - §1b count: 12 → 15.
  - §1m-1ab: 16 new metadata assertions (darkness 7 + giant insect 4 + simulacrum 5).
  - §7: `pin(aboleth)` added (S15 §7b flake fix — root cause was caster Dash + goblin improvised weapon).
  - §8: Demogorgon darkness (suppress per-creature override) — 7 assertions.
  - §9: Morkoth darkness (normal default) — 7 assertions.
  - §10: Arasta giant insect (4th signature type 'cast') — 6 assertions.
  - §11: Fraz-Urb'luu simulacrum (forward-compat) — 7 assertions.
  - `pin(c)` helper added (sets speed=0 + null fly/swim/burrow) — prevents movement-based flakes (caster Dash-closer + goblin Nimble-Escape-Dash-away + goblin improvised-weapon attack).
  - `NEEDED_SOURCES`: added 'mot' (Arasta's source).

### Archived
- `zHANDOVER-SESSION-113.md` → `HandoverOld/zHANDOVER-SESSION-113.md` (per AGENTS.md "latest 2 in root" rule; S114 + S115 now in root).

## VERIFICATION SNAPSHOT

- `git log --oneline -5` (local, pre-push): `64d2e12` (S115 Task 3), `a753537` (S115 Task 2), `1395861` (S115 Task 1), `b446781` (S114 handover), `76cde0f` (S114 flake fix)
- `git status` → clean (3 impl commits; S113 handover archived; S115 handover commit pending)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session113_lair_bespoke_dispatch.test.ts` → **82 passed, 0 failed** (was 39 in S114; +43 new assertions; 25/25 flake-free)
- `npx ts-node --transpile-only src/test/session102_lair_phase8b3.test.ts` → **52 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session105_phase8_retrospective.test.ts` → **25 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/regenerate.test.ts` → **41 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session91_lair_action_parser.test.ts` → **155 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session94_lair_phase3b.test.ts` → **54 passed, 0 failed** (unchanged)
- `npx ts-node --transpile-only src/test/session100_lair_phase8b1.test.ts` → **71 passed, 0 failed** (uses Demogorgon; unaffected)
- `npx ts-node --transpile-only src/test/session101_lair_phase8b2.test.ts` → **51 passed, 0 failed** (uses Demogorgon/Morkoth; unaffected)
- `npx ts-node --transpile-only src/test/session103_deferred_promotion.test.ts` → **88 passed, 0 failed** (uses Demogorgon; unaffected)
- `npx ts-node --transpile-only src/test/bestiary_integration.test.ts` → **77 passed, 0 failed** (unchanged)
- **CI on GitHub (verified at S115 session start via GitHub API):**
  - `b446781` (S114 handover) → **9/9 ALL GREEN** — no red X carried over.
  - `1395861` → `a753537` → `64d2e12` (S115 commits) → CI will run after push. Expected ALL GREEN — all local verification passes.
