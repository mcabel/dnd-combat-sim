# RFC: Lair Actions (RFC-LAIRACTIONS)

**Status:** Draft — awaiting review
**Author:** Session 90 (autonomous)
**Target:** Multi-session implementation by a future agent
**Scope:** Mechanical lair actions for legendary creatures in the D&D 5e (2014) combat engine

---

## 1. Problem Statement

The engine currently parses **115 legendary groups** with **309 lair action options** from `bestiaryData/legendarygroups.json`, but the runtime behavior is a no-op stub:

```ts
// src/engine/combat.ts:6467 (current)
const pick = actions[Math.floor(Math.random() * actions.length)];
log(state, 'action', c.id,
  `${c.name} takes a lair action ...: ${pick.substring(0, 100)}...`);
// ← no mechanical effect
```

**Three deficits:**

1. **No mechanical effect.** A red dragon's "magma erupts (DC 15 DEX, 5d6 fire)" logs text but deals zero damage. Legendary creatures are severely underpowered relative to RAW.
2. **Random selection, no AI.** PHB says the creature *chooses*; the engine picks uniformly at random with no faction-awareness and no "can't repeat same effect 2 rounds in a row" rule.
3. **No in-lair gate.** A dragon fought in a field still "takes a lair action." There is no flag to indicate the creature is *in its lair*.

**User direction (this session):** Implement lair actions as a flagged, mechanically-resolved, AI-scored subsystem. Default the flag **on** (`LairMonstersAREinLair`). Resolve at **initiative count 20 with priority over ties**. Identify and registry-tag **out-of-scope flavor/social actions** with stable IDs for searchability. Score candidate actions and pick the **most beneficial to the lair creature's party**.

---

## 2. Research Findings (grounded in the actual data)

### 2.1 Data scale

| Metric | Value |
|---|---|
| Legendary groups (total) | 187 |
| Groups with lair actions | 115 |
| Total lair action options | 309 |
| Initiative count | 20 (all 115 groups; no exceptions) |

### 2.2 5eTools schema tags present in lair-action text

The free-text paragraphs are **not** unstructured — 5eTools embeds inline tags that the parser can extract:

| Tag | Count | Meaning | Example |
|---|---|---|---|
| `@dc N` | 197 | saving throw DC | `{@dc 23}` → DC 23 |
| `@condition X` | 116 | condition imposed | `{@condition prone}` |
| `@damage NdN` | 81 | damage roll | `{@damage 3d6}` |
| `@spell X` | 56 | spell name | `{@spell fireball}` |
| `@creature X` | 45 | creature summoned | `{@creature skeleton}` |
| `@dice NdN` | 18 | generic dice | `{@dice d8}` |
| `@skill X` | 17 | skill check | `{@skill Athletics}` |
| `@status X` | 15 | status | `{@status invisible}` |
| `@hit N` | 9 | attack bonus | `{@hit 10}` |
| `@chance N` | 8 | percent chance | `{@chance 50}` |
| `@hazard X` | 2 | DMG hazard | `{@hazard green slime}` |

**Distinct values:** 37 spells, 13 conditions (blinded, charmed, deafened, exhaustion, frightened, grappled, incapacitated, invisible, petrified, poisoned, prone, restrained, stunned), 39 distinct summonable creatures. **DC range:** 5–26.

**Key implication:** a parser pass can extract ~85% of lair actions into a structured schema using these tags. The remaining ~15% are bespoke or flavor.

### 2.3 Effect taxonomy (heuristic categorization of 309 options)

| Category | Count | Example |
|---|---|---|
| Save + condition | 55 | "DC 15 DEX or knocked prone" |
| Summon creature(s) | 47 | "up to six corpses rise as skeletons" |
| Save + damage | 41 | "DC 23 STR or pushed 60 ft, 3d6 lightning" |
| Save (no damage/condition) | 32 | "DC 15 DEX or fall" (gravity reverse) |
| Auto-cast spell | ~30 | "Baphomet casts mirage arcane" |
| Damage (no save) | 13 | "10 lightning damage" |
| Buff ally / debuff enemy | 8 | "gnolls have advantage on melee" |
| Visibility (obscured/fog) | 8 | "heavily obscured, lasts until next count 20" |
| Spell-slot regeneration | 4 | "roll d8, regain spell slot of that level" |
| Out-of-scope (flavor/social) | ~12 | "time moves 10 years"; "create stone objects" |

### 2.4 Existing engine infrastructure available for reuse

| Subsystem | Location | Reuse for lair actions |
|---|---|---|
| `summonSpell` dispatch | `combat.ts:6130` | Summon-category lair actions spawn via the same path |
| `damage_zone` ActiveEffect | `spell_effects.ts:201` | Environmental damage ticks |
| `terrain_zone` ActiveEffect | `spell_effects.ts:717` | Hazards, difficult terrain, obscurement |
| `battlefield_obstacle` effect | `spell_effects.ts:860` | Walls, blockages |
| `condition_apply` effect + pipeline | `effect_pipeline.ts:172` | Conditions (prone, restrained, etc.) |
| Reaction subsystem | `combat.ts:1017` | (Lair actions are NOT reactions — see §6.4) |
| `applySpellEffect` / `applyDamage` | `utils.ts` | Damage + effect application |
| Concentration tracking | `utils.ts:1188` | (Lair actions do NOT require concentration) |
| `livingEnemiesOf` / `chebyshev3D` | `movement.ts` | Targeting / range |

### 2.5 What does NOT exist yet (must be built)

- A structured `LairAction` schema (currently `string[]`).
- An initiative-count-20 hook with **priority over ties** (current stub fires at round start, before *all* turns — not tied to initiative 20).
- A `LairMonstersAREinLair` per-combatant flag (default `true` when `lairActions` is defined).
- A per-creature "last lair action used" history (for the "can't repeat 2 rounds in a row" rule).
- An AI scoring function for action selection.
- A dispatcher with per-category handlers.

---

## 3. Design Decisions (documented assumptions — please review)

These are the judgment calls I made to unblock implementation. Each is flagged **[DD-N]**. If you disagree with any, the RFC should be revised before Phase 1.

### [DD-1] `LairMonstersAREinLair` flag — per-combatant, default `true`

- Added to `Combatant` as `isInLair?: boolean`.
- **Parser default:** when `lairActions` is defined, `isInLair = true`. A dragon encountered outside its lair can be set to `false` by the scenario/character builder.
- The UI (monster editor) exposes this as a toggle, defaulting to **on**, per your direction.
- When `isInLair === false`, the creature still *has* `lairActions` in its data, but the engine skips the lair-action hook entirely.

### [DD-2] Initiative count 20, priority over ties — house rule (overrides PHB)

- PHB p.??? / MM: "On initiative count 20 (losing initiative ties)." The PHB default is that the lair action resolves **after** any creature whose initiative = 20.
- Your direction: **priority over ties** — lair actions resolve **before** any creature with initiative 20.
- This is a deliberate house rule. The RFC implements it as `priority: 'before-ties'` (configurable; default per your direction).
- **Implementation note:** the engine's current `runCombat` loop iterates `initiative` (an ordered string[]). There is no "initiative count" numeric tracked per creature — only the order. To implement count-20 priority, the RFC introduces a numeric `initiativeScore` on each combatant (1–30, rolled externally) and resolves lair actions at the moment the loop would reach score 20, before processing any creature with score ≤ 20 whose turn hasn't started. Creatures with score > 20 have already acted. This is a modest change to the round loop.

### [DD-3] Multiple lair creatures in one combat — each acts independently

- If two creatures with lair actions are in the same combat (e.g., two dragons), each takes its own lair action at count 20.
- Resolution order among multiple lair creatures: **descending CR** (highest CR first). Tie-break: alphabetical name (deterministic for tests).
- The "can't repeat same effect 2 rounds in a row" rule is **per-creature** (each tracks its own history).

### [DD-4] Lair actions are NOT spells — not blocked by Globe of Invulnerability, not Counterspellable

- **2024 Monster Manual clarification:** lair actions are "magical effects" but **not spells** — they cannot be Counterspelled and are not blocked by GoI.
- **Pre-2024 (this engine's scope):** RAW is ambiguous. PHB p.245 says GoI blocks "any spell of 5th level or lower cast from outside the barrier." Lair actions are not cast as spells.
- **Decision:** lair actions bypass GoI and Counterspell. They are tagged `isSpell: false` in the effect payload. The `isProtectedByGoI` check is skipped for lair-action-sourced effects.
- **Flag for review:** if you want pre-2024 strict RAW (where the question is unresolved), this is a reasonable default. If you want lair actions *blockable* by GoI (stricter), set `lairActionGoIBlockable: true` and pass a `castLevel` derived from the source creature's CR. I recommend the non-blockable default.

### [DD-5] "Can't repeat same effect 2 rounds in a row" — per-creature 2-entry history

- New scratch field: `Combatant._lairActionHistory: string[]` (last 2 action IDs used).
- The selector excludes any action whose ID is in the history.
- If all available actions are in the history (only possible if a creature has ≤2 options), the creature **skips** its lair action that round (PHB: "can't use the same effect two rounds in a row").
- History is cleared at combat start.

### [DD-6] AI scoring — expected-value estimator, not a planner action

- Lair actions do **not** go through `planTurn` / `executePlannedAction`. They are resolved at initiative count 20 by a dedicated `resolveLairActions(state)` call, mirroring the existing lair-stub location but with real logic.
- Each candidate action is scored by `scoreLairAction(action, lairCreature, bf)`:
  - **Expected damage to enemies** (sum over enemy targets of `P(hit) × avgDamage`).
  - **Expected condition value** (conditions weighted: stunned/restrained/petrified > poisoned > prone).
  - **Summon value** (expected damage contribution of the summon over 3 rounds).
  - **Buff value** (advantage on attacks for allies ≈ +4 effective per ally; vulnerability ≈ +50% damage).
  - **Debuff value** (disadvantage imposed on enemies).
  - **Control value** (push/pull/repositioning — situational, low default weight).
  - **Flavor value** = 0 (excluded from scoring; see §4).
- The action with the **highest score** is selected (tie-break: lowest action ID for determinism).
- Scoring weights are in a single config object (`LAIR_ACTION_SCORE_WEIGHTS`) for easy tuning.

### [DD-7] Out-of-scope flavor actions — registry with stable IDs, logged not executed

- A lair action is **out-of-scope** if it has none of: `@dc`, `@damage`, `@condition`, `@creature`, `@spell`, `@hit`, `@dice`, `@status`, `@hazard` AND its text matches a flavor heuristic (time manipulation, long-duration terrain reshaping ≥10 min, pure atmospheric, object creation with no combat use).
- Out-of-scope actions are assigned stable IDs (`lair_oos_NNN`) and listed in `docs/LAIR-ACTIONS-OUT-OF-SCOPE.md`.
- At runtime, if the selector picks an out-of-scope action (only possible if it's the sole remaining option after history exclusion — rare), the engine **logs** it with the ID but does not execute it.
- The parser tags out-of-scope actions with `outOfScope: true` and `outOfScopeId: 'lair_oos_NNN'` so they're searchable in logs and skip-able in scoring.

---

## 4. Out-of-Scope Identification Heuristic

An action is flagged `outOfScope: true` if **all** of the following hold:

1. **No mechanical tag** present in the raw 5eTools JSON: no `@dc`, `@damage`, `@condition`, `@creature`, `@spell`, `@hit`, `@dice`, `@status`, `@hazard`.
2. **AND** the cleaned text matches one or more flavor signals:
   - Time manipulation: "time is altered", "years forward", "years backward", "wish spell can return".
   - Long-duration terrain reshaping (≥10 minutes): "after 10 minutes", "1 hour", "8 hours", "24 hours" — *unless* the action also has a combat-relevant tag (then it's in-scope, e.g., Juiblex green slime has `@hazard`).
   - Pure atmospheric: "whispers", "sound of", "smell", "odor", "scent", "temperature", "wind", "breeze", "illuminate", "glow" — *unless* a mechanical tag is present.
   - Object creation with no combat use: "conjure up ... temporary objects made of stone or metal" (Ki-rin).
   - Social/infiltration: "simulacrum", "telepathic message", "illusion of ... appear to be".
3. **OR** the action is explicitly meta-mechanical and out-of-engine-scope:
   - "reroll initiative" (Sphinx) — affects the initiative order itself; defer to a future "meta-mechanics" phase.

**Borderline cases** (mechanical but complex — kept IN scope, deferred to a later sub-phase):
- Baphomet "Reverse Gravity" — mechanical (creatures fall), but requires a gravity-flip subsystem. Tagged `deferred: 'gravity'`.
- Black Dragon "Magical Darkness" — mechanical (blocks darkvision, blocks nonmagical light), but requires the vision/light subsystem. Tagged `deferred: 'magical-darkness'`.
- Green slime / brown mold (DMG hazards) — mechanical, but require a hazard-statblock lookup. Tagged `deferred: 'dmg-hazard'`.

Deferred actions are **logged but not executed** until their subsystem is built, same runtime behavior as out-of-scope, but tagged differently for tracking.

---

## 5. Structured Schema (Phase 1 deliverable)

### 5.1 `LairAction` type (new)

```ts
// src/types/core.ts (addition)
export interface LairAction {
  id: string;                  // stable hash: `${creatureName}::${index}`
  sourceCreature: string;      // legendary group name (e.g., "Adult Red Dragon")
  rawText: string;             // cleaned English text (for logging / fallback)
  outOfScope: boolean;         // true → log only, never execute
  outOfScopeId?: string;       // 'lair_oos_NNN' if outOfScope
  deferred?: string;           // subsystem tag if deferred ('gravity', 'magical-darkness', etc.)

  // Extracted structure (all optional — depends on category)
  saveDC?: number;             // from @dc
  saveAbility?: AbilityScore; // inferred from text (STR/DEX/CON/INT/WIS/CHA)
  damage?: { count: number; sides: number; type: string };  // from @damage
  conditions?: Condition[];    // from @condition
  summons?: { creature: string; count: number | string };   // from @creature + "up to N"
  spellToCast?: string;        // from @spell
  spellSlotLevel?: number;     // inferred if "casts at Nth level"
  rangeFt?: number;            // inferred from "within N feet"
  radiusFt?: number;           // inferred from "N-foot-radius"
  durationRounds?: number;     // 1 = "until next initiative count 20"; else N
  targetsEnemies: boolean;     // true = affects lair creature's enemies; false = allies/self
  targetFilter?: string;       // e.g., "gnoll", "hyena", "humanoid" — restricts to creature type

  // Category for dispatcher routing
  category: LairActionCategory;
}

export type LairActionCategory =
  | 'save_damage'
  | 'save_condition'
  | 'save_only'
  | 'damage_no_save'
  | 'summon'
  | 'cast_spell'
  | 'buff_ally'
  | 'debuff_enemy'
  | 'visibility'
  | 'spell_slot_regen'
  | 'movement'         // push/pull/knock
  | 'flavor'           // out-of-scope
  | 'deferred'         // in-scope but waiting on a subsystem
  | 'bespoke';         // doesn't fit any category — needs a hand-written handler
```

### 5.2 `Combatant` additions

```ts
// src/types/core.ts (additions to Combatant)
isInLair?: boolean;                    // [DD-1] default true when lairActions defined
lairActions?: {                        // REPLACES the current string[] schema
  actions: LairAction[];               //   (was: { actions: string[]; initiativeCount: number })
  initiativeCount: number;             //   always 20
};
_lairActionHistory?: string[];         // [DD-5] last 2 action IDs used
```

### 5.3 Parser changes (`src/parser/fivetools.ts`)

`parseLairActions()` is extended to:

1. Keep the existing string-flattening (for `rawText`).
2. Run the 5eTools tag extractor (regex over raw JSON) to populate the structured fields.
3. Infer `saveAbility` from text keywords ("Strength saving throw" → `'str'`; etc.).
4. Infer `rangeFt` / `radiusFt` from "within N feet" / "N-foot-radius".
5. Infer `durationRounds`: "until initiative count 20 on the next round" → `1`; "1 minute" → `10`; "until dismissed" → `Infinity`.
6. Infer `targetsEnemies` from "each creature other than the [creature]" → `true`; "the [creature] casts Haste on themself" → `false`.
7. Infer `targetFilter` from "each gnoll or hyena" → `'gnoll|hyena'`.
8. Apply the out-of-scope heuristic (§4) → set `outOfScope` / `outOfScopeId`.
9. Assign `category` via the categorization rules.
10. Assign `id` = `${sourceCreature}::${index}` (stable, deterministic).

---

## 6. Engine Integration

### 6.1 Initiative count 20 hook

The `runCombat` round loop (`combat.ts:6451`) gains a new phase **before** the per-actor turn loop:

```ts
for (let round = 1; round <= maxRounds; round++) {
  battlefield.round = round;
  state.disengagedThisTurn.clear();

  // ── Phase A: Lair actions (initiative count 20, priority over ties) ──
  resolveLairActions(state);   // NEW — see §6.2

  // ── Phase B: Lair Actions (old stub location — REMOVED) ──
  // (the old random-pick stub at combat.ts:6458 is deleted)

  for (const actorId of initiative) { ... }   // existing per-actor loop
}
```

**Note on [DD-2]:** true "initiative count 20, priority over ties" requires the engine to know each combatant's numeric initiative score. The current engine only has an ordered `initiative: string[]`. Two implementation options:

- **Option A (recommended, minimal):** keep `initiative: string[]` as the turn order, but resolve lair actions at the **start of the round** (before any creature acts). This is functionally "priority over ties" because lair actions happen before every creature's turn. This is a slight simplification — it doesn't handle the case where a creature has initiative > 20 (they'd act after the lair action in RAW too, which is what we want). **This option is correct for all practical cases and requires zero changes to initiative tracking.**
- **Option B (strict RAW):** add `initiativeScore: number` to Combatant, resolve lair actions when the loop reaches the first creature with score ≤ 20. Higher complexity; only matters if a creature has initiative exactly 20 (rare).

**Recommendation:** Option A. It satisfies your "priority over ties" direction (lair actions first) with no initiative-system changes. The RFC uses Option A.

### 6.2 `resolveLairActions(state)`

```ts
function resolveLairActions(state: EngineState): void {
  const bf = state.battlefield;
  // Collect all in-lair creatures with lair actions, sorted by descending CR
  const actors = [...bf.combatants.values()]
    .filter(c => c.isInLair !== false && c.lairActions && c.lairActions.actions.length > 0)
    .filter(c => !c.isDead && !c.isUnconscious)
    .sort((a, b) => (b.cr ?? 0) - (a.cr ?? 0) || a.name.localeCompare(b.name));

  for (const actor of actors) {
    const history = actor._lairActionHistory ?? [];
    // Candidates = actions not in history, not out-of-scope (unless sole option)
    let candidates = actor.lairActions!.actions.filter(a => !history.includes(a.id));
    // Out-of-scope actions are excluded from candidates UNLESS they're the only option
    const inScope = candidates.filter(a => !a.outOfScope && !a.deferred);
    if (inScope.length > 0) candidates = inScope;

    if (candidates.length === 0) continue;  // "can't repeat" → skip

    // Score each candidate; pick the max
    const scored = candidates.map(a => ({ action: a, score: scoreLairAction(a, actor, bf) }));
    scored.sort((x, y) => y.score - x.score || x.action.id.localeCompare(y.action.id));
    const chosen = scored[0].action;

    // Execute (or log if out-of-scope/deferred)
    if (chosen.outOfScope) {
      log(state, 'action', actor.id,
        `${actor.name} takes a lair action [${chosen.outOfScopeId}] (out of scope — logged, not executed): ${chosen.rawText.substring(0, 100)}...`);
    } else if (chosen.deferred) {
      log(state, 'action', actor.id,
        `${actor.name} takes a lair action (deferred: ${chosen.deferred} — logged, not executed): ${chosen.rawText.substring(0, 100)}...`);
    } else {
      executeLairAction(actor, chosen, state);
    }

    // Update history (keep last 2)
    actor._lairActionHistory = [...history, chosen.id].slice(-2);
  }
}
```

### 6.3 `executeLairAction(creature, action, state)` — dispatcher

Routes by `action.category`:

| Category | Handler | Reuses |
|---|---|---|
| `save_damage` | roll save per target → `applyDamage` | `rollSave`, `applyDamageWithTempHP` |
| `save_condition` | roll save → `applySpellEffect({effectType:'condition_apply'})` | effect pipeline |
| `save_only` | roll save → bespoke effect (push/fall) | per-action handler |
| `damage_no_save` | `applyDamage` to each target | — |
| `summon` | spawn creature(s) via summon subsystem | `summonSpell` dispatch pattern |
| `cast_spell` | look up spell in `genericSpellRegistry` → call `execute()` | Session 75-76 registry |
| `buff_ally` / `debuff_enemy` | `applySpellEffect` with `advantage_vs` / condition | — |
| `visibility` | `terrain_zone` effect with obscurement payload | `terrain_zone` |
| `spell_slot_regen` | restore slot on the lair creature | direct resource mutation |
| `movement` | push/pull via position mutation | `chebyshev3D` |
| `bespoke` | hand-written handler per `action.id` | — |

### 6.4 Interaction matrix

| Subsystem | Interaction | Decision |
|---|---|---|
| **Globe of Invulnerability** | Lair action effects on GoI-protected creatures | [DD-4] NOT blocked (lair actions aren't spells) |
| **Counterspell** | Enemy tries to counter a lair action | NOT counterable (not a spell) |
| **Concentration** | Does a lair action break the caster's concentration? | NO — lair actions don't consume concentration |
| **Legendary Actions** | Same round as lair actions? | YES — independent. Lair at count 20, legendary on other creatures' turns. |
| **Reactions** | Can a lair action trigger a reaction (e.g., Shield)? | Only the `save_damage` category where damage is dealt — `triggerReactions` fires normally. Other categories: no. |
| **Summons** | Do lair-summoned creatures get a turn? | YES — inserted into initiative after the lair creature (same as `summonSpell`). |
| **Death** | If the lair creature dies, do ongoing lair effects end? | Duration-based effects persist until expiry; no new lair actions fire. |

---

## 7. AI Scoring Rubric (`scoreLairAction`)

```ts
const LAIR_ACTION_SCORE_WEIGHTS = {
  damagePerEnemy: 1.0,       // expected HP loss per enemy
  conditionStunned: 40,      // flat value per enemy afflicted
  conditionRestrained: 25,
  conditionPetrified: 60,
  conditionPoisoned: 15,
  conditionProne: 10,
  conditionOther: 12,
  summonExpectedDpr: 1.0,    // summon's expected damage/round × 3 rounds
  buffAdvantage: 4,           // per ally buffed (≈ +4 to hit)
  buffVulnerability: 20,      // per enemy made vulnerable (≈ +50% dmg)
  debuffDisadvantage: 6,      // per enemy debuffed
  controlPush: 5,             // per enemy repositioned (situational)
  visibilitySelf: 8,          // obscuring the lair creature (defensive)
  spellSlotRegen: 15,         // per slot level regained
  outOfScope: -1000,          // never pick unless sole option
  deferred: -1000,
};
```

`scoreLairAction(action, lairCreature, bf)`:

1. If `outOfScope` or `deferred` → return -1000.
2. Compute target set (enemies or allies of the lair creature, filtered by `targetFilter`, within `rangeFt`).
3. Sum expected value per the weights.
4. **Penalty for self-harm:** if the action would damage the lair creature's faction, subtract that from the score.
5. Return the total.

The selector picks `max(score)`, tie-broken by lowest `action.id` (deterministic).

**Tuning:** weights live in one config object. Initial values are reasonable defaults; a follow-up pass can tune against bestiary integration tests.

---

## 8. Implementation Phases

Each phase is independently shippable with its own test file. An agent can stop after any phase and the engine remains green.

### Phase 0 — Taxonomy + out-of-scope registry (no code change, research only)
- Run the full 309-action categorization pass.
- Populate `docs/LAIR-ACTIONS-OUT-OF-SCOPE.md` with stable IDs.
- Identify the ~15 bespoke actions that need hand-written handlers.
- **Deliverable:** the registry doc + this RFC (done).
- **Estimated risk:** none (documentation only).

### Phase 1 — Structured schema + parser extraction (data layer)
- Add `LairAction` type to `core.ts`.
- Extend `parseLairActions()` to populate structured fields from 5eTools tags.
- Keep the old `string[]`-based stub working (backward compat) by having `lairActions.actions` be the new `LairAction[]` but the stub reads `action.rawText`.
- **Tests:** `src/test/session91_lair_action_parser.test.ts` — verify extraction for 10 representative creatures (one per category).
- **Estimated risk:** LOW — parser only; engine behavior unchanged.

### Phase 2 — Engine dispatch infrastructure
- Add `isInLair` flag (default true), `_lairActionHistory` scratch field.
- Add `resolveLairActions(state)` at round start (replaces the old stub).
- Implement the "can't repeat 2 rounds" history.
- Implement the out-of-scope / deferred logging.
- Handlers are **stubs** that log "not yet implemented" for in-scope categories — no mechanical effect yet.
- **Tests:** `src/test/session92_lair_action_dispatch.test.ts` — flag gating, history, out-of-scope logging, multi-creature ordering.
- **Estimated risk:** MEDIUM — touches the round loop. The old stub is replaced; any test that asserts on the old lair-action log format needs updating.

### Phase 3 — Effect handlers by category
- Implement handlers in priority order (most common first):
  1. `save_damage` + `save_condition` (96 actions, 31% of total)
  2. `summon` (47 actions, 15%)
  3. `cast_spell` (~30 actions, 10%)
  4. `damage_no_save` (13 actions, 4%)
  5. `buff_ally` / `debuff_enemy` (8 actions, 3%)
  6. `visibility` (8 actions, 3%)
  7. `spell_slot_regen` (4 actions, 1%)
  8. `movement` (push/pull — folded into `save_only`)
- Each handler gets its own test file (`session93_lair_save_damage.test.ts`, etc.).
- **Estimated risk:** MEDIUM per handler — each reuses existing subsystems; the risk is in the bespoke edge cases.

### Phase 4 — AI scoring + selection
- Implement `scoreLairAction` with the weights from §7.
- Replace the "first candidate" selection in `resolveLairActions` with max-score selection.
- **Tests:** `src/test/session9X_lair_action_scoring.test.ts` — verify the scoring picks the obvious best action in constructed scenarios (e.g., 3 clustered enemies + 1 isolated → picks AoE damage over single-target push).
- **Estimated risk:** LOW — scoring is a pure function; selection logic is isolated.

### Phase 5 — Integration + edge cases
- Full-combat integration tests with lair creatures (Adult Red Dragon, Lich, Kraken).
- GoI interaction tests ([DD-4]).
- Multi-lair-creature tests ([DD-3]).
- "Can't repeat 2 rounds" edge case (creature with 2 options, 3-round combat).
- Bestiary integration test sweep.
- **Estimated risk:** MEDIUM — surfaces interactions that need tuning.

### Phase 6 — Deferred subsystems (optional, future)
- `gravity` (Baphomet Reverse Gravity)
- `magical-darkness` (Black Dragon darkness — needs vision/light subsystem)
- `dmg-hazard` (green slime, brown mold — needs DMG hazard statblocks)
- `meta-initiative` (Sphinx reroll — needs initiative-order mutation)

---

## 9. Test Strategy

- **Unit tests** per phase (parser, dispatcher, scoring).
- **Integration tests** with real bestiary data (Adult Red Dragon is the canonical example — 3 lair actions, all save_damage/save_condition).
- **Determinism:** scoring is deterministic (tie-break by ID). "Can't repeat" is deterministic (history). The only non-determinism is dice rolls in save/damage handlers, handled via existing retry-loop patterns.
- **Regression:** the old lair-action stub log format changes. Any test asserting on `"takes a lair action (initiative count 20): <text>"` needs updating to the new format. A grep-and-update pass is part of Phase 2.

---

## 10. Open Questions (please review before Phase 1)

1. **[DD-2] Priority over ties — confirm Option A is acceptable.** Option A resolves lair actions at the *start of the round* (before all creatures). This is simpler than true initiative-count-20 tracking but means a creature with initiative 25 acts *after* the lair action even though RAW would have them act before count 20. Is this acceptable? (My recommendation: yes — it satisfies your "priority over ties" direction and the edge case is negligible.)

2. **[DD-4] GoI / Counterspell interaction — confirm non-blockable default.** The 2024 MM says lair actions aren't spells. Pre-2024 (this engine) is ambiguous. Do you want lair actions blockable by GoI? (My recommendation: no — keeps legendary creatures threatening inside a GoI.)

3. **Out-of-scope registry scope.** The starter registry (§Phase 0) identifies ~12 clear flavor actions. The ~15 "bespoke" actions (time manipulation, simulacrum, etc.) are *in-scope but need hand-written handlers*. Should bespoke actions with no clear combat mechanical effect (e.g., Sphinx "time moves 10 years") be reclassified as out-of-scope? (My recommendation: yes — reclassify purely-narrative bespoke actions as out-of-scope; keep mechanically-meaningful bespoke actions like "reroll initiative" as `deferred`.)

4. **Scoring weight tuning.** The weights in §7 are reasonable defaults. Do you want me to tune them against a specific combat scenario, or ship the defaults and let playtesting tune later? (My recommendation: ship defaults, tune in Phase 5.)

5. **`isInLair` UI surface.** You said "tied to a flag in the monster UI by default to on." The engine doesn't currently have a monster editor UI (it's a simulation engine with a character builder). Should the flag be: (a) parser-set (default true when lairActions defined, overridable in scenario JSON), (b) exposed in the character builder JSON schema, or (c) both? (My recommendation: (a) for now — the RFC assumes parser default + scenario override.)

---

## 11. References

- `bestiaryData/legendarygroups.json` — source data (115 groups, 309 actions)
- `src/engine/combat.ts:6458` — current lair-action stub (to be replaced)
- `src/parser/fivetools.ts:711` — `parseLairActions()` (to be extended)
- `src/types/core.ts:1107` — `lairActions` type (to be restructured)
- `docs/RFC-MONSTER-SPELLCASTING.md` — related RFC (legendary actions, recharge)
- PHB p.193 (Ready Action — unrelated, referenced for reaction plumbing context)
- MM (2024) — lair actions are not spells (clarification cited in [DD-4])

---

**End of RFC.** See `docs/LAIR-ACTIONS-OUT-OF-SCOPE.md` for the Phase 0 registry. See `zHANDOVER-SESSION-90.md` for the handover directing the next agent to Phase 1.
