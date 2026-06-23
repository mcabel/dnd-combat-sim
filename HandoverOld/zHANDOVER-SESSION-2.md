# zHANDOVER-SESSION-2

## REPOSITORY

- Branch: main
- Commits this session:
  - `e1b771c` — Cantrip-fix: declare Ray of Frost scratch fields on Combatant (fixes tsc build)
  - `a743591` — Cantrip-2: Implement Shocking Grasp cantrip (PHB p.275)
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided verbally at session start — do NOT paste in files

---

## ⚠️ WORKSTREAM OWNERSHIP — READ FIRST (carried forward for all future zHANDOVER agents)

This project has **multiple parallel agent workstreams**. Each workstream is
tracked by its own handover file family. **Filename letter case may be
case-insensitive on some filesystems** — when looking for your handover,
search case-insensitively for `zhandover`.

| File family | Workstream | Owner |
|---|---|---|
| `zHANDOVER-SESSION-*.md` | **Cantrips** | **THIS agent (you)** |
| `HANDOVER-SESSION-*.md` | Core Engine / leveled spells | other agent — DO NOT TOUCH |
| `SHEET-HANDOVER-*.md` | Character Sheet UI | other agent — DO NOT TOUCH |

### Your priorities (cantrip workstream)

- **Your tasks come from `zHANDOVER-SESSION-*.md` (the latest one), NOT from
  `TASK.md`.** `TASK.md` currently tracks the *Core Engine* workstream
  (1st-level spells: Shield/Guiding Bolt/Healing Word). Those are **NOT your
  tasks** — they belong to the Core Engine agent. Do not implement them.
- Implement cantrips per PHB (2014 rules only). Remaining cantrips:
  Chill Touch, Blade Ward (Shocking Grasp now done).
- Reuse the cantrip architecture in `src/engine/cantrip_effects.ts`
  (post-hit `CANTRIP_EFFECTS` map + pre-roll `CANTRIP_ATTACK_ADVANTAGE` map).
- Do NOT create a `case 'spellName'` in `executePlannedAction` for cantrips —
  cantrips ride the generic `resolveAttack` path. That dispatcher is for
  leveled spells (Core Engine workstream).
- Do NOT touch sheet routes, `leveler.ts`, or `builder.ts` (TASK.md constraint,
  applies to all workstreams).

### If `TASK.md` is meant to be the shared task tracker

The workstream-to-owner distinction above is NOT reflected in `TASK.md` today
(`TASK.md` lists only the Core Engine workstream). Consider asking the user
whether `TASK.md` should be split per workstream, or whether `zHANDOVER` should
remain the canonical source for cantrip-workstream priorities. Until clarified,
**zHANDOVER is authoritative for this workstream.**

---

## COMPLETED THIS SESSION

### Bug fix (pre-existing, in this workstream)

- **Ray of Frost compile break — `npm run build` (`tsc`) was BROKEN.**
  `src/spells/ray_of_frost.ts` (added in zHANDOVER-SESSION-1) used private
  scratch properties `_rayOfFrostOriginalSpeed` and `_hasRayOfFrost` on
  `Combatant` without declaring them in the `Combatant` interface. Under
  `strict: true` this produced 8× TS2339 errors, breaking the canonical build
  and any `ts-node` test that transitively loads the cantrip dispatcher (e.g.
  `thorn_whip.test.ts`). Other agents likely ran tests with `--transpile-only`
  and so did not notice.
  - **Fix** (`src/types/core.ts`): declared `_rayOfFrostOriginalSpeed?: number`
    and `_hasRayOfFrost?: boolean` (plus `hasMetalArmor?: boolean`, prepared
    for Shocking Grasp) on `Combatant`. Additive, non-breaking.
  - Verified: `tsc --noEmit` exits 0; `thorn_whip.test.ts` 11/11 passing again.
  - **Lesson for future cantrip agents:** after writing a cantrip that adds
    scratch fields to a combatant, RUN `node_modules/.bin/tsc --noEmit`
    (note: `npx tsc` hits a stub when typescript isn't on PATH — use the local
    bin or `npm run build`). Do not rely on `--transpile-only` test runs alone.

### Feature: Shocking Grasp (`src/spells/shocking_grasp.ts`)

- PHB p.275: level 0 evocation, action, touch (5 ft) melee spell attack, 1d8
  lightning damage.
- Two special mechanics:
  1. **Advantage on the attack roll vs metal-armored targets.** Implemented
     via a new pre-roll registry `CANTRIP_ATTACK_ADVANTAGE` in
     `src/engine/cantrip_effects.ts` (exported `getCantripAttackAdvantage()`),
     consulted by `resolveAttack()` in `combat.ts` before the d20 is rolled.
     Metal detection uses the new `Combatant.hasMetalArmor` flag.
  2. **On hit, target can't take reactions until its next turn.** Implemented
     as a post-hit rider in `applyCantripEffect()` by setting
     `target.budget.reactionUsed = true`. `resetBudget()` in `utils.ts`
     already restores `reactionUsed = false` at the start of the target's next
     turn — so **no dedicated `cleanup()` is needed** for this cantrip.
- Reaction-lock timing follows the codebase's Ray of Frost simplification
  ("combatant's next turn" rather than RAW "caster's next turn").

### Integration points touched

- `src/engine/cantrip_effects.ts`: added `'Shocking Grasp'` to post-hit
  `CANTRIP_EFFECTS`; added new `CANTRIP_ATTACK_ADVANTAGE` registry +
  `getCantripAttackAdvantage()` for pre-roll advantage.
- `src/engine/combat.ts`: imported `getCantripAttackAdvantage`; folded it into
  the attack-roll advantage computation in `resolveAttack()` (one line).
- `src/types/core.ts`: added `_rayOfFrostOriginalSpeed?`, `_hasRayOfFrost?`,
  `hasMetalArmor?` to `Combatant`.

### Tests

- `src/test/shocking_grasp.test.ts`: 26 tests, all passing. Covers metadata,
  metal-armor advantage gating, registry routing, reaction-lock + log,
  dispatcher integration, and `resetBudget` auto-expiry.

---

## DISCOVERIES RELEVANT TO NEXT TASK

1. **Pre-roll cantrip advantage pattern.** Some cantrips grant advantage on the
   attack roll itself (Shocking Grasp vs metal; future: possibly True Strike
   inverted). The post-hit `CANTRIP_EFFECTS` map can't serve these because
   advantage must be known *before* the d20 is rolled. The new
   `CANTRIP_ATTACK_ADVANTAGE` registry + `getCantripAttackAdvantage()` is the
   canonical place for this. Add future pre-roll-advantage cantrips there.

2. **`hasMetalArmor` is not yet populated by the parser.** The flag exists on
   `Combatant` and tests can set it directly, but `src/parser/pc.ts` only sets
   `wearingArmor` (boolean) from `acFormula` — it does not distinguish metal
   vs non-metal. To make Shocking Grasp's advantage work end-to-end for real
   PCs, a future task should populate `hasMetalArmor` in the parser from the
   known metal-armor list (chain shirt, scale mail, breastplate, half plate,
   ring mail, chain mail, splint, plate). This touches the parser (allowed;
   not in the forbidden list) but should be coordinated if the Sheet UI agent
   also depends on armor data.

3. **`resolveAttack` is not exported** from `combat.ts` (only `runCombat` and
   `makeFlatBattlefield` are). Deterministic unit tests of cantrip riders
   therefore test the module's `applyCantripEffect`/`cantripAttackAdvantage`
   directly plus the dispatcher, rather than driving `resolveAttack` itself.
   Do NOT add an `export` to `resolveAttack` just for tests without
   coordinating — it's Core Engine territory.

4. **Build hygiene.** Always run `node_modules/.bin/tsc --noEmit` (or
   `npm run build`) before committing. `npx tsc` is unreliable here (hits a
   stub). The previous cantrip agent's build break went unnoticed because
   `--transpile-only` test runs skip type-checking.

5. **Cantrip `shouldCast` not used.** Cantrips have no `shouldCast` (unlike
   leveled spells) — they ride the generic AI action-selection + `resolveAttack`
   path. Don't look for/export `shouldCast` from cantrip modules.

---

## IMMEDIATE NEXT ACTION

Implement **Chill Touch** cantrip (`src/spells/chill_touch.ts`):
- PHB p.221: level 0 necromancy, action, 120 ft ranged spell attack, 1d8
  necrotic.
- Two riders on hit:
  1. Target can't regain hit points until the start of your next turn.
     (Post-hit rider — add to `CANTRIP_EFFECTS`. Use a scratch flag on
     `Combatant`, e.g. `_chillTouchNoHealing?: boolean`, and have `applyHeal`
     in `utils.ts` check it. Add a `cleanup()` called from `resetBudget()`.)
  2. If the target is undead, it has disadvantage on attack rolls against you
     until the end of your next turn. (This is a self-buff keyed to the
     undead target — consider `grantSelf(caster, 'disadvantage'...)`? No —
     it's "undead has disadv vs YOU", i.e. a vulnerability on the *undead
     target's* attacks vs the caster. Tricky; may need a targeted
     vulnerability entry scoped to attacks vs the caster. Design carefully.)
- Register in both `CANTRIP_EFFECTS` (post-hit) and, if needed,
  `CANTRIP_ATTACK_ADVANTAGE` (Chill Touch itself grants no attack advantage,
  so likely only the post-hit map).
- Write `src/test/chill_touch.test.ts` mirroring `shocking_grasp.test.ts`.

Alternative next pick: **Blade Ward** (PHB p.218, self-buff: resistance to
B/P/S until end of your next turn). Simpler riders, but it's a self-cast
action (no attack roll) so it may need a different integration path than the
`resolveAttack` cantrip model — coordinate if unsure.

---

## TEST STATUS

- `shocking_grasp.test.ts`: 26/26 passing
- `thorn_whip.test.ts`: 11/11 passing (was broken by the Ray of Frost type
  error; now fixed)
- Regression sentinels (all green after this session's changes):
  `spell_effects` 23/0, `magic_missile` 25/0, `shield_simple` 12/0
- `tsc --noEmit`: 0 errors (build is GREEN again)
- Full-suite baseline: not re-run this session (run individual suites via
  `npx ts-node src/test/<name>.test.ts`; there is no aggregate runner script).

---

## NOTES FOR NEXT AGENT

- Cantrips implemented so far: Thorn Whip, Ray of Frost, **Shocking Grasp**.
- Cantrips remaining: **Chill Touch**, Blade Ward.
- All cantrip post-hit effects → `CANTRIP_EFFECTS` in `cantrip_effects.ts`.
- All cantrip pre-roll advantage → `CANTRIP_ATTACK_ADVANTAGE` in `cantrip_effects.ts`.
- Cantrip scratch fields on `Combatant` are optional (`?`) and cleared by each
  module's `cleanup()` from `resetBudget()`. Shocking Grasp is the exception:
  it needs no cleanup because it only sets `reactionUsed` (auto-reset by
  `resetBudget`).
- **Remember:** your priority is the cantrip workstream (zHANDOVER). Do NOT
  implement Guiding Bolt / Healing Word / other TASK.md spell items — those
  belong to the Core Engine agent. Do NOT edit `HANDOVER-SESSION-*` or
  `SHEET-HANDOVER-*` files. When you finish, write `zHANDOVER-SESSION-3.md`
  (case-insensitive: `zhandover-session-3.md` is fine too) and commit it.
- Commit message convention: `Cantrip-N: <summary>` (this session was Cantrip-2).
