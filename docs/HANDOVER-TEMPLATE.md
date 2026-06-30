# HANDOVER-SESSION-<N>
<!-- STREAM: <z | SHEET | CORE | <your-stream-name>> | See AGENTS.md for workstream rules -->

<!--
╔══════════════════════════════════════════════════════════════════════════╗
║  HANDOVER TEMPLATE — annotated for reuse in side projects                ║
║  Copy this file → rename → fill in the <PLACEHOLDERS> → delete the       ║
║  <!-- ANNOTATION: ... --> blocks (they're guidance, not final content).  ║
║  The `> **Purpose:** ...` blockquotes at each section top are ALSO        ║
║  guidance — delete them after reading.                                   ║
╚══════════════════════════════════════════════════════════════════════════╝

  IMPROVEMENTS OVER A MINIMAL HANDOVER (added in this template):
  1. Quick-Start Checklist — a numbered session-lifecycle checklist at the
     top so an incoming agent knows the protocol without reading prose.
  2. Risk-level legend — LOW/MEDIUM/HIGH standardized with criteria, so
     "out of scope for an autonomous session" is unambiguous.
  3. Per-task sub-structure — each completed task has 4 labelled parts
     (Directive → Implementation → Files → Verified) for skimmability.
  4. Flake-fix sub-template — a recurring pattern (RNG/test-isolation
     flakes) gets a standardized 4-step fix recipe.
  5. "What NOT to include" guidance — prevents handover bloat.
  6. Cross-stream coordination callout — explicit field for what other
     parallel agents must know (prevents merge conflicts / duplicate work).
  7. Reproducible verification commands — the exact commands to re-verify,
     so a future agent can copy-paste instead of guessing.
  8. Archival rule made explicit — "latest 2 in root, older → Archive/".

  ADAPT FOR YOUR PROJECT:
  - Replace `tsc --noEmit` with your build/lint command.
  - Replace `npx ts-node --transpile-only src/test/X.test.ts` with your
    test-runner invocation.
  - Replace "6 test chunks" with your CI matrix shape (or remove if no
    parallel chunking).
  - Replace "z/SHEET/CORE" stream names with your own (or remove the
    stream-isolation rules if you're a single-stream project).
  - The <!-- ANNOTATION --> + > Purpose blockquotes are DELETE-ON-FILL.
    The final handover should have NO annotation blocks and NO Purpose
    blockquotes — just the filled-in content.
-->

---

## Quick-Start Checklist (for the incoming agent)

> **Purpose:** A 7-step protocol the incoming agent follows every session.
> Delete this blockquote after reading. Keep the checklist in the final
> handover ONLY if your project wants it (the dnd-combat-sim handovers omit
> it; side projects may keep it for onboarding).

1. **Read the previous handover** for your stream (highest `<N>` in repo root,
   or the latest in `HandoverOld/`/`Archive/` if root has only the newest 2).
2. **Check CI on the previous HEAD** before touching code — if there's a red
   X, fix it FIRST (it's usually a flake; see "CI FAILURE RECOVERY").
3. **Read `AGENTS.md`** (or your equivalent) for stream-isolation rules —
   know which files you may NOT touch.
4. **Pick tasks** from "IMMEDIATE NEXT ACTIONS" that match your risk budget
   (LOW = autonomous OK; MEDIUM = autonomous with care; HIGH = flag for
   human review or a dedicated session).
5. **Execute → test locally → commit** after each task (don't batch —
   smaller commits are easier to revert and easier to attribute in CI).
6. **Push → verify CI is ALL GREEN** (no red X) before writing the handover.
7. **Write the next handover** (`<N+1>`), archive `<N-1>` to `HandoverOld/`,
   commit, push, verify CI on the handover commit too.

---

## REPOSITORY

> **Purpose:** Pin the exact git state + auth so the next agent can reproduce.
> Mandatory. Keep concise — this is a header, not a narrative.

- Branch: `<branch-name>` (usually `main`)
- Commits this session:
  - `<short-sha>` — `<one-line description (stream tag + task)>`
  - `<short-sha>` — `<...>`
- Previous: `<short-sha>` (`<one-line context>`), `<short-sha>` (`<...>`)
- State: clean (`<N>` commits pushed; CI on `<HEAD-sha>` = `<X/X ALL GREEN | RED X on chunk Y>`)
- URL: `<repo URL>`
- PAT: provided at session start (embed in remote URL as usual — NEVER commit it)

<!--
  ANNOTATION:
  - "Commits this session" lists ONLY this session's commits, newest first.
  - "Previous" gives 2-3 ancestor commits for context (what was HEAD before
    this session started). Include the prior handover commit.
  - "State" is the post-push git status + the CI verdict on the new HEAD.
    If CI is pending, say "pending at handover-write time — expected all
    green because <reason>". Never lie about CI state.
  - PAT line: keep it generic ("provided at session start"). The actual
    token is passed verbally/in-band, NEVER written to the handover.
-->

---

## COMPLETED THIS SESSION

> **Purpose:** The narrative record of what was done and WHY. This is the
> most-read section. Mandatory. Structure each task as a labelled sub-section.

<One-paragraph overview: how many commits, what was the starting state
(e.g. "started by checking the S<N-1> HEAD CI — found a red X"), and which
next-actions were executed vs deferred and why.>

### Task 0 — `<short title>` (commit `<sha>`) — `<next-action ref>` <RESOLVED | WIP>

**Handover directive (`S<N-1>`):** "<quote the exact next-action text from
the previous handover, so the next agent can verify you addressed the
real directive, not a reinterpretation>"

**Implementation:** <2-6 sentences. What changed, where, and the key design
decision. Reference line numbers if helpful. Don't dump code — the diff is
in the commit.>

**Files:**
- `<path>` — <one-line summary of the change in this file>
- `<path>` — <...>

**Verified:** <test counts before → after, e.g. "43 → 52 assertions (+9).
All `<suite>` regression tests pass (0 failed). tsc baseline unchanged
(5 pre-existing, 0 new). CI on `<sha>`: 9/9 ALL GREEN.">

<!--
  ANNOTATION — per-task sub-structure:
  - The 4 labelled parts (Directive / Implementation / Files / Verified)
    make the section skimmable. An agent re-checking your work reads
    "Verified" first; an agent continuing the work reads "Directive" +
    "Implementation".
  - "Handover directive" MUST quote the prior handover verbatim — this is
    the audit trail. If you deviated from the directive, say so explicitly.
  - Task numbering: "Task 0" = flake fix / unblocker (if any); "Task 1+"
    = the planned next-actions. This convention separates "I had to fix a
    red X first" from "I executed the planned work".
  - RESOLVED vs WIP: mark each task. A WIP task in the handover is OK if
    you ran out of time, but the "Verified" line must be honest about what
    passes vs what's unfinished.

  ANNOTATION — what NOT to include:
  - Don't paste full code blocks (the commit has them). Reference file +
    line range instead.
  - Don't speculate about future sessions beyond the next-actions list.
  - Don't restate the RFC/design doc — link it.
  - Don't list every test file if only 2-3 are relevant; the full list
    goes in "TEST STATUS".
-->

<!-- FLAKE-FIX SUB-TEMPLATE — use when a task is "fix a CI red X flake":
### Task 0 — CI flake fixes (commit `<sha>`) — `<prior HEAD>` red X RESOLVED

**The red X:** `<prior-HEAD-sha>` CI chunk `<N>` failed: `<test file> §<id>`
— `<exact error message>`. Root cause: `<RNG path | test-isolation issue |
parallel-load timing>`. Reproduced locally ~`<X>`% failure rate.

**Fix (deterministic):** <the change — usually one of: (a) give a test
creature a 2nd action so history-rotation doesn't skip, (b) skip an
assertion when an RNG edge case makes it unverifiable, (c) clear a
side-channel state field, (d) force a deterministic seed>.

**Verified:** `<suite>` `<old>`/`<fail>` → `<new>`/0. `<N>`/`<N>` local
runs pass (was ~`<X>`% failure). CI on `<sha>`: 9/9 ALL GREEN.
-->

---

## TEST STATUS

> **Purpose:** The full test accounting — what passed, what changed, what
> regressed. Mandatory if the project has tests.

- **New/updated tests (`<N>` files):**
  - `<test-file>` — `<count>` passed, 0 failed (was `<old>` in `S<N-1>`; `+<delta>`: `<what was added>`)
  - `<test-file>` — `<...>`
- **Regression (all 0 failed):**
  - `<test-file>` — `<count>` passed.
  - `<test-file>` — `<count>` passed.
  - `<...>`
- **Full CI suite:** <note on local full-suite feasibility, e.g. "local
  full-suite run hits sandbox memory limits (parallel OOM) — same as
  `S<N-1>`. CI on GitHub is the definitive check. `<HEAD-sha>` = X/X ALL GREEN.">

<!--
  ANNOTATION:
  - "New/updated" = files you touched this session, with before→after counts.
  - "Regression" = files you DIDN'T touch but re-ran to confirm no breakage.
    List the ones most likely to be affected by your change (same subsystem,
    shared types, etc.). A full list of every test file is optional but
    helps the next agent know the baseline.
  - If a regression test FAILED and you couldn't fix it, do NOT hide it —
    list it with "FAILED" and explain in OPEN BLOCKERS.
  - The "Full CI suite" note is important if local runs can't reproduce CI
    (parallelism, memory, env differences). State the workaround.
-->

---

## BUILD / TSC STATUS

> **Purpose:** Track the type-checker / linter / build baseline so a future
> agent knows whether a new error is theirs or pre-existing. Mandatory if
> the project has a build step. Rename to match your toolchain (TSC / ESLint
> / cargo check / go vet / etc.).

`<build/lint command>` baseline: **`<N>` pre-existing errors, 0 new errors.**
(Same `<N>` as Sessions `<range>`: `<brief description of the pre-existing
errors>`. The `S<N>` changes are `<summary of what you changed>`. CI does
`<run / not run>` the build.)

<!--
  ANNOTATION:
  - "Pre-existing" = errors that existed before this session AND are
    unrelated to your changes. Pin the count so the next agent can detect
    regressions: if they see N+1, one is new.
  - "0 new errors" is the assertion. If you have new errors, either fix
    them or explicitly call them out (and they'd better be in test files,
    not source, with a justification).
  - If CI runs the build, say so — then a CI green is sufficient proof.
    If CI does NOT run the build (only tests), the local baseline is the
    only check, so it's critical to record.
-->

---

## CI STATUS

> **Purpose:** Per-commit CI verdicts so the next agent knows the exact
> green/red state of every commit this session. Mandatory if CI exists.

- **`<sha>` (`<short description>`):** **`<X/X ALL GREEN | RED X on chunk Y>`** — `<one-line elaboration: what passed, what failed, why>`.
- **`<sha>` (`<...>`):** `<...>`
- **`<HEAD-sha>` (HEAD):** `<verdict | pending at handover-write time — expected all green because <reason>>`

<!--
  ANNOTATION:
  - List EVERY commit this session, oldest → newest, with its CI verdict.
  - "ALL GREEN" = all check-runs success. If your repo has deployment
    suites that stay "queued" (e.g. github-pages/vercel that don't fully
    run), note that pattern ONCE and treat queued-non-github-actions as
    non-failure: "github-pages/vercel suites 'queued' = normal non-failure
    state, identical to verified-green `<prior-HEAD>`."
  - For a pending HEAD, give a calibrated expectation: "expected all green
    because <the change is <scope>; <suite> tests pass locally>". If it
    later fails, the next agent knows to investigate.
  - NEVER claim green without the API check. `curl ... /check-runs` is the
    source of truth, not `git push` succeeding.
-->

---

## OPEN BLOCKERS

> **Purpose:** Anything that stops the next agent or breaks the build.
> Mandatory (write "None." if empty — don't omit the section).

None.

<!-- ANNOTATION:
  - A blocker is: a failing test you can't fix, a merge conflict, a
    missing dependency, an unreleased token, an environmental issue.
  - "None." is the most common entry. Don't invent blockers.
  - If there IS a blocker, format as:
    - **<blocker title>:** <description + reproduction + suggested fix>.
-->

---

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

> **Purpose:** The ordered to-do list for the next session. This is the
> second-most-read section (after COMPLETED). Mandatory.

The carry-overs from `S<N-1>` + `<N>` NEW follow-ups from `S<N>`:

### 1. `<task title>` (`<origin session>`, <status>, `<risk>`)

<2-4 sentence description. What's done, what remains, why the risk level.>

### 2. `<task title>` (`<origin>`, <status>, `<risk>`)

<...>

<!--
  ANNOTATION:
  - Numbering is PRIORITY order (1 = do first), not chronological.
  - Each entry's header format: "N. Title (origin-session, STATUS, RISK)".
    - origin-session: where the task was first raised (e.g. "S104").
    - STATUS: "unchanged" | "updated for S<N>" | "RESOLVED in S<N>" |
              "NEW from S<N>" | "KNOWN".
    - RISK: LOW | MEDIUM | HIGH (see legend below).
  - When a task is RESOLVED, KEEP it in the list with "RESOLVED in S<N>"
    for 1-2 sessions (audit trail), then drop it.
  - Group: resolved tasks can be a quick batch at the end ("### 4-7.
    <batch of resolved tasks> — all RESOLVED in S<N>").

  RISK-LEVEL LEGEND (standardize for your project):
  - LOW: helper/regex/test-only; dispatch path unchanged; a flake fix.
    Autonomous-OK. If CI goes red, it's a flake or a wrong expected-value.
  - MEDIUM: touches shared dispatch / scoring / a hot path; could regress
    combats. Autonomous-OK WITH CARE: run the full regression suite +
    bestiary/integration sweep before committing.
  - HIGH: rewrites a core subsystem, reorders dispatch, changes a public
    type. NOT autonomous-OK — flag for a dedicated session or human review.
  - "Out of scope for an autonomous session" = HIGH, or MEDIUM with a
    subjective objective metric (e.g. score-weight tuning needs a human
    to judge "better").
-->

---

## CI FAILURE RECOVERY

> **Purpose:** If the next agent sees a red X on YOUR commits, this section
> tells them exactly how to diagnose + reproduce. Mandatory if CI exists.

If any `S<N>` commit has a red X on CI:

1. **Identify the failing chunk(s)** via the check-run logs. `<list which
   commits were already verified green>`; `<the HEAD or a specific commit>`
   is the one that could fail.
2. **`<sha>` (`<description>`):** <per-commit recovery note — what the
   change was, what to check if it fails>. If `<test file>` fails, check
   whether `<specific assertion>` has a wrong expected value (the weights
   are computed by hand in the comments — verify the arithmetic).
3. **`<sha>` (`<...>`):** <...>
4. **Reproduce locally** with `<exact repro command, including --parallel N
   flag if needed to avoid OOM>`.
5. **Known flake:** `<test-file>` under `<condition>` — `<passes standalone?
   re-trigger with empty commit? skip-on-RNG?>`. `<other flakes fixed in
   prior sessions>`.

<!--
  ANNOTATION:
  - One bullet per commit this session (skip the verified-green ones if
    they're trivially green, but DO include any commit that was pending
    at handover-write time).
  - The "Reproduce locally" command must be COPY-PASTABLE. Include the
    --parallel flag if your local env is memory-constrained.
  - "Known flake" is a running list — add new flakes you discover, note
    when old ones get fixed. This is the most valuable long-term section:
    it turns "mysterious CI red X" into "oh, that flake, re-trigger".
-->

---

## KEY FILES THIS SESSION

> **Purpose:** A quick-scan index of what changed where. Mandatory.
> Optional but recommended: ARCHITECTURAL NOTES (next section) explains
> WHY; this section is the WHAT.

### New
- `<path>` — <one-line description>

### Modified
- `<path>`:
  - <bullet per logical change in this file, with the section/line if large>
  - <...>
- `<path>`:
  - <...>

### Archived
- `<old-path>` → `<new-path>` (per `<AGENTS.md | project convention>` "latest 2 in root" rule; `<S<N-1> + S<N>>` now in root).

<!--
  ANNOTATION:
  - "New" = files created this session (including the handover itself).
  - "Modified" = files changed, with SUB-BULLETS per logical change (not
    per line). This is more useful than a diffstat because it explains
    intent.
  - "Archived" = files moved (usually old handovers → HandoverOld/). State
    the rule that triggered the archival.
  - If your project has a "latest 2 handovers in root" convention, this
    is where you record the archival.
-->

---

## ARCHITECTURAL NOTES

> **Purpose:** The "why" behind non-obvious decisions. Optional but
> HIGHLY recommended for any task with a design tradeoff. Skip for
> trivial tasks.

### Why `<decision A>`

<2-6 sentences. The constraint, the options considered, why this one. A
future agent maintaining this code will read this before changing it —
give them the context that ISN'T in the code comments.>

### Why `<decision B>`

<...>

<!--
  ANNOTATION:
  - One sub-section per non-obvious decision. Title = the decision
    ("Why the bestiary MEAN AC (not the full distribution)").
  - This section is the hardest to write well but the most valuable in
    6 months. Err on the side of including a note.
  - DON'T repeat what the code comments say — link to them ("see the
    doc comment in `<file>` L<n>"). This section is for the CROSS-CUTTING
    rationale (why this approach vs alternatives), not the line-level.
  - If you considered and rejected an approach, say so: "Option (a)
    (reorder dispatch) would have given target-specific AC but is MEDIUM
    risk; option (b) (helper refinement) achieves most of the value at
    LOW risk. Residual inaccuracy tracked in next-action #N."
-->

---

## CROSS-STREAM COORDINATION

> **Purpose:** What parallel agents (in other streams) must know to avoid
> merge conflicts or duplicate work. Optional — include only if your
> project runs multiple agent streams in parallel (z/SHEET/CORE model).

- **`<stream>` stream:** <what they should know / what you touched in
  their territory (with justification) / what they should NOT redo>
- **`<stream>` stream:** <...>

<!--
  ANNOTATION:
  - In a multi-stream project, this section is CRITICAL. If you (a z-stream
    agent) touched a SHEET file (with user authorization), record it here
    so the SHEET agent's next session doesn't redo it or get surprised.
  - Format: one bullet per sibling stream. State: (a) what you did that
    affects them, (b) what they should do next, (c) what they should NOT
    need to do (because you did it).
  - If your project is single-stream, delete this section entirely.
-->

---

## DISCOVERIES RELEVANT TO NEXT TASK

> **Purpose:** Findings that aren't tasks themselves but shape the next
> tasks (stale docs, already-implemented features, architectural facts).
> Optional. Common in SHEET/CORE handovers; less common in z.

- <bullet per discovery>
- <...>

<!--
  ANNOTATION:
  - "DISCOVERIES" = facts you learned that the next agent needs but that
    don't fit in a next-action. Examples:
      "TASK.md is stale — TG-025 is listed as not-started but was already
       implemented in computeArmorAC (line 126)."
      "Monsters are NOT persisted as CharacterSheets — they spawn live in
       the simulate panel. A full monster-sheet path would touch 6 files."
  - Keep each bullet to 1-3 sentences. If it needs more, it's probably a
    next-action or an architectural note.
-->

---

## VERIFICATION SNAPSHOT

> **Purpose:** The exact commands + outputs that prove the session ended
> clean. Mandatory — this is the "receipt" that the handover is truthful.
> Copy-paste actual command output (trimmed), not aspirations.

- `git log --oneline -<N>` (local, post-push): `<sha>` (`<desc>`), `<...>`
- `git status` → clean (`<N>` commits pushed; `<archival note>`)
- `<build/lint command>` → **`<N>`** (pre-existing, unchanged)
- `<test command> <test-file>` → **`<count>` passed, 0 failed** (was `<old>`; `+<delta>`)
- `<test command> <test-file>` → **`<count>` passed, 0 failed** (`<regression note>`)
- `<... more test commands ...>`
- **CI on GitHub:**
  - `<prior-HEAD-sha>` (`<desc>`) → **`<verdict>`** (<context>).
  - `<sha>` (`<desc>`) → **`<verdict>`**.
  - `<HEAD-sha>` (HEAD) → **`<verdict>`**.

<!--
  ANNOTATION:
  - This is the MOST IMPORTANT section for trust. Every claim in the
    handover should be backed by a line here.
  - Commands must be the EXACT ones you ran, with real output. Don't
    write "all tests pass" — write the command + the "Results: N passed"
    line you actually saw.
  - The CI bullet must match the CI STATUS section. If CI was pending at
    write time, say "pending (expected all green because <reason>)" and
    the next agent verifies on pickup.
  - Order: git state → build → tests (new/updated first, then regression)
    → CI. This mirrors the Quick-Start checklist order.
-->

<!--
╔══════════════════════════════════════════════════════════════════════════╗
║  END OF TEMPLATE                                                         ║
║  Before committing your filled-in handover:                              ║
║   ☐ Deleted ALL <!-- ANNOTATION: ... --> blocks                          ║
║   ☐ Deleted ALL > **Purpose:** ... blockquotes                           ║
║   ☐ Replaced ALL <PLACEHOLDERS> with real content                        ║
║   ☐ Removed sections marked "delete if not applicable"                   ║
║   ☐ CI on the new HEAD is verified ALL GREEN (or red X is explained)     ║
║   ☐ Archived the N-2 handover per the "latest 2 in root" rule            ║
║   ☐ The handover commit itself is pushed + CI-verified                    ║
╚══════════════════════════════════════════════════════════════════════════╝
-->
