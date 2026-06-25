// ============================================================
// Perception + Detection Subsystem — RFC-VISION-AUDIO Phase 1
//
// Module: src/engine/perception.ts
//
// Implements the v1 vision + audio detection model per the RFC and the
// user's 6 answers (recorded in zHANDOVER-SESSION-60.md):
//
//   1. Sound formula:   passivePerception × 5 ft (Chebyshev distance)
//   2. Hide requires:   obscurement (smoke, fog, invisibility, darkness,
//                        obstacles) — NOT plain sight
//   3. Hidden persists: until noisy activity (cast with verbal component,
//                        attack). Whispering to allies (5 ft) doesn't break;
//                        voice warning / illusion does.
//   4. Detection model: 4-state (visible / hidden / position-known / unknown)
//   5. Light level:     use existing `battlefield.lightLevel` field
//   6. Active perception: allowed (spends ACTION) — contests Stealth
//
// v1 scope (Phase 1 — DONE):
//   - Generalized Hide action (any creature, not just Rogues with Cunning
//     Action). Requires obscurement/cover/invisible.
//   - Sound detection: isAudiblyDetected() = pp × 5ft, suppressed if the
//     target has the 'hidden' condition.
//   - 4-state detection classifier: getDetectionState().
//   - updateDetectionStates(): refreshes PerceptionMemory.detection for all
//     observers at the start of each combatant's turn.
//   - Active Perception action: tryActivePerception() — contests hidden
//     enemies' Stealth rolls.
//   - Stealth-break on cast: breaksStealthOnCast() + revealOnCast().
//
// Phase 2 (DONE — Session 63): vision modes consumed.
//   - isVisuallyDetected() now checks observer.senses.darkvision/blindsight/
//     truesight/tremorsense per RFC-VISION-AUDIO §4.3.
//   - lightLevel 'darkness' added: normal vision can't see; darkvision sees.
//   - canTakeHideAction() allows hiding in 'darkness' (heavy obscurement).
//   - Override senses (truesight/blindsight/tremorsense) bypass light +
//     invisibility but still require a physical path (hasLineOfSight).
//
// Phase 3 (DEFERRED): "creature you can see" spell targeting enforcement,
// opportunity-attack visibility gating, planner target filtering by
// visibility, See Invisibility spell consumption.
//
// Phase 4 (DEFERRED): per-cell light sources, fog cloud / Darkness spell as
// mobile obscurement zones, line-of-effect check for blindsight (penetrate
// fog walls without total cover).
// ============================================================

import { Combatant, Battlefield, DetectionState, Condition } from '../types/core';
import { EngineState, CombatEvent } from './combat';
import { computeLOS, hasLineOfSight } from './los';
import { addCondition, removeCondition, abilityMod, proficiencyBonus, rollDie } from './utils';

// ---- Log helper ---------------------------------------------

function emit(
  state: EngineState,
  type: CombatEvent['type'],
  actorId: string,
  desc: string,
  targetId?: string,
  value?: number,
): void {
  state.log.events.push({
    round: state.battlefield.round,
    actorId,
    type,
    targetId,
    value,
    description: desc,
  });
}

// ---- Geometry -----------------------------------------------

/**
 * Chebyshev distance in FEET between two combatants (matches the rest of the
 * engine — all diagonals = 5 ft). Used by the sound attenuation model.
 */
export function chebyshevDistanceFt(a: Combatant, b: Combatant): number {
  return Math.max(
    Math.abs(a.pos.x - b.pos.x),
    Math.abs(a.pos.y - b.pos.y),
    Math.abs(a.pos.z - b.pos.z),
  ) * 5;
}

// ---- Passive Perception -------------------------------------

/**
 * Effective passive Wisdom (Perception) for a combatant.
 *
 * Per PHB p.178: 10 + WIS mod + proficiency (if proficient) + other mods.
 * The 5etools bestiary parser already populates `senses.passivePerception`
 * for all 2401 creatures (Session 60 metadata). For PCs / legacy test
 * factories without that field, we fall back to 10 + WIS mod (no proficiency
 * — PCs would need their own passivePerception populated by the character
 * sheet, which is Sheet's responsibility).
 */
export function getPassivePerception(c: Combatant): number {
  if (c.senses?.passivePerception !== undefined) {
    return c.senses.passivePerception;
  }
  return 10 + abilityMod(c.wis);
}

// ---- Sound Detection (RFC §4.2) -----------------------------

/**
 * Per the user's answer #1: a creature is detected by sound if
 *   chebyshev_distance(observer, target) × 5  ≤  observer.pp × 5
 *   AND the target has NOT taken the Hide action (the 'hidden' condition
 *   suppresses sound — RFC §4.2 v1 simplification).
 *
 * Dead/unconscious targets produce no sound. Same-faction screening is the
 * caller's responsibility (this function is faction-agnostic).
 *
 * Examples:
 *   Goblin (pp 9):  detects sound within 45 ft
 *   Adult Red Dragon (pp 23): within 115 ft
 *   Bat (pp 11): within 55 ft (but has blindsight 60 ft — Phase 2)
 */
export function isAudiblyDetected(
  observer: Combatant,
  target: Combatant,
): boolean {
  if (target.isDead || target.isUnconscious) return false;
  // Hidden creatures are silent (RFC §4.2: "If silent, only visual detection applies").
  if (target.conditions.has('hidden')) return false;
  // Deafened observers can't hear.
  if (observer.conditions.has('deafened')) return false;

  const distFt = chebyshevDistanceFt(observer, target);
  const soundRangeFt = getPassivePerception(observer) * 5;
  return distFt <= soundRangeFt;
}

// ---- Visual Detection (Phase 2 — vision modes consumed) ------

/**
 * Phase 2 visual detection — consumes the observer's vision modes
 * (darkvision / blindsight / truesight / tremorsense) per RFC-VISION-AUDIO §4.3.
 *
 * A creature is visually detected if ALL of these are true:
 *   1. The target is not dead/unconscious/hidden.
 *   2. The observer is not blinded.
 *   3. An override sense detects the target (bypasses light + invisibility):
 *        a. Truesight (within range) → sees through darkness, invisibility, fog.
 *        b. Blindsight (within range) → detects regardless of light/invisibility.
 *        c. Tremorsense (within range + target not flying) → detects on same surface.
 *      All overrides still require a physical path (hasLineOfSight — they don't
 *      penetrate total cover; penetrating fog walls is a Phase 4 concern).
 *   4. OR normal vision + darkvision applies:
 *        a. The target is not invisible (see_invisibility = Phase 3).
 *        b. Line of sight exists (not blocked by vision-blocking obstacles).
 *        c. The observer can see in the target's light level:
 *             - 'indoors' / 'daylight' (bright): normal vision sees.
 *             - 'dim': normal vision sees (disadv on Perception — not modeled here);
 *               darkvision sees normally.
 *             - 'darkness': normal vision CANNOT see; darkvision sees (as dim).
 *               (Darkvision range check: distFt ≤ senses.darkvision.)
 *
 * v1 simplifications:
 *   - "Disadvantage on sight-Perception in dim light" is NOT modeled here (no
 *     Perception-check subsystem in combat; passive perception is unaffected).
 *   - The Darkness SPELL's "blocks darkvision" rule is handled by the obstacle's
 *     blocksVision: true flag (hasLineOfSight returns false for everyone). The
 *     payload's blocksDarkvision flag is metadata for Phase 4 (per-cell light).
 *   - See Invisibility (the spell) is Phase 3 — not consumed here.
 *   - Override senses still use hasLineOfSight as the path check (they won't
 *     penetrate fog walls — Phase 4 will add a line-of-effect check that only
 *     blocks on total cover, not vision-blocking obstacles).
 */
export function isVisuallyDetected(
  observer: Combatant,
  target: Combatant,
  bf: Battlefield,
): boolean {
  if (target.isDead || target.isUnconscious) return false;
  if (target.conditions.has('hidden')) return false;
  if (observer.conditions.has('blinded')) return false;

  const distFt = chebyshevDistanceFt(observer, target);
  const senses = observer.senses;

  // ---- Override senses (bypass light + invisibility) ----

  // Truesight: sees through darkness, invisibility, fog, illusions.
  // Still needs a physical path (no total cover).
  if (senses?.truesight !== undefined && distFt <= senses.truesight) {
    return hasLineOfSight(observer, target, bf);
  }

  // Blindsight: detects regardless of light or invisibility.
  // Still needs a physical path.
  if (senses?.blindsight !== undefined && distFt <= senses.blindsight) {
    return hasLineOfSight(observer, target, bf);
  }

  // Tremorsense: detects creatures on the same surface (not flying).
  // v1 simplification: "same surface" = target is not flying (flySpeed is null/0).
  // Still needs a physical path.
  if (senses?.tremorsense !== undefined && distFt <= senses.tremorsense) {
    const targetFlying = (target.flySpeed ?? 0) > 0;
    if (!targetFlying) {
      return hasLineOfSight(observer, target, bf);
    }
  }

  // ---- Normal vision + darkvision (subject to light + obscurement) ----

  // Invisible target → can't see with normal vision.
  // Exception: See Invisibility spell (PHB p.274) lets the caster see
  // invisible creatures + objects within 60 ft. The spell sets the
  // `_seeInvisibilityActive` scratch flag (Phase 3 — RFC-VISION-AUDIO §4.3).
  // Truesight (handled above) also sees invisible; See Invisibility is the
  // non-truesight path (wizards/sorcerers/etc. who cast the L2 spell).
  if (target.conditions.has('invisible')) {
    if (observer._seeInvisibilityActive
        && distFt <= 60   // metadata.seeInvisibilityRangeFt (PHB p.274)
        && hasLineOfSight(observer, target, bf)) {
      return true;
    }
    return false;
  }

  // LOS check (vision-blocking obstacles block normal + darkvision).
  if (!hasLineOfSight(observer, target, bf)) return false;

  // Light level check.
  const light = bf.lightLevel ?? 'indoors';
  if (light === 'darkness') {
    // Normal vision can't see in darkness; darkvision sees (as dim).
    if (senses?.darkvision === undefined || distFt > senses.darkvision) {
      return false;
    }
  }
  // 'dim' and 'indoors'/'daylight': normal vision sees. Darkvision helps in dim
  // (removes disadv on Perception — not modeled here). All can see.

  return true;
}

// ---- Detection State Classifier (RFC §4.1) ------------------

/**
 * Classify an observer's detection state toward a target into the 4-state
 * model. Pure function — does not mutate either combatant.
 *
 *   'hidden'         — target has 'hidden' condition (observer doesn't know
 *                      their position regardless of sound/LOS).
 *   'visible'        — observer can see the target (LOS + not invisible/hidden).
 *   'position-known' — can't see the target BUT can hear them (within
 *                      pp × 5ft, target not hidden).
 *   'unknown'        — can't see or hear the target.
 *
 * Same-faction screening is the caller's responsibility. Dead/unconscious
 * targets return 'unknown'.
 */
export function getDetectionState(
  observer: Combatant,
  target: Combatant,
  bf: Battlefield,
): DetectionState {
  if (target.isDead || target.isUnconscious) return 'unknown';

  // Hidden condition dominates — observer doesn't know the target's position.
  if (target.conditions.has('hidden')) return 'hidden';

  if (isVisuallyDetected(observer, target, bf)) return 'visible';
  if (isAudiblyDetected(observer, target)) return 'position-known';
  return 'unknown';
}

// ---- Detection State Refresh --------------------------------

/**
 * Refresh the detection map for ONE observer: classify every OTHER living
 * combatant. Called by updateDetectionStates() at the start of each
 * combatant's turn (for ALL observers, not just the actor — perception is
 * symmetric and continuous).
 *
 * Same-faction targets are still tracked (allies can see/hear each other),
 * but downstream consumers (planner, attack adv/disadv) filter by faction.
 *
 * Initializes `observer.perception.detection` if absent (lazy init for
 * backward-compat with legacy factories).
 */
export function refreshDetectionForObserver(
  observer: Combatant,
  bf: Battlefield,
): void {
  if (observer.isDead || observer.isUnconscious) return;
  if (!observer.perception.detection) {
    observer.perception.detection = new Map();
  }
  for (const target of bf.combatants.values()) {
    if (target.id === observer.id) continue;
    const state = getDetectionState(observer, target, bf);
    observer.perception.detection.set(target.id, state);
  }
}

/**
 * Refresh detection maps for ALL living observers on the battlefield.
 * Called once at the start of each combatant's turn (O(n²) — fine for v1
 * small combats). Idempotent.
 */
export function updateDetectionStates(bf: Battlefield): void {
  for (const observer of bf.combatants.values()) {
    refreshDetectionForObserver(observer, bf);
  }
}

// ---- Hide Action Requirements (RFC §4.4, user answer #2) ----

/**
 * Per the user's answer #2: a creature can take the Hide action only if
 * they have obscurement (smoke, fog, invisibility, darkness) OR are behind
 * total cover from all enemies.
 *
 * v1 checks (any one is sufficient):
 *   1. The creature is invisible (Invisibility spell, Greater Invisibility,
 *      Superior Invisibility) — can hide anywhere.
 *   2. The battlefield lightLevel is 'dim' (light obscurement — dusk/dawn) OR
 *      'darkness' (heavy obscurement — night/underground). Phase 2 added
 *      'darkness' per RFC-VISION-AUDIO §4.3.
 *   3. At least one vision-blocking obstacle exists on the battlefield AND
 *      no living enemy has line of sight to the hider (the Cunning Action
 *      Hide planner's existing check, generalized to all creatures).
 *
 * Phase 4 will add: per-cell darkness tracking, fog cloud as a mobile
 * obscurement zone, and the Darkness spell as a magical-darkness zone.
 */
export function canTakeHideAction(self: Combatant, bf: Battlefield): boolean {
  // (1) Invisible creatures can always hide.
  if (self.conditions.has('invisible')) return true;

  // (2) Dim light (light obscurement) or darkness (heavy obscurement) —
  // PHB p.183: "dim light... makes Perception checks that rely on sight
  // have disadvantage"; "darkness... creates a heavily obscured area."
  if (bf.lightLevel === 'dim' || bf.lightLevel === 'darkness') return true;

  // (3) Vision-blocking obstacle present AND no living enemy has LOS to self.
  const obstacles = bf.obstacles ?? [];
  const hasVisionObstacle = obstacles.some(o => !o.isOpen && o.blocksVision);
  if (!hasVisionObstacle) return false;

  for (const enemy of bf.combatants.values()) {
    if (enemy.id === self.id) continue;
    if (enemy.faction === self.faction) continue;
    if (enemy.isDead || enemy.isUnconscious) continue;
    if (hasLineOfSight(enemy, self, bf)) return false;  // an enemy can see us
  }
  return true;
}

// ---- Generalized Hide Action (RFC §4.4) ---------------------

/**
 * Execute the Hide action for any combatant (not just Rogues with Cunning
 * Action). Replaces the inline Cunning Action Hide logic in combat.ts.
 *
 * Steps:
 *   1. Requirement check (canTakeHideAction) — if false, log "tries to Hide
 *      but is Exposed!" and bail (no condition added).
 *   2. Roll Dexterity (Stealth) = d20 + DEX mod + proficiency (if the
 *      creature has Stealth proficiency — v1: Rogues always do; monsters
 *      with a `traits` entry containing 'Stealth' do; otherwise no prof).
 *   3. Compare to the highest passive Perception among living enemies.
 *   4. On success: add 'hidden' condition + store the roll in `_stealthRoll`
 *      (for active Perception contests). Log "Hides!".
 *   5. On failure: log "tries to Hide but is Detected!".
 *
 * The log message text MUST match the Cunning Action Hide tests
 * (cunning_action.test.ts §7g/7h): "Hides" on success, "Detected" on fail.
 */
export function tryHide(
  self: Combatant,
  state: EngineState,
): void {
  const bf = state.battlefield;

  // (1) Requirement check.
  if (!canTakeHideAction(self, bf)) {
    emit(state, 'action', self.id,
      `${self.name} tries to Hide but is Exposed! (no obscurement/cover)`,
      self.id);
    return;
  }

  // (2) Stealth roll.
  // v1: assume the creature is proficient in Stealth if it's a Rogue (has
  // cunningAction) OR has 'Stealth' in its traits. PHB p.96: Rogues always
  // have Stealth proficiency. Monsters: 5etools `skill` field would tell us,
  // but it's not parsed yet — fall back to trait-text sniffing.
  const hasStealthProf = !!self.resources?.cunningAction
    || self.traits.some(t => t.toLowerCase().includes('stealth'));
  const profBonus = hasStealthProf ? proficiencyBonus(self.cr) : 0;
  const stealthRoll = rollDie(20) + abilityMod(self.dex) + profBonus;

  // (3) Highest passive Perception among living enemies.
  const enemies = [...bf.combatants.values()].filter(
    c => c.faction !== self.faction && !c.isDead && !c.isUnconscious
  );
  const maxPassivePerception = enemies.length > 0
    ? Math.max(...enemies.map(e => getPassivePerception(e)))
    : 0;

  // (4/5) Success or failure.
  if (enemies.length === 0 || stealthRoll > maxPassivePerception) {
    addCondition(self, 'hidden');
    self._stealthRoll = stealthRoll;  // store for active Perception contests
    emit(state, 'condition_add', self.id,
      `${self.name} Hides! (Stealth ${stealthRoll} > Passive Perception ${maxPassivePerception})`,
      self.id);
  } else {
    emit(state, 'action', self.id,
      `${self.name} tries to Hide but is Detected! (Stealth ${stealthRoll} ≤ Passive Perception ${maxPassivePerception})`,
      self.id);
  }
}

// ---- Stealth Break on Cast (user answer #3) -----------------

/**
 * Per the user's answer #3: hidden persists until noisy activity.
 *   - Attack → already breaks stealth (resolveAttack line ~1442).
 *   - Cast a spell WITH a verbal component → breaks stealth.
 *   - Spells with NO verbal component (or Subtle Spell metamagic) → do NOT break.
 *   - Whispering to allies within 5 ft → doesn't break (out of scope for v1 —
 *     no whisper action modeled).
 *   - Voice warning / illusion → breaks (requires a new check + action economy;
 *     out of scope for v1).
 *
 * v1 simplification: we don't have per-spell component metadata for all 300+
 * spells. Default = TRUE (verbal component assumed). A small allowlist of
 * known non-verbal spells returns FALSE. Subtle Spell metamagic (Sorcerer)
 * is Phase 2 — when implemented, this function should take the caster and
 * check for a `_subtleSpellActive` flag.
 *
 * Known non-verbal spells (PHB components: V/S/M — only S or S/M are silent):
 *   - Subtle Spell (metamagic) → always silent (Phase 2)
 *   - Counterspell (PHB p.228: S only) — silent
 *   - Message (cantrip) — V/S/M has V, but it's a WHISPER; the user said
 *     whispering to allies (5ft) doesn't break. v1: silent.
 *
 * The allowlist is intentionally short for v1; expanding it is low-risk
 * additive work (no engine changes needed).
 */
const SILENT_SPELLS = new Set<string>([
  'Counterspell',
  'counterspell',
  'Message',
  'message',
]);

export function breaksStealthOnCast(spellName: string | undefined): boolean {
  if (!spellName) return true;  // unknown spell — assume verbal (safe default)
  if (SILENT_SPELLS.has(spellName)) return false;
  return true;
}

/**
 * Engine hook: if a hidden combatant casts a spell with a verbal component,
 * remove their 'hidden' condition and log it. Called from executePlannedAction
 * AFTER the Counterspell check (so a Counterspelled spell doesn't reveal the
 * caster — they didn't actually cast).
 *
 * No-op if the actor isn't hidden or the spell is silent.
 */
export function revealOnCast(
  actor: Combatant,
  spellName: string | undefined,
  state: EngineState,
): void {
  if (!actor.conditions.has('hidden')) return;
  if (!breaksStealthOnCast(spellName)) return;
  removeCondition(actor, 'hidden');
  actor._stealthRoll = undefined;
  emit(state, 'condition_remove', actor.id,
    `${actor.name} is revealed after casting!`,
    actor.id);
}

// ---- Active Perception Action (user answer #6) --------------

/**
 * Execute the active Perception action: spend the ACTION to make a
 * Perception check contesting the highest-Stealth hidden enemy's roll.
 *
 * Per PHB p.177: when you take the Search action, you make a Wisdom
 * (Perception) check. If a hidden creature's Stealth DC (their roll) is
 * ≤ your Perception check, you spot them — they lose 'hidden' against you.
 *
 * v1 simplification:
 *   - The action reveals ONE hidden enemy (the one with the highest Stealth
 *     roll — the hardest to find). On success, that enemy loses 'hidden'
 *     globally (not just vs this observer — simpler and matches the
 *     "you spot them, you point them out" intuition).
 *   - The Perception check is WIS mod + proficiency (if the creature has
 *     Perception proficiency — v1: assume yes for PCs, sniff traits for
 *     monsters). d20 roll + mods.
 *   - If no hidden enemies exist, the action is wasted (log it).
 *
 * Returns true if a hidden enemy was revealed, false otherwise.
 */
export function tryActivePerception(
  self: Combatant,
  state: EngineState,
): boolean {
  const bf = state.battlefield;

  // Find hidden enemies.
  const hiddenEnemies = [...bf.combatants.values()].filter(
    c => c.faction !== self.faction
      && !c.isDead && !c.isUnconscious
      && c.conditions.has('hidden')
  );

  if (hiddenEnemies.length === 0) {
    emit(state, 'action', self.id,
      `${self.name} takes the Search action but sees no hidden enemies.`,
      self.id);
    return false;
  }

  // Perception check.
  const hasPercProf = self.traits.some(t => t.toLowerCase().includes('perception'));
  const profBonus = hasPercProf ? proficiencyBonus(self.cr) : 0;
  const percCheck = rollDie(20) + abilityMod(self.wis) + profBonus;

  // Pick the hidden enemy with the highest Stealth roll (hardest to find).
  // Ties → first in iteration order (deterministic).
  let target = hiddenEnemies[0];
  for (const e of hiddenEnemies) {
    if ((e._stealthRoll ?? 0) > (target._stealthRoll ?? 0)) target = e;
  }
  const stealthDC = target._stealthRoll ?? 0;

  if (percCheck >= stealthDC) {
    removeCondition(target, 'hidden');
    target._stealthRoll = undefined;
    emit(state, 'condition_remove', self.id,
      `${self.name} takes the Search action and spots ${target.name}! (Perception ${percCheck} ≥ Stealth ${stealthDC})`,
      target.id);
    return true;
  } else {
    emit(state, 'action', self.id,
      `${self.name} takes the Search action but fails to spot ${target.name}. (Perception ${percCheck} < Stealth ${stealthDC})`,
      target.id);
    return false;
  }
}

// ---- Planner Helpers ----------------------------------------

/**
 * Find the nearest hidden enemy (by Chebyshev distance). Used by the planner
 * to decide whether to take the Search action.
 *
 * Returns null if no hidden enemies exist.
 */
export function nearestHiddenEnemy(
  self: Combatant,
  bf: Battlefield,
): Combatant | null {
  let best: Combatant | null = null;
  let bestDist = Infinity;
  for (const c of bf.combatants.values()) {
    if (c.id === self.id) continue;
    if (c.faction === self.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    if (!c.conditions.has('hidden')) continue;
    const d = chebyshevDistanceFt(self, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/**
 * Count living enemies that are NOT hidden from the observer (i.e. visible
 * or position-known). Used by the planner to decide if there are any
 * targetable enemies.
 *
 * Requires the detection map to be populated (refreshDetectionForObserver).
 * If the map is absent (legacy combatant), falls back to: count all living
 * enemies without the 'hidden' condition.
 */
export function countTargetableEnemies(
  self: Combatant,
  bf: Battlefield,
): number {
  const detection = self.perception.detection;
  let count = 0;
  for (const c of bf.combatants.values()) {
    if (c.id === self.id) continue;
    if (c.faction === self.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    if (detection) {
      const state = detection.get(c.id) ?? 'unknown';
      if (state === 'visible' || state === 'position-known') count++;
    } else {
      // Legacy fallback: hidden = untargetable; everything else = targetable.
      if (!c.conditions.has('hidden')) count++;
    }
  }
  return count;
}

/**
 * Count enemies that the combatant can visually detect (visible only,
 * not position-known). Used by the planner for "creature you can see"
 * spell targeting — these spells can ONLY target visible enemies.
 *
 * RFC-VISION-AUDIO Phase 3 Q5.
 */
export function countVisiblyDetectedEnemies(
  self: Combatant,
  bf: Battlefield,
): number {
  const detection = self.perception.detection;
  let count = 0;
  for (const c of bf.combatants.values()) {
    if (c.id === self.id) continue;
    if (c.faction === self.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    if (detection) {
      if (detection.get(c.id) === 'visible') count++;
    } else {
      // Legacy fallback: no detection map → check conditions.
      // Not hidden + not invisible = visible (v1 simplification).
      if (!c.conditions.has('hidden') && !c.conditions.has('invisible')) count++;
    }
  }
  return count;
}

/**
 * Return the list of living enemies the observer can target — i.e. those
 * whose detection state is 'visible' or 'position-known'. Enemies that are
 * 'hidden' (took Hide action, position unknown) or 'unknown' (lost track)
 * are excluded — you can't attack or cast at a creature whose position you
 * don't know.
 *
 * This is the list-returning companion to countTargetableEnemies(). Used by
 * the planner's target-selection functions (targeting.ts) to enforce
 * RFC-VISION-AUDIO Phase 3: don't target enemies you can't perceive.
 *
 * Requires the detection map to be populated (refreshDetectionForObserver).
 * If the map is absent (legacy combatant / test factory), falls back to:
 * all living enemies without the 'hidden' condition (backward-compatible).
 *
 * Note: 'position-known' targets (heard but not seen) ARE included — attacks
 * against them are valid (with disadvantage, handled by attackAdvantageState).
 * "Creature you can see" spell enforcement is a separate concern (Phase 3 Q5).
 */
export function targetableEnemiesOf(
  self: Combatant,
  bf: Battlefield,
): Combatant[] {
  const detection = self.perception.detection;
  const result: Combatant[] = [];
  for (const c of bf.combatants.values()) {
    if (c.id === self.id) continue;
    if (c.faction === self.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    if (detection) {
      const state = detection.get(c.id) ?? 'unknown';
      if (state === 'visible' || state === 'position-known') result.push(c);
    } else {
      // Legacy fallback: hidden = untargetable; everything else = targetable.
      if (!c.conditions.has('hidden')) result.push(c);
    }
  }
  return result;
}

/**
 * Count living hidden enemies (for planner: should I take the Search action?).
 */
export function countHiddenEnemies(
  self: Combatant,
  bf: Battlefield,
): number {
  let count = 0;
  for (const c of bf.combatants.values()) {
    if (c.id === self.id) continue;
    if (c.faction === self.faction) continue;
    if (c.isDead || c.isUnconscious) continue;
    if (c.conditions.has('hidden')) count++;
  }
  return count;
}

// ---- "Creature You Can See" Spell Enforcement (Phase 3 Q5) ----

/**
 * Set of spell names that require "a creature you can see" as a target.
 *
 * Per PHB / XGE spell descriptions, these spells explicitly state
 * "a creature you can see" in their targeting clause. If the caster
 * cannot visually detect the target, the spell cannot be cast.
 *
 * This is a hardcoded v1 set. A more robust approach would parse the
 * spell description for the phrase, but that's Phase 4+ scope.
 *
 * Sources: PHB 2014 spell descriptions, Xanathar's Guide to Everything.
 */
const SPELLS_REQUIRING_VISIBLE_TARGET: ReadonlySet<string> = new Set([
  // Cantrips
  'Chill Touch',       // "a creature you can see within range"
  'Eldritch Blast',    // "a creature you can see within range"
  'Fire Bolt',         // "a creature you can see within range"
  'Guidance',          // "a creature you can see" (willing)
  'Guiding Bolt',      // "a creature you can see within range"
  'Mind Sliver',       // "a creature you can see within range"
  'Sacred Flame',      // "a creature you can see within range"
  'Spare the Dying',   // "a creature you can see within range"
  'Toll the Dead',     // "a creature you can see within range"
  'Vicious Mockery',   // "a creature you can see within range"
  // Level 1
  'Blindness/Deafness',// "a creature you can see within range"
  'Bless',             // "up to three creatures of your choice" (visible implied)
  'Bane',              // "up to three creatures of your choice" (visible implied)
  'Cause Fear',        // "a creature you can see within range"
  'Charm Person',      // "a humanoid you can see within range"
  'Command',           // "a creature you can see within range"
  'Compelled Duel',    // "a creature you can see within range"
  'Detect Evil and Good', // "a creature you can see" (touch range but see required)
  'Dissonant Whispers',// "a creature you can see within range"
  'Entangle',          // area effect (no "you can see" — NOT included)
  'Friends',           // "a creature you can see within range"
  'Hex',               // "a creature you can see within range"
  'Hunter\'s Mark',    // "a creature you can see within range"
  'Inflict Wounds',    // "a creature you can see within range" (touch, but see required)
  'Ray of Sickness',   // "a creature you can see within range"
  'Shield of Faith',   // "a creature you can see within range"
  'Sapping Sting',     // "a creature you can see within range"
  'Silvery Barbs',     // "when a creature you can see"
  'Tasha\'s Hideous Laughter', // "a creature you can see within range"
  'Thunderous Smite',  // self-buff (no target — NOT included)
  'Wrathful Smite',    // self-buff (no target — NOT included)
  'Zephyr Strike',     // self-buff (no target — NOT included)
  // Level 2
  'Blindness/Deafness',// already listed (can be upcast)
  'Blur',              // self-buff (NOT included)
  'Calm Emotions',     // "each humanoid in a 20-foot radius you can see" (area, but see)
  'Charm Monster',     // "a creature you can see within range"
  'Crown of Madness',  // "a humanoid you can see within range"
  'Hold Person',       // "a humanoid you can see within range"
  'Invisibility',      // "a creature you touch" (NOT "you can see" — NOT included)
  'Mind Spike',        // "a creature you can see within range"
  'Phantasmal Force',  // "a creature you can see within range"
  'Ray of Enfeeblement', // "a creature you can see within range"
  'See Invisibility',  // self-buff (NOT included)
  'Shadow Blade',      // self-buff (NOT included)
  'Suggestion',        // "a creature you can see within range"
  'Web',               // area effect (NOT included)
  // Level 3
  'Bestow Curse',      // "a creature you can see within range" (touch variant exists, but base is "you can see")
  'Clairvoyance',      // self-buff (NOT included)
  'Counterspell',      // reaction to a spell (NOT "creature you can see" — it's "a spell")
  'Dispel Magic',      // object/creature/effect (NOT "creature you can see" specifically)
  'Enemies Abound',    // "a creature you can see within range"
  'Fear',              // cone (NOT "creature you can see" — area)
  'Fast Friends',      // "a creature you can see within range"
  'Hypnotic Pattern',  // area effect (NOT included)
  'Lightning Bolt',    // line effect (NOT included)
  'Spirit Guardians',  // self-buff (NOT included)
  'Vortex Warp',       // "a creature you can see within range"
  // Level 4
  'Banishment',        // "a creature you can see within range"
  'Blight',            // "a creature you can see within range"
  'Charm Monster',     // already listed
  'Dominate Beast',    // "a beast you can see within range"
  'Greater Invisibility', // self-buff (NOT included)
  // Level 5
  'Contagion',         // "a creature you can see within range"
  'Dominate Person',   // "a humanoid you can see within range"
  'Geas',              // "a creature you can see within range"
  'Hold Monster',      // "a creature you can see within range"
  'Mind Spike',        // already listed (upcast)
  // Level 6
  'Disintegrate',      // "a creature you can see within range"
  'Dominate Monster',  // "a creature you can see within range"
  'Eyebite',           // self-activated (choose target each round — "a creature you can see")
  'Flesh to Stone',    // "a creature you can see within range"
  'Mass Suggestion',   // "up to twelve creatures you can see"
  'Sunbeam',           // line effect (NOT "creature you can see" — it's a line)
  'True Seeing',       // self-buff (NOT included)
  // Level 7
  'Finger of Death',   // "a creature you can see within range"
  'Power Word Pain',   // "a creature you can see within range"
  'Psychic Scream',    // "up to ten creatures you can see"
  // Level 8
  'Dominate Monster',  // already listed
  'Feeblemind',        // "a creature you can see within range"
  'Glibness',          // self-buff (NOT included)
  'Power Word Stun',   // "a creature you can see within range"
  'Sunburst',          // area effect (NOT included)
  // Level 9
  'Foresight',         // self/other buff (touch — NOT "you can see")
  'Power Word Kill',   // "a creature you can see within range"
  'Weird',             // area effect (NOT included)
  // Monster / NPC spells
  'Antagonize',        // "a creature you can see within range"
  'Maddening Dark',    // area effect (NOT included)
  'Superior Invisibility', // self-buff (NOT included)
]);

/**
 * Check if a spell requires "a creature you can see" targeting.
 */
export function requiresVisibleTarget(spellName: string): boolean {
  return SPELLS_REQUIRING_VISIBLE_TARGET.has(spellName);
}

/**
 * Check if a caster can target a specific creature with a spell that
 * requires "a creature you can see" targeting.
 *
 * Returns true if:
 *   - The spell does NOT require visible targeting, OR
 *   - The caster can visually detect the target
 *
 * Returns false if:
 *   - The spell requires visible targeting AND the caster cannot
 *     visually detect the target (hidden, position-known, unknown,
 *     or invisible without see invisibility/truesight)
 */
export function canTargetWithSpell(
  caster: Combatant,
  target: Combatant,
  spellName: string,
  bf: Battlefield,
): boolean {
  if (!requiresVisibleTarget(spellName)) return true;
  return isVisuallyDetected(caster, target, bf);
}
