---
ticket: LOGI-0013
arm: orchestrator
status: done
created: 2026-09-26T06:05:12.513Z
depends_on_plans:
---

## 1. Objective
Dispose of LOGI-0013 (e2e harness): qa sealed the deliverable (start-api wrapper + absolute E2E_DB_PATH + CI failure artifacts) with CI run #17 green on 75c039e, but the handoff qa->orchestrator was never closed, so the ticket sits in_progress at the head of the dispatch queue and hides the true next ticket (LOGI-0008). Hold-check the harness on the current tip, close the ticket, backfill the stale roadmap rows, then move to LOGI-0008.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `state/plans/LOGI-0013-orchestrator.plan.md` | modify | this plan (ticks + status) | ~55 |
| `memory/journal/LOGI-0013.md` | append (tracker seal) | orchestrator-arm section | ~8 |
| `state/events.jsonl` | append (CLI only) | PLAN_CREATED/LOCKED, TASK_STARTED, STEP_DONE, HANDOFF | ~7 |
| `state/handoffs.jsonl` | append (CLI only) | HANDOFF orchestrator→done | 1 |
| `state/tasks.json` | derived (CLI only) | snapshot rebuild | auto |
| `memory/active.md` | regenerate (tracker active) | pointer to LOGI-0008 | ~20 |
| `memory/progress.md` | modify (tracker progress) | LOGI-0013 row → DONE | 1 |
| `Docs/PROJECT_STATUS.md` | modify | stale roadmap rows 4–7 → DONE, LOGI-0008 becomes head | ~6 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `tests/e2e/start-api.mjs` | full | the LOGI-0013 deliverable: stale DB/WAL/SHM removed *before* `dotnet run`, absolute `Data Source` |
| `tests/e2e/playwright.config.ts` | 20-45 | absolute `E2E_DB_PATH` injected into the webServer env |
| `tests/e2e/global-setup.ts` | 1-40 | proof the DB is no longer unlinked while the API holds it open |
| `.github/workflows/ci.yml` | 80-115 | on-failure `test-results` + `api-logs` artifact upload |
| `memory/journal/LOGI-0013.md` | tail 40 (`tracker journal-tail`) | qa-arm close-out gates + the "what the next agent needs" note |
| `Docs/PROJECT_STATUS.md` | 44-68 | roadmap rows 4–8 + dependency prose |
| `tools/tracker/core.mjs` | 22-46 | `LEGAL_TRANSITIONS` (`in_progress->done`) + `ARM_BOUNDARIES.orchestrator` |

## 4. Steps (each with verify gate)
- [x] 1. Milestone 1 — Harness hold-check on the current tip: confirm the LOGI-0013 deliverable is still live (start-api.mjs prepares the throwaway DB before the API starts; global-setup.ts deletes no file; playwright.config.ts injects an absolute E2E_DB_PATH; ci.yml uploads api-logs + test-results on failure) → verify: `npx playwright test --list` exits 0 with 63 tests in 7 files; grep shows the DB deletion exists only in start-api.mjs
- [x] 2. Milestone 2 — Closure bookkeeping (CLI-only): `tracker claim`, `tracker seal` (orchestrator-arm section), `tracker handoff --ticket LOGI-0013 --from orchestrator --to done`, `tracker progress`, `tracker active --done ... --next ...` → verify: `tracker show --ticket LOGI-0013` reports status=done; `tracker ready` head is LOGI-0008 with no LOGI-0013 row
- [x] 3. Milestone 3 — Roadmap truth + one atomic arm commit: backfill `Docs/PROJECT_STATUS.md` rows 4–7 to DONE with evidence pointers (LOGI-0008 stays the queue head), then one commit `chore(LOGI-0013): close e2e-harness ticket (orchestrator disposition)` → verify: `git status --short` shows only derived `state/tasks.json`; `tracker status` = Active Arm NONE, head LOGI-0008

## 5. Risks / open questions
- The ticket is closed on **local + prior CI evidence** (run #17 on `75c039e`): protocol rule 7 forbids re-polling remote CI from the agent loop, so the hold-check is local (`--list` + harness invariants) rather than a new run.
- Closing LOGI-0013 must not erase the deferrals it recorded: Driver own-route scoping (`x-roles` Driver on `/shipments`) stays parked on LOGI-0009/0010, and the stale `PROJECT_STATUS` status cells are cosmetic (the event log wins).
- The roadmap backfill touches only the **Status** cell; the planned `Depends on` column stays LOGI-0016 §11.3's job to avoid a write collision with that plan.

## 6. Exit gates
- `npx playwright test --list` → `Total: 63 tests in 7 files`, exit 0 (harness alive on the current tip).
- Harness invariants proven: no DB/WAL/SHM deletion in `tests/e2e/global-setup.ts`; deletion only inside `tests/e2e/start-api.mjs`; `api-logs` artifact step present in `.github/workflows/ci.yml`.
- `tracker show --ticket LOGI-0013` → `status: done`; `tracker ready` head = LOGI-0008 with no LOGI-0013 row; `tracker ready --all` flags LOGI-0013 `dispatchable: false`.
- Journal carries the orchestrator-arm seal, `HANDOFF LOGI-0013 orchestrator→done` (legal `in_progress->done`), and `tracker status` reports Active Arm NONE.
- `git status --short` clean after the atomic commit (only derived `state/tasks.json` allowed).
