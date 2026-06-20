# MEGABATCH-MIGRATION-PLAN.md — Overnight Real-Mechanics Migration (Sessions 24-27)

> **Purpose:** This document is the complete specification for an overnight long-running
> task agent to migrate **124 spells** from forward-compat flags to bespoke implementations
> with REAL mechanical effects, across **4 sequential batches** (one per overnight run).
>
> **Audience:** The long-running task agent. Read this ENTIRE file before starting any batch.
>
> **Source analysis:** `MEGABATCH-ANALYSIS.json` (255 spells analyzed, 124 migratable,
> 131 blocked). Do NOT re-run the analysis — it's done. Use the per-spell specs below.
>
> **Prior work:** Sessions 22-23 migrated 14 spells (Fireball, Lightning Bolt, Cone of
> Cold, Inflict Wounds, Chromatic Orb, Catapult, Ice Knife, Blight, Cloudkill, Disintegrate,
> Harm, Finger of Death, Sunburst, Power Word Kill). These are the **reference patterns**
> — mirror them exactly.

---

## EXECUTIVE SUMMARY

| Batch | Spells | Pattern focus | Mirror spells | Est. time |
|-------|--------|---------------|---------------|-----------|
| **Batch 1** | 44 | Combat damage (AoE save, single-target save, spell attack, auto-hit) | Catapult, Shatter, Fireball, Sunburst, Scorching Ray, Inflict Wounds, Magic Missile | ~11 hrs |
| **Batch 2** | 35 | Save-or-condition (single + AoE) | Blindness/Deafness, Hold Person, Sunburst condition loop | ~8 hrs |
| **Batch 3** | 23 | Concentration buffs (hex rider, weapon enchant, advantage, bless die) | Hex, Bless, Magic Weapon, Faerie Fire | ~6 hrs |
| **Batch 4** | 22 | Persistent damage zones + healing + temp HP | Moonbeam, Cloud of Daggers, Healing Word, Cure Wounds | ~6 hrs |
| **TOTAL** | **124** | | | **~31 hrs** |

**131 spells remain blocked** (pending TG-006 Summon, TG-007 Wall, TG-008 Reaction,
TG-009 Antimagic, TG-010 LOS/Vision, TG-011 Complex subsystems). These are NOT in scope
for the megabatch — see `TEAMGOALS.md` for their blocker status.

---

## STARTUP CHECKLIST (run before EVERY batch)

1. `cd /home/z/my-project/dnd-combat-sim && git pull origin main` — get latest.
2. `npm install` — deps: ts-node, typescript.
3. `npm run spell-cache:build` — confirm current count (should be 420/557 before Batch 1;
   will rise to 544/557 after all 4 batches).
4. Read the **reference spell modules** for the patterns this batch uses (see each batch's
   "Reference patterns" section). You MUST mirror their exact structure.
5. Run the prior session's spell tests to confirm green baseline:
   ```bash
   for t in fireball lightning_bolt cone_of_cold inflict_wounds chromatic_orb catapult \
            ice_knife blight cloudkill disintegrate harm finger_of_death sunburst \
            power_word_kill; do
     npx ts-node --transpile-only src/test/${t}.test.ts | grep "Results:" | head -1
   done
   ```
   All 14 must print `Results: N passed, 0 failed`.
6. Run the bulk test: `npx ts-node --transpile-only src/test/bulk_spell_dispatch.test.ts | tail -3`
   — must print `Results: N passed, 0 failed`.
7. `npx tsc --noEmit 2>&1 | grep -v TS7006 | grep "error TS"` — must be empty (TS7006
   implicit-any in test files is pre-existing and acceptable).

---

## THE 7-STEP MIGRATION RECIPE (follow for EVERY spell)

For each spell in a batch, execute these 7 steps in order. **Do NOT skip steps.**

### Step 1: Rewrite the spell module (`src/spells/<snake>.ts`)

Replace the forward-compat flag implementation with a bespoke implementation. The module
MUST export: `metadata`, `shouldCast`, `execute`, `cleanup`, and (for damage spells)
`rollDamage`. Mirror the structure of the reference spell indicated in the per-spell spec.

**Module template (single-target save — mirror `catapult.ts`):**
```typescript
// Header comment: spell name, source (PHB p.X / XGE p.X), level, school, components,
//   Effect (1-2 sentences), Upcast, v1 simplifications, migration note.
import { Combatant, Battlefield } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollSave, rollDie, applyDamageWithTempHP } from '../engine/utils';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: '<Canonical>', level: <N>, school: '<school>', rangeFt: <N>,
  dieCount: <N>, dieSides: <N>, damageType: '<type>' as const,
  concentration: false, saveAbility: '<dex|con|str|wis|int|cha>' as const,
  castingTime: 'action',
  // ... forward-compat flags for simplifications
} as const;

function emit(state, type, actorId, desc, targetId?, value?): void { /* same as catapult */ }

export function rollDamage(): number { /* roll dieCount dieSides */ }

export function shouldCast(caster, bf): Combatant | null {
  // 1. Check caster has the action
  // 2. Check slot available (hasSpellSlot)
  // 3. Find best target (highest-threat enemy in range)
  // 4. Return Combatant or null
}

export function execute(caster, target, state): void {
  // 1. consumeSpellSlot
  // 2. emit action log
  // 3. Re-check target liveness
  // 4. rollSave → full or half damage
  // 5. applyDamageWithTempHP
  // 6. emit save + damage logs
}

export function cleanup(_c: Combatant): void { /* no-op for instantaneous */ }
```

**For AoE save spells** (mirror `shatter.ts` / `fireball.ts`): `shouldCast` returns
`Combatant[] | null` (array of all enemies in the AoE), `execute` takes
`(caster, targets[], state)` and loops over targets.

**For AoE + condition spells** (mirror `sunburst.ts`): same as AoE save, but on failed
save also call `applySpellEffect(target, { effectType: 'condition_apply', payload: { condition: '<cond>' }, sourceIsConcentration: false })`.

**For spell attack spells** (mirror `inflict_wounds.ts` melee / `scorching_ray.ts` ranged):
use `rollAttack(hitBonus, false, false)` instead of `rollSave`; `rollDamage(isCrit)`
doubles dice on crit.

**For cone AoE** (mirror `burning_hands.ts`): use `inConeFt(caster.pos, aimAt.pos, enemy.pos, rangeFt, halfAngleDeg)`.

**For line AoE** (mirror `lightning_bolt.ts`): use `inLineFt(caster.pos, aimAt.pos, enemy.pos, lengthFt, widthFt)`.

**For flat-bonus damage** (mirror `disintegrate.ts`): add `flatDamageBonus: <N>` to metadata;
`rollDamage(includeFlat = true)` adds the bonus; bonus IS halved on save.

**For HP-gate instakill** (mirror `power_word_kill.ts`): no save, no attack; `shouldCast`
gates on `target.currentHP <= threshold`; `execute` sets HP=0 + isDead/isUnconscious.

### Step 2: Add the type to `PlannedAction.type` union (`src/types/core.ts`)

Find the `PlannedAction` interface (search for `// ── Session 23 — Real-mechanics
migration batch 2`). Add a new comment section for the current batch and one type per spell:

```typescript
    // ── Session 24 — Megabatch batch 1 (44 combat damage spells) ──
    | 'chaosBolt'            // Chaos Bolt — PHB: ranged spell attack 2d8 + chaos-type bounce
    | 'earthTremor'          // Earth Tremor — XGE: CON save 1d6 bludgeoning + prone, 10-ft radius
    // ... etc
```

Use camelCase. The type name must match the `case '<type>':` branch in combat.ts and the
`type: '<type>'` in planner.ts.

### Step 3: Add the case branch in `combat.ts` (`executePlannedAction`)

Find the Session 23 case branches (search for `case 'powerWordKill':`). Add new case
branches after them, before the `case 'genericSpell':` block. Mirror the pattern:

**For single-target spells** (shouldCast returns `Combatant | null`):
```typescript
    case 'chaosBolt': {
      const cbTargetId = plan.targetId;
      const cbTarget = cbTargetId ? bf.combatants.get(cbTargetId) ?? null : null;
      const liveTarget = cbTarget && !cbTarget.isDead && !cbTarget.isUnconscious
        ? cbTarget
        : shouldCastChaosBolt(actor, bf);
      if (liveTarget) executeChaosBolt(actor, liveTarget, state);
      break;
    }
```

**For AoE spells** (shouldCast returns `Combatant[] | null`):
```typescript
    case 'earthTremor': {
      const etTargets = shouldCastEarthTremor(actor, bf);
      if (etTargets) executeEarthTremor(actor, etTargets, state);
      break;
    }
```

Add the import at the top of combat.ts (after the Session 23 import block):
```typescript
import {
  shouldCast as shouldCastChaosBolt,
  execute as executeChaosBolt,
} from '../spells/chaos_bolt';
```

### Step 4: Add the planner branch in `planner.ts`

Find the Session 23 planner branches (search for `12N. BLIGHT`). Add new branches after
them, before the `SESSION 19 — GENERIC SPELL LOOP`. Number them `12O`, `12P`, ... `12Z`,
`12AA`, `12AB`, etc.

**Tactical priority:** Higher-level spells first, then by expected damage. Each branch
gates on `!plan.action && self.actions.some(a => a.name === '<Canonical>')` then calls
shouldCast and sets `plan.action`.

```typescript
  // --- 12O. CHAOS BOLT (ranged spell attack 2d8 + chaos bounce, L1, NO concentration) ---
  if (!plan.action && self.actions.some(a => a.name === 'Chaos Bolt')) {
    const cbTarget = shouldCastChaosBolt(self, battlefield);
    if (cbTarget) {
      plan.action = {
        type: 'chaosBolt',
        action: null,
        targetId: cbTarget.id,
        description: `${self.name} casts Chaos Bolt at ${cbTarget.name}`,
      };
      plan.targetId = cbTarget.id;
      plan.bonusAction = planBonusAction(self, cbTarget, battlefield);
      return plan;
    }
  }
```

Add the import at the top of planner.ts (after the Session 23 import block):
```typescript
import { shouldCast as shouldCastChaosBolt } from '../spells/chaos_bolt';
```

### Step 5: Remove the spell from `_generic_registry.ts`

Use the Python script pattern from `scripts/remove_migrated_spells_s23.py`. For each spell,
remove:
1. The 5-line import block (`import { shouldCast as shouldCastX, execute as executeX, metadata as metadataX } from './snake';`)
2. The 6-line map entry (`'Canonical': { name: 'Canonical', level: metadataX.level, shouldCast: shouldCastX, execute: executeX, },`)

**Recommended:** Write a batch removal script `scripts/remove_migrated_spells_batch.py`
that takes a list of (canonical, snake, alias) tuples and removes all of them in one pass.
Mirror the Session 23 script's structure. Run it once per batch.

After removal, verify: `grep -c "^  '" src/spells/_generic_registry.ts` should drop by the
batch size (e.g. 299 → 255 after Batch 1's 44 spells).

### Step 6: Write the test file (`src/test/<snake>.test.ts`)

Mirror `catapult.test.ts` (single-target save), `fireball.test.ts` (AoE save),
`disintegrate.test.ts` (flat bonus), `sunburst.test.ts` (AoE + condition),
`power_word_kill.test.ts` (HP-gate), or `inflict_wounds.test.ts` (spell attack).

**Minimum test coverage (per spell):**
1. Metadata correctness (name, level, school, range, dice, damage type, save ability, concentration)
2. shouldCast gates: no action → null, no slot → null, no enemies in range → null, valid → returns target(s)
3. shouldCast target selection: highest-threat bias (damage spells) or HP-gate (Power Word variants)
4. execute — guaranteed fail (full damage): slot consumed, damage in dice range, correct log events
5. execute — guaranteed success (half damage): half-damage range, save-success log
6. (For AoE) multi-target: correct targets caught, no spillover to out-of-range enemies
7. (For condition riders) condition applied on fail, NOT on success
8. (For flat bonus) rollDamage with/without bonus
9. cleanup is a no-op

Use deterministic save DCs:
- Guaranteed fail: `saveDC: 25` + ability score 1 (mod -5, even nat 20 → 15 < 25)
- Guaranteed success: `saveDC: 5` + ability score 30 (mod +10, even nat 1 → 11 ≥ 5)

### Step 7: Update `bulk_spell_dispatch.test.ts`

After each batch:
1. Update the `MIGRATED_SPELLS_S2X` array in section 1b/1c/1d/1e to include the new spells.
2. If any migrated spell was a sample in `SAMPLE_SPELLS` or `SAMPLE_BY_LEVEL`, replace it
   with a non-migrated spell still in the registry.
3. Lower the `min-registry-size` assertion if needed (it should track `299 - cumulative_migrated`).
4. Run the bulk test: `npx ts-node --transpile-only src/test/bulk_spell_dispatch.test.ts | tail -3`

---

## POST-BATCH VERIFICATION (run after EVERY batch)

1. **tsc:** `npx tsc --noEmit 2>&1 | grep -v TS7006 | grep "error TS"` — must be empty.
2. **All new spell tests pass:**
   ```bash
   for t in <list of snake names migrated this batch>; do
     echo -n "$t: "
     npx ts-node --transpile-only src/test/${t}.test.ts 2>&1 | grep "Results:" | head -1
   done
   ```
   All must print `Results: N passed, 0 failed`.
3. **Bulk test passes:** `npx ts-node --transpile-only src/test/bulk_spell_dispatch.test.ts | tail -3`
4. **Regression — all prior bespoke spell tests still green:** run the 14 Session 22/23
   spell tests + healing_word + bless + burning_hands + magic_missile + shield_simple +
   sleep + arcane_lock + moonbeam + darkvision + combat + shatter + scorching_ray + summons.
5. **Spell cache rebuild:** `npm run spell-cache:build` — implemented count should rise
   by the batch size (420 → 464 after Batch 1, → 499 after Batch 2, → 522 after Batch 3,
   → 544 after Batch 4).
6. **Commit:** `git add -A && git commit -m "Cantrip-<N>: Megabatch batch <B> — <count> <pattern> spells"`
   - Batch 1 → Cantrip-24
   - Batch 2 → Cantrip-25
   - Batch 3 → Cantrip-26
   - Batch 4 → Cantrip-27
7. **Push:** `git push origin main` — tell the user if the push fails.
8. **Write handover:** Update `zHANDOVER-SESSION-<N>.md` (24, 25, 26, 27) with the batch
   summary, test counts, and next-batch instructions. Commit + push the handover.

---

## BATCH 1: Combat Damage Spells (44 spells) — Cantrip-24

**Goal:** Migrate all 44 combat-damage spells that mirror existing patterns exactly.
These are the highest-value, lowest-risk spells — pure damage with no persistent effects.

**Reference patterns to study before starting:**
- `src/spells/catapult.ts` — single-target save (DEX save, single Combatant target)
- `src/spells/blight.ts` — single-target save (CON save, 30 ft range)
- `src/spells/disintegrate.ts` — single-target save with flat bonus (+40)
- `src/spells/shatter.ts` — AoE save radius (CON save, 10-ft radius)
- `src/spells/fireball.ts` — AoE save radius (DEX save, 20-ft radius, 150 ft range)
- `src/spells/cloudkill.ts` — AoE save radius (one-shot, moving-AoE simplified)
- `src/spells/sunburst.ts` — AoE save + condition_apply (blinded on fail)
- `src/spells/burning_hands.ts` — AoE save cone (uses `inConeFt`)
- `src/spells/lightning_bolt.ts` — AoE save line (uses `inLineFt`)
- `src/spells/inflict_wounds.ts` — melee spell attack (uses `rollAttack`, `isAdjacent`)
- `src/spells/scorching_ray.ts` — ranged spell attack multi-attack (3 attacks)
- `src/spells/chromatic_orb.ts` — ranged spell attack single + type choice
- `src/spells/magic_missile.ts` — auto-hit damage (no save, no attack)
- `src/spells/power_word_kill.ts` — HP-gate instakill (no save, no attack)

**Engine helpers available:** `rollSave`, `rollAttack`, `rollDie`, `applyDamageWithTempHP`,
`applyDamage`, `abilityMod`, `chebyshev3D`, `livingEnemiesOf`, `livingAlliesOf`,
`isAdjacent`, `inConeFt`, `inLineFt`, `applySpellEffect` (for condition_apply),
`consumeSpellSlot`, `hasSpellSlot`.

**Tactical priority order in planner.ts:** L9 > L8 > L7 > L6 > L5 > L4 > L3 > L2 > L1,
then by expected damage within a level (higher dice count first). Number branches `12O`
through `12Z`, then `12AA` through `12AR` (44 branches total).

### Batch 1 spell list (44 spells, sorted by level then name)

#### L1 (8 spells)
- **Chaos Bolt** (`src/spells/chaos_bolt.ts`) — ranged spell attack 2d8 + chaos-type bounce
  - Pattern: `SPELL_ATTACK_RANGED` | Mirror: `scorching_ray` (single attack, not multi)
  - Notes: chaos-type random selection simplified — pick a random damage type from [acid, cold, fire, lightning, poison, thunder] on each cast. Crit-bounce to a second target within 30 ft of the first is simplified away (just double dice on crit like Inflict Wounds).
- **Earth Tremor** (`src/spells/earth_tremor.ts`) — CON save 1d6 bludgeoning + prone (10-ft radius)
  - Pattern: `AOE_SAVE_DAMAGE_WITH_CONDITION` | Mirror: `sunburst` (AoE save + condition_apply for prone)
  - Notes: caster is excluded from the AoE (PHB p.XGE:155 "other than you"). prone condition applied on fail.
- **Frost Fingers** (`src/spells/frost_fingers.ts`) — CON save 2d8 cold (15-ft cone)
  - Pattern: `AOE_SAVE_DAMAGE_CONE` | Mirror: `burning_hands` (cone via `inConeFt`)
- **Magnify Gravity** (`src/spells/magnify_gravity.ts`) — CON save 2d8 force (10-ft radius)
  - Pattern: `AOE_SAVE_DAMAGE_RADIUS` | Mirror: `shatter`
- **Ray of Sickness** (`src/spells/ray_of_sickness.ts`) — ranged spell attack 2d8 poison + poisoned on hit
  - Pattern: `SPELL_ATTACK_RANGED` | Mirror: `scorching_ray` (single attack) + `condition_apply` for poisoned on hit
- **Spellfire Flare** (`src/spells/spellfire_flare.ts`) — 2d10+mod fire auto-hit (60 ft)
  - Pattern: `AUTO_HIT_DAMAGE` | Mirror: `magic_missile` (no save, no attack — just apply damage)
  - Notes: single-target auto-hit (not multi-dart like Magic Missile). +mod is the caster's spellcasting mod.
- **Wardaway** (`src/spells/wardaway.ts`) — CON save 2d4 force (60 ft, single target)
  - Pattern: `SINGLE_TARGET_SAVE_DAMAGE` | Mirror: `catapult`
  - Notes: construct/undead auto-succeed simplification — skip the creature-type check (no tag in v1).
- **Witch Bolt** (`src/spells/witch_bolt.ts`) — ranged spell attack 1d12 lightning + 1d12/action DoT (concentration)
  - Pattern: `SPELL_ATTACK_RANGED` | Mirror: `scorching_ray` (single attack)
  - Notes: initial attack is ranged spell attack. DoT on subsequent turns (1d12/action auto-hit while caster uses action) is SIMPLIFIED AWAY — one-shot damage only. concentration flag set to false in v1 (since the persistent DoT is skipped).

#### L2 (2 spells)
- **Mind Spike** (`src/spells/mind_spike.ts`) — WIS save 3d8 psychic (60 ft, concentration, DoT tracking)
  - Pattern: `SINGLE_TARGET_SAVE_DAMAGE` | Mirror: `catapult`
  - Notes: concentration tracking simplified — one-shot damage. concentration flag set to false in v1.
- **Spray of Cards** (`src/spells/spray_of_cards.ts`) — DEX save 2d10 slashing + blinded (15-ft cone)
  - Pattern: `AOE_SAVE_DAMAGE_WITH_CONDITION` | Mirror: `sunburst` (but cone shape via `inConeFt`)
  - Notes: cone shape — use `inConeFt` like burning_hands, but with condition_apply for blinded on fail like sunburst.

#### L3 (5 spells)
- **Erupting Earth** (`src/spells/erupting_earth.ts`) — DEX save 3d12 bludgeoning + difficult terrain (20-ft cube)
  - Pattern: `AOE_SAVE_DAMAGE_WITH_CONDITION` | Mirror: `sunburst` (without the condition — difficult terrain is terrain-only, simplified away)
  - Notes: 20-ft cube approximated as 20-ft radius (chebyshev). difficult terrain rider NOT modelled.
- **Life Transference** (`src/spells/life_transference.ts`) — necrotic damage ×2 = heal caster (CON save 4d8 necrotic)
  - Pattern: `SINGLE_TARGET_SAVE_DAMAGE` | Mirror: `catapult` + heal rider
  - Notes: deal 4d8 necrotic to target (CON save half), then heal caster for 2× the necrotic damage dealt. Use `applyHeal(caster, healAmount)` from utils. This is a NEW rider — first spell to heal caster based on damage dealt.
- **Pulse Wave** (`src/spells/pulse_wave.ts`) — CON save 6d6 force + push/pull (cone)
  - Pattern: `AOE_SAVE_DAMAGE_WITH_CONDITION` | Mirror: `sunburst` (cone via `inConeFt`, push/pull simplified away)
- **Tidal Wave** (`src/spells/tidal_wave.ts`) — STR save 4d8 bludgeoning + prone (line/wave, no concentration)
  - Pattern: `AOE_SAVE_DAMAGE_WITH_CONDITION` | Mirror: `sunburst` (approximate the "wave" as a 30-ft line via `inLineFt`, + prone on fail)
- **Vampiric Touch** (`src/spells/vampiric_touch.ts`) — melee spell attack 3d6 necrotic + heal half (concentration)
  - Pattern: `SPELL_ATTACK_MELEE` | Mirror: `inflict_wounds` + heal rider
  - Notes: melee spell attack (touch range, `isAdjacent`). On hit, heal caster for half the necrotic damage dealt. concentration flag set to false in v1 (the persistent "attack each turn" rider is simplified away — one-shot attack only).

#### L4 (6 spells)
- **Elemental Bane** (`src/spells/elemental_bane.ts`) — WIS save 2d6 acid/poison/etc + vulnerability to chosen element
  - Pattern: `SINGLE_TARGET_SAVE_DAMAGE` | Mirror: `catapult`
  - Notes: vulnerability rider simplified — the "target takes double damage from chosen element" rider is NOT modelled (would need a new `vulnerability_add` effect type). One-shot 2d6 acid damage only. v1 picks acid as the default damage type (the "chosen element" is acid for simplicity).
- **Gravity Sinkhole** (`src/spells/gravity_sinkhole.ts`) — CON save 5d10 force + pull (20-ft radius, no concentration)
  - Pattern: `AOE_SAVE_DAMAGE_RADIUS` | Mirror: `shatter`
  - Notes: pull rider simplified (no position-change hook in v1). 20-ft radius, 5d10 force.
- **Ice Storm** (`src/spells/ice_storm.ts`) — DEX save 2d8 cold + 2d6 bludgeoning + difficult terrain (20-ft cylinder, no concentration)
  - Pattern: `AOE_SAVE_DAMAGE_RADIUS` | Mirror: `shatter`
  - Notes: 20-ft cylinder approximated as 20-ft radius. Combined damage: roll 2d8 cold + 2d6 bludgeoning, sum, apply as two separate damage applications (cold then bludgeoning — matters for resistances). difficult terrain rider NOT modelled. `damageType` in metadata can be a union or just 'cold' for simplicity — use a custom `rollDamageCold()` + `rollDamageBludgeon()` and sum.
- **Sickening Radiance** (`src/spells/sickening_radiance.ts`) — CON save 4d10 radiant + exhausted (30-ft cube, concentration)
  - Pattern: `AOE_SAVE_DAMAGE_WITH_CONDITION` | Mirror: `sunburst`
  - Notes: exhaustion simplified to poisoned (no exhaustion subsystem in v1 — 6 levels of exhaustion is too complex). 30-ft cube approximated as 30-ft radius. concentration flag set to false in v1 (the persistent damage_zone rider is simplified away — one-shot damage + condition).
- **Spellfire Storm** (`src/spells/spellfire_storm.ts`) — 4d10 fire auto-hit (60 ft, concentration, DoT)
  - Pattern: `AUTO_HIT_DAMAGE` | Mirror: `magic_missile`
  - Notes: single-target auto-hit. DoT rider simplified — one-shot. concentration flag false in v1.
- **Storm Sphere** (`src/spells/storm_sphere.ts`) — CON save 6d6 thunder (40-ft sphere) + 1d8 lightning ranged attack (concentration)
  - Pattern: `AOE_SAVE_DAMAGE_RADIUS` | Mirror: `shatter` (one-shot — the ranged-attack rider and DoT simplified away)
  - Notes: multi-effect simplified to one-shot 6d6 thunder AoE. concentration flag false in v1.
- **Vitriolic Sphere** (`src/spells/vitriolic_sphere.ts`) — DEX save 10d4 acid + 5d4 DoT (20-ft sphere, no concentration)
  - Pattern: `AOE_SAVE_DAMAGE_RADIUS` | Mirror: `shatter`
  - Notes: DoT simplified — one-shot 10d4 acid. 20-ft sphere.

#### L5 (8 spells)
- **Destructive Wave** (`src/spells/destructive_wave.ts`) — CON save 5d6 thunder/necrotic + prone (30-ft radius, no concentration)
  - Pattern: `AOE_SAVE_DAMAGE_WITH_CONDITION` | Mirror: `sunburst`
  - Notes: targets only enemies (NOT allies — PHB p.XGE:xx). Caster chooses thunder OR necrotic damage; v1 picks thunder. 30-ft radius. prone on fail.
- **Enervation** (`src/spells/enervation.ts`) — DEX save 4d8 necrotic + heal half + DoT (60 ft, concentration)
  - Pattern: `SINGLE_TARGET_SAVE_DAMAGE` | Mirror: `catapult` + heal rider
  - Notes: heal caster for half the damage dealt. DoT simplified — one-shot. concentration false in v1.
- **Flame Strike** (`src/spells/flame_strike.ts`) — DEX save 4d6 fire + 4d6 radiant (10-ft cylinder, no concentration)
  - Pattern: `AOE_SAVE_DAMAGE_RADIUS` | Mirror: `shatter`
  - Notes: 10-ft cylinder as 10-ft radius. Dual damage type: 4d6 fire + 4d6 radiant (sum, but apply as two damage applications for resistance).
- **Immolation** (`src/spells/immolation.ts`) — DEX save 8d6 fire + DoT until extinguished (90 ft, concentration)
  - Pattern: `SINGLE_TARGET_SAVE_DAMAGE` | Mirror: `catapult`
  - Notes: DoT simplified — one-shot 8d6 fire. concentration false in v1.
- **Maelstrom** (`src/spells/maelstrom.ts`) — DEX save 6d6 bludgeoning + restrained (20-ft radius, concentration)
  - Pattern: `AOE_SAVE_DAMAGE_WITH_CONDITION` | Mirror: `sunburst` (restrained on fail)
  - Notes: concentration false in v1 (persistent whirlpool simplified away — one-shot).
- **Negative Energy Flood** (`src/spells/negative_energy_flood.ts`) — CON save 5d12 necrotic + undead boost (60 ft, no concentration)
  - Pattern: `SINGLE_TARGET_SAVE_DAMAGE` | Mirror: `catapult`
  - Notes: undead-boost rider simplified (if target is undead and survives, it gains HP — no creature-type tag, skip). One-shot 5d12 necrotic.
- **Steel Wind Strike** (`src/spells/steel_wind_strike.ts`) — 5 melee spell attacks 6d10 force (30 ft, no concentration)
  - Pattern: `SPELL_ATTACK_MULTI` | Mirror: `scorching_ray` (5 attacks instead of 3, 6d10 instead of 2d6, melee not ranged)
  - Notes: teleport-to-last-target rider simplified away. 5 attacks against 5 distinct enemies (or fewer enemies if not enough targets — repeat attacks on the same enemy). Use `isAdjacent`-equivalent check for "within 30 ft" (the spell lets you teleport between attacks, but v1 simplifies to: all targets must be within 30 ft of caster).
- **Synaptic Static** (`src/spells/synaptic_static.ts`) — INT save 8d6 psychic + -1d6 to attacks (20-ft sphere, no concentration)
  - Pattern: `AOE_SAVE_DAMAGE_WITH_CONDITION` | Mirror: `sunburst`
  - Notes: the -1d6 to attacks rider is simplified to `condition_apply:incapacitated` (no existing -1d6 debuff effect type). 20-ft sphere, INT save, 8d6 psychic.

#### L6 (4 spells)
- **Chain Lightning** (`src/spells/chain_lightning.ts`) — 4 targets 10d8 lightning (150 ft, no concentration)
  - Pattern: `SPELL_ATTACK_MULTI` | Mirror: `scorching_ray` (but no attack roll — it's auto-hit to 4 targets)
  - Notes: Actually this is NOT a spell attack — it's auto-hit lightning to 1 primary + 3 arcs. Reclassify as `AUTO_HIT_DAMAGE` multi-target. shouldCast returns `Combatant[] | null` (up to 4 targets: primary + 3 nearest enemies within 30 ft of primary). execute applies 10d8 lightning to each. Mirror `magic_missile` for auto-hit + `fireball` for multi-target.
- **Circle of Death** (`src/spells/circle_of_death.ts`) — CON save 8d6 necrotic (60-ft sphere, no concentration)
  - Pattern: `AOE_SAVE_DAMAGE_RADIUS` | Mirror: `shatter` (60-ft radius, 60-ft range)
- **Gravity Fissure** (`src/spells/gravity_fissure.ts`) — CON save 8d8 force + pull (100-ft line, no concentration)
  - Pattern: `AOE_SAVE_DAMAGE_LINE` | Mirror: `lightning_bolt` (100-ft line via `inLineFt`, 8d8 force)
  - Notes: pull rider simplified away.
- **Mental Prison** (`src/spells/mental_prison.ts`) — INT save 5d10 psychic + 3d10 if moves (60 ft, concentration)
  - Pattern: `SINGLE_TARGET_SAVE_DAMAGE` | Mirror: `catapult`
  - Notes: movement-trigger rider simplified — one-shot 5d10 psychic. concentration false in v1.
- **Sunbeam** (`src/spells/sunbeam.ts`) — CON save 6d8 radiant + blinded (60-ft LINE, concentration, repeat action)
  - Pattern: `AOE_SAVE_DAMAGE_WITH_CONDITION` | Mirror: `sunburst` (condition_apply for blinded) + `lightning_bolt` (LINE shape via `inLineFt`)
  - Notes: **LINE shape, not cone** (per PHB p.279 — "5-foot-wide, 60-foot-long line"). Use `inLineFt(caster.pos, aimAt.pos, enemy.pos, 60, 5)`. concentration false in v1 (repeat-action rider simplified — one-shot).

#### L7 (2 spells)
- **Crown of Stars** (`src/spells/crown_of_stars.ts`) — 7 motes 4d12 radiant ranged (no concentration, 1 hr)
  - Pattern: `SPELL_ATTACK_MULTI` | Mirror: `scorching_ray`
  - Notes: 7-mote storage simplified — one-shot 1 mote = 4d12 radiant ranged spell attack. The "1 mote/bonus action for 7 turns" rider simplified to a single attack. concentration false.
- **Fire Storm** (`src/spells/fire_storm.ts`) — DEX save 7d10 fire (10 10-ft cubes, no concentration)
  - Pattern: `AOE_SAVE_DAMAGE_RADIUS` | Mirror: `shatter`
  - Notes: complex shape (10 10-ft cubes) simplified to a single 40-ft radius sphere. 7d10 fire.

#### L8 (5 spells)
- **Dark Star** (`src/spells/dark_star.ts`) — 8d8 necrotic + blinded (40-ft sphere, concentration, magical darkness)
  - Pattern: `AOE_SAVE_DAMAGE_WITH_CONDITION` | Mirror: `sunburst` (40-ft radius, blinded on fail)
  - Notes: magical-darkness rider simplified away (would need TG-010 LOS subsystem). concentration false in v1.
- **Earthquake** (`src/spells/earthquake.ts`) — 5d6 bludgeoning + difficult terrain/fissures (50-ft radius, concentration)
  - Pattern: `AOE_SAVE_DAMAGE_RADIUS` | Mirror: `shatter`
  - Notes: multi-effect simplified to one-shot 5d6 bludgeoning (no save — auto-hit AoE). difficult terrain/fissure riders NOT modelled. concentration false in v1.
- **Feeblemind** (`src/spells/feeblemind.ts`) — INT save 4d6 psychic + INT/CHA→1 (60-day disable, no concentration)
  - Pattern: `SINGLE_TARGET_SAVE_DAMAGE` | Mirror: `catapult` + condition_apply
  - Notes: ability-damage rider simplified to `condition_apply:incapacitated` (no ability-score-damage subsystem). 4d6 psychic + incapacitated on fail. 60-day duration NOT tracked (persists for v1 combat).
- **Incendiary Cloud** (`src/spells/incendiary_cloud.ts`) — DEX save 10d8 fire (20-ft sphere, no concentration, moving)
  - Pattern: `AOE_SAVE_DAMAGE_RADIUS` | Mirror: `shatter` (moving rider simplified — one-shot)
- **Maddening Darkness** (`src/spells/maddening_darkness.ts`) — 8d8 psychic + darkness (60-ft sphere, concentration)
  - Pattern: `AOE_SAVE_DAMAGE_WITH_CONDITION` | Mirror: `sunburst` (darkness rider simplified — no condition applied, just 8d8 psychic)
  - Notes: darkness rider simplified away (would need TG-010). concentration false in v1. Reclassify as `AOE_SAVE_DAMAGE_RADIUS` (no condition).

#### L9 (2 spells)
- **Psychic Scream** (`src/spells/psychic_scream.ts`) — INT save 14d6 psychic + stunned (90 ft, 10 targets, no concentration)
  - Pattern: `AOE_SAVE_DAMAGE_WITH_CONDITION` | Mirror: `sunburst` (stunned on fail, up to 10 targets)
  - Notes: 10-target cap — shouldCast picks the 10 highest-threat enemies within 90 ft. "Head explodes if unblocked" rider simplified away. 14d6 psychic + stunned on fail.
- **Ravenous Void** (`src/spells/ravenous_void.ts`) — 5d10 force (60-ft sphere, 1000 ft, concentration, pull + restrained)
  - Pattern: `AOE_SAVE_DAMAGE_RADIUS` | Mirror: `shatter` (1000-ft range, 60-ft radius, no save — auto-hit)
  - Notes: pull/restrained riders simplified away. concentration false in v1. Auto-hit 5d10 force (PHB p.XGE:xx — no save, just damage).

### Batch 1 special notes

- **Dual-damage spells** (Ice Storm 2d8 cold + 2d6 bludgeoning; Flame Strike 4d6 fire + 4d6 radiant): implement `rollDamageCold()` + `rollDamageBludgeon()` as separate helpers, sum for total, but apply as two `applyDamageWithTempHP` calls (cold then bludgeoning) so resistances apply correctly per type.
- **Heal-riders** (Life Transference, Vampiric Touch, Enervation): import `applyHeal` from `../engine/utils`. Heal the caster for half (Vampiric Touch, Enervation) or 2× (Life Transference) the necrotic damage DEALT (after resistance, before temp HP absorption). Use `dealt` return value from `applyDamageWithTempHP`.
- **Auto-hit multi-target** (Chain Lightning): shouldCast returns `Combatant[] | null` (up to 4 targets). No attack roll, no save — just apply damage to each. Mirror `magic_missile`'s auto-hit + `fireball`'s multi-target shape.
- **Cone spells** (Frost Fingers, Spray of Cards, Pulse Wave): use `inConeFt(caster.pos, aimAt.pos, enemy.pos, rangeFt, halfAngleDeg)`. Cone half-angle is 90° for a "standard cone" (180° total spread) — check burning_hands.ts for the exact call.
- **Line spells** (Gravity Fissure, Sunbeam, Tidal Wave-as-line): use `inLineFt(caster.pos, aimAt.pos, enemy.pos, lengthFt, widthFt = 5)`.

---

## BATCH 2: Save-or-Condition Spells (35 spells) — Cantrip-25

**Goal:** Migrate all 35 save-or-condition spells (single-target + AoE). These apply a
condition (blinded, charmed, frightened, paralyzed, poisoned, restrained, stunned, prone,
unconscious, incapacitated, sleeping) on a failed save, with NO damage.

**Reference patterns:**
- `src/spells/blindness_deafness.ts` — single-target save-or-condition (CON save or blinded)
- `src/spells/hold_person.ts` — single-target save-or-condition (WIS save or paralyzed)
- `src/spells/sunburst.ts` — AoE save + condition_apply loop (the condition portion)

**Engine helpers:** `applySpellEffect(target, { effectType: 'condition_apply', payload: { condition: '<cond>' }, sourceIsConcentration: false })`.

**Conditions available** (all via `condition_apply`): `blinded`, `charmed`, `deafened`,
`frightened`, `incapacitated`, `invisible`, `paralyzed`, `petrified`, `poisoned`,
`restrained`, `stunned`, `unconscious`, `sleeping`.

**Tactical priority in planner.ts:** L9 > L8 > ... > L1. Conditions that fully disable
(stunned, paralyzed, unconscious, petrified) rank above partial conditions (frightened,
poisoned, prone). Number branches continuing from Batch 1's last branch.

### Batch 2 spell list (35 spells)

#### L1 (6 spells)
- **Animal Friendship** (`src/spells/animal_friendship.ts`) — WIS save or charmed (24 hr, beast only)
  - Mirror: `hold_person` | creature-type restriction NOT enforced (no beast tag). `condition_apply:charmed`.
- **Cause Fear** (`src/spells/cause_fear.ts`) — WIS save or frightened (1 target, L1)
  - Mirror: `hold_person` | `condition_apply:frightened`. Upcast adds targets — NOT modelled.
- **Charm Person** (`src/spells/charm_person.ts`) — WIS save or charmed (humanoid only)
  - Mirror: `hold_person` | `condition_apply:charmed`. Humanoid restriction NOT enforced.
- **Color Spray** (`src/spells/color_spray.ts`) — 6d10 HP-pool cone (15-ft), affected creatures unconscious
  - Mirror: `sunburst` (cone via `inConeFt`, condition_apply:unconscious)
  - Notes: HP-pool mechanic simplified — roll 6d10 = total HP budget; affect enemies lowest-currentHP-first until budget exhausted. This is a NEW selection pattern (HP-budget, not save). Implement shouldCast to return `Combatant[] | null` sorted by currentHP ascending, then execute applies unconscious to each in order, subtracting currentHP from the budget, until budget ≤ 0.
- **Command** (`src/spells/command.ts`) — WIS save or 1-word command (simplified to incapacitated)
  - Mirror: `hold_person` | `condition_apply:incapacitated`. Command options (approach, drop, flee, grovel, halt) all simplified to incapacitated.
- **Compelled Duel** (`src/spells/compelled_duel.ts`) — WIS save or compelled to attack caster
  - Mirror: `hold_person` | `condition_apply:frightened` (taunt simplified to frightened — target has disadv on attacks vs others). Complex movement restrictions NOT modelled.
- **Grease** (`src/spells/grease.ts`) — DEX save or prone (10-ft square, no damage)
  - Mirror: `sunburst` (AoE, condition_apply:prone). 10-ft square as 10-ft radius. No damage — pure condition AoE.

#### L2 (1 spell)
- **Pyrotechnics** (`src/spells/pyrotechnics.ts`) — CON save or blinded (uses fire source, 10-ft effect)
  - Mirror: `sunburst` (condition_apply:blinded). Fire-source requirement simplified — assume always available. 10-ft radius.

#### L3 (9 spells)
- **Antagonize** (`src/spells/antagonize.ts`) — WIS save 4d4 psychic + must attack caster (concentration)
  - Mirror: `hold_person` + damage. This is actually `SAVE_CONDITION_SINGLE` with damage — deal 4d4 psychic + apply frightened (taunt simplified). concentration false in v1.
- **Bestow Curse** (`src/spells/bestow_curse.ts`) — WIS save or cursed (choose: disadv on attacks/ability/no action/take damage)
  - Mirror: `hold_person` | `condition_apply:incapacitated` (curse options simplified to one — incapacitated). concentration true (PHB p.214 — concentration 1 min).
- **Catnap** (`src/spells/catnap.ts`) — 3 willing creatures fall asleep (no save, 10 min short rest)
  - Mirror: `sunburst` (AoE, no save — willing targets). `condition_apply:sleeping` to up to 3 willing allies. No save (willing). short-rest benefit NOT modelled.
- **Enemies Abound** (`src/spells/enemies_abound.ts`) — INT save or treat allies as enemies (concentration)
  - Mirror: `hold_person` | `condition_apply:frightened` (target-acquisition debuff simplified). concentration true.
- **Fast Friends** (`src/spells/fast_friends.ts`) — WIS save or charmed (single target, 1 hr, concentration)
  - Mirror: `hold_person` | `condition_apply:charmed`. concentration true.
- **Fear** (`src/spells/fear.ts`) — WIS save or frightened + drop weapon (cone)
  - Mirror: `sunburst` (cone via `inConeFt`, condition_apply:frightened). Drop-weapon rider simplified away.
- **Hypnotic Pattern** (`src/spells/hypnotic_pattern.ts`) — WIS save or charmed+incapacitated (10-ft cube, concentration)
  - Mirror: `sunburst` (condition_apply:charmed AND incapacitated — two applySpellEffect calls). 10-ft cube as 10-ft radius. concentration true.
- **Incite Greed** (`src/spells/incite_greed.ts`) — WIS save or charmed (cone, concentration)
  - Mirror: `sunburst` (cone, condition_apply:charmed). concentration true.
- **Sleet Storm** (`src/spells/sleet_storm.ts`) — DEX save or prone + concentration breaks (20-ft cylinder, no damage, concentration)
  - Mirror: `sunburst` (condition_apply:prone). Concentration-break rider simplified away. 20-ft cylinder as 20-ft radius. concentration true.
- **Stinking Cloud** (`src/spells/stinking_cloud.ts`) — CON save or poisoned+incapacitated (20-ft cube, no damage, concentration)
  - Mirror: `sunburst` (condition_apply:poisoned AND incapacitated). 20-ft cube as 20-ft radius. concentration true.

#### L4 (3 spells)
- **Charm Monster** (`src/spells/charm_monster.ts`) — WIS save or charmed (any creature, no concentration)
  - Mirror: `hold_person` (but any creature, not just humanoid). condition_apply:charmed.
- **Dominate Beast** (`src/spells/dominate_beast.ts`) — WIS save or charmed+controlled (beast, concentration)
  - Mirror: `hold_person` | control simplified to charmed. condition_apply:charmed. concentration true.
- **Phantasmal Killer** (`src/spells/phantasmal_killer.ts`) — WIS save or frightened + 4d10 psychic DoT (concentration)
  - Mirror: `hold_person` + damage. Deal 4d10 psychic + condition_apply:frightened on fail. DoT simplified — one-shot. concentration true.
- **Watery Sphere** (`src/spells/watery_sphere.ts`) — STR save or restrained + moved (5-ft sphere, no damage, concentration)
  - Mirror: `sunburst` (condition_apply:restrained). 5-ft radius. movement rider simplified. concentration true.

#### L5 (4 spells)
- **Contagion** (`src/spells/contagion.ts`) — melee spell attack + disease (poisoned simplification, no save initially)
  - Mirror: `inflict_wounds` (melee spell attack) + condition_apply:poisoned on hit. Disease-after-3-saves mechanic simplified to immediate poisoned on hit. concentration false (PHB p.227 — no concentration).
- **Dominate Person** (`src/spells/dominate_person.ts`) — WIS save or charmed+controlled (humanoid, concentration)
  - Mirror: `hold_person` | control simplified to charmed. condition_apply:charmed. concentration true.
- **Geas** (`src/spells/geas.ts`) — WIS save or 5d10 psychic damage on disobey (no concentration, 30 days)
  - Mirror: `hold_person` | damage-on-disobey simplified to one-shot: deal 5d10 psychic + condition_apply:charmed on fail. No concentration (PHB p.245). 30-day duration NOT tracked.
- **Hold Monster** (`src/spells/hold_monster.ts`) — WIS save or paralyzed (any creature, concentration)
  - Mirror: `hold_person` (any creature, not just humanoid). condition_apply:paralyzed. concentration true.

#### L6 (3 spells)
- **Eyebite** (`src/spells/eyebite.ts`) — each turn choose: asleep/panicked/sickened (concentration)
  - Mirror: `hold_person` | choice-per-turn simplified — v1 picks asleep (condition_apply:sleeping) on one target. concentration true. One-shot (the per-turn choice rider simplified).
- **Flesh to Stone** (`src/spells/flesh_to_stone.ts`) — CON save or restrained (then petrified on 3 fails, concentration)
  - Mirror: `blindness_deafness` | 3-fail mechanic simplified to one condition: condition_apply:restrained on fail (petrified-on-3-fails simplified). concentration true.
- **Mass Suggestion** (`src/spells/mass_suggestion.ts`) — WIS save or follow suggestion (12 targets, no concentration, 24 hr)
  - Mirror: `sunburst` (AoE, up to 12 targets, condition_apply:charmed). No concentration. 24-hr duration NOT tracked.

#### L7 (3 spells)
- **Power Word Pain** (`src/spells/power_word_pain.ts`) — HP gate (≤ 60) → slowed + 4d8 psychic DoT (no save, no concentration)
  - Mirror: `power_word_kill` (HP-gate pattern) + damage. If target.currentHP ≤ 60: deal 4d8 psychic + condition_apply:restrained (slowed simplified to restrained). No save, no attack. Slot consumed unconditionally.
- **Reverse Gravity** (`src/spells/reverse_gravity.ts`) — DEX save or restrained (falling) (50-ft cube, concentration)
  - Mirror: `sunburst` (condition_apply:restrained). 50-ft cube as 50-ft radius. concentration true.
- **Whirlwind** (`src/spells/whirlwind.ts`) — CON save or restrained (50-ft cone, concentration)
  - Mirror: `sunburst` (cone via `inConeFt`, condition_apply:restrained). concentration true.

#### L8 (1 spell)
- **Dominate Monster** (`src/spells/dominate_monster.ts`) — WIS save or charmed+controlled (any creature, concentration)
  - Mirror: `hold_person` | control simplified to charmed. condition_apply:charmed. concentration true.
- **Power Word Stun** (`src/spells/power_word_stun.ts`) — HP gate (≤ 150) → stunned (no save, no concentration)
  - Mirror: `power_word_kill` (HP-gate) + condition_apply:stunned. If target.currentHP ≤ 150: apply stunned. No save, no attack. Slot consumed unconditionally.

#### L9 (1 spell)
- **Weird** (`src/spells/weird.ts`) — WIS save or frightened + 4d10 psychic DoT (120 ft, concentration)
  - Mirror: `sunburst` (AoE, condition_apply:frightened + 4d10 psychic on fail). DoT simplified — one-shot. 120-ft range, 30-ft radius. concentration true.

---

## BATCH 3: Concentration Buffs (23 spells) — Cantrip-26

**Goal:** Migrate all 23 concentration buff spells that use existing SpellEffectType
values. These apply a persistent buff to the caster or an ally via `applySpellEffect`.

**Reference patterns:**
- `src/spells/bless.ts` — `bless_die` effect (+1d4 to attacks/saves, up to 3 allies)
- `src/spells/hex.ts` — `hex_damage` effect (+1d6 necrotic on each weapon hit vs target)
- `src/spells/magic_weapon.ts` — `weapon_enchant` effect (+1 to attack/damage)
- `src/spells/faerie_fire.ts` — `advantage_vs` effect (advantage on attacks vs target)
- `src/spells/barkskin.ts` — `ac_floor` effect (AC = max(AC, 16))
- `src/spells/shield_of_faith.ts` — `ac_bonus` effect (+2 AC)
- `src/spells/enlarge_reduce.ts` — `enlarge_reduce` effect (size/damage buff/debuff)

**Engine helpers:** `applySpellEffect(target, { casterId, spellName, effectType, payload, sourceIsConcentration })`.
For concentration buffs, `sourceIsConcentration: true` (so the effect is removed if
concentration breaks). The caster's `concentration` field should be set (mirror bless.ts).

**SpellEffectType payloads** (study `src/types/core.ts` `ActiveEffect` interface + `src/engine/spell_effects.ts`):
- `bless_die`: `{ die: 4 }` (or `{ die: -4 }` for Bane — negative bless)
- `hex_damage`: `{ damageType: 'necrotic', die: 6 }` (rider on weapon hit)
- `weapon_enchant`: `{ attackBonus: 1, damageBonus: 1, damageType?: 'fire' }`
- `advantage_vs`: `{ advType: 'attacks_vs', advScope: '<type>' }`
- `ac_bonus`: `{ bonus: 2 }`
- `ac_floor`: `{ floor: 16 }`

### Batch 3 spell list (23 spells)

#### BUFF_BLESS_DIE (2 spells)
- **Bane** (`src/spells/bane.ts`) — CHA save or -1d4 to attacks/saves (3 targets)
  - Mirror: `bless` (but inverse — negative bless_die). shouldCast targets up to 3 enemies. They make a CHA save; on fail, apply `bless_die` with `{ die: -4 }`. concentration true.
- **Motivational Speech** (`src/spells/motivational_speech.ts`) — +1d4 to attacks/saves + 5 temp HP (concentration)
  - Mirror: `bless` (bless_die `{ die: 4 }` to up to 3 allies) + temp HP. Apply `bless_die` + set `tempHP += 5` on each ally. concentration true.

#### BUFF_HEX_RIDER (11 spells — all the Smite spells + ranger strikes)
- **Ensnaring Strike** (`src/spells/ensnaring_strike.ts`) — next weapon hit +1d6 piercing + restrained (concentration)
  - Mirror: `hex` (hex_damage `{ damageType: 'piercing', die: 6 }` on next weapon hit) + condition_apply:restrained on the target hit. Self-cast buff (applies to caster). concentration true.
- **Hail of Thorns** (`src/spells/hail_of_thorns.ts`) — next ranged weapon hit +1d10 piercing + AoE (concentration)
  - Mirror: `hex` (hex_damage `{ damageType: 'piercing', die: 10 }`). AoE rider simplified. concentration true.
- **Searing Smite** (`src/spells/searing_smite.ts`) — next weapon hit +1d6 fire + 1d6 fire/turn DoT (concentration)
  - Mirror: `hex` (hex_damage `{ damageType: 'fire', die: 6 }`). DoT simplified. concentration true.
- **Thunderous Smite** (`src/spells/thunderous_smite.ts`) — next weapon hit +2d6 thunder + push 10 ft (concentration)
  - Mirror: `hex` (hex_damage `{ damageType: 'thunder', die: 6 }` — note: 2d6 not 1d6; the hex_damage payload die would need to be `{ die: 6, count: 2 }` OR roll twice). Push rider simplified. concentration true.
- **Wrathful Smite** (`src/spells/wrathful_smite.ts`) — next weapon hit +1d6 psychic + frightened (concentration)
  - Mirror: `hex` (hex_damage `{ damageType: 'psychic', die: 6 }`) + condition_apply:frightened on target hit. concentration true.
- **Zephyr Strike** (`src/spells/zephyr_strike.ts`) — next weapon hit +1d8 force + disengage + speed boost (concentration)
  - Mirror: `hex` (hex_damage `{ damageType: 'force', die: 8 }`). Disengage + speed boost riders simplified. concentration true.
- **Blinding Smite** (`src/spells/blinding_smite.ts`) — next weapon hit +3d8 radiant + blinded (concentration)
  - Mirror: `hex` (hex_damage `{ damageType: 'radiant', die: 8, count: 3 }`) + condition_apply:blinded on target hit. concentration true.
- **Lightning Arrow** (`src/spells/lightning_arrow.ts`) — next weapon hit +4d8 lightning + 2d8 AoE (concentration)
  - Mirror: `hex` (hex_damage `{ damageType: 'lightning', die: 8, count: 4 }`). AoE rider simplified. concentration true.
- **Spirit Shroud** (`src/spells/spirit_shroud.ts`) — +1d8 on weapon hit + targets slowed (10-ft aura, concentration)
  - Mirror: `hex` (hex_damage `{ damageType: 'radiant', die: 8 }` — v1 picks radiant over necrotic). Aura-based: applies to all enemies within 10 ft (not just one target). Slow rider simplified. concentration true.
- **Staggering Smite** (`src/spells/staggering_smite.ts`) — next weapon hit +4d6 psychic + DC WIS save stunned (concentration)
  - Mirror: `hex` (hex_damage `{ damageType: 'psychic', die: 6, count: 4 }`) + condition_apply:stunned on target hit (WIS save simplified — auto-stun on hit). concentration true.
- **Banishing Smite** (`src/spells/banishing_smite.ts`) — next weapon hit +5d10 force + banish if HP ≤ 50 (concentration)
  - Mirror: `hex` (hex_damage `{ damageType: 'force', die: 10, count: 5 }`). Banish rider simplified. concentration true.

#### BUFF_WEAPON_ENCHANT (6 spells)
- **Divine Favor** (`src/spells/divine_favor.ts`) — +1d4 radiant on weapon attacks (concentration)
  - Mirror: `magic_weapon` (weapon_enchant `{ attackBonus: 0, damageBonus: 0, damageType: 'radiant', damageDie: 4 }`). NOTE: weapon_enchant payload may need a `damageDie` field for the +1d4 — check `src/types/core.ts` ActiveEffect payload shape. If no die field, approximate as +1 damage (weapon_enchant `{ attackBonus: 0, damageBonus: 1 }`) and document the simplification. Self-cast. concentration true.
- **Shadow Blade** (`src/spells/shadow_blade.ts`) — creates 2d8 psychic weapon (concentration)
  - Mirror: `magic_weapon` (weapon_enchant `{ attackBonus: 1, damageBonus: 0, damageType: 'psychic', damageDie: 8, damageCount: 2 }`). The "creates a weapon" is approximated as enchanting an existing weapon. concentration true.
- **Elemental Weapon** (`src/spells/elemental_weapon.ts`) — +1 attack + 1d4 elemental damage (concentration)
  - Mirror: `magic_weapon` (weapon_enchant `{ attackBonus: 1, damageBonus: 0, damageType: 'fire', damageDie: 4 }`). v1 picks fire. concentration true.
- **Flame Arrows** (`src/spells/flame_arrows.ts`) — +1d6 fire on ammo (concentration)
  - Mirror: `magic_weapon` (weapon_enchant `{ attackBonus: 0, damageBonus: 0, damageType: 'fire', damageDie: 6 }`). concentration true.
- **Holy Weapon** (`src/spells/holy_weapon.ts`) — +5d8 radiant on weapon attacks + 8d8 blast on dismiss (concentration)
  - Mirror: `magic_weapon` (weapon_enchant `{ attackBonus: 1, damageBonus: 0, damageType: 'radiant', damageDie: 8, damageCount: 5 }`). Dismiss-blast simplified. concentration true.
- **Swift Quiver** (`src/spells/swift_quiver.ts`) — bonus action: extra ammo attack (concentration)
  - Mirror: `magic_weapon` (no damage bonus — attack-count buff). This spell doesn't add damage; it grants a bonus-action attack. Simplified: apply weapon_enchant `{ attackBonus: 0, damageBonus: 0 }` as a marker, and document that the bonus-action attack is NOT modelled (no bonus-action-attack hook). concentration true. LOW value — consider deferring if the weapon_enchant payload doesn't fit.

#### BUFF_ADVANTAGE_VS (4 spells)
- **Beacon of Hope** (`src/spells/beacon_of_hope.ts`) — adv on WIS/death saves + max heal (concentration)
  - Mirror: `faerie_fire` (advantage_vs `{ advType: 'saves', advScope: 'wis' }`). Max-heal rider NOT modelled. Affects up to 3 allies. concentration true.
- **Intellect Fortress** (`src/spells/intellect_fortress.ts`) — adv on INT/WIS/CHA saves + psychic resistance (concentration)
  - Mirror: `faerie_fire` (advantage_vs `{ advType: 'saves', advScope: 'int_wis_cha' }`). Resistance rider NOT modelled. Self or one ally. concentration true.
- **Holy Aura** (`src/spells/holy_aura.ts`) — adv on saves vs spells + light + blind attackers (30-ft aura, concentration)
  - Mirror: `faerie_fire` (advantage_vs `{ advType: 'saves', advScope: 'spells' }`). Light + blind-attackers riders simplified. 30-ft aura to all allies. concentration true.
- **Foresight** (`src/spells/foresight.ts`) — advantage on all d20 + enemies disadv (touch, concentration, 8 hr)
  - Mirror: `faerie_fire` (advantage_vs `{ advType: 'all', advScope: 'all' }`). Enemies-disadv simplified (would need a debuff on all enemies). Touch, one ally. concentration true. 8-hr duration NOT tracked.

---

## BATCH 4: Persistent Zones + Healing + Temp HP (22 spells) — Cantrip-27

**Goal:** Migrate the 22 persistent-damage-zone, healing, and temp-HP spells. These are
the most complex remaining — they use `damage_zone` (persistent AoE that ticks each turn),
`applyHeal`, and `tempHP`.

**Reference patterns:**
- `src/spells/moonbeam.ts` — `damage_zone` effect (persistent AoE, CON save on enter/start-of-turn)
- `src/spells/cloud_of_daggers.ts` — `damage_zone` effect (persistent AoE, auto-damage)
- `src/spells/flaming_sphere.ts` — `damage_zone` effect (persistent, bonus-action to move)
- `src/spells/healing_word.ts` — healing (1d4+WIS heal, bonus action)
- `src/spells/prayer_of_healing.ts` — multi-target healing

**Engine helpers:**
- `applySpellEffect(target, { effectType: 'damage_zone', payload: { cellKey, damageType, dieCount, dieSides, saveDC, saveAbility }, sourceIsConcentration: true })` — the damage_zone ticks on start-of-turn for any enemy in the cell.
- `applyHeal(target, amount)` — heals, capped at maxHP.
- `target.tempHP = amount` — sets temp HP (overwrites, doesn't stack — PHB p.198).

**IMPORTANT:** Study `moonbeam.ts` and `cloud_of_daggers.ts` carefully before starting
Batch 4. The `damage_zone` payload shape and the start-of-turn tick hook in `runCombat`
are the trickiest parts. The cleanup function for damage_zone spells MUST remove the
sentinel effect when concentration breaks or the caster dies (mirror moonbeam.ts cleanup).

### Batch 4 spell list (22 spells)

#### PERSISTENT_DAMAGE_ZONE (11 spells)
- **Death Armor** (`src/spells/death_armor.ts`) — 1d4 slashing aura to attackers (concentration)
  - Mirror: `cloud_of_daggers` (damage_zone, but self-aura — attacker-triggered, not start-of-turn). This is a NEW trigger (on-attacked, not on-turn). Simplified: apply as damage_zone centered on caster with a note that the "attacker triggers" is approximated as "start-of-turn for adjacent enemies". concentration true.
- **Dust Devil** (`src/spells/dust_devil.ts`) — 1d8 bludgeoning aura + moving (concentration)
  - Mirror: `moonbeam` (damage_zone, 10-ft radius, 1d8 bludgeoning). Moving rider simplified. concentration true.
- **Healing Spirit** (`src/spells/healing_spirit.ts`) — 1d6 heal/turn aura (concentration, bonus action)
  - Mirror: `moonbeam` (damage_zone with NEGATIVE damage = heal). Apply `damage_zone` with `damageType: 'heal'` (or a heal_zone sentinel). This is a NEW variant — damage_zone that heals allies instead of damaging enemies. concentration true. bonus action.
- **Cacophonic Shield** (`src/spells/cacophonic_shield.ts`) — 2d6 thunder aura (10-ft, concentration)
  - Mirror: `cloud_of_daggers` (damage_zone, 10-ft radius, 2d6 thunder). concentration true.
- **Call Lightning** (`src/spells/call_lightning.ts`) — 3d10 lightning per turn (60-ft radius, concentration)
  - Mirror: `moonbeam` (damage_zone, but the caster chooses a strike point each turn — simplified to a fixed damage_zone that ticks for 3d10 lightning). concentration true.
- **Hunger of Hadar** (`src/spells/hunger_of_hadar.ts`) — 2d6 cold + 4d6 acid per turn (20-ft sphere, concentration)
  - Mirror: `moonbeam` (damage_zone, 20-ft radius, dual damage: 2d6 cold + 4d6 acid). concentration true.
- **Spirit Guardians** (`src/spells/spirit_guardians.ts`) — 3d8 radiant/necrotic aura (10-ft, concentration)
  - Mirror: `cloud_of_daggers` (damage_zone, 10-ft radius centered on caster, 3d8 radiant — v1 picks radiant over necrotic). Targets only enemies. concentration true.
- **Guardian of Faith** (`src/spells/guardian_of_faith.ts`) — 20d6 radiant zone (10-ft, fixed total damage, no concentration)
  - Mirror: `moonbeam` (damage_zone, 10-ft radius, but FIXED total damage 20d6 — once depleted, the zone disappears). This is a NEW variant — damage_zone with a damage budget. Simplified: one-shot 20d6 radiant to all enemies in 10-ft radius (no per-turn tick). No concentration.
- **Dawn** (`src/spells/dawn.ts`) — CON save 4d10 radiant per turn (30-ft cylinder, concentration)
  - Mirror: `moonbeam` (damage_zone, 30-ft radius, CON save 4d10 radiant). concentration true.
- **Insect Plague** (`src/spells/insect_plague.ts`) — 4d10 piercing per turn (20-ft sphere, concentration)
  - Mirror: `moonbeam` (damage_zone, 20-ft radius, 4d10 piercing). concentration true.
- **Storm of Vengeance** (`src/spells/storm_of_vengeance.ts`) — 2d6 thunder + 6d6 lightning + other effects per turn (140-ft cylinder, concentration)
  - Mirror: `moonbeam` (damage_zone, 140-ft radius, dual damage 2d6 thunder + 6d6 lightning). Other-effect riders simplified. concentration true.

#### HEALING (9 spells)
- **Goodberry** (`src/spells/goodberry.ts`) — 10 berries, each heals 1 HP when eaten
  - Mirror: `healing_word` (but pre-cast — simplified to in-combat: heal 1 ally for 10 HP, representing eating all berries). LOW value. No concentration.
- **Wither and Bloom** (`src/spells/wither_and_bloom.ts`) — 2d6 necrotic damage + 2d6 heal (different targets)
  - Mirror: `catapult` (2d6 necrotic to enemy) + `healing_word` (2d6 heal to ally). Dual-target: shouldCast returns `{ damageTarget: Combatant, healTarget: Combatant } | null`. This is a NEW shouldCast shape (two targets). No concentration.
- **Aura of Vitality** (`src/spells/aura_of_vitality.ts`) — 2d6 heal as bonus action (3 targets in 30-ft aura, concentration)
  - Mirror: `moonbeam` (damage_zone, but heal_zone — 2d6 heal/turn to allies in 30-ft radius). concentration true. bonus action.
- **Mass Healing Word** (`src/spells/mass_healing_word.ts`) — 1d4+mod heal up to 6 targets (60 ft, bonus action)
  - Mirror: `prayer_of_healing` (multi-target heal, up to 6 allies). 1d4+spellcasting-mod. bonus action.
- **Mass Cure Wounds** (`src/spells/mass_cure_wounds.ts`) — 3d8+mod heal up to 6 targets (60 ft, no concentration)
  - Mirror: `prayer_of_healing` (multi-target heal, up to 6 allies, 3d8+spellcasting-mod). No concentration.
- **Heal** (`src/spells/heal.ts`) — 70 HP + remove blinded/deafened/diseased (60 ft, no concentration)
  - Mirror: `healing_word` (single-target, 70 HP flat heal). Condition-removal: delete blinded/deafened from target.conditions. No concentration.
- **Regenerate** (`src/spells/regenerate.ts`) — 4d8+mod heal + 1 HP/turn + regrow organs (touch, no concentration)
  - Mirror: `healing_word` (4d8+spellcasting-mod heal). 1-HP/turn rider simplified (would need a heal_zone). No concentration.
- **Mass Heal** (`src/spells/mass_heal.ts`) — 700 HP split among creatures (60 ft, no concentration)
  - Mirror: `prayer_of_healing` (multi-target, 700 HP split among up to N allies — shouldCast picks wounded allies, execute distributes 700 HP round-robin until depleted). No concentration.
- **Power Word Heal** (`src/spells/power_word_heal.ts`) — full HP + remove blinded/deafened/frightened/paralyzed/stunned (touch, no concentration)
  - Mirror: `heal` (full HP = set currentHP = maxHP). Remove 5 conditions. No concentration.

#### TEMP_HP (2 spells)
- **Armor of Agathys** (`src/spells/armor_of_agathys.ts`) — 5 temp HP + 5 cold damage to melee attackers
  - Mirror: `false_life` (temp HP) + retaliation rider simplified. Set `caster.tempHP = 5`. Retaliation damage (5 cold to melee attackers) NOT modelled (would need an on-attacked hook). No concentration.
- **False Life** (`src/spells/false_life.ts`) — 1d4+4 temp HP (self, 1 hr)
  - Mirror: simple self-buff. Roll 1d4+4, set `caster.tempHP = result`. No concentration. 1-hr duration NOT tracked.

---

## DEFERRED SPELLS (131 blocked — NOT in scope)

These 131 spells require new engine subsystems documented in `TEAMGOALS.md`:

| Blocker | Count | Subsystem needed |
|---------|-------|------------------|
| BLOCKED_OTHER | 89 | Various (utility, multi-effect buffs, shapechange, etc.) |
| BLOCKED_SUMMON | 17 | TG-006 Summon subsystem (4-phase plan in `docs/TG-006-SUMMON-PLAN.md`) |
| BLOCKED_TELEPORT | 7 | TG-011 Teleportation subsystem |
| BLOCKED_LOS_VISION | 5 | TG-010 computeLOS/vision-blocking |
| BLOCKED_WARD | 4 | TG-011 Ward subsystem |
| BLOCKED_WALL | 3 | TG-007 Wall subsystem |
| BLOCKED_RANDOM_TABLE | 3 | New random-effect-table subsystem |
| BLOCKED_ANTIMAGIC | 1 | TG-009 Antimagic/dispel |
| BLOCKED_DELAYED | 1 | New delayed-detonation subsystem |
| BLOCKED_MULTI_IMPACT | 1 | New multi-impact-AoE subsystem |

Do NOT attempt these in the megabatch. They are documented in `MEGABATCH-ANALYSIS.json`
with `blocked_reason` for each. Future sessions should tackle them subsystem-by-subsystem
after the respective TG entries are implemented.

---

## TROUBLESHOOTING

### Common issues

1. **tsc error: "Type '<camelCase>' is not assignable to type 'PlannedActionType'"** — you
   forgot to add the type to the `PlannedAction.type` union in `src/types/core.ts`. Add it.

2. **Bulk test fails: "Registry has at least N spells (got M)"** — you removed spells from
   the registry but didn't lower the `min-registry-size` assertion in
   `bulk_spell_dispatch.test.ts`. Lower it to match `299 - cumulative_migrated`.

3. **Bulk test fails: "<Spell> not in registry (likely a blocker)"** — a migrated spell
   was a sample in `SAMPLE_SPELLS` or `SAMPLE_BY_LEVEL`. Replace it with a non-migrated
   spell still in the registry.

4. **Spell test fails: "Damage in X-Y range: got Z"** — your `rollDamage` dice are wrong,
   or the half-on-save floor is off. Check `metadata.dieCount` and `metadata.dieSides`.

5. **tsc error: "Property 'applySpellEffect' does not exist on module"** — you need to
   import it: `import { applySpellEffect } from '../engine/spell_effects';`.

6. **Planner never picks the new spell** — you forgot the import at the top of
   `planner.ts`, OR the branch is placed BELOW the generic spell loop (it must be ABOVE).

7. **combat.ts case branch never fires** — you forgot the import, OR the `case` label
   doesn't match the `type:` string in planner.ts (they must be identical camelCase).

### When to stop and commit

Commit after each batch (44 / 35 / 23 / 22 spells), NOT after each spell. This keeps the
git history clean and makes rollback easy if a batch introduces a regression.

If you hit a spell that's harder than expected (e.g. the `damage_zone` payload shape
doesn't fit, or a condition isn't in the available list), SKIP that spell, note it in the
handover, and continue to the next. Better to migrate 40/44 spells cleanly than to block
on 1 spell and lose the whole batch.

---

## FINAL CHECKLIST (after all 4 batches)

- [ ] All 124 migratable spells have bespoke modules (shouldCast returns Combatant/array/plan, not boolean)
- [ ] All 124 spells removed from `_generic_registry.ts` (registry count: 299 - 124 = 175)
- [ ] All 124 types added to `PlannedAction.type` union in `src/types/core.ts`
- [ ] All 124 case branches added in `src/engine/combat.ts` `executePlannedAction`
- [ ] All 124 planner branches added in `src/ai/planner.ts` (numbered 12O through ~12EG)
- [ ] All 124 test files written in `src/test/<snake>.test.ts`
- [ ] `bulk_spell_dispatch.test.ts` updated (section 1d/1e/1f/1g verifying all 124 migrated; samples replaced; min-registry-size lowered to ~170)
- [ ] `npx tsc --noEmit` — 0 non-TS7006 errors
- [ ] `npm run spell-cache:build` — implemented count 544/557 (420 + 124)
- [ ] All 14 Session 22/23 spell tests still green
- [ ] All 124 new spell tests green
- [ ] All prior bespoke + engine tests green (healing_word, bless, burning_hands, magic_missile, shield_simple, sleep, arcane_lock, moonbeam, darkvision, combat, shatter, scorching_ray, summons, healing_spells)
- [ ] `zHANDOVER-SESSION-27.md` written with full summary
- [ ] All 4 commits pushed to GitHub (Cantrip-24, 25, 26, 27)

---

## APPENDIX: Reference spell quick-index

| Pattern | Reference spell | shouldCast returns | execute signature |
|--------|----------------|-------------------|-------------------|
| SINGLE_TARGET_SAVE_DAMAGE | catapult.ts | `Combatant \| null` | `(caster, target, state)` |
| SINGLE_TARGET_SAVE_DAMAGE + flat bonus | disintegrate.ts | `Combatant \| null` | `(caster, target, state)` |
| AOE_SAVE_DAMAGE_RADIUS | shatter.ts / fireball.ts | `Combatant[] \| null` | `(caster, targets[], state)` |
| AOE_SAVE_DAMAGE_CONE | burning_hands.ts | `Combatant[] \| null` | `(caster, targets[], state)` |
| AOE_SAVE_DAMAGE_LINE | lightning_bolt.ts | `Combatant[] \| null` | `(caster, targets[], state)` |
| AOE_SAVE_DAMAGE + condition | sunburst.ts | `Combatant[] \| null` | `(caster, targets[], state)` |
| SPELL_ATTACK_RANGED | chromatic_orb.ts | `Combatant \| null` | `(caster, target, state)` |
| SPELL_ATTACK_MELEE | inflict_wounds.ts | `Combatant \| null` | `(caster, target, state)` |
| SPELL_ATTACK_MULTI | scorching_ray.ts | `Combatant[] \| null` | `(caster, targets[], state)` |
| AUTO_HIT_DAMAGE | magic_missile.ts | `Combatant \| Combatant[] \| null` | varies |
| HP_CHECK_INSTAKILL | power_word_kill.ts | `Combatant \| null` | `(caster, target, state)` |
| SAVE_CONDITION_SINGLE | hold_person.ts / blindness_deafness.ts | `Combatant \| null` | `(caster, target, state)` |
| SAVE_CONDITION_AOE | sunburst.ts (condition portion) | `Combatant[] \| null` | `(caster, targets[], state)` |
| BUFF_BLESS_DIE | bless.ts | `Combatant[] \| null` (allies) | `(caster, targets[], state)` |
| BUFF_HEX_RIDER | hex.ts | `Combatant \| null` (target) | `(caster, target, state)` |
| BUFF_WEAPON_ENCHANT | magic_weapon.ts | `Combatant \| null` (ally) | `(caster, target, state)` |
| BUFF_ADVANTAGE_VS | faerie_fire.ts | `Combatant[] \| null` (enemies) | `(caster, targets[], state)` |
| PERSISTENT_DAMAGE_ZONE | moonbeam.ts / cloud_of_daggers.ts | `Combatant[] \| null` or cell | `(caster, targets[], state)` |
| HEALING | healing_word.ts | `Combatant \| null` (ally) | `(caster, target, state)` |
| HEALING_MULTI | prayer_of_healing.ts | `Combatant[] \| null` (allies) | `(caster, targets[], state)` |
| TEMP_HP | (new — mirror false_life) | `null` (self) | `(caster, state)` |
