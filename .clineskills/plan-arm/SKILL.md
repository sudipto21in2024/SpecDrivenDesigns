---
name: plan-arm
description: Create a persisted Plan File for a ticket arm before any implementation. Use at the start of every arm (backend/frontend/qa/docs) to define the touched-files and required-files manifests, ordered steps with verify gates, and exit criteria. Trigger when beginning a new ticket, feature, or arm of work.
---

# Plan Arm

You are the planner. Produce a Plan File — no source code changes.

## Procedure
1. Load context cheaply, in this order:
   - `node tools/tracker/index.mjs current` (position) and `memory/active.md`
   - the ticket file `specs/features/<TICKET>-*.md` (ACs are the source of truth)
   - `memory/journal/<TICKET>.md` (upstream arms' sealed findings)
   - the code graph (skill `code-graph`): resolve which files relate to the objective.
2. Fill the plan template (`tracker plan new --ticket T --arm A --objective "..."` creates it at
   `state/plans/<T>-<A>.plan.md`). Every section is mandatory:
   - **§2 Touched files (WRITE manifest):** exact repo-relative paths. This is the scope boundary.
   - **§3 Required files (READ scope):** only files the plan depends on, with line ranges.
   - **§4 Steps:** small (≈ one file or edit batch each), each with its own verify gate.
   - **§6 Exit gates:** the commands that prove the arm done (tests, lint, build).
3. Run `node tools/tracker/index.mjs validate-plan <file>`. Fix all errors. Do not lock —
   the orchestrator locks after review (skill `validate-plan`).

## Size heuristic
Trivial arms (≤2 files, no parallel arms) may compress §2/§3 to a 10-line bullet list.
Anything touching contracts, DB schema, or parallel arms gets the full treatment.

## Hard rules
- Never list a file outside the arm's boundary (backend ≠ `src/frontend/**`/`contracts/**`, etc.) — validation will reject it.
- If graphify reveals callers/neighbors of files you'll change, add them to §3 (ripple check).
- Keep the objective ≤3 lines. The plan is the deliverable, not prose.
