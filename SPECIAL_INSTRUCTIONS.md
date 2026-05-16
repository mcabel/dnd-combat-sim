# SPECIAL_INSTRUCTIONS.md
# D&D 5e Combat Sim — AI Continuity Document
# Read this FIRST before touching any code.

---

## 1. SESSION START PROTOCOL (do this every time)

```bash
# If starting from a GitHub zip upload:
cd dnd-combat-sim-main
npm install

# Run full test suite — must be 0 failures before you touch anything
export TS_NODE_COMPILER_OPTIONS='{"lib":["ES2020","DOM"],"types":["node"]}'
for f in src/test/*.test.ts; do
  echo -n "$(basename $f): "
  npx ts-node $f 2>&1 | grep "Results:"
done

# Read task.md — find "Last completed" and "Next session starts at"
cat task.md | head -20

# Read the latest summary in summaries/ (sorted by name, take the last)
ls summaries/ | sort | tail -1
cat summaries/<that-file>.md
```

## 2. SESSION END PROTOCOL (do this every time before stopping)

```bash
# 1. Run tests — must be 0 failures
for f in src/test/*.test.ts; do
  echo -n "$(basename $f): "
  npx ts-node $f 2>&1 | grep "Results:"
done

# 2. Update task.md — mark completed items ✅, update "Last completed" line

# 3. Write summaries/summary-YYYY-MM-DD-sN.md (increment N)

# 4. If user provides GitHub token, push:
git add -A
git commit -m "Session N: brief description"
git remote set-url origin https://TOKEN@github.com/mcabel/dnd-combat-sim.git
git push origin main

# NEVER leave mid-session without: tests passing + task.md updated + summary written
```

## 3. PROJECT IDENTITY

**What this is:** A TypeScript simulation engine for D&D 5e (PHB 2014, pre-2024 ruleset).
It models combat encounters between level-1 PCs and monsters, running N simulations and
reporting win rates, average rounds, and per-combatant statistics.

**What it is NOT:** A game. No UI for players. No character builder. Pure simulation.

**Ruleset constraints (non-negotiable):**
- PHB 2014, MM 2014, DMG 2014, SAC v2.7 (2021), Tasha's CoE (2020)
- Pre-2024 only — ignore 2024 PHB/MM rules entirely
- Chebyshev 3D distance (diagonals = 5ft) — NOT the DMG 5/10 optional rule
- Multiattack NEVER usable for Opportunity Attacks (SAC v2.7)
- Creatures are NOT psychic — they can only act on observable information

## 4. FILE STRUCTURE (must know this)

```
src/
├── types/core.ts          # ALL type definitions — change here first
├── parser/
│   ├── fivetools.ts       # 5etools JSON → Combatant (monsters)
│   └── pc.ts              # pc_stat_blocks_lv1.json → Combatant (PCs)
├── engine/
│   ├── movement.ts        # Chebyshev distance, OA triggers, pathfinding
│   ├── utils.ts           # Dice, damage, conditions, rests, ALL mechanics helpers
│   └── combat.ts          # THE main combat loop — executes TurnPlans
├── ai/
│   ├── targeting.ts       # Target selection (nearest/weakest/smart profiles)
│   ├── actions.ts         # Action selection — what to DO on your turn
│   ├── planner.ts         # MAIN turn planner — state machine per design doc
│   └── resources.ts       # Class resource AI (rage, smite, BI, hex, etc.)
├── data/loader.ts         # Scans bestiaryData/*.json, filters summon-types
├── scenarios/
│   ├── encounter.ts       # buildEncounter() + resetCombatant()
│   ├── simulate.ts        # simulate() — runs N encounters, aggregates stats
│   ├── report.ts          # Terminal output formatter
│   ├── presets.ts         # Named encounter configurations
│   ├── html_report.ts     # generateHTMLReport() / saveHTMLReport()
│   └── multiencounter.ts  # simulateDay() — multi-encounter with rests
├── summons/
│   ├── registry.ts        # SummonEntry catalogue (Giant Fly, Avatar of Death)
│   ├── spawner.ts         # spawnSummon() with HP scaling
│   └── mount.ts           # Mount rules PHB p.198
├── test/                  # One test file per subsystem — see below
└── index.ts               # CLI entry point
bestiaryData/              # Drop 5etools JSON files here — auto-loaded
```

## 5. KEY DESIGN DECISIONS (do not reverse these)

### AI Profiles
- `attackNearest` — closes gap, hits closest, no tactics (T-Rex, Larva)
- `attackWeakest` — targets bloodied/low-AC enemies
- `smart` — full threat-weighted scoring (healer +80, AoE caster +70, bloodied +60)
- `defend` — only retaliates if adjacent; NEVER pursues (Giant Fly, magic item mounts)
- Profile is per-creature at spawn; can be overridden mid-combat via `pendingCommands`

### INT score does NOT gate behavior
A T-Rex (INT 2) uses `attackNearest` and charges freely.
Only creatures whose LORE says "defends unless commanded" get `defend` profile.

### Summon-type creatures
Creatures with no numeric CR are excluded from `loadBestiaryDir()`.
They live in `src/summons/registry.ts` with estimated CR and HP scaling rules.
Use `spawnSummon()` not `spawnMonster()` for these.

### Perception model (non-psychic)
`TargetKnowledge` in `PerceptionMemory` tracks ONLY what can be observed:
- isBloodied (visible wounds < 50% HP)
- visibleArmorType (what they're wearing)
- castAoEThisCombat, receivedHealingThisCombat (witnessed actions)
- isFlying, isRanged, hasMeleeWeapon (visible)
NEVER set: exact HP, spell slots remaining, concentration state (not observable)

### Death saves (PHB p.197)
- Monsters die instantly at 0 HP
- PCs go unconscious and roll death saves at start of their turn
- Hits on downed PC: 1 auto-failure (ranged), 2 auto-failures (melee within 5ft)
- 3 successes = stable; 3 failures = dead; nat 20 = revive at 1 HP

### Concentration (PHB p.203)
- `action.requiresConcentration: boolean` on every Action
- On damage: `rollConcentrationSave(caster, damageTaken)` in utils.ts
- DC = max(10, floor(damage/2))
- Smart AI targets concentrating casters; avoids casting concentration spells when concentrating

## 6. HOW TO ADD A NEW MECHANIC (the correct process)

1. **Type first:** Add fields to `src/types/core.ts` (Combatant, Action, etc.)
2. **Engine:** Implement in `src/engine/utils.ts` (pure functions, testable)
3. **Wire into combat loop:** `src/engine/combat.ts` — find the right hook point
4. **Wire into AI:** `src/ai/actions.ts` or `src/ai/planner.ts`
5. **Update parsers:** `src/parser/fivetools.ts` and `src/parser/pc.ts`
6. **Update factories:** ALL test files have a `makeC()` or similar factory —
   add new fields with safe defaults to every one
7. **Update `resetCombatant()`:** in `src/scenarios/encounter.ts`
8. **Write tests:** New test file in `src/test/` covering the mechanic
9. **Run full suite:** Must be 0 failures before committing

## 7. CURRENT TEST SUITE (as of last verified state)

| File | Assertions | What it covers |
|------|-----------|----------------|
| parser.test.ts | 101 | 5etools parsing, all monster fields |
| engine.test.ts | 71 | Movement, distance, OA, damage, budget |
| ai.test.ts | 26 | Targeting profiles, action selection, OA decisions |
| combat.test.ts | 49 | Full combat loop, initiative, events |
| pc.test.ts | 248 | All 12 classes, resource loading |
| integration.test.ts | 26 | PC vs monster end-to-end |
| mechanics.test.ts | 45 | Concentration, death saves, sneak attack, pack tactics, temp HP |
| scenario.test.ts | 52 | Encounter builder, simulate(), report |
| resources.test.ts | 72 | Class resources (rage, smite, BI, etc.) |
| phase4.test.ts | 54 | Rests, ammo, creature type profiles, prone, grapple, commands |
| summons.test.ts | 51 | Summon registry, spawnSummon, Giant Fly |
| mount.test.ts | 31 | Mount/dismount, movement pool, rider DEX save |
| html_report.test.ts | 36 | HTML report generation, XSS safety |
| death_saves.test.ts | 57 | PHB p.197 death saving throw rules |
| **Total** | **869+** | **All 0 failures** |

## 8. KNOWN INTERMITTENT FAILURES (acceptable, do not investigate)

Some tests use real dice RNG inside loops. These occasionally fail at low probability:
- `mechanics.test.ts` — concentration save with exact thresholds
- `combat.test.ts` — probabilistic "wins ≥ N/10" assertions
- `integration.test.ts` — "fighter wins majority" over small sample

If a test fails once in 5 runs, it's RNG variance. If it fails 3/5 runs, investigate.

## 9. WHAT IS ALREADY IMPLEMENTED (do not re-implement)

All of these work and are tested:
- Chebyshev 3D movement, OA triggers, Disengage
- All 3 AI profiles + defend profile + pendingCommands
- Concentration saves on damage, auto-break on death
- Death saving throws (all PHB rules including hits on downed PCs)
- Sneak Attack (finesse/ranged, once/turn, OA eligible)
- Pack Tactics (trait name check)
- Temp HP (no-stack, absorbs first)
- Divine Smite (post-hit decision, crit/bloodied trigger)
- Rage, Second Wind, Bardic Inspiration, Lay on Hands, Hex
- Short rest + long rest recovery
- Ammo tracking (arrows, fallback to melee)
- Commanded creatures (verbal, no action cost)
- Prone modifiers (melee adv / ranged disadv)
- Grapple + Shove (STR contest, conditions)
- Default AI profile from creature type (beast=nearest, humanoid=smart, etc.)
- Mount rules (PHB p.198) — rider uses mount movement pool
- Summon registry + spawnSummon() with HP scaling
- Multi-encounter adventuring day with rests
- HTML report generator (standalone, zero deps)
- CLI with --output flag

## 10. WHAT IS NOT YET IMPLEMENTED (next priorities)

From `task.md` Phase 7:

1. **Concentration AI improvements (7.2)** — HIGH
   - Casters should PREFER non-concentration spells when already concentrating
   - Smart enemies should TARGET concentrating casters to force CON saves
   - Wire `requiresConcentration` flag (already on Action type) into selectAction()
   - Files: `src/ai/actions.ts`, `src/ai/targeting.ts`

2. **Level scaling — PCs lv 2–5 (7.3)** — HIGH
   - Parser already handles any level; need `pc_stat_blocks_lv2.json` etc.
   - User must provide data files; parser/PC layer needs no code changes

3. **Interactive HTML report (7.1)** — MEDIUM
   - Add JS filter/sort to combatant table in html_report.ts
   - Toggle between day encounters

4. **GitHub Actions CI (7.5)** — DONE this session ✅

5. **More encounter presets (7.4)** — LOW (needs more bestiary files)

## 11. IMPORTANT GOTCHAS

### TypeScript environment
The tsconfig now includes `"lib":["ES2020","DOM"]` and `"types":["node"]`.
If tests fail with "Cannot find name 'console'" or "Cannot find name 'process'",
the tsconfig is wrong. Fix by adding those lib/types entries.

### The stray src/combat.ts (RESOLVED)
A previous agent created a stray `src/combat.ts` as a duplicate of
`src/engine/combat.ts`. It has been deleted. The real file is always
`src/engine/combat.ts`. Do not recreate the stray file.

### Ranged OA restriction
Opportunity Attacks use a SINGLE melee action — never Multiattack, never ranged.
`selectOAAction()` in movement.ts enforces this.

### Faction types
`monsterToCombatant()` only accepts `'enemy' | 'neutral'` for faction.
To spawn a monster as party-faction: spawn as enemy, then set `.faction = 'party'`.
`spawnSummon()` handles this correctly already.

### Concentration vs requiresConcentration
`self.concentration` (on Combatant) = "is currently concentrating on spell X"
`action.requiresConcentration` (on Action) = "casting this would start/replace concentration"
Keep these distinct.

## 12. GITHUB WORKFLOW

Repo: https://github.com/mcabel/dnd-combat-sim (PRIVATE)
Main branch: `main`

User provides a GitHub PAT at end of session. Push with:
```bash
git add -A
git commit -m "Session N: description"
git remote set-url origin https://TOKEN@github.com/mcabel/dnd-combat-sim.git
git push origin main
```

User revokes token after each push (short-lived PAT pattern).

If no token available: user downloads zip from Claude outputs and pushes locally.

## 13. DESIGN DOCUMENTS

See project files:
- `combat_ai_design.md` — original monster AI state machine spec
- `player_ai_design.md` — original player AI spec
- `pc_stat_blocks_lv1.json` — all 12 PHB classes at level 1 (verified, corrections noted)
- `task.md` — live task tracker, always the source of truth for what's done
- `summaries/` — per-session logs, read the latest for immediate context
