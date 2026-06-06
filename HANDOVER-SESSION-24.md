# HANDOVER — Session 24 Start

## Prompt Instructions (carry forward every session)
- Break down large tasks, ask for input when needed
- Commit to GitHub after each meaningful chunk of work
- Stop and flag for Sonnet when a task is architecturally complex
- When fresh chat is optimal: commit, write this handover, stop
- Future handovers must be self-contained and seamless
- PAT: stored in your local git credential store — do not paste in files. User provides it verbally at session start.
- Scope: PHB 2014 / MM 2014 / SAC v2.7. No post-2024 content yet.
- Username: mcabel

## Current State
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `3ac36bb`)
- **Tests:** 1119 passing, 0 failed (18 suites)
- **Branch:** main (detached HEAD workflow — always push `HEAD:main`)

---

## What Was Done in Session 23

### Phase 8-G: Encounter Difficulty Label ✅ COMPLETE
- `difficultyLabel(partyWinRate)` exported from `server.ts` — six tiers:
  Trivial ≥90% / Easy ≥70% / Medium ≥45% / Hard ≥25% / Deadly ≥10% / TPK <10%
- `difficulty: string` added to `ApiSimResult`; populated in both POST routes
- `simulator.html`: `.summary-row` flex container; six `.diff-badge.<label>` color variants
- 4 new server tests (32 total); unit-tests all 12 boundary cases

### ST-5: Mount Redirect (all three in-scope tiers) ✅ COMPLETE
New file `src/engine/mount_redirect.ts` — three exported pure helpers:
- `checkMountedCombatant(target, action, bf)` — attack-roll redirect to rider (Mounted Combatant feat). No reaction cost. Guards: not a save, not auto-hit, rider alive + has feat.
- `checkProtectionStyle(target, bf)` — rider imposes disadvantage (PHB Fighting Style: Protection). Reaction cost; marks `reactionUsed`.
- `checkInterceptionReduction(target, dmg, bf)` — 1d10 + prof reduction before HP application (TCE Fighting Style: Interception). Reaction cost.

`combat.ts` hooks:
- Mounted Combatant redirect at 3 call sites: `attack/cast`, `legendary`, OA
- Protection disadvantage hook after `resolveAttackAdvantage` (renamed `baseDisadv`)
- Interception reduction hook before `applyDamageWithTempHP`

21 new tests in `src/test/mount_redirect.test.ts`

**Deferred from ST-5** (not yet implemented):
- Warding Bond (needs `resistances[]` on Combatant + buff system)
- Warding Maneuver (Cavalier lvl 3, AC mid-attack)
- Divine Allegiance / Aura of Guardian (Paladin lvl 7)

### Advantage / Disadvantage System ✅ COMPLETE
New types in `src/types/core.ts`:
- `D20TestScope` — 'attack' | 'attack:melee' | 'attack:ranged' | 'attack:spell' | 'save' | 'save:str/dex/con/int/wis/cha' | 'ability' | 'ability:str/dex/con/int/wis/cha' | 'initiative' | 'perception' | 'all'
- `AdvDurationType` — 'permanent' | 'until_next_turn' | 'rounds'
- `AdvantageEntry` — `{ type, scope, source, durationType, roundsRemaining }`
- Two new fields on `Combatant`: `advantages: AdvantageEntry[]` (own rolls), `vulnerabilities: AdvantageEntry[]` (rolls against this creature)

New file `src/engine/adv_system.ts`:
- `grantSelf(c, type, scope, source, durationType, rounds?)` — own roll advantage/disadvantage
- `grantVulnerability(c, type, scope, source, durationType, rounds?)` — applies to rolls against this creature
- `tickAdvantages(c)` — call at START of creature's turn; expires `until_next_turn`, decrements `rounds`
- `querySelf(c, scope)` — returns `{ advantage, disadvantage }` for own rolls
- `queryVulnerability(c, scope)` — returns `{ advantage, disadvantage }` for incoming rolls
- `passiveBonus(c, scope)` — returns +5 / −5 / 0 for passive scores
- `removeBySource(c, source)` — clears entries by source label
- **Refresh rule**: same `{type, scope}` → keep longer `roundsRemaining` (no stacking/accumulating)
- **Scope matching**: `'attack'` covers `'attack:melee'`; `'attack:melee'` does NOT cover `'attack'`; `'all'` covers everything

**Bug fixes landed with this work:**
- `invisible` condition was NOT in `attackAdvantageState` — now added (both attacker invisible → adv; target invisible → disadv)
- `rollSave` had `hasAdvantage = false` hardcoded — now queries adv_system
- `isDodging` flag was set but never checked — replaced entirely with adv_system grants

**Reckless Attack (Barbarian)** — now implemented:
- At start of Barbarian's turn: `grantSelf(barb, 'advantage', 'attack:melee', 'Reckless Attack', 'until_next_turn')` + `grantVulnerability(barb, 'advantage', 'attack', 'Reckless Attack', 'until_next_turn')`
- Always fires when enemies are present (AI: always beneficial at level 1)
- `tickAdvantages(actor)` called at start of every actor's turn in the main combat loop

**Dodge action** — now properly implemented:
- `grantVulnerability(actor, 'disadvantage', 'attack', 'Dodge', 'until_next_turn')`
- `grantSelf(actor, 'advantage', 'save:dex', 'Dodge', 'until_next_turn')`
- Old `(actor as any).isDodging` flag removed

48 new tests in `src/test/adv_system.test.ts`

---

## NOT YET DONE — Next Session Priority

### Rage (Barbarian) — +2 damage + resistance (RECOMMENDED NEXT)
Currently a stub (`case 'rage': log(...); break;`). Rage is mechanically implemented in the AI (tracks `r.active`, `r.remaining`, `r.roundsRemaining`) but the engine execution doesn't:
1. Add +2 to all melee damage rolls while raging
2. Grant resistance to bludgeoning, piercing, slashing damage
3. Wire `tickRage()` at end of barbarian's turn

This is the highest-impact remaining stub — the barbarian's primary class feature.
Resistance requires adding `resistances: DamageType[]` to `Combatant` and checking it in `applyDamageWithTempHP`.

### ST-5 (remaining deferred):
- Warding Bond (spell) — needs resistance system + buff tracking
- Warding Maneuver (Cavalier lvl 3) — mid-attack AC re-check
- Divine Allegiance / Aura of Guardian (Paladin lvl 7)

### Phase 8 Web UI:
- 8-H: Day simulation / resource chaining — flag for Sonnet (larger design change)

### Multi-level PCs (FUTURE):
- When user provides lv2–lv5 stat block JSON files

---

## Key Architecture Notes

### adv_system.ts integration points:
| Location | What it does |
|---|---|
| `engine/utils.ts > attackAdvantageState` | Queries `querySelf(attacker, 'attack')` + `queryVulnerability(target, 'attack')` |
| `engine/utils.ts > rollSave` | Queries `querySelf(c, 'save:X')` + `querySelf(c, 'save')` |
| `engine/combat.ts > main loop` | `tickAdvantages(actor)` at start of each turn |
| `engine/combat.ts > case 'dodge'` | `grantVulnerability` + `grantSelf` |
| `engine/combat.ts > Reckless Attack block` | `grantSelf` + `grantVulnerability` |

### Combatant fields added this session:
```typescript
advantages:      AdvantageEntry[];  // own d20 rolls
vulnerabilities: AdvantageEntry[];  // rolls made against this creature
```
Both initialized to `[]` in `pc.ts` and `fivetools.ts` (spawner inherits from fivetools).

### Scope matching rule:
- General scope covers specific: `'attack'` entry matches `'attack:melee'` query ✓
- Specific does NOT cover general: `'attack:melee'` entry does NOT match `'attack'` query ✓
- `'all'` matches everything ✓

---

## Test Baseline (1119 total, 0 failed)
| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| combat.test.ts | 52 |
| concentration_ai.test.ts | 33 |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| html_report.test.ts | 36 |
| integration.test.ts | 26 |
| mechanics.test.ts | 57 |
| mount.test.ts | 43 |
| mount_redirect.test.ts | 21 |
| parser.test.ts | 101 |
| pc.test.ts | 248 |
| phase4.test.ts | 54 |
| resources.test.ts | 72 |
| scenario.test.ts | 94 |
| server.test.ts | 32 |
| summons.test.ts | 51 |
| **Total** | **1119** |

---

## Run Tests
```bash
export TS_NODE_COMPILER_OPTIONS='{"lib":["ES2020","DOM"],"types":["node"]}'
for f in src/test/*.test.ts; do
  echo -n "$(basename $f): "
  npx ts-node "$f" 2>&1 | grep "Results:"
done
```

## Start Server
```bash
export TS_NODE_COMPILER_OPTIONS='{"lib":["ES2020","DOM"],"types":["node"]}'
npx ts-node src/server.ts
# Open: http://localhost:3000/simulator.html
```

## Git Workflow
```bash
git add -A
git commit -m "Session 24: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```

## Notes for Session 24
- **Most impactful next step:** Barbarian Rage — implement +2 damage and B/P/S resistance. Requires adding `resistances: DamageType[]` to `Combatant` and checking it in `applyDamageWithTempHP`. Stub is at `case 'rage'` in `combat.ts > executePlannedAction`. AI side (`activateRagePlan`, `tickRage`) is already written in `ai/resources.ts`.
- Reckless Attack (landed this session) already interacts correctly with Rage — when both are active, barbarian attacks with advantage AND deals +2 damage.
- The adv_system is the foundation for all future spell/feat advantages — next consumers would be Bless (1d4 bonus — not adv/disadv, separate system), Faerie Fire, Invisibility spells etc.
