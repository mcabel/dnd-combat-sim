# RFC: Pattern Bias AI — Situation-Aware Spell-Selection Weighting

**Date:** Session 63
**Author:** Z.ai
**Status:** PROPOSED (user directed: "the weighted system should also consider situations and patterns to add more weight to some actions and spells (pattern bias)… you have to research videogame and/or simulator state machines for making a well-designed 'intelligence' for the selection weighted system")
**Risk:** MEDIUM — extends the existing weighted scorer in `src/ai/monster_spellcasting.ts`; pure-function detectors are additive, but the composition formula + concentration-churn tracking touch hot planner code paths
**Depends on:** `monster_spellcasting.ts` Phase 1 (cantrip selection — `computeSpellWeight`, `tagMultiplier`, `finisherMultiplier`, `SpellcastContext`), `planner.ts` monster-spell branch (line ~5236), `actions.ts::findBestAoECluster` (AoE cluster detector), `resources.ts` slot/innate helpers, `movement.ts` distance helpers

---

## 1. Goal

Extend the existing weighted spell-selection system into a richer **"pattern bias"** AI that recognises battlefield patterns and adjusts spell weights accordingly. Per the user's directives (Session 63 §9.2 of `RFC-MONSTER-SPELLCASTING.md`):

> "The weighted system should also consider situations and patterns to add more weight to some actions and spells (pattern bias): example strong ally wounded → healing or defensive; enemies are grouped: AOE. Consider that each side will want their side to win, so they will try what is optimal within their means."

> "'enemies are grouped' would have higher 'bias' bonus than 'target almost dead'. Some other bonuses may play a part in the decision such as a situation where a creature has AC 12 but a saving throw of 20: targeting 12 is much better choice (although spells that still do 1/2 damage regardless of save pass would put something like fireball as favored)."

> "'Preserving concentration' is generally a good idea, so it should get some 'bias bonus'. Consider situations where dropping bless to cast hold person would be better than enjoying the benefits of the first spell, and add bias to those situations. It is not a good idea to cast a concentration spell just to change again next round unless a new situation really merits this. You need to be robust on the research, planning and design of this."

> "Fights in this simulator should all be 'to death'; running away and/or socially interacting and negotiating are out of scope. Teleportation and dimension door or similar spells should be used either defensively (to get distance and heal or buff w/o danger) or offensively to 'kite' opponents (use range to tactically defeat an enemy that has lesser or no ranged options). The monster side should never care about saving resources; they want to go all out vs the 'player side' since monster side long rest, short rest and retreat are out of scope. Monster parties are always assumed to be 'rested' and full on their resources when they spawn."

The deliverable is a **pure-function pattern-detector layer** that feeds multipliers into the existing `computeSpellWeight()` formula — without changing the formula's shape or replacing the utility-AI paradigm. Each side plays to win: monsters go all-out (no conservation), PCs play to win but conserve (long-rest scarcity — unchanged).

---

## 2. AI Paradigm Research

Tactical-combat AI in video games and simulators falls into four well-known paradigms. This section evaluates each against our constraints (turn-based, deterministic, single-file plan per round, existing weighted scorer in place, low regression risk).

### 2.1 Finite State Machines (FSM) — Pac-Man, Quake, early RTS

A combatant is in exactly one state (`Idle`, `Engage`, `Flee`, `Cast`) at a time; transitions fire on predicates (`HP < 30% → Flee`). Predictable, easy to debug, but **brittle for spell selection**: a caster might be in `Engage` while a fireball opportunity exists, and the FSM has no native way to express "prefer fireball here, otherwise swing." Adding a state per pattern multiplies transitions combinatorially.

### 2.2 Behavior Trees — Halo 2, Spore, modern AAA

A tree of selector/sequence nodes; left-to-right evaluation returns the first successful child. Excellent for **sequential** decision-making (perceive → pick target → move → act) and easy to extend. But trees encode **priority order**, not **graded preference**: they don't naturally express "fireball is ×1.8 good here, magic missile is ×1.3 good there, pick the bigger." You can bolt a scorer onto a leaf node, but then you're back to utility AI.

### 2.3 Monte Carlo Tree Search (MCTS) — Total War, Civilisation V combat, DeepMind tactical games

Simulate many random rollouts from the current state, pick the action with the best win-rate. **Theoretically strongest** for tactical combat, but: (a) requires a fast, reversible simulator — ours is event-driven and slow per tick; (b) explodes with branching factor (~50 candidate actions × many target positions × movement variants); (c) non-deterministic tuning makes test assertions brittle; (d) the user explicitly asked for a **weighted system**, not a search. MCTS is the right tool for a future "high-CR boss intelligence" upgrade (Open Question #2), not for the broad pattern-bias layer.

### 2.4 Utility AI — F.E.A.R., The Sims, Civilisation IV/V, Stellaris, Infinity Engine

Each candidate action gets a **score** from one or more **considerations** (curves over context variables); the highest-scoring action wins. Strengths for our use case:

- **Composable**: new considerations are additive multipliers — no graph surgery.
- **Debuggable**: each multiplier is logged, so "why did the Lich cast Hold Person?" has a paper trail.
- **Graded**: naturally expresses "fireball ×1.8 > magic missile ×1.3."
- **Deterministic**: same inputs → same output → testable.
- **Matches existing code**: `computeSpellWeight()` already is a utility-AI scorer (`base × tag × finisher × availability`).

### 2.5 Recommendation

**Adopt Utility AI as the paradigm. Extend the existing `computeSpellWeight()` scorer with a layer of pattern-detector multipliers (the "pattern biases"). Do not introduce FSM, behavior trees, or MCTS at this layer.**

Justification:

| Criterion | FSM | Behavior Tree | MCTS | **Utility AI (chosen)** |
|-----------|-----|---------------|------|-------------------------|
| Fits existing `computeSpellWeight()` | ✗ (replace) | ✗ (replace) | ✗ (replace) | ✓ (extend) |
| Composable biases | ✗ | partial | n/a | ✓ |
| Graded preferences | ✗ | ✗ | ✓ | ✓ |
| Deterministic / testable | ✓ | ✓ | ✗ | ✓ |
| Low regression risk | ✗ | ✗ | ✗ | ✓ |
| Cost per turn | low | low | **very high** | low |
| Matches user's "weighted system" wording | ✗ | ✗ | ✗ | ✓ |

The D&D 5e optimisation community's heuristics (action economy, concentration preservation, target prioritisation, save-vs-AC targeting, AoE clustering, nova rounds, kiting) all map cleanly onto **multipliers over a context struct** — exactly the shape `SpellcastContext` already provides.

---

## 3. Current State (What's Already There)

### 3.1 The Weighted Scorer (`src/ai/monster_spellcasting.ts`)

The Phase 1 cantrip selection already implements a utility-AI scorer. The current formula:

```
weight = baseWeight(level) × tagMultiplier(primaryTag, ctx)
         × finisherMultiplier(targetHP, avgDmg) × availabilityMultiplier
```

Where:

- **`baseWeight(level)`** = `1.0 + level × 0.15` (cantrips = 1.0, L1 = 1.15, L3 = 1.45, L9 = 2.35). Encodes "higher-level spells are intrinsically more powerful."
- **`tagMultiplier(primaryTag, ctx)`** — a switch table over the spell's **primary tag** (first tag in its `tags[]` array) and the dominant situation (bloodied, downed ally, outnumbered, round-1 with 3+ enemies, round-1 with 1 enemy, default). Returns 0.3–2.5.
- **`finisherMultiplier(targetHP, avgDmg)`** — returns 1.3 if `targetHP ≤ avgDmg × 1.5` ("cantrip can kill, save the slot"), else 1.0.
- **`availabilityMultiplier`** — Phase 1: always 1.0 (at-will + cantrips = infinite). Phase 2: 0.0 if no slot remains, 1.0 otherwise.

### 3.2 The Six Tags

```typescript
type SpellTag = 'damage' | 'cc' | 'healing' | 'defending' | 'buff' | 'utility';
```

- **damage**: deals HP damage (Fireball, Magic Missile, Fire Bolt).
- **cc**: crowd control — conditions/restraints (Hold Person, Entangle, Web, Banishment).
- **healing**: restores HP (Cure Wounds, Healing Word, Aid).
- **defending**: self-preservation (Shield reaction, Blink, Misty Step escape, Blur).
- **buff**: enhances allies (Bless, Haste, Mage Armor).
- **utility**: non-combat or situational (Detect Magic, Light, Message) — never selected in combat.

### 3.3 The `SpellcastContext` Fields

```typescript
interface SpellcastContext {
  selfHPct: number;          // 0.0–1.0 (currentHP / maxHP)
  allyCount: number;         // living allies (excluding self)
  enemyCount: number;        // living enemies
  nearestEnemyDistFt: number;
  hasDownedAlly: boolean;    // unconscious + not dead ally
  isOutnumbered: boolean;    // enemyCount > allyCount + 1
  round: number;             // 1 = opener
}
```

Built by `computeSpellcastContext(self, bf)` — a pure function (no mutation).

### 3.4 The Selection Algorithm (`selectMonsterSpell`)

1. Collect candidates from `monsterSpellcasting.atWill` + `monsterSpellcasting.slots[0].spells`.
2. For each candidate, look up a `CantripTemplate` (Phase 1: 17 combat cantrips).
3. Skip if no template (utility or unimplemented — Doubt #1/#6 = A).
4. Find the best target in range via `findBestCantripTarget()` (lowest-HP, then nearest).
5. Compute `computeSpellWeight()` for each candidate.
6. Return the highest-weight candidate as a `cast` PlannedAction.
7. Ties → highest damage sides, then alphabetical.
8. If no candidate qualifies → return null (planner falls back to weapon attacks).

### 3.5 Existing Pieces We Will Reuse

- `findBestAoECluster(self, bf, radiusFt, minEnemies)` in `src/ai/actions.ts` — already finds the best center for an AoE hitting ≥`minEnemies` enemies without ally splash. We will call this from `enemyClusterBias()` rather than re-implementing.
- `chebyshev3D` / `distanceFt` / `euclideanDistFt` in `src/engine/movement.ts` — for distance-based biases (kiting, escape).
- `livingEnemiesOf` / `livingAlliesOf` / `adjacentEnemyCount` — for cluster and threat detection.
- `self.perception.targets.get(enemy.id)` — bounded knowledge (no psychic cheating).
- `combatant.faction: 'party' | 'enemy' | 'neutral'` — strategy split key.
- `combatant.concentration: { active, spellName, dcIfHit, targetId? }` — concentration state.
- `combatant.ac: number` — direct AC field (no perception indirection required for the engine's internal scorer).

### 3.6 Gap: Per-Ability Save Bonus

The user's "AC 12 vs save 20" directive requires comparing a target's save bonus to its AC. Today `Combatant.ac` is a direct field, but there is **no `savingThrows: { str?, dex?, … }` map** on `Combatant` — only raw ability scores (`str`, `dex`, `con`, `int`, `wis`, `cha`). Save bonus in 5e = ability modifier + proficiency (if proficient). Monsters typically list saves only for proficient abilities in their stat block; the parser stores this nowhere today.

**Phase 2 of this RFC** adds the lookup: extend `Combatant` with an optional `savingThrows?: Partial<Record<AbilityScore, number>>` populated from the 5etools `save` field, falling back to the ability modifier when absent. The `acVsSaveBias` detector (Phase 2) uses this.

---

## 4. Proposed Design: Pattern Bias System

### 4.1 Architecture

```
                ┌──────────────────────────────────────────┐
                │       computeSpellcastContext(self, bf)   │  (existing)
                └──────────────────────────────────────────┘
                              │  ctx
                              ▼
   ┌──────────────────────────────────────────────────────────────┐
   │   Pattern Detectors (NEW — pure functions)                   │
   │     enemyClusterBias  finisherBias  woundedAllyBias          │
   │     acVsSaveBias      concentrationPreservationBias          │
   │     kitingBias        defensiveEscapeBias    resourceAllOutBias │
   └──────────────────────────────────────────────────────────────┘
                              │  bias[] (each in [0.5, 3.0])
                              ▼
   ┌──────────────────────────────────────────────────────────────┐
   │   computeSpellWeight(name, tags, level, avgDmg, ctx, target, │  (extended)
   │                        bias[])                              │
   │     final = clamp( base × tag × finisher × Π(bias),          │
   │                     0.1, 10.0 )                             │
   └──────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    highest-weight spell wins
```

Each detector is a **pure function** `(ctx, bf, self, spell?, target?) → number`. They take the same context the scorer already builds (no extra state) plus the candidate spell/target under evaluation. They return a multiplier in `[0.5, 3.0]` (a "nudge") or `0.0` (a "veto").

### 4.2 Composition Formula

```typescript
function composeBiases(biases: number[]): number {
  // Veto wins: any 0.0 collapses the weight to 0.
  for (const b of biases) if (b === 0) return 0;
  // Multiply all nudges; clamp to a sane final range to prevent runaway.
  const product = biases.reduce((acc, b) => acc * b, 1);
  return Math.max(0.1, Math.min(10.0, product));
}

export function computeSpellWeight(
  spellName: string,
  tags: SpellTag[],
  spellLevel: number,
  avgDamage: number,
  ctx: SpellcastContext,
  targetHP: number,
  biases: number[] = [],   // NEW parameter — default [] = no biases (backward-compat)
): number {
  if (tags.length === 0) return 0;
  const primaryTag = tags[0];
  const base = baseWeight(spellLevel);
  const tagMult = tagMultiplier(primaryTag, ctx);
  const finisher = finisherMultiplier(targetHP, avgDamage);
  const availability = 1.0;
  const biasProduct = composeBiases(biases);
  return base * tagMult * finisher * availability * biasProduct;
}
```

**Why multiplicative, not additive?** Multiplication preserves relative ordering when one bias is decisive (e.g. `concentrationPreservationBias = 0.5` halves the weight of "churn" candidates; `enemyClusterBias = 2.5` triples AoE candidates — they compound). Additive biases wash out — a +0.5 cluster bonus is meaningless against a +2.0 AC-vs-save penalty. Multiplication also composes naturally with the existing `tagMult × finisher × availability` chain.

**Why `[0.5, 3.0]` per bias?** A bias outside this range becomes a veto in practice (e.g. `0.0` × anything = `0.0`) or a dictatorship (`10.0` × anything dominates). Restricting each bias to `[0.5, 3.0]` keeps the system **composable and debuggable**: any single pattern can swing a weight by 3× at most, so two contradictory patterns can't produce a runaway multiplier. The final clamp `[0.1, 10.0]` is a safety net for the rare case where 4+ biases align.

**Why the `[0.1, 10.0]` final clamp?** Without it, four ×2.0 biases produce ×16 — the AI would always pick the same spell regardless of tag/finisher. With it, the system never lets a spell's final weight exceed 10× base. The lower bound `0.1` lets a veto-adjacent spell still be selected if it's the only legal option (e.g. a 0.1-weight Fire Bolt beats no action).

### 4.3 Pattern Detectors

Each detector below is a pure function. All take `(ctx, bf, self)` plus candidate-specific args where relevant. All return a value in `[0.0, 3.0]`. **Default (no pattern match) = 1.0** (neutral — passes through).

#### 4.3.1 `enemyClusterBias` — AoE opportunity

User directive: **"enemies are grouped: AOE"** — this bias is HIGHER priority than the finisher bias.

```typescript
/**
 * Boost AoE/damage spells when ≥2 enemies are clustered within a typical
 * spell radius. The user explicitly ranked this ABOVE the finisher bonus
 * ("'enemies are grouped' would have higher 'bias' bonus than 'target
 * almost dead'"). Cap is 2.5 (vs finisher's 1.3) so cluster wins ties.
 *
 * Uses the existing findBestAoECluster() from src/ai/actions.ts — no
 * duplication. Reuses the spell's own radius when known (Fireball 20ft,
 * Burning Hands 15ft cone), else 15ft default.
 *
 * Only boosts spells with the 'damage' or 'cc' tag. A Healing Word on a
 * cluster is not boosted (a different detector handles that).
 */
export function enemyClusterBias(
  ctx: SpellcastContext,
  bf: Battlefield,
  self: Combatant,
  spellTags: SpellTag[],
  spellRadiusFt: number,
): number {
  if (!spellTags.includes('damage') && !spellTags.includes('cc')) return 1.0;
  const cluster = findBestAoECluster(self, bf, spellRadiusFt, 2);
  if (!cluster) return 1.0;
  // 2 enemies → 1.6, 3 → 2.0, 4+ → 2.5 (capped).
  if (cluster.enemies.length >= 4) return 2.5;
  if (cluster.enemies.length === 3) return 2.0;
  return 1.6; // exactly 2
}
```

#### 4.3.2 `finisherBias` — target almost dead

User directive: **"'finisher bonus' to the weight system is a good idea"** but ranked BELOW enemyCluster.

```typescript
/**
 * Boost spells that can kill the target this turn. Lower magnitude than
 * enemyClusterBias (1.3 vs 2.5) per the user's explicit ranking.
 *
 * The existing finisherMultiplier() in monster_spellcasting.ts already
 * returns 1.3 when targetHP ≤ avgDmg × 1.5 — this detector is a thin
 * wrapper that makes the bonus apply to ALL spell tags (not just cantrips)
 * and exposes it as a bias for the composition layer.
 */
export function finisherBias(
  _ctx: SpellcastContext,
  _bf: Battlefield,
  _self: Combatant,
  target: Combatant,
  avgDmg: number,
): number {
  if (target.currentHP <= avgDmg * 1.5) return 1.3;
  return 1.0;
}
```

#### 4.3.3 `woundedAllyBias` — strong ally is bloodied

User directive: **"strong ally wounded → healing or defensive"**.

```typescript
/**
 * Boost healing/defending spells when a "strong" ally (maxHP ≥ threshold)
 * is bloodied (< 50% HP). "Strong" = high-impact ally worth saving
 * (frontliner, healer, nova-striker).
 *
 * Threshold: ally.maxHP ≥ 25 (proxy for "not a familiar or low-CR
 * summon"). Bloodied cutoff matches isBloodied() at 50%.
 *
 * Downed allies (isUnconscious && !isDead) trigger the max boost (2.5)
 * — reviving a downed PC is the highest-leverage heal in 5e.
 */
export function woundedAllyBias(
  ctx: SpellcastContext,
  bf: Battlefield,
  self: Combatant,
  spellTags: SpellTag[],
): number {
  if (!spellTags.includes('healing') && !spellTags.includes('defending')) return 1.0;

  const STRONG_ALLY_MIN_HP = 25;
  let bestBoost = 1.0;

  for (const ally of livingAlliesOf(self, bf)) {
    if (ally.id === self.id) continue;
    if (ally.maxHP < STRONG_ALLY_MIN_HP) continue;
    if (ally.isUnconscious && !ally.isDead) {
      bestBoost = Math.max(bestBoost, 2.5); // revive the downed
    } else if (ally.currentHP < ally.maxHP * 0.5) {
      bestBoost = Math.max(bestBoost, 1.8); // heal the bloodied
    }
  }
  return bestBoost;
}
```

#### 4.3.4 `acVsSaveBias` — attack-roll vs save targeting

User directive: **"a creature has AC 12 but a saving throw of 20: targeting 12 is much better choice (although spells that still do 1/2 damage regardless of save pass would put something like fireball as favored)"**.

```typescript
/**
 * Compare the spell's targeting axis (attack-roll vs save) to the target's
 * weakest defense. Two sub-cases per the user's directive:
 *
 *  (a) Attack-roll spell vs low-AC target → boost. If spell is attack-roll
 *      and target.ac is low (≤ 14) AND target's relevant save is high
 *      (≥ +5), boost ×1.4. The hit is reliable; the save would fail.
 *
 *  (b) Save spell that deals HALF on success (Fireball, Burning Hands,
 *      many AoE) vs high-save target → STILL favored (not penalised)
 *      because half damage is guaranteed. Boost ×1.1 ("still decent").
 *      Pure save-or-suck (Hold Person, Banishment) vs high-save target
 *      → PENALISE ×0.6 (will likely waste the slot).
 *
 * Phase 1 simplification: target save bonus is approximated from the
 * ability modifier (no proficiency tracking). Phase 2 adds the full
 * savingThrows map (see §3.6).
 */
export function acVsSaveBias(
  _ctx: SpellcastContext,
  _bf: Battlefield,
  _self: Combatant,
  target: Combatant,
  spell: { attackRoll: boolean; saveAbility?: AbilityScore; dealsHalfOnSave?: boolean },
): number {
  // (a) Attack-roll spell vs low-AC / high-save target
  if (spell.attackRoll) {
    if (target.ac <= 14) {
      const saveBonus = spell.saveAbility
        ? abilityMod(target[spell.saveAbility])
        : 0;
      if (saveBonus >= 5) return 1.4;
      return 1.2; // low AC alone is still good
    }
    if (target.ac >= 19) return 0.7; // hard to hit
    return 1.0;
  }
  // (b) Save spell
  if (spell.saveAbility) {
    const saveBonus = abilityMod(target[spell.saveAbility]);
    if (saveBonus >= 5) {
      // High save: penalise save-or-suck, but NOT half-on-save.
      return spell.dealsHalfOnSave ? 1.1 : 0.6;
    }
    if (saveBonus <= 0) return 1.3; // easy save target — boost
    return 1.0;
  }
  return 1.0;
}
```

#### 4.3.5 `concentrationPreservationBias` — don't churn concentration

User directive: **"'Preserving concentration' is generally a good idea, so it should get some 'bias bonus'. Consider situations where dropping bless to cast hold person would be better than enjoying the benefits of the first spell, and add bias to those situations. It is not a good idea to cast a concentration spell just to change again next round unless a new situation really merits this.**"

This is the most complex detector — see **§5 (Concentration Churn Prevention)** for the full decision matrix and churn-tracking state.

```typescript
/**
 * Penalise casting a concentration spell when already concentrating —
 * UNLESS the new spell is significantly higher-value than the current
 * concentration spell (situation-merits-swap override).
 *
 * Returns 0.0 (veto) for churn-within-2-turns swaps that aren't
 * overridden; 0.5 for mild churn; 1.0 for neutral (not concentrating,
 * or candidate isn't concentration); never exceeds 1.0.
 */
export function concentrationPreservationBias(
  ctx: SpellcastContext,
  _bf: Battlefield,
  self: Combatant,
  candidateIsConcentration: boolean,
  candidateValueEstimate: number, // rough power estimate of the new spell
): number {
  if (!candidateIsConcentration) return 1.0;
  if (!self.concentration?.active) return 1.0;

  // Currently concentrating. Compare new spell's value to the existing one.
  const currentValue = estimateConcentrationValue(self.concentration.spellName, ctx);
  const swapMerit = candidateValueEstimate - currentValue;

  // Churn penalty: scales with how recently we last swapped.
  const turnsSinceSwap = ctx.round - (self._lastConcentrationSwapTurn ?? -10);
  let churnPenalty = 1.0;
  if (turnsSinceSwap <= 1) churnPenalty = 0.0;  // swapped last turn — hard veto
  else if (turnsSinceSwap <= 2) churnPenalty = 0.5;
  else if (turnsSinceSwap <= 3) churnPenalty = 0.8;

  // High-value situation overrides churn.
  if (swapMerit >= 3.0) return 1.0; // clearly better — ignore churn
  if (swapMerit >= 1.5) return Math.max(churnPenalty, 0.7); // somewhat better
  // Not better — apply churn penalty.
  return churnPenalty;
}
```

`estimateConcentrationValue(spellName, ctx)` is a small lookup table: `Bless` = 2.0 (×N allies), `Hold Person` = 4.0 vs single target (paralyzed = autocrit), `Hold Person` = 6.0 if 2+ enemies can be paralyzed (the "enemy cluster for Hold Person > current Bless value" case the user mentioned), `Haste` = 3.0, `Barkskin` = 1.0, etc. Phase 1 ships a 12-entry table for the most common monster concentration spells; Phase 3 extends.

#### 4.3.6 `kitingBias` — ranged self vs melee enemy

User directive: **"use range to tactically defeat an enemy that has lesser or no ranged options"**.

```typescript
/**
 * Boost mobility/ranged spells when self is a ranged caster and the
 * nearest enemies are melee-only (no ranged actions) and slower than
 * self. Encourages Dimension Door / Misty Step / Longstrider to maintain
 * distance and pick enemies apart.
 *
 * Detection:
 *   - self has any ranged/spell/save action (ranged-capable)
 *   - no enemy adjacent (we have distance to keep)
 *   - majority of enemies have only melee actions
 *   - majority of enemies have speed ≤ self.speed (can't catch us)
 *
 * Boost applies to spells with the 'defending' tag (Misty Step, Blink)
 * or movement-utility effects. Pure damage spells are NOT boosted here
 * (enemyClusterBias handles them).
 */
export function kitingBias(
  ctx: SpellcastContext,
  bf: Battlefield,
  self: Combatant,
  spellTags: SpellTag[],
): number {
  if (!spellTags.includes('defending')) return 1.0;
  if (ctx.nearestEnemyDistFt <= 10) return 1.0; // too close — kiting isn't safe

  const selfIsRanged = self.actions.some(
    a => a.attackType === 'ranged' || a.attackType === 'spell' || a.attackType === 'save'
  );
  if (!selfIsRanged) return 1.0;

  const enemies = livingEnemiesOf(self, bf);
  if (enemies.length === 0) return 1.0;
  const meleeOnlyCount = enemies.filter(
    e => !e.actions.some(a => a.attackType === 'ranged' || a.attackType === 'spell')
  ).length;
  const slowerCount = enemies.filter(e => e.speed <= self.speed).length;

  if (meleeOnlyCount / enemies.length >= 0.5
      && slowerCount / enemies.length >= 0.5) {
    return 1.8; // kite opportunity
  }
  return 1.0;
}
```

#### 4.3.7 `defensiveEscapeBias` — self HP critical

User directive: **"Teleportation and dimension door or similar spells should be used either defensively (to get distance and heal or buff w/o danger)"**.

```typescript
/**
 * Boost teleport/escape spells when self HP < 30% AND an adjacent enemy
 * threatens. Encourages Misty Step / Dimension Door / Thunder Step to
 * break engagement and reach a safe square.
 *
 * Stacks with woundedAllyBias (different tag) and with kitingBias (both
 * boost defending spells). The composition cap [0.1, 10.0] keeps the
 * combined multiplier bounded.
 */
export function defensiveEscapeBias(
  ctx: SpellcastContext,
  bf: Battlefield,
  self: Combatant,
  spellTags: SpellTag[],
): number {
  if (!spellTags.includes('defending')) return 1.0;
  if (ctx.selfHPct >= 0.30) return 1.0;
  const adj = adjacentEnemyCount(self, bf);
  if (adj === 0) return 1.0;
  return adj >= 2 ? 2.5 : 1.8;
}
```

#### 4.3.8 `resourceAllOutBias` — monsters go all out

User directive: **"The monster side should never care about saving resources; they want to go all out vs the 'player side' since monster side long rest, short rest and retreat are out of scope. Monster parties are always assumed to be 'rested' and full on their resources when they spawn."**

```typescript
/**
 * Monsters: NEVER penalise daily-use or high-slot spells for conservation.
 * The user directive is explicit — monsters go all out, fights are to the
 * death, monster parties are always rested on spawn. So this bias returns
 * 1.0 for monsters (no penalty, no bonus — the spell is just "available").
 *
 * PCs: a mild conservation factor for high-slot spells when many slots
 * remain unused (long-rest scarcity model). Encourages low-slot solutions
 * when the fight is "easy" (low enemy CR sum vs party level). NOT applied
 * in Phase 1 (PCs use the existing generic-spell loop, unchanged).
 *
 * Implementation: returns 1.0 for 'enemy' faction always. Phase 5 adds
 * the PC conservation factor.
 */
export function resourceAllOutBias(
  _ctx: SpellcastContext,
  _bf: Battlefield,
  self: Combatant,
  spellLevel: number,
): number {
  if (self.faction === 'enemy') return 1.0; // all-out — no penalty
  // Phase 5 (PC conservation): return < 1.0 for high-slot spells in easy fights.
  return 1.0;
}
```

### 4.4 Priority Ordering (Veto vs Nudge)

Per the user's directives, the biases have a strict priority ordering for **tie-breaking and veto resolution**:

| Rank | Bias | Type | Notes |
|------|------|------|-------|
| 1 | `enemyClusterBias` | nudge (≤2.5) | HIGHEST per user — outranks finisher |
| 2 | `finisherBias` | nudge (≤1.3) | Lower than cluster per user |
| 3 | `woundedAllyBias` | nudge (≤2.5) | Downed ally boost = max |
| 4 | `acVsSaveBias` | nudge (0.6–1.4) | Penalty axis too |
| 5 | `concentrationPreservationBias` | **veto-capable** (0.0) | Hard-stops churn |
| 6 | `kitingBias` | nudge (≤1.8) | Requires ranged self |
| 7 | `defensiveEscapeBias` | nudge (≤2.5) | Stacks with kiting |
| 8 | `resourceAllOutBias` | neutral (1.0) for monsters | Phase 5: PC conservation |

**Veto vs nudge semantics:**

- **Nudge**: a multiplier in `[0.5, 3.0]`. Compounds with other nudges. Never zeroes a weight alone.
- **Veto-capable**: can return `0.0` to force the candidate's weight to exactly `0` (the composition short-circuits on the first `0.0`). Only `concentrationPreservationBias` is veto-capable in this design.

The ordering is for **documentation and tie-breaking only** — the composition formula multiplies all biases together, so the order of multiplication doesn't affect the result. The ordering matters for two cases:

1. **Logging**: when we emit "why did the AI pick spell X?", the biases are listed in priority order so a human reader sees the most important factor first.
2. **Override resolution** (concentration): the `concentrationPreservationBias` decides whether a "high-value situation" override applies by comparing the candidate's value estimate to the current concentration spell's value — see §5.

---

## 5. Concentration Churn Prevention

The user's most stringent directive: **"It is not a good idea to cast a concentration spell just to change again next round unless a new situation really merits this. You need to be robust on the research, planning and design of this."**

### 5.1 The Churn Problem

A naive weighted system will swap concentration every turn: round 1 cast Bless (×1.2 buff bonus), round 2 see an enemy cluster → cast Hold Person (×2.0 cc bonus + ×1.6 cluster bonus = ×3.2 vs Bless's ×1.2), round 3 see a wounded ally → cast Bless again (×2.5 wounded-ally bonus). Net result: the caster never benefits from any concentration spell because each is dropped before its effect ticks.

### 5.2 The Two-Mechanism Solution

**Mechanism A — Churn penalty (default behavior):**

Track the round on which the caster last dropped a concentration spell to cast a new one, in a scratch field `_lastConcentrationSwapTurn: number | undefined`. The `concentrationPreservationBias` detector reads this and penalises re-swaps within a decay window:

| Turns since last swap | Penalty multiplier | Rationale |
|-----------------------|--------------------|-----------|
| 0 (same turn — n/a) | n/a | can't double-cast in one turn |
| 1 (swapped last turn) | **0.0 (veto)** | hard stop — never churn two turns running |
| 2 | 0.5 | heavy penalty — let the new spell work one round |
| 3 | 0.8 | mild penalty |
| 4+ | 1.0 | full neutral — churn cost expired |

The penalty **decays** over 3 turns, so a caster who held Bless for 3 rounds then swapped to Hold Person pays no penalty on round 5 if a wounded ally needs Healing Word concentration.

**Mechanism B — Situation-merits override:**

The penalty is **bypassed** when the new concentration spell is **significantly more valuable** than the current one. The `concentrationPreservationBias` compares `candidateValueEstimate` to `estimateConcentrationValue(currentSpellName, ctx)` and overrides the churn penalty if the gap is large enough.

### 5.3 Concentration Value Decision Matrix

`estimateConcentrationValue(spellName, ctx)` returns a rough "power score" (1–10 scale) for the currently-held concentration spell in the current context. Higher = more worth keeping.

| Current Spell | Single-target context | Multi-enemy (3+) context | Wounded ally context | Enemy cluster context |
|---------------|------------------------|--------------------------|----------------------|------------------------|
| Bless | 2.0 (×N allies) | 3.0 | 2.5 | 2.0 |
| Bane | 2.0 | 3.5 | 1.5 | 3.5 |
| Hold Person | 4.0 (paralyzed) | 5.0 (2 targets @ L3) | 2.0 | **6.0** (user example) |
| Hold Monster | 4.5 | 4.5 | 2.0 | 4.5 |
| Haste | 3.5 (×1 ally) | 3.5 | 3.0 | 2.5 |
| Barkskin | 1.5 (self only) | 1.5 | 1.0 | 1.0 |
| Blur | 2.0 (self) | 2.0 | 1.5 | 1.5 |
| Web | 2.5 | 4.5 | 1.5 | 4.5 |
| Spirit Guardians | 3.5 | 5.5 | 2.0 | 5.5 |
| Hunger of Hadar | 2.5 | 5.0 | 1.5 | 5.0 |
| Suggestion | 2.5 | 1.5 | 1.0 | 1.5 |
| Hex | 2.5 (1 target) | 2.0 | 1.5 | 2.0 |
| *(unknown)* | 1.5 (floor) | 1.5 | 1.5 | 1.5 |

**Override thresholds** (in `concentrationPreservationBias`):

| `candidateValue − currentValue` | Behaviour | Example |
|----------------------------------|-----------|---------|
| `≥ 3.0` | **Override** churn penalty → bias = 1.0 | Hold Person (6.0) over Bless (2.0) when enemy cluster — user's exact example |
| `1.5 – 2.9` | **Partial override** → bias = max(churnPenalty, 0.7) | Spirit Guardians (3.5) over Barkskin (1.5) |
| `0 – 1.4` | Apply churn penalty | Swapping one buff for a marginally better one — penalise |
| `< 0` (candidate worse) | Apply churn penalty (full) | Don't downgrade concentration |

### 5.4 Worked Example: Bless → Hold Person → Healing Word

Round 1: Cleric casts **Bless** (3 allies). `_lastConcentrationSwapTurn = 1`.
Round 2: Three enemies cluster. Hold Person candidate. `estimateConcentrationValue('Hold Person', cluster-ctx) = 6.0`. `currentValue = estimateConcentrationValue('Bless', cluster-ctx) = 2.0`. `swapMerit = 4.0 ≥ 3.0` → **override** → bias = 1.0. Cleric swaps to Hold Person. `_lastConcentrationSwapTurn = 2`.
Round 3: Strong ally (Fighter, 30 maxHP) is now bloodied at 12 HP. Healing Word (concentration? — no, Healing Word is NOT concentration in 5e; bad example). Use **Cure Wounds** (also not concentration). Let's pick **Aid** (concentration? — no, Aid is non-concentration). Pick a real concentration heal: **Aura of Vitality** (concentration, heals 2d6/round as a bonus action).

Round 3 (revised): Aura of Vitality candidate. `candidateValue` ≈ 3.0 (wounded-ally context). `currentValue = estimateConcentrationValue('Hold Person', wounded-ally-ctx) = 2.0`. `swapMerit = 1.0` → no override → churn penalty applies. `turnsSinceSwap = 1` → penalty = **0.0 (veto)**. Cleric keeps Hold Person; uses a non-concentration action (Cure Wounds at touch, or a cantrip).
Round 4: Same situation. `turnsSinceSwap = 2` → penalty = 0.5. Aura of Vitality weight is halved — might still lose to a cantrip that finishes a held enemy. Cleric probably keeps Hold Person.
Round 5: `turnsSinceSwap = 3` → penalty = 0.8. If the ally is still bloodied, Aura of Vitality might now win. Or the Cleric drops Hold Person (combat may have ended) and casts Aura.

**This is the behavior the user asked for**: concentration is preserved across turns, swaps happen only when the situation clearly merits it, and the churn penalty expires after 3 turns.

### 5.5 Scratch Field

A single new optional field on `Combatant`:

```typescript
// In src/types/core.ts, Combatant interface:
// ── Session 63 RFC-PATTERN-BIAS-AI: concentration churn tracking ──
// Set to `bf.round` whenever the caster drops one concentration spell to
// cast another. Read by concentrationPreservationBias() to penalise
// repeated swaps within 3 turns. Optional — undefined = "never swapped"
// (treated as fully decayed).
_lastConcentrationSwapTurn?: number;
```

Initialized to `undefined` (or `-10`) on combat start. Set in `startConcentration()` (or a small wrapper) whenever the caster was already concentrating and starts a new concentration spell.

---

## 6. Monster vs PC Strategy Split

Per the user's directive, the two factions play by different resource strategies.

### 6.1 Monsters (faction === 'enemy')

- **All-out, no conservation.** Daily-use spells (`monsterDailyUses`) get **no penalty** from `resourceAllOutBias` — it returns 1.0 unconditionally for enemies.
- **Always rested on spawn.** `monsterSpellSlots` and `monsterDailyUses` are initialized to `max` at combat start (Phase 2/3 of `RFC-MONSTER-SPELLCASTING.md`). No "monsters short-rest between encounters" logic — every monster party spawns at full resources.
- **Fights to the death.** No retreat, no social interaction, no negotiation. The `selfPreserveDecision()` in `actions.ts` (which can return 'retreat') is overridden for monsters — they may `dodge` (defensive posture) but never `retreat`.
- **Teleport use:** Dimension Door, Misty Step, Thunder Step, Far Step used in two modes:
  - **Defensive escape**: `defensiveEscapeBias` boosts when HP < 30% + adjacent enemies. Self-targeted, lands 30–60ft from the front line, then heal/buff next turn.
  - **Offensive kiting**: `kitingBias` boosts when self is ranged-capable + enemies are melee-only + slower. Teleport maintains distance; cantrips/slots pick the enemy apart.

### 6.2 PCs (faction === 'party')

- **Play to win but conserve.** Long-rest scarcity model — a party doesn't know how many encounters the adventuring day holds. The existing PC planner (generic-spell loop + bespoke branches) is **unchanged**.
- **Phase 5 (optional, low priority):** add a mild `resourceAllOutBias` for PCs that penalises high-slot spells when the fight is "easy" (low enemy CR sum vs party level). Tunable; default-off.

### 6.3 Faction Dispatch

The pattern detectors themselves are faction-agnostic (they read `self.faction` where relevant). The split is enforced inside `resourceAllOutBias` and via the planner branch:

```typescript
// In selectMonsterSpell (Phase 2+), the resource strategy is encoded by
// resourceAllOutBias returning 1.0 for enemies. For PCs, the existing
// planner branches (shouldCastBless, shouldCastHex, etc.) are unchanged —
// they don't call computeSpellWeight() at all today.
//
// Phase 2 of THIS RFC unifies both sides: a selectSpell() entry point
// that branches on faction and calls computeSpellWeight() with the
// faction-appropriate bias set. Phase 1 (this RFC) only extends the
// monster path; the PC path follows in Phase 5.
```

### 6.4 Neutral Faction

`faction === 'neutral'` combatants (rare — summoned creatures that haven't picked a side, mind-controlled targets) default to the **monster strategy** (all-out) for safety — they have no long-rest scarcity model. Phase 1 doesn't special-case neutrals.

---

## 7. Implementation Plan (Phased)

### Phase 1: Pattern Detectors + Composition (LOW risk)

**Scope:** Add the 8 pattern detectors as pure functions in a new file `src/ai/pattern_bias.ts`. Extend `computeSpellWeight()` with an optional `biases: number[] = []` parameter (default empty → backward-compatible). Wire the detectors into `selectMonsterSpell()` so cantrip selection now uses the composition formula.

**No new types.** No new fields on `Combatant`. No new engine entry points. Phase 1 only affects the 17 cantrip candidates — slotted + daily spells are still Phase 2/3 of the parent RFC.

**Deliverables:**
- `src/ai/pattern_bias.ts` — all 8 detectors + `composeBiases()` + `estimateConcentrationValue()` (12-entry table).
- `monster_spellcasting.ts::computeSpellWeight()` — extended signature.
- `monster_spellcasting.ts::selectMonsterSpell()` — calls detectors, passes biases.
- Tests: `src/test/pattern_bias.test.ts` — 12+ cases (see §10).

### Phase 2: AC-vs-Save Targeting (MEDIUM risk)

**Scope:** Add `Combatant.savingThrows?: Partial<Record<AbilityScore, number>>` populated from the 5etools `save` field (parser change). Update `acVsSaveBias()` to use the real save bonus instead of the ability-mod proxy. Wire the parser (`src/parser/fivetools.ts` or equivalent) to populate the field.

**Risk:** Parser changes can cascade — every monster's combatant factory call. Mitigation: optional field, falls back to ability mod when undefined.

### Phase 3: Concentration Churn Tracking (MEDIUM risk)

**Scope:** Add `Combatant._lastConcentrationSwapTurn?: number` scratch field. Update `startConcentration()` in `src/engine/utils.ts` to set the field when the caster was already concentrating. `concentrationPreservationBias()` already reads it (Phase 1 stub returns 1.0 when undefined = "treat as fully decayed").

**Risk:** Every code path that calls `startConcentration()` is touched. Mitigation: the field is optional; the bias gracefully treats `undefined` as "no penalty."

### Phase 4: Kiting + Defensive Escape (MEDIUM risk)

**Scope:** Wire `kitingBias()` and `defensiveEscapeBias()` into the planner's movement + spell-selection logic. Requires:
- A movement-range analysis helper (does the teleport destination escape the threat radius?).
- A "is enemy melee-only?" predicate (already derivable from `enemy.actions`).
- A "is enemy slower than self?" predicate (compares `enemy.speed` to `self.speed`).

**Risk:** Touches the movement planner. Mitigation: Phase 4 detectors are gated on `spellTags.includes('defending')` — only Misty Step, Blink, etc. are affected; cantrip selection (Phase 1) is untouched.

### Phase 5: PC Conservation Factor (LOW risk, OPTIONAL)

**Scope:** Extend `resourceAllOutBias()` for PCs to return < 1.0 for high-slot spells when the fight is "easy." Requires:
- A fight-difficulty estimator (sum of enemy CRs vs sum of party levels).
- A "slot scarcity" heuristic (remaining slots / max slots per level).

**Risk:** Could regress PC spell selection. Mitigation: default-off (config flag), only enable once tuned.

---

## 8. Files to Touch

| File | Change | Phase |
|------|--------|-------|
| `src/ai/pattern_bias.ts` (NEW) | 8 pattern detectors + `composeBiases()` + `estimateConcentrationValue()` + 12-entry concentration value table | 1 |
| `src/ai/monster_spellcasting.ts` | Extend `computeSpellWeight()` with `biases?: number[]` parameter; `selectMonsterSpell()` calls detectors; add `SpellcastContext._lastConcentrationSwapTurn` read | 1 |
| `src/types/core.ts` | Add `savingThrows?: Partial<Record<AbilityScore, number>>` to `Combatant` | 2 |
| `src/parser/fivetools.ts` (or equivalent) | Populate `savingThrows` from 5etools `save` field | 2 |
| `src/types/core.ts` | Add `_lastConcentrationSwapTurn?: number` scratch field to `Combatant` | 3 |
| `src/engine/utils.ts` | `startConcentration()` sets `_lastConcentrationSwapTurn` when caster was already concentrating | 3 |
| `src/ai/planner.ts` | Wire `kitingBias` + `defensiveEscapeBias` into the planner's movement/spell-selection logic (Phase 4 only) | 4 |
| `src/ai/pattern_bias.ts` | Extend `resourceAllOutBias()` for PCs (Phase 5) | 5 |
| `src/test/pattern_bias.test.ts` (NEW) | 12+ test cases — see §10 | 1–3 |

---

## 9. Backward Compatibility

- **Existing Phase 1 cantrip selection continues to work.** The `biases` parameter on `computeSpellWeight()` defaults to `[]`, so callers that don't pass it get the same behavior as today (composition of an empty array = 1.0).
- **Biases are additive multipliers (default 1.0).** A detector that doesn't fire returns `1.0` — neutral, no effect on the weight.
- **No new required types.** `savingThrows` and `_lastConcentrationSwapTurn` are both optional. Existing combatants (test factories, hand-built encounters) work without them.
- **PC spellcasting path is unchanged** through Phase 4. The generic-spell loop, bespoke spell branches, and `shouldCast*` helpers in `resources.ts` are not touched. Phase 5 (PC conservation) is optional and default-off.
- **Concentration churn tracking degrades gracefully.** If `_lastConcentrationSwapTurn` is `undefined`, the `concentrationPreservationBias` treats it as `turnsSinceSwap = Infinity` — no penalty. Existing tests that don't set the field get the legacy "always allow swap" behavior.
- **Monster all-out strategy is the default for `faction === 'enemy'`.** No config flag needed. PCs default to the unchanged existing behavior; Phase 5 introduces the conservation factor behind a flag.

---

## 10. Test Plan

### Phase 1 Tests (`src/test/pattern_bias.test.ts`)

1. **`enemyClusterBias` returns 1.6 with exactly 2 enemies in a 20ft Fireball radius** — set up 2 goblins 10ft apart, assert bias = 1.6 for a Fireball candidate.
2. **`enemyClusterBias` returns 2.5 with 4+ enemies clustered** — 4 goblins in a 15ft square, assert bias = 2.5.
3. **`enemyClusterBias` returns 1.0 when no cluster exists** — 2 enemies 60ft apart, assert bias = 1.0.
4. **`enemyClusterBias` returns 1.0 for a healing spell even when enemies are clustered** — assert non-damage/cc tags don't get the boost.
5. **`finisherBias` returns 1.3 when target HP ≤ avgDmg × 1.5** — target at 6 HP, Fire Bolt avg 5 → bias 1.3.
6. **`finisherBias` returns 1.0 when target HP > avgDmg × 1.5** — target at 30 HP → bias 1.0.
7. **`enemyClusterBias` outranks `finisherBias` in composition** — set up both patterns, assert the cluster-weighted spell wins. (3 enemies clustered + a separate low-HP target: Fireball weight > Ray of Frost weight even though Ray of Frost gets the finisher bonus.)
8. **`woundedAllyBias` returns 2.5 for a downed strong ally** — Fighter (maxHP 30) at 0 HP unconscious → healing spell bias = 2.5.
9. **`woundedAllyBias` returns 1.0 for a downed weak ally** — familiar (maxHP 10) downed → no boost (below threshold).
10. **`acVsSaveBias` returns 1.4 for attack-roll spell vs AC 12 + high-save target** — target AC 12, CON 20 (+5), cantrip Fire Bolt → bias 1.4.
11. **`acVsSaveBias` returns 0.6 for save-or-suck vs high-save target** — Hold Person vs target WIS 20 → bias 0.6.
12. **`acVsSaveBias` returns 1.1 for Fireball (half-on-save) vs high-save target** — Fireball vs target DEX 20 → bias 1.1 (still favored).
13. **`concentrationPreservationBias` returns 0.0 for churn within 1 turn** — caster swapped last turn, candidate is concentration, no override → bias 0.0 (veto).
14. **`concentrationPreservationBias` returns 1.0 for high-value override** — caster on Bless, candidate Hold Person, enemy cluster present (swapMerit ≥ 3.0) → bias 1.0 (override).
15. **`resourceAllOutBias` returns 1.0 for monster faction** — assert no penalty regardless of spell level.
16. **Composition: veto wins** — pass `[1.5, 0.0, 2.0]` to `composeBiases` → returns 0.
17. **Composition: clamps to 10.0** — pass `[3.0, 3.0, 3.0, 3.0]` (product 81) → returns 10.0.
18. **Composition: clamps to 0.1** — pass `[0.5, 0.5, 0.5, 0.5, 0.5]` (product 0.03) → returns 0.1.
19. **Integration: `selectMonsterSpell` picks Fireball-weighted cantrip equivalent over single-target when 3 enemies cluster** — Phase 1 only has cantrips, but Acid Splash (multi-target cantrip) should win over Fire Bolt when 2 enemies are within 5ft of each other.
20. **Integration: monster all-out uses a daily-use spell immediately when it's the highest-weighted** — Phase 3 mock: stub `monsterDailyUses`, assert the daily spell is selected on round 1 (no conservation penalty).

### Phase 2 Tests

21. **`acVsSaveBias` uses real `savingThrows` map when present** — target with `savingThrows: { dex: 8 }` and DEX 14 (+2): bias uses +8, not +2.
22. **Falls back to ability mod when `savingThrows` is undefined** — backward-compat for combatants built before the parser change.

### Phase 3 Tests

23. **`startConcentration` sets `_lastConcentrationSwapTurn` when already concentrating** — cast Bless round 1, cast Hold Person round 2 → field set to 2.
24. **`concentrationPreservationBias` reads `_lastConcentrationSwapTurn` correctly** — set field to `bf.round - 1`, assert veto on a non-overridden swap.
25. **Churn penalty decays after 3 turns** — set field to `bf.round - 4`, assert bias returns to 1.0 for a non-overridden swap.

### Phase 4 Tests

26. **`kitingBias` returns 1.8 for ranged self vs melee-only slower enemies at distance** — Lich (ranged cantrips) vs 2 melee-only Ogres (speed 30, Lich speed 30 — equal, qualifies), 40ft apart → bias 1.8 for Misty Step.
27. **`defensiveEscapeBias` returns 2.5 when HP < 30% + 2 adjacent enemies** — assert Misty Step weight is boosted.
28. **`defensiveEscapeBias` returns 1.0 when HP > 30%** — no false boost.

---

## 11. Open Questions

1. **Exact bias multiplier values.** The values in this RFC (1.3, 1.6, 2.0, 2.5, etc.) are initial proposals based on the user's priority directives and 5e optimisation heuristics. Tuning requires playtesting: set up a battery of 50+ encounters and measure win-rates against the existing Phase 1 baseline. Defer exact tuning to a follow-up "bias-tuning" task once Phase 1 is merged.

2. **MCTS for high-CR boss monsters.** A future RFC could dispatch legendary creatures (Lich, Ancient Dragon, Tarrasque) to an MCTS-based planner that simulates 2–3 rounds of rollout, while leaving the utility-AI pattern-bias system for the rank-and-file. This would give bosses "look-ahead" without imposing MCTS cost on every goblin. Out of scope for this RFC; flagged for Session 64+ consideration.

3. **Concentration value table completeness.** The 12-entry `estimateConcentrationValue` table covers the most common monster concentration spells (Bless, Bane, Hold Person, Hold Monster, Haste, Barkskin, Blur, Web, Spirit Guardians, Hunger of Hadar, Suggestion, Hex). Phase 3 expands to ~40 spells. Question: should unknown spells default to a floor of 1.5 (conservative — encourage keeping them) or a midpoint of 3.0 (permissive — encourage swapping)? This RFC proposes 1.5 (conservative, matches the "preserve concentration" directive); revisit if playtesting shows monsters hold weak spells too long.

---

## 12. References

- **DMG p.252** — "Combining Game Effects" (related; see `RFC-COMBINING-EFFECTS.md`).
- **PHB Ch.10** — "Combining Magical Effects" (concentration stacking rules).
- **PHB p.196** — Opportunity attacks (kiting relevance).
- **PHB p.201** — Cantrip damage scaling (already in `cantripDiceCount()`).
- **PHB p.203** — Concentration (one spell at a time, break on damage).
- **PHB p.290–292** — Conditions (paralyzed, restrained, stunned — concentration targets).
- **MM p.10–11** — Monster Spellcasting, At-Will, N/day features.
- **XGE p.5** — "Combining Game Effects" sidebar (priority order).
- **Mark, D.** — *Behavioral Mathematics for Game AI* (2009, utility AI theory).
- **Champandard, A.** — *Behavior Trees for AI* (Gamasutra, 2008 — behavior trees).
- **Buckland, M.** — *Programming Game AI by Example* (FSM chapter).
- **Browne, C. et al.** — *A Survey of Monte Carlo Tree Search Methods* (2012, MCTS).
- **F.E.A.R. GDC 2006 talk** (Orkin) — utility-AI scoring in commercial shooters.
- **D&D 5e optimisation community** (rpgbot.net, Tabletop Builds, RPGBOT podcast) — action economy, concentration preservation, target prioritisation, save-vs-AC targeting, AoE clustering, nova rounds, kiting.
- Existing codebase: `src/ai/monster_spellcasting.ts` (Phase 1 scorer), `src/ai/actions.ts::findBestAoECluster`, `src/ai/targeting.ts::smartScore`, `src/ai/resources.ts` (slot helpers), `src/engine/movement.ts` (distance helpers), `src/types/core.ts` (Combatant / Action / concentration / faction).
- Parent RFC: `docs/RFC-MONSTER-SPELLCASTING.md` §9.2 (user's pattern-bias directive).
