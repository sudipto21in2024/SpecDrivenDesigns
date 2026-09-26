---
name: execute-plan
description: Execute a locked plan file as the implementing child task — manifest-scoped edits, per-step checkpoints with auto-commit, journal sealing, and tracker handoff. Use when a plan is locked and implementation should begin. Trigger: execute plan, implement ticket arm.
---

# Execute Plan

You are the executor for one arm. Your scope is the locked plan's §2 manifest — nothing else.

## Startup
1. Get position and slice plan context via CLI (NEVER read whole plan/spec files):
   - `node tools/tracker/index.mjs plan-slice --ticket T --arm A` (touched manifest, active step, exit gates)
   - `node tools/spec/index.mjs show --ticket T --section ac` (Acceptance criteria)
   - `node tools/tracker/index.mjs journal-tail --ticket T --lines 20`
2. `node tools/tracker/index.mjs claim --ticket T --arm A --agent <name>`.
3. Read only §3 required files (targeted line ranges) or slice pointers:
   - `contract:<resource>` → `node tools/contract/index.mjs show --resource <r>`
   - Never read whole contracts or `schema.d.ts`.

## Execution loop (per §4 milestone)
1. Implement the vertical slice, confined to §2 touched files. You may edit multiple related files in one turn.
2. Run the milestone's verify gate (e.g. `dotnet test ...` or `npm test ...`).
3. **Milestone Checkpoint:**
   - Tick the milestone: `node tools/tracker/index.mjs tick --ticket T --arm A --step N`
   - Log completion: `node tools/tracker/index.mjs log --ticket T --arm A --type STEP_DONE --note "milestone n: <result>"`
   - *Do NOT create git commits for intermediate micro-steps.*
4. On gate failure: fix immediately; micro-log only if reporting an obstacle or escalation (`--gate fail`).

## Deviation protocol
Any file edit outside §2 → log `tracker log --type PLAN_DEVIATION --note "<file> <reason>"`,
add it to §2, re-run `validate-plan`. Repeated deviations → stop and escalate.

## Completion (Handover & Atomic Arm Commit)
1. **VERIFY:** run all §6 exit gates locally (`dotnet test`, `npm test`, `playwright test`). Never wait for remote GitHub CI.
2. **SEAL (mechanical, CLI-only):**
   `node tools/tracker/index.mjs seal --ticket T --arm A --what "<done>" --gates "<results>" --findings "<notes>" --next "<next agent needs>"`
3. **ATOMIC COMMIT:** create one single git commit for the verified arm:
   `git add <touched files> state/ memory/ && git commit -m "<TICKET> <arm>: green (<summary>)"`
4. **RECORD & MEMORY:**
   - `node tools/tracker/index.mjs handoff --ticket T --from A --to <next> --summary "memory/journal/<T>.md#<arm>" --gates "<gates>"`
   - `tracker active --done "<one line>" --next "<next action>"`
   - `tracker progress --ticket T --status "<status>"`
