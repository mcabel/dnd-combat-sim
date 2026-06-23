# zHANDOVER-SESSION-6

## REPOSITORY

- Branch: main
- Prior commits (cantrip workstream):
  - `bc4d033` — Cantrip-3/4/5: Recover lost sessions (Chill Touch + Blade Ward + handovers)
  - `f2f40a3` — Spell-cache: per-level cache + batch picker tooling
  - `80f0357` — Spell-cache: fix reprint precedence (newest in-scope source wins)
- Commits this session: _(none yet — this is a PLANNING handover for the next implementer)_
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: user provides in chat each session. do not warn.

---

## ⚠️ WORKSTREAM OWNERSHIP — READ FIRST

| File family | Workstream | Owner |
|---|---|---|
| `zHANDOVER-SESSION-*.md` | **Cantrips** | **THIS agent (you)** |
| `HANDOVER-SESSION-*.md` | Core Engine / leveled spells | other agent — DO NOT TOUCH |
| `SHEET-HANDOVER-*.md` | Character Sheet UI | other agent — DO NOT TOUCH |

### Your priorities (cantrip workstream)

- **Your tasks come from `zHANDOVER-SESSION-*.md`.** This handover defines the batch.
- Implement cantrips per PHB (2014 rules only). The 5 originally-planned PHB cantrips (Thorn Whip, Ray of Frost, Shocking Grasp, Chill Touch, Blade Ward) are DONE. This session extends to the **next batch of 5 combat cantrips**.
- Reuse the cantrip architecture in `src/engine/cantrip_effects.ts` (three registries: `CANTRIP_EFFECTS` post-hit, `CANTRIP_ATTACK_ADVANTAGE` pre-roll, `CANTRIP_SELF_EFFECTS` self-buff).
- Do NOT create a `case 'spellName'` in `executePlannedAction` for cantrips.
- Do NOT touch sheet routes, `leveler.ts`, or `builder.ts` (TASK.md constraint).

---

## STARTUP CHECKLIST (do these before implementing)

1. `git pull` — make sure you're on the latest `main`.
2. Read `zHANDOVER-SESSION-3.md` (Chill Touch pattern) and `zHANDOVER-SESSION-4.md` (Blade Ward pattern) — these are your templates. The code you write will closely mirror them.
3. Read `SPELL-CACHE.md` — it explains the cache + picker workflow.
4. Run `npm install` (deps: ts-node, typescript).
5. Run `npm run spell-cache:build` — refresh the cache (confirm 5/49 cantrips implemented).
6. For each cantrip below, run `npm run spell-cache:show -- "Name"` to get the full raw 5etools JSON (entries, scalingLevelDice, components) before implementing.

---

## GOALS THIS SESSION — Batch: 5 combat cantrips (all PHB 2014)

Picked from `spell-cache/level-0.json`. These 5 are chosen for **mechanical diversity**: 1 ranged attack + 4 saves (DEX×2, CON, WIS), 1 AoE, 1 cover-bypass, 1 debuff rider. Together they exercise every cantrip code path and establish patterns for future batches.

| # | Name | School | Effect | Source | Page | Module to create |
|---|------|--------|--------|--------|------|------------------|
| 1 | **Fire Bolt** | Evocation | ranged spell attack · 1d10 fire · 120 ft · +scales | PHB (2014-08-19) | 242 | `src/spells/fire_bolt.ts` |
| 2 | **Acid Splash** | Conjuration | DEX save · 1d6 acid · 60 ft · 1 or 2 targets within 5ft · +scales | PHB | 211 | `src/spells/acid_splash.ts` |
| 3 | **Poison Spray** | Conjuration | CON save · 1d12 poison · 10 ft cone · +scales | PHB | 266 | `src/spells/poison_spray.ts` |
| 4 | **Vicious Mockery** | Enchantment | WIS save · 1d4 psychic · 60 ft · +disadv on next attack · +scales | PHB | 285 | `src/spells/vicious_mockery.ts` |
| 5 | **Sacred Flame** | Evocation | DEX save · 1d8 radiant · 60 ft · ignores cover · +scales | PHB | 272 | `src/spells/sacred_flame.ts` |

### Implementation checklist (paste into the session's completion notes)

- [ ] **Fire Bolt** (`PHB p.242`) — ranged spell attack, 1d10 fire, scales at 5/11/17. Create `src/spells/fire_bolt.ts`. No post-hit rider → no `CANTRIP_EFFECTS` entry needed (damage is handled by `resolveAttack`); the module provides `metadata` only. Confirm the parser/AI can select it as a ranged spell attack.
- [ ] **Acid Splash** (`PHB p.211`) — DEX save, 1d6 acid, scales. **Targeting: 1 creature, OR 2 creatures within 5ft of each other.** This is the first multi-target cantrip. Decide: (a) implement as single-target for v1 (simplest, note the simplification), or (b) add a 2-target AoE resolution path. Recommendation: **single-target for v1**, document the simplification in the module header + handover. If the codebase already has an AoE targeting helper (check `src/engine/combat.ts` for Burning Hands / Thunderwave), follow that pattern.
- [ ] **Poison Spray** (`PHB p.266`) — CON save, 1d12 poison, 10 ft range (NOT a cone despite the "spray" name — it's a single target within 10 ft), scales. Create `src/spells/poison_spray.ts`. Save-based → rides `resolveAttack`'s save branch. No post-hit rider → `metadata` only.
- [ ] **Vicious Mockery** (`PHB p.285`) — WIS save, 1d4 psychic, scales. **Rider: target has disadvantage on the next attack roll it makes before the end of its next turn.** This is a one-shot debuff (not ongoing like Chill Touch's undead disadv). Implement via `target._viciousMockeryDisadvNextAttack = true` (new scratch field on `Combatant` in `core.ts`), checked + **consumed** in `resolveAttack` (fold into `disadvantage`, then set back to `false` after the attack resolves). Register in `CANTRIP_EFFECTS` (post-hit, on save-fail). Add `cleanup()` clearing the flag (called from `resetBudget`). **Mirror the Chill Touch disadv pattern** (zHANDOVER-SESSION-3) but with auto-consume-on-next-attack semantics.
- [ ] **Sacred Flame** (`PHB p.272`) — DEX save, 1d8 radiant, scales. **Special: "The target gains no benefit from cover for this saving throw."** The save branch in `resolveAttack` currently uses `los` for cover; Sacred Flame must bypass cover. Options: (a) add a `bypassesCover?: boolean` flag on `Action` (clean, extensible), or (b) special-case by action name (FORBIDDEN by the no-`case` rule). **Recommendation: option (a)** — add `bypassesCover?: boolean` to the `Action` interface in `core.ts`, set `true` on Sacred Flame's action, and have the save branch skip cover when set. This also benefits future spells (e.g. Word of Radiance). No post-hit rider → `metadata` only + the `bypassesCover` flag.

### Integration points you will touch (expected)

- `src/types/core.ts`: Add `_viciousMockeryDisadvNextAttack?: boolean` (Vicious Mockery). Add `bypassesCover?: boolean` to `Action` (Sacred Flame). Both optional.
- `src/engine/cantrip_effects.ts`: Add `'Vicious Mockery'` to `CANTRIP_EFFECTS` (post-hit rider on save-fail). Fire Bolt / Acid Splash / Poison Spray / Sacred Flame have no post-hit rider → no `CANTRIP_EFFECTS` entries.
- `src/engine/combat.ts`: `resolveAttack` save branch — check `action.bypassesCover` and skip cover bonus when true (Sacred Flame). `resolveAttack` attack-roll — fold `_viciousMockeryDisadvNextAttack` into `disadvantage` and consume it after the attack (Vicious Mockery).
- `src/engine/utils.ts`: `resetBudget` — add `cleanupViciousMockery` call (clears the flag if it wasn't consumed).
- **Do NOT** touch the AI planner (`src/ai/planner.ts`) — that's Core Engine territory. The engine routing is enough; AI selection is a separate task.

### Tests (write one `*.test.ts` per cantrip, in the repo's ts-node convention)

Mirror `src/test/chill_touch.test.ts` (38 tests) and `src/test/shocking_grasp.test.ts` (26 tests) for structure: custom `assert`/`eq` harness, `makeCombatant`/`makeBF`/`makeState` helpers, sections for metadata / rider / dispatcher / cleanup. Target ~15–30 tests per cantrip. Each test file must exit non-zero on failure (`process.exit(1)`).

**Critical test cases per cantrip:**
- Fire Bolt: metadata; damage type = fire; scales flag.
- Acid Splash: metadata; DEX save; scaling. If single-target v1, a test confirming it hits one target.
- Poison Spray: metadata; CON save; range = 10ft; scales.
- Vicious Mockery: metadata; WIS save; **rider applies disadv on save-fail**; **disadv consumed on next attack** (one-shot — second attack has no disadv); **rider cleared by resetBudget**; **save-success applies no rider**.
- Sacred Flame: metadata; DEX save; **`bypassesCover: true`** on the action; **cover bonus NOT applied to the save** (construct a target behind half cover and verify the save DC isn't reduced / the spell isn't blocked).

---

## DISCOVERIES / PATTERNS FROM PRIOR SESSIONS (reuse these)

1. **Cantrip module shape** (see `src/spells/chill_touch.ts`, `blade_ward.ts`): `export const metadata = { name, level:0, school, rangeFt, concentration:false, castingTime:'action', damageDice, damageType } as const;` + an `emit()` log helper + `applyCantripEffect(caster, target, state): boolean` (post-hit) or `applySelfEffect(caster, state): boolean` (self-buff) + `cleanup(combatant): void`.
2. **Scratch fields on `Combatant`** are optional (`?`), prefixed `_`, cleared by `cleanup()` from `resetBudget()`. See `_chillTouchNoHealing`, `_bladeWardActive`.
3. **Save-based cantrips** ride `resolveAttack`'s existing save branch (attackType `'save'`, `saveDC`, `saveAbility`). No new routing needed — the parser/AI must produce an `Action` with those fields. The cantrip module is only needed if there's a post-hit rider.
4. **Targeted disadvantage** (Chill Touch undead, Vicious Mockery) uses a scratch field holding the target's ID (Chill Touch) or a boolean (Vicious Mockery), folded into `resolveAttack`'s `disadvantage` boolean. Do NOT use the `vulnerabilities: AdvantageEntry[]` system — it scopes by d20-test type, not by target/one-shot.
5. **Resistance composition** lives in `applyDamageWithTempHP`'s single `hasResistance` boolean (Blade Ward pattern) — not relevant to this batch (no damage-resistance riders).
6. **Build hygiene:** run `./node_modules/.bin/tsc --noEmit` before committing. Run the full suite: `for t in src/test/*.test.ts; do timeout 75 ./node_modules/.bin/ts-node "$t" || echo "FAIL: $t"; done` (51 files, must stay green).
7. **Revert test side-effects** before committing: `git checkout -- characters/` if any fixture JSON got an `updatedAt` bump.

---

## IMMEDIATE NEXT ACTION

1. `git pull && npm install && npm run spell-cache:build`
2. Implement the 5 cantrips in the order above (Fire Bolt first — simplest; Vicious Mockery + Sacred Flame last — most involved).
3. After each: `tsc --noEmit` + run that cantrip's test.
4. After all 5: run the **full regression suite** (51 files must stay green).
5. `npm run spell-cache:build` again — confirm cantrip implemented count goes 5 → 10.
6. Commit: `Cantrip-6: Implement Fire Bolt, Acid Splash, Poison Spray, Vicious Mockery, Sacred Flame (PHB)`.
7. Write `zHANDOVER-SESSION-7.md` (next batch — use `npm run spell-cache:pick -- --level 0 --source PHB --count 5` to choose, or curate for mechanical diversity).
8. **Push to GitHub.** Tell the user explicitly if the push fails.

---

## TEST STATUS (before this session)

- `blade_ward.test.ts`: 38/38 · `chill_touch.test.ts`: 38/38 · `shocking_grasp.test.ts`: 26/26 · `thorn_whip.test.ts`: 11/11
- Full regression suite (51 files, ~2600+ tests): all green
- `tsc --noEmit`: 0 errors
- Spell cache: 557 unique spells, 5/49 cantrips implemented, 41 cantrips remaining in-scope

---

## NOTES FOR NEXT AGENT

- **Scope rule (per user):** canon pre-2024; reprints → newest in-scope source wins; XPHB (2024) out of scope. The cache handles this automatically — trust `spell-cache:pick`'s canonical-source column.
- **Creatures follow a different rule** (all variants kept) — not applicable to spells. See `SPELL-CACHE.md`.
- **Parser tech debt** (still open, documented in zHANDOVER-3/4/5): `hasMetalArmor` and `isUndead` flags exist on `Combatant` but aren't populated by the parser. Not blocking this batch.
- **AI planner** does not yet select most cantrips — engine routing is enough for this batch. AI selection is a Core Engine task.
- **Commit message convention:** `Cantrip-N: <summary>` (this session is Cantrip-6).

---

## AGENT PROTOCOL (PERPETUAL)

- **REPOSITORY:** https://github.com/mcabel/dnd-combat-sim
- **COMMIT POLICY:** Always `git add` and `git commit` the `zHANDOVER-SESSION-*.md` file to the project root directory. **MUST UPLOAD CODE/ARTIFACTS/ETC TO THE GITHUB REPO AFTER THE ZHANDOVER IS PRODUCED.** Tell the user explicitly if a push fails.
- **OUTPUT POLICY:**
  - PRIORITY: Upload/commit code/artifacts to the GitHub repo.
  - ONLY output the handover in the chat if access to the repo is somehow blocked.
  - NO summaries, no conversational filler, no "Here is the file" headers.
