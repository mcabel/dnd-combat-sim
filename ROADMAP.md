# PROJECT ROADMAP: D&D 5e Combat AI Simulator

This roadmap outlines the structural pillars, core architectural milestones, and upcoming development horizons for the simulator. It serves as a macro-level orientation guide for development agents to ensure architectural consistency across both workstreams.

---

## 1. Core Architectural Principles & Constraints (Immutable)

Any incoming agent must strictly adhere to these fundamental project rules established in the specifications and early design phases:
- **Rule Systems:** Adhere exclusively to PHB 2014, MM 2014, and Sage Advice Compendium v2.7 rulesets. Do not introduce post-2024/OneD&D mechanics under any circumstance.
- **Movement Hierarchy:** The engine operates on Chebyshev 3D grid space calculations. Standard Euclidean math is reserved exclusively for calculating specific circular area-of-effect bounds.
- **Line of Sight (LOS):** Ray-casting is performed at flat 2D Level-1 precision across 4x4 corner sub-coordinates to calculate dynamic cover (+2/+5 AC and Dexterity saves). High-overhead 3D voxelization and creature-based soft-cover algorithms are explicitly out of scope.
- **State Processing:** The combat loop runs deterministically via an asynchronous state machine pool. User interactions on the frontend must interact with live state transitions via inline number and button stepper components, completely bypassing blocking browser routines.
- **Workstream Independence:** The Core Combat AI Engine and the Character Sheet/Party System web views are isolated workstreams governed by separate tracking files. Agents must never cross-contaminate their scopes.

---

## 2. Completed Milestones

### Core Engine & Combat AI (Combat Stream)
- **Combat Loop Execution:** Developed a reliable turn-planning framework supporting standard, bonus, and reaction action economies.
- **Tactical Profiles:** Programmed threat-weighted scoring algorithms supporting multiple AI personas (`smart`, `attackNearest`, `attackWeakest`, `defend`).
- **Resource Management:** Wired internal tracking loops for multi-class resources including spell/pact slots, Rage counters, Divine Smite, and Bardic Inspiration.
- **Environmental & Rule Logic:** Full code implementation for core actions (Grapple, Shove, Help, Dodge), dynamic conditions, and automated opportunity attack evaluation.
- **Data Integration:** Integrated automated 5etools JSON loaders to populate a dynamic backend monster bestiary.

### Character Sheet & Web UI (Sheet Stream)
- **Data Architecture:** Created validated JSON schemas and database storage models managing multi-class Level 1 data blocks, equipment matrices, and status conditions.
- **Interactive DM Dashboard:** Formed a responsive party editor interface enabling live hit-point modification steppers, interactive spell slot pips, condition badges, and collective party summary metrics.
- **Resting & Progression Services:** Functional backend endpoints managing automated long rests, short rests (including hit dice spending logic), and basic milestone XP distribution overrides.

---

## 3. High-Level Horizons

Future development efforts will target these broad structural objectives:
- **Horizon A: Comprehensive Tier-1 Spell System Finalization**
  Systematically expanding the core spell registry to handle the remainder of the Player's Handbook Tier-1 spell data library, focusing on unique execution types (guaranteed-hit paths, vector-mapped cone geometry, and forced-movement reactions).
- **Horizon B: Full Multi-Encounter Adventuring Days**
  Polishing the simulated resource-draining pipelines across chained encounters, ensuring proper handling of automated short/long resting milestones and persistent condition tracking.
- **Horizon C: Unified Simulation Sandboxing**
  Connecting the web-based Party Management interface directly into the custom simulator runner engine, enabling users to launch live simulation instances featuring their curated player character data blocks directly against bestiary encounters.
