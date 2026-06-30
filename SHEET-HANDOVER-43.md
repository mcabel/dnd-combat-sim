# SHEET-HANDOVER-43
<!-- STREAM: Sheet | See AGENTS.md for workstream rules and startup priority -->

## REPOSITORY

- Branch: main
- Commits this session:
  - `bd66e76` — S108 flake-fix: session101 §11d nat-20 crit on miss assertion
  - `50c393d` — SHEET-43: per-enemy isInLair toggle in simulate panel (z S104 loose end)
- Previous: `7838e87` (z S108 handover), `0a4ef0b` (z S108 Hallow v2 per-target hitChance), `0447bd5` (z S107 handover)
- Repository state: clean (2 commits pushed; CI on `bd66e76` = 9/9 ALL GREEN — red X on `50c393d` resolved by the flake fix)
- Repository URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start

> **Note:** The Sheet and Core agents were offline this session. The z (Cantrip) agent — normally restricted to `src/engine/cantrip_effects.ts` + `src/spells/<cantrip>.ts` — was authorized by the user to take on Sheet and Core loose ends. The z agent's own S108 work (Hallow v2 per-target hitChance, commits `0a4ef0b` + `7838e87`) was already committed and CI-verified ALL GREEN before this Sheet work began. See `zHANDOVER-SESSION-108.md` for the z-stream session details.

---

## COMPLETED THIS SESSION

Two commits. The session started by reading the latest Sheet (`SHEET-HANDOVER-42`) and Core (`HANDOVER-SESSION-50`) handovers. Both reported "no work queued," but cross-referencing with the z S108 handover revealed a **pending SHEET task since S104**: the `isInLair` toggle UI (#2 in z S108's next-actions). Research confirmed this was the only actionable loose end across all three streams.

### Sheet-43a — per-enemy `isInLair` toggle in simulate panel (`50c393d`)

**Source:** z S104 handover flagged "Character-builder `isInLair` toggle UI" as a SHEET-stream task. The parser (S92: `isInLair: lairActions ? true : undefined`), engine (S92: `resolveLairActions` filters `c.isInLair === true`), and scenario-JSON override were all done; only the UI surface was missing. The z S108 handover listed it as next-action #2: "Parser + scenario JSON already done; char builder is the remaining surface. LOW risk (UI-only)."

**Research finding:** The RFC's "character-builder monster branch" (`src/characters/builder.ts`) is aspirational, not implemented. Monsters are NOT persisted as `CharacterSheet`s — they're spawned live in the simulate panel via `spawnMonster(bestiary, name, pos, aiProfile)`. The `CharacterSheet` type has zero monster-specific fields (no `lairActions`, `isInLair`, `creatureType`, `cr`). So the toggle belongs on the **per-enemy sim config row**, not in a character builder. This is the truest fit for the current architecture and requires touching only 2 source files (not 6+ for a full monster-sheet path).

**Implementation (Path A from research):**
- **`src/character_router.ts`** (`POST /simulate/custom`): the `enemies[]` request schema gains `isInLair?: boolean`. After `spawnMonster(...)`, if `cfg.isInLair !== undefined`, the router applies `m.isInLair = cfg.isInLair` (override). Semantics:
  - **Omitted** → parser default stands (`true` for lair creatures, `undefined` otherwise — no override).
  - **`false`** → suppresses lair actions even for lair creatures (e.g. a dragon ambushed in a field).
  - **`true`** → explicit (same effect as parser default — lair actions fire).
  - For non-lair creatures, `isInLair: true` is harmless: the engine's `resolveLairActions` also filters on `lairActions.actions.length > 0`.
- **`docs/characters.html`**:
  - `addEnemyRow()`: pushes `isInLair: true` (default checked — matches parser default for lair creatures).
  - Row HTML gains a compact "Lair" checkbox (`<label class="mon-lair-toggle">`) with a tooltip explaining the toggle suppresses lair actions. The `onchange` handler sets `S.partyEnemies[idx].isInLair = this.checked`.
  - `runSim()`: the POST body includes `isInLair: e.isInLair` in the `enemies.map(...)` mapping.
  - CSS: `.mon-lair-toggle` (compact flex label + 14px checkbox, muted color, nowrap) + `.mon-lair-toggle input[type=checkbox]`.
  - The `removeEnemyRow` re-index logic (which replaces `[\d+]` in `onchange` attributes) already handles checkbox `onchange` — no change needed.
  - Initial state (`S.partyEnemies`): the default Goblin entry gains `isInLair: true`.

**Why "always show the checkbox" (not just for lair creatures):** The `/api/monsters` endpoint returns `{name, cr, type}` — no lair-action info. Adding `hasLairActions` would require exporting `parseLairActions` from `fivetools.ts` (Core territory) and calling it for all 5904 monsters in the endpoint loop. The simpler approach: always show the checkbox (default checked). For non-lair creatures, checking it is a harmless no-op (engine filter #2 excludes them). The tooltip explains "Only affects creatures with lair actions." This keeps the change to 2 SHEET-territory files + 1 test file.

**Files:**
- `src/character_router.ts` — `enemies[]` schema + override (6 lines + 9-line comment).
- `docs/characters.html` — CSS (2 rules) + `addEnemyRow` (checkbox + `isInLair` push) + initial state + `runSim` POST body.
- `src/test/sheet43_isInLair_toggle.test.ts` (NEW, 7 assertions):
  - §1-§4: HTTP-level — `POST /simulate/custom` with `isInLair: false` / `true` / omitted / on a lair creature (Adult Red Dragon) → 200 + valid response shape. Uses the pre-existing Paladin character (`00000000-0000-0000-0000-000000000003`) as the party.
  - §5: Engine-level — spawn Adult Red Dragon, override `isInLair = false` (mimicking the router), run combat → **0 lair-action logs** (behavioral verification that the override suppresses lair actions).
  - §6: Engine-level — override `isInLair = true` (explicit) → **≥1 lair-action log** (same as parser default).
  - §7: Engine-level — no override (undefined) → parser default `isInLair = true` → **≥1 lair-action log**.

**Verified:** sheet43 7/0. server 263/0 (no regression). character_storage 89/0. session92 (lair dispatch) 59/0. tsc baseline unchanged (5 pre-existing, 0 new).

### Sheet-43b — session101 §11d CI flake fix (`bd66e76`)

**Red X on `50c393d`:** CI test chunk 5 failed: `session101_lair_phase8b2.test.ts` §11d "no damage log on miss" — `unexpected damage: Kobold deals 6 piercing damage to Goblin (CRIT)`. This was NOT a SHEET-43 regression — it's a pre-existing lair-test flake that happened to fire on the same CI run.

**Root cause:** §11 sets `goblin.ac = 30` and the Kobold's illusory-attack has `attackBonus: 7` (max d20+7=27 < 30 → always misses). But the Kobold still has its **regular dagger attack** in `kobold.actions`. On the Kobold's turn (after the lair action at initiative 20), the regular dagger attack can **nat-20** (PHB p.194: nat 20 always hits regardless of AC) → critical hit → piercing damage log. §11d checks for ANY damage log from the Kobold → finds the regular-attack crit → fails. ~5% per run under parallel load.

**Fix (two layers, mirrors the S107 session102 §8a skip-on-RNG pattern):**
1. **Clear `kobold.actions = []`** in §11 so ONLY the lair action fires. The lair action fires from `lairActions`, not `actions`, so this doesn't affect the illusory-attack test. Eliminates the regular dagger as a damage source entirely.
2. **Skip-on-crit in §11d:** if a damage log exists AND contains `"CRIT"`, skip the assertion (nat-20 auto-hit is correct PHB behavior, not a bug). Only fail if damage appears WITHOUT a crit (a real bug: damage on a non-crit miss). Handles the rare case where the illusory-attack itself nat-20s (~5% of the time, independent of the regular attack).

**Files:** `src/test/session101_lair_phase8b2.test.ts` — §11: `kobold.actions = []` after `forceAction` + skip-on-crit block in §11d. Test-only change — no engine/parser code modified.

**Verified:** 10/10 local runs pass (was ~5% failure rate under parallel load). tsc baseline unchanged. CI on `bd66e76`: **9/9 ALL GREEN**.

---

## DISCOVERIES RELEVANT TO NEXT TASK

- **Monsters are NOT persisted as `CharacterSheet`s.** They're spawned live in the simulate panel via `spawnMonster`. The RFC's "character-builder monster branch" in `builder.ts` is aspirational. A full monster-sheet path (Path B from research) would add `creatureType?/cr?/lairActions?/isInLair?` to `CharacterSheet`, a `buildMonsterCombatant(sheet)` in `builder.ts`, a `POST /api/characters/import-monster` endpoint, and a `renderMonsterDetail` UI — 6+ files, much larger scope. The per-enemy sim toggle (Path A, done here) satisfies the immediate need. Path B remains a future option if monster persistence is ever needed.

- **`/api/monsters` endpoint** (in `src/server.ts`, not `character_router.ts`) returns `{name, cr, type}` — no lair-action info. If a future session wants the UI to show the "Lair" checkbox only for lair creatures, export `parseLairActions` from `fivetools.ts` (or a lightweight `hasLairActions(raw)` wrapper) and add a `hasLairActions?: boolean` field to the API response. The current "always show" approach is a deliberate LOW-risk choice.

- **TASK.md is stale.** TG-025 (per-class unarmored-AC hook) is listed as not-started but was ALREADY implemented in `computeArmorAC` (handles Barbarian `10+dex+con` and Monk `10+dex+wis`). TG-028 (Booming/Green-Flame Blade label fix) is listed as the "LAST remaining Core Engine task" but was ALSO already done (comments already say "melee weapon attack"). Both should be marked DONE in a future TASK.md cleanup.

- **z S108 next-action #2 (isInLair toggle) is RESOLVED** by Sheet-43a. The z agent's next handover should update its next-actions list to mark #2 as resolved.

---

## OPEN BLOCKERS

None.

---

## IMMEDIATE NEXT ACTION

No Sheet work queued. The `isInLair` toggle (the pending SHEET task from z S104) is done. Check `TEAMGOALS.md` for new Sheet-tagged items or get a new objective from Ares.

If the z agent writes S109, it should note:
- z S108 #2 (isInLair toggle) → **RESOLVED by SHEET-43a** (`50c393d`).
- z S108 #9 (Hallow v2 hitChance) → **RESOLVED in z S108** (`0a4ef0b`).
- The session101 §11d flake → **FIXED in SHEET-43b** (`bd66e76`), test-only.

---

## TEST STATUS

| Suite | Count | Notes |
|-------|-------|-------|
| sheet43_isInLair_toggle.test.ts | 7 | NEW — HTTP + engine verification of isInLair override |
| server.test.ts | 263 | No regression |
| character_storage.test.ts | 89 | No regression |
| session92_lair_action_dispatch.test.ts | 59 | No regression (lair dispatch) |
| session101_lair_phase8b2.test.ts | 51 | Flake fixed (was 50/1 under parallel load) |
| **Total ( Sheet-touched )** | **469** | All 0 failures |

All 0 failures. `tsc --noEmit` baseline: 5 pre-existing errors (same as Sessions 91-108), 0 new.

---

## CI STATUS

- **`50c393d` (SHEET-43 isInLair toggle):** **RED X** — test chunk 5 failed (session101 §11d flake). NOT a SHEET-43 regression.
- **`bd66e76` (SHEET-43b flake fix, HEAD):** **9/9 ALL GREEN** — build + deploy + report-build-status + 6 test chunks all SUCCESS. Red X resolved.

(If a flaky CRASH appears on any chunk — the known flake was `summons.test.ts` under parallel load, now supplemented by the S107 flake fixes for session99/session102 and the S108 flake fix for session101. Re-trigger with an empty commit if any NEW flake CRASHes.)
