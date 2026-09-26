# Optimization Tracking & Tasks Context

> Generated to track the execution and optimization of the Lean Agent Context & Execution Platform.
> All state and decisions are persisted here so any agent session can resume without loss of context.

---

## 1. Objectives & Decisions

1. **Stop Direct File Reads for State/Specs/Plans:**
   - No direct `read_files` on `memory/active.md`, `memory/progress.md`, `state/plans/*.plan.md`, or `specs/features/*.md`.
   - Provided CLI slice tools:
     - `tracker status`: Single composite 10-line session start state (ticket, arm, step, manifests, gates, git).
     - `tracker plan-slice`: Extracts touched files manifest, active step, and exit gates.
     - `node tools/spec/index.mjs show --ticket <T> --section <S>`: Slices acceptance criteria (AC) or spec sections.

2. **Reduce Coding Passes from 15–20 to 2–4:**
   - Shift from microscopic single-file steps to **Vertical Slice Milestones** (Max 2–3 milestones per arm: Core Logic/Data + Tests -> UI/Integration -> Arm Verification).
   - Multi-file edits allowed in a single turn within the locked manifest (§2).

3. **Abolish Per-Step Micro-Commits:**
   - 1 atomic commit per Arm completion when exit gates are verified green.

4. **Decouple Remote GitHub CI from Inner Loop:**
   - Inner loop acceptance relies strictly on local tests (`dotnet test`, `npm test`, `playwright test`).
   - Remote CI babysitting in agent loops is forbidden.

---

## 2. Master Task List & Progress

### Phase 1: Tooling Enhancements
- [x] **Task 1.0:** Create pre-optimization backup (`state_backup_pre_opt`, `memory_backup_pre_opt`).
- [x] **Task 1.1:** Add `tracker status` composite command to `tools/tracker/index.mjs` and `core.mjs`.
- [x] **Task 1.2:** Add `tracker plan-slice` command to `tools/tracker/index.mjs`.
- [x] **Task 1.3:** Create spec slicer CLI tool `tools/spec/index.mjs`.
- [x] **Task 1.4:** Update `.gitignore` with `nul` and backup dirs.

### Phase 2: Protocol & Rule Overhaul
- [x] **Task 2.1:** Revise `.clinerules/10-agent-context-protocol.md` (mandate `tracker status`, ban direct reads of active.md/specs/plans, eliminate per-step git commits, decouple remote CI).
- [x] **Task 2.2:** Update architectural guidance document `Docs/ProjectTechGuidence/11-agent-context-and-execution.md`.

### Phase 3: Skill Templates Alignment
- [x] **Task 3.1:** Update `.clineskills/plan-arm/SKILL.md` (enforce 2–3 vertical-slice milestones, eliminate micro-file steps).
- [x] **Task 3.2:** Update `.clineskills/execute-plan/SKILL.md` (allow vertical slice edits, atomic arm commits, slice-first reads).
- [x] **Task 3.3:** Update `.clineskills/resume-or-recover/SKILL.md` (use `tracker status`).
- [x] **Task 3.4:** Update `.clineskills/orchestrate-dispatch/SKILL.md` (use `tracker status`).

### Phase 4: Verification & Testing
- [x] **Task 4.1:** Test `node tools/tracker/index.mjs status`.
- [x] **Task 4.2:** Test `node tools/tracker/index.mjs plan-slice --ticket LOGI-0007 --arm backend` and `frontend`.
- [x] **Task 4.3:** Test `node tools/spec/index.mjs show --ticket LOGI-0007 --section ac` and `--section summary`.
- [x] **Task 4.4:** Clean up temporary backup directories after successful verification.
