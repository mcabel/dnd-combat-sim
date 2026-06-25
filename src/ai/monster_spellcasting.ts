// ============================================================
// Monster Spellcasting Engine Integration
// RFC: docs/RFC-MONSTER-SPELLCASTING.md
//
// Module: src/ai/monster_spellcasting.ts
//
// Phase 1 (THIS SESSION — Session 63):
//   - At-will spells + cantrips only (no slot consumption, no daily tracking).
//   - Iterates `monsterSpellcasting.atWill` + `monsterSpellcasting.slots[0].spells`.
//   - For each spell name (case-insensitive), looks up a `CANTRIP_TEMPLATE`.
//   - Builds a synthetic spell-attack Action (attack-roll OR save-based).
//   - Weighted scoring: prefer damage cantrips on full HP, defending on low HP.
//   - Returns a PlannedAction (type: 'cast') or null (fall back to weapon attacks).
//
// Phase 2 (DEFERRED): slot-based leveled spells, monsterSpellSlots consumption.
// Phase 3 (DEFERRED): daily-use spells, monsterDailyUses consumption.
// Phase 4 (DEFERRED): spell upcast, multi-target AoE, reaction spells.
//
// Autonomous decisions (RFC §9.1, Core + Sheet offline):
//   #1 = A: Only cast spells with a known template (skip unimplemented).
//   #2 = Weighted system decides (no forced opener).
//   #3 = B: Cantrip-finisher bonus when target HP ≤ cantrip avg dmg × 1.5.
//   #4 = A: Break concentration automatically (Phase 2+ — moot for Phase 1).
//   #5 = B: Situational priority for daily-use spells (Phase 3).
//   #6 = A: Skip silently when spell not in library.
//
// Dispatch path:
//   selectMonsterSpell() → PlannedAction { type: 'cast', action: syntheticAction }
//   combat.ts `case 'cast':` → resolveAttack(actor, target, action, state)
//   resolveAttack handles both attack-roll (attackType='spell') and
//   save-based (attackType='save' + saveDC + saveAbility) cantrips.
// ============================================================

import { Combatant, Battlefield, Action, PlannedAction, DamageType, AbilityScore } from '../types/core';
import { chebyshev3D } from '../engine/movement';
import { composeBiases, collectCantripBiases } from './pattern_bias';
import { requiresVisibleTarget } from '../engine/perception';

// ---- Spell Tags (RFC §4.1) ----------------------------------

export type SpellTag = 'damage' | 'cc' | 'healing' | 'defending' | 'buff' | 'utility';

// ---- Cantrip Templates (Phase 1 — top 13 combat cantrips) ----

/**
 * A cantrip template captures the mechanical essentials needed to build a
 * synthetic spell-attack Action for a monster. Derived from the PHB/XGE
 * cantrip modules (src/spells/<name>.ts). Damage scales at caster level
 * 5/11/17 (2/3/4 dice) — see `cantripDiceCount()`.
 *
 * `attackRoll: true`  → ranged/melee spell attack (attackType: 'spell').
 * `attackRoll: false` → save-based cantrip (attackType: 'save' + saveAbility).
 *
 * Phase 1 includes only combat cantrips (damage or condition applicators).
 * Utility cantrips (Mage Hand, Prestidigitation, Dancing Lights, Light,
 * Message, Minor Illusion, etc.) are intentionally excluded — they have no
 * combat effect and would waste the monster's action (Doubt #1 = A: skip).
 */
export interface CantripTemplate {
  name: string;            // canonical capitalization
  damageSides: number;     // die sides (d8 → 8, d10 → 10, d12 → 12)
  damageType: DamageType;  // 'fire' | 'cold' | 'necrotic' | etc.
  rangeFt: number;         // 0 = touch (melee spell attack)
  attackRoll: boolean;     // true = attack roll, false = save
  saveAbility?: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  tags: SpellTag[];        // primary tags for weighted scoring
  // Optional rider description (for logging only — mechanical riders like
  // Ray of Frost's speed reduction are NOT applied in Phase 1; resolveAttack
  // doesn't invoke cantrip riders. Forward-compat TODO.)
  rider?: string;
}

const CANTRIP_TEMPLATES: Record<string, CantripTemplate> = {
  // key = lowercase canonical name (case-insensitive lookup)
  'fire bolt': {
    name: 'Fire Bolt', damageSides: 10, damageType: 'fire',
    rangeFt: 120, attackRoll: true, tags: ['damage'],
  },
  'ray of frost': {
    name: 'Ray of Frost', damageSides: 8, damageType: 'cold',
    rangeFt: 60, attackRoll: true, tags: ['damage'],
    rider: 'speed reduced by 10 ft (not applied in Phase 1)',
  },
  'eldritch blast': {
    name: 'Eldritch Blast', damageSides: 10, damageType: 'force',
    rangeFt: 120, attackRoll: true, tags: ['damage'],
    rider: 'multiple beams at higher levels (Phase 1: single beam)',
  },
  'chill touch': {
    name: 'Chill Touch', damageSides: 8, damageType: 'necrotic',
    rangeFt: 120, attackRoll: true, tags: ['damage'],
    rider: 'no healing for undead target (not applied in Phase 1)',
  },
  'shocking grasp': {
    name: 'Shocking Grasp', damageSides: 8, damageType: 'lightning',
    rangeFt: 5, attackRoll: true, tags: ['damage'],
    rider: 'advantage vs metal armor (not applied in Phase 1)',
  },
  'produce flame': {
    name: 'Produce Flame', damageSides: 8, damageType: 'fire',
    rangeFt: 30, attackRoll: true, tags: ['damage'],
  },
  'thorn whip': {
    name: 'Thorn Whip', damageSides: 6, damageType: 'piercing',
    rangeFt: 30, attackRoll: true, tags: ['damage'],
    rider: 'pull up to 10 ft (not applied in Phase 1)',
  },
  'sacred flame': {
    name: 'Sacred Flame', damageSides: 8, damageType: 'radiant',
    rangeFt: 60, attackRoll: false, saveAbility: 'dex', tags: ['damage'],
    rider: 'ignores cover (not applied in Phase 1)',
  },
  'toll the dead': {
    name: 'Toll the Dead', damageSides: 8, damageType: 'necrotic',
    rangeFt: 60, attackRoll: false, saveAbility: 'wis', tags: ['damage'],
    rider: 'd12 if target missing HP (not applied in Phase 1)',
  },
  'acid splash': {
    name: 'Acid Splash', damageSides: 6, damageType: 'acid',
    rangeFt: 60, attackRoll: false, saveAbility: 'dex', tags: ['damage'],
    rider: 'can target 2 creatures within 5 ft (Phase 1: single target)',
  },
  'poison spray': {
    name: 'Poison Spray', damageSides: 12, damageType: 'poison',
    rangeFt: 10, attackRoll: false, saveAbility: 'con', tags: ['damage'],
  },
  'vicious mockery': {
    name: 'Vicious Mockery', damageSides: 4, damageType: 'psychic',
    rangeFt: 60, attackRoll: false, saveAbility: 'wis', tags: ['damage', 'cc'],
    rider: 'disadvantage on next attack (not applied in Phase 1)',
  },
  'mind sliver': {
    name: 'Mind Sliver', damageSides: 6, damageType: 'psychic',
    rangeFt: 60, attackRoll: false, saveAbility: 'int', tags: ['damage', 'cc'],
    rider: '-1d4 next save (not applied in Phase 1)',
  },
  // ── Session 63 Phase 3 additions: 4 more single-target combat cantrips ──
  // These expand monster cantrip coverage (more creatures can now cast their
  // cantrips instead of falling back to weapon attacks).
  'frostbite': {
    name: 'Frostbite', damageSides: 6, damageType: 'cold',
    rangeFt: 60, attackRoll: false, saveAbility: 'con', tags: ['damage', 'cc'],
    rider: 'disadvantage on next weapon attack (not applied in Phase 1)',
  },
  'primal savagery': {
    name: 'Primal Savagery', damageSides: 10, damageType: 'acid',
    rangeFt: 5, attackRoll: true, tags: ['damage'],
    // MELEE spell attack (touch range). Not a save.
  },
  'infestation': {
    name: 'Infestation', damageSides: 6, damageType: 'poison',
    rangeFt: 30, attackRoll: false, saveAbility: 'con', tags: ['damage', 'cc'],
    rider: 'forced movement up to 5 ft (not applied in Phase 1)',
  },
  'lightning lure': {
    name: 'Lightning Lure', damageSides: 8, damageType: 'lightning',
    rangeFt: 15, attackRoll: false, saveAbility: 'str', tags: ['damage', 'cc'],
    rider: 'pull target up to 10 ft toward caster (not applied in Phase 1)',
  },
};

// Case-insensitive lookup index (built once at module load).
const CANTRIP_BY_LOWER: Record<string, CantripTemplate> = {};
for (const [k, v] of Object.entries(CANTRIP_TEMPLATES)) {
  CANTRIP_BY_LOWER[k] = v;
}

/**
 * Look up a cantrip template by spell name (case-insensitive).
 * Returns null if the spell is not a known combat cantrip.
 *
 * Monster spell names from `monsterSpellcasting` are lowercase
 * (e.g. 'ray of frost'). This function normalizes and matches.
 *
 * Session 69 fix: also strips trailing 5etools cross-reference asterisks
 * (e.g. "fire bolt*" → "fire bolt"). The * marks spells sourced from a
 * different book than the monster's source — without this strip, monsters
 * whose atWill list contains "fire bolt*" would fail to look up the
 * Fire Bolt cantrip template and skip it entirely.
 */
export function lookupCantripTemplate(spellName: string): CantripTemplate | null {
  const normalized = spellName.toLowerCase().trim().replace(/\s*\*+\s*$/, '');
  return CANTRIP_BY_LOWER[normalized] ?? null;
}

/**
 * Session 67 — spell-coverage tracker.
 *
 * Returns the canonical (capitalized) names of every cantrip currently in
 * `CANTRIP_TEMPLATES`. Used by `scripts/scan_monster_spells.ts` to mark
 * those cantrips as "implemented" even when they are not in the spell cache
 * (the cache only covers PHB/XGE/TCE/etc. spell modules in `src/spells/`,
 * not the monster-only combat cantrip templates handled directly in this
 * module).
 */
export function listCantripTemplateNames(): string[] {
  return Object.values(CANTRIP_TEMPLATES).map(t => t.name);
}

// ---- Spell Tag Derivation (RFC §6) --------------------------

/**
 * Spell tag overrides for at-will LEVELED spells (Phase 2+).
 * Phase 1 uses cantrip templates directly (tags embedded in the template).
 * This map is here for forward-compat — Phase 2 will consult it when
 * dispatching at-will leveled spells via the GENERIC_SPELLS registry.
 *
 * Examples (not exhaustive — Phase 2 will expand):
 */
export const SPELL_TAG_OVERRIDES: Record<string, SpellTag[]> = {
  'Shield': ['defending'],
  'Misty Step': ['defending'],
  'Blink': ['defending'],
  'Blur': ['defending'],
  'Mage Armor': ['defending'],
  'Bless': ['buff'],
  'Haste': ['buff'],
  'Cure Wounds': ['healing'],
  'Healing Word': ['healing'],
  'Aid': ['healing'],
};

/**
 * Derive tags for a spell. Phase 1: cantrip templates have embedded tags.
 * Phase 2 will extend this to consult GENERIC_SPELLS metadata + overrides.
 */
export function deriveSpellTags(spellName: string): SpellTag[] {
  const tmpl = lookupCantripTemplate(spellName);
  if (tmpl) return tmpl.tags;
  const override = SPELL_TAG_OVERRIDES[spellName];
  if (override) return override;
  return [];  // unknown → no tags (will be skipped by scoring)
}

// ---- Cantrip Damage Scaling (PHB p.201) ---------------------

/**
 * PHB p.201: "A cantrip's spell level increases as you gain levels.
 * The cantrip's damage increases at 5th, 11th, and 17th level."
 *
 *   caster level 1–4:  1 die
 *   caster level 5–10: 2 dice
 *   caster level 11–16: 3 dice
 *   caster level 17+:  4 dice
 *
 * Monsters use `casterLevel` (parsed from "Nth-level spellcaster" header,
 * or CR as fallback — see parser/fivetools.ts parseCasterLevel).
 */
export function cantripDiceCount(casterLevel: number | undefined): number {
  const lvl = casterLevel ?? 1;
  if (lvl >= 17) return 4;
  if (lvl >= 11) return 3;
  if (lvl >= 5) return 2;
  return 1;
}

/**
 * Average damage of NdS dice = N × (S+1) / 2, floored.
 *   1d8 → 4, 2d8 → 9, 3d8 → 13, 4d8 → 18.
 *   1d10 → 5, 2d10 → 11, 4d10 → 22.
 *
 * Used for the finisher bonus (Doubt #3) and the synthetic Action's
 * `damage.average` field.
 */
export function cantripAverageDamage(diceCount: number, sides: number): number {
  return Math.floor(diceCount * (sides + 1) / 2);
}

// ---- Spellcast Context (RFC §4.2) ---------------------------

export interface SpellcastContext {
  selfHPct: number;          // 0.0–1.0 (currentHP / maxHP)
  allyCount: number;         // living allies (excluding self)
  enemyCount: number;        // living enemies
  nearestEnemyDistFt: number;
  hasDownedAlly: boolean;    // unconscious + not dead ally
  isOutnumbered: boolean;    // enemyCount > allyCount + 1
  round: number;             // 1 = opener
}

/**
 * Build the situational context for a monster's spell selection.
 * Pure function — does not mutate. Used by computeSpellWeight().
 */
export function computeSpellcastContext(self: Combatant, bf: Battlefield): SpellcastContext {
  let allyCount = 0;
  let enemyCount = 0;
  let nearestEnemyDistFt = Infinity;
  let hasDownedAlly = false;

  for (const c of bf.combatants.values()) {
    if (c.id === self.id) continue;
    if (c.isDead) continue;
    const sameFaction = c.faction === self.faction;
    if (sameFaction) {
      if (!c.isUnconscious) allyCount++;
      else hasDownedAlly = true;  // unconscious but not dead = downed
    } else {
      if (!c.isUnconscious) {
        enemyCount++;
        const d = chebyshev3D(self.pos, c.pos) * 5;
        if (d < nearestEnemyDistFt) nearestEnemyDistFt = d;
      }
    }
  }

  const selfHPct = self.maxHP > 0 ? self.currentHP / self.maxHP : 1;

  return {
    selfHPct,
    allyCount,
    enemyCount,
    nearestEnemyDistFt,
    hasDownedAlly,
    isOutnumbered: enemyCount > allyCount + 1,
    round: bf.round,
  };
}

// ---- Weighted Scoring (RFC §4.2) ----------------------------

/**
 * Tag multiplier table (RFC §4.2). The spell's PRIMARY tag (first in the
 * template's tags array) determines the multiplier. Phase 1 simplification:
 * cantrips are almost always 'damage' (some are 'damage'+'cc' — primary
 * tag is 'damage').
 *
 * Situational overrides:
 *   - Round 1 with 3+ enemies → damage ×1.5, cc ×1.8 (prefer AoE openers)
 *   - Low HP (<30%) → defending ×1.8, healing ×2.0, damage ×0.8
 *   - Downed ally → healing ×2.5
 *   - Outnumbered → cc ×2.0, damage ×1.4
 *   - Default → all ×1.0
 */
function tagMultiplier(primaryTag: SpellTag, ctx: SpellcastContext): number {
  // Determine the dominant situation (priority order).
  if (ctx.hasDownedAlly) {
    // Phase 1: no healing cantrips, but the multiplier is defined for forward-compat.
    switch (primaryTag) {
      case 'healing': return 2.5;
      case 'damage': return 0.5;
      case 'cc': return 0.5;
      case 'defending': return 0.5;
      case 'buff': return 0.5;
      default: return 0.5;
    }
  }
  if (ctx.selfHPct < 0.30) {
    switch (primaryTag) {
      case 'healing': return 2.0;
      case 'defending': return 1.8;
      case 'damage': return 0.8;
      case 'cc': return 0.6;
      case 'buff': return 0.5;
      default: return 1.0;
    }
  }
  if (ctx.isOutnumbered) {
    switch (primaryTag) {
      case 'cc': return 2.0;
      case 'damage': return 1.4;
      case 'healing': return 1.0;
      case 'defending': return 0.8;
      case 'buff': return 1.0;
      default: return 1.0;
    }
  }
  if (ctx.round === 1 && ctx.enemyCount >= 3) {
    switch (primaryTag) {
      case 'damage': return 1.5;
      case 'cc': return 1.8;
      case 'buff': return 1.2;
      case 'healing': return 0.5;
      case 'defending': return 0.3;
      default: return 1.0;
    }
  }
  if (ctx.round === 1 && ctx.enemyCount === 1) {
    switch (primaryTag) {
      case 'damage': return 1.3;
      case 'cc': return 1.2;
      case 'buff': return 0.8;
      case 'healing': return 0.3;
      case 'defending': return 0.3;
      default: return 1.0;
    }
  }
  return 1.0;  // default
}

/**
 * Base weight: higher-level spells have higher base. Cantrips (level 0)
 * have base 1.0. This makes slotted spells preferred over cantrips when
 * both are available (Phase 2+). Phase 1 only has cantrips, so all bases
 * are 1.0 — the differentiator is the tag multiplier + finisher bonus.
 */
function baseWeight(spellLevel: number): number {
  if (spellLevel <= 0) return 1.0;
  return 1.0 + spellLevel * 0.15;  // L1=1.15, L3=1.45, L9=2.35
}

/**
 * Finisher bonus (Doubt #3 = B): when the target's current HP ≤ the cantrip's
 * average damage × 1.5, the cantrip gets a ×1.3 weight boost ("finish with a
 * cantrip, save the slot"). Phase 1 has no slots, but this bonus still makes
 * the monster prefer a cantrip that can kill over one that can't.
 *
 * `targetHP` is the best target's current HP. `cantripAvgDmg` is the cantrip's
 * average damage (diceCount × damageSides / 2 + 0.5).
 */
function finisherMultiplier(targetHP: number, cantripAvgDmg: number): number {
  if (targetHP <= cantripAvgDmg * 1.5) return 1.3;
  return 1.0;
}

/**
 * Compute the total weight for a candidate spell.
 *
 *   weight = baseWeight(level) × tagMultiplier(primaryTag, ctx)
 *            × finisherMultiplier(targetHP, avgDmg) × availabilityMultiplier
 *            × composeBiases(biases)
 *
 * Phase 1: availabilityMultiplier is always 1.0 (at-will + cantrips = infinite).
 * Phase 2: 0.0 if no slot remains, 1.0 otherwise.
 *
 * The `biases` parameter is new in RFC-PATTERN-BIAS-AI Phase 1.
 * Default [] → composeBiases([]) = 1.0 (backward-compatible).
 */
export function computeSpellWeight(
  spellName: string,
  tags: SpellTag[],
  spellLevel: number,
  avgDamage: number,
  ctx: SpellcastContext,
  targetHP: number,
  biases: number[] = [],
): number {
  if (tags.length === 0) return 0;  // no tags → skip
  const primaryTag = tags[0];
  const base = baseWeight(spellLevel);
  const tagMult = tagMultiplier(primaryTag, ctx);
  const finisher = finisherMultiplier(targetHP, avgDamage);
  const availability = 1.0;  // Phase 1: at-will = infinite
  const biasProduct = composeBiases(biases);
  return base * tagMult * finisher * availability * biasProduct;
}

// ---- Synthetic Action Builder -------------------------------

/**
 * Build a synthetic spell-attack Action for a monster cantrip.
 *
 * For attack-roll cantrips (Fire Bolt, Ray of Frost, etc.):
 *   attackType='spell', hitBonus=spellAttackBonus, range from template.
 *
 * For save-based cantrips (Sacred Flame, Toll the Dead, etc.):
 *   attackType='save', saveDC=monster's saveDC, saveAbility from template.
 *
 * Damage scales by caster level (cantripDiceCount). The `slotLevel: 0` marks
 * it as a cantrip (not counterspellable per existing getSpellInfoFromPlan,
 * and doesn't consume a spell slot).
 *
 * The monster's `spellAttackBonus` and `saveDC` come from `monsterSpellcasting`.
 * If absent (parser gap), we fall back to a +0 hit / DC 10 — the monster still
 * casts but is weak. This is a safety net; the parser populates these for all
 * 945 spellcasting monsters.
 */
export function buildCantripAction(monster: Combatant, tmpl: CantripTemplate): Action {
  const sc = monster.monsterSpellcasting;
  const hitBonus = sc?.spellAttackBonus ?? 0;
  const saveDC = sc?.saveDC ?? 10;
  const diceCount = cantripDiceCount(monster.casterLevel);
  const avg = cantripAverageDamage(diceCount, tmpl.damageSides);

  const isTouch = tmpl.rangeFt <= 5;
  const range = isTouch ? null : { normal: tmpl.rangeFt, long: tmpl.rangeFt };

  return {
    name: tmpl.name,
    isMultiattack: false,
    attackType: tmpl.attackRoll ? 'spell' : 'save',
    reach: isTouch ? tmpl.rangeFt : 0,
    range,
    hitBonus: tmpl.attackRoll ? hitBonus : 0,
    damage: {
      count: diceCount,
      sides: tmpl.damageSides,
      bonus: 0,
      average: avg,
    },
    damageType: tmpl.damageType,
    saveDC: tmpl.attackRoll ? null : saveDC,
    saveAbility: tmpl.attackRoll ? null : (tmpl.saveAbility ?? null),
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,  // cantrip
    costType: 'action',
    legendaryCost: 0,
    description: `${tmpl.name} (monster cantrip)${tmpl.rider ? ' — ' + tmpl.rider : ''}`,
  };
}

// ---- Target Selection ---------------------------------------

/**
 * Find the best target for a monster cantrip: the living enemy with the
 * LOWEST current HP within the cantrip's range (prefer kills / finishes).
 * Ties → nearest. Returns null if no enemy is in range.
 *
 * Phase 1 simplification: no LOS check here (resolveAttack enforces LOS
 * for attack-roll spells; save-based cantrips like Sacred Flame ignore
 * cover per PHB but still require "a creature you can see"). The planner's
 * detection-state map (Phase 1 of Vision/Audio) is consulted: only
 * 'visible' or 'position-known' enemies are targetable.
 */
function findBestCantripTarget(
  self: Combatant,
  bf: Battlefield,
  rangeFt: number,
  requiresVisible: boolean = false,
): Combatant | null {
  let best: Combatant | null = null;
  let bestScore = -Infinity;

  for (const c of bf.combatants.values()) {
    if (c.id === self.id) continue;
    if (c.faction === self.faction) continue;
    if (c.isDead || c.isUnconscious) continue;

    // Range check (Chebyshev distance in feet).
    const distFt = chebyshev3D(self.pos, c.pos) * 5;
    if (distFt > rangeFt) continue;

    // Detection check: skip enemies we can't see or hear.
    // (Phase 1 Vision/Audio: 'visible' or 'position-known' = targetable.)
    const detection = self.perception?.detection?.get(c.id);
    if (detection === 'hidden' || detection === 'unknown') continue;

    // ── RFC-VISION-AUDIO Phase 3 Q5: visible-target spell gating ──
    // If this cantrip requires "a creature you can see", skip enemies
    // that aren't visually detected (position-known but not visible).
    // Legacy fallback: if detection is undefined (no perception map),
    // treat the enemy as visible unless they have 'hidden'/'invisible'.
    if (requiresVisible) {
      if (detection === undefined) {
        // Legacy combatant — fall back to condition check
        if (c.conditions.has('hidden') || c.conditions.has('invisible')) continue;
      } else if (detection !== 'visible') {
        continue;
      }
    }

    // Score: prefer low-HP targets (finisher), then nearest.
    // Lower HP = higher score. Use negative HP so max() picks lowest HP.
    const hpScore = -c.currentHP;
    const distScore = -distFt * 0.01;  // tiny tiebreaker
    const score = hpScore + distScore;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// ---- Main Entry: selectMonsterSpell -------------------------

/**
 * Select the best at-will/cantrip spell for a monster to cast this turn.
 *
 * Algorithm (RFC §4.3, Phase 1 subset):
 *   1. Guard: monster has `monsterSpellcasting` and at least one candidate.
 *   2. Collect candidates: atWill + slots[0].spells (cantrips).
 *   3. For each, look up a cantrip template (case-insensitive).
 *      Skip if no template (Doubt #1 = A, #6 = A: skip unimplemented/utility).
 *   4. Find the best target in range (findBestCantripTarget).
 *      If no target in range for ANY cantrip → return null (fall to weapons).
 *   5. Compute weight for each candidate (tags × context × finisher).
 *   6. Return the highest-weight candidate as a 'cast' PlannedAction.
 *   7. Ties → highest damage sides, then alphabetical.
 *
 * Returns null if:
 *   - No `monsterSpellcasting`.
 *   - No cantrip templates match (all utility/unimplemented).
 *   - No target in range for any matching cantrip.
 *   - The monster has no action budget left (caller checks — but we guard too).
 *
 * The returned PlannedAction uses type 'cast' so it dispatches through the
 * existing `case 'cast':` branch in combat.ts → resolveAttack. No new case
 * branch is needed (RFC §5.2).
 */
export function selectMonsterSpell(
  self: Combatant,
  bf: Battlefield,
): PlannedAction | null {
  const sc = self.monsterSpellcasting;
  if (!sc) return null;

  // Collect candidate spell names (cantrips + at-will).
  // Cantrips: slots[0].spells (level 0 = at-will cantrips).
  // At-will: sc.atWill (may include leveled at-will spells — Phase 2 handles
  // those via GENERIC_SPELLS; Phase 1 only handles cantrip-template matches).
  const candidates = new Set<string>();
  if (sc.atWill) for (const s of sc.atWill) candidates.add(s);
  if (sc.slots?.[0]?.spells) for (const s of sc.slots[0].spells) candidates.add(s);

  if (candidates.size === 0) return null;

  // Build the context once.
  const ctx = computeSpellcastContext(self, bf);

  // If no living enemies at all, bail (let the planner pick a non-combat action).
  if (ctx.enemyCount === 0) return null;

  // Score each candidate cantrip.
  let bestPlan: PlannedAction | null = null;
  let bestWeight = 0;
  let bestDmgSides = 0;
  let bestName = '';

  for (const spellName of candidates) {
    const tmpl = lookupCantripTemplate(spellName);
    if (!tmpl) continue;  // Doubt #1/#6: skip unimplemented + utility cantrips

    // Find the best target in range for this cantrip.
    // ── RFC-VISION-AUDIO Phase 3 Q5: visible-target gating ──
    // If this cantrip requires "a creature you can see", only consider
    // visually detected enemies as targets.
    const target = findBestCantripTarget(self, bf, tmpl.rangeFt, requiresVisibleTarget(tmpl.name));
    if (!target) continue;  // no target in range → skip this cantrip

    // Compute average damage (for finisher bonus + scoring).
    const diceCount = cantripDiceCount(self.casterLevel);
    const avgDmg = cantripAverageDamage(diceCount, tmpl.damageSides);

    // ── RFC-PATTERN-BIAS-AI Phase 1: collect pattern biases ──
    // Each detector returns a multiplier (1.0 = neutral, >1.0 = boost,
    // <1.0 = penalise, 0.0 = veto). They compose multiplicatively.
    const biases = collectCantripBiases(
      ctx, bf, self, target, tmpl.tags, avgDmg,
      tmpl.attackRoll, tmpl.saveAbility as AbilityScore | undefined,
    );

    // Compute weight (now includes pattern bias composition).
    const weight = computeSpellWeight(
      tmpl.name, tmpl.tags, 0, avgDmg, ctx, target.currentHP, biases,
    );

    // Tie-breaking: higher weight wins; ties → higher damage sides; then alpha.
    if (weight > bestWeight
        || (weight === bestWeight && weight > 0
            && (tmpl.damageSides > bestDmgSides
                || (tmpl.damageSides === bestDmgSides && tmpl.name < bestName)))) {
      bestWeight = weight;
      bestDmgSides = tmpl.damageSides;
      bestName = tmpl.name;

      const action = buildCantripAction(self, tmpl);
      bestPlan = {
        type: 'cast',
        action,
        targetId: target.id,
        description: `${self.name} casts ${tmpl.name} at ${target.name}`,
      };
    }
  }

  return bestPlan;
}

// ---- Phase 2/3 Forward-Compat Helpers (stubbed) -------------

/**
 * Phase 2: Initialize `monsterSpellSlots` from `monsterSpellcasting.slots`.
 * Called at combat start (to be wired in Phase 2). Stubbed here for
 * forward-compat — does nothing in Phase 1.
 */
export function initMonsterSpellSlots(_monster: Combatant): void {
  // Phase 2: populate monster.monsterSpellSlots from monsterSpellcasting.slots.
  // Phase 1: no-op (at-will + cantrips don't consume slots).
}

/**
 * Phase 2: Consume a monster spell slot of the given level.
 * Stubbed for forward-compat. Phase 1 doesn't call this.
 */
export function consumeMonsterSpellSlot(_monster: Combatant, _level: number): boolean {
  // Phase 2: decrement monster.monsterSpellSlots[level].remaining.
  return true;  // Phase 1: always "succeeds" (at-will = infinite)
}

/**
 * Phase 3: Initialize `monsterDailyUses` from `monsterSpellcasting.daily`.
 * Stubbed for forward-compat.
 */
export function initMonsterDailyUses(_monster: Combatant): void {
  // Phase 3: populate monster.monsterDailyUses from monsterSpellcasting.daily.
}
