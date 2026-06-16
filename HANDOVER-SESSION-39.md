# HANDOVER — Session 39 Start

## Prompt Instructions (carry forward every session)
- Break down large tasks, ask for input when needed
- Commit to GitHub after each meaningful chunk of work
- Stop and flag for Sonnet when a task is architecturally complex
- When fresh chat is optimal: commit, write this handover, stop
- Future handovers must be self-contained and seamless
- PAT: provided verbally at session start — do not paste in files
- Scope: PHB 2014 / MM 2014 / SAC v2.7. No post-2024 content yet.
- Username: mcabel
- **Do NOT use Larva for testing** — too fragile. Use bestiary-mm-2014.json monsters via `loadBestiaryJson` + `monsterToCombatant`.
- **Another agent** is working `SHEET-HANDOVER-*.md` — do not touch sheet routes, leveler.ts, or builder.ts.
- Use `spawnMonster(name, id, pos)` pattern for bestiary enemies in tests (see hex.test.ts).

## Current State
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `740347c`)
- **Tests:** 2,258 passing, 0 failed (42 suites)
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done This Session (Session 38 — combat-sim agent)

### Arms of Hadar OA integration ✅ (commit `740347c`)
Added section 5 to `arms_of_hadar.test.ts` (+6 tests, now 39 total):
- 5a: `opportunityAttackTriggered` returns false when `reactionUsed = true`
- 5b: End-to-end — Arms of Hadar execute → failed save → OA blocked
- 5c: Enemy who passed save retains reaction, OA still triggers
Confirmed: `movement.ts:281` already gates OA on `watcher.budget.reactionUsed`. Integration was correct; tests now explicitly verify it.

### Hex ✅ COMPLETE (commit `740347c`)
**PHB p.251:** 1st-level enchantment, **bonus action**, **concentration**, range 90 ft, single target.
Effect: +1d6 necrotic on every hit by the caster against the hexed target. AI picks STR for the ability debuff (disadvantage on STR checks — low combat impact).

**New type infrastructure:**
- `SpellEffectType`: added `'hex_damage'`
- `ActiveEffect.payload`: added `hexDie?: number`
- `PlannedAction.type`: added `'hex'` and `'mageArmor'`
- `spell_effects.ts`: added `getActiveHexDie(target, attackerId)` helper

**combat.ts hook:** After Rage damage in `resolveAttack`, checks `getActiveHexDie(target, attacker.id)` and rolls 1d6 necrotic bonus. Logs as `'action'` event with `'Hex bonus'` in description.

**Planner:** `shouldCastHex` in `resources.ts` checks pact slot + concentration. `hexPlan` returns `{ type: 'hex', targetId }`. Dispatched via `case 'hex'` in `executePlannedAction` → calls `hex.ts execute()` which sets concentration and applies `hex_damage` ActiveEffect.

**Files:** `src/spells/hex.ts`, `src/test/hex.test.ts` (27 tests)
**Modified:** `types/core.ts`, `engine/spell_effects.ts`, `engine/combat.ts`, `ai/resources.ts`, `ai/planner.ts`, `data/spells.ts`

### Mage Armor ✅ COMPLETE (commit `740347c`)
**PHB p.256:** 1st-level abjuration, **action**, **no concentration**, touch, 8 hrs.
Effect: Unarmored target AC = 13 + DEX mod. AI casts on self as first action when beneficial.

**New Combatant field:** `wearingArmor: boolean`
- Set in `pc.ts`: `!/unarmored/i.test(acFormula) && !/draconic/i.test(acFormula)`
- Bard/Fighter/Paladin/Ranger/Rogue/Warlock → `true` (wearing actual armor)
- Wizard/Monk/Barbarian/Sorcerer → `false` (unarmored / Draconic Resilience / Unarmored Defense)
- Monsters in `fivetools.ts`: `false` by default (natural armor ≠ worn armor)
- **All 42 test files patched** to include `wearingArmor: false` in inline Combatant factories

**shouldCast:** slot available + `!wearingArmor` + `(13 + DEX mod) > current AC` (Sorcerer Draconic 13+DEX already = same AC → skips) + not already active.

**Effect:** `ac_bonus` ActiveEffect with `acBonus = (13 + dexMod) - ac`. No concentration tag.

**Planner priority:** AFTER all offensive spells (Sleep, Thunderwave, etc.), BEFORE `selectAction`. Guard: `if (!plan.action)`. Also fixed `plan.action = chosenAction` → `if (!plan.action) plan.action = chosenAction` to prevent overwriting self-buff.

**Files:** `src/spells/mage_armor.ts`, `src/test/mage_armor.test.ts` (21 tests)
**Modified:** `types/core.ts`, `parser/pc.ts`, `parser/fivetools.ts`, `engine/combat.ts`, `ai/planner.ts`, `data/spells.ts`, `src/test/spell_actions.test.ts`

---

## Planner Priority Order (Session 38 final state)

**Before `selectTarget`:**
1. Bless (ally buff, fires even with no enemies)

**After `selectTarget`:**
2. Cure Wounds (urgent — downed ally in 5ft)
3. Warding Bond (ally protection)
4. **Sleep** (no-save opener — 5d8 HP bucket, Sorcerer + Wizard only)
5. Entangle (AoE control at 90ft, concentration)
6. Thunderwave (melee AoE ≥2 enemies within 15ft, NOT concentration)
7. Arms of Hadar (melee AoE ≥2 enemies within 10ft Euclidean, Warlock only, NOT concentration)
8. Faerie Fire (AoE advantage at 60ft, concentration)
9. **Mage Armor** (self-buff, unarmored casters, no concentration — fires when no offensive spell available)
10. `selectAction` → normal attack / cantrip / Magic Missile
11. **Hex** (bonus action — `planBonusAction` path, Warlock only, concentration)

---

## NOT YET DONE — Priorities for Session 39

### 1. Burning Hands (Sorcerer/Wizard AoE fire damage)
**PHB p.220:** 1st-level evocation. Action, 15-ft cone, DEX save. Fail: 3d6 fire; success: half. No concentration.

**Blocker:** Cone AoE geometry not yet implemented. 15-ft cone from caster requires:
- Direction vector from caster toward target
- Include all cells within 15 ft AND within the 53.13° half-angle of the cone
- New function in `movement.ts`: `inConeFt(caster, target, apex, halfAngleDeg, rangeFt)`

**Also:** No PC in `pc_stat_blocks_lv1.json` currently has Burning Hands. Need to add it to Sorcerer's `spells_1st` list before implementation is testable.

**Suggested approach:**
1. Add cone geometry to `movement.ts`
2. Add `'burningHands'` to `PlannedAction` type
3. Create `src/spells/burning_hands.ts`
4. Add to `pc_stat_blocks_lv1.json` — Sorcerer `spells_1st`
5. Add to planner (after Thunderwave, before Arms of Hadar — similar range/trigger)
6. Test: `src/test/burning_hands.test.ts`

### 2. Magic Missile (Wizard/Sorcerer auto-hit)
**PHB p.257:** 1st-level evocation. Action, 120 ft, 3 darts × 1d4+1 force. Auto-hit (no attack roll, no save). No concentration.

Already in Wizard/Sorcerer actions via `pc_stat_blocks_lv1.json` but currently handled generically by `selectAction` (probably as a ranged spell attack that might miss). Needs dedicated case for guaranteed-hit mechanic.

### 3. Dissonant Whispers (Bard single-target psychic)
**PHB p.234:** 1st-level enchantment. WIS save. Fail: 3d6 psychic + target must use reaction to move away. No concentration.

Bard currently has it in stat blocks but no dedicated implementation.

### 4. Chromatic Orb (Sorcerer) — already in actions, uses selectAction
Currently parsed and functional as a spell attack. No dedicated case needed unless specific element-choice AI is desired.

---

## Spell Modules Implemented So Far

| Spell | File | Casters | Notes |
|-------|------|---------|-------|
| Faerie Fire | `src/spells/faerie_fire.ts` | Druid | DEX save, outlined, concentration |
| Bless | `src/spells/bless.ts` | Cleric, Paladin | +1d4 attacks/saves, concentration |
| Entangle | `src/spells/entangle.ts` | Druid | STR save, restrained, concentration |
| Thunderwave | `src/spells/thunderwave.ts` | Druid, Wizard | CON save, 2d8 + push, no concentration; cube from perimeter |
| Arms of Hadar | `src/spells/arms_of_hadar.ts` | Warlock | STR save, 2d6 necrotic + lose reaction, no concentration; Euclidean circle |
| Sleep | `src/spells/sleep.ts` | Sorcerer, Wizard | 5d8 HP bucket, no save, no concentration; wake on damage |
| Warding Bond | `src/spells/warding_bond.ts` | Cleric | redirect half damage, concentration |
| Shield of Faith | `src/spells/shield_of_faith.ts` | Cleric, Paladin | +2 AC (bonus action, concentration) |
| **Hex** | **`src/spells/hex.ts`** | **Warlock** | **+1d6 necrotic on hit, bonus action, concentration** |
| **Mage Armor** | **`src/spells/mage_armor.ts`** | **Wizard** | **AC = 13+DEX if unarmored, action, no concentration** |

---

## Key Architectural Notes

### wearingArmor field (new Session 38)
`Combatant.wearingArmor: boolean` — false for unarmored creatures (Wizard, Monk, Barbarian, Sorcerer, monsters). True for any creature in actual armor. Set by `pc.ts` from `acFormula` string pattern. Used by Mage Armor `shouldCast`.

### Spell DB key format
`data/spells.ts` SPELL_DB uses lowercase with spaces as keys: `'mage armor'`, `'arms of hadar'`, etc. `lookupSpell()` calls `.toLowerCase()` so "Mage Armor" → "mage armor" works.

### Inline enemy factories in tests
**Do NOT use raw inline Combatant objects for enemies in combat tests.** Use `loadBestiaryJson` + `monsterToCombatant` from `src/parser/fivetools.ts`. See `hex.test.ts` for the pattern:
```typescript
const bestiaryRaw = JSON.parse(fs.readFileSync('bestiaryData/bestiary-mm-2014.json', 'utf8'));
const bestiary    = loadBestiaryJson(bestiaryRaw);
function spawnMonster(name, id, pos) {
  const template = bestiary.get(name.toLowerCase());
  const c = monsterToCombatant(template, pos);
  c.id = id;
  return c;
}
```

### AoE Shape Reference
| PHB Wording | Shape | Distance fn | Example spells |
|-------------|-------|-------------|----------------|
| "X-ft cube" | Chebyshev square | `distanceFt` | Thunderwave (15-ft cube) |
| "X-ft radius sphere" | True circle | `euclideanDistFt` | Arms of Hadar (10-ft), Sleep (20-ft) |
| "X-ft cone" | Wedge | **NOT YET IMPLEMENTED** | Burning Hands (15-ft) |
| "X-ft line" | Ray | **NOT YET IMPLEMENTED** | Lightning Bolt (100-ft) |

---

## Test Baseline (Session 39 start)

| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| arms_of_hadar.test.ts | 39 |
| bardic_inspiration.test.ts | 27 |
| bless.test.ts | 37 |
| character_builder.test.ts | 82 |
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 124 |
| character_storage.test.ts | 74 |
| combat.test.ts | 47 |
| concentration_ai.test.ts | 34 |
| cunning_action.test.ts | 53 |
| day.test.ts | 54 |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| entangle.test.ts | 30 |
| faerie_fire.test.ts | 29 |
| healing.test.ts | 34 |
| healing_spells.test.ts | 36 |
| **hex.test.ts** | **27 (Session 38)** |
| html_report.test.ts | 36 |
| integration.test.ts | 26 |
| los.test.ts | 54 |
| **mage_armor.test.ts** | **21 (Session 38)** |
| mechanics.test.ts | 57 |
| mount.test.ts | 44 |
| mount_redirect.test.ts | 21 |
| parser.test.ts | 101 |
| pc.test.ts | 270 |
| phase4.test.ts | 54 |
| rage.test.ts | 40 |
| resources.test.ts | 72 |
| scenario.test.ts | 94 |
| server.test.ts | 32 |
| shield_of_faith.test.ts | 27 |
| sleep.test.ts | 35 |
| sneak_attack.test.ts | 23 |
| spell_actions.test.ts | 52 |
| spell_effects.test.ts | 23 |
| summons.test.ts | 51 |
| thunderwave.test.ts | 25 |
| warding_bond.test.ts | 41 |

**Total: 2,258 passing, 0 failed**

---

## Run Tests
```bash
export TS_NODE_COMPILER_OPTIONS='{"lib":["ES2020","DOM"],"types":["node"]}'
for f in src/test/*.test.ts; do
  echo -n "$(basename $f): "
  timeout 35 npx ts-node "$f" 2>&1 | grep "Results:"
done
```

## Git Workflow
```bash
git config user.email "mcabel@users.noreply.github.com"
git config user.name "mcabel"
git add -A
git commit -m "Session 39: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```
