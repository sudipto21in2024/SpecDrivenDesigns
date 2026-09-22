# Agent Context & Execution Protocol (always active)

Reference: `Docs/ProjectTechGuidence/11-agent-context-and-execution.md` · State CLI: `node tools/tracker/index.mjs`

1. **Session start:** read `memory/active.md` and run `node tools/tracker/index.mjs current`.
   If an arm is in-progress, use skill `resume-or-recover` — never guess position.
2. **No plan, no code:** every arm needs a locked `state/plans/<TICKET>-<arm>.plan.md`
   (skills `plan-arm` → `validate-plan` → `tracker plan lock`) before the first edit.
3. **Main thread never edits source.** It dispatches (`orchestrate-dispatch`), verifies gates,
   and updates memory. Implementation happens in fresh-window child tasks (`new_task`).
4. **Scope = manifest:** read only the plan's §3 files (targeted ranges); edit only §2 files.
   **Slice-first reads:** contract → `node tools/contract/index.mjs show --resource <r> [--fields x-roles|params|responses|schemas]`;
   events/journal → `tracker show/history --last/journal-tail`. Never read `contracts/v1-openapi.yaml`,
   `src/frontend/src/api/schema.d.ts`, `state/events.jsonl`, or a whole journal/plan file.
5. **Mechanical bookkeeping (CLI-only):** tick = `tracker tick`; seal = `tracker seal`;
   memory = `tracker active` / `tracker progress`. Never hand-edit `memory/journal/*`,
   `memory/active.md`, `memory/progress.md`, or plan checkboxes with the editor.
   One STEP_DONE per verified step; `micro` only for gate failures.
6. **Checkpoint every verified step:** tick + `tracker log --type STEP_DONE` + git commit.
   Context > ~50% → skill `context-recycle` (seal + hand off, never push through).
7. **Handover before ending any task:** seal journal → verify gates → `tracker handoff` →
   memory updated via tracker commands (skill `execute-plan` §Completion). If it isn't on disk, it doesn't exist.
8. **Session end:** `tracker active --done "..." --next "..."` + `tracker progress` on milestones.
