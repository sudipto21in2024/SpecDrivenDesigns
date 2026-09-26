---
ticket: LOGI-0015
arm: orchestrator
status: done
created: 2026-09-26T05:36:28.100Z
depends_on_plans:
---

## 1. Objective
Fix tracker status derivation + dispatch queue: completed tickets (LOGI-0007 = last worked) were re-reported as "ready" and the real next ticket was invisible.
Root cause: `handoff` never records the destination state (grep `toState` in `state/handoffs.jsonl` = 0), so the snapshot keeps `status: planned`; the queue then equates "no open arm" with "ready".
Fix: derive status from the event log, exclude finished tickets from the queue, discover unstarted roadmap tickets, and enforce `LEGAL_TRANSITIONS`.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tools/tracker/core.mjs` | modify | handoffState + roadmapBacklog + rebuildSnapshot derivation + readyQueue filter | ~70 |
| `tools/tracker/index.mjs` | modify | status output + ready --all + handoff --state/--force + usage text | ~30 |
| `Docs/ProjectTechGuidence/11-agent-context-and-execution.md` | modify | document status derivation + queue contract | ~20 |
| `Docs/OPTIMIZATION_TASKS.md` | modify | record Phase 5 follow-up fix | ~10 |
| `state/plans/LOGI-0015-orchestrator.plan.md` | create | this plan | ~50 |
| `state/events.jsonl` | append | event trail (PLAN_*, TASK_STARTED, PLAN_DONE, STEP_DONE, HANDOFF) |
| `state/handoffs.jsonl` | append | handoff records now carrying `toState` |
| `state/tasks.json` | regenerate | derived snapshot (CLI-written, never hand-edited) |
| `memory/journal/LOGI-0015.md` | create | sealed arm journal section |
| `memory/active.md` | regenerate | session position via `tracker active` |
| `memory/progress.md` | update | LOGI-0015 row via `tracker progress` |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `Docs/PROJECT_STATUS.md` | 44-60 | ordered roadmap table (the backlog source) |
| `state/handoffs.jsonl` | 21-24 | LOGI-0007 handoff shape: `to` present, `toState` absent |
| `state/tasks.json` | 1-38 | derived snapshot: LOGI-0007 stuck at `planned` / `next: done` |
| `memory/journal/LOGI-0007.md` | tail | last worked ticket evidence |
| `.clineskills/orchestrate-dispatch/SKILL.md` | 10-20 | queue consumer contract |

## 4. Steps (each with verify gate)
- [x] 1. Milestone 1 (state + transitions): `handoffState()` derivation; `rebuildSnapshot` sets `in_progress` on TASK_STARTED and the handoff destination state (`done` / `blocked` / `in_progress`), closing all open arms on `done`; `handoff` records `toState` and rejects transitions outside `LEGAL_TRANSITIONS` (`--force` escape) → verify: `show --ticket LOGI-0007` prints `"status": "done"`; an illegal `handoff --to done` on a planned ticket exits 1
- [x] 2. Milestone 2 (query + observability): `readyQueue()` excludes `done`/`blocked`/open-arm tickets, appends unstarted roadmap rows (`TRACKER_ROADMAP` override), adds `--all`; `status` prints head + source + queue composition → verify: default `ready` head is an incomplete ticket, contains no `done` ticket, includes LOGI-0008; `ready --all` still shows LOGI-0007 flagged `dispatchable: false`
- [x] 3. Milestone 3 (arm verification + docs): full CLI regression sweep + doc updates → verify: `status`, `ready`, `show`, `history`, `current`, `plan-slice`, `journal-tail`, `search`, `validate-plan`, `resume-check` all exit 0; `git status --short` shows only §2 manifest files

## 5. Risks / open questions
- Roadmap rows drift (LOGI-0004..0007 still read "Not Started"): the event log always wins — a ticket with events is never treated as backlog.
- A finished ticket with no events at all (LOGI-0000/0001 predate the tracker): excluded by the roadmap status cell (`DONE`/🟢), not by events.
- Transition enforcement could block a legacy flow: all 24 real handoffs map to legal pairs; `--force` remains for exceptions.
- `state/tasks.json` is derived and rewritten by every command — never hand-edited.

## 6. Exit gates
- `tracker status` head is the true next actionable ticket; LOGI-0007 never appears as ready.
- No `done` ticket in the default queue; roadmap backlog LOGI-0008..LOGI-0012 discovered.
- `git status --short` == only §2 manifest files (no `src/**`, `contracts/**`, `tests/**`).
- Journal sealed via `tracker seal` + `HANDOFF orchestrator→done` recorded as the legal `in_progress->done` transition.
