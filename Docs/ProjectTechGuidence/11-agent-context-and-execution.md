# 11 — Agent Context & Execution Platform (State Store, Plans, Handoffs, Recovery)

> Consolidated design for token-efficient, recoverable, multi-agent execution.
> Status: IMPLEMENTED (tooling) · See `tools/tracker/`, `state/`, `memory/`, `.clineskills/`, `.clinerules/`.

## 1. Problem

- Long tasks executed sequentially in the main thread overflow the context window and waste tokens on re-exploration.
- Rework happens when implementation starts before touched/required files are identified.
- Stopping mid-task (token exhaustion, crash, human pause) loses position.
- No unified, searchable memory of decisions and handoffs across sessions/agents.

## 2. Architecture

```
MAIN THREAD (Orchestrator) — never edits source
 loop: tracker ready → dispatch planner → validate/lock plan → dispatch executor
       → confirm handoff → update memory → next arm
│
├── STATE STORE   state/events.jsonl, tasks.json, handoffs.jsonl, plans/*.plan.md
│                 + tools/tracker CLI (structured, deterministic, searchable)
├── MEMORY BANK   memory/active.md, project.md, patterns.md, tech.md, progress.md, journal/
├── CODE GRAPH    graphify-out/ (graph.json, GRAPH_REPORT.md) — committed
│
└── CHILD TASKS via new_task (fresh context window each):
     planner child → executor child (backend / frontend / qa / docs)
     each: claim → execute locked plan → per-step checkpoints → seal journal → tracker handoff
```

### Principles

1. **File-based contracts, not chat memory** (extends `01-agent-architecture.md`). Anything important is on disk; conversations are disposable.
2. **No plan, no code.** Every arm has a persisted Plan File validated *before* any edit.
3. **Main thread never implements.** It dispatches, verifies gates, and updates memory.
4. **Position lives in artifacts, never in the conversation.** Plan checkboxes + event log + git == ground truth.

## 3. State Store & Tracker CLI

Append-only JSONL events are the source of truth; `tasks.json` is a derived snapshot.

```json
{"ts":"...","type":"HANDOFF","ticket":"LOGI-0003","from":"backend","to":"e2e-qa",
 "summary_ptr":"memory/journal/LOGI-0003.md#backend-arm","gates":["dotnet test 9/9"]}
```

Commands (run `node tools/tracker/index.mjs <cmd> --help`):

| Command | Purpose |
|---|---|
| `current` | What is being worked on right now (ticket, arm, plan, last step) |
| `ready [--stuck]` | Orchestrator dispatch queue / stale orphaned arms |
| `claim --ticket T --arm A [--agent NAME]` | Mark arm in-progress |
| `log --ticket T --type STEP_DONE [--note ...]` | Step-level checkpoint events |
| `micro --ticket T --arm A --action "..." [--files f1,f2] [--gate pass\|fail\|skip] [--next "..."] [--detail "..."]` | **Micro-action log with full actionable context** — after every edit batch and every gate run, so a successor can resume at the exact next action |
| `resume-check --ticket T --arm A [--run-gates]` | **Validate code state BEFORE resuming**: git vs plan §2 manifest, event-log vs file-mtime reconciliation, re-runs the last step's verify gates. Verdicts: `clean` / `mid_step` / `broken` (exit 1 — do not resume; reset + redo step) |
| `handoff --ticket T --from A --to B --summary PTR [--gates ...]` | Validate + record handoff |
| `plan new/get/set-status/lock` | Plan file lifecycle (draft → validated → locked → done) |
| `validate-plan <file> [--resume]` | Deterministic pre-flight: file existence, boundary rules, parallel collisions |
| `search "query"` | Full-text search over events, handoffs, plans, journals |
| `history --ticket T` | Timeline |

### Plan File format (`state/plans/<TICKET>-<arm>.plan.md`)
## 4. Task Handover Protocol (5 steps, executed by the outgoing task)

1. **SEAL** — append findings to `memory/journal/<TICKET>.md`: what was done, files touched,
   test results, decisions, "what the next agent needs". *If it isn't in the journal, it doesn't exist.*
2. **VERIFY** — run the state's exit gates; failures route back, never forward.
3. **RECORD** — `tracker handoff ...` (validates the state transition).
4. **COMPOSE** — successor context block (~30 lines: ticket, state, read-first list, plan ptr, gates).
5. **DISPATCH** — orchestrator starts the next `new_task` with that block.

## 5. Stop / Recovery Protocol

Checkpoint discipline during execution (per `execute-plan` skill):
- **Micro-log every action:** after each edit batch and each gate run, `tracker micro`
  records what was done, which files, gate result, and the *exact next action* — enough
  for a successor to resume at the precise step without reading any conversation.
- Tick the plan checkbox + `tracker log STEP_DONE` after every verified step; auto-commit
  per verified step (`git commit -m "TICKET arm: step n/m green"`); journal failures before fixing.

Resume (skill `resume-or-recover`, run whenever a session starts with an in-progress arm):

1. `tracker current` + `git status --short` + `git log --oneline -5` → full position.
2. **`tracker resume-check --ticket T --arm A [--run-gates]` (mandatory before resuming):**
   cross-checks git vs the plan §2 manifest, reconciles event timestamps vs file mtimes,
   and re-runs the last completed step's verify gates. Verdicts:
   - `clean` → resume at first unticked step;
   - `mid_step` (uncommitted manifest changes / tree newer than events) → re-run the step's
     verify gate; pass ⇒ tick, fail ⇒ redo the step;
   - `broken` (exit 1: deleted manifest file or failing gate) → **do not resume**;
     `git checkout -- <file>` and re-execute the last step. Tokens dying mid-edit is a
     real condition — this is exactly the case `resume-check` exists for;
   - non-empty `outside_manifest_changes` → reconcile (another arm's work or a deviation).
3. `tracker validate-plan --resume` → confirm required files unchanged / no parallel drift.
4. Continue at first unticked step. Loss window ≈ one small step (minutes).


## 6. Skills

| Skill | Role |
|---|---|
| `plan-arm` | Planner child: produce Plan File (manifests via graphify + targeted reads) |
| `validate-plan` | Run pre-flight, interpret failures, fix-or-escalate |
| `execute-plan` | Executor child: manifest-scoped implementation, per-step checkpoints, seal + handoff |
| `orchestrate-dispatch` | Orchestrator loop |
| `context-recycle` | ~50% context threshold ⇒ seal + `new_task` self-handoff |
| `code-graph` | Graphify build/refresh/query discipline |
| `resume-or-recover` | Deterministic resume after any interruption |

## 7. Memory Bank

`memory/active.md` (≤60 lines: current ticket, state, next action), `project.md`,
`patterns.md`, `tech.md`, `progress.md`, `journal/<TICKET>.md` (append-only).
Rules: read `active.md` at session start; update before ending any session;
searchable via `tracker search` and grep.

## 8. Code Graph (graphify)

`graphify extract ./src` → commit `graphify-out/` (`.graphifyignore`: Migrations, node_modules,
schema.d.ts). Query before reading: `graphify query/path/explain`. Hard rule: read only the
resolved ≤5 files, targeted ranges — never whole modules.

## 9. Metrics (per `10-orchestration-kilocode-config.md`)

Arms with `PLAN_DEVIATION` %, resumes per ticket, tokens per arm (from subagent stats),
handoff gate failure rate.


YAML front matter (`ticket, arm, status, created, depends_on_plans`) + sections:
1. Objective (≤3 lines) · 2. **Touched files** (WRITE manifest — the scope boundary) ·
3. **Required files** (READ scope with line ranges) · 4. Ordered steps, each with its own
verify gate and `- [ ]` checkbox · 5. Risks · 6. Exit gates.

### Pre-flight validation (`validate-plan`)

Checks every §3 required file exists, §2 paths are creatable, boundary rules respected
(backend arm may not touch `src/frontend/**` or `contracts/**`, etc.), no §2 file collisions
with other in-progress arms, dependency plans locked. Fails loudly with a fix list.
