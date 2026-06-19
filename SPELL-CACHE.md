# Spell Cache — Workflow Guide

> **TL;DR:** `npm run spell-cache:build` regenerates the cache; `npm run spell-cache:pick -- --level 0 --source PHB --count 5` picks your next batch.

---

## Should we load `testDataSpells/*.json` every time?

**No — for the agent workflow it's a bad idea.** The raw 5etools JSONs total **2.2 MB** across 17 files (`spells-phb.json` alone is 637 KB, `spells-xphb.json` 595 KB). Every time an agent wants to answer *"which cantrips are left to implement?"* it would have to parse all of them, dedupe PHB↔XPHB reprints, cross-reference `src/spells/*.ts` to see what's done, and sort. That's slow, repetitive, and gives no durable progress tracking.

**Note:** the combat *engine* never loads these JSONs at runtime — they are reference data only. So caching is purely a *workflow* optimization, not a runtime one.

The spell cache precomputes a lean per-level view with an **auto-derived `implemented` flag** (scanned from `src/spells/*.ts`), so the flag can never drift from reality. An agent then picks a manageable batch per session, implements it, and re-runs the build to refresh the flags.

---

## What's in the cache

```
spell-cache/
├── INDEX.md            # dashboard: per-level counts + implemented list
├── level-0.json        # cantrips   (49 spells, 5 implemented)
├── level-1.json        # level 1    (82 spells, 14 implemented)
├── level-2.json        # level 2    (94 spells, 1 implemented)
├── ...
└── level-9.json        # level 9    (22 spells, 0 implemented)
```

Each `level-N.json` entry looks like:

```json
{
  "name": "Acid Splash",
  "source": "PHB",
  "sourceFile": "testDataSpells/spells-phb.json",
  "page": 211,
  "level": 0,
  "school": "Conjuration",
  "implemented": false,
  "implementedModule": null,
  "inScope2014": true,
  "reprintedIn": ["XPHB"],
  "classes": ["Druid", "Ranger", "Sorcerer", "Wizard"],
  "effect": "DEXTERITY save · 1d6 acid · 60 ft · Instantaneous · +scales",
  "meta": {
    "time": "1 action",
    "range": "60 ft",
    "duration": "Instantaneous",
    "save": "dexterity",
    "attack": null,
    "damage": ["1d6 acid"],
    "scales": true
  }
}
```

Spells are **sorted by name, then source** (PHB before XPHB). PHB is preferred as the canonical source when a spell is reprinted in XPHB (2024). `inScope2014` is `false` only for spells that exist **solely** in XPHB (2024-only).

---

## Commands

### `npm run spell-cache:build`
Regenerate the cache from `testDataSpells/*.json` + `src/spells/*.ts`. Run this:
- once before starting a session, and
- after implementing any spell (so the `implemented` flag updates).

Idempotent and safe to re-run.

### `npm run spell-cache:pick -- --level <N> [--source <CODE>] [--count <N>] [--class <Class>] [--all]`
Pick the next batch of unimplemented spells and emit a **markdown table ready to paste into a handover**.

| Flag | Meaning |
|------|---------|
| `--level N` | Spell level 0–9 (required) |
| `--source PHB` | Restrict to one sourcebook code (e.g. `PHB`, `XGE`, `TCE`) |
| `--count 5` | How many to pick (default 5) |
| `--class Wizard` | Filter by class list (from `sources.json`) |
| `--all` | Include out-of-scope XPHB (2024) spells |

Example output (level 0, PHB, 5):
```
## Suggested next batch — cantrips, source PHB, 5 spell(s) (2014 in-scope only)
| # | Name | School | Effect | Source | Page | Module to create |
| 1 | Acid Splash | Conjuration | DEX save · 1d6 acid · 60 ft · +scales | PHB | 211 | src/spells/acid_splash.ts |
...
### Implementation checklist (paste into handover)
- [ ] Acid Splash (PHB p.211) — 1d6 acid, save-based → resolveAttack save branch. Create src/spells/acid_splash.ts.
...
```

### `npm run spell-cache:show -- "Spell Name" [--pretty]`
Print the **full raw 5etools JSON entry** for a spell. Use this when you're about to implement and need the complete `entries`, `scalingLevelDice`, component details, etc. (the cache only stores a summary). Picks the **newest in-scope printing** (e.g. TCE over PHB for the same spell); falls back to the newest out-of-scope printing only if no in-scope version exists, and flags it as out-of-scope.

---

## Recommended per-session workflow

1. **`npm run spell-cache:build`** — refresh the cache (in case other agents added spells).
2. **`npm run spell-cache:pick -- --level 0 --source PHB --count 5`** — get your batch.
3. **Paste the output** into your `zHANDOVER-SESSION-N.md` under "Goals this session".
4. **Implement** each spell: `src/spells/<snake_name>.ts`, register in the right cantrip registry, write tests.
5. **`npm run spell-cache:build`** again — confirm your new spells now show `implemented: true`.
6. **Commit** the spell modules + updated cache + handover together.

---

## Design notes

- **Project scope (per user).** Canon material published **pre-2024** is in scope. The 2024 revised core books (XPHB, and future XMM/XDMG) are **out of scope** and never override pre-2024 content. Add new 2024+ codes to `OUT_OF_SCOPE_SOURCES` in `build.ts` / `show.ts` when testDataSpells gains them.
- **Reprint precedence: NEWEST in-scope source wins.** When the same spell appears in multiple pre-2024 sourcebooks (e.g. Booming Blade in SCAG 2015 → reprinted in TCE 2020), the **newest** printing is canonical — its `source`, `sourceFile`, `page`, and rules text take precedence. Older in-scope printings and any out-of-scope printings are recorded in `otherSources` (newest-first) for reference only. Example: Booming Blade → `source: "TCE"`, `otherSources: []` (SCAG isn't a separate file in testDataSpells; TCE's own entry is authoritative).
- **`implemented` is auto-derived, never hand-edited.** The build script scans `src/spells/*.ts`, reads each module's `export const metadata = { name: '...' }` (falling back to filename→Title Case), and matches against spell names. This eliminates flag drift.
- **Dedup by name.** A spell reprinted across files appears once, with the canonical (newest in-scope) source primary and all other printings in `otherSources`. This cut 936 name+source pairs down to 557 unique spells.
- **`inScope`** = the spell exists in at least one pre-2024 source. Spells that exist ONLY in XPHB (2024) — e.g. Sorcerous Burst, Arcane Vigor, the spell Divine Smite — have `inScope: false` and are excluded from the picker by default (use `--all` to include them).
- **Damage summary** scans only `entries[0]` (the primary effect) for `{@damage NdN}`, so scaling cantrips show their base die (e.g. "1d6 acid") plus a `+scales` flag — not "1d6 + 2d6 + 3d6 + 4d6". Utility spells with `damageInflict` tags but no dice (e.g. Alter Self) correctly show no damage.
- **Workstream routing in the picker:** cantrips (level 0) → Cantrip workstream (`zHANDOVER`); leveled spells → Core Engine workstream (`HANDOVER-SESSION-*`). The picker says so explicitly so agents don't cross workstream boundaries.

### ⚠️ Creatures follow a DIFFERENT rule (not applied here)

Per project scope: **creatures are allowed to have ALL reprinted versions as variants** — they are NOT deduped. This spell cache dedupes by name (newest in-scope wins) because that's the rule for **spells and features**. A future creature/monster cache must NOT copy this dedup logic; it should keep every printing as a separate variant entry. Do not port `build.ts`'s dedup to a creature cache without inverting this behavior.

---

## Ownership

This tooling (`scripts/spell-cache/`, `spell-cache/`, `SPELL-CACHE.md`) is **shared across all three workstreams** — it touches no engine, spell, parser, or sheet source. It is additive tooling only. Any agent may regenerate the cache and commit the refreshed `spell-cache/` alongside their own spell work. Generated files (`spell-cache/*.json`, `spell-cache/INDEX.md`) are committed so agents start from a fresh view without rebuilding.
