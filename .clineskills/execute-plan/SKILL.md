---
name: execute-plan
description: Execute a locked plan file as the implementing child task — manifest-scoped edits, per-step checkpoints with auto-commit, journal sealing, and tracker handoff. Use when a plan is locked and implementation should begin. Trigger: execute plan, implement ticket arm.
---

# Execute Plan

You are the executor for one arm. Your scope is the locked plan's §2 manifest — nothing else.

## Startup
1. Read the locked plan (`state/plans/<T>-<A>.plan.md`), the ticket spec, and `memory/journal/<TICKET>.md`
   (tail only: `tracker journal-tail --ticket T --lines 30`).
2. `node tools/tracker/index.mjs claim --ticket T --arm A --agent <name>`.
3. Read only §3 required files (targeted line ranges). If a §3 entry is a slice pointer
   (`contract:<resource>`), run `node tools/contract/index.mjs show --resource <r> [--fields x-roles|params|responses|schemas]`
   — **never read `contracts/v1-openapi.yaml` or `schema.d.ts` whole** (schema.d.ts is generated;
   the `generate:api` zero-diff gate replaces reading it). If you truly need a file outside §3,
   STOP editing, add it to §3 with justification, and note the deviation.

## Execution loop (per §4 step)
1. Implement the step, confined to §2 files.
2. Run the step's verify gate.
3. **Checkpoint (mandatory):** tick the checkbox mechanically
   (`node tools/tracker/index.mjs tick --ticket T --arm A --step N`), then
   `node tools/tracker/index.mjs log --ticket T --arm A --type STEP_DONE --note "step n/m: <result>"`,
   then `git add <touched files> && git commit -m "<TICKET> <arm>: step n/m green"`.
   One STEP_DONE per verified step — `micro` is for gate failures (`--gate fail`) only.
4. On gate failure: journal the failure + what you tried **before** attempting a fix, and micro-log it with `--gate fail`.

## Deviation protocol
Any file edit outside §2 → log `tracker log --type PLAN_DEVIATION --note "<file> <reason>"`,
add it to §2, re-run `validate-plan`. Repeated deviations → stop and escalate.

## Completion (5-step handover — do all of them, in order)
1. **SEAL (mechanical, CLI-only):**
   `node tools/tracker/index.mjs seal --ticket T --arm A --what "<done>" --gates "<results>" --findings "<notes>" --next "<next agent needs>"`
   — appends the journal section (char-budgeted, LF-safe) + STEP_DONE in one call.
   Do NOT hand-edit `memory/journal/*.md` or use the editor for it.
2. **VERIFY:** run all §6 exit gates; failures route back into this arm, never forward.
3. **RECORD:** `node tools/tracker/index.mjs handoff --ticket T --from A --to <next> --summary "memory/journal/<T>.md#<arm>" --gates "<gate1>,<gate2>"`.
4. **MEMORY:** `tracker active --done "<one line>" --next "<next action>;"` and
   `tracker progress --ticket T --status "<status>"` — never rewrite these files by hand.
5. **END:** your conversation will be destroyed — the journal + tracker are your only legacy.
