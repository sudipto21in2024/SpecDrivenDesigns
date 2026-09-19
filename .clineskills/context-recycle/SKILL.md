---
name: context-recycle
description: Proactive context-window management — when context usage approaches ~50%, seal progress into the plan file and journal, then hand off via new_task to a fresh window. Use when the context indicator shows high usage mid-task. Trigger: context almost full, running out of context.
---

# Context Recycle

Context past ~50% degrades quality. Never push through — hand off.

## When the threshold hits (mid-arm)
1. Finish the current step (or stop at a clean file boundary — never mid-edit).
2. Update the plan file: tick completed checkboxes; add an `## In-progress notes` section with
   exactly where you are (step n/m, what works, what fails, current hypothesis).
3. Append the same to `memory/journal/<TICKET>.md`.
4. Checkpoint: `tracker log --type STEP_DONE --note "recycled at step n/m"` + commit touched files.
5. `new_task` with a resume block:
   ```
   RESUME <TICKET> <arm> — plan: state/plans/<file>.plan.md (step n/m done)
   Read: plan (esp. In-progress notes), memory/journal/<T>.md, memory/active.md
   First action: re-run step n's verify gate → tick or redo per protocol
   ```

## As orchestrator
Your context grows slower but never resets automatically. When high:
1. Ensure `memory/active.md` fully reflects position + dispatch queue.
2. `new_task` a fresh orchestrator with: "Use skill orchestrate-dispatch. Read memory/active.md first."

## Rule of thumb
The conversation is disposable; the plan + journal + tracker are not. If it isn't written down, it's lost.
