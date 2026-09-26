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

### Phase 5: Follow-up Fix — State Derivation & Dispatch Queue (LOGI-0015)
- [x] **Task 5.1:** Derive ticket status from the handoff destination — `tracker handoff` now records `toState` (previously absent from all 24 handoffs), so a finished ticket reads `done` instead of staying `planned`.
- [x] **Task 5.2:** Dispatch queue excludes `done`/`blocked`/open-arm tickets and appends unstarted roadmap tickets (`Docs/PROJECT_STATUS.md`, `TRACKER_ROADMAP` override); `ready --all` audits the rest.
- [x] **Task 5.3:** Enforce `LEGAL_TRANSITIONS` on `handoff` (exit 1 + `--force` escape) and print the head ticket, source and queue composition in `tracker status`.

### Phase 6: Dependency Graph, Blocking & Queue Release Gates (LOGI-0016 — PROPOSED, not started)

> **Full plan:** `Docs/planned-features/LOGI-0016-dependency-graph-and-blocking.md`
> (context §1–§3 · scenarios §4 · ACs §5 · design §6 · execution §7 · risks §8 · open questions §9 ·
> pre-drafted arm plan §10 · evidence §11).
> **Status:** documented only — **no tracker state exists yet** (no `PLAN_CREATED`, no plan file, no
> queue row). Promotion procedure: plan doc §7.6. Recommended slot: before dispatching LOGI-0010.
> **Problem in one line:** dependencies can be *written down* (`depends_on_plans`, an empty spec
> `depends_on:`, one prose sentence in `PROJECT_STATUS.md` §2) but are never *read* by the dispatch
> queue, `planned->blocked` is illegal, and the only hard gate is artifact-level (§3 required files).

- [ ] **Task 6.1 (Milestone 1):** Dependency model — `TRACKER_STATE_DIR` fixture override, `planned->blocked` + `blocked->planned` transitions, `dependencyEdges`/`blockerStatus`/`dependencyHeld`/`findCycles`, roadmap `Depends on` column parse, `readyQueue` held classification (event-log-first status).
- [ ] **Task 6.2 (Milestone 2):** CLI + surfacing — `deps`, `block`, `unblock`, `ready --held`, `status` `Held`/`UNBLOCK_CANDIDATE`/`STALE_DEP`/`DEP_CYCLE` lines, `plan lock --strict-deps`, plus docs (`11-agent-context-and-execution.md`, `03-spec-driven-workflow.md`), skills (`plan-arm`, `orchestrate-dispatch`) and the roadmap dependency-column backfill.
- [ ] **Task 6.3 (Milestone 3):** Arm verification — full CLI regression sweep on real state, LOGI-0015 non-regression contract, sealed journal, one atomic commit, `HANDOFF orchestrator→done`.
- [ ] **Task 6.4 (Decision needed first):** resolve open questions O1–O5 (roadmap vs spec dependency source, strict-deps default, manual vs auto unblock, dedicated `tooling` arm boundary, mandatory `depends_on` for new specs).
