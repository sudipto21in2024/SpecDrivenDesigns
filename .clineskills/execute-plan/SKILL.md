---
name: execute-plan
description: Execute a locked plan file as the implementing child task — manifest-scoped edits, per-step checkpoints with auto-commit, journal sealing, and tracker handoff. Use when a plan is locked and implementation should begin. Trigger: execute plan, implement ticket arm.
---

# Execute Plan

You are the executor for one arm. Your scope is the locked plan's §2 manifest — nothing else.

## Startup
1. Read the locked plan (`state/plans/<T>-<A>.plan.md`), the ticket spec, and `memory/journal/<TICKET>.md`.
2. `node tools/tracker/index.mjs claim --ticket T --arm A --agent <name>`.
3. Read only §3 required files (targeted line ranges). If you truly need a file outside §3,
   STOP editing, add it to §3 with justification, and note the deviation.

## Execution loop (per §4 step)
1. Implement the step, confined to §2 files.
2. Run the step's verify gate.
3. **Micro-log every action** (mandatory — this is what makes mid-task death cheap):
   - after each edit batch: `node tools/tracker/index.mjs micro --ticket T --arm A --action "<what was done>" --files "<f1>,<f2>" --next "<exact next action>"`
   - after each gate/command: add `--gate pass|fail|skip --detail "<result>"`
   - `--next` must be precise enough that a successor can act on it without reading your conversation.
4. **Checkpoint (mandatory):** tick the checkbox in the plan file, then
   `node tools/tracker/index.mjs log --ticket T --arm A --type STEP_DONE --note "step n/m: <result>"`,
   then `git add <touched files> && git commit -m "<TICKET> <arm>: step n/m green"`.
5. On gate failure: journal the failure + what you tried **before** attempting a fix, and micro-log it with `--gate fail`.

## Deviation protocol
Any file edit outside §2 → log `tracker log --type PLAN_DEVIATION --note "<file> <reason>"`,
add it to §2, re-run `validate-plan`. Repeated deviations → stop and escalate.

## Completion (5-step handover — do all of them, in order)
1. **SEAL:** append to `memory/journal/<TICKET>.md` — what was done, files, test results,
   decisions, and "what the next agent needs". If it isn't in the journal, it doesn't exist.
2. **VERIFY:** run all §6 exit gates; failures route back into this arm, never forward.
3. **RECORD:** `node tools/tracker/index.mjs handoff --ticket T --from A --to <next> --summary "memory/journal/<T>.md#<arm>" --gates "<gate1>,<gate2>"`.
4. **COMPOSE:** write the successor's context block (~30 lines: ticket, state, read-first list, plan ptr, gates) at the end of the journal section.
5. **END:** your conversation will be destroyed — the journal + tracker are your only legacy.
