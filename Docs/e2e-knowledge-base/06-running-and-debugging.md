# 06 — Running & Debugging

Everything you need to run the suite locally, read results, and debug a failure.

## 1. Running

```bash
cd c:\Sudipto\SpecDrivenDesigns\tests\e2e
npx playwright test                          # everything (167 tests, 25 files)
npx playwright test widgets.spec.ts          # one file
npx playwright test --grep @AC-6             # one test (tag) or describe
npx playwright test --last-failed            # retry only the failed ones
npx playwright test --debug                    # UI mode with the Playwright inspector
npx playwright test --headed --browser=chromium  # window visible (slows everything)
```

- Local: `reuseExistingServer: !process.env.CI` → if port 5199/5173 are already in use, the
  suite reuses whatever is running there (handy for testing against a locally-running backend).
  CI: always starts fresh via `start-api.mjs`.
- CI: `retries: 1`, `list` + `html` reporters → `playwright-report/index.html` plus the per-run
  `test-results/` artifacts (`<suffix>--<status>-<ticket>-<AC>` folders).
- The full suite: from a clean checkout, expect ~**4–6 minutes** (API start ~10s + preview build
  ~20s + ~150 spec tests). A single file: ~35s as timed (`warehouses.spec.ts` 8/8 passed).

## 2. Reading results

```
playwright-report/index.html      # consolidated report: videos/traces/failures
tests/e2e/test-results/           # per-test artifacts (screenshot + trace on failure)
  <suffix>--<status>-<ticket>-<AC>/   # e.g. shipments-list-LOGI-0007-s-b9a0c--400-ProblemDetails-not-500
      <timestamp>/
          failure-text.txt          # the failing expect message
          test-*.png / .zip (trace)
```

`trace: 'retain-on-failure'` means traces are kept for the last failed run; re-run with
`--reporter=list --trace on` (or `--debug`) to inspect a live failure interactively.

## 3. Debugging workflows

```bash
# slowest tests first
npx playwright test --reporter=list --reporter=github
# or with perf output
npx playwright test --reporter=list --reporter=line

# step through a failing test with the inspector
npx playwright test --debug

# UI mode (interactive, watch-mode friendly)
npx playwright test --ui
```

Playwright UI mode: step through tests, see DOM snapshots, network requests, and logs side by
side, and set breakpoints. Use it for the interactive trio (login, confirm dialogs, drag-drop on
the planning board).

## 4. Common failure signatures and what they mean

| Symptom | Likely cause |
|---|---|
| `no such table` / 500s throughout | stale/delete race: DB deleted while API holds it (`start-api.mjs` removes it before the API starts — check nothing else unlinks it) |
| 409 on unique key (`plate_number`, `license_number`) | another file's `uniqueRef`/`runId` collided; run the file alone first |
| 401 on every call | `signIn` failure or token not attached (`authHeaders`); check `TestAuth`-style helper |
| UI assertion fails but API check passes | wrong layer: API data correct, browser state stale (hard reload / new page) — look at the Playwright trace for the actual DOM |
| Spec times out at 30s | test does something wrong (sleep, waiting on a non-idle API, per-test DB reset); read the trace to find the stall |
| `fixture writes into different DB than the API reads` | `E2E_DB_PATH` drift: someone changed the constant in `paths.ts` but not the config; `grep E2E_DB_PATH` across `tests/e2e` |

## 5. Linting & housekeeping

- There is no Playwright lint rule set pinned; formatting is the repo's usual style (prettier
  config applies to TS/TSX at the repo level).
- `playwright-report/` is generated (gitignored in `.gitignore`); `test-results/` entries are
  evidence, not artifacts to commit.
- `capture-design-parity.mjs` is not a test (see doc 07) — leave it untouched unless you are
  changing the screen layouts.
