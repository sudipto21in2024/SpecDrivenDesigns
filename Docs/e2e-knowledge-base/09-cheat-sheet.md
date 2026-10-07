# 09 — Cheat Sheet & Reading Path

Quick lookup for the common E2E questions, plus how the E2E suite relates to the other two.

## 1. Where do I change X?

| I want to… | Touch |
|---|---|
| add an API-level test (new endpoint behavior) | new `*.spec.ts` in `tests/e2e/` using `api.ts` helpers + `request` |
| new helper for an endpoint | `support/*.ts` (e.g. `support/shipments.ts`) — the single API-access point for specs |
| change a selector/testid | `pages/*.ts` page object, then update the spec and verify with `codegen` |
| change how the DB is reset/initialized | `global-setup.ts` (API-level reset) + `start-api.mjs` (pre-start cleanup) |
| add a row the API cannot create | `support/shipments.ts`/`routes.ts` fixtures (direct SQLite, same `E2E_DB_PATH`) |
| change where the DB lives | `support/paths.ts` (single source of truth — update everywhere it is used) |
| make a spec parallel-safe | add unique data per run (`runId`+`seq`), sign in via `api.ts`, no cross-spec deps |
| change caches/timeouts | `playwright.config.ts` (`test.timeout`, `expect.timeout`, `actionTimeout`, `retries`) |
| change the browser surface | `pages/*.ts` + `data-testid` on MUI components (see frontend doc 03) |
| capture design parity screenshots | `node capture-design-parity.mjs` against the running Docker stack |
| debug a failing spec | `--debug` or `--ui` for the inspector; read `test-results/*/failure-text.txt` + trace |
| run only one test | `npx playwright test --grep @AC-6` or `--last-failed` |

## 2. Reading path for the three suites (where this fits)

```text
backend/knowledge-base/
  03 api-pipeline.md          → 08 business-rules.md          09 testing.md
  (how the API behaves + how it's tested)          ← e2e-knowledge-base/  ← frontend-knowledge-base/
        ↑                                          (browser-level acceptance)  (component-level unit tests)

  contract (shape/roles) ←───────────────────────────┘
```

- The E2E suite is the **whole integrated system** verdict: real API + real database + real
  frontend. The backend `dotnet test` (244) and frontend `npm test` (162) are the unit/component
  gates the E2E suite measures against.
- E2E-spec names trace to tickets (LOGI-0001…0013), and they assert the contract's status codes
  and `x-roles` at the browser level — the same contract the backend tests pin.

## 3. Quick command reference

```bash
cd c:\Sudipto\SpecDrivenDesigns\tests\e2e
npx playwright test                          # full suite (167 tests, ~4-6 min)
npx playwright test warehouses.spec.ts       # one file
npx playwright test --grep @AC-7             # one test/describe
npx playwright test --last-failed            # previously failed only
npx playwright test --debug                    # UI inspector with step-through
npx playwright test --ui                       # interactive watch mode
npx playwright test --reporter=list --reporter=github  # slower CI output
node capture-design-parity.mjs               # design-parity screenshots (Docker stack required)
```

## 4. Environment variables

| Variable | Usage |
|---|---|
| `E2E_DB_PATH` | absolute throwaway SQLite path (single source of truth in `support/paths.ts`) |
| `Database__ConnectionString` | set from the same path in the API webServer |
| `ASPNETCORE_ENVIRONMENT=Development` | API webServer env: migrations + seeding on startup |
| `CI` | enables `retries: 1` + `list`+`html` reporters; disables server reuse |

## 5. Known gotchas (the ones that have actually bitten the team)

1. **The DB-locking bug** (LOGI-0013): `unlink` a SQLite file while it is open → "no such table"
   500s on Linux/CI. The fix is that `start-api.mjs` deletes the files *before* the API starts.
2. **localStorage survives navigation**: a previous test's token boots the next test signed-in;
   `LoginPage.gotoAnonymous()` clears it before the initial navigation.
3. **WAL + busy timeout**: fixtures write directly into the DB the API reads; the busy timeout
   protects the fixture from the API's write lock, and `fullyParallel: false` guarantees the API is
   idle whenever a fixture runs.
4. **Per-run uniqueness**: forgetting `runId`+`seq` means a CI retry triggers unique-index 409s.
5. **One common failure mode**: an assert on the wrong layer (asserting DOM when the bug is the
   API response, or vice versa) — read the trace's network entry/exit first.
6. **`[AsParameters]` / `RequiresRoles` / `ProblemDetails`** — the backend-side machinery the specs
   exercise; see backend docs 03–07 if the API behavior is in question.

## 6. Validation

This document was assembled from the live suite: 167 tests across 25 spec files, green on run
(`warehouses.spec.ts` 8/8 passed in 35.6s including the ~25s API+preview startup), and the
README claims match the observed layout. Run `npx playwright test --list` to see the full suite
map at any time.
