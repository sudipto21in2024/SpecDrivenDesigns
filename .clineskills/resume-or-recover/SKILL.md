---
name: resume-or-recover
description: Deterministic recovery after any interruption — token exhaustion, crash, human stop, or days-long gap. Use at session start whenever tracker current shows an in-progress arm or the previous session ended abnormally. Trigger: resume, recover, continue where we left off, what was I doing.
---

# Resume or Recover

Trust only artifacts (plan, tracker, git, journal) — never a resumed conversation's memory.

## Procedure
1. **Position (Zero direct-read discovery):**
   - Run `node tools/tracker/index.mjs status` (shows active arm, working tree, and next action).
   - If arm is in-progress: `node tools/tracker/index.mjs plan-slice --ticket T --arm A` (touched manifest, active step, exit gates).
   - Tail journal if context needed: `node tools/tracker/index.mjs journal-tail --ticket T --lines 20`.
   - NEVER use `read_files` on `memory/active.md`, `state/events.jsonl`, full journal, or whole plan files.
2. **Validate code state BEFORE resuming (mandatory):**
   `node tools/tracker/index.mjs resume-check --ticket T --arm A [--run-gates]`
   It cross-checks git vs the plan §2 manifest, reconciles event-log timestamps vs file
   mtimes, and (with `--run-gates`) re-runs the last completed step's verify commands.
   Act on the verdict — the tree may genuinely be broken (e.g. tokens died mid-edit):
   | Verdict | Meaning | Action |
   |---|---|---|
   | `clean` | tree matches events | resume at first unticked milestone |
   | `mid_step` | uncommitted manifest changes / tree newer than events | re-run the milestone's verify gate; tick or redo |
   | `broken` (exit 1) | deleted manifest file or failing gate | DO NOT resume — `git checkout -- <file>`, redo the milestone |
   | `outside_manifest_changes` non-empty | files changed outside the plan scope | investigate: another arm's work, or a deviation — reconcile before continuing |
3. **Drift check:** `node tools/tracker/index.mjs validate-plan <plan> --resume` — if required files changed in intervening commits, re-validate the plan before continuing.
4. **Continue** at the first unticked milestone with the same §2 scope boundary.

## First journal entry after recovery
"Resumed <arm> at step n/m; prior session ended <reason>; working tree reconciled (<files> reset)."
