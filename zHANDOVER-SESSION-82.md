# HANDOVER-SESSION-82

## REPOSITORY

- Branch: main
- Commits this session (oldest → newest):
  - `110094f` — Session 81: GoI caster-inside-barrier (PHB p.245) — casterId param on isProtectedByGoI
  - `2230fc1` — Session 81: RFC-COMBINING-EFFECTS Phase 2 — sourceTurnExpires on Sunburst + Color Spray
  - `81a541d` — Session 81: Ready action defensive no-op stub — break fall-through to Bardic Inspiration
- Previous: `6b17713` (Session 81 handover), `4f77b49` (Session 80 Part 2 Eldritch Blast)
- State: clean, pushed
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

### Part 1: GoI caster-inside-barrier (PHB p.245) — commit `110094f`

**Context:** Session 81 handover "IMMEDIATE NEXT ACTIONS" #5 (LOW risk). When the GoI caster is also the attacking spell's caster, their own spells are cast from INSIDE the barrier and should affect all creatures within it (including allies). Previously `filterGoIProtectedTargets` only excluded the GoI caster themselves (via the `t.id === casterId` short-circuit), leaving allies within the GoI radius wrongly filtered out.

**Implementation:**

1. **`isProtectedByGoI()`** (`src/engine/spell_effects.ts`) — New optional 4th parameter `casterId?: string`. When the spell's caster IS the GoI caster who owns a given barrier (`casterId === barrier center's id`), that barrier provides NO protection and is skipped. This applies to both the self-GoI check (branch 1) and the nearby-GoI-caster check (branch 2). Backward compatible: if `casterId` is omitted, the caster is assumed outside every barrier (pre-Session 81 behavior — used by persistent damage-zone tick sites).

2. **`filterGoIProtectedTargets()`** — Now forwards `casterId` to `isProtectedByGoI`. The `t.id === casterId` short-circuit is retained (defensive guard + clarity).

3. **`combat.ts` single-target pre-dispatch check** (line ~3085) — Now passes `actor.id` as `casterId` so a barrier the caster is inside provides no protection (same fix, single-target path).

4. **Metadata** (`src/spells/globe_of_invulnerability.ts`) — New flag `globeOfInvulnerabilityCasterInsideV1Implemented: true`. Header comments updated.

**Scope decision (important):** Only the IDENTITY case (caster === GoI caster) is handled. The broader RAW reading — that ANY combatant standing within the barrier's 10-ft radius counts as "inside" — is intentionally NOT applied. Reason: the existing AoE test suite (sessions 77-79) positions external attacking casters within 10 ft of GoI-protected targets and asserts protection still applies. Extending to the spatial case would require re-positioning those attackers outside the radius and is tracked as a follow-up. This is documented in the `isProtectedByGoI` docstring.

**Persistent damage-zone tick sites** (combat.ts:~6579 + ~18 per-spell `goiBlocked` call sites) call `isProtectedByGoI()` WITHOUT `casterId` (backward compat → old behavior). Their semantics (zone persists after caster moves; "cast from outside" determination is ambiguous for ongoing ticks) are tracked as a separate follow-up. No regression.

### Part 2: RFC-COMBINING-EFFECTS Phase 2 — sourceTurnExpires on Sunburst + Color Spray — commit `2230fc1`

**Context:** Session 81 handover "IMMEDIATE NEXT ACTIONS" #4 (MEDIUM risk). "Some non-concentration spell modules still need `sourceTurnExpires` populated." `reevaluateEffects` already expires effects by `sourceTurnExpires` (effect_pipeline.ts:81) — Phase 2 just makes spell modules populate it.

**Survey findings (for future sessions):** Of 36 spell files with `sourceIsConcentration: false`, only 5 previously set `sourceTurnExpires` (mage_armor, blindness_deafness, cause_fear, charm_person, charm_monster). The remaining 31 candidates fall into categories — most do NOT cleanly fit `sourceTurnExpires`:
- **End-of-next-turn / 1-round** (NOT round-based, handled by a different mechanism): antagonize, booming_blade, command, melf_s_acid_arrow, power_word_stun, spray_of_cards, shield, tidal_wave, earth_tremor, destructive_wave (prone).
- **Save-ends** (NOT a fixed duration): psychic_scream, power_word_pain.
- **Dispel-only / huge duration** (effectively permanent in combat): feeblemind (60 days, dispel-only), geas (30 days), hallow (until dispelled), plant_growth (instantaneous→permanent).
- **Concentration** (not Phase 2): sunbeam, dark_star.
- **Zones/weapons** (own expiry via ticks/turns): cordon_of_arrows, grease, spiritual_weapon.
- **24-hr non-concentration** (could set `sourceTurnExpires = round + 2880`, harmless but low-value): animal_friendship, mass_suggestion.
- **Clean 1-min non-concentration round-based** (the good Phase 2 targets): **sunburst**, **color_spray**, pyrotechnics.

**Implementation (the 2 cleanest candidates, mirroring Blindness/Deafness exactly):**

1. **`src/spells/sunburst.ts`** — Blinded `condition_apply` effect (PHB p.284: "blinded for 1 minute") now carries `appliedTurn: round` + `sourceTurnExpires: round + 10`. The end-of-turn CON save to end blindness early remains a separate unimplemented simplification (same gap as Blindness/Deafness — only the 1-min outer cap is now tracked). Metadata: `sunburstBlindnessDurationV1Simplified: false`, `sunburstBlindnessDurationV1Implemented: true`.

2. **`src/spells/color_spray.ts`** — Blinded `condition_apply` effect (PHB p.222: blinded for 1 minute) now carries `appliedTurn: round` + `sourceTurnExpires: round + 10`. Same save-ends simplification note. Metadata: `colorSprayBlindedDurationV1Implemented: true`.

**Remaining Phase 2 candidates** (for a future session): pyrotechnics (1-min blinded, clean); animal_friendship + mass_suggestion (24-hr charmed, low-value but harmless). Each needs PHB duration verification before adding.

### Part 3: Ready action defensive no-op stub — commit `81a541d`

**Context:** Session 81 handover "IMMEDIATE NEXT ACTIONS" #3 (MEDIUM-HIGH risk). "Currently a STUB in combat.ts — the case 'ready': falls through."

**Finding:** The `case 'ready':` label FELL THROUGH to `case 'bardicInspiration':` (no `break` between them). The AI planner NEVER emits a `'ready'` plan today (no heuristic for when/what to ready — confirmed via grep: no `type: 'ready'` in `src/ai/`), so this was a DORMANT bug — but if a `'ready'` plan ever surfaced it would have incorrectly granted a Bardic Inspiration die to the target.

**Implementation:** `case 'ready':` is now its own branch — a defensive no-op stub that:
- Logs the action (using `plan.description` or a default "X takes the Ready action (not yet implemented — action spent, no trigger set).").
- Consumes `actor.budget.actionUsed = true` (so the turn still progresses).
- `break`s (no fall-through to Bardic Inspiration).

This prevents the latent bug and documents intent while the full feature is pending. Full Ready Action implementation requires: (1) a planner heuristic for when to ready and what trigger+action to set; (2) a `readiedAction` field on Combatant storing the trigger + action; (3) trigger-evaluation hooks after movement/attacks/spell-casts; (4) firing the readied action as a reaction (consuming `budget.reactionUsed`); (5) clearing the readied action at the start of the creature's next turn if unused. This needs an RFC for the trigger taxonomy + AI heuristic + reaction plumbing — NOT attempted this session (too high-risk for one autonomous session).

## TEST STATUS

### New test files this session

- `src/test/session81_goi_caster_inside.test.ts`: 39/39 ✅ (7 phases: self-GoI, ally/enemy in radius, external attacker backward compat, multiple GoI casters mixed inside/outside, Fireball end-to-end integration, metadata, source presence)
- `src/test/session81_source_turn_expires.test.ts`: 25/25 ✅ (6 phases: effect carries appliedTurn/sourceTurnExpires for Sunburst + Color Spray; blinded present at round 1 + round 11 boundary; blinded removed at round 12 via reevaluateEffects; metadata; source presence)
- `src/test/session81_ready_stub.test.ts`: 9/9 ✅ (3 phases: synthetic 'ready' plan dispatch — action consumed, logged, NO Bardic Inspiration die applied (fall-through bug gone); default description; source presence)

### Updated existing tests

- `src/test/session80_goi_radius.test.ts`: test 4b FLIPPED (ally near GoI caster now NOT filtered when GoI caster is attacker — was the documented buggy assertion); added 7e metadata assertion for `globeOfInvulnerabilityCasterInsideV1Implemented`. 37/37 ✅.

### Regression checks (all green)

- GoI family: session77 (48), session78 (57), session79 (51), session80 (37), session72_upcasting (77), combining_effects (114) — all ✅.
- Spell-specific: sunburst (46), color_spray (57), eldritch_blast (53), eldritch_invocations (50), repelling_blast (37), more_eldritch_invocations (56), thirsting_blade (24), cantrip_pipeline (67) — all ✅.
- Combat-adjacent (Ready stub): combat (50), mechanics (57), bardic_inspiration (27), cunning_action (53), action_surge_dash_disengage (18) — all ✅.
- Full suite: all 6 CI chunks green (~22.6k assertions across 407 files).

## TSC STATUS

`npx tsc --noEmit` baseline unchanged: **5 pre-existing errors, 0 new errors from this session.** (Pre-existing: combat.ts:2580/2600 + utils.ts:601 `Record<string,unknown>` casts; monster_spellcasting.test.ts:602/609 `lich.monsterSpellSlots` possibly-undefined.)

## CI STATUS

- `110094f` (GoI caster-inside): 9/9 check-runs `success` ✅ — **no red X**
- `2230fc1` (sourceTurnExpires): 9/9 check-runs `success` ✅ — **no red X**
- `81a541d` (Ready stub): build/deploy/report-build-status `success`; 6 test chunks completed `success` ✅ — **no red X** (verified before handover commit)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

### 1. Verify CI green on `81a541d` (Ready stub)

Verified before this handover commit: all 9 check-runs `success` ✅.

### 2. RFC-MONSTER-SPELLCASTING Phase 3 (MEDIUM-HIGH risk) — unchanged from Session 72

Daily-use abilities: Recharge (Dragon Breath 5-6), Lair Actions (initiative 20), Legendary Actions (partially implemented). Phase 4 (bespoke dispatch for ~267 spells) was completed in commit `819bc0b` (Session 75-76).

### 3. Ready Action full implementation (MEDIUM-HIGH risk) — design needed

The defensive stub (`81a541d`) prevents the fall-through bug, but the full feature needs an RFC covering:
- Trigger taxonomy (enemy enters range, enemy casts a spell, ally is attacked, etc.)
- AI heuristic for when to Ready (vs. just acting now)
- `readiedAction` state on Combatant
- Trigger-evaluation hooks in the turn loop (after movement, attacks, spell-casts)
- Reaction-firing mechanism (consumes `budget.reactionUsed`; must coexist with Shield / Counterspell / opportunity attacks)
- Cleanup at start of the readier's next turn (unused readied action is lost)

### 4. RFC-COMBINING-EFFECTS Phase 2 remaining (MEDIUM risk) — partially done

`sourceTurnExpires` now populated on 7 non-concentration spells (mage_armor, blindness_deafness, cause_fear, charm_person, charm_monster, **sunburst**, **color_spray** — last 2 this session). Remaining clean candidates (see survey in Part 2 above):
- **pyrotechnics** (1-min blinded, non-concentration) — cleanest next target.
- animal_friendship + mass_suggestion (24-hr charmed, non-concentration) — harmless but low-value (combat won't reach 24 h).
- All other candidates are end-of-turn / save-ends / dispel-only / concentration / zones — do NOT fit `sourceTurnExpires`.

### 5. GoI broader RAW reading (LOW risk) — deferred

The "any combatant within the 10-ft radius counts as inside" interpretation (not just the GoI caster themselves). Would require re-positioning the sessions 77-79 AoE test attackers outside the 10-ft radius. Documented in `isProtectedByGoI` docstring.

### 6. GoI persistent damage-zone tick caster-inside (LOW risk) — deferred

combat.ts:~6579 + ~18 per-spell `goiBlocked` call sites call `isProtectedByGoI()` without `casterId`. Semantics for persistent zones (zone persists after caster moves) are ambiguous; left as backward-compat (old behavior). Could pass `zone.casterId` for consistency in a future session.

### 7. Eldritch Blast multi-target per beam (LOW risk) — deferred

RAW allows directing different beams at different targets. For v1, all beams target the same enemy. Multi-target requires AI planner changes to emit per-beam targeting instructions.

## CI FAILURE RECOVERY

If any of `110094f` / `2230fc1` / `81a541d` has a red X on CI:

1. **Read the failing check-run logs** via GitHub API.
2. **Most likely failure mode for `110094f`:** the `casterId` param change to `isProtectedByGoI` regressing a call site that now receives the 4th arg unexpectedly — but all existing call sites either pass no 4th arg (backward compat) or were updated. Check session77/78/79 GoI AoE tests.
3. **Most likely failure mode for `2230fc1`:** a test that runs a combat >10 rounds with Sunburst/Color Spray blinded and asserts the blinded is still present. Check sunburst.test.ts / color_spray.test.ts / any combat scenario test.
4. **Most likely failure mode for `81a541d`:** a test that constructs a `type: 'ready'` PlannedAction (previously falling through to Bardic Inspiration) and asserts the Bardic Inspiration die is set — now it won't be. Unlikely (planner never emits 'ready'), but check bardic_inspiration / cunning_action tests.
5. **Fix forward** on a new commit.

## KEY FILES THIS SESSION

### Modified

- `src/engine/spell_effects.ts` — `isProtectedByGoI()` gains optional `casterId` param (skip barriers the caster owns); `filterGoIProtectedTargets()` forwards it
- `src/engine/combat.ts` — single-target GoI pre-dispatch passes `actor.id`; `case 'ready':` is its own defensive no-op stub (no fall-through to Bardic Inspiration)
- `src/spells/globe_of_invulnerability.ts` — `globeOfInvulnerabilityCasterInsideV1Implemented: true`; header comments
- `src/spells/sunburst.ts` — blinded effect gets `appliedTurn` + `sourceTurnExpires: round + 10`; metadata flags
- `src/spells/color_spray.ts` — blinded effect gets `appliedTurn` + `sourceTurnExpires: round + 10`; metadata flag
- `src/test/session80_goi_radius.test.ts` — test 4b flipped; 7e metadata assertion added

### New

- `src/test/session81_goi_caster_inside.test.ts` — 39 assertions, 7 phases
- `src/test/session81_source_turn_expires.test.ts` — 25 assertions, 6 phases
- `src/test/session81_ready_stub.test.ts` — 9 assertions, 3 phases

## ARCHITECTURAL NOTES

### GoI caster-inside approach

The fix reuses the existing `isProtectedByGoI` two-branch structure (self-GoI + nearby-GoI-caster). A new `isCasterInsideBarrier(center)` closure checks `casterId === center.id`. When true, that barrier is skipped (no protection). The check is applied in BOTH branches:
- Branch 1 (self-GoI on target): `if (selfGoI && !isCasterInsideBarrier(target)) return true;`
- Branch 2 (nearby GoI caster `c`): `if (chebyshev ≤ 2 && !isCasterInsideBarrier(c)) return true;`

This correctly handles the multi-GoI-caster case: if the attacker is GoI caster A and the ally is within both A's and B's radii, barrier A is skipped (attacker inside) but barrier B still protects (attacker outside B) → ally protected by B. Verified by test 4a.

### sourceTurnExpires pattern

The 1-min duration is the OUTER CAP (`sourceTurnExpires = round + 10`). The end-of-turn CON save to end blindness early is a SEPARATE inner mechanic (not modeled — same gap as Blindness/Deafness). `reevaluateEffects` removes the effect when `round > sourceTurnExpires` (boundary: round 11 = sourceTurnExpires 11 → still active; round 12 → expired). This is exactly the Blindness/Deafness reference pattern.

### Ready stub defensive design

The stub consumes `actionUsed` (so the turn progresses) and logs, but does NOT set a trigger or consume a reaction (since no readied action is stored). This means a 'ready' plan is effectively a wasted action — which is the correct conservative behavior until the full feature lands. The stub's existence also means future planner work can emit 'ready' plans without risking the Bardic Inspiration fall-through.

## VERIFICATION SNAPSHOT

- `git log --oneline -5`: `81a541d`, `2230fc1`, `110094f`, `6b17713`, `4f77b49`
- `git status` → clean working tree (after pushes)
- `npx tsc --noEmit 2>&1 | grep "error TS" | wc -l` → **5** (pre-existing, unchanged)
- Key test files: all pass (GoI family, sunburst, color_spray, combat, mechanics, session81 tests)
- CI on `110094f` / `2230fc1` / `81a541d`: all 9 check-runs `success` ✅
- **NO RED X**
