---
name: plan-arm
description: Create a persisted Plan File for a ticket arm before any implementation. Use at the start of every arm (backend/frontend/qa/docs) to define the touched-files and required-files manifests, ordered steps with verify gates, and exit criteria. Trigger when beginning a new ticket, feature, or arm of work.
---

# Plan Arm

You are the planner. Produce a Plan File — no source code changes.

## Procedure
1. Load context cheaply using CLI slice commands only (DO NOT read whole markdown files):
   - `node tools/tracker/index.mjs status` (position and git status)
   - `node tools/spec/index.mjs show --ticket <T> --section ac` (Acceptance criteria)
   - `node tools/tracker/index.mjs journal-tail --ticket <T> --lines 20` (upstream arm sealed findings)
   - `node tools/contract/index.mjs show --resource <r> [--fields x-roles|schemas]` (API contract slice)
2. Fill the plan template (`tracker plan new --ticket T --arm A --objective "..."` creates it at
   `state/plans/<T>-<A>.plan.md`). Every section is mandatory:
   - **§2 Touched files (WRITE manifest):** exact repo-relative paths. This is the scope boundary.
   - **§3 Required files (READ scope):** only files the plan depends on, with line ranges or slice pointers.
   - **§4 Steps (Vertical Slice Milestones — 2 to 3 milestones maximum):**
     - Milestone 1: Core Logic & Data (Domain/DTOs/Commands + Unit Tests) -> Verify: unit tests pass
     - Milestone 2: Integration & UI/Endpoints (Endpoints/Components + Integration Tests) -> Verify: tests/lint pass
     - Milestone 3: Full-Suite Verification & Handoff -> Verify: all arm exit gates green
     *DO NOT create 10+ single-file steps that force 15–20 passes.*
   - **§6 Exit gates:** the local commands that prove the arm done (e.g. `dotnet test`, `npm test`).
3. Run `node tools/tracker/index.mjs validate-plan <file>`. Fix all errors. Do not lock —
   the orchestrator locks after review (skill `validate-plan`).

## Size heuristic
Trivial arms (≤2 files, no parallel arms) may compress §2/§3 to a 10-line bullet list.
Anything touching contracts, DB schema, or parallel arms gets the full treatment.

## Hard rules
- Never list a file outside the arm's boundary (backend ≠ `src/frontend/**`/`contracts/**`, etc.) — validation will reject it.
- If graphify reveals callers/neighbors of files you'll change, add them to §3 (ripple check).
- Keep the objective ≤3 lines. The plan is the deliverable, not prose.
