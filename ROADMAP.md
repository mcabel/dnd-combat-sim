# ROADMAP.md

## PURPOSE

ROADMAP.md defines long-term project direction.

ROADMAP.md is not loaded by default.

Consult ROADMAP.md only when:

* Starting a new objective
* Modifying architecture
* Creating a new subsystem
* Resolving architectural uncertainty
* User explicitly requests roadmap review

ROADMAP.md is not:

* A handover
* A task tracker
* A progress journal
* A session log

---

# PROJECT STRUCTURE

## WORKSTREAM A — CORE COMBAT ENGINE

Purpose:

Deterministic combat simulation and statistical encounter analysis.

Primary systems:

* Combat state machine
* Initiative and turn planning
* Tactical AI
* Resource management
* Spellcasting systems
* Condition systems
* Combat resolution
* Encounter simulation
* Statistical analysis

---

## WORKSTREAM B — CHARACTER SHEET UI

Purpose:

Character and party management.

Primary systems:

* Character creation
* Party management
* Resource tracking
* Condition tracking
* Interactive UI controls
* Dashboard visualization

---

# ARCHITECTURAL RULES

## Stream Isolation

Core Engine and Sheet UI remain independent.

Do not:

* Mix handovers
* Share session tracking
* Create cross-stream implementation dependencies without explicit need

---

## Repository Authority

Repository state is authoritative.

Documentation exists to accelerate navigation.

Documentation does not override code.

Authority order:

Code

>

Latest Relevant HOvr

>

TASK.md

>

ROADMAP.md

>

Project Description

---

## Determinism

Combat simulations must remain reproducible.

Avoid introducing hidden nondeterministic behavior.

Randomness must remain controlled through established engine mechanisms.

---

## Canonical Rules Fidelity

Implement official pre-2024 rules as accurately as practical.

When ambiguity exists:

1. Official rule text
2. Official errata
3. Sage Advice Compendium v2.7

Never use:

* OneD&D
* D&D 2024
* D&D 5.5e
* UA
* Homebrew
* Third-party content

---

# CORE ENGINE MILESTONES

## Combat Engine

* Stable combat loop
* Initiative system
* Action economy
* Conditions framework
* Resource tracking

---

## Movement & Battlefield

* Chebyshev movement
* 3D positioning
* Opportunity attacks
* Difficult terrain
* Cover
* Line of sight

---

## AI

* Tactical evaluation
* Resource preservation
* Target selection
* Encounter adaptation

---

## Spellcasting

* Spell framework
* Spell targeting
* Save resolution
* Concentration handling
* Area-of-effect systems
* Expanded spell coverage

---

## Encounter Analytics

* Large-scale simulation
* Statistical reporting
* Encounter difficulty metrics
* CR comparison analysis

---

# SHEET UI MILESTONES

## Character Management

* Character creation
* Character editing
* Validation

---

## Party Management

* Party assembly
* Persistence
* Import/export

---

## Resource Tracking

* HP
* Spell slots
* Class resources
* Conditions

---

## UI Systems

* Interactive pips
* Condition badges
* Dashboard views

---

# ROADMAP MAINTENANCE RULES

Update ROADMAP.md only when:

* Architecture changes
* Milestones change
* Long-term direction changes

Do not update ROADMAP.md for:

* Session progress
* Completed tasks
* Current implementation status
* Recent discoveries
* Handover information

Target size:

Under 1000 words.
