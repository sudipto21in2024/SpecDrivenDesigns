# Agent Context & Execution Protocol (always active)

Reference: `Docs/ProjectTechGuidence/11-agent-context-and-execution.md` · State CLI: `node tools/tracker/index.mjs`

1. **Session start:** read `memory/active.md` and run `node tools/tracker/index.mjs current`.
   If an arm is in-progress, use skill `resume-or-recover` — never guess position.
2. **No plan, no code:** every arm needs a locked `state/plans/<TICKET>-<arm>.plan.md`
   (skills `plan-arm` → `validate-plan` → `tracker plan lock`) before the first edit.
3. **Main thread never edits source.** It dispatches (`orchestrate-dispatch`), verifies gates,
   and updates memory. Implementation happens in fresh-window child tasks (`new_task`).
4. **Scope = manifest:** read only the plan's §3 files (targeted ranges); edit only §2 files.
   Resolve files via the code graph (`code-graph`), not by reading whole modules.
5. **Checkpoint every verified step:** tick the plan checkbox + `tracker log --type STEP_DONE`
   + git commit. Context > ~50% → skill `context-recycle` (seal + hand off, never push through).
6. **Handover before ending any task:** seal journal → verify gates → `tracker handoff` →
   compose successor block (skill `execute-plan` §Completion). If it isn't on disk, it doesn't exist.
7. **Session end:** update `memory/active.md` (+ journal, + `memory/progress.md` on milestones).
