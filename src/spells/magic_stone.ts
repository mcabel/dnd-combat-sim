// ============================================================
// Magic Stone — XGE p.160 (reprinted from EEPC p.20)
// Level 0 transmutation cantrip
//
// Casting time: bonus action (XGE p.160 — CANON NOTE: this is
//   one of the few cantrips that casts as a bonus action, like
//   Shillelagh. The Session 10 handover didn't explicitly call
//   this out, but the 5etools spell-cache JSON lists
//   "time":[{"number":1,"unit":"bonus"}] — bonus action. This
//   module follows the canon JSON.)
// Range: Touch (the pebbles are the target of the enchantment)
// Components: V + S (no M — the pebbles are the TARGET of the
//   spell, not a material component)
// Duration: 1 minute
// Effect: You touch one to three pebbles and imbue them with
//   magic. You or someone else can make a ranged spell attack
//   with one of the pebbles by throwing it or hurling it with a
//   sling. If thrown, a pebble has a range of 60 feet. If
//   someone else attacks with a pebble, that attacker adds your
//   spellcasting ability modifier, not the attacker's, to the
//   attack roll. On a hit, the target takes bludgeoning damage
//   equal to 1d6 + your spellcasting ability modifier. Whether
//   the attack hits or misses, the spell then ends on the stone.
//
//   If you cast this spell again, the spell ends on any pebbles
//   still affected by your previous casting.
//
// Scaling: NONE (Magic Stone does NOT scale at 5/11/17 — the
//   1d6 + spellcasting mod is flat at all levels. This is one
//   of the few cantrips with no scaling track.)
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — SELF-THROW mode only,
// modeled as a single action that does the ranged spell attack):
// ────────────────────────────────────────────────────────────
// Magic Stone v1 is a vanilla RANGED SPELL ATTACK — the same
// pattern as Fire Bolt (PHB p.242) but:
//   - 1d6 + spellcastingMod bludgeoning (vs 1d10 flat fire)
//   - 60 ft throw range (vs 120 ft)
//   - Does NOT scale (vs scales at 5/11/17)
//   - V + S (vs V + S — same)
//
// v1 simplification: implement ONLY the SELF-THROW mode (the
// caster throws their own pebbles as a ranged spell attack).
// The ALLY-THROW mode (the cantrip enchants 1-3 pebbles that
// ALLIES can throw as ranged spell attacks using the CASTER's
// spell attack mod) is documented as TODO via the metadata flag
// `magicStoneAllyThrowV1Implemented: false`. The ally-throw mode
// requires a persistent-enchantment subsystem (tracking which
// pebbles are enchanted, who holds them, and routing the
// caster's spell attack mod through the ally's attack roll) —
// out of scope for this batch.
//
// v1 simplification: canonically, Magic Stone is a BONUS ACTION
// to enchant the pebbles, and throwing a pebble is a separate
// ACTION (the Attack action with the pebble as a ranged spell
// attack). v1 collapses this into a single ACTION that does
// both the enchantment and the throw (the bonus-action economy
// is documented as TODO via the metadata flag
// `magicStoneBonusActionEconomyV1Simplified: true`). The Action
// built from this metadata has costType='action' (NOT
// 'bonusAction') to match the v1 single-action model.
//
// v1 simplification: canonically, the spell lasts 1 minute and
// the caster can throw 1-3 pebbles over multiple actions. v1
// treats each throw as a separate action with no persistent
// enchantment tracking (each throw is a fresh cast + throw).
// Documented via the metadata flag
// `magicStonePersistentEnchantmentV1Simplified: true`.
//
// Damage formula (canon — XGE p.160):
//   1d6 + spellcastingMod bludgeoning
//   The spellcastingMod is the CASTER's spellcasting ability
//   modifier (INT for Wizard, CHA for Sorcerer/Warlock, WIS for
//   Cleric/Druid). On the Combatant, this is the `spellcastingMod`
//   field (defaults to 3 per DEFAULT_SPELLCASTING_MOD in
//   green_flame_blade.ts when undefined).
//
// NO CANTRIP_EFFECTS entry (no post-hit rider).
// NO CANTRIP_SELF_EFFECTS entry (not a self-buff).
// NO CANTRIP_AOE_EFFECTS entry (not a caster-centered AoE).
//
// Routing (per zHANDOVER-SESSION-10):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Magic Stone's Action and a primary target.
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS / CANTRIP_AOE_EFFECTS registries (no
//     match) and falls through to resolveAttack.
//   - resolveAttack's standard attack-roll branch rolls the
//     attack, applies 1d6 + spellcastingMod bludgeoning damage
//     on hit (crit doubles the 1d6 — PHB p.196; the +mod is
//     flat, not doubled).
//
// Note: the +spellcastingMod bonus to damage is part of the
// Action's damage expression (the AI/parser builds the Action
// with damage = { count: 1, sides: 6, bonus: spellcastingMod,
// average: 3 + spellcastingMod }). This module's metadata
// exposes `damageBonusField: 'spellcastingMod'` so the AI/parser
// knows to add the caster's spellcastingMod to the damage bonus.
// ============================================================

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Magic Stone',
  level: 0,
  school: 'transmutation',
  /**
   * Range: Touch (XGE p.160 — the pebbles are the target of the
   * enchantment). The THROW range is 60 ft (canon — XGE p.160:
   * "If thrown, a pebble has a range of 60 feet"). v1 collapses
   * the enchant + throw into a single action, so the Action's
   * range.normal = 60 ft (the throw range). rangeFt reflects the
   * spell's listed range (Touch = 0 ft) for AI/planner metadata.
   *
   * CANON NOTE: the Session 10 handover listed "30 ft (throw
   * range)", but the 5etools spell-cache JSON says "If thrown, a
   * pebble has a range of 60 feet." 30 ft is the SLING range
   * (per PHB p.149); 60 ft is the THROW range. v1 follows the
   * canon 60 ft throw range per the Session 9 protocol of always
   * cross-checking the handover against the 5etools JSON.
   */
  rangeFt: 0,
  /** Throw range (canon — XGE p.160: 60 ft). */
  throwRangeFt: 60,
  concentration: false,
  /**
   * Casting time: BONUS ACTION (XGE p.160 — canon). v1 simplification:
   * the v1 single-action model treats the throw as an ACTION
   * (costType='action' on the built Action), collapsing the
   * bonus-action enchant + action throw into one action. See
   * module header.
   */
  castingTime: 'bonusAction' as const,
  damageDice: '1d6',
  damageType: 'bludgeoning',
  /**
   * Magic Stone does NOT scale at 5/11/17 (XGE p.160 — the 1d6 +
   * spellcasting mod is flat at all levels). This is one of the
   * few cantrips with no scaling track.
   */
  scales: false as const,
  /**
   * Components: V + S (no M — XGE p.160: "Components: V, S"). The
   * pebbles are the TARGET of the spell, not a material component.
   */
  components: { v: true, s: true, m: false } as const,
  /**
   * v1 simplification flag: XGE p.160 allows the CASTER to enchant
   * 1-3 pebbles that ALLIES can throw as ranged spell attacks
   * using the CASTER's spell attack mod. v1 implements ONLY the
   * SELF-THROW mode (the caster throws their own pebbles). The
   * ally-throw mode requires a persistent-enchantment subsystem.
   */
  magicStoneAllyThrowV1Implemented: false as const,
  /**
   * v1 simplification flag: XGE p.160 has Magic Stone as a BONUS
   * ACTION to enchant, with throwing as a separate ACTION. v1
   * collapses these into a single ACTION that does both (the
   * built Action has costType='action', not 'bonusAction').
   */
  magicStoneBonusActionEconomyV1Simplified: true as const,
  /**
   * v1 simplification flag: XGE p.160 says the enchantment lasts
   * 1 minute (multiple throws possible). v1 treats each throw as
   * a separate action with no persistent enchantment tracking
   * (each throw is a fresh cast + throw).
   */
  magicStonePersistentEnchantmentV1Simplified: true as const,
  /**
   * Damage bonus field: the damage formula is 1d6 + spellcastingMod
   * (XGE p.160). The AI/parser reads this metadata field to know
   * that the Action's damage.bonus should be set to the caster's
   * spellcastingMod (NOT zero like Fire Bolt's flat 1d10).
   */
  damageBonusField: 'spellcastingMod' as const,
} as const;
