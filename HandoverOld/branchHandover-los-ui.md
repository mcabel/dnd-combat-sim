# branchHandover — los-ui

## Branch
`feature/los-ui` — branched from main at commit `357c271` (Session 30: LOS/Cover system)

## Purpose
Build the obstacle-placement UI and battlefield visualisation in the web simulator.
All work is in `docs/simulator.html` and `src/server.ts` only.
**Do NOT touch** `src/engine/`, `src/ai/`, `src/types/core.ts`, or any `*.test.ts` file.

---

## What main-agent committed (357c271) — your contract

### New type: `Obstacle` (in `src/types/core.ts`)
```typescript
interface Obstacle {
  id: string;
  x: number;        // grid square, left edge
  y: number;        // grid square, top edge
  z: number;        // reserved for 3D — always 0 for flat encounters
  width: number;    // grid squares on X axis
  depth: number;    // grid squares on Y axis
  height: number;   // reserved for 3D — always 1 for flat
  blocksMovement: boolean;  // wall/pillar/closed door → cover
  blocksVision: boolean;    // fog cloud/curtain → disadvantage
  isOpen?: boolean;         // when true: bypasses both flags (open door)
}
```

### `Battlefield` now has `obstacles?: Obstacle[]`
`makeFlatBattlefield(w, h, combatants)` still works unchanged.
To add obstacles, set `battlefield.obstacles = [...]` after construction.

### Server endpoint contract
`POST /api/simulate` — add `obstacles` array to the request body:
```json
{
  "party": [...],
  "enemies": [...],
  "obstacles": [
    { "id": "W1", "x": 5, "y": 0, "z": 0,
      "width": 1, "depth": 10, "height": 1,
      "blocksMovement": true, "blocksVision": true }
  ]
}
```
The server should take this array and set `battlefield.obstacles = obstacles` before
calling `runCombat`. Parse with `Obstacle[]` from `core.ts`.

---

## Your Tasks (priority order)

### Task 1 — Server: accept obstacles in /api/simulate
**File:** `src/server.ts`
**What to do:**
- In the `POST /api/simulate` handler, read `req.body.obstacles` (default `[]`)
- After `makeFlatBattlefield(...)`, set `battlefield.obstacles = req.body.obstacles ?? []`
- Validate each obstacle has `x, y, width, depth, blocksMovement, blocksVision` (reject 400 if malformed)
- Forward the battlefield with obstacles to `runCombat`
**Test:** Send a POST with an obstacles array and confirm it doesn't error.

### Task 2 — UI: Obstacle palette + placement on grid
**File:** `docs/simulator.html`
**What to do:**
- Add an "Obstacles" panel to the sidebar (dark/gold D&D theme matching the existing UI)
- Palette items (drag-or-click-to-place):
  - 🧱 **Wall** — `blocksMovement: true, blocksVision: true`
  - 🏛️ **Pillar** — `blocksMovement: true, blocksVision: true`, 1×1
  - 🚪 **Door (closed)** — `blocksMovement: true, blocksVision: true`
  - 🚪 **Door (open)** — `isOpen: true`
  - 🌫️ **Fog Cloud** — `blocksMovement: false, blocksVision: true`
- Click-to-place: clicking a grid square places the selected obstacle
- Click-placed obstacle to remove it
- Display placed obstacles as coloured overlays on the grid:
  - Wall/Pillar: dark grey semi-transparent
  - Fog Cloud: light blue semi-transparent
  - Closed Door: brown; Open Door: lighter brown
- Track all placed obstacles in a JS array: `let placedObstacles = []`
- Include obstacles in the JSON body when the user clicks **Run Simulation**

### Task 3 — UI: Cover indicator overlay (optional, if time allows)
**File:** `docs/simulator.html`
- After a simulation run, show cover state for each enemy combatant vs the first party member:
  - Green badge = No Cover
  - Yellow badge = Half Cover
  - Orange badge = Three-Quarters Cover
  - Red badge = Total Cover
- This is cosmetic; don't call `computeLOS` from the frontend.
  Instead, expose a `GET /api/cover?from=id1&to=id2` route in the server that returns
  the LOSResult JSON from the engine.

---

## Conflict Map — files you must NOT touch

| File | Owner | Why |
|------|-------|-----|
| `src/engine/los.ts` | main-agent | Core LOS engine |
| `src/engine/combat.ts` | main-agent | Cover integrated in resolveAttack |
| `src/types/core.ts` | main-agent | Obstacle type lives here |
| `src/test/los.test.ts` | main-agent | LOS tests |
| `src/ai/planner.ts` | healing-spells branch (lines 248–265, 515–535) | Don't touch — coordinate with both agents before modifying |

**Safe to modify:** `docs/simulator.html`, `src/server.ts`

---

## Known Conflicts with Healing-Spells Branch
The healing-spells branch modified `src/ai/planner.ts` lines 248–265 and 515–535.
- **Your branch does not touch `planner.ts`** — no conflict.
- When rebasing onto main after healing-spells merges: rebase `feature/los-ui`
  onto the new main and re-test `server.test.ts`.

---

## Merge Criteria (before opening PR to main)
- [ ] `POST /api/simulate` with obstacles array does not error
- [ ] Placed obstacles are sent correctly in the simulation request body
- [ ] `server.test.ts` still passes (run `timeout 45 npx ts-node src/test/server.test.ts`)
- [ ] No `import` from `src/engine/` or `src/ai/` in `simulator.html` (browser has no Node)
- [ ] No changes to any `*.test.ts` file other than server.test.ts if server contract changed

---

## Branching Instructions
```bash
# Clone and create your branch
git clone https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git
cd dnd-combat-sim
git checkout -b feature/los-ui

# Work, then push
git config user.email "mcabel@users.noreply.github.com"
git config user.name "mcabel"
git add docs/simulator.html src/server.ts
git commit -m "feature/los-ui: obstacle placement UI + server endpoint"
git push origin feature/los-ui
```

## Run Tests
```bash
export TS_NODE_COMPILER_OPTIONS='{"lib":["ES2020","DOM"],"types":["node"]}'
timeout 45 npx ts-node src/test/server.test.ts 2>&1 | grep "Results:"
```
