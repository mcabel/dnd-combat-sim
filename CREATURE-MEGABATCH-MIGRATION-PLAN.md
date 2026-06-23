# CREATURE-MEGABATCH-MIGRATION-PLAN.md — Creature Mechanics Megabatch (Sessions 52+)

> **Purpose:** This document is the complete specification for a multi-session effort to
> implement REAL mechanical effects for every creature/monster ability that the generic
> 5etools parser currently drops. It mirrors the structure and discipline of
> `MEGABATCH-MIGRATION-PLAN.md` (which migrated 124 spells across Sessions 24-27).
>
> **Audience:** Any agent (human or AI) continuing the creature workstream. Read this
> ENTIRE file before starting any batch.
>
> **Source analysis:** `CREATURE-MEGABATCH-ANALYSIS.json` (453 unique creatures analyzed,
> 252 HIGH / 61 MED / 140 LOW priority). Do NOT re-run the analysis — it's done. Use the
> per-creature `patterns` / `blocked_reasons` fields as the work spec. The generator script
> is `scripts/creature_analysis.ts` (re-run only if `bestiaryData/` changes).
>
> **Prior work:** The creature pipeline has ALWAYS been generic — `src/parser/fivetools.ts`
> → `monsterToCombatant()` converts raw 5etools JSON into `Combatant` objects. All ~901
> loadable creatures spawn correctly, but special mechanics are silently dropped. Only 5
> trait names have mechanical checks today (Pack Tactics, Mounted Combatant, Fighting Style
> Protection/Interception, Reckless Attack). Legendary *actions* ARE wired (pool + off-turn
> firing at `combat.ts:2712, 5784`); legendary *resistance* is NOT.

---

## EXECUTIVE SUMMARY

| Batch | Creatures lighted up | Pattern focus | Mirror creatures | Est. effort | Risk |
|-------|---------------------|---------------|------------------|-------------|------|
| **Batch 0** | 453 (infra) | Reprint-safe loader keying + duplicate-file dedupe + collision subname suffix | Goblin, Tarrasque | ~2 hrs | LOW |
| **Batch 1** | up to 439 | Damage defenses: `immune` / `resist` / `vulnerable` / `conditionImmune` | Skeleton (vuln), Crawling Claw (immune), Awakened Shrub (resist) | ~4 hrs | MED |
| **Batch 2** | 127 + 277 | Save proficiencies (wired into `rollSave`) + senses/passive/skills as metadata | Flying Sword (saves), Cat (skills), Bat (blindsight) | ~3 hrs | LOW |
| **Batch 3** | 84 + 28 | `recharge` field on `Action` + Legendary Resistance trait (auto-success 3/day) | Blink Dog (recharge), Adult Brass Dragon (leg-resist) | ~5 hrs | MED |
| **Batch 4** | ~200 | Bespoke trait modules (Magic Resistance 65, Regeneration 13, Magic Weapons 19, Death Burst 8, Blood Frenzy 7, Incorporeal Movement 8, Avoidance 2, Charge 14, Pounce 6, Swarm 10, Superior Invisibility 7, Rejuvenation 6, Sunlight Sensitivity 18, False Appearance 22) | per-trait mirrors (see analysis `pattern_mirrors`) | ~8 hrs | MED |
| **Batch 5 (DEFERRED)** | 41 + 83 + 23 | Lair actions + monster spellcasting full lists + Shapechanger | Faerie Dragon (lair ref), Acolyte (spellcaster), Jackalwere (shapechanger) | ~15 hrs | HIGH |
| **TOTAL (0-4)** | **~450** | | | **~22 hrs** | |

**Deferred to Batch 5** (large engine-investment): 41 lair-action creatures (need an
initiative-order `lairActionTriggered` hook + lair-action JSON loader), 83 spellcasting
creatures with full spell lists (need `SPELL_DB` wiring + monster spell-slot tracking +
planner integration), 23 shapechangers (need a polymorph/transform subsystem). These are
documented in `TEAMGOALS.md` TG-007 (LOS/vision, blocks Devil's Sight + magical darkness)
and a new TG entry to be filed by the creature workstream.

**Source data caveat:** As of Session 52, `bestiaryData/` contains only `bestiary-mm-2014.json`
(MM, 450 creatures), `bestiary-mm.json` (BYTE-IDENTICAL duplicate — removed in Batch 0), and
`bestiary-dmg.json` (DMG, 3 creatures). The canonical 5etools source repo
(`TheGiddyLimit/5etools-src`) was DMCA-removed from GitHub in Aug 2024, so additional pre-2024
sourcebooks (VGM, MTF, IDrotF, etc.) cannot be auto-fetched. The reprint-disambiguation built
in Batch 0 is **forward-compatible**: when the user manually drops more `bestiary-<source>.json`
files into `bestiaryData/`, the loader + subname suffix handle collisions automatically with no
further code changes.

---

## AGENT LAUNCH PROMPT (copy-paste for the next continuation agent)

> **This prompt is self-bootstrapping.** Provide the agent this prompt plus the GitHub PAT.
>
> **Repo:** https://github.com/mcabel/dnd-combat-sim (private — needs PAT for clone + push)
>
> **Recommended prompt:**
>
> ```
> You are continuing the CREATURE MECHANICS MEGABATCH in the dnd-combat-sim GitHub repo.
>
> STEP 0 — BOOTSTRAP THE REPO (run once at the start):
>   # Replace <GITHUB_PAT> with the PAT the user gives you. Do NOT commit the PAT to any
>   # tracked file — keep it only in the clone URL (.git/config).
>   git clone https://mcabel:<GITHUB_PAT>@github.com/mcabel/dnd-combat-sim.git
>   cd dnd-combat-sim
>   npm install
>   # Confirm baseline tests are green:
>   for f in src/test/*.test.ts; do npx ts-node --transpile-only "$f" 2>&1 | grep "Results:"; done
>
> STEP 1: Read CREATURE-MEGABATCH-MIGRATION-PLAN.md (this file) IN FULL.
>         Read CREATURE-MEGABATCH-ANALYSIS.json's `summary` section + the `creatures` entries
>         for the batch you're working on.
>         Read the latest zHANDOVER-SESSION-NN.md for what the previous session completed.
>
> STEP 2: `git pull origin main` to sync.
>
> STEP 3: Determine which batch is next by checking the "Batch Status" table at the bottom of
>         this file (updated by each session). Execute the NEXT incomplete batch in order.
>         Use the per-batch spec below. Follow the 6-step recipe for each mechanic.
>
> CRITICAL OPERATIONAL RULES:
> - COMMIT INCREMENTALLY — one commit per sub-batch (e.g. Batch 4a Magic Resistance is one
>   commit, 4b Regeneration is the next). Push after each commit.
> - Run `npx tsc --noEmit` (excluding TS7006) + the relevant test files after each commit.
> - KEEP GOING after each commit until the batch is done or time runs out.
> - If a mechanic is harder than expected, SKIP it (note in handover `special_notes`) and move on.
> - Do NOT touch combat.ts beyond the minimal hook point each mechanic needs — coordinate with
>   the Core Engine workstream via TEAMGOALS.md if a hook is contested.
> - For ANY field-shape ambiguity in 5etools JSON, consult `scripts/creature_analysis.ts`
>   (it already handles every shape encountered across all 453 creatures).
>
> STEP 4: When you finish the batch OR hit the time budget, write
>         zHANDOVER-SESSION-NN.md (NN = previous + 1) summarizing: what was wired, what was
>         skipped + why, test counts, and where the next run picks up. Update the "Batch
>         Status" table in THIS file. Commit + push the handover.
>
> GOAL: light up as many of the 453 creatures' real mechanics as possible, batch by batch.
> ```

---

## STARTUP CHECKLIST (run before EVERY batch)

1. `git pull origin main` — get latest.
2. `npm install` — deps: ts-node, typescript.
3. Run the creature-relevant baseline tests to confirm green:
   ```bash
   for t in parser combat scenario summons mount; do
     npx ts-node --transpile-only src/test/${t}.test.ts 2>&1 | grep "Results:" | head -1
   done
   ```
   All must print `Results: N passed, 0 failed`.
4. Regenerate the analysis ONLY if `bestiaryData/` changed since last session:
   ```bash
   npx ts-node --transpile-only scripts/creature_analysis.ts | tail -40
   ```
   Then `git diff CREATURE-MEGABATCH-ANALYSIS.json` to see what's new.
5. `npx tsc --noEmit 2>&1 | grep -v TS7006 | grep "error TS"` — must be empty.

---

## THE 6-STEP MIGRATION RECIPE (follow for EVERY mechanic)

For each mechanic in a batch, execute these 6 steps in order.

### Step 1: Type first (`src/types/core.ts`)
Add the new field to `Combatant` (or `Action`) with a safe optional default + a doc comment
referencing the PHB/MM page and the session that added it. Example:
```ts
// ── Session 52 Batch 1: Damage immunities from 5etools bestiary ──
// Populated by monsterToCombatant from raw.immune. Consumed by applyDamage
// (utils.ts) which already halves for resistances / zeroes for immunities.
immunities?: DamageType[];
```

### Step 2: Parser (`src/parser/fivetools.ts`)
Add a `parseX()` helper for the raw field. Handle EVERY shape the analysis script documented
(string array, object-with-inner-array, object-with-special). Add unit assertions to
`src/test/parser.test.ts` for each shape.

### Step 3: Wire into `monsterToCombatant()`
Populate the new field from the parsed raw value. Use safe defaults (`[]` for arrays) so
existing test factories don't break.

### Step 4: Engine consumption
Find the right hook point. For defenses → `applyDamage` in `utils.ts` (already consumes
`immunities`/`resistances` — just ensure parser populates them + add `conditionImmunities`
consumption in `applyCondition`). For traits → the trait's specific trigger (save roll,
damage roll, start-of-turn, etc.). Keep the hook MINIMAL.

### Step 5: Update factories
Every test file has a `makeC()` / `makeCombatant()` factory. Add the new field with a safe
default to every one (grep for `resistances:` to find them). This is tedious but prevents
100+ test compile errors.

### Step 6: Write tests + de-flake
New test file `src/test/<mechanic>.test.ts` covering: matching creature gets the effect,
non-matching doesn't, edge cases (crit, save success, etc.). For any test using real dice
RNG on attack rolls, use the Session-50 de-flake pattern (retry-until-hit loops,
at-least-N instead of exactly-N, widened thresholds for crit paths). Run 30+ consecutive
times to confirm stability.

---

## BATCH 0 — Reprint-safe loader + dedupe + collision subname (PREREQUISITE)

**Scope:** Infrastructure only. No creature mechanics change. This unblocks clean test
isolation and makes future multi-sourcebook data work correctly.

### Why first
- `mergeBestiaries()` keys by `name.toLowerCase()` alone → genuine cross-sourcebook reprints
  would silently collide (last file wins, earlier dropped).
- `bestiary-mm.json` is byte-identical to `bestiary-mm-2014.json` → wastes load time and
  creates a false "450 reprints" artifact in the analysis.
- The collision subname suffix (`"Goblin (MM)"`) is the user-approved disambiguation format.

### Changes
1. **Delete `bestiary-mm.json`** (byte-identical duplicate of `bestiary-mm-2014.json`).
   Keep `bestiary-mm-2014.json` as the canonical MM file.
2. **`src/parser/fivetools.ts`** — change `mergeBestiaries()` and `loadBestiaryJson()`:
   - Key by `${name.toLowerCase()}|${source.toLowerCase()}` instead of name alone.
   - Expose a NEW export `findCreatureByName(bestiary, name)` that returns ALL entries
     matching the name (array — empty if none). `spawnMonster()` uses the first; document
     that callers should disambiguate when >1.
   - Add `creatureSubname(raw)` helper: returns `null` normally; returns the source code
     (e.g. `"MM"`, `"VGM"`) ONLY when another creature with the same name exists in a
     DIFFERENT source. The subname is appended to `Combatant.name` as `"Name (Source)"`.
3. **`src/data/loader.ts`** — `LoadResult.bestiary` map key changes to `name|source`. The
   `summonTypeSkipped` list already names the source. No public-API break.
4. **`src/parser/fivetools.ts` `monsterToCombatant()`** — set `name = subname ? \`${raw.name} (${subname})\` : raw.name`.
   Add a `source?: string` field to `Combatant` (optional) so the sourcebook is always in
   metadata regardless of collision.
5. **`src/types/core.ts`** — add `source?: string` to `Combatant`.
6. **Tests** — `src/test/parser.test.ts`: add a test that loads TWO bestiaries with a
   same-name creature in different sources and asserts BOTH are retrievable + BOTH get a
   subname suffix. Assert a unique-name creature gets NO suffix.

### Acceptance criteria
- `loadBestiaryDir('./bestiaryData')` returns 453 unique creatures (was 903 with the dup).
- `spawnMonster(bestiary, 'Goblin', ...)` still works (returns the Goblin, no subname —
  it's unique).
- A synthetic 2-source test with a colliding name produces `"Foo (MM)"` and `"Foo (VGM)"`.
- `Combatant.source` is `"MM"` / `"DMG"` for all spawned monsters.
- All existing tests green.

---

## BATCH 1 — Damage defenses parser (immune / resist / vulnerable / conditionImmune)

**Scope:** Parse the four defense fields from raw 5etools JSON into the existing
`immunities` / `resistances` / `vulnerabilities` arrays + a NEW `conditionImmunities` field.

### Creatures affected
- 173 `DEFENSE_IMMUNE` (e.g. Tarrasque, Adult Red Dragon, all undead immune to poison)
- 105 `DEFENSE_RESIST` (e.g. devils resist nonmagical B/P/S)
- 20 `DEFENSE_VULNERABLE` (e.g. Skeletons/Skeletons vuln to bludgeoning)
- 141 `DEFENSE_CONDITION_IMMUNE` (e.g. constructs immune to charmed/frightened/paralyzed)
- Engine already consumes `immunities`/`resistances`/`vulnerabilities` in `applyDamage`
  (`utils.ts:1114, 1126`). `conditionImmunities` needs a new check in `applyCondition`.

### 5etools field shapes (handle ALL — verified by `creature_analysis.ts`)
- **String array:** `immune: ["fire"]`
- **Object with inner same-named array:** `immune: [{ immune: ["bludgeoning","piercing","slashing"], note: "from nonmagical attacks", cond: true }]` — the `cond: true` flag means "conditional resistance" (nonmagical only). v1 simplification: apply the resistance unconditionally (document the simplification — matching the "nonmagical" condition requires a `isNonmagical` flag on attacks, deferred).
- **Object with special:** `immune: [{ special: "damage from spells" }]` — rare; v1 skips these (log a warning, treat as no immunity).
- Same shapes for `resist` / `vulnerable` / `conditionImmune` (conditionImmune inner values are condition names like `"charmed"`, `"poisoned"`).

### Changes
1. **`src/types/core.ts`** — add `conditionImmunities?: string[]` to `Combatant` (condition
   names; checked by `applyCondition`).
2. **`src/parser/fivetools.ts`** — add `parseDamageDefenseList(rawField, fieldName): DamageType[]` and `parseConditionImmune(rawField): string[]`. Wire into `monsterToCombatant()`:
   ```ts
   immunities: parseDamageDefenseList(raw.immune, 'immune'),
   resistances: parseDamageDefenseList(raw.resist, 'resist'),
   vulnerabilities: parseDamageDefenseList(raw.vulnerable, 'vulnerable'),
   conditionImmunities: parseConditionImmune(raw.conditionImmune),
   ```
3. **`src/engine/utils.ts` `applyCondition()`** — early-return (skip application) if
   `target.conditionImmunities?.includes(condition)`. Emit a log line
   `"<Creature> is immune to <condition>"`.
4. **Tests** — `src/test/creature_defenses.test.ts`:
   - Skeleton: vulnerable to bludgeoning → takes double. Not vuln to fire.
   - Tarrasque: immune to fire/poison → takes 0. Resistant nothing.
   - A devil (e.g. Lemure): resist nonmagical B/P/S → takes half (v1 unconditional).
   - A construct (e.g. Flying Sword): conditionImmune charmed/exhaustion/frightened/paralyzed/petrified/poisoned → applyCondition skips.
   - Round-trip: spawn 10 random creatures, assert no crashes + defense arrays non-empty
     where the analysis says they should be.

### Acceptance criteria
- All 173 immune / 105 resist / 20 vulnerable / 141 conditionImmune creatures get correct
  defense arrays when spawned.
- `applyDamage` correctly zeroes/halves/doubles per the arrays (already wired — just verify).
- `applyCondition` skips condition-immune creatures.
- All existing tests green; new test file ≥ 12 assertions.

---

## BATCH 2 — Save proficiencies + senses/skills/passive metadata

**Scope:** Wire monster save bonuses into `rollSave`; record senses/skills/passive as
metadata for future LOS work (TG-007).

### Creatures affected
- 127 `SAVE_PROFICIENCY` (e.g. Adult Red Dragon: dex/con/wis/cha saves)
- 277 `SKILL_PROFICIENCY`, 271 `SENSES_DARKVISION`, 106 `SENSES_BLINDSIGHT`, 24 truesight, 9 tremorsense

### 5etools field shapes
- `save: { "dex":"+6", "con":"+13", "wis":"+7", "cha":"+11" }` — ability → signed bonus string.
- `skill: { "perception":"+13", "stealth":"+6" }` — same.
- `senses: ["blindsight 60 ft.", "darkvision 120 ft."]` — string array, parse the number + type.
- `passive: 23` — integer.

### Changes
1. **`src/types/core.ts`** — add:
   ```ts
   saveProficiencies?: Partial<Record<AbilityScore, number>>;  // ability → bonus
   skillProficiencies?: Record<string, number>;                 // skill name → bonus
   senses?: { darkvision?: number; blindsight?: number; truesight?: number; tremorsense?: number; passivePerception?: number };
   ```
2. **`src/parser/fivetools.ts`** — add `parseSaves()`, `parseSkills()`, `parseSenses()`. Wire into `monsterToCombatant()`.
3. **`src/engine/utils.ts` `rollSave()`** — if `combatant.saveProficiencies?.[ability]` is set, use that bonus INSTEAD of the default `abilityMod + profBonus(cr)`. (The listed bonus is the full total — don't double-add proficiency.) Emit log showing which.
4. **Tests** — `src/test/creature_saves.test.ts`: Adult Red Dragon CON save uses +13 (not ability mod + CR prof). A no-save creature uses the default.

### Acceptance criteria
- 127 save-proficient creatures use their listed save bonuses.
- Senses/skills/passive recorded as metadata (not yet consumed by LOS — forward-compat).
- All existing tests green.

---

## BATCH 3 — Recharge mechanic + Legendary Resistance trait

**Scope:** Two related mechanics that gate action availability / save outcomes.

### 3a. Recharge (84 creatures)
- Add `recharge?: { min: number; recharged: boolean }` to `Action` (`src/types/core.ts`).
- Parser: strip `{@recharge N}` / `{@recharge}` from `action.name`, set `recharge = { min: N||6, recharged: true }` (available on spawn).
- Engine: at start of each of the creature's turns, for each action with `recharge`, roll 1d6; if `>= recharge.min`, set `recharged = true` (available this turn). On use, set `recharged = false`.
- AI planner: skip actions where `recharge && !recharge.recharged`.
- Mirror: Blink Dog (recharge Teleport), Mephits (recharge Breath), Dragons (recharge Breath).
- Tests: `creature_recharge.test.ts` — a recharge-5 action is unavailable after use, recharges on 1d6≥5.

### 3b. Legendary Resistance (28 creatures)
- Trait name pattern: `"Legendary Resistance (N/Day)"`. Parse N at spawn → store as `legendaryResistance?: { max: number; remaining: number }` on `Combatant`.
- Engine: in `rollSave()`, if the save FAILED and `combatant.legendaryResistance?.remaining > 0` and the creature CHOOSES to use it (AI decision), force the save to succeed and decrement. v1 simplification: always use it on a failed save that would cause significant damage (HP loss ≥ 25% maxHP) — mirrors the "smart" usage. Document the simplification.
- Reset on a long rest (monsters don't short-rest in v1 combat, so per-combat only).
- Mirror: Adult Brass Dragon (LR 3/day).
- Tests: `creature_legendary_resistance.test.ts` — dragon fails a save, uses LR, save becomes success, remaining decrements; after 3 uses, no more.

### Acceptance criteria
- 84 recharge creatures' breath weapons / special attacks gate correctly per turn.
- 28 legendary-resistance creatures auto-succeed 3 saves per combat.
- All existing tests green.

---

## BATCH 4 — Bespoke trait modules (the spells-megabatch analogue)

**Scope:** One engine hook + one trait-detection block per trait family. Group by hook point
so each sub-batch is independently shippable. Each sub-batch is ONE commit.

### 4a. Magic Resistance (65 creatures) — advantage on saves vs spells/magic
- Hook: `rollSave()` — if `combatant.traits.includes('Magic Resistance')` AND the save is
  against a spell/magical effect, grant advantage. v1 simplification: treat ALL saves as
  "vs magic" for monsters (the engine doesn't tag save sources yet — document). 
- Mirror: Slaad Tadpole. Tests: `creature_magic_resistance.test.ts`.

### 4b. Regeneration (13 creatures) — start-of-turn HP regen
- Hook: `beginTurn()` / `resetBudget()` in `combat.ts`. Parse the regen amount from the
  trait description (`{@damage N}` or "regains N hit points"). Add a `regeneration?: number`
  field. At start of turn, if not dead and HP > 0, heal min(regen, maxHP - currentHP).
  Exception: acid/fire typically stops troll regen — parse "unless" clause; v1 simplification
  applies the stop only if the creature took acid/fire damage since its last turn (track
  `lastTurnDamageTypes: Set<DamageType>` on Combatant — small new field).
- Mirror: Red Slaad. Tests: `creature_regeneration.test.ts`.

### 4c. Magic Weapons (19 creatures) — attacks count as magical
- Hook: `resolveAttack()` damage-type check. Add `attacksAreMagical?: boolean` to Combatant.
  When true, the creature's weapon attacks bypass "resistance to nonmagical B/P/S".
  Requires the conditional-resistance flag from Batch 1's `cond: true` parsing — revisit
  Batch 1 to honor `isNonmagical` on incoming attacks.
- Mirror: Couatl. Tests: `creature_magic_weapons.test.ts`.

### 4d. Death Burst (8 creatures) — AoE on death
- Hook: `onDeath` event in `combat.ts`. Parse the Death Burst description for damage dice +
  type + save DC + radius. Store as `deathBurst?: { damage, type, saveDC, radius }`.
  On death, apply to all creatures in radius.
- Mirror: Mud Mephit. Tests: `creature_death_burst.test.ts`.

### 4e. Blood Frenzy (7) + Avoidance (2) + Incorporeal Movement (8) + Superior Invisibility (7) + Rejuvenation (6) + Sunlight Sensitivity (18) + False Appearance (22) + Charge (14) + Pounce (6) + Swarm (10)
- Each is a small bespoke hook. Document each in its own test. Sunlight Sensitivity needs
  a "is it daylight?" flag on Battlefield — v1 simplification: apply disadvantage only when
  `battlefield.lightLevel === 'daylight'` (default indoors/night = no penalty). False
  Appearance + Incorporeal Movement are mostly metadata (advantage on stealth / move through
  creatures) — record the flag, wire the minor combat effect.
- Mirrors: per `pattern_mirrors` in the analysis JSON.
- Tests: `creature_traits_batch4e.test.ts` covering all 10 sub-traits.

### Acceptance criteria
- Each sub-batch (4a..4e) is one commit with its own test file.
- All ~200 creatures with these traits get the mechanical effect.
- All existing tests green.

---

## BATCH 5 — DEFERRED (lair actions + monster spellcasting + shapechanger)

Documented for future sessions. NOT in scope for the immediate megabatch.

### 5a. Lair actions (41 creatures)
- Blocker: needs an initiative-count-20 (or initiative-0) hook in `runCombat` that fires
  lair actions for creatures with `lairActions`. The MM entries reference lair actions via
  `legendaryGroup` → a SEPARATE lair-actions JSON file (NOT in `bestiaryData/` today). Need
  to source `data/lairactions/lair-actions-*.json` from 5etools (user must provide — DMCA'd).
- File a new TG entry: "TG-0XX: Lair action subsystem".

### 5b. Monster spellcasting (83 creatures)
- Blocker: needs `SPELL_DB` lookup from spell names in the `spellcasting.spells` block,
  monster spell-slot tracking (a `MonsterSpellSlots` derived from the `slots` per level),
  and planner integration (monster casts its highest-impact prepared spell each turn).
- v1 simplification: parse the spell list + slots; have the monster cast one spell per turn
  from its list (round-robin or AI-scored) using its spell save DC / attack bonus from the
  `headerEntries`. Concentration spells it casts get tracked on `concentration`.
- File a new TG entry: "TG-0XX: Monster spellcasting integration".

### 5c. Shapechanger (23 creatures)
- Blocker: needs a transform subsystem (swap actions/HP/AC on transform, track original
  form). Defer to a dedicated subsystem session.

---

## BATCH STATUS (updated by each session — append a row per session)

| Batch | Status | Session | Commit | Notes |
|-------|--------|---------|--------|-------|
| 0 | ✅ DONE | 52 | 547a361 | reprint-safe loader + source provenance; 453 unique creatures; 34 new test assertions |
| 1 | ✅ DONE | 52 | 2ee8600 | defenses (immune/resist/vulnerable/conditionImmune); 92 new test assertions; fixed applyDamageWithTempHP vuln-then-resist bug |
| 2 | ✅ DONE | 52 | ea9a72d | saves/senses/passive; 58 new test assertions; rollSave uses listed save bonus |
| 3 | ✅ DONE | 52 | 3fb8be8 | recharge + leg-resist; 52 new test assertions; 84 recharge + 28 LR creatures |
| 4a | ✅ DONE | 52 | 2f7ced4 | Magic Resistance (65 creatures); rollSave grants advantage |
| 4b | ✅ DONE | 52 | 2f7ced4 | Regeneration (13 creatures); start-of-turn heal + stop-clause suppression |
| 4c | ✅ DONE | 52 | cfb8a11 | Magic Weapons flag (19 creatures); full nonmagical-bypass deferred |
| 4d | ✅ DONE | 53 | 23ff730 | Death Burst (14 creatures parsed across 7 pre-2024 sources); checkDeath hook + chain reactions; 63 test assertions |
| 4e (Session 52) | ✅ DONE | 52 | cfb8a11 | Blood Frenzy (7) + Swarm/cannotRegainHP (10) + Siege Monster metadata (5) |
| 4e-remaining | ✅ PARTIAL | 53 | 2850c18 | Sunlight Sensitivity (120) + Avoidance (8) wired into engine. 6 more metadata flags parsed (Ambusher 10, Brute 14, False Appearance 100, Siege Monster 71, Water Breathing 33, Hold Breath 57). Remaining: Charge (49), Pounce (24), Incorporeal Movement (54), Superior Invisibility (15), Rejuvenation (33) — need movement/AI/death-respawn hooks. |
| 4f | ✅ DONE | 53 | cdc68c4 | Superior Invisibility (15 creatures) wired into AI planner + engine. Incorporeal Movement (51 creatures) parsed as metadata-only (v1 movement has no collision detection). |
| 4g | ✅ DONE | 53 | 8622bda | Charge (49 creatures) + Pounce (24 creatures) movement-triggered riders. _turnStartPos tracking in resetBudget. Extra damage + STR save vs push/prone (Charge), STR save vs prone (Pounce). |
| 5 | DEFERRED | — | — | lair + spellcasting + shapechanger |

**Session 53 note:** User uploaded ~99 bestiary sourcebooks mid-session (was 2 in Session 52). All counts above reflect the expanded dataset. Parser robustness fixes (rawCreatureType handling for `{type: {choose: [...]}}` shape) + 4 stale test files updated to be source-aware (no longer pin MM-only creature names). See zHANDOVER-SESSION-53.md for full details.

---

## APPENDIX: Analysis summary snapshot (Session 52 baseline)

```json
{
  "unique_creature_count": 453,
  "by_source": { "MM": 450, "DMG": 3 },
  "by_priority": { "HIGH": 252, "MED": 61, "LOW": 140 },
  "top_patterns": {
    "DEFENSE_IMMUNE": 173, "DEFENSE_CONDITION_IMMUNE": 141,
    "DEFENSE_RESIST": 105, "RECHARGE": 84, "SPELLCASTER": 83,
    "TRAIT_MAGIC_RESISTANCE": 65, "LEGENDARY_RESISTANCE_TRAIT": 28,
    "TRAIT_SHAPECHANGER": 23, "DEFENSE_VULNERABLE": 20,
    "TRAIT_MAGIC_WEAPONS": 19, "TRAIT_SUNLIGHT_SENSITIVITY": 18,
    "TRAIT_REGENERATION": 13, "TRAIT_SWARM": 10, "TRAIT_DEVILS_SIGHT": 9
  },
  "genuine_reprints": 0,
  "duplicate_files": 1
}
```

Full per-creature detail: `CREATURE-MEGABATCH-ANALYSIS.json`. Regenerate via
`npx ts-node --transpile-only scripts/creature_analysis.ts`.
