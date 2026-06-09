# LOS System: Design Decisions for dnd-combat-sim

Reference spec: `specLOS.md` (provided Session 30)
Scope: PHB 2014 / MM 2014 / SAC v2.7

---

## Decisions vs. Provided Spec

### Coordinate System — SIMPLIFIED
**Spec:** 60 EU per 5ft grid square (designed for a 3D renderer).  
**Decision:** Grid squares stay as the unit of measure (1 GS = 5ft), matching all
existing code. Ray-casting uses floats where 1.0 = one grid square. No EU layer.
**Reason:** Adding a 60:1 scale to a pure-simulation TypeScript project adds
complexity with zero benefit.

### LUT Sine/Cosine Tables — DROPPED
**Spec:** Pre-compute 360-step sin/cos LUT to avoid runtime trig.  
**Decision:** Use `Math.sin`/`Math.cos` directly; only called at event-time (per
attack), not per-frame. Profiling can revisit if the simulator ever becomes
performance-critical.

### Precision Tier — LV1 ONLY (initially)
**Spec:** Three tiers — LV1 (4×4 corners, 2D), LV2 (8×8 vertices, 3D), LV3
(sub-voxelization for large creatures).  
**Decision:** Implement LV1 only. All current combat is on a flat (z=0) grid.
LV2 promoted to a deferred feature flag when vertical combat is added.
LV3 (sub-voxelization) is not in scope for this project.  
**Details of LV1:**
- Source nodes: 4 corners of attacker's base footprint
- Target nodes: 4 corners of target's base footprint
- Best source corner = most clear paths to target corners (0–4)
- Cover state derived from best clear count ÷ 4

### Frustum Optimization — DROPPED
With LV1's 4×4 = 16 rays per check, no optimization is needed.

### AABB Footprints — Simplified
Size codes follow existing fivetools convention ('T','S','M','L','H','G').

| Size | Code | Footprint (grid squares) |
|------|------|--------------------------|
| Tiny | T | 0.5 × 0.5 (centered in square) |
| Small | S | 1 × 1 |
| Medium | M | 1 × 1 |
| Large | L | 2 × 2 |
| Huge | H | 3 × 3 |
| Gargantuan | G | 4 × 4 |

Tiny creatures are treated as 0.5 × 0.5 centered in their grid square for
ray-casting. For all others the footprint origin = `pos` (top-left corner in
continuous grid coordinates).

### Obstacle Geometry — Grid-Square-Filling Rectangles
**Spec:** Implies edge-based wall geometry.  
**Decision:** Obstacles occupy a rectangle of grid squares (defined by `x, y,
width, depth`). This matches how the UI will place them and maps cleanly to the
ray-casting slab method. Edge-based thin walls are a future enhancement.

### 3D / Z-Axis — DEFERRED
All current combat is flat. The `Obstacle` type includes a `z` and `height`
field for forward-compatibility, but LOS computations use only X and Y.

### Creature-as-Cover — DEFERRED
In PHB rules, creatures can provide cover to other creatures. The initial
implementation only uses static `Obstacle` objects. A future pass will let the
caller optionally pass `otherCombatants` as soft obstacle sources.

### AoE Shapes — SEPARATE MILESTONE (not LOS/cover)
Thunderwave "Self (Cube)", Fireball sphere, BFS fluid routing — these are all
confirmed for implementation but scoped to **Milestone 3** in a later session.
The Thunderwave reference image (4 cube placements relative to caster) confirms
the projection mechanic: the entire cube volume expands OUTSIDE the caster's
space, anchored to a chosen outer face.

---

## Cover Mapping (kept exactly as spec)

| Clear Rays (out of 4 target nodes) | Cover State | Mechanical Effect |
|------------------------------------|-------------|-------------------|
| 4/4 (100%) | None | No modifier |
| 2–3/4 (50–75%) | Half Cover | +2 AC and DEX saves |
| 1/4 (25%) | Three-Quarters Cover | +5 AC and DEX saves |
| 0/4 (0%) | Total Cover | Cannot be targeted |

---

## What IS Implemented (Milestone 1 + 2)

1. **`src/types/battlefield.ts`** — `Obstacle`, `Battlefield`, `LOSResult`,
   `CoverState`, `Vec2`, `AABB2D` type definitions.
2. **`src/engine/los.ts`** — LOS computation engine (LV1, 2D).
3. **`CombatState.battlefield?: Battlefield`** — Optional field, fully
   backward-compatible (all existing tests pass unchanged).
4. **Cover integration in `resolveAttack`** — Apply `coverACBonus` to effective
   AC; short-circuit if total cover.
5. **`src/test/los.test.ts`** — Unit tests for geometry functions and LOS
   integration cases.

## Obstacle Metadata (kept exactly as spec §6.2)
- `blocksMovement: boolean` — Physical Line of Effect (walls, pillars, closed doors).
- `blocksVision: boolean` — Visual Line of Sight (fog clouds, heavy curtains).
- `isOpen?: boolean` — When `true`, bypasses BOTH `blocksMovement` and
  `blocksVision` for that obstacle (open door/window).

## LOS vs. Line of Effect (kept as spec §3.1)
- **Line of Effect blocked** → cannot target (total cover) or cover bonus applies.
- **Line of Sight blocked** → attack has disadvantage (handled in adv_system).

---

## Deferred / Out of Scope
- LV2 (3D 8-vertex), LV3 (sub-voxelization)
- Frustum optimization
- Creature-as-cover
- AoE shapes (Milestone 3)
- Phase 8-H day simulation (Sonnet flag)
