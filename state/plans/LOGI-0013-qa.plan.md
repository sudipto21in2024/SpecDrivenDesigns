---
ticket: LOGI-0013
arm: qa
status: done
created: 2026-09-21T00:00:00.000Z
depends_on_plans:
---

## 1. Objective
Diagnosed blocker: the CI `e2e` job has been red since run #11 (5 consecutive runs, incl. docs-only
pushes) while `build-and-test` is green. Evidence: same code went green (#10) → red (#11); run #14's
log shows the API returning **HTTP 500 for `POST /api/v1/auth/login`** from 04:36:0x onward, killing
every later test (8 failed / 22 passed), and expecting 401 but receiving 500.
Root cause: `tests/e2e/global-setup.ts` deletes `e2e-logiflow.db` (+ `-wal`/`-shm`) *while the API
process holds them open* (Playwright starts webServers before globalSetup). On Linux `unlink()`
succeeds, so SQLite keeps writing to deleted inodes; the next physical connection re-creates an
**empty** database → `no such table …` → 500 on every request. Windows locks the file, so the delete
silently fails locally — hence CI-only red.
Fix: make the throwaway DB genuinely throwaway *before* the API starts (never touch it while the app
runs) and make the CI job self-diagnosing (upload the API's Serilog file log on failure).

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `tests/e2e/start-api.mjs` | create | Prepare the throwaway SQLite file before the API starts | ~55 |
| `tests/e2e/playwright.config.ts` | modify | Use the wrapper + an absolute DB path (single source of truth) | ~15 |
| `tests/e2e/global-setup.ts` | modify | Stop deleting live DB files; reset rows via the API only | ~20 |
| `.github/workflows/ci.yml` | modify | Upload API Serilog log + Playwright artifacts on failure | ~12 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `tests/e2e/support/api.ts` | full | signIn/authHeaders helpers used by the reset |
| `tests/e2e/pages/warehouses.page.ts` | 1-40 | goto semantics used by specs |
| `src/backend/LogiFlow.Api/Program.cs` | 84-110 | Serilog file sink path + Development-only migrate/seed |
| `Docs/ProjectTechGuidence/06-testing-strategy-playwright.md` | 20-45 | Playwright DB conventions the harness must honour |

## 4. Steps (each with verify gate)
- [x] 1. Add `tests/e2e/start-api.mjs` and wire it into `playwright.config.ts` (absolute
  `Database__ConnectionString`, `E2E_DB_PATH`) → verify: wrapper prints the DB path it prepares and
  the suite still boots (local run reaches the tests).
- [x] 2. Remove the live-file `rmSync` block from `tests/e2e/global-setup.ts`; keep the API-driven row
  reset and extend it to `/drivers` (404-tolerant, for the LOGI-0005 qa arm) → verify: grep shows no
  `rmSync` left in the harness; suite green.
- [x] 3. Add the on-failure diagnostics artifact step to `.github/workflows/ci.yml` (Serilog `Logs`,
  `test-results`, `playwright-report`) → verify: YAML parses.
- [x] 4. Full local e2e suite (`npx playwright test` from `tests/e2e`) → verify: 30 passed, 0 flaky;
  fresh migration lines in `src/backend/LogiFlow.Api/Logs/logiflow-<today>.txt`, no `no such table`.
- [x] 5. Push and watch CI → verify: `e2e` job green on the new SHA (the real gate).

## 5. Risks / open questions
- The unlink mechanism is a high-confidence diagnosis, not a certainty: steps 3+5 make the next red run
  self-diagnosing (the Serilog artifact would name the real exception).
- `dotnet run` resolves a relative `Data Source` against its own working directory; the fix pins an
  absolute path so this can no longer drift between local and CI.
- Locally `reuseExistingServer` is on: a stale API on :5199 skips the wrapper, so kill leftovers before
  validating.

## 6. Exit gates
- Local e2e suite green (30 passed, 0 flaky).
- CI run on the pushed SHA: `build-and-test` + `e2e` green.
- LOGI-0005 frontend/qa arms unblocked (their gates depend on a trustworthy e2e job).
