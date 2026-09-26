# Agent Context & Execution Protocol (always active)

Reference: `Docs/ProjectTechGuidence/11-agent-context-and-execution.md` · State CLI: `node tools/tracker/index.mjs`

1. **Session start (Zero direct-read discovery):** run `node tools/tracker/index.mjs status`.
   DO NOT read `memory/active.md`, `memory/progress.md`, `state/plans/*.plan.md`, or `specs/features/*.md` directly.
   If an arm is in-progress, `tracker status` displays the active arm, next step, touched files, and gates.
2. **No plan, no code (Vertical-slice milestones):** every arm needs a locked `state/plans/<TICKET>-<arm>.plan.md`
   (skills `plan-arm` → `validate-plan` → `tracker plan lock`) before the first edit.
   Plans must define **2–3 vertical-slice milestones** (Logic+Unit Tests → Integration+UI → Arm Verification),
   NOT 10+ microscopic single-file steps.
3. **Execution freedom within manifest:** Within the locked plan's §2 touched files, implement cohesive vertical slices
   in 1–2 passes. The compiler, linter, and tests are the immediate feedback loop.
4. **Scope = manifest & Slice-first reads:** read only the plan's §3 files (targeted ranges); edit only §2 files.
   **CLI Slicers only:**
   - Contract slice: `node tools/contract/index.mjs show --resource <r> [--fields x-roles|params|responses|schemas]`
   - Spec slice: `node tools/spec/index.mjs show --ticket <T> [--section ac|summary|actors|data|defaults]`
   - Plan slice: `node tools/tracker/index.mjs plan-slice --ticket <T> --arm <A>`
   - State & Tail: `node tools/tracker/index.mjs status` / `journal-tail --ticket <T>` / `history --ticket <T> --last N`
   NEVER use `read_files` on whole contracts, specs, plans, `schema.d.ts`, or journal files.
5. **Mechanical bookkeeping at Milestones (CLI-only):**
   - Tick milestone = `tracker tick --ticket T --arm A --step N`
   - Log milestone completion = `tracker log --ticket T --arm A --type STEP_DONE --note "..."`
   - Seal arm = `tracker seal --ticket T --arm A --what "..." --gates "..." --findings "..." --next "..."`
   Never hand-edit `memory/journal/*`, `memory/active.md`, `memory/progress.md`, or plan checkboxes with the editor.
6. **Atomic Arm Commits (Abolish step-level micro-commits):**
   - Checkpoint git with **one atomic commit per verified Arm** (e.g. `feat(LOGI-0007): implement shipments backend arm`).
   - Mid-arm git commit is only performed if context exceeds ~50% (skill `context-recycle`).
   - Do NOT commit every minor single-file edit.
7. **Local Gates Authority (No Remote CI Babysitting):**
   - Verification gates are executed locally (`dotnet test`, `npm test`, `playwright test`).
   - Remote GitHub Actions CI is asynchronous and must NEVER be polled or babysit inside the agent loop.
8. **Handover before ending any task:** seal journal (`tracker seal`) → verify local exit gates → `tracker handoff` →
   update active state (`tracker active --done "..." --next "..."`).
