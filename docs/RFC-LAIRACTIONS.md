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
- An initiative-count-20 hook with **PHB-accurate tie resolution** (current stub fires at round start, before *all* turns — not tied to initiative 20).
- A numeric `initiativeScore` on Combatant (currently `rollInitiative` computes scores but discards them, returning only an ordered ID array).
- A `LairMonstersAREinLair` per-combatant flag (default `true` when `lairActions` is defined), exposed in the parser, scenario JSON, **and** character builder.
- A per-creature "last lair action used" history (for the "can't repeat 2 rounds in a row" rule).
- A per-action magical/spell tagging (`isMagical`, `isSpell`, `spellName`, `castLevel`) for GoI / Counterspell / Antimagic Field interactions.
- An AI scoring function for action selection.
- A dispatcher with per-category handlers.

---

## 3. Design Decisions (documented assumptions — please review)

These are the judgment calls I made to unblock implementation. Each is flagged **[DD-N]**. If you disagree with any, the RFC should be revised before Phase 1.

### [DD-1] `LairMonstersAREinLair` flag — per-combatant, default `true`, exposed in 3 surfaces

- Added to `Combatant` as `isInLair?: boolean`.
- **Parser default:** when `lairActions` is defined, `isInLair = true`. A dragon encountered outside its lair can be set to `false`.
- **Scenario JSON override:** the scenario/character builder JSON can set `isInLair: false` to override the parser default (e.g., a dragon ambush in a field).
- **Character builder surface:** the character builder's monster-import path (`src/characters/builder.ts` monster branch) preserves the `isInLair` flag from the bestiary, and the `CharacterSheet`/monster JSON schema exposes it as a settable toggle (default on when `lairActions` present). This satisfies your direction "in char builder too."
- When `isInLair === false`, the creature still *has* `lairActions` in its data, but the engine skips the lair-action hook entirely.

### [DD-2] Initiative count 20, PHB-accurate tie resolution (losing ties) — RESOLVED per user

- **PHB / MM:** "On initiative count 20 (losing initiative ties)." The lair action resolves **after** any creature whose initiative = 20. Creatures with initiative > 20 act first; creatures with initiative = 20 act before the lair action; creatures with initiative < 20 act after.
- **User direction (this session):** use the PHB default — lair actions resolve **after** creatures with initiative ≥ 20, **before** creatures with initiative < 20.
- **Implementation requirement:** the engine's `rollInitiative` (`utils.ts:911`) currently computes numeric initiative scores but **discards them**, returning only an ordered ID array. To resolve lair actions at count 20 accurately, the RFC adds a numeric `initiativeScore: number` field to `Combatant`, populated by `rollInitiative` (and accepted as an override in `runCombat`'s initiative parameter for pre-rolled scenarios).
- **Round loop change:** `runCombat`'s per-round turn loop (`combat.ts:6451`) is restructured to insert a lair-action checkpoint at the boundary between creatures with initiative ≥ 20 and those with < 20:
  ```
  for each actorId in initiative (descending order):
    if actorId is the first with initiativeScore < 20 AND no lair actions have fired this round:
      resolveLairActions(state)   // fires once, after all ≥-20 creatures, before <-20 creatures
    execute actorId's turn
  // if no creature has initiativeScore < 20, lair actions fire at the end of the round
  ```
- **Edge case — all creatures have initiative > 20:** lair actions fire at the end of the round (after all turns). This is correct per PHB.
- **Edge case — all creatures have initiative < 20:** lair actions fire at the start of the round (before all turns). Also correct.
- **Edge case — no numeric scores (legacy scenarios passing only `initiative: string[]`):** fall back to firing at round start (the current stub behavior). This is a graceful degradation, not PHB-accurate, but preserves backward compat.

### [DD-3] Multiple lair creatures in one combat — each acts independently

- If two creatures with lair actions are in the same combat (e.g., two dragons), each takes its own lair action at count 20.
- Resolution order among multiple lair creatures: **descending CR** (highest CR first). Tie-break: alphabetical name (deterministic for tests).
- The "can't repeat same effect 2 rounds in a row" rule is **per-creature** (each tracks its own history).

### [DD-4] Per-action magical/spell tagging — RESOLVED per user (no blanket rule)

**User direction (this session):** "You will have to read and understand each lair action individually. There is no blanket statement here: they can be magical, but not necessarily spells. But it CAN be a spell sometimes. Determine and tag each instance that allows casting a spell; some spells and their areas are blocked by GoI; it's important to tag lair actions that are magical, even if not spells, because antimagic field exists."

**No blanket rule.** Each of the 309 lair actions is read individually and tagged with:

```ts
isMagical: boolean;     // default true (MM: "magical effects"). False only for purely physical effects (rare).
isSpell: boolean;       // true ONLY when the action explicitly casts a named spell.
spellName?: string;     // when isSpell (e.g., 'fireball', 'banishment').
castLevel?: number;     // when isSpell — for GoI threshold check. Base spell level by default; upcast level if text specifies.
```

**Tagging rules (applied per-action in Phase 1 parser pass):**

1. **`isSpell: true`** when the action text contains `@spell X` OR matches the pattern "casts [spell name]" / "casts the [spell name] spell." The 56 `@spell` tags in the data identify these directly. Examples:
   - "Baphomet casts mirage arcane" → `isSpell: true, spellName: 'mirage arcane', castLevel: 7` (mirage arcane is 7th-level).
   - "Geryon casts the banishment spell" → `isSpell: true, spellName: 'banishment', castLevel: 4`.
   - "The lich rolls a d8 and regains a spell slot" → `isSpell: false` (no spell is cast; this is resource regeneration).
2. **`isMagical: true, isSpell: false`** for all other actions where the effect is supernatural (magma erupting from nowhere, gravity reversing, magical darkness, summoned creatures appearing). This is the default — MM says lair actions are "magical effects." Examples:
   - "Magma erupts from a point... DC 15 DEX, 5d6 fire" → `isMagical: true, isSpell: false`.
   - "A strong current... DC 23 STR or pushed 60 ft" → `isMagical: true, isSpell: false`.
3. **`isMagical: false`** only for purely physical effects with no magical source. This is **rare** — the MM describes all lair actions as magical. Reserved for edge cases like "a tremor shakes the lair" if the design team decides that's geological rather than magical. Default: all actions start `isMagical: true` unless explicitly reviewed.

**Interaction matrix (per-tag, not blanket):**

| Subsystem | `isSpell: true` | `isMagical: true, isSpell: false` | `isMagical: false` |
|---|---|---|---|
| **Globe of Invulnerability** | **Blocked** if `castLevel ≤ GoI threshold` and caster is outside the barrier (Session 87 spatial rules apply). The lair creature is the "caster" for `casterId` purposes. | **Not blocked** (GoI blocks spells, not magical effects). | Not blocked. |
| **Counterspell** | **Counterable** (enemy within 60 ft can cast Counterspell; ability check vs DC 10+castLevel). | Not counterable. | Not counterable. |
| **Antimagic Field** (forward-compat — not yet implemented) | **Suppressed** (spells are suppressed in AMF). | **Suppressed** (magical effects are suppressed in AMF per PHB p.213). | Not suppressed. |
| **Dispel Magic** | **Dismissible** (dispels the spell effect if cast at ≥ castLevel). | Not dismissible (Dispel Magic ends spells, not magical effects). | Not dismissible. |

**Implementation:** the `executeLairAction` dispatcher checks `action.isSpell` before applying effects. If `isSpell && castLevel > 0`, it calls `isProtectedByGoI(target, castLevel, bf, lairCreature.id)` per target (reusing the Session 87 spatial logic). If `isSpell`, it also fires the `triggerReactions` hook for `incoming_spell` (enabling Counterspell). If `!isSpell`, both are skipped.

**Phase 1 deliverable:** the parser pass produces a per-action tagging table (309 rows) with columns: `id | sourceCreature | isMagical | isSpell | spellName | castLevel | category`. This table is reviewed before Phase 2 dispatch begins. The ~56 `@spell`-tagged actions get `isSpell: true` automatically; the remaining ~253 are `isMagical: true, isSpell: false` by default, with any `isMagical: false` exceptions flagged `[VERIFY]`.

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

## 4. Out-of-Scope vs Deferred Classification — RESOLVED per user

**User direction (this session):** "defer" — purely-narrative bespoke actions (Sphinx time travel, etc.) are classified as **`deferred`**, NOT `out-of-scope`. They remain candidates for future implementation when their subsystem lands; they are not permanently excluded.

### 4.1 Out-of-scope (`outOfScope: true`, `outOfScopeId: 'lair_oos_NNN'`)

An action is **out-of-scope** (permanently excluded from mechanical execution) if **all** of the following hold:

1. **No mechanical tag** present in the raw 5eTools JSON: no `@dc`, `@damage`, `@condition`, `@creature`, `@spell`, `@hit`, `@dice`, `@status`, `@hazard`.
2. **AND** the cleaned text matches one or more flavor signals:
   - Long-duration terrain reshaping (≥10 minutes) with no combat use: "after 10 minutes, the terrain reshapes to assume the appearance..." (Balhannoth).
   - Object creation with no combat use: "conjure up ... temporary objects made of stone or metal" (Ki-rin).
   - Vehicle/ship movement: "a strong wind propels the vessel" (Merrenoloth).
3. **AND** the action has no plausible mechanical implementation even with a future subsystem (purely social/narrative).

These are logged at runtime with their `outOfScopeId` but never executed. Count: **~5 actions** (see `docs/LAIR-ACTIONS-OUT-OF-SCOPE.md`).

### 4.2 Deferred (`deferred: '<subsystem>'`, NOT out-of-scope)

An action is **deferred** if it IS mechanical (or could become mechanical) but depends on a subsystem the engine doesn't yet have. Per user direction, narrative-bespoke actions that *could* be modeled someday are deferred, not out-of-scope. Subsystem tags:

| Tag | Meaning | Example |
|---|---|---|
| `'gravity'` | gravity-flip subsystem | Baphomet "Reverse Gravity" |
| `'magical-darkness'` / `'visibility'` | vision/light subsystem | Black Dragon darkness, fog/mist actions |
| `'dmg-hazard'` | DMG hazard statblock lookup | Juiblex green slime |
| `'meta-time'` | time-manipulation subsystem | Sphinx "time moves 10 years" |
| `'meta-initiative'` | initiative-order mutation | Sphinx "reroll initiative" |

Deferred actions are logged at runtime with their deferral tag. When the named subsystem is implemented, the action moves to in-scope and becomes executable. Count: **~8 actions**.

### 4.3 Borderline `[VERIFY]` cases

Two actions are flagged for human review in Phase 1:
- Lichen Lich "shambling mound" — 1-hour duration but functions as a summon in combat. **Recommend:** reclassify as `summon` (in-scope, `durationRounds: Infinity`).
- Juiblex "green slime" — DMG hazard with real combat effect. **Recommend:** `deferred: 'dmg-hazard'`.

### 4.4 Summary

| Classification | Count | Runtime | Reversibility |
|---|---|---|---|
| Out-of-scope (`lair_oos_*`) | ~5 | Logged with ID, never executed | Permanent (would need a design decision to model social/narrative effects) |
| Deferred (`lair_def_*`) | ~8 | Logged with tag, executed when subsystem lands | Reversible — becomes executable when the subsystem is built |
| Borderline `[VERIFY]` | 2 | Phase 1 agent classifies | — |
| **Total non-executable** | **~15** | of 309 (~5%) | — |

---

## 5. Structured Schema (Phase 1 deliverable)

### 5.1 `LairAction` type (new)

```ts
// src/types/core.ts (addition)
export interface LairAction {
  id: string;                  // stable: `${creatureName}::${index}`
  sourceCreature: string;      // legendary group name (e.g., "Adult Red Dragon")
  rawText: string;             // cleaned English text (for logging / fallback)
  outOfScope: boolean;         // true → log only, never executed (flavor/social)
  outOfScopeId?: string;       // 'lair_oos_NNN' if outOfScope
  deferred?: string;           // subsystem tag if deferred ('gravity', 'magical-darkness', 'meta-time', etc.)

  // ── [DD-4] Magical / spell tagging (per-action, no blanket rule) ──
  isMagical: boolean;          // default true (MM: "magical effects"). False only for purely physical (rare).
  isSpell: boolean;            // true ONLY when the action casts a named spell.
  spellName?: string;          // when isSpell (e.g., 'mirage arcane').
  castLevel?: number;          // when isSpell — for GoI threshold check.

  // Extracted structure (all optional — depends on category)
  saveDC?: number;             // from @dc
  saveAbility?: AbilityScore; // inferred from text (STR/DEX/CON/INT/WIS/CHA)
  damage?: { count: number; sides: number; type: string };  // from @damage
  conditions?: Condition[];    // from @condition
  summons?: { creature: string; count: number | string };   // from @creature + "up to N"
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
  | 'cast_spell'        // isSpell: true, spellName set
  | 'buff_ally'
  | 'debuff_enemy'
  | 'visibility'
  | 'spell_slot_regen'
  | 'movement'         // push/pull/knock
  | 'deferred'         // in-scope but waiting on a subsystem (gravity, magical-darkness, meta-time, etc.)
  | 'bespoke'          // doesn't fit any category — needs a hand-written handler
  | 'flavor';          // out-of-scope (social/narrative, no combat mechanical effect)
```

### 5.2 `Combatant` additions

```ts
// src/types/core.ts (additions to Combatant)
isInLair?: boolean;                    // [DD-1] default true when lairActions defined; parser + scenario JSON + char builder
initiativeScore?: number;              // [DD-2] numeric initiative (1-30+); set by rollInitiative; for count-20 boundary
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
3. **[DD-4] Tag each action individually:**
   - `isSpell: true` if `@spell` tag present OR text matches "casts [spell]" / "casts the [spell] spell." Extract `spellName` and look up `castLevel` from the spell registry.
   - `isMagical: true` by default for all actions (MM: "magical effects"). Set `isMagical: false` only if the text describes a purely physical effect with no magical source (rare; flag `[VERIFY]`).
   - This is a **per-action read**, not a blanket rule. The Phase 1 deliverable is a 309-row tagging table.
4. Infer `saveAbility` from text keywords ("Strength saving throw" → `'str'`; etc.).
5. Infer `rangeFt` / `radiusFt` from "within N feet" / "N-foot-radius".
6. Infer `durationRounds`: "until initiative count 20 on the next round" → `1`; "1 minute" → `10`; "until dismissed" → `Infinity`.
7. Infer `targetsEnemies` from "each creature other than the [creature]" → `true`; "the [creature] casts Haste on themself" → `false`.
8. Infer `targetFilter` from "each gnoll or hyena" → `'gnoll|hyena'`.
9. Apply the out-of-scope heuristic (§4) → set `outOfScope` / `outOfScopeId` OR `deferred`.
10. Assign `category` via the categorization rules (`cast_spell` when `isSpell`, else by tags).
11. Assign `id` = `${sourceCreature}::${index}` (stable, deterministic).

---

## 6. Engine Integration

### 6.1 Initiative count 20 hook (PHB-accurate, losing ties)

The `runCombat` round loop (`combat.ts:6451`) is restructured to insert a lair-action checkpoint **at the initiative-20 boundary** within the per-actor turn loop (not at round start). This requires numeric initiative scores (see [DD-2]):

```ts
for (let round = 1; round <= maxRounds; round++) {
  battlefield.round = round;
  state.disengagedThisTurn.clear();

  let lairActionsFiredThisRound = false;

  for (const actorId of initiative) {  // descending order
    const actor = battlefield.combatants.get(actorId)!;

    // ── Lair action checkpoint: fire AFTER all creatures with init ≥ 20,
    //    BEFORE the first creature with init < 20. (PHB: losing ties) ──
    if (!lairActionsFiredThisRound && (actor.initiativeScore ?? 0) < 20) {
      resolveLairActions(state);   // see §6.2
      lairActionsFiredThisRound = true;
    }

    // (existing per-actor turn logic)
    if (!actor || actor.isDead) continue;
    // ... executeTurnPlan(actor, plan, state) ...
  }

  // Edge case: if ALL creatures had initiative ≥ 20 (or no numeric scores),
  // lair actions fire at the END of the round.
  if (!lairActionsFiredThisRound) {
    resolveLairActions(state);
  }
}
```

**Backward compat:** if `initiativeScore` is undefined on all combatants (legacy scenarios passing only `initiative: string[]`), the `actor.initiativeScore ?? 0 < 20` check is true for the first creature, so lair actions fire at round start (the current stub behavior). This is graceful degradation — not PHB-accurate, but doesn't break existing tests.

**`rollInitiative` change:** `utils.ts:911` is updated to store the rolled score on each combatant (`c.initiativeScore = roll`) in addition to returning the ordered ID array. This is a one-line addition with no behavior change.

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

### 6.4 Interaction matrix (per-action tags — see [DD-4])

| Subsystem | `isSpell: true` action | `isMagical, !isSpell` action | `!isMagical` action (rare) |
|---|---|---|---|
| **Globe of Invulnerability** | Blocked if `castLevel ≤ GoI threshold` and lair creature is outside the barrier (Session 87 spatial rules; `casterId = lairCreature.id`). | NOT blocked (GoI blocks spells only). | NOT blocked. |
| **Counterspell** | Counterable (enemy within 60 ft; ability check vs DC 10+castLevel). Fires `incoming_spell` reaction trigger. | Not counterable. | Not counterable. |
| **Antimagic Field** (forward-compat) | Suppressed. | Suppressed (magical effects suppressed per PHB p.213). | Not suppressed. |
| **Dispel Magic** | Dismissible (if cast at ≥ castLevel). | Not dismissible. | Not dismissible. |
| **Concentration** | Does NOT break the lair creature's concentration (lair actions aren't concentration spells). | Same. | Same. |
| **Legendary Actions** | Independent — lair at count 20, legendary on other creatures' turns. | Same. | Same. |
| **Reactions (Shield, Absorb Elements)** | `save_damage` category fires `incoming_attack_hit` / `incoming_damage` triggers normally. Other categories: no. | Same. | Same. |
| **Summons** | Lair-summoned creatures get a turn — inserted into initiative after the lair creature (same as `summonSpell`). | Same. | Same. |
| **Death of lair creature** | Duration-based effects persist until expiry; no new lair actions fire. | Same. | Same. |

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

## 10. Resolved Questions (user decisions recorded Session 90)

All 5 open questions from the draft RFC have been resolved by the user. The design decisions in §3 reflect these resolutions. Summary for the implementing agent:

| # | Question | User decision | RFC section |
|---|---|---|---|
| 1 | [DD-2] Initiative count 20 tie resolution | **PHB default** — lair actions resolve AFTER creatures with initiative ≥ 20, BEFORE those with < 20. Requires `initiativeScore` numeric field. | [DD-2], §6.1 |
| 2 | [DD-4] GoI / Counterspell interaction | **No blanket rule.** Read each action individually. Tag `isMagical` / `isSpell` / `spellName` / `castLevel` per-action. Spells are blocked by GoI and counterable; magical non-spells are not blocked by GoI but ARE suppressed by Antimagic Field (forward-compat). | [DD-4], §6.4 |
| 3 | Out-of-scope vs deferred for narrative-bespoke | **Defer** — narrative-bespoke actions (Sphinx time travel, etc.) are `deferred`, not `out-of-scope`. Only permanently-excluded flavor/social actions (Balhannoth warp, Ki-rin objects, Merrenoloth ship) are `out-of-scope`. | §4 |
| 4 | Scoring weight tuning | **Ship defaults** — use the weights in §7 as-is; tune in Phase 5 based on playtesting. | §7 |
| 5 | `isInLair` UI surface | **All 3 surfaces** — parser default (true when lairActions defined) + scenario JSON override + character builder JSON schema (exposed as settable toggle, default on). | [DD-1] |

**No further user input is required to begin Phase 1.** The implementing agent should proceed with the design as specified in §3–§8.

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
