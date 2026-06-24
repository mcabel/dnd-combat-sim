# RFC: Vision + Audio Subsystem (Tier-C, TG-010/TG-021)

**Date:** Session 60
**Author:** Z.ai
**Status:** PROPOSED (user directed "A — starting with vision and audio subsystem")
**Risk:** HIGH — touches perception, targeting, stealth, and all attack rolls

---

## 1. Goal

Implement a vision + audio detection subsystem that determines which combatants can perceive each other, enabling:
- Proper stealth/hidden mechanics (not just Cunning Action Hide)
- Invisible creature handling (detected by sound, but not targetable by "creature you can see")
- Darkness/dim light/obscurity effects
- Blindsight/truesight/tremorsense vision modes
- Sound attenuation based on passive perception

---

## 2. Existing Infrastructure (What's Already There)

### Already implemented:
- **`los.ts`** (322 lines): `computeLOS()` returns `LOSResult` with `hasLineOfSight`, `hasLineOfEffect`, `cover` (none/half/three-quarters/total), `coverACBonus`
- **`Combatant.senses`**: `{ darkvision?, blindsight?, truesight?, tremorsense?, passivePerception? }` — parsed from 5etools for all 2401 creatures
- **`Battlefield.lightLevel`**: `'indoors' | 'daylight' | 'dim'` — currently only used by Sunlight Sensitivity
- **`hidden` condition**: grants advantage on attacks + disadvantage on attacks vs hidden creature; removed on attack (Cunning Action Hide, line 3625-3638)
- **`invisible` effect**: grants advantage on attacks + disadvantage on attacks vs invisible creature; ends on attack/cast (Invisibility spell, Greater Invisibility, Superior Invisibility)
- **`PerceptionMemory`**: tracks `lastSeenPos` + `TargetKnowledge` per target per observer
- **Cunning Action Hide** (line 3627): rolls Stealth vs highest passive perception among enemies → grants `hidden`

### What's missing:
- No general "detection" system — all creatures are assumed visible to all enemies at all times
- No sound/audio model — stealth only works via Cunning Action Hide (Rogue-only)
- No darkness/obscurity effect on vision (lightLevel only affects Sunlight Sensitivity)
- No blindsight/truesight/tremorsense consumption (parsed but unused)
- No "creature you can see" targeting check (spells that require visible targets don't check)

---

## 3. 5e Rules Research

### 3.1 Light Levels (PHB p.183)
- **Bright light**: normal vision; most outdoor daytime, torchlight
- **Dim light**: light obscurement; dusk, dawn, bright moonlight; **disadvantage on Wisdom (Perception) checks** that rely on sight
- **Darkness**: heavily obscured; night, dungeon; **can't see at all** (without darkvision/special senses)

### 3.2 Obscurement (PHB p.183)
- **Lightly obscured**: dim light, patchy fog, moderate foliage → disadvantage on Perception (sight)
- **Heavily obscured**: darkness, opaque fog, dense foliage → **can't see through** (effectively blind); creatures inside are effectively hidden from sight (but not sound)

### 3.3 Vision Types (PHB p.185)
- **Normal vision**: needs light; blind in darkness
- **Darkvision**: see in dim light as if bright; see in darkness as if dim (shades of gray); range limited (usually 60 ft)
- **Blindsight**: perceive without sight (sonar, keen smell, etc.); range limited; **ignores darkness/invisibility/obscurment** within range
- **Truesight**: see through darkness, invisibility, illusions, transformations; range limited (usually 120 ft)
- **Tremorsense**: detect + pinpoint vibrations through ground; range limited; needs contact with same surface

### 3.4 Stealth + Hidden (PHB p.177, p.192)
- **Hide action**: Use action (or bonus action if Rogue) → Dexterity (Stealth) check vs passive Wisdom (Perception) of enemies. Success = hidden from those enemies.
- **Requirements to hide**: Must be heavily obscured OR behind total cover OR invisible (can't hide in plain sight unless invisible)
- **Being hidden**: enemies don't know your position; you have advantage on attacks; attacks vs you have disadvantage; you can't be targeted by "a creature you can see" effects
- **Losing hidden**: attack, cast a spell, make noise (shout), move into line of sight of an enemy, or an enemy's active Perception check beats your Stealth
- **Invisible ≠ hidden**: Invisible creatures can still be detected by sound. To be fully undetectable, you must be invisible AND take the Hide action.

### 3.5 Passive Perception (PHB p.178)
- Passive Wisdom (Perception) = 10 + WIS mod + proficiency (if proficient) + other modifiers
- Used as the "default" detection DC — if a creature's Stealth check ≥ your passive perception, they're hidden from you
- Already parsed for all 2401 creatures (`senses.passivePerception`)

---

## 4. Proposed Design

### 4.1 Detection Model

Every combatant has a **detection state** toward every enemy combatant:
```
type DetectionState = 'visible' | 'hidden' | 'position-known' | 'unknown';
```

- **visible**: Can see + hear the target. Can target with attacks + spells. No special modifiers.
- **hidden**: Can't see or hear the target. Don't know their position. Can't target directly (must guess a location).
- **position-known**: Can't see the target (invisible, in darkness, behind cover) but know their position (heard them move, saw them go behind cover, etc.). Can target attacks at disadvantage (can't see), but CAN target "a creature you can see" spells (can't see → blocked).
- **unknown**: Don't know the target exists or their position (never seen them, no sound detected).

**v1 simplification**: All enemies start as `visible` at combat start (no surprise rounds in v1). The detection state changes during combat based on actions + environment.

### 4.2 Sound Attenuation Model

The user specified: "sound attenuation based on passive perception, scaled to integer increments of 5ft non-euclidean."

**Proposed formula** (non-euclidean = Chebyshev distance, same as the rest of the engine):
```
sound_detection_range_ft = passivePerception × 5

A creature is detected by sound if:
  chebyshev_distance(observer, target) × 5 ≤ observer.sound_detection_range_ft
  AND the target has NOT taken the Hide action (spent action/bonus economy)
```

**Examples**:
- Goblin (passive 9): detects sound within 45 ft
- Adult Red Dragon (passive 23): detects sound within 115 ft
- Bat (passive 11): detects sound within 55 ft (but has blindsight 60 ft — see 4.3)

**Sound events that trigger detection** (the user said "creatures are always detected by sound unless they spent any action/bonus economy" — meaning the Hide action suppresses sound):
- Moving (unless you took the Hide action)
- Attacking
- Casting a spell (with verbal component)
- Speaking/shouting

**v1 simplification**: No per-action sound events. A creature is either "producing sound" (default) or "silent" (has the `hidden` condition from taking the Hide action). If silent, only visual detection applies.

### 4.3 Vision Detection

A creature is **visually detected** by an observer if ALL of these are true:
1. **Line of sight** exists (los.hasLineOfSight — not blocked by total cover or heavy obscurement)
2. **The observer can see** in the target's light level:
   - Bright light: normal vision sees
   - Dim light: normal vision sees (with disadvantage on Perception); darkvision sees normally
   - Darkness: normal vision CANNOT see; darkvision sees (as dim); blindsight/truesight/tremorsense see
3. **The target is not invisible** (unless observer has truesight or see invisibility)
4. **The target is not hidden** (hidden = can't be seen, even if invisible — requires taking the Hide action)

**Blindsight override**: If the target is within the observer's blindsight range, the observer perceives the target regardless of light, obscurement, or invisibility (but NOT through total cover — blindsight still needs a path).

**Truesight override**: If within range, truesight sees through darkness, invisibility, illusions, and transformations.

**Tremorsense override**: If the target is on the same surface and within range, detected regardless of sight. Doesn't work on flying creatures.

### 4.4 The "Hidden" Condition (Revised)

The existing `hidden` condition stays, but the trigger is generalized:

**How to become hidden** (requires spending action economy):
1. **Hide action** (action, or bonus action for Rogues with Cunning Action): Roll Dexterity (Stealth) vs highest passive perception among enemies. If successful, gain `hidden` condition. Requirements: must be heavily obscured OR behind total cover OR invisible.
2. **Any action/bonus spent to hide** (the user's directive): In v1, spending an action to hide is the only way to become hidden. This grants `hidden` if the Stealth check succeeds.

**What hidden does**:
- Enemies don't know your position (detection state = `hidden`)
- You have advantage on attacks (first attack only — attacking reveals you)
- Attacks vs you have disadvantage
- You can't be targeted by "a creature you can see" effects
- Moving while hidden: requires a new Stealth check each turn (v1 simplification: hidden persists until you attack, cast, or an enemy beats your Stealth with an active Perception action)

**What ends hidden**:
- Attack (any attack — hit or miss reveals you)
- Cast a spell (with verbal/somatic component)
- Move into line of sight of an enemy (without re-stealthing)
- An enemy uses their action to make a Perception check and beats your Stealth

### 4.5 Invisible vs Hidden (Clarification)

Per the user's directive + 5e rules:
- **Invisible alone**: Can't be seen. But still produces sound → enemies know your position (`position-known`). Attacks vs you have disadvantage (can't see). Your attacks have advantage. You CAN be targeted by attacks (at the right position) but NOT by "a creature you can see" spells.
- **Hidden (took Hide action)**: Can't be seen OR heard. Enemies don't know your position. Can't be targeted at all (must guess a location).
- **Invisible + Hidden**: Both. Enemies don't know your position. This is the strongest stealth state.

---

## 5. Engine Integration Points

### 5.1 Targeting Check (new)
Before any spell or attack that says "a creature you can see":
```
canTargetCaster = isVisuallyDetected(observer, target)
if (!canTargetCaster) → spell fizzles / attack can't be made
```

### 5.2 Attack Roll Modifiers (existing, revised)
```
if (target is hidden from attacker) → disadvantage (can't see)
else if (target is position-known but not visible) → disadvantage (can't see)
else if (target is invisible and attacker doesn't have truesight/see invisibility) → disadvantage

if (attacker is hidden from target) → advantage (unseen attacker)
if (attacker is invisible and target doesn't have truesight/see invisibility) → advantage
```

### 5.3 Perception Update (existing PerceptionMemory, revised)
At the start of each combatant's turn, update detection states:
```
for each enemy:
  if enemy has 'hidden' condition:
    detection[enemy] = 'hidden'
  else if isVisuallyDetected(self, enemy):
    detection[enemy] = 'visible'
    lastSeenPos[enemy] = enemy.pos
  else if isAudiblyDetected(self, enemy):
    detection[enemy] = 'position-known'
    lastSeenPos[enemy] = enemy.pos  // know where the sound came from
  else:
    detection[enemy] = 'unknown'  // lost track
```

### 5.4 Spell Targeting (new check in executePlannedAction)
For spells with "a creature you can see" in their description:
- Check if the caster can visually detect the target
- If not, the spell can't be cast at that target (planner should filter these out)

### 5.5 Opportunity Attacks (new check)
OA requires "a creature you can see" leaving your reach. If the creature is hidden or position-known-but-not-visible, no OA.

---

## 6. Specific Doubts for User Clarification

1. **Sound attenuation formula**: I proposed `sound_range = passivePerception × 5ft`. Is this the right scaling? A goblin (passive 9) would hear within 45 ft; a dragon (passive 23) within 115 ft. Alternative: `sound_range = (passivePerception - 10) × 5ft` (only above-average perceivers hear far). Which do you prefer?

2. **Hide action requirements**: 5e requires "heavily obscured or behind cover" to hide. The user said "spend action/bonus economy → grants hidden." Should v1 require obscurement/cover, or can any creature hide anywhere by spending an action? (5e-accurate = require cover/obscurement; simpler = allow anywhere.)

3. **Hidden on move**: In 5e, staying hidden while moving requires a new Stealth check each turn (or at DM's discretion). Should v1: (A) require a new Stealth check each turn to stay hidden, (B) hidden persists until you attack/cast, or (C) hidden persists for 1 round then auto-reveals?

4. **Position-known vs visible**: I introduced a `position-known` state (can hear but not see). Should v1: (A) implement this 4-state model (visible/hidden/position-known/unknown), or (B) simplify to 2 states (visible/hidden — if you can hear them, you can "see" them well enough to target)?

5. **Darkness/dim light as default**: The `lightLevel` field defaults to `'indoors'` (no light penalty). Should v1: (A) keep this default (most combats are indoors with no light issues), (B) add a `'darkness'` option for night/underground combats, or (C) add per-cell light tracking (complex)?

6. **Active Perception**: Should creatures be able to use their action to make an active Perception check to find hidden enemies? (5e allows this.) Or is passive perception sufficient for v1?

---

## 7. Implementation Plan (Phased)

### Phase 1: Sound + Hidden Generalization (LOW-MEDIUM risk)
- Generalize the `hidden` condition beyond Cunning Action Hide (any creature can take the Hide action)
- Implement sound detection: `isAudiblyDetected(observer, target)` based on passive perception × 5ft
- Add `detection` state tracking to `PerceptionMemory`
- Wire into attack advantage/disadvantage (unseen attacker / can't see target)
- **Covers**: stealth for all classes, basic sound detection, invisible-but-not-hidden

### Phase 2: Vision Modes (MEDIUM risk)
- Implement `isVisuallyDetected(observer, target)` using senses (darkvision, blindsight, truesight, tremorsense)
- Wire lightLevel into vision checks
- Add darkness/dim light combat effects (disadvantage on sight-based Perception)
- **Covers**: darkvision, blindsight, truesight, tremorsense, darkness

### Phase 3: "Creature You Can See" Targeting (MEDIUM risk)
- Add visibility check to spell targeting in executePlannedAction
- Add visibility check to opportunity attacks
- Filter planner targets by visibility
- **Covers**: spell targeting restrictions, OA restrictions

### Phase 4 (DEFERRED): Terrain + Obscurement Integration (HIGH risk)
- Per-cell light sources (torches, light spell, magical darkness)
- Fog cloud, darkness spell as mobile obscurement zones
- Integration with los.ts for dynamic cover
- **Defer until Phase 1-3 stable**

---

## 8. Files to Touch (Phase 1)

- `src/types/core.ts` — `DetectionState` type, update `PerceptionMemory` with detection states
- `src/engine/perception.ts` (NEW) — `isVisuallyDetected()`, `isAudiblyDetected()`, `getDetectionState()`, `updatePerception()`
- `src/engine/combat.ts` — wire detection into attack advantage/disadvantage, spell targeting, OA
- `src/engine/utils.ts` — generalize Hide action (not just Cunning Action)
- `src/ai/planner.ts` — filter targets by visibility, add Hide action for non-Rogues
- `src/test/vision_audio.test.ts` (NEW) — tests

**Minimal overlap with Sheet.** Core Engine owns combat.ts/utils.ts/planner.ts — I'd be touching their files. **Recommendation: do this after Core returns** to avoid clashes, OR have Core review the RFC.
