# RFC: Lair Action `cast_spell` Bespoke Dispatch (Pilot Batch)

**Date:** Session 113 (proposed)
**Author:** Z.ai (z stream, with user-authorized SHEET+CORE access)
**Status:** PROPOSED — awaiting user ack
**Risk:** MEDIUM (re-assessed from HIGH; see §3)
**Depends on:** `src/spells/_generic_registry.ts` (System 1), `src/ai/monster_bespoke_registry.ts` (System 3), `src/engine/combat.ts::handleLairCastSpell`

---

## 0. TL;DR

Today, when a lair action casts a spell (e.g. Zariel's lair action "casts fireball"), the engine looks up the spell in the **GENERIC_SPELLS** registry only. If the spell has a **bespoke** module (like Fireball does) but isn't in the generic registry, the lair action **silently no-ops** with a "not in GENERIC_SPELLS registry" log. 15 of 21 unique `cast_spell` lair-action spells are affected (the other 5 already work via the generic registry; 1 has no module at all).

This RFC proposes a **pilot of 3 spells** (Fireball, Banishment, Fog Cloud) that adds a bespoke-dispatch fallback to `handleLairCastSpell`. The pilot covers all 3 `execute()` signature shapes (AoE-array, single-target, self-cast) and both concentration rules categories (creature-casts vs hazard-like). If the pilot proves the pattern, the remaining 12 spells are mechanical repetition.

**User authorizations received (this session):**
- B1: z agent owns SHEET + CORE files until further notice.
- B2: MEDIUM risk acceptable; worst case revert the commit.
- B3: pilot batch (option c) — 3 spells first, verify CI green, then expand.
- B4: tests that lock in the old broken behavior must be rewritten to assert the new canon-correct behavior.
- B5: yes, post RFC to TEAMGOALS first (this document).
- Q1: concentration rules — creature-casts → concentration applies normally; hazard-like wording ("as though it had cast", "identical to the spell") → magical hazard, no concentration. Explicit exceptions ("doesn't need to concentrate") honored. Duration-replacement removes concentration unless retained.
- Q2: `antimagic field` — keep current skip behavior, update log message (no longer "Phase 5 will wire").
- Q3: RFC covers pilot only (option a).
- Q4: metadata flag = `lairActionBespokeDispatchV1Implemented: true`.
- Q5: rewrite the 2 flipping tests to assert new canon-correct behavior (option a).

---

## 1. Background — the three spell-dispatch systems

### System 1 — `GENERIC_SPELLS` registry (the "fallback" registry)

File: `src/spells/_generic_registry.ts` (2,168 lines, auto-generated).

A big map of 313 spells. Each entry has the **same** shape:
```typescript
'Alarm': { name: 'Alarm', level: 1, shouldCast: fn, execute: fn }
'Heroism': { ... }
// ... 311 more
```

**Key property:** every `execute()` in this registry has the SAME signature: `execute(caster, state)`. The spell picks its own targets internally.

### System 2 — Bespoke spell modules (dedicated per-spell files)

Files like `src/spells/fireball.ts`, `src/spells/banishment.ts`, `src/spells/moonbeam.ts`, etc. (~100 spells).

**Key property:** each has a DIFFERENT `execute()` signature depending on what the spell needs:
- `fireball.ts:192` → `execute(caster, targets: Combatant[], state)` — AoE, needs target array
- `banishment.ts:73` → `execute(caster, target: Combatant, state)` — single-target
- `fog_cloud.ts:161` → `execute(caster, _self: Combatant, state)` — self-cast, ignores target

These modules are wired for **PC spellcasting** (planner + combat.ts `case 'fireball':` branches) and **monster spellcasting** (via System 3). **They are NOT wired for lair actions.**

### System 3 — Monster bespoke registry (the monster-spellcasting bridge)

File: `src/ai/monster_bespoke_registry.ts` (533 lines). Maps ~180 spell names to their `combat.ts` case-branch plan types:
```typescript
'Fireball' → { planType: 'fireball', level: 3, tags: ['damage'] }
'Banishment' → { planType: 'banishment', level: 4, tags: ['cc'] }
```

When a MONSTER (not a lair action) casts Fireball, the planner uses this registry to set `plan.type = 'fireball'`, and `combat.ts`'s `executePlannedAction` switch hits `case 'fireball':` which calls `executeFireball(caster, targets, state)` with the right signature. The `attachMonsterBespokeSyntheticState` helper (lines 478-533) temporarily adds a synthetic `actions` entry + `resources.spellSlots` so the bespoke `shouldCast` checks pass.

**Lair actions don't go through this path.** They go through `handleLairCastSpell` (System 1 only).

### The gap (concrete example)

**Zariel's lair action `Zariel::0` casts `fireball` at L3.** Current flow in `handleLairCastSpell` (`combat.ts:7937-8027`):
1. Look up `"fireball"` in `GENERIC_SPELLS` → **not found** (Fireball has a bespoke module, not a generic entry)
2. Log: `cast_spell: "fireball" (L3) not in GENERIC_SPELLS registry — logged, not executed (Phase 5 will wire dedicated spell modules)`
3. **Return. No fireball. No damage. Zariel's lair action does literally nothing.**

Same story for: **Banishment, Moonbeam, Fog Cloud, Lightning Bolt, Wall of Force, Spike Growth, Darkness, Command, Sleet Storm, Phantasmal Force, Cloud of Daggers, Simulacrum, Power Word Kill, Lesser Restoration** — 15 spells across 21 lair-action instances used by 18 creatures. All silently no-op today.

---

## 2. Audit — all 21 unique `cast_spell` lair-action spells

**Method:** ran an audit script against the full bestiary (`mergeBestiaries` of 97 source files, 7307 creatures, 173 with lair actions, 489 lair-action options total, 63 of which are `cast_spell`). Cross-referenced each spell against:
- `GENERIC_SPELLS` registry (System 1)
- `monster_bespoke_registry` (System 3)
- Raw spell JSON (`testDataSpells/spells-phb.json`) for accurate concentration + duration data
- Raw lair-action text (`bestiaryData/legendarygroups.json`) to apply the user's Q1 concentration categorization

### 2.1 Module coverage

| Spell | In GENERIC_SPELLS? | In MonsterBespoke? | Module Status |
|---|---|---|---|
| antimagic field | no | no | **NO MODULE** (Q2: skip, update log) |
| banishment | no | YES | bespoke module exists |
| cloud of daggers | no | YES | bespoke module exists |
| command | no | YES | bespoke module exists |
| confusion | YES | no | already works (generic) |
| creation | YES | no | already works (generic) |
| darkness | no | YES | bespoke module exists |
| fireball | no | YES | bespoke module exists |
| fog cloud | no | YES | bespoke module exists |
| giant insect | YES | no | already works (generic) |
| lesser restoration | no | YES | bespoke module exists (BUT parser mis-tag — see §2.4) |
| lightning bolt | no | YES | bespoke module exists |
| major image | YES | no | already works (generic) |
| mirage arcane | YES | no | already works (generic) |
| moonbeam | no | YES | bespoke module exists |
| phantasmal force | no | YES | bespoke module exists |
| power word kill | no | YES | bespoke module exists |
| simulacrum | no | YES | bespoke module exists |
| sleet storm | no | YES | bespoke module exists |
| spike growth | no | YES | bespoke module exists |
| wall of force | no | YES | bespoke module exists |

**Summary:**
- 5 spells already work via GENERIC_SPELLS (no change needed): confusion, creation, giant insect, major image, mirage arcane
- 15 spells have a bespoke module but are NOT routed for lair actions — **these are what unified dispatch would newly route**
- 1 spell (`antimagic field`) has NO module — Q2 directive: skip with updated log
- 0 spells are in BOTH registries (no priority-conflict issue)

### 2.2 Accurate concentration data (verified from raw spell JSON)

User correction: **Cloud of Daggers IS concentration** (PHB'14 p.222 — Duration: Concentration, up to 1 minute). My earlier statement was wrong. I verified ALL 21 spells against `testDataSpells/spells-phb.json`:

| Spell | Level | Concentration? | Duration (raw) |
|---|---|---|---|
| Command | L1 | no | 1 round |
| Fog Cloud | L1 | YES | Concentration, up to 1 hour |
| Cloud of Daggers | L2 | YES | Concentration, up to 1 minute |
| Darkness | L2 | YES | Concentration, up to 10 minutes |
| Lesser Restoration | L2 | no | Instantaneous |
| Moonbeam | L2 | YES | Concentration, up to 1 minute |
| Phantasmal Force | L2 | YES | Concentration, up to 1 minute |
| Spike Growth | L2 | YES | Concentration, up to 10 minutes |
| Fireball | L3 | no | Instantaneous |
| Lightning Bolt | L3 | no | Instantaneous |
| Major Image | L3 | YES | Concentration, up to 10 minutes |
| Sleet Storm | L3 | YES | Concentration, up to 1 minute |
| Banishment | L4 | YES | Concentration, up to 1 minute |
| Confusion | L4 | YES | Concentration, up to 1 minute |
| Giant Insect | L4 | YES | Concentration, up to 10 minutes |
| Creation | L5 | no | special |
| Wall of Force | L5 | YES | Concentration, up to 10 minutes |
| Mirage Arcane | L7 | no | 10 days (no concentration) |
| Simulacrum | L7 | no | Permanent (ends on dispel) |
| Antimagic Field | L8 | YES | Concentration, up to 1 hour |
| Power Word Kill | L9 | no | Instantaneous |

**13 of 21 spells are concentration.** The lair-action concentration rules (§2.3) determine whether the lair version actually uses concentration.

### 2.3 Lair-action concentration categorization (per user Q1 directive)

User Q1 rule: "if the lair says that the creature cast the spell, and that spell requires concentration, then concentration rules apply as normal. There may be exceptions what a special ability say 'without requiring concentration', in which case that would be an explicit exception. Another exception… 'the dungeon emits fog as in the spell fog cloud'… then the effects will occur as described but since it is not a creature casting it then it is safe to treat it like a magical hazard."

User Q1 clarification (this session): "Any effect that replaces the duration of a Concentration spell also removes Concentration unless it's specifically retained."

Applying these rules to each lair action's raw text:

#### Category A — "Creature casts the spell" → concentration applies normally (if the spell is concentration)

| Spell | Lair Action Text | Spell is concentration? | Lair version concentration? |
|---|---|---|---|
| **banishment** (Geryon) | "Geryon casts the {@spell banishment} spell." | YES | ✅ YES (normal concentration) |
| **command** (Graz'zt) | "Graz'zt casts the {@spell command} spell on every creature of his choice in the lair." | no | n/a (not concentration) |
| **fireball** (Zariel) | "Zariel casts the {@spell fireball} spell." | no | n/a (not concentration) |
| **fireball** (Vanifer) | "...cast one of her spells, up to 3rd level... She can't cast the same spell two rounds in a row, although she can continue to concentrate on a spell she previously cast using a lair action." | no | n/a (Fireball is not concentration; but the lair action ALLOWS maintaining OTHER concentration spells — relevant for future concentration-aware lair-action scheduling) |
| **lightning bolt** (Githzerai Anarch) | "The anarch casts the {@spell lightning bolt} spell (at 5th level)..." | no | n/a (not concentration) |
| **power word kill** (Orcus) | "Orcus's voice booms throughout the lair. His utterance causes one creature of his choice to be subjected to {@spell power word kill}." | no | n/a (not concentration) |
| **wall of force** (Elder Brain) | "The elder brain casts {@spell wall of force}." | YES | ✅ YES (normal concentration) |
| **moonbeam** (Kyrilla) | "Kyrilla casts {@spell moonbeam} (no components required). While maintaining {@status concentration} on this effect, she can't take other lair actions." | YES | ✅ YES (normal concentration; the lair text confirms concentration) |
| **phantasmal force** (Aboleth) | "The aboleth casts {@spell phantasmal force} (no components required)... While maintaining {@status concentration} on this effect, the aboleth can't take other lair actions." | YES | ✅ YES (normal concentration; lair text confirms) |
| **cloud of daggers** (Kyrilla) | "Kyrilla casts {@spell cloud of daggers} (no components required)... While maintaining {@status concentration} on this effect, she can't take other lair actions." | YES | ✅ YES (normal concentration; lair text confirms — user correction applied) |
| **darkness** (Morkoth) | "The morkoth casts {@spell darkness}, {@spell dispel magic}, or {@spell misty step}, using Intelligence as its spellcasting ability and without expending a spell slot." | YES | ✅ YES (normal concentration; no exception stated) |

#### Category A with explicit exception — "doesn't need to concentrate" → no concentration

| Spell | Lair Action Text | Spell is concentration? | Lair version concentration? |
|---|---|---|---|
| **darkness** (Demogorgon) | "Demogorgon casts the {@spell darkness} spell four times, targeting different areas with the spell. **Demogorgon doesn't need to concentrate on the spells**, which end on initiative count 20 of the next round." | YES | ❌ NO — explicit exception per user Q1 rule |

#### Category A with duration replacement — concentration removed (per user clarification)

| Spell | Lair Action Text | Spell is concentration? | Lair version concentration? |
|---|---|---|---|
| **giant insect** (Arasta) | "Arasta casts the {@spell giant insect} spell (spiders only). **It lasts until she uses this lair action again or until she dies.**" | YES | ❌ NO — duration replacement removes concentration per user clarification ("Any effect that replaces the duration of a Concentration spell also removes Concentration unless it's specifically retained") |

#### Category B — Hazard-like wording ("as though it had cast", "identical to the spell", "fills the space") → magical hazard, no concentration

| Spell | Lair Action Text | Spell is concentration? | Lair version concentration? |
|---|---|---|---|
| **fog cloud** (Bronze/Silver Dragon) | "The dragon creates fog **as though it had cast the {@spell fog cloud} spell**. The fog lasts until initiative count 20 on the next round." | YES | ❌ NO — hazard-like (no creature is casting; duration overridden to "initiative count 20 next round") |
| **sleet storm** (Yan-C-Bin) | "Yan-C-Bin drops the temperature of the air, covering all surfaces with ice. **This effect is identical to the {@spell sleet storm} spell.**" | YES | ❌ NO — hazard-like |
| **spike growth** (Copper Dragon) | "Stone spikes sprout from the ground in a 20-foot radius centered on that point. **The effect is otherwise identical to the {@spell spike growth} spell** and lasts until the dragon uses this lair action again or until the dragon dies." | YES | ❌ NO — hazard-like |
| **antimagic field** (Demilich) | "The demilich targets one creature it can see within 60 feet of it. **An {@spell antimagic field} fills the space of the target**, moving with it until initiative count 20 on the next round." | YES | ❌ NO — hazard-like (BUT Q2: skip this spell entirely for the pilot — no module exists) |
| **simulacrum** (Fraz-Urb'luu) | "Fraz-Urb'luu chooses one Humanoid within the lair and instantly creates a simulacrum of that creature (**as if created with the {@spell simulacrum} spell**). This simulacrum obeys Fraz-Urb'luu's commands and is destroyed on the next initiative count 20." | no | n/a (Simulacrum is not concentration; "as if created with" = hazard-like wording; explicit duration override "destroyed on next initiative count 20") |

#### Parser mis-tag (discovery — out of scope for pilot)

| Spell | Lair Action Text | Issue |
|---|---|---|
| **lesser restoration** (Fazrian) | "...the creature is {@condition blinded}. The blindness lasts until the creature receives a {@spell lesser restoration} spell or similar magic." | **NOT a lair action casting Lesser Restoration.** The spell is mentioned as a CURE for the blindness, not as a cast. The parser mis-detected the `{@spell lesser restoration}` reference as a cast. This lair action is actually a `save_condition` (blinding gaze), not `cast_spell`. Out of scope for the pilot — file as a separate parser-bug task. |

### 2.4 Pilot batch selection (3 spells, all 3 signature shapes, both concentration categories)

| Pilot Spell | Signature | Spell concentration? | Lair concentration? | Why selected |
|---|---|---|---|---|
| **fireball** (Zariel) | `execute(caster, targets[], state)` — AoE | no | n/a | Simplest case: instantaneous AoE damage, no concentration. Tests the array-target signature + the basic dispatch path. |
| **banishment** (Geryon) | `execute(caster, target, state)` — single-target | YES | ✅ YES (Category A, normal concentration) | Tests single-target signature + concentration handling. The lair creature must start concentration on Banishment. |
| **fog cloud** (Bronze Dragon) | `execute(caster, _self, state)` — self-cast | YES | ❌ NO (Category B, hazard-like) | Tests self-cast signature + hazard-like path (NO concentration, duration overridden to "initiative count 20 next round"). |

These 3 cover:
- All 3 `execute()` signature shapes (array, single, self)
- All 3 concentration paths (not-concentration, normal-concentration, hazard-no-concentration)
- 3 different lair-action text patterns (plain "casts", "casts + concentration confirmed", "as though it had cast")

If the pilot proves the pattern, the remaining 12 spells are mechanical repetition (each fits one of the 3 signature × concentration combinations above).

---

## 3. Risk assessment (re-classified HIGH → MEDIUM)

The S104-S112 handovers classified this as HIGH risk. After research, re-classify as **MEDIUM** (autonomous-OK with care, per user B2 directive).

### Why lower than HIGH
1. **Narrow blast radius.** Only `handleLairCastSpell` (one function, ~90 lines) changes. PC spellcasting is untouched. Monster spellcasting is untouched. The bespoke modules' `execute()` functions are untouched.
2. **Bespoke modules already exist and are battle-tested.** Fireball/Banishment/Fog Cloud have been used by PC + monster spellcasting for 50+ sessions. We're adding a third entry point (lair actions) to existing, working code.
3. **Targeting helpers already exist.** `selectLairActionTargets` (used by other lair-action categories) already picks targets. The bespoke modules just need to receive those targets.
4. **Synthetic-state pattern already exists.** `attachMonsterBespokeSyntheticState` (monster_spellcasting path) already solves the "lair creature has no `actions` entry + no `resources.spellSlots`" problem. We mirror that pattern.
5. **The 2 flipping tests are explicitly marked as "current broken behavior" regression guards.** Rewriting them to assert the new canon-correct behavior is canon-correct, not test-driven-development sin.
6. **The audit gives us the exact list.** 15 spells, 21 lair-action instances, 18 creatures. Bounded scope. No surprises.

### Why still MEDIUM (not LOW)
1. **Signature variance.** The 15 bespoke modules have 3 different `execute()` signatures. The unified dispatcher needs a per-spell adapter. Getting one wrong = crash or wrong targeting.
2. **Synthetic state for lair creatures.** The bespoke `shouldCast` functions check `caster.actions.some(a => a.name === 'Fireball')` + `hasSpellSlot(caster, 3)` + (for concentration spells) `caster.concentration?.active`. Lair creatures fail all 3. We attach synthetic state to make `shouldCast` pass, then call `execute` directly (bypassing `shouldCast` since the lair action is forced). The concentration-active check is the trickiest — for Category A spells (Banishment), we must NOT pre-set concentration (the spell's `execute` starts it); for Category B spells (Fog Cloud hazard), we must ensure concentration is NOT started.
3. **Concentration rules complexity.** The Q1 categorization (§2.3) has 4 sub-categories (A-normal, A-explicit-exception, A-duration-replacement, B-hazard). The dispatcher needs a per-spell flag to know which path. Getting this wrong = lair creature wrongly concentrates (or wrongly doesn't).
4. **The 2 flipping tests** must be rewritten carefully — if I get the new expected values wrong, CI goes red.
5. **Parser-level flag.** Distinguishing Category A from B requires either (a) a new parser flag on the lair action, or (b) a hardcoded per-spell lookup table in the dispatcher. (a) is cleaner but touches the parser; (b) is simpler but less maintainable. RFC proposes (b) for the pilot (3 spells), with (a) as a future refactor when the remaining 12 are added.

### Why NOT HIGH
- No core subsystem rewrite
- No dispatch reorder (we're ADDING a fallback path, not reordering existing ones)
- No public type change (the `LairAction` interface may gain an optional `lairActionSpellMode?` field, but it's additive)
- The change is additive: `handleLairCastSpell` gains a second lookup branch; the GENERIC_SPELLS path still works exactly as before for the 5 spells that use it

---

## 4. Proposed design

### 4.1 New helper: `dispatchBespokeLairSpell`

Location: `src/engine/combat.ts` (new function, ~80 lines, near `handleLairCastSpell`).

```typescript
/**
 * Dispatch a bespoke spell module for a lair-action `cast_spell`.
 * Called by `handleLairCastSpell` when `lookupGenericSpell` returns null
 * but `lookupMonsterBespokeByName` returns an entry.
 *
 * Handles:
 *   1. Synthetic-state attachment (action + resources) so the bespoke
 *      `shouldCast` checks pass — mirrors `attachMonsterBespokeSyntheticState`.
 *   2. Target selection via `selectLairActionTargets` (the same helper
 *      used by other lair-action categories).
 *   3. Signature adapter: calls the bespoke `execute` with the right
 *      signature shape (array / single / self) based on the plan type.
 *   4. Concentration handling per the Q1 categorization:
 *      - Category A (creature casts, normal concentration): the bespoke
 *        `execute` starts concentration normally (no special handling).
 *      - Category A explicit exception / duration replacement: pre-set
 *        `caster.concentration = null` before execute, then suppress
 *        concentration start inside execute via a flag (or use a wrapper).
 *      - Category B (hazard-like): same as duration-replacement — no
 *        concentration, duration overridden to "initiative count 20
 *        next round" (or the lair-action-specific duration).
 *   5. Cleanup: remove synthetic state after execute (idempotent).
 */
function dispatchBespokeLairSpell(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): boolean {  // returns true if dispatched, false if no module matched
  // ...
}
```

### 4.2 Per-spell metadata: `LAIR_BESPOKE_SPELL_META`

Location: new constant in `src/engine/combat.ts` (or a small new file `src/engine/lair_bespoke_meta.ts` if cleaner).

A hardcoded lookup table for the pilot's 3 spells, capturing the Q1 categorization + signature shape:

```typescript
interface LairBespokeSpellMeta {
  canonicalName: string;       // 'Fireball'
  planType: string;            // 'fireball' (matches monster_bespoke_registry)
  signature: 'aoe' | 'single' | 'self';  // execute() signature shape
  concentrationMode: 'normal' | 'suppress';  // Q1 categorization
  // 'normal' = Category A normal concentration (spell's execute starts it)
  // 'suppress' = Category A exception / duration-replacement / Category B hazard
  //              (do NOT start concentration; apply lair-duration override)
  lairDurationRounds?: number; // for 'suppress' mode: lair-specific duration
  // undefined = use spell's normal duration (for 'normal' mode)
}

const LAIR_BESPOKE_SPELL_META: Map<string, LairBespokeSpellMeta> = new Map([
  // Pilot batch (S113)
  ['fireball', {
    canonicalName: 'Fireball', planType: 'fireball',
    signature: 'aoe', concentrationMode: 'normal',
    // Fireball is not concentration; 'normal' is fine (execute won't start conc)
  }],
  ['banishment', {
    canonicalName: 'Banishment', planType: 'banishment',
    signature: 'single', concentrationMode: 'normal',
    // Category A normal: Geryon casts Banishment, concentration applies normally
  }],
  ['fog cloud', {
    canonicalName: 'Fog Cloud', planType: 'fogCloud',
    signature: 'self', concentrationMode: 'suppress', lairDurationRounds: 1,
    // Category B hazard: Bronze Dragon's lair creates fog, no concentration,
    // duration = "until initiative count 20 on the next round" = 1 round
  }],
  // Future expansion (S114+): the remaining 12 spells go here
]);
```

### 4.3 Modified `handleLairCastSpell` flow

```typescript
function handleLairCastSpell(creature, action, state): void {
  // ... existing GoI pre-filter (unchanged) ...

  const desc = lookupGenericSpell(action.spellName);
  if (desc) {
    // ... existing generic-registry path (unchanged) ...
    desc.execute(creature, state);
    return;
  }

  // NEW: bespoke-dispatch fallback (S113)
  const dispatched = dispatchBespokeLairSpell(creature, action, state);
  if (dispatched) return;

  // Spell not in generic registry AND not in lair-bespoke meta.
  // Q2 directive: updated log message (no longer "Phase 5 will wire").
  log(state, 'action', creature.id,
    `  → cast_spell: "${action.spellName}" (L${castLevel}) ` +
    `not in GENERIC_SPELLS registry and no bespoke lair-dispatch module — ` +
    `logged, not executed`,
    undefined);
}
```

### 4.4 Synthetic-state attachment (mirror `attachMonsterBespokeSyntheticState`)

The bespoke `shouldCast` functions check:
1. `caster.actions.some(a => a.name === 'Fireball')` — lair creature has no such action
2. `hasSpellSlot(caster, 3)` — lair creature has no `resources.spellSlots`
3. (For concentration spells) `caster.concentration?.active` — lair creature may or may not have concentration active

For the pilot, we **bypass `shouldCast` entirely** (the lair action is forced — the creature IS casting this spell per the lair-action trigger). We attach synthetic state ONLY so `execute()` doesn't crash on the `caster.actions.find(a => a.name === 'Fireball')` lookup (used to read `saveDC`).

```typescript
// Inside dispatchBespokeLairSpell:
const meta = LAIR_BESPOKE_SPELL_META.get(action.spellName.toLowerCase());
if (!meta) return false;

// Attach synthetic action (for saveDC lookup) — mirrors attachMonsterBespokeSyntheticState
const hadAction = creature.actions.some(a => a.name === meta.canonicalName);
if (!hadAction) {
  creature.actions.push({
    name: meta.canonicalName,
    isMultiattack: false, attackType: 'spell',
    reach: 0, range: null, hitBonus: 0,
    damage: { count: 0, sides: 0, bonus: 0, average: 0 },
    damageType: 'force',
    saveDC: creature.monsterSpellcasting?.saveDC ?? action.saveDC ?? 15,
    saveAbility: null, isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: action.castLevel ?? meta.level,
    costType: 'action', legendaryCost: 0,
  } as Action);
}

// For 'suppress' mode: ensure concentration is NOT started by execute.
// Implementation: temporarily set a flag on the creature that execute can check,
// OR wrap execute in a try/finally that clears concentration if it was started.
// (Pilot v1: use the flag approach — see §4.5 for the flag shape.)

try {
  // Select targets via the existing lair-action targeting helper
  const targets = selectLairActionTargets(creature, action, state.battlefield)
    .filter(t => t.id !== creature.id && !t.isDead && !t.isUnconscious);

  // Signature adapter
  switch (meta.signature) {
    case 'aoe':
      // Fireball: execute(caster, targets[], state)
      callExecuteByPlanType(meta.planType, creature, targets, state);
      break;
    case 'single':
      // Banishment: execute(caster, target, state) — pick first target
      callExecuteByPlanType(meta.planType, creature, targets[0] ?? creature, state);
      break;
    case 'self':
      // Fog Cloud: execute(caster, _self, state) — target is caster (ignored)
      callExecuteByPlanType(meta.planType, creature, creature, state);
      break;
  }
} finally {
  // Cleanup synthetic action
  if (!hadAction) {
    creature.actions = creature.actions.filter(a => a.name !== meta.canonicalName);
  }
  // Cleanup concentration-suppression flag (if set)
}

return true;
```

### 4.5 Concentration-suppression flag (for Category B + duration-replacement spells)

For `concentrationMode: 'suppress'` spells (Fog Cloud pilot), the bespoke `execute` would normally call `startConcentration(caster, 'Fog Cloud')`. We need to suppress this.

**Pilot v1 approach (simplest):** after `execute` returns, if `concentrationMode === 'suppress'` AND the caster's concentration was newly started by this execute, clear it and apply the lair-duration override:

```typescript
if (meta.concentrationMode === 'suppress') {
  // execute() may have started concentration — clear it
  if (creature.concentration?.active && creature.concentration.spellName === meta.canonicalName) {
    creature.concentration = null;
  }
  // Apply lair-duration override: convert the spell's persistent effect to
  // expire at "initiative count 20 next round" (1 round)
  // (Implementation: tag the active effects created by this execute with
  //  a sourceTurnExpires = currentRound + 1, or use the existing
  //  lair-action duration pattern.)
}
```

This is the trickiest part of the pilot. If it proves too brittle, fallback: skip concentration-suppress spells in the pilot and do only Fireball + Banishment (both `concentrationMode: 'normal'`), defer Fog Cloud to S114.

### 4.6 `callExecuteByPlanType` dispatch

A switch over `meta.planType` that calls the right bespoke `execute` with the right signature:

```typescript
function callExecuteByPlanType(
  planType: string, caster: Combatant,
  target: Combatant | Combatant[], state: EngineState,
): void {
  switch (planType) {
    case 'fireball': {
      const targets = Array.isArray(target) ? target : [target];
      executeFireball(caster, targets, state);
      break;
    }
    case 'banishment': {
      const t = Array.isArray(target) ? target[0] : target;
      executeBanishment(caster, t, state);
      break;
    }
    case 'fogCloud': {
      // Fog Cloud execute ignores the target param
      executeFogCloud(caster, caster, state);
      break;
    }
    // Future: 12 more cases for the remaining spells
    default:
      throw new Error(`Unknown lair-bespoke plan type: ${planType}`);
  }
}
```

The imports for `executeFireball`, `executeBanishment`, `executeFogCloud` are added to `combat.ts` (these modules are already imported elsewhere for the PC/monster dispatch paths — verify no circular-import issues).

### 4.7 Metadata flag

```typescript
// In src/engine/combat.ts (or a new src/engine/lair_action_metadata.ts)
export const lairActionMetadata = {
  // Session 113: lair-action cast_spell now dispatches to bespoke spell
  // modules (not just GENERIC_SPELLS). Pilot: Fireball, Banishment, Fog Cloud.
  // See docs/RFC-LAIR-ACTION-BESPOKE-DISPATCH.md for the full design.
  lairActionBespokeDispatchV1Implemented: true,
  // Future: lairActionBespokeDispatchV2FullCoverage (when all 15 spells routed)
};
```

The flag is asserted by a new test (§5.3) so future agents can verify the feature is present.

---

## 5. Test plan

### 5.1 Tests that will FLIP (must be rewritten per Q5 directive)

#### `src/test/session94_lair_phase3b.test.ts` §2 (lines 176-215)

**Current behavior asserted:** Aboleth with `spellName = 'Fireball'` → "not in GENERIC_SPELLS registry" log fires + log mentions "Phase 5".

**New behavior to assert (canon-correct):** Aboleth with `spellName = 'Fireball'` → Fireball actually executes → fire damage dealt to the goblin target + "casts Fireball (L3) via lair action" log fires.

**Rewrite sketch:**
```typescript
// 2. cast_spell — Aboleth::0 with spellName overridden to "Fireball"
//    (Fireball has a bespoke module, NOT in GENERIC_SPELLS).
//    After S113 unified dispatch: Fireball actually executes.
console.log('\n--- 2. cast_spell: Aboleth "Fireball" (bespoke dispatch) ---');
{
  const aboleth = spawn('Aboleth', { x: 0, y: 0, z: 0 });
  asParty(aboleth);
  forceLairAction(aboleth, 'Aboleth::0');
  aboleth.lairActions!.actions[0].spellName = 'Fireball';
  aboleth.lairActions!.actions[0].castLevel = 3;
  tankUp(aboleth); noLegendary(aboleth);

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);
  const goblinHPBefore = goblin.currentHP;

  const bf = makeBF([aboleth, goblin]);
  const rlog = runCombat(bf, [aboleth.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  // 2a. "casts Fireball" log fires (bespoke dispatch succeeded)
  const castLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === aboleth.id &&
    e.description.includes('casts Fireball'));
  assert('2a. "casts Fireball (L3) via lair action" log fires', castLog !== undefined);

  // 2b. Goblin took fire damage (8d6 DC save for half — HP must have dropped)
  assert('2b. goblin took fire damage', goblin.currentHP < goblinHPBefore,
    `HP before=${goblinHPBefore}, after=${goblin.currentHP}`);

  // 2c. The OLD "not in GENERIC_SPELLS registry" log does NOT fire
  const skipLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === aboleth.id &&
    e.description.includes('not in GENERIC_SPELLS registry'));
  assert('2c. old "not in registry" log does NOT fire', skipLog === undefined);
}
```

#### `src/test/session102_lair_phase8b3.test.ts` §11 (lines 425-455)

**Current behavior asserted:** Githzerai Anarch with `spellName = 'lightning bolt'` → "not in GENERIC_SPELLS registry" log fires.

**New behavior to assert:** After S113, **Lightning Bolt is NOT in the pilot batch** (it's spell #4 of 15, deferred to S114). So the current behavior (skip log) STILL HOLDS for Lightning Bolt — but the log message changes (no longer mentions "Phase 5").

**Decision:** for the pilot, the §11 test should be UPDATED to assert the new log message wording (no "Phase 5"), but Lightning Bolt still skips. When S114 adds Lightning Bolt, the test gets rewritten again to assert execution.

**Rewrite sketch (pilot version):**
```typescript
// 11. Handler: cast_spell — Lightning Bolt (not yet in pilot batch, still skips)
console.log('\n--- 11. Handler: cast_spell Lightning Bolt (pilot: not yet routed) ---');
{
  const ga = spawn('Githzerai Anarch', 'MPMM');
  asParty(ga); tankUp(ga); noLegendary(ga); ga.isInLair = true;
  const lbAction = ga.lairActions!.actions.find(a => a.spellName === 'lightning bolt')!;
  forceAction(ga, lbAction);

  const goblin = spawn('Goblin'); asEnemy(goblin); tankUp(goblin, 100_000);
  const bf = makeBF([ga, goblin]);
  const rlog = runCombat(bf, [ga.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  // Lightning Bolt is NOT in the S113 pilot batch → still skips, but with updated wording
  const skipLog = rlog.events.find((e: any) =>
    e.type === 'action' && e.actorId === ga.id &&
    e.description.includes('no bespoke lair-dispatch module'));
  assert('11a. updated skip log fires for Lightning Bolt (pilot: not yet routed)',
    skipLog !== undefined);
  if (skipLog) {
    assert('11b. log mentions L5', skipLog.description.includes('L5'));
    assert('11c. log mentions "lightning bolt"',
      skipLog.description.toLowerCase().includes('lightning bolt'));
    // 11d. the OLD "Phase 5" wording is gone
    assert('11d. old "Phase 5" wording is gone',
      !skipLog.description.includes('Phase 5'));
  }
}
```

### 5.2 Regression tests (must stay green)

- `session94_lair_phase3b.test.ts` §1 (Aboleth phantasmal force — generic-registry path) — UNCHANGED (phantasmal force is in MonsterBespoke, but NOT in the pilot's `LAIR_BESPOKE_SPELL_META`, so it still skips via the new log path). Actually wait — phantasmal force IS bespoke-only. After S113 pilot, it would skip with the new log message. **Check if §1 asserts the old log message** — if so, it needs the same rewrite as §11.
- `session94_lair_phase3b.test.ts` §3+ (non-cast_spell lair actions) — UNCHANGED
- `session102_lair_phase8b3.test.ts` §10 (Creation — generic-registry path) — UNCHANGED (Creation is in GENERIC_SPELLS, still works)
- `session102_lair_phase8b3.test.ts` §12+ (non-cast_spell lair actions) — UNCHANGED
- `session105_phase8_retrospective.test.ts` — UNCHANGED (asserts `isSpellCount > 0` and `every isSpell action has a spellName`; the count doesn't change, only the dispatch behavior)
- All lair-action tests that don't use `cast_spell` — UNCHANGED

### 5.3 New test: `src/test/session113_lair_bespoke_dispatch.test.ts`

A new test file (~80 assertions, 6 sections) covering the pilot:

1. **Metadata flag** — `lairActionBespokeDispatchV1Implemented === true`
2. **Fireball dispatch** — Zariel lair action fires Fireball, goblin takes fire damage, log asserts
3. **Banishment dispatch** — Geryon lair action fires Banishment, target makes CHA save, concentration started on Geryon, log asserts
4. **Fog Cloud dispatch (hazard)** — Bronze Dragon lair action fires Fog Cloud, NO concentration started on the dragon, fog obstacle created with 1-round duration, log asserts
5. **Skip path** — Lightning Bolt (not in pilot) still skips with updated log message (no "Phase 5")
6. **Antimagic field** — skip path with updated log message (no "Phase 5"); Q2 directive

### 5.4 Local verification before commit

```
# Run the 2 affected chunks locally (chunk 2 + chunk 3 per the S111 memory guidance)
npx ts-node --transpile-only scripts/run_tests.ts --chunk 2 --total 6 --parallel 2 --timeout 90
npx ts-node --transpile-only scripts/run_tests.ts --chunk 3 --total 6 --parallel 2 --timeout 90

# Run the new pilot test standalone
npx ts-node --transpile-only src/test/session113_lair_bespoke_dispatch.test.ts

# tsc baseline (must stay at 5 pre-existing, 0 new)
./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"
```

---

## 6. Files to touch (pilot)

| File | Change | Lines (est.) |
|------|--------|------|
| `src/engine/combat.ts` | Add `dispatchBespokeLairSpell` + `callExecuteByPlanType` + `LAIR_BESPOKE_SPELL_META` + `lairActionMetadata` export; modify `handleLairCastSpell` to call the new helper; update the skip log message (remove "Phase 5") | +120, -8 |
| `src/engine/combat.ts` | Add imports for `executeFireball`, `executeBanishment`, `executeFogCloud` (verify no circular-import) | +3 |
| `src/test/session94_lair_phase3b.test.ts` | Rewrite §2 (lines 176-215) to assert Fireball executes | ~-40, +35 |
| `src/test/session102_lair_phase8b3.test.ts` | Rewrite §11 (lines 425-455) to assert updated skip log wording (no "Phase 5") | ~-30, +25 |
| `src/test/session113_lair_bespoke_dispatch.test.ts` | NEW — pilot test (~80 assertions, 6 sections) | +250 |
| `docs/RFC-LAIR-ACTION-BESPOKE-DISPATCH.md` | This file (already created) | +0 (this is it) |
| `TEAMGOALS.md` | Add crosslink to this RFC | +10 |
| `zHANDOVER-SESSION-113.md` | New handover documenting the pilot | +300 |

**Out of scope for the pilot (deferred to S114+):**
- The remaining 12 bespoke spells (banishment, cloud of daggers, command, darkness, moonbeam, phantasmal force, power word kill, simulacrum, sleet storm, spike growth, wall of force, lightning bolt)
- The `antimagic_field.ts` module implementation (Q2: skip with updated log)
- The `lesser restoration` parser mis-tag fix (discovery in §2.3 — file as separate task)
- The parser-level `lairActionSpellMode: 'cast' | 'hazard'` flag (pilot uses the hardcoded `LAIR_BESPOKE_SPELL_META` table; parser flag is a future refactor)

---

## 7. Open questions for user ack

These are the decisions I need confirmed before I start coding:

### Q-ack-1. Pilot spell selection — confirm Fireball + Banishment + Fog Cloud?

These 3 cover all 3 signature shapes + both concentration categories. Alternatives:
- (a) Fireball + Banishment + Fog Cloud (my recommendation — covers all 3 shapes + both conc categories)
- (b) Fireball + Banishment only (drop Fog Cloud — avoids the concentration-suppression complexity; defer to S114)
- (c) Fireball + Lightning Bolt + Power Word Kill (all 3 are non-concentration, simplest — but doesn't test concentration handling)

**Recommendation: (a).** If the concentration-suppression flag (§4.5) proves too brittle during implementation, fall back to (b) and defer Fog Cloud.

### Q-ack-2. Concentration-suppression approach — confirm the post-execute cleanup?

For Category B / duration-replacement spells (Fog Cloud pilot), §4.5 proposes: let `execute` start concentration normally, then clear it post-execute + apply the lair-duration override.

Alternative: add a `suppressConcentration` flag to `Combatant` that `startConcentration` checks. This is cleaner but touches `startConcentration` (a core engine function) — slightly higher risk.

**Recommendation: post-execute cleanup** (§4.5 as written). If it proves brittle, switch to the flag approach.

### Q-ack-3. Synthetic-state approach — confirm bypassing `shouldCast`?

The bespoke `shouldCast` functions check `actions.some(a => a.name === 'X')` + `hasSpellSlot` + `concentration?.active`. For lair actions, we bypass `shouldCast` entirely (the lair action is forced) and only attach a synthetic action for the `saveDC` lookup inside `execute`.

Alternative: attach synthetic state AND call `shouldCast` (if it returns null, skip the lair action). This is more "canon-accurate" (a lair creature that can't see any enemies wouldn't cast Fireball into the void) but adds complexity.

**Recommendation: bypass `shouldCast`** (lair actions are forced — the lair creature IS casting this spell per the lair-action trigger, regardless of whether it's a good idea). Add a follow-up task for S114+ to make lair-action targeting smarter.

### Q-ack-4. Test file location — confirm `src/test/session113_lair_bespoke_dispatch.test.ts`?

Following the existing `sessionNNN_*.test.ts` pattern.

### Q-ack-5. Metadata flag location — confirm `src/engine/combat.ts`?

The `lairActionMetadata` export lives in `combat.ts` (where `handleLairCastSpell` lives). Alternative: a new `src/engine/lair_action_metadata.ts` file. The latter is cleaner but adds a file. **Recommendation: `combat.ts`** for the pilot (matches where `NON_SPELL_PLAN_TYPES` and other combat-metadata constants live).

---

## 8. Rollback plan

Per user B2 ("worst case we can reverse the commit"):

- If CI goes red on the pilot commit and the fix isn't quick, `git revert <pilot-commit-sha>` and re-push.
- The 2 rewritten tests will revert with the commit (they're in the same commit).
- The new test file (`session113_lair_bespoke_dispatch.test.ts`) will revert with the commit.
- The RFC + TEAMGOALS crosslink are in a separate commit (this document) — they stay even if the pilot is reverted (the RFC documents the design regardless of implementation status).

---

## 9. Success criteria

The pilot is "done" when ALL of these are true:

1. `lairActionBespokeDispatchV1Implemented: true` flag exists in `combat.ts` metadata
2. `handleLairCastSpell` tries GENERIC_SPELLS first, then `LAIR_BESPOKE_SPELL_META`, then logs the updated skip message
3. Fireball (Zariel lair action) actually executes — goblin takes fire damage
4. Banishment (Geryon lair action) actually executes — target makes CHA save, Geryon starts concentration
5. Fog Cloud (Bronze Dragon lair action) actually executes — fog obstacle created, NO concentration on the dragon, 1-round duration
6. Antimagic field (Demilich lair action) still skips — with the updated log message (no "Phase 5")
7. Lightning Bolt (Githzerai Anarch lair action) still skips — with the updated log message (not in pilot batch)
8. `session94_lair_phase3b.test.ts` §2 rewritten — asserts Fireball executes
9. `session102_lair_phase8b3.test.ts` §11 rewritten — asserts updated skip log wording
10. New `session113_lair_bespoke_dispatch.test.ts` passes (~80 assertions)
11. tsc baseline unchanged (5 pre-existing, 0 new)
12. CI on the pilot commit = 9/9 ALL GREEN (build + deploy + report-build-status + 6 test chunks)
13. `zHANDOVER-SESSION-113.md` written with pilot results + proposal for the remaining 12 spells

---

## 10. References

- `docs/RFC-MONSTER-SPELLCASTING.md` — the monster-spellcasting RFC (Phase 4 created `monster_bespoke_registry.ts`)
- `src/spells/_generic_registry.ts` — System 1 (GENERIC_SPELLS, 313 spells)
- `src/ai/monster_bespoke_registry.ts` — System 3 (monster-bespoke bridge, ~180 spells)
- `src/engine/combat.ts:7937-8027` — `handleLairCastSpell` (the function being modified)
- `src/engine/combat.ts:3048+` — `executePlannedAction` (the PC/monster dispatch path — reference pattern)
- `src/ai/monster_bespoke_registry.ts:478-533` — `attachMonsterBespokeSyntheticState` (the synthetic-state pattern to mirror)
- `zHANDOVER-SESSION-111.md` §1 (carry-over from S104) — the "unified cast dispatch" next-action
- `zHANDOVER-SESSION-112.md` §1 — the S112 survey that identified this as the next LOW-MEDIUM-risk autonomous task
- User Q1 directive (this session) — concentration rules for lair actions
- User Q2-Q5 directives (this session) — antimagic field skip, pilot scope, metadata flag name, test rewrite approach

---

## 11. Status

**PROPOSED** — awaiting user ack on Q-ack-1 through Q-ack-5 (§7).

Once acked, the implementation sequence is:
1. Write the pilot code (`combat.ts` changes + new test file)
2. Run local regression (chunks 2 + 3 + new test standalone + tsc)
3. Rewrite the 2 flipping tests
4. Commit + push
5. Verify CI 9/9 ALL GREEN
6. Write `zHANDOVER-SESSION-113.md`
7. Archive `zHANDOVER-SESSION-111.md` to `HandoverOld/` (per AGENTS.md "latest 2 in root" rule; S112 + S113 now in root)
8. Commit handover + archival
9. Verify CI 9/9 ALL GREEN on handover commit
10. Report to user
