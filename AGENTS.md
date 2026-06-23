# AGENTS.md
# Multi-Agent Workstream Authority

---

## PRIORITY RULE

**A handover document uploaded by the user at session start supersedes TASK.md and all other
context for that session.**

If the user provides a handover at startup:
1. Read the uploaded handover first.
2. Work only the tasks in that handover.
3. Ignore TASK.md for scope and priority — it applies only to agents without an uploaded handover.

---

## WORKSTREAMS

Three independent agents run in parallel. Each owns distinct files and must never touch
another stream's files.

| Agent | Handover prefix | Source files |
|-------|----------------|--------------|
| Sheet | `SHEET-HANDOVER-XX` | `src/characters/*`, `src/character_router.ts`, `docs/characters.html` |
| Core Engine | `HANDOVER-SESSION-XX` | `src/engine/*`, `src/spells/*`, `src/ai/*`, `src/parser/*` |
| Cantrip / z | `zHANDOVER-SESSION-XX` | `src/engine/cantrip_effects.ts`, `src/spells/<cantrip>.ts` |

---

## STARTUP SEQUENCE

1. Check whether the user has uploaded a handover file.
2. **If yes** — that handover defines the active workstream and all priorities. Begin immediately.
3. **If no** — read TASK.md, then the latest handover for the workstream described in TASK.md.

---

## STREAM ISOLATION RULES

- Sheet agent must not modify engine internals (`src/engine/*`).
- Core Engine agent must not touch `src/characters/*`, `src/character_router.ts`, or `docs/characters.html`.
- Cantrip agent must not touch leveled-spell modules or character sheet files.
- No agent merges another agent's handover into its own.

---

## HANDOVER NAMING CONVENTION

| Stream | Pattern | Example |
|--------|---------|---------|
| Sheet | `SHEET-HANDOVER-NN.md` | `SHEET-HANDOVER-29.md` |
| Core Engine | `HANDOVER-SESSION-NN.md` | `HANDOVER-SESSION-43.md` |
| Cantrip / z | `zHANDOVER-SESSION-NN.md` | `zHANDOVER-SESSION-16.md` |

Each agent writes the next numbered handover for its own stream only.

Old handovers are archived in a single subfolder to keep the repo root tidy:
- `HandoverOld/` — all archived handovers (HANDOVER-SESSION, zHANDOVER-SESSION,
  SHEET-HANDOVER, and the legacy `branchHandover-*` files). Only the latest 2
  of each handover type are kept in the repo root; everything else is moved
  into `HandoverOld/`.
