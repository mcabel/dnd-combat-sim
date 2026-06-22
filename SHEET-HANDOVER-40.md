# SHEET-HANDOVER-40
<!-- STREAM: Sheet | See AGENTS.md for workstream rules and startup priority -->

## REPOSITORY

- Branch: main
- Commit: `fbff2fe`
- Repository state: clean, pushed
- Repository URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided verbally at session start

---

## COMPLETED THIS SESSION

This session was a functionality audit followed by implementation of all
high/medium priority gaps found.

### Audit gaps closed (`fbff2fe`)

**Router — three new endpoints:**

- `POST /characters/:id/chooseinvocations` — wires `chooseEldritchInvocations()`
  (already existed in improvements.ts, previously inaccessible from the UI).
  Body: `{ invocations: string[] }`. Validates count matches Warlock level slot
  table and all names are in the v1 registry. Returns 400 for all validation
  failures (both count mismatches and unknown names).

- `POST /characters/:id/choosepactboon` — wires `choosePactBoon()`. Body:
  `{ boon: 'chain' | 'blade' | 'tome' }`. Returns 400 when boon is invalid,
  level < 3, or already set.

- `POST /characters/:id/addxp` — award XP to a single character (previously
  only available via party endpoint). Body: `{ amount: number }`. Returns
  `{ character, newTotal }`.

**UI — `docs/characters.html`:**

- `WARLOCK_INVOCATION_SLOTS` table and `warlockInvocationSlots()` helper added
  (mirrors `leveler.ts` — keep in sync if that table ever changes).
- `AVAILABLE_INVOCATIONS` constant (4 v1 invocations).
- `S.pendingInvocations` / `S.pendingPactBoon` state flags; auto-detected from
  character data in `renderCharDetail()` — no levelup response required.
- Two new alert banners (`#invocations-alert`, `#pactboon-alert`) and two new
  form cards (`#invocations-form-card` with per-invocation checkboxes enforcing
  exact count; `#pactboon-form-card` with blade/chain/tome select).
- New functions: `renderInvocationsPanel()`, `updateInvocationsConfirmBtn()`,
  `doChooseInvocations()`, `doChoosePactBoon()`.
- Inline `+ XP` button on class info row (toggles an input panel);
  `showAddXPPanel()` / `doAddXP()`.
- `flySpeed` / `swimSpeed` / `burrowSpeed` displayed as stat boxes when non-null
  (fields existed in schema since before Session 39, never rendered).
- Pending flags reset on character delete and `newChar()`.

---

## DISCOVERIES RELEVANT TO NEXT TASK

- `choosePactBoon()` only accepts `'chain' | 'blade' | 'tome'` (PHB three).
  TCE Pact of the Talisman is out of scope for the current implementation.
  If Talisman support is added, the type union in improvements.ts and the
  UI select options both need updating.
- Invocation registry is v1-limited to 4 names. `pendingInvocations` is
  intentionally suppressed at Warlock level 9+ (needs 5+ invocations but
  only 4 exist). If the registry grows, update `AVAILABLE_INVOCATIONS` in
  characters.html and the suppression condition in `renderCharDetail`.
- `wardingBond` and `darkOnesBlessing` in `CharacterResources` type are
  combat-engine transient state, not sheet-persistent resources — no UI
  action needed.

---

## OPEN BLOCKERS

None for Sheet.

---

## REMAINING KNOWN GAPS (lower priority, not implemented)

- Full currency (cp/sp/ep/pp) — only gold tracked. Schema change required.
- Temporary ability score modifications (Enhance Ability, etc.) — no schema
  support exists yet.
- AC not auto-updated when armor is equipped — pure UX gap, no rules impact.

---

## IMMEDIATE NEXT ACTION

No Sheet work queued. Check TEAMGOALS.md for new Sheet-tagged items or get
a new objective from Ares.

---

## TEST STATUS

| Suite | Count |
|-------|-------|
| character_storage.test.ts | 89 |
| character_leveler.test.ts | 256 |
| character_improvements.test.ts | 108 |
| server.test.ts (via `timeout 120`) | 197 (was 176; +21 new endpoint tests) |
| **Total** | **650** |

All 0 failures. `npx tsc --noEmit -p tsconfig.json` clean (0 Sheet-relevant errors).
Reverted `characters/00000000-0000-0000-0000-000000000003.json` before commit.
