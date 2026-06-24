# RFC: Combining Game Effects — Same-Name Dedup + Source Tracking in the Active-Effects Pipeline

**Date:** Session 63
**Author:** Z.ai
**Status:** PROPOSED (user directed: implement DMG p.252 "Combining Game Effects" + PHB Ch.10 "Combining Magical Effects" + XGE priority rules in the active-effects pipeline)
**Risk:** MEDIUM-HIGH — touches every ActiveEffect consumer (getActiveBlessDie, getActiveDamageZones, condition_apply cleanup, etc.) and re-architects how `combatant.conditions` is populated for spell-sourced conditions
**Depends on:** existing ActiveEffect pipeline (`src/engine/spell_effects.ts`), Session 62 vision subsystem (`src/engine/perception.ts`), Session 63 `Obstacle.isMagicalDarkness` + `senses.devilsSight` flags in `src/types/core.ts`

---

## 1. Goal

Implement the DMG p.252 "Combining Game Effects" rule and the related PHB Ch.10 "Combining Magical Effects" rule in the engine's active-effects pipeline. Per the user's directive:

> "when there are 2 active effects with the same name, example blindness (from blindness spell) and blindness (from being inside the Darkness spell: 'Creatures inside are effectively blinded,') should both be considered in the active effects pipeline, but only the strongest takes effect. each item in the active effects pipeline should have an originating source if that source ending would make that effect end as well. After the duration expires from the strongest source, the next strongest with the highest still active duration takes over."

The pipeline must:

1. **Detect overlapping same-name effects** (two `blinded` from different sources, two Spirit Guardians auras from different clerics, two Bless buffs from different casters).
2. **Suppress all but the most potent** while the durations overlap (DMG p.252 / PHB p.205).
3. **Take over** when the top effect expires — the next-highest-priority overlapping effect with remaining duration becomes the active one.
4. **Track the originating source** of each effect so that ending the source (concentration break, AoE expiry, caster death, dispel) ends its effects.
5. **Apply the priority order** specified by the user + XGE: **most powerful > longest duration > most recently cast/applied**.
6. **Not worsen conditions** when multiple instances impose them — *except Exhaustion*, which has levels (PHB p.291).
7. **Distinguish magical darkness that blocks darkvision from darkness that doesn't** — only the Darkness spell (and sources that explicitly say so) blocks darkvision; Devil's Sight penetrates magical darkness regardless (Session 63 already wired the flags; this RFC formalises the rule).

---

## 2. 5e Rules Research

### 2.1 DMG p.252 — "Combining Game Effects" (2014 DMG)

> "Different game features can affect a target at the same time. But when two or more game features have the same name, only the effects of one of them—the most potent one—apply while the durations of the effects overlap. For example, if a target is ignited by a fire elemental's Fire Form trait, the ongoing fire damage doesn't increase if the burning target is subjected to that trait again. Game features include spells, class features, feats, racial traits, monster abilities, and magic items. See the related rule in the Combining Magical Effects section of chapter 10 in the Player's Handbook."

**Reading**: "Game feature" is a broad category — it includes **everything** that can affect a target, not just spells. Two `blinded` conditions from different sources don't worsen; two Spirit Guardians auras don't double-tick; two Bless buffs don't give two d4s. The **most potent** single instance applies.

### 2.2 PHB Ch.10 — "Combining Magical Effects" (p.205)

> "The effects of different spells add together while the durations of the spells overlap. The effects of the same spell cast multiple times don't combine. Instead, the most potent effect—such as the highest bonus—from that casting applies while their durations overlap, or the most recent effect applies if the castings are equally potent and have the same durations.
>
> For example, if two clerics cast bless on the same target, that character gains the spell's benefit only once; he or she doesn't get to roll two bonus dice."

**Reading**: **Different spells stack** (Bless + Bane both apply; Bless + Bardic Inspiration both apply). **Same spell from different casters does NOT stack** — the most potent applies, or the most recent if equally potent. The PHB example is literally the Bless case.

### 2.3 XGE — Priority Details (XGE p.5 "Combining Game Effects" sidebar)

The XGE sidebar formalises the **tie-break order** the user specified:

1. **Most powerful** — e.g. for damage auras: higher damage die / higher damage roll; for conditions: higher save DC; for buffs: higher bonus.
2. **Longest duration** — if potency is equal, the one with the longest remaining duration wins.
3. **Most recently cast/applied** — final tie-breaker; if both above are equal, the latest-applied wins (the older one is suppressed).

### 2.4 Conditions — "Do Not Stack" Except Exhaustion

The PHB Condition descriptions (PHB p.290–292) carry the implicit "multiple instances don't worsen" rule: a creature is either blinded or not, either poisoned or not, etc. The single explicit exception is **Exhaustion** (PHB p.291), which is a 7-level graduated state — each application increments the level (capped at 6 = death).

In our type system, `combatant.conditions: Set<Condition>` already enforces "either-or" semantics (a Set is binary), and `combatant.exhaustionLevel: number` (0–6) is the graduated field — so the data model already aligns. The gap is *source tracking*: today, a `blinded` added by Blindness/Deafness is indistinguishable from a `blinded` caused by being inside a Darkness spell's AoE. When the Darkness spell ends, the `blinded` is NOT removed (because the cleanup is keyed on the spell, not on the condition's source).

### 2.5 Magical Darkness — Source-Specific Darkvision Blocking

Per the user: "magical darkness only blocks darkvision if the cause source explicitly says so (e.g. the spell Darkness). Other sources will allow darkvision to see."

- **Darkness spell** (PHB p.230): "A creature with darkvision can't see through this darkness" → blocks darkvision.
- **Natural darkness** (lightLevel: 'darkness'): darkvision sees (as dim light). Already handled in `isVisuallyDetected`.
- **Other sources of darkness**: must NOT block darkvision unless the source explicitly says so.

Session 63 already wired the data model:
- `Obstacle.isMagicalDarkness?: boolean` — set to `true` by the Darkness spell; absent for Fog Cloud.
- `senses.devilsSight?: boolean` — Devil's Sight (monster trait + Warlock invocation): "Magical darkness doesn't impede the devil's darkvision."

**Devil's Sight vs Darkvision** (PHB p.110, Warlock Eldritch Invocation): Devil's Sight is distinct from darkvision — it lets the creature see through **magical darkness** specifically. Normal darkvision cannot see through magical darkness. Devil's Sight requires darkvision to also be set (it extends, doesn't replace). The Darkness spell description doesn't say "blocks Devil's Sight" — so Devil's Sight penetrates Darkness. Other vision modes (Truesight, Blindsight) also bypass magical darkness because they bypass obscurement entirely.

---

## 3. Current State (What's Already There)

### 3.1 The `ActiveEffect` interface (`src/types/core.ts` line 158)

```typescript
export interface ActiveEffect {
  id: string;               // 'eff_1', 'eff_2', ...
  casterId: string;         // ID of the Combatant who cast the spell
  spellName: string;        // canonical spell name; also adv_system source label
  effectType: SpellEffectType;
  payload: { /* ~30 optional fields keyed off effectType */ };
  sourceIsConcentration: boolean;  // if true, removed when caster's conc ends
  breaksOnAttackOrCast?: boolean;
  sourceCreatureType?: string;
}
```

**Missing for this RFC**: no `effectName` (canonical identity shared across sources), no `sourceId` (originating spell instance / aura ID), no `sourceTurnExpires` (turn the source ends, for non-concentration sources), no `appliedTurn` (timestamp for "most recent" tiebreak).

### 3.2 The Pipeline (`src/engine/spell_effects.ts`)

- `applySpellEffect(target, def)` (line 53) — pushes onto `target.activeEffects`; for `condition_apply` it directly mutates `target.conditions.add(...)`.
- `removeEffectsFromCaster(casterId, bf)` (line 171) — sweeps the entire battlefield, removing every effect whose `casterId` matches; calls `_undoEffect` for each (which splices the condition back out of the Set).
- `removeEffectById(targetId, effectId, bf)` (line 233) — removes a single effect (used by dispel / one-shot expiries).
- `_undoEffect(target, effect)` (line 258) — handles structural cleanup per effectType (delete from `conditions` Set, remove obstacle, splice resistance, etc.).

**No same-name dedup anywhere**. Two `condition_apply` effects with `condition: 'blinded'` from different casters both push `'blinded'` into the Set; when one caster's concentration breaks, `removeEffectsFromCaster` deletes `'blinded'` from the Set **even if the other caster's effect is still active** — a bug under DMG p.252.

### 3.3 Query Helpers (already implement *ad-hoc* dedup at read-time)

The existing helpers do some dedup, but at **read-time, not write-time** — and they use different strategies:

| Helper | Strategy | Per DMG p.252? |
|--------|----------|----------------|
| `getActiveBlessDie` | `max(dieSides)` | Yes — most potent |
| `getActiveBaneDie` | `max(dieSides)` | Yes |
| `getActiveAcFloor` | `max(acFloor)` | Yes |
| `getActiveAcBonus` | **`sum(acBonus)`** | **NO** — two Shield of Faith would stack +4; should be +2 |
| `getActiveDamageZones` | returns **ALL** | **NO** — two Spirit Guardians both tick; should tick only the strongest |
| `getActiveWeaponEnchant` | **`sum(attackBonus, damageBonus)`** | **NO** — two Magic Weapon would stack +2; should be +1 |
| `getActiveCurseAttackDisadv` | returns ALL caster IDs | Yes — different casters' curses each apply (different-name effect per caster) |
| `getActiveHexDie` | filter by `casterId` | Yes — Hex is per-attacker, not per-target |

The pipeline needs to make this consistent.

### 3.4 Conditions (`src/engine/utils.ts` line 528)

```typescript
export function addCondition(target: Combatant, condition: Condition): void {
  // immunity checks (Nature's Ward, conditionImmunities, etc.)
  target.conditions.add(condition);
  // cascade: paralyzed/stunned/petrified → incapacitated
  // auto-break concentration on incapacitated
}
```

The `Set` is binary — adding `'blinded'` twice is idempotent for *presence*. But the source is **not tracked**: if Blindness/Deafness adds `'blinded'` and then the target walks into a Darkness spell's AoE (which should also impose `'blinded'`), and then the Darkness spell ends, `'blinded'` is wrongly removed because Darkness's cleanup blindly deletes it. The pipeline must know the Darkness-imposed `'blinded'` and the Blindness/Deafness-imposed `'blinded'` are two *separate effects* sharing the same condition name.

### 3.5 Exhaustion (`src/types/core.ts` line 1139, `spell_effects.ts` line 111)

`combatant.exhaustionLevel: number` (0–6) is a separate graduated field, **not** part of the `conditions` Set. `effectType: 'exhaustion_level'` increments it via `Math.min(6, level + amount)`. The `_undoEffect` for `exhaustion_level` is a **no-op** (PHB p.291: exhaustion persists until rest/spell removal, not dispel). This is already correct — exhaustion is its own thing.

### 3.6 Vision + Magical Darkness (Session 63)

- `Obstacle.isMagicalDarkness?: boolean` — set to `true` by the Darkness spell module (`src/spells/darkness.ts` line 259).
- `senses.devilsSight?: boolean` — added to the `Senses` interface this session.
- `isVisuallyDetected()` in `src/engine/perception.ts` — currently uses `hasLineOfSight`, which checks `obstacle.blocksVision` (true for both Fog Cloud and Darkness). This blocks **everyone** — darkvision is NOT yet consulted per-obstacle. The `blocksDarkvision` payload flag on the `battlefield_obstacle` effect is metadata-only.

This RFC doesn't change vision behaviour (that's RFC-VISION-AUDIO Phase 4), but it formalises the *rule* that the active-effects pipeline must surface to the vision layer.

---

## 4. Proposed Design

### 4.1 Effect Identity — `effectName`

Add a canonical `effectName` field to `ActiveEffect`, distinct from `spellName`:

```typescript
export interface ActiveEffect {
  // existing fields...
  id: string;
  casterId: string;
  spellName: string;
  effectType: SpellEffectType;
  payload: { /* ... */ };
  sourceIsConcentration: boolean;
  breaksOnAttackOrCast?: boolean;
  sourceCreatureType?: string;

  // ── RFC-COMBINING-EFFECTS (Session 63) ──
  /**
   * Canonical effect identity, used for same-name dedup per DMG p.252.
   * Two effects with the same `effectName` overlap; only the most potent
   * applies while their durations overlap.
   *
   * Distinct from `spellName` — two different spells can impose the same
   * effect (Blindness/Deafness spell + Darkness spell both → 'blinded';
   * Spirit Guardians from Cleric A + Spirit Guardians from Cleric B both
   * → 'spirit-guardians'). The pipeline groups by `effectName`.
   *
   * Lookup: src/engine/effect_identity.ts → EFFECT_IDENTITY_REGISTRY.
   */
  effectName: string;

  /**
   * Unique ID of the originating source instance (a spell cast, an aura
   * placement, a trait activation). When the source ends (concentration
   * break, AoE expiry, caster death), all effects with this `sourceId`
   * are removed.
   *
   * Examples:
   *   - 'src_blindness_clericA_round1'  — one casting of Blindness/Deafness
   *   - 'src_darkness_clericA_round3'   — one Darkness spell placement
   *   - 'src_spiritGuardians_clericB_round2'  — one Spirit Guardians aura
   *
   * If absent, the effect's lifecycle is bound to `casterId` +
   * `sourceIsConcentration` (legacy behaviour — backward compatible).
   */
  sourceId?: string;

  /**
   * Turn number on which this effect's source expires (for non-concentration
   * sources with a finite duration, e.g. Blindness/Deafness 1 min ≈ 10 rounds).
   * The pipeline re-evaluates overlap on each turn start; if the current
   * round > sourceTurnExpires, the effect is removed and the next-strongest
   * overlapping effect (if any) takes over.
   *
   * undefined = no expiry (legacy behaviour; or concentration-bound — its
   * expiry is the caster's concentration break, not a turn counter).
   */
  sourceTurnExpires?: number;

  /**
   * Initiative count (or turn number, v1) when this effect was applied.
   * Used as the XGE final tiebreaker ("most recently cast/applied") when
   * two same-name effects have equal potency AND equal remaining duration.
   * Higher = more recent.
   */
  appliedTurn: number;
}
```

### 4.2 Effect Identity Registry

A new module `src/engine/effect_identity.ts` maps `(spellName, effectType, payload)` tuples to canonical `effectName` strings:

```typescript
// src/engine/effect_identity.ts

/**
 * Maps a spell's name + the effect-type/payload it produces to a canonical
 * `effectName` — the identity key used by the dedup pipeline.
 *
 * Two effects with the same `effectName` overlap (DMG p.252). Effects with
 * different `effectName`s stack (PHB p.205 "different spells add together").
 */
export const EFFECT_IDENTITY_REGISTRY: Record<string, string> = {
  // ── Conditions imposed by different sources, all → canonical condition name ──
  'Blindness/Deafness': 'blinded',   // spell applies blinded (v1 always picks blinded)
  'Darkness':           'blinded',   // PHB p.230: "creatures inside are effectively blinded"
  'Blinding Smite':     'blinded',   // PHB p.224: weapon rider that blinds on hit
  'Power Word Stun':    'stunned',
  'Stunning Strike':    'stunned',
  // ... (full table grows as spell modules are wired in)

  // ── Concentration buffs: same spell name → same effect identity ──
  'Bless':              'bless',           // 2 clerics casting Bless → 'bless' overlaps
  'Bane':               'bane',
  'Shield of Faith':    'shield-of-faith',
  'Mage Armor':         'mage-armor',
  'Barkskin':           'barkskin',

  // ── Persistent AoE damage auras ──
  'Spirit Guardians':   'spirit-guardians',  // 2 clerics' auras overlap on a shared target
  'Cloud of Daggers':   'cloud-of-daggers',
  'Moonbeam':           'moonbeam',
  'Cloudkill':          'cloudkill',
  'Blade Barrier':      'blade-barrier',
  'Wall of Fire':       'wall-of-fire',

  // ── Battlefield obstacles (vision/hearing blockers) ──
  // Each obstacle is its own source — they DON'T overlap (two Fog Clouds
  // in different locations both exist; two Darkness spells in the same
  // location suppress the weaker per DMG p.252).
  // For obstacles, effectName encodes position so co-located obstacles
  // dedup but offset obstacles coexist.
  // (See §4.5 for the obstacle special-case.)
};

/**
 * Resolve the canonical `effectName` for an effect being applied.
 * Falls back to `spellName` lowercased + effectType if not registered.
 */
export function resolveEffectName(
  spellName: string,
  effectType: string,
  payload: Record<string, unknown>,
): string {
  const direct = EFFECT_IDENTITY_REGISTRY[spellName];
  if (direct) return direct;

  // Obstacles: include obstacleId so co-located obstacles dedup.
  if (effectType === 'battlefield_obstacle' && payload.obstacleId) {
    return `obstacle:${payload.obstacleId}`;
  }

  // Damage zones: include center coords so overlapping AoEs dedup.
  if (effectType === 'damage_zone' && payload.terrainCenterX !== undefined) {
    const x = payload.terrainCenterX;
    const y = payload.terrainCenterY;
    return `${spellName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${x},${y}`;
  }

  // Default: spell name lowercased + effectType (so different effects from
  // the same spell don't collide — e.g. Hex's hex_damage and its condition
  // are distinct effects).
  return `${spellName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${effectType}`;
}
```

### 4.3 The Dedup Algorithm (turn-start re-evaluation)

The pipeline runs at the **start of each combatant's turn** (alongside `resetBudget`). For each combatant, it:

1. **Expires** effects whose `sourceTurnExpires` ≤ current round (non-concentration duration expiry).
2. **Groups** remaining effects by `effectName`.
3. For each group with >1 effect, **selects the top one** by priority (most powerful > longest duration > most recently applied) and marks the others `suppressed: true`.
4. **Re-derives** `combatant.conditions` from the unsuppressed `condition_apply` effects (a condition is active iff ≥1 unsuppressed effect imposes it).
5. **Notifies** the read helpers (`getActiveBlessDie`, `getActiveDamageZones`, etc.) — they filter on `!suppressed`.

```typescript
// src/engine/effect_pipeline.ts (new module)

import { ActiveEffect, Combatant, Battlefield } from '../types/core';

/** Re-evaluate the active-effects pipeline for one combatant.
 *  Call from resetBudget() at the start of each combatant's turn. */
export function reevaluateEffects(c: Combatant, bf: Battlefield): void {
  const round = bf.round;

  // 1. Expire non-concentration effects whose sourceTurnExpires has passed.
  c.activeEffects = c.activeEffects.filter(e => {
    if (e.sourceTurnExpires !== undefined && round > e.sourceTurnExpires) {
      _undoEffect(c, e, bf);   // structural cleanup (remove condition/obstacle/etc.)
      return false;
    }
    return true;
  });

  // 2. Group by effectName.
  const groups = new Map<string, ActiveEffect[]>();
  for (const e of c.activeEffects) {
    const key = e.effectName;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  // 3. For each multi-effect group, pick the top + suppress the rest.
  for (const [, group] of groups) {
    if (group.length <= 1) {
      if (group[0]) group[0].suppressed = false;
      continue;
    }
    group.sort(compareByPriority);
    group[0].suppressed = false;       // top effect stays active
    for (let i = 1; i < group.length; i++) {
      group[i].suppressed = true;      // suppressed but retained (takeover candidates)
    }
  }

  // 4. Re-derive conditions from unsuppressed condition_apply effects.
  _rederiveConditions(c);
}

/** DMG p.252 + XGE priority: most powerful > longest duration > most recent. */
function compareByPriority(a: ActiveEffect, b: ActiveEffect): number {
  // 1. Most powerful (effect-type-specific comparator — see §4.4)
  const potency = comparePotency(a, b);
  if (potency !== 0) return -potency;   // higher potency first

  // 2. Longest duration (later sourceTurnExpires wins; Infinity for concentration)
  const aDur = a.sourceTurnExpires ?? Infinity;
  const bDur = b.sourceTurnExpires ?? Infinity;
  if (aDur !== bDur) return bDur - aDur;

  // 3. Most recently applied (higher appliedTurn wins)
  return (b.appliedTurn ?? 0) - (a.appliedTurn ?? 0);
}

/** Re-derive the conditions Set from unsuppressed condition_apply effects.
 *  Exhaustion is NOT in the Set (it's on exhaustionLevel) — handled separately. */
function _rederiveConditions(c: Combatant): void {
  const activeConditions = new Set<Condition>();
  for (const e of c.activeEffects) {
    if (e.suppressed) continue;
    if (e.effectType === 'condition_apply' && e.payload.condition) {
      activeConditions.add(e.payload.condition);
    } else if (e.effectType === 'dominated') {
      activeConditions.add('charmed');
      activeConditions.add('incapacitated');
    } else if (e.effectType === 'suggestion') {
      activeConditions.add('charmed');
    } else if (e.effectType === 'invisible') {
      activeConditions.add('invisible');
    }
  }
  // Cascade: paralyzed/stunned/petrified → incapacitated
  if (activeConditions.has('paralyzed') ||
      activeConditions.has('stunned') ||
      activeConditions.has('petrified')) {
    activeConditions.add('incapacitated');
  }
  // Replace the Set (preserves Set identity for any external references)
  c.conditions.clear();
  for (const cond of activeConditions) c.conditions.add(cond);
}
```

### 4.4 Per-Effect-Type Potency Comparator

```typescript
function comparePotency(a: ActiveEffect, b: ActiveEffect): number {
  // Same effectName → same effectType (guaranteed by registry design)
  switch (a.effectType) {
    case 'bless_die':
    case 'bane_die':
      return (a.payload.dieSides ?? 0) - (b.payload.dieSides ?? 0);

    case 'ac_bonus':
      return (a.payload.acBonus ?? 0) - (b.payload.acBonus ?? 0);

    case 'ac_floor':
      return (a.payload.acFloor ?? 0) - (b.payload.acFloor ?? 0);

    case 'damage_zone':
      // Higher damage die × count = more powerful.
      // Spirit Guardians 3d8 (v1) > Cloud of Daggers 4d4 (avg 10 vs avg 9 — close,
      // but different effectName so they don't overlap; only same-name compares).
      return ((a.payload.dieCount ?? 0) * (a.payload.dieSides ?? 0))
           - ((b.payload.dieCount ?? 0) * (b.payload.dieSides ?? 0));

    case 'condition_apply':
      // For save-imposed conditions: higher save DC = more potent.
      // v1: condition_apply doesn't carry saveDC today; we add it to the payload
      // in Phase 1. Falls back to 0 (equal potency → tiebreak by duration/recency).
      return (a.payload.saveDC ?? 0) - (b.payload.saveDC ?? 0);

    case 'weapon_enchant':
      return ((a.payload.attackBonus ?? 0) + (a.payload.damageBonus ?? 0))
           - ((b.payload.attackBonus ?? 0) + (b.payload.damageBonus ?? 0));

    // For effect types where "power" is harder to define (advantage_vs, taunt,
    // curse_rider, etc.) return 0 → tiebreak by duration/recency.
    default:
      return 0;
  }
}
```

### 4.5 Battlefield Obstacles — Co-located Dedup

Two Fog Clouds in different grid cells coexist (different `obstacleId` → different `effectName`). Two Darkness spells **on the same cell** overlap and the more potent one wins (same as DMG p.252). Phase 1 uses `obstacle:${obstacleId}` so obstacles never dedup at the effect level — the overlap check happens in `hasLineOfSight` (the obstacle that blocks the most LOS cells wins; this is a Phase 2+ refinement, deferred).

### 4.6 Takeover-on-Expiry

When the top effect in a group expires (round > `sourceTurnExpires`, or its caster's concentration breaks), `reevaluateEffects` re-sorts the remaining group, promotes the next-highest-priority effect (`suppressed = false`), and `_rederiveConditions` re-adds the condition to the Set. No special-cased "takeover" code — it falls out of the re-sort.

### 4.7 Concentration Break — Selective Removal

`removeEffectsFromCaster(casterId, bf)` is unchanged in shape, but it now removes effects by `sourceId` (not just `casterId`). When a caster's concentration breaks, ALL their active effects' `sourceId`s are removed across the battlefield, then `reevaluateEffects` runs on every affected combatant to promote suppressed takeovers.

### 4.8 Conditions Don't Worsen (Except Exhaustion)

- `addCondition` from non-spell sources (monster traits, class features) still mutates the Set directly — backward compatible.
- `applySpellEffect` for `condition_apply` no longer mutates the Set directly; it pushes the effect and lets `reevaluateEffects` derive the Set.
- Exhaustion (`effectType: 'exhaustion_level'`) is untouched — it increments `exhaustionLevel` immediately (a graduated state, not in the Set, no dedup needed).

### 4.9 Magical Darkness — Already Wired (Session 63)

This RFC doesn't change vision code. It formalises the rule so future vision consumers (RFC-VISION-AUDIO Phase 4) read:
- `Obstacle.isMagicalDarkness === true` → blocks darkvision unless `senses.devilsSight === true`.
- `Obstacle.isMagicalDarkness === undefined/false` → darkvision sees through (Fog Cloud, natural darkness).
- Devil's Sight is **distinct** from darkvision: it specifically lets darkvision penetrate *magical* darkness; it doesn't grant sight on its own (must be paired with `senses.darkvision`).

---

## 5. Implementation Plan (Phased)

### Phase 1 — Effect Identity + Same-Name Dedup (MEDIUM risk)
- Add `effectName`, `sourceId`, `sourceTurnExpires`, `appliedTurn`, `suppressed` to `ActiveEffect`.
- Create `src/engine/effect_identity.ts` with `EFFECT_IDENTITY_REGISTRY` + `resolveEffectName()`.
- Update `applySpellEffect` to set `effectName = resolveEffectName(...)` + `appliedTurn = bf.round`.
- Create `src/engine/effect_pipeline.ts` with `reevaluateEffects()`.
- Call `reevaluateEffects(c, bf)` from `resetBudget()` (start of each turn).
- Update read helpers (`getActiveBlessDie`, `getActiveAcBonus`, `getActiveDamageZones`, `getActiveWeaponEnchant`) to filter `!suppressed`.
- **Covers**: Bless + Bless, Bane + Bane, two Spirit Guardians, two Magic Weapon.

### Phase 2 — Non-Concentration Source Tracking (MEDIUM risk)
- Spell modules that apply non-concentration effects with finite duration (Blindness/Deafness 1 min, Hex 1 hr, etc.) set `sourceTurnExpires` on the effect.
- `reevaluateEffects` already expires by `sourceTurnExpires` — Phase 2 just makes spell modules populate it.
- **Covers**: Blindness/Deafness expires after 10 rounds; Hex expires after 600 rounds (or combat end, whichever first).

### Phase 3 — Takeover-on-Expiry Re-evaluation (LOW risk)
- Already implemented in Phase 1's `reevaluateEffects` (re-sort promotes the next effect). Phase 3 adds **tests** that explicitly verify takeover: cast Blindness/Deafness (round 1, expires round 10), cast a 2nd Blindness/Deafness (round 5, expires round 14), the top one is whichever has longer duration; when it expires, the other takes over.
- **Covers**: Darkness spell (round 1) + Blindness/Deafness (round 3); Darkness ends (round 11); Blindness/Deafness still has 2 rounds — takes over.

### Phase 4 — Conditions Derived from Pipeline (HIGH risk — biggest blast radius)
- `applySpellEffect` for `condition_apply` no longer calls `target.conditions.add(...)` directly. The Set is rebuilt each turn by `_rederiveConditions`.
- Spell modules stop calling `addCondition()` for spell-sourced conditions — they push an `ActiveEffect` and let the pipeline derive.
- `removeEffectsFromCaster` calls `_undoEffect` (still removes structural things like obstacles) but does NOT call `target.conditions.delete(...)` — the Set is derived, not authoritatively mutated.
- Non-spell sources (monster traits like Eye of Frost, class features like Rage-granted resistances) keep calling `addCondition()` directly.
- **Covers**: two `blinded` from different sources — Darkness ends → `blinded` correctly retained because Blindness/Deafness is still active.

---

## 6. Files to Touch

| File | Change | Phase |
|------|--------|-------|
| `src/types/core.ts` | Add `effectName`, `sourceId`, `sourceTurnExpires`, `appliedTurn`, `suppressed` to `ActiveEffect` | 1 |
| `src/engine/effect_identity.ts` (NEW) | `EFFECT_IDENTITY_REGISTRY` + `resolveEffectName()` | 1 |
| `src/engine/effect_pipeline.ts` (NEW) | `reevaluateEffects()`, `compareByPriority()`, `comparePotency()`, `_rederiveConditions()` | 1 |
| `src/engine/spell_effects.ts` | `applySpellEffect` sets `effectName` + `appliedTurn`; read helpers filter `!suppressed`; `_undoEffect` no longer mutates `conditions` Set directly (Phase 4) | 1, 4 |
| `src/engine/utils.ts` | `resetBudget()` calls `reevaluateEffects(c, bf)` | 1 |
| `src/engine/combat.ts` | `removeEffectsFromCaster` call sites ensure `reevaluateEffects` runs on affected combatants | 1 |
| `src/spells/blindness_deafness.ts` | Set `sourceTurnExpires` (10 rounds = 1 min); set `effectName: 'blinded'` via registry | 2 |
| `src/spells/darkness.ts` | `effectName: 'blinded'` (already partial via obstacle; the implicit blinded condition on creatures inside is added as a separate `condition_apply` effect in Phase 2 — Darkness currently only adds the obstacle, not a per-creature `condition_apply`) | 2 |
| `src/spells/spirit_guardians.ts` | Set `effectName: 'spirit-guardians'`; verify 2 clerics' auras on shared target dedup correctly | 1 |
| `src/spells/bless.ts`, `bane.ts`, `magic_weapon.ts`, `shield_of_faith.ts`, `barkskin.ts`, etc. | Set `effectName` via registry (auto-resolved — minimal changes) | 1 |
| `src/test/combining_effects.test.ts` (NEW) | Phase 1-4 test cases (see §8) | 1-4 |

---

## 7. Backward Compatibility

- **Optional new fields** — `effectName`, `sourceId`, `sourceTurnExpires`, `appliedTurn`, `suppressed` are added to `ActiveEffect` as required (`effectName`, `appliedTurn`) or optional (`sourceId`, `sourceTurnExpires`, `suppressed`). Existing tests that construct ActiveEffects directly must add `effectName` (and optionally `appliedTurn`); a fallback `resolveEffectName()` is called inside `applySpellEffect` when `effectName` is absent on the input def, so spell modules don't all need updating in lock-step.
- **The `conditions` Set stays as a derived view** — non-spell sources (monster traits, class features, manual test setup) keep calling `addCondition()` / `removeCondition()` directly. The pipeline's `_rederiveConditions` unions spell-sourced conditions with non-spell-sourced ones (Phase 4 adds a `_nonsspellConditions` Set to keep them separate; until then, Phase 1-3 leaves the Set authoritative and only adds dedup at the read-helper layer).
- **Legacy read helpers** keep working — `getActiveBlessDie` returns `max(dieSides)` over unsuppressed effects; the sum-based helpers (`getActiveAcBonus`, `getActiveWeaponEnchant`) get a `filter(!suppressed)` added but the sum semantics stay (so different-name buffs still stack — Bless's +1d4 + Bardic Inspiration's +1d6 both apply because they have different `effectName`).
- **Existing tests pass** — the dedup only kicks in when two effects share an `effectName`. Single-caster scenarios (the vast majority of tests) are unaffected.
- **Exhaustion untouched** — `exhaustionLevel` and `effectType: 'exhaustion_level'` behaviour is unchanged.

---

## 8. Test Plan

### Phase 1 — Same-Name Dedup
1. **Bless + Bless (different casters, same target)**: cleric A casts Bless on fighter; cleric B casts Bless on fighter. `getActiveBlessDie(fighter)` returns 4 (one d4, not two). When cleric A's concentration breaks, Bless from cleric B takes over (still 4, not 0).
2. **Spirit Guardians × 2**: cleric A and cleric B both cast Spirit Guardians; fighter is within both auras. Fighter takes 3d8 radiant once per turn (not twice). When cleric A's concentration breaks, fighter still takes 3d8 from cleric B's aura.
3. **Magic Weapon × 2**: cleric A and cleric B both cast Magic Weapon on the same fighter. `getActiveWeaponEnchant(fighter)` returns +1/+1 (not +2/+2).
4. **Bless + Bane (different names) → stack**: cleric casts Bless on fighter; enemy casts Bane on fighter. Both apply — Bless adds d4, Bane subtracts d4 (net 0, but both effects are present and tracked).

### Phase 2 — Source Tracking + Expiry
5. **Blindness/Deafness expires after 10 rounds**: caster A casts Blindness/Deafness at fighter (round 1); fighter is `'blinded'` rounds 1-10; round 11 the effect expires and `'blinded'` is removed.
6. **Darkness spell + Blindness/Deafness (same condition, different sources)**: Darkness spell active rounds 1-10 (concentration); caster B casts Blindness/Deafness at fighter round 3 (expires round 13). Fighter is `'blinded'` rounds 1-13. When Darkness ends round 10, `'blinded'` is retained (Blindness/Deafness still has 3 rounds).
7. **Two Darkness spells, same cell**: cleric A and cleric B both cast Darkness centered on the same point. `bf.obstacles` has both obstacles, but `hasLineOfSight` blocks based on the more potent (Phase 2 stub: both block — Phase 4 vision will dedup co-located obstacles per DMG p.252).

### Phase 3 — Takeover
8. **Takeover scenario**: 3 Blindness/Deafness castings on one target — round 1 (expires r10), round 5 (expires r14), round 7 (expires r16). The top one (round 7 casting — most recent, all equal potency, longest remaining) wins. When it expires r16, the next-strongest (round 5 casting — already expired) is gone; the round 1 casting is gone too — `'blinded'` removed. Reverse the cast order to verify the longest-duration one wins regardless of cast order.

### Phase 4 — Conditions Derived
9. **Conditions re-derived on every turn**: spell-sourced `condition_apply` effect with `suppressed: true` does NOT add to the Set; when the suppressing effect expires, the suppressed one is promoted and the Set is re-derived.
10. **Cascade preserved**: paralyzed effect active → incapacitated in the Set; paralyzed expires → incapacitated removed (unless stunned/petrified still active).
11. **Non-spell conditions preserved**: a monster trait that calls `addCondition(c, 'poisoned')` directly still works; the pipeline doesn't strip non-spell conditions.
12. **Exhaustion untouched**: two `exhaustion_level` effects (Sickening Radiance twice) → `exhaustionLevel` increments by 2 (one per application). Not deduped — Exhaustion is graduated.

### Magical Darkness / Devil's Sight
13. **Darkness blocks darkvision**: a Dwarf (darkvision 60) inside a Darkness spell cannot see other creatures inside (current Phase 1-3 behaviour — `hasLineOfSight` returns false because `blocksVision: true`). RFC-VISION-AUDIO Phase 4 will refine this so darkvision is checked per-obstacle.
14. **Devil's Sight penetrates Darkness**: an Imp (`senses.devilsSight: true`) inside a Darkness spell can see through it (Phase 4 vision consumption — flag is already wired in the type system).
15. **Fog Cloud does NOT block darkvision**: a Dwarf inside Fog Cloud can see with darkvision (Phase 4 — `isMagicalDarkness` is undefined for Fog Cloud).

---

## 9. Open Questions

1. **Defining "most powerful" for complex effect types.** For `damage_zone`, `dieCount × dieSides` (max roll) is a reasonable proxy, but average damage (`dieCount × (dieSides+1)/2`) is closer to "most potent." For `condition_apply`, `saveDC` is the natural proxy but isn't currently stored on the payload — Phase 1 needs to add it. For multi-effect spells (e.g. a hypothetical spell that imposes both frightened AND disadvantage on attacks), should each rider be a separate effect with its own `effectName`, or one composite effect? **Recommendation**: separate effects per rider (each gets its own dedup group).

2. **"Most recently cast" tiebreaker — timestamp or initiative count?** The user's directive says "most recently cast or applied." Using `appliedTurn` (integer round number) is simple but coarse — two effects applied on the same round tie. A sub-turn timestamp (`Date.now()` or a monotonic counter incremented per `applySpellEffect` call) is finer but more invasive. **Recommendation**: `appliedTurn` for v1 (round-level granularity); upgrade to a monotonic counter in Phase 2 if tests reveal ordering ambiguity.

3. **Obstacles co-located dedup — when two Darkness spells overlap geometrically but not on the same center cell.** Two Darkness spells centered 10 ft apart have overlapping areas but different `obstacleId`s. DMG p.252 says the most potent applies in the overlap. **Recommendation**: defer to Phase 4 vision work — Phase 1-3 leaves both obstacles in `bf.obstacles` and `hasLineOfSight` blocks based on whichever obstacle covers the queried cell (effectively "union of obstacles" — slightly more permissive than RAW but harmless in v1 since both Darkness spells have the same effect).

---

## 10. References

- DMG p.252 — "Combining Game Effects" (2014 DMG)
- PHB p.205 — "Combining Magical Effects" (PHB Ch.10)
- PHB p.290-292 — Conditions (blinded, charmed, poisoned, etc.)
- PHB p.291 — Exhaustion (graduated 7-level state)
- PHB p.230 — Darkness spell ("A creature with darkvision can't see through this darkness")
- PHB p.110 — Devil's Sight (Warlock Eldritch Invocation)
- XGE p.5 — "Combining Game Effects" sidebar (priority tiebreak rules)
- `src/types/core.ts` line 158 — `ActiveEffect` interface
- `src/types/core.ts` line 1285 — `senses.devilsSight` (Session 63)
- `src/types/core.ts` line 2170 — `Obstacle.isMagicalDarkness` (Session 63)
- `src/engine/spell_effects.ts` line 53 — `applySpellEffect`
- `src/engine/spell_effects.ts` line 171 — `removeEffectsFromCaster`
- `src/engine/perception.ts` line 173 — `isVisuallyDetected` (Phase 2-3 done)
- `src/engine/utils.ts` line 528 — `addCondition`
- `src/spells/darkness.ts` line 259 — `isMagicalDarkness: true` on obstacle
- `src/spells/spirit_guardians.ts` — example of overlapping AoE (line 211)
- `src/spells/blindness_deafness.ts` line 73 — applies `condition_apply: blinded`
- `docs/RFC-VISION-AUDIO.md` — Phase 4 deferred vision work (per-cell light, fog/darkness as obscurement zones)
- `docs/RFC-MONSTER-SPELLCASTING.md` §9.3 — cross-reference to this RFC
